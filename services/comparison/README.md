# Comparison service

Cross-utility / region / period metric aggregates for the wildfire warehouse.

## Run

```powershell
cd "C:\AI Coding Projects\Wildfire Services"
$env:PYTHONPATH = "."
uvicorn services.comparison.app:app --port 8003 --app-dir .
```

Docs: http://127.0.0.1:8003/docs

## Endpoints

| Path | Purpose |
|------|---------|
| `GET /health` | DB ping + metric/definition notes |
| `GET /compare-utilities` | Metric per utility |
| `GET /compare-regions` | Metric per county or HFTD tier |
| `GET /compare-periods` | Same scope, two date ranges + delta |

### Metrics

`ignition_count`, `epss_outage_count`, `epss_to_ignition_ratio`, `calfire_incident_count`, `acres_burned`, `psps_event_count`, `customers_deenergized`

### Normalization

`normalize=none|per_circuit|per_km2` — response always labels which form was returned (`value`, `raw_value`, `denominator`). Unavailable denominators → `value: null` + `reason` (never a silent zero). The map UI must draw a **hatched placeholder** for those bars, not an empty axis plus a floating “no data” (see [`frontend/CANVAS.md`](../../frontend/CANVAS.md)).

### Definitions

- **Ignitions:** `ignition_definition=attribute` (default for utilities) or `spatial` (`ST_Within`; default for HFTD).
- **EPSS:** PG&E-only. Non-PGE → `null` + reason.
- **CAL FIRE:** `Wildfire` / `Fire` only.
- **County:** attribute on EPSS/CAL FIRE; CPUC ignitions use load-time Census PIP `county`. PSPS still has no county column → null + reason. County `per_km2` is not wired yet (`REASON_NO_COUNTY_AREA`) even though `wildfire.counties` now exists.
- **No CPZ** in this warehouse.
