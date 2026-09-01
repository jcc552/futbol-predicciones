/**
 * predictor.js
 * Punto de entrada único del modelo: dado el histórico de una competición
 * y un partido a predecir, calcula fuerzas de equipo (team-stats.js),
 * ratings Elo (elo.js) y ajuste H2H, y se los pasa a poisson.js para
 * obtener la predicción final 1X2.
 *
 * Se usa tanto para los partidos del día (picks.js) como para el
 * backtesting contra la temporada pasada (backtest.js), garantizando que
 * ambos usan exactamente la misma lógica de predicción.
 */

if (typeof require !== "undefined" && typeof module !== "undefined") {
  if (typeof CONFIG === "undefined") globalThis.CONFIG = require("./config.js");
  if (typeof TeamStats === "undefined") globalThis.TeamStats = require("./team-stats.js");
  if (typeof Elo === "undefined") globalThis.Elo = require("./elo.js");
  if (typeof Poisson === "undefined") globalThis.Poisson = require("./poisson.js");
}

const Predictor = {
  /**
   * Prepara el "contexto" de una competición una sola vez (fuerzas de
   * equipo + ratings Elo actuales) para no recalcularlo partido a partido
   * cuando se predicen varios partidos del mismo día/competición.
   *
   * history: partidos ya jugados, ordenados cronológicamente.
   */
  buildContext(history) {
    const leagueAvgGoals = TeamStats.leagueAverageGoals(history);
    const strengths = TeamStats.buildStrengths(history, leagueAvgGoals);
    const { ratings: eloRatings } = Elo.runSeason(history);
    return { leagueAvgGoals, strengths, eloRatings, history };
  },

  _gamesPlayed(history, team) {
    return history.filter((m) => m.homeTeam === team || m.awayTeam === team).length;
  },

  /**
   * Predice un partido concreto usando un contexto ya construido.
   * Devuelve probabilidades 1X2, λ de cada equipo, ratings Elo usados y
   * el número de partidos que respaldan la estimación (para Kelly).
   */
  predict(context, homeTeam, awayTeam) {
    const { leagueAvgGoals, strengths, eloRatings, history } = context;

    const home = strengths.get(homeTeam) ?? {
      attackHome: 1, defenseHome: 1, attackAway: 1, defenseAway: 1,
    };
    const away = strengths.get(awayTeam) ?? {
      attackHome: 1, defenseHome: 1, attackAway: 1, defenseAway: 1,
    };

    const eloHome = eloRatings.get(homeTeam) ?? CONFIG.model.startingElo;
    const eloAway = eloRatings.get(awayTeam) ?? CONFIG.model.startingElo;
    const eloMultiplier = Elo.expectedGoalMultiplier(eloHome, eloAway);

    const h2h = history.filter(
      (m) =>
        (m.homeTeam === homeTeam && m.awayTeam === awayTeam) ||
        (m.homeTeam === awayTeam && m.awayTeam === homeTeam)
    );
    const h2hMultiplier = TeamStats.headToHeadMultiplier(h2h, homeTeam, awayTeam, leagueAvgGoals);

    const prediction = Poisson.predictMatch({
      leagueAvgGoals,
      home,
      away,
      eloMultiplier,
      h2hMultiplier,
    });

    const gamesHome = this._gamesPlayed(history, homeTeam);
    const gamesAway = this._gamesPlayed(history, awayTeam);

    return {
      ...prediction,
      eloHome,
      eloAway,
      gamesPlayedBothTeams: Math.min(gamesHome, gamesAway),
    };
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = Predictor;
}
