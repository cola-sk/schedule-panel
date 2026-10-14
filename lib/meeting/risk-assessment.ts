import "server-only";

import OpenAI from "openai";
import { getAIModelConfig } from "@/lib/ai-config/store";
import { listMeetings } from "./store";
import type { MeetingAnalysis, MeetingRisk, MultiMeetingRiskAssessment } from "./types";

function parseJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || content.match(/\{[\s\S]*\}/)?.[0] || content;
  return JSON.parse(candidate);
}

export async function assessMultipleMeetingsRisks(options?: {
  meetingIds?: string[];
  seriesName?: string;
  limit?: number;
}): Promise<MultiMeetingRiskAssessment> {
  const allMeetings = listMeetings().filter((m) => m.status === "completed");

  let targetMeetings: MeetingAnalysis[] = [];
  if (options?.meetingIds?.length) {
    targetMeetings = allMeetings.filter((m) => options.meetingIds!.includes(m.id));
  } else if (options?.seriesName) {
    targetMeetings = allMeetings.filter(
      (m) => m.seriesName?.toLowerCase() === options.seriesName!.toLowerCase(),
    );
  } else {
    targetMeetings = allMeetings.slice(0, options?.limit || 5);
  }

  // 按开会日期升序排列（展示风险演进趋势）
  targetMeetings.sort((a, b) => {
    const da = a.meetingDate || a.createdAt;
    const db = b.meetingDate || b.createdAt;
    return new Date(da).getTime() - new Date(db).getTime();
  });

  if (!targetMeetings.length) {
    throw new Error("没有可供评估的已完成会议记录");
  }

  const allRisks: Array<{
    meetingTitle: string;
    meetingDate: string;
    risk: MeetingRisk;
  }> = [];

  for (const m of targetMeetings) {
    const dateStr = m.meetingDate ? m.meetingDate.slice(0, 10) : m.createdAt.slice(0, 10);
    const risks = Array.isArray(m.risks) ? m.risks : [];
    for (const r of risks) {
      allRisks.push({
        meetingTitle: m.title,
        meetingDate: dateStr,
        risk: r,
      });
    }
  }

  const config = getAIModelConfig();
  if (!config.llmBaseUrl || !config.llmApiKey || !config.llmModel) {
    throw new Error("尚未配置 AI 模型，请先前往设置完成模型配置");
  }

  const promptText = `你是一名技术研发总监与风险管理专家。
以下是团队最近 ${targetMeetings.length} 场技术会议中识别出的风险与阻塞记录（已按时间先后排序）。
请基于这些多次会议的实际开会日期与内容，深度分析风险演变趋势、持续遗留问题及跨周期风险点。

会议列表：
${targetMeetings
  .map(
    (m, idx) =>
      `${idx + 1}. [${m.meetingDate ? m.meetingDate.slice(0, 10) : m.createdAt.slice(0, 10)}] ${m.title}（包含 ${m.risks?.length || 0} 项风险）`,
  )
  .join("\n")}

风险明细：
${
  allRisks.length
    ? allRisks
        .map(
          (item, idx) =>
            `${idx + 1}. 【${item.meetingDate} · ${item.meetingTitle}】
- 风险: ${item.risk.title} (等级: ${item.risk.level})
- 负责人: ${item.risk.owner || "未指定"}
- 影响: ${item.risk.impact}
- 缓解应对: ${item.risk.mitigation}
- 证据: ${item.risk.quote}`,
        )
        .join("\n\n")
    : "（暂无具体风险项条目）"
}

请严格按以下 JSON 格式输出分析，不要 Markdown：
{
  "title": "多次会议综合风险评估报告",
  "overallRiskLevel": "low|medium|high",
  "summary": "针对最近多次会议的整体风险态势研判（200-500字）",
  "persistentRisks": [
    {
      "title": "长期反复存在或未闭环的风险描述",
      "level": "low|medium|high",
      "occurrences": 2,
      "impact": "持续未解决带来的深层业务或技术影响",
      "mitigation": "建议采取的根治或兜底方案"
    }
  ],
  "emergingRisks": [
    {
      "title": "近期新增的高风险点",
      "level": "low|medium|high",
      "fromMeetingTitle": "会议标题",
      "meetingDate": "YYYY-MM-DD",
      "impact": "潜在影响"
    }
  ],
  "recommendations": [
    "针对后续技术推进与团队风险预防的具体行动建议1",
    "建议2"
  ]
}`;

  const client = new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl });
  const response = await client.chat.completions.create({
    model: config.llmModel,
    messages: [
      { role: "system", content: "你是专业的前端架构与工程风险管理专家，严格输出合法 JSON。" },
      { role: "user", content: promptText },
    ],
  });

  const raw = response.choices[0]?.message?.content || "";
  const parsed = parseJson(raw);

  const dates = targetMeetings.map((m) => m.meetingDate || m.createdAt);
  const startDate = dates[0] ? dates[0].slice(0, 10) : undefined;
  const endDate = dates[dates.length - 1] ? dates[dates.length - 1].slice(0, 10) : undefined;

  return {
    id: `assessment_${crypto.randomUUID()}`,
    title: parsed.title || "多次会议综合风险评估报告",
    meetingIds: targetMeetings.map((m) => m.id),
    meetingCount: targetMeetings.length,
    dateRange: { start: startDate, end: endDate },
    overallRiskLevel: ["low", "medium", "high"].includes(parsed.overallRiskLevel)
      ? parsed.overallRiskLevel
      : "medium",
    summary: parsed.summary || "已完成多次会议风险评估。",
    persistentRisks: Array.isArray(parsed.persistentRisks) ? parsed.persistentRisks : [],
    emergingRisks: Array.isArray(parsed.emergingRisks) ? parsed.emergingRisks : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    createdAt: new Date().toISOString(),
  };
}
