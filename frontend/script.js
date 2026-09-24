
const API_URL = "http://127.0.0.1:8000";

let temperatureChart = null;
let phChart = null;
let foodChart = null;

let savedConfiguration = null;

const $ = (id) => document.getElementById(id);


// ======================================================
// UTILITÁRIOS
// ======================================================

function formatDateTime(value) {
    if (!value) return "--";

    // Os registros atuais do backend usam DD/MM/YYYY HH:MM:SS.
    return value;
}

function setMessage(message, type = "") {
    const element = $("settingsMessage");
    element.textContent = message;
    element.className = `form-message ${type}`;
}

function setConnection(isOnline) {
    const dot = $("connectionDot");
    const text = $("connectionText");

    dot.classList.toggle("online", isOnline);
    dot.classList.toggle("offline", !isOnline);

    text.textContent = isOnline ? "API conectada" : "API desconectada";
}

async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, options);

    if (!response.ok) {
        let detail = `Erro HTTP ${response.status}`;

        try {
            const data = await response.json();
            if (data.detail) {
                detail = Array.isArray(data.detail)
                    ? data.detail.map(item => item.msg).join("; ")
                    : data.detail;
            }
        } catch (_) {
            // Mantém a mensagem HTTP padrão.
        }

        throw new Error(detail);
    }

    return response.json();
}

function showValue(value, suffix = "") {
    if (value === null || value === undefined || value === "") {
        return "--";
    }

    return `${value}${suffix}`;
}

function parseDateLabel(value) {
    if (!value) return "";

    // Mantém o horário que veio do backend sem conversão de fuso.
    const parts = value.split(" ");
    return parts.length > 1 ? parts[1].slice(0, 5) : value;
}

function setChartEmptyMessage(canvasId, chart, message) {
    const canvas = $(canvasId);
    const container = canvas.parentElement;

    let empty = container.querySelector(".chart-empty");

    if (!chart) {
        if (!empty) {
            empty = document.createElement("div");
            empty.className = "chart-empty";
            empty.style.position = "absolute";
            empty.style.inset = "0";
            empty.style.display = "grid";
            empty.style.placeItems = "center";
            empty.style.textAlign = "center";
            empty.style.padding = "15px";
            empty.style.color = "#8b9bb3";
            empty.style.fontSize = "12px";
            container.appendChild(empty);
        }

        empty.textContent = message;
        canvas.style.visibility = "hidden";
    } else {
        if (empty) empty.remove();
        canvas.style.visibility = "visible";
    }
}


// ======================================================
// GRÁFICOS
// ======================================================

function createLineChart(canvasId, labels, values, label, color) {
    const context = $(canvasId).getContext("2d");

    return new Chart(context, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label,
                data: values,
                borderColor: color,
                backgroundColor: `${color}22`,
                fill: true,
                tension: 0.35,
                pointRadius: 3,
                pointHoverRadius: 5,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: "index"
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#8b9bb3",
                        maxRotation: 0,
                        autoSkip: true
                    },
                    grid: {
                        color: "#ffffff08"
                    }
                },
                y: {
                    ticks: {
                        color: "#8b9bb3"
                    },
                    grid: {
                        color: "#ffffff10"
                    }
                }
            }
        }
    });
}

function createBarChart(canvasId, labels, values, label, color) {
    const context = $(canvasId).getContext("2d");

    return new Chart(context, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label,
                data: values,
                backgroundColor: `${color}bb`,
                borderColor: color,
                borderWidth: 1,
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#8b9bb3",
                        maxRotation: 0,
                        autoSkip: true
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: "#8b9bb3"
                    },
                    grid: {
                        color: "#ffffff10"
                    }
                }
            }
        }
    });
}

function updateLineChart(existingChart, canvasId, records, valueKey, label, color) {
    if (!records || records.length === 0) {
        if (existingChart) existingChart.destroy();
        setChartEmptyMessage(canvasId, null, "Nenhuma medição registrada ainda.");
        return null;
    }

    // A API retorna os registros do mais recente para o mais antigo.
    const ordered = [...records].reverse();

    const labels = ordered.map(item => parseDateLabel(item.data_hora));
    const values = ordered.map(item => Number(item[valueKey]));

    if (existingChart) existingChart.destroy();

    const chart = createLineChart(canvasId, labels, values, label, color);
    setChartEmptyMessage(canvasId, chart, "");
    return chart;
}

