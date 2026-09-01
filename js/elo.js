/**
 * elo.js
 * Rating Elo simplificado por equipo. Complementa a Poisson: mientras que
 * las medias de goles ponderadas capturan la forma reciente concreta
 * (cuántos goles mete/encaja), el Elo resume la FUERZA RELATIVA global del
 * equipo frente a todos sus rivales a lo largo de la temporada, de forma
 * más estable que mirar solo los últimos partidos.
 *
 * Fórmulas estándar de Elo adaptadas a fútbol (con posibilidad de empate):
 *
 *   Probabilidad esperada de que el local gane (antes de aplicar la ventaja
 *   de campo en puntos Elo):
 *       E_local = 1 / (1 + 10^((Elo_visitante - (Elo_local + ventajaCampo)) / 400))
 *
 *   Resultado real S (desde el punto de vista del local):
 *       S = 1   si gana el local
 *       S = 0.5 si empate
 *       S = 0   si gana el visitante
 *
 *   Actualización tras el partido:
 *       Elo_local'      = Elo_local      + K × (S      - E_local)
 *       Elo_visitante'  = Elo_visitante  + K × ((1-S)   - (1 - E_local))
 *
 * K (CONFIG.model.kFactor) controla cuánto pesa cada resultado nuevo.
 */

if (typeof require !== "undefined" && typeof module !== "undefined" && typeof CONFIG === "undefined") {
  globalThis.CONFIG = require("./config.js");
}

const Elo = {
  expectedScore(eloA, eloB, homeAdvantage = 0) {
    return 1 / (1 + Math.pow(10, (eloB - (eloA + homeAdvantage)) / 400));
  },

  /**
   * Actualiza el rating de ambos equipos tras un resultado real.
   * result: "H" (gana local), "D" (empate), "A" (gana visitante)
   */
  updateRatings(eloHome, eloAway, result, k = CONFIG.model.kFactor) {
    const expectedHome = this.expectedScore(eloHome, eloAway, CONFIG.model.homeAdvantageElo);
    const actualHome = result === "H" ? 1 : result === "D" ? 0.5 : 0;

    const newEloHome = eloHome + k * (actualHome - expectedHome);
    const newEloAway = eloAway + k * ((1 - actualHome) - (1 - expectedHome));

    return { eloHome: newEloHome, eloAway: newEloAway };
  },

  /**
   * Recalcula de forma secuencial el rating Elo de todos los equipos de una
   * competición a partir de una lista de partidos ORDENADA CRONOLÓGICAMENTE.
   * Se usa tanto para la validación contra la temporada pasada como para
   * mantener el rating actualizado partido a partido en la temporada en curso.
   *
   * matches: [{ homeTeam, awayTeam, homeGoals, awayGoals }, ...]
   * Devuelve un Map equipo -> rating final, y opcionalmente el histórico
   * completo si trackHistory=true (útil para el gráfico de evolución Elo).
   */
  runSeason(matches, { startingElo = CONFIG.model.startingElo, trackHistory = false } = {}) {
    const ratings = new Map();
    const history = []; // { date, team, elo }

    const getElo = (team) => ratings.get(team) ?? startingElo;

    matches.forEach((m) => {
      const eloHome = getElo(m.homeTeam);
      const eloAway = getElo(m.awayTeam);
      const result = m.homeGoals > m.awayGoals ? "H" : m.homeGoals < m.awayGoals ? "A" : "D";

      const { eloHome: newHome, eloAway: newAway } = this.updateRatings(eloHome, eloAway, result);
      ratings.set(m.homeTeam, newHome);
      ratings.set(m.awayTeam, newAway);

      if (trackHistory) {
        history.push({ date: m.date, team: m.homeTeam, elo: newHome });
        history.push({ date: m.date, team: m.awayTeam, elo: newAway });
      }
    });

    return { ratings, history };
  },

  /**
   * Traduce una diferencia de Elo en un MULTIPLICADOR de goles esperados a
   * aplicar sobre la λ de Poisson (no sustituye a Poisson, lo ajusta).
   * Se usa una función logística acotada para evitar multiplicadores
   * extremos con diferencias de Elo muy grandes.
   *
   *   diff = (Elo_local + ventajaCampo) - Elo_visitante
   *   multiplicador = 1 + tanh(diff / 400) × 0.4
   *
   * Con diff = 0 → multiplicador = 1 (sin ajuste).
   * Con diff grande a favor del local → hasta ×1.4 más goles esperados
   * para el local (y recíprocamente menos para el rival, ver poisson.js).
   */
  expectedGoalMultiplier(eloHome, eloAway) {
    const diff = (eloHome + CONFIG.model.homeAdvantageElo) - eloAway;
    return 1 + Math.tanh(diff / 400) * 0.4;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = Elo;
}
