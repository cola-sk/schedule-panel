import { NextResponse } from "next/server";
import { analyzeOtherDirectory } from "@/lib/knowledge-migration/other-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    return NextResponse.json(await analyzeOtherDirectory(taskId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取“其他”目录失败" },
      { status: 400 },
    );
  }
}