function updateFoodChart(records) {
    if (foodChart) {
        foodChart.destroy();
        foodChart = null;
    }

    if (!records || records.length === 0) {
        setChartEmptyMessage("foodChart", null, "Nenhuma alimentação registrada ainda.");
        return;
    }

    const ordered = [...records].reverse();
    const labels = ordered.map(item => parseDateLabel(item.data_hora));
    const values = ordered.map(item => Number(item.quantidade ?? 0));

    foodChart = createBarChart(
        "foodChart",
        labels,
        values,
        "Quantidade de ração (g)",
        "#a78bfa"
    );

    setChartEmptyMessage("foodChart", foodChart, "");
}


// ======================================================
// CONFIGURAÇÕES
// ======================================================

function fillConfiguration(data) {
    if (!data || data.mensagem) {
        savedConfiguration = null;
        setMessage("Nenhuma configuração salva no banco.", "");
        return;
    }

    savedConfiguration = data;

    $("desiredTemperature").value = data.temperatura_desejada ?? "";
    $("feedingTime1").value = data.horario_alimentacao_1 ?? "";
    $("feedingTime2").value = data.horario_alimentacao_2 ?? "";
    $("foodAmount").value = data.quantidade_racao ?? "";

    $("desiredTemperatureMetric").textContent =
        showValue(data.temperatura_desejada, " °C");

    updateNextFeeding(data);

    setMessage(
        `Configurações carregadas. Última alteração: ${formatDateTime(data.data_hora)}`,
        "success"
    );
}

async function loadConfiguration() {
    try {
        const data = await apiRequest("/configuracoes");
        fillConfiguration(data);
    } catch (error) {
        setMessage(`Não foi possível carregar as configurações: ${error.message}`, "error");
    }
}

function updateNextFeeding(data) {
    const times = [
        data.horario_alimentacao_1,
        data.horario_alimentacao_2
    ].filter(Boolean).sort();

    if (times.length === 0) {
        $("nextFeeding").textContent = "--:--";
        $("feedingDescription").textContent = "Horários não configurados";
        return;
    }

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const next = times.find(time => time > currentTime) || times[0];

    $("nextFeeding").textContent = next;
    $("feedingDescription").textContent =
        times.find(time => time > currentTime)
            ? "Próximo horário de hoje"
            : "Próximo horário previsto para amanhã";
}

async function saveConfiguration(event) {
    event.preventDefault();

    const button = $("saveSettings");
    button.disabled = true;
    button.textContent = "Salvando...";
    setMessage("");

    const temperature = $("desiredTemperature").value;
    const time1 = $("feedingTime1").value;
    const time2 = $("feedingTime2").value;
    const amount = $("foodAmount").value;

    if (!temperature || !time1 || !time2 || amount === "") {
        setMessage("Preencha todos os campos.", "error");
        button.disabled = false;
        button.textContent = "Salvar configurações";
        return;
    }

    const params = new URLSearchParams({
        temperatura_desejada: temperature,
        horario_alimentacao_1: time1,
        horario_alimentacao_2: time2,
        quantidade_racao: amount
    });

    try {
        // Se já houver configuração, atualiza; caso contrário, cria.
        const method = savedConfiguration ? "PUT" : "POST";

        const result = await apiRequest(`/configuracoes?${params.toString()}`, {
            method
        });

        setMessage(result.mensagem || "Configurações salvas!", "success");
        await loadConfiguration();
    } catch (error) {
        setMessage(`Erro ao salvar: ${error.message}`, "error");
    } finally {
        button.disabled = false;
        button.textContent = "Salvar configurações";
    }
}


// ======================================================
// TEMPERATURA
// ======================================================

