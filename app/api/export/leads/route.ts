import { NextResponse, type NextRequest } from "next/server"
import { loadAllLeads } from "@/lib/leads/repo"
import { buildExport } from "@/lib/leads/export"

// GET /api/export/leads            → official leads.csv (qualified only)
// GET /api/export/leads?all=1      → every stored lead (audit)
// GET /api/export/leads?report=1   → validation report JSON
// Behind the APP_PASSWORD gate (see proxy.ts).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const leads = await loadAllLeads({ includeFixtures: sp.get("fixtures") === "1" })
  const { csv, report } = buildExport(leads, { includeNonQualified: sp.get("all") === "1", bom: sp.get("bom") === "1" })
  if (sp.get("report") === "1") return NextResponse.json(report)
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${sp.get("all") === "1" ? "leads-all" : "leads"}.csv"`,
    },
  })
}
