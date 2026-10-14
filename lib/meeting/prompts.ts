import type { MeetingScenario } from "./types";

const OUTPUT_SHAPE = `严格输出合法 JSON，不要 Markdown，也不要增加字段。必须遵守以下形状：
{
  "title": "会议标题",
  "meetingDate": "ISO 8601 日期或空字符串",
  "durationMinutes": 60,
  "participants": ["姓名1", "姓名2"],
  "summary": "会议摘要",
  "progressItems": [{"project": "项目或事项", "owner": "负责人", "status": "not_started|on_track|at_risk|blocked|completed", "progress": "当前已完成内容和所处阶段", "nextStep": "下一步及里程碑", "dueAt": "ISO 8601 日期或空字符串", "quote": "原话", "context": "原文上下文"}],
  "risks": [{"title": "风险或阻塞", "level": "low|medium|high", "owner": "跟进人或空字符串", "impact": "不处理的影响", "mitigation": "应对措施或待协调动作", "quote": "原话", "context": "原文上下文"}],
  "decisions": [{"title": "决议标题", "detail": "决议详情", "quote": "原话", "context": "原文上下文"}],
  "openQuestions": [{"question": "待确定细节", "stakeholders": ["姓名或团队"], "nextStep": "下一步", "quote": "原话", "context": "原文上下文"}],
  "actionItems": [{"who": {"name": "姓名", "email": "原文中的邮箱或空字符串"}, "what": "动词+宾语", "dueAt": "ISO 8601 日期或空字符串", "deliverable": "交付物", "quote": "原话", "context": "原文上下文"}]
}`;

const TRACEABILITY_RULES = `所有输出必须仅依据会议原文（包括飞书文档和个人纪要），不得捏造虚假信息。每个进展、风险、决议、待确定项和行动项必须提供 quote（最直接的原话）与 context（说话人、时间戳及前后语境；个人纪要注明[个人记录]）。找不到原文证据的内容不要输出。`;

const MEETING_ACTION_INSTRUCTIONS = `你是团队技术会议行动与执行闭环专家。你的核心目标是从会议记录中提炼出结构清晰、可追踪的【会议纪要】、【TODO/行动项】与【风险】，并精准提取开会日期。

核心分析规则：
1. 开会日期识别（meetingDate）：必须识别会议召开的具体日期。仔细查找文档标题（例如“2026年10月13日”）、正文时间戳（例如“会议时间：2026年10月13日”）、或者个人记录中注明的日期，转换为标准 ISO 8601 日期格式（如“2026-10-13”）。
2. 会议纪要（decisions）：提炼所有经讨论达成一致的方案决策、技术共识、关键纪要、选型拍板和规约。title 是简明纪要主题，detail 是具体内容和边界。
3. 行动项（actionItems / TODO）：落实会后具体执行任务。who 必须具体到负责人姓名；what 必须是明确具体动作；dueAt 填写截止时间；deliverable 是可交付成果。
4. 风险（risks）：全面梳理进度风险、依赖阻塞、质量隐患或资源瓶颈。必须评定风险等级（low/medium/high），明确影响（impact）与应对缓解措施（mitigation），以便后续进行多次会议的综合风险评估。
5. 个人纪要融合：如果提供了【个人记录文本纪要】，请将其与飞书文档交叉验证并补充遗漏的纪要、待办和隐性风险。`;

const TECHNICAL_WEEKLY_INSTRUCTIONS = `你是前端团队技术周会的项目跟进助手。本场会议的目标是对齐技术需求池中各事项的进度、提炼技术与业务纪要、暴露潜在风险并落实可执行 TODO。

分析规则：
1. 开会日期识别（meetingDate）：严格识别周会实际召开日期（如“2026-10-13”）。
2. decisions：提炼周会上敲定的团队规范、工具链演进方案及各模块关键会议纪要。
3. progressItems：以项目/事项为单位合并发言，客观判定 status（not_started/on_track/at_risk/blocked/completed）。
4. risks：记录会影响交付时间、质量、依赖协作的具体风险/阻塞，明确影响与应对措施。
5. actionItems：提取会后明确承诺的行动项，包含 Who、What、When、Deliverable。
6. summary 重点概括整体推进情况、核心纪要、重要风险和本周关键行动。`;

const TECHNICAL_REVIEW_INSTRUCTIONS = `你是前端团队技术方案评审的会议分析助手。本场会议的目标是沉淀已经形成的评审纪要、排查潜在技术风险、明确遗留细节，并落实评审后的 TODO。

分析规则：
1. 开会日期识别（meetingDate）：严格识别评审会召开日期（如“2026-10-13”）。
2. decisions：收录会上明确拍板、后续默认不再反复讨论的技术纪要，title 为主题，detail 详细说明边界。
3. risks：提炼评审过程中专家或团队指出的系统架构、性能、兼容性或交付风险，明确等级与应对措施。
4. openQuestions：收录仍有分歧或依赖外部确认的遗留细节。
5. actionItems：严格采用 5W1H 落实方案修改与跟进待办。
6. summary 概括方案目标、核心纪要和仍需补齐的关键细节。`;

export const DEFAULT_MEETING_PROMPTS: Array<{
  id: string;
  name: string;
  description: string;
  scenario: MeetingScenario;
  instructions: string;
}> = [
  {
    id: "builtin_meeting_action",
    name: "会议行动闭环（会议纪要 / TODO / 风险）",
    description: "全面提取会议纪要、可跟进 TODO 与潜在风险，精准识别开会日期",
    scenario: "meeting_action",
    instructions: MEETING_ACTION_INSTRUCTIONS,
  },
  {
    id: "builtin_technical_weekly",
    name: "前端技术周会",
    description: "按技术需求聚合进展，识别会议纪要、风险阻塞与后续 TODO",
    scenario: "technical_weekly",
    instructions: TECHNICAL_WEEKLY_INSTRUCTIONS,
  },
  {
    id: "builtin_technical_review",
    name: "技术方案评审",
    description: "沉淀明确纪要、潜在风险、待确定细节与评审后 TODO",
    scenario: "technical_review",
    instructions: TECHNICAL_REVIEW_INSTRUCTIONS,
  },
];

export function buildMeetingAnalysisPrompt(instructions: string) {
  return `${instructions.trim()}\n\n${TRACEABILITY_RULES}\n\n${OUTPUT_SHAPE}`;
}

export function getMeetingAnalysisPrompt(scenario: MeetingScenario) {
  const template = DEFAULT_MEETING_PROMPTS.find((item) => item.scenario === scenario) || DEFAULT_MEETING_PROMPTS[0];
  return buildMeetingAnalysisPrompt(template.instructions);
}
