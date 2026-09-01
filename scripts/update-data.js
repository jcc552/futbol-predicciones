/**
 * scripts/update-data.js
 * Se ejecuta una vez al día desde GitHub Actions (ver
 * .github/workflows/update-data.yml). Es el ÚNICO sitio del proyecto que
 * habla con APIs externas — el front-end solo lee los JSON que este
 * script deja en /data. Motivos de este diseño (ver README §4):
 *   - No se expone ninguna API key en el navegador del visitante.
 *   - Cada visitante no consume cuota de la API gratuita (rate limits
 *     de 10 req/min en football-data.org serían inviables con tráfico real).
 *   - El sitio sigue siendo 100% estático (Vercel/Netlify/GitHub Pages).
 *
 * Fuentes de datos:
 *   - Partidos, resultados e histórico: football-data.org (plan gratuito).
 *   - Cuotas de mercado: The Odds API (plan gratuito, 500 peticiones/mes).
 *     El emparejamiento partido↔cuota se hace por nombre de equipo
 *     normalizado (best-effort); si no hay match o no hay ODDS_API_KEY,
 *     el partido se guarda sin cuotas y simplemente no genera picks
 *     (ver limitaciones en el README).
 *
 * Variables de entorno esperadas (configuradas como Secrets en GitHub):
 *   FOOTBALL_DATA_API_KEY  (obligatoria)
 *   ODDS_API_KEY           (opcional — sin ella no habrá picks de valor)
 */

const fs = require("fs");
const path = require("path");

