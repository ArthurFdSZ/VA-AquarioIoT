# VA-AquarioIoT

Sistema de automação e monitoramento de aquários baseado em uma arquitetura IoT, integrando aplicação web, API REST, persistência de dados e uma camada embarcada para futura comunicação com hardware.

O projeto foi estruturado de forma modular para separar **interface**, **regra de negócio**, **persistência de dados** e **sistema embarcado**, permitindo que os componentes sejam desenvolvidos e testados de forma independente.

> **Status:** Em desenvolvimento.

---

## Visão Geral

O VA-AquarioIoT tem como objetivo desenvolver uma plataforma capaz de centralizar o monitoramento e a configuração de um aquário automatizado.

A aplicação é dividida em quatro componentes principais:

- **Frontend:** interface de monitoramento e configuração;
- **Backend:** processamento das requisições e gerenciamento da aplicação;
- **Banco de dados:** persistência das configurações e dados de telemetria;
- **Sistema embarcado:** camada responsável pela futura integração com sensores e atuadores.

A arquitetura foi desenvolvida para permitir que o software continue evoluindo independentemente da definição final dos componentes físicos.

---

## Arquitetura

```text
┌───────────────────────────────┐
│           FRONTEND            │
│                               │
│     HTML • CSS • JavaScript   │
│                               │
│ Dashboard / Configurações     │
└───────────────┬───────────────┘
                │
                │ HTTP
                │ REST / JSON
                ▼
┌───────────────────────────────┐
│            BACKEND            │
│                               │
│       Python • FastAPI        │
│                               │
│ API / Regras da aplicação     │
└───────────┬───────────┬───────┘
            │           │
            │           │
            ▼           ▼
┌───────────────────┐   ┌─────────────────────┐
│      DATABASE     │   │ SISTEMA EMBARCADO   │
│                   │   │                     │
│      SQLite       │   │       C / C++       │
│                   │   │                     │
│ Persistência      │   │ Integração IoT      │
└───────────────────┘   └─────────────────────┘
```

Essa separação reduz o acoplamento entre os componentes e facilita manutenção, testes e desenvolvimento colaborativo.

---

## Stack Tecnológica

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend | HTML5 | Estrutura da interface |
| Frontend | CSS3 | Layout e responsividade |
| Frontend | JavaScript | Lógica da interface e comunicação com a API |
| Backend | Python | Lógica da aplicação |
| Backend | FastAPI | Implementação da API REST |
| Servidor | Uvicorn | Execução ASGI da aplicação FastAPI |
| Persistência | SQLite | Armazenamento local dos dados |
| Comunicação | HTTP | Transporte entre os componentes |
| Arquitetura de API | REST | Organização da comunicação cliente-servidor |
| Serialização | JSON | Representação e transferência de dados |
| Embarcado | C / C++ | Desenvolvimento da camada de integração IoT |
| Versionamento | Git | Controle de versões |
| Repositório | GitHub | Colaboração e armazenamento do código |
| Desenvolvimento | VS Code | Ambiente de desenvolvimento |

---

## Fluxo de Dados

O projeto diferencia dois fluxos principais.

### Configuração

```text
Usuário
   │
   ▼
Dashboard
   │
   ▼
API
   │
   ▼
Banco de Dados
   │
   ▼
Sistema Embarcado
```

As configurações representam os parâmetros definidos pelo usuário para o funcionamento do sistema.

### Telemetria

```text
Sistema Embarcado
        │
        ▼
       API
        │
        ▼
 Banco de Dados
        │
        ▼
    Dashboard
```

A telemetria representa informações registradas pelo sistema durante sua operação.

Essa separação permite distinguir o **estado desejado**, definido pelo usuário, do **estado observado**, registrado pelo sistema.

---

## Persistência de Dados

O projeto utiliza SQLite como mecanismo de persistência durante o desenvolvimento.

A estrutura atual contempla dados relacionados a:

- Configurações do sistema;
- Histórico de temperatura;
- Histórico de pH;
- Histórico de alimentação;
- Eventos da aplicação.

A modelagem separa dados de configuração dos dados de telemetria para evitar mistura de responsabilidades.

O SQLite foi escolhido por oferecer uma solução leve, local e de baixa complexidade para o estágio atual do projeto.

---

## Dashboard

O frontend funciona como interface de supervisão e configuração do sistema.

A interface foi estruturada para apresentar:

- Estado geral do sistema;
- Dados de temperatura;
- Dados de pH;
- Informações relacionadas à alimentação;
- Gráficos históricos;
- Eventos registrados;
- Configuração dos parâmetros de operação.

Os dados apresentados pelo dashboard são obtidos através da camada de backend.

---

## Backend

O backend é desenvolvido utilizando **Python e FastAPI**.

Sua responsabilidade é atuar como camada intermediária entre:

```text
Frontend ↔ Backend ↔ Banco de Dados
                     ↕
              Sistema Embarcado
```

Entre suas responsabilidades estão:

- Receber requisições do frontend;
- Processar dados da aplicação;
- Gerenciar configurações;
- Registrar dados de telemetria;
- Consultar informações persistidas;
- Disponibilizar dados para o dashboard;
- Fornecer uma interface de comunicação para a futura camada embarcada.

