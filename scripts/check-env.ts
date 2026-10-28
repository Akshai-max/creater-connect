// Production readiness check. Prints variable names and problems, never values.
//   npm run check-env                 checks .env.local
//   npm run check-env -- --file .env.production
import fs from "node:fs"
import { parseArgs } from "node:util"
import { checkEnv } from "../lib/env-check"

const { values } = parseArgs({ options: { file: { type: "string", default: ".env.local" } } })

function load(file: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return env
}

const findings = checkEnv({ ...load(values.file!), NODE_ENV: "production" })
const errors = findings.filter((f) => f.level === "error")
for (const f of findings) console.log(`${f.level === "error" ? "✗" : "!"} ${f.key.padEnd(24)} ${f.message}`)
console.log(`\n${errors.length} blocking, ${findings.length - errors.length} warnings (${values.file})`)
if (errors.length) process.exitCode = 1
