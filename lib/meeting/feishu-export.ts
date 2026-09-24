import "server-only";

import { formatLarkError, getFeishuClient, resolveDocumentTarget } from "@/lib/mcp/feishu-doc-engine";
import type { MeetingAnalysis } from "./types";

type LarkResponse<T> = { code?: number; msg?: string; data?: T };
type BitableTable = { table_id?: string; name?: string };
type BitableField = { field_id?: string; field_name?: string; type?: number; is_primary?: boolean };

async function request<T>(options: Parameters<ReturnType<typeof getFeishuClient>["request"]>[0]) {
  let result: LarkResponse<T>;
  try {
    result = await getFeishuClient().request<LarkResponse<T>>(options);
  } catch (error: any) {
    throw new Error(formatLarkError(error, "飞书多维表格请求失败"));
  }
  if (result.code !== 0) {
    throw new Error(formatLarkError(result, "飞书多维表格请求失败"));
  }
  return result.data;
}

async function resolveTable(targetUrl: string) {
  const client = getFeishuClient();
  const resolved = await resolveDocumentTarget(client, targetUrl);

  if (resolved.objType !== "bitable" || !resolved.token) {
    throw new Error(
      "请输入有效的飞书多维表格链接（支持 /base/、/bitable/ 或知识库 Wiki 下的多维表格页面）",
    );
  }

  const appToken = resolved.token;
  const data = await request<{ items?: BitableTable[] }>({
    url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables?page_size=100`,
    method: "GET",
  });
  const tables = data?.items ?? [];
  if (!tables.length) {
    throw new Error("目标多维表格中没有可用的数据表");
  }

  let tableId = resolved.tableId;
  let tableName = resolved.title || "";
  if (tableId) {
    const matched = tables.find((item) => item.table_id === tableId);
    if (matched?.name) {
      tableName = matched.name;
    }
  } else {
    tableId = tables[0].table_id;
    tableName = tables[0].name || tableName;
  }
  if (!tableId) throw new Error("目标多维表格中没有可用的数据表");
  return { appToken, tableId, tableName };
}

async function ensureTextFields(appToken: string, tableId: string) {
  const data = await request<{ items?: BitableField[] }>({
    url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`,
    method: "GET",
  });
  const fields = data?.items ?? [];
  const primary = fields.find((field) => field.is_primary) || fields[0];
  if (!primary?.field_name) throw new Error("目标数据表缺少主字段");

  const expected = ["会议", "责任人", "任务内容", "截止时间", "交付物", "状态", "原文引用", "原文上下文", "来源链接"];
  const names = new Set(fields.map((field) => field.field_name).filter(Boolean));
  for (const fieldName of expected) {
    if (fieldName === primary.field_name || names.has(fieldName)) continue;
    await request({
      url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      method: "POST",
      data: { field_name: fieldName, type: 1 },
    });
    names.add(fieldName);
  }
  return primary.field_name;
}

export async function exportMeetingActions(meeting: MeetingAnalysis, targetUrl: string) {
  if (meeting.status !== "completed") throw new Error("会议尚未分析完成，无法导出");
  if (!meeting.actionItems.length) throw new Error("本次会议没有可导出的行动项");

  const { appToken, tableId, tableName } = await resolveTable(targetUrl);
  const primaryField = await ensureTextFields(appToken, tableId);
  const statusLabels = { pending: "待确认", in_progress: "进行中", completed: "已完成" } as const;
  const records = meeting.actionItems.map((item) => ({
    fields: {
      [primaryField]: item.what,
      会议: meeting.title,
      责任人: item.who.email ? `${item.who.name} <${item.who.email}>` : item.who.name,
      任务内容: item.what,
      截止时间: item.dueAt || "未定",
      交付物: item.deliverable,
      状态: statusLabels[item.status],
      原文引用: item.quote,
      原文上下文: item.context,
      来源链接: meeting.sourceUrl,
    },
  }));

  for (let index = 0; index < records.length; index += 500) {
    await request({
      url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      method: "POST",
      data: { records: records.slice(index, index + 500) },
    });
  }

  return { tableId, tableName, recordCount: records.length };
}
