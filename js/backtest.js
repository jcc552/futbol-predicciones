/**
 * backtest.js
 * Simulación "walk-forward": para cada partido de una lista cronológica,
 * el modelo se entrena SOLO con los partidos anteriores a ese partido
 * (nunca con datos futuros — evita fuga de información, el error más
 * común al "validar" un modelo deportivo). Se compara contra:
 *
 *   - Estrategia aleatoria (elige 1/X/2 al azar)
 *   - Estrategia "favorito" (apuesta siempre a la cuota más baja del mercado)
 *   - Modelo Poisson + Elo (esta web)
 *
 * Y para el staking:
 *   - Kelly fraccionado (kelly.js)
 *   - Stake fijo (misma cantidad en cada pick)
 *   - Stake aleatorio (dentro de un rango razonable)
 *
 * NOTA: requiere que cada partido tenga odds reales asociadas (odds.home/
 * odds.draw/odds.away) para poder calcular EV, ROI y probabilidad implícita.
 * Si un partido no tiene cuotas registradas, se excluye de las métricas de
 * apuestas (pero sí cuenta para el % de acierto puro del modelo).
 */

if (typeof require !== "undefined" && typeof module !== "undefined") {
  if (typeof CONFIG === "undefined") globalThis.CONFIG = require("./config.js");
  if (typeof Predictor === "undefined") globalThis.Predictor = require("./predictor.js");
  if (typeof Kelly === "undefined") globalThis.Kelly = require("./kelly.js");
}

const Backtest = {
  /**
   * matches: partidos cronológicos de UNA competición, cada uno con
   *   { date, homeTeam, awayTeam, homeGoals, awayGoals, odds?: {home,draw,away} }
   * minHistory: nº mínimo de partidos previos antes de empezar a evaluar
   *   (evita evaluar las primeras jornadas sin datos de forma).
   */
  walkForward(matches, minHistory = 40) {
    const sorted = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date));
    const rows = [];

    for (let idx = minHistory; idx < sorted.length; idx++) {
      const match = sorted[idx];
      const history = sorted.slice(0, idx); // solo pasado — sin fuga de datos

      const context = Predictor.buildContext(history);
      const pred = Predictor.predict(context, match.homeTeam, match.awayTeam);

      const actual =
        match.homeGoals > match.awayGoals ? "1" : match.homeGoals < match.awayGoals ? "2" : "X";

      const modelPick =
        pred.home >= pred.draw && pred.home >= pred.away
          ? "1"
          : pred.away >= pred.draw
          ? "2"
          : "X";

      rows.push({
        date: match.date,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        actual,
        modelPick,
        modelCorrect: modelPick === actual,
        probs: { "1": pred.home, X: pred.draw, "2": pred.away },
        odds: match.odds || null,
        eloHome: pred.eloHome,
        eloAway: pred.eloAway,
        gamesPlayedBothTeams: pred.gamesPlayedBothTeams,
      });
    }
    return rows;
  },

  /**
   * A partir de las filas de walkForward(), simula el resultado de apostar
   * con las tres estrategias de SELECCIÓN y las tres de STAKE, solo en los
   * partidos que tienen odds registradas.
   */
  simulateStrategies(rows, startingBalance = 1000) {
    const withOdds = rows.filter((r) => r.odds);

    const strategies = {
      modelo: { balance: startingBalance, wins: 0, bets: 0, curve: [] },
      favorito: { balance: startingBalance, wins: 0, bets: 0, curve: [] },
      aleatorio: { balance: startingBalance, wins: 0, bets: 0, curve: [] },
    };

    const stakeStrategies = {
      kelly: { balance: startingBalance, curve: [] },
      fijo: { balance: startingBalance, curve: [] },
      aleatorioStake: { balance: startingBalance, curve: [] },
    };

    const flatStake = startingBalance * 0.02; // 2% fijo de referencia

    withOdds.forEach((r) => {
      const oddsMap = { "1": r.odds.home, X: r.odds.draw, "2": r.odds.away };

      // --- Selección: modelo (pick del modelo) ---
      this._applyBet(strategies.modelo, r.modelPick, r.actual, oddsMap, flatStake);

      // --- Selección: favorito (menor cuota del mercado) ---
      const favoritePick = Object.entries(oddsMap).sort((a, b) => a[1] - b[1])[0][0];
      this._applyBet(strategies.favorito, favoritePick, r.actual, oddsMap, flatStake);

      // --- Selección: aleatorio ---
      const randomPick = ["1", "X", "2"][Math.floor(Math.random() * 3)];
      this._applyBet(strategies.aleatorio, randomPick, r.actual, oddsMap, flatStake);

      // --- Staking (todas usan la selección del modelo, comparando solo el stake) ---
      const p = r.probs[r.modelPick];
      const odds = oddsMap[r.modelPick];

      const kellyResult = Kelly.suggestedStake({
        probability: p,
        decimalOdds: odds,
        balance: stakeStrategies.kelly.balance,
        gamesPlayedBothTeams: r.gamesPlayedBothTeams,
      });
      this._applyStake(stakeStrategies.kelly, kellyResult.stake, r.modelPick, r.actual, odds);
      this._applyStake(stakeStrategies.fijo, flatStake, r.modelPick, r.actual, odds);
      this._applyStake(
        stakeStrategies.aleatorioStake,
        flatStake * (0.5 + Math.random()),
        r.modelPick,
        r.actual,
        odds
      );
    });

    return { strategies, stakeStrategies, sampleSize: withOdds.length };
  },

  _applyBet(strategy, pick, actual, oddsMap, stake) {
    strategy.bets++;
    if (pick === actual) {
      strategy.wins++;
      strategy.balance += stake * (oddsMap[pick] - 1);
    } else {
      strategy.balance -= stake;
    }
    strategy.curve.push(+strategy.balance.toFixed(2));
  },

  _applyStake(strategy, stake, pick, actual, odds) {
    if (stake <= 0) {
      strategy.curve.push(+strategy.balance.toFixed(2));
      return;
    }
    if (pick === actual) {
      strategy.balance += stake * (odds - 1);
    } else {
      strategy.balance -= stake;
    }
    strategy.curve.push(+strategy.balance.toFixed(2));
  },

  /** % de acierto puro del modelo (independiente de si había odds) */
  accuracy(rows) {
    if (rows.length === 0) return 0;
    return rows.filter((r) => r.modelCorrect).length / rows.length;
  },

  /**
   * Intervalo de confianza aproximado (95%, normal) para una proporción
   * de aciertos p sobre n intentos:
   *      IC = p ± 1.96 × sqrt(p(1-p)/n)
   * Aproximación válida para n moderado/grande (>30); para muestras muy
   * pequeñas subestima la incertidumbre real (ver limitaciones en README).
   */
  confidenceInterval(p, n) {
    if (n === 0) return { low: 0, high: 0 };
    const margin = 1.96 * Math.sqrt((p * (1 - p)) / n);
    return { low: Math.max(0, p - margin), high: Math.min(1, p + margin) };
  },

  roi(finalBalance, startingBalance, totalStaked) {
    if (totalStaked === 0) return 0;
    return (finalBalance - startingBalance) / totalStaked;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = Backtest;
}
