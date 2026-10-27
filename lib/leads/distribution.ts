// Country-distribution rules for the dataset as a whole.
import { RULES } from "./config"
import { APPROVED_COUNTRIES } from "./types"

export type DistributionReport = {
  total: number
  byCountry: Record<string, { count: number; share: number }>
  approvedShare: number
  approvedCountries: number
  maxCountry: string | null
  maxShare: number
  checks: { id: string; pass: boolean; detail: string }[]
  pass: boolean
}

export function countryDistribution(countries: (string | null)[]): DistributionReport {
  const total = countries.length
  const counts = new Map<string, number>()
  for (const c of countries) counts.set(c ?? "??", (counts.get(c ?? "??") ?? 0) + 1)
  const byCountry: DistributionReport["byCountry"] = {}
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    byCountry[k] = { count: n, share: total ? n / total : 0 }
  }
  const approved = [...counts.entries()].filter(([k]) => (APPROVED_COUNTRIES as readonly string[]).includes(k))
  const approvedN = approved.reduce((s, [, n]) => s + n, 0)
  const [maxCountry, maxN] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null, 0]
  const approvedShare = total ? approvedN / total : 0
  const maxShare = total ? maxN / total : 0
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const checks = [
    { id: "non_empty", pass: total > 0, detail: `${total} leads` },
    { id: "approved_share", pass: approvedShare >= RULES.minApprovedShare, detail: `${pct(approvedShare)} from approved countries (need ≥${pct(RULES.minApprovedShare)})` },
    { id: "country_count", pass: approved.length >= RULES.minApprovedCountries, detail: `${approved.length} approved countries (need ≥${RULES.minApprovedCountries})` },
    { id: "max_share", pass: total > 0 && maxShare <= RULES.maxCountryShare, detail: `largest is ${maxCountry ?? "—"} at ${pct(maxShare)} (max ${pct(RULES.maxCountryShare)})` },
  ]
  return { total, byCountry, approvedShare, approvedCountries: approved.length, maxCountry, maxShare, checks, pass: checks.every((c) => c.pass) }
}
