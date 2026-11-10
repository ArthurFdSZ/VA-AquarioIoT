"""API do VA automações: monitoramento, configurações, eventos e comandos."""

from contextlib import closing
from datetime import datetime, timedelta
from typing import Literal, Optional
from zoneinfo import ZoneInfo
import json

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

try:
    from .banco import conectar_banco, inicializar_banco
except ImportError:  # permite executar também com: cd backend && uvicorn main:app
    from banco import conectar_banco, inicializar_banco

FUSO_HORARIO = ZoneInfo("America/Sao_Paulo")
TEMPO_LIMITE_CONEXAO_SEGUNDOS = 60

app = FastAPI(
    title="VA automações",
    description=(
        "API de monitoramento e automação de aquário. "
        "O ESP32 controla os componentes físicos; a API armazena e disponibiliza dados."
    ),
    version="2.0.0",
)

# Durante o desenvolvimento, permite o acesso do frontend local.
# Antes da publicação, substituir pelo endereço exato do frontend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def iniciar_aplicacao():
    inicializar_banco()


def agora() -> datetime:
    return datetime.now(FUSO_HORARIO)


def data_hora_atual() -> str:
    return agora().isoformat(timespec="seconds")


def normalizar_data_hora(valor: Optional[str]) -> Optional[str]:
    if valor is None:
        return None
    try:
        data = datetime.fromisoformat(valor)
        if data.tzinfo is None:
            data = data.replace(tzinfo=FUSO_HORARIO)
        return data.astimezone(FUSO_HORARIO).isoformat(timespec="seconds")
    except ValueError as erro:
        raise HTTPException(400, "Data/hora inválida. Use ISO 8601.") from erro


def registrar_evento(
    tipo: str,
    descricao: str,
    gravidade: str = "informacao",
    conexao=None,
):
    propria_conexao = conexao is None
    db = conexao or conectar_banco()
    db.execute(
        "INSERT INTO eventos (tipo, descricao, gravidade, data_hora) VALUES (?, ?, ?, ?)",
        (tipo, descricao, gravidade, data_hora_atual()),
    )
    if propria_conexao:
        db.commit()
        db.close()


def buscar_configuracoes(conexao=None):
    propria_conexao = conexao is None
    db = conexao or conectar_banco()
    registro = db.execute(
        "SELECT * FROM configuracoes WHERE id = 1"
    ).fetchone()
    if propria_conexao:
        db.close()
    return dict(registro) if registro else None


class ConfiguracoesAtualizacao(BaseModel):
    automacao_aquecedor: bool = True
    temperatura_ligar: float = Field(24.5, ge=0, le=40)
    temperatura_desligar: float = Field(26.0, ge=0, le=40)
    automacao_alimentacao: bool = True
    horario_alimentacao_1: str = "08:00"
    horario_alimentacao_2: str = "18:00"
    angulo_servo: int = Field(90, ge=0, le=180)
    intervalo_atualizacao: int = Field(10, ge=2, le=300)
    alerta_temperatura: bool = True
    alerta_comunicacao: bool = True

    @field_validator("horario_alimentacao_1", "horario_alimentacao_2")
    @classmethod
    def validar_horario(cls, valor: str) -> str:
        try:
            datetime.strptime(valor, "%H:%M")
        except ValueError as erro:
            raise ValueError("Horário deve estar no formato HH:MM.") from erro
        return valor

    @model_validator(mode="after")
    def validar_histerese(self):
        if self.temperatura_desligar <= self.temperatura_ligar:
            raise ValueError(
                "A temperatura para desligar deve ser maior que a temperatura para ligar."
            )
        return self


class TemperaturaEntrada(BaseModel):
    temperatura: float = Field(..., ge=-10, le=60)
    data_hora: Optional[str] = None


class EventoAquecedorEntrada(BaseModel):
    estado: Literal["ligado", "desligado"]
    origem: Literal["automatica", "manual"] = "automatica"
    temperatura: Optional[float] = Field(None, ge=-10, le=60)
    data_hora: Optional[str] = None


class AlimentacaoEntrada(BaseModel):
    origem: Literal["automatica", "manual"]
    status: Literal["executada", "falhou", "nao_executada"] = "executada"
    horario_programado: Optional[str] = None
    data_hora: Optional[str] = None
    angulo_servo: Optional[int] = Field(None, ge=0, le=180)
    chave_execucao: Optional[str] = Field(None, max_length=120)
    comando_id: Optional[int] = None
    observacao: Optional[str] = Field(None, max_length=500)

    @field_validator("horario_programado")
    @classmethod
    def validar_horario_programado(cls, valor):
        if valor is not None:
            try:
                datetime.fromisoformat(valor)
            except ValueError:
                try:
                    datetime.strptime(valor, "%H:%M")
                except ValueError as erro:
                    raise ValueError("Use HH:MM ou data/hora ISO 8601.") from erro
        return valor


