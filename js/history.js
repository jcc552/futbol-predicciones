/**
 * history.js
 * Lógica de history.html: tabla de todas las apuestas simuladas del
 * usuario (aceptadas desde picks.html), su estado (pendiente/ganada/
 * perdida) y la evolución de su saldo virtual a lo largo del tiempo.
 */

const HistoryPage = {
  init() {
    const history = Storage.getHistory();
    this.renderSummary(history);
    this.renderTable(history);
    this.renderBalanceChart(history);

    document.getElementById("reset-btn").addEventListener("click", () => {
      if (confirm("Esto borrará tu historial de apuestas simuladas y reiniciará el saldo virtual. ¿Continuar?")) {
        Storage.resetBalance();
        location.reload();
      }
    });
  },

  renderSummary(history) {
    const settled = history.filter((b) => b.status !== "pending");
    const won = settled.filter((b) => b.status === "won").length;
    const totalStaked = settled.reduce((s, b) => s + b.stake, 0);
    const net = settled.reduce((s, b) => s + (b.payout ?? 0) - b.stake, 0);
    const roi = totalStaked ? net / totalStaked : 0;

    const set = (id, v) => (document.getElementById(id).textContent = v);
    set("hist-balance", Fmt.currency(Storage.getBalance()));
    set("hist-bets", history.length);
    set("hist-accuracy", settled.length ? Fmt.pct(won / settled.length) : "—");
    set("hist-roi", settled.length ? Fmt.pct(roi) : "—");
  },

  renderTable(history) {
    const tbody = document.getElementById("history-body");
    const emptyState = document.getElementById("history-empty");

    if (history.length === 0) {
      emptyState.style.display = "block";
      tbody.innerHTML = "";
      return;
    }
    emptyState.style.display = "none";

    tbody.innerHTML = [...history]
      .reverse()
      .map((b) => {
        const statusLabel = { pending: "Pendiente", won: "Ganada", lost: "Perdida", void: "Anulada" }[b.status];
        const net = b.status === "won" ? b.payout - b.stake : b.status === "lost" ? -b.stake : 0;
        const netClass = net > 0 ? "pos" : net < 0 ? "neg" : "";
        return `<tr>
          <td>${Fmt.date(b.placedAt)}</td>
          <td>${b.home} — ${b.away}</td>
          <td>${b.market}</td>
          <td>${b.odds.toFixed(2)}</td>
          <td>${Fmt.currency(b.stake)}</td>
          <td>${statusLabel}</td>
          <td class="${netClass}">${b.status === "pending" ? "—" : Fmt.currency(net)}</td>
        </tr>`;
      })
      .join("");
  },

  renderBalanceChart(history) {
    const ctx = document.getElementById("balance-chart");
    if (!ctx || history.length === 0) return;

    let balance = CONFIG.betting.startingVirtualBalance;
    const points = [balance];
    const labels = ["Inicio"];

    [...history]
      .filter((b) => b.status !== "pending")
      .sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt))
      .forEach((b, i) => {
        balance += b.status === "won" ? b.payout - b.stake : -b.stake;
        points.push(+balance.toFixed(2));
        labels.push(`#${i + 1}`);
      });

    if (points.length < 2) return;
    ChartTheme.lineChart(ctx, labels, [{ label: "Saldo virtual", data: points, color: ChartTheme.colors.amber }]);
  },
};

document.addEventListener("DOMContentLoaded", () => HistoryPage.init());
