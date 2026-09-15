const { computeSignal, getMomentumStore, computeMonthReturn, UNIVERSE } = require("./shared");

exports.handler = async () => {
  try {
    const signal = await computeSignal();
    const store = getMomentumStore();
    await store.setJSON("latest", signal);

    const monthKey = signal.updatedAt.slice(0, 7);
    let history = (await store.get("history", { type: "json" })) || [];

    // Prix de clôture de TOUS les ETF à ce relevé — nécessaire pour
    // recalculer le rendement réalisé le mois suivant (stratégie ET
    // benchmark equal-weight, qui utilise les 14, pas seulement le Top2).
    const pricesNow = {};
    signal.results.forEach(r => { pricesNow[r.ticker] = r.last_price; });

    const idx = history.findIndex(h => h.month === monthKey);
    const previousEntry = idx >= 0 ? history[idx - 1] : history[history.length - 1];

    let monthReturnPct = null, benchReturnPct = null;
    if (previousEntry && previousEntry.prices) {
      const stratTickers = (previousEntry.top || []).map(e => e.ticker);
      const stratRet = computeMonthReturn(stratTickers, pricesNow, previousEntry.prices);
      // Aucun ETF détenu ce mois-là (0 éligible) -> rendement nul, pas "donnée manquante"
      monthReturnPct = stratRet !== null ? +(stratRet * 100).toFixed(2) : (stratTickers.length === 0 ? 0 : null);

      const allTickers = UNIVERSE.map(e => e.ticker);
      const benchRet = computeMonthReturn(allTickers, pricesNow, previousEntry.prices);
      benchReturnPct = benchRet !== null ? +(benchRet * 100).toFixed(2) : null;
    }

    const entry = {
      month: monthKey,
      top: signal.selection.top,
      allScored: signal.selection.allScored,
      prices: pricesNow,
      monthReturnPct,
      benchReturnPct,
      capturedAt: signal.updatedAt,
    };

    if (idx >= 0) history[idx] = entry; else history.push(entry);
    history = history.slice(-24);
    await store.setJSON("history", history);

    return { statusCode: 200, body: JSON.stringify({ ok: true, month: monthKey, top: entry.top.map(t => t.display) }) };
  } catch (err) {
    console.error("update-momentum-scheduled failed:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
