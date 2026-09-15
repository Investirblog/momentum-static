const https = require("https");
const { getStore } = require("@netlify/blobs");

// ─────────────────────────────────────────────────────────────────────
// Univers (identique à generate_data.py — 14 ETF)
// ─────────────────────────────────────────────────────────────────────
const UNIVERSE = [
  { ticker: "QDVE.DE", display: "QDVE", name: "S&P 500 Technology",        bloc: "sector" },
  { ticker: "QDVF.DE", display: "QDVF", name: "S&P 500 Energy",            bloc: "sector" },
  { ticker: "QDVH.DE", display: "QDVH", name: "S&P 500 Health Care",       bloc: "sector" },
  { ticker: "QDVG.DE", display: "QDVG", name: "S&P 500 Financials",        bloc: "sector" },
  { ticker: "QDVI.DE", display: "QDVI", name: "MSCI USA Value Factor",     bloc: "factor" },
  { ticker: "IWQU.L",  display: "IWQU", name: "MSCI World Quality",        bloc: "factor" },
  { ticker: "WSML.L",  display: "WSML", name: "MSCI World Small Cap",      bloc: "factor" },
  { ticker: "MVOL.L",  display: "MVOL", name: "MSCI World Min Volatility", bloc: "factor" },
  { ticker: "IUVL.L",  display: "IUVL", name: "MSCI Europe Value",         bloc: "factor" },
  { ticker: "CNDX.L",  display: "CNDX", name: "Nasdaq 100 UCITS ETF",      bloc: "geo" },
  { ticker: "EXUS.DE", display: "EXUS", name: "MSCI World ex-USA",         bloc: "geo" },
  { ticker: "IEMA.L",  display: "IEMA", name: "MSCI Emerging Markets",     bloc: "geo" },
  { ticker: "IGLN.L",  display: "IGLN", name: "Physical Gold ETC",         bloc: "refuge" },
  { ticker: "IPRP.L",  display: "IPRP", name: "MSCI World Real Estate",    bloc: "refuge" },
];

const TOP_N = 2; // nombre d'ETF sélectionnés chaque mois (config actuelle du site)

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json,*/*",
        "Referer": "https://finance.yahoo.com/",
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(6000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

/** Récupère ~14 mois de données quotidiennes — assez pour 252 jours de
 * lookback (12 mois) + marge. */
async function getDailyPrices(ticker, idx) {
  await delay(idx * 200);
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = Math.floor((Date.now() - 430 * 24 * 60 * 60 * 1000) / 1000); // ~14 mois
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${p1}&period2=${p2}&interval=1d`;
  try {
    const { statusCode, body } = await fetchUrl(url);
    if (statusCode === 429) return { ticker, closes: null, error: "Rate limited" };
    const json = JSON.parse(body);
    const result = json?.chart?.result?.[0];
    if (!result) return { ticker, closes: null, error: json?.chart?.error?.description || "Aucun résultat Yahoo Finance" };
    const ts = result.timestamp;
    const raw = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close;
    if (!ts || !raw) return { ticker, closes: null, error: "Pas de données OHLC" };
    // Chronologique croissant (le plus ancien en premier), comme un DataFrame pandas
    const closes = ts.map((t, i) => raw[i]).filter(v => v != null);
    if (closes.length < 60) return { ticker, closes: null, error: `Seulement ${closes.length} jours disponibles` };
    return { ticker, closes };
  } catch (e) { return { ticker, closes: null, error: e.message }; }
}

function calcPerf(closes, n) {
  if (closes.length < n + 1) return null;
  const cur = closes[closes.length - 1], past = closes[closes.length - 1 - n];
  if (!past) return null;
  return +((cur / past - 1) * 100).toFixed(4);
}

function calcSMA(closes, n) {
  if (closes.length < n) return null;
  const slice = closes.slice(closes.length - n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

/** Score 13612W (Keller & Keuning) — identique à generate_data.py :
 * 12×ret1M + 4×ret3M + 2×ret6M + 1×ret12M (jours de bourse : 21/63/126/252) */
function calcScore13612W(closes) {
  const p1m = calcPerf(closes, 21), p3m = calcPerf(closes, 63);
  const p6m = calcPerf(closes, 126), p12m = calcPerf(closes, 252);
  if ([p1m, p3m, p6m, p12m].some(v => v === null)) return { score: null, p1m, p3m, p6m, p12m };
  const score = +(12 * p1m + 4 * p3m + 2 * p6m + p12m).toFixed(4);
  return { score, p1m, p3m, p6m, p12m };
}

/** Calcule le classement complet + sélection TopN — logique équivalente à
 * generate_data.py + la sélection faite côté front-end dans l'ancien
 * index.html (éligible = score connu ET pas sous sa SMA200). */
async function computeSignal() {
  const results = [];
  const daily = await Promise.all(UNIVERSE.map((etf, i) => getDailyPrices(etf.ticker, i)));

  UNIVERSE.forEach((etf, i) => {
    const d = daily[i];
    if (!d.closes) {
      results.push({ ...etf, last_price: null, p1m: null, p3m: null, p6m: null, p12m: null,
        score: null, sma200: null, above_sma200: null, error: d.error });
      return;
    }
    const { score, p1m, p3m, p6m, p12m } = calcScore13612W(d.closes);
    const sma200 = calcSMA(d.closes, 200);
    const last = +d.closes[d.closes.length - 1].toFixed(4);
    const above = sma200 !== null ? last > sma200 : null;
    results.push({
      ...etf, last_price: last, p1m, p3m, p6m, p12m, score,
      sma200: sma200 !== null ? +sma200.toFixed(4) : null,
      above_sma200: above, error: null,
    });
  });

  // Éligible = score connu ET pas explicitement sous sa SMA200 (above===false exclut ; above===null n'exclut pas)
  const eligible = results.filter(r => r.score !== null && r.above_sma200 !== false)
    .sort((a, b) => b.score - a.score);
  const top = eligible.slice(0, TOP_N);
  const nullCount = results.filter(r => r.score === null).length;

  return {
    results,
    selection: { top: top.map(e => ({ ticker: e.ticker, display: e.display, name: e.name, score: e.score })),
                 topN: TOP_N, nullCount, allScored: nullCount === 0 },
    updatedAt: new Date().toISOString(),
  };
}

function getMomentumStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: "momentumstatic", siteID, token });
  return getStore("momentumstatic");
}

module.exports = { UNIVERSE, TOP_N, computeSignal, getMomentumStore };
