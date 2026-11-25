#include <WiFi.h>
#include <HTTPClient.h>
#include <ESP32Servo.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>

// =====================================
// CONEXAO WIFI E FASTAPI
// =====================================

const char* SSID = "Picles";
const char* SENHA = "pao12345";

const char* API_BASE = "http://172.20.10.11:8000";

// =====================================
// PINOS
// =====================================

#define PINO_SERVO 18
#define PINO_SENSOR 4

#define PINO_RELE1 22
#define PINO_RELE2 23

// Mantidos conforme o codigo original.
const uint8_t RELE_LIGADO = HIGH;
const uint8_t RELE_DESLIGADO = LOW;

// =====================================
// CONTROLE DE TEMPERATURA
// =====================================

const float TEMPERATURA_MINIMA = 24.5f;
const float TEMPERATURA_MAXIMA = 27.0f;

const unsigned long INTERVALO_LEITURA = 2000;

// =====================================
// COMUNICACAO HTTP
// =====================================

const unsigned long INTERVALO_HTTP = 10000;
const unsigned long INTERVALO_RECONEXAO = 10000;

// =====================================
// SERVO MOTOR
// =====================================

const int ANGULO_INICIAL = 0;
const int ANGULO_PADRAO = 90;

const unsigned long TEMPO_MOVIMENTO_SERVO = 3000;

// =====================================
// OBJETOS
// =====================================

OneWire oneWire(PINO_SENSOR);
DallasTemperature sensor(&oneWire);

Servo servo;

// =====================================
// VARIAVEIS
// =====================================

unsigned long ultimaLeitura = 0;
unsigned long ultimaComunicacao = 0;
unsigned long ultimaTentativaWiFi = 0;

float ultimaTemperatura = 0;

bool temperaturaValida = false;
bool aquecedorLigado = false;

// Evita repetir o ultimo comando durante
// a mesma inicializacao do ESP32.
// Nao protege contra reinicializacoes.
int ultimoComandoAlimentacaoExecutado = -1;

// =====================================
// CONTROLE DO AQUECEDOR
// =====================================

void atualizarAquecedor(bool ligado) {

  aquecedorLigado = ligado;

  digitalWrite(
    PINO_RELE1,
    ligado ? RELE_LIGADO : RELE_DESLIGADO
  );

  digitalWrite(
    PINO_RELE2,
    ligado ? RELE_LIGADO : RELE_DESLIGADO
  );
}

// =====================================
// LEITURA DE TEMPERATURA
// =====================================

void lerTemperatura() {

  sensor.requestTemperatures();

  float valor = sensor.getTempCByIndex(0);

  temperaturaValida =
    valor != DEVICE_DISCONNECTED_C &&
    valor >= -55.0f &&
    valor <= 125.0f;

  if (!temperaturaValida) {

    atualizarAquecedor(false);

    Serial.println("--------------------------");
    Serial.println("ERRO: SENSOR DESCONECTADO!");
    Serial.println("AQUECEDOR DESLIGADO POR SEGURANCA!");

    return;
  }

  ultimaTemperatura = valor;

  // MESMA LOGICA DO CODIGO ORIGINAL

  if (valor <= TEMPERATURA_MINIMA) {

    atualizarAquecedor(true);

  } else if (valor >= TEMPERATURA_MAXIMA) {

    atualizarAquecedor(false);
  }

  Serial.println("--------------------------");

  Serial.print("Temperatura da agua: ");
  Serial.print(valor);
  Serial.println(" C");

  if (aquecedorLigado) {

    Serial.println("AQUECEDOR: LIGADO");

  } else {

    Serial.println("AQUECEDOR: DESLIGADO");
  }
}

// =====================================
// CONEXAO WIFI
// =====================================

void conectarWiFi() {

  Serial.println();
  Serial.println("==========================");
  Serial.println("INICIANDO CONEXAO WIFI");
  Serial.println("==========================");

  WiFi.mode(WIFI_STA);

  WiFi.begin(SSID, SENHA);

  Serial.println("Tentativa de conexao iniciada.");
  Serial.println("Aguardando conexao em segundo plano...");
}

// =====================================
// MONITORAMENTO WIFI
// =====================================

