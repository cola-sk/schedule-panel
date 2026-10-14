import { NextResponse } from "next/server";
import { z } from "zod";
import { assessMultipleMeetingsRisks } from "@/lib/meeting/risk-assessment";

const schema = z.object({
  meetingIds: z.array(z.string()).optional(),
  seriesName: z.string().trim().optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const options = schema.parse(body);
    const assessment = await assessMultipleMeetingsRisks(options);
    return NextResponse.json({ assessment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "多次会议风险评估失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
