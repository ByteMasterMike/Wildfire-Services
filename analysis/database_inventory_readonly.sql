-- Run against the deployed wildfire database to verify the actual catalog.
-- Read-only: no schema, data, model, or configuration changes are made.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';

SELECT current_database() AS database_name, current_timestamp AS inspected_at;

-- Discover non-system relations, including any business schemas beyond wildfire.
SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind AS relation_kind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('information_schema', 'pg_catalog')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY n.nspname, c.relname;

-- Complete deployed business columns, effective types (including geometry),
-- nullability, defaults and comments. API projections cannot replace this query.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       a.attnum AS ordinal_position,
       a.attname AS column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS sql_type,
       NOT a.attnotnull AS nullable,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default,
       pg_catalog.col_description(c.oid, a.attnum) AS column_comment
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'wildfire'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

-- Find cause-related columns without assuming only EPSS has them on this server.
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
  AND lower(column_name) LIKE '%cause%'
ORDER BY table_schema, table_name, ordinal_position;

-- Raw cause values: do not merge abbreviations without a confirmed codebook.
SELECT cause, cause IS NULL AS is_missing, COUNT(*) AS records,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 4) AS percent
FROM wildfire.epss_outages
GROUP BY cause
ORDER BY records DESC, cause NULLS LAST;

SELECT year, cause, COUNT(*) AS records
FROM wildfire.epss_outages
GROUP BY year, cause
ORDER BY year, records DESC, cause NULLS LAST;

SELECT outage_type, COUNT(*) AS records
FROM wildfire.epss_outages
GROUP BY outage_type
ORDER BY records DESC, outage_type NULLS LAST;

COMMIT;