async function loadTemperatures() {
    try {
        const data = await apiRequest("/temperaturas");
        const records = data.temperaturas || [];

        if (records.length > 0) {
            const latest = records[0];

            $("currentTemperature").textContent =
                showValue(latest.temperatura, " °C");

            $("aquariumTemperature").textContent =
                showValue(latest.temperatura, " °C");

            $("heatingDescription").textContent =
                `Última leitura: ${formatDateTime(latest.data_hora)}`;
        } else {
            $("currentTemperature").textContent = "-- °C";
            $("aquariumTemperature").textContent = "Aguardando";
            $("heatingDescription").textContent = "Nenhuma leitura registrada";
        }

        temperatureChart = updateLineChart(
            temperatureChart,
            "temperatureChart",
            records,
            "temperatura",
            "Temperatura (°C)",
            "#22c7d6"
        );
    } catch (error) {
        console.error("Erro ao carregar temperaturas:", error);
        setChartEmptyMessage("temperatureChart", null, "Não foi possível carregar as temperaturas.");
    }
}


// ======================================================
// pH
// ======================================================

async function loadPhMeasurements() {
    try {
        const data = await apiRequest("/medicoes/ph");
        const records = data.medicoes_ph || [];

        if (records.length > 0) {
            const latest = records[0];

            $("currentPh").textContent = showValue(latest.ph);
            $("phDescription").textContent =
                `Última leitura: ${formatDateTime(latest.data_hora)}`;

            $("aquariumPh").textContent = showValue(latest.ph);
        } else {
            $("currentPh").textContent = "--";
            $("phDescription").textContent = "Aguardando medição";
            $("aquariumPh").textContent = "Aguardando";
        }

        phChart = updateLineChart(
            phChart,
            "phChart",
            records,
            "ph",
            "pH",
            "#f5a65b"
        );
    } catch (error) {
        console.error("Erro ao carregar pH:", error);
        $("currentPh").textContent = "--";
        $("phDescription").textContent = "Não foi possível consultar o pH";
        setChartEmptyMessage("phChart", null, "Não foi possível carregar as medições de pH.");
    }
}


// ======================================================
// ALIMENTAÇÕES
// ======================================================

async function loadFeedings() {
    try {
        const data = await apiRequest("/alimentacoes");
        const records = data.alimentacoes || [];

        updateFoodChart(records);
        renderEvents(records);
    } catch (error) {
        console.error("Erro ao carregar alimentações:", error);
        setChartEmptyMessage("foodChart", null, "Não foi possível carregar o histórico de ração.");
        $("eventsList").innerHTML =
            '<div class="empty-state">Não foi possível carregar os eventos.</div>';
    }
}

function renderEvents(feedings) {
    const container = $("eventsList");

    if (!feedings || feedings.length === 0) {
        container.innerHTML =
            '<div class="empty-state">Nenhuma alimentação registrada ainda.</div>';
        return;
    }

    container.innerHTML = "";

    feedings.slice(0, 5).forEach(item => {
        const row = document.createElement("div");
        row.className = "event-item";

        const icon = document.createElement("div");
        icon.className = "event-icon";
        icon.textContent = "◷";

        const content = document.createElement("div");
        content.className = "event-content";

        const title = document.createElement("strong");
        title.textContent = item.tipo || "Alimentação registrada";

        const description = document.createElement("p");
        description.textContent =
            `${item.quantidade ?? "--"} g · ${formatDateTime(item.data_hora)}`;

        content.appendChild(title);
        content.appendChild(description);
        row.appendChild(icon);
        row.appendChild(content);
        container.appendChild(row);
    });
}


// ======================================================
// ATUALIZAÇÃO GERAL
// ======================================================

async function refreshDashboard() {
    try {
        await apiRequest("/");
        setConnection(true);
    } catch (error) {
        setConnection(false);
        $("lastUpdate").textContent = "API indisponível";
        return;
    }

    await Promise.all([
        loadConfiguration(),
        loadTemperatures(),
        loadPhMeasurements(),
        loadFeedings()
    ]);

    $("lastUpdate").textContent =
        `Última atualização: ${new Date().toLocaleTimeString("pt-BR")}`;
}


// ======================================================
// INICIALIZAÇÃO
// ======================================================

function updateDate() {
    $("currentDate").textContent = new Date().toLocaleDateString("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

$("settingsForm").addEventListener("submit", saveConfiguration);

$("reloadSettings").addEventListener("click", loadConfiguration);

$("refreshEvents").addEventListener("click", loadFeedings);

updateDate();
refreshDashboard();

// Atualiza os dados periodicamente enquanto o dashboard estiver aberto.
setInterval(refreshDashboard, 30000);