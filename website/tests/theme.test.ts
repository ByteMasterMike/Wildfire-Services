import test from "node:test"
import assert from "node:assert/strict"
import {
  applyTheme,
  parseTheme,
  persistTheme,
  readStoredTheme,
  THEME_STORAGE_KEY,
} from "../src/theme.ts"
import { barSvg, exportChrome } from "../src/exports.ts"

test("unknown or missing stored values stay on the live dark theme", () => {
  assert.equal(parseTheme(null), "dark")
  assert.equal(parseTheme("dark"), "dark")
  assert.equal(parseTheme("light"), "light")
  assert.equal(parseTheme("system"), "dark")
})

test("applyTheme sets data-theme only for light", () => {
  const attrs: Record<string, string> = {}
  const root = {
    setAttribute(name: string, value: string) {
      attrs[name] = value
    },
    removeAttribute(name: string) {
      delete attrs[name]
    },
  }
  applyTheme("light", root)
  assert.equal(attrs["data-theme"], "light")
  applyTheme("dark", root)
  assert.equal(attrs["data-theme"], undefined)
})

test("persistTheme writes the choice for the next visit", () => {
  const store: Record<string, string> = {}
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key]
    },
    key: () => null,
    get length() {
      return Object.keys(store).length
    },
  }
  try {
    persistTheme("light")
    assert.equal(store[THEME_STORAGE_KEY], "light")
    assert.equal(readStoredTheme(), "light")
    persistTheme("dark")
    assert.equal(store[THEME_STORAGE_KEY], "dark")
    assert.equal(readStoredTheme(), "dark")
  } finally {
    if (previous) globalThis.localStorage = previous
    else delete (globalThis as { localStorage?: Storage }).localStorage
  }
})

test("exported chart chrome follows the active theme while series colors stay as passed", () => {
  const dark = barSvg(
    "Title",
    "Caption",
    [{ key: "A", value: 2 }],
    2,
    "#b7a0f0",
    false,
    exportChrome("dark"),
  )
  const light = barSvg(
    "Title",
    "Caption",
    [{ key: "A", value: 2 }],
    2,
    "#b7a0f0",
    false,
    exportChrome("light"),
  )
  assert.match(dark, /fill="#222"/)
  assert.match(light, /fill="#ffffff"/)
  assert.match(dark, /#b7a0f0/)
  assert.match(light, /#b7a0f0/)
})