const CONFIG = require("../js/config.js");
const Predictor = require("../js/predictor.js");
const Backtest = require("../js/backtest.js");
const Elo = require("../js/elo.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const FD_BASE = "https://api.football-data.org/v4";
const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;
const ODDS_KEY = process.env.ODDS_API_KEY;

// Mapeo código de competición (football-data.org) -> sport key de The Odds API
const ODDS_API_SPORT_KEY = {
  PL: "soccer_epl",
  PD: "soccer_spain_la_liga",
  SA: "soccer_italy_serie_a",
  BL1: "soccer_germany_bundesliga",
  FL1: "soccer_france_ligue_one",
};

function normalizeTeamName(name) {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/\b(fc|cf|ac|sc|club|de|deportivo|calcio|u\.?s\.?|ss|as)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

async function fdFetch(pathSuffix) {
  if (!FD_KEY) throw new Error("Falta FOOTBALL_DATA_API_KEY");
  const res = await fetch(`${FD_BASE}${pathSuffix}`, {
    headers: { "X-Auth-Token": FD_KEY },
  });
  if (!res.ok) {
    console.error(`football-data.org ${pathSuffix} -> HTTP ${res.status}`);
    return null;
  }
  return res.json();
}

async function fetchOddsForCompetition(code) {
  const sportKey = ODDS_API_SPORT_KEY[code];
  if (!ODDS_KEY || !sportKey) return [];
  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=eu&markets=h2h&oddsFormat=decimal&apiKey=${ODDS_KEY}`
    );
    if (!res.ok) {
      console.error(`The Odds API ${code} -> HTTP ${res.status}`);
      return [];
    }
    return res.json();
  } catch (err) {
    console.error(`The Odds API ${code} falló:`, err.message);
    return [];
  }
}

function matchOdds(homeTeam, awayTeam, oddsEvents) {
  const h = normalizeTeamName(homeTeam);
  const a = normalizeTeamName(awayTeam);
  const event = oddsEvents.find((e) => {
    const eh = normalizeTeamName(e.home_team || "");
    const ea = normalizeTeamName(e.away_team || "");
    return (eh.includes(h) || h.includes(eh)) && (ea.includes(a) || a.includes(ea));
  });
  if (!event) return null;

  const bookmaker = event.bookmakers?.[0];
  const market = bookmaker?.markets?.find((m) => m.key === "h2h");
  if (!market) return null;

  const find = (teamName, fallback) => {
    const outcome = market.outcomes.find((o) => normalizeTeamName(o.name) === normalizeTeamName(teamName));
    return outcome ? outcome.price : fallback;
  };
  const drawOutcome = market.outcomes.find((o) => o.name === "Draw");

  const home = find(event.home_team, null);
  const away = find(event.away_team, null);
  const draw = drawOutcome ? drawOutcome.price : null;
  if (!home || !away || !draw) return null;

  return { home, draw, away, bookmaker: bookmaker.title };
}

function toInternalMatch(m) {
  return {
    date: m.utcDate,
    homeTeam: m.homeTeam.name,
    awayTeam: m.awayTeam.name,
    homeGoals: m.score.fullTime.home,
    awayGoals: m.score.fullTime.away,
  };
}

async function buildMatchesToday() {
  const today = new Date().toISOString().slice(0, 10);
  const allMatches = [];

  for (const comp of CONFIG.competitions) {
    const data = await fdFetch(`/competitions/${comp.code}/matches?dateFrom=${today}&dateTo=${today}`);
    if (!data) continue;

    const oddsEvents = await fetchOddsForCompetition(comp.code);

    (data.matches || []).forEach((m) => {
      const odds =
        m.status === "SCHEDULED" ? matchOdds(m.homeTeam.name, m.awayTeam.name, oddsEvents) : null;

      allMatches.push({
        id: m.id,
        competition: comp.code,
        utcDate: m.utcDate,
        status: m.status, // SCHEDULED | FINISHED | ...
        homeTeam: m.homeTeam.name,
        awayTeam: m.awayTeam.name,
        score:
          m.status === "FINISHED"
            ? { home: m.score.fullTime.home, away: m.score.fullTime.away }
            : null,
        odds: odds ? { home: odds.home, draw: odds.draw, away: odds.away } : null,
      });
    });
  }

  return { generatedAt: new Date().toISOString(), matches: allMatches };
}

async function buildSeasonHistory() {
  const allMatches = [];
  for (const comp of CONFIG.competitions) {
    const data = await fdFetch(`/competitions/${comp.code}/matches?status=FINISHED`);
    if (!data) continue;
    (data.matches || []).forEach((m) => {
      allMatches.push({ competition: comp.code, ...toInternalMatch(m) });
    });
  }
  return { generatedAt: new Date().toISOString(), matches: allMatches };
}

function buildEloRatings(seasonHistory) {
  const ratings = {};
  const byCompetition = new Map();
  seasonHistory.matches.forEach((m) => {
    if (!byCompetition.has(m.competition)) byCompetition.set(m.competition, []);
    byCompetition.get(m.competition).push(m);
  });

  byCompetition.forEach((matches, code) => {
    const sorted = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date));
    const { ratings: teamRatings } = Elo.runSeason(sorted);
    ratings[code] = Object.fromEntries(teamRatings);
  });

  return { generatedAt: new Date().toISOString(), ratings };
}

/**
 * Validación contra la temporada pasada completa. Se cachea: si ya existe
 * y tiene menos de 25 días, no se vuelve a calcular (es costoso y los
 * resultados de temporadas CERRADAS no cambian).
 */
async function buildPastSeasonValidation() {
  const outPath = path.join(DATA_DIR, "past-season-validation.json");
  if (fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    const ageDays = (Date.now() - new Date(existing.generatedAt).getTime()) / 86400000;
    if (ageDays < 25 && existing.bySeason?.length) {
      console.log("Validación de temporada pasada ya en caché, se conserva.");
      return existing;
    }
  }

  const currentYear = new Date().getFullYear();
  const pastSeasonYear = new Date().getMonth() >= 6 ? currentYear - 1 : currentYear - 2;

  const bySeason = [];
  for (const comp of CONFIG.competitions) {
    const data = await fdFetch(`/competitions/${comp.code}/matches?season=${pastSeasonYear}&status=FINISHED`);
    if (!data || !data.matches?.length) continue;

    const matches = data.matches.map((m) => toInternalMatch(m));
    const rows = Backtest.walkForward(matches, 40);
    const accuracy = Backtest.accuracy(rows);

    bySeason.push({
      competition: comp.code,
      seasonLabel: `${pastSeasonYear}/${String(pastSeasonYear + 1).slice(2)}`,
      accuracy,
      roi: estimateRoiWithoutOdds(rows), // ver nota abajo
      sampleSize: rows.length,
      matches, // se guarda para poder alimentar getFullHistoryForCompetition() en el cliente
    });
  }

  return { generatedAt: new Date().toISOString(), bySeason };
}

/**
 * football-data.org NO da cuotas históricas en el plan gratuito, así que
 * el ROI de la validación histórica se estima usando la cuota implícita
 * "justa" 1/P(resultado) como aproximación neutral (sin margen de casa),
 * NO cuotas reales de mercado. Esto es una simplificación explícita:
 * ver limitaciones en el README. El ROI "real" con cuotas de mercado solo
 * puede calcularse para la temporada actual (donde sí hay odds de The Odds API).
 */
function estimateRoiWithoutOdds(rows) {
  let balance = 0;
  let staked = 0;
  rows.forEach((r) => {
    const fairOdds = 1 / r.probs[r.modelPick];
    const stake = 1;
    staked += stake;
    balance += r.modelCorrect ? stake * (fairOdds - 1) : -stake;
  });
  return staked ? balance / staked : 0;
}

function writeJSON(filename, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
  console.log(`Escrito data/${filename}`);
}

async function main() {
  if (!FD_KEY) {
    console.error("FOOTBALL_DATA_API_KEY no configurada. Aborta sin tocar los JSON existentes.");
    process.exit(1);
  }

  const seasonHistory = await buildSeasonHistory();
  writeJSON("season-history.json", seasonHistory);

  const eloRatings = buildEloRatings(seasonHistory);
  writeJSON("elo-ratings.json", eloRatings);

  const matchesToday = await buildMatchesToday();
  writeJSON("matches-today.json", matchesToday);

  const pastValidation = await buildPastSeasonValidation();
  writeJSON("past-season-validation.json", pastValidation);
}

main().catch((err) => {
  console.error("Fallo en update-data.js:", err);
  process.exit(1);
});
