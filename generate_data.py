"""
generate_data.py — Génère data.json pour le screener momentum
Exécuté automatiquement par GitHub Actions le 1er de chaque mois
"""

import yfinance as yf
import numpy as np
import json
from datetime import datetime

UNIVERSE = [
    {"ticker": "QDVF.DE", "display": "QDVF", "name": "S&P 500 Energy",           "bloc": "sector"},
    {"ticker": "QDVG.DE", "display": "QDVG", "name": "S&P 500 Financials",        "bloc": "sector"},
    {"ticker": "QDVH.DE", "display": "QDVH", "name": "S&P 500 Health Care",       "bloc": "sector"},
    {"ticker": "QDVD.DE", "display": "QDVD", "name": "S&P 500 Consumer Discret.", "bloc": "sector"},
    {"ticker": "QDVE.DE", "display": "QDVE", "name": "S&P 500 Technology",        "bloc": "sector"},
    {"ticker": "QDVC.DE", "display": "QDVC", "name": "S&P 500 Industrials",       "bloc": "sector"},
    {"ticker": "QDVI.DE", "display": "QDVI", "name": "MSCI USA Value Factor",     "bloc": "factor"},
    {"ticker": "IWMO.L",  "display": "IWMO", "name": "MSCI World Momentum",       "bloc": "factor"},
    {"ticker": "IWQU.L",  "display": "IWQU", "name": "MSCI World Quality",        "bloc": "factor"},
    {"ticker": "WSML.L",  "display": "WSML", "name": "MSCI World Small Cap",      "bloc": "factor"},
    {"ticker": "MVOL.L",  "display": "MVOL", "name": "MSCI World Min Volatility", "bloc": "factor"},
    {"ticker": "IEMA.L",  "display": "IEMA", "name": "MSCI Emerging Markets",     "bloc": "refuge"},
    {"ticker": "IGLN.L",  "display": "IGLN", "name": "Physical Gold ETC",         "bloc": "refuge"},
    {"ticker": "IDTM.L",  "display": "IDTM", "name": "US Treasuries 7-10Y",       "bloc": "refuge"},
]

def calc_perf(closes, n):
    if len(closes) < n + 1:
        return None
    cur, past = closes[-1], closes[-1 - n]
    if not past or past == 0:
        return None
    return round((cur / past - 1) * 100, 2)

def calc_sma(closes, n):
    if len(closes) < n:
        return None
    return float(np.mean(closes[-n:]))

results = []
tickers = [e["ticker"] for e in UNIVERSE]

print("Téléchargement des données...")
df = yf.download(tickers, period="12mo", auto_adjust=True, progress=True)["Close"]

for etf in UNIVERSE:
    t = etf["ticker"]
    try:
        series = df[t].dropna()
        if len(series) < 30:
            raise ValueError(f"Seulement {len(series)} jours")
        closes = series.tolist()

        p1m = calc_perf(closes, 21)
        p3m = calc_perf(closes, 63)
        p6m = calc_perf(closes, 126)
        sma200 = calc_sma(closes, 200)
        last = round(float(closes[-1]), 4)
        above_sma200 = bool(last > sma200) if sma200 is not None else None
        valid = [v for v in [p1m, p3m, p6m] if v is not None]
        score = round(sum(valid), 2) if valid else None

        results.append({
            **etf,
            "last_price": last,
            "p1m": p1m, "p3m": p3m, "p6m": p6m,
            "sma200": round(sma200, 4) if sma200 else None,
            "above_sma200": above_sma200,
            "score": score,
            "error": None,
        })
        print(f"  ✓ {etf['display']:6s} score={score}")
    except Exception as e:
        print(f"  ✗ {etf['display']:6s} erreur: {e}")
        results.append({**etf, "last_price": None, "p1m": None, "p3m": None,
                        "p6m": None, "sma200": None, "above_sma200": None,
                        "score": None, "error": str(e)})

output = {
    "computed_at": datetime.utcnow().isoformat() + "Z",
    "results": results
}

with open("data.json", "w") as f:
    json.dump(output, f, indent=2)

print(f"\n✓ data.json généré — {len([r for r in results if r['score'] is not None])}/{len(UNIVERSE)} ETF OK")
