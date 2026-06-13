# Auditoría GEX/VEX — Archivos para Re-Auditoría

**Generado**: 12-jun-2026  
**Estado del sistema**: Post-correcciones completas (13 ítems aplicados)  
**Propósito**: Validar con datos en vivo (mercado abierto) que las correcciones funcionan correctamente.

---

## Contexto

El sistema fue auditado el 11-jun-2026. Se encontraron errores críticos en:
- Fórmula Vanna (subestimaba VEX ~27× en 0DTE)
- Signo dealer en calls (invertido en 100% de casos)
- IV de Yahoo sin sanitizar (contratos con IV=1e-5 → GEX=0)
- Gamma Flip retornaba primer cruce en lugar del más cercano al spot
- T calculado con medianoche UTC en lugar de 16:00 ET (error ~8h en 0DTE)

Todos los errores fueron corregidos. Esta carpeta contiene el código **post-corrección**.

---

## Archivos incluidos

| Archivo | Descripción |
|---------|-------------|
| `backend/main.py` | FastAPI — T corregido (20:30 UTC), IV sanitizada, gamma flip cercano al spot |
| `src/lib/gex-engine.ts` | Motor único: `RISK_FREE_RATE=0.045`, `calcT()`, `calcGamma()`, `calcVanna()`, `findGammaFlip()` |
| `src/app/api/options/route.ts` | API route Next.js — usa gex-engine, paridad call/put OTM |
| `src/app/api/snapshots/route.ts` | Persistencia server-side: EMA con half-life 45min |
| `src/app/components/GammaMatrix.tsx` | Matriz VEX — usa calcVanna() del motor compartido |
| `src/app/page.tsx` | Frontend principal — Risk V2, métricas invariantes a zoom, presión VEX/GEX |
| `scripts/dealer-builder.js` | Estimador buy/sell — sin path dependency, cierres proporcionales |

---

## Qué validar con el mercado abierto

1. **Vanna / VEX**: Con IV real y T correcto, verificar que VEX Matrix muestre valores coherentes (no ~0 en ITM)
2. **Gamma Flip**: Debe aparecer cerca del spot actual, no a −8/−19% de distancia
3. **0DTE (viernes)**: T debe ser horas reales (ej. 0.03 años a las 10am), no 0.5 días
4. **King Node DEALER vs RAW**: Con datos UW frescos, verificar que el signo sea opuesto al cliente
5. **Risk Score**: Con spot cerca de King positivo → score BAJO (pin), no alto

---

## Instrucciones para el auditor

```
Soy el auditor. Los archivos en claude_audit_files/ son el código post-corrección.
Quiero validar con datos en vivo del mercado de hoy que las 6 correcciones críticas
funcionan correctamente. Por favor auditá con énfasis en:
- Vanna/VEX en 0DTE vs 30DTE
- Gamma Flip en SPY y QQQ
- Risk Score en escenario pin (spot ≈ King positivo)
```
