import "server-only";

import fs from "fs";
import path from "path";
import type {
  MeetingActionItem,
  MeetingAnalysis,
  MeetingCreateInput,
  MeetingExportRecord,
} from "./types";
import { getMeetingPrompt } from "./prompt-store";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "meeting-analyses.json");

interface MeetingStore {
  meetings: MeetingAnalysis[];
}

declare global {
  // eslint-disable-next-line no-var
  var __meetingStore__: MeetingStore | undefined;
  // eslint-disable-next-line no-var
  var __meetingStoreMtime__: number | undefined;
}

function now() {
  return new Date().toISOString();
}

function emptyStore(): MeetingStore {
  return { meetings: [] };
}

function loadStore(): MeetingStore {
  try {
    if (!fs.existsSync(STORE_FILE)) return emptyStore();
    const mtime = fs.statSync(STORE_FILE).mtimeMs;
    if (global.__meetingStore__ && global.__meetingStoreMtime__ === mtime) {
      return global.__meetingStore__;
    }
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as MeetingStore;
    const store = Array.isArray(parsed.meetings) ? parsed : emptyStore();
    global.__meetingStore__ = store;
    global.__meetingStoreMtime__ = mtime;
    return store;
  } catch (error) {
    console.error("读取会议分析记录失败:", error);
    return emptyStore();
  }
}

function persist(store: MeetingStore) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(temporary, STORE_FILE);
  global.__meetingStore__ = store;
  global.__meetingStoreMtime__ = fs.statSync(STORE_FILE).mtimeMs;
}

export function listMeetings(): MeetingAnalysis[] {
  return [...loadStore().meetings].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getMeeting(id: string): MeetingAnalysis | undefined {
  return loadStore().meetings.find((meeting) => meeting.id === id);
}

export function createMeeting(input: MeetingCreateInput): MeetingAnalysis {
  const store = loadStore();
  const prompt = getMeetingPrompt(input.promptId);
  if (!prompt) throw new Error("所选 Prompt 不存在或已被删除");
  const timestamp = now();
  const meeting: MeetingAnalysis = {
    id: `meeting_${crypto.randomUUID()}`,
    scenario: prompt.scenario,
    promptId: prompt.id,
    promptName: prompt.name,
    promptInstructions: prompt.instructions,
    sourceUrl: input.sourceUrl.trim(),
    sourceTitle: "正在读取会议记录",
    title: "正在分析会议",
    seriesName: input.seriesName?.trim() || undefined,
    participants: [],
    summary: "",
    status: "analyzing",
    decisions: [],
    openQuestions: [],
    progressItems: [],
    risks: [],
    actionItems: [],
    carriedActionItemIds: [],
    exports: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.meetings.unshift(meeting);
  persist(store);
  return meeting;
}

export function updateMeeting(
  id: string,
  changes: Partial<Omit<MeetingAnalysis, "id" | "createdAt">>,
): MeetingAnalysis | undefined {
  const store = loadStore();
  const meeting = store.meetings.find((item) => item.id === id);
  if (!meeting) return undefined;
  Object.assign(meeting, changes, { updatedAt: now() });
  persist(store);
  return meeting;
}

export function updateMeetingAction(
  meetingId: string,
  actionId: string,
  changes: Partial<Pick<MeetingActionItem, "who" | "what" | "dueAt" | "deliverable" | "status">>,
): MeetingAnalysis | undefined {
  const store = loadStore();
  const meeting = store.meetings.find((item) => item.id === meetingId);
  const action = meeting?.actionItems.find((item) => item.id === actionId);
  if (!meeting || !action) return undefined;
  Object.assign(action, changes);
  meeting.updatedAt = now();
  persist(store);
  return meeting;
}

export function addMeetingExport(meetingId: string, exported: MeetingExportRecord) {
  const store = loadStore();
  const meeting = store.meetings.find((item) => item.id === meetingId);
  if (!meeting) return undefined;
  meeting.exports.unshift(exported);
  meeting.updatedAt = now();
  persist(store);
  return meeting;
}

export function findPreviousSeriesMeeting(seriesName: string, excludeId: string, scenario: MeetingAnalysis["scenario"]) {
  return listMeetings().find(
    (meeting) =>
      meeting.id !== excludeId &&
      meeting.status === "completed" &&
      (meeting.scenario || "technical_review") === scenario &&
      meeting.seriesName?.trim().toLowerCase() === seriesName.trim().toLowerCase(),
  );
}
