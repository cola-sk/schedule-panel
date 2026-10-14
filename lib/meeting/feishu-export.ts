import "server-only";

import { formatLarkError, getFeishuClient, resolveDocumentTarget } from "@/lib/mcp/feishu-doc-engine";
import type { MeetingAnalysis, MeetingExportOptions } from "./types";

type LarkResponse<T> = { code?: number; msg?: string; data?: T };
type BitableTable = { table_id?: string; name?: string };
type BitableField = { field_id?: string; field_name?: string; type?: number; is_primary?: boolean };

function formatBitableError(error: unknown, defaultMsg: string): string {
  const err = error as any;
  const status = err?.response?.status;
  const code = err?.response?.data?.code || err?.code;
  if (status === 403 || code === 91403 || code === 1063004) {
    return "飞书多维表格写入权限不足（403）：请在飞书打开目标多维表格页面，在右上角点击「···」或「分享/协同」，添加自建应用「FEB」为协作者并赋予「可编辑」权限。";
  }
  return formatLarkError(error, defaultMsg);
}

async function request<T>(options: Parameters<ReturnType<typeof getFeishuClient>["request"]>[0]) {
  let result: LarkResponse<T>;
  try {
    result = await getFeishuClient().request<LarkResponse<T>>(options);
  } catch (error: any) {
    throw new Error(formatBitableError(error, "飞书多维表格请求失败"));
  }
  if (result.code !== 0) {
    throw new Error(formatBitableError(result, "飞书多维表格请求失败"));
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

async function ensureTableFields(appToken: string, tableId: string) {
  const data = await request<{ items?: BitableField[] }>({
    url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`,
    method: "GET",
  });
  const fields = data?.items ?? [];
  const primary = fields.find((field) => field.is_primary) || fields[0];
  if (!primary?.field_name) throw new Error("目标数据表缺少主字段");

  const expectedFields: Array<{ name: string; type: number }> = [
    { name: "类别", type: 1 },
    { name: "开会日期", type: 1 },
    { name: "会议名称", type: 1 },
    { name: "责任人", type: 1 },
    { name: "风险等级", type: 1 },
    { name: "截止时间", type: 1 },
    { name: "交付物/应对措施", type: 1 },
    { name: "影响范围", type: 1 },
    { name: "状态", type: 1 },
    { name: "原文引用", type: 1 },
    { name: "原文上下文", type: 1 },
    { name: "来源链接", type: 1 },
  ];

  const existingNames = new Set(fields.map((field) => field.field_name).filter(Boolean));

  for (const field of expectedFields) {
    if (field.name === primary.field_name || existingNames.has(field.name)) continue;
    try {
      await request({
        url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
        method: "POST",
        data: { field_name: field.name, type: field.type },
      });
      existingNames.add(field.name);
    } catch {
      // 若无新增字段权限或并发冲突，忽略并尽可能继续
    }
  }

  return { primaryField: primary.field_name, existingFields: existingNames };
}

function formatMeetingDateOnly(dateStr?: string) {
  if (!dateStr?.trim()) return "";
  const match = dateStr.match(/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
  if (match) return match[1].replace(/[/.]/g, "-");
  const d = new Date(dateStr);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return dateStr;
}

export async function exportMeetingActions(
  meeting: MeetingAnalysis,
  optionsOrUrl: string | MeetingExportOptions,
) {
  if (meeting.status !== "completed") throw new Error("会议尚未分析完成，无法导出");

  const options: MeetingExportOptions =
    typeof optionsOrUrl === "string"
      ? { targetUrl: optionsOrUrl, includeDecisions: true, includeActionItems: true, includeRisks: true }
      : {
          includeDecisions: true,
          includeActionItems: true,
          includeRisks: true,
          ...optionsOrUrl,
        };

  const { appToken, tableId, tableName } = await resolveTable(options.targetUrl);
  const { primaryField, existingFields } = await ensureTableFields(appToken, tableId);

  const statusLabels = { pending: "待推进", in_progress: "进行中", completed: "已完成" } as const;
  const riskLevelLabels = { low: "低", medium: "中", high: "高" } as const;
  const meetingDateStr = formatMeetingDateOnly(meeting.meetingDate || meeting.createdAt);
  const sourceLink = meeting.sourceUrl || (meeting.personalNotes ? "个人记录文本纪要" : "无链接");

  const rawRecords: Array<Record<string, unknown>> = [];

  // 1. 结论 (Decisions)
  if (options.includeDecisions !== false && meeting.decisions?.length) {
    for (const item of meeting.decisions) {
      rawRecords.push({
        [primaryField]: item.detail ? `【结论】${item.title}：${item.detail}` : item.title,
        类别: "结论",
        开会日期: meetingDateStr,
        会议名称: meeting.title,
        责任人: "",
        风险等级: "",
        截止时间: "",
        "交付物/应对措施": item.detail,
        影响范围: "",
        状态: "已达成",
        原文引用: item.quote,
        原文上下文: item.context,
        来源链接: sourceLink,
      });
    }
  }

  // 2. TODO / 行动项 (Action Items)
  if (options.includeActionItems !== false && meeting.actionItems?.length) {
    for (const item of meeting.actionItems) {
      const owner = item.who.email ? `${item.who.name} <${item.who.email}>` : item.who.name;
      rawRecords.push({
        [primaryField]: item.what,
        类别: "TODO",
        开会日期: meetingDateStr,
        会议名称: meeting.title,
        责任人: owner,
        风险等级: "",
        截止时间: item.dueAt ? formatMeetingDateOnly(item.dueAt) : "未定",
        "交付物/应对措施": item.deliverable,
        影响范围: "",
        状态: statusLabels[item.status] || "待推进",
        原文引用: item.quote,
        原文上下文: item.context,
        来源链接: sourceLink,
      });
    }
  }

  // 3. 风险 (Risks)
  if (options.includeRisks !== false && meeting.risks?.length) {
    for (const item of meeting.risks) {
      rawRecords.push({
        [primaryField]: item.title,
        类别: "风险",
        开会日期: meetingDateStr,
        会议名称: meeting.title,
        责任人: item.owner || "未指定",
        风险等级: riskLevelLabels[item.level] || item.level,
        截止时间: "",
        "交付物/应对措施": item.mitigation,
        影响范围: item.impact,
        状态: "监控中",
        原文引用: item.quote,
        原文上下文: item.context,
        来源链接: sourceLink,
      });
    }
  }

  if (!rawRecords.length) {
    throw new Error("本次会议在所选范围内没有可导出的项（结论、TODO 或风险）");
  }

  // 过滤仅保留多维表格中实际存在的列（除了主字段保证写入）
  const records = rawRecords.map((item) => {
    const fields: Record<string, unknown> = {
      [primaryField]: item[primaryField],
    };
    for (const [key, value] of Object.entries(item)) {
      if (key !== primaryField && existingFields.has(key) && value !== undefined && value !== null) {
        fields[key] = value;
      }
    }
    return { fields };
  });

  for (let index = 0; index < records.length; index += 500) {
    await request({
      url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      method: "POST",
      data: { records: records.slice(index, index + 500) },
    });
  }

  return {
    tableId,
    tableName,
    recordCount: records.length,
    types: [
      ...(options.includeDecisions && meeting.decisions?.length ? ["conclusion" as const] : []),
      ...(options.includeActionItems && meeting.actionItems?.length ? ["todo" as const] : []),
      ...(options.includeRisks && meeting.risks?.length ? ["risk" as const] : []),
    ],
  };
}
