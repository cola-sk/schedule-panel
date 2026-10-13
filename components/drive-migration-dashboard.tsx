"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  FolderSync,
  Search,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Loader2,
  FolderOpen,
  Folder,
  ChevronRight,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  Layers,
  Database,
  File,
  HelpCircle,
  Info,
  CheckSquare,
  Square,
  RefreshCw,
  Sparkles,
  EyeOff,
  RotateCcw,
  Check,
  Trash2,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DriveFileItem,
  DriveFileType,
  WikiDirectoryNode,
  ScanDriveResult,
  MigrateSingleResult,
  DriveMigrationTask,
} from "@/lib/drive-migration/types";
import { DriveMigrationTasksSheet } from "./drive-migration-tasks-sheet";

const DEFAULT_WIKI_URL =
  "https://segway-ninebot.feishu.cn/wiki/SFHOwfaJ8iC6Vzkm8ehcL5YYn2f";

const STORAGE_KEY_CONFIG = "feishu_drive_migration_config";
const STORAGE_KEY_SCAN = "feishu_drive_migration_scan";
const STORAGE_KEY_ITEM_STATES = "feishu_drive_migration_item_states";
const STORAGE_KEY_ITEM_TARGETS = "feishu_drive_migration_item_targets";
const STORAGE_KEY_SELECTED = "feishu_drive_migration_selected";
const STORAGE_KEY_SELECTED_ID = "feishu_drive_migration_selected_id";
const STORAGE_KEY_CLIENT_ID = "feishu_drive_migration_client_id";

function getClientId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(STORAGE_KEY_CLIENT_ID);
  if (!id) {
    id = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem(STORAGE_KEY_CLIENT_ID, id);
  }
  return id;
}

const inputControlClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// 与知识库归档选择框完全一致的紧凑下拉样式
const selectClass =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-foreground";

type ItemStatus = "pending" | "migrating" | "migrated" | "skipped" | "failed";

export interface ItemStateDetail {
  status: ItemStatus;
  wikiToken?: string;
  url?: string;
  error?: string;
  manual?: boolean;
}

export interface ItemTargetSelection {
  level1Token: string; // 一级目录 token，为空时代表根目录
  level2Token: string; // 二级目录 token，为空时代表存入一级目录
  level3Token: string; // 三级目录 token，为空时代表存入二级目录
}

export interface DriveTreeNode {
  id: string; // 节点 Token
  name: string; // 节点名称
  type: DriveFileType;
  path: string; // 相对路径
  parentToken?: string;
  parentPath?: string;
  isFolder: boolean;
  children: DriveTreeNode[];
  allDescendantFileTokens: string[]; // 该节点及其下所有后代文档 Token
  counts?: {
    total: number;
    pending: number;
    migrated: number;
    skipped: number;
    failed: number;
  };
}

type ToastState = { message: string; tone: "success" | "error"; seconds: number };

function Metric({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string | number;
  compact?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 transition-colors">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-semibold tracking-tight text-foreground ${compact ? "text-lg" : "text-2xl"}`}>
        {value}
      </p>
    </div>
  );
}

function getFileTypeIcon(type: DriveFileType) {
  switch (type) {
    case "docx":
    case "doc":
      return <FileText className="size-3.5 text-blue-500 shrink-0" />;
    case "sheet":
      return <FileSpreadsheet className="size-3.5 text-emerald-500 shrink-0" />;
    case "bitable":
      return <Database className="size-3.5 text-purple-500 shrink-0" />;
    case "folder":
      return <FolderOpen className="size-3.5 text-amber-500 shrink-0" />;
    case "slides":
      return <Layers className="size-3.5 text-orange-500 shrink-0" />;
    default:
      return <File className="size-3.5 text-muted-foreground shrink-0" />;
  }
}

function getFileTypeLabel(type: DriveFileType) {
  switch (type) {
    case "docx":
    case "doc":
      return "云文档";
    case "sheet":
      return "电子表格";
    case "bitable":
      return "多维表格";
    case "folder":
      return "文件夹";
    case "slides":
      return "幻灯片";
    case "mindnote":
      return "思维笔记";
    default:
      return "文件";
  }
}

/**
 * 构建网盘完整文件树（包含文件夹和所有文档）
 */
