// Single entry point for the lead engine.
//   npm run engine -- --input data/leads-input.csv
//   npm run engine -- --input data/leads-input.csv --youtube-ids data/channel-ids.txt
//   npm run engine -- --provider candidates
//   npm run engine -- --input tests/fixtures/leads-input.csv --dry-run
//   npm run engine -- --purge-fixtures
// Exit code is non-zero when the run fails, so it can be scheduled safely.
import { parseArgs } from "node:util"
import { runEngine, type EngineOptions } from "../lib/leads/engine"

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    provider: { type: "string", default: "file" },
    "youtube-ids": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    fixture: { type: "boolean", default: false },
    "include-fixtures": { type: "boolean", default: false },
    "include-non-qualified": { type: "boolean", default: false },
    "simulate-failure-after": { type: "string" },
    out: { type: "string" },
    now: { type: "string" },
    "purge-fixtures": { type: "boolean", default: false },
  },
})

async function main() {
  if (values["purge-fixtures"]) {
    const { purgeFixtures } = await import("../lib/leads/repo")
    console.log(`purged ${await purgeFixtures()} fixture leads`)
    return
  }
  const provider = values.provider as EngineOptions["provider"]
  if (provider !== "file" && provider !== "candidates") throw new Error(`unknown --provider ${provider} (file | candidates)`)
  const s = await runEngine({
    provider,
    input: values.input,
    youtubeIdsFile: values["youtube-ids"],
    dryRun: values["dry-run"],
    fixture: values.fixture,
    includeFixtures: values["include-fixtures"],
    includeNonQualified: values["include-non-qualified"],
    simulateFailureAfter: values["simulate-failure-after"] != null ? Number(values["simulate-failure-after"]) : undefined,
    outDir: values.out,
    now: values.now ? new Date(values.now) : undefined,
    log: (m) => console.log(`[engine] ${m}`),
  })
  const { exportReport, errors, ...rest } = s
  console.log(JSON.stringify({ ...rest, export: exportReport && { rows: exportReport.rows, byStatus: exportReport.byStatus, byPriority: exportReport.byPriority, problems: exportReport.problems }, errors: errors.slice(0, 20), moreErrors: Math.max(0, errors.length - 20) }, null, 2))
  if (s.status !== "succeeded") process.exitCode = 1
}

main().catch((e) => {
  console.error(`[engine] fatal: ${(e as Error).message}`)
  process.exitCode = 1
})
