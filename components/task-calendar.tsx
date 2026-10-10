"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Sparkles,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReminderTask } from "@/lib/core/types";

type CalendarHoliday = { date: string; name: string };
type CalendarView = "month" | "week";

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function dateFromKey(key: string): Date {
  return new Date(`${key}T12:00:00+08:00`);
}

function keyFromDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(key: string, amount: number): string {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return keyFromDate(date);
}

function monthKey(key: string): string {
  return key.slice(0, 7);
}

function startOfWeek(key: string): string {
  return addDays(key, -dateFromKey(key).getUTCDay());
}

function formatMonth(key: string): string {
  const date = dateFromKey(key);
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long" }).format(date);
}

function formatRange(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "short", day: "numeric" });
  return `${formatter.format(dateFromKey(start))} – ${formatter.format(dateFromKey(end))}`;
}

function taskTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function taskDate(value: string): string {
  return keyFromDate(new Date(value));
}

function dayNumber(key: string): string {
  return key.slice(-2).replace(/^0/, "");
}

function formatFullDateTime(isoStr?: string): string {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    const pad = (n: number) => String(n).padStart(2, "0");
    const shDate = new Date(d.getTime() + 8 * 3600 * 1000);
    return `${shDate.getUTCFullYear()}-${pad(shDate.getUTCMonth() + 1)}-${pad(shDate.getUTCDate())} ${pad(shDate.getUTCHours())}:${pad(shDate.getUTCMinutes())}:${pad(shDate.getUTCSeconds())}`;
  } catch {
    return isoStr;
  }
}

