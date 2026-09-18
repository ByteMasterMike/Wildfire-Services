import { useEffect, useState } from "react"
import {
  applyTheme,
  persistTheme,
  readStoredTheme,
  type WorkspaceTheme,
} from "./theme.ts"

export function ThemeToggle() {
  const [theme, setTheme] = useState<WorkspaceTheme>(readStoredTheme)
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  const next: WorkspaceTheme = theme === "light" ? "dark" : "light"
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-pressed={theme === "light"}
      aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      onClick={() => {
        setTheme(next)
        persistTheme(next)
      }}
    >
      {theme === "light" ? "Dark" : "Light"}
    </button>
  )
}
