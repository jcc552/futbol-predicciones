/**
 * home.js
 * Lógica de index.html: pinta el listado de partidos del día agrupados
 * por competición, con hora, cuotas y, si ya han finalizado, el resultado
 * real. También liquida automáticamente las apuestas simuladas pendientes
 * cuyo partido ya tiene resultado (Storage.settleBets).
 */

const HomePage = {
  async init() {
    const { matches, generatedAt } = await DataAPI.getMatchesToday();
    this.renderUpdatedAt(generatedAt);

    if (!matches || matches.length === 0) {
      document.getElementById("matches-container").innerHTML = "";
      document.getElementById("matches-empty").style.display = "block";
      return;
    }

    this.settleFinishedMatches(matches);
    this.renderHeroStats(matches);
    this.renderMatches(matches);
  },

  renderUpdatedAt(generatedAt) {
    const el = document.getElementById("updated-at");
    if (!el) return;
    el.textContent = generatedAt
      ? `Datos actualizados ${Fmt.dateLong(generatedAt)}, ${Fmt.time(generatedAt)}`
      : "Datos de ejemplo — pendiente de la primera actualización automática";
  },

  settleFinishedMatches(matches) {
    const resultsByMatchId = new Map();
    matches
      .filter((m) => m.status === "FINISHED")
      .forEach((m) => {
        const result =
          m.score.home > m.score.away ? "1" : m.score.home < m.score.away ? "2" : "X";
        resultsByMatchId.set(m.id, result);
      });
    if (resultsByMatchId.size > 0) Storage.settleBets(resultsByMatchId);
  },

  renderHeroStats(matches) {
    const scheduled = matches.filter((m) => m.status === "SCHEDULED").length;
    const finished = matches.filter((m) => m.status === "FINISHED").length;
    const competitions = new Set(matches.map((m) => m.competition)).size;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set("stat-scheduled", scheduled);
    set("stat-finished", finished);
    set("stat-competitions", competitions);
    set("stat-balance", Fmt.currency(Storage.getBalance()));
  },

  renderMatches(matches) {
    const container = document.getElementById("matches-container");
    container.innerHTML = "";

    const byCompetition = new Map();
    matches.forEach((m) => {
      if (!byCompetition.has(m.competition)) byCompetition.set(m.competition, []);
      byCompetition.get(m.competition).push(m);
    });

    CONFIG.competitions.forEach(({ code, name }) => {
      const group = byCompetition.get(code);
      if (!group || group.length === 0) return;

      const section = document.createElement("div");
      section.className = "competition-group";
      section.innerHTML = `<h3 class="competition-title">${name}</h3>`;

      group
        .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
        .forEach((m) => section.appendChild(this.renderMatchRow(m)));

      container.appendChild(section);
    });
  },

  renderMatchRow(m) {
    const row = document.createElement("div");
    row.className = "match-row";

    const isFinished = m.status === "FINISHED";
    const homeWon = isFinished && m.score.home > m.score.away;
    const awayWon = isFinished && m.score.away > m.score.home;

    row.innerHTML = `
      <div>
        <div class="match-time">${Fmt.time(m.utcDate)}</div>
        ${isFinished ? '<div class="match-status">Finalizado</div>' : ""}
      </div>
      <div class="match-teams">
        <span class="team ${homeWon ? "winner" : ""}">${m.homeTeam}</span>
        <span class="team ${awayWon ? "winner" : ""}">${m.awayTeam}</span>
      </div>
      ${
        isFinished
          ? `<div class="match-score">${m.score.home} – ${m.score.away}</div>`
          : this.renderOddsStrip(m.odds)
      }
    `;
    return row;
  },

  renderOddsStrip(odds) {
    if (!odds) return '<div class="text-muted small">Sin cuotas</div>';
    return `
      <div class="odds-strip">
        <div class="odds-chip"><span class="k">1</span>${odds.home.toFixed(2)}</div>
        <div class="odds-chip"><span class="k">X</span>${odds.draw.toFixed(2)}</div>
        <div class="odds-chip"><span class="k">2</span>${odds.away.toFixed(2)}</div>
      </div>
    `;
  },
};

document.addEventListener("DOMContentLoaded", () => HomePage.init());
