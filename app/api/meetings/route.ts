import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeMeeting } from "@/lib/meeting/analyzer";
import { createMeeting, listMeetings } from "@/lib/meeting/store";

const createSchema = z
  .object({
    sourceUrl: z.string().trim().max(2000).optional().or(z.literal("")),
    personalNotes: z.string().trim().max(50000).optional().or(z.literal("")),
    promptId: z.string().trim().min(1).max(200),
    seriesName: z.string().trim().max(120).optional(),
  })
  .refine(
    (data) => Boolean(data.sourceUrl?.trim() || data.personalNotes?.trim()),
    { message: "请提供飞书会议文档链接或输入个人记录的文本纪要" },
  );

export async function GET() {
  return NextResponse.json({ meetings: listMeetings() });
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    if (input.sourceUrl && !/feishu\.cn\/(docx|docs|wiki)\//i.test(input.sourceUrl)) {
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
