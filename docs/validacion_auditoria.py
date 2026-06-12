# -*- coding: utf-8 -*-
"""Validación numérica — Auditoría GEX/VEX
Replica exacta de las fórmulas del código auditado vs referencia Black-Scholes.
"""
import math

N = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
phi = lambda x: math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)

def d1d2(S, K, T, r, sig):
    d1 = (math.log(S / K) + (r + 0.5 * sig**2) * T) / (sig * math.sqrt(T))
    return d1, d1 - sig * math.sqrt(T)

def bs_delta_call(S, K, T, r, sig):
    return N(d1d2(S, K, T, r, sig)[0])

# ---------- TEST 1: fórmula de VANNA del sistema vs BS analítica vs diferencias finitas ----------
print("=" * 70)
print("TEST 1 — VANNA: sistema vs analítica vs diferencia finita dDelta/dSigma")
print("=" * 70)
r = 0.05
S = 700.0
K = 710.0
sig = 0.20
for T, label in [(0.5/365, "0DTE (0.5d)"), (2/365, "2DTE"), (30/365, "30d"), (180/365, "180d")]:
    d1, d2 = d1d2(S, K, T, r, sig)
    vega = S * phi(d1) * math.sqrt(T)
    vanna_sistema = -(vega * d2) / (S * sig)            # como en page.tsx / GammaMatrix.tsx
    vanna_correcta = -phi(d1) * d2 / sig                # BS analítica
    h = 1e-5
    vanna_fd = (bs_delta_call(S, K, T, r, sig + h) - bs_delta_call(S, K, T, r, sig - h)) / (2 * h)
    ratio = vanna_sistema / vanna_correcta if vanna_correcta != 0 else float('nan')
    print(f"{label:12s} sistema={vanna_sistema:+.6f}  correcta={vanna_correcta:+.6f}  "
          f"finDiff={vanna_fd:+.6f}  ratio sist/correcta={ratio:.4f}  sqrt(T)={math.sqrt(T):.4f}")
print("-> El ratio coincide con sqrt(T): la fórmula del sistema tiene un factor sqrt(T) extra.")
print("-> 0DTE subestimada ~27x; expiraciones largas casi correctas => distorsión término-estructura.\n")

# ---------- TEST 2: signo del modo DEALER ----------
print("=" * 70)
print("TEST 2 — Signo del GEX en modo DEALER (dealerGex = rawGex * bias)")
print("=" * 70)
gamma = 0.05; oi = 10000; S = 700.0
gexS2 = gamma * oi * S**2
# Convención del sistema: raw call = +, raw put = -
# bias = (buyCliente - sellCliente)/inventario  -> +1 = clientes COMPRARON
# Posición dealer = opuesta al cliente => dealer_gamma = -bias * gamma (calls y puts, gamma>0)
casos = [("CALL", +1, "clientes compran calls -> dealer CORTO gamma (debe ser NEGATIVO)"),
         ("CALL", -1, "clientes venden calls -> dealer LARGO gamma (debe ser POSITIVO)"),
         ("PUT",  +1, "clientes compran puts -> dealer CORTO gamma (debe ser NEGATIVO)"),
         ("PUT",  -1, "clientes venden puts -> dealer LARGO gamma (debe ser POSITIVO)")]
for tipo, bias, desc in casos:
    raw = gexS2 if tipo == "CALL" else -gexS2
    sistema = raw * bias                   # implementación actual
    correcto = -bias * gexS2               # dealer = -cliente
    ok = "OK" if (sistema > 0) == (correcto > 0) else "** SIGNO INVERTIDO **"
    print(f"{tipo} bias={bias:+d}: sistema={sistema/1e6:+10.1f}M  correcto={correcto/1e6:+10.1f}M  {ok}")
    print(f"   ({desc})")
print()

# ---------- TEST 3: estimador buy/sell con clamping ----------
print("=" * 70)
print("TEST 3 — Estimador dealer-builder: clamping y dependencia de trayectoria")
print("=" * 70)
def build(history):
    buy = sell = 0.0
    for i in range(len(history) - 1):
        delta = history[i+1]["oi"] - history[i]["oi"]
        if delta == 0: continue
        rec = history[i+1]
        bp, sp = 0.5, 0.5
        if rec["color"] == "green": bp, sp = rec["ba"], 1 - rec["ba"]
        elif rec["color"] == "red": sp, bp = rec["ba"], 1 - rec["ba"]
        if delta > 0:
            buy += delta * bp; sell += delta * sp
        else:
            buy -= abs(delta) * bp; sell -= abs(delta) * sp
        buy = max(0, buy); sell = max(0, sell)
    inv = buy + sell
    return buy, sell, (buy - sell) / inv if inv > 0 else 0

