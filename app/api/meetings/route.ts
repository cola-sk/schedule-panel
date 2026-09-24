import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeMeeting } from "@/lib/meeting/analyzer";
import { createMeeting, listMeetings } from "@/lib/meeting/store";

const createSchema = z.object({
  sourceUrl: z.string().trim().url().max(2000),
  promptId: z.string().trim().min(1).max(200),
  seriesName: z.string().trim().max(120).optional(),
});

export async function GET() {
  return NextResponse.json({ meetings: listMeetings() });
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    if (!/feishu\.cn\/(docx|docs|wiki)\//i.test(input.sourceUrl)) {
      return NextResponse.json({ error: "目前仅支持飞书文档、妙记整理稿或 Wiki 文档链接" }, { status: 400 });
    }
    const meeting = createMeeting(input);
    const analyzed = await analyzeMeeting(meeting);
    if (analyzed.status === "failed") {
      return NextResponse.json({ meeting: analyzed, error: analyzed.error }, { status: 422 });
    }
    return NextResponse.json({ meeting: analyzed }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建会议分析失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
