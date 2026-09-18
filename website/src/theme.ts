export const THEME_STORAGE_KEY = "wildfire-workspace-theme"
export type WorkspaceTheme = "dark" | "light"

const THEME_COLORS: Record<WorkspaceTheme, string> = {
  dark: "#1a1a1a",
  light: "#f3f1ec",
}

export function parseTheme(value: unknown): WorkspaceTheme {
  return value === "light" ? "light" : "dark"
}

export function readStoredTheme(): WorkspaceTheme {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return "dark"
  }
}

export function applyTheme(
  theme: WorkspaceTheme,
  root: Pick<HTMLElement, "setAttribute" | "removeAttribute"> | null = typeof document === "undefined"
    ? null
    : document.documentElement,
) {
  if (!root) return
  if (theme === "light") root.setAttribute("data-theme", "light")
  else root.removeAttribute("data-theme")
  if (typeof document === "undefined") return
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute("content", THEME_COLORS[theme])
}

export function persistTheme(theme: WorkspaceTheme) {
  applyTheme(theme)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* Browser storage is optional; the in-session theme still applies. */
  }
}