void verificarWiFi() {

  static bool estavaConectado = false;

  bool conectado = WiFi.status() == WL_CONNECTED;

  if (conectado && !estavaConectado) {

    Serial.println();
    Serial.println("==========================");
    Serial.println("WIFI CONECTADO!");
    Serial.println("==========================");

    Serial.print("REDE: ");
    Serial.println(SSID);

    Serial.print("IP DO ESP32: ");
    Serial.println(WiFi.localIP());

    Serial.print("SINAL WIFI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");

    Serial.print("ENDERECO FASTAPI: ");
    Serial.println(API_BASE);
  }

  if (!conectado && estavaConectado) {

    Serial.println();
    Serial.println("WIFI DESCONECTADO!");
  }

  estavaConectado = conectado;
}

// =====================================
// INICIAR REQUISICAO HTTP
// =====================================

bool iniciarHttp(HTTPClient& http, const String& rota) {

  if (WiFi.status() != WL_CONNECTED) {

    Serial.println("HTTP cancelado: Wi-Fi desconectado.");

    return false;
  }

  http.setTimeout(2500);

  String url = String(API_BASE) + rota;

  if (!http.begin(url)) {

    Serial.print("Erro ao iniciar HTTP: ");
    Serial.println(url);

    return false;
  }

  return true;
}

// =====================================
// ENVIAR TEMPERATURA
// =====================================

void enviarTemperatura() {

  if (!temperaturaValida) {

    Serial.println("Temperatura invalida: envio ignorado.");

    return;
  }

  HTTPClient http;

  if (!iniciarHttp(http, "/temperaturas")) {
    return;
  }

  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;

  doc["temperatura"] = ultimaTemperatura;

  String payload;

  serializeJson(doc, payload);

  int status = http.POST(payload);

  Serial.print("POST /temperaturas: ");
  Serial.println(status);

  if (status < 0) {

    Serial.print("Erro HTTP: ");
    Serial.println(http.errorToString(status));
  }

  http.end();
}

// =====================================
// ENVIAR HEARTBEAT
// =====================================

void enviarHeartbeat() {

  HTTPClient http;

  if (!iniciarHttp(http, "/dispositivo/heartbeat")) {
    return;
  }

  http.addHeader("Content-Type", "application/json");

  int status = http.POST("{}");

  Serial.print("POST /dispositivo/heartbeat: ");
  Serial.println(status);

  if (status < 0) {

    Serial.print("Erro HTTP: ");
    Serial.println(http.errorToString(status));
  }

  http.end();
}

// =====================================
// CONFIRMAR COMANDO
// =====================================

bool confirmarComando(
  int id,
  bool sucesso,
  const char* mensagem
) {

  HTTPClient http;

  String rota =
    "/dispositivo/comandos/" +
    String(id) +
    "/resultado";

  if (!iniciarHttp(http, rota)) {
    return false;
  }

  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;

  doc["status"] = sucesso ? "executado" : "falhou";
  doc["mensagem"] = mensagem;

  String payload;

  serializeJson(doc, payload);

  int status = http.sendRequest("PUT", payload);

  Serial.print("PUT resultado comando ");
  Serial.print(id);
  Serial.print(": ");
  Serial.println(status);

  http.end();

  return status >= 200 && status < 300;
}

// =====================================
// EXECUTAR ALIMENTACAO
// =====================================

void executarAlimentacao(int angulo) {

  angulo = constrain(angulo, 0, 180);

  Serial.println("==========================");
  Serial.println("INICIANDO ALIMENTACAO");
  Serial.println("==========================");

  Serial.print("Movendo servo para ");
  Serial.print(angulo);
  Serial.println(" graus.");

  servo.write(angulo);

  delay(TEMPO_MOVIMENTO_SERVO);

  servo.write(ANGULO_INICIAL);

  delay(TEMPO_MOVIMENTO_SERVO);

  Serial.println("Servo retornou para 0 graus.");
  Serial.println("ALIMENTACAO FINALIZADA!");
}

// =====================================
// CONSULTAR COMANDOS DO FASTAPI
// =====================================

