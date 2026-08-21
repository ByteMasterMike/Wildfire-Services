-- US / CONUS ignitions from FireCastRL Kaggle dataset (IRWIN-derived sample).
-- Applied by load_us_ignitions.ensure_table and included from schema.sql.

CREATE TABLE IF NOT EXISTS wildfire.us_ignitions (
  id          BIGSERIAL PRIMARY KEY,
  event_date  DATE NOT NULL,
  year        SMALLINT NOT NULL,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  pr          DOUBLE PRECISION,
  rmax        DOUBLE PRECISION,
  rmin        DOUBLE PRECISION,
  sph         DOUBLE PRECISION,
  srad        DOUBLE PRECISION,
  tmmn        DOUBLE PRECISION,
  tmmx        DOUBLE PRECISION,
  vs          DOUBLE PRECISION,
  bi          DOUBLE PRECISION,
  fm100       DOUBLE PRECISION,
  fm1000      DOUBLE PRECISION,
  erc         DOUBLE PRECISION,
  etr         DOUBLE PRECISION,
  pet         DOUBLE PRECISION,
  vpd         DOUBLE PRECISION,
  geom        geometry(Point, 4326) NOT NULL,
  UNIQUE (latitude, longitude, event_date)
);

CREATE INDEX IF NOT EXISTS us_ignitions_year_idx ON wildfire.us_ignitions (year);
CREATE INDEX IF NOT EXISTS us_ignitions_event_date_idx ON wildfire.us_ignitions (event_date);
CREATE INDEX IF NOT EXISTS us_ignitions_geom_gix ON wildfire.us_ignitions USING GIST (geom);

COMMENT ON TABLE wildfire.us_ignitions IS
  'IRWIN-derived ignition points from the FireCastRL / Kaggle US Wildfire Dataset (2014–2025). '
  'One row per positive 75-day sequence; ignition date is the first Yes day. '
  'CONUS classification sample — not a complete census of US ignitions. '
  'Not utility-attributed; NOT comparable to wildfire.cpuc_ignitions (utility-caused only). '
  'Synthesized negatives and Int16-sentinel (32767) sequences excluded at extract. '
  'Temperatures tmmn/tmmx are Kelvin (GRIDMET).';
