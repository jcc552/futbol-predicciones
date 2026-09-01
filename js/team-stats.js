/**
 * team-stats.js
 * Calcula, a partir del histórico de partidos de un equipo, sus fuerzas
 * ofensivas y defensivas como local y como visitante (por separado),
 * dando más peso a los partidos recientes, y el multiplicador por
 * enfrentamientos directos (H2H) recientes entre dos equipos concretos.
 *
 * "Fuerza" = (goles marcados o encajados por el equipo) / (media de la liga).
 * 1.0 = rinde como la media de la liga; 1.3 = un 30% mejor que la media, etc.
 */

if (typeof require !== "undefined" && typeof module !== "undefined" && typeof CONFIG === "undefined") {
  globalThis.CONFIG = require("./config.js");
}

const TeamStats = {
  /**
   * matches: histórico completo de la competición, cada partido con
   *   { date, homeTeam, awayTeam, homeGoals, awayGoals }
   * Devuelve un Map equipo -> { attackHome, defenseHome, attackAway, defenseAway }
   */
  buildStrengths(matches, leagueAvgGoals) {
    const byTeam = new Map();

    const ensure = (team) => {
      if (!byTeam.has(team)) {
        byTeam.set(team, { homeGames: [], awayGames: [] });
      }
      return byTeam.get(team);
    };

    matches.forEach((m) => {
      ensure(m.homeTeam).homeGames.push({ date: m.date, scored: m.homeGoals, conceded: m.awayGoals });
      ensure(m.awayTeam).awayGames.push({ date: m.date, scored: m.awayGoals, conceded: m.homeGoals });
    });

    const strengths = new Map();
    byTeam.forEach((data, team) => {
      strengths.set(team, {
        attackHome: this.weightedRatio(data.homeGames, "scored", leagueAvgGoals),
        defenseHome: this.weightedRatio(data.homeGames, "conceded", leagueAvgGoals),
        attackAway: this.weightedRatio(data.awayGames, "scored", leagueAvgGoals),
        defenseAway: this.weightedRatio(data.awayGames, "conceded", leagueAvgGoals),
      });
    });

    return strengths;
  },

  /**
   * Media ponderada: los partidos dentro de la "ventana reciente"
   * (CONFIG.model.recentFormWindow) pesan recentFormWeight en el total;
   * el resto de la temporada pesa (1 - recentFormWeight). Si un equipo
   * tiene pocos partidos, se usa CONFIG.model.leagueAvgGoalsFallback
   * como respaldo para no dividir por cero ni sobre-reaccionar a 1-2 partidos.
   */
  weightedRatio(games, field, leagueAvgGoals) {
    if (games.length === 0) return 1.0; // sin datos → asumir equipo "medio"

    const sorted = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
    const recentWindow = CONFIG.model.recentFormWindow;
    const recent = sorted.slice(-recentWindow);
    const older = sorted.slice(0, Math.max(0, sorted.length - recentWindow));

    const avg = (arr) =>
      arr.length ? arr.reduce((s, g) => s + g[field], 0) / arr.length : leagueAvgGoals;

    const recentAvg = avg(recent);
    const olderAvg = older.length ? avg(older) : recentAvg;

    const w = CONFIG.model.recentFormWeight;
    const blended = recent.length ? recentAvg * w + olderAvg * (1 - w) : leagueAvgGoals;

    // Si el equipo tiene muy pocos partidos jugados, se atenúa hacia la
    // media de liga (regresión a la media) para no fiarse de un rating
    // extremo con muestra pequeña.
    const sampleSize = games.length;
    const shrinkFactor = Math.min(sampleSize / CONFIG.model.recentFormWindow, 1);
    const ratio = blended / leagueAvgGoals;
    return shrinkFactor * ratio + (1 - shrinkFactor) * 1.0;
  },

  /**
   * Multiplicador por enfrentamientos directos recientes. Si en los últimos
   * H2H el local ha anotado más de lo esperado contra ese rival concreto,
   * se aplica un pequeño ajuste al alza (y viceversa). Se acota para que
   * nunca domine sobre Poisson+Elo (CONFIG.model.h2hWeight controla el peso).
   */
  headToHeadMultiplier(h2hMatches, homeTeam, awayTeam, leagueAvgGoals) {
    if (!h2hMatches || h2hMatches.length === 0) {
      return { home: 1, away: 1 };
    }

    const recent = [...h2hMatches]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, CONFIG.model.h2hWindow);

    let homeGoalsFor = 0, awayGoalsFor = 0, n = 0;
    recent.forEach((m) => {
      // Normaliza siempre a la perspectiva "homeTeam actual vs awayTeam actual",
      // aunque en el histórico jugaran en campo contrario.
      if (m.homeTeam === homeTeam) {
        homeGoalsFor += m.homeGoals;
        awayGoalsFor += m.awayGoals;
      } else {
        homeGoalsFor += m.awayGoals;
        awayGoalsFor += m.homeGoals;
      }
      n++;
    });

    const homeAvg = homeGoalsFor / n;
    const awayAvg = awayGoalsFor / n;
    const w = CONFIG.model.h2hWeight;

    const homeMult = 1 + w * ((homeAvg - leagueAvgGoals) / leagueAvgGoals);
    const awayMult = 1 + w * ((awayAvg - leagueAvgGoals) / leagueAvgGoals);

    // Acotado a ±15% para que el H2H sea un ajuste fino, no el factor dominante.
    return {
      home: Math.min(Math.max(homeMult, 0.85), 1.15),
      away: Math.min(Math.max(awayMult, 0.85), 1.15),
    };
  },

  /** Media de goles/partido de toda la competición (para normalizar fuerzas) */
  leagueAverageGoals(matches) {
    if (matches.length === 0) return CONFIG.model.leagueAvgGoalsFallback;
    const total = matches.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0);
    return total / (matches.length * 2);
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = TeamStats;
}
