"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileEdit,
  FileSearch,
  FileText,
  History,
  Link2,
  ListChecks,
  ListTodo,
  LoaderCircle,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UsersRound,
  X,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { meetingScenarioMeta } from "@/lib/meeting/types";
import type {
  MeetingAnalysis,
  MeetingAnalysisStatus,
  MeetingPromptTemplate,
  MultiMeetingRiskAssessment,
} from "@/lib/meeting/types";

const statusMeta: Record<MeetingAnalysisStatus, { label: string; className: string }> = {
  completed: { label: "已完成", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  analyzing: { label: "分析中", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  failed: { label: "失败", className: "bg-red-50 text-red-700 ring-red-200" },
};

function formatDate(value?: string) {
  if (!value) return "日期未识别";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function MeetingHistory({
  initialMeetings,
  initialPrompts,
}: {
  initialMeetings: MeetingAnalysis[];
  initialPrompts: MeetingPromptTemplate[];
}) {
  const router = useRouter();
  const [meetings, setMeetings] = useState(initialMeetings);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | MeetingAnalysisStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [riskAssessmentOpen, setRiskAssessmentOpen] = useState(false);

  // 表单状态
  const [sourceUrl, setSourceUrl] = useState("");
  const [personalNotes, setPersonalNotes] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const defaultPromptId =
    initialPrompts.find((p) => p.id === "builtin_meeting_action")?.id ||
    initialPrompts.find((p) => p.id === "builtin_technical_weekly")?.id ||
    initialPrompts[0]?.id ||
    "";
  const [promptId, setPromptId] = useState(defaultPromptId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 编辑与重新生成状态
  const [editingMeeting, setEditingMeeting] = useState<MeetingAnalysis | null>(null);
  const [editSourceUrl, setEditSourceUrl] = useState("");
  const [editPersonalNotes, setEditPersonalNotes] = useState("");
  const [editSeriesName, setEditSeriesName] = useState("");
  const [editPromptId, setEditPromptId] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");

  function startEdit(meeting: MeetingAnalysis) {
    setEditingMeeting(meeting);
    setEditSourceUrl(meeting.sourceUrl || "");
    setEditPersonalNotes(meeting.personalNotes || "");
    setEditSeriesName(meeting.seriesName || "");
    setEditPromptId(meeting.promptId || defaultPromptId);
    setEditError("");
  }

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingMeeting) return;
    if (!editSourceUrl.trim() && !editPersonalNotes.trim()) {
      setEditError("请至少提供飞书会议文档链接或输入个人记录的文本纪要");
      return;
    }
    if (editSourceUrl.trim() && !/feishu\.cn\/(docx|docs|wiki)\//i.test(editSourceUrl.trim())) {
      setEditError("目前仅支持飞书文档、妙记整理稿或 Wiki 文档链接");
      return;
    }
    setEditSubmitting(true);
    setEditError("");
    try {
      const response = await fetch(`/api/meetings/${editingMeeting.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: editSourceUrl.trim() || "",
          personalNotes: editPersonalNotes.trim() || "",
          seriesName: editSeriesName.trim() || "",
          promptId: editPromptId || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.meeting) throw new Error(data.error || "重新生成失败");
      router.push(`/meeting/${data.meeting.id}`);
    } catch (err: any) {
      setEditError(err.message || "重新生成失败");
      setEditSubmitting(false);
    }
  }

  async function submitSaveOnly() {
    if (!editingMeeting) return;
    if (!editSourceUrl.trim() && !editPersonalNotes.trim()) {
      setEditError("请至少提供飞书会议文档链接或输入个人记录的文本纪要");
      return;
    }
    if (editSourceUrl.trim() && !/feishu\.cn\/(docx|docs|wiki)\//i.test(editSourceUrl.trim())) {
      setEditError("目前仅支持飞书文档、妙记整理稿或 Wiki 文档链接");
      return;
    }
    setEditSubmitting(true);
    setEditError("");
    try {
      const response = await fetch(`/api/meetings/${editingMeeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: editSourceUrl.trim() || null,
          personalNotes: editPersonalNotes.trim() || null,
          seriesName: editSeriesName.trim() || null,
          promptId: editPromptId || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.meeting) throw new Error(data.error || "保存失败");
      setMeetings((prev) => prev.map((m) => (m.id === data.meeting.id ? data.meeting : m)));
      setEditingMeeting(null);
    } catch (err: any) {
      setEditError(err.message || "保存失败");
    } finally {
      setEditSubmitting(false);
    }
  }

  // 风险评估状态
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<MultiMeetingRiskAssessment | null>(null);
  const [assessmentError, setAssessmentError] = useState("");

  const selectedPrompt = initialPrompts.find((prompt) => prompt.id === promptId);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return meetings.filter((meeting) => {
      if (filter !== "all" && meeting.status !== filter) return false;
      if (!normalized) return true;
      return [meeting.title, meeting.sourceTitle, meeting.seriesName, meeting.summary]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized));
    });
  }, [filter, meetings, query]);

  const totals = meetings.reduce(
    (result, meeting) => ({
      meetings: result.meetings + 1,
      actions: result.actions + (meeting.actionItems?.length || 0),
      unfinished: result.unfinished + (meeting.actionItems?.filter((item) => item.status !== "completed").length || 0),
      risks: result.risks + (meeting.risks?.length || 0),
    }),
    { meetings: 0, actions: 0, unfinished: 0, risks: 0 },
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!sourceUrl.trim() && !personalNotes.trim()) {
      setError("请至少提供飞书会议文档链接或输入个人记录的文本纪要");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: sourceUrl.trim() || undefined,
          personalNotes: personalNotes.trim() || undefined,
          promptId,
          seriesName: seriesName.trim() || undefined,
        }),
      });
      const body = (await response.json()) as { meeting?: MeetingAnalysis; error?: string };
      if (!response.ok || !body.meeting) throw new Error(body.error || "会议分析失败");
      router.push(`/meeting/${body.meeting.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "会议分析失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function triggerRiskAssessment() {
    setAssessing(true);
    setAssessmentError("");
    try {
      const response = await fetch("/api/meetings/risk-assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 8 }),
      });
      const data = (await response.json()) as { assessment?: MultiMeetingRiskAssessment; error?: string };
      if (!response.ok || !data.assessment) {
        throw new Error(data.error || "风险评估失败");
      }
      setAssessment(data.assessment);
    } catch (err) {
      setAssessmentError(err instanceof Error ? err.message : "风险评估生成失败");
    } finally {
      setAssessing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#1f2735]">
      <AppSidebar />
      <main className="ml-60 min-h-screen">
        <header className="border-b border-[#e7eaf0] bg-white">
          <div className="flex h-16 items-center justify-between px-8">
            <div>
              <h1 className="text-[17px] font-semibold tracking-[-0.02em]">会议行动</h1>
              <p className="mt-0.5 text-xs text-[#8a94a3]">
                提取会议纪要、TODO 与风险，支持识别开会日期与多维表格导出
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setRiskAssessmentOpen(true);
                  if (!assessment && !assessing) {
                    triggerRiskAssessment();
                  }
                }}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dfe4eb] bg-white px-3.5 text-sm font-medium text-[#566273] hover:bg-[#f7f8fa]"
              >
                <ShieldAlert size={15} className="text-amber-500" /> 多次会议风险评估
              </button>
              <Link
                href="/meeting/prompts"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dfe4eb] bg-white px-3.5 text-sm font-medium text-[#566273] hover:bg-[#f7f8fa]"
              >
                <Settings2 size={15} /> Prompt 管理
              </Link>
              <button
                onClick={() => setDialogOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#3370ff] px-3.5 text-sm font-medium text-white shadow-sm hover:bg-[#2864ed]"
              >
                <Plus size={16} /> 分析新会议
              </button>
            </div>
          </div>
        </header>

        <div className="w-full px-8 py-8">
          <section className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[#3370ff]">
                <Sparkles size={15} /> 智能执行闭环
              </p>
              <h2 className="text-[28px] font-semibold tracking-[-0.045em] text-[#202938]">
                会议记录与行动跟踪
              </h2>
              <p className="mt-2 text-sm text-[#727e91]">
                沉淀决议、跟进 TODO、暴露潜在风险，并结合多次会议日期推进闭环。
              </p>
            </div>
          </section>

          <section className="mb-6 grid gap-3 sm:grid-cols-4">
            <Metric icon={<FileText size={18} />} value={totals.meetings} label="已分析会议" tone="blue" />
            <Metric icon={<ListChecks size={18} />} value={totals.actions} label="累计行动项" tone="green" />
            <Metric icon={<Clock3 size={18} />} value={totals.unfinished} label="待推进事项" tone="orange" />
            <Metric icon={<AlertTriangle size={18} />} value={totals.risks} label="累计风险项" tone="red" />
          </section>

          <section className="overflow-hidden rounded-xl border border-[#e3e7ed] bg-white shadow-[0_1px_2px_rgba(24,36,56,.03)]">
            <div className="flex flex-col gap-3 border-b border-[#e9ecf1] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-1 rounded-lg bg-[#f4f6f8] p-1 text-xs font-medium">
                {(["all", "completed", "analyzing", "failed"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setFilter(status)}
                    className={`rounded-md px-3 py-1.5 transition ${
                      filter === status ? "bg-white text-[#293446] shadow-sm" : "text-[#7b8697] hover:text-[#3c4859]"
                    }`}
                  >
                    {status === "all" ? "全部" : statusMeta[status].label}
                  </button>
                ))}
              </div>
              <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-[#dfe4eb] bg-white px-3 text-sm sm:w-72 focus-within:border-[#8baaf5] focus-within:ring-2 focus-within:ring-[#3370ff]/10">
                <Search size={15} className="text-[#8b96a7]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索会议名称或系列"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#a4acb8]"
                />
              </label>
            </div>

            {filtered.length ? (
              <div className="divide-y divide-[#edf0f4]">
                {filtered.map((meeting) => (
                  <MeetingRow key={meeting.id} meeting={meeting} onEdit={() => startEdit(meeting)} />
                ))}
              </div>
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center px-6 py-14 text-center">
                <span className="grid size-12 place-items-center rounded-xl bg-[#edf3ff] text-[#4e75ce]">
                  <FileSearch size={23} />
                </span>
                <h3 className="mt-4 font-semibold text-[#354052]">
                  {meetings.length ? "没有符合条件的会议" : "还没有会议分析记录"}
                </h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-[#7c8798]">
                  {meetings.length
                    ? "换个关键词或筛选条件试试。"
                    : "添加飞书会议链接或粘贴个人记录文本纪要，系统将提炼会议纪要、TODO与风险。"}
                </p>
                {!meetings.length && (
                  <button
                    onClick={() => setDialogOpen(true)}
                    className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#3370ff] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2864ed]"
                  >
                    <Plus size={16} /> 分析第一场会议
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* 新建会议分析弹窗 */}
      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#172033]/35 p-4 backdrop-blur-[1px] overflow-y-auto"
          onMouseDown={(event) => event.target === event.currentTarget && !submitting && setDialogOpen(false)}
        >
          <form
            onSubmit={submit}
            className="w-full max-w-xl my-8 rounded-2xl border border-white/60 bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.025em]">分析新会议</h2>
                <p className="mt-1 text-sm text-[#7c8798]">
                  支持输入飞书会议文档链接，或直接粘贴个人记录的文本纪要进行联合分析。
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setDialogOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-[#7b8695] hover:bg-[#f3f5f7]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <label htmlFor="meeting-prompt" className="text-sm font-medium text-[#3d4859]">
                分析模板 <span className="text-red-500">*</span>
              </label>
              <Link href="/meeting/prompts" className="text-xs font-medium text-[#5273ba] hover:text-[#3370ff]">
                管理模板
              </Link>
            </div>
            <select
              id="meeting-prompt"
              required
              value={promptId}
              onChange={(event) => setPromptId(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-lg border border-[#dce2ea] bg-white px-3 text-sm outline-none focus:border-[#6e96f4] focus:ring-2 focus:ring-[#3370ff]/10"
            >
              {initialPrompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.builtIn ? "[内置] " : ""}
                  {prompt.name}
                </option>
              ))}
            </select>
            {selectedPrompt && (
              <div className="mt-2 rounded-lg bg-[#f5f8ff] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#4c6fb8] ring-1 ring-[#dbe5fa]">
                    {meetingScenarioMeta[selectedPrompt.scenario]?.label || "通用分析"}
                  </span>
                  {selectedPrompt.builtIn && <span className="text-[11px] text-[#8b96a6]">系统内置</span>}
                </div>
                <p className="mt-1 text-xs leading-5 text-[#66758c]">{selectedPrompt.description}</p>
              </div>
            )}

            {/* 飞书文档链接输入 */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-[#3d4859]">
                  飞书会议文档链接 <span className="font-normal text-[#98a1af]">（可选）</span>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSourceUrl("https://segway-ninebot.feishu.cn/docx/JP3cdOFWiohfq1x5wUqc2uAWnuf")
                  }
                  className="text-xs text-[#3370ff] hover:underline"
                >
                  填入示例链接
                </button>
              </div>
              <div className="mt-1.5 flex h-11 items-center gap-2 rounded-lg border border-[#dce2ea] px-3 focus-within:border-[#6e96f4] focus-within:ring-2 focus-within:ring-[#3370ff]/10">
                <Link2 size={16} className="shrink-0 text-[#8390a2]" />
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://segway-ninebot.feishu.cn/docx/..."
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a6afbb]"
                />
              </div>
            </div>

            {/* 个人记录文本纪要输入 */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-[#3d4859]">
                  个人记录文本纪要 <span className="font-normal text-[#98a1af]">（可选，支持多行文本或随堂速记）</span>
                </label>
              </div>
              <textarea
                rows={4}
                value={personalNotes}
                onChange={(event) => setPersonalNotes(event.target.value)}
                placeholder="可粘贴个人在会议中记录的要点、口头决议、补充待办或风险提示。系统将与飞书文档交叉印证融合分析..."
                className="mt-1.5 w-full rounded-lg border border-[#dce2ea] p-3 text-sm outline-none placeholder:text-[#a6afbb] focus:border-[#6e96f4] focus:ring-2 focus:ring-[#3370ff]/10 leading-relaxed resize-none"
              />
              <p className="mt-1 text-xs text-[#8a95a5]">
                💡 飞书会议文档与个人记录至少输入一项；两者皆有将交叉印证、互补遗漏。
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-[#3d4859]">
                会议系列 <span className="font-normal text-[#98a1af]">（可选）</span>
              </label>
              <input
                value={seriesName}
                onChange={(event) => setSeriesName(event.target.value)}
                placeholder="例如：FEB 前端周会、技术方案评审"
                className="mt-1.5 h-11 w-full rounded-lg border border-[#dce2ea] px-3 text-sm outline-none placeholder:text-[#a6afbb] focus:border-[#6e96f4] focus:ring-2 focus:ring-[#3370ff]/10"
              />
              <p className="mt-1 text-xs leading-5 text-[#8994a4]">
                填写同一系列名称后，系统会自动关联该系列上次会议未完成的行动项。
              </p>
            </div>

            {error && (
              <div className="mt-4 flex gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <CircleAlert size={16} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setDialogOpen(false)}
                className="h-10 rounded-lg border border-[#dfe4eb] px-4 text-sm font-medium text-[#566273] hover:bg-[#f7f8fa]"
              >
                取消
              </button>
              <button
                disabled={submitting || (!sourceUrl.trim() && !personalNotes.trim())}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#3370ff] px-4 text-sm font-medium text-white hover:bg-[#2864ed] disabled:opacity-60"
              >
                {submitting ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {submitting ? "正在读取并分析…" : "开始分析"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 多次会议风险评估弹窗 */}
      {riskAssessmentOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#172033]/40 p-4 backdrop-blur-[2px] overflow-y-auto"
          onMouseDown={(event) => event.target === event.currentTarget && setRiskAssessmentOpen(false)}
        >
          <div className="w-full max-w-2xl my-8 rounded-2xl border border-white/60 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
                  <ShieldAlert size={20} />
                </span>
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.025em]">多次会议综合风险评估</h2>
                  <p className="mt-0.5 text-xs text-[#7c8798]">
                    汇总近期多次会议风险项，识别持续未解决隐患与演变趋势
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRiskAssessmentOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-[#7b8695] hover:bg-[#f3f5f7]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5">
              {assessing ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <LoaderCircle size={32} className="animate-spin text-[#3370ff]" />
                  <p className="mt-4 text-sm font-medium text-[#2d3748]">正在结合最近多次会议进行风险深度研判…</p>
                  <p className="mt-1 text-xs text-[#8c97a8]">分析会议日期、跨周期风险收敛情况及依赖瓶颈</p>
                </div>
              ) : assessmentError ? (
                <div className="rounded-xl border border-red-200 bg-red-50/50 p-6 text-center">
                  <p className="text-sm font-medium text-red-700">{assessmentError}</p>
                  <button
                    onClick={triggerRiskAssessment}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#3370ff] hover:underline"
                  >
                    重试评估
                  </button>
                </div>
              ) : assessment ? (
                <div className="space-y-4">
                  {/* 整体态势卡片 */}
                  <div className="rounded-xl border border-[#e8ecf2] bg-[#f9fafc] p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[#637286]">综合风险评级</span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            assessment.overallRiskLevel === "high"
                              ? "bg-red-100 text-red-700 ring-1 ring-red-300"
                              : assessment.overallRiskLevel === "medium"
                              ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300"
                              : "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300"
                          }`}
                        >
                          {assessment.overallRiskLevel === "high"
                            ? "高危 (HIGH)"
                            : assessment.overallRiskLevel === "medium"
                            ? "中度 (MEDIUM)"
                            : "可控 (LOW)"}
                        </span>
                      </div>
                      <span className="text-xs text-[#8c97a8]">
                        覆盖 {assessment.meetingCount} 场会议（{assessment.dateRange.start || "近期"} ~{" "}
                        {assessment.dateRange.end || "至今"}）
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#455264]">{assessment.summary}</p>
                  </div>

                  {/* 持续反复风险 */}
                  {assessment.persistentRisks?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#606e82] mb-2 flex items-center gap-1.5">
                        <TrendingUp size={14} className="text-amber-500" /> 跨周期持续风险（需重点攻坚）
                      </h4>
                      <div className="space-y-2">
                        {assessment.persistentRisks.map((item, idx) => (
                          <div
                            key={idx}
                            className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3 text-xs leading-5"
                          >
                            <div className="flex items-center justify-between font-semibold text-[#2c3645]">
                              <span>{item.title}</span>
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 font-normal">
                                出现 {item.occurrences} 次
                              </span>
                            </div>
                            <p className="mt-1 text-[#5c6878]">
                              <span className="font-medium text-[#3c4756]">影响：</span>
                              {item.impact}
                            </p>
                            <p className="mt-0.5 text-[#5c6878]">
                              <span className="font-medium text-[#3c4756]">建议应对：</span>
                              {item.mitigation}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 近期新增风险 */}
                  {assessment.emergingRisks?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#606e82] mb-2 flex items-center gap-1.5">
                        <AlertTriangle size={14} className="text-red-500" /> 近期新增潜在风险
                      </h4>
                      <div className="space-y-2">
                        {assessment.emergingRisks.map((item, idx) => (
                          <div
                            key={idx}
                            className="rounded-lg border border-[#e8ecf2] bg-white p-3 text-xs leading-5"
                          >
                            <div className="flex items-center justify-between font-semibold text-[#2c3645]">
                              <span>{item.title}</span>
                              <span className="text-[11px] font-normal text-[#8a95a5]">
                                来自：{item.fromMeetingTitle} ({item.meetingDate || "近期"})
                              </span>
                            </div>
                            <p className="mt-1 text-[#657384]">{item.impact}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 防范建议 */}
                  {assessment.recommendations?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#606e82] mb-2 flex items-center gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-500" /> 改进与防范建议
                      </h4>
                      <ul className="list-inside list-disc space-y-1 rounded-lg border border-[#e8ecf2] bg-white p-3 text-xs text-[#455264] leading-relaxed">
                        {assessment.recommendations.map((rec, idx) => (
                          <li key={idx}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-[#8a95a5]">暂无风险评估数据</div>
              )}
            </div>

            <div className="mt-6 flex justify-between items-center border-t border-[#edf0f4] pt-4">
              <span className="text-xs text-[#8a95a5]">
                {assessment ? `评估时间：${formatDate(assessment.createdAt)}` : ""}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRiskAssessmentOpen(false)}
                  className="h-9 rounded-lg border border-[#dfe4eb] px-3.5 text-xs font-medium text-[#566273] hover:bg-[#f7f8fa]"
                >
                  关闭
                </button>
                <button
                  disabled={assessing}
                  onClick={triggerRiskAssessment}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#3370ff] px-3.5 text-xs font-medium text-white hover:bg-[#2864ed] disabled:opacity-70"
                >
                  {assessing ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  重新评估
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 针对单条任务的编辑与重新生成弹窗 */}
      {editingMeeting && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#172033]/40 p-4 backdrop-blur-[2px] overflow-y-auto"
          onMouseDown={(event) =>
            event.target === event.currentTarget && !editSubmitting && setEditingMeeting(null)
          }
        >
          <div className="w-full max-w-2xl my-8 rounded-2xl bg-white p-6 shadow-2xl border border-white/60">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-[#3370ff]">
                  <FileEdit size={19} />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-[#1f2735]">编辑会议纪要与重新生成</h2>
                  <p className="mt-0.5 text-xs text-[#718096]">
                    正在编辑「{editingMeeting.title}」的输入来源
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={editSubmitting}
                onClick={() => setEditingMeeting(null)}
                className="grid size-8 place-items-center rounded-lg text-[#7c8797] hover:bg-[#f3f5f7]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submitEdit} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#3d4859] mb-1">
                  分析模板
                </label>
                <select
                  value={editPromptId}
                  onChange={(e) => setEditPromptId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#dce2ea] bg-white px-3 text-xs outline-none focus:border-[#6e96f4]"
                >
                  {initialPrompts.map((prompt) => (
                    <option key={prompt.id} value={prompt.id}>
                      {prompt.builtIn ? "[内置] " : ""}
                      {prompt.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-[#3d4859]">
                    飞书会议文档链接 <span className="font-normal text-[#98a1af]">（可选）</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setEditSourceUrl(
                          "https://segway-ninebot.feishu.cn/docx/JP3cdOFWiohfq1x5wUqc2uAWnuf"
                        )
                      }
                      className="text-[11px] text-[#3370ff] hover:underline"
                    >
                      填入示例链接
                    </button>
                    {editSourceUrl && (
                      <button
                        type="button"
                        onClick={() => setEditSourceUrl("")}
                        className="text-[11px] text-[#8a95a5] hover:text-red-500"
                      >
                        清空
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex h-10 items-center gap-2 rounded-lg border border-[#dce2ea] px-3 focus-within:border-[#6e96f4] focus-within:ring-2 focus-within:ring-[#3370ff]/10">
                  <Link2 size={15} className="shrink-0 text-[#8390a2]" />
                  <input
                    type="url"
                    value={editSourceUrl}
                    onChange={(e) => setEditSourceUrl(e.target.value)}
                    placeholder="https://segway-ninebot.feishu.cn/docx/..."
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[#a6afbb]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-[#3d4859]">
                    个人记录文本纪要 <span className="font-normal text-[#98a1af]">（可选，支持多行速记、口头决议或补充待办）</span>
                  </label>
                  <span className="text-[11px] text-[#9aa4b2]">
                    {editPersonalNotes.length} 字
                  </span>
                </div>
                <textarea
                  rows={5}
                  value={editPersonalNotes}
                  onChange={(e) => setEditPersonalNotes(e.target.value)}
                  placeholder="可粘贴或修改个人在会议中记录的要点、口头决议、补充待办或风险提示..."
                  className="w-full rounded-lg border border-[#dce2ea] p-3 text-xs outline-none placeholder:text-[#a6afbb] focus:border-[#6e96f4] focus:ring-2 focus:ring-[#3370ff]/10 leading-relaxed resize-y font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3d4859] mb-1">
                  会议系列名称 <span className="font-normal text-[#98a1af]">（可选）</span>
                </label>
                <input
                  type="text"
                  value={editSeriesName}
                  onChange={(e) => setEditSeriesName(e.target.value)}
                  placeholder="例如：FEB 前端周会、技术方案评审"
                  className="h-9 w-full rounded-lg border border-[#dce2ea] px-3 text-xs outline-none focus:border-[#6e96f4]"
                />
              </div>

              <div className="rounded-lg border border-amber-200/60 bg-amber-50/50 p-2.5 text-xs text-[#7d5e2a] leading-relaxed">
                💡 <strong>重新生成提示：</strong>将根据修改后的文档链接或速记文本重新运行 AI 分析并更新全部会议纪要、TODO 和风险。
              </div>

              {editError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
                  <CircleAlert size={15} className="shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              <div className="mt-5 flex items-center justify-between border-t border-[#edf0f4] pt-4">
                <button
                  type="button"
                  disabled={editSubmitting}
                  onClick={() => setEditingMeeting(null)}
                  className="h-9 rounded-lg border border-[#dfe4eb] px-4 text-xs font-medium text-[#566273] hover:bg-[#f7f8fa]"
                >
                  取消
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={editSubmitting || (!editSourceUrl.trim() && !editPersonalNotes.trim())}
                    onClick={submitSaveOnly}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#3370ff]/40 bg-[#f4f7fe] px-3.5 text-xs font-medium text-[#3370ff] hover:bg-[#ebf2fe] disabled:opacity-50 transition"
                  >
                    <Save size={14} />
                    <span>仅保存修改</span>
                  </button>
                  <button
                    type="submit"
                    disabled={editSubmitting || (!editSourceUrl.trim() && !editPersonalNotes.trim())}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#3370ff] px-4 text-xs font-medium text-white hover:bg-[#2864ed] disabled:opacity-60 shadow-sm"
                  >
                    {editSubmitting ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {editSubmitting ? "正在重新生成…" : "保存并重新生成"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MeetingRow({
  meeting,
  onEdit,
}: {
  meeting: MeetingAnalysis;
  onEdit: () => void;
}) {
  const meta = statusMeta[meeting.status];
  const outstanding = meeting.actionItems?.filter((item) => item.status !== "completed").length || 0;
  const decisionsCount = meeting.decisions?.length || 0;
  const risksCount = meeting.risks?.length || 0;
  const actionsCount = meeting.actionItems?.length || 0;

  return (
    <Link
      href={`/meeting/${meeting.id}`}
      className="group grid gap-4 px-5 py-5 transition hover:bg-[#fafbfc] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-[15px] font-semibold text-[#303a49] group-hover:text-[#295fdf]">
            {meeting.title}
          </h3>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.className}`}>
            {meta.label}
          </span>
          <span className="rounded-full bg-[#eef3ff] px-2 py-0.5 text-[11px] text-[#4c6fb8]">
            {meeting.promptName || meetingScenarioMeta[meeting.scenario || "meeting_action"]?.label || "会议行动"}
          </span>
          {meeting.seriesName && (
            <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[11px] text-[#687486]">
              {meeting.seriesName}
            </span>
          )}
          {meeting.personalNotes && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-200/60">
              含个人速记
            </span>
          )}
        </div>
        <p className="mt-1.5 line-clamp-1 text-sm text-[#7a8596]">
          {meeting.status === "failed" ? meeting.error : meeting.summary || meeting.sourceTitle}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#8a95a5]">
          <span className="flex items-center gap-1.5 font-medium text-[#465467]">
            <CalendarDays size={13} className="text-[#3370ff]" />
            开会日期：{formatDate(meeting.meetingDate || meeting.createdAt)}
          </span>
          {meeting.durationMinutes && (
            <span className="flex items-center gap-1.5">
              <Clock3 size={13} />
              {meeting.durationMinutes} 分钟
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <UsersRound size={13} />
            {meeting.participants?.length || "—"} 人
          </span>
          <span className="flex items-center gap-1.5">
            <BadgeCheck size={13} className="text-emerald-600" />
            {decisionsCount} 纪要
          </span>
          <span className="flex items-center gap-1.5">
            <ListTodo size={13} className="text-blue-600" />
            {actionsCount} TODO
          </span>
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-amber-600" />
            {risksCount} 风险
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 md:justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEdit();
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d2d9e4] bg-white px-2.5 text-xs font-medium text-[#445266] hover:bg-[#f2f4f7] hover:text-[#3370ff] hover:border-[#3370ff]/40 transition shadow-xs"
          title="编辑会议输入并重新生成"
        >
          <FileEdit size={13} className="text-[#3370ff]" />
          <span>编辑 / 重新生成</span>
        </button>
        <div className="text-right">
          <p className={`text-lg font-semibold ${outstanding ? "text-[#d18418]" : "text-[#1a9a6b]"}`}>
            {outstanding}
          </p>
          <p className="text-[11px] text-[#919aa8]">待推进 TODO</p>
        </div>
        <ArrowRight
          size={17}
          className="text-[#a0a9b6] transition group-hover:translate-x-0.5 group-hover:text-[#3370ff]"
        />
      </div>
    </Link>
  );
}

function Metric({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone: "blue" | "green" | "orange" | "red";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    orange: "bg-amber-50 text-amber-600",
    red: "bg-rose-50 text-rose-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#e4e8ee] bg-white px-4 py-4">
      <span className={`grid size-10 place-items-center rounded-lg ${colors[tone]}`}>{icon}</span>
      <div>
        <p className="text-xl font-semibold tracking-[-0.03em]">{value}</p>
        <p className="mt-0.5 text-xs text-[#818c9c]">{label}</p>
      </div>
    </div>
  );
}
