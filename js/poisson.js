/**
 * poisson.js
 * Modelo de distribución de Poisson para predicción de resultados de fútbol.
 *
 * METODOLOGÍA (ver también README.md §Metodología):
 *
 * 1) Goles esperados (λ) de cada equipo se calculan combinando:
 *      - Fuerza ofensiva/defensiva propia como local o visitante por separado
 *        (un equipo NO tiene el mismo λ jugando en casa que fuera).
 *      - Media de goles a favor/en contra ponderada, dando más peso a los
 *        partidos recientes (CONFIG.model.recentFormWeight).
 *      - Fuerza relativa del rival, vía el rating Elo (ver elo.js).
 *      - Ajuste por enfrentamientos directos recientes (H2H).
 *
 * 2) Con λ_local y λ_visitante se construye la distribución de Poisson
 *    para cada equipo y se cruzan en una matriz P(goles_local = i, goles_visitante = j)
 *    asumiendo independencia entre ambos marcadores (simplificación estándar
 *    en los modelos tipo Dixon-Coles sin el término de corrección de bajo scoring;
 *    ver limitaciones en el README).
 *
 * 3) Sumando las celdas de la matriz se obtiene P(1), P(X), P(2) y la
 *    probabilidad de cualquier marcador exacto.
 *
 * Fórmula de Poisson:
 *      P(X = k) = (λ^k · e^-λ) / k!
 */

if (typeof require !== "undefined" && typeof module !== "undefined" && typeof CONFIG === "undefined") {
  globalThis.CONFIG = require("./config.js");
}

const Poisson = {
  /** Factorial simple (k pequeño, sin necesidad de optimizar) */
  factorial(k) {
    let r = 1;
    for (let i = 2; i <= k; i++) r *= i;
    return r;
  },

  /** P(X = k) para una Poisson de media lambda */
  probability(lambda, k) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / this.factorial(k);
  },

  /**
   * Calcula los goles esperados (λ) para el equipo local y el visitante.
   *
   * team.attackHome / team.defenseHome / team.attackAway / team.defenseAway
   * son "fuerzas" relativas a la media de la liga (1.0 = media de la liga).
   * eloAdjustment es un multiplicador derivado de la diferencia Elo entre
   * ambos equipos (ver Elo.expectedGoalMultiplier).
   *
   * λ_local = mediaGolesLiga × ataqueLocal.local × defensaVisitante.fuera × ajusteElo × ajusteH2H
   * λ_visitante = mediaGolesLiga × ataqueVisitante.fuera × defensaLocal.local × (1/ajusteElo) × ajusteH2H
   */
  expectedGoals({ leagueAvgGoals, home, away, eloMultiplier, h2hMultiplier }) {
    const lambdaHome =
      leagueAvgGoals *
      home.attackHome *
      away.defenseAway *
      eloMultiplier *
      h2hMultiplier.home;

    const lambdaAway =
      leagueAvgGoals *
      away.attackAway *
      home.defenseHome *
      (1 / eloMultiplier) *
      h2hMultiplier.away;

    // Cotas de seguridad: un λ de 0 o negativo, o desproporcionado,
    // indicaría datos insuficientes; se acota a un rango razonable.
    return {
      lambdaHome: Math.min(Math.max(lambdaHome, 0.15), 4.5),
      lambdaAway: Math.min(Math.max(lambdaAway, 0.15), 4.5),
    };
  },

  /**
   * Construye la matriz de probabilidades conjuntas P(i goles local, j goles visitante)
   * para i, j en [0, maxGoals].
   */
  scoreMatrix(lambdaHome, lambdaAway, maxGoals = CONFIG.model.maxGoalsGrid) {
    const matrix = [];
    for (let i = 0; i <= maxGoals; i++) {
      const row = [];
      const pHomeI = this.probability(lambdaHome, i);
      for (let j = 0; j <= maxGoals; j++) {
        row.push(pHomeI * this.probability(lambdaAway, j));
      }
      matrix.push(row);
    }
    return matrix;
  },

  /**
   * A partir de la matriz de marcadores, devuelve P(1), P(X), P(2) y el
   * marcador más probable.
   */
  outcomeProbabilities(matrix) {
    let pHome = 0, pDraw = 0, pAway = 0;
    let bestScore = { i: 0, j: 0, p: -1 };

    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        const p = matrix[i][j];
        if (i > j) pHome += p;
        else if (i === j) pDraw += p;
        else pAway += p;
        if (p > bestScore.p) bestScore = { i, j, p };
      }
    }

    // Normalización: la matriz truncada a maxGoalsGrid no suma exactamente 1.
    const total = pHome + pDraw + pAway;
    return {
      home: pHome / total,
      draw: pDraw / total,
      away: pAway / total,
      mostLikelyScore: `${bestScore.i}-${bestScore.j}`,
      mostLikelyScoreProb: bestScore.p / total,
    };
  },

  /**
   * Predicción completa 1X2 + marcador más probable para un partido.
   */
  predictMatch(input) {
    const { lambdaHome, lambdaAway } = this.expectedGoals(input);
    const matrix = this.scoreMatrix(lambdaHome, lambdaAway);
    const outcome = this.outcomeProbabilities(matrix);
    return { lambdaHome, lambdaAway, ...outcome };
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = Poisson;
}
