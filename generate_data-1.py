"""
generate_data.py — Génère data.json pour le screener momentum
Exécuté automatiquement par GitHub Actions le 1er de chaque mois

Modifications v2 :
- Suppression QDVC (Industrials), QDVD (Consumer Discret.), IWMO (redondance momentum)
- Suppression IDTM (Treasuries — rôle défensif couvert par VAA)
- Ajout CNDX (Nasdaq 100), EXUS (World ex-USA), IPRP (World Real Estate), IUVL (Europe Value)
- Score : 13612W (Keller) au lieu de simple somme 1+3+6M
- Filtre SMA200 conservé
"""

import yfinance as yf
import numpy as np
import json
from datetime import datetime

UNIVERSE = [
    # ── Secteurs US (4) ──────────────────────────────────────────────
    {"ticker": "QDVE.DE", "display": "QDVE", "name": "S&P 500 Technology",        "bloc": "sector"},
    {"ticker": "QDVF.DE", "display": "QDVF", "name": "S&P 500 Energy",            "bloc": "sector"},
    {"ticker": "QDVH.DE", "display": "QDVH", "name": "S&P 500 Health Care",       "bloc": "sector"},
    {"ticker": "QDVG.DE", "display": "QDVG", "name": "S&P 500 Financials",        "bloc": "sector"},
    # ── Facteurs World (5) ───────────────────────────────────────────
    {"ticker": "QDVI.DE", "display": "QDVI", "name": "MSCI USA Value Factor",     "bloc": "factor"},
    {"ticker": "IWQU.L",  "display": "IWQU", "name": "MSCI World Quality",        "bloc": "factor"},
    {"ticker": "WSML.L",  "display": "WSML", "name": "MSCI World Small Cap",      "bloc": "factor"},
    {"ticker": "MVOL.L",  "display": "MVOL", "name": "MSCI World Min Volatility", "bloc": "factor"},
    {"ticker": "IUVL.L",  "display": "IUVL", "name": "MSCI Europe Value",         "bloc": "factor"},
    # ── Géographiques (3) ────────────────────────────────────────────
    {"ticker": "CNDX.L",  "display": "CNDX", "name": "Nasdaq 100 UCITS ETF",      "bloc": "geo"},
    {"ticker": "EXUS.DE", "display": "EXUS", "name": "MSCI World ex-USA",         "bloc": "geo"},
    {"ticker": "IEMA.L",  "display": "IEMA", "name": "MSCI Emerging Markets",     "bloc": "geo"},
    # ── Refuges (2) ──────────────────────────────────────────────────
    {"ticker": "IGLN.L",  "display": "IGLN", "name": "Physical Gold ETC",         "bloc": "refuge"},
    {"ticker": "IPRP.L",  "display": "IPRP", "name": "MSCI World Real Estate",    "bloc": "refuge"},
]

def calc_perf(closes, n):
    """Retour sur n jours ouvrés"""
    if len(closes) < n + 1:
        return None
    cur, past = closes[-1], closes[-1 - n]
    if not past or past == 0:
        return None
    return round((cur / past - 1) * 100, 4)

def calc_sma(closes, n):
    if len(closes) < n:
        return None
    return float(np.mean(closes[-n:]))

def calc_score_13612w(closes):
    """
    Score momentum 13612W de Keller & Keuning :
    12×ret1M + 4×ret3M + 2×ret6M + 1×ret12M
    (pondère davantage le court terme tout en intégrant le long terme)
    """
    p1m  = calc_perf(closes, 21)
    p3m  = calc_perf(closes, 63)
    p6m  = calc_perf(closes, 126)
    p12m = calc_perf(closes, 252)
    if any(v is None for v in [p1m, p3m, p6m, p12m]):
        return None, p1m, p3m, p6m, p12m
    score = round(12*p1m + 4*p3m + 2*p6m + p12m, 4)
    return score, p1m, p3m, p6m, p12m

results = []
tickers = [e["ticker"] for e in UNIVERSE]

print("Téléchargement des données (13 mois)...")
df = yf.download(tickers, period="14mo", auto_adjust=True, progress=True)["Close"]

for etf in UNIVERSE:
    t = etf["ticker"]
    try:
        series = df[t].dropna()
        if len(series) < 60:
            raise ValueError(f"Seulement {len(series)} jours disponibles")
        closes = series.tolist()

        score, p1m, p3m, p6m, p12m = calc_score_13612w(closes)
        sma200    = calc_sma(closes, 200)
        last      = round(float(closes[-1]), 4)
        above_sma = bool(last > sma200) if sma200 is not None else None

        results.append({
            **etf,
            "last_price":   last,
            "p1m":          p1m,
            "p3m":          p3m,
            "p6m":          p6m,
            "p12m":         p12m,
            "score":        score,
            "sma200":       round(sma200, 4) if sma200 else None,
            "above_sma200": above_sma,
            "error":        None,
        })
        flag = "✓" if score is not None else "?"
        print(f"  {flag} {etf['display']:6s}  score={score}  above_sma={above_sma}")

    except Exception as e:
        print(f"  ✗ {etf['display']:6s}  erreur: {e}")
        results.append({
            **etf,
            "last_price": None, "p1m": None, "p3m": None,
            "p6m": None, "p12m": None, "score": None,
            "sma200": None, "above_sma200": None, "error": str(e),
        })

output = {
    "computed_at": datetime.utcnow().isoformat() + "Z",
    "version": "2.0-13612W",
    "results": results,
}

with open("data.json", "w") as f:
    json.dump(output, f, indent=2)

ok = len([r for r in results if r["score"] is not None])
print(f"\n✓ data.json généré — {ok}/{len(UNIVERSE)} ETF OK")
print(f"  Score utilisé : 13612W (Keller & Keuning)")
print(f"  Top 1 : {sorted([r for r in results if r['score']], key=lambda x: -x['score'])[0]['display'] if ok else '—'}")
