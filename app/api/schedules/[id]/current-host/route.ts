import { NextRequest, NextResponse } from "next/server";
import { setCurrentHost } from "@/lib/core/scheduler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const targetIndex = Number(body.targetIndex);
  if (!Number.isInteger(targetIndex) || targetIndex < 0) {
    return NextResponse.json({ error: "请提供有效的成员索引 (targetIndex)" }, { status: 400 });
  }

  try {
    const updated = await setCurrentHost(id, targetIndex);
    return NextResponse.json({ schedule: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "设置当前值班人员失败" },
      { status: 400 },
    );
  }
}
