/**
 * Visualization-service client for the Historical Map tab.
 * Depends on window.WILDFIRE_API_BASE / WILDFIRE_CALFIRE_INCIDENT_TYPE from api-config.js.
 */
(() => {
  const MAP_LIMIT = 20000;

  const apiBase = () =>
    String(window.WILDFIRE_API_BASE || "http://127.0.0.1:8002").replace(/\/$/, "");

  const calfireIncidentType = () => {
    const v = window.WILDFIRE_CALFIRE_INCIDENT_TYPE;
    if (v === undefined || v === null) return "all";
    return String(v);
  };

  const qs = (params) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      sp.set(k, String(v));
    });
    const s = sp.toString();
    return s ? `?${s}` : "";
  };

  async function fetchJson(pathWithQuery) {
    const url = `${apiBase()}${pathWithQuery}`;
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${url}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    return response.json();
  }

  async function health() {
    return fetchJson("/health");
  }

  async function mapLayer(dataset, params = {}) {
    const p = { dataset, limit: MAP_LIMIT, offset: 0, ...params };
    if (dataset === "calfire") {
      const t = calfireIncidentType();
      if (t !== "") p.incident_type = t;
    }
    if (dataset === "epss") p.include_outages = true;
    return fetchJson(`/map-layer${qs(p)}`);
  }

  async function timeSeries(dataset, params = {}) {
    const p = { dataset, interval: "weekly", ...params };
    if (dataset === "calfire") {
      const t = calfireIncidentType();
      if (t !== "") p.incident_type = t;
    }
    return fetchJson(`/time-series${qs(p)}`);
  }

  async function utilityTerritory(utility) {
    return fetchJson(`/utility-territory${qs({ utility })}`);
  }

  async function eventDetail(dataset, id, params = {}) {
    return fetchJson(`/event-detail${qs({ dataset, id, ...params })}`);
  }

  /** Convert /map-layer ignitions GeoJSON → website point records. */
  function ignitionsToRecords(payload) {
    const features = payload?.geojson?.features || [];
    return features.map((f) => {
      const p = f.properties || {};
      const coords = f.geometry?.coordinates;
      const lon = Array.isArray(coords) ? Number(coords[0]) : NaN;
      const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
      const utility = String(p.utility || "").trim();
      return {
        id: p.id,
        lat,
        lon,
        year: Number(p.year),
        date: p.event_date,
        utility,
        county: p.county || "",
        source_file: p.source_file,
        name: utility ? `${utility} Ignition` : "CPUC Ignition"
      };
    }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  }

  /** Convert /map-layer us_ignitions GeoJSON → website point records. */
  function usIgnitionsToRecords(payload) {
    const features = payload?.geojson?.features || [];
    return features.map((f) => {
      const p = f.properties || {};
      const coords = f.geometry?.coordinates;
      const lon = Array.isArray(coords) ? Number(coords[0]) : NaN;
      const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
      return {
        id: p.id,
        lat,
        lon,
        year: Number(p.year),
        date: p.event_date,
        name: "US Ignition (all-cause)"
      };
    }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  }

  /** Expand EPSS circuit features (with embedded outages) → outage records + circuit map. */
  function epssPayloadToRecordsAndCircuits(payload) {
    const features = payload?.geojson?.features || [];
    const circuitsById = new Map();
    const records = [];
    let nullGeom = 0;

    features.forEach((feature) => {
      const p = feature.properties || {};
      const circuitId = String(p.circuit_id || "").trim().padStart(9, "0");
      if (!circuitId) return;
      if (!feature.geometry) nullGeom += 1;
      circuitsById.set(circuitId, {
        type: "Feature",
        properties: {
          circuit_id: circuitId,
          circuit_name: p.circuit_name,
          division: p.division,
          substation: p.substation,
          event_count: p.event_count
        },
        geometry: feature.geometry
      });
      const outages = Array.isArray(p.outages) ? p.outages : [];
      if (outages.length) {
        outages.forEach((o) => {
          records.push({
            id: o.id,
            circuit_id: circuitId,
            circuit: o.circuit || p.circuit_name,
            year: Number(o.year),
            date: o.start_date,
            end_date: o.end_date || o.start_date,
            county: o.county,
            cause: o.cause,
            outage_type: o.outage_type,
            division: o.division || p.division,
            customer_minutes: o.customer_minutes,
            restoration_min: o.restoration_min,
            medical_baseline: o.medical_baseline,
            life_support: o.life_support,
            schools: o.schools,
            hospitals: o.hospitals,
            lat: NaN,
            lon: NaN,
            name: o.circuit || p.circuit_name || circuitId
          });
        });
      } else {
        // Fallback aggregate row when include_outages missing
        records.push({
          circuit_id: circuitId,
          circuit: p.circuit_name,
          year: Array.isArray(p.years) && p.years.length ? Number(p.years[0]) : NaN,
          date: p.first_event,
          end_date: p.last_event || p.first_event,
          division: p.division,
          lat: NaN,
          lon: NaN,
          name: p.circuit_name || circuitId,
          _aggregate: true,
          event_count: p.event_count
        });
      }
    });

    return {
      records,
      circuitsById,
      nullGeom,
      truncated: Boolean(payload?.meta?.truncated),
      total: payload?.meta?.total
    };
  }

  function calfireToRecords(payload) {
    const features = payload?.geojson?.features || [];
    return features.map((f) => {
      const p = f.properties || {};
      const coords = f.geometry?.coordinates;
      const lon = Array.isArray(coords) ? Number(coords[0]) : NaN;
      const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
      const date = p.date_only_created || "";
      const yearMatch = String(date).match(/^(\d{4})/);
      return {
        id: p.incident_id,
        lat,
        lon,
        year: yearMatch ? Number(yearMatch[1]) : Number(p.year) || NaN,
        date,
        end_date: p.date_only_extinguished || null,
        name: p.incident_name || "CAL FIRE",
        county: p.county,
        acres: p.acres_burned,
        containment: p.containment,
        incident_type: p.incident_type,
        utility: String(p.utility || "").trim(),
        radius_hint: p.radius_hint
      };
    }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  }

  /** Normalize PSPS API props to website PascalCase used by popup builders. */
  function normalizePspsFeatureCollection(payload) {
    const features = (payload?.geojson?.features || []).map((f) => {
      const p = f.properties || {};
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          EventName: p.event_name ?? p.EventName,
          FirstDateofPOC: p.first_date_of_poc ?? p.FirstDateofPOC,
          IOU: p.utility ?? p.IOU,
          DeEnergizationStartDate:
            p.deenergization_start_date ?? p.DeEnergizationStartDate,
          FullRestorationDate: p.full_restoration_date ?? p.FullRestorationDate,
          CustomerDeEnergized: p.customers_deenergized ?? p.CustomerDeEnergized,
          year: p.year,
          affected_circuits: p.affected_circuits
        }
      };
    });
    return { type: "FeatureCollection", features };
  }

  function normalizeHftdFeatureCollection(payload) {
    const features = (payload?.geojson?.features || []).map((f) => {
      const p = f.properties || {};
      const tier = p.tier || p.HFTD;
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          ...p,
          HFTD: tier,
          tier,
          style: p.style
        }
      };
    });
    return { type: "FeatureCollection", features };
  }

  /** Convert /time-series buckets → weekStarts + counts (API already uses website Jan-1 bins). */
  function bucketsToWeeklySeries(payload) {
    const buckets = payload?.buckets || [];
    return {
      weekStarts: buckets.map((b) => b.start),
      weekLabels: buckets.map((b) => b.label || `${b.start} – ${b.end}`),
      counts: buckets.map((b) => Number(b.count) || 0),
      total_events: payload?.meta?.total_events
    };
  }

  window.WildfireVisApi = {
    apiBase,
    calfireIncidentType,
    health,
    mapLayer,
    timeSeries,
    utilityTerritory,
    eventDetail,
    ignitionsToRecords,
    usIgnitionsToRecords,
    epssPayloadToRecordsAndCircuits,
    calfireToRecords,
    normalizePspsFeatureCollection,
    normalizeHftdFeatureCollection,
    bucketsToWeeklySeries,
    MAP_LIMIT
  };
})();
