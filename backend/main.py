from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import math
from datetime import datetime, timezone

app = FastAPI(title="GEX-VEX Options Backend")

# Enable CORS for Next.js frontend calls
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def clean_value(val):
    if pd.isna(val) or val is None:
        return 0.0
    try:
        fval = float(val)
        if math.isnan(fval) or math.isinf(fval):
            return 0.0
        return fval
    except Exception:
        return 0.0

def calculate_gamma(S, K, T, r, sigma):
    if T <= 0:
        T = 1e-5
    # Cap volatility at a minimum of 1% to avoid division by zero
    sigma = max(sigma, 0.01)
    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
        pdf = math.exp(-0.5 * d1**2) / math.sqrt(2.0 * math.pi)
        gamma = pdf / (S * sigma * math.sqrt(T))
        return gamma
    except Exception:
        return 0.0

@app.get("/api/options")
def get_options(symbol: str = Query(..., description="Ticker symbol e.g. SPY"), expiration: str = Query(None, description="Expiration date YYYY-MM-DD")):
    try:
        ticker = yf.Ticker(symbol)
        
        # Get spot price
        hist = ticker.history(period="1d")
        if hist.empty:
            try:
                spot = ticker.info.get("regularMarketPrice") or ticker.info.get("ask") or ticker.info.get("bid")
            except Exception:
                spot = None
        else:
            spot = float(hist['Close'].iloc[-1])
            
        if spot is None:
            raise HTTPException(status_code=404, detail=f"Could not retrieve spot price for symbol {symbol}")

        # Get expirations
        expirations = list(ticker.options)
        if not expirations:
            return {
                "spot": spot,
                "expirations": [],
                "calls": [],
                "puts": [],
                "kingNode": None,
                "gammaFlip": None,
                "vannaFlip": None,
                "totalCallGex": 0,
                "totalPutGex": 0,
                "netGex": 0,
                "totalCallVex": 0,
                "totalPutVex": 0,
                "netVex": 0,
                "dealerBias": {
                    "overall": "N/A",
                    "gexRegime": "N/A",
                    "vexRegime": "N/A"
                }
            }
            
        # Default to the first expiration
        selected_exp = expiration if expiration in expirations else expirations[0]
        
        # Get option chain
        opt_chain = ticker.option_chain(selected_exp)
        
        # AUDIT M1 FIX: options expire 16:00 ET = 20:30 UTC; using midnight UTC caused ~8h
        # error in T for 0DTE. calcT equivalent in Python.
        exp_dt = datetime.strptime(selected_exp + "T20:30:00", "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        now_ms = datetime.now(timezone.utc).timestamp()
        exp_ms = exp_dt.timestamp()
        T = max(exp_ms - now_ms, 0) / (365.25 * 24 * 3600)
        if T <= 0:
            T = 1e-5
        
        # Risk-free rate (assumed 4.5% standard treasury yield)
        r = 0.045
        
        # ── AUDIT C4/C5 FIX: sanitizar IV ────────────────────────────────────────
        # Descartar contratos basura: bid=0 y OI=0 simultáneamente
        def is_junk(row_bid, row_oi):
            return row_bid == 0 and row_oi == 0

        # IV válida: rango [3%, 400%] en decimal [0.03, 4.0]
        # yahoo-finance2 ya entrega decimal; NO dividir por 100
        def sanitize_iv(iv_raw):
            if iv_raw is None or iv_raw != iv_raw:  # None o NaN
                return None
            iv = float(iv_raw)
            if iv < 0.03 or iv > 4.0:
                return None  # IV corrupta o ala extrema no confiable
            return iv

        calls_raw = []
        for _, row in opt_chain.calls.iterrows():
            strike = clean_value(row.get("strike"))
            iv_raw = clean_value(row.get("impliedVolatility"))
            oi     = int(clean_value(row.get("openInterest")))
            vol    = int(clean_value(row.get("volume")))
            bid    = clean_value(row.get("bid"))
            ask    = clean_value(row.get("ask"))
            if is_junk(bid, oi): continue
            iv = sanitize_iv(iv_raw)
            calls_raw.append({"strike": strike, "iv": iv, "iv_raw": iv_raw,
                               "oi": oi, "vol": vol, "bid": bid, "ask": ask})

        puts_raw = []
        for _, row in opt_chain.puts.iterrows():
            strike = clean_value(row.get("strike"))
            iv_raw = clean_value(row.get("impliedVolatility"))
            oi     = int(clean_value(row.get("openInterest")))
            vol    = int(clean_value(row.get("volume")))
            bid    = clean_value(row.get("bid"))
            ask    = clean_value(row.get("ask"))
            if is_junk(bid, oi): continue
            iv = sanitize_iv(iv_raw)
            puts_raw.append({"strike": strike, "iv": iv, "iv_raw": iv_raw,
                             "oi": oi, "vol": vol, "bid": bid, "ask": ask})

        # ── PARIDAD CALL/PUT: una sola IV por strike (contrato OTM) ──────────────
        # OTM call si strike > spot, OTM put si strike < spot, ATM usa la call
        call_iv_map = {c["strike"]: c["iv"] for c in calls_raw if c["iv"] is not None}
        put_iv_map  = {p["strike"]: p["iv"] for p in puts_raw  if p["iv"] is not None}

        def otm_iv(strike, is_call):
            """Devuelve la IV del contrato OTM en ese strike para paridad call/put."""
            if strike >= spot:
                # OTM es la CALL
                iv = call_iv_map.get(strike) or put_iv_map.get(strike)
            else:
                # OTM es la PUT
                iv = put_iv_map.get(strike) or call_iv_map.get(strike)
            return iv

        calls = []
        total_call_gex = 0.0

        for c in calls_raw:
            strike = c["strike"]
            iv = otm_iv(strike, True)
            if iv is None:
                iv = 0.0  # sin IV válida → gamma=0 (correcto: no inventar)
            oi  = c["oi"]
            gamma = calculate_gamma(spot, strike, T, r, iv)
            gex   = gamma * oi * (spot ** 2)
            total_call_gex += gex
            calls.append({
                "strike": strike,
                "impliedVolatility": c["iv_raw"],  # mostrar el valor original de Yahoo
                "openInterest": oi,
                "volume": c["vol"],
                "bid": c["bid"],
                "ask": c["ask"],
                "gamma": gamma,
                "gex": gex,
                "vanna": 0.0,
                "vex": 0,
                "ivSanitized": iv,   # IV usada en el cálculo (para debug)
                "ivValid": c["iv"] is not None
            })

        puts = []
        total_put_gex = 0.0

        for p in puts_raw:
            strike = p["strike"]
            iv = otm_iv(strike, False)
            if iv is None:
                iv = 0.0
            oi  = p["oi"]
            gamma = calculate_gamma(spot, strike, T, r, iv)
            gex   = -gamma * oi * (spot ** 2)
            total_put_gex += gex
            puts.append({
                "strike": strike,
                "impliedVolatility": p["iv_raw"],
                "openInterest": oi,
                "volume": p["vol"],
                "bid": p["bid"],
                "ask": p["ask"],
                "gamma": gamma,
                "gex": gex,
                "vanna": 0.0,
                "vex": 0,
                "ivSanitized": iv,
                "ivValid": p["iv"] is not None
            })
            
        # Combine GEX by strike to find the "King Node" (highest absolute GEX)
        strike_gex_map = {}
        for c in calls:
            strike_gex_map[c['strike']] = strike_gex_map.get(c['strike'], 0.0) + c['gex']
        for p in puts:
            strike_gex_map[p['strike']] = strike_gex_map.get(p['strike'], 0.0) + p['gex']
            
        king_node = None
        if strike_gex_map:
            king_node = max(strike_gex_map.keys(), key=lambda k: abs(strike_gex_map[k]))
            
        # Net GEX
        net_gex = total_call_gex + total_put_gex
        
        # AUDIT C7 FIX: use ivSanitized (not iv_raw) and return closest crossing to spot
        def get_net_gex_at_S(S_test):
            gex_sum = 0.0
            for c in calls:
                g = calculate_gamma(S_test, c['strike'], T, r, c['ivSanitized'])
                gex_sum += g * c['openInterest'] * (S_test ** 2)
            for p in puts:
                g = calculate_gamma(S_test, p['strike'], T, r, p['ivSanitized'])
                gex_sum -= g * p['openInterest'] * (S_test ** 2)
            return gex_sum

        spot_min = spot * 0.8
        spot_max = spot * 1.2
        steps = 40
        step_size = (spot_max - spot_min) / steps

        all_crosses = []
        s_prev = spot_min
        gex_prev = get_net_gex_at_S(s_prev)

        for i in range(1, steps + 1):
            s_curr = spot_min + i * step_size
            gex_curr = get_net_gex_at_S(s_curr)
            if (gex_prev < 0 and gex_curr >= 0) or (gex_prev > 0 and gex_curr <= 0):
                gex_left = gex_prev
                low_s = s_prev
                high_s = s_curr
                for _ in range(8):
                    mid_s = (low_s + high_s) / 2.0
                    gex_mid = get_net_gex_at_S(mid_s)
                    if gex_mid == 0:
                        low_s = mid_s
                        break
                    elif (gex_left < 0 and gex_mid < 0) or (gex_left > 0 and gex_mid > 0):
                        low_s = mid_s
                    else:
                        high_s = mid_s
                all_crosses.append((low_s + high_s) / 2.0)
            s_prev = s_curr
            gex_prev = gex_curr

        gamma_flip = min(all_crosses, key=lambda c: abs(c - spot)) if all_crosses else None

        return {
            "spot": spot,
            "expirations": expirations,
            "selectedExpiration": selected_exp,
            "calls": calls,
            "puts": puts,
            "kingNode": king_node,
            "gammaFlip": gamma_flip,
            "vannaFlip": None,
            "totalCallGex": total_call_gex,
            "totalPutGex": total_put_gex,
            "netGex": net_gex,
            "totalCallVex": 0,
            "totalPutVex": 0,
            "netVex": 0,
            "dealerBias": {
                "overall": "N/A",
                "gexRegime": "N/A",
                "vexRegime": "N/A"
            }
        }
    except Exception as e:
        # Prevent HTTP 500 errors by raising HTTP 400 Bad Request
        raise HTTPException(status_code=400, detail=f"API options retrieval error: {str(e)}")
