import { cleanupCandidates } from "../app/candidates/cleanup-actions"

async function main() {
  console.log("Running cleanup against production candidates...\n")
  const r = await cleanupCandidates()
  console.log(`═══ Cleanup result ═══`)
  console.log(`Before:      ${r.totalBefore} pending`)
  console.log(`Duplicates:  ${r.duplicates} removed`)
  console.log(`Junk:        ${r.rejected} rejected`)
  console.log(`After:       ${r.remaining} pending\n`)

  if (r.rejectionReasons.length > 0) {
    console.log("Rejection reasons:")
    for (const { reason, count } of r.rejectionReasons) {
      console.log(`  ${String(count).padStart(3)}× ${reason}`)
    }
  }
  if (r.duplicateHandles.length > 0) {
    console.log(`\nDuplicate handles found: ${r.duplicateHandles.slice(0, 10).join(", ")}${r.duplicateHandles.length > 10 ? "..." : ""}`)
  }
}
main()