class ComandoEntrada(BaseModel):
    tipo: Literal["alimentacao_manual", "aquecedor_ligar", "aquecedor_desligar"]
    duracao_segundos: Optional[int] = Field(None, ge=1, le=3600)
    angulo_servo: Optional[int] = Field(None, ge=0, le=180)

    @model_validator(mode="after")
    def validar_comando(self):
        if self.tipo == "aquecedor_ligar" and self.duracao_segundos is None:
            raise ValueError(
                "O comando manual para ligar o aquecedor exige duracao_segundos (1 a 3600)."
            )
        if self.tipo != "aquecedor_ligar" and self.duracao_segundos is not None:
            raise ValueError("Duração só é aceita para o comando aquecedor_ligar.")
        if self.tipo != "alimentacao_manual" and self.angulo_servo is not None:
            raise ValueError("Ângulo do servo só é aceito para alimentação manual.")
        return self


class ResultadoComando(BaseModel):
    status: Literal["executado", "falhou"]
    mensagem: Optional[str] = Field(None, max_length=500)


class HeartbeatEntrada(BaseModel):
    versao_firmware: Optional[str] = Field(None, max_length=50)


class EventoEntrada(BaseModel):
    tipo: str = Field(..., min_length=2, max_length=80)
    descricao: str = Field(..., min_length=2, max_length=500)
    gravidade: Literal["informacao", "aviso", "erro", "critico"] = "informacao"
    data_hora: Optional[str] = None



@app.get("/")
def inicio():
    return {
        "sistema": "VA automações",
        "versao_api": "2.0.0",
        "status": "online",
        "documentacao": "/docs",
    }


# -----------------------------------------------------------------------------
# CONFIGURAÇÕES
# -----------------------------------------------------------------------------

@app.get("/configuracoes")
def consultar_configuracoes():
    configuracao = buscar_configuracoes()
    if configuracao is None:
        raise HTTPException(500, "Configurações não inicializadas.")
    for campo in (
        "automacao_aquecedor", "automacao_alimentacao",
        "alerta_temperatura", "alerta_comunicacao",
    ):
        configuracao[campo] = bool(configuracao[campo])
    return configuracao


@app.put("/configuracoes")
def atualizar_configuracoes(dados: ConfiguracoesAtualizacao):
    valores = dados.model_dump()
    for campo in (
        "automacao_aquecedor", "automacao_alimentacao",
        "alerta_temperatura", "alerta_comunicacao",
    ):
        valores[campo] = int(valores[campo])

    with closing(conectar_banco()) as conexao:
        conexao.execute(
            """UPDATE configuracoes SET
                automacao_aquecedor = ?, temperatura_ligar = ?,
                temperatura_desligar = ?, automacao_alimentacao = ?,
                horario_alimentacao_1 = ?, horario_alimentacao_2 = ?,
                angulo_servo = ?, intervalo_atualizacao = ?,
                alerta_temperatura = ?, alerta_comunicacao = ?, atualizado_em = ?
                WHERE id = 1""",
            (
                valores["automacao_aquecedor"], valores["temperatura_ligar"],
                valores["temperatura_desligar"], valores["automacao_alimentacao"],
                valores["horario_alimentacao_1"], valores["horario_alimentacao_2"],
                valores["angulo_servo"], valores["intervalo_atualizacao"],
                valores["alerta_temperatura"], valores["alerta_comunicacao"],
                data_hora_atual(),
            ),
        )
        registrar_evento("configuracoes_atualizadas", "Configurações do sistema atualizadas.", conexao=conexao)
        conexao.commit()
    return {"mensagem": "Configurações atualizadas.", **consultar_configuracoes()}


# Endpoint dedicado ao ESP32: retorna somente parâmetros necessários ao dispositivo.
@app.get("/dispositivo/configuracoes")
def configuracoes_dispositivo():
    config = consultar_configuracoes()
    return {
        "automacao_aquecedor": config["automacao_aquecedor"],
        "temperatura_ligar": config["temperatura_ligar"],
        "temperatura_desligar": config["temperatura_desligar"],
        "automacao_alimentacao": config["automacao_alimentacao"],
        "horario_alimentacao_1": config["horario_alimentacao_1"],
        "horario_alimentacao_2": config["horario_alimentacao_2"],
        "angulo_servo": config["angulo_servo"],
    }


# -----------------------------------------------------------------------------
# TEMPERATURA E INDICADORES
# -----------------------------------------------------------------------------

