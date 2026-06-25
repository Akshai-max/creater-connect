// Run roster enrichment in batches until done
import { enrichRosterBatch } from "../app/creators/enrich-actions"

async function main() {
  let totalEnriched = 0
  let totalSkipped = 0
  let totalErrors = 0
  let batch = 1
  const startTime = Date.now()

  while (true) {
    console.log(`\n--- Batch ${batch} ---`)
    const r = await enrichRosterBatch(50)
    totalEnriched += r.enriched
    totalSkipped += r.skipped
    totalErrors += r.errors
    console.log(`  ${r.enriched} enriched, ${r.skipped} skipped, ${r.errors} errors. ${r.remaining} remaining.`)
    if (r.enriched === 0 && r.remaining === 0) break
    if (r.enriched === 0 && r.skipped === 0) break // nothing happening, bail
    batch++
    if (batch > 10) { console.log("Hit batch limit (safety)"); break }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n═══ Done in ${elapsed}s ═══`)
  console.log(`Total enriched: ${totalEnriched}`)
  console.log(`Total skipped:  ${totalSkipped}`)
  console.log(`Total errors:   ${totalErrors}`)
}
main()
