import { NextResponse } from "next/server";
import { z } from "zod";
import { getMeeting, updateMeetingAction } from "@/lib/meeting/store";

const actionSchema = z.object({
  actionId: z.string().min(1),
  changes: z.object({
    who: z.object({ name: z.string().trim().min(1).max(80), email: z.string().trim().email().optional() }).optional(),
    what: z.string().trim().min(1).max(500).optional(),
    dueAt: z.string().trim().max(100).nullable().optional(),
    deliverable: z.string().trim().min(1).max(500).optional(),
    status: z.enum(["pending", "in_progress", "completed"]).optional(),
  }),
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
    const input = actionSchema.parse(await request.json());
    const meeting = updateMeetingAction(id, input.actionId, {
      ...input.changes,
      dueAt: input.changes.dueAt || undefined,
    });
    if (!meeting) return NextResponse.json({ error: "会议或行动项不存在" }, { status: 404 });
    return NextResponse.json({ meeting });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新行动项失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
