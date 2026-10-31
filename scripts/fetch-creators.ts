// CLI script to fetch creators across Instagram, Spotify, and LinkedIn APIs
// and qualify them against the IncuBrix qualification criteria.
//
// Usage:
//   node --env-file-if-exists=.env.local --import tsx scripts/fetch-creators.ts
//   node --env-file-if-exists=.env.local --import tsx scripts/fetch-creators.ts --platforms instagram,spotify,linkedin --query "business coach"
//   node --env-file-if-exists=.env.local --import tsx scripts/fetch-creators.ts --ig-users elena_contentcoach --spotify-shows 4rOoJ6Egrf8K2IrywzwOMk --linkedin-slugs david-vance-growth

import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { fetchAndQualifyCreators } from "../lib/leads/multi-platform"

const { values } = parseArgs({
  options: {
    platforms: { type: "string", default: "instagram,spotify,linkedin" },
    query: { type: "string", default: "business coach" },
    "ig-users": { type: "string" },
    "spotify-shows": { type: "string" },
    "linkedin-slugs": { type: "string" },
    out: { type: "string", default: "data/discovered-multiplatform.csv" },
    limit: { type: "string", default: "10" },
    sample: { type: "boolean", default: true },
    verbose: { type: "boolean", default: false },
  },
})

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const platforms = values.platforms!.split(",").map((p) => p.trim()) as ("instagram" | "spotify" | "linkedin")[]
  const igUsers = values["ig-users"]?.split(",").map((u) => u.trim().replace(/^@/, "")).filter(Boolean)
  const spotifyShows = values["spotify-shows"]?.split(",").map((s) => s.trim()).filter(Boolean)
  const linkedInSlugs = values["linkedin-slugs"]?.split(",").map((s) => s.trim().replace(/^in\//, "").replace(/\/+$/, "")).filter(Boolean)

  console.log(`\n======================================================`)
  console.log(`CREATOR DISCOVERY & QUALIFICATION ENGINE`)
  console.log(`Platforms: ${platforms.join(", ")}`)
  console.log(`Query: "${values.query}"`)
  console.log(`======================================================\n`)

  const result = await fetchAndQualifyCreators({
    platforms,
    query: values.query,
    limit: Number(values.limit),
    instagramUsernames: igUsers,
    spotifyShowIds: spotifyShows,
    linkedInSlugs,
    allowSampleDataOnAuthError: values.sample,
  })

  console.log(`Total Fetched:  ${result.totalFetched}`)
  console.log(`Qualified:      ${result.qualifiedCount} creators (passed all 15 qualification checks)`)
  console.log(`Unverified:     ${result.unverifiedCount} creators (missing evidence / pending human confirmation)`)
  console.log(`Rejected:       ${result.rejectedCount} creators (excluded by qualification rules)`)
  console.log(`\nPlatform Breakdown:`)

  for (const [p, s] of Object.entries(result.platformSummaries)) {
    console.log(`  - ${p.toUpperCase().padEnd(10)}: ${s.fetched} fetched (${s.qualified} qualified, ${s.unverified} unverified, ${s.rejected} rejected)`)
    if (s.errors.length) {
      console.log(`    Errors/Notes: ${s.errors.join("; ")}`)
    }
  }

  // Export to CSV
  if (result.rawRows.length > 0) {
    const cols = Object.keys(result.rawRows[0])
    const csvContent = [
      cols.join(","),
      ...result.rawRows.map((r) => cols.map((c) => esc(r[c])).join(",")),
    ].join("\n") + "\n"

    const outPath = path.resolve(process.cwd(), values.out!)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, csvContent, "utf8")
    console.log(`\nExported ${result.rawRows.length} creator rows to ${outPath}`)
  }

  // Print Qualified Creators
  if (result.qualifiedLeads.length > 0) {
    console.log(`\n------------------------------------------------------`)
    console.log(`QUALIFIED CREATORS:`)
    console.log(`------------------------------------------------------`)
    for (const lead of result.qualifiedLeads) {
      console.log(`\n* ${lead.input.creatorName} [${lead.input.primaryPlatform.toUpperCase()}]`)
      console.log(`  Profile:     ${lead.input.profileUrl}`)
      console.log(`  Segment:     ${lead.input.segment}`)
      console.log(`  Score:       ${lead.score}/100`)
      console.log(`  Best Contact: ${lead.channels.best ? `${lead.channels.best.toUpperCase()} -> ${lead.channels.bestValue}` : "None"}`)
      console.log(`  Need:        ${lead.input.need} ("${lead.input.needSignalText || ""}")`)
      console.log(`  Monetization: ${lead.input.monetizationSignal}`)
      if (lead.firstMessage) {
        console.log(`  Draft Pitch (Initial):\n    ${lead.firstMessage.split("\n")[0]}`)
      }
    }
  }

  // Print Unverified Creators Breakdown
  if (result.unverifiedLeads.length > 0 && values.verbose) {
    console.log(`\n------------------------------------------------------`)
    console.log(`UNVERIFIED CREATORS:`)
    console.log(`------------------------------------------------------`)
    for (const lead of result.unverifiedLeads) {
      console.log(`\n? ${lead.input.creatorName} [${lead.input.primaryPlatform.toUpperCase()}]`)
      console.log(`  Profile: ${lead.input.profileUrl}`)
      const failingChecks = lead.qualification.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.reason}`)
      console.log(`  Missing Evidence: ${failingChecks.join(" | ")}`)
    }
  }

  console.log(`\nDone. You can run the Lead Engine over this output:`)
  console.log(`  npm run engine -- --input ${values.out}\n`)
}

main().catch((e) => {
  console.error("Fatal error:", e)
  process.exit(1)
})
