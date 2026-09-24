"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  BookOpen,
  Bot,
  CalendarPlus,
  CalendarClock,
  CircleAlert,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  FolderTree,
  GripVertical,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  Settings2,
  Trash2,
  Users,
  UserX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TaskCalendar } from "@/components/task-calendar";
import { AppSidebar } from "@/components/app-sidebar";
import type { PublicBotConfig, ReminderSchedule, ReminderTask } from "@/lib/types";
import { computeWeekPeriodInfo } from "@/lib/bots/weekly-report/period";

type KnowledgeTaskSummary = {
  id: string;
  name: string;
  description?: string;
  config?: {
    targetWikiRoot?: string;
    confluenceBaseUrl?: string;
  };
  overview?: {
    total: number;
    counts: Record<string, number>;
    jobs: Array<{ id: string; status: string; total: number; processed: number; failed: number }>;
  };
  treeNodeCount?: number;
  notifyConfig?: {
    enabled?: boolean;
    botId?: string;
    webhookUrl?: string;
    dayOfWeek?: number;
    time?: string;
    sendMode?: string;
    lastSentAt?: string;
  };
};

type DashboardData = {
  schedules: ReminderSchedule[];
  tasks: ReminderTask[];
  history: ReminderTask[];
  bots: PublicBotConfig[];
  configured: boolean;
};

type View = "tasks" | "bots" | "history";
type ToastState = { message: string; tone: "success" | "error"; seconds: number };
type Confirmation = { type: "send" | "postpone"; task: ReminderTask };

function getKnowledgeTaskStatus(task: KnowledgeTaskSummary): {
  label: string;
  variant: "success" | "secondary" | "warning" | "outline";
  className?: string;
} {
  const isRunning = task.overview?.jobs?.some((j) => j.status === "running");
  if (isRunning) {
    return {
      label: "迁移进行中",
      variant: "outline",
      className: "border-blue-500 text-blue-600 bg-blue-50/60",
    };
  }
  const total = task.overview?.total ?? task.treeNodeCount ?? 0;
  const counts = task.overview?.counts ?? {};
  const migrated = counts.migrated ?? 0;
  const failed = counts.failed ?? 0;

  if (failed > 0) {
    return { label: `有 ${failed} 项失败`, variant: "warning", className: "text-red-700 bg-red-50" };
  }
  if (task.notifyConfig) {
    return {
      label: task.notifyConfig.enabled ? "启用中" : "已停用",
      variant: task.notifyConfig.enabled ? "success" : "secondary",
    };
  }
  if (total > 0 && migrated >= total) {
    return { label: "全部已归档", variant: "success" };
  }
  if (migrated > 0) {
    return { label: "归档中", variant: "success" };
  }
  return { label: "已配置", variant: "secondary" };
}

const weekdays = ["", "每周一", "每周二", "每周三", "每周四", "每周五", "每周六", "每周日"];
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDate(value: string) {
  return dateFormat.format(new Date(value));
}

function isThisWeek(dateString: string): boolean {
  const target = new Date(dateString);
  const now = new Date();

  // 获取本周一的 00:00:00
  const day = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);

  // 获取本周日的 23:59:59
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return target >= monday && target <= sunday;
}

const inputControlClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>();
  const [knowledgeTasks, setKnowledgeTasks] = useState<KnowledgeTaskSummary[]>([]);
  const [view, setView] = useState<View>("tasks");
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>();
  const [editingSchedule, setEditingSchedule] = useState<ReminderSchedule>();
  const [editingBot, setEditingBot] = useState<PublicBotConfig | "new">();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [postponingTaskId, setPostponingTaskId] = useState<string>();
  const [calendarRefreshToken, setCalendarRefreshToken] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [confirming, setConfirming] = useState(false);
  const [resettingPostponements, setResettingPostponements] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [resettingOverrides, setResettingOverrides] = useState(false);
  const [toast, setToast] = useState<ToastState>();
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [dashRes, kmRes] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/knowledge-migrations/tasks", { cache: "no-store" }).catch(() => null),
      ]);
      if (dashRes.ok) {
        setData(await dashRes.json());
      }
      if (kmRes && kmRes.ok) {
        const kmData = (await kmRes.json()) as { tasks?: KnowledgeTaskSummary[] };
        setKnowledgeTasks(kmData.tasks ?? []);
      }
    } catch (err) {
      console.error("加载数据失败:", err);
    }
  }, []);

  useEffect(() => {
    void load();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const scheduleId = params.get("scheduleId");
      if (scheduleId) setSelectedScheduleId(scheduleId);
    }
  }, [load]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (toastIntervalRef.current) clearInterval(toastIntervalRef.current);
    };
  }, []);

  const showToast = useCallback((message: string, tone: ToastState["tone"] = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toastIntervalRef.current) clearInterval(toastIntervalRef.current);
    setToast({ message, tone, seconds: 3 });
    toastIntervalRef.current = setInterval(() => {
      setToast((current) => current ? { ...current, seconds: Math.max(0, current.seconds - 1) } : current);
    }, 1000);
    toastTimerRef.current = setTimeout(() => {
      setToast(undefined);
      if (toastIntervalRef.current) clearInterval(toastIntervalRef.current);
    }, 3000);
  }, []);

  useEffect(() => {
    if (data && !data.configured) showToast("暂无可用 Webhook，请在“机器人配置”中添加机器人。", "error");
  }, [data?.configured, showToast]);

  async function sendNow(task: ReminderTask) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/send`, { method: "POST" });
    const result = await response.json();
    if (response.ok) showToast(result.result.mocked ? "该机器人未配置 Webhook，已在本地模拟发送。" : "消息已成功发送到飞书群。");
    else showToast(result.error ?? "发送失败", "error");
    if (response.ok) await load();
  }

  async function syncDoc(scheduleId?: string) {
    if (syncing) return;
    setSyncing(true);
    try {
      const response = await fetch("/api/feishu/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId }),
      });
      const result = await response.json();
      if (!response.ok) {
        showToast(result.error ?? "同步失败", "error");
        return;
      }
      showToast(
        `已成功同步 ${result.count} 位轮值成员${result.missingOpenIdCount ? `，其中 ${result.missingOpenIdCount} 位尚未绑定 open_id` : ""}。`,
      );
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "同步失败", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function postponeTask(task: ReminderTask) {
    if (postponingTaskId) return;
    setPostponingTaskId(task.id);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/postpone`, { method: "POST" });
      const result = await response.json();
      showToast(
        response.ok ? `已将 ${formatDate(task.scheduledAt)} 的轮值延期到下一个可执行周。` : (result.error ?? "延期失败"),
        response.ok ? "success" : "error",
      );
      if (response.ok) {
        setCalendarRefreshToken((value) => value + 1);
        await load();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "延期失败", "error");
    } finally {
      setPostponingTaskId(undefined);
    }
  }

  function requestSendNow(task: ReminderTask) {
    setConfirmation({ type: "send", task });
  }

  function requestPostponeTask(task: ReminderTask) {
    if (postponingTaskId) return;
    setConfirmation({ type: "postpone", task });
  }

  async function confirmPendingAction() {
    if (!confirmation || confirming) return;
    const pending = confirmation;
    setConfirming(true);
    try {
      if (pending.type === "send") await sendNow(pending.task);
      else await postponeTask(pending.task);
    } finally {
      setConfirming(false);
      setConfirmation(undefined);
    }
  }

  async function resetPostponements(scheduleId: string) {
    if (resettingPostponements) return;
    setResettingPostponements(true);
    try {
      const response = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}/postponements/reset`, {
        method: "POST",
      });
      const result = await response.json();
      showToast(
        response.ok ? `已恢复正常周期，清除了 ${result.clearedCount ?? 0} 次手动延期。` : (result.error ?? "恢复失败"),
        response.ok ? "success" : "error",
      );
      if (response.ok) {
        setCalendarRefreshToken((value) => value + 1);
        await load();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "恢复失败", "error");
    } finally {
      setResettingPostponements(false);
    }
  }

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSchedule) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload: Record<string, any> = {
      dayOfWeek: Number(form.get("dayOfWeek")),
      time: String(form.get("time") ?? ""),
      botId: String(form.get("botId") ?? ""),
      enabled: form.get("enabled") === "on",
    };
    const name = form.get("name");
    if (name) payload.name = String(name).trim();
    const documentId = form.get("documentId");
    if (documentId !== null) payload.documentId = String(documentId).trim();
    const sourceDocumentId = form.get("sourceDocumentId");
    if (sourceDocumentId !== null) payload.sourceDocumentId = String(sourceDocumentId).trim();
    const targetFolderId = form.get("targetFolderId");
    if (targetFolderId !== null) payload.targetFolderId = String(targetFolderId).trim();

    const response = await fetch(`/api/schedules/${editingSchedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    setSaving(false);
    showToast(response.ok ? "定时规则已更新。" : (result.error ?? "保存失败"), response.ok ? "success" : "error");
    if (response.ok) {
      setEditingSchedule(undefined);
      await load();
    }
  }

  async function saveBot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingBot) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const isNew = editingBot === "new";
    const webhookUrl = String(form.get("webhookUrl") ?? "").trim();
    const payload = {
      name: String(form.get("name") ?? ""),
      ...(isNew || webhookUrl ? { webhookUrl } : {}),
      enabled: form.get("enabled") === "on",
    };
    const response = await fetch(isNew ? "/api/bots" : `/api/bots/${editingBot.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    setSaving(false);
    showToast(response.ok ? `机器人${isNew ? "已添加" : "已更新"}。` : (result.error ?? "保存失败"), response.ok ? "success" : "error");
    if (response.ok) {
      setEditingBot(undefined);
      await load();
    }
  }

  async function removeBot(bot: PublicBotConfig) {
    if (!window.confirm(`确认删除机器人「${bot.name}」？`)) return;
    const response = await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
    const result = await response.json();
    showToast(response.ok ? "机器人已删除。" : (result.error ?? "删除失败"), response.ok ? "success" : "error");
    if (response.ok) await load();
  }

  async function handleSetCurrentHost(scheduleId: string, targetIndex: number) {
    const response = await fetch(`/api/schedules/${scheduleId}/current-host`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetIndex }),
    });
    const result = await response.json();
    if (response.ok) {
      showToast("已成功更新当前值班节点，排期已重新计算。");
      setCalendarRefreshToken((v) => v + 1);
      await load();
    } else {
      showToast(result.error ?? "设置失败", "error");
    }
  }

  async function handleReorderTasks(scheduleId: string, updatedTasks: ReminderTask[]) {
    if (reordering) return;
    setReordering(true);
    try {
      const response = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: updatedTasks.map((t) => ({
            scheduledAt: t.scheduledAt,
            host: t.host,
            isSwapped: t.isSwapped,
          })),
        }),
      });
      const result = await response.json();
      if (response.ok) {
        showToast("已更新未来排期值班顺序。");
        setCalendarRefreshToken((v) => v + 1);
        await load();
      } else {
        showToast(result.error ?? "调序失败", "error");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "调序失败", "error");
    } finally {
      setReordering(false);
    }
  }

  async function handleResetOverrides(scheduleId: string) {
    if (resettingOverrides) return;
    setResettingOverrides(true);
    try {
      const response = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}/overrides/reset`, {
        method: "POST",
      });
      const result = await response.json();
      if (response.ok) {
        showToast(`已恢复默认排期顺序，清除了 ${result.clearedCount ?? 0} 个临时调换。`);
        setCalendarRefreshToken((v) => v + 1);
        await load();
      } else {
        showToast(result.error ?? "重置失败", "error");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "重置失败", "error");
    } finally {
      setResettingOverrides(false);
    }
  }

  const activeSchedules = data?.schedules.filter((item) => item.enabled).length ?? 0;
  const botName = (id: string) => data?.bots.find((bot) => bot.id === id)?.name ?? "未指定机器人";

  // 只展示有定时任务（已启用定时通知）的知识库任务
  const scheduledKnowledgeTasks = knowledgeTasks.filter((kt) => Boolean(kt.notifyConfig?.enabled));

  // 本周执行计划
  const thisWeekTasks = (data?.tasks ?? []).filter((task) => isThisWeek(task.scheduledAt));
  const nextTask = data?.tasks[0];

  // 当前选中的详情任务
  const selectedSchedule = data?.schedules.find((item) => item.id === selectedScheduleId);
  const selectedScheduleTasks = (data?.tasks ?? []).filter((task) => task.scheduleId === selectedScheduleId);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppSidebar />

      {/* 主内容区 */}
      <main className="ml-60 max-w-[1500px] p-8 lg:p-10">
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
            {toast.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
            <span className="flex-1">{toast.message}</span>
            <span className="shrink-0 font-mono text-xs opacity-70">{toast.seconds}s</span>
          </div>
        )}

        {selectedSchedule ? (
          selectedSchedule.type === "weekly_report" || selectedSchedule.id.includes("weekly-report") ? (
            /* 周报自动归档任务专属详情与设置视图 */
            <WeeklyReportTaskDetailView
              schedule={selectedSchedule}
              bots={data?.bots ?? []}
              botName={botName(selectedSchedule.botId)}
              onBack={() => setSelectedScheduleId(undefined)}
              onEdit={() => setEditingSchedule(selectedSchedule)}
              onReload={load}
              showToast={showToast}
              onPostponeTask={requestPostponeTask}
              postponingTaskId={postponingTaskId}
              onResetPostponements={() => void resetPostponements(selectedSchedule.id)}
              resettingPostponements={resettingPostponements}
            />
          ) : (
            /* 周会主持提醒任务详情视图 */
            <TaskDetailView
              schedule={selectedSchedule}
              tasks={selectedScheduleTasks}
              botName={botName(selectedSchedule.botId)}
              onBack={() => setSelectedScheduleId(undefined)}
              onEdit={() => setEditingSchedule(selectedSchedule)}
              onSync={() => void syncDoc(selectedSchedule.id)}
              syncing={syncing}
              onSendTask={requestSendNow}
              onPostponeTask={requestPostponeTask}
              postponingTaskId={postponingTaskId}
              onResetPostponements={() => void resetPostponements(selectedSchedule.id)}
              resettingPostponements={resettingPostponements}
              onSetCurrentHost={(targetIndex) => handleSetCurrentHost(selectedSchedule.id, targetIndex)}
              onReorderTasks={(newTasks) => handleReorderTasks(selectedSchedule.id, newTasks)}
              reordering={reordering}
              onResetOverrides={() => void handleResetOverrides(selectedSchedule.id)}
              resettingOverrides={resettingOverrides}
            />
          )
        ) : (
          /* 一级主页面：顶部 Tab（任务与日历 / 发送记录） + 对应内容 */
          <>
            <div className="mb-8 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">定时任务</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  查看当前配置的定时提醒与自动归档任务，以及本周预计要触发的执行计划
                </p>
              </div>

              <div className="flex items-center rounded-lg border border-border bg-secondary/40 p-1">
                <button
                  type="button"
                  onClick={() => setView("tasks")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === "tasks"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <CalendarClock className="size-3.5" />
                  <span>任务与日历</span>
                </button>
                <button
                  type="button"
                  onClick={() => setView("history")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === "history"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Send className="size-3.5" />
                  <span>发送记录 ({data?.history.length ?? 0})</span>
                </button>
              </div>
            </div>

            {view === "history" ? (
              <SendHistoryView records={data?.history ?? []} hideTitle />
            ) : view === "bots" ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 p-4">
                  <p className="text-sm text-muted-foreground">
                    提示：飞书机器人配置已统一收敛至「系统设置」中。
                  </p>
                  <Link href="/settings?tab=bots">
                    <Button size="sm">前往系统设置管理机器人</Button>
                  </Link>
                </div>
                <BotManagement
                  bots={data?.bots ?? []}
                  editingBot={editingBot}
                  saving={saving}
                  onEdit={setEditingBot}
                  onDelete={(bot) => void removeBot(bot)}
                  onSave={saveBot}
                />
              </div>
            ) : (
              <>

              {/* 指标卡片 */}
              <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Metric label="启用中的任务" value={String(activeSchedules + scheduledKnowledgeTasks.length)} />
                <Metric
                  label="本周预计执行"
                  value={thisWeekTasks.length > 0 ? `${thisWeekTasks.length} 次` : "本周已无待办"}
                />
                <Metric
                  label="下次执行时间"
                  value={nextTask ? formatDate(nextTask.scheduledAt) : "暂无"}
                  compact
                  isDate={Boolean(nextTask)}
                />
              </section>

              <TaskCalendar
                onOpenSchedule={(scheduleId) => setSelectedScheduleId(scheduleId)}
                onPostponeTask={requestPostponeTask}
                refreshToken={calendarRefreshToken}
              />

              {/* 任务列表（点击进入详情） */}
              <Card className="mb-8">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">已配置的任务列表</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {(data?.schedules ?? []).length === 0 && scheduledKnowledgeTasks.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">暂无配置的任务</div>
                  ) : (
                    <>
                      {(data?.schedules ?? []).map((schedule) => {
                        const isWeeklyReport = schedule.type === "weekly_report" || schedule.id.includes("weekly-report");
                        return (
                          <div
                            key={schedule.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedScheduleId(schedule.id)}
                            onKeyDown={(e) => e.key === "Enter" && setSelectedScheduleId(schedule.id)}
                            className="group flex cursor-pointer items-center justify-between border-t border-border px-6 py-4.5 transition-colors hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:outline-none"
                          >
                            <div className="flex items-center gap-4">
                              <div className="grid size-10 place-items-center rounded-lg bg-secondary text-foreground group-hover:bg-background">
                                {isWeeklyReport ? (
                                  <FileSpreadsheet className="size-5" />
                                ) : (
                                  <CalendarClock className="size-5" />
                                )}
                              </div>
                              <div>
                                <div className="flex items-center gap-2.5 font-medium">
                                  <span className="text-base">{schedule.name}</span>
                                  <Badge variant={schedule.enabled ? "success" : "secondary"}>
                                    {schedule.enabled ? "启用中" : "已停用"}
                                  </Badge>
                                  <Badge variant="outline" className="text-[10px]">
                                    {isWeeklyReport ? "周报归档" : "周会轮值"}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {isWeeklyReport ? (
                                    `${weekdays[schedule.dayOfWeek]} ${schedule.time} · 机器人：${schedule.botId ? botName(schedule.botId) : "未指定机器人"} · 归档目标：${schedule.targetFolderId ? "已配置" : "待配置"} · 模板源：${schedule.sourceDocumentId ? "已配置" : "待配置"}`
                                  ) : (
                                    `${weekdays[schedule.dayOfWeek]} ${schedule.time} · 机器人：${botName(schedule.botId)} · 当前 ${schedule.rotation.length} 人轮值`
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                              <span>查看排期与详情</span>
                              <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                            </div>
                          </div>
                        );
                      })}

                      {scheduledKnowledgeTasks.map((kt) => {
                        const statusInfo = getKnowledgeTaskStatus(kt);
                        const total = kt.overview?.total ?? kt.treeNodeCount ?? 0;
                        const migrated = kt.overview?.counts?.migrated ?? 0;
                        const pending = kt.overview?.counts?.pending ?? 0;

                        const cycleText = kt.notifyConfig?.dayOfWeek && kt.notifyConfig.time
                          ? `${weekdays[kt.notifyConfig.dayOfWeek]} ${kt.notifyConfig.time}`
                          : "定时推送";

                        const botText = kt.notifyConfig?.botId
                          ? botName(kt.notifyConfig.botId)
                          : kt.notifyConfig?.webhookUrl
                            ? "自定义 Webhook"
                            : "未指定机器人";

                        return (
                          <Link
                            key={kt.id}
                            href={`/knowledge-migration?taskId=${kt.id}`}
                            className="group flex cursor-pointer items-center justify-between border-t border-border px-6 py-4.5 transition-colors hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:outline-none"
                          >
                            <div className="flex items-center gap-4">
                              <div className="grid size-10 place-items-center rounded-lg bg-secondary text-foreground group-hover:bg-background">
                                <BookOpen className="size-5" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2.5 font-medium">
                                  <span className="text-base">{kt.name || "前端知识库团队迁移"}</span>
                                  <Badge variant={statusInfo.variant} className={statusInfo.className}>
                                    {statusInfo.label}
                                  </Badge>
                                  <Badge variant="outline" className="text-[10px]">
                                    知识库归档
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {`${cycleText} · 机器人：${botText} · 归档进度：${migrated}/${total} 篇已完成${pending > 0 ? ` · 待处理 ${pending} 篇` : ""}`}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                              <span>查看排期与详情</span>
                              <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                            </div>
                          </Link>
                        );
                      })}
                    </>
                  )}
                </CardContent>
              </Card>

              {/* 本周预计执行计划 */}
              <Card>
                <CardHeader className="flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle className="text-base font-semibold">本周预计执行的计划</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">仅展示当前自然周将要提醒或归档的任务</p>
                  </div>
                  {thisWeekTasks.length > 0 && (
                    <Badge variant="outline" className="font-mono text-xs tabular-nums">
                      本周 {thisWeekTasks.length} 项
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  {thisWeekTasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <CheckCircle2 className="size-7 text-emerald-600/70 mb-2.5" />
                      <p className="text-sm font-medium text-foreground">本周已无待执行的提醒任务</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        后续任务将在下周按既定规则自动派发，点击上方任务卡片可查看完整排期
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="border-y border-border bg-secondary/50 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="px-6 py-3 font-medium">执行时间</th>
                            <th className="px-6 py-3 font-medium">所属任务</th>
                            <th className="px-6 py-3 font-medium">发送机器人 / 模式</th>
                            <th className="px-6 py-3 font-medium">主持人 / 模式</th>
                            <th className="px-6 py-3 font-medium text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {thisWeekTasks.map((task) => {
                            const isDue = new Date(task.scheduledAt).getTime() <= Date.now();
                            const isKnowledgeMigration = task.scheduleId.startsWith("knowledge-migration:");
                            const kmTaskId = isKnowledgeMigration ? task.scheduleId.replace("knowledge-migration:", "") : null;
                            const kmTask = kmTaskId ? knowledgeTasks.find((kt) => kt.id === kmTaskId) : null;
                            const isWeeklyReport = !isKnowledgeMigration && (task.scheduleId.includes("weekly-report") || task.host.name === "系统自动");

                            const assignedBotId = isKnowledgeMigration
                              ? kmTask?.notifyConfig?.botId
                              : data?.schedules.find((item) => item.id === task.scheduleId)?.botId;

                            const botDisplayName = assignedBotId
                              ? botName(assignedBotId)
                              : isKnowledgeMigration && kmTask?.notifyConfig?.webhookUrl
                                ? "自定义 Webhook"
                                : "未指定机器人";

                            return (
                              <tr key={task.id} className="transition-colors hover:bg-secondary/30">
                                <td className="px-6 py-4 font-mono text-xs tabular-nums text-foreground font-medium">
                                  {formatDate(task.scheduledAt)}
                                  {isDue && (
                                    <Badge variant="warning" className="ml-2 px-1.5 py-0 text-[10px]">
                                      待派发
                                    </Badge>
                                  )}
                                </td>
                                <td className="px-6 py-4 font-medium">{task.scheduleName}</td>
                                <td className="px-6 py-4 text-muted-foreground">
                                  {botDisplayName}
                                </td>
                                <td className="px-6 py-4">
                                  {isKnowledgeMigration ? (
                                    <Badge variant="outline" className="text-[11px] font-normal text-indigo-600 border-indigo-200 bg-indigo-50/50">
                                      知识库周报推送
                                    </Badge>
                                  ) : isWeeklyReport ? (
                                    <Badge variant="outline" className="text-[11px] font-normal">
                                      周报自动归档
                                    </Badge>
                                  ) : (
                                    <HostBadge host={task.host} />
                                  )}
                                </td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex justify-end gap-1">
                                  {!isKnowledgeMigration && (
                                    <Button variant="ghost" size="sm" onClick={() => requestPostponeTask(task)} disabled={postponingTaskId === task.id}>
                                      <CalendarPlus className="size-3.5" />
                                      <span>{postponingTaskId === task.id ? "延期中…" : "延期到下周"}</span>
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="sm" onClick={() => requestSendNow(task)}>
                                    <Send className="size-3.5" />
                                    <span>{isKnowledgeMigration || isWeeklyReport ? "立即执行" : "立即发送"}</span>
                                  </Button>
                                </div>
                              </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

        {editingSchedule && (
          <Dialog.Root open onOpenChange={(open) => !open && setEditingSchedule(undefined)}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card text-card-foreground shadow-xl focus:outline-none">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div>
                  <Dialog.Title className="text-base font-semibold leading-none tracking-tight">
                    {editingSchedule.type === "weekly_report" || editingSchedule.id.includes("weekly-report")
                      ? "调整周报定时与归档规则"
                      : "调整定时规则"}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1.5 text-xs text-muted-foreground">
                    修改后将从下一次计划执行时生效。
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <Button variant="ghost" size="sm" aria-label="关闭调整定时规则弹窗">
                    关闭
                  </Button>
                </Dialog.Close>
              </div>
              <form className="p-6" onSubmit={saveSchedule}>
                {editingSchedule.type === "weekly_report" || editingSchedule.id.includes("weekly-report") ? (
                  /* 周报自动归档配置表单 */
                  <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
                    <label className="grid gap-2 font-medium sm:col-span-2">
                      <span>任务名称</span>
                      <input
                        className={inputControlClass}
                        name="name"
                        defaultValue={editingSchedule.name}
                        placeholder="例如：前端周报更新提醒"
                        required
                      />
                    </label>

                    <label className="grid gap-2 font-medium">
                      <span>执行日</span>
                      <select
                        className={inputControlClass}
                        name="dayOfWeek"
                        defaultValue={editingSchedule.dayOfWeek}
                      >
                        {weekdays.slice(1).map((day, index) => (
                          <option key={day} value={index + 1}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-2 font-medium">
                      <span>执行时间</span>
                      <input
                        className={`${inputControlClass} font-mono tabular-nums`}
                        name="time"
                        type="time"
                        defaultValue={editingSchedule.time}
                        required
                      />
                    </label>

                    <label className="grid gap-2 font-medium sm:col-span-2">
                      <span>飞书模板源文档地址（拉取此文档内容）</span>
                      <input
                        className={inputControlClass}
                        name="sourceDocumentId"
                        type="url"
                        placeholder="https://xxx.feishu.cn/wiki/... 模板文档链接"
                        defaultValue={editingSchedule.sourceDocumentId || ""}
                        required
                      />
                    </label>

                    <label className="grid gap-2 font-medium sm:col-span-2">
                      <span>飞书目标知识库根目录（归档到此目录树）</span>
                      <input
                        className={inputControlClass}
                        name="targetFolderId"
                        type="url"
                        placeholder="https://xxx.feishu.cn/wiki/... 知识库根节点链接"
                        defaultValue={editingSchedule.targetFolderId || ""}
                        required
                      />
                    </label>

                    <label className="grid gap-2 font-medium sm:col-span-2">
                      <div className="flex items-center justify-between">
                        <span>关联通知机器人（生成后发送飞书群提醒，可选）</span>
                        <Link href="/settings?tab=bots" className="text-xs font-normal text-muted-foreground hover:text-foreground">
                          配置机器人 →
                        </Link>
                      </div>
                      <select
                        className={inputControlClass}
                        name="botId"
                        defaultValue={editingSchedule.botId || ""}
                      >
                        <option value="">不发送群提醒（仅归档文档）</option>
                        {(data?.bots ?? []).map((bot) => (
                          <option key={bot.id} value={bot.id}>
                            {bot.name}
                            {!bot.configured ? " (未配置 Webhook)" : bot.enabled ? "" : " (已停用)"}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-2.5 pt-2 sm:col-span-2 text-sm font-normal select-none">
                      <input
                        name="enabled"
                        type="checkbox"
                        className="size-4 rounded border-input text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                        defaultChecked={editingSchedule.enabled}
                      />
                      <span>允许定时自动执行</span>
                    </label>
                  </div>
                ) : (
                  /* 轮值提醒任务配置表单 */
                  <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
                    <label className="grid gap-2 font-medium">
                      <span>执行日</span>
                      <select
                        className={inputControlClass}
                        name="dayOfWeek"
                        defaultValue={editingSchedule.dayOfWeek}
                      >
                        {weekdays.slice(1).map((day, index) => (
                          <option key={day} value={index + 1}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2 font-medium">
                      <span>执行时间</span>
                      <input
                        className={`${inputControlClass} font-mono tabular-nums`}
                        name="time"
                        type="time"
                        defaultValue={editingSchedule.time}
                        required
                      />
                    </label>
                    <label className="grid gap-2 font-medium sm:col-span-2">
                      <div className="flex items-center justify-between">
                        <span>发送机器人</span>
                        <Link href="/settings?tab=bots" className="text-xs font-normal text-muted-foreground hover:text-foreground">
                          配置机器人 →
                        </Link>
                      </div>
                      <select
                        className={inputControlClass}
                        name="botId"
                        defaultValue={editingSchedule.botId}
                      >
                        {(data?.bots ?? []).map((bot) => (
                          <option key={bot.id} value={bot.id}>
                            {bot.name}
                            {bot.enabled ? "" : "（已停用）"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2 font-medium sm:col-span-2">
                      <span>飞书名单数据源地址（文档 / 表格 / 维表 URL）</span>
                      <input
                        className={inputControlClass}
                        name="documentId"
                        type="url"
                        placeholder="https://xxx.feishu.cn/wiki/... 或 docx/bitable/sheet 链接"
                        defaultValue={editingSchedule.documentId || ""}
                      />
                    </label>
                    <label className="flex items-center gap-2.5 pt-2 sm:col-span-2 text-sm font-normal select-none">
                      <input
                        name="enabled"
                        type="checkbox"
                        className="size-4 rounded border-input text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                        defaultChecked={editingSchedule.enabled}
                      />
                      <span>允许定时派发</span>
                    </label>
                  </div>
                )}
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  {editingSchedule.type === "weekly_report" || editingSchedule.id.includes("weekly-report")
                    ? "周报规则：每次执行自动拉取源模板内容，并在目标知识库按 年份工作汇总/月份/周报 目录结构自动归档。"
                    : "轮值来源：飞书文档/表格。点击“同步飞书名单”后自动刷新最新人员排期。"}
                </p>
                <div className="mt-6 flex justify-end gap-2.5 border-t border-border pt-4">
                  <Button variant="outline" size="sm" type="button" onClick={() => setEditingSchedule(undefined)}>
                    取消
                  </Button>
                  <Button size="sm" type="submit" disabled={saving}>
                    {saving ? "保存中…" : "保存"}
                  </Button>
                </div>
              </form>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
        <ConfirmDialog
          open={Boolean(confirmation)}
          title={confirmation?.type === "send" ? "确认立即发送" : "确认延期轮值"}
          description={
            confirmation?.type === "send"
              ? `将立即发送「${confirmation.task.scheduleName}」的提醒消息。`
              : confirmation
                ? `将 ${formatDate(confirmation.task.scheduledAt)} 的轮值延期到下一个可执行周。`
                : ""
          }
          confirmLabel={confirmation?.type === "send" ? "立即发送" : "确认延期"}
          loading={confirming}
          onOpenChange={(open) => !open && setConfirmation(undefined)}
          onConfirm={() => void confirmPendingAction()}
        />
      </main>
    </div>
  );
}

/**
 * 任务详情视图（展示该任务的所有执行计划与轮值名单）
 */
function TaskDetailView({
  schedule,
  tasks,
  botName,
  onBack,
  onEdit,
  onSync,
  syncing,
  onSendTask,
  onPostponeTask,
  postponingTaskId,
  onResetPostponements,
  resettingPostponements,
  onSetCurrentHost,
  onReorderTasks,
  reordering,
  onResetOverrides,
  resettingOverrides,
}: {
  schedule: ReminderSchedule;
  tasks: ReminderTask[];
  botName: string;
  onBack: () => void;
  onEdit: () => void;
  onSync: () => void;
  syncing: boolean;
  onSendTask: (task: ReminderTask) => void;
  onPostponeTask: (task: ReminderTask) => void;
  postponingTaskId?: string;
  onResetPostponements: () => void;
  resettingPostponements: boolean;
  onSetCurrentHost: (targetIndex: number) => Promise<void>;
  onReorderTasks: (newTasks: ReminderTask[]) => Promise<void>;
  reordering: boolean;
  onResetOverrides: () => void;
  resettingOverrides: boolean;
}) {
  const [limit, setLimit] = useState<number>(20);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [localTasks, setLocalTasks] = useState<ReminderTask[]>(tasks);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const fetchScheduleTasks = useCallback(async (lim: number) => {
    setLoadingTasks(true);
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(schedule.id)}/tasks?limit=${lim}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok && Array.isArray(json.tasks)) {
        setLocalTasks(json.tasks);
      }
    } catch {
      // fallback
    } finally {
      setLoadingTasks(false);
    }
  }, [schedule.id]);

  useEffect(() => {
    void fetchScheduleTasks(limit);
  }, [fetchScheduleTasks, limit, schedule]);

  const hasOverrides = Boolean(schedule.hostOverrides && Object.keys(schedule.hostOverrides).length > 0);
  const currentHost = localTasks[0]?.host || schedule.rotation[schedule.currentIndex];

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${index}`);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    // 保持各期执行时间和期数不变，仅重排/调换主持人
    const hosts = localTasks.map((t) => t.host);
    const [movedHost] = hosts.splice(draggedIndex, 1);
    hosts.splice(targetIndex, 0, movedHost);

    const updatedTasks: ReminderTask[] = localTasks.map((task, idx) => ({
      ...task,
      host: hosts[idx],
      isOverridden: true,
      isSwapped: idx === targetIndex || idx === draggedIndex || Boolean(task.isSwapped),
    }));

    setLocalTasks(updatedTasks);
    setDraggedIndex(null);
    setDragOverIndex(null);

    await onReorderTasks(updatedTasks);
  };

  const handleSkipTask = async (index: number) => {
    if (reordering) return;
    if (index === 0) {
      // 本次跳过当前即将值班人员：直接顺延当前值班节点至下一位，无需记录繁琐 override
      const nextIndex = (schedule.currentIndex + 1) % schedule.rotation.length;
      await onSetCurrentHost(nextIndex);
      return;
    }

    const hosts = localTasks.map((t) => t.host);
    const skippedHost = hosts[index];
    if (!skippedHost) return;

    // 将该期主持人移出，后续人员依次顺延顶上
    hosts.splice(index, 1);
    const lastHostName = hosts[hosts.length - 1]?.name;
    const rotationIndex = schedule.rotation.findIndex((m) => m.name === lastHostName);
    let nextHost = skippedHost;
    if (rotationIndex >= 0 && schedule.rotation.length > 0) {
      nextHost = schedule.rotation[(rotationIndex + 1) % schedule.rotation.length];
    }
    hosts.push(nextHost);

    const updatedTasks: ReminderTask[] = localTasks.map((task, idx) => ({
      ...task,
      host: hosts[idx],
      isOverridden: true,
      isSwapped: false, // 跳过仅顺延，不展示调换徽章
    }));

    setLocalTasks(updatedTasks);
    await onReorderTasks(updatedTasks);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div>
      {/* 顶部返回与操作 */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" />
          <span>返回任务列表</span>
        </button>
        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={onSync} disabled={syncing}>
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
            <span>{syncing ? "同步中…" : "同步飞书名单"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onResetPostponements}
            disabled={resettingPostponements || !schedule.postponedDates?.length}
          >
            {resettingPostponements ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            <span>{resettingPostponements ? "恢复中…" : "恢复正常周期"}</span>
          </Button>
          <Button size="sm" onClick={onEdit}>
            <Settings2 className="size-3.5" />
            <span>调整规则</span>
          </Button>
        </div>
      </div>

      {/* 任务基本信息卡片 */}
      <div className="mb-8 rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{schedule.name}</h1>
              <Badge variant={schedule.enabled ? "success" : "secondary"}>
                {schedule.enabled ? "启用中" : "已停用"}
              </Badge>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              执行周期：<span className="font-medium text-foreground">{weekdays[schedule.dayOfWeek]} {schedule.time}</span> · 
              绑定机器人：<span className="font-medium text-foreground">{botName}</span> · 
              时区：{schedule.timezone}
            </p>
          </div>
          <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-l border-border pt-3 sm:pt-0 sm:pl-6 text-xs text-muted-foreground">
            <div>
              <p>最近一次发送</p>
              <p className="mt-1 font-mono tabular-nums text-foreground font-medium">
                {schedule.lastSentAt ? formatDate(schedule.lastSentAt) : "尚未触发"}
              </p>
            </div>
          </div>
        </div>

        {/* 轮值人员名单与当前值班节点切换 */}
        <div className="mt-6 border-t border-border pt-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Users className="size-3.5 text-muted-foreground" />
              <span>当前轮值人员顺序（共 {schedule.rotation.length} 人，点击「设为当前」可调整值班节点）</span>
            </div>
            <span className="text-[11px] text-muted-foreground">按序周轮换</span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {schedule.rotation.map((member, idx) => {
              const isFirstTaskOverridden = Boolean(localTasks[0]?.isOverridden || localTasks[0]?.isSwapped);
              const isCurrent = isFirstTaskOverridden
                ? (currentHost?.openId ? member.openId === currentHost.openId : member.name === currentHost?.name)
                : typeof schedule.currentIndex === "number"
                  ? idx === (schedule.currentIndex % schedule.rotation.length)
                  : (currentHost?.openId ? member.openId === currentHost.openId : member.name === currentHost?.name);

              return (
                <div
                  key={`${member.name}-${idx}`}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    isCurrent
                      ? "border-emerald-500/40 bg-emerald-500/10 text-foreground font-medium ring-1 ring-emerald-500/20"
                      : "border-border bg-secondary/30 text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <span className="font-mono text-[11px] text-muted-foreground font-medium">{idx + 1}.</span>
                  <span className="font-medium">{member.name}</span>
                  <HostBadge host={member} compact />
                  {isCurrent ? (
                    <Badge variant="success" className="px-1.5 py-0 text-[10px] font-normal">
                      当前值班{isFirstTaskOverridden ? "（临时）" : ""}
                    </Badge>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void onSetCurrentHost(idx)}
                      className="ml-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors hover:underline focus-visible:outline-none"
                    >
                      设为当前
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 该任务的所有未来执行计划 */}
      <Card>
        <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle className="text-base font-semibold">未来执行计划排期</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              按轮值算法推算出的排期安排（可拖拽左侧手柄临时调换人员，不影响执行时间与底层名单）
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 rounded-md border border-border bg-secondary/40 p-0.5 text-xs text-muted-foreground">
              <span className="px-1.5 text-[11px] font-medium select-none">期数</span>
              {[10, 20, 30, 50].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setLimit(num)}
                  disabled={loadingTasks}
                  className={`rounded px-2 py-0.5 font-mono text-xs transition-colors ${
                    limit === num
                      ? "bg-foreground text-background font-semibold shadow-xs"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
            {hasOverrides && (
              <Button
                variant="outline"
                size="sm"
                onClick={onResetOverrides}
                disabled={resettingOverrides}
                className="text-xs"
              >
                {resettingOverrides ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                <span>恢复默认排期</span>
              </Button>
            )}
            <Badge variant="outline" className="font-mono text-xs tabular-nums">
              {loadingTasks ? "加载中…" : `共 ${localTasks.length} 期`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {localTasks.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">暂无排期计划</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-border bg-secondary/50 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-3 text-center"></th>
                    <th className="px-6 py-3 font-medium">期数</th>
                    <th className="px-6 py-3 font-medium">执行时间</th>
                    <th className="px-6 py-3 font-medium">轮值主持人</th>
                    <th className="px-6 py-3 font-medium">发送状态</th>
                    <th className="px-6 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {localTasks.map((task, index) => {
                    const isDragging = draggedIndex === index;
                    const isDragOver = dragOverIndex === index && draggedIndex !== index;
                    return (
                      <tr
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => void handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                        className={`group transition-all ${
                          isDragging ? "opacity-35 bg-secondary/70" : "hover:bg-secondary/30"
                        } ${isDragOver ? "border-t-2 border-primary bg-primary/5" : ""}`}
                      >
                        <td className="w-10 px-3 py-4 text-center cursor-grab active:cursor-grabbing text-muted-foreground/60 group-hover:text-foreground">
                          <div className="flex items-center justify-center" title="按住拖拽调整值班顺序">
                            <GripVertical className="size-4" />
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono text-xs tabular-nums text-muted-foreground">
                          第 {index + 1} 期
                        </td>
                        <td className="px-6 py-4 font-mono text-xs tabular-nums text-foreground font-medium">
                          {formatDate(task.scheduledAt)}
                          {isThisWeek(task.scheduledAt) && (
                            <Badge variant="success" className="ml-2 px-1.5 py-0 text-[10px]">
                              本周
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <HostBadge host={task.host} />
                            {task.isSwapped && (
                              <Badge
                                variant="outline"
                                className="px-1.5 py-0 text-[10px] font-normal text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10"
                                title="此期为手动临时调换的主持人"
                              >
                                临时调换
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-xs font-mono">
                          {task.status === "sent" ? (
                            <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                              已发送
                            </Badge>
                          ) : new Date(task.scheduledAt).getTime() <= Date.now() ? (
                            <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                              待派发
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">待执行</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleSkipTask(index)}
                              disabled={reordering}
                              title={`本次跳过 ${task.host.name}，后续人员自动顺延补齐`}
                            >
                              <UserX className="size-3.5" />
                              <span>本次跳过</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onPostponeTask(task)}
                              disabled={postponingTaskId === task.id || reordering}
                            >
                              <CalendarPlus className="size-3.5" />
                              <span>{postponingTaskId === task.id ? "延期中…" : "延期到下周"}</span>
                            </Button>
                            {index === 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onSendTask(task)}
                                disabled={reordering}
                              >
                                <Send className="size-3.5" />
                                <span>立即发送</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


/**
 * 人员 @ 状态标识组件
 */
function HostBadge({
  host,
  compact = false,
}: {
  host: { name: string; openId?: string };
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span
        className={`inline-block size-1.5 rounded-full ${host.openId ? "bg-emerald-500" : "bg-zinc-300"}`}
        title={host.openId ? "已绑定飞书ID，可强提醒 @" : "未绑定飞书ID，仅作文本提及"}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-medium">{host.name}</span>
      <Badge
        variant={host.openId ? "outline" : "secondary"}
        className="text-[11px] font-normal"
        title={host.openId ? "已绑定飞书ID，可强提醒 @" : "未绑定飞书ID，仅作文本提及"}
      >
        {host.openId ? "可 @" : "未绑飞书ID"}
      </Badge>
    </div>
  );
}

function BotManagement({
  bots,
  editingBot,
  saving,
  onEdit,
  onDelete,
  onSave,
}: {
  bots: PublicBotConfig[];
  editingBot: PublicBotConfig | "new" | undefined;
  saving: boolean;
  onEdit: (bot: PublicBotConfig | "new" | undefined) => void;
  onDelete: (bot: PublicBotConfig) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <>
      <div className="grid max-w-4xl gap-4">
        {bots.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center bg-card">
            <Bot className="size-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-foreground">暂未添加机器人</p>
            <p className="mt-1 text-xs text-muted-foreground">点击右上角“添加机器人”关联飞书群 Webhook</p>
            <Button size="sm" className="mt-4" onClick={() => onEdit("new")}>
              <Plus className="size-3.5" />
              <span>添加机器人</span>
            </Button>
          </div>
        ) : (
          bots.map((bot) => (
            <Card key={bot.id}>
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <Bot className="size-4 text-muted-foreground" />
                    <span>{bot.name}</span>
                    <Badge variant={bot.enabled ? "success" : "secondary"}>
                      {bot.enabled ? "启用中" : "已停用"}
                    </Badge>
                  </div>
                  <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                    Webhook：<span className="text-foreground/80">{bot.webhookMasked}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => onEdit(bot)}>
                    <Pencil className="size-3.5" />
                    <span>编辑</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(bot)}>
                    <Trash2 className="size-3.5" />
                    <span>删除</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {editingBot && (
        <Card className="mt-6 max-w-2xl border-border shadow-md">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle>{editingBot === "new" ? "添加机器人" : `编辑 ${editingBot.name}`}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onEdit(undefined)}>
              关闭
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSave}>
              <div className="grid gap-4 text-sm">
                <label className="grid gap-2 font-medium">
                  <span>机器人名称</span>
                  <input
                    className={inputControlClass}
                    name="name"
                    defaultValue={editingBot === "new" ? "" : editingBot.name}
                    placeholder="例如：FEBot"
                    required
                  />
                </label>
                <label className="grid gap-2 font-medium">
                  <span>飞书机器人 Webhook</span>
                  <input
                    className={`${inputControlClass} font-mono text-xs`}
                    name="webhookUrl"
                    type="url"
                    placeholder={
                      editingBot === "new"
                        ? "https://open.feishu.cn/open-apis/bot/v2/hook/…"
                        : "留空以保持当前 Webhook 不变"
                    }
                    required={editingBot === "new"}
                  />
                </label>
                <label className="flex items-center gap-2.5 text-sm font-normal select-none">
                  <input
                    name="enabled"
                    type="checkbox"
                    className="size-4 rounded border-input text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    defaultChecked={editingBot === "new" || editingBot.enabled}
                  />
                  <span>启用机器人</span>
                </label>
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Webhook 是敏感凭据，保存后仅显示脱敏值，不会通过接口回传到浏览器。生产环境应加密持久化并限制管理台访问权限。
              </p>
              <div className="mt-6 flex justify-end gap-2.5 border-t border-border pt-4">
                <Button variant="outline" size="sm" type="button" onClick={() => onEdit(undefined)}>
                  取消
                </Button>
                <Button size="sm" type="submit" disabled={saving}>
                  {saving ? "保存中…" : "保存"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function SendHistoryView({ records, hideTitle }: { records: ReminderTask[]; hideTitle?: boolean }) {
  const sortedRecords = [...records].sort((a, b) => {
    const aTime = a.sentAt ? new Date(a.sentAt).getTime() : 0;
    const bTime = b.sentAt ? new Date(b.sentAt).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <div>
      {!hideTitle && (
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">发送记录</h1>
          <p className="mt-1 text-sm text-muted-foreground">查看提醒发送时间、触发方式、消息内容及使用的机器人信息</p>
        </div>
      )}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">历史发送记录</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sortedRecords.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">暂无发送记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-y border-border bg-secondary/50 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">发送时间</th>
                    <th className="px-6 py-3 font-medium">触发方式</th>
                    <th className="px-6 py-3 font-medium">消息内容</th>
                    <th className="px-6 py-3 font-medium">机器人</th>
                    <th className="px-6 py-3 font-medium">机器人 ID</th>
                    <th className="px-6 py-3 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedRecords.map((record) => (
                    <tr key={`${record.id}-${record.sentAt ?? record.scheduledAt}`} className="align-top transition-colors hover:bg-secondary/30">
                      <td className="whitespace-nowrap px-6 py-4 font-mono text-xs tabular-nums text-foreground">
                        {record.sentAt ? formatDate(record.sentAt) : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={record.triggerType === "manual" ? "outline" : "secondary"}>
                          {record.triggerType === "manual" ? "手动触发" : record.triggerType === "scheduled" ? "定时触发" : "未记录"}
                        </Badge>
                      </td>
                      <td className="max-w-[360px] px-6 py-4 text-foreground">
                        <p className="whitespace-pre-wrap break-words">{record.content ?? record.error ?? "—"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">任务：{record.scheduleName}</p>
                      </td>
                      <td className="px-6 py-4 font-medium">{record.botName ?? "—"}</td>
                      <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{record.botId ?? "—"}</td>
                      <td className="px-6 py-4">
                        <Badge variant={record.status === "sent" ? "success" : "warning"}>
                          {record.status === "sent" ? "已发送" : "发送失败"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  compact = false,
  isDate = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
  isDate?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className={
            compact
              ? `mt-2 text-base font-semibold tracking-tight text-foreground ${isDate ? "font-mono text-sm tabular-nums" : ""}`
              : "mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums text-foreground"
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * 周报自动归档任务专属详情视图
 */
function WeeklyReportTaskDetailView({
  schedule,
  bots,
  botName,
  onBack,
  onEdit,
  onReload,
  showToast,
  onPostponeTask,
  postponingTaskId,
  onResetPostponements,
  resettingPostponements,
}: {
  schedule: ReminderSchedule;
  bots: PublicBotConfig[];
  botName: string;
  onBack: () => void;
  onEdit: () => void;
  onReload: () => Promise<void>;
  showToast: (message: string, tone?: "success" | "error") => void;
  onPostponeTask: (task: ReminderTask) => void;
  postponingTaskId?: string;
  onResetPostponements: () => void;
  resettingPostponements: boolean;
}) {
  const [executing, setExecuting] = useState(false);
  const [history, setHistory] = useState<ReminderTask[]>([]);
  const [upcoming, setUpcoming] = useState<ReminderTask[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    success?: boolean;
    url?: string;
    message?: string;
    nodeToken?: string;
  }>();

  const fetchDetail = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/weekly-report", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setUpcoming(data.upcoming || []);
        setHistory(data.history || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail, schedule]);

  const handleExecuteNow = async () => {
    if (executing) return;
    setExecuting(true);
    setExecutionResult(undefined);
    try {
      const res = await fetch("/api/weekly-report/execute", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        showToast("本周周报已成功生成并归档！");
        setExecutionResult({
          success: true,
          url: data.result?.documentUrl,
          message: data.result?.content,
          nodeToken: data.result?.createdNodeToken,
        });
        await onReload();
        await fetchDetail();
      } else {
        showToast(data.error ?? "执行失败", "error");
        setExecutionResult({
          success: false,
          message: data.error ?? "周报生成执行失败",
        });
      }
    } catch (err: any) {
      const msg = err?.message || "周报生成执行失败";
      showToast(msg, "error");
      setExecutionResult({ success: false, message: msg });
    } finally {
      setExecuting(false);
    }
  };

  const periodPreview = computeWeekPeriodInfo(new Date());

  return (
    <div>
      {/* 顶部返回与操作 */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" />
          <span>返回任务列表</span>
        </button>
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onResetPostponements}
            disabled={resettingPostponements || !schedule.postponedDates?.length}
          >
            {resettingPostponements ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            <span>{resettingPostponements ? "恢复中…" : "恢复正常周期"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExecuteNow}
            disabled={executing || !schedule.sourceDocumentId || !schedule.targetFolderId}
            title="立即读取源模板并在目标知识库创建本周周报"
          >
            {executing ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            <span>{executing ? "生成中…" : "立即执行一次"}</span>
          </Button>
          <Button size="sm" onClick={onEdit}>
            <Settings2 className="size-3.5" />
            <span>调整规则</span>
          </Button>
        </div>
      </div>

      {/* 实时执行结果 Banner */}
      {executionResult && (
        <div
          className={`mb-8 rounded-xl border p-5 ${
            executionResult.success
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
              : "border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-200"
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              {executionResult.success ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              ) : (
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-red-600" />
              )}
              <div>
                <h3 className="font-semibold text-sm">
                  {executionResult.success ? "周报生成执行成功" : "周报生成执行失败"}
                </h3>
                <p className="mt-1 text-xs leading-relaxed opacity-90">{executionResult.message}</p>
              </div>
            </div>
            {executionResult.url && (
              <a
                href={executionResult.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-emerald-700 shrink-0"
              >
                <span>打开飞书周报</span>
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* 任务基本信息卡片 */}
      <div className="mb-8 rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{schedule.name}</h1>
              <Badge variant={schedule.enabled ? "success" : "secondary"}>
                {schedule.enabled ? "启用中" : "已停用"}
              </Badge>
              <Badge variant="outline" className="text-xs">周报自动归档</Badge>
            </div>
            <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              <p>
                执行周期：<span className="font-medium text-foreground">{weekdays[schedule.dayOfWeek]} {schedule.time}</span> · 
                绑定机器人：<span className="font-medium text-foreground">{botName}</span> · 
                时区：{schedule.timezone}
              </p>
              <p className="break-all">
                模板源文档：
                {schedule.sourceDocumentId ? (
                  <a
                    href={schedule.sourceDocumentId}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground hover:underline inline-flex items-center gap-1"
                  >
                    <span>{schedule.sourceDocumentId}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span className="text-destructive font-medium">尚未配置</span>
                )}
              </p>
              <p className="break-all">
                归档目标知识库：
                {schedule.targetFolderId ? (
                  <a
                    href={schedule.targetFolderId}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground hover:underline inline-flex items-center gap-1"
                  >
                    <span>{schedule.targetFolderId}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span className="text-destructive font-medium">尚未配置</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-l border-border pt-3 sm:pt-0 sm:pl-6 text-xs text-muted-foreground">
            <div>
              <p>最近一次执行</p>
              <p className="mt-1 font-mono tabular-nums text-foreground font-medium">
                {schedule.lastSentAt ? formatDate(schedule.lastSentAt) : "尚未触发"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 目录层级说明卡片 */}
      <Card className="mb-8 border-dashed bg-secondary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <FolderTree className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">自动归档层级结构说明</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>每次执行时，系统会自动在设定的「目标知识库根目录」下按以下规则检查并递归创建：</p>
          <div className="rounded-md border border-border bg-card p-3 font-mono text-[12px] text-foreground">
            <div>📁 目标知识库根目录</div>
            <div className="ml-4 text-muted-foreground">└─ 📁 {periodPreview.yearName}（如 2026工作汇总）</div>
            <div className="ml-8 text-muted-foreground">└─ 📁 {periodPreview.monthName}（如 202609）</div>
            <div className="ml-12 text-foreground font-medium">└─ 📄 {periodPreview.weekTitle}（复制源模板内容）</div>
          </div>
          <p>
            若对应年份或月份目录已存在，会自动复用现有目录；若当周周报已存在，则会覆盖更新，避免产生重复文件。
          </p>
        </CardContent>
      </Card>

      {/* 未来执行计划 */}
      <Card className="mb-8">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-semibold">未来执行计划排期</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">按照设定的定时规则推算的后续排期（自动跳过法定节假日）</p>
          </div>
          <Badge variant="outline" className="font-mono text-xs tabular-nums">
            共 {upcoming.length} 期
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无排期计划（请检查任务是否启用）</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-border bg-secondary/50 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">期数</th>
                    <th className="px-6 py-3 font-medium">预计执行时间</th>
                    <th className="px-6 py-3 font-medium">预计生成周报标题</th>
                    <th className="px-6 py-3 font-medium">所属层级</th>
                    <th className="px-6 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {upcoming.map((task, index) => {
                    const period = computeWeekPeriodInfo(task.scheduledAt);
                    return (
                      <tr key={task.id} className="transition-colors hover:bg-secondary/30">
                        <td className="px-6 py-4 font-mono text-xs text-muted-foreground">第 {index + 1} 期</td>
                        <td className="px-6 py-4 font-mono text-xs tabular-nums font-medium text-foreground">
                          {formatDate(task.scheduledAt)}
                        </td>
                        <td className="px-6 py-4 font-medium">{period.weekTitle}</td>
                        <td className="px-6 py-4 text-xs text-muted-foreground">
                          {period.yearName} / {period.monthName}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onPostponeTask(task)}
                              disabled={postponingTaskId === task.id}
                            >
                              <CalendarPlus className="size-3.5" />
                              <span>{postponingTaskId === task.id ? "延期中…" : "延期到下周"}</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 历史执行记录 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">历史执行记录</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
              <Loader2 className="size-4 animate-spin" />
              <span>加载历史记录中…</span>
            </div>
          ) : history.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">暂无历史执行记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-y border-border bg-secondary/50 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">执行时间</th>
                    <th className="px-6 py-3 font-medium">触发方式</th>
                    <th className="px-6 py-3 font-medium">执行结果与文档地址</th>
                    <th className="px-6 py-3 font-medium text-right">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((record) => (
                    <tr key={record.id} className="transition-colors hover:bg-secondary/30">
                      <td className="whitespace-nowrap px-6 py-4 font-mono text-xs tabular-nums text-foreground">
                        {record.sentAt ? formatDate(record.sentAt) : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={record.triggerType === "manual" ? "outline" : "secondary"}>
                          {record.triggerType === "manual" ? "手动触发" : "定时触发"}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-foreground text-xs leading-relaxed max-w-[480px]">
                        <p className="break-words">{record.content || record.error || "—"}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Badge variant={record.status === "sent" ? "success" : "warning"}>
                          {record.status === "sent" ? "成功" : "失败"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
