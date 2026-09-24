import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteMeetingPrompt, getMeetingPrompt, updateMeetingPrompt } from "@/lib/meeting/prompt-store";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(300),
  scenario: z.enum(["technical_weekly", "technical_review"]),
  instructions: z.string().trim().min(20).max(30000),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = updateSchema.parse(await request.json());
    const prompt = updateMeetingPrompt(id, input);
    if (!prompt) return NextResponse.json({ error: "Prompt 不存在" }, { status: 404 });
    return NextResponse.json({ prompt });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "更新 Prompt 失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const prompt = getMeetingPrompt(id);
  if (!prompt) return NextResponse.json({ error: "Prompt 不存在" }, { status: 404 });
  if (prompt.builtIn) return NextResponse.json({ error: "内置 Prompt 不能删除，可恢复默认内容" }, { status: 400 });
  deleteMeetingPrompt(id);
  return NextResponse.json({ ok: true });
}