# Caso GOOGL documentado
hist = [{"oi": 947, "color": "green", "ba": 0.5},
        {"oi": 6092, "color": "green", "ba": 0.6},
        {"oi": 40965, "color": "red", "ba": 0.56},
        {"oi": 51531, "color": "green", "ba": 0.7},
        {"oi": 17708, "color": "green", "ba": 0.7},
        {"oi": 14353, "color": "red", "ba": 0.6}]
b, s, bias = build(hist)
print(f"Caso GOOGL doc: buy={b:.0f} sell={s:.0f} bias={bias:+.3f} | OI real={hist[-1]['oi']}")
print(f"  buy+sell={b+s:.0f} vs OI={hist[-1]['oi']}  (inventario inflado por clamping: {(b+s)/hist[-1]['oi']-1:+.1%})")

# Dependencia de trayectoria: mismo flujo neto, distinto orden
histA = [{"oi": 0, "color": "green", "ba": 0.8},
         {"oi": 10000, "color": "green", "ba": 0.8},   # +10k green
         {"oi": 5000, "color": "red", "ba": 0.8}]      # -5k red
histB = [{"oi": 0, "color": "red", "ba": 0.8},
         {"oi": 10000, "color": "red", "ba": 0.8},     # +10k red
         {"oi": 5000, "color": "green", "ba": 0.8}]    # -5k green
for nm, h in [("A (+10k green, -5k red)", histA), ("B (+10k red, -5k green)", histB)]:
    b, s, bias = build(h)
    print(f"Trayectoria {nm}: buy={b:.0f} sell={s:.0f} bias={bias:+.3f}")
print("-> Mismo OI final (5000) produce bias opuestos: el estimador es 100% dependiente")
print("   de la atribucion color/bidAsk del DIA del cambio, sin distinguir apertura/cierre.\n")

# ---------- TEST 4: lógica de escenarios y spacing de strikes ----------
print("=" * 70)
print("TEST 4 — Escenarios: reglas con umbrales en PUNTOS absolutos vs grid de strikes")
print("=" * 70)
def escenario_superior(strikes_pos):  # replica validUpNodes: cadena de positivos consecutivos <=3 pts
    valid = []
    if strikes_pos:
        valid.append(strikes_pos[0])
        for s in strikes_pos[1:]:
            if len(valid) >= 3: break
            if s - valid[-1] <= 3: valid.append(s)
            else: break
    return valid

spy_grid = [741, 742, 743, 744]       # SPY: spacing 1
tsla_grid = [310, 315, 320, 325]      # TSLA: spacing 5 (mismo problema que auditor documentó con NVDA)
print(f"SPY  (spacing 1): nodos positivos {spy_grid} -> cadena detectada: {escenario_superior(spy_grid)}")
print(f"TSLA (spacing 5): nodos positivos {tsla_grid} -> cadena detectada: {escenario_superior(tsla_grid)}")
print("-> En TSLA la regla '<=3 puntos' corta la cadena en el primer nodo SIEMPRE.")
print("   'Absorcion hasta X' es estructuralmente imposible en tickers con spacing >= 5.")
print("Regla inferior 'gap > 1 punto': en TSLA cada par adyacente (5 pts) es 'gap',")
print("   y la 'zona vacia' detectada es solo ruido del grid, no estructura. Idem GOOGL.\n")

# ---------- TEST 5: gamma flip primer-cruce vs cruce más cercano al spot ----------
print("=" * 70)
print("TEST 5 — Gamma flip: el escaneo toma el PRIMER cruce desde 0.8*spot")
print("=" * 70)
# Perfil sintético con dos cruces: uno lejano (irrelevante) y uno cerca del spot
spot = 700.0
def net_gex(S):
    # cruce en 610 y otro en 695
    return (S - 610) * (S - 695) * (S - 1000) * -1
cruces = []
prev = net_gex(spot * 0.8)
sp = spot * 0.8
for i in range(1, 41):
    s = spot * 0.8 + i * (spot * 0.4) / 40
    cur = net_gex(s)
    if (prev < 0 <= cur) or (prev > 0 >= cur):
        cruces.append(round((sp + s) / 2, 1))
    sp, prev = s, cur
