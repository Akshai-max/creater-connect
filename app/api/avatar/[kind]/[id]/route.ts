import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { creators, candidates } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

// Proxy Instagram CDN avatar through our origin to bypass browser hotlink restrictions.
// URL format: /api/avatar/creator/CR001  or  /api/avatar/candidate/cand_xyz
//
// Server-side fetch works (returns 200 image/jpeg). Browsers fail because IG sets
// strict CORP/Referer policies. By proxying we serve from our own origin.

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ kind: string; id: string }> }
) {
  const { kind, id } = await ctx.params

  let url: string | null = null
  if (kind === "creator") {
    const r = (await db.select({ u: creators.avatarUrl }).from(creators).where(eq(creators.id, id)))[0]
    url = r?.u ?? null
  } else if (kind === "candidate") {
    const r = (await db.select({ u: candidates.avatarUrl }).from(candidates).where(eq(candidates.id, id)))[0]
    url = r?.u ?? null
  } else {
    return new NextResponse("Bad kind", { status: 400 })
  }

  if (!url) {
    // Tiny transparent gif so Avatar's onError fires and falls back to initials
    return new NextResponse(null, { status: 404 })
  }

  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      // Don't send referer — IG CDN allows server-side requests without it
      signal: AbortSignal.timeout(10000),
    })

    if (!upstream.ok) {
      return new NextResponse(null, { status: upstream.status })
    }

    const buf = await upstream.arrayBuffer()
    const contentType = upstream.headers.get("content-type") ?? "image/jpeg"

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    })
  } catch (e) {
    return new NextResponse(null, { status: 502 })
  }
}
