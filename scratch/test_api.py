import sys
import json
import traceback
from fastapi.testclient import TestClient
from backend.main import app

try:
    client = TestClient(app)
    response = client.get("/api/options?symbol=SPY")
    print("STATUS:", response.status_code)
    if response.status_code != 200:
        print("RESPONSE:", response.text)
    else:
        print("SUCCESS")
except Exception as e:
    traceback.print_exc()
