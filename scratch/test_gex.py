import yfinance as yf
import math
from datetime import datetime, date

def calculate_gamma(S, K, T, r, sigma):
    if T <= 0:
        T = 1e-5
    if sigma <= 0:
        sigma = 1e-5
    d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    pdf = math.exp(-0.5 * d1**2) / math.sqrt(2.0 * math.pi)
    gamma = pdf / (S * sigma * math.sqrt(T))
    return gamma

symbol = "SPY"
ticker = yf.Ticker(symbol)
hist = ticker.history(period="1d")
spot = float(hist['Close'].iloc[-1])
expirations = ticker.options
selected_exp = expirations[0]

exp_date = datetime.strptime(selected_exp, "%Y-%m-%d").date()
today_date = date.today()
days_to_expiration = max((exp_date - today_date).days, 0.5)
T = days_to_expiration / 365.25
r = 0.045

opt_chain = ticker.option_chain(selected_exp)

# Process calls
calls_data = []
for _, row in opt_chain.calls.iterrows():
    strike = row['strike']
    oi = row['openInterest'] if not math.isnan(row['openInterest']) else 0
    vol = row['volume'] if not math.isnan(row['volume']) else 0
    iv = row['impliedVolatility'] if not math.isnan(row['impliedVolatility']) else 0
    gamma = calculate_gamma(spot, strike, T, r, iv)
    # GEX = Gamma * OI * 100 * Spot^2 * 0.01 = Gamma * OI * Spot^2
    gex = gamma * oi * (spot ** 2)
    calls_data.append({"strike": strike, "gamma": gamma, "gex": gex, "oi": oi})

# Process puts
puts_data = []
for _, row in opt_chain.puts.iterrows():
    strike = row['strike']
    oi = row['openInterest'] if not math.isnan(row['openInterest']) else 0
    vol = row['volume'] if not math.isnan(row['volume']) else 0
    iv = row['impliedVolatility'] if not math.isnan(row['impliedVolatility']) else 0
    gamma = calculate_gamma(spot, strike, T, r, iv)
    # Put GEX is negative
    gex = -gamma * oi * (spot ** 2)
    puts_data.append({"strike": strike, "gamma": gamma, "gex": gex, "oi": oi})

# Combine to find King Node (highest absolute GEX)
all_gex = {}
for c in calls_data:
    all_gex[c['strike']] = all_gex.get(c['strike'], 0) + c['gex']
for p in puts_data:
    all_gex[p['strike']] = all_gex.get(p['strike'], 0) + p['gex']

king_node_strike = max(all_gex.keys(), key=lambda k: abs(all_gex[k]))
king_node_val = all_gex[king_node_strike]

print(f"Spot: {spot}")
print(f"King Node: Strike {king_node_strike} with GEX {king_node_val}")

# Calculate Gamma Flip price level
# We scan S from spot * 0.8 to spot * 1.2, in steps of 0.5
s_range = []
spot_min = spot * 0.8
spot_max = spot * 1.2
steps = 200
step_size = (spot_max - spot_min) / steps

# Compile all strikes, OIs, IVs
contracts = [] # (strike, type, oi, iv)
for c in calls_data:
    contracts.append((c['strike'], "CALL", c['oi'], c['oi'] * 0.01 * 100)) # wait, we can just store the raw values
# Let's write a helper to calculate net GEX at a given S
def get_net_gex(S_test):
    net_gex = 0
    for c in opt_chain.calls.itertuples():
        iv = c.impliedVolatility if not math.isnan(c.impliedVolatility) else 0
        oi = c.openInterest if not math.isnan(c.openInterest) else 0
        gamma = calculate_gamma(S_test, c.strike, T, r, iv)
        net_gex += gamma * oi * (S_test ** 2)
    for p in opt_chain.puts.itertuples():
        iv = p.impliedVolatility if not math.isnan(p.impliedVolatility) else 0
        oi = p.openInterest if not math.isnan(p.openInterest) else 0
        gamma = calculate_gamma(S_test, p.strike, T, r, iv)
        net_gex -= gamma * oi * (S_test ** 2)
    return net_gex

# Let's search for the crossing point
s_prev = spot_min
gex_prev = get_net_gex(s_prev)
gamma_flip = None

for i in range(1, steps + 1):
    s_curr = spot_min + i * step_size
    gex_curr = get_net_gex(s_curr)
    if (gex_prev < 0 and gex_curr >= 0) or (gex_prev > 0 and gex_curr <= 0):
        # Linearly interpolate to find exact flip price
        ratio = abs(gex_prev) / (abs(gex_prev) + abs(gex_curr))
        gamma_flip = s_prev + ratio * (s_curr - s_prev)
        break
    s_prev = s_curr
    gex_prev = gex_curr

print(f"Gamma Flip: {gamma_flip}")
