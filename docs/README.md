# GitHub Pages UI (`docs/`)

Public map + Ask surface for [Wildfire Services](https://github.com/ByteMasterMike/Wildfire-Services). This folder is what GitHub Pages serves. **Planning Tool is not in this copy** — the map is the only view. Local development that still needs the Planning Tool uses [`frontend/`](../frontend/README.md) and `python frontend/serve.py`.

`.nojekyll` must stay in this folder so Pages does not strip asset paths.

## Serve a local preview of this copy

Do not use `python frontend/serve.py` to check Pages-only UI — that serves `frontend/`. From `docs/`:

```powershell
cd "C:\AI Coding Projects\Wildfire Services\docs"
python -m http.server 8770
```

Open http://127.0.0.1:8770/

After JS/CSS edits, bump the `?v=` query strings on `sect-fasttrip-psps.js` / `.css` in `index.html` so Pages does not keep a stale bundle.

## APIs

[`assets/js/api-config.js`](assets/js/api-config.js) points visualization, agent, and GPU control at CloudFront `/api/...` prefixes. `WILDFIRE_DATA_QUERY_BASE` is still `http://127.0.0.1:8000` (record-table refetch from Pages cannot reach a private warehouse).

```js
window.WILDFIRE_API_BASE = "https://d3t70p3if3twy3.cloudfront.net/api/visualization";
window.WILDFIRE_AGENT_BASE = "https://d3t70p3if3twy3.cloudfront.net/api/agent";
window.WILDFIRE_GPU_CONTROL_BASE = "https://d3t70p3if3twy3.cloudfront.net/api/gpu-control";
window.WILDFIRE_CALFIRE_INCIDENT_TYPE = ""; // omit → API default Wildfire+Fire
```

HDWI animation stays local (`assets/data/weather_anim/`). If `/health` or layer fetches fail, a banner appears above the map — the map will not silently stay blank.

## Map-only canvas

Canvas CSS/JS stays scoped to `#sfps-tab-historical` / `#historical-canvas-host`. Collapsible **Data sources** is in the page footer.

Working contract for the agent-driven left surface: [`CANVAS.md`](CANVAS.md). The Planning Tool verification step in that file applies to [`frontend/`](../frontend/README.md) only — this Pages copy has no Planning Tool tab. Preview here with `python -m http.server` from `docs/`.

**Asked series** (Ask canvas) and browse **Events over time** (Time / Bar / Donut) share one Plotly node but not one resize path. Asked series fills its container (`autosize: true`). Browse uses a fixed 380px host, `autosize: false`, and a date axis pinned to the selected calendar year. Running `Plotly.Plots.resize` on the Plotly node itself after the asked-series fill work blanks Bar/Donut and can stretch Time’s axis — that isolation is intentional.

## US Ignitions

Toggle **US Ignitions (IRWIN / all-cause)** is off by default. Markers, clusters, the layer swatch, the info-strip, and the Events-over-time series use red **`#dc2626`**, matching visualization `style.color`. FireCastRL is an all-cause event-window sample, not a census, not comparable to CPUC or CAL FIRE, and California-heavy (~40% overall / ~59% of 2024). Auto-zoom to CONUS only from the default California view with no utility/county filter; **Zoom to national extent** is on the strip.

One hue per dataset: CPUC burnt orange, CAL FIRE red, US ignitions `#dc2626`, EPSS purple, PSPS blue, HFTD amber (opacity for tier). CAL FIRE magnitude is bubble size, not a second color.

## Ask + GPU

Ask stays enabled whenever the agent `/health` endpoint is reachable, even if the GPU/model is down; the banner then says counts, maps, and rankings still work. Start/stop for the demo GPU is the strip above the form. The token is prompted per action and is not stored. Stopping EC2 does not stop EBS (~$20/month).

The Ask panel can download CSV when an answer produced tabular tool data (records, comparison rows, time-series buckets, spatial counts). Count-only answers do not.
