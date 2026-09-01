/**
 * charts.js
 * Helpers finos sobre Chart.js para mantener una configuración visual
 * coherente (colores de la paleta, tipografía, grid discreto) en todos
 * los gráficos del sitio sin repetir opciones en cada página.
 */

const ChartTheme = {
  colors: {
    amber: "#c9a227",
    brick: "#b5533c",
    chalk: "#edefea",
    muted: "#7c9086",
    line: "#2a3b2f",
    seriesA: "#c9a227",
    seriesB: "#7c9086",
    seriesC: "#b5533c",
  },

  baseOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: this.colors.chalk, font: { family: "Inter", size: 12 } },
        },
        tooltip: {
          backgroundColor: "#16241b",
          borderColor: this.colors.line,
          borderWidth: 1,
          titleColor: this.colors.chalk,
          bodyColor: this.colors.chalk,
        },
      },
      scales: {
        x: {
          ticks: { color: this.colors.muted, font: { family: "Inter", size: 11 } },
          grid: { color: this.colors.line },
        },
        y: {
          ticks: { color: this.colors.muted, font: { family: "Inter", size: 11 } },
          grid: { color: this.colors.line },
        },
      },
    };
  },

  lineChart(ctx, labels, datasets) {
    return new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: datasets.map((d, i) => ({
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.15,
          borderColor: d.color ?? Object.values(this.colors)[i % 3],
          backgroundColor: "transparent",
          ...d,
        })),
      },
      options: this.baseOptions(),
    });
  },

  barChart(ctx, labels, datasets) {
    return new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: datasets.map((d, i) => ({
          backgroundColor: d.color ?? Object.values(this.colors)[i % 3],
          borderRadius: 2,
          ...d,
        })),
      },
      options: this.baseOptions(),
    });
  },
};
