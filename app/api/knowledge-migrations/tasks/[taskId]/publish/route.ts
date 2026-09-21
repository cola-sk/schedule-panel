import { NextRequest, NextResponse } from "next/server";
import { publishTaskItems } from "@/lib/knowledge-migration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      wikiIds?: unknown;
      ids?: unknown;
    };
    const rawIds = Array.isArray(body.wikiIds) ? body.wikiIds : Array.isArray(body.ids) ? body.ids : [];
    const wikiIds = rawIds.filter((item): item is string => typeof item === "string");

    const result = await publishTaskItems(taskId, wikiIds);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "迁移到飞书失败" }, { status: 400 });
  }
}
