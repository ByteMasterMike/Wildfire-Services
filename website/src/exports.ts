import type { RegionSeries } from './temporal.ts';
import { parseTheme, type WorkspaceTheme } from './theme.ts';

export type ExportRow = Record<string, unknown>
export type ExportChrome = {
  bg: string
  fg: string
  muted: string
  label: string
  value: string
  track: string
  grid: string
  hatchA: string
  hatchB: string
}

const EXPORT_CHROME: Record<WorkspaceTheme, ExportChrome> = {
  dark: {
    bg: "#222",
    fg: "#eee",
    muted: "#aaa",
    label: "#ccc",
    value: "#ddd",
    track: "#ffffff08",
    grid: "#444",
    hatchA: "#333",
    hatchB: "#666",
  },
  light: {
    bg: "#ffffff",
    fg: "#1a1a1a",
    muted: "#5a5a5a",
    label: "#3d3d3d",
    value: "#2a2a2a",
    track: "#1a1a1a12",
    grid: "#c4bfb4",
    hatchA: "#d9d4cb",
    hatchB: "#eceae4",
  },
}

export function exportChrome(theme?: WorkspaceTheme): ExportChrome {
  const current =
    theme ??
    (typeof document === "undefined"
      ? "dark"
      : parseTheme(document.documentElement.getAttribute("data-theme")))
  return EXPORT_CHROME[current]
}
export function csvText(rows: ExportRow[], caveats: readonly string[] = []) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const cell = (value: unknown) => {
    let text =
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value)
    if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text))
      text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return (
    "\uFEFF" +
    [
      ...caveats.map(note => cell(`# Note: ${note}`)),
      columns.map(cell).join(","),
      ...rows.map((row) =>
        columns.map((column) => cell(row[column])).join(","),
      ),
    ].join("\r\n")
  )
}
export const exportFilename = (title: string, extension: string) =>
  `wildfire-${
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .slice(0, 100)
      .trim() || "data"
  }.${extension}`
