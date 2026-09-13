import { configFor, type DatasetId } from "./data.ts"
import { HDW_GRID } from "./HdwPlayer"

export const acresRadius = (acres: number | null) =>
  Math.min(20, 4 + Math.sqrt(Math.max(0, acres ?? 0)) * 0.03)
export function MapLegend({
  dataset,
  hftd,
  territories,
  weather,
}: {
  dataset: DatasetId
  hftd: boolean
  territories: boolean
  weather: boolean
}) {
  const config = configFor(dataset)
  const color = dataset === "calfire" ? "#b91c1c" : config.color
  return (
    <div className="map-legend" aria-label="Map legend">
      <div className="legend-keys">
        <span className="legend-key">
          <i
            className={`legend-symbol ${
              dataset === "epss"
                ? "is-line"
                : dataset === "psps"
                  ? "is-area"
                  : "is-point"
            }`}
            style={{
              color,
              backgroundColor: dataset === "epss" ? "transparent" : color,
            }}
          />
          {dataset === "epss"
            ? "EPSS circuits"
            : dataset === "psps"
              ? "PSPS areas"
              : dataset === "us_ignitions"
                ? "US sample"
                : config.name}
        </span>
        {["cpuc", "us_ignitions"].includes(dataset) && (
          <span className="legend-key">
            <i className="legend-cluster" style={{ borderColor: color }}>
              n
            </i>
            Events in cluster
          </span>
        )}
        {dataset === "calfire" && (
          <span className="legend-acres">
            {[100, 10000, 100000].map((value) => (
              <span key={value}>
                <svg
                  width="30"
                  height="30"
                  viewBox="0 0 30 30"
                  aria-hidden="true"
                >
                  <circle
                    cx="15"
                    cy="15"
                    r={acresRadius(value)}
                    fill={color}
                    fillOpacity=".35"
                    stroke={color}
                  />
                </svg>
                {value === 100 ? "100" : value === 10000 ? "10k" : "100k"}
              </span>
            ))}
            <span>reported acres</span>
          </span>
        )}
        {hftd && (
          <>
            <span className="legend-key">
              <i className="legend-tier tier-2" />
              Tier 2
            </span>
            <span className="legend-key">
              <i className="legend-tier tier-3" />
              Tier 3
            </span>
          </>
        )}
        {territories && (
          <span className="legend-key">
            <i className="legend-symbol is-line" style={{ color: "#9ba9bb" }} />
            IOU boundaries
          </span>
        )}
      </div>
      {weather && (
        <div className="weather-legend">
          <span>HDW · hPa·m/s</span>
          {HDW_GRID.meta.bands.map((b) => (
            <span key={b.name} title={b.name}>
              <i style={{ background: b.color }} />
              {b.min_hdw}
              {b.max_hdw === null ? "+" : `–${b.max_hdw}`}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
