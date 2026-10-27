// Regenerates tests/fixtures/leads-input.csv (FICTIONAL rows) for demos:
//   node --import tsx scripts/write-fixture-csv.ts [--shift-days N]
// --shift-days moves every date forward so the fixture stays "recent" later on.
import fs from "node:fs"
import { FIXTURE_ROWS, toCsv } from "../tests/fixtures/rows"

const shiftArg = process.argv.indexOf("--shift-days")
const shift = shiftArg > -1 ? Number(process.argv[shiftArg + 1]) : 0
const shiftDate = (s: string) => new Date(new Date(s).getTime() + shift * 86_400_000).toISOString().slice(0, 10)
const rows = FIXTURE_ROWS.map((r) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && shift ? v.replace(/\d{4}-\d{2}-\d{2}/g, shiftDate) : v])),
)
fs.writeFileSync("tests/fixtures/leads-input.csv", toCsv(rows))
console.log(`wrote ${rows.length} fixture rows${shift ? ` (dates +${shift}d)` : ""}`)
