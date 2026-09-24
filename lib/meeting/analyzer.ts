import "server-only";

import OpenAI from "openai";
import { z } from "zod";
import { getAIModelConfig } from "@/lib/ai-config/store";
import { readDocument } from "@/lib/mcp/feishu-doc-engine";
import { buildMeetingAnalysisPrompt, getMeetingAnalysisPrompt } from "./prompts";
import { findPreviousSeriesMeeting, updateMeeting } from "./store";
import type {
  MeetingActionItem,
  MeetingAnalysis,
  MeetingProgressItem,
  MeetingProgressStatus,
  MeetingRisk,
  MeetingRiskLevel,
} from "./types";

const evidenceSchema = z.object({
  quote: z.string().min(1).max(1000),
  context: z.string().min(1).max(2500),
});

const analysisSchema = z.object({
  title: z.string().min(1).max(120),
  meetingDate: z.string().optional().default(""),
  durationMinutes: z.coerce.number().int().positive().max(1440).optional(),
  participants: z.array(z.string().min(1).max(80)).max(100).default([]),
  summary: z.string().min(1).max(1000),
  decisions: z.array(z.object({
    title: z.string().min(1).max(150),
    detail: z.string().min(1).max(800),
  }).merge(evidenceSchema)).max(50).default([]),
  openQuestions: z.array(z.object({
    question: z.string().min(1).max(300),
    stakeholders: z.array(z.string().min(1).max(80)).max(20).default([]),
    nextStep: z.string().min(1).max(500),
  }).merge(evidenceSchema)).max(50).default([]),
  progressItems: z.array(z.object({
    project: z.string().min(1).max(300),
    owner: z.string().min(1).max(80),
    status: z.enum(["not_started", "on_track", "at_risk", "blocked", "completed"]),
    progress: z.string().min(1).max(1000),
    nextStep: z.string().min(1).max(800),
    dueAt: z.string().optional().default(""),
  }).merge(evidenceSchema)).max(100).default([]),
  risks: z.array(z.object({
    title: z.string().min(1).max(300),
    level: z.enum(["low", "medium", "high"]),
    owner: z.string().max(80).optional().default(""),
    impact: z.string().min(1).max(800),
    mitigation: z.string().min(1).max(800),
  }).merge(evidenceSchema)).max(100).default([]),
  actionItems: z.array(z.object({
    who: z.object({
      name: z.string().min(1).max(80),
      email: z.string().max(200).optional().default(""),
    }),
    what: z.string().min(1).max(500),
    dueAt: z.string().optional().default(""),
    deliverable: z.string().min(1).max(500),
  }).merge(evidenceSchema)).max(100).default([]),
});

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueAt(record: UnknownRecord, ...keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  const lowerEntries = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = lowerEntries.get(key.toLowerCase());
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function textValue(value: unknown, maxLength = 2500): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim().slice(0, maxLength);
  }
  if (Array.isArray(value)) {
    return value.map((item) => textValue(item, maxLength)).filter(Boolean).join("、").slice(0, maxLength);
  }
  if (isRecord(value)) {
    const nested = valueAt(
      value,
      "name",
      "displayName",
      "display_name",
      "text",
      "content",
      "value",
      "title",
      "description",
    );
    if (nested !== undefined && nested !== value) return textValue(nested, maxLength);
  }
  return "";
}

function recordList(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function stringList(value: unknown, maxItems = 100): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map((item) => textValue(item, 80)).filter(Boolean).slice(0, maxItems);
}

function normalizeEvidence(record: UnknownRecord) {
  const evidence = valueAt(record, "evidence", "source", "traceability");
  const nested = isRecord(evidence) ? evidence : {};
  const quote = textValue(
    valueAt(record, "quote", "originalQuote", "original_quote", "sourceQuote", "source_quote", "原文") ??
      valueAt(nested, "quote", "text", "original", "原文"),
    1000,
  );
  const context = textValue(
    valueAt(record, "context", "sourceContext", "source_context", "originalContext", "original_context", "上下文") ??
      valueAt(nested, "context", "surroundingText", "surrounding_text", "上下文"),
    2500,
  );
  return { quote: quote || context, context: context || quote };
}

function normalizeProgressStatus(value: unknown): MeetingProgressStatus {
  const status = textValue(value, 80).toLowerCase();
  if (/completed|done|finished|已完成|开发完成|已发布|已上线/.test(status)) return "completed";
  if (/blocked|阻塞|卡住|暂停/.test(status)) return "blocked";
  if (/at.?risk|风险|延期|延误/.test(status)) return "at_risk";
  if (/not.?started|未介入|未开始|待开始|待排期/.test(status)) return "not_started";
  return "on_track";
}

function normalizeRiskLevel(value: unknown): MeetingRiskLevel {
  const level = textValue(value, 40).toLowerCase();
  if (/high|critical|严重|高|p0/.test(level)) return "high";
  if (/low|轻微|低|p2/.test(level)) return "low";
  return "medium";
}

