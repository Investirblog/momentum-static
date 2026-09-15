const { computeSignal, getMomentumStore } = require("./shared");

const STALE_AFTER_HOURS = 30;

exports.handler = async () => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const store = getMomentumStore();
    let signal = await store.get("latest", { type: "json" });
    let history = (await store.get("history", { type: "json" })) || [];
    let cached = true;

    const isStale = !signal ||
      (Date.now() - new Date(signal.updatedAt).getTime()) > STALE_AFTER_HOURS * 3600 * 1000;

    if (isStale) {
      try {
        signal = await computeSignal();
        cached = false;
      } catch (e) {
        if (!signal) throw e;
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ...signal, history, cached }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
