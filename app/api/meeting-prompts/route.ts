import { NextResponse } from "next/server";
import { z } from "zod";
import { createMeetingPrompt, listMeetingPrompts } from "@/lib/meeting/prompt-store";

const promptSchema = z.object({
  name: z.string().trim().min(1, "请输入 Prompt 名称").max(100),
  description: z.string().trim().min(1, "请输入用途说明").max(300),
  scenario: z.enum(["technical_weekly", "technical_review"]),
  instructions: z.string().trim().min(20, "Prompt 内容至少需要 20 个字符").max(30000),
});

export async function GET() {
  return NextResponse.json({ prompts: listMeetingPrompts() });
}

export async function POST(request: Request) {
  try {
    const input = promptSchema.parse(await request.json());
    return NextResponse.json({ prompt: createMeetingPrompt(input) }, { status: 201 });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "创建 Prompt 失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
