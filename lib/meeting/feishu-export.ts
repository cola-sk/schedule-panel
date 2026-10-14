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

async function createNewTableTab(appToken: string, tabName: string) {
  const safeName = tabName.replace(/[:\\/?*\[\]]/g, "_").slice(0, 30) || "会议行动记录";
  const createRes = await request<{ table_id?: string }>({
    url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables`,
    method: "POST",
    data: {
      table: {
        name: safeName,
      },
    },
  });
  if (!createRes?.table_id) {
    throw new Error(`在多维表格中创建新 Tab「${safeName}」失败`);
  }
  return { tableId: createRes.table_id, tableName: safeName };
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
      // 忽略字段创建错误（如并发或已有）
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

/**
 * 文本精简辅助函数：去除无意义换行与多余空格，并控制最大长度，使多维表格单元格清爽简要
 */
function conciseText(str?: string, maxLen = 60): string {
  if (!str) return "";
  const cleaned = str.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1)}…`;
}

export async function exportMeetingActions(
  meeting: MeetingAnalysis,
  optionsOrUrl: string | MeetingExportOptions,
) {
  if (meeting.status !== "completed") throw new Error("会议尚未分析完成，无法导出");

  const options: MeetingExportOptions =
    typeof optionsOrUrl === "string"
      ? {
          targetUrl: optionsOrUrl,
          includeDecisions: true,
          includeActionItems: true,
          includeRisks: true,
          createNewTab: false,
        }
      : {
          includeDecisions: true,
          includeActionItems: true,
          includeRisks: true,
          createNewTab: false,
          ...optionsOrUrl,
        };

  const client = getFeishuClient();
  const resolvedTarget = await resolveDocumentTarget(client, options.targetUrl);
  if (resolvedTarget.objType !== "bitable" || !resolvedTarget.token) {
    throw new Error("请输入有效的飞书多维表格链接（支持 /base/、/bitable/ 或知识库 Wiki 下的多维表格页面）");
  }

  const appToken = resolvedTarget.token;
  const meetingDateStr = formatMeetingDateOnly(meeting.meetingDate || meeting.createdAt);

  let tableId: string;
  let tableName: string;

  if (options.createNewTab) {
    const defaultTabName = `${meetingDateStr || "会议"} ${conciseText(meeting.title, 14)}`;
    const tabName = options.tabName?.trim() || defaultTabName;
    const newTab = await createNewTableTab(appToken, tabName);
    tableId = newTab.tableId;
    tableName = newTab.tableName;
  } else {
    const resolved = await resolveTable(options.targetUrl);
    tableId = resolved.tableId;
    tableName = resolved.tableName;
  }

  const { primaryField, existingFields } = await ensureTableFields(appToken, tableId);

  const statusLabels = { pending: "待推进", in_progress: "进行中", completed: "已完成" } as const;
  const riskLevelLabels = { low: "低", medium: "中", high: "高" } as const;
  const sourceLink = meeting.sourceUrl || (meeting.personalNotes ? "个人记录文本纪要" : "无链接");

  const rawRecords: Array<Record<string, unknown>> = [];

  // 1. 结论 (Decisions) - 文字精简
  if (options.includeDecisions !== false && meeting.decisions?.length) {
    for (const item of meeting.decisions) {
      rawRecords.push({
        [primaryField]: conciseText(item.title, 50),
        类别: "结论",
        开会日期: meetingDateStr,
        会议名称: conciseText(meeting.title, 40),
        责任人: "",
        风险等级: "",
        截止时间: "",
        "交付物/应对措施": conciseText(item.detail, 80),
        影响范围: "",
        状态: "已达成",
        原文引用: item.quote,
        原文上下文: item.context,
        来源链接: sourceLink,
      });
    }
  }

  // 2. TODO / 行动项 (Action Items) - 文字精简
  if (options.includeActionItems !== false && meeting.actionItems?.length) {
    for (const item of meeting.actionItems) {
      const owner = item.who.name || "未指定";
      rawRecords.push({
        [primaryField]: conciseText(item.what, 60),
        类别: "TODO",
        开会日期: meetingDateStr,
        会议名称: conciseText(meeting.title, 40),
        责任人: owner,
        风险等级: "",
        截止时间: item.dueAt ? formatMeetingDateOnly(item.dueAt) : "未定",
        "交付物/应对措施": conciseText(item.deliverable, 60),
        影响范围: "",
        状态: statusLabels[item.status] || "待推进",
        原文引用: item.quote,
        原文上下文: item.context,
        来源链接: sourceLink,
      });
    }
  }

  // 3. 风险 (Risks) - 文字精简
  if (options.includeRisks !== false && meeting.risks?.length) {
    for (const item of meeting.risks) {
      rawRecords.push({
        [primaryField]: conciseText(item.title, 50),
        类别: "风险",
        开会日期: meetingDateStr,
        会议名称: conciseText(meeting.title, 40),
        责任人: item.owner || "未指定",
        风险等级: riskLevelLabels[item.level] || item.level,
        截止时间: "",
        "交付物/应对措施": conciseText(item.mitigation, 80),
        影响范围: conciseText(item.impact, 80),
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

  // 仅写入目标表实际存在的列
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
