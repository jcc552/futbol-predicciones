/**
 * kelly.js
 * Stake sugerido mediante el Criterio de Kelly fraccionado.
 *
 * Kelly puro (fracción del bankroll a apostar) para una apuesta con
 * cuota decimal "o" y probabilidad estimada por el modelo "p":
 *
 *      b = o - 1                    (ganancia neta por unidad apostada)
 *      f* = (b·p - (1-p)) / b       (fracción óptima del bankroll, Kelly puro)
 *
 * f* puede ser muy volátil y agresivo si el modelo tiene error de
 * estimación (que siempre lo tiene). Por eso se usa "Kelly fraccionado":
 *
 *      f_sugerida = f* × kellyFraction × factorConfianza
 *
 * donde:
 *   - kellyFraction (CONFIG.betting.kellyFraction): reduce Kelly puro a un
 *     cuarto por defecto, práctica estándar para amortiguar el riesgo de
 *     un modelo imperfecto.
 *   - factorConfianza: entre 0 y 1, según cuántos partidos de histórico
 *     respaldan la estimación de ambos equipos (menos partidos → menos
 *     confianza → stake menor, aunque el EV calculado sea alto).
 *
 * El resultado se acota además a CONFIG.betting.maxStakePct del saldo
 * como tope de seguridad, y nunca es negativo (si f* < 0, no hay valor
 * y no se sugiere stake).
 */

if (typeof require !== "undefined" && typeof module !== "undefined" && typeof CONFIG === "undefined") {
  globalThis.CONFIG = require("./config.js");
}

const Kelly = {
  pureFraction(probability, decimalOdds) {
    const b = decimalOdds - 1;
    if (b <= 0) return 0;
    const f = (b * probability - (1 - probability)) / b;
    return f;
  },

  /**
   * gamesPlayedBothTeams: mínimo de partidos jugados entre local y
   * visitante en el histórico usado por el modelo — cuantos menos
   * partidos, menor el factor de confianza.
   */
  confidenceFactor(gamesPlayedBothTeams) {
    const threshold = CONFIG.betting.minConfidenceGamesForFullKelly;
    return Math.min(Math.max(gamesPlayedBothTeams / threshold, 0.25), 1);
  },

  /**
   * Devuelve el stake sugerido en unidades monetarias (saldo virtual),
   * junto con los valores intermedios para mostrar transparencia al
   * usuario (fracción pura, fracción fraccionada, factor de confianza).
   */
  suggestedStake({ probability, decimalOdds, balance, gamesPlayedBothTeams }) {
    const pureF = this.pureFraction(probability, decimalOdds);
    if (pureF <= 0) {
      return { stake: 0, pureFraction: pureF, adjustedFraction: 0, confidence: 0 };
    }

    const confidence = this.confidenceFactor(gamesPlayedBothTeams);
    let adjustedFraction = pureF * CONFIG.betting.kellyFraction * confidence;
    adjustedFraction = Math.min(adjustedFraction, CONFIG.betting.maxStakePct);

    const stake = +(balance * adjustedFraction).toFixed(2);
    return { stake, pureFraction: pureF, adjustedFraction, confidence };
  },

  /** Valor esperado (EV) de la apuesta, en tanto por uno. */
  expectedValue(probability, decimalOdds) {
    return probability * decimalOdds - 1;
  },

  /** Probabilidad implícita en una cuota decimal (sin quitar el margen de la casa). */
  impliedProbability(decimalOdds) {
    return 1 / decimalOdds;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = Kelly;
}
