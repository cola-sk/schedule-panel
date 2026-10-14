import { NextResponse } from "next/server";
import { z } from "zod";
import { getMeetingPrompt } from "@/lib/meeting/prompt-store";
import { getMeeting, updateMeeting, updateMeetingAction } from "@/lib/meeting/store";

const patchSchema = z.object({
  actionId: z.string().optional(),
  changes: z.object({
    who: z.object({ name: z.string().trim().min(1).max(80), email: z.string().trim().email().optional() }).optional(),
    what: z.string().trim().min(1).max(500).optional(),
    dueAt: z.string().trim().max(100).nullable().optional(),
    deliverable: z.string().trim().min(1).max(500).optional(),
    status: z.enum(["pending", "in_progress", "completed"]).optional(),
  }).optional(),
  meetingDate: z.string().trim().max(100).optional(),
  title: z.string().trim().max(200).optional(),
  seriesName: z.string().trim().max(120).optional(),
  sourceUrl: z.string().trim().max(2000).nullable().optional(),
  personalNotes: z.string().trim().max(50000).nullable().optional(),
  promptId: z.string().trim().max(200).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const meeting = getMeeting(id);
  if (!meeting) return NextResponse.json({ error: "会议记录不存在" }, { status: 404 });
  return NextResponse.json({ meeting });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = patchSchema.parse(await request.json());

    if (input.actionId && input.changes) {
      const meeting = updateMeetingAction(id, input.actionId, {
        ...input.changes,
        dueAt: input.changes.dueAt || undefined,
      });
      if (!meeting) return NextResponse.json({ error: "会议或行动项不存在" }, { status: 404 });
      return NextResponse.json({ meeting });
    }

    if (
      input.meetingDate !== undefined ||
      input.title !== undefined ||
      input.seriesName !== undefined ||
      input.sourceUrl !== undefined ||
      input.personalNotes !== undefined ||
      input.promptId !== undefined
    ) {
      let promptUpdates: Record<string, string> = {};
      if (input.promptId) {
        const prompt = getMeetingPrompt(input.promptId);
        if (!prompt) return NextResponse.json({ error: "所选 Prompt 模板不存在" }, { status: 400 });
        promptUpdates = {
          promptId: prompt.id,
          promptName: prompt.name,
          promptInstructions: prompt.instructions,
          scenario: prompt.scenario,
        };
      }

      if (input.sourceUrl && !/feishu\.cn\/(docx|docs|wiki)\//i.test(input.sourceUrl)) {
        return NextResponse.json({ error: "目前仅支持飞书文档、妙记整理稿或 Wiki 文档链接" }, { status: 400 });
      }

      const meeting = updateMeeting(id, {
        ...(input.meetingDate !== undefined ? { meetingDate: input.meetingDate } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.seriesName !== undefined ? { seriesName: input.seriesName || undefined } : {}),
        ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl || undefined } : {}),
        ...(input.personalNotes !== undefined ? { personalNotes: input.personalNotes || undefined } : {}),
        ...promptUpdates,
      });
      if (!meeting) return NextResponse.json({ error: "会议记录不存在" }, { status: 404 });
      return NextResponse.json({ meeting });
    }

    return NextResponse.json({ error: "无效的更新请求" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新会议记录失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
