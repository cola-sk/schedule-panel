export type MeetingAnalysisStatus = "analyzing" | "completed" | "failed";
export type MeetingActionStatus = "pending" | "in_progress" | "completed";
export type MeetingScenario = "meeting_action" | "technical_weekly" | "technical_review";
export type MeetingProgressStatus = "not_started" | "on_track" | "at_risk" | "blocked" | "completed";
export type MeetingRiskLevel = "low" | "medium" | "high";

export interface MeetingEvidence {
  quote: string;
  context: string;
}

export interface MeetingDecision extends MeetingEvidence {
  id: string;
  title: string;
  detail: string;
}

export interface MeetingOpenQuestion extends MeetingEvidence {
  id: string;
  question: string;
  stakeholders: string[];
  nextStep: string;
}

export interface MeetingActionItem extends MeetingEvidence {
  id: string;
  who: {
    name: string;
    email?: string;
  };
  what: string;
  dueAt?: string;
  deliverable: string;
  status: MeetingActionStatus;
}

export interface MeetingProgressItem extends MeetingEvidence {
  id: string;
  project: string;
  owner: string;
  status: MeetingProgressStatus;
  progress: string;
  nextStep: string;
  dueAt?: string;
}

export interface MeetingRisk extends MeetingEvidence {
  id: string;
  title: string;
  level: MeetingRiskLevel;
  owner?: string;
  impact: string;
  mitigation: string;
}

export interface MeetingExportRecord {
  id: string;
  targetUrl: string;
  tableId: string;
  tableName?: string;
  exportedAt: string;
  recordCount: number;
  types?: ("conclusion" | "todo" | "risk")[];
}

export interface MeetingExportOptions {
  targetUrl: string;
  includeDecisions?: boolean;
  includeActionItems?: boolean;
  includeRisks?: boolean;
}

export interface MeetingPromptTemplate {
  id: string;
  name: string;
  description: string;
  scenario: MeetingScenario;
  instructions: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingAnalysis {
  id: string;
  scenario: MeetingScenario;
  promptId: string;
  promptName: string;
  promptInstructions: string;
  sourceUrl?: string;
  personalNotes?: string;
  sourceTitle: string;
  title: string;
  seriesName?: string;
  meetingDate?: string;
  durationMinutes?: number;
  participants: string[];
  summary: string;
  status: MeetingAnalysisStatus;
  decisions: MeetingDecision[];
  openQuestions: MeetingOpenQuestion[];
  progressItems: MeetingProgressItem[];
  risks: MeetingRisk[];
  actionItems: MeetingActionItem[];
  previousMeetingId?: string;
  carriedActionItemIds: string[];
  exports: MeetingExportRecord[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  analyzedAt?: string;
}

export interface MeetingCreateInput {
  sourceUrl?: string;
  personalNotes?: string;
  promptId: string;
  seriesName?: string;
}

export interface MultiMeetingRiskAssessment {
  id: string;
  title: string;
  meetingIds: string[];
  meetingCount: number;
  dateRange: { start?: string; end?: string };
  overallRiskLevel: "low" | "medium" | "high";
  summary: string;
  persistentRisks: Array<{
    title: string;
    level: "low" | "medium" | "high";
    occurrences: number;
    impact: string;
    mitigation: string;
  }>;
  emergingRisks: Array<{
    title: string;
    level: "low" | "medium" | "high";
    fromMeetingTitle: string;
    meetingDate?: string;
    impact: string;
  }>;
  recommendations: string[];
  createdAt: string;
}

export const DEFAULT_FEISHU_BITABLE_URL =
  "https://segway-ninebot.feishu.cn/wiki/GkpgwSzwwiMtpckxJIwcKVSZnMh?base_hp_from=larktab&table=tblnWKuYFte8wMP0&view=vewt4Taott";

export const meetingScenarioMeta: Record<MeetingScenario, { label: string; description: string }> = {
  meeting_action: {
    label: "会议行动闭环",
    description: "结构化提取结论、TODO与潜在风险，精准识别开会日期",
  },
  technical_weekly: {
    label: "前端技术周会",
    description: "提取事项进展、风险/阻塞与后续 TODO",
  },
  technical_review: {
    label: "技术方案评审",
    description: "提取评审结论、待确定细节与后续 TODO",
  },
};

