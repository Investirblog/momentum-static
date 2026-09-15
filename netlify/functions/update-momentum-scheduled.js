const { computeSignal, getMomentumStore } = require("./shared");

exports.handler = async () => {
  try {
    const signal = await computeSignal();
    const store = getMomentumStore();

    // Cache "dernier calcul" — lu par get-momentum.js à chaque visite
    await store.setJSON("latest", signal);

    // Historique — une entrée par mois calendaire, mise à jour chaque jour
    // tant que le mois est en cours ; se fige dès qu'on passe au mois
    // suivant (on ne retouche plus les entrées passées). Même mécanisme
    // que RotationShield.
    const monthKey = signal.updatedAt.slice(0, 7);
    let history = (await store.get("history", { type: "json" })) || [];

    const entry = {
      month: monthKey,
      top: signal.selection.top,
      allScored: signal.selection.allScored,
      capturedAt: signal.updatedAt,
    };

    const idx = history.findIndex(h => h.month === monthKey);
    if (idx >= 0) history[idx] = entry; else history.push(entry);

    history = history.slice(-24); // 24 derniers mois
    await store.setJSON("history", history);

    return { statusCode: 200, body: JSON.stringify({ ok: true, month: monthKey, top: entry.top.map(t => t.display) }) };
  } catch (err) {
    console.error("update-momentum-scheduled failed:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
