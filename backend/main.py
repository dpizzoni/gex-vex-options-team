from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import math
from datetime import datetime, date

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
        
        # Calculate time to maturity in years (T)
        exp_date = datetime.strptime(selected_exp, "%Y-%m-%d").date()
        today_date = date.today()
        days_to_expiration = max((exp_date - today_date).days, 0.5) # assume min 0.5 days for today's expiration
        T = days_to_expiration / 365.25
        
        # Risk-free rate (assumed 4.5% standard treasury yield)
        r = 0.045
        
        calls = []
        total_call_gex = 0.0
        
        for _, row in opt_chain.calls.iterrows():
            strike = clean_value(row.get("strike"))
            iv = clean_value(row.get("impliedVolatility"))
            oi = int(clean_value(row.get("openInterest")))
            vol = int(clean_value(row.get("volume")))
            bid = clean_value(row.get("bid"))
            ask = clean_value(row.get("ask"))
            
            gamma = calculate_gamma(spot, strike, T, r, iv)
            # GEX = Gamma * OpenInterest * Spot^2
            gex = gamma * oi * (spot ** 2)
            total_call_gex += gex
            
            calls.append({
                "strike": strike,
                "impliedVolatility": iv,
                "openInterest": oi,
                "volume": vol,
                "bid": bid,
                "ask": ask,
                "gamma": gamma,
                "gex": gex,
                "vanna": 0.0,
                "vex": 0
            })
            
        puts = []
        total_put_gex = 0.0
        
        for _, row in opt_chain.puts.iterrows():
            strike = clean_value(row.get("strike"))
            iv = clean_value(row.get("impliedVolatility"))
            oi = int(clean_value(row.get("openInterest")))
            vol = int(clean_value(row.get("volume")))
            bid = clean_value(row.get("bid"))
            ask = clean_value(row.get("ask"))
            
            gamma = calculate_gamma(spot, strike, T, r, iv)
            # Puts GEX is negative
            gex = -gamma * oi * (spot ** 2)
            total_put_gex += gex
            
            puts.append({
                "strike": strike,
                "impliedVolatility": iv,
                "openInterest": oi,
                "volume": vol,
                "bid": bid,
                "ask": ask,
                "gamma": gamma,
                "gex": gex,
                "vanna": 0.0,
                "vex": 0
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
        
        # Calculate Gamma Flip price level
        def get_net_gex_at_S(S_test):
            gex_sum = 0.0
            for c in calls:
                g = calculate_gamma(S_test, c['strike'], T, r, c['impliedVolatility'])
                gex_sum += g * c['openInterest'] * (S_test ** 2)
            for p in puts:
                g = calculate_gamma(S_test, p['strike'], T, r, p['impliedVolatility'])
                gex_sum -= g * p['openInterest'] * (S_test ** 2)
            return gex_sum

        gamma_flip = None
        spot_min = spot * 0.8
        spot_max = spot * 1.2
        steps = 40
        step_size = (spot_max - spot_min) / steps
        
        s_prev = spot_min
        gex_prev = get_net_gex_at_S(s_prev)
        
        for i in range(1, steps + 1):
            s_curr = spot_min + i * step_size
            gex_curr = get_net_gex_at_S(s_curr)
            if (gex_prev < 0 and gex_curr >= 0) or (gex_prev > 0 and gex_curr <= 0):
                low_s = s_prev
                high_s = s_curr
                for _ in range(8):
                    mid_s = (low_s + high_s) / 2.0
                    gex_mid = get_net_gex_at_S(mid_s)
                    if gex_mid == 0:
                        low_s = mid_s
                        break
                    elif (gex_prev < 0 and gex_mid < 0) or (gex_prev > 0 and gex_mid > 0):
                        low_s = mid_s
                    else:
                        high_s = mid_s
                gamma_flip = (low_s + high_s) / 2.0
                break
            s_prev = s_curr
            gex_prev = gex_curr

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
