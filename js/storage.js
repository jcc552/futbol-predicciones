/**
 * storage.js
 * Toda la persistencia del usuario vive en localStorage: saldo virtual
 * ficticio e historial de apuestas simuladas. No se usa ningún backend
 * ni base de datos porque no hace falta compartir estado entre
 * dispositivos ni usuarios para un trabajo académico individual.
 */

const Storage = {
  getBalance() {
    const raw = localStorage.getItem(CONFIG.storage.virtualBalance);
    if (raw === null) {
      this.setBalance(CONFIG.betting.startingVirtualBalance);
      return CONFIG.betting.startingVirtualBalance;
    }
    return parseFloat(raw);
  },

  setBalance(value) {
    localStorage.setItem(CONFIG.storage.virtualBalance, String(value));
  },

  resetBalance() {
    this.setBalance(CONFIG.betting.startingVirtualBalance);
    localStorage.setItem(CONFIG.storage.betHistory, JSON.stringify([]));
  },

  getHistory() {
    const raw = localStorage.getItem(CONFIG.storage.betHistory);
    return raw ? JSON.parse(raw) : [];
  },

  saveHistory(history) {
    localStorage.setItem(CONFIG.storage.betHistory, JSON.stringify(history));
  },

  /**
   * Registra una apuesta simulada aceptada por el usuario y descuenta el
   * stake del saldo virtual. La liquidación (ganada/perdida) se hace
   * más tarde en settleBets() cuando el resultado real está disponible.
   */
  placeBet(bet) {
    const history = this.getHistory();
    const record = {
      id: `${bet.matchId}-${bet.market}-${Date.now()}`,
      matchId: bet.matchId,
      competition: bet.competition,
      home: bet.home,
      away: bet.away,
      market: bet.market, // "1" | "X" | "2"
      odds: bet.odds,
      modelProbability: bet.modelProbability,
      expectedValue: bet.expectedValue,
      stake: bet.stake,
      kellyStakeSuggested: bet.kellyStakeSuggested,
      placedAt: new Date().toISOString(),
      status: "pending", // pending | won | lost | void
      payout: null,
    };
    history.push(record);
    this.saveHistory(history);
    this.setBalance(this.getBalance() - bet.stake);
    return record;
  },

  /**
   * Liquida las apuestas "pending" cuyo partido ya tiene resultado real.
   * results: Map matchId -> "1"|"X"|"2"
   */
  settleBets(resultsByMatchId) {
    const history = this.getHistory();
    let balance = this.getBalance();
    let changed = false;

    history.forEach((bet) => {
      if (bet.status !== "pending") return;
      const actual = resultsByMatchId.get(bet.matchId);
      if (!actual) return; // partido aún no finalizado

      changed = true;
      if (actual === bet.market) {
        bet.status = "won";
        bet.payout = +(bet.stake * bet.odds).toFixed(2);
        balance += bet.payout;
      } else {
        bet.status = "lost";
        bet.payout = 0;
      }
    });

    if (changed) {
      this.saveHistory(history);
      this.setBalance(balance);
    }
    return changed;
  },
};
