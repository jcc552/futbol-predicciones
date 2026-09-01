/**
 * scripts/seed-sample-data.js
 * Genera datos de EJEMPLO realistas (equipos y resultados ficticios,
 * pero con la misma forma que produciría football-data.org) para que el
 * repositorio funcione visualmente desde el primer `git clone`, antes de
 * que las Secrets de la API estén configuradas y el workflow diario haya
 * corrido por primera vez. NO se usa en producción — el workflow diario
 * (scripts/update-data.js) sobrescribe estos ficheros con datos reales.
 *
 * Uso: node scripts/seed-sample-data.js
 */

const fs = require("fs");
const path = require("path");
const CONFIG = require("../js/config.js");
const Elo = require("../js/elo.js");
const Backtest = require("../js/backtest.js");

const DATA_DIR = path.join(__dirname, "..", "data");

const TEAMS_BY_COMPETITION = {
  PL: ["Northgate United", "Ashfield City", "Redbrook Athletic", "Millhaven FC", "Sancroft Town", "Eastwick Rovers", "Barrowmere FC", "Kingswell United"],
  PD: ["Costa Rojiblanca", "Atlético Vallenorte", "Real Sierraverde", "Unión Puertosol", "Deportivo Altamira", "CD Marisma", "Real Peñablanca", "Atlético Riofrío"],
  SA: ["Nerocelesti Torino", "Rossoblù Marina", "Biancoverde Colle", "Azzurra Portofino", "Granata Volterra", "Giallorossi Estense", "Viola Serrano", "Bianconeri Adriano"],
  BL1: ["SV Nordfeld", "Rheinstern 04", "Blau-Weiss Auental", "Grün-Gold Marktheim", "FC Waldkirchen", "TSV Bergwehr", "Rot-Weiss Dornfeld", "SC Lindenau"],
  FL1: ["AS Portblanc", "Olympique Vercours", "Stade Belleroche", "RC Nordval", "FC Sablons", "AJ Montrouvre", "US Clairefosse", "Racing Aubépierre"],
};

function randomScore() {
  // Distribución aproximada a fútbol real (más 0-2 goles que marcadores altos)
  const weights = [0.24, 0.32, 0.22, 0.13, 0.06, 0.03];
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r <= acc) return i;
  }
  return weights.length - 1;
}

function buildRoundRobinSeason(teams, startDate) {
  const matches = [];
  let date = new Date(startDate);
  // Doble vuelta simple: cada equipo juega contra todos, ida y vuelta
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < teams.length; i++) {
      for (let j = 0; j < teams.length; j++) {
        if (i === j) continue;
        const home = round === 0 ? teams[i] : teams[j];
        const away = round === 0 ? teams[j] : teams[i];
        matches.push({
          date: date.toISOString(),
          homeTeam: home,
          awayTeam: away,
          homeGoals: randomScore(),
          awayGoals: randomScore(),
        });
        date = new Date(date.getTime() + 3 * 86400000); // cada 3 días, simplificado
      }
    }
  }
  return matches;
}

function fairOdds(matches, competition) {
  // Genera cuotas "de mercado" plausibles a partir de las fuerzas simuladas,
  // añadiendo el margen típico de una casa de apuestas (~6%).
  return matches.map((m) => {
    const pHome = 0.3 + Math.random() * 0.25;
    const pDraw = 0.2 + Math.random() * 0.1;
    const pAway = Math.max(0.15, 1 - pHome - pDraw);
    const total = pHome + pDraw + pAway;
    const margin = 1.06;
    return {
      ...m,
      _oddsHint: {
        home: +((1 / (pHome / total)) / margin).toFixed(2),
        draw: +((1 / (pDraw / total)) / margin).toFixed(2),
        away: +((1 / (pAway / total)) / margin).toFixed(2),
      },
    };
  });
}

function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const seasonHistoryAll = [];
  const pastValidationBySeason = [];
  const eloRatings = {};
  const todayMatches = [];

  const today = new Date();

  CONFIG.competitions.forEach((comp) => {
    const teams = TEAMS_BY_COMPETITION[comp.code];

    // --- Temporada actual (ya jugada, para season-history.json) ---
    const seasonStart = new Date(today.getTime() - 70 * 86400000);
    const currentSeasonMatches = buildRoundRobinSeason(teams, seasonStart).filter(
      (m) => new Date(m.date) < today
    );
    currentSeasonMatches.forEach((m) => seasonHistoryAll.push({ competition: comp.code, ...m }));

    // --- Rating Elo actual a partir de esa temporada ---
    const { ratings } = Elo.runSeason(currentSeasonMatches);
    eloRatings[comp.code] = Object.fromEntries(ratings);

    // --- Temporada pasada completa (para past-season-validation.json) ---
    const pastSeasonStart = new Date(today.getTime() - 300 * 86400000);
    const pastSeasonMatches = buildRoundRobinSeason(teams, pastSeasonStart);
    const rows = Backtest.walkForward(pastSeasonMatches, 20);
    pastValidationBySeason.push({
      competition: comp.code,
      seasonLabel: "temporada de ejemplo",
      accuracy: Backtest.accuracy(rows),
      roi: 0.02,
      sampleSize: rows.length,
      matches: pastSeasonMatches,
    });

    // --- 1-2 partidos "de hoy" con cuotas, para picks.html e index.html ---
    const withOdds = fairOdds(
      [
        { homeTeam: teams[0], awayTeam: teams[1] },
        { homeTeam: teams[2], awayTeam: teams[3] },
      ],
      comp.code
    );
    withOdds.forEach((m, idx) => {
      todayMatches.push({
        id: `${comp.code}-sample-${idx}`,
        competition: comp.code,
        utcDate: new Date(today.getTime() + (idx + 1) * 3 * 3600000).toISOString(),
        status: "SCHEDULED",
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        score: null,
        odds: m._oddsHint,
      });
    });
  });

  fs.writeFileSync(
    path.join(DATA_DIR, "season-history.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), matches: seasonHistoryAll }, null, 2)
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "elo-ratings.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), ratings: eloRatings }, null, 2)
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "past-season-validation.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), bySeason: pastValidationBySeason }, null, 2)
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "matches-today.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), matches: todayMatches }, null, 2)
  );

  console.log("Datos de ejemplo generados en /data.");
}

main();
