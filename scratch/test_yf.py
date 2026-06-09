import yfinance as yf
import json

symbol = "SPY"
print(f"Fetching data for {symbol}...")
ticker = yf.Ticker(symbol)

# Get spot
hist = ticker.history(period="1d")
spot = float(hist['Close'].iloc[-1]) if not hist.empty else None
print(f"Spot price: {spot}")

# Get expirations
expirations = ticker.options
print(f"Expirations count: {len(expirations)}")
if expirations:
    first_exp = expirations[0]
    print(f"First expiration: {first_exp}")
    
    # Get option chain
    opt = ticker.option_chain(first_exp)
    
    # Print columns
    print("Calls columns:", list(opt.calls.columns))
    
    # Show first call record
    if not opt.calls.empty:
        first_call = opt.calls.iloc[0].to_dict()
        print("First call data:", json.dumps(first_call, indent=2))
else:
    print("No expirations found")
