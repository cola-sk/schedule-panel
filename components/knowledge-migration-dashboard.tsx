"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  FolderSync,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  isValidCategory,
  type KnowledgeDirectory,
  type KnowledgeMigrationItem,
  type KnowledgeMigrationTask,
  type MigrationStatus,
  type TaskMigrationStats,
  type TaskNotifyConfig,
  type WikiTreeNode,
} from "@/lib/knowledge-migration/types";
import { KnowledgeMigrationStatsPanel } from "./knowledge-migration-stats-panel";

type Taxonomy = Record<string, readonly string[]>;

type TaskSummary = {
  id: string;
  name: string;
  description?: string;
  config: KnowledgeMigrationTask["config"] & { confluenceSecretConfigured?: boolean };
  overview: {
    total: number;
    counts: Record<MigrationStatus, number>;
    jobs: Array<{ id: string; status: string; total: number; processed: number; failed: number; startedAt: string }>;
  };
  treeNodeCount: number;
};

type TaskDetailResponse = {
  task: {
    id: string;
    name: string;
    description?: string;
    config: KnowledgeMigrationTask["config"] & { confluenceSecretConfigured?: boolean };
    tree: WikiTreeNode[];
    treeUpdatedAt?: string;
    targetDirectories: KnowledgeDirectory[];
    taxonomy: Taxonomy;
    overview: {
      total: number;
      counts: Record<MigrationStatus, number>;
      jobs: Array<{ id: string; status: string; total: number; processed: number; failed: number; startedAt: string }>;
    };
    notifySchedule?: Pick<TaskNotifyConfig, "enabled" | "dayOfWeek" | "time" | "lastSentAt"> & { nextRunAt?: string };
  };
  currentNodeItem?: KnowledgeMigrationItem;
  items: KnowledgeMigrationItem[];
};

type ItemDraft = {
  title: string;
  primaryCategory: string;
  secondaryCategory: string;
};

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring";

const statuses: Array<{ value: MigrationStatus; label: string; variant: "outline" | "success" | "warning" | "secondary" }> = [
  { value: "discovered", label: "已发现", variant: "secondary" },
  { value: "pending_review", label: "待审核", variant: "warning" },
  { value: "approved", label: "待迁移", variant: "warning" },
  { value: "migrating", label: "迁移中", variant: "warning" },
  { value: "migrated", label: "已迁移", variant: "success" },
  { value: "failed", label: "失败", variant: "outline" },
  { value: "skipped", label: "已忽略", variant: "secondary" },
];

function statusMeta(status: MigrationStatus) {
  return statuses.find((item) => item.value === status) || statuses[0];
}

function date(value?: string) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Shanghai",
        hour12: false,
      }).format(new Date(value))
    : "—";
}

async function parseResponse<T = any>(res: Response, fallback = "请求失败"): Promise<T> {
  const text = await res.text();
  if (!text) {
    if (!res.ok) throw new Error(`${fallback} (${res.status} ${res.statusText || ""})`.trim());
    return {} as T;
  }
  try {
    const data = JSON.parse(text) as T & { error?: string };
    if (!res.ok) throw new Error(data.error || `${fallback} (${res.status})`);
    return data;
  } catch (err) {
    if (err instanceof Error && !err.message.includes("JSON")) throw err;
    if (!res.ok) throw new Error(`${fallback} (${res.status})：${text.slice(0, 150)}`);
    throw new Error(`无法解析服务端响应：${text.slice(0, 150)}`);
  }
}