---

## Sistema Embarcado

A camada embarcada está sendo estruturada em **C/C++**.

Sua função será estabelecer a comunicação entre o software e o hardware responsável pela automação do aquário.

A definição dos sensores, atuadores, circuitos e demais componentes físicos ainda faz parte da evolução do projeto.

Por esse motivo, a arquitetura de software procura não depender de um modelo específico de hardware durante esta etapa.

---

## Comunicação

Atualmente, a arquitetura utiliza:

```text
HTTP
 │
 ▼
REST
 │
 ▼
JSON
```

**HTTP** é utilizado como protocolo de comunicação.

**REST** define a organização da comunicação entre os componentes.

**JSON** é utilizado para representação e transferência estruturada dos dados.

A arquitetura poderá incorporar outros protocolos de comunicação IoT conforme os requisitos do hardware e da infraestrutura forem definidos.

---

## Estrutura do Projeto

```text
VA-AquarioIoT/
│
├── backend/
│   ├── banco.py
│   └── main.py
│
├── database/
│   └── aquario.db
│
├── esp32/
│   └── simulador.cpp
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
│
├── .gitignore
└── README.md
```

### `backend/`

Contém a API, regras da aplicação e comunicação com a camada de persistência.

### `database/`

Contém o banco SQLite utilizado durante o desenvolvimento.

### `esp32/`

Área destinada ao desenvolvimento e aos testes da camada embarcada.

### `frontend/`

Contém a interface web responsável pelo dashboard e pelas configurações.

---

## Execução do Ambiente

### Requisitos

Para executar o ambiente atual são necessários:

- Python;
- FastAPI;
- Uvicorn;
- tzdata;
- Navegador web.

Instalação das dependências Python:

```bash
pip install fastapi uvicorn tzdata
```

### Preparação do banco

Na raiz do projeto:

```bash
python backend/banco.py
```

### Inicialização do backend

```bash
uvicorn backend.main:app --reload
```

Durante o desenvolvimento, a aplicação utiliza um servidor local para disponibilizar a API.

### Frontend

O frontend está localizado em:

```text
frontend/index.html
```

A interface pode ser aberta no navegador durante o desenvolvimento.

---

## Estado Atual

### Implementado

- Estrutura modular do projeto;
- Banco de dados SQLite;
- Persistência das configurações;
- Persistência de dados de monitoramento;
- Backend utilizando FastAPI;
- Comunicação REST utilizando JSON;
- Dashboard web;
- Integração entre frontend e backend;
- Visualização de dados históricos;
- Estrutura inicial para integração IoT;
- Versionamento utilizando Git e GitHub.

### Em desenvolvimento

- Integração da camada embarcada;
- Definição do hardware;
- Comunicação entre hardware e backend;
- Automação dos processos físicos;
- Atualização de telemetria através do sistema embarcado;
- Testes de integração entre software e hardware.

---

## Diretrizes de Arquitetura

O projeto segue alguns princípios técnicos:

**Separação de responsabilidades**

Cada camada possui uma responsabilidade específica, reduzindo dependências desnecessárias.

**Baixo acoplamento**

O frontend não acessa diretamente o banco de dados e a camada embarcada não depende da interface web.

**Persistência independente**

Os dados são centralizados através da camada de backend.

**Arquitetura extensível**

Novos sensores, atuadores e protocolos poderão ser incorporados sem necessidade de reconstruir toda a aplicação.

**Desenvolvimento incremental**

Software, banco de dados, interface e sistema embarcado podem evoluir separadamente até a integração final.

---

## Versionamento

O projeto utiliza **Git** para controle de versões e **GitHub** para colaboração entre os integrantes.

O desenvolvimento colaborativo deverá utilizar branches para separar novas funcionalidades da versão principal do sistema.

Fluxo recomendado:

```text
main
 │
 ├── feature/frontend
 │
 ├── feature/backend
 │
 ├── feature/database
 │
 └── feature/embedded
```

Após validação, as alterações podem ser integradas à branch principal.

---

## Próximas Etapas

As próximas etapas técnicas incluem:

1. Definição dos componentes físicos;
2. Desenvolvimento da camada embarcada;
3. Implementação da comunicação hardware/software;
4. Integração dos dados de telemetria;
5. Implementação da lógica de atuação;
6. Testes integrados;
7. Revisão de segurança e configuração de CORS;
8. Preparação da aplicação para execução fora do ambiente local.

---

## Contexto do Projeto

O VA-AquarioIoT é um projeto acadêmico voltado à aplicação prática de conceitos de:

- Internet das Coisas (IoT);
- Sistemas embarcados;
- Desenvolvimento backend;
- APIs REST;
- Banco de dados;
- Desenvolvimento frontend;
- Automação;
- Integração hardware/software;
- Arquitetura de software;
- Versionamento e desenvolvimento colaborativo.

---

## Observação

O projeto encontra-se em desenvolvimento.

A arquitetura de software está sendo construída antes da definição completa do hardware. Portanto, sensores, atuadores e estratégias de controle poderão ser definidos ou alterados conforme os requisitos técnicos do sistema forem consolidados.
