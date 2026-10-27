import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { leads, outreachMessages } from "@/lib/db/schema"
import { asc, eq } from "drizzle-orm"

// GET /api/export/messages?lead=L-XXXX → that lead's sequences as Markdown.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("lead")
  if (!id) return NextResponse.json({ error: "lead is required" }, { status: 400 })
  const l = (await db.select().from(leads).where(eq(leads.id, id)))[0]
  if (!l) return NextResponse.json({ error: "not found" }, { status: 404 })
  const ms = await db.select().from(outreachMessages).where(eq(outreachMessages.leadId, id)).orderBy(asc(outreachMessages.channel), asc(outreachMessages.sequence))
  const parts = [`# ${l.creatorName} (${l.id})`, `Hook: ${l.personalizationHook ?? "—"}`, ""]
  for (const m of ms) {
    parts.push(`## ${m.channel} — ${m.sequence === 1 ? "Initial" : `Follow-up ${m.sequence - 1}`} [${m.status}]`)
    parts.push(m.status === "unavailable" ? `_Unavailable: ${m.unavailableReason}_` : `${m.subject ? `**Subject:** ${m.subject}\n\n` : ""}${m.body}`)
    parts.push("")
  }
  return new NextResponse(parts.join("\n"), { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${l.id}-sequences.md"` } })
}
