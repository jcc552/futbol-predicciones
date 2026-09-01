/**
 * picks.js
 * Lógica específica de picks.html: para cada partido del día, ejecuta el
 * modelo (predictor.js), compara la probabilidad estimada contra la
 * probabilidad implícita en la cuota ofrecida, y marca como "apuesta de
 * valor" aquellas con EV >= CONFIG.betting.minEdgeToFlag. Para cada pick
 * de valor calcula el stake sugerido (Kelly fraccionado) y permite al
 * usuario aceptar, modificar o ignorar, siempre con saldo virtual.
 */

const PicksPage = {
  contextsByCompetition: new Map(),

  async init() {
    const list = document.getElementById("picks-list");
    const balanceEl = document.getElementById("virtual-balance");
    const emptyState = document.getElementById("picks-empty");

    balanceEl.textContent = Fmt.currency(Storage.getBalance());

    const { matches } = await DataAPI.getMatchesToday();
    if (!matches || matches.length === 0) {
      emptyState.style.display = "block";
      list.innerHTML = "";
      return;
    }

    const picks = await this.computePicks(matches);
    this.render(picks);
  },

  async computePicks(matches) {
    const results = [];

    for (const match of matches) {
      if (match.status !== "SCHEDULED") continue; // solo partidos aún no jugados
      if (!match.odds) continue; // sin cuotas no se puede calcular EV

      let context = this.contextsByCompetition.get(match.competition);
      if (!context) {
        const history = await DataAPI.getFullHistoryForCompetition(match.competition);
        context = Predictor.buildContext(history);
        this.contextsByCompetition.set(match.competition, context);
      }

      const pred = Predictor.predict(context, match.homeTeam, match.awayTeam);
      const markets = [
        { key: "1", label: match.homeTeam, prob: pred.home, odds: match.odds.home },
        { key: "X", label: "Empate", prob: pred.draw, odds: match.odds.draw },
        { key: "2", label: match.awayTeam, prob: pred.away, odds: match.odds.away },
      ];

      markets.forEach((m) => {
        const ev = Kelly.expectedValue(m.prob, m.odds);
        if (ev >= CONFIG.betting.minEdgeToFlag) {
          const kelly = Kelly.suggestedStake({
            probability: m.prob,
            decimalOdds: m.odds,
            balance: Storage.getBalance(),
            gamesPlayedBothTeams: pred.gamesPlayedBothTeams,
          });
          results.push({
            matchId: match.id,
            competition: match.competition,
            competitionName: this.competitionName(match.competition),
            home: match.homeTeam,
            away: match.awayTeam,
            kickoff: match.utcDate,
            market: m.key,
            marketLabel: m.label,
            odds: m.odds,
            modelProbability: m.prob,
            impliedProbability: Kelly.impliedProbability(m.odds),
            expectedValue: ev,
            eloHome: pred.eloHome,
            eloAway: pred.eloAway,
            kellyStakeSuggested: kelly.stake,
            confidence: kelly.confidence,
          });
        }
      });
    }

    return results.sort((a, b) => b.expectedValue - a.expectedValue);
  },

  competitionName(code) {
    return CONFIG.competitions.find((c) => c.code === code)?.name ?? code;
  },

  render(picks) {
    const list = document.getElementById("picks-list");
    const emptyState = document.getElementById("picks-empty");
    list.innerHTML = "";

    if (picks.length === 0) {
      emptyState.style.display = "block";
      return;
    }
    emptyState.style.display = "none";

    picks.forEach((pick) => list.appendChild(this.renderCard(pick)));
  },

  renderCard(pick) {
    const card = document.createElement("article");
    card.className = "pick-card";
    const evPct = Fmt.pct(pick.expectedValue);

    card.innerHTML = `
      <div class="pick-card-head">
        <div>
          <div class="pick-teams">${pick.home} — ${pick.away}</div>
          <div class="pick-league">${pick.competitionName} · ${Fmt.time(pick.kickoff)}</div>
        </div>
        <span class="ev-badge positive">Valor: ${pick.marketLabel} · EV ${evPct}</span>
      </div>

      <div class="pick-grid">
        <div class="metric"><div class="v">${pick.odds.toFixed(2)}</div><div class="l">Cuota</div></div>
        <div class="metric"><div class="v">${Fmt.pct(pick.modelProbability)}</div><div class="l">Prob. modelo</div></div>
        <div class="metric"><div class="v">${Fmt.pct(pick.impliedProbability)}</div><div class="l">Prob. implícita</div></div>
        <div class="metric"><div class="v">${Math.round(pick.eloHome)}</div><div class="l">Elo local</div></div>
        <div class="metric"><div class="v">${Math.round(pick.eloAway)}</div><div class="l">Elo visitante</div></div>
        <div class="metric"><div class="v">${Fmt.pct(pick.confidence, 0)}</div><div class="l">Confianza</div></div>
      </div>

      <div class="stake-row">
        <label>Stake sugerido (Kelly ¼)</label>
        <input type="number" min="0" step="0.5" value="${pick.kellyStakeSuggested}" class="stake-input" />
        <button class="btn accept-btn">Aceptar apuesta simulada</button>
        <button class="btn ghost ignore-btn">Ignorar</button>
      </div>
    `;

    const stakeInput = card.querySelector(".stake-input");
    const acceptBtn = card.querySelector(".accept-btn");
    const ignoreBtn = card.querySelector(".ignore-btn");

    acceptBtn.addEventListener("click", () => {
      const stake = parseFloat(stakeInput.value);
      if (!stake || stake <= 0) return;
      if (stake > Storage.getBalance()) {
        alert("El stake supera tu saldo virtual disponible.");
        return;
      }
      Storage.placeBet({ ...pick, stake });
      document.getElementById("virtual-balance").textContent = Fmt.currency(Storage.getBalance());
      acceptBtn.disabled = true;
      acceptBtn.textContent = "Apuesta registrada";
      stakeInput.disabled = true;
    });

    ignoreBtn.addEventListener("click", () => {
      card.style.opacity = "0.45";
      acceptBtn.disabled = true;
      ignoreBtn.disabled = true;
      ignoreBtn.textContent = "Ignorado";
    });

    return card;
  },
};

document.addEventListener("DOMContentLoaded", () => PicksPage.init());
