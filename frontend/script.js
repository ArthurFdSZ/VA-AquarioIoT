/* =========================================================
   VA automações — dashboard
   Toda a comunicação é feita com a API FastAPI (JSON).
   Endpoints usados (conferidos no main.py):
     GET  /dashboard/resumo            GET  /temperaturas[?inicio&limite]
     GET  /temperaturas/estatisticas   GET  /aquecedor/historico
     GET  /aquecedor/estatisticas      GET  /alimentacoes[?inicio&limite]
     GET  /alimentacoes/estatisticas   GET  /eventos?limite
     GET  /comandos                    POST /comandos
     GET  /configuracoes               PUT  /configuracoes
   ========================================================= */

(function () {
    "use strict";

    // Endereço da API. Para trocar sem editar este arquivo, defina
    // window.VA_API_URL antes de carregar o script.
    const API_URL = (window.VA_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

    const TZ = "America/Sao_Paulo";
    const DAY = 86400000;
    const HOUR = 3600000;
    const GAP_MS = 15 * 60000;          // lacuna que interrompe a linha do gráfico
    const TEMP_LIMIT = 10000;           // máximo aceito pela API em /temperaturas
    const MIN_POLL = 5;                 // segundos
    const MAX_POLL = 120;

    // ------------------------------------------------------------------
    // Estado
    // ------------------------------------------------------------------
    const state = {
        apiOk: null,
        failures: 0,
        resumo: null,
        config: null,
        formDirty: false,
        temps: [],            // [{id, t, v}] das últimas 24 h, ordem crescente
        tempIds: new Set(),
        tempsKey: null,
        tempMode: null,       // null = automático; "time" | "seq" quando o usuário escolhe
        heatKey: null,
        heatEvents: [],       // eventos_aquecedor em ordem crescente
        feedKey: null,
        feeds: [],            // alimentacoes dos últimos 7 dias
        eventsCount: null,
        events: [],
        command: null,        // {id, phase, expira_em, mensagem}
    };

    let pollTimer = null;
    let cmdTimer = null;
    let refreshing = false;
    let lastRefresh = 0;

    // ------------------------------------------------------------------
    // Utilitários
    // ------------------------------------------------------------------
    const $ = (id) => document.getElementById(id);

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (c) => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
        ));
    }

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    const fmtHM = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const fmtDM = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
    const fmtLong = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
    const fmtKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
    const fmtHour = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });
    const fmtWeek = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short" });
    const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

    const fmt1 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "--" : nf1.format(v));
    const hourOf = (t) => Number(fmtHour.format(t));
    const fmtHMS = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    // meia-noite (horário de Brasília) do dia de t
    function startOfDay(t) {
        const [h, m, sec] = fmtHMS.format(t).split(":").map(Number);
        return t - (((h * 60 + m) * 60 + sec) * 1000 + (t % 1000));
    }
    const dayKey = (t) => fmtKey.format(t);

    function dayLabel(t) {
        const key = dayKey(t);
        if (key === dayKey(Date.now())) return "Hoje";
        if (key === dayKey(Date.now() - DAY)) return "Ontem";
        return fmtDM.format(t);
    }

    // "Hoje, 08:00" / "Ontem, 18:00" / "07/11, 08:00"
    function whenLabel(t) {
        return `${dayLabel(t)}, ${fmtHM.format(t)}`;
    }

    function ago(ms) {
        const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (s < 60) return `há ${s} s`;
        const m = Math.round(s / 60);
        if (m < 60) return `há ${m} min`;
        const h = Math.floor(m / 60);
        if (h < 24) return `há ${h} h`;
        return `há ${Math.floor(h / 24)} d`;
    }

    // 72 -> "1 h 12 min"
    function fmtDuration(min) {
        if (min === null || min === undefined) return "--";
        const m = Math.round(min);
        if (m < 60) return `${m} min`;
        const h = Math.floor(m / 60);
        return `${h} h ${String(m % 60).padStart(2, "0")} min`;
    }

    // Versão para cartões grandes: "4 h 07<sup>min</sup>" / "42<sup>min</sup>"
    function durParts(min) {
        if (min === null || min === undefined) return "--";
        const m = Math.round(min);
        if (m < 60) return `${m}<sup>min</sup>`;
        const h = Math.floor(m / 60);
        if (h >= 100) return `${h}<sup>h</sup>`;
        return `${h} h ${String(m % 60).padStart(2, "0")}<sup>min</sup>`;
    }

    function parseTime(value) {
        const t = Date.parse(value);
        return Number.isNaN(t) ? null : t;
    }

    // ISO aceito por datetime.fromisoformat no backend
    function isoParam(ms) {
        return encodeURIComponent(new Date(ms).toISOString().slice(0, 19) + "+00:00");
    }

    const hmToMin = (hm) => {
        const [h, m] = String(hm).split(":").map(Number);
        return h * 60 + m;
    };

    // ------------------------------------------------------------------
    // API
    // ------------------------------------------------------------------
    async function api(path, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const headers = { Accept: "application/json" };
            if (options.body) headers["Content-Type"] = "application/json";
            const response = await fetch(API_URL + path, { ...options, headers, signal: controller.signal });

            if (!response.ok) {
                let detail = `Erro HTTP ${response.status}`;
                try {
                    const data = await response.json();
                    if (data && data.detail) {
                        detail = Array.isArray(data.detail)
                            ? data.detail.map((d) => String(d.msg || "").replace(/^Value error, /, "")).join("; ")
                            : String(data.detail);
                    }
                } catch (_) { /* mantém a mensagem padrão */ }
                const error = new Error(detail);
                error.status = response.status;
                throw error;
            }
            return await response.json();
        } catch (error) {
            if (error.name === "AbortError") throw new Error("A API demorou demais para responder.");
            if (error instanceof TypeError) throw new Error("Não foi possível conectar à API.");
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    // ------------------------------------------------------------------
    // Gráficos (SVG próprio, sem bibliotecas externas)
    // ------------------------------------------------------------------
    const resizer = new ResizeObserver((entries) => {
        entries.forEach((entry) => { if (entry.target._draw) entry.target._draw(); });
    });

    function watch(el, draw) {
        el._draw = draw;
        resizer.observe(el);
    }

    function unwatchAll(root) {
        root.querySelectorAll(".chart, .ruler, .ringbox, [data-watch]").forEach((el) => {
            resizer.unobserve(el);
            el._draw = null;
        });
    }

    function niceStep(raw) {
        return [0.1, 0.2, 0.5, 1, 2, 5, 10].find((s) => s >= raw) || 10;
    }

    function xTicks(t0, t1) {
        const span = (t1 - t0) / HOUR;
        const out = [];
        let t = Math.ceil(t0 / HOUR) * HOUR;
        if (span <= 48) {
            const step = [1, 2, 3, 4, 6, 12].find((s) => span / s <= 7) || 12;
            for (; t <= t1; t += HOUR) {
                if (hourOf(t) % step === 0) out.push({ t, label: String(hourOf(t)).padStart(2, "0") + "h" });
            }
        } else {
            const days = [];
            for (; t <= t1; t += HOUR) if (hourOf(t) === 0) days.push(t);
            const k = Math.max(1, Math.ceil(days.length / 7));
            days.forEach((d, i) => { if (i % k === 0) out.push({ t: d, label: fmtDM.format(d) }); });
        }
        return out;
    }

    function splitGaps(points, limit) {
        const segments = [];
        let current = [];
        points.forEach((p, i) => {
            if (i > 0 && p.t - points[i - 1].t > limit) {
                segments.push(current);
                current = [];
            }
            current.push(p);
        });
        if (current.length) segments.push(current);
        return segments;
    }

    function downsample(points, buckets) {
        if (points.length <= buckets) return points;
        const out = [];
        const size = points.length / buckets;
        for (let i = 0; i < buckets; i++) {
            const a = Math.floor(i * size);
            const b = Math.min(points.length, Math.floor((i + 1) * size));
            if (b <= a) continue;
            let st = 0, sv = 0;
            for (let j = a; j < b; j++) { st += points[j].t; sv += points[j].v; }
            out.push({ t: st / (b - a), v: sv / (b - a) });
        }
        return out;
    }

    /**
     * Gráfico de linha da temperatura.
     * o: { points:[{t,v}], t0, t1, band:[min,max]|null, segments:[{a,b}], empty:string }
     */
    function lineChart(el, o) {
        el._model = o;
        watch(el, () => drawLine(el));
        drawLine(el);
    }

    const SEQ_MAX = 120;      // no modo "por leitura" mostra as últimas N leituras
    const SEQ_AUTO = 30;      // até aqui o modo automático usa "por leitura"
    const resolveMode = (n) => state.tempMode || (n <= SEQ_AUTO ? "seq" : "time");

    function gapLimit(points) {
        if (points.length < 3) return GAP_MS;
        const d = [];
        for (let i = 1; i < points.length; i++) d.push(points[i].t - points[i - 1].t);
        d.sort((x, y) => x - y);
        return Math.max(GAP_MS, d[d.length >> 1] * 4);
    }

    function drawLine(el) {
        const o = el._model;
        const W = el.clientWidth, H = el.clientHeight;
        if (!o || W < 60 || H < 60) return;

        if (!o.points.length) {
            el.innerHTML = `<div class="empty">${esc(o.empty)}</div>`;
            return;
        }

        const seq = o.mode === "seq";
        const pts = seq ? o.points.slice(-SEQ_MAX) : o.points;
        const n = pts.length;
        const hasHeat = !seq && o.segments && o.segments.length > 0;
        const L = 42, R = 14, T = 16, PADX = 10;
        const B = seq ? 44 : (hasHeat ? 40 : 28);
        const pw = W - L - R, ph = H - T - B;
        const t0 = o.t0, t1 = o.t1;

        let lo = Math.min(...pts.map((p) => p.v));
        let hi = Math.max(...pts.map((p) => p.v));
        if (o.band) { lo = Math.min(lo, o.band[0]); hi = Math.max(hi, o.band[1]); }
        const pad = Math.max(0.3, (hi - lo) * 0.12);
        const step = niceStep((hi - lo + pad * 2) / 4);
        const y0 = Math.floor((lo - pad) / step) * step;
        const y1 = Math.ceil((hi + pad) / step) * step;

        const sx = (t) => L + PADX + (pw - 2 * PADX) * clamp((t - t0) / (t1 - t0), 0, 1);
        const sy = (v) => T + ph * (1 - (v - y0) / (y1 - y0));
        const xs = pts.map((p, i) => seq
            ? (n === 1 ? L + pw / 2 : L + PADX + (pw - 2 * PADX) * i / (n - 1))
            : sx(p.t));

        let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de temperatura">`;
        svg += `<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f5d57" stop-opacity=".18"/><stop offset="1" stop-color="#2f5d57" stop-opacity="0"/></linearGradient></defs>`;

        if (o.band) {
            const yTop = sy(Math.min(o.band[1], y1)), yBot = sy(Math.max(o.band[0], y0));
            svg += `<rect x="${L}" y="${yTop.toFixed(1)}" width="${pw}" height="${Math.max(0, yBot - yTop).toFixed(1)}" rx="6" fill="#2f5d57" opacity=".07"/>`;
        }

        for (let v = y0; v <= y1 + step / 2; v += step) {
            const y = sy(v);
            svg += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e1ddd4"/>`;
            svg += `<text x="${L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11.5" fill="#8d8a82">${nf1.format(v).replace(",0", "")}°</text>`;
        }

        // ----- eixo X
        if (!seq) {
            xTicks(t0, t1).forEach((tick) => {
                svg += `<text x="${sx(tick.t).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11.5" fill="#8d8a82">${tick.label}</text>`;
            });
        } else {
            const k = Math.min(n, Math.max(2, Math.floor(pw / 62)));
            const shown = new Set();
            for (let j = 0; j < k; j++) shown.add(k === 1 ? 0 : Math.round(j * (n - 1) / (k - 1)));
            shown.forEach((i) => {
                svg += `<text x="${xs[i].toFixed(1)}" y="${H - 22}" text-anchor="middle" font-size="11.5" fill="#8d8a82">${fmtHM.format(pts[i].t)}</text>`;
            });
            const today = dayKey(Date.now()), yest = dayKey(Date.now() - DAY);
            let s0 = 0;
            for (let i = 1; i <= n; i++) {
                if (i < n && dayKey(pts[i].t) === dayKey(pts[s0].t)) continue;
                const key = dayKey(pts[s0].t);
                const label = key === today ? "hoje" : key === yest ? "ontem" : fmtDM.format(pts[s0].t);
                const cx = clamp((xs[s0] + xs[i - 1]) / 2, L + 14, W - R - 14);
                svg += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="#6d6a63">${label}</text>`;
                if (i < n) {
                    const sepX = ((xs[i - 1] + xs[i]) / 2).toFixed(1);
                    svg += `<line x1="${sepX}" x2="${sepX}" y1="${T}" y2="${T + ph + 6}" stroke="#8d8a82" stroke-opacity=".55" stroke-dasharray="3 4"/>`;
                }
                s0 = i;
            }
        }

        if (hasHeat) {
            o.segments.forEach((sg) => {
                const a = Math.max(sg.a, t0), b = Math.min(sg.b, t1);
                if (b <= a) return;
                svg += `<rect x="${sx(a).toFixed(1)}" y="${H - B + 7}" width="${Math.max(2, sx(b) - sx(a)).toFixed(1)}" height="4" rx="2" fill="#c9773c"/>`;
            });
        }

        const dot = (x, y, r) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#fff" stroke="#2f5d57" stroke-width="2.2"/>`;
        let last = null;

        if (seq) {
            // uma leitura = um ponto, igualmente espaçado; valores escritos quando cabem
            if (n > 1) {
                svg += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)} ${sy(p.v).toFixed(1)}`).join(" ")}" fill="none" stroke="#2f5d57" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
            }
            const dense = n > 60;
            const labelled = n <= Math.floor(pw / 40);
            pts.forEach((p, i) => {
                if (!dense) svg += dot(xs[i], sy(p.v), 4);
                if (labelled) {
                    const above = sy(p.v) - T > 20;
                    svg += `<text x="${xs[i].toFixed(1)}" y="${(sy(p.v) + (above ? -11 : 19)).toFixed(1)}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#1d2321" style="paint-order:stroke;stroke:var(--card);stroke-width:3px">${fmt1(p.v)}</text>`;
                }
            });
            last = { x: xs[n - 1], y: sy(pts[n - 1].v) };
        } else {
            const limit = gapLimit(pts);
            const segments = splitGaps(pts, limit);
            const dense = n > 80;
            const target = Math.max(2, Math.floor(pw / 2));
            let prev = null;
            segments.forEach((seg) => {
                const red = dense ? downsample(seg, Math.max(2, Math.round(target * seg.length / n))) : seg;
                if (!red.length) return;
                const first = { x: sx(red[0].t), y: sy(red[0].v) };
                // intervalo sem leituras: pontilhado ligando o trecho anterior a este
                if (prev) svg += `<path d="M${prev.x.toFixed(1)} ${prev.y.toFixed(1)} L${first.x.toFixed(1)} ${first.y.toFixed(1)}" fill="none" stroke="#2f5d57" stroke-opacity=".5" stroke-width="2" stroke-dasharray="2 6" stroke-linecap="round"/>`;
                if (red.length > 1) {
                    const path = red.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)} ${sy(p.v).toFixed(1)}`).join(" ");
                    const tail = red[red.length - 1];
                    if (dense) svg += `<path d="${path} L${sx(tail.t).toFixed(1)} ${T + ph} L${first.x.toFixed(1)} ${T + ph} Z" fill="url(#areaGrad)"/>`;
                    svg += `<path d="${path}" fill="none" stroke="#2f5d57" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
                } else if (dense) {
                    svg += `<circle cx="${first.x.toFixed(1)}" cy="${first.y.toFixed(1)}" r="2.5" fill="#2f5d57"/>`;
                }
                const tl = red[red.length - 1];
                prev = { x: sx(tl.t), y: sy(tl.v) };
                last = prev;
            });
            if (!dense) pts.forEach((p, i) => { svg += dot(xs[i], sy(p.v), 3.2); });
        }

        if (last && o.showLast !== false) {
            svg += `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="9" fill="#2f5d57" opacity=".15"/><circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4.5" fill="#2f5d57"/>`;
        }

        svg += `<line id="guide" x1="0" x2="0" y1="${T}" y2="${T + ph}" stroke="#1d2321" stroke-opacity=".25" stroke-dasharray="3 3" visibility="hidden"/>`;
        svg += `<circle id="guideDot" r="5" fill="#fff" stroke="#2f5d57" stroke-width="2.5" visibility="hidden"/>`;
        svg += `</svg><div class="tip" id="tip"></div>`;
        el.innerHTML = svg;

        // dica ao passar o mouse
        el._geom = { L, R, T, pw, ph, pts, xs, sy };
        if (!el._hover) {
            el._hover = true;
            el.addEventListener("pointermove", (ev) => hoverLine(el, ev));
            el.addEventListener("pointerleave", () => hideHover(el));
        }
    }

    function hoverLine(el, ev) {
        const g = el._geom;
        if (!g || !g.pts.length) return;
        const rect = el.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        if (x < g.L - 6 || x > g.L + g.pw + 6) return hideHover(el);

        // ponto mais próximo na horizontal (busca binária)
        const xs = g.xs;
        let a = 0, b = xs.length - 1;
        while (b - a > 1) {
            const m = (a + b) >> 1;
            if (xs[m] < x) a = m; else b = m;
        }
        const i = Math.abs(xs[a] - x) <= Math.abs(xs[b] - x) ? a : b;
        const p = g.pts[i];
        const cx = xs[i], cy = g.sy(p.v);

        const guide = el.querySelector("#guide"), dot = el.querySelector("#guideDot"), tip = el.querySelector("#tip");
        if (!guide || !dot || !tip) return;
        guide.setAttribute("x1", cx); guide.setAttribute("x2", cx); guide.setAttribute("visibility", "visible");
        dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("visibility", "visible");
        tip.innerHTML = `<b>${fmt1(p.v)} °C</b><span>${esc(whenLabel(p.t))}</span>`;
        tip.style.left = clamp(cx, 70, el.clientWidth - 70) + "px";
        tip.style.top = Math.max(cy - 14, 54) + "px";
        tip.classList.add("on");
    }

    function hideHover(el) {
        const guide = el.querySelector("#guide"), dot = el.querySelector("#guideDot"), tip = el.querySelector("#tip");
        if (guide) guide.setAttribute("visibility", "hidden");
        if (dot) dot.setAttribute("visibility", "hidden");
        if (tip) tip.classList.remove("on");
    }

    /**
     * Barras: alimentações executadas por dia.
     * o: { days:[{label, auto, manual, today}] }
     */
    function barChart(el, o) {
        el._model = o;
        watch(el, () => drawBars(el));
        drawBars(el);
    }

    function drawBars(el) {
        const o = el._model;
        const W = el.clientWidth, H = el.clientHeight;
        if (!o || W < 60 || H < 60) return;

        const totals = o.days.map((d) => d.auto + d.manual);
        const max = Math.max(...totals);
        if (max === 0) {
            el.innerHTML = `<div class="empty">Nenhuma alimentação executada nos últimos 7 dias.</div>`;
            return;
        }

        const L = 26, R = 8, T = 26, B = 32;
        const pw = W - L - R, ph = H - T - B;
        const step = Math.max(1, Math.ceil(max / 4));
        const top = Math.ceil(max / step) * step;
        const sy = (v) => T + ph * (1 - v / top);
        const colW = pw / o.days.length;
        const bw = Math.min(38, colW * 0.55);

        let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Alimentações executadas por dia">`;
        for (let v = 0; v <= top; v += step) {
            const y = sy(v);
            svg += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e1ddd4"/>`;
            svg += `<text x="${L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11.5" fill="#8d8a82">${v}</text>`;
        }
        o.days.forEach((d, i) => {
            const x = L + i * colW + (colW - bw) / 2;
            const base = sy(0);
            const yAuto = sy(d.auto), yAll = sy(d.auto + d.manual);
            const tip = `${d.full}: ${d.auto} automática(s), ${d.manual} manual(is)`;
            svg += `<g><title>${esc(tip)}</title>`;
            if (d.auto) svg += `<rect x="${x.toFixed(1)}" y="${yAuto.toFixed(1)}" width="${bw}" height="${(base - yAuto).toFixed(1)}" rx="7" fill="${d.today ? "#1d2321" : "#2f5d57"}"/>`;
            if (d.manual) svg += `<rect x="${x.toFixed(1)}" y="${yAll.toFixed(1)}" width="${bw}" height="${(yAuto - yAll - (d.auto ? 3 : 0)).toFixed(1)}" rx="7" fill="#c9773c"/>`;
            if (d.auto + d.manual) svg += `<text x="${(x + bw / 2).toFixed(1)}" y="${(yAll - 8).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="#1d2321">${d.auto + d.manual}</text>`;
            svg += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="12" ${d.today ? 'font-weight="600" fill="#1d2321"' : 'fill="#8d8a82"'}>${esc(d.label)}</text></g>`;
        });
        svg += "</svg>";
        el.innerHTML = svg;
    }

    /** Linha do tempo de funcionamento do aquecedor (modal). */
    function timelineChart(el, o) {
        el._model = o;
        watch(el, () => drawTimeline(el));
        drawTimeline(el);
    }

    function drawTimeline(el) {
        const o = el._model;
        const W = el.clientWidth;
        if (!o || W < 60) return;
        const H = 84, bar = 44;
        const sx = (t) => clamp(((t - o.t0) / (o.t1 - o.t0)) * W, 0, W);
        let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Linha do tempo do aquecimento"><rect x="0" y="0" width="${W}" height="${bar}" rx="8" fill="#ebe8e0"/>`;
        o.intervals.forEach((iv) => {
            const a = Math.max(iv.a, o.t0), b = Math.min(iv.b, o.t1);
            if (b <= a) return;
            const x = sx(a);
            svg += `<g><title>${esc(`${whenLabel(iv.a)} · ${iv.open ? "ligado agora" : fmtDuration((iv.b - iv.a) / 60000)}`)}</title><rect x="${x.toFixed(1)}" y="0" width="${Math.max(3, sx(b) - x).toFixed(1)}" height="${bar}" rx="8" fill="#c9773c"/></g>`;
        });
        xTicks(o.t0, o.t1).forEach((tick) => {
            svg += `<text x="${sx(tick.t).toFixed(1)}" y="${bar + 24}" text-anchor="middle" font-size="12" fill="#8d8a82">${tick.label}</text>`;
        });
        const now = sx(Date.now());
        svg += `<line x1="${now.toFixed(1)}" x2="${now.toFixed(1)}" y1="-2" y2="${bar + 6}" stroke="#1d2321" stroke-width="2"/></svg>`;
        el.innerHTML = svg;
    }

    /** Régua de termômetro do card de temperatura. */
    function drawRuler(el) {
        const m = el._model;
        const W = el.clientWidth;
        if (!m || W < 60) return;
        const { v, lo, hi, bad } = m;
        let rmin = Math.floor(lo - 2), rmax = Math.ceil(hi + 2);
        if (v !== null) { rmin = Math.min(rmin, Math.floor(v)); rmax = Math.max(rmax, Math.ceil(v)); }
        const range = rmax - rmin;
        const tickStep = range <= 10 ? 0.1 : 0.5;
        const sx = (x) => ((x - rmin) / range) * (W - 2) + 1;

        let svg = `<svg width="${W}" height="46" viewBox="0 0 ${W} 46">`;
        svg += `<rect x="${sx(lo).toFixed(1)}" y="0" width="${(sx(hi) - sx(lo)).toFixed(1)}" height="14" rx="3" fill="#2f5d57" opacity=".12"/>`;
        const n = Math.round(range / tickStep);
        for (let i = 0; i <= n; i++) {
            const val = rmin + i * tickStep;
            const big = Math.abs(val - Math.round(val * 2) / 2) < 1e-6 && Math.abs((val * 2) % 1) < 1e-6;
            svg += `<line x1="${sx(val).toFixed(1)}" x2="${sx(val).toFixed(1)}" y1="${big ? 0 : 5}" y2="14" stroke="${big ? "#1d2321" : "#b9b5ab"}" stroke-width="1"/>`;
        }
        if (v !== null) {
            const x = sx(clamp(v, rmin, rmax));
            svg += `<path d="M${x.toFixed(1)} 18 l-5.5 9 h11z" fill="${bad ? "#b8483e" : "#2f5d57"}"/>`;
        }
        svg += `<text x="0" y="44" font-size="11" fill="#8d8a82">${rmin}°</text><text x="${W}" y="44" text-anchor="end" font-size="11" fill="#8d8a82">${rmax}°</text></svg>`;
        el.innerHTML = svg;
    }

    /** Anel da contagem regressiva da próxima alimentação. */
    function drawRing(el) {
        const m = el._model;
        if (!m) return;
        const r = 34, c = 2 * Math.PI * r;
        el.innerHTML = `<svg width="88" height="88" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r="${r}" fill="none" stroke="#e1ddd4" stroke-width="6"/>
            <circle cx="44" cy="44" r="${r}" fill="none" stroke="#1d2321" stroke-width="6" stroke-linecap="round"
                stroke-dasharray="${(c * m.fraction).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 44 44)"/>
            <text x="44" y="${m.small ? 42 : 49}" text-anchor="middle" font-size="19" font-weight="600" fill="#1d2321">${esc(m.big)}</text>
            ${m.small ? `<text x="44" y="58" text-anchor="middle" font-size="11" fill="#8d8a82">${esc(m.small)}</text>` : ""}
        </svg>`;
    }

    // ------------------------------------------------------------------
    // Dashboard: cabeçalho e cards
    // ------------------------------------------------------------------
    function configNow() {
        return state.config || (state.resumo && state.resumo.configuracoes) || null;
    }

    function tickClock() {
        const text = fmtLong.format(Date.now());
        $("clock").textContent = text.charAt(0).toUpperCase() + text.slice(1) + " · " + fmtHM.format(Date.now());
    }

    function renderHeader() {
        const pill = $("devicePill"), text = $("deviceText"), last = $("lastReading");
        const r = state.resumo;

        if (state.apiOk === false) {
            pill.dataset.state = "bad";
            text.textContent = "API indisponível";
        } else if (!r) {
            pill.dataset.state = "idle";
            text.textContent = "Conectando…";
        } else if (!r.dispositivo || !r.dispositivo.ultima_comunicacao) {
            pill.dataset.state = "warn";
            text.textContent = "Aguardando o 1º contato do ESP32";
        } else if (r.dispositivo.conectado) {
            pill.dataset.state = "ok";
            text.textContent = "ESP32 online";
        } else {
            pill.dataset.state = "bad";
            text.textContent = "ESP32 sem comunicação";
        }

        const t = r && r.temperatura ? parseTime(r.temperatura.data_hora) : null;
        last.textContent = t ? `Última leitura ${ago(t)}` : (r ? "Nenhuma leitura recebida" : "Aguardando dados…");
    }

    function renderTempCard() {
        const r = state.resumo, cfg = configNow();
        const reading = r && r.temperatura ? r.temperatura : null;
        const v = reading ? Number(reading.temperatura) : null;

        $("tempValue").textContent = fmt1(v);

        const chip = $("tempChip");
        const online = r && r.dispositivo && r.dispositivo.conectado;
        let cls = "", label = "Aguardando leitura";
        if (v !== null && cfg) {
            if (!online) {
                cls = "warn";
                label = `Dado de ${ago(parseTime(reading.data_hora))}`;
            } else if (v < cfg.temperatura_ligar) { cls = "low"; label = "Abaixo da mínima"; }
            else if (v >= cfg.temperatura_desligar) { cls = "bad"; label = "Acima da máxima"; }
            else { cls = "ok"; label = "Dentro da faixa"; }
        }
        chip.className = "chip " + cls;
        chip.textContent = label;
        $("tempRange").textContent = cfg ? `${fmt1(cfg.temperatura_ligar)} – ${fmt1(cfg.temperatura_desligar)} °C` : "";

        const rulerEl = $("tempRuler");
        if (cfg) {
            rulerEl._model = { v, lo: cfg.temperatura_ligar, hi: cfg.temperatura_desligar, bad: v !== null && (v < cfg.temperatura_ligar || v >= cfg.temperatura_desligar) };
            watch(rulerEl, () => drawRuler(rulerEl));
            drawRuler(rulerEl);
        }
    }

    function renderHeatCard() {
        const r = state.resumo, cfg = configNow();
        const h = r ? r.aquecedor : null;
        const box = $("heatState"), foot = $("heatFoot");
        const estado = h ? h.estado : null;

        box.dataset.on = String(estado === "ligado");
        $("heatValue").textContent = estado === "ligado" ? "Ligado" : estado === "desligado" ? "Desligado" : "Sem registro";

        if (!h || estado === "desconhecido" || !estado) {
            foot.textContent = "Aguardando o 1º registro do ESP32";
            return;
        }
        const since = parseTime(h.data_hora);
        const rule = cfg
            ? (estado === "ligado"
                ? `Desliga em <b>${fmt1(cfg.temperatura_desligar)} °C</b>`
                : `Liga abaixo de <b>${fmt1(cfg.temperatura_ligar)} °C</b>`)
            : "";
        const detail = since ? `<span>desde ${fmtHM.format(since)}${h.origem === "manual" ? " · controle manual" : ""}</span>` : "";
        foot.innerHTML = `${rule ? `<span>${rule}</span>` : ""}${detail}`;
    }

    function nextFeedInfo() {
        const r = state.resumo, cfg = configNow();
        if (!r || !r.alimentacao || !r.alimentacao.proxima || !cfg) return null;
        const next = parseTime(r.alimentacao.proxima);
        if (next === null) return null;

        const nextMin = hmToMin(fmtHM.format(next));
        const times = [cfg.horario_alimentacao_1, cfg.horario_alimentacao_2];
        const index = times.findIndex((hm) => hmToMin(hm) === nextMin);
        const others = times.map(hmToMin).filter((m) => m !== nextMin);
        const gapMin = others.length ? Math.min(...others.map((m) => ((nextMin - m + 1440) % 1440) || 1440)) : 1440;
        return { next, index: index < 0 ? 0 : index, gapMs: gapMin * 60000 };
    }

    function renderNextCard() {
        const r = state.resumo;
        const ring = $("nextRing"), foot = $("nextFoot"), value = $("nextValue");
        const info = nextFeedInfo();

        if (!info) {
            value.textContent = "--";
            ring.innerHTML = "";
            ring._model = null;
            foot.textContent = r && r.alimentacao && r.alimentacao.automacao_ativa === false
                ? "Automação de alimentação desligada"
                : "Aguardando dados";
            return;
        }

        const remaining = Math.max(0, info.next - Date.now());
        const min = Math.round(remaining / 60000);
        const big = min < 60 ? String(min) : `${Math.floor(min / 60)}h`;
        const small = min < 60 ? "min" : (min % 60 ? `${min % 60}min` : "");

        value.textContent = fmtHM.format(info.next);
        ring._model = { fraction: clamp(remaining / info.gapMs, 0, 1), big, small };
        watch(ring, () => drawRing(ring));
        drawRing(ring);

        const cfg = configNow();
        const day = dayKey(info.next) === dayKey(Date.now()) ? "" : "Amanhã · ";
        foot.innerHTML = `<span class="cd"><b>em ${esc(fmtDuration(remaining / 60000))}</b></span><span>${day}Alimentação ${info.index + 1} · servo <b>${esc(cfg.angulo_servo)}°</b></span>`;
    }

    function renderLastCard() {
        const r = state.resumo;
        const last = r && r.alimentacao ? r.alimentacao.ultima : null;
        const value = $("lastValue"), foot = $("lastFoot");
        if (!last) {
            value.textContent = "--";
            foot.textContent = r ? "Nenhuma alimentação registrada" : "Aguardando dados";
            return;
        }
        const t = parseTime(last.data_hora);
        value.textContent = t ? fmtHM.format(t) : "--";
        const origem = last.origem === "manual" ? "manual" : "automática";
        // /dashboard/resumo só devolve alimentações com status "executada",
        // ou seja, as que o ESP32 confirmou.
        foot.innerHTML = `<span class="chip ok">Confirmada pelo ESP32</span><span>${t ? dayLabel(t) : ""} · ${origem}</span>`;
    }

    function renderCards() {
        renderTempCard();
        renderHeatCard();
        renderNextCard();
        renderLastCard();
    }

    // ------------------------------------------------------------------
    // Dashboard: gráficos e eventos
    // ------------------------------------------------------------------
    function heatIntervals(eventsAsc, now) {
        const out = [];
        let open = null;
        eventsAsc.forEach((e) => {
            const t = parseTime(e.data_hora);
            if (t === null) return;
            if (e.estado === "ligado") {
                if (!open) open = { a: t, tIni: e.temperatura, origem: e.origem };
            } else if (e.estado === "desligado" && open) {
                out.push({ a: open.a, b: t, tIni: open.tIni, tFim: e.temperatura, origem: open.origem, open: false });
                open = null;
            }
        });
        if (open) out.push({ a: open.a, b: now, tIni: open.tIni, tFim: null, origem: open.origem, open: true });
        return out;
    }

    function renderTempChart() {
        const el = $("tempChart");
        const now = Date.now();
        const cfg = configNow();
        const intervals = heatIntervals(state.heatEvents, now);
        const t0 = startOfDay(now);
        const points = state.temps.filter((p) => p.t >= t0).map((p) => ({ t: p.t, v: p.v }));
        const mode = resolveMode(points.length);
        const box = $("tempModeBox");
        if (box) box.innerHTML = modeSwitch(mode);
        lineChart(el, {
            points,
            mode,
            t0,
            t1: Math.max(now, t0 + HOUR),
            band: cfg ? [cfg.temperatura_ligar, cfg.temperatura_desligar] : null,
            segments: intervals.map((i) => ({ a: i.a, b: i.b })),
            empty: "Nenhuma leitura de temperatura hoje ainda.",
        });
    }

    function renderFeedChart() {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const t = Date.now() - i * DAY;
            const key = dayKey(t);
            const rows = state.feeds.filter((f) => f.status === "executada" && dayKey(parseTime(f.data_hora)) === key);
            days.push({
                key,
                label: fmtWeek.format(t).replace(".", ""),
                full: `${fmtDM.format(t)}`,
                auto: rows.filter((f) => f.origem === "automatica").length,
                manual: rows.filter((f) => f.origem === "manual").length,
                today: i === 0,
            });
        }
        barChart($("feedChart"), { days });
    }

    /** Texto amigável + estilo de cada evento do banco (campos reais: tipo, descricao, gravidade). */
    function eventInfo(ev) {
        const tipo = String(ev.tipo || "");
        const desc = String(ev.descricao || "");
        const manual = /manual/i.test(desc);
        let title = desc || tipo, cls = "";

        switch (tipo) {
            case "aquecedor_ligado": title = "Aquecimento ligado" + (manual ? " (manual)" : ""); cls = "heat"; break;
            case "aquecedor_desligado": title = "Aquecimento desligado" + (manual ? " (manual)" : ""); cls = "heat"; break;
            case "alimentacao_executada": title = manual ? "Alimentação manual realizada" : "Alimentação automática realizada"; cls = "feed"; break;
            case "alimentacao_nao_concluida": title = /falhou/i.test(desc) ? "Alimentação falhou" : "Alimentação não executada"; cls = "warn"; break;
            case "configuracoes_atualizadas": title = "Configurações alteradas"; break;
            case "temperatura_baixa": title = "Temperatura abaixo do limite"; break;
            case "temperatura_alta": title = "Temperatura acima do limite"; break;
            case "temperatura_normalizada": title = "Temperatura normalizada"; break;
            case "dispositivo_desconectado": title = "ESP32 sem comunicação"; break;
            case "dispositivo_reconectado": title = "ESP32 reconectado"; break;
            case "dispositivo_conectado": title = "ESP32 conectado pela 1ª vez"; break;
            case "comando_criado": title = /alimentacao_manual/.test(desc) ? "Alimentação manual solicitada" : "Comando solicitado"; break;
            case "comando_executado": title = "Comando executado pelo ESP32"; break;
            case "comando_falhou": title = "Comando falhou no ESP32"; break;
            default: break;
        }
        if (ev.gravidade === "erro" || ev.gravidade === "critico") cls = "bad";
        else if (ev.gravidade === "aviso" && !cls) cls = "warn";
        return { title, cls };
    }

    function renderEvents() {
        const list = $("events");
        if (!state.events.length) {
            list.innerHTML = `<li class="none">Nenhum evento registrado ainda.</li>`;
            return;
        }
        list.innerHTML = state.events.slice(0, 5).map((ev) => {
            const t = parseTime(ev.data_hora);
            const info = eventInfo(ev);
            const when = t === null ? "--" : (dayKey(t) === dayKey(Date.now()) ? fmtHM.format(t) : `${fmtDM.format(t)} · ${fmtHM.format(t)}`);
            return `<li class="e ${info.cls}"><time datetime="${esc(ev.data_hora)}">${when}</time><p>${esc(info.title)}</p></li>`;
        }).join("");
    }

    // ------------------------------------------------------------------
    // Carregamento de dados (somente quando algo mudou)
    // ------------------------------------------------------------------
    async function loadTemps() {
        const now = Date.now();
        const lastT = state.temps.length ? state.temps[state.temps.length - 1].t : null;
        const full = lastT === null || now - lastT > DAY;
        const start = full ? now - DAY : lastT;
        const limit = full ? TEMP_LIMIT : 2000;

        const data = await api(`/temperaturas?inicio=${isoParam(start)}&limite=${limit}`);
        if (full) { state.temps = []; state.tempIds = new Set(); }

        (data.temperaturas || []).forEach((row) => {
            const t = parseTime(row.data_hora);
            if (t === null || state.tempIds.has(row.id)) return;
            state.tempIds.add(row.id);
            state.temps.push({ id: row.id, t, v: Number(row.temperatura) });
        });
        state.temps.sort((a, b) => a.t - b.t);

        const cutoff = now - DAY - HOUR;
        if (state.temps.length && state.temps[0].t < cutoff) {
            state.temps = state.temps.filter((p) => p.t >= cutoff);
            state.tempIds = new Set(state.temps.map((p) => p.id));
        }
    }

    async function loadHeat() {
        const data = await api("/aquecedor/historico?limite=500");
        state.heatEvents = (data.eventos || []).slice().sort((a, b) => parseTime(a.data_hora) - parseTime(b.data_hora));
    }

    async function loadFeeds() {
        const data = await api(`/alimentacoes?inicio=${isoParam(Date.now() - 8 * DAY)}&limite=500`);
        state.feeds = data.alimentacoes || [];
    }

    async function loadEvents() {
        const data = await api("/eventos?limite=8");
        state.events = data.eventos || [];
    }

    /**
     * /dashboard/resumo é a única consulta feita a cada ciclo. As demais só
     * acontecem quando o resumo indica que algo mudou (nova leitura, novo estado
     * do aquecedor, novo evento).
     */
    async function syncHistory(resumo) {
        const changed = { temps: false, heat: false, feeds: false, events: false };
        const jobs = [];
        const reading = resumo.temperatura ? resumo.temperatura.data_hora : null;
        if (reading !== state.tempsKey) {
            jobs.push(loadTemps().then(() => {
                state.tempsKey = reading;
                changed.temps = true;
            }));
        }

        const heatKey = resumo.aquecedor ? `${resumo.aquecedor.estado}|${resumo.aquecedor.data_hora}` : "";
        if (heatKey !== state.heatKey) {
            jobs.push(loadHeat().then(() => {
                state.heatKey = heatKey;
                changed.heat = true;
            }));
        }

        const last = resumo.alimentacao && resumo.alimentacao.ultima ? resumo.alimentacao.ultima.id : "";
        const feedKey = `${resumo.total_eventos}|${last}|${dayKey(Date.now())}`;
        if (feedKey !== state.feedKey) {
            jobs.push(loadFeeds().then(() => {
                state.feedKey = feedKey;
                changed.feeds = true;
            }));
        }

        if (resumo.total_eventos !== state.eventsCount) {
            jobs.push(loadEvents().then(() => {
                state.eventsCount = resumo.total_eventos;
                changed.events = true;
            }));
        }

        await Promise.allSettled(jobs);
        return changed;
    }

    function setApi(ok) {
        state.apiOk = ok;
        state.failures = ok ? 0 : state.failures + 1;
    }

    function schedule() {
        clearTimeout(pollTimer);
        if (document.hidden) return;
        const cfg = configNow();
        const base = clamp(cfg && cfg.intervalo_atualizacao ? cfg.intervalo_atualizacao : 10, MIN_POLL, MAX_POLL) * 1000;
        const delay = state.apiOk === false ? Math.min(60000, base * 2 ** Math.min(state.failures, 3)) : base;
        pollTimer = setTimeout(refresh, delay);
    }

    async function refresh() {
        if (refreshing) return;
        refreshing = true;
        clearTimeout(pollTimer);
        try {
            const resumo = await api("/dashboard/resumo");
            state.resumo = resumo;
            setApi(true);
            applyConfig(resumo.configuracoes);
            renderHeader();
            renderCards();
            await syncHistory(resumo);
            renderTempChart();
            renderFeedChart();
            renderEvents();
        } catch (error) {
            setApi(false);
            renderHeader();
            console.error("[VA] Falha ao atualizar:", error);
        } finally {
            refreshing = false;
            lastRefresh = Date.now();
            schedule();
        }
    }

    // Relógio local: atualiza textos relativos e a contagem sem chamar a API.
    function tick() {
        tickClock();
        if (state.resumo) {
            renderHeader();
            renderTempCard();
            renderNextCard();
            renderManual();

            const info = nextFeedInfo();
            if (info && Date.now() >= info.next && Date.now() - lastRefresh > 5000) refresh();
        }
    }

    // ------------------------------------------------------------------
    // Configurações
    // ------------------------------------------------------------------
    const CFG_KEYS = [
        "automacao_aquecedor", "temperatura_ligar", "temperatura_desligar",
        "automacao_alimentacao", "horario_alimentacao_1", "horario_alimentacao_2",
        "angulo_servo", "intervalo_atualizacao", "alerta_temperatura", "alerta_comunicacao",
    ];

    function normalizeConfig(cfg) {
        if (!cfg) return null;
        const c = { ...cfg };
        ["automacao_aquecedor", "automacao_alimentacao", "alerta_temperatura", "alerta_comunicacao"].forEach((k) => { c[k] = Boolean(c[k]); });
        return c;
    }

    function applyConfig(cfg) {
        const c = normalizeConfig(cfg);
        if (!c) return;
        state.config = c;
        if (!state.formDirty) fillForm(c);
        const when = parseTime(c.atualizado_em);
        $("cfgSub").textContent = when
            ? `Salvas na API · última alteração ${dayLabel(when).toLowerCase()} às ${fmtHM.format(when)}`
            : "Os valores são salvos na API";
    }

    function fillForm(c) {
        $("cfgMin").value = Number(c.temperatura_ligar).toFixed(1);
        $("cfgMax").value = Number(c.temperatura_desligar).toFixed(1);
        $("cfgF1").value = c.horario_alimentacao_1;
        $("cfgF2").value = c.horario_alimentacao_2;
        $("cfgServo").value = c.angulo_servo;
        clearErrors();
        updateSlider();
    }

    function readForm() {
        const num = (id) => {
            const raw = $(id).value.trim().replace(",", ".");
            return raw === "" ? NaN : Number(raw);
        };
        return {
            temperatura_ligar: num("cfgMin"),
            temperatura_desligar: num("cfgMax"),
            horario_alimentacao_1: $("cfgF1").value,
            horario_alimentacao_2: $("cfgF2").value,
            angulo_servo: num("cfgServo"),
        };
    }

    function validateForm(v) {
        const e = {};
        if (Number.isNaN(v.temperatura_ligar) || v.temperatura_ligar < 0 || v.temperatura_ligar > 40) e.Min = "Informe um valor entre 0 e 40.";
        if (Number.isNaN(v.temperatura_desligar) || v.temperatura_desligar < 0 || v.temperatura_desligar > 40) e.Max = "Informe um valor entre 0 e 40.";
        if (!e.Min && !e.Max && v.temperatura_desligar <= v.temperatura_ligar) e.Max = "A máxima deve ser maior que a mínima.";
        const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
        if (!validTime(v.horario_alimentacao_1)) e.F1 = "Use o formato HH:MM (00:00 a 23:59).";
        if (!validTime(v.horario_alimentacao_2)) e.F2 = "Use o formato HH:MM (00:00 a 23:59).";
        if (!Number.isInteger(v.angulo_servo) || v.angulo_servo < 0 || v.angulo_servo > 180) e.Servo = "Use um número inteiro de 0 a 180.";
        return e;
    }

    function clearErrors() {
        ["Min", "Max", "F1", "F2", "Servo"].forEach((k) => {
            $("err" + k).textContent = "";
            $("f" + k).classList.remove("invalid");
        });
    }

    function showErrors(errors) {
        clearErrors();
        Object.entries(errors).forEach(([k, message]) => {
            $("err" + k).textContent = message;
            $("f" + k).classList.add("invalid");
        });
    }

    function setCfgMessage(text, kind = "") {
        const el = $("cfgMsg");
        el.textContent = text;
        el.className = "msg " + kind;
    }

    function updateSlider() {
        const lo = 18, hi = 34;
        const v = readForm();
        const c = state.config || {};
        const a = Number.isNaN(v.temperatura_ligar) ? c.temperatura_ligar : v.temperatura_ligar;
        const b = Number.isNaN(v.temperatura_desligar) ? c.temperatura_desligar : v.temperatura_desligar;
        if (a === undefined || b === undefined) return;
        const pa = clamp((a - lo) / (hi - lo), 0, 1) * 100;
        const pb = clamp((b - lo) / (hi - lo), 0, 1) * 100;
        $("slA").style.left = pa + "%";
        $("slB").style.left = pb + "%";
        $("slFill").style.left = Math.min(pa, pb) + "%";
        $("slFill").style.width = Math.abs(pb - pa) + "%";
    }

    async function saveConfig(event) {
        event.preventDefault();
        if (!state.config) {
            setCfgMessage("Aguarde o carregamento das configurações.", "error");
            return;
        }
        const values = readForm();
        const errors = validateForm(values);
        if (Object.keys(errors).length) {
            showErrors(errors);
            setCfgMessage("Corrija os campos destacados.", "error");
            return;
        }
        clearErrors();

        // O PUT exige o objeto completo; os campos que o painel não edita são preservados.
        const body = {};
        CFG_KEYS.forEach((k) => { body[k] = state.config[k]; });
        Object.assign(body, values);

        const button = $("saveBtn");
        button.disabled = true;
        button.textContent = "Salvando…";
        setCfgMessage("");
        try {
            const saved = await api("/configuracoes", { method: "PUT", body: JSON.stringify(body) });
            state.formDirty = false;
            applyConfig(saved);
            setCfgMessage(`✓ Configurações salvas às ${fmtHM.format(Date.now())}`, "ok");
            refresh();
        } catch (error) {
            setCfgMessage(error.message, "error");
        } finally {
            button.disabled = false;
            button.textContent = "Salvar configurações";
        }
    }

    function initForm() {
        $("cfgForm").addEventListener("submit", saveConfig);
        ["cfgMin", "cfgMax", "cfgF1", "cfgF2", "cfgServo"].forEach((id) => {
            $(id).addEventListener("input", () => {
                state.formDirty = true;
                setCfgMessage("");
                updateSlider();
            });
        });
        // Máscara HH:MM (campo de texto: o formato 24 h não depende do idioma do navegador)
        ["cfgF1", "cfgF2"].forEach((id) => {
            $(id).addEventListener("input", (ev) => {
                const digits = ev.target.value.replace(/\D/g, "").slice(0, 4);
                ev.target.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
            });
        });
        $("resetBtn").addEventListener("click", () => {
            state.formDirty = false;
            if (state.config) fillForm(state.config);
            setCfgMessage("");
        });
    }

    // ------------------------------------------------------------------
    // Alimentação manual (comando -> ESP32 -> confirmação)
    // ------------------------------------------------------------------
    function setCommand(patch) {
        state.command = patch ? { ...(state.command || {}), ...patch } : null;
        renderManual();
    }

    function renderManual() {
        const c = state.command;
        const btn = $("manualBtn"), note = $("manualNote");
        const steps = $("manualSteps").children;
        const online = state.resumo && state.resumo.dispositivo && state.resumo.dispositivo.conectado;

        [...steps].forEach((s) => { s.className = ""; });
        steps[0].textContent = "Solicitada";
        steps[1].textContent = "Aguardando ESP32";
        steps[2].textContent = "Executada";
        $("manualSteps").setAttribute("aria-hidden", c ? "false" : "true");

        btn.disabled = false;
        btn.textContent = "Alimentar agora";

        if (!c) {
            note.textContent = online === false
                ? "ESP32 sem comunicação: o comando fica na fila por até 5 minutos."
                : "Só marcamos como alimentado após a confirmação do ESP32.";
            return;
        }

        steps[0].className = "d";
        if (c.phase === "pending") {
            steps[1].className = "w";
            btn.disabled = true;
            btn.textContent = "Aguardando o ESP32…";
            const left = Math.max(0, Math.round((Date.parse(c.expira_em) - Date.now()) / 1000));
            note.textContent = `Comando na fila. Expira em ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}.`;
        } else if (c.phase === "done") {
            steps[1].className = "d";
            steps[2].className = "d";
            note.textContent = `Executada pelo ESP32${c.executado_em ? ` às ${fmtHM.format(parseTime(c.executado_em))}` : ""}.`;
        } else if (c.phase === "failed") {
            steps[1].className = "d";
            steps[2].className = "x";
            steps[2].textContent = "Falhou";
            note.textContent = c.mensagem || "O ESP32 informou que não conseguiu alimentar.";
        } else if (c.phase === "timeout") {
            steps[1].className = "x";
            steps[1].textContent = "Sem resposta";
            note.textContent = "O ESP32 não respondeu em 5 minutos. Verifique a conexão e tente de novo.";
        } else if (c.phase === "error") {
            steps[0].className = "";
            note.textContent = c.mensagem;
        }
    }

    function finishCommand(phase, row) {
        clearTimeout(cmdTimer);
        const id = state.command && state.command.id;
        setCommand({
            phase,
            executado_em: row && row.executado_em,
            mensagem: row && row.mensagem_resultado,
        });
        if (phase === "done") refresh();
        setTimeout(() => {
            if (state.command && state.command.id === id && state.command.phase !== "pending") setCommand(null);
        }, 45000);
    }

    async function pollCommand() {
        const c = state.command;
        if (!c || c.phase !== "pending") return;
        try {
            const data = await api("/comandos?limite=20");
            const row = (data.comandos || []).find((x) => x.id === c.id);
            if (row) {
                if (row.status === "executado") return finishCommand("done", row);
                if (row.status === "falhou") return finishCommand("failed", row);
                if (row.status === "expirado") return finishCommand("timeout", row);
            }
        } catch (_) { /* tenta de novo no próximo ciclo */ }

        if (Date.now() > Date.parse(c.expira_em)) return finishCommand("timeout");
        cmdTimer = setTimeout(pollCommand, 3000);
    }

    async function requestFeeding() {
        const btn = $("manualBtn");
        btn.disabled = true;
        btn.textContent = "Enviando…";
        try {
            const res = await api("/comandos", { method: "POST", body: JSON.stringify({ tipo: "alimentacao_manual" }) });
            const cmd = res.comando;
            state.command = { id: cmd.id, phase: "pending", expira_em: cmd.expira_em };
            renderManual();
            clearTimeout(cmdTimer);
            cmdTimer = setTimeout(pollCommand, 2500);
            refresh();   // o evento "comando_criado" aparece no histórico
        } catch (error) {
            setCommand({ id: null, phase: "error", mensagem: error.message });
            setTimeout(() => { if (state.command && state.command.phase === "error") setCommand(null); }, 8000);
        }
    }

    // Se já existe um comando manual pendente (criado antes de abrir a página), acompanha-o.
    async function adoptPendingCommand() {
        try {
            const data = await api("/comandos?limite=10");
            const row = (data.comandos || []).find((c) =>
                c.tipo === "alimentacao_manual" && c.status === "pendente" && Date.parse(c.expira_em) > Date.now());
            if (row) {
                state.command = { id: row.id, phase: "pending", expira_em: row.expira_em };
                renderManual();
                cmdTimer = setTimeout(pollCommand, 1500);
            }
        } catch (_) { /* sem problema */ }
    }

    // ------------------------------------------------------------------
    // Janela de detalhes
    // ------------------------------------------------------------------
    const dlg = $("detail");
    const body = $("detailBody");
    const modal = { kind: null, period: 1, filter: "todos", token: 0 };

    const TITLES = {
        temperatura: ["Temperatura atual", "Temperatura atual"],
        aquecimento: ["Aquecimento", "Aquecimento"],
        alimentacao: ["Alimentação", "Histórico de alimentações"],
        eventos: ["Eventos", "Histórico de eventos"],
    };
    const PERIODS = {
        temperatura: [[1, "24 h"], [7, "7 dias"], [30, "30 dias"]],
        aquecimento: [[1, "24 h"], [7, "7 dias"], [30, "30 dias"]],
        alimentacao: [[7, "7 dias"], [30, "30 dias"]],
        eventos: null,
    };
    const X_SVG = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l10 10M12 2L2 12"/></svg>`;

    function shell({ kicker, title, sub, right }, inner) {
        return `<div class="hd">
            <div><small>${esc(kicker)}</small><h2 id="detailTitle">${title}${sub ? `<span>${sub}</span>` : ""}</h2></div>
            <div class="hd-right">${right || ""}<button class="x-btn" type="button" data-close aria-label="Fechar">${X_SVG}</button></div>
        </div>${inner}`;
    }

    function segControl(options, current, attr) {
        return `<div class="seg" role="group">${options.map(([value, label]) =>
            `<button type="button" ${attr}="${value}" class="${String(value) === String(current) ? "on" : ""}" aria-pressed="${String(value) === String(current)}">${esc(label)}</button>`).join("")}</div>`;
    }

    const modeSwitch = (mode) => segControl([["time", "Por tempo"], ["seq", "Por leitura"]], mode, "data-m");

    // troca o modo do gráfico de temperatura (painel e janela de detalhes)
    function setTempMode(mode) {
        state.tempMode = mode;
        try { localStorage.setItem("va_temp_mode", mode); } catch (e) { /* sem armazenamento */ }
        document.querySelectorAll("[data-m]").forEach((btn) => {
            const on = btn.dataset.m === mode;
            btn.classList.toggle("on", on);
            btn.setAttribute("aria-pressed", String(on));
        });
        ["tempChart", "mTemp"].forEach((id) => {
            const el = $(id);
            if (el && el._model) { el._model.mode = mode; drawLine(el); }
        });
    }

    const stat = (label, value, note) =>
        `<div class="s"><div class="l">${esc(label)}</div><div class="v">${value}</div><div class="n">${note || "&nbsp;"}</div></div>`;

    function setBody(html) {
        unwatchAll(body);
        body.innerHTML = html;
    }

    function openModal(kind) {
        modal.kind = kind;
        if (kind === "temperatura" || kind === "aquecimento") modal.period = 1;
        if (kind === "alimentacao") modal.period = 7;
        modal.filter = "todos";
        renderModal();
        if (!dlg.open) dlg.showModal();
    }

    async function renderModal() {
        const token = ++modal.token;
        const kind = modal.kind;
        const [kicker, title] = TITLES[kind];
        const periods = PERIODS[kind];
        const right = periods ? segControl(periods, modal.period, "data-p") : "";

        setBody(shell({ kicker, title: esc(title), right }, `<div class="loading">Carregando…</div>`));

        try {
            const builder = { temperatura: buildTemp, aquecimento: buildHeat, alimentacao: buildFeed, eventos: buildEvents }[kind];
            const html = await builder(right);
            if (token !== modal.token) return;       // outra janela/período foi aberto
            setBody(html.markup);
            if (html.after) html.after();
        } catch (error) {
            if (token !== modal.token) return;
            setBody(shell({ kicker, title: esc(title), right },
                `<div class="loading"><div>Não foi possível carregar os dados.<br><small>${esc(error.message)}</small></div>
                 <button class="btn ghost" type="button" data-retry>Tentar de novo</button></div>`));
        }
    }

    function bandSituation(v) {
        const cfg = configNow();
        if (!cfg) return `<span class="chip">--</span>`;
        if (v < cfg.temperatura_ligar) return `<span class="chip low">Abaixo da mínima</span>`;
        if (v >= cfg.temperatura_desligar) return `<span class="chip bad">Acima da máxima</span>`;
        return `<span class="chip ok">Na faixa</span>`;
    }

    async function buildTemp(right) {
        const dias = modal.period;
        const start = Date.now() - dias * DAY;
        const [stats, list] = await Promise.all([
            api(`/temperaturas/estatisticas?dias=${dias}`),
            api(`/temperaturas?inicio=${isoParam(start)}&limite=${TEMP_LIMIT}`),
        ]);

        const rows = list.temperaturas || [];
        const pts = rows.map((r) => ({ t: parseTime(r.data_hora), v: Number(r.temperatura) }))
            .filter((p) => p.t !== null).sort((a, b) => a.t - b.t);
        const truncated = rows.length >= TEMP_LIMIT;
        const t0 = truncated && pts.length ? pts[0].t : start;

        const atTime = (value) => {
            if (value === null || value === undefined) return "";
            const p = pts.find((x) => x.v === Number(value));
            return p ? (dias === 1 ? `às ${fmtHM.format(p.t)}` : whenLabel(p.t).toLowerCase()) : "";
        };
        const period = dias === 1 ? "nas últimas 24 h" : `nos últimos ${dias} dias`;
        const current = state.resumo && state.resumo.temperatura ? state.resumo.temperatura : null;
        const cfg = configNow();
        const mode = resolveMode(pts.length);

        const tableRows = pts.slice(-12).reverse().map((p) =>
            `<tr><td>${esc(whenLabel(p.t))}</td><td><b>${fmt1(p.v)}</b> °C</td><td>${bandSituation(p.v)}</td></tr>`).join("");

        const markup = shell({
            kicker: "Temperatura atual",
            title: `${current ? fmt1(current.temperatura) : "--"} °C`,
            sub: current ? `medida ${esc(ago(parseTime(current.data_hora)))}` : "sem leitura",
            right: modeSwitch(mode) + right,
        }, `
            <div class="stats c3">
                ${stat("Média", stats.media === null ? "--" : `${fmt1(stats.media)}<sup>°C</sup>`, period)}
                ${stat("Mínima", stats.minima === null ? "--" : `${fmt1(stats.minima)}<sup>°C</sup>`, atTime(stats.minima))}
                ${stat("Máxima", stats.maxima === null ? "--" : `${fmt1(stats.maxima)}<sup>°C</sup>`, atTime(stats.maxima))}
            </div>
            <div class="mbody cols">
                <div class="box">
                    <h3>Histórico de medições<span>${cfg ? `faixa configurada ${fmt1(cfg.temperatura_ligar)} – ${fmt1(cfg.temperatura_desligar)} °C` : ""}</span></h3>
                    <div class="chart" id="mTemp"></div>
                    ${truncated ? `<p class="mnote">Gráfico limitado às ${nf0.format(TEMP_LIMIT)} leituras mais recentes (desde ${esc(whenLabel(t0))}).</p>` : ""}
                </div>
                <div class="box">
                    <h3>Últimas leituras<span>${nf0.format(stats.quantidade_medicoes || 0)} no período</span></h3>
                    <div class="tscroll">${tableRows
                        ? `<table><thead><tr><th>Hora</th><th>Temp.</th><th>Situação</th></tr></thead><tbody>${tableRows}</tbody></table>`
                        : `<p class="mnote">Nenhuma leitura neste período.</p>`}</div>
                </div>
            </div>`);

        return {
            markup,
            after: () => lineChart($("mTemp"), {
                points: pts, mode, t0, t1: Date.now(),
                band: cfg ? [cfg.temperatura_ligar, cfg.temperatura_desligar] : null,
                segments: [],
                empty: "Nenhuma leitura neste período.",
            }),
        };
    }

    async function buildHeat(right) {
        const dias = modal.period;
        const start = Date.now() - dias * DAY;
        const [stats, hist] = await Promise.all([
            api(`/aquecedor/estatisticas?dias=${dias}`),
            api("/aquecedor/historico?limite=1000"),
        ]);

        const asc = (hist.eventos || []).slice().sort((a, b) => parseTime(a.data_hora) - parseTime(b.data_hora));
        const now = Date.now();
        const intervals = heatIntervals(asc, now).filter((iv) => iv.b >= start);
        const rows = intervals.slice().reverse().slice(0, 60);

        const h = state.resumo ? state.resumo.aquecedor : null;
        const estado = h && h.estado;
        const since = h && h.data_hora ? parseTime(h.data_hora) : null;
        const share = stats.tempo_total_ligado_minutos !== undefined
            ? `${Math.round((stats.tempo_total_ligado_minutos / (dias * 1440)) * 100)}% do período` : "";
        const periodo = dias === 1 ? "nas últimas 24 h" : `nos últimos ${dias} dias`;

        const tableRows = rows.map((iv) => `<tr>
            <td>${esc(whenLabel(iv.a))}</td>
            <td>${iv.open ? `${esc(fmtDuration((iv.b - iv.a) / 60000))} <span class="chip warn">em andamento</span>` : esc(fmtDuration((iv.b - iv.a) / 60000))}</td>
            <td>${iv.tIni === null || iv.tIni === undefined ? "--" : fmt1(iv.tIni)} → ${iv.open ? "ligado" : (iv.tFim === null || iv.tFim === undefined ? "--" : fmt1(iv.tFim))}</td>
            <td class="m">${iv.origem === "manual" ? "Manual" : "Automática"}</td></tr>`).join("");

        const markup = shell({
            kicker: "Aquecimento",
            title: estado === "ligado" ? "Ligado" : estado === "desligado" ? "Desligado" : "Sem registro",
            sub: since ? `desde ${esc(whenLabel(since).toLowerCase())}` : "",
            right,
        }, `
            <div class="stats c3">
                ${stat("Tempo ligado", durParts(stats.tempo_total_ligado_minutos), share)}
                ${stat("Acionamentos", String(stats.quantidade_acionamentos ?? "--"), `vezes que ligou ${periodo}`)}
                ${stat("Duração média", durParts(stats.duracao_media_minutos), stats.maior_duracao_minutos ? `maior: ${esc(fmtDuration(stats.maior_duracao_minutos))}` : "por acionamento")}
            </div>
            <div class="mbody rows">
                <div class="box">
                    <h3>Histórico de funcionamento<span>laranja = ligado · linha preta = agora (${esc(fmtHM.format(now))})</span></h3>
                    <div data-watch id="mTimeline" style="min-height:84px"></div>
                </div>
                <div class="box">
                    <h3>Histórico de acionamentos<span>${intervals.length} no período</span></h3>
                    <div class="tscroll">${tableRows
                        ? `<table><thead><tr><th>Ligou em</th><th>Permaneceu ligado</th><th>Temperatura (início → fim, °C)</th><th>Origem</th></tr></thead><tbody>${tableRows}</tbody></table>`
                        : `<p class="mnote">Nenhum acionamento neste período.</p>`}</div>
                </div>
            </div>`);

        return { markup, after: () => timelineChart($("mTimeline"), { intervals, t0: start, t1: now }) };
    }

    async function buildFeed(right) {
        const dias = modal.period;
        const start = Date.now() - dias * DAY;
        const [stats, list] = await Promise.all([
            api(`/alimentacoes/estatisticas?dias=${dias}`),
            api(`/alimentacoes?inicio=${isoParam(start)}&limite=500`),
        ]);
        const rows = list.alimentacoes || [];
        const cfg = configNow();
        const last = state.resumo && state.resumo.alimentacao ? state.resumo.alimentacao.ultima : null;
        const lastT = last ? parseTime(last.data_hora) : null;

        const statusChip = (s) => s === "executada"
            ? `<span class="chip ok">Confirmada pelo ESP32</span>`
            : s === "falhou" ? `<span class="chip bad">Falha no ESP32</span>`
                : `<span class="chip warn">Não executada</span>`;

        const tableRows = rows.map((f) => {
            const t = parseTime(f.data_hora);
            return `<tr>
                <td>${t ? esc(whenLabel(t)) : "--"}</td>
                <td>${f.origem === "manual" ? "Manual" : "Automática"}</td>
                <td>${statusChip(f.status)}</td>
                <td class="m">${f.horario_programado ? esc(f.horario_programado.length <= 5 ? f.horario_programado : fmtHM.format(parseTime(f.horario_programado))) : "--"}</td>
                <td class="m">${f.angulo_servo === null || f.angulo_servo === undefined ? "--" : esc(f.angulo_servo) + "°"}</td>
                <td class="m">${esc(f.observacao || "")}</td></tr>`;
        }).join("");

        const markup = shell({
            kicker: "Alimentação",
            title: lastT ? fmtHM.format(lastT) : "--",
            sub: lastT ? `${esc(dayLabel(lastT).toLowerCase())} · última confirmada pelo ESP32` : "nenhuma alimentação registrada",
            right,
        }, `
            <div class="stats c4">
                ${stat("1º horário", cfg ? esc(cfg.horario_alimentacao_1) : "--", cfg && !cfg.automacao_alimentacao ? "automação desligada" : "programado")}
                ${stat("2º horário", cfg ? esc(cfg.horario_alimentacao_2) : "--", cfg && !cfg.automacao_alimentacao ? "automação desligada" : "programado")}
                ${stat("Executadas", String(stats.total_executadas ?? "--"), `${stats.automaticas ?? 0} automáticas · ${stats.manuais ?? 0} manuais`)}
                ${stat("Servo", cfg ? `${esc(cfg.angulo_servo)}<sup>°</sup>` : "--", "a API ainda não registra gramas de ração")}
            </div>
            <div class="mbody one rows" style="grid-template-rows:minmax(0,1fr)">
                <div class="box">
                    <h3>Histórico de alimentações<span>só aparecem como executadas após a confirmação do ESP32${stats.percentual_cumprimento !== null && stats.percentual_cumprimento !== undefined ? ` · cumprimento ${esc(fmt1(stats.percentual_cumprimento))}%` : ""}</span></h3>
                    <div class="tscroll">${tableRows
                        ? `<table><thead><tr><th>Data e hora</th><th>Origem</th><th>Situação</th><th>Programada</th><th>Servo</th><th>Observação</th></tr></thead><tbody>${tableRows}</tbody></table>`
                        : `<p class="mnote">Nenhuma alimentação registrada neste período.</p>`}</div>
                </div>
            </div>`);
        return { markup };
    }

    async function buildEvents() {
        const data = await api("/eventos?limite=100");
        let events = data.eventos || [];
        if (modal.filter === "alertas") events = events.filter((e) => e.gravidade !== "informacao");

        const sev = { informacao: ["Info", ""], aviso: ["Aviso", "warn"], erro: ["Erro", "bad"], critico: ["Crítico", "bad"] };
        const tableRows = events.map((e) => {
            const t = parseTime(e.data_hora);
            const info = eventInfo(e);
            const [label, cls] = sev[e.gravidade] || ["--", ""];
            return `<tr><td>${t ? esc(whenLabel(t)) : "--"}</td><td>${esc(info.title)}</td><td class="m">${esc(e.descricao)}</td><td><span class="chip ${cls}">${label}</span></td></tr>`;
        }).join("");

        const filters = segControl([["todos", "Todos"], ["alertas", "Alertas"]], modal.filter, "data-f");
        const markup = shell({ kicker: "Eventos", title: "Histórico de eventos", sub: `${events.length} ${modal.filter === "alertas" ? "alertas" : "mais recentes"}`, right: filters },
            `<div class="mbody one" style="grid-template-rows:minmax(0,1fr)"><div class="box"><div class="tscroll">${tableRows
                ? `<table><thead><tr><th>Quando</th><th>Evento</th><th>Detalhe</th><th>Tipo</th></tr></thead><tbody>${tableRows}</tbody></table>`
                : `<p class="mnote">Nenhum evento para este filtro.</p>`}</div></div></div>`);
        return { markup };
    }

    function initModal() {
        document.querySelectorAll("[data-detail]").forEach((btn) =>
            btn.addEventListener("click", () => openModal(btn.dataset.detail)));
        $("openEvents").addEventListener("click", () => openModal("eventos"));
        $("tempModeBox").addEventListener("click", (ev) => {
            const m = ev.target.closest("[data-m]");
            if (m) setTempMode(m.dataset.m);
        });
        try {
            const saved = localStorage.getItem("va_temp_mode");
            if (saved === "time" || saved === "seq") state.tempMode = saved;
        } catch (e) { /* sem armazenamento */ }

        dlg.addEventListener("click", (ev) => {
            if (ev.target === dlg) return dlg.close();                       // clique no fundo
            const close = ev.target.closest("[data-close]");
            const period = ev.target.closest("[data-p]");
            const filter = ev.target.closest("[data-f]");
            const mode = ev.target.closest("[data-m]");
            if (mode) return setTempMode(mode.dataset.m);
            if (close) return dlg.close();
            if (period) { modal.period = Number(period.dataset.p); return renderModal(); }
            if (filter) { modal.filter = filter.dataset.f; return renderModal(); }
            if (ev.target.closest("[data-retry]")) return renderModal();
        });
        dlg.addEventListener("close", () => {
            modal.token++;
            unwatchAll(body);
            body.innerHTML = "";
        });
    }

    // ------------------------------------------------------------------
    // Inicialização
    // ------------------------------------------------------------------
    function init() {
        initForm();
        initModal();
        $("manualBtn").addEventListener("click", requestFeeding);

        tickClock();
        renderManual();
        setInterval(tick, 5000);
        setInterval(() => { if (state.command && state.command.phase === "pending") renderManual(); }, 1000);

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) { clearTimeout(pollTimer); return; }
            if (Date.now() - lastRefresh > 2000) refresh(); else schedule();
        });

        refresh().then(adoptPendingCommand);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