export function TaskCalendar({
  onOpenSchedule,
  onPostponeTask,
  refreshToken,
}: {
  onOpenSchedule: (scheduleId: string) => void;
  onPostponeTask: (task: ReminderTask) => void;
  refreshToken: number;
}) {
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(() => keyFromDate(new Date()));
  const [tasks, setTasks] = useState<ReminderTask[]>([]);
  const [holidays, setHolidays] = useState<CalendarHoliday[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [hoveredTask, setHoveredTask] = useState<{
    task: ReminderTask;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);

  useEffect(() => {
    const handleDismiss = () => setHoveredTask(null);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, []);

  const days = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(5, 7));
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    const firstWeekday = dateFromKey(first).getUTCDay();
    const last = keyFromDate(new Date(Date.UTC(year, month, 0, 4)));
    const lastWeekday = dateFromKey(last).getUTCDay();
    const gridStart = addDays(first, -firstWeekday);
    const gridEnd = addDays(last, 6 - lastWeekday);
    const total = Math.round((dateFromKey(gridEnd).getTime() - dateFromKey(gridStart).getTime()) / (24 * 60 * 60 * 1000)) + 1;
    return Array.from({ length: total }, (_, index) => addDays(gridStart, index));
  }, [cursor, view]);

  const rangeStart = days[0];
  const rangeEnd = days.at(-1);

  useEffect(() => {
    if (!rangeStart || !rangeEnd) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    fetch(`/api/calendar?start=${rangeStart}&end=${rangeEnd}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const text = await response.text();
        let result: { error?: string; tasks?: ReminderTask[]; holidays?: CalendarHoliday[] } = {};
        if (text) {
          try {
            result = JSON.parse(text);
          } catch {
            throw new Error(`服务响应异常 (${response.status})`);
          }
        }
        if (!response.ok) throw new Error(result.error ?? "日历加载失败");
        const filtered = ((result.tasks ?? []) as ReminderTask[]).filter(
          (t) => t.triggerType !== "manual"
        );
        setTasks(filtered);
        setHolidays(result.holidays ?? []);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "日历加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [rangeStart, rangeEnd, refreshToken]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, ReminderTask[]>();
    tasks
      .filter((task) => task.triggerType !== "manual")
      .forEach((task) => {
        const key = taskDate(task.scheduledAt);
        map.set(key, [...(map.get(key) ?? []), task]);
      });
    return map;
  }, [tasks]);

  const holidaysByDate = useMemo(() => new Map(holidays.map((holiday) => [holiday.date, holiday.name])), [holidays]);
  const today = keyFromDate(new Date());
  const title = view === "month" ? formatMonth(cursor) : formatRange(days[0], days[6]);

  function movePeriod(amount: number) {
    if (view === "week") setCursor(addDays(startOfWeek(cursor), amount * 7));
    else {
      const date = dateFromKey(`${monthKey(cursor)}-01`);
      date.setUTCMonth(date.getUTCMonth() + amount);
      setCursor(keyFromDate(date));
    }
  }

  function goToday() {
    setCursor(today);
  }

  function isKnowledgeMigrationTask(task: ReminderTask) {
    return task.scheduleId.startsWith("knowledge-migration:");
  }

  function openTask(task: ReminderTask) {
    if (isKnowledgeMigrationTask(task)) {
      const taskId = task.scheduleId.replace("knowledge-migration:", "");
      window.location.assign(`/knowledge-migration?taskId=${taskId}`);
      return;
    }
    onOpenSchedule(task.scheduleId);
  }

  return (
    <CardShell>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">任务日历</h2>
          <Badge variant="outline" className="ml-1 text-[11px]">中国节假日</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {(["month", "week"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${view === item ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setView(item)}
              >
                {item === "month" ? "月" : "周"}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={goToday}>今天</Button>
          <Button variant="ghost" size="sm" className="size-8 px-0" onClick={() => movePeriod(-1)} aria-label="上一个周期"><ChevronLeft className="size-4" /></Button>
          <Button variant="ghost" size="sm" className="size-8 px-0" onClick={() => movePeriod(1)} aria-label="下一个周期"><ChevronRight className="size-4" /></Button>
        </div>
      </div>
      <div className="px-5 py-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium">{title}</p>
          {loading && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />加载中</span>}
        </div>
        {error ? <p className="py-10 text-center text-sm text-red-600">{error}</p> : (
          <div className="overflow-x-auto">
            <div className={`min-w-[720px] ${view === "month" ? "grid grid-cols-7" : "grid grid-cols-7"}`}>
              {weekdayLabels.map((label) => <div key={label} className="border-b border-border px-2 py-2 text-center text-xs font-medium text-muted-foreground">{label}</div>)}
              {days.map((day) => {
                const dayTasks = tasksByDate.get(day) ?? [];
                const holiday = holidaysByDate.get(day);
                const inMonth = monthKey(day) === monthKey(cursor);
                return (
                  <div key={day} className={`min-h-28 border-b border-r border-border p-2 ${inMonth || view === "week" ? "" : "bg-secondary/20"} ${holiday ? "bg-red-50/70" : ""}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className={`grid size-6 place-items-center rounded-full text-xs ${day === today ? "bg-foreground font-semibold text-background" : inMonth || view === "week" ? "text-foreground" : "text-muted-foreground/50"}`}>{dayNumber(day)}</span>
                      {holiday && <span className="max-w-[7rem] truncate text-[10px] font-medium text-red-600" title={holiday}>{holiday}</span>}
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {dayTasks.map((task) => {
                        const isSent = task.status === "sent";
                        const isPostponed = task.status === "postponed";
                        const isFailed = task.status === "failed";
                        const isKM = isKnowledgeMigrationTask(task);
                        const isSystemHost =
                          !task.host?.name ||
                          task.host.name.startsWith("系统") ||
                          task.host.name === "定时任务" ||
                          task.host.name === "手动触发";
                        const triggerLabel = task.triggerType === "manual" ? "手动发送" : "定时发送";

                        let taskDesc = "";
                        if (isPostponed) {
                          taskDesc = "本期已延期";
                        } else if (isFailed) {
                          taskDesc = `${taskTime(task.scheduledAt)} · 发送失败`;
                        } else if (isSent) {
                          const time = taskTime(task.sentAt || task.scheduledAt);
                          taskDesc = isSystemHost
                            ? `${time}`
                            : `${time} · ${task.host.name}`;
                        } else {
                          const time = taskTime(task.scheduledAt);
                          taskDesc = isSystemHost
                            ? `${time}`
                            : `${time} · ${task.host.name}`;
                        }

                        const canPostpone = !isKM && !task.scheduleId.includes("weekly-report") && new Date(task.scheduledAt).getTime() >= Date.now();

                        let cardStyle = "";
                        if (isSent) {
                          // 已发送：统一柔和绿色，不论什么任务
                          cardStyle =
                            "border-emerald-200/80 bg-emerald-50/50 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-100 hover:border-emerald-400 dark:hover:border-emerald-600 hover:bg-emerald-100/60";
                        } else if (isPostponed) {
                          cardStyle =
                            "border-dashed border-amber-300/80 bg-amber-50/40 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200 hover:bg-amber-100/50";
                        } else if (isFailed) {
                          cardStyle =
                            "border-rose-200 bg-rose-50/70 text-rose-950 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200 hover:bg-rose-100/60";
                        } else {
                          // 未执行发送：统一更显眼醒目的主题蓝，不论什么任务
                          cardStyle =
                            "border-blue-300/90 bg-blue-50/90 text-blue-950 dark:border-blue-700/80 dark:bg-blue-950/40 dark:text-blue-100 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-100/90 shadow-2xs";
                        }

                        return (
                          <div
                            key={task.id}
                            role="button"
                            tabIndex={0}
                            className={`group cursor-pointer rounded-md border px-1.5 py-1 text-[11px] leading-4 shadow-2xs transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${cardStyle}`}
                            onMouseEnter={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              setHoveredTask({
                                task,
                                rect: {
                                  top: rect.top,
                                  left: rect.left,
                                  width: rect.width,
                                  height: rect.height,
                                },
                              });
                            }}
                            onMouseLeave={() => setHoveredTask(null)}
                            onClick={() => openTask(task)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openTask(task);
                              }
                            }}
                          >
                            <div className="flex items-center gap-1 font-medium truncate">
                              {isSent ? (
                                <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              ) : isPostponed ? (
                                <CalendarX className="size-3 text-amber-600 dark:text-amber-400 shrink-0" />
                              ) : isFailed ? (
                                <AlertCircle className="size-3 text-rose-600 dark:text-rose-400 shrink-0" />
                              ) : (
                                <Clock className="size-3 text-blue-600 dark:text-blue-400 shrink-0" />
                              )}
                              <span className="truncate">{task.scheduleName}</span>
                            </div>

                            <div
                              className={`truncate text-[10px] ${
                                isSent
                                  ? "text-emerald-700/80 dark:text-emerald-300/80"
                                  : isPostponed
                                  ? "text-amber-700/80 dark:text-amber-300/80"
                                  : isFailed
                                  ? "text-rose-700/80 dark:text-rose-300/80"
                                  : "text-blue-800/80 dark:text-blue-200/80"
                              }`}
                            >
                              {taskDesc}
                            </div>

                            <div className="mt-1 flex items-center justify-between gap-1">
                              <span
                                className={`text-[10px] ${
                                  isSent
                                    ? "text-emerald-600/90 dark:text-emerald-400/90 group-hover:underline"
                                    : "text-blue-700/90 dark:text-blue-300/90 group-hover:underline"
                                }`}
                              >
                                {isSent ? "查看记录" : "查看详情"}
                              </span>

                              {isSent ? (
                                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-200 px-1 py-0 text-[9px] font-medium border">
                                  已发送
                                </Badge>
                              ) : isFailed ? (
                                <Badge variant="outline" className="border-rose-300 text-rose-700 bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:bg-rose-950/40 px-1 py-0 text-[9px] font-normal">
                                  失败
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 悬停事件详情卡片 */}
      {hoveredTask && (
        <TaskHoverCard
          task={hoveredTask.task}
          anchorRect={hoveredTask.rect}
        />
      )}
    </CardShell>
  );
}

function TaskHoverCard({
  task,
  anchorRect,
}: {
  task: ReminderTask;
  anchorRect: { top: number; left: number; width: number; height: number };
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(260);

  useEffect(() => {
    if (cardRef.current) {
      setMeasuredHeight(cardRef.current.offsetHeight);
    }
  }, [task]);

  const popoverWidth = 320;
  const padding = 12;

  const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const windowHeight = typeof window !== "undefined" ? window.innerHeight : 800;

  const anchorRight = anchorRect.left + anchorRect.width;

  // 判断是否靠右边（卡片中心在视口中线以右，或者在卡片右侧放置不下时，弹出在卡片左侧，完全不遮挡原卡片）
  const placeOnLeft =
    anchorRect.left + anchorRect.width / 2 > windowWidth / 2 ||
    anchorRight + popoverWidth + padding > windowWidth;

  let left = 0;
  let top = anchorRect.top;

  if (windowWidth < 680) {
    // 窄屏小设备：上下弹出
    left = Math.max(padding, Math.min(anchorRect.left, windowWidth - popoverWidth - padding));
    const placeAbove = anchorRect.top - measuredHeight - 8 > 0;
    top = placeAbove ? anchorRect.top - measuredHeight - 8 : anchorRect.top + anchorRect.height + 8;
  } else if (placeOnLeft) {
    // 靠右侧：弹出在卡片左侧，距离卡片左边缘 10px，原卡片及整列卡片完全不被遮挡
    left = anchorRect.left - popoverWidth - 10;
    if (left < padding) left = padding;
  } else {
    // 靠左侧：弹出在卡片右侧，距离卡片右边缘 10px
    left = anchorRight + 10;
    if (left + popoverWidth > windowWidth - padding) {
      left = windowWidth - popoverWidth - padding;
    }
  }

  // 垂直位置调整：避免下方超出屏幕
  if (top + measuredHeight > windowHeight - padding) {
    top = windowHeight - measuredHeight - padding;
  }
  if (top < padding) {
    top = padding;
  }

  const isSent = task.status === "sent";
  const isPostponed = task.status === "postponed";
  const isFailed = task.status === "failed";
  const isKM = task.scheduleId.startsWith("knowledge-migration:");
  const isSystemHost =
    !task.host?.name ||
    task.host.name.startsWith("系统") ||
    task.host.name === "定时任务" ||
    task.host.name === "手动触发";
  const triggerLabel = task.triggerType === "manual" ? "手动发送" : "定时发送";

  return (
    <div
      ref={cardRef}
      style={{ top: `${Math.max(8, top)}px`, left: `${left}px`, width: `${popoverWidth}px` }}
      className="fixed z-50 pointer-events-none rounded-xl border border-border/90 bg-popover/95 p-3.5 text-popover-foreground shadow-2xl backdrop-blur-md transition-all animate-in fade-in-0 zoom-in-95"
    >
      {/* 头部：标题与状态 Badge */}
      <div className="flex items-start justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-semibold text-xs leading-snug text-foreground">
            {isSent ? (
              <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
            ) : isPostponed ? (
              <CalendarX className="size-3.5 text-amber-500 shrink-0" />
            ) : isFailed ? (
              <AlertCircle className="size-3.5 text-rose-500 shrink-0" />
            ) : (
              <Clock className="size-3.5 text-blue-500 shrink-0" />
            )}
            <span className="truncate">{task.scheduleName}</span>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground truncate">
            {isKM ? "飞书知识库归档与文档贡献统计" : "团队定时消息通知与轮值排期"}
          </p>
        </div>

        {/* 状态徽章 */}
        {isSent ? (
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-200 text-[10px] px-1.5 py-0 shrink-0 border">
            已成功发送
          </Badge>
        ) : isPostponed ? (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
            已延期
          </Badge>
        ) : isFailed ? (
          <Badge variant="outline" className="border-rose-300 text-rose-700 bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:bg-rose-950/40 text-[10px] px-1.5 py-0 shrink-0">
            发送失败
          </Badge>
        ) : (
          <Badge className="bg-blue-600 text-white dark:bg-blue-500 border-transparent text-[10px] px-1.5 py-0 shrink-0 font-medium">
            待发送
          </Badge>
        )}
      </div>

      {/* 核心属性 */}
      <div className="mt-2.5 space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>当前状态：</span>
          <span className="font-medium text-foreground">
            {isSent ? "已发生（已完成推送）" : isPostponed ? "本期已延期" : isFailed ? "执行失败" : "待执行（等待到达预定时间）"}
          </span>
        </div>

        {!isSystemHost && (
          <div className="flex items-center justify-between text-muted-foreground">
            <span>负责人 / 主持人：</span>
            <span className="font-medium text-foreground flex items-center gap-1">
              <User className="size-3 text-muted-foreground" />
              {task.host.name}
              {task.isSwapped && <span className="text-[10px] text-indigo-500 font-semibold">(换班)</span>}
              {task.isOverridden && !task.isSwapped && <span className="text-[10px] text-amber-500 font-semibold">(临时覆盖)</span>}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between text-muted-foreground">
          <span>计划排期：</span>
          <span className="font-mono text-foreground font-medium">
            {formatFullDateTime(task.scheduledAt)}
          </span>
        </div>

        {task.sentAt && (
          <div className="flex items-center justify-between text-muted-foreground">
            <span>实际发送：</span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">
              {formatFullDateTime(task.sentAt)}
            </span>
          </div>
        )}

        {task.botName && (
          <div className="flex items-center justify-between text-muted-foreground">
            <span>推送机器人：</span>
            <span className="text-foreground font-medium">{task.botName}</span>
          </div>
        )}
      </div>

      {/* 详细内容 / 摘要 */}
      {task.content && (
        <div className="mt-2.5 rounded-lg border border-border/70 bg-secondary/40 p-2 text-[11px] leading-relaxed">
          <div className="font-medium text-foreground mb-1 text-[10px] flex items-center gap-1">
            <Sparkles className="size-3 text-indigo-500" />
            <span>详情摘要</span>
          </div>
          <div className="line-clamp-4 overflow-hidden break-words text-muted-foreground">
            {task.content}
          </div>
        </div>
      )}

      {/* 错误详情 */}
      {task.error && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/80 p-2 text-[11px] text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          <span className="font-semibold">错误信息：</span> {task.error}
        </div>
      )}

      {/* 底部点击提示 */}
      <div className="mt-2.5 flex items-center justify-between border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1 text-foreground/80">
          <ExternalLink className="size-3 text-muted-foreground" />
          点击卡片前往对应详情页
        </span>
        <span className="font-mono text-[9px] text-muted-foreground/60">
          {isSent ? "已完成事件" : isPostponed ? "已延期事件" : "未执行排期"}
        </span>
      </div>
    </div>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return <section className="mb-8 overflow-hidden rounded-xl border border-border bg-card shadow-xs">{children}</section>;
}
