"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CircleAlert,
  Clock3,
  FileSearch,
  FileText,
  Link2,
  ListChecks,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { meetingScenarioMeta } from "@/lib/meeting/types";
import type { MeetingAnalysis, MeetingAnalysisStatus, MeetingPromptTemplate } from "@/lib/meeting/types";

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

export function MeetingHistory({ initialMeetings, initialPrompts }: { initialMeetings: MeetingAnalysis[]; initialPrompts: MeetingPromptTemplate[] }) {
  const router = useRouter();
  const [meetings] = useState(initialMeetings);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | MeetingAnalysisStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [promptId, setPromptId] = useState(initialPrompts.find((prompt) => prompt.id === "builtin_technical_weekly")?.id || initialPrompts[0]?.id || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
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
      actions: result.actions + meeting.actionItems.length,
      unfinished: result.unfinished + meeting.actionItems.filter((item) => item.status !== "completed").length,
    }),
    { meetings: 0, actions: 0, unfinished: 0 },
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl, promptId, seriesName: seriesName || undefined }),
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

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#1f2735]">
      <AppSidebar />
      <main className="ml-60 min-h-screen">
        <header className="border-b border-[#e7eaf0] bg-white">
          <div className="flex h-16 items-center justify-between px-8">
            <div>
              <h1 className="text-[17px] font-semibold tracking-[-0.02em]">会议行动</h1>
              <p className="mt-0.5 text-xs text-[#8a94a3]">从会议记录到可追踪的执行闭环</p>
            </div>
            <div className="flex items-center gap-2"><Link href="/meeting/prompts" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dfe4eb] bg-white px-3.5 text-sm font-medium text-[#566273] hover:bg-[#f7f8fa]"><Settings2 size={15} /> Prompt 管理</Link><button onClick={() => setDialogOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#3370ff] px-3.5 text-sm font-medium text-white shadow-sm hover:bg-[#2864ed]"><Plus size={16} /> 分析新会议</button></div>
          </div>
        </header>

        <div className="w-full px-8 py-8">
          <section className="mb-7">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[#3370ff]"><Sparkles size={15} /> 历史分析</p>
            <h2 className="text-[28px] font-semibold tracking-[-0.045em] text-[#202938]">会议记录</h2>
            <p className="mt-2 text-sm text-[#727e91]">回看决议、分歧与行动项，继续推进未完成工作。</p>
          </section>

          <section className="mb-6 grid gap-3 sm:grid-cols-3">
            <Metric icon={<FileText size={18} />} value={totals.meetings} label="已分析会议" tone="blue" />
            <Metric icon={<ListChecks size={18} />} value={totals.actions} label="累计行动项" tone="green" />
            <Metric icon={<Clock3 size={18} />} value={totals.unfinished} label="待推进事项" tone="orange" />
          </section>

          <section className="overflow-hidden rounded-xl border border-[#e3e7ed] bg-white shadow-[0_1px_2px_rgba(24,36,56,.03)]">
            <div className="flex flex-col gap-3 border-b border-[#e9ecf1] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-1 rounded-lg bg-[#f4f6f8] p-1 text-xs font-medium">
                {(["all", "completed", "analyzing", "failed"] as const).map((status) => (
                  <button key={status} onClick={() => setFilter(status)} className={`rounded-md px-3 py-1.5 transition ${filter === status ? "bg-white text-[#293446] shadow-sm" : "text-[#7b8697] hover:text-[#3c4859]"}`}>
                    {status === "all" ? "全部" : statusMeta[status].label}
                  </button>
                ))}
              </div>
              <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-[#dfe4eb] bg-white px-3 text-sm sm:w-72 focus-within:border-[#8baaf5] focus-within:ring-2 focus-within:ring-[#3370ff]/10">
                <Search size={15} className="text-[#8b96a7]" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会议名称或系列" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#a4acb8]" />
              </label>
            </div>

            {filtered.length ? (
              <div className="divide-y divide-[#edf0f4]">
                {filtered.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} />)}
              </div>
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center px-6 py-14 text-center">
                <span className="grid size-12 place-items-center rounded-xl bg-[#edf3ff] text-[#4e75ce]"><FileSearch size={23} /></span>
                <h3 className="mt-4 font-semibold text-[#354052]">{meetings.length ? "没有符合条件的会议" : "还没有会议分析记录"}</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-[#7c8798]">{meetings.length ? "换个关键词或筛选条件试试。" : "添加一篇飞书会议文档，分析结果会保存在这里，之后可随时回看和导出。"}</p>
                {!meetings.length && <button onClick={() => setDialogOpen(true)} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#3370ff] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2864ed]"><Plus size={16} /> 分析第一场会议</button>}
              </div>
            )}
          </section>
        </div>
      </main>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#172033]/35 p-4 backdrop-blur-[1px]" onMouseDown={(event) => event.target === event.currentTarget && !submitting && setDialogOpen(false)}>
          <form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-white/60 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><h2 className="text-lg font-semibold tracking-[-0.025em]">分析新会议</h2><p className="mt-1 text-sm text-[#7c8798]">系统会读取原文，并保留每一项结论的引用证据。</p></div>
              <button type="button" disabled={submitting} onClick={() => setDialogOpen(false)} className="grid size-8 place-items-center rounded-lg text-[#7b8695] hover:bg-[#f3f5f7]"><X size={18} /></button>
            </div>
            <div className="mt-6 flex items-center justify-between"><label htmlFor="meeting-prompt" className="text-sm font-medium text-[#3d4859]">分析 Prompt <span className="text-red-500">*</span></label><Link href="/meeting/prompts" className="text-xs font-medium text-[#5273ba] hover:text-[#3370ff]">管理 Prompt</Link></div>
            <select id="meeting-prompt" required value={promptId} onChange={(event) => setPromptId(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[#dce2ea] bg-white px-3 text-sm outline-none focus:border-[#6e96f4] focus:ring-2 focus:ring-[#3370ff]/10">
              {initialPrompts.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.builtIn ? "[内置] " : ""}{prompt.name}</option>)}
            </select>
            {selectedPrompt && <div className="mt-2 rounded-lg bg-[#f5f8ff] px-3 py-2.5"><div className="flex items-center gap-2"><span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#4c6fb8] ring-1 ring-[#dbe5fa]">{meetingScenarioMeta[selectedPrompt.scenario].label}</span>{selectedPrompt.builtIn && <span className="text-[11px] text-[#8b96a6]">系统内置</span>}</div><p className="mt-1.5 text-xs leading-5 text-[#66758c]">{selectedPrompt.description}</p></div>}
            <label className="mt-5 block text-sm font-medium text-[#3d4859]">飞书会议文档链接 <span className="text-red-500">*</span></label>
            <div className="mt-2 flex h-11 items-center gap-2 rounded-lg border border-[#dce2ea] px-3 focus-within:border-[#6e96f4] focus-within:ring-2 focus-within:ring-[#3370ff]/10">
              <Link2 size={16} className="shrink-0 text-[#8390a2]" /><input required type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://xxx.feishu.cn/docx/..." className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a6afbb]" />
            </div>
            <label className="mt-4 block text-sm font-medium text-[#3d4859]">会议系列 <span className="font-normal text-[#98a1af]">（可选）</span></label>
            <input value={seriesName} onChange={(event) => setSeriesName(event.target.value)} placeholder="例如：FEB 周会、会员项目同步会" className="mt-2 h-11 w-full rounded-lg border border-[#dce2ea] px-3 text-sm outline-none placeholder:text-[#a6afbb] focus:border-[#6e96f4] focus:ring-2 focus:ring-[#3370ff]/10" />
            <p className="mt-2 text-xs leading-5 text-[#8994a4]">填写同一系列名称后，系统会关联上次会议未完成的行动项。</p>
            {error && <div className="mt-4 flex gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700"><CircleAlert size={16} className="mt-0.5 shrink-0" />{error}</div>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={submitting} onClick={() => setDialogOpen(false)} className="h-10 rounded-lg border border-[#dfe4eb] px-4 text-sm font-medium text-[#566273] hover:bg-[#f7f8fa]">取消</button>
              <button disabled={submitting || !promptId} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#3370ff] px-4 text-sm font-medium text-white hover:bg-[#2864ed] disabled:opacity-70">{submitting ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}{submitting ? "正在读取并分析…" : "开始分析"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function MeetingRow({ meeting }: { meeting: MeetingAnalysis }) {
  const meta = statusMeta[meeting.status];
  const outstanding = meeting.actionItems.filter((item) => item.status !== "completed").length;
  return (
    <Link href={`/meeting/${meeting.id}`} className="group grid gap-4 px-5 py-5 transition hover:bg-[#fafbfc] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-[15px] font-semibold text-[#303a49] group-hover:text-[#295fdf]">{meeting.title}</h3>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.className}`}>{meta.label}</span>
          <span className="rounded-full bg-[#eef3ff] px-2 py-0.5 text-[11px] text-[#4c6fb8]">{meeting.promptName || meetingScenarioMeta[meeting.scenario || "technical_review"].label}</span>
          {meeting.seriesName && <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[11px] text-[#687486]">{meeting.seriesName}</span>}
        </div>
        <p className="mt-1.5 line-clamp-1 text-sm text-[#7a8596]">{meeting.status === "failed" ? meeting.error : meeting.summary || meeting.sourceTitle}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#8a95a5]">
          <span className="flex items-center gap-1.5"><CalendarDays size={13} />{formatDate(meeting.meetingDate || meeting.createdAt)}</span>
          {meeting.durationMinutes && <span className="flex items-center gap-1.5"><Clock3 size={13} />{meeting.durationMinutes} 分钟</span>}
          <span className="flex items-center gap-1.5"><UsersRound size={13} />{meeting.participants.length || "—"} 人</span>
          {meeting.scenario === "technical_weekly"
            ? <span className="flex items-center gap-1.5"><ListChecks size={13} />{meeting.progressItems?.length || 0} 项进展 · {meeting.risks?.length || 0} 项风险</span>
            : <span className="flex items-center gap-1.5"><BadgeCheck size={13} />{meeting.decisions.length} 项决议</span>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-6 md:justify-end">
        <div className="text-right"><p className={`text-lg font-semibold ${outstanding ? "text-[#d18418]" : "text-[#1a9a6b]"}`}>{outstanding}</p><p className="text-[11px] text-[#919aa8]">待推进</p></div>
        <ArrowRight size={17} className="text-[#a0a9b6] transition group-hover:translate-x-0.5 group-hover:text-[#3370ff]" />
      </div>
    </Link>
  );
}

function Metric({ icon, value, label, tone }: { icon: React.ReactNode; value: number; label: string; tone: "blue" | "green" | "orange" }) {
  const colors = { blue: "bg-blue-50 text-blue-600", green: "bg-emerald-50 text-emerald-600", orange: "bg-amber-50 text-amber-600" };
  return <div className="flex items-center gap-3 rounded-xl border border-[#e4e8ee] bg-white px-4 py-4"><span className={`grid size-10 place-items-center rounded-lg ${colors[tone]}`}>{icon}</span><div><p className="text-xl font-semibold tracking-[-0.03em]">{value}</p><p className="mt-0.5 text-xs text-[#818c9c]">{label}</p></div></div>;
}
