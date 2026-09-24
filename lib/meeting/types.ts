export type MeetingAnalysisStatus = "analyzing" | "completed" | "failed";
export type MeetingActionStatus = "pending" | "in_progress" | "completed";
export type MeetingScenario = "technical_weekly" | "technical_review";
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
  exportedAt: string;
  recordCount: number;
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
  sourceUrl: string;
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
  sourceUrl: string;
  promptId: string;
  seriesName?: string;
}

export const meetingScenarioMeta: Record<MeetingScenario, { label: string; description: string }> = {
  technical_weekly: {
    label: "前端技术周会",
    description: "提取事项进展、风险/阻塞与后续 TODO",
  },
  technical_review: {
    label: "技术方案评审",
    description: "提取评审结论、待确定细节与后续 TODO",
  },
};
