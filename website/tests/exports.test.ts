import test from "node:test"
import assert from "node:assert/strict"
import { csvText, barSvg, exportFilename } from "../src/exports.ts"

test("CSV preserves identifiers, missing values, Unicode and quotes, while neutralizing spreadsheet formulas", () => {
  const text = csvText([
    {
      circuit_id: "043371102",
      name: '中文, "line"\nnext',
      count: 0,
      missing: null,
    },
    {
      circuit_id: "001",
      name: '=HYPERLINK("https://example.com")',
      count: 2,
      missing: null,
    },
  ])
  assert.ok(text.startsWith("\uFEFF"))
  assert.ok(text.includes('"043371102"'))
  assert.ok(text.includes('"中文, ""line""\nnext"'))
  assert.ok(text.includes('"0",""'))
  assert.ok(text.includes("\"'=HYPERLINK"))
  assert.equal(exportFilename("A/B: C", "csv"), "wildfire-A_B_ C.csv")
})
test("bar export includes complete data, escapes labels and distinguishes unavailable rows from zero", () => {
  const svg = barSvg(
    "A & B",
    "All selected records",
    [
      { key: "<script>", value: 2 },
      { key: "Zero", value: 0 },
      { key: "Missing", value: null },
    ],
    2,
    "#b7a0f0",
    false,
  )
  assert.ok(svg.includes("A &amp; B"))
  assert.ok(svg.includes("&lt;script&gt;"))
  assert.ok(svg.includes("No data"))
  assert.ok(svg.includes("url(#missing)"))
  assert.ok(svg.includes(">0</text>"))
})
