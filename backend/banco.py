
import sqlite3
import os

# Localiza automaticamente a pasta principal do projeto
PASTA_PROJETO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Caminho do banco de dados dentro do projeto
CAMINHO_BANCO = os.path.join(
    PASTA_PROJETO,
    "database",
    "aquario.db"
)

# Cria a pasta database caso ela não exista
os.makedirs(os.path.dirname(CAMINHO_BANCO), exist_ok=True)

conexao = sqlite3.connect(CAMINHO_BANCO)
cursor = conexao.cursor()

# Tabela de configurações
cursor.execute("""
CREATE TABLE IF NOT EXISTS configuracoes (
    id INTEGER PRIMARY KEY,
    temperatura_desejada REAL NOT NULL,
    horario_alimentacao_1 TEXT,
    horario_alimentacao_2 TEXT,
    quantidade_racao REAL
)
""")

# Verifica se a coluna data_hora existe nas configurações
cursor.execute("PRAGMA table_info(configuracoes)")
colunas = [coluna[1] for coluna in cursor.fetchall()]

# Adiciona a coluna caso ainda não exista
if "data_hora" not in colunas:
    cursor.execute("""
        ALTER TABLE configuracoes
        ADD COLUMN data_hora DATETIME
    """)

# Tabela de temperaturas
cursor.execute("""
CREATE TABLE IF NOT EXISTS temperaturas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    temperatura REAL NOT NULL,
    data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
)
""")

# Tabela de medições de pH
cursor.execute("""
CREATE TABLE IF NOT EXISTS medicoes_ph (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ph REAL NOT NULL,
    data_hora DATETIME NOT NULL
)
""")

# Tabela de alimentações
cursor.execute("""
CREATE TABLE IF NOT EXISTS alimentacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
    tipo TEXT NOT NULL,
    quantidade REAL
)
""")

# Tabela de eventos
cursor.execute("""
CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    descricao TEXT,
    data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
)
""")

conexao.commit()
conexao.close()

print("Banco de dados atualizado com sucesso!")
print("Banco utilizado:", CAMINHO_BANCO)