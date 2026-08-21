# Wildfire policy agent prototype

Feasibility harness for routing one trusted user's natural-language question to
the four read-only backend services. It is an API experiment, not a production
chat product.

## Architecture boundary

The deterministic tier handles only high-confidence requests whose operation,
dataset/metric, scope, and required time/location slots are explicit:

- filtered count/list → `data_query_records`
- coordinate context → `data_query_spatial`
- map/time series/detail → a visualization tool
- fully specified utility/region/period comparison → `comparison_run`
- explicit cell/date, coordinate/date, county/date, or utility/date risk → `risk_forecast` chain
- known unavailable domains (CPZ, cost, optimization, damage, live web) → refusal
- missing risk metric, location, region definition, or time → clarification

Compositions, cross-dataset questions, and requests not matching those strict
rules go to the model. Every response logs `path`, `rule`, and tool trajectory.

## Six grouped tools

| Tool | Responsibility |
|---|---|
| `data_query_records` | Filtered counts and small record samples |
| `data_query_spatial` | Point context or one polygon-contained summary |
| `visualization_create` | Map layer or time series |
| `visualization_inspect` | Utility territory or one event/circuit detail |
| `risk_forecast` | Historical fitted place/date risk (cell, point, county, or PGE/SCE/SDGE) |
| `comparison_run` | Utility, HFTD/county, or period comparison |

Pydantic validates all arguments before HTTP execution. Tool errors contain a
stable code, `recoverable`, suggested action, and field errors. Backend HTTP 200
responses are contract-checked so partial data cannot silently degrade into an
answer. Full payloads are stored in a bounded 15-minute artifact store; only
summaries enter model context.

## Deterministic qualifications

The caveat engine reads response metadata and may issue qualification-only
companion calls:

- Every utility-scoped CPUC ignition count is paired with the same-period
  spatial containment count, for any utility (not only PG&E).
- CAL FIRE answers report missing incident-type and utility-tag counts.
- US ignition answers state that the CA-heavy FireCastRL data is a sample, not
  a census, and is not comparable to CPUC.
- EPSS answers state that warehouse coverage is PG&E-only.

If a required companion call or metadata field fails, the primary result is
suppressed rather than returned without its qualification.

## Run

Start the four backend services on ports 8000–8003, then:

```powershell
$env:PYTHONPATH = "."
$env:PYTHONIOENCODING = "utf-8"
uvicorn services.agent.app:app --port 8004 --app-dir .
```

- `GET /health`
- `POST /ask` with `{"question":"How many PG&E ignitions were there in 2024?"}`
- `GET /artifacts/{ref}` for a non-expired full backend payload

The service is single-exchange: it stores no conversation history.

## Evaluation

The 27 cases cover single-service, multi-service, required caveats,
clarifications/refusals, recovery, and partial-HTTP-200 detection. Any subset of
the eight matrix cells can be selected:

```powershell
python -m services.agent.eval.runner `
  --models qwen3:4b,qwen3:8b `
  --thinking off,on `
  --modes prompt,constrained
```

Initial staged baseline only:

```powershell
python -m services.agent.eval.runner `
  --models qwen3:4b --thinking off --modes prompt
```

Use `--case-ids id1,id2` for focused development. Results are written to
`eval/REPORT.md`, `summary.json`, `summary.csv`, and per-case gzip raw logs.

The stop gate is **50% model-tier routing accuracy**, evaluated separately from
deterministic bypasses after at least five model-tier cases. Below the gate, the
runner stops before subsequent selected cells.

## Ollama limitations

Ollama's OpenAI-compatible endpoint does not support `tool_choice`; the harness
cannot force a tool call. Evaluation therefore records no-tool responses and
valid direct-answer attempts before evidence. The harness blocks either from
becoming a factual answer.

The installed Qwen3 model template forces a thinking prefix even when
`reasoning_effort=none`. For the thinking-off cell, startup creates an
idempotent template-only `*-agent-nothink` alias that uses the exact base
weights and closes the thinking block before generation. Requests still go
through `/v1/chat/completions`; reports retain the base model name.
