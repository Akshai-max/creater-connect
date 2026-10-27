// Seed test CLI (owned test accounts only — see README › Test mode).
//   npm run seed-test -- start [--no-send]
//   npm run seed-test -- mark-sent --test <id> --channel linkedin
//   npm run seed-test -- reply --test <id> --channel email
//   npm run seed-test -- report --test <id>
import { parseArgs } from "node:util"
import { logManualEvent, refreshSeedStatus, startSeedTest } from "../lib/leads/seed-repo"

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { test: { type: "string" }, channel: { type: "string" }, note: { type: "string" }, "no-send": { type: "boolean", default: false } },
})

async function main() {
  const cmd = positionals[0]
  if (cmd === "start") {
    const r = await startSeedTest({ send: !values["no-send"] })
    console.log(`seed test ${r.id} started`)
    for (const e of r.entries) {
      console.log(`\n── ${e.channel} → ${e.recipient} (${e.delivered === "resend" ? "sent via Resend" : "MANUAL: send this from your own account, then run mark-sent"})${e.error ? ` [send error: ${e.error}]` : ""}`)
      console.log(e.message)
    }
    return
  }
  if (!values.test) throw new Error("--test <seed test id> is required")
  if (cmd === "mark-sent" || cmd === "reply") {
    if (!values.channel) throw new Error("--channel is required")
    await logManualEvent(values.test, values.channel, cmd === "reply" ? "reply" : "sent", values.note)
  } else if (cmd !== "report") {
    throw new Error("usage: seed-test start | mark-sent | reply | report")
  }
  const report = await refreshSeedStatus(values.test)
  console.log(JSON.stringify(report, null, 2))
  if (cmd === "report" && !report.pass) process.exitCode = 2
}

main().catch((e) => {
  console.error(`[seed-test] ${(e as Error).message}`)
  process.exitCode = 1
})
