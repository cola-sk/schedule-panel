import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeMeeting } from "@/lib/meeting/analyzer";
import { getMeetingPrompt } from "@/lib/meeting/prompt-store";
import { getMeeting, updateMeeting } from "@/lib/meeting/store";

const retrySchema = z
  .object({
    sourceUrl: z.string().trim().max(2000).optional().or(z.literal("")),
    personalNotes: z.string().trim().max(50000).optional().or(z.literal("")),
    promptId: z.string().trim().max(200).optional(),
    seriesName: z.string().trim().max(120).optional().or(z.literal("")),
  })
  .optional();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const meeting = getMeeting(id);
    if (!meeting) return NextResponse.json({ error: "会议记录不存在" }, { status: 404 });

    let bodyData: z.infer<typeof retrySchema> = undefined;
    try {
      const text = await request.text();
      if (text.trim()) {
        bodyData = retrySchema.parse(JSON.parse(text));
      }
    } catch {
      // 允许无 body 或空 body，直接沿用原有内容重新生成
    }

    const updates: Parameters<typeof updateMeeting>[1] = {
      status: "analyzing",
      error: undefined,
    };

    if (bodyData) {
      if (bodyData.sourceUrl !== undefined) {
        const trimmed = bodyData.sourceUrl.trim();
        if (trimmed && !/feishu\.cn\/(docx|docs|wiki)\//i.test(trimmed)) {
          return NextResponse.json({ error: "目前仅支持飞书文档、妙记整理稿或 Wiki 文档链接" }, { status: 400 });
        }
        updates.sourceUrl = trimmed || undefined;
      }
      if (bodyData.personalNotes !== undefined) {
        updates.personalNotes = bodyData.personalNotes.trim() || undefined;
      }
      if (bodyData.seriesName !== undefined) {
        updates.seriesName = bodyData.seriesName.trim() || undefined;
      }
      if (bodyData.promptId) {
        const prompt = getMeetingPrompt(bodyData.promptId);
        if (!prompt) return NextResponse.json({ error: "所选 Prompt 模板不存在" }, { status: 400 });
        updates.promptId = prompt.id;
        updates.promptName = prompt.name;
        updates.promptInstructions = prompt.instructions;
        updates.scenario = prompt.scenario;
      }
    }

    const effectiveMeeting = updateMeeting(id, updates);
    if (!effectiveMeeting) return NextResponse.json({ error: "会议记录更新失败" }, { status: 500 });

    const hasUrl = Boolean(effectiveMeeting.sourceUrl?.trim());
    const hasNotes = Boolean(effectiveMeeting.personalNotes?.trim());
    if (!hasUrl && !hasNotes) {
      updateMeeting(id, { status: "failed", error: "请至少提供飞书会议文档链接或输入个人记录的文本纪要" });
      return NextResponse.json({ error: "请至少提供飞书会议文档链接或输入个人记录的文本纪要" }, { status: 400 });
    }

    const analyzed = await analyzeMeeting(effectiveMeeting);
    if (analyzed.status === "failed") {
      return NextResponse.json({ meeting: analyzed, error: analyzed.error }, { status: 422 });
    }
    return NextResponse.json({ meeting: analyzed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重新生成失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

