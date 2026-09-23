"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Bot,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderTree,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublicBotConfig, ReminderSchedule, ReminderTask } from "@/lib/types";
import { computeWeekPeriodInfo } from "@/lib/bots/weekly-report/period";

const weekdays = ["", "每周一", "每周二", "每周三", "每周四", "每周五", "每周六", "每周日"];

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
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

const inputControlClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

type ToastState = { message: string; tone: "success" | "error"; seconds: number };

export default function WeeklyReportPage() {
  const [schedule, setSchedule] = useState<ReminderSchedule>();
  const [bots, setBots] = useState<PublicBotConfig[]>([]);
  const [upcoming, setUpcoming] = useState<ReminderTask[]>([]);
  const [history, setHistory] = useState<ReminderTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    success?: boolean;
    url?: string;
    message?: string;
    nodeToken?: string;
  }>();

  const [toast, setToast] = useState<ToastState>();
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const showToast = useCallback((message: string, tone: ToastState["tone"] = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toastIntervalRef.current) clearInterval(toastIntervalRef.current);
    setToast({ message, tone, seconds: 3 });
    toastIntervalRef.current = setInterval(() => {
      setToast((current) => (current ? { ...current, seconds: Math.max(0, current.seconds - 1) } : current));
    }, 1000);
    toastTimerRef.current = setTimeout(() => {
      setToast(undefined);
      if (toastIntervalRef.current) clearInterval(toastIntervalRef.current);
    }, 3000);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/weekly-report", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setSchedule(data.schedule);
        setBots(data.bots || []);
        setUpcoming(data.upcoming || []);
        setHistory(data.history || []);
      }
    } catch {
      showToast("加载周报配置失败", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSaveConfig = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!schedule) return;
    setSaving(true);
    const form = new FormData(e.currentTarget);
    try {
      const payload = {
        name: String(form.get("name") || "").trim(),
        dayOfWeek: Number(form.get("dayOfWeek")),
        time: String(form.get("time") || "").trim(),
        sourceDocumentId: String(form.get("sourceDocumentId") || "").trim(),
        targetFolderId: String(form.get("targetFolderId") || "").trim(),
        botId: String(form.get("botId") || "").trim(),
        enabled: form.get("enabled") === "on",
      };
      const res = await fetch("/api/weekly-report", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (res.ok) {
        showToast("周报定时配置已保存。");
        await loadData();
      } else {
        showToast(result.error ?? "保存失败", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleExecuteNow = async () => {
    if (executing) return;
    setExecuting(true);
    setExecutionResult(undefined);
    try {
      const res = await fetch("/api/weekly-report/execute", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        showToast("本周周报已成功生成并归档！");
        setExecutionResult({
          success: true,
          url: data.result?.documentUrl,
          message: data.result?.content,
          nodeToken: data.result?.createdNodeToken,
        });
        await loadData();
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
      setExecutionResult({
        success: false,
        message: msg,
      });
    } finally {
      setExecuting(false);
    }
  };

  const periodPreview = computeWeekPeriodInfo(new Date());

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 侧边栏 */}
      <aside className="fixed inset-y-0 w-60 border-r border-border bg-card px-3 py-6 select-none">
        <div className="mb-8 flex items-center gap-2.5 px-3 text-sm font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-mono font-medium text-background">
            F
          </span>
          <span>前端机器人</span>
        </div>
        <nav className="space-y-1 text-sm font-medium">
          <Link
            href="/"
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <CalendarClock className="size-4" />
            <span>定时任务</span>
          </Link>
          <div className="flex w-full items-center gap-2.5 rounded-md bg-secondary px-3 py-2 text-left font-medium text-foreground">
            <FileSpreadsheet className="size-4" />
            <span>周报归档</span>
          </div>
          <Link
            href="/"
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Bot className="size-4" />
            <span>机器人配置</span>
          </Link>
          <Link
            href="/"
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Send className="size-4" />
            <span>发送记录</span>
          </Link>
          <Link
            href="/knowledge-migration"
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <BookOpen className="size-4" />
            <span>知识库归档</span>
          </Link>
        </nav>
      </aside>

      {/* 主内容区 */}
      <main className="ml-60 max-w-[1400px] p-8 lg:p-10">
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

        {/* 顶部标题与操作栏 */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{schedule?.name ?? "前端周报更新提醒"}</h1>
              <Badge variant={schedule?.enabled ? "success" : "secondary"}>
                {schedule?.enabled ? "定时启用中" : "已停用"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              按设定周期拉取周报模板源文档，在飞书知识库目标根目录下按「年份 / 月份 / 周报标题（x月x日 - x月x日）」自动创建目录层级并同步正文内容
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadData()}
              disabled={loading}
              title="刷新配置与状态"
            >
              <RotateCcw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>刷新</span>
            </Button>
            <Button
              size="sm"
              onClick={handleExecuteNow}
              disabled={executing || !schedule?.sourceDocumentId || !schedule?.targetFolderId}
              title="立即读取源模板并在目标知识库创建本周周报"
            >
              {executing ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              <span>{executing ? "生成中…" : "立即执行一次"}</span>
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

        {/* 指标卡片 */}
        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">执行周期</p>
              <p className="mt-2 text-base font-semibold tracking-tight text-foreground">
                {schedule ? `${weekdays[schedule.dayOfWeek]} ${schedule.time}` : "未配置"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">本周生成标题</p>
              <p className="mt-2 font-mono text-base font-semibold tracking-tight text-foreground truncate" title={periodPreview.weekTitle}>
                {periodPreview.weekTitle}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">归档层级预览</p>
              <p className="mt-2 text-sm font-medium tracking-tight text-foreground truncate" title={`${periodPreview.yearName} / ${periodPreview.monthName}`}>
                {periodPreview.yearName} / {periodPreview.monthName}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">最近一次执行</p>
              <p className="mt-2 font-mono text-sm font-semibold tracking-tight tabular-nums text-foreground">
                {schedule?.lastSentAt ? formatDate(schedule.lastSentAt) : "尚未触发"}
              </p>
            </CardContent>
          </Card>
        </section>

        {/* 配置表单 */}
        {schedule && (
          <Card className="mb-8">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">定时与目录配置</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    配置周报模板的读取来源与归档目标路径
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <form onSubmit={handleSaveConfig}>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 text-sm">
                  <label className="grid gap-2 font-medium">
                    <span>任务名称</span>
                    <input
                      className={inputControlClass}
                      name="name"
                      defaultValue={schedule.name}
                      placeholder="例如：周报模板自动归档"
                      required
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-2 font-medium">
                      <span>执行日</span>
                      <select
                        className={inputControlClass}
                        name="dayOfWeek"
                        defaultValue={schedule.dayOfWeek}
                      >
                        {weekdays.slice(1).map((day, idx) => (
                          <option key={day} value={idx + 1}>
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
                        defaultValue={schedule.time}
                        required
                      />
                    </label>
                  </div>

                  <label className="grid gap-2 font-medium md:col-span-2">
                    <span>飞书模板源文档地址（拉取此文档的内容）</span>
                    <input
                      className={inputControlClass}
                      name="sourceDocumentId"
                      type="url"
                      placeholder="https://xxx.feishu.cn/wiki/... 或 /docx/... 链接"
                      defaultValue={schedule.sourceDocumentId || ""}
                      required
                    />
                  </label>

                  <label className="grid gap-2 font-medium md:col-span-2">
                    <span>飞书目标知识库根目录（自动在此目录下创建 年/月/周报 目录树）</span>
                    <input
                      className={inputControlClass}
                      name="targetFolderId"
                      type="url"
                      placeholder="https://xxx.feishu.cn/wiki/... 知识库根节点链接或 wikiToken"
                      defaultValue={schedule.targetFolderId || ""}
                      required
                    />
                  </label>

                  <label className="grid gap-2 font-medium md:col-span-2">
                    <span>关联通知机器人（生成周报后自动发送群提醒，可选）</span>
                    <select
                      className={inputControlClass}
                      name="botId"
                      defaultValue={schedule.botId}
                    >
                      <option value="">不发送群提醒（仅生成文档）</option>
                      {bots.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} {b.enabled ? "" : "（已停用）"}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex items-center gap-2.5 md:col-span-2 text-sm font-normal select-none pt-1">
                    <input
                      name="enabled"
                      type="checkbox"
                      className="size-4 rounded border-input text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                      defaultChecked={schedule.enabled}
                    />
                    <span>启用定时自动执行</span>
                  </label>
                </div>

                <div className="mt-6 flex justify-end gap-2.5 border-t border-border pt-4">
                  <Button size="sm" type="submit" disabled={saving}>
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    <span>{saving ? "保存中…" : "保存配置"}</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* 目录层级规范说明卡片 */}
        <Card className="mb-8 border-dashed bg-secondary/20">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <FolderTree className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">自动归档层级结构说明</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>每次执行时，系统会自动在您设定的「目标知识库根目录」下按以下规则检查并递归创建：</p>
            <div className="rounded-md border border-border bg-card p-3 font-mono text-[12px] text-foreground">
              <div>📁 目标知识库根目录</div>
              <div className="ml-4 text-muted-foreground">└─ 📁 {periodPreview.yearName}（如 2026年）</div>
              <div className="ml-8 text-muted-foreground">└─ 📁 {periodPreview.monthName}（如 9月）</div>
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
                      <th className="px-6 py-3 font-medium text-right">状态</th>
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
                            <Badge variant="outline" className="text-[10px]">
                              待执行
                            </Badge>
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
            {history.length === 0 ? (
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
      </main>
    </div>
  );
}
