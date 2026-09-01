/**
 * config.js
 * Configuración central del proyecto: ligas cubiertas, rutas a los datos
 * estáticos generados por el workflow diario, claves de localStorage y
 * parámetros ajustables del modelo (pesos, Kelly fraccionado, etc).
 *
 * Cambiar aquí NO requiere tocar el resto del código: todos los módulos
 * leen estos valores.
 */

const CONFIG = {
  // Competiciones cubiertas (códigos de football-data.org v4).
  // "Varias grandes ligas europeas" — top 5 ligas domésticas.
  competitions: [
    { code: "PL", name: "Premier League", country: "Inglaterra" },
    { code: "PD", name: "LaLiga", country: "España" },
    { code: "SA", name: "Serie A", country: "Italia" },
    { code: "BL1", name: "Bundesliga", country: "Alemania" },
    { code: "FL1", name: "Ligue 1", country: "Francia" },
  ],

  // Rutas a los ficheros JSON estáticos (generados por
  // .github/workflows/update-data.yml una vez al día). El front-end
  // nunca llama directamente a la API externa: ver README §4.
  data: {
    matchesToday: "data/matches-today.json",
    eloRatings: "data/elo-ratings.json",
    pastSeasonValidation: "data/past-season-validation.json",
    seasonHistory: "data/season-history.json", // resultados ya jugados esta temporada
  },

  // Claves de localStorage (todo lo relativo al usuario vive en el navegador)
  storage: {
    virtualBalance: "ffa_virtual_balance",
    betHistory: "ffa_bet_history",
    startingBalance: "ffa_starting_balance",
  },

  // --- Parámetros del modelo Poisson + Elo ---
  model: {
    startingElo: 1500,
    kFactor: 24, // sensibilidad del ajuste Elo tras cada partido
    homeAdvantageElo: 60, // puntos Elo añadidos al local antes de calcular la probabilidad esperada
    recentFormWeight: 0.6, // peso de los últimos 6 partidos frente a la media de temporada (0-1)
    recentFormWindow: 6,
    h2hWeight: 0.15, // peso del ajuste por enfrentamientos directos recientes
    h2hWindow: 5,
    maxGoalsGrid: 8, // goles máximos considerados en la matriz de Poisson (0..8 por equipo)
    leagueAvgGoalsFallback: 1.35, // goles/partido de referencia si un equipo no tiene histórico suficiente
  },

  // --- Parámetros de value betting y Kelly fraccionado ---
  betting: {
    minEdgeToFlag: 0.03, // EV mínimo (3%) para considerar un pick como "de valor"
    kellyFraction: 0.25, // Kelly cuarto — reduce varianza frente a Kelly puro
    maxStakePct: 0.05, // tope de seguridad: nunca sugerir más del 5% del saldo en un pick
    minConfidenceGamesForFullKelly: 15, // partidos jugados por ambos equipos para confiar plenamente en el modelo
    startingVirtualBalance: 1000,
  },
};

// Congelado para evitar mutaciones accidentales desde otros módulos.
Object.freeze(CONFIG.competitions);
Object.freeze(CONFIG.data);
Object.freeze(CONFIG.storage);
Object.freeze(CONFIG.model);
Object.freeze(CONFIG.betting);

if (typeof module !== "undefined" && module.exports) {
  module.exports = CONFIG;
}
