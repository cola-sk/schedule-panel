import { NextResponse } from "next/server";
import { z } from "zod";
import { exportMeetingActions } from "@/lib/meeting/feishu-export";
import { addMeetingExport, getMeeting } from "@/lib/meeting/store";

const exportSchema = z.object({
  targetUrl: z
    .string()
    .trim()
    .min(1, "请输入飞书多维表格链接")
    .max(2000)
    .transform((val) => (/^https?:\/\//i.test(val) ? val : `https://${val}`))
    .pipe(z.string().url("链接格式不正确，请输入有效的飞书 URL")),
  includeDecisions: z.boolean().optional().default(true),
  includeActionItems: z.boolean().optional().default(true),
  includeRisks: z.boolean().optional().default(true),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const meeting = getMeeting(id);
    if (!meeting) return NextResponse.json({ error: "会议记录不存在" }, { status: 404 });
    const options = exportSchema.parse(await request.json());
    const result = await exportMeetingActions(meeting, options);
    const exported = {
      id: `export_${crypto.randomUUID()}`,
      targetUrl: options.targetUrl,
      tableId: result.tableId,
      tableName: result.tableName,
      exportedAt: new Date().toISOString(),
      recordCount: result.recordCount,
      types: result.types,
    };
    addMeetingExport(id, exported);
    return NextResponse.json({ exported, tableName: result.tableName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出到多维表格失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