export function KnowledgeMigrationDashboard() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>("");
  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse>();

  const [loading, setLoading] = useState(true);
  const [taskLoading, setTaskLoading] = useState(false);
  const [syncingWikiTree, setSyncingWikiTree] = useState(false);
  const [syncingDirectories, setSyncingDirectories] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [directoryMigrating, setDirectoryMigrating] = useState(false);
  const [showDirectoryModal, setShowDirectoryModal] = useState(false);

  // 视图模式：工作台 vs 周度对比统计
  const [viewMode, setViewModeState] = useState<"workbench" | "stats">("workbench");

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem("km_view_mode") as "workbench" | "stats";
      if (savedMode === "workbench" || savedMode === "stats") {
        setViewModeState(savedMode);
      }
    } catch {
      // ignore
    }
  }, []);

  const setViewMode = (mode: "workbench" | "stats") => {
    setViewModeState(mode);
    try {
      localStorage.setItem("km_view_mode", mode);
    } catch {
      // ignore
    }
  };
  const [statsData, setStatsData] = useState<TaskMigrationStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // 选中的 Wiki 目录树节点（"all" 为全部文档）
  const [selectedWikiId, setSelectedWikiId] = useState<string>("all");
  // 文档视图选项卡："all" | "pending" | "migrated" | "failed"
  const [activeTab, setActiveTab] = useState<"all" | "pending" | "migrated" | "failed">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [treeSearch, setTreeSearch] = useState<string>("");

  const [filters, setFilters] = useState({
    keyword: "",
    status: "",
    primaryCategory: "",
    secondaryCategory: "",
    createdBy: "",
    updatedBy: "",
  });
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});

  const [showTaskModal, setShowTaskModal] = useState(false);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    if (!notice) return;

    noticeTimerRef.current = setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = undefined;
    }, 5000);

    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, [notice]);

  // 加载任务列表
  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-migrations/tasks", { cache: "no-store" });
      const data = await parseResponse<{ tasks?: TaskSummary[] }>(res, "获取任务列表失败");
      const list = data.tasks || [];
      setTasks(list);
      if (list.length > 0 && !activeTaskId) {
        const queryTaskId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("taskId") : null;
        const matched = queryTaskId && list.some((t) => t.id === queryTaskId);
        setActiveTaskId(matched ? queryTaskId! : list[0].id);
      }
      return list;
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "获取任务列表失败" });
      return [];
    }
  }, [activeTaskId]);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const selectedWikiIdRef = useRef(selectedWikiId);
  selectedWikiIdRef.current = selectedWikiId;

  // 3. 加载选中的任务详情与文档
  const loadTaskDetail = useCallback(
    async (
      taskId: string,
      queryFilters?: typeof filters,
      tab?: "all" | "pending" | "migrated" | "failed",
      wikiId?: string,
      options?: { silent?: boolean }
    ) => {
      if (!taskId) return;
      if (!options?.silent) {
        setTaskLoading(true);
      }
      try {
        const actualFilters = queryFilters ?? filtersRef.current;
        const actualTab = tab ?? activeTabRef.current;
        const actualWikiId = wikiId ?? selectedWikiIdRef.current;

        const params = new URLSearchParams();
        if (actualWikiId && actualWikiId !== "all") params.set("selectedWikiId", actualWikiId);
        if (actualTab && actualTab !== "all") params.set("tab", actualTab);
        Object.entries(actualFilters).forEach(([key, val]) => {
          if (val) params.set(key, String(val));
        });

        const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}?${params.toString()}`, { cache: "no-store" });
        const data = await parseResponse<TaskDetailResponse>(res, "获取任务详情失败");
        setTaskDetail(data);
        return data;
      } catch (error) {
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "加载任务文档失败" });
      } finally {
        if (!options?.silent) {
          setTaskLoading(false);
        }
      }
    },
    []
  );

  // 初始化
  useEffect(() => {
    void (async () => {
      await loadTasks();
      setLoading(false);
    })();
  }, [loadTasks]);

  // 切换任务时加载详情 (仅在 activeTaskId 真正切换时重置为全选)
  const prevTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeTaskId && activeTaskId !== prevTaskIdRef.current) {
      prevTaskIdRef.current = activeTaskId;
      setSelectedWikiId("all");
      setSelectedIds([]);
      setItemDrafts({});
      void loadTaskDetail(activeTaskId, filtersRef.current, activeTabRef.current, "all");
      void loadTaskStats(activeTaskId);
    }
  }, [activeTaskId, loadTaskDetail]);

  const loadTaskStats = useCallback(async (taskId: string) => {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/stats`, { cache: "no-store" });
      const data = await parseResponse<{ stats: TaskMigrationStats | null }>(res, "获取统计数据失败");
      setStatsData(data.stats);
      return data.stats;
    } catch {
      // 容错
      return null;
    }
  }, []);

  const refreshTaskStats = useCallback(async (taskId: string) => {
    if (!taskId) return;
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/stats`, { method: "POST" });
      const data = await parseResponse<{ stats: TaskMigrationStats }>(res, "生成统计数据失败");
      setStatsData(data.stats);
      setNotice({ tone: "success", message: "飞书全量文档与周度统计已成功生成！" });
      return data.stats;
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "扫描生成统计失败" });
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // 扫描中轮询
  const running = taskDetail?.task.overview.jobs.some((job) => job.status === "running") || false;
  useEffect(() => {
    if (!running || !activeTaskId) return;
    const timer = window.setInterval(() => void loadTaskDetail(activeTaskId).catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [activeTaskId, loadTaskDetail, running]);

  // 快捷操作
  async function request<T = any>(url: string, options: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    return parseResponse<T>(response, "操作失败");
  }

  function applyFilters(nextFilters: typeof filters) {
    setFilters(nextFilters);
    if (activeTaskId) {
      void loadTaskDetail(activeTaskId, nextFilters, activeTab, selectedWikiId);
    }
  }

  // 同步 Wiki 目录树
  async function handleSyncWikiTree() {
    if (!activeTaskId) return;
    setSyncingWikiTree(true);
    try {
      await request(`/api/knowledge-migrations/tasks/${activeTaskId}/sync-tree`, { method: "POST" });
      await loadTaskDetail(activeTaskId);
      await loadTasks();
      setNotice({ tone: "success", message: "Wiki 目录树已同步更新！" });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "同步 Wiki 目录树失败" });
    } finally {
      setSyncingWikiTree(false);
    }
  }

  // 同步飞书目标一二级目录
  async function handleSyncDirectories() {
    if (!activeTaskId) return;
    setSyncingDirectories(true);
    try {
      await request(`/api/knowledge-migrations/tasks/${activeTaskId}/sync-directories`, { method: "POST" });
      await loadTaskDetail(activeTaskId);
      await loadTasks();
      setNotice({ tone: "success", message: "飞书目标目录已同步更新！" });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "获取飞书目标目录失败" });
    } finally {
      setSyncingDirectories(false);
    }
  }

  // 启动按目录或全量扫描并分类
  async function handleScan() {
    if (!activeTaskId) return;
    setScanning(true);
    try {
      const scopeBody = selectedWikiId && selectedWikiId !== "all" ? { selectedWikiId } : {};
      await request(`/api/knowledge-migrations/tasks/${activeTaskId}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scopeBody),
      });
      await loadTaskDetail(activeTaskId);
      await loadTasks();
      setNotice({
        tone: "success",
        message:
          selectedWikiId === "all"
            ? "已启动全量正文提取与模型分类扫描任务，进度将自动刷新。"
            : `已启动当前目录维度（共 ${scopeTotal} 篇）的模型分类扫描任务，进度将自动刷新。`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "启动扫描失败" });
    } finally {
      setScanning(false);
    }
  }

  // 批量迁移选中的文档
  async function handlePublish() {
    if (!activeTaskId || !selectedIds.length) return;

    // 检查是否有仅选了一级目录、未选二级目录的文档，并弹出二次确认
    const primaryOnlyCount = selectedIds.filter((id) => {
      const draft = itemDrafts[id];
      const item = taskDetail?.items.find((it) => it.wikiId === id);
      const primary = draft?.primaryCategory !== undefined ? draft.primaryCategory : (item?.finalPrimaryCategory || item?.suggestion?.primaryCategory);
      const secondary = draft?.secondaryCategory !== undefined ? draft.secondaryCategory : (item?.finalSecondaryCategory || item?.suggestion?.secondaryCategory);
      return primary && !secondary;
    }).length;

    if (primaryOnlyCount > 0) {
      if (
        !window.confirm(
          `选中的 ${selectedIds.length} 篇文档中有 ${primaryOnlyCount} 篇未指定二级目录，将直接存放在对应的一级目录下。确定要继续迁移吗？`
        )
      ) {
        return;
      }
    }

    setPublishing(true);
    try {
      // 行内编辑先保存在本地草稿中。批量发布前统一落库，避免仍使用
      // 大模型分类时写入的旧 finalPrimaryCategory/finalSecondaryCategory。
      await Promise.all(
        selectedIds
          .filter((wikiId) => itemDrafts[wikiId])
          .map((wikiId) =>
            request(`/api/knowledge-migrations/tasks/${activeTaskId}/items/${encodeURIComponent(wikiId)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...itemDrafts[wikiId], action: "save" }),
            })
          )
      );
      const res = await request(`/api/knowledge-migrations/tasks/${activeTaskId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wikiIds: selectedIds }),
      });
      await loadTaskDetail(activeTaskId);
      await loadTasks();
      setSelectedIds([]);
      setItemDrafts({});
      setNotice({
        tone: res.result.failed ? "error" : "success",
        message: `迁移完成：成功 ${res.result.migrated} 篇，需重新处理 ${res.result.needsReview} 篇，失败 ${res.result.failed} 篇。`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "发布迁移失败" });
    } finally {
      setPublishing(false);
    }
  }

  async function handleDirectoryMigration(primary: string, secondary: string, includeRoot: boolean) {
    if (!activeTaskId || selectedWikiId === "all" || !primary) return;
    setDirectoryMigrating(true);
    try {
      const res = await request<{
        result: { migrated: number; excluded: number; skipped: number; needsReview: number; failed: number; blocked: number };
      }>(`/api/knowledge-migrations/tasks/${activeTaskId}/migrate-directory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootWikiId: selectedWikiId,
          primaryCategory: primary,
          secondaryCategory: secondary || undefined,
          includeRoot,
        }),
      });
      await Promise.all([loadTaskDetail(activeTaskId), loadTasks()]);
      setSelectedIds([]);
      const result = res.result;
      setNotice({
        tone: result.failed || result.needsReview ? "error" : "success",
        message: `目录迁移完成：新建 ${result.migrated} 篇，排除已迁移 ${result.excluded} 篇，忽略 ${result.skipped} 篇，失败 ${result.failed} 篇${
          result.blocked ? `，未继续处理 ${result.blocked} 篇` : ""
        }。`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "目录整体迁移失败" });
    } finally {
      setDirectoryMigrating(false);
    }
  }

  // 删除任务
  async function handleDeleteTask(taskId: string) {
    if (!confirm("确定要删除该归档任务吗？任务下的所有归档状态和记录将被移除。")) return;
    try {
      await request(`/api/knowledge-migrations/tasks/${taskId}`, { method: "DELETE" });
      const remainingTasks = await loadTasks();
      if (activeTaskId === taskId) {
        setActiveTaskId(remainingTasks[0]?.id || "");
      }
      setNotice({ tone: "success", message: "任务已删除。" });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "删除失败" });
    }
  }

  const currentTask = taskDetail?.task;
  const hasTree = (currentTask?.tree?.length || 0) > 0;
  const hasDirectories = Object.keys(currentTask?.taxonomy || {}).length > 0;
  const overallProgress = useMemo(() => {
    const counts = currentTask?.overview.counts;
    const ignored = counts?.skipped || 0;
    return {
      migrated: counts?.migrated || 0,
      total: Math.max(0, (currentTask?.overview.total || 0) - ignored),
      ignored,
    };
  }, [currentTask?.overview]);

  // 寻找选中的目录树节点面包屑
  const selectedBreadcrumbs = useMemo(() => {
    if (!currentTask?.tree || selectedWikiId === "all") return "全部文档";
    function findPath(nodes: WikiTreeNode[], id: string, prefix: string[] = []): string[] | null {
      for (const n of nodes) {
        const next = [...prefix, n.title];
        if (String(n.id) === String(id)) return next;
        if (n.children?.length) {
          const found = findPath(n.children, id, next);
          if (found) return found;
        }
      }
      return null;
    }
    const path = findPath(currentTask.tree, selectedWikiId);
    return path ? path.join(" / ") : "选中分支";
  }, [currentTask?.tree, selectedWikiId]);

  const selectedDirectory = useMemo(() => {
    function findNode(nodes: WikiTreeNode[], id: string): WikiTreeNode | undefined {
      for (const node of nodes) {
        if (String(node.id) === String(id)) return node;
        const found = findNode(node.children || [], id);
        if (found) return found;
      }
    }
    if (!currentTask?.tree || selectedWikiId === "all") return undefined;
    const node = findNode(currentTask.tree, selectedWikiId);
    return node?.children?.length ? node : undefined;
  }, [currentTask?.tree, selectedWikiId]);

  // 计算当前作用域（全量 vs 单一目录节点）下的子文档统计
  const scopeCounts = useMemo(() => {
    if (selectedWikiId === "all") {
      return (
        currentTask?.overview.counts || {
          discovered: 0,
          pending_review: 0,
          approved: 0,
          migrating: 0,
          migrated: 0,
          failed: 0,
          skipped: 0,
        }
      );
    }
    const items = taskDetail?.items || [];
    return items.reduce<Record<MigrationStatus, number>>(
      (acc, it) => {
        const s = it.status || "discovered";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      },
      { discovered: 0, pending_review: 0, approved: 0, migrating: 0, migrated: 0, failed: 0, skipped: 0 }
    );
  }, [selectedWikiId, currentTask?.overview.counts, taskDetail?.items]);

  const scopeTotal = selectedWikiId === "all" ? (currentTask?.overview.total || 0) : (taskDetail?.items?.length || 0);
  const directoryTotal = selectedDirectory
    ? getTreeNodeProgress(selectedDirectory).total - getTreeNodeProgress(selectedDirectory).migrated
    : 0;

  // 当前范围内已具备有效迁移路径、可直接迁移的文档。
  const validCategorizedItems = useMemo(() => {
    if (!taskDetail?.items || !currentTask?.taxonomy) return [];
    return taskDetail.items.filter((item) => {
      // 已迁移、迁移中和忽略项均不参与批量迁移。
      if (["migrated", "migrating", "skipped"].includes(item.status)) return false;
      // 批量发布只认已经写入的最终分类，不再回退到模型建议。
      const primary = item.finalPrimaryCategory;
      const secondary = item.finalSecondaryCategory;
      return isValidCategory(primary, secondary, currentTask.taxonomy);
    });
  }, [taskDetail?.items, currentTask?.taxonomy]);

  const validCategorizedIds = useMemo(() => validCategorizedItems.map((i) => i.wikiId), [validCategorizedItems]);
  const isAllValidSelected =
    validCategorizedIds.length > 0 && validCategorizedIds.every((id) => selectedIds.includes(id));

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1700px]">
        {/* 顶部全局导航栏 */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">知识库归档</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              多 Wiki 任务独立配置，左侧 Wiki 目录树精准溯源，按 Wiki 唯一 ID（pageId）审核与记录迁移状态。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* 新建任务 */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsEditingTask(false);
                setShowTaskModal(true);
              }}
            >
              <Plus className="size-3.5" />
              新建归档任务
            </Button>
          </div>
        </div>

        {/* 顶部 Toast 提示 */}
        {notice && (
          <div
            className={`fixed left-1/2 top-4 z-[100] flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-lg ${
              notice.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
            role="alert"
            aria-live={notice.tone === "error" ? "assertive" : "polite"}
          >
            {notice.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
            )}
            <span className="flex-1">{notice.message}</span>
            <button
              type="button"
              className="text-xs font-medium opacity-70 hover:opacity-100"
              onClick={() => setNotice(null)}
            >
              关闭
            </button>
          </div>
        )}

        {/* 任务选择器与操作栏 */}
        {tasks.length > 0 ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-muted-foreground">当前任务：</label>
              <select
                className={`${inputClass} w-auto min-w-48 font-medium`}
                value={activeTaskId}
                onChange={(e) => setActiveTaskId(e.target.value)}
              >
                {(tasks || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.overview?.total ?? 0} 篇)
                  </option>
                ))}
              </select>

              {currentTask && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsEditingTask(true);
                    setShowTaskModal(true);
                  }}
                  title="修改 Confluence 来源或目标飞书配置"
                >
                  <Settings2 className="size-3.5" />
                  任务配置
                </Button>
              )}

              {tasks.length > 1 && currentTask && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => void handleDeleteTask(currentTask.id)}
                  title="删除当前任务"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleSyncWikiTree()}
                disabled={syncingWikiTree || syncingDirectories || running}
                title="从 Confluence 重新读取页面树结构并更新左侧树，不调用大模型"
              >
                {syncingWikiTree ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                更新 Wiki 目录树
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleSyncDirectories()}
                disabled={syncingWikiTree || syncingDirectories || running}
                title="从目标飞书知识库拉取最新的一级/二级分类目录并对齐飞书文档状态"
              >
                {syncingDirectories ? <Loader2 className="size-3.5 animate-spin" /> : <FolderSync className="size-3.5" />}
                获取飞书目标目录
              </Button>
            </div>
          </div>
        ) : (
          <div className="mb-6 rounded-xl border border-dashed border-border p-8 text-center">
            <FilePlus2 className="mx-auto size-10 text-muted-foreground" />
            <h3 className="mt-3 text-base font-semibold">暂无归档任务</h3>
            <p className="mt-1 text-sm text-muted-foreground">创建首个归档任务并配置 Confluence 来源与飞书目标即可开始。</p>
            <Button
              size="sm"
              className="mt-4"
              onClick={() => {
                setIsEditingTask(false);
                setShowTaskModal(true);
              }}
            >
              <Plus className="size-3.5" />
              立即创建任务
            </Button>
          </div>
        )}

        {/* 顶部视图模式切换 Tab */}
        {currentTask && (
          <div className="mb-6 flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode("workbench")}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all ${
                  viewMode === "workbench"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Folder className="size-3.5" />
                <span>归档工作台</span>
                <span className="font-mono text-[10px] opacity-80">({currentTask.overview?.total || 0} 篇)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setViewMode("stats");
                  if (activeTaskId) void loadTaskStats(activeTaskId);
                }}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all ${
                  viewMode === "stats"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <BarChart3 className="size-3.5" />
                <span>全量周度对比统计</span>
                {statsData ? (
                  <Badge
                    variant="secondary"
                    className={`${
                      viewMode === "stats"
                        ? "bg-white/20 text-white hover:bg-white/30"
                        : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                    } text-[10px] px-1.5 py-0 font-normal`}
                  >
                    非 Wiki: {statsData.totalNonWikiDocs} 篇 (全量 {statsData.totalFeishuDocs})
                  </Badge>
                ) : (
                  <span className="inline-block size-2 rounded-full bg-indigo-500 animate-pulse" title="点击查看全量统计" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* 模式 1：全量周度对比统计面板 */}
        {currentTask && viewMode === "stats" && (
          <KnowledgeMigrationStatsPanel
            taskId={currentTask.id}
            taskName={currentTask.name}
            stats={statsData}
            onRefresh={() => refreshTaskStats(currentTask.id)}
            loading={statsLoading}
            notifySchedule={currentTask.notifySchedule}
            onNotifyConfigSaved={() => loadTaskDetail(currentTask.id, undefined, undefined, undefined, { silent: true })}
          />
        )}

        {/* 模式 2：归档工作台 */}
        {currentTask && viewMode === "workbench" && (
          <>
            {/* 概览数据卡片 */}
            <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {statuses.map((status) => (
                <Card key={status.value} className="shadow-none">
                  <CardContent className="p-3.5">
                    <p className="text-xs text-muted-foreground">{status.label}</p>
                    <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                      {currentTask.overview?.counts?.[status.value] || 0}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </section>

            {/* 两栏工作台：左侧 Wiki 目录树，右侧待迁移/已迁移文档清单 */}
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              {/* 左侧：要迁移的 Wiki 目录树 */}
              <aside className="lg:col-span-4 xl:col-span-3">
                <Card className="shadow-none">
                <CardHeader className="border-b border-border p-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                      <Folder className="size-4 text-amber-500" />
                      要迁移的 Wiki 目录树
                    </CardTitle>
                    <div className="text-right text-xs text-muted-foreground">
                      <p className="font-mono font-semibold text-foreground">
                        {overallProgress.migrated}/{overallProgress.total}
                      </p>
                      <p>
                        已迁移 / 应迁移
                        {overallProgress.ignored > 0 && ` · 忽略 ${overallProgress.ignored} 篇`}
                      </p>
                    </div>
                  </div>

                  {/* 树内快捷搜索 */}
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                    <input
                      className={`${inputClass} h-8 pl-8 text-xs`}
                      value={treeSearch}
                      onChange={(e) => setTreeSearch(e.target.value)}
                      placeholder="搜索 Wiki 目录名称…"
                    />
                  </div>
                </CardHeader>

                <CardContent className="max-h-[750px] overflow-y-auto p-2">
                  {/* 全部文档快速入口 */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedWikiId("all");
                      void loadTaskDetail(currentTask.id, filters, activeTab, "all");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedWikiId("all")}
                    className={`flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                      selectedWikiId === "all"
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-foreground hover:bg-secondary/60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FolderOpen className="size-4 text-primary" />
                      <span>全部文档 ({currentTask.overview.total})</span>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {overallProgress.migrated}/{overallProgress.total}
                    </span>
                  </div>

                  <div className="my-1.5 border-b border-border/60" />

                  {/* 递归树组件 */}
                  {!hasTree ? (
                    <div className="py-12 text-center text-xs text-muted-foreground">
                      <p>尚未同步 Wiki 目录树结构</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 text-xs"
                        disabled={syncingWikiTree}
                        onClick={() => void handleSyncWikiTree()}
                      >
                        {syncingWikiTree && <Loader2 className="size-3 animate-spin mr-1.5" />}
                        立即同步 Wiki 树
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {(currentTask?.tree || []).map((node) => (
                        <WikiTreeNodeRow
                          key={node.id}
                          node={node}
                          searchKeyword={treeSearch}
                          selectedWikiId={selectedWikiId}
                          onSelect={(id) => {
                            setSelectedWikiId(id);
                            setSelectedIds([]);
                            void loadTaskDetail(currentTask.id, filters, activeTab, id);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>

            {/* 右侧：知识库文档清单与迁移状态 */}
            <section className="lg:col-span-8 xl:col-span-9 space-y-4">
              <Card className="shadow-none">
                <CardHeader className="border-b border-border py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {selectedWikiId === "all" ? "全部文档范围：" : "当前目录范围："}
                        </span>
                        <Badge variant="outline" className="font-medium">
                          {selectedBreadcrumbs}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedWikiId === "all"
                          ? "按 Wiki 唯一 ID 记录迁移状态；选择具备有效迁移路径的文档后即可直接写入飞书知识库。"
                          : `包含当前目录文档与下级子文档共 ${scopeTotal} 篇（目录文档置顶排在第 1 位）。`}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-amber-400/50 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-200 font-medium"
                        onClick={() => void handleScan()}
                        disabled={scanning || running}
                        title={
                          selectedWikiId === "all"
                            ? "全量递归提取页面正文摘录并调用全局大模型推荐迁移分类"
                            : `仅针对当前选中的目录分支（共 ${scopeTotal} 篇）提取正文摘录并调用大模型推荐分类`
                        }
                      >
                        {scanning || running ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5 text-amber-500" />
                        )}
                        {running
                          ? "分类扫描中…"
                          : selectedWikiId === "all"
                          ? "全量扫描并分类"
                          : `扫描当前目录 (${scopeTotal} 篇)`}
                      </Button>

                      {selectedDirectory && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowDirectoryModal(true)}
                          disabled={directoryMigrating || running}
                          title="将当前目录整体（包含子目录层级结构）迁移至指定的飞书二级目录下"
                        >
                          {directoryMigrating ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <FolderOpen className="size-3.5 text-blue-500" />
                          )}
                          {directoryMigrating ? "整体迁移中…" : `整体迁移目录 (${directoryTotal} 篇)`}
                        </Button>
                      )}

                      <Button
                        size="sm"
                        onClick={() => void handlePublish()}
                        disabled={!selectedIds.length || publishing}
                        title="迁移左侧复选框选中的文档到飞书知识库"
                      >
                        {publishing ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <FilePlus2 className="size-3.5" />
                        )}
                        {publishing ? "写入飞书中…" : `批量迁移 (${selectedIds.length})`}
                      </Button>
                    </div>
                  </div>

                  {/* 状态分类选项卡 (全部 / 待迁移 / 已迁移 / 异常与跳过) */}
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-border pb-3">
                    {[
                      { key: "all", label: "全部", count: scopeTotal },
                      {
                        key: "pending",
                        label: "待迁移",
                        count:
                          (scopeCounts.discovered || 0) +
                          (scopeCounts.pending_review || 0) +
                          (scopeCounts.approved || 0),
                      },
                      { key: "migrated", label: "已迁移", count: scopeCounts.migrated || 0 },
                      {
                        key: "failed",
                        label: "失败/忽略",
                        count:
                          (scopeCounts.failed || 0) +
                          (scopeCounts.skipped || 0),
                      },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => {
                          const nextTab = tab.key as typeof activeTab;
                          setActiveTab(nextTab);
                          void loadTaskDetail(currentTask.id, filters, nextTab, selectedWikiId);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          activeTab === tab.key
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "bg-secondary/60 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className="font-mono text-[10px] opacity-80">({tab.count})</span>
                      </button>
                    ))}
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  {/* 未获取飞书目录提示条 */}
                  {!hasDirectories && (
                    <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50/60 px-4 py-2 text-xs text-amber-900 dark:border-amber-950 dark:bg-amber-950/20 dark:text-amber-200">
                      <div className="flex items-center gap-2">
                        <CircleAlert className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>尚未获取目标飞书知识库的一二级目录，文档分类体系需要先从飞书拉取。</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] bg-background border-amber-300 hover:bg-amber-100 dark:border-amber-800"
                        disabled={syncingDirectories}
                        onClick={() => void handleSyncDirectories()}
                      >
                        {syncingDirectories ? <Loader2 className="size-3 animate-spin mr-1" /> : <FolderSync className="size-3 mr-1" />}
                        立即获取飞书目录
                      </Button>
                    </div>
                  )}

                  {/* 详细过滤表单 */}
                  <form
                    className="grid gap-2 border-b border-border bg-secondary/20 p-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void loadTaskDetail(currentTask.id, filters, activeTab, selectedWikiId);
                    }}
                  >
                    <div className="md:col-span-2">
                      <input
                        className={inputClass}
                        value={filters.keyword}
                        onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
                        placeholder="搜索 Wiki ID、标题或来源路径"
                      />
                    </div>
                    <select
                      className={inputClass}
                      value={filters.status}
                      onChange={(e) => applyFilters({ ...filters, status: e.target.value })}
                    >
                      <option value="">全部精确状态</option>
                      {statuses.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className={inputClass}
                      value={filters.primaryCategory}
                      onChange={(e) =>
                        applyFilters({ ...filters, primaryCategory: e.target.value, secondaryCategory: "" })
                      }
                    >
                      <option value="">全部一级分类</option>
                      {Object.keys(currentTask?.taxonomy || {}).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <select
                      className={inputClass}
                      value={filters.secondaryCategory}
                      disabled={!filters.primaryCategory}
                      onChange={(e) => applyFilters({ ...filters, secondaryCategory: e.target.value })}
                    >
                      <option value="">全部二级分类</option>
                      {((currentTask?.taxonomy && currentTask.taxonomy[filters.primaryCategory]) || []).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1.5">
                      <Button type="submit" variant="outline" size="sm" className="w-full">
                        <Filter className="size-3.5" />
                        筛选
                      </Button>
                    </div>
                  </form>

                  {/* 数据列表 */}
                  {taskLoading ? (
                    <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      加载文档中…
                    </div>
                  ) : !(taskDetail?.items && taskDetail.items.length > 0) ? (
                    <div className="flex flex-col items-center py-16 text-center">
                      <FileText className="size-8 text-muted-foreground" />
                      <p className="mt-3 text-sm font-medium">
                        {selectedWikiId === "all" ? "当前分类或目录下暂无匹配文档" : "当前页面下暂无下级子文档"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedWikiId === "all"
                          ? "可尝试切换左侧目录树节点，或清空筛选条件。"
                          : "该页面为末级文档，您可直接在上方卡片对本节点文档进行审核与操作。"}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1360px] text-left text-sm">
                        <thead className="bg-secondary/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={isAllValidSelected}
                                  disabled={!validCategorizedIds.length}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedIds((curr) => [...new Set([...curr, ...validCategorizedIds])]);
                                    } else {
                                      setSelectedIds((curr) => curr.filter((id) => !validCategorizedIds.includes(id)));
                                    }
                                  }}
                                  title="全选/取消已有一二级分类的文档"
                                />
                                <span>选择</span>
                              </div>
                            </th>
                            <th className="px-4 py-3">Wiki 唯一 ID / 来源信息</th>
                            <th className="px-4 py-3">新建飞书标题</th>
                            <th className="px-4 py-3">迁移路径 (一/二级类)</th>
                            <th className="px-4 py-3">模型建议</th>
                            <th className="px-4 py-3">迁移状态</th>
                            <th className="sticky right-0 z-10 bg-secondary/40 px-4 py-3 text-right shadow-[-6px_0_10px_-10px_hsl(var(--foreground)/0.4)]">
                              操作
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {(taskDetail?.items || []).map((item) => (
                            <TaskItemRow
                              key={item.wikiId}
                              taskId={currentTask.id}
                              item={item}
                              selected={selectedIds.includes(item.wikiId)}
                              taxonomy={currentTask.taxonomy || {}}
                              onDraftChange={(draft) =>
                                setItemDrafts((curr) => ({ ...curr, [item.wikiId]: draft }))
                              }
                              onSelectedChange={(checked) =>
                                setSelectedIds((curr) =>
                                  checked ? [...new Set([...curr, item.wikiId])] : curr.filter((id) => id !== item.wikiId)
                                )
                              }
                              onSaved={(msg?: string) => {
                                setItemDrafts((curr) => {
                                  if (!curr[item.wikiId]) return curr;
                                  const next = { ...curr };
                                  delete next[item.wikiId];
                                  return next;
                                });
                                setNotice({ tone: "success", message: msg || "操作成功" });
                                void loadTaskDetail(currentTask.id, undefined, undefined, undefined, { silent: true });
                                void loadTasks();
                              }}
                              onError={(msg) => setNotice({ tone: "error", message: msg })}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>
        </>
      )}
      </div>

      {/* 任务创建/修改配置弹窗 */}
      <TaskConfigModal
        open={showTaskModal}
        isEditing={isEditingTask}
        task={isEditingTask ? currentTask : undefined}
        onOpenChange={setShowTaskModal}
        onSaved={async (taskId) => {
          const updatedTasks = await loadTasks();
          setActiveTaskId(taskId);
          setNotice({ tone: "success", message: isEditingTask ? "任务配置已更新！" : "归档任务创建成功！" });
        }}
      />

      {/* 目录整体迁移配置弹窗 */}
      <DirectoryMigrationModal
        open={showDirectoryModal}
        onOpenChange={setShowDirectoryModal}
        directory={selectedDirectory}
        directoryBreadcrumbs={selectedBreadcrumbs}
        taxonomy={currentTask?.taxonomy}
        totalCount={directoryTotal}
        onConfirm={handleDirectoryMigration}
      />
    </main>
  );
}

// ----------------------------------------------------
// 左侧 Wiki 树行组件 (递归呈现)
// ----------------------------------------------------

function WikiTreeNodeRow({
  node,
  searchKeyword,
  selectedWikiId,
  onSelect,
  level = 0,
}: {
  node: WikiTreeNode;
  searchKeyword: string;
  selectedWikiId: string;
  onSelect: (id: string) => void;
  level?: number;
}) {
  const [expanded, setExpanded] = useState(level < 1);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedWikiId === node.id;

  // 搜索关键字匹配过滤
  const matches = searchKeyword ? node.title.toLowerCase().includes(searchKeyword.toLowerCase()) : true;
  const childMatches = searchKeyword
    ? node.children?.some((c) => c.title.toLowerCase().includes(searchKeyword.toLowerCase()))
    : false;

  if (searchKeyword && !matches && !childMatches) {
    return null;
  }

  const status = node.status ? statusMeta(node.status) : undefined;
  const nodeProgress = getTreeNodeProgress(node);
  const folderMigrated = hasChildren && nodeProgress.total > 0 && nodeProgress.migrated === nodeProgress.total;
  const showStatus = status && (!hasChildren || (!folderMigrated && node.status !== "skipped"));

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (hasChildren && !expanded) setExpanded(true);
          onSelect(node.id);
        }}
        onKeyDown={(e) => e.key === "Enter" && onSelect(node.id)}
        style={{ paddingLeft: `${level * 14 + 6}px` }}
        className={`group flex cursor-pointer items-center justify-between rounded-md py-1.5 pr-2 text-xs transition-colors ${
          isSelected
            ? "bg-primary/10 text-primary font-semibold"
            : "text-foreground hover:bg-secondary/60"
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="p-0.5 text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <span className="w-3.5" />
          )}

          {hasChildren ? (
            expanded ? (
              <FolderOpen className="size-3.5 shrink-0 text-amber-500" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-amber-500" />
            )
          ) : (
            <FileText className="size-3.5 shrink-0 text-blue-500" />
          )}

          <span className="truncate" title={`${node.title} (Wiki ID: ${node.id})`}>
            {node.title}
          </span>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {folderMigrated && (
            <span title="文件夹内的待迁移文档均已迁移">
              <CheckCircle2 className="size-3.5 text-emerald-500" aria-label="文件夹内的待迁移文档均已迁移" />
            </span>
          )}
          {showStatus && status && (
            <Badge variant={status.variant} className="px-1 py-0 text-[9px] font-normal">
              {status.label}
            </Badge>
          )}
          {nodeProgress.total > 0 && (
            <span
              className="font-mono text-[10px] text-muted-foreground"
              title={
                hasChildren
                  ? `已迁移 ${nodeProgress.migrated} 篇，应迁移 ${nodeProgress.total} 篇`
                  : `已迁移 ${nodeProgress.migrated} 篇，应迁移 ${nodeProgress.total} 篇${
                      nodeProgress.skipped ? `，忽略 ${nodeProgress.skipped} 篇` : ""
                    }`
              }
            >
              {nodeProgress.migrated}/{nodeProgress.total}
            </span>
          )}
        </div>
      </div>

      {hasChildren && expanded && (
        <div className="space-y-0.5">
          {(node.children || []).map((child) => (
            <WikiTreeNodeRow
              key={child.id}
              node={child}
              searchKeyword={searchKeyword}
              selectedWikiId={selectedWikiId}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getTreeNodeProgress(node: WikiTreeNode) {
  const counts = node.counts || { total: 0, migrated: 0, pending: 0, failed: 0, skipped: 0 };
  const ownStatus = node.status || "discovered";
  const skipped = counts.skipped + (ownStatus === "skipped" ? 1 : 0);
  return {
    migrated: counts.migrated + (ownStatus === "migrated" ? 1 : 0),
    total: Math.max(0, counts.total + 1 - skipped),
    skipped,
  };
}

// ----------------------------------------------------
// 单个文档表格行组件 (基于 Wiki 唯一 ID 操作)
// ----------------------------------------------------

function TaskItemRow({
  taskId,
  item,
  selected,
  taxonomy = {},
  onDraftChange,
  onSelectedChange,
  onSaved,
  onError,
}: {
  taskId: string;
  item: KnowledgeMigrationItem;
  selected: boolean;
  taxonomy?: Taxonomy;
  onDraftChange: (draft: ItemDraft) => void;
  onSelectedChange: (checked: boolean) => void;
  onSaved: (message?: string) => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(item.finalTitle || item.source?.title || "");
  const [primary, setPrimary] = useState(item.finalPrimaryCategory || item.suggestion?.primaryCategory || "");
  const [secondary, setSecondary] = useState(item.finalSecondaryCategory || item.suggestion?.secondaryCategory || "");
  const [submitting, setSubmitting] = useState(false);

  // 当外部扫描完成或数据刷新时，自动同步最新的标题和一二级分类
  useEffect(() => {
    setTitle(item.finalTitle || item.source?.title || "");
    setPrimary(item.finalPrimaryCategory || item.suggestion?.primaryCategory || "");
    setSecondary(item.finalSecondaryCategory || item.suggestion?.secondaryCategory || "");
  }, [
    item.finalTitle,
    item.source?.title,
    item.finalPrimaryCategory,
    item.suggestion?.primaryCategory,
    item.finalSecondaryCategory,
    item.suggestion?.secondaryCategory,
  ]);

  const secondaryOptions = (taxonomy && primary ? taxonomy[primary] : []) || [];
  const status = statusMeta(item.status);
  const editable = item.status !== "migrating";
  const canMigrate = editable && item.status !== "migrated" && Boolean(primary && title.trim());

  async function update(action: "save" | "skip" | "reset") {
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/knowledge-migrations/tasks/${taskId}/items/${encodeURIComponent(item.wikiId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, primaryCategory: primary, secondaryCategory: secondary, action }),
        }
      );
      await parseResponse(response, "更新文档失败");
      if (action === "skip") onSelectedChange(false);
      const actionMsg =
        action === "save" ? "迁移信息已保存" : action === "reset" ? "已重置为待迁移状态" : "已忽略该文档";
      onSaved(actionMsg);
    } catch (error) {
      onError(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function migrate(resetFirst = false) {
    if (!primary) return;
    if (!secondary) {
      if (
        !window.confirm(
          `您未选择二级目录，文档「${title || item.source?.title || item.wikiId}」将直接迁移到一级目录「${primary}」根目录下，确定继续吗？`
        )
      ) {
        return;
      }
    }

    setSubmitting(true);
    try {
      const itemUrl = `/api/knowledge-migrations/tasks/${taskId}/items/${encodeURIComponent(item.wikiId)}`;
      if (resetFirst) {
        const resetResponse = await fetch(itemUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reset" }),
        });
        await parseResponse(resetResponse, "重置迁移记录失败");
      }

      const saveResponse = await fetch(itemUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, primaryCategory: primary, secondaryCategory: secondary, action: "save" }),
      });
      await parseResponse(saveResponse, "保存迁移信息失败");

      const publishResponse = await fetch(`/api/knowledge-migrations/tasks/${taskId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wikiIds: [item.wikiId] }),
      });
      const result = await parseResponse<{ result?: { failed?: number } }>(publishResponse, "迁移失败");
      if (result.result?.failed) {
        onError("迁移写入飞书失败，请查看错误信息");
      } else {
        onSaved("文档已成功迁移至飞书！");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "迁移失败");
    } finally {
      setSubmitting(false);
    }
  }

  const pathStr = Array.isArray(item.source?.path) ? item.source.path.join(" / ") : "";

  return (
    <tr
      className={`align-top transition-colors ${
        item.isCurrentRoot
          ? "bg-amber-500/[0.07] hover:bg-amber-500/[0.12] border-l-4 border-l-amber-500"
          : "hover:bg-secondary/20"
      }`}
    >
      {/* 选择 */}
      <td className="px-4 py-3.5">
        <input
          aria-label={`选择${item.source?.title || item.finalTitle || item.wikiId}`}
          type="checkbox"
          disabled={!canMigrate}
          checked={selected}
          onChange={(e) => onSelectedChange(e.target.checked)}
        />
      </td>

      {/* Wiki 唯一 ID 与来源 */}
      <td className="max-w-72 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-[10px] tracking-tight">
            ID: {item.wikiId}
          </Badge>

          {/* 目录与页面属性标识 */}
          {item.isCurrentRoot ? (
            <Badge className="border-amber-400/40 bg-amber-500/15 text-amber-800 dark:text-amber-200 text-[10px] font-semibold">
              <Folder className="mr-1 size-3 inline" />
              当前目录节点
            </Badge>
          ) : item.isFolder ? (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 text-[10px]">
              <Folder className="mr-1 size-3 inline" />
              目录节点
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-muted-foreground text-[10px]">
              <FileText className="mr-1 size-3 inline" />
              子页面
            </Badge>
          )}

          {/* 正文是否为空标识 */}
          {item.contentEmpty === true ? (
            <Badge
              variant="outline"
              className="border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 text-[10px]"
              title="该 Wiki 页面正文为空（仅作为目录或无内容）"
            >
              正文为空
            </Badge>
          ) : item.contentEmpty === false ? (
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px]"
              title="该 Wiki 页面包含正文内容"
            >
              有正文
            </Badge>
          ) : null}
        </div>
        <a
          className="mt-1.5 block font-medium hover:underline"
          href={item.source?.url || "#"}
          target="_blank"
          rel="noreferrer"
        >
          {item.source?.title || item.finalTitle || item.wikiId}
        </a>
        <p className="mt-1 truncate text-xs text-muted-foreground" title={pathStr}>
          {pathStr || "根目录"}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          更新：{item.source?.updatedBy || "未知"} · {date(item.source?.updatedAt)}
        </p>
      </td>

      {/* 新建飞书标题 */}
      <td className="px-4 py-3.5">
        <input
          className={`${inputClass} min-w-52`}
          value={title}
          disabled={!editable}
          onChange={(e) => {
            const nextTitle = e.target.value;
            setTitle(nextTitle);
            onDraftChange({ title: nextTitle, primaryCategory: primary, secondaryCategory: secondary });
          }}
        />
      </td>

      {/* 迁移路径 */}
      <td className="px-4 py-3.5">
        <div className="grid min-w-44 gap-2">
          <select
            className={inputClass}
            value={primary}
            disabled={!editable}
            onChange={(e) => {
              const nextPrimary = e.target.value;
              setPrimary(nextPrimary);
              setSecondary("");
              onDraftChange({ title, primaryCategory: nextPrimary, secondaryCategory: "" });
            }}
          >
            <option value="">选择一级类</option>
            {Object.keys(taxonomy || {}).map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={secondary}
            disabled={!editable || !primary}
            onChange={(e) => {
              const nextSecondary = e.target.value;
              setSecondary(nextSecondary);
              onDraftChange({ title, primaryCategory: primary, secondaryCategory: nextSecondary });
            }}
          >
            <option value="">无（直接存入一级目录）</option>
            {(secondaryOptions || []).map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>
      </td>

      {/* LLM 建议 */}
      <td className="max-w-60 px-4 py-3.5 text-xs">
        <p className="font-medium">
          {item.suggestion?.primaryCategory
            ? `${item.suggestion.primaryCategory} / ${item.suggestion.secondaryCategory || "未定"}`
            : "未分析"}
          {item.suggestion?.confidence !== undefined && ` · ${Math.round(item.suggestion.confidence * 100)}%`}
        </p>
        <p className="mt-1 leading-5 text-muted-foreground">
          {item.suggestion.reason || item.suggestion.error || item.suggestion.summary || "—"}
        </p>
      </td>

      {/* 迁移状态 */}
      <td className="px-4 py-3.5">
        <Badge variant={status.variant}>{status.label}</Badge>
        {item.error && <p className="mt-1.5 max-w-48 text-xs leading-5 text-red-600">{item.error}</p>}
      </td>

      {/* 操作 */}
      <td className="sticky right-0 z-10 bg-background px-4 py-3.5 text-right shadow-[-6px_0_10px_-10px_hsl(var(--foreground)/0.4)]">
        <div className="flex min-w-32 flex-col items-end gap-1.5">
          {item.status === "failed" ? (
            <div className="flex flex-col gap-1 items-end">
              <Button
                size="sm"
                variant="outline"
                disabled={!canMigrate || submitting}
                onClick={() => void migrate()}
              >
                {submitting ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                重试迁移
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={submitting}
                onClick={() => void update("skip")}
                title="忽略该文档，不再参与后续迁移"
              >
                <EyeOff className="size-3" />
                忽略迁移
              </Button>
            </div>
          ) : item.status === "migrated" ? (
            <div className="flex flex-col items-end gap-1">
              <Button size="sm" variant="outline" disabled={submitting} onClick={() => void migrate(true)}>
                {submitting && <Loader2 className="size-3 animate-spin" />}
                重新迁移
              </Button>
              {item.targetUrl && (
                <a
                  className="max-w-48 break-all text-xs text-blue-600 hover:underline"
                  href={item.targetUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开飞书文档
                </a>
              )}
            </div>
          ) : item.status === "skipped" ? (
            <Button size="sm" variant="outline" disabled={submitting} onClick={() => void update("save")}>
              恢复待审
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                disabled={!canMigrate || submitting}
                onClick={() => void migrate()}
                title="保存标题和分类后，直接迁移到飞书知识库"
              >
                {submitting && <Loader2 className="size-3 animate-spin" />}
                迁移
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!editable || submitting}
                onClick={() => void update("skip")}
                title="忽略该文档，不再参与后续迁移"
              >
                <EyeOff className="size-3" />
                忽略迁移
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 知识库任务创建 / 编辑弹窗
// ---------------------------------------------------------------------------

function TaskConfigModal({
  open,
  isEditing,
  task,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  isEditing: boolean;
  task?: TaskSummary | TaskDetailResponse["task"];
  onOpenChange: (open: boolean) => void;
  onSaved: (taskId: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const form = new FormData(e.currentTarget);
      const payload = Object.fromEntries(form.entries());
      const url = isEditing && task ? `/api/knowledge-migrations/tasks/${task.id}` : "/api/knowledge-migrations/tasks";
      const method = isEditing ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseResponse<{ task?: { id: string } }>(res, "保存任务失败");
      onSaved(data.task?.id || task?.id || "");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存任务失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-2xl focus:outline-none">
          <Dialog.Title className="text-base font-semibold tracking-tight">
            {isEditing ? "编辑知识库任务配置" : "新建知识库归档任务"}
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 text-xs text-muted-foreground">
            配置该任务要迁移的 Confluence 来源站点、待迁移根节点或子节点，以及飞书目标知识库。
          </Dialog.Description>

          {error && (
            <div className="mt-3 rounded-md bg-red-50 p-2.5 text-xs text-red-800">
              {error}
            </div>
          )}

          <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
            <label className="grid gap-1.5 text-xs font-medium">
              <span>任务名称</span>
              <input
                required
                name="name"
                className={inputClass}
                defaultValue={task?.name || "前端知识库归档任务"}
                placeholder="例如：前端知识库归档、机器人SDK文档迁移"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-medium">
                <span>Confluence 站点地址</span>
                <input
                  required
                  name="confluenceBaseUrl"
                  className={inputClass}
                  defaultValue={task?.config.confluenceBaseUrl || "https://wiki.segwayrobotics.com/pages/viewpage.action"}
                  placeholder="https://wiki.segwayrobotics.com"
                />
              </label>

              <label className="grid gap-1.5 text-xs font-medium">
                <span>待迁移根页面 ID（支持多节点，逗号分隔）</span>
                <input
                  required
                  name="confluenceRootPageId"
                  className={inputClass}
                  defaultValue={task?.config.confluenceRootPageId || "109091428"}
                  placeholder="例如：109091428, 88434409"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-medium">
                <span>Confluence 认证方式</span>
                <select
                  name="confluenceAuthType"
                  className={inputClass}
                  defaultValue={task?.config.confluenceAuthType || "pat"}
                >
                  <option value="pat">Personal Access Token (PAT)</option>
                  <option value="basic">Basic Auth</option>
                  <option value="cookie">Session Cookie</option>
                </select>
              </label>

              <label className="grid gap-1.5 text-xs font-medium">
                <span>用户名（仅 Basic Auth 需要）</span>
                <input
                  name="confluenceUsername"
                  className={inputClass}
                  defaultValue={task?.config.confluenceUsername}
                />
              </label>
            </div>

            <label className="grid gap-1.5 text-xs font-medium">
              <span>
                Confluence 凭据/Token
                {task?.config.confluenceSecretConfigured ? (
                  <span className="ml-1 text-emerald-600">（已保存，留空则保持不变）</span>
                ) : (
                  <span className="ml-1 text-muted-foreground font-normal">（留空将自动复用已有任务的有效凭据）</span>
                )}
              </span>
              <input
                type="password"
                name="confluenceSecret"
                className={inputClass}
                autoComplete="new-password"
                placeholder={
                  task?.config.confluenceSecretConfigured
                    ? "已配置凭据，留空保持不变"
                    : "PAT Token 或密码（留空将自动复用已有凭据）"
                }
              />
            </label>

            <label className="grid gap-1.5 text-xs font-medium">
              <span>目标飞书知识库根节点 URL</span>
              <input
                required
                name="targetWikiRoot"
                className={inputClass}
                defaultValue={task?.config.targetWikiRoot || "https://lcn9r6s394zz.feishu.cn/wiki/SFHOwfaJ8iC6Vzkm8ehcL5YYn2f"}
                placeholder="https://xxx.feishu.cn/wiki/..."
              />
            </label>

            <label className="grid gap-1.5 text-xs font-medium">
              <span>默认归档人姓名</span>
              <input
                name="defaultOperatorName"
                className={inputClass}
                defaultValue={task ? task.config.defaultOperatorName ?? "" : "管理员"}
                placeholder="可留空"
              />
            </label>

            <div className="mt-6 flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
                取消
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {saving ? "保存中…" : isEditing ? "保存配置" : "创建任务"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// 目录整体迁移模态框 (DirectoryMigrationModal)
// ---------------------------------------------------------------------------

function DirectoryMigrationModal({
  open,
  onOpenChange,
  directory,
  directoryBreadcrumbs,
  taxonomy = {},
  totalCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directory?: WikiTreeNode;
  directoryBreadcrumbs: string;
  taxonomy?: Taxonomy;
  totalCount: number;
  onConfirm: (primary: string, secondary: string, includeRoot: boolean) => Promise<void>;
}) {
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [includeRoot, setIncludeRoot] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && directory) {
      const p = Object.keys(taxonomy)[0] || "";
      setPrimary(p);
      setSecondary(taxonomy[p]?.[0] || "");
      setIncludeRoot(true);
    }
  }, [open, directory, taxonomy]);

  const secondaryOptions = (taxonomy && primary ? taxonomy[primary] : []) || [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!primary) return;
    if (!secondary) {
      if (
        !window.confirm(
          `您未选择二级目录，目录「${directory?.title || "当前目录"}」将直接整体迁移到一级目录「${primary}」根目录下，确定要继续吗？`
        )
      ) {
        return;
      }
    }
    setSubmitting(true);
    try {
      await onConfirm(primary, secondary, includeRoot);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  const targetLabel = secondary ? `二级目录「${secondary}」` : `一级目录「${primary || "所选目录"}」`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-2xl focus:outline-none">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderOpen className="size-4" />
            </div>
            <div>
              <Dialog.Title className="text-base font-semibold tracking-tight">
                整体迁移目录结构
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                保留源目录与子目录、文档的完整层级关系，批量迁移到飞书知识库。
              </Dialog.Description>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">源目录路径：</span>
                <span className="font-medium text-foreground max-w-[280px] truncate text-right" title={directoryBreadcrumbs}>
                  {directoryBreadcrumbs}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">包含待迁移文档：</span>
                <Badge variant="secondary" className="font-mono text-[11px]">
                  共 {totalCount} 篇
                </Badge>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-medium">
                <span>目标飞书一级目录</span>
                <select
                  required
                  className={inputClass}
                  value={primary}
                  disabled={submitting}
                  onChange={(e) => {
                    const nextPrimary = e.target.value;
                    setPrimary(nextPrimary);
                    setSecondary(taxonomy[nextPrimary]?.[0] || "");
                  }}
                >
                  <option value="">选择一级目录</option>
                  {Object.keys(taxonomy).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-xs font-medium">
                <span>目标飞书二级目录</span>
                <select
                  className={inputClass}
                  value={secondary}
                  disabled={!primary || submitting}
                  onChange={(e) => setSecondary(e.target.value)}
                >
                  <option value="">无（直接存入一级目录）</option>
                  {secondaryOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-md border border-border/80 bg-background/50 p-3">
              <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={includeRoot}
                  disabled={submitting}
                  onChange={(e) => setIncludeRoot(e.target.checked)}
                />
                <div>
                  <span className="font-medium text-foreground">包含当前目录节点本身</span>
                  <p className="mt-0.5 text-[11px] text-muted-foreground leading-normal">
                    {includeRoot
                      ? `将在${targetLabel}下先创建「${directory?.title || "当前目录"}」节点，再将所有子项挂载其下。`
                      : `不创建「${directory?.title || "当前目录"}」，直接将所有下级子目录和文档平铺挂载至${targetLabel}下。`}
                  </p>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
                取消
              </Button>
              <Button type="submit" size="sm" disabled={!primary || submitting}>
                {submitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                {submitting ? "整体迁移中…" : `开始整体迁移 (${totalCount} 篇)`}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
