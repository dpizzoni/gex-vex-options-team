import json
import traceback
from backend.main import get_options

try:
    data = get_options("SPY", None)
    # Simulate FastAPI json serialization
    json_str = json.dumps(data)
    print("SUCCESS")
except Exception as e:
    traceback.print_exc()