@app.post("/temperaturas")
def registrar_temperatura(dados: TemperaturaEntrada):
    momento = normalizar_data_hora(dados.data_hora) or data_hora_atual()
    config = buscar_configuracoes()
    with closing(conectar_banco()) as conexao:
        cursor = conexao.execute(
            "INSERT INTO temperaturas (temperatura, data_hora) VALUES (?, ?)",
            (dados.temperatura, momento),
        )
        conexao.execute(
            "UPDATE dispositivo SET ultima_comunicacao = ?, ultima_temperatura = ? WHERE id = 1",
            (momento, dados.temperatura),
        )

        if config and config["alerta_temperatura"]:
            if dados.temperatura < config["temperatura_ligar"]:
                chave = "temperatura_fora_faixa"
                ativo = conexao.execute(
                    "SELECT ativo FROM estado_alertas WHERE chave = ?", (chave,)
                ).fetchone()
                if not ativo or not ativo["ativo"]:
                    registrar_evento(
                        "temperatura_baixa",
                        f"Temperatura abaixo do limite de acionamento: {dados.temperatura:.2f} °C.",
                        "aviso", conexao,
                    )
                conexao.execute(
                    "INSERT INTO estado_alertas (chave, ativo, atualizado_em) VALUES (?, 1, ?) "
                    "ON CONFLICT(chave) DO UPDATE SET ativo = 1, atualizado_em = excluded.atualizado_em",
                    (chave, momento),
                )
            elif dados.temperatura >= config["temperatura_desligar"]:
                chave = "temperatura_fora_faixa"
                ativo = conexao.execute(
                    "SELECT ativo FROM estado_alertas WHERE chave = ?", (chave,)
                ).fetchone()
                if not ativo or not ativo["ativo"]:
                    registrar_evento(
                        "temperatura_alta",
                        f"Temperatura atingiu ou ultrapassou o limite de desligamento: {dados.temperatura:.2f} °C.",
                        "aviso", conexao,
                    )
                conexao.execute(
                    "INSERT INTO estado_alertas (chave, ativo, atualizado_em) VALUES (?, 1, ?) "
                    "ON CONFLICT(chave) DO UPDATE SET ativo = 1, atualizado_em = excluded.atualizado_em",
                    (chave, momento),
                )
            else:
                ativo = conexao.execute(
                    "SELECT ativo FROM estado_alertas WHERE chave = 'temperatura_fora_faixa'"
                ).fetchone()
                if ativo and ativo["ativo"]:
                    registrar_evento(
                        "temperatura_normalizada",
                        f"Temperatura retornou à faixa configurada: {dados.temperatura:.2f} °C.",
                        "informacao", conexao,
                    )
                    conexao.execute(
                        "UPDATE estado_alertas SET ativo = 0, atualizado_em = ? "
                        "WHERE chave = 'temperatura_fora_faixa'", (momento,)
                    )
        conexao.commit()
        novo_id = cursor.lastrowid
    return {
        "mensagem": "Temperatura registrada.",
        "id": novo_id,
        "temperatura": dados.temperatura,
        "data_hora": momento,
    }


@app.get("/temperaturas")
def consultar_temperaturas(
    limite: int = Query(500, ge=1, le=10000),
    inicio: Optional[str] = None,
    fim: Optional[str] = None,
):
    inicio = normalizar_data_hora(inicio) if inicio else None
    fim = normalizar_data_hora(fim) if fim else None
    sql = "SELECT id, temperatura, data_hora FROM temperaturas WHERE 1 = 1"
    parametros = []
    if inicio:
        sql += " AND data_hora >= ?"
        parametros.append(inicio)
    if fim:
        sql += " AND data_hora <= ?"
        parametros.append(fim)
    sql += " ORDER BY data_hora DESC LIMIT ?"
    parametros.append(limite)
    with closing(conectar_banco()) as conexao:
        registros = conexao.execute(sql, parametros).fetchall()
    return {"temperaturas": [dict(item) for item in registros]}


