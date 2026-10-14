import fs from "fs";
import path from "path";
import { DEFAULT_ROSTER_SOURCE_URL, RosterConfig, RosterMember, RosterStoreData } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "roster.json");

declare global {
  // eslint-disable-next-line no-var
  var __rosterStore__: RosterStoreData | undefined;
  // eslint-disable-next-line no-var
  var __rosterStoreMtime__: number | undefined;
}

const DEFAULT_STORE: RosterStoreData = {
  config: {
    sourceUrl: DEFAULT_ROSTER_SOURCE_URL,
    totalMembers: 0,
    resolvedOpenIdCount: 0,
  },
  members: [],
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getRosterStore(): RosterStoreData {
  if (fs.existsSync(STORE_FILE)) {
    const mtime = fs.statSync(STORE_FILE).mtimeMs;
    if (global.__rosterStore__ && global.__rosterStoreMtime__ === mtime) {
      return global.__rosterStore__;
    }
    try {
      const content = fs.readFileSync(STORE_FILE, "utf-8");
      const parsed = JSON.parse(content) as RosterStoreData;
      if (parsed && typeof parsed === "object") {
        const data: RosterStoreData = {
          config: {
            ...DEFAULT_STORE.config,
            ...(parsed.config || {}),
          },
          members: Array.isArray(parsed.members) ? parsed.members : [],
        };
        global.__rosterStore__ = data;
        global.__rosterStoreMtime__ = mtime;
        return data;
      }
    } catch (error) {
      console.error("读取 data/roster.json 失败:", error);
    }
  }

  return DEFAULT_STORE;
}

export function saveRosterStore(data: RosterStoreData): void {
  ensureDataDir();
  const tempFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tempFile, STORE_FILE);
  global.__rosterStore__ = data;
  global.__rosterStoreMtime__ = fs.statSync(STORE_FILE).mtimeMs;
}

export function getRosterConfig(): RosterConfig {
  return getRosterStore().config;
}

export function saveRosterConfig(patch: Partial<RosterConfig>): RosterConfig {
  const store = getRosterStore();
  const nextConfig: RosterConfig = {
    ...store.config,
    ...patch,
  };
  saveRosterStore({
    ...store,
    config: nextConfig,
  });
  return nextConfig;
}

export function getRosterMembers(): RosterMember[] {
  return getRosterStore().members;
}

export function saveRosterMembers(members: RosterMember[]): void {
  const store = getRosterStore();
  const resolvedOpenIdCount = members.filter((m) => Boolean(m.openId)).length;
  saveRosterStore({
    config: {
      ...store.config,
      totalMembers: members.length,
      resolvedOpenIdCount,
    },
    members,
  });
}

export function upsertRosterMember(
  member: Partial<RosterMember> & { name: string; email?: string },
): RosterMember {
  const store = getRosterStore();
  const name = member.name.trim();
  const email = (member.email || "").trim().toLowerCase();
  const openId = member.openId?.trim();
  const atTag = openId ? `<at id="${openId}">${name}</at>` : `@${name}`;

  const existingIndex = store.members.findIndex(
    (m) =>
      m.name === name ||
      (email && m.email === email) ||
      (openId && m.openId === openId) ||
      (member.id && m.id === member.id),
  );

  const newEntry: RosterMember = {
    id: member.id || openId || (email ? email.split("@")[0] : `member_${Date.now()}`),
    name,
    email,
    openId,
    mobile: member.mobile?.trim(),
    department: member.department?.trim(),
    atTag,
    updatedAt: new Date().toISOString(),
  };

  const updatedMembers = [...store.members];
  if (existingIndex >= 0) {
    updatedMembers[existingIndex] = {
      ...updatedMembers[existingIndex],
      ...newEntry,
    };
  } else {
    updatedMembers.push(newEntry);
  }

  saveRosterMembers(updatedMembers);
  return newEntry;
}

export function deleteRosterMember(idOrNameOrEmail: string): boolean {
  const store = getRosterStore();
  const target = idOrNameOrEmail.trim().toLowerCase();
  const initialLen = store.members.length;
  const filtered = store.members.filter(
    (m) => m.id.toLowerCase() !== target && m.name.toLowerCase() !== target && m.email.toLowerCase() !== target,
  );

  if (filtered.length !== initialLen) {
    saveRosterMembers(filtered);
    return true;
  }
  return false;
}
