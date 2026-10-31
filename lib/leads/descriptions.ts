// Channel descriptions for the review screen. They're only in the lead file (channel_description,
// written by discovery), which is ~60 MB and takes ~2 s to parse, so they're read once and kept in
// memory until a cycle rewrites the file.
import fs from "node:fs"
import { parse } from "csv-parse"

export const LEADS_FILE = process.env.LEADS_INPUT_FILE || "data/discovered-2026-10-29.csv"

let cache: { mtimeMs: number; byId: Map<string, string> } | null = null

export async function channelDescriptions(file = LEADS_FILE): Promise<Map<string, string>> {
  let mtimeMs: number
  try { mtimeMs = fs.statSync(file).mtimeMs } catch { return new Map() }
  if (cache && cache.mtimeMs === mtimeMs) return cache.byId
  const byId = new Map<string, string>()
  // Streamed, keeping only the two columns needed, so the whole file never sits in memory as rows.
  const parser = fs.createReadStream(file).pipe(parse({ columns: true, skip_empty_lines: true, relax_quotes: true }))
  for await (const r of parser as AsyncIterable<Record<string, string>>) {
    if (r.stable_creator_id && r.channel_description) byId.set(r.stable_creator_id, r.channel_description)
  }
  cache = { mtimeMs, byId }
  return byId
}