void consultarComandos() {

  HTTPClient http;

  if (!iniciarHttp(
    http,
    "/dispositivo/comandos/pendentes"
  )) {
    return;
  }

  int status = http.GET();

  if (status != 200) {

    Serial.print("GET comandos: ");
    Serial.println(status);

    http.end();

    return;
  }

  String resposta = http.getString();

  http.end();

  JsonDocument doc;

  DeserializationError erro =
    deserializeJson(doc, resposta);

  if (erro) {

    Serial.println("ERRO: JSON de comandos invalido.");

    return;
  }

  JsonArray comandos = doc["comandos"].as<JsonArray>();

  for (JsonObject comando : comandos) {

    int id = comando["id"] | -1;

    String tipo = comando["tipo"] | "";

    if (id < 0) {
      continue;
    }

    // =====================================
    // ALIMENTACAO MANUAL E AUTOMATICA
    // =====================================

    if (
      tipo == "alimentacao_manual" ||
      tipo == "alimentacao_automatica"
    ) {

      // Evita repetir o ultimo comando
      // durante esta inicializacao.

      if (id == ultimoComandoAlimentacaoExecutado) {

        confirmarComando(
          id,
          true,
          "Comando ja executado"
        );

        continue;
      }

      int angulo =
        comando["parametros"]["angulo_servo"] |
        ANGULO_PADRAO;

      if (tipo == "alimentacao_automatica") {

        Serial.println("==========================");
        Serial.println("ALIMENTACAO AUTOMATICA");
        Serial.println("==========================");

      } else {

        Serial.println("==========================");
        Serial.println("ALIMENTACAO MANUAL");
        Serial.println("==========================");
      }

      executarAlimentacao(angulo);

      ultimoComandoAlimentacaoExecutado = id;

      confirmarComando(
        id,
        true,
        "Servo acionado"
      );

    } else {

      // Comandos manuais do aquecedor
      // nao sao executados nesta versao.

      confirmarComando(
        id,
        false,
        "Tipo de comando nao suportado"
      );
    }
  }
}

// =====================================
// SETUP
// =====================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println("==========================");
  Serial.println("AQUARIO AUTOMATIZADO");
  Serial.println("INICIANDO SISTEMA...");
  Serial.println("==========================");

  // INICIA RELES

  pinMode(PINO_RELE1, OUTPUT);
  pinMode(PINO_RELE2, OUTPUT);

  // AQUECEDOR INICIA DESLIGADO

  atualizarAquecedor(false);

  // INICIA SENSOR

  sensor.begin();
  sensor.setResolution(10);

  // INICIA SERVO

  servo.setPeriodHertz(50);

  servo.attach(PINO_SERVO, 500, 2400);

  servo.write(ANGULO_INICIAL);

  Serial.println("Sensor inicializado.");
  Serial.println("Servo inicializado.");
  Serial.println("Reles inicializados.");

  // INICIA WIFI

  conectarWiFi();

  // CONFIGURA TEMPORIZADORES

  ultimaLeitura = millis() - INTERVALO_LEITURA;

  ultimaComunicacao = millis() - INTERVALO_HTTP;

  ultimaTentativaWiFi = millis();

  Serial.println();
  Serial.println("SETUP FINALIZADO!");
  Serial.println("==========================");
}

// =====================================
// LOOP PRINCIPAL
// =====================================

void loop() {

  unsigned long agora = millis();

  // =====================================
  // MONITORA WIFI
  // =====================================

  verificarWiFi();

  // =====================================
  // LE TEMPERATURA
  // =====================================

  if (
    agora - ultimaLeitura >= INTERVALO_LEITURA
  ) {

    ultimaLeitura = agora;

    lerTemperatura();
  }

  // =====================================
  // TENTA RECONECTAR AO WIFI
  // =====================================

  if (
    WiFi.status() != WL_CONNECTED &&
    agora - ultimaTentativaWiFi >= INTERVALO_RECONEXAO
  ) {

    ultimaTentativaWiFi = agora;

    Serial.println();
    Serial.println("Wi-Fi indisponivel!");
    Serial.println("Tentando reconectar...");

    WiFi.reconnect();
  }

  // =====================================
  // COMUNICACAO COM FASTAPI
  // =====================================

  if (
    agora - ultimaComunicacao >= INTERVALO_HTTP
  ) {

    ultimaComunicacao = agora;

    if (WiFi.status() == WL_CONNECTED) {

      Serial.println();
      Serial.println("Comunicando com FastAPI...");

      enviarTemperatura();

      enviarHeartbeat();

      consultarComandos();

    } else {

      Serial.println(
        "Wi-Fi desconectado. "
        "Controle termico local continua."
      );
    }
  }
}