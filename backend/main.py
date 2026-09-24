
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import os
from datetime import datetime
from zoneinfo import ZoneInfo

app = FastAPI(
    title="VA automações",
    description="API de monitoramento e automação do aquário",
    version="1.0.0"
)

# CORS para desenvolvimento.
# Vamos revisar esta configuração ao finalizar o projeto.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Localiza automaticamente a pasta principal do projeto
PASTA_PROJETO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Caminho do banco de dados
CAMINHO_BANCO = os.path.join(
    PASTA_PROJETO,
    "database",
    "aquario.db"
)


def horario_atual():
    """Retorna a data e o horário atual no fuso de São Paulo."""
    return datetime.now(
        ZoneInfo("America/Sao_Paulo")
    ).strftime("%d/%m/%Y %H:%M:%S")


def conectar_banco():
    """Abre uma conexão com o banco de dados do projeto."""
    return sqlite3.connect(CAMINHO_BANCO)


@app.get("/")
def inicio():
    return {
        "mensagem": "Sistema do aquário funcionando!"
    }


# =========================================================
# CONFIGURAÇÕES
# =========================================================

@app.get("/configuracoes")
def consultar_configuracoes():
    conexao = conectar_banco()
    cursor = conexao.cursor()

    cursor.execute("""
        SELECT
            id,
            temperatura_desejada,
            horario_alimentacao_1,
            horario_alimentacao_2,
            quantidade_racao,
            data_hora
        FROM configuracoes
        ORDER BY id DESC
        LIMIT 1
    """)

    configuracao = cursor.fetchone()
    conexao.close()

    if configuracao is None:
        return {
            "mensagem": "Nenhuma configuração cadastrada."
        }

    return {
        "id": configuracao[0],
        "temperatura_desejada": configuracao[1],
        "horario_alimentacao_1": configuracao[2],
        "horario_alimentacao_2": configuracao[3],
        "quantidade_racao": configuracao[4],
        "data_hora": configuracao[5]
    }


@app.post("/configuracoes")
def criar_configuracao(
    temperatura_desejada: float,
    horario_alimentacao_1: str,
    horario_alimentacao_2: str,
    quantidade_racao: float
):
    conexao = conectar_banco()
    cursor = conexao.cursor()

    data_hora = horario_atual()

    cursor.execute("""
        INSERT INTO configuracoes (
            temperatura_desejada,
            horario_alimentacao_1,
            horario_alimentacao_2,
            quantidade_racao,
            data_hora
        )
        VALUES (?, ?, ?, ?, ?)
    """, (
        temperatura_desejada,
        horario_alimentacao_1,
        horario_alimentacao_2,
        quantidade_racao,
        data_hora
    ))

    conexao.commit()
    conexao.close()

    return {
        "mensagem": "Configuração salva com sucesso!",
        "data_hora": data_hora
    }


@app.put("/configuracoes")
def atualizar_configuracao(
    temperatura_desejada: float,
    horario_alimentacao_1: str,
    horario_alimentacao_2: str,
    quantidade_racao: float
):
    conexao = conectar_banco()
    cursor = conexao.cursor()

    data_hora = horario_atual()

    cursor.execute("""
        UPDATE configuracoes
        SET
            temperatura_desejada = ?,
            horario_alimentacao_1 = ?,
            horario_alimentacao_2 = ?,
            quantidade_racao = ?,
            data_hora = ?
        WHERE id = (
            SELECT id
            FROM configuracoes
            ORDER BY id DESC
            LIMIT 1
        )
    """, (
        temperatura_desejada,
        horario_alimentacao_1,
        horario_alimentacao_2,
        quantidade_racao,
        data_hora
    ))

    conexao.commit()
    linhas_alteradas = cursor.rowcount
    conexao.close()

    if linhas_alteradas == 0:
        return {
            "mensagem": "Nenhuma configuração encontrada para atualizar."
        }

    return {
        "mensagem": "Configuração atualizada com sucesso!",
        "data_hora": data_hora
    }


# =========================================================
# TEMPERATURAS
# =========================================================

@app.post("/temperatura")
def registrar_temperatura(temperatura: float):
    conexao = conectar_banco()
    cursor = conexao.cursor()

    data_hora = horario_atual()

    cursor.execute("""
        INSERT INTO temperaturas (temperatura, data_hora)
        VALUES (?, ?)
    """, (temperatura, data_hora))

    conexao.commit()
    conexao.close()

    return {
        "mensagem": "Temperatura registrada com sucesso!",
        "temperatura": temperatura,
        "data_hora": data_hora
    }


@app.get("/temperaturas")
def consultar_temperaturas():
    conexao = conectar_banco()
    cursor = conexao.cursor()

    cursor.execute("""
        SELECT id, temperatura, data_hora
        FROM temperaturas
        ORDER BY id DESC
    """)

    registros = cursor.fetchall()
    conexao.close()

    return {
        "temperaturas": [
            {
                "id": registro[0],
                "temperatura": registro[1],
                "data_hora": registro[2]
            }
            for registro in registros
        ]
    }


# =========================================================
# MEDIÇÕES DE pH
# =========================================================

@app.post("/medicoes/ph")
def registrar_ph(
    ph: float = Query(..., ge=0, le=14)
):
    """
    Registra uma medição de pH.
    O valor deve estar entre 0 e 14.
    """
    conexao = conectar_banco()
    cursor = conexao.cursor()

    data_hora = horario_atual()

    cursor.execute("""
        INSERT INTO medicoes_ph (ph, data_hora)
        VALUES (?, ?)
    """, (ph, data_hora))

    conexao.commit()
    conexao.close()

    return {
        "mensagem": "Medição de pH registrada com sucesso!",
        "ph": ph,
        "data_hora": data_hora
    }


@app.get("/medicoes/ph")
def consultar_ph(
    limite: int = Query(100, ge=1, le=1000)
):
    """
    Consulta o histórico de medições de pH.
    Por padrão, retorna até 100 registros mais recentes.
    """
    conexao = conectar_banco()
    cursor = conexao.cursor()

    cursor.execute("""
        SELECT id, ph, data_hora
        FROM medicoes_ph
        ORDER BY id DESC
        LIMIT ?
    """, (limite,))

    registros = cursor.fetchall()
    conexao.close()

    return {
        "medicoes_ph": [
            {
                "id": registro[0],
                "ph": registro[1],
                "data_hora": registro[2]
            }
            for registro in registros
        ]
    }


# =========================================================
# ALIMENTAÇÕES
# =========================================================

@app.post("/alimentacao")
def registrar_alimentacao(tipo: str, quantidade: float):
    conexao = conectar_banco()
    cursor = conexao.cursor()

    data_hora = horario_atual()

    cursor.execute("""
        INSERT INTO alimentacoes (data_hora, tipo, quantidade)
        VALUES (?, ?, ?)
    """, (data_hora, tipo, quantidade))

    conexao.commit()
    conexao.close()

    return {
        "mensagem": "Alimentação registrada com sucesso!",
        "tipo": tipo,
        "quantidade": quantidade,
        "data_hora": data_hora
    }


@app.get("/alimentacoes")
def consultar_alimentacoes():
    conexao = conectar_banco()
    cursor = conexao.cursor()

    cursor.execute("""
        SELECT id, data_hora, tipo, quantidade
        FROM alimentacoes
        ORDER BY id DESC
    """)

    registros = cursor.fetchall()
    conexao.close()

    return {
        "alimentacoes": [
            {
                "id": registro[0],
                "data_hora": registro[1],
                "tipo": registro[2],
                "quantidade": registro[3]
            }
            for registro in registros
        ]
    }