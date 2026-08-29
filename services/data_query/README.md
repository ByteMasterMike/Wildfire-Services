# Data query service

FastAPI read API over the `wildfire` PostGIS schema.

## Run

```bash
# DB up + loaded first
docker compose up -d
python -m db.loaders

# PowerShell
$env:PYTHONPATH = "."
uvicorn services.data_query.app:app --reload --app-dir .
```

Open http://localhost:8000/docs

Connection settings come from repo-root `.env` via `shared/db.py` (default port **5433**).

## Endpoints (summary)

| Path | Notes |
|------|--------|
| `GET /health` | DB ping + table counts |
| `GET /ignitions` | CPUC combined; `county=` is Census name from point-in-polygon |
| `GET /us-ignitions` | FireCastRL CONUS all-cause sample (CA-heavy: ≈40% overall / ≈59% of 2024); year/date/bbox; **no state/utility** (400) |
| `GET /epss/outages` | PGE-only; paginated |
| `GET /psps/events` | Event polygons |
| `GET /psps/events/{event_name}/circuits` | `{event_name:path}` so names like `PGE PSPS Event 10/11/21` work; orphans return `geometry: null` |
| `GET /calfire/incidents` | Default types `Wildfire`,`Fire` only; `incident_type=untyped\|all` |
| `GET /circuits` / `GET /circuits/{id}` | |
| `GET /hftd` | Tier filter optional |
| `GET /iou-territories` | |
| `GET /spatial/point` | IOU + HFTD + grid cell + county (Census TIGER PIP) |
| `GET /spatial/summary` | Counts inside utility **or** HFTD polygon |
| `GET /rank` | Single-dataset top-N (`group_by=county\|utility\|circuit`, `metric=count\|acres_burned`, default limit 10, cap 25). Ties at the cutoff are included. Not US-by-state or EPSS-by-utility. |

Common query params: `utility`, `year`, `start_date`, `end_date`, `bbox`, `format=json|geojson`, `geometry=true|false`, `limit`, `offset`.

Special tokens: `utility=untagged`, `incident_type=untyped`, `include_untagged=true`.

Year-to-year CAL FIRE **count** comparisons are the incident-map feed, not the Redbook census (2023→2024 listed 133→611 is a posting-threshold drop, not occurrence; median acres 70→43). Warehouse acres still track Redbook ~95–97%. See [`analysis/calfire-2024-jump.md`](../../analysis/calfire-2024-jump.md).

## Ignition counts: attribute vs spatial

| Question style | Endpoint / filter | Definition |
|----------------|-------------------|------------|
| “Tagged as PGE” | `/ignitions?utility=PGE` | `utility` column |
| “Inside PGE territory” | `/spatial/summary?utility=PGE` | `ST_Within` IOU polygon |

For **PGE 2024** these are **532** (attribute) vs **536** (spatial). The gap is points inside the polygon without a PGE tag. Document which definition you use when answering agents or stakeholders.
