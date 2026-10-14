export interface RosterMember {
  id: string;
  name: string;
  email: string;
  openId?: string;
  mobile?: string;
  department?: string;
  atTag: string; // e.g. `<at id="ou_xxx">姓名</at>` 或 `@姓名`
  updatedAt?: string;
}

export interface RosterConfig {
  sourceUrl: string;
  lastSyncAt?: string;
  lastSyncStatus?: "success" | "error";
  lastSyncError?: string;
  totalMembers?: number;
  resolvedOpenIdCount?: number;
}

export interface RosterStoreData {
  config: RosterConfig;
  members: RosterMember[];
}

export const DEFAULT_ROSTER_SOURCE_URL =
  "https://segway-ninebot.feishu.cn/wiki/CIa3wViE6iXC8qkZDCScNs6Pnzd?table=tblBzQZc7Ik9XuC3&view=vewP2B92zv&sheet=x2ifD2";