def estatisticas_temperatura(dias: int):
    limite_data = (agora() - timedelta(days=dias)).isoformat(timespec="seconds")
    with closing(conectar_banco()) as conexao:
        registros = conexao.execute(
            "SELECT temperatura, data_hora FROM temperaturas WHERE data_hora >= ? ORDER BY data_hora",
            (limite_data,),
        ).fetchall()
        config = buscar_configuracoes(conexao)
    if not registros:
        return {
            "periodo_dias": dias, "quantidade_medicoes": 0,
            "atual": None, "media": None, "minima": None, "maxima": None,
            "variacao": None, "tendencia": "sem_dados",
            "estabilidade_percentual": None, "tempo_fora_faixa_minutos": None,
            "tempo_dentro_faixa_minutos": None,
        }

    valores = [float(r["temperatura"]) for r in registros]
    momentos = [datetime.fromisoformat(r["data_hora"]) for r in registros]
    dentro = fora = 0.0
    faixa_min = config["temperatura_ligar"]
    faixa_max = config["temperatura_desligar"]
    for i in range(len(registros) - 1):
        duracao = max(0.0, (momentos[i + 1] - momentos[i]).total_seconds())
        duracao = min(duracao, 15 * 60)  # evita supor estabilidade durante longas quedas de conexão
        if faixa_min <= valores[i] < faixa_max:
            dentro += duracao
        else:
            fora += duracao
    total = dentro + fora
    tendencia = "estavel"
    if len(valores) >= 2:
        diferenca = valores[-1] - valores[0]
        if diferenca > 0.2:
            tendencia = "subindo"
        elif diferenca < -0.2:
            tendencia = "descendo"
    with closing(conectar_banco()) as conexao:
        acionamentos = conexao.execute(
            "SELECT data_hora FROM eventos_aquecedor WHERE estado = 'ligado' AND data_hora >= ? ORDER BY data_hora",
            (limite_data,),
        ).fetchall()
        variacoes_horarias = {}
        for indice in range(1, len(registros)):
            hora = momentos[indice].strftime("%H:00")
            variacao = abs(valores[indice] - valores[indice - 1])
            variacoes_horarias.setdefault(hora, []).append(variacao)
        recuperacoes = []
        for acionamento in acionamentos:
            instante_ligou = datetime.fromisoformat(acionamento["data_hora"])
            recuperada = conexao.execute(
                "SELECT data_hora FROM temperaturas WHERE data_hora > ? AND temperatura >= ? ORDER BY data_hora LIMIT 1",
                (acionamento["data_hora"], faixa_min),
            ).fetchone()
            if recuperada:
                instante_recuperou = datetime.fromisoformat(recuperada["data_hora"])
                minutos = (instante_recuperou - instante_ligou).total_seconds() / 60
                if 0 <= minutos <= dias * 24 * 60:
                    recuperacoes.append(minutos)
    horas_ordenadas = sorted(
        variacoes_horarias.items(),
        key=lambda item: sum(item[1]) / len(item[1]),
        reverse=True,
    )
    return {
        "periodo_dias": dias,
        "quantidade_medicoes": len(valores),
        "atual": valores[-1],
        "media": round(sum(valores) / len(valores), 2),
        "minima": min(valores),
        "maxima": max(valores),
        "variacao": round(max(valores) - min(valores), 2),
        "tendencia": tendencia,
        "estabilidade_percentual": round((dentro / total) * 100, 2) if total else None,
        "tempo_dentro_faixa_minutos": round(dentro / 60, 2) if total else None,
        "tempo_fora_faixa_minutos": round(fora / 60, 2) if total else None,
        "tempo_recuperacao_medio_minutos": round(sum(recuperacoes) / len(recuperacoes), 2) if recuperacoes else None,
        "quantidade_recuperacoes_calculadas": len(recuperacoes),
        "horarios_maior_oscilacao": [
            {"hora": hora, "variacao_media": round(sum(valores_hora) / len(valores_hora), 3)}
            for hora, valores_hora in horas_ordenadas[:5]
        ],
        "observacao_estabilidade": "Estimativa baseada no intervalo entre amostras; lacunas acima de 15 minutos não são contabilizadas. A recuperação é estimada pela primeira leitura posterior ao acionamento que retorna ao limite de acionamento.",
    }


@app.get("/temperaturas/estatisticas")
def consultar_estatisticas_temperatura(dias: int = Query(7, ge=1, le=365)):
    return estatisticas_temperatura(dias)


# -----------------------------------------------------------------------------
# AQUECEDOR
# -----------------------------------------------------------------------------