const escapeXML = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
function wrapped(text: string, length: number) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    if ((line + " " + word).length > length && line) {
      lines.push(line)
      line = ""
    }
    line += (line ? " " : "") + word
  }
  if (line) lines.push(line)
  return lines
}
export function barSvg(
  title: string,
  caption: string,
  rows: { key: string; value: number | null }[],
  total: number,
  color: string,
  share: boolean,
  chrome = exportChrome(),
) {
  const max = Math.max(1, ...rows.map((row) => row.value ?? 0))
  const { bg, fg, muted, label, value, track, hatchA, hatchB } = chrome
  const heading = wrapped(caption, 110)
  let y = 74 + heading.length * 16
  const bars = rows.map((row) => {
    const labels = wrapped(row.key, 28)
    const height = Math.max(36, labels.length * 15 + 8)
    const center = y + height / 2
    const percent = row.value === null ? null : (row.value / total) * 100
    const width =
      row.value === null
        ? 76
        : share
          ? (percent ?? 0) * 5.4
          : (row.value / max) * 540
    const bar = `<g>${labels.map((line, i) => `<text x="24" y="${y + 15 + i * 15}" fill="${label}" font-size="12">${escapeXML(line)}</text>`).join("")}<rect x="240" y="${center - 10}" width="540" height="20" fill="${track}" rx="3"/><rect x="240" y="${center - 10}" width="${width}" height="20" fill="${
      row.value === null ? "url(#missing)" : color
    }" rx="3"/>${
      row.value === null
        ? `<text x="278" y="${center + 4}" text-anchor="middle" font-size="10" fill="${value}">No data</text>`
        : ""
    }<text x="866" y="${center + 4}" text-anchor="end" fill="${value}" font-size="12">${
      row.value === null
        ? "—"
        : share
          ? `${percent!.toFixed(1)}%`
          : row.value.toLocaleString()
    }</text></g>`
    y += height + 6
    return bar
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${y + 28}" viewBox="0 0 900 ${y + 28}" font-family="Arial, sans-serif"><defs><pattern id="missing" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${hatchA}"/><rect width="4" height="8" fill="${hatchB}"/></pattern></defs><rect width="100%" height="100%" fill="${bg}"/><text x="24" y="32" fill="${fg}" font-size="18">${escapeXML(title)}</text>${heading.map((line, i) => `<text x="24" y="${56 + i * 16}" fill="${muted}" font-size="11">${escapeXML(line)}</text>`).join("")}${bars.join("")}</svg>`
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function svgPng(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = image.width * 2
    canvas.height = image.height * 2
    const context = canvas.getContext("2d")
    if (!context)
      throw new Error("Image export is not available in this browser.")
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Image export failed.")),
        "image/png",
      ),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
export function lineSvg(
  element: SVGSVGElement,
  title: string,
  caption: string,
  legend: { label: string; color: string }[],
  chrome = exportChrome(),
) {
  const { bg, fg, muted } = chrome
  const copy = element.cloneNode(true) as SVGSVGElement
  const original = [element, ...element.querySelectorAll("*")]
  const copies = [copy, ...copy.querySelectorAll("*")]
  original.forEach((node, i) => {
    const style = getComputedStyle(node)
    for (const key of [
      "fill",
      "stroke",
      "stroke-width",
      "font-family",
      "font-size",
      "font-weight",
      "opacity",
    ])
      (copies[i] as SVGElement).style.setProperty(
        key,
        style.getPropertyValue(key),
      )
  })
  const width = element.viewBox.baseVal.width,
    height = element.viewBox.baseVal.height
  const lines = wrapped(caption, Math.max(25, Math.floor((width - 32) / 6)))
  const top = 58 + lines.length * 16 + legend.length * 17
  copy.setAttribute("y", String(top))
  copy.setAttribute("width", String(width))
  copy.setAttribute("height", String(height))
  copy.removeAttribute("tabindex")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${top + height + 16}" viewBox="0 0 ${width} ${top + height + 16}" font-family="Arial, sans-serif"><rect width="100%" height="100%" fill="${bg}"/><text x="16" y="28" fill="${fg}" font-size="16">${escapeXML(title)}</text>${lines.map((line, i) => `<text x="16" y="${49 + i * 16}" fill="${muted}" font-size="11">${escapeXML(line)}</text>`).join("")}${legend.map((item, i) => `<text x="16" y="${60 + lines.length * 16 + i * 17}" fill="${escapeXML(item.color)}" font-size="11">${escapeXML(item.label)}</text>`).join("")}${new XMLSerializer().serializeToString(copy)}</svg>`
}

export function regionalSvg(title: string, caption: string, series: RegionSeries[], chrome = exportChrome()): string {
  const { bg, fg, muted, label, value, grid } = chrome;
  const width=1040, tileWidth=490, tileHeight=164;
  const notes=wrapped(caption,145);
  const top=68+notes.length*16;
  const height=top+Math.ceil(series.length/2)*tileHeight+16;
  const ceiling=Math.ceil(Math.max(4,...series.flatMap(region=>region.buckets.map(bucket=>bucket.count)))/4)*4;
  const tiles=series.map((region,index)=>{
    const x=(i:number)=>region.buckets.length<2?tileWidth/2:40+i/(region.buckets.length-1)*(tileWidth-56);
    const y=(value:number)=>124-value/ceiling*76;
    const ticks=[...new Set([0,Math.floor((region.buckets.length-1)/2),region.buckets.length-1])].filter(i=>i>=0);
    return `<g transform="translate(${16+index%2*512},${top+Math.floor(index/2)*tileHeight})"><text x="0" y="17" fill="${value}" font-size="13">${escapeXML(region.name)}</text><text x="${tileWidth}" y="17" fill="${label}" font-size="12" text-anchor="end">${region.total.toLocaleString()} outages</text><text x="40" y="36" fill="${muted}" font-size="10">Outages</text>${[0,ceiling/2,ceiling].map(value=>`<path d="M40 ${y(value)}H${tileWidth-16}" stroke="${grid}"/><text x="33" y="${y(value)+4}" text-anchor="end" fill="${muted}" font-size="10">${value}</text>`).join('')}<polyline fill="none" stroke="#b7a0f0" stroke-width="2" points="${region.buckets.map((bucket,i)=>`${x(i)},${y(bucket.count)}`).join(' ')}"/>${ticks.map(i=>`<text x="${x(i)}" y="144" fill="${muted}" font-size="10" text-anchor="${i===0?'start':i===region.buckets.length-1?'end':'middle'}">${escapeXML(region.buckets[i].start)}</text>`).join('')}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial,sans-serif"><rect width="100%" height="100%" fill="${bg}"/><text x="16" y="28" fill="${fg}" font-size="17">${escapeXML(title)}</text>${notes.map((line,index)=>`<text x="16" y="${50+index*16}" fill="${muted}" font-size="11">${escapeXML(line)}</text>`).join('')}${tiles}</svg>`;
}
