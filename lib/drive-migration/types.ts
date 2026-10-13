export type DriveFileType =
  | "docx"
  | "doc"
  | "sheet"
  | "bitable"
  | "folder"
  | "file"
  | "slides"
  | "mindnote"
  | "shortcut"
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
  isShortcut?: boolean;
  shortcutToken?: string;
  targetToken?: string;
  targetType?: string;
  status?: "pending" | "migrating" | "migrated" | "skipped" | "failed";
  wikiToken?: string;
  wikiUrl?: string;
}

export interface WikiDirectoryNode {
  nodeToken: string;
  title: string;
  objType?: string;
  objToken?: string;
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
  knownItemStates?: Record<
    string,
    {
      status: "pending" | "migrating" | "migrated" | "skipped" | "failed";
      wikiToken?: string;
      url?: string;
      error?: string;
    }
  >;
}

export interface MigrateItemParam {
  token: string;
  name: string;
  type: string;
  customTargetParentToken?: string;
  isShortcut?: boolean;
  targetToken?: string;
  shortcutToken?: string;
  targetType?: string;
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
  isShortcut?: boolean;
  targetToken?: string;
  shortcutToken?: string;
  targetType?: string;
}

export interface DriveMigrationTask {
  id: string;
  name: string;
  clientId?: string;
  sourceFolderUrl?: string;
  sourceFolderToken?: string;
  sourceFolderName?: string;
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

export interface MigratedFileRecord {
  fileToken: string;
  fileName: string;
  fileType: string;
  sourceDriveToken?: string;
  sourceDriveUrl?: string;
  sourceDriveName?: string;
  targetWikiUrl: string;
  targetParentNodeToken?: string;
  wikiToken?: string;
  wikiUrl?: string;
  migratedAt: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  taskId?: string;
}

export interface DriveFolderStat {
  folderToken: string;
  folderUrl?: string;
  folderName?: string;
  totalMigratedFiles: number;
  successCount: number;
  failedCount: number;
  lastMigratedAt: string;
  fileTokens: string[];
}

export interface TargetWikiStat {
  targetWikiUrl: string;
  spaceId?: string;
  totalMigratedFiles: number;
  successCount: number;
  failedCount: number;
  lastMigratedAt: string;
  fileTokens: string[];
}

export interface DriveMigrationStats {
  totalFiles: number;
  successFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalDrivesCount: number;
  totalTargetWikisCount: number;
  drives: Record<string, DriveFolderStat>;
  targetWikis: Record<string, TargetWikiStat>;
  records: MigratedFileRecord[];
  updatedAt: string;
}


