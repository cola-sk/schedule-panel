import { NextResponse } from "next/server";
import { publishItems } from "@/lib/knowledge-migration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((item): item is string => typeof item === "string") : [];
    const result = await publishItems(ids);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "迁移到飞书失败" }, { status: 400 });
  }
}
