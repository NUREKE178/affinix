import { html, useRef, useEffect } from "../lib/preact.js";

const GRID_COLOR = "rgba(148,163,184,0.12)";
const TICK_COLOR = "#94a3b8";

function useChart(buildConfig, deps) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  // Create once, then UPDATE in place when the data changes -- destroying and
  // rebuilding on every live refresh would replay the intro animation and
  // flash the chart each time a new participant answers.
  useEffect(() => {
    if (!canvasRef.current || typeof window.Chart === "undefined") return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => () => { chartRef.current?.destroy(); chartRef.current = null; }, []);
  return canvasRef;
}

export function BarChart({ labels, data, colors, horizontal = false, height = 220, suffix = "%" }) {
  const ref = useChart(
    () => ({
      type: "bar",
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderRadius: 6, maxBarThickness: 46 }],
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.formattedValue}${suffix}` } } },
        scales: {
          x: { grid: { color: horizontal ? GRID_COLOR : "transparent" }, ticks: { color: TICK_COLOR } },
          y: { grid: { color: horizontal ? "transparent" : GRID_COLOR }, ticks: { color: TICK_COLOR } },
        },
      },
    }),
    [JSON.stringify(labels), JSON.stringify(data)]
  );
  return html`<div class="sk-display rounded-lg p-3" style=${{ height: `${height}px` }}><canvas ref=${ref}></canvas></div>`;
}

export function DonutChart({ labels, data, colors, height = 220 }) {
  const ref = useChart(
    () => ({
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: { legend: { position: "bottom", labels: { color: TICK_COLOR, boxWidth: 10, padding: 12, font: { size: 11 } } } },
      },
    }),
    [JSON.stringify(labels), JSON.stringify(data)]
  );
  return html`<div class="sk-display rounded-lg p-3" style=${{ height: `${height}px` }}><canvas ref=${ref}></canvas></div>`;
}

export function LineChart({ labels, data, color = "#6366f1", height = 220, fill = true }) {
  const ref = useChart(
    () => ({
      type: "line",
      data: {
        labels,
        datasets: [{
          data, borderColor: color, backgroundColor: `${color}22`, fill, tension: 0.35,
          pointRadius: 0, pointHoverRadius: 4, borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: TICK_COLOR, maxRotation: 0, autoSkip: true } },
          y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR }, beginAtZero: true },
        },
      },
    }),
    [JSON.stringify(labels), JSON.stringify(data)]
  );
  return html`<div class="sk-display rounded-lg p-3" style=${{ height: `${height}px` }}><canvas ref=${ref}></canvas></div>`;
}
