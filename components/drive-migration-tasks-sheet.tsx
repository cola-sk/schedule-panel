"use client";

import { useState } from "react";
import {
  X,
  Loader2,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Trash2,
  RefreshCw,
  FolderSync,
  ChevronDown,
  ChevronRight,
  FileText,
  FileSpreadsheet,
  Database,
  Layers,
  File,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DriveMigrationTask, DriveFileType } from "@/lib/drive-migration/types";

function getFileTypeIcon(type: string) {
  switch (type) {
    case "docx":
    case "doc":
      return <FileText className="size-3.5 text-blue-500 shrink-0" />;
    case "sheet":
      return <FileSpreadsheet className="size-3.5 text-emerald-500 shrink-0" />;
    case "bitable":
      return <Database className="size-3.5 text-purple-500 shrink-0" />;
    case "slides":
      return <Layers className="size-3.5 text-orange-500 shrink-0" />;
    default:
      return <File className="size-3.5 text-muted-foreground shrink-0" />;
  }
}

export function DriveMigrationTasksSheet({
  open,
  onClose,
  tasks,
  loading,
  onRefresh,
  onClearCompleted,
}: {
  open: boolean;
  onClose: () => void;
  tasks: DriveMigrationTask[];
  loading?: boolean;
  onRefresh: () => void;
  onClearCompleted: () => void;
}) {
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());

  if (!open) return null;

  function toggleExpandTask(id: string) {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const runningCount = tasks.filter((t) => t.status === "running" || t.status === "pending").length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩背景 */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity cursor-pointer"
        onClick={onClose}
      />

      {/* 侧滑面板 */}
      <div className="relative z-50 flex h-full w-full max-w-xl flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200">
        {/* 顶部标题区 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-foreground text-background">
              <FolderSync className="size-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">后台迁移任务</h2>
                {runningCount > 0 ? (
                  <Badge variant="outline" className="border-amber-300 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1 text-[11px]">
                    <Loader2 className="size-3 animate-spin" />
                    <span>{runningCount} 个任务执行中</span>
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[11px]">
                    共 {tasks.length} 项记录
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                任务在后台静默运行，迁移完毕后自动刷新主界面状态
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              className="size-8 p-0"
              title="刷新任务进度"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            {tasks.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearCompleted}
                className="size-8 p-0 text-muted-foreground hover:text-destructive"
                title="清除已完成/失败的历史任务"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="size-8 p-0"
              title="关闭"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* 任务列表区 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tasks.length === 0 ? (
            <div className="flex h-80 flex-col items-center justify-center text-center text-muted-foreground">
              <FolderSync className="size-10 mb-2 opacity-30" />
              <p className="text-sm font-medium text-foreground">暂无后台迁移任务</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                在主列表中勾选文档并点击「开始批量迁移」，或在目录行点击「迁移当前目录」后，任务将自动转入后台执行。
              </p>
            </div>
          ) : (
            tasks.map((task) => {
              const isRunning = task.status === "running" || task.status === "pending";
              const isExpanded = expandedTaskIds.has(task.id) || (isRunning && expandedTaskIds.size === 0);
              const percent =
                task.progress.total > 0
                  ? Math.round((task.progress.completed / task.progress.total) * 100)
                  : 0;

              return (
                <div
                  key={task.id}
                  className="rounded-lg border border-border bg-card p-4 shadow-2xs space-y-3 transition-colors hover:border-foreground/20"
                >
                  {/* 头部：标题与状态 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground truncate" title={task.name}>
                          {task.name}
                        </h3>
                        {isRunning ? (
                          <Badge variant="outline" className="border-amber-400 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1 text-[10px]">
                            <Loader2 className="size-2.5 animate-spin" />
                            <span>执行中</span>
                          </Badge>
                        ) : task.status === "completed" ? (
                          task.progress.failed > 0 ? (
                            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400 text-[10px]">
                              部分完成
                            </Badge>
                          ) : (
                            <Badge variant="success" className="text-[10px] gap-1">
                              <CheckCircle2 className="size-2.5" />
                              <span>已完成</span>
                            </Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="border-destructive/30 text-destructive text-[10px] gap-1">
                            <CircleAlert className="size-2.5" />
                            <span>失败</span>
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                        创建时间: {new Date(task.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleExpandTask(task.id)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                    >
                      <span>{isExpanded ? "收起" : "展开"}</span>
                      {isExpanded ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                  </div>

                  {/* 进度条与数量统计 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                      <span>
                        进度: {task.progress.completed} / {task.progress.total} 篇 ({percent}%)
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-600 dark:text-emerald-400">成功 {task.progress.success}</span>
                        {task.progress.failed > 0 && (
                          <span className="text-destructive">失败 {task.progress.failed}</span>
                        )}
                        {task.progress.skipped > 0 && (
                          <span>跳过 {task.progress.skipped}</span>
                        )}
                      </div>
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 rounded-full ${
                          task.status === "completed" && task.progress.failed === 0
                            ? "bg-emerald-500"
                            : isRunning
                            ? "bg-amber-500"
                            : "bg-primary"
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>

                    {isRunning && task.currentFile && (
                      <p className="text-[11px] text-muted-foreground truncate animate-pulse flex items-center gap-1.5">
                        <Loader2 className="size-2.5 animate-spin shrink-0 text-amber-500" />
                        <span>正在处理: {task.currentFile}</span>
                      </p>
                    )}
                  </div>

                  {/* 展开的具体文件结果清单 */}
                  {isExpanded && (
                    <div className="border-t border-border/70 pt-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {task.items.map((item) => (
                        <div
                          key={item.token}
                          className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs bg-secondary/30 hover:bg-secondary/60 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            {getFileTypeIcon(item.type)}
                            <span className="truncate text-foreground" title={item.name}>
                              {item.name}
                            </span>
                          </div>

                          <div className="shrink-0 flex items-center gap-1 text-[11px]">
                            {item.status === "migrating" ? (
                              <span className="flex items-center gap-1 text-amber-600 font-medium">
                                <Loader2 className="size-3 animate-spin" />
                                迁移中
                              </span>
                            ) : item.status === "success" ? (
                              <div className="flex items-center gap-1.5">
                                <span className="flex items-center gap-0.5 text-emerald-600">
                                  <CheckCircle2 className="size-3" />
                                  完成
                                </span>
                                {item.url && (
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary hover:underline inline-flex items-center gap-0.5"
                                    title="在飞书知识库中打开"
                                  >
                                    <ExternalLink className="size-2.5" />
                                  </a>
                                )}
                              </div>
                            ) : item.status === "failed" ? (
                              <span
                                className="flex items-center gap-0.5 text-destructive max-w-[140px] truncate"
                                title={item.error || "迁移失败"}
                              >
                                <CircleAlert className="size-3 shrink-0" />
                                <span className="truncate">{item.error || "失败"}</span>
                              </span>
                            ) : item.status === "skipped" ? (
                              <span className="text-muted-foreground">已跳过</span>
                            ) : (
                              <span className="text-muted-foreground">排队中</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
