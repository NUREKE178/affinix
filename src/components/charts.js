import { html, useRef, useEffect } from "../lib/preact.js";

// Chart.js styled to sit directly on a plate: no well behind it, hairline grid, mono tick labels.
export const SERIES_COLORS = ["#ff6a1f", "#86a5d9", "#d9cfb8", "#4fc3b0", "#c8a1e8"];

const GRID_COLOR = "rgba(255,255,255,0.06)";
const TICK_COLOR = "#868993";
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const tooltip = {
  backgroundColor: "#1a1b1e",
  borderColor: "rgba(255,255,255,0.12)",
  borderWidth: 1,
  titleColor: "#ececee",
  bodyColor: "#c3c5cb",
  titleFont: { family: SANS, size: 12, weight: "600" },
  bodyFont: { family: MONO, size: 12 },
  padding: 10,
  cornerRadius: 8,
  boxPadding: 4,
};

function withAlpha(hex, alpha) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Chart.js (205 KB) is only needed on the pages that draw a chart, so it is fetched the first time one of them mounts instead of
// blocking every page's first paint from index.html.
let chartLoad = null;
function ensureChart() {
  if (typeof window.Chart !== "undefined") return Promise.resolve(window.Chart);
  chartLoad ||= new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = new URL("../../vendor/chart.umd.js", import.meta.url).href;
    el.onload = () => resolve(window.Chart);
    el.onerror = () => { chartLoad = null; el.remove(); reject(new Error("chart.js failed to load")); };
    document.head.appendChild(el);
  });
  return chartLoad;
}

function useChart(buildConfig, deps) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  // Create once, then UPDATE in place when the data changes -- destroying and
  // rebuilding on every live refresh would replay the intro animation and
  // flash the chart each time a new participant answers.
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    let off = false;
    const draw = () => {
      if (off || !canvasRef.current) return;
      const cfg = buildConfig();
      const chart = chartRef.current;
      if (chart && chart.config.type === cfg.type) {
        chart.data.labels = cfg.data.labels;
        cfg.data.datasets.forEach((ds, i) => {
          if (chart.data.datasets[i]) Object.assign(chart.data.datasets[i], ds);
          else chart.data.datasets[i] = ds;
        });
        chart.data.datasets.length = cfg.data.datasets.length;
        chart.update();
        return;
      }
      chartRef.current = new window.Chart(canvasRef.current, cfg);
    };
    if (typeof window.Chart !== "undefined") draw();
    else ensureChart().then(draw).catch(() => { /* no chart: the numbers next to it still show */ });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => () => { chartRef.current?.destroy(); chartRef.current = null; }, []);
  return canvasRef;
}

const axisTicks = { color: TICK_COLOR, font: { family: MONO, size: 10.5 } };

// A variant's own colour when it has one (the column is nullable and the builder leaves it empty), else the series palette.
const barColors = (colors, n) => Array.from({ length: n }, (_, i) => colors?.[i] || SERIES_COLORS[i % SERIES_COLORS.length]);

export function BarChart({ labels, data, colors, horizontal = false, height = 220, suffix = "%" }) {
  const ref = useChart(
    () => ({
      type: "bar",
      data: {
        labels,
        datasets: [{ data, backgroundColor: barColors(colors, data.length), borderRadius: 5, borderSkipped: false, maxBarThickness: 44 }],
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { ...tooltip, displayColors: false, callbacks: { label: (ctx) => `${ctx.formattedValue}${suffix}` } } },
        scales: {
          x: { grid: { color: horizontal ? GRID_COLOR : "transparent" }, border: { display: false }, ticks: axisTicks },
          y: { grid: { color: horizontal ? "transparent" : GRID_COLOR }, border: { display: false }, ticks: axisTicks },
        },
      },
    }),
    [JSON.stringify(labels), JSON.stringify(data), JSON.stringify(colors)]
  );
  return html`<div style=${{ height: `${height}px` }}><canvas ref=${ref}></canvas></div>`;
}

/** A thin ring with a readout in its hole and a two-column legend underneath (HTML, so the labels
 * stay in the text face and wrap cleanly). `center` = { value?, label }: value defaults to the sum. */
export function DonutChart({ labels, data, colors, height = 190, center }) {
  const total = data.reduce((a, b) => a + (b || 0), 0);
  const ref = useChart(
    () => ({
      type: "doughnut",
      // nothing to show yet: one quiet, inert ring instead of an empty canvas
      data: { labels, datasets: [{ data: total ? data : [1], backgroundColor: total ? colors : ["#26282d"], borderWidth: 0, borderRadius: total ? 4 : 0, spacing: total ? 3 : 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "76%",
        plugins: { legend: { display: false }, tooltip: { ...tooltip, displayColors: false, enabled: total > 0 } },
      },
    }),
    [JSON.stringify(labels), JSON.stringify(data)]
  );
  return html`
    <div class="sk-donut">
      <div class="sk-donut-ring" style=${{ height: `${height}px` }}>
        <canvas ref=${ref}></canvas>
        ${center && html`
          <div class="sk-donut-center">
            <div class="sk-donut-value sk-num">${center.value ?? total}</div>
            <div class="sk-caption">${center.label}</div>
          </div>
        `}
      </div>
      <ul class="sk-legend">
        ${labels.map((label, i) => html`
          <li key=${i}><i style=${{ background: colors[i] }}></i><span>${label}</span><b class="sk-num">${data[i] ?? 0}</b></li>
        `)}
      </ul>
    </div>
  `;
}

export function LineChart({ labels, data, color = SERIES_COLORS[0], height = 220, fill = true }) {
  const ref = useChart(
    () => ({
      type: "line",
      data: {
        labels,
        datasets: [{
          data,
          borderColor: color,
          borderWidth: 2,
          tension: 0.35,
          fill,
          // the area under the line fades out toward the axis
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            const area = chart.chartArea;
            if (!area) return "transparent";
            const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, withAlpha(color, 0.26));
            g.addColorStop(1, withAlpha(color, 0));
            return g;
          },
          pointRadius: 0,
          pointHoverRadius: 4.5,
          pointHoverBackgroundColor: "#0e0e10",
          pointHoverBorderColor: color,
          pointHoverBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip: { ...tooltip, displayColors: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { ...axisTicks, maxRotation: 0, autoSkip: true } },
          y: { grid: { color: GRID_COLOR }, border: { display: false }, ticks: { ...axisTicks, precision: 0 }, beginAtZero: true },
        },
      },
    }),
    [JSON.stringify(labels), JSON.stringify(data)]
  );
  return html`<div style=${{ height: `${height}px` }}><canvas ref=${ref}></canvas></div>`;
}
