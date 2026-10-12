export type DriveFileType =
  | "docx"
  | "doc"
  | "sheet"
  | "bitable"
  | "folder"
  | "file"
  | "slides"
  | "mindnote"
  | "unknown";

export interface DriveFileItem {
  token: string;
  name: string;
  type: DriveFileType;
  parentToken?: string;
  parentPath?: string;
  url?: string;
  modifiedTime?: string;
  size?: number;
}

export interface WikiDirectoryNode {
  nodeToken: string;
  title: string;
  objType?: string;
  parentNodeToken?: string;
  path: string;
  depth: number;
  hasChild?: boolean;
}

export interface ScanDriveResult {
  folderInfo?: {
    token: string;
    name?: string;
  };
  files: DriveFileItem[];
  wiki: {
    spaceId: string;
    rootToken: string;
    rootTitle: string;
    directories: WikiDirectoryNode[];
  };
  stats: {
    totalFiles: number;
    totalFolders: number;
    typeCounts: Record<string, number>;
  };
}

export interface MigrateItemParam {
  token: string;
  name: string;
  type: string;
  customTargetParentToken?: string;
}

export interface MigrateSingleResult {
  token: string;
  name: string;
  type: string;
  status: "success" | "failed" | "skipped";
  wikiToken?: string;
  url?: string;
  error?: string;
}

export interface BatchMigrateResponse {
  results: MigrateSingleResult[];
  summary: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
  };
}

export type MigrationTaskStatus = "pending" | "running" | "completed" | "failed";

export interface MigrationTaskItemDetail {
  token: string;
  name: string;
  type: string;
  customTargetParentToken?: string;
  status: "pending" | "migrating" | "success" | "failed" | "skipped";
  wikiToken?: string;
  url?: string;
  error?: string;
}

export interface DriveMigrationTask {
  id: string;
  name: string;
  targetWikiUrl: string;
  targetParentNodeToken?: string;
  status: MigrationTaskStatus;
  progress: {
    total: number;
    completed: number;
    success: number;
    failed: number;
    skipped: number;
  };
  currentFile?: string;
  items: MigrationTaskItemDetail[];
  createdAt: string;
  updatedAt: string;
}

