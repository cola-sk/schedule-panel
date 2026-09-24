import { NextResponse } from "next/server";
import { analyzeMeeting } from "@/lib/meeting/analyzer";
import { getMeeting, updateMeeting } from "@/lib/meeting/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const meeting = getMeeting(id);
  if (!meeting) return NextResponse.json({ error: "会议记录不存在" }, { status: 404 });
  updateMeeting(id, { status: "analyzing", error: undefined });
  const analyzed = await analyzeMeeting({ ...meeting, status: "analyzing", error: undefined });
  if (analyzed.status === "failed") {
    return NextResponse.json({ meeting: analyzed, error: analyzed.error }, { status: 422 });
  }
  return NextResponse.json({ meeting: analyzed });
}

