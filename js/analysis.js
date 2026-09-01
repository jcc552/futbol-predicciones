/**
 * analysis.js
 * Lógica de analysis.html:
 *   1) Muestra la validación PRECALCULADA contra la temporada pasada
 *      completa (generada por el workflow diario — ver scripts/update-data.js
 *      y data/past-season-validation.json), con % de acierto, ROI e
 *      intervalo de confianza.
 *   2) Ejecuta EN VIVO (en el navegador) el mismo backtesting walk-forward
 *      pero sobre los partidos ya jugados de la temporada ACTUAL, para
 *      comparar de forma continua modelo vs aleatorio vs favorito, y
 *      Kelly vs stake fijo vs stake aleatorio.
 *   3) Dibuja la evolución del rating Elo de los equipos más destacados.
 */

const AnalysisPage = {
  async init() {
    await this.renderPastSeasonValidation();
    await this.renderCurrentSeasonBacktest();
    await this.renderEloEvolution();
  },

  async renderPastSeasonValidation() {
    const data = await DataAPI.getPastSeasonValidation();
    const container = document.getElementById("past-validation");

    if (!data.bySeason || data.bySeason.length === 0) {
      container.innerHTML = `<p class="empty-state">
        Todavía no se ha ejecutado la validación inicial contra la temporada pasada.
        Se genera automáticamente en la primera ejecución del workflow diario
        (ver <code>scripts/update-data.js</code>).
      </p>`;
      return;
    }

    container.innerHTML = "";
    data.bySeason.forEach((season) => {
      const ci = Backtest.confidenceInterval(season.accuracy, season.sampleSize);
      const card = document.createElement("div");
      card.className = "method-card";
      card.style.marginBottom = "16px";
      card.innerHTML = `
        <h3>${this.competitionName(season.competition)} — temporada ${season.seasonLabel}</h3>
        <div class="pick-grid" style="border:none; padding:0;">
          <div class="metric"><div class="v">${Fmt.pct(season.accuracy)}</div><div class="l">Acierto 1X2</div></div>
          <div class="metric"><div class="v">${Fmt.pct(season.roi)}</div><div class="l">ROI (stake fijo 2%)</div></div>
          <div class="metric"><div class="v">${season.sampleSize}</div><div class="l">Partidos evaluados</div></div>
          <div class="metric"><div class="v">${Fmt.pct(ci.low)}–${Fmt.pct(ci.high)}</div><div class="l">IC 95% del acierto</div></div>
        </div>
      `;
      container.appendChild(card);
    });
  },

  async renderCurrentSeasonBacktest() {
    const statusEl = document.getElementById("live-backtest-status");
    statusEl.textContent = "Ejecutando validación sobre la temporada en curso…";

    const seasonHistory = await DataAPI.getSeasonHistory();
    const byCompetition = new Map();
    (seasonHistory.matches || []).forEach((m) => {
      if (!byCompetition.has(m.competition)) byCompetition.set(m.competition, []);
      byCompetition.get(m.competition).push(m);
    });

    let allRows = [];
    byCompetition.forEach((matches) => {
      if (matches.length < 45) return; // margen mínimo para minHistory=40
      allRows = allRows.concat(Backtest.walkForward(matches, 40));
    });

    if (allRows.length === 0) {
      statusEl.textContent =
        "Aún no hay suficientes partidos jugados esta temporada para una comparación en vivo fiable.";
      document.getElementById("strategy-comparison").innerHTML = "";
      return;
    }

    statusEl.textContent = `Comparación en vivo sobre ${allRows.length} partidos ya jugados esta temporada.`;

    const sim = Backtest.simulateStrategies(allRows, CONFIG.betting.startingVirtualBalance);
    this.renderStrategyTable(sim);
    this.renderStrategyChart(sim);
    this.renderAccuracyByCompetition(byCompetition);
  },

  renderAccuracyByCompetition(byCompetition) {
    const ctx = document.getElementById("accuracy-chart");
    if (!ctx) return;

    const labels = [];
    const values = [];
    byCompetition.forEach((matches, code) => {
      if (matches.length < 45) return;
      const rows = Backtest.walkForward(matches, 40);
      labels.push(this.competitionName(code));
      values.push(+(Backtest.accuracy(rows) * 100).toFixed(1));
    });
    if (labels.length === 0) return;

    ChartTheme.barChart(ctx, labels, [{ label: "% de acierto 1X2", data: values, color: ChartTheme.colors.amber }]);
  },

  renderStrategyTable(sim) {
    const container = document.getElementById("strategy-comparison");
    const rows = Object.entries(sim.strategies)
      .map(([name, s]) => {
        const acc = s.bets ? s.wins / s.bets : 0;
        const roiVal = s.bets ? (s.balance - CONFIG.betting.startingVirtualBalance) / (s.bets * (CONFIG.betting.startingVirtualBalance * 0.02)) : 0;
        return `<tr>
          <td>${this.strategyLabel(name)}</td>
          <td>${s.bets}</td>
          <td>${Fmt.pct(acc)}</td>
          <td class="${roiVal >= 0 ? "pos" : "neg"}">${Fmt.pct(roiVal)}</td>
          <td>${Fmt.currency(s.balance)}</td>
        </tr>`;
      })
      .join("");

    const stakeRows = Object.entries(sim.stakeStrategies)
      .map(([name, s]) => {
        const roiVal = (s.balance - CONFIG.betting.startingVirtualBalance) / CONFIG.betting.startingVirtualBalance;
        return `<tr>
          <td>${this.stakeLabel(name)}</td>
          <td class="${roiVal >= 0 ? "pos" : "neg"}">${Fmt.pct(roiVal)}</td>
          <td>${Fmt.currency(s.balance)}</td>
        </tr>`;
      })
      .join("");

    container.innerHTML = `
      <table class="data-table" style="margin-bottom:28px;">
        <caption>Elección del pick: modelo vs. favorito vs. aleatorio (stake fijo 2% en los tres casos)</caption>
        <thead><tr><th>Estrategia</th><th>Apuestas</th><th>% acierto</th><th>ROI</th><th>Saldo final simulado</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <table class="data-table">
        <caption>Criterio de stake, usando siempre el pick del modelo</caption>
        <thead><tr><th>Estrategia de stake</th><th>ROI</th><th>Saldo final simulado</th></tr></thead>
        <tbody>${stakeRows}</tbody>
      </table>
    `;
  },

  renderStrategyChart(sim) {
    const ctx = document.getElementById("strategy-chart");
    if (!ctx) return;
    const maxLen = Math.max(...Object.values(sim.strategies).map((s) => s.curve.length));
    const labels = Array.from({ length: maxLen }, (_, i) => i + 1);

    ChartTheme.lineChart(ctx, labels, [
      { label: "Modelo (Poisson+Elo)", data: sim.strategies.modelo.curve, color: ChartTheme.colors.amber },
      { label: "Favorito", data: sim.strategies.favorito.curve, color: ChartTheme.colors.muted },
      { label: "Aleatorio", data: sim.strategies.aleatorio.curve, color: ChartTheme.colors.brick },
    ]);
  },

  async renderEloEvolution() {
    const ctx = document.getElementById("elo-chart");
    if (!ctx) return;
    const seasonHistory = await DataAPI.getSeasonHistory();
    const matches = seasonHistory.matches || [];
    if (matches.length === 0) return;

    // Se toma la competición con más partidos jugados como muestra representativa.
    const counts = {};
    matches.forEach((m) => (counts[m.competition] = (counts[m.competition] || 0) + 1));
    const topCompetition = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!topCompetition) return;

    const compMatches = matches
      .filter((m) => m.competition === topCompetition)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const { history } = Elo.runSeason(compMatches, { trackHistory: true });

    // Los 4 equipos con el rating final más alto
    const finalRatings = new Map();
    history.forEach((h) => finalRatings.set(h.team, h.elo));
    const topTeams = [...finalRatings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0]);

    const byTeam = new Map(topTeams.map((t) => [t, []]));
    history.forEach((h) => {
      if (byTeam.has(h.team)) byTeam.get(h.team).push(h.elo);
    });

    const maxLen = Math.max(...[...byTeam.values()].map((v) => v.length));
    const labels = Array.from({ length: maxLen }, (_, i) => `J${i + 1}`);

    ChartTheme.lineChart(
      ctx,
      labels,
      topTeams.map((team, i) => ({
        label: team,
        data: byTeam.get(team),
        color: [ChartTheme.colors.amber, ChartTheme.colors.chalk, ChartTheme.colors.muted, ChartTheme.colors.brick][i],
      }))
    );
    document.getElementById("elo-chart-caption").textContent = `${this.competitionName(topCompetition)} — top 4 equipos por rating Elo actual`;
  },

  competitionName(code) {
    return CONFIG.competitions.find((c) => c.code === code)?.name ?? code;
  },
  strategyLabel(key) {
    return { modelo: "Modelo (Poisson + Elo)", favorito: "Apostar al favorito", aleatorio: "Selección aleatoria" }[key];
  },
  stakeLabel(key) {
    return { kelly: "Kelly fraccionado (¼)", fijo: "Stake fijo (2%)", aleatorioStake: "Stake aleatorio" }[key];
  },
};

document.addEventListener("DOMContentLoaded", () => AnalysisPage.init());
