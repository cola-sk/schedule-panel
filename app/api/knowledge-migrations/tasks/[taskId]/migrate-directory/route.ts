import { NextRequest, NextResponse } from "next/server";
import { migrateTaskDirectory } from "@/lib/knowledge-migration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const rootWikiId = typeof body.rootWikiId === "string" ? body.rootWikiId.trim() : "";
    const primaryCategory = typeof body.primaryCategory === "string" ? body.primaryCategory.trim() : "";
    const secondaryCategory = typeof body.secondaryCategory === "string" ? body.secondaryCategory.trim() : undefined;
    const includeRoot = body.includeRoot === true;
    if (!rootWikiId || !primaryCategory) {
      throw new Error("请指定要迁移的源目录和飞书一级目录");
    }

    const result = await migrateTaskDirectory(taskId, {
      rootWikiId,
      primaryCategory,
      secondaryCategory: secondaryCategory || undefined,
      includeRoot,
    });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "目录整体迁移失败" }, { status: 400 });
  }
}
