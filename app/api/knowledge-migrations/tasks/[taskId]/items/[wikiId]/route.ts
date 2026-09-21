import { NextRequest, NextResponse } from "next/server";
import { reviewTaskItem } from "@/lib/knowledge-migration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; wikiId: string }> }
) {
  try {
    const { taskId, wikiId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const item = reviewTaskItem(taskId, {
      wikiId,
      title: typeof body.title === "string" ? body.title : undefined,
      primaryCategory: typeof body.primaryCategory === "string" ? body.primaryCategory : undefined,
      secondaryCategory: typeof body.secondaryCategory === "string" ? body.secondaryCategory : undefined,
      action:
        body.action === "skip" ||
        body.action === "reset"
          ? body.action
          : "save",
      operator: typeof body.operator === "string" ? body.operator : undefined,
    });

    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新迁移文档失败" }, { status: 400 });
  }
}
