import { aggregateDaily, type Bucket, type Interval } from "./data.ts"

export function annualPosition(date: string, interval: Interval) {
  const month = Number(date.slice(5, 7)) - 1
  if (interval === "monthly") return month
  if (interval === "quarterly") return Math.floor(month / 3)
  if (interval === "weekly")
    return Math.floor(
      (Date.parse(date) - Date.UTC(Number(date.slice(0, 4)), 0, 1)) /
        86400000 /
        7,
    )
  // A leap-year calendar aligns March onward without inventing a Feb 29 zero.
  return (
    (Date.UTC(2000, month, Number(date.slice(8, 10))) - Date.UTC(2000, 0, 1)) /
    86400000
  )
}
export function annualPoints(daily: Bucket[], interval: Interval) {
  return aggregateDaily(daily, interval).map((bucket) => ({
    ...bucket,
    x: annualPosition(bucket.start, interval),
  }))
}
export function annualAxis(interval: Interval) {
  if (interval === "monthly")
    return {
      max: 11,
      ticks: [
        [0, "Jan"],
        [3, "Apr"],
        [6, "Jul"],
        [9, "Oct"],
        [11, "Dec"],
      ] as [number, string][],
    }
  if (interval === "quarterly")
    return {
      max: 3,
      ticks: [
        [0, "Q1"],
        [1, "Q2"],
        [2, "Q3"],
        [3, "Q4"],
      ] as [number, string][],
    }
  if (interval === "weekly")
    return {
      max: 52,
      ticks: [
        [0, "W1"],
        [13, "W14"],
        [26, "W27"],
        [39, "W40"],
        [52, "W53"],
      ] as [number, string][],
    }
  return {
    max: 365,
    ticks: [
      "2000-01-01",
      "2000-04-01",
      "2000-07-01",
      "2000-10-01",
      "2000-12-31",
    ].map(
      (date) =>
        [annualPosition(date, "daily"), date.slice(5)] as [number, string],
    ),
  }
}
export function yearRange(
  year: number,
  coverage: { start: string | null; end: string | null },
) {
  if (!coverage.start || !coverage.end) return null
  const start =
    coverage.start > `${year}-01-01` ? coverage.start : `${year}-01-01`
  const end = coverage.end < `${year}-12-31` ? coverage.end : `${year}-12-31`
  return start <= end
    ? {
        start,
        end,
        partial: start !== `${year}-01-01` || end !== `${year}-12-31`,
      }
    : null
}
