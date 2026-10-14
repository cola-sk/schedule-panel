import "server-only";

import fs from "fs";
import path from "path";
import { getRosterMembers, getAtTagByName } from "@/lib/roster";
import { getTask } from "./store";
import type {
  MemberContributionMigrationItem,
  MemberPersonalMigrationRecord,
  MigrationPersonStat,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STATUS_FILE = path.join(DATA_DIR, "knowledge-personal-migration-status.json");

type TaskMigrationStatusMap = Record<string, Record<string, MemberPersonalMigrationRecord>>;

declare global {
  // eslint-disable-next-line no-var
  var __kmPersonalMigrationStatus__: TaskMigrationStatusMap | undefined;
  // eslint-disable-next-line no-var
  var __kmPersonalMigrationStatusMtime__: number | undefined;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadAllStatusRecords(): TaskMigrationStatusMap {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const mtime = fs.statSync(STATUS_FILE).mtimeMs;
      if (global.__kmPersonalMigrationStatus__ && global.__kmPersonalMigrationStatusMtime__ === mtime) {
        return global.__kmPersonalMigrationStatus__;
      }
      const raw = fs.readFileSync(STATUS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        global.__kmPersonalMigrationStatus__ = parsed;
        global.__kmPersonalMigrationStatusMtime__ = mtime;
        return parsed;
      }
    }
  } catch (err) {
    console.error("读取 knowledge-personal-migration-status.json 失败:", err);
  }
  return {};
}

function persistAllStatusRecords(data: TaskMigrationStatusMap) {
  ensureDataDir();
  const tempFile = `${STATUS_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tempFile, STATUS_FILE);
  global.__kmPersonalMigrationStatus__ = data;
  global.__kmPersonalMigrationStatusMtime__ = fs.statSync(STATUS_FILE).mtimeMs;
}

export function getPersonalMigrationRecords(taskId: string): Record<string, MemberPersonalMigrationRecord> {
  const all = loadAllStatusRecords();
  return all[taskId] || all["global"] || {};
}

export function savePersonalMigrationRecords(taskId: string, records: Record<string, MemberPersonalMigrationRecord>) {
  const all = loadAllStatusRecords();
  all[taskId] = records;
  persistAllStatusRecords(all);
}

/**
 * 综合关联：结合飞书名单与任务历史贡献，计算每位成员的迁移完成状态与贡献数据
 */
export function getTaskMemberContributionStatus(taskId: string) {
  const task = getTask(taskId);
  const rosterMembers = getRosterMembers();
  const statusRecords = getPersonalMigrationRecords(taskId);

  const personsRank: MigrationPersonStat[] = task?.stats?.personsRank || [];

  const items: MemberContributionMigrationItem[] = rosterMembers.map((member) => {
    // 匹配个人迁移状态记录 (按 member.id, name, 或 email 前缀)
    const record =
      statusRecords[member.id] ||
      statusRecords[member.name] ||
      (member.email ? statusRecords[member.email.split("@")[0]] : undefined);

    // 匹配历史贡献统计 (按 userId=openId 或 姓名)
    const stat = personsRank.find((p) => {
      if (member.openId && p.userId && p.userId === member.openId) return true;
      if (p.personName && member.name) {
        if (p.personName === member.name) return true;
        if (p.personName.includes(member.name) || member.name.includes(p.personName)) return true;
      }
      return false;
    });

    const nonWikiCount = stat?.nonWikiCount || 0;
    const wikiCount = stat?.wikiCount || 0;
    const totalCount = stat?.totalCount || (nonWikiCount + wikiCount);
    const categories = stat?.categories || [];

    const completed = Boolean(record?.completed);
    const isZeroContributor = nonWikiCount === 0;
    const isZeroAndIncomplete = !completed && isZeroContributor;

    return {
      memberId: member.id,
      name: member.name,
      email: member.email,
      openId: member.openId,
      atTag: member.atTag || getAtTagByName(member.name),
      completed,
      completedAt: record?.completedAt,
      note: record?.note,
      nonWikiCount,
      wikiCount,
      totalCount,
      categories,
      isZeroContributor,
      isZeroAndIncomplete,
    };
  });

  // 按状态排序：待催办排在最前，其次未完成但有贡献，最后已完成
  items.sort((a, b) => {
    if (a.isZeroAndIncomplete && !b.isZeroAndIncomplete) return -1;
    if (!a.isZeroAndIncomplete && b.isZeroAndIncomplete) return 1;
    if (!a.completed && b.completed) return -1;
    if (a.completed && !b.completed) return 1;
    return b.nonWikiCount - a.nonWikiCount;
  });

  const zeroContributors = items.filter((item) => item.isZeroAndIncomplete);
  const completedCount = items.filter((item) => item.completed).length;

  return {
    members: items,
    summary: {
      total: items.length,
      completed: completedCount,
      incomplete: items.length - completedCount,
      zeroContributorsAndIncomplete: zeroContributors.length,
      zeroContributors,
    },
    notifyConfig: task?.notifyConfig,
  };
}

/**
 * 更新单个人员的个人文档迁移状态
 */
export function updateMemberPersonalMigrationStatus(
  taskId: string,
  memberIdOrName: string,
  completed: boolean,
  note?: string,
): MemberPersonalMigrationRecord {
  const records = getPersonalMigrationRecords(taskId);
  const rosterMembers = getRosterMembers();
  const matched = rosterMembers.find(
    (m) => m.id === memberIdOrName || m.name === memberIdOrName || m.email === memberIdOrName,
  );

  const key = matched?.id || memberIdOrName;
  const now = new Date().toISOString();

  const prev = records[key] || {
    memberId: key,
    name: matched?.name || memberIdOrName,
    email: matched?.email,
    openId: matched?.openId,
    completed: false,
    updatedAt: now,
  };

  const updated: MemberPersonalMigrationRecord = {
    ...prev,
    completed,
    completedAt: completed ? (prev.completedAt || now) : undefined,
    note: note !== undefined ? note.trim() : prev.note,
    updatedAt: now,
  };

  records[key] = updated;
  savePersonalMigrationRecords(taskId, records);
  return updated;
}

/**
 * 批量更新人员的个人文档迁移状态
 */
export function batchUpdateMemberPersonalMigrationStatus(
  taskId: string,
  updates: Array<{ memberIdOrName: string; completed: boolean; note?: string }>,
) {
  const records = getPersonalMigrationRecords(taskId);
  const rosterMembers = getRosterMembers();
  const now = new Date().toISOString();

  for (const item of updates) {
    const matched = rosterMembers.find(
      (m) => m.id === item.memberIdOrName || m.name === item.memberIdOrName || m.email === item.memberIdOrName,
    );
    const key = matched?.id || item.memberIdOrName;
    const prev = records[key] || {
      memberId: key,
      name: matched?.name || item.memberIdOrName,
      email: matched?.email,
      openId: matched?.openId,
      completed: false,
      updatedAt: now,
    };

    records[key] = {
      ...prev,
      completed: item.completed,
      completedAt: item.completed ? (prev.completedAt || now) : undefined,
      note: item.note !== undefined ? item.note.trim() : prev.note,
      updatedAt: now,
    };
  }

  savePersonalMigrationRecords(taskId, records);
}