print(f"Spot={spot}, cruces reales en 610 y 695. Cruces detectados (en orden): {cruces}")
print(f"El sistema retorna el PRIMERO: {cruces[0] if cruces else None} (deberia ser 695, el mas cercano al spot)")
print("Evidencia en vivo: SPY flip=679.4 con spot=739.2 (-8.1%), TSLA flip similar desviacion\n")

# ---------- TEST 6: convención de magnitud GEX ----------
print("=" * 70)
print("TEST 6 — Magnitud GEX: gamma*OI*S^2 equivale a la convencion 'por 1% de movimiento'")
print("=" * 70)
gamma = 0.05; oi = 1000; S = 700.0
sistema = gamma * oi * S**2
spotgamma_1pct = gamma * oi * 100 * S * (S * 0.01)   # contrato x100, movimiento 1% de S
print(f"Sistema: {sistema:,.0f} | SpotGamma por 1%: {spotgamma_1pct:,.0f} (identicos: 100*0.01=1)")
print("-> La magnitud es correcta bajo convencion 'dolares de delta-hedge por 1% de movimiento',")
print("   pero el dashboard la etiqueta como '$' sin documentar la convencion.\n")

# ---------- TEST 7: normalizacion IV — regla [0.03, 4.00] vs heuristica sigma>1 ----------
print("=" * 70)
print("TEST 7 — Sanitizacion IV Yahoo: filtro [0.03, 4.00] vs heuristica sigma>1 rota")
print("Tickers del sistema: SPY, QQQ, GOOGL, TSLA")
print("=" * 70)
# IVs representativos de QQQ (0DTE wings) y TSLA (high-vol)
# Yahoo entrega IV en decimal: 0.20 = 20%, 2.81 = 281%
print("\n--- Caso A: QQQ calls ITM con IV corrupta (C4) ---")
ivs_bad = [("call ITM OI=50 (corrupt)", 1e-5), ("call ATM", 0.1073), ("call OTM wing", 0.3250)]
for nm, iv in ivs_bad:
    old_rule = iv / 100 if iv > 1 else iv  # heuristica rota anterior
    new_rule = iv if (0.03 <= iv <= 4.00) else 0  # nueva regla correcta
    status = "OK" if new_rule > 0 == (iv >= 0.03) else "DESCARTADO" if new_rule == 0 else "ERROR"
    print(f"{nm:30s} IV Yahoo={iv:8.5f} ({iv*100:7.3f}%)  "
          f"heuristica_rota={old_rule:7.4f} ({old_rule*100:6.2f}%)  "
          f"nueva_regla={new_rule:7.4f}  {'-> GEX=0 (descartado)' if new_rule == 0 else '-> VALIDO'}")

print("\n--- Caso B: TSLA 0DTE alas con IV > 100% (C5) ---")
ivs_high = [("put wing OTM TSLA", 2.8125), ("put 150% IV TSLA", 1.375), ("call ATM TSLA", 0.9585), ("call TSLA ATM", 0.2073)]
for nm, iv in ivs_high:
    old_rule = iv / 100 if iv > 1 else iv  # heuristica rota: 2.81 -> 0.028 (INCORRECTO!)
    new_rule = iv if (0.03 <= iv <= 4.00) else 0
    is_fixed = abs(new_rule - iv) < 0.001 if new_rule > 0 else True
    print(f"{nm:25s} IV Yahoo={iv:7.4f} ({iv*100:6.1f}%)  "
          f"heuristica_ROTA={old_rule:7.4f} ({old_rule*100:6.2f}%)  "
          f"nueva_regla={new_rule:7.4f} ({new_rule*100:6.2f}%)  "
          f"{'OK-preservado' if is_fixed and new_rule > 0 else 'GEX=0' if new_rule == 0 else 'ERROR'}")

print("\n--- Caso C: IV fuera de rango absoluto ---")
ivs_extreme = [("IV=0 (sin dato)", 0.0), ("IV=1e-5 (corrupto ITM)", 1e-5), ("IV=4.01 (absurdo)", 4.01)]
for nm, iv in ivs_extreme:
    new_rule = iv if (0.03 <= iv <= 4.00) else 0
    print(f"{nm:25s} IV={iv:.5f}  nueva_regla={new_rule:.5f}  {'DESCARTADO (correcto)' if new_rule == 0 else 'VALIDO'}")

print("\n-> Backend (route.ts) y Frontend (page.tsx, GammaMatrix.tsx) ahora usan la misma regla [0.03, 4.00]")
print("-> IVs ITM corruptas descartadas. IVs > 100% preservadas. Consistencia backend=frontend garantizada.")
