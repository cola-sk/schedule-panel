import { NextResponse } from "next/server";
import { startScan } from "@/lib/knowledge-migration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const job = await startScan();
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建扫描任务失败" }, { status: 400 });
  }
}
