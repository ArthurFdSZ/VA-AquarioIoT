#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>

// ==========================================
// 1. CONFIGURACOES DO WIFI
// ==========================================

const char* ssid = "NOME_DO_WIFI";
const char* password = "SENHA_DO_WIFI";

// ==========================================
// 2. ENDERECO DO BACKEND FASTAPI
// ==========================================

// Trocar pelo IP real do computador.

const char* servidor =
  "http://192.168.0.105:8000";

// ==========================================
// 3. PINOS
// ==========================================

#define PINO_SENSOR 4
#define PINO_SERVO 18
#define PINO_RELE 26

// Muitos modulos de rele sao ativos em LOW.
// CONFIRMEM no modelo de voces antes de usar.
const bool RELE_ATIVO_EM_LOW = true;

// ==========================================
// 4. INTERVALOS
// ==========================================

const unsigned long INTERVALO_TEMPERATURA = 5000;
const unsigned long INTERVALO_COMANDOS = 2000;
const unsigned long TIMEOUT_BACKEND = 15000;

// ==========================================
// 5. OBJETOS
// ==========================================

OneWire oneWire(PINO_SENSOR);
DallasTemperature sensor(&oneWire);

Servo alimentador;

// ==========================================
// 6. VARIAVEIS
// ==========================================

unsigned long ultimoEnvioTemperatura = 0;
unsigned long ultimaConsultaComandos = 0;
unsigned long ultimoContatoBackend = 0;

bool aquecedorLigado = false;
bool servoEmMovimento = false;

unsigned long inicioMovimentoServo = 0;

// Estados do alimentador
int estadoServo = 0;

// ==========================================
// 7. CONTROLE DO RELE
// ==========================================

void controlarAquecedor(bool ligar) {

  aquecedorLigado = ligar;

  if (RELE_ATIVO_EM_LOW) {
    digitalWrite(PINO_RELE, ligar ? LOW : HIGH);
  } else {
    digitalWrite(PINO_RELE, ligar ? HIGH : LOW);
  }

  Serial.println(
    ligar ? "Aquecedor LIGADO" : "Aquecedor DESLIGADO"
  );
}

// ==========================================
// 8. LEITURA DA TEMPERATURA
// ==========================================

float lerTemperatura() {

  sensor.requestTemperatures();

  float temperatura = sensor.getTempCByIndex(0);

  if (temperatura == DEVICE_DISCONNECTED_C) {
    Serial.println("ERRO: Sensor desconectado!");
    return -999;
  }

  if (temperatura < -10 || temperatura > 50) {
    Serial.println("ERRO: Leitura fora da faixa esperada!");
    return -999;
  }

  return temperatura;
}

// ==========================================
// 9. ENVIO DA TEMPERATURA
// ==========================================

void enviarTemperatura() {

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi desconectado!");
    return;
  }

  float temperatura = lerTemperatura();

  if (temperatura == -999) {

    // Leitura invalida: aquecedor desligado
    controlarAquecedor(false);
    return;
  }

  HTTPClient http;

  http.begin(
    String(servidor) + "/api/temperatura"
  );

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  String json = "{\"temperatura\":";
  json += String(temperatura, 2);
  json += "}";

  int resposta = http.POST(json);

  Serial.print("Temperatura: ");
  Serial.println(temperatura);

  Serial.print("Resposta HTTP: ");
  Serial.println(resposta);

  http.end();
}

// ==========================================
// 10. ALIMENTADOR
// ==========================================

void iniciarAlimentacao() {

  if (servoEmMovimento) {
    Serial.println("Alimentador ja esta funcionando!");
    return;
  }

  Serial.println("Iniciando alimentacao...");

  servoEmMovimento = true;
  estadoServo = 1;

  inicioMovimentoServo = millis();

  alimentador.attach(PINO_SERVO);

  alimentador.write(90);
}

// Executa o movimento sem usar delays longos
void atualizarAlimentador() {

  if (!servoEmMovimento) {
    return;
  }

  unsigned long agora = millis();

  // Aguarda o movimento de ida
  if (estadoServo == 1 &&
      agora - inicioMovimentoServo >= 700) {

    alimentador.write(0);

    estadoServo = 2;
    inicioMovimentoServo = agora;
  }

  // Aguarda o retorno
  else if (estadoServo == 2 &&
           agora - inicioMovimentoServo >= 700) {

    alimentador.detach();

    servoEmMovimento = false;
    estadoServo = 0;

    Serial.println("Alimentacao concluida!");
  }
}

// ==========================================
// 11. CONFIRMAR ALIMENTACAO NO BACKEND
// ==========================================

void confirmarAlimentacao() {

  HTTPClient http;

  http.begin(
    String(servidor) +
    "/api/comandos/alimentacao/concluir"
  );

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  int resposta = http.POST("{}");

  Serial.print("Confirmacao alimentacao: ");
  Serial.println(resposta);

  http.end();
}

// ==========================================
// 12. CONSULTAR COMANDOS DO BACKEND
// ==========================================

void consultarComandos() {

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  HTTPClient http;

  http.begin(
    String(servidor) + "/api/comandos"
  );

  int resposta = http.GET();

  if (resposta == 200) {

    String retorno = http.getString();

    StaticJsonDocument<256> documento;

    DeserializationError erro =
      deserializeJson(documento, retorno);

    if (!erro) {

      ultimoContatoBackend = millis();

      bool comandoAquecedor =
        documento["aquecedor"] | false;

      bool comandoAlimentar =
        documento["alimentar"] | false;

      // Controle do aquecedor
      controlarAquecedor(comandoAquecedor);

      // Executar alimentacao somente se estiver livre
      if (comandoAlimentar && !servoEmMovimento) {

        iniciarAlimentacao();

        confirmarAlimentacao();
      }

    } else {

      Serial.println("Erro ao interpretar JSON!");
    }

  } else {

    Serial.print("Erro ao consultar comandos: ");
    Serial.println(resposta);
  }

  http.end();
}

// ==========================================
// 13. CONEXAO WIFI
// ==========================================

void conectarWiFi() {

  WiFi.begin(ssid, password);

  Serial.print("Conectando ao Wi-Fi");

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("Wi-Fi conectado!");

  Serial.print("IP do ESP32: ");
  Serial.println(WiFi.localIP());
}

// ==========================================
// 14. SETUP
// ==========================================

void setup() {

  Serial.begin(115200);

  pinMode(PINO_RELE, OUTPUT);

  // Comecar sempre com aquecedor desligado
  controlarAquecedor(false);

  sensor.begin();

  conectarWiFi();

  alimentador.setPeriodHertz(50);
}

// ==========================================
// 15. LOOP PRINCIPAL
// ==========================================

void loop() {

  unsigned long agora = millis();

  // Verificar Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {

    controlarAquecedor(false);

    WiFi.reconnect();
  }

  // Enviar temperatura
  if (WiFi.status() == WL_CONNECTED &&
      agora - ultimoEnvioTemperatura >=
      INTERVALO_TEMPERATURA) {

    ultimoEnvioTemperatura = agora;

    enviarTemperatura();
  }

  // Consultar comandos
  if (WiFi.status() == WL_CONNECTED &&
      agora - ultimaConsultaComandos >=
      INTERVALO_COMANDOS) {

    ultimaConsultaComandos = agora;

    consultarComandos();
  }

  // Protecao: perder comunicacao com backend
  if (ultimoContatoBackend == 0 ||
      agora - ultimoContatoBackend >
      TIMEOUT_BACKEND) {

    controlarAquecedor(false);
  }

  // Atualizar movimento do servo
  atualizarAlimentador();
}