function buildFullDriveTree(
  files: DriveFileItem[],
  rootToken?: string,
  itemStates: Record<string, ItemStateDetail> = {},
): {
  rootChildren: DriveTreeNode[];
  nodeMap: Map<string, DriveTreeNode>;
  totalFolders: number;
  totalFiles: number;
} {
  const nodeMap = new Map<string, DriveTreeNode>();
  let totalFolders = 0;
  let totalFiles = 0;

  for (const f of files) {
    const isFolder = f.type === "folder";
    if (isFolder) totalFolders++;
    else totalFiles++;

    const parentPath = f.parentPath || "/";
    const selfPath =
      parentPath === "/"
        ? `/${f.name}`
        : `${parentPath}/${f.name}`.replace(/\/+/g, "/");

    nodeMap.set(f.token, {
      id: f.token,
      name: f.name,
      type: f.type,
      path: selfPath,
      parentToken: f.parentToken,
      parentPath: f.parentPath,
      isFolder,
      children: [],
      allDescendantFileTokens: isFolder ? [] : [f.token],
      counts: { total: 0, pending: 0, migrated: 0, skipped: 0, failed: 0 },
    });
  }

  const rootChildren: DriveTreeNode[] = [];

  for (const node of nodeMap.values()) {
    const parentId = node.parentToken;
    if (
      parentId &&
      nodeMap.has(parentId) &&
      parentId !== node.id &&
      parentId !== rootToken
    ) {
      nodeMap.get(parentId)!.children.push(node);
    } else if (parentId === rootToken || !parentId || node.parentPath === "/") {
      rootChildren.push(node);
    } else {
      let matched = false;
      for (const other of nodeMap.values()) {
        if (other.isFolder && other.id !== node.id && other.path === node.parentPath) {
          other.children.push(node);
          matched = true;
          break;
        }
      }
      if (!matched) {
        rootChildren.push(node);
      }
    }
  }

  function sortAndAggregate(node: DriveTreeNode) {
    node.children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const tokens = new Set<string>(node.isFolder ? [] : [node.id]);
    for (const child of node.children) {
      sortAndAggregate(child);
      child.allDescendantFileTokens.forEach((t) => tokens.add(t));
    }
    node.allDescendantFileTokens = Array.from(tokens);

    if (node.isFolder) {
      const counts = { total: 0, pending: 0, migrated: 0, skipped: 0, failed: 0 };
      for (const t of node.allDescendantFileTokens) {
        counts.total++;
        const st = itemStates[t]?.status || "pending";
        if (st === "migrated") counts.migrated++;
        else if (st === "skipped") counts.skipped++;
        else if (st === "failed") counts.failed++;
        else counts.pending++;
      }
      node.counts = counts;
    }
  }

  rootChildren.sort((a, b) => {
    if (a.isFolder !== b.isFolder) {
      return a.isFolder ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  rootChildren.forEach(sortAndAggregate);

  return { rootChildren, nodeMap, totalFolders, totalFiles };
}

/**
 * 递归渲染左侧网盘目录树（展示文件夹与文档）
 */
function DriveTreeNodeRow({
  node,
  searchKeyword,
  treeFilter,
  selectedId,
  onSelect,
  level = 0,
  itemStates,
}: {
  node: DriveTreeNode;
  searchKeyword: string;
  treeFilter: "all" | "pending" | "skipped" | "migrated";
  selectedId: string;
  onSelect: (id: string) => void;
  level?: number;
  itemStates: Record<string, ItemStateDetail>;
}) {
  const isAllMigrated = Boolean(
    node.isFolder &&
    node.counts &&
    node.counts.total > 0 &&
    node.counts.migrated === node.counts.total
  );

  const isAllSkipped = Boolean(
    node.isFolder &&
    node.counts &&
    node.counts.total > 0 &&
    node.counts.skipped === node.counts.total
  );

  // 默认折叠：当文件夹下所有文件已忽略时默认折叠(false)，否则默认展开(true)
  const [expanded, setExpanded] = useState<boolean>(!isAllSkipped);
  const prevIsAllSkippedRef = useRef(isAllSkipped);

  // 当整目录文档变为全部忽略时自动折叠
  useEffect(() => {
    if (isAllSkipped && !prevIsAllSkippedRef.current) {
      setExpanded(false);
    }
    prevIsAllSkippedRef.current = isAllSkipped;
  }, [isAllSkipped]);

  const isSelected = selectedId === node.id;
  const hasChildren = node.children && node.children.length > 0;

  // 搜索关键字匹配判断（自身匹配或任一下级子节点匹配）
  const hasMatchingDescendant = useMemo(() => {
    if (!searchKeyword.trim()) return true;
    const lower = searchKeyword.toLowerCase();
    function check(n: DriveTreeNode): boolean {
      if (
        n.name.toLowerCase().includes(lower) ||
        n.path.toLowerCase().includes(lower)
      ) {
        return true;
      }
      return n.children.some(check);
    }
    return check(node);
  }, [node, searchKeyword]);

  // 状态筛选判断（自身匹配或任一下级子节点匹配）
  const hasMatchingFilter = useMemo(() => {
    if (treeFilter === "all") return true;
    if (node.isFolder) {
      if (!node.counts || node.counts.total === 0) return false;
      if (treeFilter === "pending") return node.counts.pending > 0;
      if (treeFilter === "skipped") return node.counts.skipped > 0;
      if (treeFilter === "migrated") return node.counts.migrated > 0;
      return true;
    } else {
      const st = itemStates[node.id]?.status || "pending";
      return st === treeFilter;
    }
  }, [node, treeFilter, itemStates]);

  // 搜索关键字存在或处于特定状态筛选时，自动展开含有匹配后代项的节点
  useEffect(() => {
    if (searchKeyword.trim() && hasMatchingDescendant && hasChildren) {
      setExpanded(true);
    } else if (treeFilter !== "all" && hasMatchingFilter && hasChildren) {
      setExpanded(true);
    }
  }, [searchKeyword, hasMatchingDescendant, treeFilter, hasMatchingFilter, hasChildren]);

  if (searchKeyword.trim() && !hasMatchingDescendant) {
    return null;
  }

  if (treeFilter !== "all" && !hasMatchingFilter) {
    return null;
  }

  const fileState = !node.isFolder ? itemStates[node.id]?.status || "pending" : null;
  const isFileSkipped = !node.isFolder && fileState === "skipped";

  return (
    <div>
      <div
        onClick={() => {
          if (hasChildren && !expanded && !isAllSkipped) setExpanded(true);
          onSelect(node.id);
        }}
        onKeyDown={(e) => e.key === "Enter" && onSelect(node.id)}
        style={{ paddingLeft: `${level * 14 + 6}px` }}
        className={`group flex cursor-pointer items-center justify-between rounded-md py-1.5 pr-2 text-xs transition-colors ${
          isSelected
            ? "bg-primary/10 text-primary font-semibold"
            : isAllSkipped || isFileSkipped
            ? "text-muted-foreground/80 hover:bg-secondary/60"
            : "text-foreground hover:bg-secondary/60"
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {node.isFolder ? (
            hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(!expanded);
                }}
                className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                title={expanded ? "折叠目录" : "展开目录"}
              >
                {expanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
            ) : (
              <span className="w-3.5" />
            )
          ) : (
            <span className="w-3.5" />
          )}

          {node.isFolder ? (
            isAllSkipped ? (
              expanded ? (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground/60" />
              ) : (
                <Folder className="size-3.5 shrink-0 text-muted-foreground/60" />
              )
            ) : expanded ? (
              <FolderOpen className="size-3.5 shrink-0 text-amber-500" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-amber-500" />
            )
          ) : (
            getFileTypeIcon(node.type)
          )}

          <span
            className={`truncate ${isAllSkipped || isFileSkipped ? "text-muted-foreground opacity-80" : ""}`}
            title={`${node.name} (${node.path})`}
          >
            {node.name}
          </span>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {node.isFolder ? (
            isAllMigrated ? (
              <span title="该目录下所有文档均已完成迁移">
                <CheckCircle2 className="size-3.5 text-emerald-500" />
              </span>
            ) : isAllSkipped ? (
              <span
                className="flex items-center gap-1 rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] text-muted-foreground font-normal"
                title="该目录下所有文档均已忽略"
              >
                <EyeOff className="size-3 shrink-0" />
                <span>已忽略</span>
              </span>
            ) : (
              node.counts && node.counts.total > 0 && (
                <span
                  className="font-mono text-[10px] text-muted-foreground"
                  title={`已迁移 ${node.counts.migrated} / 共 ${node.counts.total} 篇${
                    node.counts.skipped > 0 ? ` (已忽略 ${node.counts.skipped})` : ""
                  }`}
                >
                  {node.counts.migrated}/{node.counts.total}
                </span>
              )
            )
          ) : (
            fileState === "migrated" ? (
              <span title="已完成迁移">
                <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
              </span>
            ) : fileState === "skipped" ? (
              <span
                className="flex items-center gap-1 text-[10px] text-muted-foreground font-normal"
                title="已忽略"
              >
                <EyeOff className="size-3 shrink-0" />
                <span>已忽略</span>
              </span>
            ) : fileState === "failed" ? (
              <span title="迁移失败">
                <CircleAlert className="size-3.5 text-destructive shrink-0" />
              </span>
            ) : null
          )}
        </div>
      </div>

      {hasChildren && expanded && (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <DriveTreeNodeRow
              key={child.id}
              node={child}
              searchKeyword={searchKeyword}
              treeFilter={treeFilter}
              selectedId={selectedId}
              onSelect={onSelect}
              level={level + 1}
              itemStates={itemStates}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DriveMigrationDashboard() {
  const [folderUrl, setFolderUrl] = useState("");
  const [wikiUrl, setWikiUrl] = useState(DEFAULT_WIKI_URL);
  const [recursive, setRecursive] = useState(true);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanDriveResult | null>(null);

  // 每条文档记录独立的目标路径设置映射：fileToken -> ItemTargetSelection
  const [itemTargets, setItemTargets] = useState<Record<string, ItemTargetSelection>>({});

  // 批量快捷设置的目标路径（作为快捷批量应用的缓存）
  const [batchTarget, setBatchTarget] = useState<ItemTargetSelection>({
    level1Token: "",
    level2Token: "",
    level3Token: "",
  });

  // 文档的状态覆盖映射（通过浏览器 localStorage 本地持久化保存）
  const [itemStates, setItemStates] = useState<Record<string, ItemStateDetail>>({});

  // 选中的文档 token 集合
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());

  // 左侧选中的网盘节点 ID（'all' 代表全部文档，目录则展示目录下所有文档，单文件则右侧只展示单文件）
  const [selectedId, setSelectedId] = useState<string>("all");
  const [treeSearch, setTreeSearch] = useState<string>("");
  const [treeFilter, setTreeFilter] = useState<"all" | "pending" | "skipped" | "migrated">("all");

  // 是否已完成从 localStorage 恢复初始化（防止初始化时空状态覆写缓存）
  const [isLoaded, setIsLoaded] = useState(false);

  // 视图过滤状态
  const [statusTab, setStatusTab] = useState<"all" | "pending" | "migrated" | "skipped" | "failed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // 任务提交中状态（防止快速连续点击提交）
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const submittingTokensRef = useRef<Set<string>>(new Set());
  const isSubmittingBatchRef = useRef<boolean>(false);

  // Toast 提示
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 帮助卡片开关
  const [showHelp, setShowHelp] = useState(false);

  const showToast = useCallback((message: string, tone: "success" | "error" = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, tone, seconds: tone === "error" ? 6 : 4 });

    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, (tone === "error" ? 6 : 4) * 1000);
  }, []);

  // 1. 初始化时从 localStorage 恢复配置与扫描结果
  useEffect(() => {
    try {
      const savedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        if (parsed.folderUrl) setFolderUrl(parsed.folderUrl);
        if (parsed.wikiUrl) setWikiUrl(parsed.wikiUrl);
        if (typeof parsed.recursive === "boolean") setRecursive(parsed.recursive);
      }

      const savedScan = localStorage.getItem(STORAGE_KEY_SCAN);
      if (savedScan) {
        const parsedScan = JSON.parse(savedScan);
        setScanResult(parsedScan);
      }

      const savedStates = localStorage.getItem(STORAGE_KEY_ITEM_STATES);
      if (savedStates) {
        setItemStates(JSON.parse(savedStates));
      }

      const savedTargets = localStorage.getItem(STORAGE_KEY_ITEM_TARGETS);
      if (savedTargets) {
        setItemTargets(JSON.parse(savedTargets));
      }

      const savedSelected = localStorage.getItem(STORAGE_KEY_SELECTED);
      if (savedSelected) {
        setSelectedTokens(new Set(JSON.parse(savedSelected)));
      }

      const savedId = localStorage.getItem(STORAGE_KEY_SELECTED_ID);
      if (savedId) {
        setSelectedId(savedId);
      }
    } catch (e) {
      console.warn("读取本地缓存失败:", e);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // 2. 自动保存配置和状态到 localStorage（确保在初始化恢复完成后才写回，防止覆写现有状态）
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(
        STORAGE_KEY_CONFIG,
        JSON.stringify({ folderUrl, wikiUrl, recursive }),
      );
    } catch {}
  }, [folderUrl, wikiUrl, recursive, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      if (scanResult) {
        localStorage.setItem(STORAGE_KEY_SCAN, JSON.stringify(scanResult));
      }
    } catch {}
  }, [scanResult, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY_ITEM_STATES, JSON.stringify(itemStates));
    } catch {}
  }, [itemStates, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY_ITEM_TARGETS, JSON.stringify(itemTargets));
    } catch {}
  }, [itemTargets, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(
        STORAGE_KEY_SELECTED,
        JSON.stringify(Array.from(selectedTokens)),
      );
    } catch {}
  }, [selectedTokens, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY_SELECTED_ID, selectedId);
    } catch {}
  }, [selectedId, isLoaded]);

  // 构建目标知识库的一、二、三级目录层级映射
  const hierarchy = useMemo(() => {
    const allDirs = scanResult?.wiki?.directories || [];
    const rootToken = scanResult?.wiki?.rootToken || scanResult?.wiki?.spaceId || "";
    const rootTitle = scanResult?.wiki?.rootTitle || "知识库根目录";

    const level1Nodes = allDirs.filter(
      (d) =>
        d.nodeToken !== rootToken &&
        (d.depth === 1 || d.parentNodeToken === rootToken || (!d.parentNodeToken && d.nodeToken !== rootToken)),
    );

    const level1Set = new Set(level1Nodes.map((n) => n.nodeToken));
    const level2Map = new Map<string, WikiDirectoryNode[]>();
    const level3Map = new Map<string, WikiDirectoryNode[]>();

    allDirs.forEach((d) => {
      if (d.parentNodeToken && level1Set.has(d.parentNodeToken)) {
        const list = level2Map.get(d.parentNodeToken) || [];
        list.push(d);
        level2Map.set(d.parentNodeToken, list);
      }
    });

    const level2Set = new Set<string>();
    level2Map.forEach((children) => {
      children.forEach((c) => level2Set.add(c.nodeToken));
    });

    allDirs.forEach((d) => {
      if (d.parentNodeToken && level2Set.has(d.parentNodeToken)) {
        const list = level3Map.get(d.parentNodeToken) || [];
        list.push(d);
        level3Map.set(d.parentNodeToken, list);
      }
    });

    return {
      rootToken,
      rootTitle,
      level1Nodes,
      level2Map,
      level3Map,
    };
  }, [scanResult]);

  // 构建左侧个人网盘文件夹与文档完整树结构
  const driveTree = useMemo(() => {
    if (!scanResult?.files) {
      return {
        rootChildren: [],
        nodeMap: new Map<string, DriveTreeNode>(),
        totalFolders: 0,
        totalFiles: 0,
      };
    }
    return buildFullDriveTree(
      scanResult.files,
      scanResult.folderInfo?.token,
      itemStates,
    );
  }, [scanResult, itemStates]);

  // 计算某条记录最终生效的目标父节点 Token
  const getResolvedTargetToken = useCallback(
    (fileToken: string): string => {
      const target = itemTargets[fileToken] || {
        level1Token: "",
        level2Token: "",
        level3Token: "",
      };
      if (target.level3Token) return target.level3Token;
      if (target.level2Token) return target.level2Token;
      if (target.level1Token) return target.level1Token;
      return hierarchy.rootToken;
    },
    [itemTargets, hierarchy.rootToken],
  );

  // 获取某条记录的目录选择值
  const getItemTarget = useCallback(
    (fileToken: string): ItemTargetSelection => {
      return (
        itemTargets[fileToken] || {
          level1Token: "",
          level2Token: "",
          level3Token: "",
        }
      );
    },
    [itemTargets],
  );

  // 建立全局文件字典（支持按 token、targetToken、shortcutToken 快速索引）
  const fileMap = useMemo(() => {
    const map = new Map<string, DriveFileItem>();
    if (!scanResult?.files) return map;
    scanResult.files.forEach((f) => {
      map.set(f.token, f);
      if (f.targetToken) map.set(f.targetToken, f);
      if (f.shortcutToken) map.set(f.shortcutToken, f);
    });
    return map;
  }, [scanResult]);

  // 获取某个文件的当前状态（默认 pending，支持快捷方式穿透到真实文件或自带已知状态）
  const getFileState = useCallback(
    (token: string): ItemStateDetail => {
      if (itemStates[token]) return itemStates[token];
      const file = fileMap.get(token);
      if (file?.targetToken && itemStates[file.targetToken]) {
        return itemStates[file.targetToken];
      }
      if (file?.shortcutToken && itemStates[file.shortcutToken]) {
        return itemStates[file.shortcutToken];
      }
      if (file?.status && file.status !== "pending") {
        return {
          status: file.status,
          wikiToken: file.wikiToken,
          url: file.wikiUrl,
        };
      }
      return { status: "pending" };
    },
    [itemStates, fileMap],
  );

  // 当前左侧选中的树节点详情（可能为目录，也可能为单个文件，为 null 时代表全部文档）
  const selectedTreeNode = useMemo(() => {
    if (selectedId === "all") return null;
    return driveTree.nodeMap.get(selectedId) || null;
  }, [selectedId, driveTree]);

  // 当前选中的目录是否所有文档均已忽略
  const selectedFolderAllSkipped = useMemo(() => {
    return Boolean(
      selectedTreeNode &&
      selectedTreeNode.isFolder &&
      selectedTreeNode.counts &&
      selectedTreeNode.counts.total > 0 &&
      selectedTreeNode.counts.skipped === selectedTreeNode.counts.total,
    );
  }, [selectedTreeNode]);

  // 更新状态并立即同步写回本地持久化缓存
  const updateItemStates = useCallback(
    (updater: (prev: Record<string, ItemStateDetail>) => Record<string, ItemStateDetail>) => {
      setItemStates((prev) => {
        const next = updater(prev);
        try {
          localStorage.setItem(STORAGE_KEY_ITEM_STATES, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [],
  );

  // 后台任务管理状态
  const [tasks, setTasks] = useState<DriveMigrationTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [isTasksSheetOpen, setIsTasksSheetOpen] = useState(false);
  const prevCompletedTasksRef = useRef<Set<string>>(new Set());
  const isFirstFetchRef = useRef<boolean>(true);

  // 获取后台任务清单并同步完成状态至页面
  const fetchTasks = useCallback(async () => {
    try {
      setTasksLoading(true);
      const clientId = getClientId();
      const res = await fetch(`/api/drive-migration/tasks?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.tasks)) return;

      const newTasks: DriveMigrationTask[] = data.tasks;
      setTasks(newTasks);

      // 同步后台已迁移或失败的文档结果到当前主界面状态中
      const newlyFinishedItems: Record<string, ItemStateDetail> = {};
      const tokensToRemoveFromSelected = new Set<string>();

      newTasks.forEach((task) => {
        task.items.forEach((item) => {
          if (item.status === "success") {
            const detail: ItemStateDetail = {
              status: "migrated",
              wikiToken: item.wikiToken,
              url: item.url,
            };
            newlyFinishedItems[item.token] = detail;
            if (item.targetToken) newlyFinishedItems[item.targetToken] = detail;
            if (item.shortcutToken) newlyFinishedItems[item.shortcutToken] = detail;
            tokensToRemoveFromSelected.add(item.token);
            if (item.targetToken) tokensToRemoveFromSelected.add(item.targetToken);
          } else if (item.status === "failed") {
            const failDetail: ItemStateDetail = {
              status: "failed",
              error: item.error,
            };
            newlyFinishedItems[item.token] = failDetail;
            if (item.targetToken) newlyFinishedItems[item.targetToken] = failDetail;
          }
        });
      });

      // 从后端持久化统计中同步可能已迁移的文档记录（防止清除任务后状态丢失）
      try {
        const statsRes = await fetch("/api/drive-migration/stats");
        if (statsRes.ok) {
          const statsJson = await statsRes.json();
          if (Array.isArray(statsJson?.stats?.records)) {
            statsJson.stats.records.forEach((rec: any) => {
              if (rec.status === "success" && rec.fileToken) {
                newlyFinishedItems[rec.fileToken] = {
                  status: "migrated",
                  wikiToken: rec.wikiToken,
                  url: rec.wikiUrl,
                };
                tokensToRemoveFromSelected.add(rec.fileToken);
              }
            });
          }
        }
      } catch {}

      if (Object.keys(newlyFinishedItems).length > 0) {
        updateItemStates((prev) => {
          let hasDiff = false;
          const next = { ...prev };
          Object.entries(newlyFinishedItems).forEach(([token, state]) => {
            if (
              !prev[token] ||
              prev[token].status !== state.status ||
              prev[token].wikiToken !== state.wikiToken
            ) {
              next[token] = state;
              hasDiff = true;
            }
          });
          return hasDiff ? next : prev;
        });

        if (tokensToRemoveFromSelected.size > 0) {
          setSelectedTokens((prev) => {
            let changed = false;
            const next = new Set(prev);
            tokensToRemoveFromSelected.forEach((t) => {
              if (next.has(t)) {
                next.delete(t);
                changed = true;
              }
            });
            return changed ? next : prev;
          });
        }
      }

      // 检测新完成的任务并给出 Toast 提示（首次加载时静默登记历史任务，仅后续轮询中新完成的任务才弹 Toast）
      if (isFirstFetchRef.current) {
        newTasks.forEach((task) => {
          if (task.status === "completed" || task.status === "failed") {
            prevCompletedTasksRef.current.add(task.id);
          }
        });
        isFirstFetchRef.current = false;
      } else {
        newTasks.forEach((task) => {
          if (
            task.status === "completed" &&
            !prevCompletedTasksRef.current.has(task.id)
          ) {
            prevCompletedTasksRef.current.add(task.id);
            if (task.progress.failed > 0) {
              showToast(
                `后台任务「${task.name}」已完成：成功 ${task.progress.success} 篇，失败 ${task.progress.failed} 篇`,
                "error",
              );
            } else {
              showToast(
                `后台任务「${task.name}」全部成功！共 ${task.progress.success} 篇文档已归档。`,
              );
            }
          }
        });
      }
    } catch (e) {
      console.warn("获取后台迁移任务失败:", e);
    } finally {
      setTasksLoading(false);
    }
  }, [updateItemStates, showToast]);

  // 组件加载时获取一次任务列表
  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  // 当有正在执行的任务时，开启 1.5 秒轮询；没有时停止轮询
  const hasRunningTasks = useMemo(() => {
    return tasks.some((t) => t.status === "running" || t.status === "pending");
  }, [tasks]);

  useEffect(() => {
    if (!hasRunningTasks) return;
    const interval = setInterval(() => {
      void fetchTasks();
    }, 1500);
    return () => clearInterval(interval);
  }, [hasRunningTasks, fetchTasks]);

  const runningTasksCount = useMemo(() => {
    return tasks.filter((t) => t.status === "running" || t.status === "pending").length;
  }, [tasks]);

  const latestRunningTask = useMemo(() => {
    return tasks.find((t) => t.status === "running" || t.status === "pending");
  }, [tasks]);

  // 当前处于后台执行中或排队中的文档 token 集合
  const runningTaskTokens = useMemo(() => {
    const tokens = new Set<string>();
    tasks.forEach((t) => {
      if (t.status === "running" || t.status === "pending") {
        t.items.forEach((item) => {
          if (item.status === "pending" || item.status === "migrating") {
            tokens.add(item.token);
          }
        });
      }
    });
    return tokens;
  }, [tasks]);

  // 清空已完成任务历史
  async function handleClearCompletedTasks() {
    try {
      const clientId = getClientId();
      await fetch(`/api/drive-migration/tasks?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
      await fetchTasks();
      showToast("已清空已完成的历史迁移任务");
    } catch {}
  }

  // 清空所有本地缓存数据
  function handleClearCache() {
    if (!window.confirm("确定要清空本地保存的网盘扫描结果、每条记录的目标路径和状态缓存吗？")) return;
    try {
      localStorage.removeItem(STORAGE_KEY_CONFIG);
      localStorage.removeItem(STORAGE_KEY_SCAN);
      localStorage.removeItem(STORAGE_KEY_ITEM_STATES);
      localStorage.removeItem(STORAGE_KEY_ITEM_TARGETS);
      localStorage.removeItem(STORAGE_KEY_SELECTED);
      localStorage.removeItem(STORAGE_KEY_SELECTED_ID);
      setFolderUrl("");
      setWikiUrl(DEFAULT_WIKI_URL);
      setScanResult(null);
      setItemStates({});
      setItemTargets({});
      setBatchTarget({ level1Token: "", level2Token: "", level3Token: "" });
      setSelectedTokens(new Set());
      setSelectedId("all");
      showToast("本地缓存已清空");
    } catch {}
  }

  // 扫描个人网盘与知识库
  async function handleScan() {
    if (!folderUrl.trim()) {
      showToast("请输入个人网盘文件夹链接或 Token", "error");
      return;
    }
    if (!wikiUrl.trim()) {
      showToast("请输入目标知识库链接", "error");
      return;
    }

    setScanning(true);

    try {
      const res = await fetch("/api/drive-migration/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderUrlOrToken: folderUrl.trim(),
          targetWikiUrl: wikiUrl.trim(),
          recursive,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "扫描网盘失败");
      }

      setScanResult(data);

      if (data.knownItemStates && Object.keys(data.knownItemStates).length > 0) {
        updateItemStates((prev) => ({
          ...prev,
          ...data.knownItemStates,
        }));
      }

      // 默认勾选非已迁移、非忽略的文档
      const initialSelected = new Set<string>();
      data.files.forEach((f: DriveFileItem) => {
        if (f.type !== "folder") {
          const directKnown =
            data.knownItemStates?.[f.token] ||
            (f.targetToken ? data.knownItemStates?.[f.targetToken] : undefined) ||
            (f.shortcutToken ? data.knownItemStates?.[f.shortcutToken] : undefined);
          const state = directKnown || getFileState(f.token);
          if (state.status !== "migrated" && state.status !== "skipped" && f.status !== "migrated") {
            initialSelected.add(f.token);
          }
        }
      });
      setSelectedTokens(initialSelected);

      showToast(`扫描成功：找到 ${data.stats?.totalFiles ?? 0} 个文档与 ${data.wiki?.directories?.length ?? 0} 个知识库目录。`);
    } catch (err: any) {
      showToast(err.message || "扫描发生未知错误", "error");
    } finally {
      setScanning(false);
    }
  }

  // 全局统计各状态的文档数量
  const globalStatusCounts = useMemo(() => {
    const counts = { all: 0, pending: 0, migrated: 0, skipped: 0, failed: 0 };
    if (!scanResult?.files) return counts;

    scanResult.files.forEach((f) => {
      if (f.type === "folder") return;
      counts.all++;
      const st = getFileState(f.token).status;
      if (st === "migrated") counts.migrated++;
      else if (st === "skipped") counts.skipped++;
      else if (st === "failed") counts.failed++;
      else counts.pending++;
    });

    return counts;
  }, [scanResult, getFileState]);

  // 当前选中节点范围内的各状态数量（用于状态 Tab）
  const scopeStatusCounts = useMemo(() => {
    const counts = { all: 0, pending: 0, migrated: 0, skipped: 0, failed: 0 };
    if (!scanResult?.files) return counts;

    let targetTokens: Set<string>;
    if (selectedId === "all") {
      targetTokens = new Set(
        scanResult.files.filter((f) => f.type !== "folder").map((f) => f.token),
      );
    } else {
      const node = driveTree.nodeMap.get(selectedId);
      if (node) {
        targetTokens = new Set(node.allDescendantFileTokens);
      } else {
        targetTokens = new Set();
      }
    }

    scanResult.files.forEach((f) => {
      if (f.type === "folder" || !targetTokens.has(f.token)) return;
      counts.all++;
      const st = getFileState(f.token).status;
      if (st === "migrated") counts.migrated++;
      else if (st === "skipped") counts.skipped++;
      else if (st === "failed") counts.failed++;
      else counts.pending++;
    });

    return counts;
  }, [scanResult, selectedId, driveTree, getFileState]);

  // 根据左侧目录树选择（全部 / 目录 / 单个文件）与右侧过滤条件计算展示的文件列表
  const filteredFiles = useMemo(() => {
    if (!scanResult?.files) return [];

    let filesInScope: DriveFileItem[] = [];
    if (selectedId === "all") {
      filesInScope = scanResult.files.filter((f) => f.type !== "folder");
    } else {
      const selectedNode = driveTree.nodeMap.get(selectedId);
      if (selectedNode) {
        if (selectedNode.isFolder) {
          // 点击目录：展示该目录及所有下级包含的文件
          const allowedTokens = new Set(selectedNode.allDescendantFileTokens);
          filesInScope = scanResult.files.filter((f) => allowedTokens.has(f.token));
        } else {
          // 点击单个文件：右侧仅展示该单篇文件
          filesInScope = scanResult.files.filter((f) => f.token === selectedNode.id);
        }
      } else {
        filesInScope = scanResult.files.filter((f) => f.type !== "folder");
      }
    }

    return filesInScope.filter((file) => {
      const state = getFileState(file.token);
      if (statusTab !== "all") {
        if (statusTab === "pending" && state.status !== "pending") return false;
        if (statusTab === "migrated" && state.status !== "migrated") return false;
        if (statusTab === "skipped" && state.status !== "skipped") return false;
        if (statusTab === "failed" && state.status !== "failed") return false;
      }

      if (typeFilter !== "all" && file.type !== typeFilter) return false;
      if (
        searchQuery.trim() &&
        !file.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(file.parentPath || "").toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [scanResult, selectedId, driveTree, statusTab, typeFilter, searchQuery, getFileState]);

  // 检查左侧目录树在当前搜索词和状态筛选下是否有任一可见节点（避免过滤后空白无提示）
  const hasAnyVisibleTreeNode = useMemo(() => {
    if (driveTree.rootChildren.length === 0) return false;
    if (treeFilter === "all" && !treeSearch.trim()) return true;

    function checkNode(n: DriveTreeNode): boolean {
      if (treeSearch.trim()) {
        const lower = treeSearch.toLowerCase();
        const matchSearch =
          n.name.toLowerCase().includes(lower) ||
          n.path.toLowerCase().includes(lower) ||
          n.children.some(checkNode);
        if (!matchSearch) return false;
      }

      if (treeFilter !== "all") {
        if (n.isFolder) {
          if (!n.counts || n.counts.total === 0) return false;
          if (treeFilter === "pending" && n.counts.pending === 0) return false;
          if (treeFilter === "skipped" && n.counts.skipped === 0) return false;
          if (treeFilter === "migrated" && n.counts.migrated === 0) return false;
        } else {
          const st = itemStates[n.id]?.status || "pending";
          if (st !== treeFilter) return false;
        }
      }
      return true;
    }

    return driveTree.rootChildren.some(checkNode);
  }, [driveTree.rootChildren, treeFilter, treeSearch, itemStates]);

  // 当前表格行全选 / 取消全选
  const isAllSelected = useMemo(() => {
    if (filteredFiles.length === 0) return false;
    return filteredFiles.every((f) => selectedTokens.has(f.token));
  }, [filteredFiles, selectedTokens]);

  function toggleSelectAll() {
    setSelectedTokens((prev) => {
      const next = new Set(prev);
      if (isAllSelected) {
        filteredFiles.forEach((f) => next.delete(f.token));
      } else {
        filteredFiles.forEach((f) => next.add(f.token));
      }
      return next;
    });
  }

  function toggleSelectOne(token: string) {
    setSelectedTokens((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  }

  // 修改单篇记录的目标路径
  function handleItemLevel1Change(fileToken: string, level1Token: string) {
    setItemTargets((prev) => ({
      ...prev,
      [fileToken]: {
        level1Token,
        level2Token: "",
        level3Token: "",
      },
    }));
  }

  function handleItemLevel2Change(fileToken: string, level2Token: string) {
    setItemTargets((prev) => {
      const current = prev[fileToken] || { level1Token: "", level2Token: "", level3Token: "" };
      return {
        ...prev,
        [fileToken]: {
          ...current,
          level2Token,
          level3Token: "",
        },
      };
    });
  }

  function handleItemLevel3Change(fileToken: string, level3Token: string) {
    setItemTargets((prev) => {
      const current = prev[fileToken] || { level1Token: "", level2Token: "", level3Token: "" };
      return {
        ...prev,
        [fileToken]: {
          ...current,
          level3Token,
        },
      };
    });
  }

  // 快捷将顶部选中的路径批量应用到勾选的文档
  function handleApplyBatchTargetToSelected() {
    if (selectedTokens.size === 0) {
      showToast("请先在列表中勾选要批量设置目标路径的文档", "error");
      return;
    }
    setItemTargets((prev) => {
      const next = { ...prev };
      selectedTokens.forEach((token) => {
        next[token] = { ...batchTarget };
      });
      return next;
    });
    showToast(`已为选中的 ${selectedTokens.size} 篇文档批量应用目标路径`);
  }

  // 单个文件的状态标记操作
  function handleMarkAsMigrated(token: string, name: string) {
    const file = fileMap.get(token);
    updateItemStates((prev) => ({
      ...prev,
      [token]: { status: "migrated", manual: true },
      ...(file?.targetToken ? { [file.targetToken]: { status: "migrated", manual: true } } : {}),
      ...(file?.shortcutToken ? { [file.shortcutToken]: { status: "migrated", manual: true } } : {}),
    }));
    setSelectedTokens((prev) => {
      const next = new Set(prev);
      next.delete(token);
      if (file?.targetToken) next.delete(file.targetToken);
      return next;
    });
    showToast(`已标记「${name}」为已迁移`);
  }

  function handleMarkAsSkipped(token: string, name: string) {
    const file = fileMap.get(token);
    updateItemStates((prev) => ({
      ...prev,
      [token]: { status: "skipped" },
      ...(file?.targetToken ? { [file.targetToken]: { status: "skipped" } } : {}),
      ...(file?.shortcutToken ? { [file.shortcutToken]: { status: "skipped" } } : {}),
    }));
    setSelectedTokens((prev) => {
      const next = new Set(prev);
      next.delete(token);
      if (file?.targetToken) next.delete(file.targetToken);
      return next;
    });
    showToast(`已忽略「${name}」`);
  }

  function handleResetToPending(token: string, name: string) {
    const file = fileMap.get(token);
    updateItemStates((prev) => {
      const next = { ...prev };
      delete next[token];
      if (file?.targetToken) delete next[file.targetToken];
      if (file?.shortcutToken) delete next[file.shortcutToken];
      return next;
    });
    showToast(`已将「${name}」恢复为待迁移`);
  }

  // 单个文档提交后台异步迁移
  async function handleMigrateSingle(file: DriveFileItem) {
    // 同步防重锁：若正在提交或后台已有该文档的活跃任务，立即拦截
    if (submittingTokensRef.current.has(file.token) || runningTaskTokens.has(file.token)) {
      showToast(`「${file.name}」已在后台迁移中，请勿重复操作`, "error");
      return;
    }
    submittingTokensRef.current.add(file.token);
    setIsSubmittingTask(true);

    const targetParentToken = getResolvedTargetToken(file.token);

    try {
      const res = await fetch("/api/drive-migration/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: getClientId(),
          name: `迁移「${file.name}」`,
          sourceFolderUrl: folderUrl.trim(),
          sourceFolderToken: scanResult?.folderInfo?.token,
          sourceFolderName: scanResult?.folderInfo?.name,
          targetWikiUrl: wikiUrl.trim(),
          targetParentNodeToken: hierarchy.rootToken,
          items: [
            {
              token: file.token,
              name: file.name,
              type: file.type,
              customTargetParentToken: targetParentToken,
              isShortcut: file.isShortcut,
              targetToken: file.targetToken,
              shortcutToken: file.shortcutToken,
              targetType: file.targetType,
            },
          ],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "启动后台迁移失败");

      if (data.isNew === false) {
        showToast(`「${file.name}」已在后台任务中运行，无需重复提交。`);
      } else {
        showToast(`已提交「${file.name}」至后台迁移，正在后台运行，您可继续正常操作。`);
      }
      void fetchTasks();
    } catch (err: any) {
      showToast(`启动迁移失败: ${err.message}`, "error");
    } finally {
      submittingTokensRef.current.delete(file.token);
      setIsSubmittingTask(false);
    }
  }

  // ----------------------------------------------------
  // 目录级别批量操作（支持 忽略 / 恢复 / 迁移 整个目录）
  // ----------------------------------------------------

  // 迁移整个目录（一键提交当前目录下所有待迁移文档至后台）
  async function handleMigrateFolder(node: DriveTreeNode) {
    if (isSubmittingBatchRef.current) return;
    if (!scanResult?.files) return;
    const allFilesMap = new Map(scanResult.files.map((f) => [f.token, f]));

    const pendingTokens = node.allDescendantFileTokens.filter((token) => {
      const st = getFileState(token).status;
      return (st === "pending" || st === "failed") && !runningTaskTokens.has(token);
    });

    if (pendingTokens.length === 0) {
      showToast(`目录「${node.name}」下没有待迁移的文档（或已全部在迁移中）`, "error");
      return;
    }

    if (
      !window.confirm(
        `确认将目录「${node.name}」下的 ${pendingTokens.length} 篇文档提交至后台迁移吗？\n文档将在后台异步迁移归档，不影响当前页面的其他操作。`,
      )
    ) {
      return;
    }

    const itemsToMigrate = pendingTokens
      .map((token) => allFilesMap.get(token))
      .filter(Boolean) as DriveFileItem[];

    try {
      isSubmittingBatchRef.current = true;
      setIsSubmittingTask(true);
      const payloadItems = itemsToMigrate.map((f) => ({
        token: f.token,
        name: f.name,
        type: f.type,
        customTargetParentToken: getResolvedTargetToken(f.token),
        isShortcut: f.isShortcut,
        targetToken: f.targetToken,
        shortcutToken: f.shortcutToken,
        targetType: f.targetType,
      }));

      const res = await fetch("/api/drive-migration/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: getClientId(),
          name: `迁移目录「${node.name}」 (${payloadItems.length} 篇)`,
          sourceFolderUrl: folderUrl.trim(),
          sourceFolderToken: scanResult?.folderInfo?.token,
          sourceFolderName: scanResult?.folderInfo?.name,
          targetWikiUrl: wikiUrl.trim(),
          targetParentNodeToken: hierarchy.rootToken,
          items: payloadItems,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "目录迁移提交失败");

      showToast(`已提交目录「${node.name}」的后台迁移任务（共 ${payloadItems.length} 篇文档），可在后台任务中查看实时进度。`);
      void fetchTasks();
    } catch (err: any) {
      showToast(`提交目录迁移失败: ${err.message}`, "error");
    } finally {
      isSubmittingBatchRef.current = false;
      setIsSubmittingTask(false);
    }
  }

  // 忽略整个目录
  function handleIgnoreFolder(node: DriveTreeNode) {
    const tokens = node.allDescendantFileTokens;
    if (tokens.length === 0) return;

    if (!window.confirm(`确定要将目录「${node.name}」下的 ${tokens.length} 篇文档全部标记为“已忽略”吗？`)) {
      return;
    }

    updateItemStates((prev) => {
      const next = { ...prev };
      tokens.forEach((t) => {
        next[t] = { status: "skipped", manual: true };
      });
      return next;
    });

    setSelectedTokens((prev) => {
      const next = new Set(prev);
      tokens.forEach((t) => next.delete(t));
      return next;
    });

    showToast(`已将目录「${node.name}」下的 ${tokens.length} 篇文档标记为已忽略`);
  }

  // 恢复整个目录为待迁移
  function handleResetFolder(node: DriveTreeNode) {
    const tokens = node.allDescendantFileTokens;
    if (tokens.length === 0) return;

    if (!window.confirm(`确定要将目录「${node.name}」下的 ${tokens.length} 篇文档全部恢复为“待迁移”状态吗？`)) {
      return;
    }

    updateItemStates((prev) => {
      const next = { ...prev };
      tokens.forEach((t) => {
        delete next[t];
      });
      return next;
    });

    showToast(`已将目录「${node.name}」下的 ${tokens.length} 篇文档恢复为待迁移`);
  }

  // 批量标记操作（针对表格勾选的已选项）
  function handleBatchMarkAsMigrated() {
    const selectedList = filteredFiles.filter((f) => selectedTokens.has(f.token));
    if (selectedList.length === 0) return;

    updateItemStates((prev) => {
      const next = { ...prev };
      selectedList.forEach((f) => {
        next[f.token] = { status: "migrated", manual: true };
      });
      return next;
    });

    setSelectedTokens((prev) => {
      const next = new Set(prev);
      selectedList.forEach((f) => next.delete(f.token));
      return next;
    });

    showToast(`已批量标记 ${selectedList.length} 篇文档为已迁移`);
  }

  function handleBatchMarkAsSkipped() {
    const selectedList = filteredFiles.filter((f) => selectedTokens.has(f.token));
    if (selectedList.length === 0) return;

    updateItemStates((prev) => {
      const next = { ...prev };
      selectedList.forEach((f) => {
        next[f.token] = { status: "skipped" };
      });
      return next;
    });

    setSelectedTokens((prev) => {
      const next = new Set(prev);
      selectedList.forEach((f) => next.delete(f.token));
      return next;
    });

    showToast(`已批量忽略 ${selectedList.length} 篇文档`);
  }

  function handleBatchResetToPending() {
    const selectedList = filteredFiles.filter((f) => selectedTokens.has(f.token));
    if (selectedList.length === 0) return;

    updateItemStates((prev) => {
      const next = { ...prev };
      selectedList.forEach((f) => {
        delete next[f.token];
      });
      return next;
    });

    showToast(`已将 ${selectedList.length} 篇文档恢复为待迁移`);
  }

  // 批量执行已勾选文档后台异步迁移
  async function handleExecuteBatchMigration() {
    if (isSubmittingBatchRef.current) return;
    if (selectedTokens.size === 0) {
      showToast("请先在列表中勾选要迁移的文档", "error");
      return;
    }

    const itemsToMigrate = (scanResult?.files || []).filter(
      (f) => selectedTokens.has(f.token) && !runningTaskTokens.has(f.token),
    );

    if (itemsToMigrate.length === 0) {
      showToast("选中的文档已全部在后台迁移中，无需重复操作", "error");
      return;
    }

    try {
      isSubmittingBatchRef.current = true;
      setIsSubmittingTask(true);
      const payloadItems = itemsToMigrate.map((f) => ({
        token: f.token,
        name: f.name,
        type: f.type,
        customTargetParentToken: getResolvedTargetToken(f.token),
        isShortcut: f.isShortcut,
        targetToken: f.targetToken,
        shortcutToken: f.shortcutToken,
        targetType: f.targetType,
      }));

      const res = await fetch("/api/drive-migration/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: getClientId(),
          name: `批量迁移文档 (${payloadItems.length} 篇)`,
          sourceFolderUrl: folderUrl.trim(),
          sourceFolderToken: scanResult?.folderInfo?.token,
          sourceFolderName: scanResult?.folderInfo?.name,
          targetWikiUrl: wikiUrl.trim(),
          targetParentNodeToken: hierarchy.rootToken,
          items: payloadItems,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "执行批量迁移失败");
      }

      showToast(`已提交 ${payloadItems.length} 篇文档的后台迁移任务，正在后台运行，您可继续正常操作。`);
      void fetchTasks();
    } catch (err: any) {
      showToast(`启动批量迁移失败: ${err.message}`, "error");
    } finally {
      isSubmittingBatchRef.current = false;
      setIsSubmittingTask(false);
    }
  }

  return (
    <div className="w-full px-6 py-8 sm:px-8 max-w-[1600px]">
      {/* 全局右上角 Toast */}
      {toast && (
        <div
          className={`fixed right-6 top-6 z-[100] flex max-w-[min(30rem,calc(100vw-3rem))] items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            toast.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="alert"
          aria-live="assertive"
        >
          {toast.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <span className="shrink-0 font-mono text-xs opacity-70">{toast.seconds}s</span>
        </div>
      )}

      {/* 顶部标题区 */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">个人网盘迁移</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            左侧目录树展示网盘所有文件与目录，支持按目录或单文档自由查看、忽略与迁移
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* 后台任务管理抽屉入口 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsTasksSheetOpen(true)}
            className={`gap-1.5 text-xs ${
              runningTasksCount > 0
                ? "border-amber-400 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                : ""
            }`}
            title="查看后台迁移任务列表及实时进度"
          >
            {runningTasksCount > 0 ? (
              <Loader2 className="size-3.5 animate-spin text-amber-500" />
            ) : (
              <FolderSync className="size-3.5" />
            )}
            <span>
              {runningTasksCount > 0
                ? `后台任务 (${runningTasksCount} 进行中)`
                : `后台任务 (${tasks.length})`}
            </span>
          </Button>

          {scanResult && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearCache}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              title="清空本地浏览器缓存数据"
            >
              <Trash2 className="size-3.5" />
              <span>清空缓存</span>
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHelp(!showHelp)}
            className="gap-1.5"
          >
            <HelpCircle className="size-4 text-muted-foreground" />
            <span>{showHelp ? "收起说明" : "使用与授权说明"}</span>
          </Button>
        </div>
      </div>

      {/* 本地缓存提示条 */}
      <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
        <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="leading-relaxed">
          <span className="font-medium">温馨提示：</span>
          网盘扫描与迁移记录仅保存在当前浏览器的本地缓存中。若更换浏览器、切换访问域名、使用无痕模式或清理浏览器缓存，历史记录将会消失（可随时重新扫描重新获取）。
        </div>
      </div>

      {/* 授权与操作指南卡片 */}
      {showHelp && (
        <Card className="mb-8 border-border bg-secondary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Sparkles className="size-4 text-amber-500" />
              <span>使用指引与目录树交互机制</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2 leading-relaxed">
            <p>
              1. <strong className="text-foreground">网盘文件夹授权</strong>：在飞书云文档中打开目标文件夹，点击右上角
              <strong>「... 分享」→「添加协作者」</strong>，搜索并添加您的
              <strong>飞书机器人</strong>（授予可阅读或可编辑权限）。
            </p>
            <p>
              2. <strong className="text-foreground">左侧网盘目录树导航</strong>：完全对齐「知识库归档」体验。左侧展示网盘所有文件夹及包含的文件。
              <strong>点击目录</strong>，右侧展示该目录及其下所有文件；<strong>点击单个文件</strong>，右侧仅展示该单篇文件。
            </p>
            <p>
              3. <strong className="text-foreground">目录与单文件级操作</strong>：支持一键对当前目录进行
              <strong>「迁移当前目录」</strong>或<strong>「忽略当前目录」</strong>；每篇文档右侧也可独立通过级联下拉框选择各自目标路径。
            </p>
            <p>
              4. <strong className="text-foreground">本地缓存说明</strong>：个人网盘的扫描清单、目标路径配置与状态覆盖映射仅保存在当前浏览器的本地缓存（LocalStorage）中，更换浏览器、切换访问域名或清理缓存后将清空，随时可通过重新扫描恢复。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 统计指标卡片 */}
      {scanResult && (
        <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="发现文档总数" value={`${globalStatusCounts.all} 篇`} />
          <Metric label="待迁移文档" value={`${globalStatusCounts.pending} 篇`} />
          <Metric label="已迁移完成" value={`${globalStatusCounts.migrated} 篇`} />
          <Metric label="已忽略文档" value={`${globalStatusCounts.skipped} 篇`} />
        </section>
      )}

      {/* 扫描与源配置卡片 */}
      <Card className="mb-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">网盘源与目标知识库</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            输入个人网盘文件夹链接与目标知识库，点击扫描获取文档清单与知识库多级目录
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* 源网盘文件夹 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground flex items-center justify-between">
                <span>源个人网盘文件夹链接 / Token *</span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  /drive/folder/fldcn...
                </span>
              </label>
              <input
                type="text"
                placeholder="粘贴个人网盘文件夹 URL 或 Token"
                value={folderUrl}
                onChange={(e) => setFolderUrl(e.target.value)}
                className={inputControlClass}
              />
            </div>

            {/* 目标知识库地址 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground flex items-center justify-between">
                <span>目标知识库地址 *</span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  /wiki/...
                </span>
              </label>
              <input
                type="text"
                placeholder="输入飞书知识库节点 URL 或 token"
                value={wikiUrl}
                onChange={(e) => setWikiUrl(e.target.value)}
                className={inputControlClass}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                className="rounded border-input text-foreground focus:ring-ring size-3.5"
              />
              <span>递归扫描所有子文件夹中的文档</span>
            </label>

            <Button
              onClick={handleScan}
              disabled={scanning}
              size="sm"
              className="gap-1.5"
            >
              {scanning ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>正在扫描中...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5" />
                  <span>扫描并获取知识库目录</span>
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 扫描结果：左侧网盘完整目录树 + 右侧文档清单双栏结构 */}
      {scanResult && (
        <div className="grid gap-6 lg:grid-cols-12 items-start min-h-[600px]">
          {/* 左侧：网盘目录树导航（包含所有目录与文件，对齐知识库归档） */}
          <aside className="lg:col-span-4 xl:col-span-3 space-y-4">
            <Card className="shadow-none sticky top-6 min-h-[580px] flex flex-col">
              <CardHeader className="border-b border-border py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <FolderOpen className="size-4 text-primary" />
                    <span>网盘目录树</span>
                  </CardTitle>
                  <span className="text-xs font-mono text-muted-foreground">
                    {driveTree.totalFolders} 个文件夹 · {driveTree.totalFiles} 篇文档
                  </span>
                </div>
                {/* 目录树搜索输入框 */}
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="搜索网盘文档或目录..."
                    value={treeSearch}
                    onChange={(e) => setTreeSearch(e.target.value)}
                  />
                </div>

                {/* 目录树状态筛选 Tabs */}
                <div className="mt-2.5 grid grid-cols-4 gap-1 rounded-lg bg-secondary/50 p-1 text-xs">
                  {(
                    [
                      { id: "all", label: "全部", count: globalStatusCounts.all },
                      { id: "pending", label: "待迁移", count: globalStatusCounts.pending },
                      { id: "skipped", label: "已忽略", count: globalStatusCounts.skipped },
                      { id: "migrated", label: "已迁移", count: globalStatusCounts.migrated },
                    ] as const
                  ).map((tab) => {
                    const active = treeFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setTreeFilter(tab.id);
                          setStatusTab(tab.id);
                        }}
                        className={`flex flex-col items-center justify-center rounded-md py-1 px-1 transition-all ${
                          active
                            ? "bg-card text-foreground shadow-xs font-semibold"
                            : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                        }`}
                        title={`仅在目录树中展示${tab.label}状态的文件夹与文档`}
                      >
                        <span className="text-[11px] font-medium leading-none">{tab.label}</span>
                        <span className="mt-1 font-mono text-[10px] opacity-70 leading-none">
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardHeader>
              <CardContent className="p-2 flex-1 min-h-[440px] max-h-[calc(100vh-320px)] overflow-y-auto">
                {/* 「全部文档」顶层节点 */}
                <div
                  onClick={() => setSelectedId("all")}
                  className={`flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                    selectedId === "all"
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderOpen className="size-4 text-primary shrink-0" />
                    <span className="truncate">
                      {treeFilter === "all"
                        ? `全部文档 (${driveTree.totalFiles})`
                        : treeFilter === "pending"
                        ? `全部待迁移 (${globalStatusCounts.pending})`
                        : treeFilter === "skipped"
                        ? `全部已忽略 (${globalStatusCounts.skipped})`
                        : `全部已迁移 (${globalStatusCounts.migrated})`}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                    {treeFilter === "all"
                      ? `${globalStatusCounts.migrated}/${globalStatusCounts.all}`
                      : `${
                          treeFilter === "pending"
                            ? globalStatusCounts.pending
                            : treeFilter === "skipped"
                            ? globalStatusCounts.skipped
                            : globalStatusCounts.migrated
                        } 篇`}
                  </span>
                </div>

                <div className="my-1.5 border-b border-border/60" />

                {/* 递归树节点列表（展示所有目录与文件） */}
                {driveTree.rootChildren.length === 0 ? (
                  <div className="py-16 text-center text-xs text-muted-foreground">
                    <p>网盘中暂无文档</p>
                  </div>
                ) : !hasAnyVisibleTreeNode ? (
                  <div className="flex flex-col items-center justify-center py-16 px-2 text-center text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">暂无匹配的目录或文档</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      当前筛选下没有可展示的内容
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setTreeFilter("all");
                        setStatusTab("all");
                      }}
                      className="mt-3 text-[11px] text-primary hover:underline cursor-pointer"
                    >
                      查看全部文档
                    </button>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {driveTree.rootChildren.map((node) => (
                      <DriveTreeNodeRow
                        key={node.id}
                        node={node}
                        searchKeyword={treeSearch}
                        treeFilter={treeFilter}
                        selectedId={selectedId}
                        onSelect={(id) => setSelectedId(id)}
                        itemStates={itemStates}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>

          {/* 右侧：文档清单与迁移管理 */}
          <section className="lg:col-span-8 xl:col-span-9 space-y-4 min-w-0">
            <Card className="shadow-none min-h-[580px] flex flex-col">
              <CardHeader className="flex-col gap-4 pb-3 border-b border-border">
                {/* 顶部范围与操作栏 */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {selectedId === "all"
                          ? "全部文档范围："
                          : selectedTreeNode?.isFolder
                          ? "当前目录范围："
                          : "单个文档："}
                      </span>
                      <Badge variant="outline" className="font-medium text-xs max-w-[320px] truncate">
                        {selectedTreeNode ? (
                          selectedTreeNode.isFolder ? (
                            <>
                              <Folder className={`size-3 mr-1 inline ${selectedFolderAllSkipped ? "text-muted-foreground/60" : "text-amber-500"}`} />
                              <span className="truncate">{selectedTreeNode.path || selectedTreeNode.name}</span>
                            </>
                          ) : (
                            <>
                              {getFileTypeIcon(selectedTreeNode.type)}
                              <span className="ml-1 truncate">{selectedTreeNode.name}</span>
                            </>
                          )
                        ) : (
                          "全部文档范围"
                        )}
                      </Badge>
                      {selectedFolderAllSkipped && (
                        <Badge variant="secondary" className="text-xs text-muted-foreground gap-1">
                          <EyeOff className="size-3" />
                          <span>整目录已忽略</span>
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-xs">
                        展示 {filteredFiles.length} / {scopeStatusCounts.all} 篇
                      </Badge>
                      {selectedTokens.size > 0 && (
                        <Badge variant="outline" className="text-xs">
                          已选 {selectedTokens.size} 项
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedTreeNode ? (
                        selectedTreeNode.isFolder ? (
                          selectedFolderAllSkipped ? (
                            `当前目录下包含 ${selectedTreeNode.counts?.total ?? 0} 篇文档，全部已处于忽略状态`
                          ) : (
                            `当前目录下包含 ${selectedTreeNode.counts?.total ?? 0} 篇文档（待迁移 ${selectedTreeNode.counts?.pending ?? 0} 篇，已迁移 ${selectedTreeNode.counts?.migrated ?? 0} 篇，已忽略 ${selectedTreeNode.counts?.skipped ?? 0} 篇）`
                          )
                        ) : (
                          `当前正在查看单篇文档，可在下方行内指定迁移路径并执行迁移或标记`
                        )
                      ) : (
                        `包含个人网盘内所有扫描到的文档共 ${globalStatusCounts.all} 篇，每行右侧支持独立指定目标路径`
                      )}
                    </p>
                  </div>

                  {/* 目录级别整体操作按钮（仅在选中目录节点时展示） */}
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedTreeNode && selectedTreeNode.isFolder && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleMigrateFolder(selectedTreeNode)}
                          disabled={isSubmittingTask || (selectedTreeNode.counts?.pending ?? 0) === 0}
                          className="border-amber-400/50 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-200 text-xs gap-1.5 font-medium"
                          title="一键将当前目录下所有待迁移文档提交至后台迁移"
                        >
                          {isSubmittingTask ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <FolderOpen className="size-3.5 text-amber-600" />
                          )}
                          <span>后台迁移当前目录 ({selectedTreeNode.counts?.pending ?? 0} 篇)</span>
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleIgnoreFolder(selectedTreeNode)}
                          disabled={isSubmittingTask || (selectedTreeNode.counts?.total ?? 0) === 0 || selectedFolderAllSkipped}
                          className="text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                          title={selectedFolderAllSkipped ? "当前目录下所有文档已全部忽略" : "将当前目录下的所有文档标记为已忽略"}
                        >
                          <EyeOff className="size-3.5" />
                          <span>{selectedFolderAllSkipped ? "已全部忽略" : "忽略当前目录"}</span>
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleResetFolder(selectedTreeNode)}
                          disabled={isSubmittingTask || (selectedTreeNode.counts?.total ?? 0) === 0 || (selectedTreeNode.counts?.skipped ?? 0) === 0}
                          className="text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                          title="将当前目录下的所有已忽略文档恢复为待迁移"
                        >
                          <RotateCcw className="size-3.5" />
                          <span>恢复当前目录</span>
                        </Button>
                      </>
                    )}

                    {/* 批量迁移勾选的文档 */}
                    <Button
                      size="sm"
                      onClick={handleExecuteBatchMigration}
                      disabled={isSubmittingTask || selectedTokens.size === 0}
                      className="gap-1.5 text-xs"
                    >
                      {isSubmittingTask ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>提交中...</span>
                        </>
                      ) : (
                        <>
                          <FolderSync className="size-3.5" />
                          <span>后台批量迁移 ({selectedTokens.size})</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* 搜索与类型过滤工具栏 */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="all">全部类型 ({scanResult.stats.totalFiles})</option>
                      {Object.entries(scanResult.stats.typeCounts).map(([type, count]) => {
                        if (type === "folder") return null;
                        return (
                          <option key={type} value={type}>
                            {getFileTypeLabel(type as DriveFileType)} ({count})
                          </option>
                        );
                      })}
                    </select>

                    <div className="relative w-52">
                      <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="搜索文档名称/路径..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>

              {/* 状态分类切换 Tab */}
              <div className="flex items-center gap-1 border-b border-border bg-secondary/30 px-4 py-2 text-xs">
                {(
                  [
                    { id: "all", label: "全部文档", count: scopeStatusCounts.all },
                    { id: "pending", label: "待迁移", count: scopeStatusCounts.pending },
                    { id: "migrated", label: "已迁移", count: scopeStatusCounts.migrated },
                    { id: "skipped", label: "已忽略", count: scopeStatusCounts.skipped },
                    { id: "failed", label: "迁移失败", count: scopeStatusCounts.failed },
                  ] as const
                ).map((tab) => {
                  const active = statusTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setStatusTab(tab.id)}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                        active
                          ? "bg-card text-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className="font-mono text-[11px] opacity-70">({tab.count})</span>
                    </button>
                  );
                })}
              </div>

              {/* 批量快捷操作栏（勾选单篇文档时出现） */}
              {selectedTokens.size > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 bg-secondary/20 px-4 py-2 text-xs border-b border-border">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground font-medium">
                      已勾选 <strong className="text-foreground">{selectedTokens.size}</strong> 篇：
                    </span>

                    {/* 快捷批量填充相同目标路径 */}
                    <div className="flex items-center gap-1.5 border-l border-border pl-2">
                      <span className="text-muted-foreground text-[11px]">快捷批量填充:</span>
                      <select
                        value={batchTarget.level1Token}
                        onChange={(e) => {
                          setBatchTarget({
                            level1Token: e.target.value,
                            level2Token: "",
                            level3Token: "",
                          });
                        }}
                        className="h-7 rounded border border-input bg-background px-2 text-xs outline-none"
                      >
                        <option value="">【根目录】</option>
                        {hierarchy.level1Nodes.map((n) => (
                          <option key={n.nodeToken} value={n.nodeToken}>
                            {n.title}
                          </option>
                        ))}
                      </select>

                      {batchTarget.level1Token &&
                        (hierarchy.level2Map.get(batchTarget.level1Token) || []).length > 0 && (
                          <select
                            value={batchTarget.level2Token}
                            onChange={(e) => {
                              setBatchTarget({
                                ...batchTarget,
                                level2Token: e.target.value,
                                level3Token: "",
                              });
                            }}
                            className="h-7 rounded border border-input bg-background px-2 text-xs outline-none"
                          >
                            <option value="">【二级目录】</option>
                            {(hierarchy.level2Map.get(batchTarget.level1Token) || []).map((n) => (
                              <option key={n.nodeToken} value={n.nodeToken}>
                                {n.title}
                              </option>
                            ))}
                          </select>
                        )}

                      {batchTarget.level2Token &&
                        (hierarchy.level3Map.get(batchTarget.level2Token) || []).length > 0 && (
                          <select
                            value={batchTarget.level3Token}
                            onChange={(e) => {
                              setBatchTarget({
                                ...batchTarget,
                                level3Token: e.target.value,
                              });
                            }}
                            className="h-7 rounded border border-input bg-background px-2 text-xs outline-none"
                          >
                            <option value="">【三级目录】</option>
                            {(hierarchy.level3Map.get(batchTarget.level2Token) || []).map((n) => (
                              <option key={n.nodeToken} value={n.nodeToken}>
                                {n.title}
                              </option>
                            ))}
                          </select>
                        )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleApplyBatchTargetToSelected}
                        className="h-7 text-xs px-2"
                      >
                        <span>应用到已选</span>
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBatchMarkAsMigrated}
                      className="h-7 text-xs gap-1"
                    >
                      <Check className="size-3 text-emerald-600" />
                      <span>批量标记已迁移</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBatchMarkAsSkipped}
                      className="h-7 text-xs gap-1"
                    >
                      <EyeOff className="size-3 text-muted-foreground" />
                      <span>批量标记忽略</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBatchResetToPending}
                      className="h-7 text-xs gap-1"
                    >
                      <RotateCcw className="size-3" />
                      <span>恢复待迁移</span>
                    </Button>
                  </div>
                </div>
              )}

              <CardContent className="p-0 flex-1 flex flex-col">
                <div className="overflow-x-auto w-full flex-1 min-h-[440px]">
                  {/* 使用 table-fixed 强制分配各列宽度，确保级联选择等所有列默认均在视口中可见 */}
                  <table className="w-full table-fixed text-left text-sm min-w-[760px]">
                    <thead className="border-b border-border bg-secondary/50 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="w-10 px-2 py-3 text-center">
                          <button
                            type="button"
                            onClick={toggleSelectAll}
                            className="flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer mx-auto"
                          >
                            {isAllSelected ? (
                              <CheckSquare className="size-4 text-foreground" />
                            ) : (
                              <Square className="size-4" />
                            )}
                          </button>
                        </th>
                        <th className="w-[38%] px-4 py-3 font-medium">文档信息</th>
                        <th className="w-[34%] px-4 py-3 font-medium">迁移目标路径（级联选择）</th>
                        <th className="w-[12%] px-2 py-3 font-medium text-center">状态</th>
                        <th className="w-[16%] px-3 py-3 font-medium text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredFiles.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-24 text-center text-sm text-muted-foreground">
                            {selectedId === "all"
                              ? "当前分类下暂无匹配文档"
                              : selectedTreeNode?.isFolder
                              ? "当前网盘目录下暂无匹配文档"
                              : "未找到该文档记录"}
                          </td>
                        </tr>
                      ) : (
                        filteredFiles.map((file) => {
                          const isSelected = selectedTokens.has(file.token);
                          const state = getFileState(file.token);
                          const target = getItemTarget(file.token);
                          const isRunning = runningTaskTokens.has(file.token);

                          const availableLevel2 = target.level1Token
                            ? hierarchy.level2Map.get(target.level1Token) || []
                            : [];
                          const availableLevel3 = target.level2Token
                            ? hierarchy.level3Map.get(target.level2Token) || []
                            : [];

                          return (
                            <tr
                              key={file.token}
                              className={`transition-colors hover:bg-secondary/40 ${
                                isSelected ? "bg-secondary/20" : ""
                              } ${isRunning ? "bg-primary/5" : ""}`}
                            >
                              {/* 勾选复选框 */}
                              <td className="w-10 px-2 py-3.5 align-top text-center">
                                <button
                                  type="button"
                                  disabled={isRunning || state.status === "migrated"}
                                  onClick={() => toggleSelectOne(file.token)}
                                  className={`mt-1 inline-flex items-center justify-center text-muted-foreground hover:text-foreground ${
                                    isRunning || state.status === "migrated" ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                                  }`}
                                  title={isRunning ? "该文档正在后台迁移中" : state.status === "migrated" ? "该文档已完成迁移" : undefined}
                                >
                                  {isSelected ? (
                                    <CheckSquare className="size-4 text-foreground" />
                                  ) : (
                                    <Square className="size-4" />
                                  )}
                                </button>
                              </td>

                              {/* 文档信息（通过 overflow-hidden 和 truncate 严格限制在自身列宽内） */}
                              <td className="px-4 py-3.5 align-top overflow-hidden">
                                <div className="space-y-1 max-w-full">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {getFileTypeIcon(file.type)}
                                    {file.url ? (
                                      <a
                                        href={file.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-medium text-foreground hover:underline truncate inline-flex items-center gap-1 min-w-0"
                                        title={file.name}
                                      >
                                        <span className="truncate">{file.name}</span>
                                        <ExternalLink className="size-3 text-muted-foreground shrink-0 opacity-60" />
                                      </a>
                                    ) : (
                                      <span className="font-medium text-foreground truncate min-w-0" title={file.name}>
                                        {file.name}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">
                                      {getFileTypeLabel(file.type)}
                                    </Badge>
                                    {file.isShortcut && (
                                      <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 shrink-0 bg-secondary/80 text-muted-foreground border border-border" title="源自飞书个人网盘快捷方式">
                                        快捷方式
                                      </Badge>
                                    )}
                                    {file.parentPath && (
                                      <span className="font-mono text-[11px] truncate max-w-[200px]" title={file.parentPath}>
                                        原路径: {file.parentPath}
                                      </span>
                                    )}
                                    {file.modifiedTime && (
                                      <span className="text-[11px] shrink-0">
                                        {new Date(Number(file.modifiedTime) * 1000).toLocaleDateString()}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* 迁移目标路径：每条记录右侧的级联下拉选择区（完全参考知识库归档） */}
                              <td className="px-4 py-3.5 align-top">
                                <div className="w-full space-y-1.5">
                                  {/* 级联 1: 一级目标目录 */}
                                  <select
                                    value={target.level1Token}
                                    disabled={state.status === "migrated"}
                                    onChange={(e) => handleItemLevel1Change(file.token, e.target.value)}
                                    className={selectClass}
                                    title="选择一级目录"
                                  >
                                    <option value="">【知识库根目录】</option>
                                    {hierarchy.level1Nodes.map((node) => (
                                      <option key={node.nodeToken} value={node.nodeToken}>
                                        {node.title}
                                      </option>
                                    ))}
                                  </select>

                                  {/* 级联 2: 二级目标目录（当选了一级目录且有二级子项时动态出现） */}
                                  {target.level1Token && availableLevel2.length > 0 && (
                                    <select
                                      value={target.level2Token}
                                      disabled={state.status === "migrated"}
                                      onChange={(e) => handleItemLevel2Change(file.token, e.target.value)}
                                      className={selectClass}
                                      title="选择二级目录"
                                    >
                                      <option value="">无（直接存入一级目录）</option>
                                      {availableLevel2.map((node) => (
                                        <option key={node.nodeToken} value={node.nodeToken}>
                                          {node.title}
                                        </option>
                                      ))}
                                    </select>
                                  )}

                                  {/* 级联 3: 三级目标目录（当选了二级目录且有三级子项时动态出现） */}
                                  {target.level2Token && availableLevel3.length > 0 && (
                                    <select
                                      value={target.level3Token}
                                      disabled={state.status === "migrated"}
                                      onChange={(e) => handleItemLevel3Change(file.token, e.target.value)}
                                      className={selectClass}
                                      title="选择三级目录"
                                    >
                                      <option value="">无（直接存入二级目录）</option>
                                      {availableLevel3.map((node) => (
                                        <option key={node.nodeToken} value={node.nodeToken}>
                                          {node.title}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </td>

                              {/* 状态徽章 */}
                              <td className="px-2 py-3.5 align-top text-center">
                                {isRunning ? (
                                  <Badge variant="outline" className="text-xs text-primary border-primary/30 gap-1 animate-pulse">
                                    <Loader2 className="size-3 animate-spin" />
                                    后台迁移中
                                  </Badge>
                                ) : state.status === "migrated" ? (
                                  <div className="space-y-1">
                                    <Badge variant="success" className="text-xs gap-1">
                                      <CheckCircle2 className="size-3" />
                                      {state.manual ? "已标记" : "已迁移"}
                                    </Badge>
                                    {(state.url || file.wikiUrl) && (
                                      <div>
                                        <a
                                          href={state.url || file.wikiUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                                        >
                                          知识库中查看
                                          <ExternalLink className="size-3" />
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                ) : state.status === "skipped" ? (
                                  <Badge variant="secondary" className="text-xs text-muted-foreground">
                                    已忽略
                                  </Badge>
                                ) : state.status === "failed" ? (
                                  <div className="space-y-1">
                                    <Badge variant="outline" className="text-xs text-destructive border-destructive/30">
                                      迁移失败
                                    </Badge>
                                    {state.error && (
                                      <p title={state.error} className="text-[11px] text-destructive truncate max-w-[100px]">
                                        {state.error}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <Badge variant="outline" className="text-xs text-muted-foreground font-normal">
                                    待迁移
                                  </Badge>
                                )}
                              </td>

                              {/* 操作列 */}
                              <td className="px-3 py-3.5 align-top text-right">
                                <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                  {isRunning ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled
                                      className="h-7 text-xs px-2 gap-1 text-primary opacity-80"
                                      title="该文档正在后台迁移中"
                                    >
                                      <Loader2 className="size-3 animate-spin" />
                                      <span>迁移中...</span>
                                    </Button>
                                  ) : state.status === "pending" || state.status === "failed" ? (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={isSubmittingTask}
                                        onClick={() => void handleMigrateSingle(file)}
                                        className="h-7 text-xs px-2 gap-1"
                                        title="提交此单篇文档至后台迁移到右侧所选目录"
                                      >
                                        <Send className="size-3" />
                                        <span>迁移</span>
                                      </Button>
                                      <button
                                        type="button"
                                        onClick={() => handleMarkAsMigrated(file.token, file.name)}
                                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                                        title="手动标记此文档已完成迁移"
                                      >
                                        <Check className="size-3" />
                                        <span>完成</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleMarkAsSkipped(file.token, file.name)}
                                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors cursor-pointer"
                                        title="忽略此文档，不进行迁移"
                                      >
                                        <EyeOff className="size-3" />
                                        <span>忽略</span>
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleResetToPending(file.token, file.name)}
                                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors cursor-pointer"
                                      title="恢复为待迁移状态"
                                    >
                                      <RotateCcw className="size-3" />
                                      <span>恢复</span>
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      )}

      {/* 底部常驻悬浮进度条（当有后台任务正在进行且抽屉未打开时展示） */}
      {hasRunningTasks && latestRunningTask && !isTasksSheetOpen && (
        <aside
          role="region"
          aria-label="后台任务进度"
          className="fixed bottom-6 right-6 z-40 flex items-center gap-3.5 rounded-xl border border-primary/20 bg-background/95 p-3.5 shadow-2xl backdrop-blur-md ring-1 ring-black/5 dark:ring-white/10"
        >
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Loader2 className="size-4 animate-spin" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground truncate max-w-[200px]">
                {latestRunningTask.name}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground">
                {latestRunningTask.progress.completed}/{latestRunningTask.progress.total}
              </span>
            </div>
            {latestRunningTask.currentFile && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                正在处理: {latestRunningTask.currentFile}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="default"
            onClick={() => setIsTasksSheetOpen(true)}
            className="ml-2 h-7 px-2.5 text-xs gap-1"
          >
            <span>查看任务</span>
          </Button>
        </aside>
      )}

      {/* 后台任务管理抽屉 */}
      <DriveMigrationTasksSheet
        open={isTasksSheetOpen}
        onClose={() => setIsTasksSheetOpen(false)}
        tasks={tasks}
        loading={tasksLoading}
        onClearCompleted={handleClearCompletedTasks}
        onRefresh={fetchTasks}
      />
    </div>
  );
}
