/**
 * data.js
 * Capa de acceso a los datos. El sitio es 100% estático: en vez de llamar
 * a la API externa desde el navegador de cada visitante, lee ficheros JSON
 * que un GitHub Action regenera una vez al día (ver README §4 para la
 * justificación de esta elección frente a "fetch en cada visita").
 */

const DataAPI = {
  _cache: new Map(),

  async _loadJSON(path) {
    if (this._cache.has(path)) return this._cache.get(path);
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} al cargar ${path}`);
      const json = await res.json();
      this._cache.set(path, json);
      return json;
    } catch (err) {
      console.error(`No se pudo cargar ${path}:`, err);
      return null;
    }
  },

  async getMatchesToday() {
    return (await this._loadJSON(CONFIG.data.matchesToday)) ?? { generatedAt: null, matches: [] };
  },

  async getEloRatings() {
    return (await this._loadJSON(CONFIG.data.eloRatings)) ?? { generatedAt: null, ratings: {} };
  },

  async getPastSeasonValidation() {
    return (
      (await this._loadJSON(CONFIG.data.pastSeasonValidation)) ?? {
        generatedAt: null,
        bySeason: [],
      }
    );
  },

  async getSeasonHistory() {
    return (await this._loadJSON(CONFIG.data.seasonHistory)) ?? { generatedAt: null, matches: [] };
  },

  /** Todo el histórico disponible (temporada pasada + temporada actual jugada) para un cálculo de fuerzas. */
  async getFullHistoryForCompetition(competitionCode) {
    const [pastValidation, seasonHistory] = await Promise.all([
      this.getPastSeasonValidation(),
      this.getSeasonHistory(),
    ]);
    const past = (pastValidation.bySeason || [])
      .filter((s) => s.competition === competitionCode)
      .flatMap((s) => s.matches);
    const current = (seasonHistory.matches || []).filter((m) => m.competition === competitionCode);
    return [...past, ...current].sort((a, b) => new Date(a.date) - new Date(b.date));
  },
};

/** Utilidades de fecha/formato compartidas por las páginas */
const Fmt = {
  currency(v) {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);
  },
  pct(v, decimals = 1) {
    return `${(v * 100).toFixed(decimals)}%`;
  },
  time(iso) {
    return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  },
  date(iso) {
    return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  },
  dateLong(iso) {
    return new Date(iso).toLocaleDateString("es-ES", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });
  },
};
