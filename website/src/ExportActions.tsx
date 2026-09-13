import { useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePanel } from "./state"
import {
  csvText,
  downloadBlob,
  exportFilename,
  svgPng,
  type ExportRow,
} from "./exports.ts"

export function ExportActions({
  rows,
  svg,
  disabled = false,
}: {
  rows: () => ExportRow[] | Promise<ExportRow[]>
  svg?: () => string
  disabled?: boolean
}) {
  const { actionsHost, title } = usePanel()
  const menu = useRef<HTMLDetailsElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function run(type: "csv" | "png") {
    if (menu.current) {
      menu.current.open = false
      menu.current.querySelector('summary')?.focus({ preventScroll: true })
    }
    setBusy(true)
    setError("")
    try {
      const blob =
        type === "csv"
          ? new Blob([csvText(await rows())], {
              type: "text/csv;charset=utf-8",
            })
          : await svgPng(svg!())
      downloadBlob(blob, exportFilename(title, type))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.")
    } finally {
      setBusy(false)
    }
  }
  if (!actionsHost) return null
  return createPortal(
    <>
      <details
        ref={menu}
        className="export-menu"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            if (menu.current) menu.current.open = false
          }
        }}
      >
        <summary aria-label={`Export ${title}`} title="Export">
          ↓
        </summary>
        <div>
          <button disabled={disabled || busy} onClick={() => run("csv")}>
            Download CSV
          </button>
          {svg && (
            <button disabled={disabled || busy} onClick={() => run("png")}>
              Download PNG
            </button>
          )}
        </div>
      </details>
      {error && (
        <span className="export-error" role="status" title={error}>
          Export failed
        </span>
      )}
    </>,
    actionsHost,
  )
}
