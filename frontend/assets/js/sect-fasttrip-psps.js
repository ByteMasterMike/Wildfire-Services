(() => {
  const root = document.getElementById("sect-fasttrip-psps");
  if (!root) return;

  const basePath = root.dataset.basePath || "";
  // Planning Tool PNGs live in sibling dataset_demo (not copied into this slim frontend).
  const plotsBasePath =
    root.dataset.plotsBase || `${basePath}/assets/website_plots`;
  const manifestUrl = `${plotsBasePath}/manifest.json`;
  const VisApi = window.WildfireVisApi;
  const USE_VIS_API = Boolean(VisApi);

  const imageStatus = document.getElementById("image-status");
  const imageParams = document.getElementById("image-params");
  const decisionImage = document.getElementById("decision-image");
  const resetPart2Button = document.getElementById("reset-part2");
  const downloadResultsButton = document.getElementById("download-results");

  const historicalYearInput = document.getElementById("historical-year");
  const historicalYearValue = document.getElementById("historical-year-value");
  const historicalYearPlay = document.getElementById("historical-year-play");
  const historicalCountyFilter = document.getElementById("historical-county-filter");
  const historicalUtilityFilter = document.getElementById("historical-utility-filter");
  const historicalLayerToggles = document.getElementById("historical-layer-toggles");
  const historicalMapEl = document.getElementById("historical-map");
  const historicalCanvasHost = document.getElementById("historical-canvas-host");
  const historicalCanvasStatsEl = document.getElementById("historical-canvas-stats");
  const historicalCanvasRestoreEl = document.getElementById("historical-canvas-restore");
  const historicalCanvasShowMapBtn = document.getElementById("historical-canvas-show-map");
  const historicalCanvasStaleEl = document.getElementById("historical-canvas-stale");
  const historicalTabEl = document.getElementById("sfps-tab-historical");
  const historicalMapRow = historicalTabEl
    ? historicalTabEl.querySelector(".sfps-historical-map-row")
    : null;
  const historicalControlsEl = document.querySelector(
    "#sfps-tab-historical .sfps-historical-controls"
  );
  const historicalSummaryChartEl = document.getElementById("historical-summary-chart");
  const historicalChartTitleEl = document.getElementById("historical-chart-title");
  const historicalComparisonEl = document.getElementById("historical-comparison-table");
  const historicalChartToggle = document.getElementById("historical-chart-toggle");
  const historicalDownloadDataBtn = document.getElementById("historical-download-data");
  const weatherPlayBtn = document.getElementById("historical-weather-play");
  const weatherSpeedSelect = document.getElementById("historical-weather-speed");
  const weatherScrub = document.getElementById("historical-weather-scrub");
  const weatherDateEl = document.getElementById("historical-weather-date");
  const weatherLegendEl = document.getElementById("historical-weather-legend");
  const weatherAttributionEl = document.getElementById("historical-weather-attribution");
  const weatherSourceInfoBtn = document.getElementById("historical-weather-source-info");
  const weatherSourcePopover = document.getElementById("historical-weather-source-popover");
  const hftdLegendEl = document.getElementById("historical-hftd-legend");
  const usIgnitionsStripEl = document.getElementById("historical-us-ignitions-strip");
  const usIgnitionsZoomNationalBtn = document.getElementById(
    "historical-us-ignitions-zoom-national"
  );
  const historicalApiBannerEl = document.getElementById("historical-api-banner");

  const hyperparams = [
    "B_budget",
    "B_budget_multiplier",
    "C_budget",
    "C_budget_multiplier",
    "W_cap",
    "W_cap_multiplier",
    "alpha",
    "effective_alpha",
    "gamma_i_multiplier",
    "delta",
    "grouping_method",
    "ignitions",
    "mht_method"
  ];

  const paramLabels = {
    B_budget: "Fast-trip budget",
    B_budget_multiplier: "Fast-trip budget (% of circuits)",
    C_budget: "PSPS budget",
    C_budget_multiplier: "Sect. budget (% of circuits)",
    W_cap: "Reliability constraint (absolute)",
    W_cap_multiplier: "SAIFI",
    alpha: "FWER",
    effective_alpha: "Effectiveness of fast-trip (% of mitigation)",
    gamma_i_multiplier: "Reliability Impact of Fast-Trip",
    delta: "Reliability Impact of PSPS",
    grouping_method: "Declustering method",
    ignitions: "Ignitions",
    mht_method: "Decluster + MHT method"
  };

  /** Labels for Planning Tool (grid) sliders — folder names still encode a, C, B, W, ae, g, d. */
  const gridShortLabels = {
    W_cap_multiplier: "SAIFI Cap",
    C_budget_multiplier: "Sect. budget (% of circuits)",
    B_budget_multiplier: "Fast-trip budget (% of circuits)",
    effective_alpha: "Effectiveness of fast-trip (% of mitigation)",
    alpha: "FWER",
    gamma_i_multiplier: "Reliability Impact of Fast-Trip",
    delta: "Reliability Impact of PSPS",
    mht_method: "Method"
  };

  /** Slugs excluded from Planning Tool (grid) method dropdown and map image list. */
  const GRID_MHT_EXCLUDED_SLUGS = new Set(["group_conformal_oracle"]);

  /** Display labels for grid mode — internal CSV slugs unchanged for paths. */
  const gridMethodLabels = {
    group_conformal_fixed: "Ours (fix groups)",
    group_conformal_random: "Ours (random)",
    maxrank: "Max-Rank",
    ci: "C.I.",
    bonferroni: "Bonferroni",
    co_optimized: "Co-Optimized",
    planning_only: "Planning-Only"
  };

  const filterGridMhtValues = (values) =>
    values.filter((v) => !GRID_MHT_EXCLUDED_SLUGS.has(String(v)));

  /** Temporarily hide these grid slider values in the Planning Tool (numeric match). */
  const GRID_HIDDEN_SLIDER_VALUES = {
    W_cap_multiplier: [0.15],
    effective_alpha: [0.95]
  };

  /** When set, Planning Tool (grid) only offers these numeric values for the param. */
  const GRID_ALLOWED_SLIDER_VALUES = {
    B_budget_multiplier: [0.2],
    C_budget_multiplier: [0.3],
  };

  const filterGridHiddenSliderValues = (param, values) => {
    if (!gridPlotsMode) return values;
    const allowed = GRID_ALLOWED_SLIDER_VALUES[param];
    if (allowed?.length) {
      return values.filter((v) => {
        const n = Number(v);
        if (Number.isNaN(n)) return false;
        return allowed.some((a) => Math.abs(a - n) < 1e-9);
      });
    }
    const blocked = GRID_HIDDEN_SLIDER_VALUES[param];
    if (!blocked?.length) return values;
    return values.filter((v) => {
      const n = Number(v);
      if (Number.isNaN(n)) return true;
      return !blocked.some((b) => b === n);
    });
  };

  let dataset = [];
  let defaultCsvFile = "";
  let usingDefaultCsv = false;
  let imageMeta = [];
  let imageSuffixOptions = [];
  /** When true, maps/decision images load from assets/website_plots/grid_plots/… (merged_planning_grid.csv). */
  let gridPlotsMode = false;
  let imageSelection = {
    suffix: ""
  };
  const userSelected = new Set();

  const imageBasePath = `${plotsBasePath}/`;
  const fixedImageParams = {
    alpha: "0.1",
    mht_method: "Operational_MaxRank",
    gamma_i_multiplier: "0.5"
  };

  // Cached API time-series for the chart (server uses website Jan-1 weekly bins).
  let historicalApiWeekly = null;
  let historicalApiLoadToken = 0;
  let historicalTerritoryCache = new Map();
  const historicalKnownUtilities = ["BVES", "Liberty", "PACIFICORP", "PGE", "SCE", "SDGE"];

  const historicalYears = [2020, 2021, 2022, 2023, 2024, 2025];

  // ═══════════════════════════════════════════════════════════════════
  // Historical Data — interactive map + summary chart datasets.
  //
  // Each entry uses placeholder/sample data for now. To swap in a real
  // dataset later, just set `dataUrl` to a CSV with `lat`, `lon`, and
  // `year` columns (plus anything else you'd like in the popup) — that's
  // the only change needed. When `dataUrl` is set, it takes priority over
  // `sampleData` and is parsed with PapaParse.
  // ═══════════════════════════════════════════════════════════════════
  const HISTORICAL_DATASETS = {
    cpuc: {
      label: "CPUC Ignition Events",
      chartShortLabel: "CPUC Ignitions",
      color: "#c0440e", // var(--sfps-bonf)
      dataUrl: `${basePath}/assets/data/cpuc_fire_incidents_combined.csv`,
      sampleData: [
        { lat: 39.76, lon: -121.62, year: 2020, name: "Butte County ignition" },
        { lat: 38.58, lon: -122.93, year: 2020, name: "Sonoma County ignition" },
        { lat: 40.59, lon: -122.39, year: 2021, name: "Shasta County ignition" },
        { lat: 37.87, lon: -122.27, year: 2021, name: "Alameda County ignition" },
        { lat: 36.78, lon: -119.42, year: 2021, name: "Fresno County ignition" },
        { lat: 39.16, lon: -121.34, year: 2022, name: "Yuba County ignition" },
        { lat: 34.42, lon: -119.7,  year: 2022, name: "Santa Barbara County ignition" },
        { lat: 38.9,  lon: -120.0,  year: 2022, name: "El Dorado County ignition" },
        { lat: 40.43, lon: -123.82, year: 2023, name: "Humboldt County ignition" },
        { lat: 37.3,  lon: -121.88, year: 2023, name: "Santa Clara County ignition" },
        { lat: 38.0,  lon: -122.5,  year: 2023, name: "Marin County ignition" },
        { lat: 39.5,  lon: -121.85, year: 2024, name: "Glenn County ignition" },
        { lat: 35.6,  lon: -118.85, year: 2024, name: "Kern County ignition" },
        { lat: 38.3,  lon: -121.0,  year: 2024, name: "Sacramento County ignition" }
      ]
    },
    epss: {
      label: "EPSS Outage Events",
      chartShortLabel: "EPSS",
      color: "#7c3aed", // var(--sfps-mr)
      highlightColor: "#5b21b6",
      dataUrl: `${basePath}/assets/data/epss_outages.csv`,
      cluster: false,
      sampleData: [
        { lat: 39.9,  lon: -121.0,  year: 2020, name: "Plumas circuit de-energized" },
        { lat: 38.45, lon: -122.71, year: 2020, name: "Napa circuit fast-trip" },
        { lat: 37.5,  lon: -119.65, year: 2021, name: "Mariposa circuit de-energized" },
        { lat: 39.3,  lon: -121.6,  year: 2021, name: "Yuba circuit fast-trip" },
        { lat: 34.2,  lon: -118.9,  year: 2021, name: "Ventura circuit de-energized" },
        { lat: 38.7,  lon: -120.8,  year: 2022, name: "Amador circuit fast-trip" },
        { lat: 40.1,  lon: -122.2,  year: 2022, name: "Tehama circuit de-energized" },
        { lat: 36.9,  lon: -121.7,  year: 2022, name: "Monterey circuit fast-trip" },
        { lat: 39.0,  lon: -120.9,  year: 2023, name: "Placer circuit de-energized" },
        { lat: 37.0,  lon: -120.0,  year: 2023, name: "Madera circuit fast-trip" },
        { lat: 38.2,  lon: -122.65, year: 2024, name: "Sonoma circuit de-energized" },
        { lat: 35.9,  lon: -119.3,  year: 2024, name: "Tulare circuit fast-trip" },
        { lat: 40.3,  lon: -121.4,  year: 2024, name: "Lassen circuit de-energized" }
      ]
    },
    calfire: {
      label: "CAL FIRE Incidents",
      chartShortLabel: "CAL FIRE",
      color: "#b91c1c",
      dataUrl: `${basePath}/assets/data/calfire_incidents.csv`,
      bubbleByAcres: true,
      cluster: false
    },
    usIgnitions: {
      label: "US Ignitions (IRWIN / all-cause)",
      chartShortLabel: "US Ignitions",
      color: "#0f766e",
      apiDataset: "us_ignitions",
      defaultActive: false
    }
  };

  // PSPS event polygons (GeoJSON) — separate from point datasets so they
  // are not clustered and are not counted in the Event Counts chart.
  const PSPS_EVENTS_LAYER = {
    key: "pspsEvents",
    label: "PSPS Event Areas",
    color: "#1d6fa5", // var(--sfps-blue)
    dataUrl: `${basePath}/assets/data/psps_events.geojson`,
    style: {
      color: "#1d6fa5",
      weight: 1.5,
      opacity: 0.9,
      fillColor: "#1d6fa5",
      fillOpacity: 0.25
    },
    highlightStyle: {
      color: "#155a85",
      weight: 2.5,
      opacity: 1,
      fillColor: "#1d6fa5",
      fillOpacity: 0.45
    }
  };

  const EPSS_CIRCUITS_URL = `${basePath}/assets/data/epss_circuits.geojson`;
  const IOU_TERRITORIES_URL = `${basePath}/assets/data/iou_territories.geojson`;
  const PSPS_EVENT_CIRCUITS_URL = `${basePath}/assets/data/psps_event_circuits.json`;
  const STATEWIDE_MAP_VIEW = { center: [37.6, -120.8], zoom: 6 };
  const CONUS_MAP_VIEW = { center: [37.5, -96], zoom: 4 };
  const MAP_VIEW_LAT_TOL = 0.2;
  const MAP_VIEW_LON_TOL = 0.2;
  const MAP_VIEW_ZOOM_TOL = 0.35;
  const PSPS_CIRCUITS_POPUP_PREVIEW = 6;

  const FIRE_WEATHER_LAYER = {
    key: "fireWeather",
    label: "Fire-Weather Danger",
    color: "#e34a33"
  };

  // CPUC High Fire Threat District — static background polygons (not charted).
  // Tier fills keyed on properties.HFTD ("Tier 2" / "Tier 3").
  const HFTD_LAYER = {
    key: "hftd",
    label: "CPUC HFTD",
    color: "#d97706",
    dataUrl: `${basePath}/assets/data/hftd.geojson`,
    defaultActive: false,
    tierStyles: {
      "Tier 2": {
        color: "#d97706",
        weight: 0.75,
        opacity: 0.45,
        fillColor: "#d97706",
        fillOpacity: 0.16
      },
      "Tier 3": {
        color: "#d97706",
        weight: 0.9,
        opacity: 0.55,
        fillColor: "#d97706",
        fillOpacity: 0.38
      }
    },
    fallbackStyle: {
      color: "#d97706",
      weight: 0.75,
      opacity: 0.4,
      fillColor: "#d97706",
      fillOpacity: 0.12
    }
  };

  // Contour thresholds in encoded space (HDW = value * 2). Use 1 instead of 0
  // for Low so empty (0) cells outside California stay outside the contour.
  const WEATHER_THRESHOLD_BANDS = [
    { threshold: 1, encMin: 0, name: "Low", color: "#fee8c8", min_hdw: 0, max_hdw: 78 },
    { threshold: 39, encMin: 39, name: "Moderate", color: "#fdbb84", min_hdw: 78, max_hdw: 150 },
    { threshold: 75, encMin: 75, name: "High", color: "#e34a33", min_hdw: 150, max_hdw: 270 },
    { threshold: 135, encMin: 135, name: "Extreme", color: "#99000d", min_hdw: 270, max_hdw: null }
  ];

  let historicalMapInstance = null;
  let historicalLayerGroups = {};
  let historicalDatasetRecords = {};
  let historicalActiveLayers = new Set([
    ...Object.keys(HISTORICAL_DATASETS).filter(
      (key) => HISTORICAL_DATASETS[key].defaultActive !== false
    ),
    PSPS_EVENTS_LAYER.key,
    FIRE_WEATHER_LAYER.key
    // HFTD + US Ignitions off by default
  ]);
  /** True only when we auto-fit CONUS for US Ignitions (restore CA on toggle-off). */
  let usIgnitionsAutoZoomed = false;
  let historicalUsIgnitionsYearLoaded = null;
  let historicalChartType = "timeseries";
  let historicalMapChartInitialized = false;
  let historicalPspsGeoJson = null;
  let historicalPspsLayer = null;
  let historicalHftdGeoJson = null;
  let historicalHftdLayer = null;
  let pspsEventCircuitsByName = null;
  let epssCircuitsById = null;
  let historicalIouTerritoriesGeoJson = null;
  let historicalIouTerritoryLayer = null;
  let historicalWeatherLayer = null;
  let historicalYearPlayTimer = null;

  const WEATHER_ANIM_BASE = `${basePath}/assets/data/weather_anim`;
  const WEATHER_UPSAMPLE = 4;
  const WEATHER_THRESHOLDS = [1, 39, 75, 135];
  const WEATHER_DAY_DURATION_MS = 100;
  const WEATHER_FILL_OPACITY = 0.55;
  const CPUC_FADE_DAYS = 3;
  const weatherDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  });

  let weatherMeta = null;
  let weatherCells = null;
  let weatherYearCache = {};
  let weatherAnimYear = null;
  let weatherAnimData = null;
  let weatherAnimDayT = 0;
  let weatherAnimPlaying = false;
  let weatherAnimRafId = null;
  let weatherAnimLastFrameMs = null;
  let weatherAnimSpeed = 1;
  let weatherAnimInitialized = false;
  let weatherAnimLoading = false;
  let weatherAnimLoadToken = 0;
  let weatherDayFilterActive = false;
  let weatherLastSyncedDayIndex = null;

  const setHistoricalApiBanner = (message, isError = true) => {
    if (!historicalApiBannerEl) return;
    if (!message) {
      historicalApiBannerEl.hidden = true;
      historicalApiBannerEl.textContent = "";
      historicalApiBannerEl.classList.remove("is-error", "is-info");
      return;
    }
    historicalApiBannerEl.hidden = false;
    historicalApiBannerEl.textContent = message;
    historicalApiBannerEl.classList.toggle("is-error", isError);
    historicalApiBannerEl.classList.toggle("is-info", !isError);
  };

  const loadHistoricalDatasetRecords = async (key) => {
    const config = HISTORICAL_DATASETS[key];
    if (!config) return [];
    if (!config.dataUrl) return config.sampleData || [];
    try {
      const response = await fetch(config.dataUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const rows = parseCsvText(text);

      if (key === "calfire") {
        const records = rows
          .map((row) => {
            const lat = Number(row.incident_latitude);
            const lon = Number(row.incident_longitude);
            const date = String(row.incident_dateonly_created || "").trim();
            const yearMatch = date.match(/^(\d{4})/);
            const year = yearMatch ? Number(yearMatch[1]) : NaN;
            const acresRaw = Number(row.incident_acres_burned);
            const acres = Number.isFinite(acresRaw) ? acresRaw : null;
            const containmentRaw = Number(row.incident_containment);
            const containment = Number.isFinite(containmentRaw) ? containmentRaw : null;
            const endDate = String(row.incident_dateonly_extinguished || "").trim();
            return {
              lat,
              lon,
              year,
              date,
              end_date: endDate || null,
              name: String(row.incident_name || "").trim() || config.label,
              county: String(row.incident_county || "").trim(),
              acres,
              containment,
              incident_type: String(row.incident_type || "").trim(),
              utility: String(row.utility || "").trim()
            };
          })
          .filter((row) => {
            if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon) || !Number.isFinite(row.year)) {
              return false;
            }
            if (row.lat < 32 || row.lat > 43 || row.lon < -125 || row.lon > -113) return false;
            if (row.year < 2020 || row.year > 2025) return false;
            return Boolean(row.date);
          });
        console.log(`CAL FIRE: ${records.length} rows after CA bounds + 2020-2025 filters`);
        if (records.length === 0) {
          console.warn("CAL FIRE: 0 rows loaded after filtering");
        }
        return records;
      }

      return rows
        .map((row) => {
          const utility = String(row.utility || "").trim();
          const circuitId = String(row.circuit_id || "").trim().padStart(9, "0");
          return {
            ...row,
            lat: Number(row.lat),
            lon: Number(row.lon),
            year: Number(row.year),
            utility,
            circuit_id: circuitId,
            name: utility
              ? `${utility} Ignition`
              : row.name || row.description || config.label
          };
        })
        .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon) && Number.isFinite(row.year));
    } catch (error) {
      if (key === "calfire") {
        console.warn(`CAL FIRE: failed to load ${config.dataUrl}:`, error);
        console.warn("CAL FIRE: 0 rows loaded (no sample fallback)");
        return [];
      }
      // Fall back to placeholder data if the real CSV isn't available yet.
      return config.sampleData || [];
    }
  };

  const loadHistoricalPspsEvents = async () => {
    try {
      const response = await fetch(PSPS_EVENTS_LAYER.dataUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      historicalPspsGeoJson = await response.json();
    } catch (error) {
      historicalPspsGeoJson = { type: "FeatureCollection", features: [] };
    }
  };

  const loadHistoricalHftd = async () => {
    try {
      const response = await fetch(HFTD_LAYER.dataUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      historicalHftdGeoJson = await response.json();
      const n = historicalHftdGeoJson?.features?.length || 0;
      console.log(`HFTD: ${n} features loaded`);
    } catch (error) {
      console.warn(`HFTD: failed to load ${HFTD_LAYER.dataUrl}:`, error);
      historicalHftdGeoJson = { type: "FeatureCollection", features: [] };
    }
  };

  const styleHftdFeature = (feature) => {
    const props = feature?.properties || {};
    if (props.style && typeof props.style === "object") return props.style;
    const tier = props.HFTD || props.tier;
    return HFTD_LAYER.tierStyles[tier] || HFTD_LAYER.fallbackStyle;
  };

  const applyHistoricalApiYearPayload = (year, payload) => {
    historicalDatasetRecords.cpuc = payload.cpuc || [];
    historicalDatasetRecords.epss = payload.epss || [];
    historicalDatasetRecords.calfire = payload.calfire || [];
    if (payload.usIgnitions !== undefined) {
      historicalDatasetRecords.usIgnitions = payload.usIgnitions || [];
      historicalUsIgnitionsYearLoaded = year;
    }
    historicalPspsGeoJson = payload.psps || { type: "FeatureCollection", features: [] };
    if (payload.hftd) historicalHftdGeoJson = payload.hftd;
    if (payload.epssCircuitsById) epssCircuitsById = payload.epssCircuitsById;
    // Keep a synthetic all-years view for utility filter when using known list.
    populateHistoricalCountyFilter();
    populateHistoricalUtilityFilter();
  };

  const isUsIgnitionsLayerActive = () => historicalActiveLayers.has("usIgnitions");

  const syncUsIgnitionsStrip = () => {
    if (usIgnitionsStripEl) usIgnitionsStripEl.hidden = !isUsIgnitionsLayerActive();
  };

  const isAtDefaultCaliforniaView = () => {
    if (!historicalMapInstance) return true;
    const center = historicalMapInstance.getCenter();
    const zoom = historicalMapInstance.getZoom();
    return (
      Math.abs(center.lat - STATEWIDE_MAP_VIEW.center[0]) <= MAP_VIEW_LAT_TOL &&
      Math.abs(center.lng - STATEWIDE_MAP_VIEW.center[1]) <= MAP_VIEW_LON_TOL &&
      Math.abs(zoom - STATEWIDE_MAP_VIEW.zoom) <= MAP_VIEW_ZOOM_TOL
    );
  };

  const setConusMapView = () => {
    if (!historicalMapInstance) return;
    historicalMapInstance.setView(CONUS_MAP_VIEW.center, CONUS_MAP_VIEW.zoom);
  };

  const setStatewideMapView = () => {
    if (!historicalMapInstance) return;
    historicalMapInstance.setView(STATEWIDE_MAP_VIEW.center, STATEWIDE_MAP_VIEW.zoom);
  };

  const maybeAutoZoomUsIgnitionsOn = () => {
    if (applyingAgentParams || mapExtentMode) return;
    const filtered =
      Boolean(getSelectedHistoricalUtility()) || Boolean(getSelectedHistoricalCounty());
    if (filtered || !isAtDefaultCaliforniaView()) {
      return;
    }
    setConusMapView();
    usIgnitionsAutoZoomed = true;
  };

  const maybeRestoreCaliforniaAfterUsIgnitionsOff = () => {
    if (!usIgnitionsAutoZoomed) return;
    usIgnitionsAutoZoomed = false;
    if (!getSelectedHistoricalUtility()) {
      setStatewideMapView();
    }
  };

  const loadUsIgnitionsYearFromApi = async (year, token) => {
    if (!USE_VIS_API || !VisApi) return [];
    if (historicalUsIgnitionsYearLoaded === year && Array.isArray(historicalDatasetRecords.usIgnitions)) {
      return historicalDatasetRecords.usIgnitions;
    }
    const payload = await VisApi.mapLayer("us_ignitions", { year });
    if (token != null && token !== historicalApiLoadToken) return null;
    const records = VisApi.usIgnitionsToRecords(payload);
    historicalDatasetRecords.usIgnitions = records;
    historicalUsIgnitionsYearLoaded = year;
    if (payload?.meta?.truncated) {
      console.warn(
        `US Ignitions truncated: returned ${records.length} of ${payload.meta.total}`
      );
    }
    return records;
  };

  const loadHistoricalYearFromApi = async (year) => {
    if (!USE_VIS_API || !VisApi) {
      setHistoricalApiBanner(
        "Visualization API client missing (api-config.js / historical-vis-api.js).",
        true
      );
      return false;
    }
    const token = ++historicalApiLoadToken;
    setHistoricalApiBanner(`Loading map data from ${VisApi.apiBase()} …`, false);
    try {
      await VisApi.health();
    } catch (error) {
      setHistoricalApiBanner(
        `Visualization service unavailable at ${VisApi.apiBase()}. Start it with: uvicorn services.visualization.app:app --port 8002 --app-dir .`,
        true
      );
      console.warn("Visualization /health failed:", error);
      return false;
    }

    try {
      const wantUs = isUsIgnitionsLayerActive();
      const [ignPayload, epssPayload, calPayload, pspsPayload, hftdPayload, usPayload] =
        await Promise.all([
          VisApi.mapLayer("ignitions", { year }),
          VisApi.mapLayer("epss", { year }),
          VisApi.mapLayer("calfire", { year }),
          VisApi.mapLayer("psps", { year }),
          historicalHftdGeoJson
            ? Promise.resolve(null)
            : VisApi.mapLayer("hftd"),
          wantUs ? VisApi.mapLayer("us_ignitions", { year }) : Promise.resolve(null)
        ]);
      if (token !== historicalApiLoadToken) return false;

      const epssParsed = VisApi.epssPayloadToRecordsAndCircuits(epssPayload);
      const warnings = [];
      if (ignPayload?.meta?.truncated) warnings.push("ignitions truncated");
      if (epssPayload?.meta?.truncated) warnings.push("EPSS truncated");
      if (calPayload?.meta?.truncated) warnings.push("CAL FIRE truncated");
      if (usPayload?.meta?.truncated) warnings.push("US Ignitions truncated");
      if (epssParsed.nullGeom) {
        warnings.push(`${epssParsed.nullGeom} EPSS circuits with null geometry`);
      }

      const payload = {
        cpuc: VisApi.ignitionsToRecords(ignPayload),
        epss: epssParsed.records,
        calfire: VisApi.calfireToRecords(calPayload),
        psps: VisApi.normalizePspsFeatureCollection(pspsPayload),
        hftd: hftdPayload
          ? VisApi.normalizeHftdFeatureCollection(hftdPayload)
          : historicalHftdGeoJson,
        epssCircuitsById: epssParsed.circuitsById
      };
      if (wantUs && usPayload) {
        payload.usIgnitions = VisApi.usIgnitionsToRecords(usPayload);
      } else if (!wantUs) {
        // Keep prior cache if year matches; otherwise clear so a later toggle reloads.
        if (historicalUsIgnitionsYearLoaded !== year) {
          historicalDatasetRecords.usIgnitions = [];
          historicalUsIgnitionsYearLoaded = null;
        }
      }

      applyHistoricalApiYearPayload(year, payload);

      if (warnings.length) {
        setHistoricalApiBanner(`Loaded ${year} from API (${warnings.join("; ")}).`, false);
      } else {
        setHistoricalApiBanner("");
      }
      return true;
    } catch (error) {
      console.error("Visualization map-layer load failed:", error);
      setHistoricalApiBanner(
        `Failed to load map layers from ${VisApi.apiBase()}: ${error.message || error}`,
        true
      );
      return false;
    }
  };

  const syncHistoricalHftdLayer = () => {
    const showHftd = historicalActiveLayers.has(HFTD_LAYER.key);
    if (hftdLegendEl) hftdLegendEl.hidden = !showHftd;
    if (!historicalHftdLayer) return;
    historicalHftdLayer.clearLayers();
    if (!showHftd || !historicalHftdGeoJson) return;
    historicalHftdLayer.addData(historicalHftdGeoJson);
  };

  const loadEpssCircuits = async () => {
    try {
      const response = await fetch(EPSS_CIRCUITS_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const geojson = await response.json();
      epssCircuitsById = new Map();
      (geojson.features || []).forEach((feature) => {
        const circuitId = String(feature.properties?.circuit_id || "")
          .trim()
          .padStart(9, "0");
        if (circuitId) epssCircuitsById.set(circuitId, feature);
      });
      console.log(`EPSS circuits: ${epssCircuitsById.size} geometries loaded`);
    } catch (error) {
      console.warn(`EPSS circuits: failed to load ${EPSS_CIRCUITS_URL}:`, error);
      epssCircuitsById = new Map();
    }
  };

  const loadIouTerritories = async () => {
    try {
      const response = await fetch(IOU_TERRITORIES_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      historicalIouTerritoriesGeoJson = await response.json();
    } catch (error) {
      console.warn(`IOU territories: failed to load ${IOU_TERRITORIES_URL}:`, error);
      historicalIouTerritoriesGeoJson = { type: "FeatureCollection", features: [] };
    }
  };

  const loadPspsEventCircuits = async () => {
    try {
      const response = await fetch(PSPS_EVENT_CIRCUITS_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      pspsEventCircuitsByName = data && typeof data === "object" ? data : {};
      console.log(
        `PSPS event circuits: ${Object.keys(pspsEventCircuitsByName).length} PG&E events mapped`
      );
    } catch (error) {
      console.warn(`PSPS event circuits: failed to load ${PSPS_EVENT_CIRCUITS_URL}:`, error);
      pspsEventCircuitsByName = {};
    }
  };

  const formatPspsPopupValue = (value) => {
    if (value === undefined || value === null || value === "") return "—";
    return String(value);
  };

  const buildHistoricalPopupTableHtml = (title, color, rows) => {
    const body = rows
      .map(
        ([label, value]) =>
          `<tr><th style="text-align:left;padding:0.15rem 0.5rem 0.15rem 0;color:#64748b;font-weight:600;white-space:nowrap;">${label}</th><td style="padding:0.15rem 0;">${value}</td></tr>`
      )
      .join("");
    return `<div style="font-family:Plus Jakarta Sans,-apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif;font-size:0.8rem;line-height:1.4;"><strong style="color:${color};">${title}</strong><table style="margin-top:0.4rem;border-collapse:collapse;">${body}</table></div>`;
  };

  const HISTORICAL_POINT_CRITICAL_COUNT_FIELDS = new Set([
    "medical_baseline",
    "life_support",
    "schools",
    "hospitals"
  ]);

  const HISTORICAL_POINT_NUMERIC_FIELDS = new Set([
    "customer_minutes",
    "restoration_min",
    "acres",
    ...HISTORICAL_POINT_CRITICAL_COUNT_FIELDS
  ]);

  const isHistoricalPointPopupValueEmpty = (fieldKey, value) => {
    if (value === undefined || value === null || value === "") return true;
    if (HISTORICAL_POINT_CRITICAL_COUNT_FIELDS.has(fieldKey)) {
      const num = Number(value);
      if (Number.isFinite(num) && num === 0) return true;
    }
    return false;
  };

  const formatHistoricalPointPopupValue = (fieldKey, value) => {
    if (fieldKey === "containment") {
      const num = Number(value);
      if (Number.isFinite(num)) return `${num}%`;
      return String(value);
    }
    if (HISTORICAL_POINT_NUMERIC_FIELDS.has(fieldKey)) {
      const num = Number(value);
      if (Number.isFinite(num)) return num.toLocaleString();
    }
    return String(value);
  };

  const buildHistoricalPointPopupHtml = (key, config, record) => {
    let rowDefs;
    if (key === "cpuc") {
      rowDefs = [
        ["Date", "date", record.date],
        ["Utility", "utility", record.utility],
        ["County", "county", record.county]
      ];
    } else if (key === "epss") {
      rowDefs = [
        ["Circuit", "circuit", record.circuit],
        ["County", "county", record.county],
        ["Division", "division", record.division],
        ["Cause", "cause", record.cause],
        ["Outage Type", "outage_type", record.outage_type],
        ["Customer Minutes", "customer_minutes", record.customer_minutes],
        ["Restoration (min)", "restoration_min", record.restoration_min],
        ["Medical Baseline", "medical_baseline", record.medical_baseline],
        ["Life Support", "life_support", record.life_support],
        ["Schools", "schools", record.schools],
        ["Hospitals", "hospitals", record.hospitals]
      ];
    } else if (key === "calfire") {
      rowDefs = [
        ["County", "county", record.county],
        ["Utility", "utility", record.utility],
        ["Acres burned", "acres", record.acres],
        ["Containment", "containment", record.containment],
        ["Date", "date", record.date],
        ["Type", "incident_type", record.incident_type]
      ];
    } else if (key === "usIgnitions") {
      rowDefs = [
        ["Date", "date", record.date],
        ["Latitude", "_text", Number.isFinite(record.lat) ? record.lat.toFixed(5) : null],
        ["Longitude", "_text", Number.isFinite(record.lon) ? record.lon.toFixed(5) : null],
        ["Note", "_text", "All-cause IRWIN sample — not utility-attributed"]
      ];
    } else {
      rowDefs = [];
    }

    const rows = rowDefs
      .filter(([, fieldKey, value]) => !isHistoricalPointPopupValueEmpty(fieldKey, value))
      .map(([label, fieldKey, value]) => [
        label,
        fieldKey === "_coords" || fieldKey === "_text"
          ? String(value)
          : formatHistoricalPointPopupValue(fieldKey, value)
      ]);

    const title =
      key === "cpuc" || key === "calfire" || key === "usIgnitions"
        ? record.name || config.label
        : config.label;
    return buildHistoricalPopupTableHtml(title, config.color, rows);
  };

  const normalizeEpssCircuitId = (value) => String(value || "").trim().padStart(9, "0");

  const aggregateEpssRecordsByCircuit = (records) => {
    const byCircuit = new Map();
    records.forEach((record) => {
      const circuitId = normalizeEpssCircuitId(record.circuit_id);
      if (!circuitId) return;
      if (!byCircuit.has(circuitId)) byCircuit.set(circuitId, []);
      byCircuit.get(circuitId).push(record);
    });
    return byCircuit;
  };

  const buildEpssCircuitPopupHtml = (config, circuitProps, records) => {
    const count = records.length;
    const props = circuitProps || {};
    const title = props.circuit_name || records[0]?.circuit || config.label;
    const rowDefs = [
      ["Circuit ID", "_text", props.circuit_id],
      ["Division", "_text", props.division],
      ["Substation", "_text", props.substation],
      ["Events (filtered)", "_text", count]
    ];

    if (count > 1) {
      const dates = records.map((record) => record.date).filter(Boolean).sort();
      if (dates.length) {
        const range =
          dates[0] === dates[dates.length - 1]
            ? dates[0]
            : `${dates[0]} – ${dates[dates.length - 1]}`;
        rowDefs.push(["Date range", "_text", range]);
      }
    } else if (count === 1) {
      const record = records[0];
      rowDefs.push(
        ["County", "county", record.county],
        ["Date", "date", record.date],
        ["Cause", "cause", record.cause],
        ["Outage Type", "outage_type", record.outage_type],
        ["Customer Minutes", "customer_minutes", record.customer_minutes],
        ["Restoration (min)", "restoration_min", record.restoration_min],
        ["Medical Baseline", "medical_baseline", record.medical_baseline],
        ["Life Support", "life_support", record.life_support],
        ["Schools", "schools", record.schools],
        ["Hospitals", "hospitals", record.hospitals]
      );
    }

    const rows = rowDefs
      .filter(([, fieldKey, value]) => !isHistoricalPointPopupValueEmpty(fieldKey, value))
      .map(([label, fieldKey, value]) => [
        label,
        fieldKey === "_text" ? String(value) : formatHistoricalPointPopupValue(fieldKey, value)
      ]);

    return buildHistoricalPopupTableHtml(title, config.color, rows);
  };

  const epssCoordIsFinite = (coord) =>
    Array.isArray(coord) &&
    Number.isFinite(Number(coord[0])) &&
    Number.isFinite(Number(coord[1]));

  const sanitizeEpssCircuitFeature = (feature, circuitId) => {
    const geom = feature?.geometry;
    if (!geom || !geom.type || !geom.coordinates) {
      console.warn(`EPSS circuit ${circuitId}: missing geometry, skipping`);
      return null;
    }

    const stripDegenerateLine = (line) => {
      if (!Array.isArray(line)) return null;
      const cleaned = line.filter(epssCoordIsFinite);
      if (cleaned.length < 2) return null;
      // Drop zero-length / collapsed segments (identical consecutive points only).
      const deduped = [];
      cleaned.forEach((pt) => {
        const prev = deduped[deduped.length - 1];
        if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1]) deduped.push(pt);
      });
      return deduped.length >= 2 ? deduped : null;
    };

    let coordinates;
    let type = geom.type;
    if (type === "LineString") {
      const line = stripDegenerateLine(geom.coordinates);
      if (!line) {
        console.warn(`EPSS circuit ${circuitId}: degenerate LineString, skipping`);
        return null;
      }
      coordinates = line;
    } else if (type === "MultiLineString") {
      const lines = (geom.coordinates || []).map(stripDegenerateLine).filter(Boolean);
      if (!lines.length) {
        console.warn(`EPSS circuit ${circuitId}: all MultiLineString parts degenerate, skipping`);
        return null;
      }
      if (lines.length === 1) {
        type = "LineString";
        coordinates = lines[0];
      } else {
        coordinates = lines;
      }
    } else {
      console.warn(`EPSS circuit ${circuitId}: unsupported geometry type ${type}, skipping`);
      return null;
    }

    return {
      type: "Feature",
      properties: feature.properties || {},
      geometry: { type, coordinates }
    };
  };

  const epssLayerBoundsAreValid = (layer) => {
    try {
      const bounds = layer.getBounds();
      if (!bounds || !bounds.isValid()) return false;
      const center = bounds.getCenter();
      return Number.isFinite(center.lat) && Number.isFinite(center.lng);
    } catch (error) {
      return false;
    }
  };

  const renderEpssCircuitLayers = (group, yearRecords, config) => {
    const byCircuit = aggregateEpssRecordsByCircuit(yearRecords);
    byCircuit.forEach((records, circuitId) => {
      const feature = epssCircuitsById?.get(circuitId);
      if (!feature) return;

      // Drop collapsed/zero-length segments left by simplify pipelines before
      // handing geometry to Leaflet (avoids NaN bounds/centroids on edge cases).
      const safeFeature = sanitizeEpssCircuitFeature(feature, circuitId);
      if (!safeFeature) return;

      const count = records.length;
      const props = safeFeature.properties || {};
      const circuitName = props.circuit_name || records[0]?.circuit || circuitId;

      const baseStyle = {
        color: config.color,
        weight: 3,
        opacity: 0.95,
        fill: false
      };
      const highlightStyle = {
        color: config.highlightColor || config.color,
        weight: 4.5,
        opacity: 1,
        fill: false
      };

      let layer;
      try {
        layer = L.geoJSON(safeFeature, {
          style: baseStyle,
          onEachFeature(_feature, pathLayer) {
            pathLayer.on({
              mouseover(e) {
                e.target.setStyle(highlightStyle);
              },
              mouseout(e) {
                e.target.setStyle(baseStyle);
              }
            });
          }
        });
      } catch (error) {
        console.warn(`EPSS circuit ${circuitId}: Leaflet rejected geometry, skipping`, error);
        return;
      }

      if (!epssLayerBoundsAreValid(layer)) {
        console.warn(
          `EPSS circuit ${circuitId}: computed bounds/centroid contain NaN, skipping`
        );
        return;
      }

      layer.bindTooltip(`${circuitName}<br>${count} event${count === 1 ? "" : "s"}`, {
        sticky: true
      });
      layer.bindPopup(buildEpssCircuitPopupHtml(config, props, records), { maxWidth: 320 });
      if (USE_VIS_API && VisApi) {
        layer.on("popupopen", async () => {
          try {
            const detail = await VisApi.eventDetail("circuits", circuitId, {
              year: getCurrentHistoricalYear()
            });
            const outages = (detail.outages || []).map((o) => ({
              ...o,
              date: o.start_date,
              end_date: o.end_date || o.start_date
            }));
            const circuitProps = {
              circuit_id: detail.attributes?.circuit_id || circuitId,
              circuit_name: detail.attributes?.circuit_name || props.circuit_name,
              division: detail.attributes?.division || props.division,
              substation: detail.attributes?.substation || props.substation
            };
            layer.setPopupContent(
              buildEpssCircuitPopupHtml(config, circuitProps, outages.length ? outages : records)
            );
          } catch (error) {
            console.warn(`EPSS event-detail failed for circuit ${circuitId}:`, error);
          }
        });
      }
      try {
        layer.addTo(group);
      } catch (error) {
        console.warn(`EPSS circuit ${circuitId}: failed to add to map, skipping`, error);
      }
    });
  };

  const isSplitVerticalLayout = () =>
    historicalCanvasHost?.getAttribute("data-layout") === "split-vertical";

  const fitMapBounds = (bounds) => {
    if (!historicalMapInstance || !bounds || !bounds.isValid()) return;
    const padding = isSplitVerticalLayout() ? [8, 16] : [24, 24];
    usIgnitionsAutoZoomed = false;
    historicalMapInstance.fitBounds(bounds, { padding });
    if (mapExtentMode === "territory" && historicalMapInstance.getZoom() < 5.5) {
      historicalMapInstance.setView(bounds.getCenter(), 6);
    }
  };

  const updateHistoricalUtilityTerritoryView = () => {
    if (!historicalMapInstance || !historicalIouTerritoryLayer) return;

    historicalIouTerritoryLayer.clearLayers();
    const selectedUtility = getSelectedHistoricalUtility();

    if (!selectedUtility) {
      // Do not force statewide view on every render — that fights CONUS zoom for US Ignitions.
      return;
    }

    const shouldFitTerritory = () =>
      !extentFitPaused && (mapExtentMode == null || mapExtentMode === "territory");

    if (USE_VIS_API && VisApi) {
      const applyTerritory = (payload) => {
        if (!payload?.geojson) return;
        historicalIouTerritoryLayer.clearLayers();
        historicalIouTerritoryLayer.addData(payload.geojson);
        historicalIouTerritoryLayer.bringToBack();
        const b = payload.bounds;
        if (b && Number.isFinite(b.min_lat)) {
          const bounds = L.latLngBounds(
            [b.min_lat, b.min_lon],
            [b.max_lat, b.max_lon]
          );
          if (bounds.isValid() && shouldFitTerritory()) {
            fitMapBounds(bounds);
          }
          return;
        }
        const layerBounds = historicalIouTerritoryLayer.getBounds();
        if (layerBounds.isValid() && shouldFitTerritory()) {
          fitMapBounds(layerBounds);
        }
      };
      if (historicalTerritoryCache.has(selectedUtility)) {
        applyTerritory(historicalTerritoryCache.get(selectedUtility));
        return;
      }
      VisApi.utilityTerritory(selectedUtility)
        .then((payload) => {
          historicalTerritoryCache.set(selectedUtility, payload);
          if (getSelectedHistoricalUtility() === selectedUtility) applyTerritory(payload);
        })
        .catch((error) => {
          console.warn("utility-territory failed:", error);
        });
      return;
    }

    const features = (historicalIouTerritoriesGeoJson?.features || []).filter(
      (feature) => String(feature.properties?.utility || "").trim() === selectedUtility
    );
    if (!features.length) return;

    historicalIouTerritoryLayer.addData({
      type: "FeatureCollection",
      features
    });
    historicalIouTerritoryLayer.bringToBack();

    const bounds = historicalIouTerritoryLayer.getBounds();
    if (bounds.isValid() && shouldFitTerritory()) {
      fitMapBounds(bounds);
    }
  };

  const formatPspsCircuitList = (circuits) => {
    if (!Array.isArray(circuits) || !circuits.length) return null;
    const labels = circuits.map((circuit) => {
      const name = String(circuit.circuit_name || "").trim();
      const id = String(circuit.circuit_id || "").trim();
      if (name && id) return `${name} (${id})`;
      return name || id;
    }).filter(Boolean);
    if (!labels.length) return null;
    const preview = labels.slice(0, PSPS_CIRCUITS_POPUP_PREVIEW);
    const suffix = labels.length > PSPS_CIRCUITS_POPUP_PREVIEW ? ", …" : "";
    const noun = labels.length === 1 ? "circuit" : "circuits";
    return `${labels.length} ${noun}: ${preview.join(", ")}${suffix}`;
  };

  const formatPspsAffectedCircuits = (eventName) => {
    if (!eventName || !pspsEventCircuitsByName) return null;
    return formatPspsCircuitList(pspsEventCircuitsByName[eventName]);
  };

  const buildPspsPopupHtml = (properties) => {
    const p = properties || {};
    const eventName = p.EventName || p.event_name;
    const rows = [
      ["Event Name", formatPspsPopupValue(eventName)],
      ["First Date of POC", formatPspsPopupValue(p.FirstDateofPOC ?? p.first_date_of_poc)],
      ["IOU", formatPspsPopupValue(p.IOU ?? p.utility)],
      [
        "De-energization Start Date",
        formatPspsPopupValue(p.DeEnergizationStartDate ?? p.deenergization_start_date)
      ],
      [
        "Full Restoration Date",
        formatPspsPopupValue(p.FullRestorationDate ?? p.full_restoration_date)
      ],
      [
        "Customers De-energized",
        formatPspsPopupValue(p.CustomerDeEnergized ?? p.customers_deenergized)
      ]
    ];
    let circuitsText = formatPspsCircuitList(p.affected_circuits);
    if (!circuitsText) circuitsText = formatPspsAffectedCircuits(eventName);
    if (circuitsText) {
      rows.push(["Circuits", circuitsText]);
    }
    return buildHistoricalPopupTableHtml(PSPS_EVENTS_LAYER.label, PSPS_EVENTS_LAYER.color, rows);
  };

  const handleUsIgnitionsLayerToggle = async (enabled) => {
    syncUsIgnitionsStrip();
    const year = getCurrentHistoricalYear();
    if (enabled) {
      if (USE_VIS_API && VisApi) {
        try {
          await loadUsIgnitionsYearFromApi(year, null);
        } catch (error) {
          console.warn("US Ignitions load failed:", error);
          setHistoricalApiBanner(
            `Failed to load US Ignitions: ${error.message || error}`,
            true
          );
        }
      } else {
        historicalDatasetRecords.usIgnitions = [];
      }
      maybeAutoZoomUsIgnitionsOn();
    } else {
      maybeRestoreCaliforniaAfterUsIgnitionsOff();
    }
    renderHistoricalMapAndChart(year);
  };

  const appendHistoricalLayerToggle = (key, config) => {
    if (!historicalLayerToggles) return;
    const isOn = historicalActiveLayers.has(key);
    const label = document.createElement("label");
    label.className = `sfps-layer-toggle${isOn ? " is-active" : ""}`;
    label.dataset.layerKey = key;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isOn;
    if (config.color) checkbox.style.accentColor = config.color;
    checkbox.addEventListener("change", () => {
      noteUserMapChrome();
      if (checkbox.checked) {
        historicalActiveLayers.add(key);
      } else {
        historicalActiveLayers.delete(key);
      }
      label.classList.toggle("is-active", checkbox.checked);
      if (key === "usIgnitions") {
        handleUsIgnitionsLayerToggle(checkbox.checked);
        return;
      }
      renderHistoricalMapAndChart(getCurrentHistoricalYear());
    });

    const dot = document.createElement("span");
    dot.className = "sfps-layer-toggle-dot";
    dot.style.background = config.color;

    const text = document.createElement("span");
    text.textContent = config.label;

    label.appendChild(checkbox);
    label.appendChild(dot);
    label.appendChild(text);
    historicalLayerToggles.appendChild(label);
  };

  const buildHistoricalLayerToggles = () => {
    if (!historicalLayerToggles) return;
    historicalLayerToggles.innerHTML = "";
    Object.entries(HISTORICAL_DATASETS).forEach(([key, config]) => {
      appendHistoricalLayerToggle(key, config);
    });
    appendHistoricalLayerToggle(PSPS_EVENTS_LAYER.key, PSPS_EVENTS_LAYER);
    appendHistoricalLayerToggle(FIRE_WEATHER_LAYER.key, FIRE_WEATHER_LAYER);
    appendHistoricalLayerToggle(HFTD_LAYER.key, HFTD_LAYER);
  };

  const createHistoricalClusterGroup = (config) => {
    if (typeof L.markerClusterGroup !== "function") {
      return L.layerGroup();
    }
    return L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 50,
      iconCreateFunction(cluster) {
        const count = cluster.getChildCount();
        let sizeClass = " marker-cluster-small";
        if (count >= 100) sizeClass = " marker-cluster-large";
        else if (count >= 10) sizeClass = " marker-cluster-medium";
        return L.divIcon({
          html: `<div style="background-color:${config.color}"><span>${count}</span></div>`,
          className: `marker-cluster${sizeClass}`,
          iconSize: L.point(40, 40)
        });
      }
    });
  };

  const initHistoricalMap = () => {
    if (!historicalMapEl || typeof L === "undefined" || historicalMapInstance) return;
    historicalMapInstance = L.map(historicalMapEl, {
      scrollWheelZoom: false
    }).setView(STATEWIDE_MAP_VIEW.center, STATEWIDE_MAP_VIEW.zoom);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 12
    }).addTo(historicalMapInstance);

    // Above basemap tiles (200), below overlay pane (400) so HFTD stays under
    // weather, PSPS, circuits, and point markers regardless of bringToBack().
    if (!historicalMapInstance.getPane("hftdPane")) {
      historicalMapInstance.createPane("hftdPane");
      historicalMapInstance.getPane("hftdPane").style.zIndex = 350;
    }

    bindCanvasRelayoutObserver();
    bindShowMapButton();

    historicalHftdLayer = L.geoJSON(null, {
      pane: "hftdPane",
      style: styleHftdFeature,
      interactive: false
    }).addTo(historicalMapInstance);

    historicalWeatherLayer = L.geoJSON(null, {
      style(feature) {
        const color = feature?.properties?.color || FIRE_WEATHER_LAYER.color;
        return {
          fillColor: color,
          fillOpacity: WEATHER_FILL_OPACITY,
          stroke: false,
          weight: 0,
          opacity: 0
        };
      },
      interactive: false
    }).addTo(historicalMapInstance);

    historicalIouTerritoryLayer = L.geoJSON(null, {
      style: {
        color: "#334155",
        weight: 2,
        opacity: 0.85,
        fillColor: "#94a3b8",
        fillOpacity: 0.08,
        dashArray: "6 4"
      },
      interactive: false
    }).addTo(historicalMapInstance);

    // Polygons next so they sit beneath point markers / clusters.
    historicalPspsLayer = L.geoJSON(null, {
      style: () => PSPS_EVENTS_LAYER.style,
      onEachFeature(feature, layer) {
        const properties = feature.properties || {};
        layer.bindPopup(buildPspsPopupHtml(properties), { maxWidth: 360 });
        if (USE_VIS_API && VisApi) {
          layer.on("popupopen", async () => {
            const eventName = properties.EventName || properties.event_name;
            if (!eventName) return;
            try {
              const detail = await VisApi.eventDetail("psps", eventName);
              const merged = {
                ...properties,
                ...detail.attributes,
                EventName: detail.attributes?.event_name || eventName,
                affected_circuits: detail.affected_circuits
              };
              layer.setPopupContent(buildPspsPopupHtml(merged));
            } catch (error) {
              console.warn("PSPS event-detail failed:", error);
            }
          });
        }
        layer.on({
          mouseover(e) {
            e.target.setStyle(PSPS_EVENTS_LAYER.highlightStyle);
            if (!e.target.isPopupOpen()) e.target.openPopup();
          },
          mouseout(e) {
            if (historicalPspsLayer) historicalPspsLayer.resetStyle(e.target);
          }
        });
      }
    }).addTo(historicalMapInstance);

    Object.keys(HISTORICAL_DATASETS).forEach((key) => {
      const config = HISTORICAL_DATASETS[key];
      const group =
        config.cluster === false ? L.layerGroup() : createHistoricalClusterGroup(config);
      historicalLayerGroups[key] = group.addTo(historicalMapInstance);
    });
  };

  const calfireBubbleRadius = (record) => {
    const acres = Number(record.acres);
    const forRadius = Number.isFinite(acres) && acres > 0 ? acres : 1;
    return Math.max(4, Math.min(28, 4 + Math.log10(forRadius) * 5));
  };

  const getCurrentHistoricalYear = () => {
    if (!historicalYearInput || !historicalYears.length) return historicalYears[0];
    return historicalYears[Number(historicalYearInput.value)] ?? historicalYears[0];
  };

  const titleCaseCounty = (value) =>
    String(value)
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());

  const getSelectedHistoricalCounty = () =>
    historicalCountyFilter ? historicalCountyFilter.value : "";

  const getSelectedHistoricalUtility = () =>
    historicalUtilityFilter ? historicalUtilityFilter.value : "";

  const populateHistoricalCountyFilter = () => {
    if (!historicalCountyFilter) return;
    const previous = historicalCountyFilter.value;
    const byKey = new Map();
    const addCounty = (record) => {
      const raw = String(record.county || "").trim();
      if (!raw) return;
      const key = raw.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, titleCaseCounty(raw));
    };
    (historicalDatasetRecords.epss || []).forEach(addCounty);
    (historicalDatasetRecords.calfire || []).forEach(addCounty);
    (historicalDatasetRecords.cpuc || []).forEach(addCounty);
    const counties = Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
    historicalCountyFilter.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All counties";
    historicalCountyFilter.appendChild(allOption);
    counties.forEach((county) => {
      const option = document.createElement("option");
      option.value = county;
      option.textContent = county;
      historicalCountyFilter.appendChild(option);
    });
    if (previous && counties.some((c) => c.toLowerCase() === previous.toLowerCase())) {
      const match = counties.find((c) => c.toLowerCase() === previous.toLowerCase());
      historicalCountyFilter.value = match;
    } else {
      historicalCountyFilter.value = "";
    }
  };

  const populateHistoricalUtilityFilter = () => {
    if (!historicalUtilityFilter) return;
    const previous = historicalUtilityFilter.value;
    const fromPsps = (historicalPspsGeoJson?.features || [])
      .map((feature) => String(feature.properties?.IOU || feature.properties?.utility || "").trim())
      .filter(Boolean);
    const fromCpuc = (historicalDatasetRecords.cpuc || [])
      .map((record) => String(record.utility || "").trim())
      .filter(Boolean);
    const fromCalfire = (historicalDatasetRecords.calfire || [])
      .map((record) => String(record.utility || "").trim())
      .filter(Boolean);
    const seed = USE_VIS_API ? historicalKnownUtilities : [];
    const utilities = Array.from(
      new Set([...seed, ...fromPsps, ...fromCpuc, ...fromCalfire])
    ).sort((a, b) => a.localeCompare(b));
    historicalUtilityFilter.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All utilities";
    historicalUtilityFilter.appendChild(allOption);
    utilities.forEach((utility) => {
      const option = document.createElement("option");
      option.value = utility;
      option.textContent = utility;
      historicalUtilityFilter.appendChild(option);
    });
    historicalUtilityFilter.value = utilities.includes(previous) ? previous : "";
  };

  const formatIsoDateLocal = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const getWeekIndexInYear = (dateStr, year) => {
    const date = parseIsoDate(dateStr);
    if (!date || date.getFullYear() !== year) return null;
    const start = new Date(year, 0, 1);
    const dayIndex = Math.round((date - start) / 86400000);
    if (dayIndex < 0) return null;
    return Math.floor(dayIndex / 7);
  };

  const getWeekBinMeta = (year) => {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const dayCount = Math.round((yearEnd - yearStart) / 86400000) + 1;
    const weekCount = Math.ceil(dayCount / 7);
    const weekStarts = [];
    const weekLabels = [];
    for (let w = 0; w < weekCount; w += 1) {
      const start = new Date(year, 0, 1 + w * 7);
      const end = new Date(year, 0, Math.min(dayCount, 1 + w * 7 + 6));
      weekStarts.push(formatIsoDateLocal(start));
      weekLabels.push(`${formatIsoDateLocal(start)} – ${formatIsoDateLocal(end)}`);
    }
    return { weekCount, weekStarts, weekLabels };
  };

  const buildWeeklyCountsByDataset = (recordsByDataset, year) => {
    const { weekCount, weekStarts, weekLabels } = getWeekBinMeta(year);
    const series = {};
    Object.keys(HISTORICAL_DATASETS).forEach((key) => {
      const counts = new Array(weekCount).fill(0);
      (recordsByDataset[key] || []).forEach((record) => {
        const weekIndex = getWeekIndexInYear(record.date, year);
        if (weekIndex == null || weekIndex < 0 || weekIndex >= weekCount) return;
        counts[weekIndex] += 1;
      });
      series[key] = counts;
    });
    return { weekStarts, weekLabels, series };
  };

  const getChartDayMarkerDate = (year) => {
    const fromWeather = getWeatherDisplayDate();
    if (fromWeather) return fromWeather;
    if (!Number.isFinite(year)) return null;
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const dayCount = Math.round((yearEnd - yearStart) / 86400000) + 1;
    const dayIndex = Math.max(0, Math.min(dayCount - 1, Math.floor(weatherAnimDayT) || 0));
    return formatIsoDateLocal(new Date(year, 0, 1 + dayIndex));
  };

  const renderHistoricalChart = (countsByDataset, year) => {
    lastBrowseChartArgs = { countsByDataset, year };
    if (agentSeriesActive) return;
    if (!historicalSummaryChartEl || typeof Plotly === "undefined") return;
    const entries = Object.entries(HISTORICAL_DATASETS).filter(([key]) => historicalActiveLayers.has(key));
    const labels = entries.map(([, config]) => config.label);
    const shortLabels = entries.map(([, config]) => config.chartShortLabel || config.label);
    const colors = entries.map(([, config]) => config.color);
    const values = entries.map(([key]) => countsByDataset[key] || 0);

    const layout = {
      font: { family: "Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif", size: 12, color: "#1e293b" },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      showlegend: historicalChartType === "donut" || historicalChartType === "timeseries"
    };

    let data;
    if (historicalChartType === "timeseries") {
      // Time series ignores the day scrubber filter so the full-year shape stays
      // visible; the vertical marker shows the current weather day instead.
      const filteredForSeries = getFilteredHistoricalPointRecords(year, { applyDay: false });
      const baselineForAxis = getFilteredHistoricalPointRecords(year, {
        applyCounty: false,
        applyUtility: false,
        applyDay: false
      });
      const plotted = buildWeeklyCountsByDataset(filteredForSeries, year);
      const baseline = buildWeeklyCountsByDataset(baselineForAxis, year);
      let yMax = 1;
      entries.forEach(([key]) => {
        (baseline.series[key] || []).forEach((count) => {
          if (count > yMax) yMax = count;
        });
      });
      yMax = Math.max(1, Math.ceil(yMax * 1.1));

      layout.margin = { t: 28, r: 16, b: 40, l: 48 };
      layout.legend = {
        orientation: "h",
        yanchor: "bottom",
        y: 1.02,
        x: 0,
        xanchor: "left",
        font: { size: 11 }
      };
      layout.xaxis = {
        type: "date",
        gridcolor: "#e2e8f0",
        zeroline: false,
        automargin: true,
        fixedrange: true,
        tickformat: "%b",
        hoverformat: "%Y-%m-%d"
      };
      layout.yaxis = {
        title: { text: "Events / week", standoff: 6 },
        gridcolor: "#e2e8f0",
        zeroline: false,
        automargin: true,
        fixedrange: true,
        range: [0, yMax]
      };

      const markerDate = getChartDayMarkerDate(year);
      layout.shapes = markerDate
        ? [
            {
              type: "line",
              xref: "x",
              yref: "paper",
              x0: markerDate,
              x1: markerDate,
              y0: 0,
              y1: 1,
              line: { color: "#0f172a", width: 1.5, dash: "dot" }
            }
          ]
        : [];
      layout.annotations = markerDate
        ? [
            {
              x: markerDate,
              y: 1,
              xref: "x",
              yref: "paper",
              text: markerDate,
              showarrow: false,
              xanchor: "left",
              yanchor: "bottom",
              font: { size: 10, color: "#475569" },
              xshift: 4
            }
          ]
        : [];

      data = entries.map(([key, config], idx) => ({
        type: "scatter",
        mode: "lines+markers",
        name: shortLabels[idx],
        x: plotted.weekStarts,
        y: plotted.series[key] || [],
        customdata: plotted.weekLabels,
        line: { color: colors[idx], width: 2 },
        marker: { color: colors[idx], size: 5 },
        hovertemplate: `%{fullData.name}<br>%{customdata}<br>%{y} events<extra></extra>`
      }));
    } else if (historicalChartType === "donut") {
      layout.margin = { t: 10, r: 110, b: 10, l: 10 };
      layout.legend = {
        orientation: "v",
        yanchor: "middle",
        y: 0.5,
        x: 1.02,
        xanchor: "left",
        font: { size: 11 }
      };
      data = [{
        type: "pie",
        hole: 0.55,
        labels,
        values,
        marker: { colors },
        textinfo: "value",
        hovertemplate: "%{label}: %{value} events<extra></extra>"
      }];
    } else {
      layout.margin = { t: 10, r: 24, b: 36, l: 96 };
      layout.xaxis = {
        title: { text: "Event count", standoff: 8 },
        gridcolor: "#e2e8f0",
        zeroline: false,
        automargin: true,
        fixedrange: true
      };
      layout.yaxis = {
        automargin: true,
        tickfont: { size: 11 },
        fixedrange: true
      };
      data = [{
        type: "bar",
        orientation: "h",
        y: shortLabels,
        x: values,
        customdata: labels,
        marker: { color: colors },
        hovertemplate: "%{customdata}: %{x} events<extra></extra>"
      }];
    }

    const chartHeight = Math.max(320, historicalSummaryChartEl.clientHeight || 380);
    layout.height = chartHeight;
    layout.autosize = false;

    Plotly.react(historicalSummaryChartEl, data, layout, { displayModeBar: false, responsive: true });
  };

  const updateHistoricalChartDayMarker = () => {
    if (agentSeriesActive) return;
    if (historicalChartType !== "timeseries") return;
    if (!historicalSummaryChartEl || typeof Plotly === "undefined") return;
    if (!historicalSummaryChartEl.data) return;
    const year = getCurrentHistoricalYear();
    const markerDate = getChartDayMarkerDate(year);
    Plotly.relayout(historicalSummaryChartEl, {
      shapes: markerDate
        ? [
            {
              type: "line",
              xref: "x",
              yref: "paper",
              x0: markerDate,
              x1: markerDate,
              y0: 0,
              y1: 1,
              line: { color: "#0f172a", width: 1.5, dash: "dot" }
            }
          ]
        : [],
      annotations: markerDate
        ? [
            {
              x: markerDate,
              y: 1,
              xref: "x",
              yref: "paper",
              text: markerDate,
              showarrow: false,
              xanchor: "left",
              yanchor: "bottom",
              font: { size: 10, color: "#475569" },
              xshift: 4
            }
          ]
        : []
    });
  };

  const parseIsoDate = (value) => {
    if (value === undefined || value === null || value === "") return null;
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  };

  const calendarDayDiffAbs = (a, b) => {
    const da = parseIsoDate(a);
    const db = parseIsoDate(b);
    if (!da || !db) return Infinity;
    return Math.abs(Math.round((da - db) / 86400000));
  };

  const dateInInclusiveRange = (current, start, end) => {
    const c = parseIsoDate(current);
    const s = parseIsoDate(start);
    const e = parseIsoDate(end || start);
    if (!c || !s || !e) return false;
    return c >= s && c <= e;
  };

  const getWeatherDisplayDate = () => {
    if (!weatherAnimData?.dates?.length) return null;
    const nDays = weatherAnimData.dates.length;
    const dayIndex = Math.floor(weatherAnimDayT) % nDays;
    return weatherAnimData.dates[dayIndex] || null;
  };

  const getWeatherIntegerDayIndex = () => {
    if (!weatherAnimData?.dates?.length) return null;
    return Math.floor(weatherAnimDayT) % weatherAnimData.dates.length;
  };

  const recordVisibleOnDay = (key, record, currentDate) => {
    if (!currentDate) return true;
    if (key === "cpuc" || key === "usIgnitions") {
      return calendarDayDiffAbs(record.date, currentDate) <= CPUC_FADE_DAYS;
    }
    if (key === "epss") {
      return dateInInclusiveRange(currentDate, record.date, record.end_date || record.date);
    }
    if (key === "calfire") {
      if (record.end_date) {
        return dateInInclusiveRange(currentDate, record.date, record.end_date);
      }
      return calendarDayDiffAbs(record.date, currentDate) <= CPUC_FADE_DAYS;
    }
    return true;
  };

  const pspsFeatureVisibleOnDay = (feature, currentDate) => {
    if (!currentDate) return true;
    const props = feature?.properties || {};
    return dateInInclusiveRange(
      currentDate,
      props.DeEnergizationStartDate,
      props.FullRestorationDate || props.DeEnergizationStartDate
    );
  };

  const getFilteredHistoricalPointRecords = (year, options = {}) => {
    const applyCounty = options.applyCounty !== false;
    const applyUtility = options.applyUtility !== false;
    const applyDay = options.applyDay !== false;
    const selectedCounty = applyCounty ? getSelectedHistoricalCounty() : "";
    const countyKey = selectedCounty ? selectedCounty.toLowerCase() : "";
    const selectedUtility = applyUtility ? getSelectedHistoricalUtility() : "";
    const dayActive = applyDay && weatherDayFilterActive;
    const currentDate = dayActive ? getWeatherDisplayDate() : null;
    const byDataset = {};

    Object.keys(HISTORICAL_DATASETS).forEach((key) => {
      let records = (historicalDatasetRecords[key] || []).filter((record) => record.year === year);
      if ((key === "epss" || key === "cpuc" || key === "calfire") && countyKey) {
        records = records.filter(
          (record) => String(record.county || "").trim().toLowerCase() === countyKey
        );
      }
      if (key === "epss" && selectedUtility && selectedUtility !== "PGE") {
        records = [];
      }
      if (key === "cpuc" && selectedUtility) {
        records = records.filter(
          (record) => String(record.utility || "").trim() === selectedUtility
        );
      }
      if (key === "calfire" && selectedUtility) {
        records = records.filter(
          (record) => String(record.utility || "").trim() === selectedUtility
        );
      }
      // usIgnitions: no utility/county attributes — ignore those filters; year/day still apply.
      if (dayActive && currentDate) {
        records = records.filter((record) => recordVisibleOnDay(key, record, currentDate));
      }
      byDataset[key] = records;
    });

    return byDataset;
  };

  const getFilteredPspsFeatures = (year) => {
    const selectedUtility = getSelectedHistoricalUtility();
    const dayActive = weatherDayFilterActive;
    const currentDate = dayActive ? getWeatherDisplayDate() : null;
    const features = historicalPspsGeoJson?.features || [];

    return features.filter((feature) => {
      if (Number(feature.properties?.year) !== year) return false;
      if (selectedUtility && String(feature.properties?.IOU || "").trim() !== selectedUtility) {
        return false;
      }
      if (dayActive && currentDate && !pspsFeatureVisibleOnDay(feature, currentDate)) {
        return false;
      }
      return true;
    });
  };

  const renderHistoricalMapAndChart = (year) => {
    const filteredByDataset = getFilteredHistoricalPointRecords(year);
    const countsByDataset = {};

    Object.entries(HISTORICAL_DATASETS).forEach(([key, config]) => {
      const yearRecords = filteredByDataset[key] || [];
      countsByDataset[key] = yearRecords.length;

      if (!historicalMapInstance) return;

      const group = historicalLayerGroups[key];
      if (!group) return;
      group.clearLayers();

      if (!historicalActiveLayers.has(key)) return;

      if (key === "epss") {
        renderEpssCircuitLayers(group, yearRecords, config);
        return;
      }

      yearRecords.forEach((record) => {
        const marker = L.circleMarker([record.lat, record.lon], {
          radius: config.bubbleByAcres ? calfireBubbleRadius(record) : 6,
          color: config.color,
          fillColor: config.color,
          fillOpacity: config.bubbleByAcres ? 0.45 : 0.75,
          weight: 1.5
        });
        marker.bindPopup(buildHistoricalPointPopupHtml(key, config, record), { maxWidth: 320 });
        if (USE_VIS_API && VisApi && record.id != null && record.id !== "") {
          const detailDataset =
            key === "cpuc"
              ? "ignitions"
              : key === "calfire"
                ? "calfire"
                : key === "usIgnitions"
                  ? "us_ignitions"
                  : null;
          if (detailDataset) {
            marker.on("popupopen", async () => {
              try {
                const detail = await VisApi.eventDetail(detailDataset, String(record.id));
                const attrs = detail.attributes || {};
                const enriched =
                  key === "cpuc"
                    ? {
                        ...record,
                        date: attrs.event_date || record.date,
                        utility: attrs.utility || record.utility,
                        county: attrs.county || record.county
                      }
                    : key === "usIgnitions"
                      ? {
                          ...record,
                          date: attrs.event_date || record.date,
                          lat: Number(attrs.latitude ?? record.lat),
                          lon: Number(attrs.longitude ?? record.lon)
                        }
                      : {
                          ...record,
                          name: attrs.incident_name || record.name,
                          county: attrs.county || record.county,
                          utility: attrs.utility || record.utility,
                          acres: attrs.acres_burned ?? record.acres,
                          containment: attrs.containment ?? record.containment,
                          date: attrs.date_only_created || record.date,
                          incident_type: attrs.incident_type || record.incident_type
                        };
                marker.setPopupContent(
                  buildHistoricalPointPopupHtml(key, config, enriched)
                );
              } catch (error) {
                console.warn(`${key} event-detail failed:`, error);
              }
            });
          }
        }
        marker.addTo(group);
      });
    });

    if (historicalPspsLayer) {
      historicalPspsLayer.clearLayers();
      if (historicalActiveLayers.has(PSPS_EVENTS_LAYER.key) && historicalPspsGeoJson) {
        historicalPspsLayer.addData({
          type: "FeatureCollection",
          features: getFilteredPspsFeatures(year)
        });
        historicalPspsLayer.bringToBack();
      }
    }

    syncHistoricalHftdLayer();
    syncUsIgnitionsStrip();

    renderHistoricalChart(countsByDataset, year);
    drawWeatherContours();
    updateHistoricalUtilityTerritoryView();
  };

  const csvEscapeCell = (value) => {
    if (value === undefined || value === null) return "";
    const str = String(value);
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const downloadVisibleHistoricalData = () => {
    const year = getCurrentHistoricalYear();
    const filteredByDataset = getFilteredHistoricalPointRecords(year);
    const columns = [
      "dataset",
      "lat",
      "lon",
      "year",
      "date",
      "end_date",
      "name",
      "time",
      "county",
      "circuit",
      "cause",
      "outage_type",
      "division",
      "customer_minutes",
      "restoration_min",
      "medical_baseline",
      "life_support",
      "schools",
      "hospitals"
    ];

    const rows = [columns.join(",")];
    Object.entries(HISTORICAL_DATASETS).forEach(([key, config]) => {
      if (!historicalActiveLayers.has(key)) return;
      (filteredByDataset[key] || []).forEach((record) => {
        rows.push(
          columns
            .map((col) => {
              if (col === "dataset") return csvEscapeCell(config.chartShortLabel || config.label);
              return csvEscapeCell(record[col]);
            })
            .join(",")
        );
      });
    });

    const dayActive = weatherDayFilterActive;
    const dayStr = dayActive ? getWeatherDisplayDate() : null;
    const filename = dayStr
      ? `wildfire-outage-${year}-${dayStr}.csv`
      : `wildfire-outage-${year}.csv`;

    const blob = new Blob([`${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const initHistoricalMapAndChart = async () => {
    if (!historicalMapEl || !historicalSummaryChartEl) return;
    buildHistoricalLayerToggles();
    initHistoricalMap();

    const year = getCurrentHistoricalYear();

    if (USE_VIS_API) {
      const ok = await loadHistoricalYearFromApi(year);
      if (!ok) {
        // Leave map empty but keep weather / controls usable.
        historicalDatasetRecords = { cpuc: [], epss: [], calfire: [], usIgnitions: [] };
        historicalUsIgnitionsYearLoaded = null;
        historicalPspsGeoJson = { type: "FeatureCollection", features: [] };
        epssCircuitsById = new Map();
        populateHistoricalUtilityFilter();
      }
    } else {
      const keys = Object.keys(HISTORICAL_DATASETS);
      const [pointResults] = await Promise.all([
        Promise.all(keys.map((key) => loadHistoricalDatasetRecords(key))),
        loadHistoricalPspsEvents(),
        loadHistoricalHftd(),
        loadPspsEventCircuits(),
        loadEpssCircuits(),
        loadIouTerritories()
      ]);
      keys.forEach((key, idx) => {
        historicalDatasetRecords[key] = pointResults[idx];
      });
      // US Ignitions has no static CSV in the slim frontend — API only.
      if (!historicalDatasetRecords.usIgnitions) {
        historicalDatasetRecords.usIgnitions = [];
      }
      populateHistoricalCountyFilter();
      populateHistoricalUtilityFilter();
    }

    if (usIgnitionsZoomNationalBtn) {
      usIgnitionsZoomNationalBtn.addEventListener("click", () => {
        noteUserMapChrome();
        setConusMapView();
      });
    }

    if (historicalCountyFilter) {
      historicalCountyFilter.addEventListener("change", () => {
        noteUserMapChrome();
        renderHistoricalMapAndChart(getCurrentHistoricalYear());
      });
    }
    if (historicalUtilityFilter) {
      historicalUtilityFilter.addEventListener("change", () => {
        noteUserMapChrome();
        const util = getSelectedHistoricalUtility();
        if (!util && !usIgnitionsAutoZoomed) {
          setStatewideMapView();
        }
        renderHistoricalMapAndChart(getCurrentHistoricalYear());
      });
    }

    if (historicalChartToggle) {
      historicalChartToggle.querySelectorAll(".sfps-chart-toggle-btn").forEach((button) => {
        button.addEventListener("click", () => {
          noteUserMapChrome();
          historicalChartType = button.dataset.chartType || "timeseries";
          historicalChartToggle.querySelectorAll(".sfps-chart-toggle-btn").forEach((btn) => {
            btn.classList.toggle("is-active", btn === button);
          });
          renderHistoricalMapAndChart(getCurrentHistoricalYear());
        });
      });
    }

    if (historicalDownloadDataBtn) {
      historicalDownloadDataBtn.addEventListener("click", () => {
        downloadVisibleHistoricalData();
      });
    }

    renderHistoricalMapAndChart(getCurrentHistoricalYear());
    initWeatherAnim();
  };

  const refreshHistoricalYearData = async (year) => {
    if (USE_VIS_API) {
      await loadHistoricalYearFromApi(year);
    }
    renderHistoricalMapAndChart(year);
  };

  let canvasRelayoutCount = 0;
  let canvasRelayoutTimer = null;
  let canvasRelayoutObserver = null;
  let viewSource = "user";
  let applyingAgentParams = false;
  let askInFlight = false;
  let lastAgentViewScope = null;
  let lastAnswerStatus = null;
  let canvasPrimaryType = "map";
  let mapExtentMode = null;
  let extentFitPaused = false;
  let agentPointMarker = null;
  let agentSeriesActive = false;
  const COMPARISON_BAR_HEIGHT = 200;
  const SERIES_PLOT_MIN_HEIGHT = 160;
  let lastBrowseChartArgs = null;
  const MAX_STAT_CARDS = 3;
  const STAT_CARD_COLORS = {
    cpuc_ignitions: "#c0440e",
    ignitions: "#c0440e",
    us_ignitions: "#0f766e",
    epss_outages: "#7c3aed",
    epss: "#7c3aed",
    calfire_incidents: "#b91c1c",
    calfire: "#b91c1c",
    psps_events: "#1d6fa5",
    psps: "#1d6fa5",
    cnhpp: "#155d8a",
    circuits: "#155d8a"
  };
  const COMPARISON_METRIC_LABELS = {
    ignition_count: "Ignitions",
    epss_outage_count: "EPSS outages",
    epss_to_ignition_ratio: "EPSS-to-ignition ratio",
    calfire_incident_count: "CAL FIRE incidents",
    acres_burned: "Acres burned",
    psps_event_count: "PSPS events",
    customers_deenergized: "Customers de-energized"
  };
  const COMPARISON_NORMALIZE_LABELS = {
    none: null,
    per_circuit: "per circuit",
    per_km2: "per km²"
  };
  const COMPARISON_METRIC_COLORS = {
    ignition_count: "#c0440e",
    epss_outage_count: "#7c3aed",
    epss_to_ignition_ratio: "#7c3aed",
    calfire_incident_count: "#b91c1c",
    acres_burned: "#b91c1c",
    psps_event_count: "#1d6fa5",
    customers_deenergized: "#1d6fa5"
  };
  const RECORD_TABLE_LIMIT = 25;
  const RECORD_DATASET_PATHS = {
    cpuc_ignitions: "/ignitions",
    ignitions: "/ignitions",
    us_ignitions: "/us-ignitions",
    epss_outages: "/epss/outages",
    epss: "/epss/outages",
    psps_events: "/psps/events",
    psps: "/psps/events",
    calfire_incidents: "/calfire/incidents",
    calfire: "/calfire/incidents",
    circuits: "/circuits",
    hftd: "/hftd"
  };
  const RECORD_COLUMNS = {
    calfire_incidents: [
      { key: "incident_name", label: "Fire" },
      { key: "date_only_created", label: "Date" },
      { key: "acres_burned", label: "Acres" },
      { key: "containment", label: "Containment" },
      { key: "county", label: "County" },
      { key: "incident_type", label: "Type" }
    ],
    calfire: [
      { key: "incident_name", label: "Fire" },
      { key: "date_only_created", label: "Date" },
      { key: "acres_burned", label: "Acres" },
      { key: "containment", label: "Containment" },
      { key: "county", label: "County" },
      { key: "incident_type", label: "Type" }
    ],
    cpuc_ignitions: [
      { key: "event_date", label: "Date" },
      { key: "utility", label: "Utility" },
      { key: "county", label: "County" },
      { key: "location", label: "Location" }
    ],
    ignitions: [
      { key: "event_date", label: "Date" },
      { key: "utility", label: "Utility" },
      { key: "county", label: "County" },
      { key: "location", label: "Location" }
    ],
    us_ignitions: [
      { key: "event_date", label: "Date" },
      { key: "latitude", label: "Latitude" },
      { key: "longitude", label: "Longitude" }
    ],
    epss_outages: [
      { key: "start_date", label: "Start" },
      { key: "circuit_id", label: "Circuit" },
      { key: "county", label: "County" },
      { key: "outage_type", label: "Type" },
      { key: "cause", label: "Cause" }
    ],
    epss: [
      { key: "start_date", label: "Start" },
      { key: "circuit_id", label: "Circuit" },
      { key: "county", label: "County" },
      { key: "outage_type", label: "Type" },
      { key: "cause", label: "Cause" }
    ],
    psps_events: [
      { key: "event_name", label: "Event" },
      { key: "utility", label: "Utility" },
      { key: "deenergization_start_date", label: "Start" },
      { key: "customers_deenergized", label: "Customers" }
    ],
    psps: [
      { key: "event_name", label: "Event" },
      { key: "utility", label: "Utility" },
      { key: "deenergization_start_date", label: "Start" },
      { key: "customers_deenergized", label: "Customers" }
    ],
    circuits: [
      { key: "circuit_id", label: "Circuit" },
      { key: "circuit_name", label: "Name" },
      { key: "division", label: "Division" },
      { key: "utility", label: "Utility" }
    ],
    hftd: [
      { key: "tier", label: "Tier" },
      { key: "objectid", label: "ID" }
    ]
  };
  const SERIES_LABELS = {
    ignitions: "CPUC Ignitions",
    cpuc_ignitions: "CPUC Ignitions",
    us_ignitions: "US Ignitions",
    epss: "EPSS",
    epss_outages: "EPSS",
    calfire: "CAL FIRE",
    calfire_incidents: "CAL FIRE",
    psps: "PSPS",
    psps_events: "PSPS"
  };
  const SERIES_INTERVAL_AXIS = {
    daily: "Events / day",
    weekly: "Events / week",
    monthly: "Events / month"
  };

  const measureChartPlotHeight = () => {
    const el = historicalSummaryChartEl;
    if (!el) return SERIES_PLOT_MIN_HEIGHT;
    const slot = el.closest(".sfps-canvas-slot--chart");
    if (slot) {
      const header = slot.querySelector(".sfps-historical-chart-header");
      const available = slot.clientHeight - (header ? header.offsetHeight : 0) - 4;
      if (available >= SERIES_PLOT_MIN_HEIGHT) return Math.round(available);
    }
    const h = el.clientHeight;
    return h >= SERIES_PLOT_MIN_HEIGHT ? Math.round(h) : SERIES_PLOT_MIN_HEIGHT;
  };

  const resizeAgentSeriesPlot = () => {
    if (!historicalSummaryChartEl || typeof Plotly === "undefined") return;
    if (!historicalSummaryChartEl.data) return;
    if (historicalCanvasHost?.dataset.secondary !== "series") return;
    Plotly.relayout(historicalSummaryChartEl, {
      height: measureChartPlotHeight(),
      autosize: false
    });
  };

  const refitAgentMapExtent = () => {
    if (viewSource !== "agent") return;
    if (mapExtentMode !== "territory" && mapExtentMode !== "auto_fit") return;
    if (!historicalMapInstance) return;
    const size = historicalMapInstance.getSize();
    if (!size || size.x < 80 || size.y < 80) return;
    applyMapExtent(mapExtentMode);
  };

  const scheduleAgentCanvasSettle = (reason) => {
    requestAnimationFrame(() => {
      relayoutCanvas(reason);
      resizeAgentSeriesPlot();
      setTimeout(() => {
        relayoutCanvas(`${reason}:settle`);
        resizeAgentSeriesPlot();
        refitAgentMapExtent();
      }, 180);
    });
  };

  const relayoutCanvas = (reason = "manual") => {
    canvasRelayoutCount += 1;
    if (historicalMapInstance) historicalMapInstance.invalidateSize();
    const size = historicalMapInstance ? historicalMapInstance.getSize() : null;
    if (historicalCanvasHost) {
      historicalCanvasHost.dataset.relayoutCount = String(canvasRelayoutCount);
      historicalCanvasHost.dataset.viewSource = viewSource;
      historicalCanvasHost.dataset.relayoutReason = reason;
      if (size) {
        historicalCanvasHost.dataset.mapSize = `${Math.round(size.x)}x${Math.round(size.y)}`;
        historicalCanvasHost.dataset.mapZoom = String(
          Math.round(historicalMapInstance.getZoom() * 10) / 10
        );
      }
    }
    if (
      historicalSummaryChartEl &&
      typeof Plotly !== "undefined" &&
      historicalSummaryChartEl.data
    ) {
      if (historicalCanvasHost?.dataset.secondary === "series") {
        resizeAgentSeriesPlot();
      } else {
        Plotly.Plots.resize(historicalSummaryChartEl);
      }
    }
  };

  const scheduleCanvasRelayout = (reason = "resize") => {
    clearTimeout(canvasRelayoutTimer);
    canvasRelayoutTimer = setTimeout(() => relayoutCanvas(reason), 80);
  };

  const bindCanvasRelayoutObserver = () => {
    if (canvasRelayoutObserver || typeof ResizeObserver === "undefined") return;
    canvasRelayoutObserver = new ResizeObserver(() => {
      scheduleCanvasRelayout("resize-observer");
    });
    if (historicalCanvasHost) canvasRelayoutObserver.observe(historicalCanvasHost);
    if (historicalMapEl) canvasRelayoutObserver.observe(historicalMapEl);
    window.addEventListener("resize", () => scheduleCanvasRelayout("window-resize"));
  };

  const setCanvasLayout = (layout) => {
    const next = layout || "browse";
    if (historicalCanvasHost) historicalCanvasHost.setAttribute("data-layout", next);
    if (historicalMapRow) {
      const hug = next === "stats" || next === "series";
      historicalMapRow.dataset.canvasHug = hug ? "1" : "0";
    }
    requestAnimationFrame(() => {
      relayoutCanvas(`layout:${next}`);
      setTimeout(() => relayoutCanvas(`layout:${next}:settle`), 180);
    });
  };

  const setChartChrome = (mode) => {
    const secondary = mode === "agent" ? "series" : mode || "browse";
    const agent = ["series", "comparison", "records", "spatial"].includes(secondary);
    if (historicalCanvasHost) {
      historicalCanvasHost.dataset.series = agent ? "agent" : "browse";
      historicalCanvasHost.dataset.secondary = secondary;
    }
    if (historicalChartTitleEl) {
      historicalChartTitleEl.textContent =
        secondary === "series"
          ? "Asked series"
          : secondary === "comparison"
            ? "Comparison"
            : secondary === "records"
              ? "Records"
              : secondary === "spatial"
                ? "Location"
                : "Events over time";
    }
    if (historicalComparisonEl) {
      historicalComparisonEl.hidden = !["comparison", "records", "spatial"].includes(
        secondary
      );
    }
  };

  const hideComparisonTable = () => {
    if (historicalComparisonEl) {
      historicalComparisonEl.hidden = true;
      historicalComparisonEl.innerHTML = "";
    }
  };

  const showAgentSeriesError = (message) => {
    if (!historicalSummaryChartEl) return;
    if (typeof Plotly !== "undefined" && historicalSummaryChartEl.data) {
      Plotly.purge(historicalSummaryChartEl);
    }
    historicalSummaryChartEl.textContent = message || "Asked series could not be loaded.";
  };

  const renderAgentSeries = (payload, params = {}) => {
    if (!historicalSummaryChartEl || typeof Plotly === "undefined") {
      throw new Error("Plotly chart host is not available");
    }
    const buckets = Array.isArray(payload?.buckets) ? payload.buckets : null;
    if (!buckets) {
      throw new Error("time-series artifact is missing buckets");
    }
    const dataset = payload.dataset || params.dataset || "";
    const interval = payload.interval || params.interval || "weekly";
    const color = payload.color || STAT_CARD_COLORS[dataset] || "#1d6fa5";
    const label = SERIES_LABELS[dataset] || dataset || "Events";
    const x = buckets.map((item) => item.start);
    const y = buckets.map((item) => Number(item.count) || 0);
    const hover = buckets.map((item) => item.label || item.start);
    const allZero = y.length > 0 && y.every((value) => value === 0);
    const yMax = Math.max(1, Math.ceil(Math.max(0, ...y, 0) * 1.1) || 1);
    const plotHeight = measureChartPlotHeight();
    const layout = {
      font: {
        family: "Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif",
        size: 12,
        color: "#1e293b"
      },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      showlegend: false,
      margin: { t: 16, r: 16, b: 40, l: 48 },
      autosize: false,
      height: plotHeight,
      xaxis: {
        type: "date",
        gridcolor: "#e2e8f0",
        zeroline: false,
        automargin: true,
        fixedrange: true,
        tickformat: interval === "monthly" ? "%b" : "%b %d",
        hoverformat: "%Y-%m-%d"
      },
      yaxis: {
        title: { text: SERIES_INTERVAL_AXIS[interval] || "Events", standoff: 6 },
        gridcolor: "#e2e8f0",
        zeroline: false,
        automargin: true,
        fixedrange: true,
        range: [0, yMax]
      }
    };
    return Plotly.react(
      historicalSummaryChartEl,
      [
        {
          type: "scatter",
          mode: "lines+markers",
          name: label,
          x,
          y,
          text: hover,
          hovertemplate: `%{text}<br>${label}: %{y}<extra></extra>`,
          line: { color, width: 2 },
          marker: { color, size: allZero ? 5 : 6 },
          connectgaps: true
        }
      ],
      layout,
      { displayModeBar: false, responsive: true }
    );
  };

  const restoreBrowseChart = () => {
    agentSeriesActive = false;
    hideComparisonTable();
    setChartChrome("browse");
    if (lastBrowseChartArgs) {
      renderHistoricalChart(lastBrowseChartArgs.countsByDataset, lastBrowseChartArgs.year);
    }
  };

  const visTimeSeriesParams = (params = {}) => {
    const query = {
      interval: params.interval || "weekly",
      year: params.year,
      utility: params.utility,
      county: params.county,
      start_date: params.start_date,
      end_date: params.end_date
    };
    const mode = params.incident_type_mode;
    if (mode && mode !== "wildfire_default") {
      query.incident_type = mode;
    }
    return query;
  };

  const fetchTimeSeriesPayload = async (spec) => {
    const refs = spec.artifact_refs || [];
    const AgentApi = window.WildfireAgentApi;
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      if (!ref || typeof AgentApi?.getArtifact !== "function") continue;
      try {
        const art = await AgentApi.getArtifact(ref);
        const payload = art?.payload;
        if (payload && Array.isArray(payload.buckets)) return payload;
      } catch (error) {
        console.warn("Time-series artifact fetch failed:", error);
      }
    }
    const params = spec.params || {};
    if (!VisApi || typeof VisApi.timeSeries !== "function") {
      throw new Error("time-series artifact missing and visualization API unavailable");
    }
    return VisApi.timeSeries(params.dataset, visTimeSeriesParams(params));
  };

  const setTimeSeries = async (spec, options = {}) => {
    const layout = options.layout || "series";
    agentSeriesActive = true;
    hideComparisonTable();
    setChartChrome("series");
    setCanvasSlotVisible("chart", true);
    if (layout === "series") {
      canvasPrimaryType = "series";
      collapseMapViewport(true);
      setCanvasLayout("series");
    } else if (layout === "split-vertical") {
      canvasPrimaryType = "map";
      collapseMapViewport(false);
      setCanvasSlotVisible("map", true);
      setCanvasLayout("split-vertical");
    }
    try {
      const payload = await fetchTimeSeriesPayload(spec || {});
      await renderAgentSeries(payload, (spec && spec.params) || {});
    } catch (error) {
      console.warn("Asked series failed:", error);
      showAgentSeriesError(error.message || "Asked series could not be loaded.");
    }
    updateStaleViewChrome();
    scheduleAgentCanvasSettle("series:apply");
  };

  const formatComparisonNumber = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    if (Math.abs(n - Math.round(n)) < 1e-9) {
      return Math.round(n).toLocaleString("en-US");
    }
    if (Math.abs(n) >= 10) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  };

  const comparisonValueCell = (row = {}, { signed = false } = {}) => {
    const td = document.createElement("td");
    td.className = "sfps-comparison-value";
    if (row.value == null) {
      const nullEl = document.createElement("span");
      nullEl.className = "sfps-comparison-null";
      nullEl.textContent = "—";
      td.appendChild(nullEl);
      if (row.reason) {
        const reasonEl = document.createElement("span");
        reasonEl.className = "sfps-comparison-reason";
        reasonEl.textContent = row.reason;
        td.appendChild(reasonEl);
      }
      return td;
    }
    const formatted = formatComparisonNumber(row.value);
    td.textContent = signed && Number(row.value) > 0 ? `+${formatted}` : formatted;
    return td;
  };

  const comparisonCaption = (payload, params = {}) => {
    const metric = payload.metric || params.metric || "";
    const bits = [COMPARISON_METRIC_LABELS[metric] || metric || "Comparison"];
    const normalize = payload.normalize || params.normalize;
    const normLabel = COMPARISON_NORMALIZE_LABELS[normalize];
    if (normLabel) bits.push(normLabel);
    const ign = payload.meta?.ignition_definition || params.ignition_definition;
    if (metric === "ignition_count" && ign) bits.push(ign);
    const start = params.start_date;
    const end = params.end_date;
    if (start && end) bits.push(`${start} → ${end}`);
    else if (params.period_a_start && params.period_b_end) {
      bits.push(`${params.period_a_start} / ${params.period_b_start || params.period_b_end}`);
    }
    return bits.filter(Boolean).join(" · ");
  };

  const comparisonBarRows = (payload, params = {}) => {
    if (payload.period_a && payload.period_b) {
      const labelA = payload.period_a.start_date
        ? `A · ${payload.period_a.start_date.slice(0, 4)}`
        : "Period A";
      const labelB = payload.period_b.start_date
        ? `B · ${payload.period_b.start_date.slice(0, 4)}`
        : "Period B";
      return [
        { key: labelA, value: payload.period_a.value, reason: payload.period_a.reason },
        { key: labelB, value: payload.period_b.value, reason: payload.period_b.reason }
      ];
    }
    return (Array.isArray(payload.results) ? payload.results : []).map((row) => ({
      key: row.key || row.scope || "—",
      value: row.value,
      reason: row.reason
    }));
  };

  const renderComparisonChart = (payload, params = {}) => {
    if (!historicalSummaryChartEl || typeof Plotly === "undefined") return;
    const rows = comparisonBarRows(payload, params);
    if (!rows.length) return;
    const metric = payload.metric || params.metric || "";
    const color = COMPARISON_METRIC_COLORS[metric] || "#1d6fa5";
    const categories = rows.map((row) => row.key);
    const present = rows.filter((row) => row.value != null);
    const missing = rows.filter((row) => row.value == null);
    const numeric = present.map((row) => Number(row.value)).filter(Number.isFinite);
    const yMax = Math.max(1, Math.ceil(Math.max(0, ...numeric, 0) * 1.15) || 1);
    // Zero-height bars are invisible; a short hatched stub keeps the category
    // on the axis without reading as a real count (label is "no data", hover is the reason).
    const stub = yMax * 0.16;
    const traces = [];
    if (present.length) {
      traces.push({
        type: "bar",
        name: COMPARISON_METRIC_LABELS[metric] || metric || "Value",
        x: present.map((row) => row.key),
        y: present.map((row) => Number(row.value)),
        marker: { color },
        customdata: present.map((row) => formatComparisonNumber(row.value)),
        hovertemplate: "%{x}<br>%{customdata}<extra></extra>"
      });
    }
    if (missing.length) {
      traces.push({
        type: "bar",
        name: "No data",
        x: missing.map((row) => row.key),
        y: missing.map(() => stub),
        marker: {
          color: "#94a3b8",
          pattern: {
            shape: "/",
            bgcolor: "#e2e8f0",
            fgcolor: "#475569",
            size: 8,
            solidity: 0.55
          }
        },
        text: missing.map(() => "no data"),
        textposition: "inside",
        insidetextanchor: "middle",
        textfont: { size: 12, color: "#1e293b" },
        cliponaxis: false,
        customdata: missing.map((row) => row.reason || "unavailable"),
        hovertemplate: "%{x}<br>%{customdata}<extra></extra>",
        showlegend: false
      });
    }
    return Plotly.react(
      historicalSummaryChartEl,
      traces,
      {
        font: {
          family: "Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif",
          size: 12,
          color: "#1e293b"
        },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        showlegend: false,
        margin: { t: 16, r: 16, b: 40, l: 56 },
        autosize: true,
        height: COMPARISON_BAR_HEIGHT,
        bargap: 0.28,
        xaxis: {
          automargin: true,
          fixedrange: true,
          categoryorder: "array",
          categoryarray: categories
        },
        yaxis: {
          title: { text: COMPARISON_METRIC_LABELS[metric] || "Value", standoff: 6 },
          gridcolor: "#e2e8f0",
          zeroline: false,
          rangemode: "tozero",
          range: [0, yMax],
          automargin: true,
          fixedrange: true
        }
      },
      { displayModeBar: false, responsive: true }
    );
  };

  const renderComparisonTable = (payload, params = {}) => {
    if (!historicalComparisonEl) {
      throw new Error("Comparison table host is missing");
    }
    historicalComparisonEl.innerHTML = "";
    const caption = document.createElement("p");
    caption.className = "sfps-comparison-caption";
    caption.textContent = comparisonCaption(payload, params);
    historicalComparisonEl.appendChild(caption);

    const table = document.createElement("table");
    table.className = "sfps-comparison-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const kind = payload.kind || params.kind;

    if (kind === "periods" || (payload.period_a && payload.period_b)) {
      ["Period", "Value"].forEach((label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      const rows = [
        {
          label: payload.period_a?.start_date
            ? `A · ${payload.period_a.start_date} → ${payload.period_a.end_date}`
            : "Period A",
          row: payload.period_a || {}
        },
        {
          label: payload.period_b?.start_date
            ? `B · ${payload.period_b.start_date} → ${payload.period_b.end_date}`
            : "Period B",
          row: payload.period_b || {}
        },
        { label: "Delta (B − A)", row: payload.delta || {}, signed: true }
      ];
      rows.forEach((item) => {
        const tr = document.createElement("tr");
        const scope = document.createElement("td");
        scope.textContent = item.label;
        tr.appendChild(scope);
        tr.appendChild(comparisonValueCell(item.row, { signed: item.signed }));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
    } else {
      const results = Array.isArray(payload.results) ? payload.results : [];
      if (!results.length) {
        throw new Error("comparison artifact is missing results");
      }
      ["Scope", "Value"].forEach((label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      results.forEach((row) => {
        const tr = document.createElement("tr");
        const scope = document.createElement("td");
        scope.textContent = row.key || row.scope || "—";
        tr.appendChild(scope);
        tr.appendChild(comparisonValueCell(row));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
    }
    historicalComparisonEl.appendChild(table);
    historicalComparisonEl.hidden = false;
  };

  const fetchComparisonPayload = async (spec) => {
    const refs = spec.artifact_refs || [];
    const AgentApi = window.WildfireAgentApi;
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      if (!ref || typeof AgentApi?.getArtifact !== "function") continue;
      try {
        const art = await AgentApi.getArtifact(ref);
        const payload = art?.payload;
        if (payload && (Array.isArray(payload.results) || payload.period_a)) {
          return payload;
        }
      } catch (error) {
        console.warn("Comparison artifact fetch failed:", error);
      }
    }
    throw new Error("comparison artifact missing results");
  };

  const setComparison = async (spec, options = {}) => {
    const layout = options.layout || "series";
    agentSeriesActive = true;
    setChartChrome("comparison");
    setCanvasSlotVisible("chart", true);
    if (layout === "series") {
      canvasPrimaryType = "comparison";
      collapseMapViewport(true);
      setCanvasLayout("series");
    } else if (layout === "split-vertical") {
      canvasPrimaryType = "map";
      collapseMapViewport(false);
      setCanvasSlotVisible("map", true);
      setCanvasLayout("split-vertical");
    }
    try {
      const payload = await fetchComparisonPayload(spec || {});
      renderComparisonChart(payload, (spec && spec.params) || {});
      renderComparisonTable(payload, (spec && spec.params) || {});
    } catch (error) {
      console.warn("Comparison table failed:", error);
      if (historicalComparisonEl) {
        historicalComparisonEl.hidden = false;
        historicalComparisonEl.innerHTML = "";
        const err = document.createElement("p");
        err.className = "sfps-comparison-error";
        err.textContent = error.message || "Comparison could not be loaded.";
        historicalComparisonEl.appendChild(err);
      }
    }
    updateStaleViewChrome();
    scheduleAgentCanvasSettle("comparison:apply");
  };

  const dataQueryBase = () =>
    String(window.WILDFIRE_DATA_QUERY_BASE || "http://127.0.0.1:8000").replace(/\/$/, "");

  const formatRecordCell = (value) => {
    if (value == null || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value)) {
      if (Math.abs(value - Math.round(value)) < 1e-9) {
        return Math.round(value).toLocaleString("en-US");
      }
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    return text;
  };

  const recordLocationText = (row = {}) => {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
    const coords = row.geometry && row.geometry.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const glat = Number(coords[1]);
      const glon = Number(coords[0]);
      if (Number.isFinite(glat) && Number.isFinite(glon)) {
        return `${glat.toFixed(4)}, ${glon.toFixed(4)}`;
      }
    }
    return null;
  };

  const recordCellText = (row, col) => {
    if (col.key === "location") return recordLocationText(row);
    return formatRecordCell(row[col.key]);
  };

  const recordColumnsFor = (dataset) =>
    RECORD_COLUMNS[dataset] || [{ key: "id", label: "ID" }];

  const fetchRecordsPayload = async (spec) => {
    const refs = spec.artifact_refs || [];
    const AgentApi = window.WildfireAgentApi;
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      if (!ref || typeof AgentApi?.getArtifact !== "function") continue;
      try {
        const art = await AgentApi.getArtifact(ref);
        const payload = art?.payload;
        if (payload && Array.isArray(payload.data)) return payload;
      } catch (error) {
        console.warn("Record-table artifact fetch failed:", error);
      }
    }
    const params = spec.params || {};
    const path = RECORD_DATASET_PATHS[params.dataset];
    if (!path) throw new Error("record table dataset is not queryable");
    const query = {
      limit: Math.min(RECORD_TABLE_LIMIT, Number(params.row_limit) || RECORD_TABLE_LIMIT),
      geometry: false,
      format: "json",
      year: params.year,
      utility: params.utility,
      county: params.county,
      start_date: params.start_date,
      end_date: params.end_date
    };
    const sp = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      sp.set(key, String(value));
    });
    const response = await fetch(`${dataQueryBase()}${path}?${sp.toString()}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} refetching records`);
    }
    return response.json();
  };

  const renderRecordTable = (payload, params = {}) => {
    if (!historicalComparisonEl) {
      throw new Error("Records host is missing");
    }
    historicalComparisonEl.innerHTML = "";
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const meta = payload?.meta || {};
    const total = Number(meta.total);
    const shown = Math.min(rows.length, RECORD_TABLE_LIMIT);
    const caption = document.createElement("p");
    caption.className = "sfps-record-truncate";
    if (Number.isFinite(total) && total > shown) {
      caption.textContent = `Showing ${shown} of ${total.toLocaleString("en-US")} matching records. Full export is on Download CSV.`;
    } else if (Number.isFinite(total)) {
      caption.textContent = `${total.toLocaleString("en-US")} matching record${total === 1 ? "" : "s"}.`;
    } else {
      caption.textContent = `${shown} record${shown === 1 ? "" : "s"}.`;
    }
    historicalComparisonEl.appendChild(caption);

    const columns = recordColumnsFor(params.dataset || payload.dataset);
    const table = document.createElement("table");
    table.className = "sfps-record-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    columns.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.slice(0, RECORD_TABLE_LIMIT).forEach((row) => {
      const tr = document.createElement("tr");
      columns.forEach((col) => {
        const td = document.createElement("td");
        const formatted = recordCellText(row, col);
        if (formatted == null) {
          const nullEl = document.createElement("span");
          nullEl.className = "sfps-comparison-null";
          nullEl.textContent = "—";
          td.appendChild(nullEl);
        } else {
          td.textContent = formatted;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    historicalComparisonEl.appendChild(table);
    historicalComparisonEl.hidden = false;
  };

  const applyFactsLayout = (layout, primaryType) => {
    agentSeriesActive = true;
    setCanvasSlotVisible("chart", true);
    if (layout === "series") {
      canvasPrimaryType = primaryType;
      collapseMapViewport(true);
      setCanvasLayout("series");
    } else if (layout === "split-vertical") {
      canvasPrimaryType = "map";
      collapseMapViewport(false);
      setCanvasSlotVisible("map", true);
      setCanvasLayout("split-vertical");
    }
  };

  const setRecordTable = async (spec, options = {}) => {
    const layout = options.layout || "series";
    setChartChrome("records");
    applyFactsLayout(layout, "records");
    try {
      const payload = await fetchRecordsPayload(spec || {});
      renderRecordTable(payload, (spec && spec.params) || {});
    } catch (error) {
      console.warn("Record table failed:", error);
      if (historicalComparisonEl) {
        historicalComparisonEl.hidden = false;
        historicalComparisonEl.innerHTML = "";
        const err = document.createElement("p");
        err.className = "sfps-comparison-error";
        err.textContent = error.message || "Records could not be loaded.";
        historicalComparisonEl.appendChild(err);
      }
    }
    updateStaleViewChrome();
    scheduleAgentCanvasSettle("records:apply");
  };

  const spatialField = (params, key, { empty = "none" } = {}) => {
    if (!Object.prototype.hasOwnProperty.call(params || {}, key)) {
      return { text: "unresolved", kind: "unresolved" };
    }
    const value = params[key];
    if (value == null || value === "") {
      return { text: empty, kind: "none" };
    }
    return { text: String(value), kind: "value" };
  };

  const clearAgentPointMarker = () => {
    if (agentPointMarker && historicalMapInstance) {
      historicalMapInstance.removeLayer(agentPointMarker);
    }
    agentPointMarker = null;
  };

  const pinAgentPoint = (lat, lon) => {
    clearAgentPointMarker();
    if (!historicalMapInstance || typeof L === "undefined") return;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    agentPointMarker = L.circleMarker([lat, lon], {
      radius: 9,
      color: "#0f172a",
      weight: 2,
      fillColor: "#d97706",
      fillOpacity: 0.95
    }).addTo(historicalMapInstance);
    agentPointMarker.bindPopup(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    historicalMapInstance.setView([lat, lon], Math.max(historicalMapInstance.getZoom(), 9));
  };

  const renderSpatialFacts = (params = {}) => {
    if (!historicalComparisonEl) {
      throw new Error("Location host is missing");
    }
    historicalComparisonEl.innerHTML = "";
    const lat = Number(params.lat);
    const lon = Number(params.lon);
    const dl = document.createElement("dl");
    dl.className = "sfps-spatial-facts";
    const coordOk = Number.isFinite(lat) && Number.isFinite(lon);
    const fields = [
      {
        key: "coordinates",
        label: "Coordinates",
        text: coordOk ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : "unresolved",
        kind: coordOk ? "value" : "unresolved"
      },
      { key: "iou", label: "IOU", empty: "none" },
      { key: "hftd_tier", label: "HFTD tier", empty: "none" },
      { key: "county", label: "County", empty: "none" },
      { key: "cell_id", label: "Grid cell", empty: "none" }
    ];
    fields.forEach((field) => {
      const dt = document.createElement("dt");
      dt.textContent = field.label;
      const dd = document.createElement("dd");
      let text = field.text;
      let kind = field.kind;
      if (field.key !== "coordinates") {
        const fact = spatialField(params, field.key, { empty: field.empty });
        text = fact.text;
        kind = fact.kind;
        if (field.key === "county" && kind === "value" && !/county/i.test(text)) {
          text = `${text} County`;
        }
      }
      dd.textContent = text;
      if (kind === "none") dd.className = "sfps-spatial-none";
      if (kind === "unresolved") dd.className = "sfps-spatial-unresolved";
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    historicalComparisonEl.appendChild(dl);
    historicalComparisonEl.hidden = false;
  };

  const setSpatialContext = async (spec, options = {}) => {
    const layout = options.layout || "series";
    const params = (spec && spec.params) || {};
    setChartChrome("spatial");
    applyFactsLayout(layout, "spatial");
    try {
      renderSpatialFacts(params);
      if (layout === "split-vertical") {
        pinAgentPoint(Number(params.lat), Number(params.lon));
      } else {
        clearAgentPointMarker();
      }
    } catch (error) {
      console.warn("Spatial context failed:", error);
      if (historicalComparisonEl) {
        historicalComparisonEl.hidden = false;
        historicalComparisonEl.innerHTML = "";
        const err = document.createElement("p");
        err.className = "sfps-comparison-error";
        err.textContent = error.message || "Location could not be shown.";
        historicalComparisonEl.appendChild(err);
      }
    }
    updateStaleViewChrome();
    scheduleAgentCanvasSettle("spatial:apply");
  };

  const AGENT_DATASET_TO_LAYER = {
    ignitions: "cpuc",
    cpuc_ignitions: "cpuc",
    cpuc: "cpuc",
    us_ignitions: "usIgnitions",
    calfire: "calfire",
    calfire_incidents: "calfire",
    epss: "epss",
    epss_outages: "epss",
    psps: "pspsEvents",
    psps_events: "pspsEvents",
    hftd: "hftd",
  };

  const allHistoricalLayerKeys = () => [
    ...Object.keys(HISTORICAL_DATASETS),
    PSPS_EVENTS_LAYER.key,
    FIRE_WEATHER_LAYER.key,
    HFTD_LAYER.key,
  ];

  const getCanvasScope = () => ({
    year: getCurrentHistoricalYear(),
    years: [getCurrentHistoricalYear()],
    utility: getSelectedHistoricalUtility() || null,
    county: getSelectedHistoricalCounty() || null,
  });

  const formatViewScopeLabel = (scope = {}) => {
    const bits = [];
    if (scope.year != null && scope.year !== "") bits.push(String(scope.year));
    else if ((scope.years || []).length === 1) bits.push(String(scope.years[0]));
    else if ((scope.years || []).length > 1) bits.push(scope.years.join(", "));
    else if (scope.start_date && scope.end_date) {
      bits.push(`${scope.start_date} → ${scope.end_date}`);
    }
    if (scope.utility) bits.push(String(scope.utility));
    else if ((scope.utilities || []).length === 1) bits.push(String(scope.utilities[0]));
    else if ((scope.utilities || []).length > 1) bits.push(scope.utilities.join(" / "));
    if (scope.county) {
      const county = String(scope.county);
      bits.push(/county/i.test(county) ? county : `${county} County`);
    }
    return bits.join(", ");
  };

  const scopeDivergesClient = (answerScope, canvasScope) => {
    const answer = answerScope || {};
    const canvas = canvasScope || {};
    for (const key of ["utility", "county"]) {
      const left = answer[key];
      const right = canvas[key];
      if (left == null || left === "" || (Array.isArray(left) && !left.length)) continue;
      if (right == null || right === "" || String(left) !== String(right)) return true;
    }
    const yearsOf = (scope) => {
      if (scope.year != null && scope.year !== "") return [Number(scope.year)];
      return (scope.years || []).map(Number).filter(Number.isFinite);
    };
    const answerYears = yearsOf(answer);
    const canvasYears = yearsOf(canvas);
    if (answerYears.length && canvasYears.length && answerYears.join() !== canvasYears.join()) {
      return true;
    }
    if (answerYears.length && !canvasYears.length) return true;
    return false;
  };

  const updateStaleViewChrome = () => {
    if (!historicalCanvasStaleEl) return;
    const mapCollapsed = historicalCanvasHost?.dataset.mapCollapsed === "1";
    if (
      askInFlight ||
      !lastAgentViewScope ||
      mapCollapsed ||
      canvasPrimaryType === "stats" ||
      lastAnswerStatus === "clarification" ||
      lastAnswerStatus === "unsupported" ||
      lastAnswerStatus === "error"
    ) {
      historicalCanvasStaleEl.hidden = true;
      historicalCanvasStaleEl.textContent = "";
      return;
    }
    const canvasScope = getCanvasScope();
    if (!scopeDivergesClient(lastAgentViewScope, canvasScope)) {
      historicalCanvasStaleEl.hidden = true;
      historicalCanvasStaleEl.textContent = "";
      return;
    }
    const answerLabel = formatViewScopeLabel(lastAgentViewScope);
    const showingLabel = formatViewScopeLabel(canvasScope);
    historicalCanvasStaleEl.hidden = false;
    historicalCanvasStaleEl.textContent = answerLabel
      ? `Map no longer matches this answer (${answerLabel}${
          showingLabel ? ` · showing ${showingLabel}` : ""
        }).`
      : "Map no longer matches this answer.";
  };

  const formatStatCardValue = (params = {}) => {
    const value = Number(params.value);
    if (!Number.isFinite(value)) return "—";
    if (params.unit === "percentile") {
      const n = Math.round(value);
      const mod = n % 100;
      const suffix =
        mod >= 11 && mod <= 13
          ? "th"
          : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
      return `${n}${suffix}`;
    }
    if (params.kind === "risk" || params.unit === "risk") {
      if (value === 0) return "0";
      if (Math.abs(value) >= 0.01) return value.toFixed(4);
      return value.toExponential(2);
    }
    if (Math.abs(value - Math.round(value)) < 1e-9) {
      return Math.round(value).toLocaleString("en-US");
    }
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  };

  const setFilterStripIdle = (idle) => {
    const on = Boolean(idle);
    if (historicalTabEl) historicalTabEl.dataset.mapFilters = on ? "idle" : "active";
    if (!historicalControlsEl) return;
    historicalControlsEl.classList.toggle("sfps-historical-controls--idle", on);
    if (on) {
      historicalControlsEl.setAttribute(
        "title",
        "These filters apply to the map. Use Show map to return."
      );
    } else {
      historicalControlsEl.removeAttribute("title");
    }
  };

  const collapseMapViewport = (collapsed) => {
    if (historicalCanvasHost) {
      historicalCanvasHost.dataset.mapCollapsed = collapsed ? "1" : "0";
    }
    if (historicalCanvasRestoreEl) {
      historicalCanvasRestoreEl.hidden = !collapsed;
    }
    setFilterStripIdle(collapsed);
  };

  const renderStatCards = (specs = []) => {
    if (!historicalCanvasStatsEl) return;
    historicalCanvasStatsEl.innerHTML = "";
    const cards = (specs || [])
      .filter((item) => item && item.type === "stat_card")
      .slice(0, MAX_STAT_CARDS);
    if (!cards.length) {
      historicalCanvasStatsEl.hidden = true;
      historicalCanvasStatsEl.dataset.cardCount = "0";
      return;
    }
    cards.forEach((spec) => {
      const params = spec.params || {};
      const article = document.createElement("article");
      article.className = "sfps-stat-card";
      article.dataset.kind = params.kind || "";
      article.dataset.source = params.source_dataset || "";
      const accent = STAT_CARD_COLORS[params.source_dataset] || "#1d6fa5";
      article.style.setProperty("--stat-accent", accent);

      const valueEl = document.createElement("div");
      valueEl.className = "sfps-stat-card-value";
      valueEl.textContent = formatStatCardValue(params);

      const labelEl = document.createElement("div");
      labelEl.className = "sfps-stat-card-label";
      labelEl.textContent = params.label || params.source_dataset || "Value";

      const metaBits = [params.scope, params.period].filter((bit) => bit);
      const metaEl = document.createElement("div");
      metaEl.className = "sfps-stat-card-meta";
      metaEl.textContent = metaBits.join(" · ");

      article.appendChild(valueEl);
      article.appendChild(labelEl);
      if (metaBits.length) article.appendChild(metaEl);
      historicalCanvasStatsEl.appendChild(article);
    });
    historicalCanvasStatsEl.hidden = false;
    historicalCanvasStatsEl.dataset.cardCount = String(cards.length);
  };

  const setStatCards = (specs = []) => {
    renderStatCards(specs);
  };

  const setCanvasSlotVisible = (slot, visible) => {
    const el = historicalCanvasHost?.querySelector(`.sfps-canvas-slot--${slot}`);
    if (!el) return;
    el.hidden = !visible;
  };

  const restoreBrowseMap = (reason = "restore-browse") => {
    canvasPrimaryType = "map";
    mapExtentMode = null;
    clearAgentPointMarker();
    renderStatCards([]);
    restoreBrowseChart();
    collapseMapViewport(false);
    setCanvasSlotVisible("map", true);
    setCanvasSlotVisible("chart", true);
    setCanvasLayout("browse");
    relayoutCanvas(reason);
    setTimeout(() => relayoutCanvas(`${reason}:settle`), 180);
  };

  const bindShowMapButton = () => {
    if (!historicalCanvasShowMapBtn || historicalCanvasShowMapBtn.dataset.bound === "1") {
      return;
    }
    historicalCanvasShowMapBtn.dataset.bound = "1";
    historicalCanvasShowMapBtn.addEventListener("click", () => {
      viewSource = "user";
      if (historicalCanvasHost) historicalCanvasHost.dataset.viewSource = "user";
      restoreBrowseMap("show-map");
      updateStaleViewChrome();
    });
  };

  const noteUserMapChrome = () => {
    if (applyingAgentParams) return;
    const restoreFromNonMap = canvasPrimaryType && canvasPrimaryType !== "map";
    viewSource = "user";
    mapExtentMode = null;
    if (historicalCanvasHost) historicalCanvasHost.dataset.viewSource = "user";
    if (restoreFromNonMap) {
      restoreBrowseMap("chrome-restore-browse");
    }
    canvasPrimaryType = "map";
    updateStaleViewChrome();
  };

  const setExclusiveActiveLayers = (wanted) => {
    const want = new Set(wanted);
    allHistoricalLayerKeys().forEach((key) => {
      const on = want.has(key);
      if (on) historicalActiveLayers.add(key);
      else historicalActiveLayers.delete(key);
      const label = historicalLayerToggles?.querySelector(`[data-layer-key="${key}"]`);
      const checkbox = label?.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.checked = on;
      if (label) label.classList.toggle("is-active", on);
    });
  };

  const fitVisibleMapLayers = () => {
    if (!historicalMapInstance || typeof L === "undefined") return false;
    const bounds = L.latLngBounds([]);
    Object.entries(historicalLayerGroups).forEach(([key, group]) => {
      if (!historicalActiveLayers.has(key) || !group) return;
      if (typeof group.getBounds !== "function") return;
      const next = group.getBounds();
      if (next && next.isValid()) bounds.extend(next);
    });
    if (
      historicalActiveLayers.has(PSPS_EVENTS_LAYER.key) &&
      historicalPspsLayer &&
      typeof historicalPspsLayer.getBounds === "function"
    ) {
      const next = historicalPspsLayer.getBounds();
      if (next && next.isValid()) bounds.extend(next);
    }
    if (bounds.isValid()) {
      fitMapBounds(bounds);
      return true;
    }
    return false;
  };

  const applyMapExtent = (extent) => {
    if (!historicalMapInstance) return;
    if (extent === "conus") {
      setConusMapView();
      usIgnitionsAutoZoomed = true;
      return;
    }
    usIgnitionsAutoZoomed = false;
    if (extent === "statewide") {
      setStatewideMapView();
      return;
    }
    if (extent === "territory") {
      updateHistoricalUtilityTerritoryView();
      return;
    }
    if (extent === "auto_fit") {
      if (!fitVisibleMapLayers()) setStatewideMapView();
    }
  };

  const setHistoricalYearSilent = async (year) => {
    const y = Number(year);
    if (!Number.isFinite(y) || !historicalYearInput || !historicalYears.length) {
      return false;
    }
    const index = historicalYears.indexOf(y);
    if (index < 0) return false;
    historicalYearInput.value = String(index);
    if (historicalYearValue) historicalYearValue.textContent = String(y);
    const max = Number(historicalYearInput.max) || 0;
    const percent = max ? (index / max) * 100 : 0;
    historicalYearInput.style.setProperty("--value", `${percent}%`);
    if (USE_VIS_API) {
      await refreshHistoricalYearData(y);
    } else {
      renderHistoricalMapAndChart(y);
    }
    setWeatherAnimYear(y);
    return true;
  };

  const setFilterSelectSilent = (select, value) => {
    if (!select) return false;
    const raw = value == null ? "" : String(value).trim();
    const options = Array.from(select.options).map((item) => item.value);
    let match = "";
    if (raw) {
      match =
        options.find((item) => item === raw) ||
        options.find((item) => item.toUpperCase() === raw.toUpperCase()) ||
        options.find((item) => item.toLowerCase() === raw.toLowerCase()) ||
        options.find((item) =>
          item.toLowerCase().startsWith(raw.toLowerCase().replace(/\s+county$/i, ""))
        ) ||
        "";
      if (!match && !options.includes(raw)) return false;
    }
    select.value = match;
    return true;
  };

  const setMapParams = async (params = {}, viewScope = null, options = {}) => {
    applyingAgentParams = true;
    viewSource = "agent";
    canvasPrimaryType = "map";
    const extent = params.extent || "statewide";
    const layout = options.layout || "browse";
    mapExtentMode = extent;
    if (historicalCanvasHost) historicalCanvasHost.dataset.viewSource = "agent";
    lastAgentViewScope = viewScope || {
      year: params.year,
      utility: params.utility || null,
      county: params.county || null,
    };
    try {
      extentFitPaused = true;
      setCanvasSlotVisible("map", true);
      setCanvasSlotVisible("chart", true);
      collapseMapViewport(false);
      setCanvasLayout(layout);
      if (layout === "browse" || layout === "map") {
        agentSeriesActive = false;
        setChartChrome("browse");
      } else {
        agentSeriesActive = true;
        setChartChrome("agent");
      }
      const layerKeys = [];
      (params.datasets || []).forEach((dataset) => {
        const key = AGENT_DATASET_TO_LAYER[dataset];
        if (key) layerKeys.push(key);
      });
      if (params.show_hftd) layerKeys.push(HFTD_LAYER.key);
      setExclusiveActiveLayers(layerKeys);
      setFilterSelectSilent(historicalUtilityFilter, params.utility || "");
      setFilterSelectSilent(historicalCountyFilter, params.county || "");
      const year = params.year != null ? Number(params.year) : getCurrentHistoricalYear();
      if (layerKeys.includes("usIgnitions") && USE_VIS_API && VisApi) {
        try {
          await loadUsIgnitionsYearFromApi(year, null);
        } catch (error) {
          console.warn("US Ignitions load failed during map setParams:", error);
        }
      }
      await setHistoricalYearSilent(year);
      extentFitPaused = false;
      applyMapExtent(extent);
      // highlight_ids is in the schema; skipped this slice.
    } finally {
      extentFitPaused = false;
      applyingAgentParams = false;
    }
    scheduleAgentCanvasSettle("map:setParams");
    updateStaleViewChrome();
    return {
      synced: true,
      viewSource,
      extent,
      year: getCurrentHistoricalYear(),
      utility: getSelectedHistoricalUtility(),
      county: getSelectedHistoricalCounty(),
    };
  };

  const applyCanvasViews = async (payload = {}) => {
    const status = payload.view_status;
    const answerStatus = payload.status;
    const scope = payload.view_scope;
    if (answerStatus) {
      lastAnswerStatus = answerStatus;
    }
    if (
      answerStatus === "clarification" ||
      answerStatus === "unsupported" ||
      answerStatus === "error"
    ) {
      if (historicalCanvasStaleEl) {
        historicalCanvasStaleEl.hidden = true;
        historicalCanvasStaleEl.textContent = "";
      }
      return;
    }
    lastAgentViewScope = scope || lastAgentViewScope;
    const list = payload.views || [];
    const types = list.map((item) => item.type);
    const mapSpec = list.find((item) => item.type === "map");
    const seriesSpec = list.find((item) => item.type === "time_series");
    const comparisonSpec = list.find((item) => item.type === "comparison");
    const recordsSpec = list.find((item) => item.type === "record_table");
    const spatialSpec = list.find((item) => item.type === "spatial_context");
    const stats = list.filter((item) => item.type === "stat_card");
    renderStatCards(stats);

    if (answerStatus === "answer" && mapSpec) {
      const split = Boolean(seriesSpec || comparisonSpec || recordsSpec || spatialSpec);
      const layout = split ? "split-vertical" : stats.length ? "map" : "browse";
      await setMapParams(mapSpec.params || {}, scope, { layout });
      if (seriesSpec) {
        await setTimeSeries(seriesSpec, { layout: "split-vertical" });
      } else if (comparisonSpec) {
        await setComparison(comparisonSpec, { layout: "split-vertical" });
      } else if (recordsSpec) {
        await setRecordTable(recordsSpec, { layout: "split-vertical" });
      } else if (spatialSpec) {
        await setSpatialContext(spatialSpec, { layout: "split-vertical" });
      }
      return;
    }

    if (answerStatus === "answer" && seriesSpec) {
      await setTimeSeries(seriesSpec, { layout: "series" });
      return;
    }

    if (answerStatus === "answer" && comparisonSpec) {
      await setComparison(comparisonSpec, { layout: "series" });
      return;
    }

    if (answerStatus === "answer" && recordsSpec) {
      await setRecordTable(recordsSpec, { layout: "series" });
      return;
    }

    if (answerStatus === "answer" && spatialSpec) {
      await setSpatialContext(spatialSpec, { layout: "series" });
      return;
    }

    if (answerStatus === "answer" && stats.length && !types.includes("map")) {
      agentSeriesActive = false;
      setChartChrome("browse");
      canvasPrimaryType = "stats";
      collapseMapViewport(true);
      setCanvasSlotVisible("chart", false);
      setCanvasLayout("stats");
      updateStaleViewChrome();
      requestAnimationFrame(() => relayoutCanvas("stats:apply"));
      setTimeout(() => relayoutCanvas("stats:apply:settle"), 180);
      return;
    }

    if (types.includes("map")) {
      canvasPrimaryType = "map";
      collapseMapViewport(false);
    } else if (types.length) {
      canvasPrimaryType = "other";
    }

    if (status === "none" || status === "planner_fallback") {
      if (canvasPrimaryType === "stats" || canvasPrimaryType === "series" || canvasPrimaryType === "comparison" || canvasPrimaryType === "records" || canvasPrimaryType === "spatial") {
        restoreBrowseMap("planner-fallback");
      }
      updateStaleViewChrome();
    } else if (canvasPrimaryType === "other") {
      updateStaleViewChrome();
    }
  };

  const notifyAgentViews = (payload = {}) => applyCanvasViews(payload);

  const ensureHistoricalMapAndChart = () => {
    if (!historicalMapChartInitialized) {
      historicalMapChartInitialized = true;
      initHistoricalMapAndChart();
      return;
    }
    relayoutCanvas("tab-show");
    if (weatherAnimInitialized && weatherAnimData && !weatherAnimLoading) {
      drawWeatherContours();
    }
  };

  const setStatus = (el, message, isError = false) => {
    if (!el) return;
    const showErr = isError && !!message;
    el.textContent = message || "";
    el.classList.toggle("sfps-status--error", showErr);
    if (!showErr) el.style.color = "";
  };

  const applyFixedImageParams = () => {
    if (gridPlotsMode) return;
    Object.entries(fixedImageParams).forEach(([param, value]) => {
      imageSelection[param] = value;
      userSelected.add(param);
    });
  };

  const isHistoricalYearPlaying = () => historicalYearPlayTimer != null;

  const stopHistoricalYearPlayback = () => {
    if (historicalYearPlayTimer != null) {
      clearInterval(historicalYearPlayTimer);
      historicalYearPlayTimer = null;
    }
    if (historicalYearPlay) {
      historicalYearPlay.textContent = "▶";
      historicalYearPlay.setAttribute("aria-pressed", "false");
      historicalYearPlay.setAttribute("aria-label", "Play year animation");
    }
  };

  const advanceHistoricalYearStep = () => {
    if (!historicalYearInput) return;
    const max = Number(historicalYearInput.max) || 0;
    const current = Number(historicalYearInput.value) || 0;
    const next = max > 0 ? (current + 1) % (max + 1) : 0;
    historicalYearInput.value = String(next);
    historicalYearInput.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const startHistoricalYearPlayback = () => {
    if (historicalYearPlayTimer != null) return;
    pauseWeatherAnim();
    if (historicalYearPlay) {
      historicalYearPlay.textContent = "⏸";
      historicalYearPlay.setAttribute("aria-pressed", "true");
      historicalYearPlay.setAttribute("aria-label", "Pause year animation");
    }
    historicalYearPlayTimer = setInterval(advanceHistoricalYearStep, 1500);
  };

  const weatherLerp = (a, b, t) => a + (b - a) * t;

  const formatWeatherDate = (dateStr) => {
    if (!dateStr) return "—";
    const parts = dateStr.split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dateStr;
    const [year, month, day] = parts;
    return weatherDateFormatter.format(new Date(year, month - 1, day));
  };

  const getWeatherBandForThreshold = (threshold) => {
    const bands = weatherMeta?.bands || [];
    // Contour Low uses threshold 1; meta Low uses enc_min 0.
    const match =
      bands.find((band) => Number(band.enc_min) === Number(threshold)) ||
      (threshold === 1 ? bands.find((band) => Number(band.enc_min) === 0) : null);
    if (match) return match;
    const fallback = WEATHER_THRESHOLD_BANDS.find((band) => band.threshold === threshold);
    return fallback || { name: "Low", color: "#fee8c8" };
  };

  const formatWeatherHdwRange = (band) => {
    const units = weatherMeta?.units || "hPa*m/s";
    const min = band.min_hdw;
    const max = band.max_hdw;
    if (min == null && max == null) return "";
    if (max == null || max === "") return `${band.name}: ≥${min} ${units}`;
    return `${band.name}: ${min}–${max} ${units}`;
  };

  const buildWeatherLegend = () => {
    if (!weatherLegendEl) return;
    const bands = weatherMeta?.bands || WEATHER_THRESHOLD_BANDS;
    weatherLegendEl.innerHTML = "";
    bands.forEach((band) => {
      const item = document.createElement("div");
      item.className = "sfps-weather-legend-item";
      const rangeLabel = formatWeatherHdwRange(band);
      if (rangeLabel) {
        item.title = rangeLabel;
        item.setAttribute("aria-label", rangeLabel);
      }
      const swatch = document.createElement("span");
      swatch.className = "sfps-weather-legend-swatch";
      swatch.style.background = band.color;
      const label = document.createElement("span");
      label.textContent = band.name;
      item.appendChild(swatch);
      item.appendChild(label);
      weatherLegendEl.appendChild(item);
    });
  };

  const setWeatherSourcePopoverOpen = (open) => {
    if (!weatherSourceInfoBtn || !weatherSourcePopover) return;
    weatherSourcePopover.hidden = !open;
    weatherSourceInfoBtn.setAttribute("aria-expanded", String(open));
  };

  const updateWeatherAttribution = (dateLabel = "—") => {
    const source =
      weatherMeta?.source_short ||
      weatherMeta?.source ||
      "Hot-Dry-Windy Index (HDW)";
    const text = dateLabel === "—" || !dateLabel ? source : `${source} · ${dateLabel}`;
    if (weatherAttributionEl) weatherAttributionEl.textContent = text;

    const longSource = weatherMeta?.source_long || weatherMeta?.citation || "";
    if (weatherSourcePopover) weatherSourcePopover.textContent = longSource;
    if (weatherSourceInfoBtn) {
      if (longSource) {
        weatherSourceInfoBtn.hidden = false;
        weatherSourceInfoBtn.title = "Full source and citation";
      } else {
        weatherSourceInfoBtn.hidden = true;
        setWeatherSourcePopoverOpen(false);
      }
    }
  };

  const updateWeatherAnimUI = () => {
    if (!weatherAnimData) return;
    const nDays = weatherAnimData.dates.length;
    const dayIndex = Math.floor(weatherAnimDayT) % nDays;
    const frac = weatherAnimDayT - Math.floor(weatherAnimDayT);
    const displayIndex = frac >= 0.5 ? (dayIndex + 1) % nDays : dayIndex;
    const dateLabel = formatWeatherDate(weatherAnimData.dates[displayIndex]);

    if (weatherScrub) {
      weatherScrub.max = String(Math.max(0, nDays - 1));
      weatherScrub.value = String(displayIndex);
    }
    if (weatherDateEl) weatherDateEl.textContent = dateLabel;
    updateWeatherAttribution(dateLabel);
    updateHistoricalChartDayMarker();
  };

  const setWeatherLoadingUI = (message = "Loading…") => {
    if (weatherDateEl) weatherDateEl.textContent = message;
    updateWeatherAttribution(message);
  };

  const fillWeatherGrid = (values0, values1, frac) => {
    const { rows, cols } = weatherMeta;
    const grid = new Float32Array(rows * cols);
    for (let i = 0; i < weatherCells.length; i += 1) {
      const cell = weatherCells[i];
      const v0 = values0[i] ?? 0;
      const v1 = values1[i] ?? 0;
      grid[cell.row * cols + cell.col] = weatherLerp(v0, v1, frac);
    }
    return grid;
  };

  const sampleBilinear = (grid, cols, rows, x, y) => {
    const x0 = Math.max(0, Math.min(cols - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(rows - 1, Math.floor(y)));
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const v00 = grid[y0 * cols + x0] || 0;
    const v10 = grid[y0 * cols + x1] || 0;
    const v01 = grid[y1 * cols + x0] || 0;
    const v11 = grid[y1 * cols + x1] || 0;
    return (1 - tx) * (1 - ty) * v00 + tx * (1 - ty) * v10 + (1 - tx) * ty * v01 + tx * ty * v11;
  };

  const bilinearUpsampleGrid = (grid, rows, cols, factor) => {
    const upRows = rows * factor;
    const upCols = cols * factor;
    const out = new Float32Array(upRows * upCols);
    for (let j = 0; j < upRows; j += 1) {
      for (let i = 0; i < upCols; i += 1) {
        out[j * upCols + i] = sampleBilinear(grid, cols, rows, i / factor, j / factor);
      }
    }
    return { values: out, rows: upRows, cols: upCols };
  };

  const gaussianBlurGrid = (grid, rows, cols) => {
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    const norm = 16;
    const out = new Float32Array(rows * cols);
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        let sum = 0;
        let ki = 0;
        for (let dj = -1; dj <= 1; dj += 1) {
          for (let di = -1; di <= 1; di += 1) {
            const ni = Math.max(0, Math.min(cols - 1, i + di));
            const nj = Math.max(0, Math.min(rows - 1, j + dj));
            sum += (grid[nj * cols + ni] || 0) * kernel[ki];
            ki += 1;
          }
        }
        out[j * cols + i] = sum / norm;
      }
    }
    return out;
  };

  const gridPointToLonLat = (x, y) => {
    const { lon0, lat0, spacing } = weatherMeta;
    return [
      lon0 + (x / WEATHER_UPSAMPLE) * spacing,
      lat0 + (y / WEATHER_UPSAMPLE) * spacing
    ];
  };

  const contourGeometryToFeature = (geometry, band) => ({
    type: "Feature",
    properties: {
      band: band.name,
      threshold: geometry.value,
      color: band.color
    },
    geometry: {
      type: geometry.type,
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => ring.map(([x, y]) => gridPointToLonLat(x, y)))
      )
    }
  });

  const buildWeatherContourGeoJson = () => {
    if (!weatherMeta || !weatherCells || !weatherAnimData || typeof d3 === "undefined" || typeof d3.contours !== "function") {
      return null;
    }

    const { rows, cols } = weatherMeta;
    const nDays = weatherAnimData.dates.length;
    if (!nDays) return null;

    const day0 = Math.floor(weatherAnimDayT) % nDays;
    const day1 = (day0 + 1) % nDays;
    const frac = weatherAnimDayT - Math.floor(weatherAnimDayT);
    const values0 = weatherAnimData.values[day0];
    const values1 = weatherAnimData.values[day1];

    const baseGrid = fillWeatherGrid(values0, values1, frac);
    const upsampled = bilinearUpsampleGrid(baseGrid, rows, cols, WEATHER_UPSAMPLE);
    const smoothed = gaussianBlurGrid(upsampled.values, upsampled.rows, upsampled.cols);

    const contourGen = d3.contours().size([upsampled.cols, upsampled.rows]).thresholds(WEATHER_THRESHOLDS);
    const contourGeometries = contourGen(smoothed);

    const features = contourGeometries
      .slice()
      .sort((a, b) => a.value - b.value)
      .map((geometry) => {
        const band = getWeatherBandForThreshold(geometry.value);
        return contourGeometryToFeature(geometry, band);
      });

    return { type: "FeatureCollection", features };
  };

  const drawWeatherContours = () => {
    // Caption/scrubber track the loaded year even when Fire-Weather is off
    // (agent exclusive layers) or contours are still expensive to build.
    if (weatherAnimData && !weatherAnimLoading) {
      updateWeatherAnimUI();
    }
    if (!historicalWeatherLayer) return;

    if (!historicalActiveLayers.has(FIRE_WEATHER_LAYER.key)) {
      historicalWeatherLayer.clearLayers();
      return;
    }

    if (!weatherAnimData || weatherAnimLoading) return;

    const geojson = buildWeatherContourGeoJson();
    historicalWeatherLayer.clearLayers();
    if (geojson?.features?.length) {
      historicalWeatherLayer.addData(geojson);
    }
    historicalWeatherLayer.bringToBack();
  };

  const tickWeatherAnim = (now) => {
    if (!weatherAnimPlaying) return;
    if (weatherAnimLastFrameMs == null) weatherAnimLastFrameMs = now;
    const elapsed = now - weatherAnimLastFrameMs;
    weatherAnimLastFrameMs = now;

    if (weatherAnimData && !weatherAnimLoading) {
      const nDays = weatherAnimData.dates.length;
      if (nDays > 0) {
        weatherAnimDayT += (elapsed / WEATHER_DAY_DURATION_MS) * weatherAnimSpeed;
        while (weatherAnimDayT >= nDays) weatherAnimDayT -= nDays;
        const dayIndex = Math.floor(weatherAnimDayT) % nDays;
        if (weatherDayFilterActive && dayIndex !== weatherLastSyncedDayIndex) {
          weatherLastSyncedDayIndex = dayIndex;
          renderHistoricalMapAndChart(getCurrentHistoricalYear());
        } else {
          drawWeatherContours();
        }
      }
    }

    weatherAnimRafId = requestAnimationFrame(tickWeatherAnim);
  };

  const pauseWeatherAnim = () => {
    weatherAnimPlaying = false;
    weatherAnimLastFrameMs = null;
    if (weatherAnimRafId != null) {
      cancelAnimationFrame(weatherAnimRafId);
      weatherAnimRafId = null;
    }
    if (weatherPlayBtn) {
      weatherPlayBtn.textContent = "▶";
      weatherPlayBtn.setAttribute("aria-pressed", "false");
      weatherPlayBtn.setAttribute("aria-label", "Play fire-weather animation");
    }
  };

  const startWeatherAnim = () => {
    if (!weatherAnimData || weatherAnimLoading) return;
    if (weatherAnimPlaying) return;
    stopHistoricalYearPlayback();
    weatherDayFilterActive = true;
    weatherLastSyncedDayIndex = getWeatherIntegerDayIndex();
    weatherAnimPlaying = true;
    weatherAnimLastFrameMs = null;
    if (weatherPlayBtn) {
      weatherPlayBtn.textContent = "⏸";
      weatherPlayBtn.setAttribute("aria-pressed", "true");
      weatherPlayBtn.setAttribute("aria-label", "Pause fire-weather animation");
    }
    renderHistoricalMapAndChart(getCurrentHistoricalYear());
    weatherAnimRafId = requestAnimationFrame(tickWeatherAnim);
  };

  const loadWeatherGrid = async () => {
    if (weatherCells && weatherMeta) return weatherCells;
    const response = await fetch(`${WEATHER_ANIM_BASE}/grid_cells.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    weatherMeta = data.meta;
    weatherCells = data.cells;
    buildWeatherLegend();
    return weatherCells;
  };

  const loadWeatherYearData = async (year) => {
    if (weatherYearCache[year]) return weatherYearCache[year];
    const response = await fetch(`${WEATHER_ANIM_BASE}/weather_anim_${year}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    weatherYearCache[year] = data;
    return data;
  };

  const setWeatherAnimYear = async (year) => {
    if (!weatherPlayBtn) return;
    const loadToken = ++weatherAnimLoadToken;
    pauseWeatherAnim();
    weatherDayFilterActive = false;
    weatherLastSyncedDayIndex = null;
    weatherAnimYear = year;
    weatherAnimDayT = 0;
    weatherAnimData = null;
    weatherAnimLoading = true;

    if (!weatherCells) {
      try {
        await loadWeatherGrid();
      } catch (error) {
        if (loadToken !== weatherAnimLoadToken) return;
        setWeatherLoadingUI("Grid unavailable");
        weatherAnimLoading = false;
        return;
      }
    }

    if (loadToken !== weatherAnimLoadToken) return;
    setWeatherLoadingUI("Loading…");

    try {
      const data = await loadWeatherYearData(year);
      if (loadToken !== weatherAnimLoadToken) return;
      weatherAnimData = data;
      weatherAnimLoading = false;
      updateWeatherAnimUI();
      drawWeatherContours();
    } catch (error) {
      if (loadToken !== weatherAnimLoadToken) return;
      weatherAnimLoading = false;
      setWeatherLoadingUI("Weather data unavailable");
    }
  };

  const initWeatherAnim = async () => {
    if (!weatherPlayBtn) return;
    if (!weatherAnimInitialized) {
      weatherAnimInitialized = true;

      if (weatherPlayBtn) {
        weatherPlayBtn.addEventListener("click", () => {
          noteUserMapChrome();
          if (weatherAnimPlaying) pauseWeatherAnim();
          else startWeatherAnim();
        });
      }

      if (weatherSpeedSelect) {
        weatherAnimSpeed = Number(weatherSpeedSelect.value) || 1;
        weatherSpeedSelect.addEventListener("change", () => {
          weatherAnimSpeed = Number(weatherSpeedSelect.value) || 1;
        });
      }

      if (weatherScrub) {
        weatherScrub.addEventListener("input", () => {
          noteUserMapChrome();
          pauseWeatherAnim();
          if (!weatherAnimData) return;
          const day = Number(weatherScrub.value) || 0;
          weatherAnimDayT = day;
          weatherDayFilterActive = true;
          weatherLastSyncedDayIndex = day;
          updateWeatherAnimUI();
          renderHistoricalMapAndChart(getCurrentHistoricalYear());
        });
      }

      if (weatherSourceInfoBtn && weatherSourcePopover) {
        weatherSourceInfoBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          const open = weatherSourceInfoBtn.getAttribute("aria-expanded") !== "true";
          setWeatherSourcePopoverOpen(open);
        });
        document.addEventListener("click", (event) => {
          if (weatherSourcePopover.hidden) return;
          const target = event.target;
          if (
            weatherSourcePopover.contains(target) ||
            weatherSourceInfoBtn.contains(target)
          ) {
            return;
          }
          setWeatherSourcePopoverOpen(false);
        });
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape") setWeatherSourcePopoverOpen(false);
        });
      }
    }

    try {
      await loadWeatherGrid();
      if (weatherAnimYear !== getCurrentHistoricalYear() || !weatherAnimData) {
        await setWeatherAnimYear(getCurrentHistoricalYear());
      } else {
        drawWeatherContours();
      }
    } catch (error) {
      setWeatherLoadingUI("Weather animation unavailable");
    }
  };

  const initHistorical = () => {
    if (!historicalYearInput || !historicalYearValue) return;
    if (!historicalYears.length) return;

    historicalYearInput.min = "0";
    historicalYearInput.max = String(historicalYears.length - 1);
    historicalYearInput.step = "1";
    historicalYearInput.value = String(historicalYears.length - 1);

    const updateSliderFill = () => {
      const max = Number(historicalYearInput.max) || 0;
      const val = Number(historicalYearInput.value) || 0;
      const percent = max ? (val / max) * 100 : 0;
      historicalYearInput.style.setProperty("--value", `${percent}%`);
    };

    const updateYear = () => {
      const year = historicalYears[Number(historicalYearInput.value)] ?? historicalYears[0];
      historicalYearValue.textContent = String(year);
      if (USE_VIS_API) {
        refreshHistoricalYearData(year);
      } else {
        renderHistoricalMapAndChart(year);
      }
      setWeatherAnimYear(year);
      updateSliderFill();
    };

    const handleYearInput = (event) => {
      noteUserMapChrome();
      if (event.isTrusted && isHistoricalYearPlaying()) {
        stopHistoricalYearPlayback();
      }
      updateYear();
    };

    historicalYearInput.addEventListener("input", handleYearInput);
    historicalYearInput.addEventListener("change", handleYearInput);

    if (historicalYearPlay) {
      historicalYearPlay.addEventListener("click", () => {
        noteUserMapChrome();
        if (isHistoricalYearPlaying()) {
          stopHistoricalYearPlayback();
        } else {
          startHistoricalYearPlayback();
        }
      });
    }

    updateYear();
  };

  const getLabel = (param) =>
    gridPlotsMode && gridShortLabels[param] ? gridShortLabels[param] : paramLabels[param] || param;
  const getOptionLabel = (param, value) => {
    if (param === "mht_method") {
      if (gridPlotsMode) {
        const v = String(value);
        if (Object.prototype.hasOwnProperty.call(gridMethodLabels, v)) {
          return gridMethodLabels[v];
        }
        return v.replace(/_/g, " ");
      }
      return String(value).replace(/_/g, " + ");
    }
    return value;
  };

  const parseCsvText = (text) => {
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (result.errors && result.errors.length) {
      throw new Error(result.errors[0].message);
    }
    return result.data;
  };

  const initTabs = () => {
    const tabButtons = Array.from(root.querySelectorAll(".sfps-tab-button"));
    const tabPanels = Array.from(root.querySelectorAll(".sfps-tab-panel"));
    if (!tabButtons.length || !tabPanels.length) return;

    const setActiveTab = (targetId) => {
      tabButtons.forEach((button) => {
        const isActive = button.dataset.tab === targetId;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", String(isActive));
      });
      tabPanels.forEach((panel) => {
        const isActive = panel.id === targetId;
        panel.classList.toggle("is-active", isActive);
        panel.toggleAttribute("hidden", !isActive);
      });
      if (targetId !== "sfps-tab-historical") {
        stopHistoricalYearPlayback();
        pauseWeatherAnim();
      }
      if (targetId === "sfps-tab-historical") {
        ensureHistoricalMapAndChart();
      }
    };

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const targetId = button.dataset.tab;
        if (!targetId) return;
        setActiveTab(targetId);
      });
    });

    const initialButton = tabButtons.find((button) => button.classList.contains("is-active"));
    const initialTarget = initialButton?.dataset.tab || tabButtons[0].dataset.tab;
    if (initialTarget) {
      setActiveTab(initialTarget);
    }
  };

  const parseImageName = (path) => {
    if (!path) return null;
    const filename = path.split("/").pop() || "";
    const withoutExt = filename.replace(/\.(png|jpg|jpeg)$/i, "");
    let base = withoutExt;

    const suffixes = {
      hftd: base.includes("_with_hftd"),
      inset: base.includes("_with_inset")
    };

    base = base
      .replace(/_with_hftd/g, "")
      .replace(/_with_inset/g, "")
      .replace(/_no_inset/g, "");

    const mhtMarker = "_mht_method=";
    const mhtIndex = base.lastIndexOf(mhtMarker);
    if (mhtIndex === -1) return null;

    const prefix = base.slice(0, mhtIndex);
    const mhtMethod = base.slice(mhtIndex + mhtMarker.length);

    const rowMatch = prefix.match(/^map_row(\d+)_/);
    if (!rowMatch) return null;
    const row = Number(rowMatch[1]);
    const remainder = prefix.slice(rowMatch[0].length);

    const params = {};
    const regex = /([A-Za-z]+(?:_[A-Za-z]+)*)=([^_]+)/g;
    let match = regex.exec(remainder);
    while (match) {
      const key = match[1];
      const value = match[2];
      if (key && value !== undefined) {
        params[key] = value;
      }
      match = regex.exec(remainder);
    }

    return {
      path,
      row: Number.isNaN(row) ? null : row,
      params: {
        ...params,
        mht_method: mhtMethod
      },
      suffix: {
        hftd: suffixes.hftd,
        inset: suffixes.inset
      }
    };
  };

  /** Maps always use experiment id 0: grid_plots/{folder}/exp_0_{method_slug}/map.png */
  const GRID_MAP_EXP_ID = 0;

  /** Three-method comparison shown in Planning Tool (grid mode). */
  const COMPARE_METHODS = [
    { id: "ours",    slug: "group_conformal_fixed", name: "Ours", tag: "" },
    { id: "bonf",    slug: "co_optimized",          name: "Co-Optimized" },
    { id: "maxrank", slug: "planning_only",         name: "Planning-Only" },
  ];

  /** Key outcome metrics shown per method below each map. */
  const COMPARE_METRICS = [
    { key: "x_size",      label: "Sectionalized" },
    { key: "y_size",      label: "Fast-Trip" },
    { key: "z_star_size", label: "Actual PSPS" },
    {
      key: "true_cost",
      label: "Eval. Cost (10⁶)",
      fmt: (v) => (Number(v) * 1e-6).toFixed(2)
    },
  ];

  /**
   * Grid mode: default FWER, budgets, SAIFI, effectiveness, γ, and δ (initial load + Reset).
   * Must match a row in merged_planning_grid.csv (same scenario_slug for all methods).
   */
  const GRID_DEFAULT_HYPERPARAMS = {
    alpha: 0.4,
    B_budget_multiplier: 0.2,
    C_budget_multiplier: 0.3,
    W_cap_multiplier: 0.1,
    effective_alpha: 0.9,
    gamma_i_multiplier: 0.8,
    delta: 1
  };

  const buildGridImageMetaFromRow = (row) => {
    const folderSlug = row.scenario_slug;
    const methodSlug = row.method_slug;
    if (!folderSlug || !methodSlug) return null;
    const path = `grid_plots/${folderSlug}/exp_${GRID_MAP_EXP_ID}_${methodSlug}/map.png`;
    const str = (v) => (v === undefined || v === null ? "" : String(v));
    return {
      path,
      folderSlug,
      row: GRID_MAP_EXP_ID,
      params: {
        B_budget_multiplier: str(row.B_budget_multiplier),
        C_budget_multiplier: str(row.C_budget_multiplier),
        W_cap_multiplier: str(row.W_cap_multiplier),
        effective_alpha: str(row.effective_alpha),
        gamma_i_multiplier: str(row.gamma_i_multiplier),
        mht_method: str(row.mht_method),
        alpha: str(row.alpha),
        delta: str(row.delta),
        grouping_method: str(row.grouping_method || "grid")
      },
      suffix: { hftd: false, inset: false }
    };
  };

  /** Params encoded in grid folder names: a__C__B__W__ae__g__d__&lt;hash&gt; */
  const gridEncodedParamKeys = new Set([
    "alpha",
    "B_budget_multiplier",
    "C_budget_multiplier",
    "W_cap_multiplier",
    "effective_alpha",
    "gamma_i_multiplier",
    "delta"
  ]);

  const floatToToken = (val) => {
    const n = Number(val);
    if (Number.isNaN(n)) return "0p0";
    const s = n.toFixed(12).replace(/\.?0+$/, "");
    if (!s.includes(".")) return `${s}p0`;
    const [intp, frac] = s.split(".");
    const fracTrim = (frac || "").replace(/0+$/, "") || "0";
    return `${intp}p${fracTrim}`;
  };

  const encodeDelta = (val) => {
    const n = Number(val);
    if (Number.isNaN(n)) return "0";
    const s = n.toFixed(12).replace(/\.?0+$/, "");
    if (!s.includes(".")) return s;
    const [intp, frac] = s.split(".");
    if (!frac || /^0+$/.test(frac)) return intp;
    const fracTrim = frac.replace(/0+$/, "") || "0";
    return `${intp}p${fracTrim}`;
  };

  const encodeGridFolderPrefix = (sel) => {
    const a = floatToToken(sel.alpha);
    const C = floatToToken(sel.C_budget_multiplier);
    const B = floatToToken(sel.B_budget_multiplier);
    const W = floatToToken(sel.W_cap_multiplier);
    const ae = floatToToken(sel.effective_alpha);
    const g = floatToToken(sel.gamma_i_multiplier);
    const d = encodeDelta(sel.delta);
    return `a${a}__C${C}__B${B}__W${W}__ae${ae}__g${g}__d${d}`;
  };

  /**
   * Match encoded slider tuple to a folder name on disk (CSV column scenario_slug is the path segment).
   * Prefer scenario folders without legacy "__expid0__" duplicate segment when multiple names share the same prefix.
   */
  const resolveGridFolderSlug = (prefix) => {
    const folders = [...new Set(dataset.map((r) => r.scenario_slug).filter(Boolean))];
    const candidates = folders.filter((s) => s === prefix || s.startsWith(`${prefix}__`));
    if (!candidates.length) return null;
    const preferred = candidates.find((s) => !String(s).includes("expid0"));
    return preferred || candidates[0];
  };

  const getSuffixLabel = (suffix) => {
    if (suffix.hftd && suffix.inset) return "HFTD + Inset";
    if (suffix.hftd) return "HFTD";
    if (suffix.inset) return "Inset";
    return "None";
  };

  const getSuffixKey = (suffix) => {
    if (suffix.hftd && suffix.inset) return "with_hftd_with_inset";
    if (suffix.hftd) return "with_hftd";
    if (suffix.inset) return "with_inset";
    return "none";
  };

  const normalizeImagePath = (path) => {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (path.startsWith("assets/")) return `${basePath}/${path}`;
    return `${imageBasePath}${path}`;
  };

  const getUniqueValues = (rows, key) => {
    const values = new Set();
    rows.forEach((row) => {
      const value = row[key];
      if (value !== undefined && value !== null && value !== "") {
        values.add(value);
      }
    });
    const list = Array.from(values);
    if (list.every((val) => !Number.isNaN(Number(val)))) {
      return list.sort((a, b) => Number(a) - Number(b));
    }
    return list.sort();
  };

  const rebuildGridImageMetaFromDataset = () => {
    if (!gridPlotsMode || !dataset.length) {
      imageMeta = [];
      return;
    }
    const exp0 = dataset.filter(
      (r) =>
        Number(r.exp_id) === GRID_MAP_EXP_ID &&
        !GRID_MHT_EXCLUDED_SLUGS.has(String(r.mht_method))
    );
    const seen = new Set();
    imageMeta = [];
    exp0.forEach((row) => {
      const m = buildGridImageMetaFromRow(row);
      if (!m) return;
      const key = `${m.folderSlug}||${m.params.mht_method}`;
      if (seen.has(key)) return;
      seen.add(key);
      imageMeta.push(m);
    });
  };

  const syncGridImageDefaultsFromDataset = (rows) => {
    if (!gridPlotsMode || !rows.length) return;

    const rowMatchesDefaultHyperparams = (row) => {
      if (Number(row.exp_id) !== GRID_MAP_EXP_ID) return false;
      return [...gridEncodedParamKeys].every((k) => {
        const target = GRID_DEFAULT_HYPERPARAMS[k];
        const rn = Number(row[k]);
        const tn = Number(target);
        if (!Number.isNaN(rn) && !Number.isNaN(tn)) return rn === tn;
        return String(row[k]) === String(target);
      });
    };

    const pick =
      rows.find(rowMatchesDefaultHyperparams) ||
      rows.find(
        (row) =>
          Number(row.exp_id) === GRID_MAP_EXP_ID &&
          !GRID_MHT_EXCLUDED_SLUGS.has(String(row.mht_method))
      ) ||
      rows.find((row) => Number(row.exp_id) === GRID_MAP_EXP_ID) ||
      rows[0];

    const canonGridParam = (k, rawVal) => {
      if (rawVal === undefined || rawVal === null || rawVal === "") return;
      const uniques = getUniqueValues(dataset, k);
      const vn = Number(rawVal);
      const hit = uniques.find((x) => {
        const xn = Number(x);
        if (!Number.isNaN(vn) && !Number.isNaN(xn)) return vn === xn;
        return String(x) === String(rawVal);
      });
      imageSelection[k] = hit !== undefined ? String(hit) : String(rawVal);
    };

    [...gridEncodedParamKeys].forEach((k) => canonGridParam(k, pick[k]));
    if (pick.mht_method != null && pick.mht_method !== "") {
      imageSelection.mht_method = String(pick.mht_method);
    }
    imageSelection.suffix = "none";
  };

  const handleCsvData = (rows) => {
    dataset = rows;

    if (gridPlotsMode && rows.length) {
      rebuildGridImageMetaFromDataset();
      const exp0 = rows.filter((r) => Number(r.exp_id) === GRID_MAP_EXP_ID);
      syncGridImageDefaultsFromDataset(exp0.length ? exp0 : rows);
    }

    buildImageControls();
    renderImage();
  };

  const loadCsvFromUrl = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch CSV.");
    return await response.text();
  };

  const loadCsv = async () => {
    try {
      let text = "";
      if (defaultCsvFile) {
        const csvUrl = `${plotsBasePath}/${defaultCsvFile}`;
        text = await loadCsvFromUrl(csvUrl);
        usingDefaultCsv = true;
      } else {
        return;
      }
      const rows = parseCsvText(text);
      handleCsvData(rows);
    } catch (error) {
      usingDefaultCsv = false;
    }
  };

  const requiredSliderParams = new Set([
    "alpha",
    "B_budget_multiplier",
    "C_budget_multiplier",
    "effective_alpha",
    "gamma_i_multiplier",
    "W_cap_multiplier",
    "delta"
  ]);

  const valuesMatch = (metaValue, selectedValue) => {
    const metaNum = Number(metaValue);
    const selectedNum = Number(selectedValue);
    if (!Number.isNaN(metaNum) && !Number.isNaN(selectedNum)) {
      return metaNum === selectedNum;
    }
    return String(metaValue) === String(selectedValue);
  };

  /**
   * Map slider tuple to scenario_slug using CSV rows (authoritative), not folder-name prefix encoding alone.
   * Folder names may use a different α token (e.g. a0p5) than encodeGridFolderPrefix (a0p4) for the same optimization params.
   */
  const resolveGridFolderFromSelection = (sel) => {
    const rows = dataset.filter((r) => {
      if (Number(r.exp_id) !== GRID_MAP_EXP_ID) return false;
      for (const k of gridEncodedParamKeys) {
        if (!valuesMatch(r[k], sel[k])) return false;
      }
      return true;
    });
    const slugs = [...new Set(rows.map((r) => r.scenario_slug).filter(Boolean))];
    if (slugs.length === 1) return slugs[0];
    if (slugs.length > 1) return slugs.sort()[0];
    const prefix = encodeGridFolderPrefix(sel);
    return resolveGridFolderSlug(prefix);
  };

  /** When user selects 0.7, match images with effective_alpha 0.70 or 0.90 (combine 0.7 and 0.9). */
  const effectiveAlphaMatches = (selectedValue, metaValue) => {
    const sel = Number(selectedValue);
    const meta = Number(metaValue);
    if (Number.isNaN(sel) || Number.isNaN(meta)) return valuesMatch(metaValue, selectedValue);
    if (sel === 0.5) return meta === 0.5;
    if (sel === 0.7) return meta === 0.7 || meta === 0.9;
    return valuesMatch(metaValue, selectedValue);
  };

  const paramMatches = (key, metaValue, selectedValue) => {
    if (key === "effective_alpha" && !gridPlotsMode) {
      return effectiveAlphaMatches(selectedValue, metaValue);
    }
    return valuesMatch(metaValue, selectedValue);
  };

  const getFilteredImageMeta = (excludeParam, selection = imageSelection) => {
    return imageMeta.filter((meta) => {
      if (
        !gridPlotsMode &&
        excludeParam !== "suffix" &&
        userSelected.has("suffix")
      ) {
        if (getSuffixKey(meta.suffix) !== selection.suffix) return false;
      }

      return Object.entries(selection).every(([key, value]) => {
        if (key === "suffix" || key === excludeParam) return true;
        if (!userSelected.has(key)) return true;
        if (value === undefined || value === null || value === "") return true;
        if (key === "B_budget" || key === "C_budget" || key === "W_cap") return true;
        return paramMatches(key, meta.params[key], value);
      });
    });
  };

  const getStrictImageMeta = (selectionOverride) => {
    const sel = selectionOverride != null ? selectionOverride : imageSelection;
    const suffixKey = sel.suffix || "none";

    if (gridPlotsMode) {
      const resolvedFolder = resolveGridFolderFromSelection(sel);
      if (!resolvedFolder) return [];
      return imageMeta.filter((meta) => {
        if (meta.folderSlug !== resolvedFolder) return false;
        if (getSuffixKey(meta.suffix) !== suffixKey) return false;
        return Object.entries(sel).every(([key, value]) => {
          if (key === "suffix") return true;
          if (gridEncodedParamKeys.has(key)) return true;
          if (value === undefined || value === null || value === "") return true;
          if (key === "B_budget" || key === "C_budget" || key === "W_cap") return true;
          return paramMatches(key, meta.params[key], value);
        });
      });
    }

    return imageMeta.filter((meta) => {
      if (getSuffixKey(meta.suffix) !== suffixKey) return false;
      return Object.entries(sel).every(([key, value]) => {
        if (key === "suffix") return true;
        if (value === undefined || value === null || value === "") return true;
        if (key === "B_budget" || key === "C_budget" || key === "W_cap") return true;
        return paramMatches(key, meta.params[key], value);
      });
    });
  };

  const getImageValues = (param) => {
    return imageMeta
      .map((meta) => meta.params[param])
      .filter((value) => value !== undefined && value !== "");
  };

  const getImageValuesForSelection = (param, selection, activeKeys) => {
    return getMetaForSelection(selection, param, activeKeys)
      .map((meta) => meta.params[param])
      .filter((value) => value !== undefined && value !== "");
  };

  const getMetaForSelection = (selection, excludeParam, activeKeys = userSelected) => {
    return imageMeta.filter((meta) => {
      if (
        !gridPlotsMode &&
        excludeParam !== "suffix" &&
        selection.suffix &&
        activeKeys?.has("suffix")
      ) {
        if (getSuffixKey(meta.suffix) !== selection.suffix) return false;
      }
      return Object.entries(selection).every(([key, value]) => {
        if (key === "suffix" || key === excludeParam) return true;
        if (activeKeys && !activeKeys.has(key)) return true;
        if (value === undefined || value === null || value === "") return true;
        if (key === "B_budget" || key === "C_budget" || key === "W_cap") return true;
        return paramMatches(key, meta.params[key], value);
      });
    });
  };

  const buildImageControls = () => {
    imageParams.innerHTML = "";
    const previousSelection = { ...imageSelection };
    const workingSelection = { ...previousSelection, suffix: imageSelection.suffix || "" };
    const excludedImageParams = new Set([
      "B_budget",
      "C_budget",
      "W_cap"
    ]);
    if (!gridPlotsMode) {
      excludedImageParams.add("alpha");
      excludedImageParams.add("gamma_i_multiplier");
      excludedImageParams.add("mht_method");
    }
    if (gridPlotsMode) {
      excludedImageParams.add("grouping_method");
      // Grid mode always renders all three methods; no per-method dropdown needed.
      excludedImageParams.add("mht_method");
      // FWER is fixed at 0.4 in all grid experiments — hide the control.
      excludedImageParams.add("alpha");
      imageSelection.alpha = String(GRID_DEFAULT_HYPERPARAMS.alpha);
    }
    const imageParamSet = new Set();
    imageMeta.forEach((meta) => {
      Object.keys(meta.params || {}).forEach((key) => {
        if (!excludedImageParams.has(key)) {
          imageParamSet.add(key);
        }
      });
    });

    const preferredOrder = [
      "alpha",
      "W_cap_multiplier",
      "C_budget_multiplier",
      "B_budget_multiplier",
      "effective_alpha",
      "gamma_i_multiplier",
      "delta",
      "mht_method"
    ];

    const orderedParams = [
      ...preferredOrder.filter((param) => imageParamSet.has(param)),
      ...Array.from(imageParamSet)
        .filter((param) => !preferredOrder.includes(param))
        .sort()
    ];
    const selectControls = [];
    const sliderControls = [];

    const suffixControl = buildSuffixControl(previousSelection);
    if (suffixControl) {
      selectControls.push(suffixControl);
      workingSelection.suffix = imageSelection.suffix;
    }

    applyFixedImageParams();
    if (!gridPlotsMode) {
      Object.entries(fixedImageParams).forEach(([param, value]) => {
        workingSelection[param] = value;
      });
    }

    orderedParams.forEach((param) => {
      const selectionForFilter = { ...workingSelection };
      const wrapper = document.createElement("div");
      wrapper.className = "sfps-field";
      const label = document.createElement("label");
      label.textContent = getLabel(param);

      let values =
        gridPlotsMode && gridEncodedParamKeys.has(param)
          ? getUniqueValues(dataset, param)
          : getImageValuesForSelection(param, selectionForFilter, userSelected);

      if (gridPlotsMode) {
        values = filterGridHiddenSliderValues(param, values);
      }

      if (param === "mht_method" && gridPlotsMode) {
        values = filterGridMhtValues(values);
      }

      if (param === "effective_alpha" && !gridPlotsMode) {
        const canonical = new Set();
        values.forEach((v) => {
          const n = Number(v);
          if (n === 0.5) canonical.add("0.5");
          else if (n === 0.7 || n === 0.9) canonical.add("0.7");
        });
        values = ["0.5", "0.7"].filter((opt) => canonical.has(opt));
      }

      const uniqueValues = Array.from(new Set(values));
      if (!uniqueValues.length) return;

      const numericValues = uniqueValues.filter((val) => !Number.isNaN(Number(val)));
      const allNumeric = numericValues.length === uniqueValues.length;
      const sortedValues = allNumeric
        ? uniqueValues.sort((a, b) => Number(a) - Number(b))
        : uniqueValues.sort();

      let defaultValue = sortedValues[0];
      if (param === "mht_method" && gridPlotsMode && sortedValues.includes("co_optimized")) {
        defaultValue = "co_optimized";
      }
      if (param === "mht_method" && !gridPlotsMode && sortedValues.includes("Random_Bonferroni")) {
        defaultValue = "Random_Bonferroni";
      }
      if (param === "C_budget_multiplier") {
        const half = sortedValues.find((v) => Number(v) === 0.5);
        if (half !== undefined) defaultValue = half;
      }
      if (requiredSliderParams.has(param) || (allNumeric && sortedValues.length > 1)) {
        const preferredValue =
          previousSelection[param] && sortedValues.includes(previousSelection[param])
            ? previousSelection[param]
            : defaultValue;
        const preferredIndex = Math.max(0, sortedValues.indexOf(preferredValue));
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = String(Math.max(sortedValues.length - 1, 0));
        slider.step = "1";
        slider.value = String(preferredIndex);
        slider.dataset.param = param;
        slider.dataset.values = JSON.stringify(sortedValues);
        const updateSliderFill = () => {
          const max = Number(slider.max) || 0;
          const val = Number(slider.value) || 0;
          const percent = max ? (val / max) * 100 : 0;
          slider.style.setProperty("--value", `${percent}%`);
        };
        updateSliderFill();

        const valueDisplay = document.createElement("div");
        valueDisplay.className = "sfps-status sfps-slider-value";
        valueDisplay.textContent = preferredValue;
        valueDisplay.dataset.param = param;

        slider.addEventListener("input", () => {
          const list = JSON.parse(slider.dataset.values || "[]");
          const current = list[Number(slider.value)] ?? "";
          valueDisplay.textContent = current;
          imageSelection[param] = current;
          userSelected.add(param);
          updateSliderFill();
          renderImage();
        });
        slider.addEventListener("change", () => {
          updateSliderFill();
          buildImageControls();
          renderImage();
        });

        wrapper.appendChild(label);
        wrapper.appendChild(slider);
        wrapper.appendChild(valueDisplay);
        sliderControls.push(wrapper);
        imageSelection[param] = preferredValue;
        workingSelection[param] = preferredValue;
      } else {
        const input = document.createElement("select");
        input.id = `image-${param}`;
        input.dataset.param = param;

        sortedValues.forEach((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = getOptionLabel(param, value);
          input.appendChild(option);
        });

        const preferredValue =
          previousSelection[param] && sortedValues.includes(previousSelection[param])
            ? previousSelection[param]
            : defaultValue;
        input.value = preferredValue;
        input.addEventListener("change", () => {
          imageSelection[param] = input.value;
          userSelected.add(param);
          buildImageControls();
          renderImage();
        });
        wrapper.appendChild(label);
        wrapper.appendChild(input);
        selectControls.push(wrapper);
        imageSelection[param] = preferredValue;
        workingSelection[param] = preferredValue;
      }
    });

    selectControls.forEach((node) => imageParams.appendChild(node));
    sliderControls.forEach((node) => imageParams.appendChild(node));
  };

  const buildSuffixControl = (previousSelection) => {
    if (gridPlotsMode) return null;
    const filtered = getFilteredImageMeta("suffix");
    const source = filtered.length ? filtered : imageMeta;
    const options = Array.from(
      new Map(
        source.map((meta) => {
          const key = getSuffixKey(meta.suffix);
          return [key, { key, label: getSuffixLabel(meta.suffix) }];
        })
      ).values()
    );
    const lastKey = "with_hftd_with_inset";
    options.sort((a, b) => {
      if (a.key === lastKey) return 1;
      if (b.key === lastKey) return -1;
      return a.label.localeCompare(b.label);
    });

    if (!options.length) return null;

    const label = document.createElement("label");
    label.setAttribute("for", "image-suffix");
    label.textContent = "Layer option";

    const select = document.createElement("select");
    select.id = "image-suffix";
    options.forEach((suffix) => {
      const option = document.createElement("option");
      option.value = suffix.key;
      option.textContent = suffix.label;
      select.appendChild(option);
    });

    const defaultOption =
      options.find((option) => option.key === "with_hftd_with_inset") || options[0];
    const preferredSuffix =
      previousSelection?.suffix && options.some((option) => option.key === previousSelection.suffix)
        ? previousSelection.suffix
        : defaultOption.key;
    imageSelection.suffix = preferredSuffix;
    select.value = imageSelection.suffix;
    userSelected.add("suffix");
    select.addEventListener("change", () => {
      imageSelection.suffix = select.value;
      userSelected.add("suffix");
      buildImageControls();
      renderImage();
    });

    const wrapper = document.createElement("div");
    wrapper.className = "sfps-field";
    wrapper.appendChild(label);
    wrapper.appendChild(select);
    return wrapper;
  };

  const renderImage = () => {
    if (gridPlotsMode) {
      // ── Grid mode: render three-method comparison ──────────────────
      const folder = resolveGridFolderFromSelection(imageSelection);

      if (!folder) {
        setStatus(
          imageStatus,
          "No plot folder for this combination of FWER, SAIFI, sect. budget, fast-trip budget, effectiveness, γ, and δ.",
          true
        );
        COMPARE_METHODS.forEach((m) => {
          const imgEl = document.getElementById(`decision-image-${m.id}`);
          if (imgEl) imgEl.removeAttribute("src");
          const metricsEl = document.getElementById(`metrics-${m.id}`);
          if (metricsEl) metricsEl.innerHTML = "";
        });
        return;
      }

      setStatus(imageStatus, "", false);

      let pendingLoads = 0;
      let anyImageError = false;
      COMPARE_METHODS.forEach((method) => {
        const imgEl = document.getElementById(`decision-image-${method.id}`);
        const metricsEl = document.getElementById(`metrics-${method.id}`);

        if (imgEl) {
          pendingLoads += 1;
          const imgPath = `grid_plots/${folder}/exp_${GRID_MAP_EXP_ID}_${method.slug}/map.png`;
          imgEl.onload = null;
          imgEl.onerror = null;
          imgEl.onload = () => {
            pendingLoads -= 1;
            if (pendingLoads === 0 && !anyImageError) setStatus(imageStatus, "", false);
          };
          imgEl.onerror = () => {
            anyImageError = true;
            setStatus(imageStatus, `Image failed to load for ${method.name}.`, true);
            pendingLoads -= 1;
          };
          imgEl.src = normalizeImagePath(imgPath);
        }

        if (metricsEl && dataset.length) {
          const row = dataset.find(
            (r) =>
              r.scenario_slug === folder &&
              r.mht_method === method.slug &&
              Number(r.exp_id) === GRID_MAP_EXP_ID
          );
          if (row) {
            metricsEl.innerHTML = COMPARE_METRICS.map((m) => {
              const val = Number(row[m.key]);
              const display = Number.isNaN(val) ? "—" : (m.fmt ? m.fmt(val) : Math.round(val));
              return `<div class="sfps-metric-card">
                <span class="sfps-metric-value">${display}</span>
                <span class="sfps-metric-label">${m.label}</span>
              </div>`;
            }).join("");
          } else {
            metricsEl.innerHTML = "";
          }
        }
      });
      return;
    }

    // ── Legacy single-image mode ────────────────────────────────────
    if (!imageMeta.length) {
      setStatus(imageStatus, "No plot images available.", true);
      return;
    }

    const legacyImg = document.getElementById("decision-image");
    if (!legacyImg) return;

    let matches = getStrictImageMeta();
    let fallbackMessage = "";

    if (!matches.length && imageSelection.effective_alpha === "0.5") {
      matches = getStrictImageMeta({ ...imageSelection, effective_alpha: "0.7" });
      if (matches.length) {
        fallbackMessage = "No image for Effectiveness 0.5 for this combination; showing 0.7.";
      }
    }

    if (!matches.length) {
      setStatus(imageStatus, "Image not found.", true);
      legacyImg.removeAttribute("src");
      return;
    }

    const sortedMatches = matches.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
    const selected = sortedMatches[0];
    if (!selected) {
      setStatus(imageStatus, "", false);
      legacyImg.removeAttribute("src");
      return;
    }

    legacyImg.src = normalizeImagePath(selected.path);
    setStatus(imageStatus, fallbackMessage, !!fallbackMessage);
  };

  const fetchManifest = async () => {
    const cacheBustUrl = `${manifestUrl}?t=${Date.now()}`;
    const response = await fetch(cacheBustUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("No manifest.");
    return await response.json();
  };

  const refreshImageMeta = async () => {
    if (gridPlotsMode) {
      rebuildGridImageMetaFromDataset();
      return;
    }
    const manifest = await fetchManifest();
    const images = manifest.images || manifest.imageFiles || [];
    imageMeta = images.map(parseImageName).filter(Boolean);
  };

  const init = async () => {
    initTabs();
    initHistorical();
    try {
      const manifest = await fetchManifest();
      gridPlotsMode = Boolean(manifest.gridPlots);
      defaultCsvFile = (manifest.csvFiles || [])[0] || "";
      const images = manifest.images || manifest.imageFiles || [];
      imageMeta = gridPlotsMode ? [] : images.map(parseImageName).filter(Boolean);

      applyFixedImageParams();
      await loadCsv();
      if (!usingDefaultCsv) {
        buildImageControls();
        renderImage();
      }
    } catch (error) {
      defaultCsvFile = "";
      gridPlotsMode = false;
      setStatus(
        imageStatus,
        "No plot images available. Serve with python frontend/serve.py so sibling dataset_demo plots are mounted at /dataset_demo/.",
        true
      );
    }
  };

  resetPart2Button.addEventListener("click", async () => {
    imageSelection = { suffix: gridPlotsMode ? "none" : "" };
    userSelected.clear();
    applyFixedImageParams();
    try {
      await refreshImageMeta();
    } catch (error) {
      // ignore refresh failures, keep existing options
    }
    if (gridPlotsMode && dataset.length) syncGridImageDefaultsFromDataset(dataset);
    buildImageControls();
    renderImage();
  });
  if (downloadResultsButton) {
    downloadResultsButton.addEventListener("click", async () => {
      const triggerDownload = (url, filename) => {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };

      // Download the three visible method images directly from their <img> src
      const methodFileNames = {
        ours:    "ours",
        bonf:    "co_optimized",
        maxrank: "planning_only",
      };
      COMPARE_METHODS.forEach((method) => {
        const imgEl = document.getElementById(`decision-image-${method.id}`);
        if (!imgEl || !imgEl.src) return;
        triggerDownload(imgEl.src, `${methodFileNames[method.id]}.png`);
      });

      // Also fetch and download the hidden methods for the current folder
      const EXTRA_METHODS = [
        { slug: "bonferroni", filename: "bonferroni" },
        { slug: "ci",         filename: "ci" },
        { slug: "maxrank",    filename: "maxrank" },
      ];
      const folder = resolveGridFolderFromSelection(imageSelection);
      if (!folder) return;
      for (const method of EXTRA_METHODS) {
        const imgPath = `grid_plots/${folder}/exp_${GRID_MAP_EXP_ID}_${method.slug}/map.png`;
        const url = normalizeImagePath(imgPath);
        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const objUrl = URL.createObjectURL(blob);
          triggerDownload(objUrl, `${method.filename}.png`);
          URL.revokeObjectURL(objUrl);
        } catch (_) {
          // skip if image not available
        }
      }
    });
  }

  if (decisionImage) {
    decisionImage.addEventListener("error", () => {
      setStatus(imageStatus, "Image failed to load. Check the path.", true);
    });
    decisionImage.addEventListener("load", () => {
      setStatus(imageStatus, "", false);
    });
  }

  window.WildfireHistoricalMap = {
    applyAgentView: (view = {}) => {
      const datasets = [];
      const dataset = String(view.dataset || "").trim();
      if (dataset) datasets.push(dataset);
      return setMapParams(
        {
          datasets,
          year: view.year,
          utility: view.utility,
          county: view.county,
          extent: view.extent || "statewide",
          show_territory: Boolean(view.utility),
          show_hftd: dataset === "hftd",
        },
        view.view_scope || null
      );
    },
    setMapParams,
    setStatCards,
    setTimeSeries,
    setComparison,
    setRecordTable,
    setSpatialContext,
    applyCanvasViews,
    notifyAgentViews,
    noteUserMapChrome,
    restoreBrowseMap,
    setAskBusy: (busy) => {
      askInFlight = Boolean(busy);
      if (busy && historicalCanvasStaleEl) {
        historicalCanvasStaleEl.hidden = true;
      } else {
        updateStaleViewChrome();
      }
    },
    invalidateSize: () => relayoutCanvas("invalidateSize"),
    relayoutCanvas,
    setCanvasLayout,
    getCanvasLayout: () =>
      historicalCanvasHost ? historicalCanvasHost.getAttribute("data-layout") : "browse",
    getViewSource: () => viewSource,
    getRelayoutCount: () => canvasRelayoutCount,
    getMapSize: () =>
      historicalCanvasHost ? historicalCanvasHost.dataset.mapSize || "" : "",
    getMapZoom: () => (historicalMapInstance ? historicalMapInstance.getZoom() : null),
    getMapCenter: () => {
      if (!historicalMapInstance) return null;
      const c = historicalMapInstance.getCenter();
      return { lat: c.lat, lng: c.lng };
    },
    getLeafletId: () => (historicalMapEl ? historicalMapEl._leaflet_id : null),
    isAgentSeriesActive: () => agentSeriesActive,
    getYear: () => getCurrentHistoricalYear(),
  };

  init();
})();