@app.post("/aquecedor/eventos")
def registrar_evento_aquecedor(dados: EventoAquecedorEntrada):
    momento = normalizar_data_hora(dados.data_hora) or data_hora_atual()
    with closing(conectar_banco()) as conexao:
        ultimo = conexao.execute(
            "SELECT estado FROM eventos_aquecedor ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if ultimo and ultimo["estado"] == dados.estado:
            return {"mensagem": "Estado já registrado; nenhuma duplicação criada.", "duplicado": True}
        cursor = conexao.execute(
            "INSERT INTO eventos_aquecedor (estado, origem, temperatura, data_hora) VALUES (?, ?, ?, ?)",
            (dados.estado, dados.origem, dados.temperatura, momento),
        )
        registrar_evento(
            f"aquecedor_{dados.estado}",
            f"Aquecedor {dados.estado} ({dados.origem}).",
            "informacao", conexao,
        )
        conexao.execute(
            "UPDATE dispositivo SET ultima_comunicacao = ? WHERE id = 1", (momento,)
        )
        conexao.commit()
        novo_id = cursor.lastrowid
    return {"mensagem": "Evento do aquecedor registrado.", "id": novo_id, "duplicado": False}


@app.get("/aquecedor/status")
def status_aquecedor():
    with closing(conectar_banco()) as conexao:
        ultimo = conexao.execute(
            "SELECT estado, origem, temperatura, data_hora FROM eventos_aquecedor ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return dict(ultimo) if ultimo else {"estado": "desconhecido", "origem": None, "data_hora": None}


@app.get("/aquecedor/historico")
def historico_aquecedor(limite: int = Query(200, ge=1, le=5000)):
    with closing(conectar_banco()) as conexao:
        registros = conexao.execute(
            "SELECT * FROM eventos_aquecedor ORDER BY data_hora DESC LIMIT ?", (limite,)
        ).fetchall()
    return {"eventos": [dict(r) for r in registros]}


@app.get("/aquecedor/estatisticas")
def estatisticas_aquecedor(dias: int = Query(7, ge=1, le=365)):
    inicio = agora() - timedelta(days=dias)
    with closing(conectar_banco()) as conexao:
        eventos = conexao.execute(
            "SELECT estado, data_hora FROM eventos_aquecedor WHERE data_hora >= ? ORDER BY data_hora",
            (inicio.isoformat(timespec="seconds"),),
        ).fetchall()
        anterior = conexao.execute(
            "SELECT estado, data_hora FROM eventos_aquecedor WHERE data_hora < ? ORDER BY data_hora DESC LIMIT 1",
            (inicio.isoformat(timespec="seconds"),),
        ).fetchone()
    sequencia = ([anterior] if anterior else []) + list(eventos)
    ligado_desde = None
    duracoes = []
    momentos_acionamento = [
        datetime.fromisoformat(evento["data_hora"])
        for evento in eventos if evento["estado"] == "ligado"
    ]
    acionamentos = len(momentos_acionamento)
    acionamentos_por_horario = {}
    for instante in momentos_acionamento:
        hora = instante.strftime("%H:00")
        acionamentos_por_horario[hora] = acionamentos_por_horario.get(hora, 0) + 1
    intervalos = [
        (momentos_acionamento[i] - momentos_acionamento[i - 1]).total_seconds()
        for i in range(1, len(momentos_acionamento))
    ]
    for evento in sequencia:
        momento = max(datetime.fromisoformat(evento["data_hora"]), inicio)
        if evento["estado"] == "ligado":
            ligado_desde = momento
        elif evento["estado"] == "desligado" and ligado_desde:
            duracoes.append(max(0, (momento - ligado_desde).total_seconds()))
            ligado_desde = None
    if ligado_desde:
        duracoes.append(max(0, (agora() - ligado_desde).total_seconds()))
    total_segundos = sum(duracoes)
    return {
        "periodo_dias": dias,
        "quantidade_acionamentos": acionamentos,
        "tempo_total_ligado_minutos": round(total_segundos / 60, 2),
        "duracao_media_minutos": round((sum(duracoes) / len(duracoes)) / 60, 2) if duracoes else 0,
        "maior_duracao_minutos": round(max(duracoes) / 60, 2) if duracoes else 0,
        "intervalo_medio_entre_acionamentos_minutos": round((sum(intervalos) / len(intervalos)) / 60, 2) if intervalos else None,
        "acionamentos_por_horario": [
            {"hora": hora, "quantidade": quantidade}
            for hora, quantidade in sorted(acionamentos_por_horario.items())
        ],
        "estado_atual": status_aquecedor()["estado"],
    }


# -----------------------------------------------------------------------------
# ALIMENTAÇÃO
# -----------------------------------------------------------------------------

@app.post("/alimentacoes")
def registrar_alimentacao(dados: AlimentacaoEntrada):
    momento = normalizar_data_hora(dados.data_hora) or data_hora_atual()
    with closing(conectar_banco()) as conexao:
        try:
            cursor = conexao.execute(
                """INSERT INTO alimentacoes
                   (origem, horario_programado, data_hora, status, angulo_servo,
                    chave_execucao, comando_id, observacao)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    dados.origem, dados.horario_programado, momento, dados.status,
                    dados.angulo_servo, dados.chave_execucao, dados.comando_id,
                    dados.observacao,
                ),
            )
        except Exception as erro:
            if "UNIQUE constraint failed" in str(erro):
                existente = conexao.execute(
                    "SELECT id FROM alimentacoes WHERE chave_execucao = ?",
                    (dados.chave_execucao,),
                ).fetchone()
                return {"mensagem": "Execução já registrada.", "id": existente["id"], "duplicado": True}
            raise
        tipo_evento = "alimentacao_executada" if dados.status == "executada" else "alimentacao_nao_concluida"
        registrar_evento(
            tipo_evento,
            f"Alimentação {dados.status} ({dados.origem}).",
            "informacao" if dados.status == "executada" else "aviso",
            conexao,
        )
        conexao.execute(
            "UPDATE dispositivo SET ultima_comunicacao = ? WHERE id = 1", (momento,)
        )
        conexao.commit()
        novo_id = cursor.lastrowid
    return {"mensagem": "Registro de alimentação salvo.", "id": novo_id, "duplicado": False}


@app.get("/alimentacoes")
def consultar_alimentacoes(
    limite: int = Query(200, ge=1, le=5000),
    inicio: Optional[str] = None,
    fim: Optional[str] = None,
):
    inicio = normalizar_data_hora(inicio) if inicio else None
    fim = normalizar_data_hora(fim) if fim else None
    sql = "SELECT * FROM alimentacoes WHERE 1 = 1"
    parametros = []
    if inicio:
        sql += " AND data_hora >= ?"
        parametros.append(inicio)
    if fim:
        sql += " AND data_hora <= ?"
        parametros.append(fim)
    sql += " ORDER BY data_hora DESC LIMIT ?"
    parametros.append(limite)
    with closing(conectar_banco()) as conexao:
        registros = conexao.execute(sql, parametros).fetchall()
    return {"alimentacoes": [dict(r) for r in registros]}


@app.get("/alimentacoes/estatisticas")
def estatisticas_alimentacoes(dias: int = Query(30, ge=1, le=365)):
    inicio = (agora() - timedelta(days=dias)).isoformat(timespec="seconds")
    with closing(conectar_banco()) as conexao:
        registros = conexao.execute(
            "SELECT origem, status FROM alimentacoes WHERE data_hora >= ?", (inicio,)
        ).fetchall()
    total = len(registros)
    executadas = sum(1 for r in registros if r["status"] == "executada")
    automaticas = sum(1 for r in registros if r["origem"] == "automatica" and r["status"] == "executada")
    manuais = sum(1 for r in registros if r["origem"] == "manual" and r["status"] == "executada")
    programadas = [r for r in registros if r["origem"] == "automatica"]
    programadas_executadas = sum(1 for r in programadas if r["status"] == "executada")
    nao_executadas = sum(1 for r in programadas if r["status"] == "nao_executada")
    falhas = sum(1 for r in programadas if r["status"] == "falhou")
    return {
        "periodo_dias": dias,
        "total_registros": total,
        "total_executadas": executadas,
        "automaticas": automaticas,
        "manuais": manuais,
        "ocorrencias_programadas": len(programadas),
        "programadas_executadas": programadas_executadas,
        "nao_executadas": nao_executadas,
        "falhas_programadas": falhas,
        "percentual_cumprimento": round(programadas_executadas / len(programadas) * 100, 2) if programadas else None,
        "observacao": "O percentual considera somente ocorrências informadas à API; o ESP32 deverá reportar também horários não executados.",
    }


# -----------------------------------------------------------------------------
# COMANDOS MANUAIS
# -----------------------------------------------------------------------------

@app.post("/comandos", status_code=201)
def criar_comando(dados: ComandoEntrada):
    config = buscar_configuracoes()
    if dados.tipo.startswith("aquecedor_") and config["automacao_aquecedor"]:
        raise HTTPException(
            409,
            "Desative a automação do aquecedor antes de enviar um comando manual. Isso evita conflito entre controle manual e automático.",
        )
    parametros = {}
    if dados.duracao_segundos is not None:
        parametros["duracao_segundos"] = dados.duracao_segundos
    if dados.angulo_servo is not None:
        parametros["angulo_servo"] = dados.angulo_servo
    if dados.tipo == "alimentacao_manual" and "angulo_servo" not in parametros:
        parametros["angulo_servo"] = config["angulo_servo"]
    criado = agora()
    expira = criado + timedelta(minutes=5)
    with closing(conectar_banco()) as conexao:
        cursor = conexao.execute(
            "INSERT INTO comandos (tipo, parametros_json, status, criado_em, expira_em) VALUES (?, ?, 'pendente', ?, ?)",
            (dados.tipo, json.dumps(parametros), criado.isoformat(timespec="seconds"), expira.isoformat(timespec="seconds")),
        )
        registrar_evento("comando_criado", f"Comando manual criado: {dados.tipo}.", "informacao", conexao)
        conexao.commit()
        comando_id = cursor.lastrowid
    return {
        "mensagem": "Comando enviado para a fila.",
        "comando": {
            "id": comando_id,
            "tipo": dados.tipo,
            "parametros": parametros,
            "status": "pendente",
            "expira_em": expira.isoformat(timespec="seconds"),
        },
    }


@app.get("/dispositivo/comandos/pendentes")
def consultar_comandos_pendentes():
    momento = data_hora_atual()
    with closing(conectar_banco()) as conexao:
        conexao.execute(
            "UPDATE comandos SET status = 'expirado' WHERE status = 'pendente' AND expira_em < ?",
            (momento,),
        )
        registros = conexao.execute(
            "SELECT id, tipo, parametros_json, criado_em, expira_em FROM comandos "
            "WHERE status = 'pendente' ORDER BY id",
        ).fetchall()
        conexao.commit()
    return {
        "comandos": [
            {
                "id": r["id"], "tipo": r["tipo"],
                "parametros": json.loads(r["parametros_json"]),
                "criado_em": r["criado_em"], "expira_em": r["expira_em"],
            }
            for r in registros
        ]
    }


@app.put("/dispositivo/comandos/{comando_id}/resultado")
def informar_resultado_comando(comando_id: int, dados: ResultadoComando):
    momento = data_hora_atual()
    with closing(conectar_banco()) as conexao:
        comando = conexao.execute(
            "SELECT tipo, status FROM comandos WHERE id = ?", (comando_id,)
        ).fetchone()
        if not comando:
            raise HTTPException(404, "Comando não encontrado.")
        if comando["status"] != "pendente":
            raise HTTPException(409, "Este comando não está mais pendente.")
        conexao.execute(
            "UPDATE comandos SET status = ?, executado_em = ?, mensagem_resultado = ? WHERE id = ?",
            (dados.status, momento, dados.mensagem, comando_id),
        )
        registrar_evento(
            "comando_" + dados.status,
            f"Comando {comando_id} ({comando['tipo']}) {dados.status}.",
            "informacao" if dados.status == "executado" else "erro",
            conexao,
        )
        conexao.commit()
    return {"mensagem": "Resultado do comando registrado.", "comando_id": comando_id, "status": dados.status}


@app.get("/comandos")
def consultar_comandos(limite: int = Query(100, ge=1, le=1000)):
    with closing(conectar_banco()) as conexao:
        registros = conexao.execute(
            "SELECT * FROM comandos ORDER BY id DESC LIMIT ?", (limite,)
        ).fetchall()
    resultado = []
    for r in registros:
        item = dict(r)
        item["parametros"] = json.loads(item.pop("parametros_json"))
        resultado.append(item)
    return {"comandos": resultado}


# -----------------------------------------------------------------------------
# EVENTOS E COMUNICAÇÃO DO DISPOSITIVO
# -----------------------------------------------------------------------------

@app.post("/eventos", status_code=201)
def criar_evento(dados: EventoEntrada):
    momento = normalizar_data_hora(dados.data_hora) or data_hora_atual()
    with closing(conectar_banco()) as conexao:
        cursor = conexao.execute(
            "INSERT INTO eventos (tipo, descricao, gravidade, data_hora) VALUES (?, ?, ?, ?)",
            (dados.tipo, dados.descricao, dados.gravidade, momento),
        )
        conexao.commit()
    return {"mensagem": "Evento registrado.", "id": cursor.lastrowid}


@app.get("/eventos")
def consultar_eventos(
    limite: int = Query(100, ge=1, le=5000),
    gravidade: Optional[Literal["informacao", "aviso", "erro", "critico"]] = None,
):
    sql = "SELECT * FROM eventos"
    parametros = []
    if gravidade:
        sql += " WHERE gravidade = ?"
        parametros.append(gravidade)
    sql += " ORDER BY data_hora DESC LIMIT ?"
    parametros.append(limite)
    with closing(conectar_banco()) as conexao:
        registros = conexao.execute(sql, parametros).fetchall()
    return {"eventos": [dict(r) for r in registros]}


@app.post("/dispositivo/heartbeat")
def receber_heartbeat(dados: HeartbeatEntrada):
    momento = data_hora_atual()
    with closing(conectar_banco()) as conexao:
        anterior = conexao.execute(
            "SELECT ultima_comunicacao FROM dispositivo WHERE id = 1"
        ).fetchone()
        alerta = conexao.execute(
            "SELECT ativo FROM estado_alertas WHERE chave = 'comunicacao_perdida'"
        ).fetchone()
        conexao.execute(
            "UPDATE dispositivo SET ultima_comunicacao = ?, versao_firmware = COALESCE(?, versao_firmware) WHERE id = 1",
            (momento, dados.versao_firmware),
        )
        if alerta and alerta["ativo"]:
            registrar_evento("dispositivo_reconectado", "Comunicação com o ESP32 restabelecida.", "informacao", conexao)
            conexao.execute(
                "UPDATE estado_alertas SET ativo = 0, atualizado_em = ? WHERE chave = 'comunicacao_perdida'",
                (momento,),
            )
        elif anterior and anterior["ultima_comunicacao"] is None:
            registrar_evento("dispositivo_conectado", "ESP32 enviou a primeira comunicação.", "informacao", conexao)
        conexao.commit()
    return {"mensagem": "Comunicação recebida.", "data_hora": momento}


@app.get("/dispositivo/status")
def consultar_status_dispositivo():
    with closing(conectar_banco()) as conexao:
        dispositivo = conexao.execute("SELECT * FROM dispositivo WHERE id = 1").fetchone()
    ultima = dispositivo["ultima_comunicacao"] if dispositivo else None
    online = False
    if ultima:
        try:
            instante = datetime.fromisoformat(ultima)
            online = (agora() - instante).total_seconds() <= TEMPO_LIMITE_CONEXAO_SEGUNDOS
        except ValueError:
            online = False
    if ultima and not online:
        config = buscar_configuracoes()
        if config and config["alerta_comunicacao"]:
            with closing(conectar_banco()) as conexao:
                alerta = conexao.execute(
                    "SELECT ativo FROM estado_alertas WHERE chave = 'comunicacao_perdida'"
                ).fetchone()
                if not alerta or not alerta["ativo"]:
                    registrar_evento(
                        "dispositivo_desconectado",
                        "Nenhuma comunicação do ESP32 dentro do tempo limite.",
                        "erro", conexao,
                    )
                    conexao.execute(
                        "INSERT INTO estado_alertas (chave, ativo, atualizado_em) VALUES ('comunicacao_perdida', 1, ?) "
                        "ON CONFLICT(chave) DO UPDATE SET ativo = 1, atualizado_em = excluded.atualizado_em",
                        (data_hora_atual(),),
                    )
                    conexao.commit()
    return {
        "conectado": online,
        "ultima_comunicacao": ultima,
        "versao_firmware": dispositivo["versao_firmware"] if dispositivo else None,
        "ultima_temperatura": dispositivo["ultima_temperatura"] if dispositivo else None,
        "tempo_limite_segundos": TEMPO_LIMITE_CONEXAO_SEGUNDOS,
    }


# -----------------------------------------------------------------------------
# RESUMO DO DASHBOARD
# -----------------------------------------------------------------------------

@app.get("/dashboard/resumo")
def resumo_dashboard():
    with closing(conectar_banco()) as conexao:
        ultima_temperatura = conexao.execute(
            "SELECT temperatura, data_hora FROM temperaturas ORDER BY data_hora DESC LIMIT 1"
        ).fetchone()
        ultima_alimentacao = conexao.execute(
            "SELECT * FROM alimentacoes WHERE status = 'executada' ORDER BY data_hora DESC LIMIT 1"
        ).fetchone()
        total_eventos = conexao.execute("SELECT COUNT(*) AS total FROM eventos").fetchone()["total"]
        config = buscar_configuracoes(conexao)
    aquecedor = status_aquecedor()
    dispositivo = consultar_status_dispositivo()
    proxima = None
    if config and config["automacao_alimentacao"]:
        horarios = [config["horario_alimentacao_1"], config["horario_alimentacao_2"]]
        agora_local = agora()
        candidatos = []
        for horario in horarios:
            h, m = map(int, horario.split(":"))
            candidato = agora_local.replace(hour=h, minute=m, second=0, microsecond=0)
            if candidato <= agora_local:
                candidato += timedelta(days=1)
            candidatos.append(candidato)
        proxima = min(candidatos).isoformat(timespec="minutes")
    return {
        "temperatura": dict(ultima_temperatura) if ultima_temperatura else None,
        "aquecedor": aquecedor,
        "alimentacao": {
            "ultima": dict(ultima_alimentacao) if ultima_alimentacao else None,
            "proxima": proxima,
            "automacao_ativa": bool(config["automacao_alimentacao"]) if config else False,
        },
        "dispositivo": dispositivo,
        "total_eventos": total_eventos,
        "configuracoes": config,
    }


