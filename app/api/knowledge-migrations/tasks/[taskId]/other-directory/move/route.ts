import { NextResponse } from "next/server";
import { migrateOtherDirectoryDocument } from "@/lib/knowledge-migration/other-directory";
import type { OtherDirectoryRecommendation } from "@/lib/knowledge-migration/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      nodeToken?: unknown;
      recommendation?: OtherDirectoryRecommendation;
    };
    if (typeof body.nodeToken !== "string" || !body.nodeToken.trim() || !body.recommendation) {
      throw new Error("请选择一篇具有有效建议的文档");
    }
    return NextResponse.json(await migrateOtherDirectoryDocument(taskId, {
      nodeToken: body.nodeToken.trim(),
      recommendation: body.recommendation,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "迁移飞书知识库文档失败" },
      { status: 400 },
    );
  }
}