function normalizeModelOutput(value: unknown, fallbackTitle: string) {
  const root = isRecord(value) ? value : {};
  const rawDecisions = valueAt(root, "decisions", "decisionsMade", "decisions_made", "决议项");
  const rawQuestions = valueAt(root, "openQuestions", "open_questions", "blockers", "分歧留存项");
  const rawProgressItems = valueAt(root, "progressItems", "progress_items", "progress", "updates", "进展项");
  const rawRisks = valueAt(root, "risks", "riskItems", "risk_items", "风险项", "阻塞项");
  const rawActions = valueAt(root, "actionItems", "action_items", "todos", "TODOs", "行动项");

  const decisions = recordList(rawDecisions).flatMap((item) => {
    const evidence = normalizeEvidence(item);
    const title = textValue(valueAt(item, "title", "decisionTitle", "decision_title", "topic", "subject", "决议"), 150);
    const detail = textValue(valueAt(item, "detail", "description", "decision", "conclusion", "content", "rationale", "结论"), 800);
    const resolvedTitle = title || detail.slice(0, 80);
    const resolvedDetail = detail || title;
    return resolvedTitle && resolvedDetail && evidence.quote ? [{ title: resolvedTitle, detail: resolvedDetail, ...evidence }] : [];
  });

  const openQuestions = recordList(rawQuestions).flatMap((item) => {
    const evidence = normalizeEvidence(item);
    const question = textValue(valueAt(item, "question", "openQuestion", "open_question", "issue", "blocker", "title", "description", "问题"), 300);
    const stakeholders = stringList(valueAt(item, "stakeholders", "people", "owners", "participants", "needAlignWith", "need_align_with", "需对齐"), 20);
    const nextStep = textValue(valueAt(item, "nextStep", "next_step", "followUp", "follow_up", "action", "resolution", "下一步"), 500);
    return question && evidence.quote ? [{ question, stakeholders, nextStep: nextStep || "待进一步对齐", ...evidence }] : [];
  });

  const progressItems = recordList(rawProgressItems).flatMap((item) => {
    const evidence = normalizeEvidence(item);
    const project = textValue(valueAt(item, "project", "topic", "item", "requirement", "title", "项目", "事项"), 300);
    const owner = textValue(valueAt(item, "owner", "who", "assignee", "followUpBy", "follow_up_by", "跟进人", "负责人"), 80);
    const progress = textValue(valueAt(item, "progress", "update", "currentProgress", "current_progress", "description", "当前进展"), 1000);
    const nextStep = textValue(valueAt(item, "nextStep", "next_step", "nextMilestone", "next_milestone", "plan", "下一步"), 800);
    const dueAt = textValue(valueAt(item, "dueAt", "due_at", "dueDate", "due_date", "deadline", "completionDate", "完成时间"), 100);
    const status = normalizeProgressStatus(valueAt(item, "status", "state", "状态"));
    return project && progress && evidence.quote
      ? [{ project, owner: owner || "未指定", status, progress, nextStep: nextStep || "待明确下一步", dueAt, ...evidence }]
      : [];
  });

  const risks = recordList(rawRisks).flatMap((item) => {
    const evidence = normalizeEvidence(item);
    const title = textValue(valueAt(item, "title", "risk", "issue", "blocker", "description", "风险"), 300);
    const owner = textValue(valueAt(item, "owner", "who", "assignee", "跟进人", "负责人"), 80);
    const impact = textValue(valueAt(item, "impact", "effect", "consequence", "影响"), 800);
    const mitigation = textValue(valueAt(item, "mitigation", "response", "action", "nextStep", "next_step", "应对措施"), 800);
    const level = normalizeRiskLevel(valueAt(item, "level", "severity", "priority", "风险等级"));
    return title && evidence.quote
      ? [{ title, owner, level, impact: impact || "影响待确认", mitigation: mitigation || "待制定应对措施", ...evidence }]
      : [];
  });

  const actionItems = recordList(rawActions).flatMap((item) => {
    const evidence = normalizeEvidence(item);
    const rawWho = valueAt(item, "who", "owner", "assignee", "responsible", "responsiblePerson", "responsible_person", "责任人");
    const whoRecord = isRecord(rawWho) ? rawWho : {};
    const name = textValue(valueAt(whoRecord, "name", "displayName", "display_name", "nickname", "花名") ?? rawWho, 80);
    const email = textValue(valueAt(whoRecord, "email", "mail", "邮箱") ?? valueAt(item, "email", "ownerEmail", "owner_email"), 200);
    const what = textValue(valueAt(item, "what", "task", "action", "todo", "description", "content", "任务"), 500);
    const dueAt = textValue(valueAt(item, "dueAt", "due_at", "dueDate", "due_date", "deadline", "when", "截止时间"), 100);
    const deliverable = textValue(valueAt(item, "deliverable", "output", "artifact", "result", "交付物"), 500);
    return what && evidence.quote
      ? [{ who: { name: name || "未指定", email }, what, dueAt, deliverable: deliverable || "未明确", ...evidence }]
      : [];
  });

  const rawDuration = valueAt(root, "durationMinutes", "duration_minutes", "duration");
  const durationText = textValue(rawDuration, 50);
  const durationMatch = durationText.match(/\d+/)?.[0];

  return {
    title: textValue(valueAt(root, "title", "meetingTitle", "meeting_title", "会议标题"), 120) || fallbackTitle,
    meetingDate: textValue(valueAt(root, "meetingDate", "meeting_date", "date", "会议日期"), 100),
    durationMinutes: durationMatch ? Number(durationMatch) : undefined,
    participants: stringList(valueAt(root, "participants", "attendees", "members", "参会人")),
    summary: textValue(valueAt(root, "summary", "meetingSummary", "meeting_summary", "overview", "摘要"), 1000) || "本次会议已完成结构化分析。",
    decisions,
    openQuestions,
    progressItems,
    risks,
    actionItems,
  };
}

function parseJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || content.match(/\{[\s\S]*\}/)?.[0] || content;
  return JSON.parse(candidate);
}

function excerptMeeting(content: string) {
  const maxLength = 60_000;
  if (content.length <= maxLength) return content;
  return `${content.slice(0, 45_000)}\n\n……（中段已截断）……\n\n${content.slice(-15_000)}`;
}

function normalizeDate(value?: string) {
  if (!value?.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value.trim() : new Date(timestamp).toISOString();
}

export async function analyzeMeeting(meeting: MeetingAnalysis): Promise<MeetingAnalysis> {
  try {
    const scenario = meeting.scenario || "technical_review";
    const config = getAIModelConfig();
    if (!config.llmBaseUrl || !config.llmApiKey || !config.llmModel) {
      throw new Error("尚未配置 AI 模型，请先前往设置完成模型配置");
    }

    const document = await readDocument(meeting.sourceUrl, { format: "text" });
    if (!("content" in document) || !document.content?.trim()) {
      throw new Error("会议文档没有可分析的文本内容");
    }

    const previous = meeting.seriesName
      ? findPreviousSeriesMeeting(meeting.seriesName, meeting.id, scenario)
      : undefined;
    const unfinished = previous?.actionItems.filter((item) => item.status !== "completed") ?? [];
    const previousContext = unfinished.length
      ? `\n\n【同系列上次会议未完成行动项】\n${unfinished
          .map((item) => `- ${item.who.name}：${item.what}；截止：${item.dueAt || "未定"}；交付物：${item.deliverable}`)
          .join("\n")}`
      : "";

    const client = new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl });
    const response = await client.chat.completions.create({
      model: config.llmModel,
      messages: [
        {
          role: "system",
          content: meeting.promptInstructions
            ? buildMeetingAnalysisPrompt(meeting.promptInstructions)
            : getMeetingAnalysisPrompt(scenario),
        },
        {
          role: "user",
          content: `【文档标题】${document.title}\n【会议系列】${meeting.seriesName || "未指定"}${previousContext}\n\n【会议原文】\n${excerptMeeting(document.content)}`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content || "";
    const result = analysisSchema.parse(normalizeModelOutput(parseJson(raw), document.title));
    const actionItems: MeetingActionItem[] = result.actionItems.map((item) => ({
      id: `action_${crypto.randomUUID()}`,
      who: { name: item.who.name, email: item.who.email || undefined },
      what: item.what,
      dueAt: normalizeDate(item.dueAt),
      deliverable: item.deliverable,
      status: "pending",
      quote: item.quote,
      context: item.context,
    }));
    const progressItems: MeetingProgressItem[] = result.progressItems.map((item) => ({
      id: `progress_${crypto.randomUUID()}`,
      project: item.project,
      owner: item.owner,
      status: item.status,
      progress: item.progress,
      nextStep: item.nextStep,
      dueAt: normalizeDate(item.dueAt),
      quote: item.quote,
      context: item.context,
    }));
    const risks: MeetingRisk[] = result.risks.map((item) => ({
      id: `risk_${crypto.randomUUID()}`,
      title: item.title,
      level: item.level,
      owner: item.owner || undefined,
      impact: item.impact,
      mitigation: item.mitigation,
      quote: item.quote,
      context: item.context,
    }));
    const completed = updateMeeting(meeting.id, {
      scenario,
      sourceTitle: document.title,
      title: result.title,
      meetingDate: normalizeDate(result.meetingDate),
      durationMinutes: result.durationMinutes,
      participants: result.participants,
      summary: result.summary,
      status: "completed",
      decisions: result.decisions.map((item) => ({ id: `decision_${crypto.randomUUID()}`, ...item })),
      openQuestions: result.openQuestions.map((item) => ({ id: `question_${crypto.randomUUID()}`, ...item })),
      progressItems,
      risks,
      actionItems,
      previousMeetingId: previous?.id,
      carriedActionItemIds: unfinished.map((item) => item.id),
      analyzedAt: new Date().toISOString(),
      error: undefined,
    });
    if (!completed) throw new Error("会议分析记录不存在");
    return completed;
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "模型返回的会议结构无法识别，请重试或更换模型"
      : error instanceof Error ? error.message : "会议分析失败";
    const failed = updateMeeting(meeting.id, { status: "failed", error: message });
    if (!failed) throw error;
    return failed;
  }
}
