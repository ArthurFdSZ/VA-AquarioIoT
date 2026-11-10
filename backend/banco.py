
"""Camada de acesso e inicialização do banco SQLite do VA automações."""

from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import sqlite3


PASTA_PROJETO = Path(__file__).resolve().parent.parent
PASTA_DATABASE = PASTA_PROJETO / "database"
CAMINHO_BANCO = PASTA_DATABASE / "aquario.db"


def conectar_banco() -> sqlite3.Connection:
    """Abre uma conexão configurada para trabalhar com linhas nomeadas."""
    PASTA_DATABASE.mkdir(parents=True, exist_ok=True)

    conexao = sqlite3.connect(CAMINHO_BANCO, timeout=15)
    conexao.row_factory = sqlite3.Row
    conexao.execute("PRAGMA foreign_keys = ON")
    conexao.execute("PRAGMA journal_mode = WAL")

    return conexao


def inicializar_banco() -> None:
    """Cria a estrutura atual do sistema. Pode ser executada mais de uma vez."""

    with conectar_banco() as conexao:
        conexao.executescript(
            """
            CREATE TABLE IF NOT EXISTS configuracoes (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                automacao_aquecedor INTEGER NOT NULL DEFAULT 1,
                temperatura_ligar REAL NOT NULL DEFAULT 24.5,
                temperatura_desligar REAL NOT NULL DEFAULT 26.0,
                automacao_alimentacao INTEGER NOT NULL DEFAULT 1,
                horario_alimentacao_1 TEXT NOT NULL DEFAULT '08:00',
                horario_alimentacao_2 TEXT NOT NULL DEFAULT '18:00',
                angulo_servo INTEGER NOT NULL DEFAULT 90,
                intervalo_atualizacao INTEGER NOT NULL DEFAULT 10,
                alerta_temperatura INTEGER NOT NULL DEFAULT 1,
                alerta_comunicacao INTEGER NOT NULL DEFAULT 1,
                atualizado_em TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS temperaturas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                temperatura REAL NOT NULL,
                data_hora TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS eventos_aquecedor (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                estado TEXT NOT NULL CHECK (estado IN ('ligado', 'desligado')),
                origem TEXT NOT NULL DEFAULT 'automatica'
                    CHECK (origem IN ('automatica', 'manual')),
                temperatura REAL,
                data_hora TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS alimentacoes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                origem TEXT NOT NULL CHECK (origem IN ('automatica', 'manual')),
                horario_programado TEXT,
                data_hora TEXT NOT NULL,
                status TEXT NOT NULL CHECK (
                    status IN ('executada', 'falhou', 'nao_executada')
                ),
                angulo_servo INTEGER,
                chave_execucao TEXT UNIQUE,
                comando_id INTEGER,
                observacao TEXT
            );

            CREATE TABLE IF NOT EXISTS eventos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT NOT NULL,
                descricao TEXT NOT NULL,
                gravidade TEXT NOT NULL DEFAULT 'informacao'
                    CHECK (gravidade IN ('informacao', 'aviso', 'erro', 'critico')),
                data_hora TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS comandos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT NOT NULL CHECK (tipo IN (
                    'alimentacao_manual', 'aquecedor_ligar', 'aquecedor_desligar'
                )),
                parametros_json TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente', 'executado', 'falhou', 'expirado')),
                criado_em TEXT NOT NULL,
                expira_em TEXT,
                executado_em TEXT,
                mensagem_resultado TEXT
            );

            CREATE TABLE IF NOT EXISTS dispositivo (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                nome TEXT NOT NULL DEFAULT 'ESP32 do aquário',
                ultima_comunicacao TEXT,
                versao_firmware TEXT,
                ultima_temperatura REAL
            );

            CREATE TABLE IF NOT EXISTS estado_alertas (
                chave TEXT PRIMARY KEY,
                ativo INTEGER NOT NULL DEFAULT 0,
                atualizado_em TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_temperaturas_data
                ON temperaturas(data_hora);

            CREATE INDEX IF NOT EXISTS idx_aquecedor_data
                ON eventos_aquecedor(data_hora);

            CREATE INDEX IF NOT EXISTS idx_alimentacoes_data
                ON alimentacoes(data_hora);

            CREATE INDEX IF NOT EXISTS idx_eventos_data
                ON eventos(data_hora);

            CREATE INDEX IF NOT EXISTS idx_comandos_status
                ON comandos(status, criado_em);

            DROP TABLE IF EXISTS medicoes_ph;
            """
        )

        agora = datetime.now(
            ZoneInfo("America/Sao_Paulo")
        ).isoformat(timespec="seconds")

        conexao.execute(
            """
            INSERT OR IGNORE INTO configuracoes (id, atualizado_em)
            VALUES (1, ?)
            """,
            (agora,),
        )

        conexao.execute(
            "INSERT OR IGNORE INTO dispositivo (id) VALUES (1)"
        )


if __name__ == "__main__":
    inicializar_banco()
    print(f"Banco inicializado em: {CAMINHO_BANCO}")
