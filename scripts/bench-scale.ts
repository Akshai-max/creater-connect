// Scale benchmark on SYNTHETIC rows (every name says "Fixture", evidence is on
// example.com). Measures runtime of a normal run and a refresh at N rows and
// checks the export stays duplicate-free. Not lead data — never submit it.
//   npm run bench -- [--rows 5000] [--out exports/bench]
// Dry-run mode (no DB writes): measures the qualify → score → channel → draft →
// export pipeline. DB persistence time is reported separately by `npm run engine`.
import fs from "node:fs"
import path from "node:path"
import { runEngine, type EngineSummary } from "../lib/leads/engine"
import { FIXTURE_NOW, FIXTURE_SENDER, base, toCsv } from "../tests/fixtures/rows"

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : dflt
}
const N = Number(arg("--rows", "5000"))
const out = arg("--out", "exports/bench")
const COUNTRIES = ["US", "GB", "CA", "AU", "IE", "NZ", "SG"]
const SEGMENTS = ["video_podcaster", "podcaster", "youtuber", "expert_creator"]

process.env.SENDER_NAME ??= FIXTURE_SENDER.name
process.env.SENDER_ROLE ??= FIXTURE_SENDER.role
process.env.SENDER_COMPANY ??= FIXTURE_SENDER.company
process.env.SENDER_POSTAL_ADDRESS ??= FIXTURE_SENDER.postalAddress

const row = (n: number, over: Record<string, unknown> = {}) =>
  base(n, { country_iso2: COUNTRIES[n % COUNTRIES.length], creator_segment: SEGMENTS[n % SEGMENTS.length], ...over })

async function timed(label: string, rows: Record<string, unknown>[], dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  const input = path.join(dir, "input.csv")
  fs.writeFileSync(input, toCsv(rows))
  const s: EngineSummary = await runEngine({ provider: "file", input, dryRun: true, outDir: path.join(dir, "out"), now: FIXTURE_NOW })
  const r = s.exportReport
  return {
    run: label, inputRows: rows.length, status: s.status, runtimeSec: +(s.durationMs / 1000).toFixed(2),
    qualified: s.qualified, unverified: s.unverified, rejected: s.rejected, duplicatesRemoved: s.duplicates, failed: s.failed,
    exportedRows: r?.rows ?? 0, exportDuplicates: r?.duplicates ?? -1, priorityA: s.priorityA, costUsd: s.costUsd,
  }
}

async function main() {
  const first = Array.from({ length: N }, (_, i) => row(i + 1))
  // 1% in-batch duplicates (same stable id re-listed).
  for (let i = 0; i < Math.floor(N / 100); i++) first.push(row(i + 1, { creator_name: `Fixture Creator ${i + 1} (dupe)` }))
  // Refresh: same creators, 5% edited, 5% new.
  const refresh = [
    ...Array.from({ length: N }, (_, i) => (i % 20 === 0 ? row(i + 1, { followers_or_subscribers: 77000 + i }) : row(i + 1))),
    ...Array.from({ length: Math.floor(N / 20) }, (_, i) => row(N + i + 1)),
  ]
  const results = [await timed("normal", first, path.join(out, "normal")), await timed("refresh", refresh, path.join(out, "refresh"))]
  fs.writeFileSync(path.join(out, "bench-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, rows: N, results }, null, 2))
  console.table(results)
  if (results.some((r) => r.status !== "succeeded" || r.exportDuplicates !== 0)) process.exitCode = 1
}

main()
