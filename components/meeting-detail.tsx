"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  History,
  ListTodo,
  LoaderCircle,
  Mail,
  MessageSquareQuote,
  Pencil,
  Save,
  Send,
  Table2,
  TriangleAlert,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { meetingScenarioMeta } from "@/lib/meeting/types";
import type { MeetingActionItem, MeetingActionStatus, MeetingAnalysis, MeetingEvidence, MeetingProgressItem, MeetingRisk } from "@/lib/meeting/types";

const actionStatusMeta: Record<MeetingActionStatus, { label: string; className: string }> = {
  pending: { label: "待确认", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  in_progress: { label: "进行中", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  completed: { label: "已完成", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

function formatDate(value?: string, includeTime = false) {
  if (!value) return "未定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", includeTime ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function MeetingDetail({ initialMeeting, previousMeeting }: { initialMeeting: MeetingAnalysis; previousMeeting?: MeetingAnalysis }) {
  const [meeting, setMeeting] = useState(initialMeeting);
  const [openEvidence, setOpenEvidence] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string>();
  const [savingId, setSavingId] = useState<string>();
  const [exportOpen, setExportOpen] = useState(false);
  const [targetUrl, setTargetUrl] = useState("");
  const [exporting, setExporting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [exportError, setExportError] = useState("");
  const [notice, setNotice] = useState("");
  const scenario = meeting.scenario || "technical_review";

  const unfinishedPrevious = previousMeeting?.actionItems.filter((item) => item.status !== "completed") ?? [];

  function toggleEvidence(id: string) {
    setOpenEvidence((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function updateAction(actionId: string, changes: Record<string, unknown>) {
    setSavingId(actionId);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, changes }),
      });
      const body = (await response.json()) as { meeting?: MeetingAnalysis; error?: string };
      if (!response.ok || !body.meeting) throw new Error(body.error || "更新失败");
      setMeeting(body.meeting);
      setEditingId(undefined);
      setNotice("行动项已保存");
      window.setTimeout(() => setNotice(""), 2200);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "更新失败");
    } finally {
      setSavingId(undefined);
    }
  }

  async function exportActions(event: React.FormEvent) {
    event.preventDefault();
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch(`/api/meetings/${meeting.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUrl }),
      });
      const body = (await response.json()) as { exported?: MeetingAnalysis["exports"][number]; tableName?: string; error?: string };
      if (!response.ok || !body.exported) throw new Error(body.error || "导出失败");
      setMeeting((current) => ({ ...current, exports: [body.exported!, ...current.exports] }));
      setExportOpen(false);
      setTargetUrl("");
      setNotice(`已写入${body.tableName ? `「${body.tableName}」` : "目标多维表格"}，共 ${body.exported.recordCount} 条`);
      window.setTimeout(() => setNotice(""), 3000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  async function retryAnalysis() {
    setRetrying(true);
    setNotice("");
    try {
      const response = await fetch(`/api/meetings/${meeting.id}/retry`, { method: "POST" });
      const body = (await response.json()) as { meeting?: MeetingAnalysis; error?: string };
      if (!response.ok || !body.meeting) throw new Error(body.error || "重新分析失败");
      setMeeting(body.meeting);
      setNotice("重新分析已完成");
      window.setTimeout(() => setNotice(""), 2500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "重新分析失败");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#202938]">
      <AppSidebar />
      <main className="ml-60 min-h-screen">
        <header className="border-b border-[#e7eaf0] bg-white">
          <div className="flex h-16 items-center justify-between gap-4 px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/meeting" className="grid size-8 shrink-0 place-items-center rounded-lg text-[#687486] hover:bg-[#f2f4f7]"><ArrowLeft size={18} /></Link>
              <div className="min-w-0"><h1 className="truncate text-[16px] font-semibold">{meeting.title}</h1><p className="mt-0.5 truncate text-xs text-[#8a94a3]">{meeting.seriesName || "未归类会议"} · {formatDate(meeting.meetingDate || meeting.createdAt)}</p></div>
            </div>
            <button disabled={!meeting.actionItems.length || meeting.status !== "completed"} onClick={() => setExportOpen(true)} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#3370ff] px-3.5 text-sm font-medium text-white shadow-sm hover:bg-[#2864ed] disabled:cursor-not-allowed disabled:opacity-50"><Table2 size={16} /> 导出到多维表格</button>
          </div>
        </header>

        <div className="w-full px-8 py-7">
          {meeting.status === "failed" ? (
            <section className="rounded-xl border border-red-200 bg-white p-8 text-center"><span className="mx-auto grid size-12 place-items-center rounded-xl bg-red-50 text-red-600"><CircleAlert size={23} /></span><h2 className="mt-4 font-semibold">这次分析没有完成</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#6f7b8c]">{meeting.error}</p><div className="mt-5 flex items-center justify-center gap-3"><Link href="/meeting" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#dfe4eb] px-4 text-sm font-medium text-[#5e6b7d]">返回会议记录</Link><button disabled={retrying} onClick={retryAnalysis} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#3370ff] px-4 text-sm font-medium text-white hover:bg-[#2864ed] disabled:opacity-70">{retrying ? <LoaderCircle size={16} className="animate-spin" /> : <SparklesIcon />}{retrying ? "正在重新分析…" : "重新分析"}</button></div></section>
          ) : (
            <>
              <section className="rounded-xl border border-[#e1e6ed] bg-white p-5 shadow-[0_1px_2px_rgba(24,36,56,.03)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">分析完成</span><span className="rounded-full bg-[#eef3ff] px-2.5 py-1 text-xs font-medium text-[#4d6fb8]">Prompt · {meeting.promptName || meetingScenarioMeta[scenario].label}</span>{meeting.seriesName && <span className="rounded-full bg-[#f1f4f8] px-2.5 py-1 text-xs text-[#677487]">{meeting.seriesName}</span>}</div><h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{meeting.title}</h2><p className="mt-2 text-sm leading-6 text-[#6f7b8d]">{meeting.summary}</p></div>
                  <a href={meeting.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-[#5273ba] hover:text-[#3370ff]"><FileText size={15} /> 查看会议原文 <ExternalLink size={13} /></a>
                </div>
                <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-[#edf0f4] pt-4 text-xs text-[#7d8899]"><span className="flex items-center gap-1.5"><CalendarDays size={14} />{formatDate(meeting.meetingDate || meeting.createdAt)}</span>{meeting.durationMinutes && <span className="flex items-center gap-1.5"><Clock3 size={14} />{meeting.durationMinutes} 分钟</span>}<span className="flex items-center gap-1.5"><UsersRound size={14} />{meeting.participants.length ? meeting.participants.join("、") : "参会人未识别"}</span></div>
              </section>

              <section className="my-5 grid gap-3 sm:grid-cols-3">
                {scenario === "technical_weekly" ? <>
                  <Metric icon={<Activity size={17} />} count={meeting.progressItems?.length || 0} label="跟进事项" tone="green" />
                  <Metric icon={<TriangleAlert size={17} />} count={meeting.risks?.length || 0} label="风险 / 阻塞" tone="orange" />
                </> : <>
                  <Metric icon={<BadgeCheck size={17} />} count={meeting.decisions.length} label="已达成决议" tone="green" />
                  <Metric icon={<CircleAlert size={17} />} count={meeting.openQuestions.length} label="待确定细节" tone="orange" />
                </>}
                <Metric icon={<ListTodo size={17} />} count={meeting.actionItems.length} label={`${meeting.actionItems.filter((item) => item.status !== "completed").length} 项待推进`} tone="blue" />
              </section>

              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,.8fr)]">
                <div className="space-y-5">
                  {scenario === "technical_weekly" && <ProgressSection items={meeting.progressItems ?? []} openEvidence={openEvidence} onToggleEvidence={toggleEvidence} />}
                  <section className="overflow-hidden rounded-xl border border-[#e2e6ec] bg-white">
                    <SectionHeader icon={<ListTodo size={17} />} title="行动项 · 5W1H" description="责任人、任务、截止时间与交付物可人工校正；未定截止时间会持续提示。" count={meeting.actionItems.length} />
                    {meeting.actionItems.length ? <div className="divide-y divide-[#edf0f4]">{meeting.actionItems.map((action, index) => <ActionCard key={action.id} action={action} index={index} editing={editingId === action.id} saving={savingId === action.id} evidenceOpen={openEvidence.has(action.id)} onToggleEvidence={() => toggleEvidence(action.id)} onEdit={() => setEditingId(action.id)} onCancel={() => setEditingId(undefined)} onSave={(changes) => updateAction(action.id, changes)} onStatus={(status) => updateAction(action.id, { status })} />)}</div> : <EmptySection text="原文中没有识别到可归属、可执行的行动项。" />}
                  </section>

                  {scenario === "technical_review" && <section className="overflow-hidden rounded-xl border border-[#e2e6ec] bg-white">
                    <SectionHeader icon={<BadgeCheck size={17} />} title="已达成决议" description="会上已明确敲定，默认不再重复讨论的结论。" count={meeting.decisions.length} />
                    {meeting.decisions.length ? <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">{meeting.decisions.map((decision) => <div key={decision.id} className="rounded-lg border border-[#e7ebf0] p-4"><div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><BadgeCheck size={14} /> 已确认</div><h3 className="mt-2 text-sm font-semibold text-[#354052]">{decision.title}</h3><p className="mt-1.5 text-xs leading-5 text-[#727e90]">{decision.detail}</p><EvidenceButton evidence={decision} open={openEvidence.has(decision.id)} onClick={() => toggleEvidence(decision.id)} /></div>)}</div> : <EmptySection text="原文中没有明确的已达成决议。" />}
                  </section>}
                </div>

                <aside className="space-y-5">
                  {scenario === "technical_weekly" ? <RiskSection items={meeting.risks ?? []} openEvidence={openEvidence} onToggleEvidence={toggleEvidence} /> : <section className="overflow-hidden rounded-xl border border-[#eadfc9] bg-white">
                    <SectionHeader icon={<CircleAlert size={17} />} title="分歧 / 留存项" description="需要继续拉齐、仍未形成结论的事项。" count={meeting.openQuestions.length} />
                    {meeting.openQuestions.length ? <div className="space-y-4 px-5 pb-5">{meeting.openQuestions.map((question) => <div key={question.id} className="border-l-2 border-[#eeb759] pl-3"><h3 className="text-sm font-semibold leading-5 text-[#3e4758]">{question.question}</h3><p className="mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-[#847563]"><UsersRound size={13} className="mt-0.5 shrink-0" />需拉齐：{question.stakeholders.join("、") || "未明确"}</p><p className="mt-1.5 text-xs leading-5 text-[#788493]">下一步：{question.nextStep}</p><EvidenceButton evidence={question} open={openEvidence.has(question.id)} onClick={() => toggleEvidence(question.id)} /></div>)}</div> : <EmptySection text="没有识别到待对齐事项。" />}
                  </section>}

                  {previousMeeting && <section className="overflow-hidden rounded-xl border border-[#dce6fb] bg-white"><SectionHeader icon={<History size={17} />} title="跨会议追踪" description={`来自上次「${previousMeeting.title}」的未完成事项。`} count={unfinishedPrevious.length} />{unfinishedPrevious.length ? <div className="space-y-3 px-5 pb-5">{unfinishedPrevious.map((item) => <div key={item.id} className="rounded-lg bg-[#f5f8ff] p-3"><div className="flex items-start gap-2"><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[#dfe9ff] text-[11px] font-semibold text-[#4a6fbd]">{item.who.name.slice(0, 1)}</span><div><p className="text-sm font-medium leading-5 text-[#465775]">{item.what}</p><p className="mt-1 text-xs text-[#7d8da7]">{item.who.name} · 截止 {formatDate(item.dueAt)}</p></div></div></div>)}<Link href={`/meeting/${previousMeeting.id}`} className="flex items-center justify-center gap-1.5 pt-1 text-xs font-medium text-[#4d72c5]">查看上次会议 <ArrowRight size={13} /></Link></div> : <EmptySection text="上次会议的行动项已全部完成。" />}</section>}

                  <section className="rounded-xl border border-[#dce6fb] bg-[#f8faff] p-5"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#3370ff] text-white"><Table2 size={18} /></span><div><h3 className="font-semibold text-[#294675]">输出到多维表格</h3><p className="mt-1 text-xs leading-5 text-[#667d9f]">不会自动选择或新建表格。点击后由你指定目标链接。</p></div></div><button disabled={!meeting.actionItems.length} onClick={() => setExportOpen(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#3370ff] py-2.5 text-sm font-medium text-white hover:bg-[#2864ed] disabled:opacity-50"><Send size={15} /> 指定表格并导出</button>{meeting.exports.length > 0 && <div className="mt-4 border-t border-[#dfe7f5] pt-3"><p className="text-xs font-medium text-[#687c9d]">最近导出</p>{meeting.exports.slice(0, 3).map((item) => <a key={item.id} href={item.targetUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center justify-between text-xs text-[#637797] hover:text-[#3370ff]"><span>{formatDate(item.exportedAt, true)} · {item.recordCount} 条</span><ExternalLink size={12} /></a>)}</div>}</section>
                </aside>
              </div>
            </>
          )}
        </div>
      </main>

      {exportOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-[#172033]/35 p-4 backdrop-blur-[1px]" onMouseDown={(event) => event.target === event.currentTarget && !exporting && setExportOpen(false)}><form onSubmit={exportActions} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">指定目标多维表格</h2><p className="mt-1 text-sm text-[#798597]">将写入本次会议的 {meeting.actionItems.length} 条行动项。</p></div><button type="button" disabled={exporting} onClick={() => setExportOpen(false)} className="grid size-8 place-items-center rounded-lg text-[#7c8797] hover:bg-[#f3f5f7]"><X size={18} /></button></div><label className="mt-6 block text-sm font-medium text-[#3e4959]">多维表格链接</label><input required type="text" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://xxx.feishu.cn/base/... 或 /wiki/... 链接" className="mt-2 h-11 w-full rounded-lg border border-[#dce2ea] px-3 text-sm outline-none placeholder:text-[#a6afbb] focus:border-[#6e96f4] focus:ring-2 focus:ring-[#3370ff]/10" /><p className="mt-2 text-xs leading-5 text-[#8994a4]">支持多维表格链接（/base/、/bitable/）或知识库页面（/wiki/）。建议包含 table 参数。自建应用需拥有该表格或知识库的编辑权限。</p>{exportError && <div className="mt-4 flex gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700"><CircleAlert size={16} className="mt-0.5 shrink-0" />{exportError}</div>}<div className="mt-6 flex justify-end gap-2"><button type="button" disabled={exporting} onClick={() => setExportOpen(false)} className="h-10 rounded-lg border border-[#dfe4eb] px-4 text-sm font-medium text-[#566273]">取消</button><button disabled={exporting} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#3370ff] px-4 text-sm font-medium text-white disabled:opacity-70">{exporting ? <LoaderCircle size={16} className="animate-spin" /> : <Table2 size={16} />}{exporting ? "正在写入…" : "确认导出"}</button></div></form></div>}
      {notice && <div className="fixed bottom-5 left-[calc(50%+7.5rem)] z-[60] -translate-x-1/2 rounded-lg bg-[#202735] px-4 py-2.5 text-sm text-white shadow-lg">{notice}</div>}
    </div>
  );
}

function SectionHeader({ icon, title, description, count }: { icon: ReactNode; title: string; description: string; count: number }) {
  return <div className="flex items-start justify-between gap-3 px-5 py-4"><div className="flex items-start gap-2.5"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[#edf3ff] text-[#3370ff]">{icon}</span><div><h2 className="font-semibold tracking-[-0.02em]">{title}</h2><p className="mt-1 text-xs leading-5 text-[#8590a0]">{description}</p></div></div><span className="rounded-full bg-[#f2f5f9] px-2.5 py-1 text-xs font-medium text-[#617083]">{count} 项</span></div>;
}

function Metric({ icon, count, label, tone }: { icon: ReactNode; count: number; label: string; tone: "green" | "orange" | "blue" }) {
  const colors = { green: "bg-emerald-50 text-emerald-600", orange: "bg-amber-50 text-amber-600", blue: "bg-blue-50 text-blue-600" };
  return <div className="flex items-center gap-3 rounded-xl border border-[#e5e9ef] bg-white px-4 py-3.5"><span className={`grid size-9 place-items-center rounded-lg ${colors[tone]}`}>{icon}</span><div><p className="text-xl font-semibold leading-5">{count}</p><p className="mt-1 text-xs text-[#7e8898]">{label}</p></div></div>;
}

const progressStatusMeta = {
  not_started: { label: "未开始", className: "bg-slate-100 text-slate-600" },
  on_track: { label: "正常推进", className: "bg-emerald-50 text-emerald-700" },
  at_risk: { label: "有风险", className: "bg-amber-50 text-amber-700" },
  blocked: { label: "已阻塞", className: "bg-red-50 text-red-700" },
  completed: { label: "已完成", className: "bg-blue-50 text-blue-700" },
} as const;

function ProgressSection({ items, openEvidence, onToggleEvidence }: { items: MeetingProgressItem[]; openEvidence: Set<string>; onToggleEvidence: (id: string) => void }) {
  return <section className="overflow-hidden rounded-xl border border-[#e2e6ec] bg-white"><SectionHeader icon={<Activity size={17} />} title="事项进展" description="按技术需求或项目聚合当前状态、实际进展与下一里程碑。" count={items.length} />{items.length ? <div className="divide-y divide-[#edf0f4]">{items.map((item) => { const status = progressStatusMeta[item.status]; return <article key={item.id} className="px-5 py-4"><div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-semibold text-[#354052]">{item.project}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>{status.label}</span></div><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#788496]"><span className="flex items-center gap-1.5"><UserRound size={13} />{item.owner}</span><span className={`flex items-center gap-1.5 ${item.dueAt ? "" : "text-red-600"}`}><CalendarDays size={13} />{item.dueAt ? `目标 ${formatDate(item.dueAt)}` : "完成时间未定"}</span></div><div className="mt-3 grid gap-3 rounded-lg bg-[#f8fafc] p-3 sm:grid-cols-2"><div><p className="text-[11px] font-medium text-[#929cab]">当前进展</p><p className="mt-1 text-sm leading-6 text-[#536071]">{item.progress}</p></div><div><p className="text-[11px] font-medium text-[#929cab]">下一步</p><p className="mt-1 text-sm leading-6 text-[#536071]">{item.nextStep}</p></div></div><EvidenceButton evidence={item} open={openEvidence.has(item.id)} onClick={() => onToggleEvidence(item.id)} /></article>; })}</div> : <EmptySection text="本次会议没有识别到明确的事项进展。" />}</section>;
}

function RiskSection({ items, openEvidence, onToggleEvidence }: { items: MeetingRisk[]; openEvidence: Set<string>; onToggleEvidence: (id: string) => void }) {
  const levels = { low: { label: "低", className: "bg-slate-100 text-slate-600 border-slate-300" }, medium: { label: "中", className: "bg-amber-50 text-amber-700 border-amber-300" }, high: { label: "高", className: "bg-red-50 text-red-700 border-red-300" } } as const;
  return <section className="overflow-hidden rounded-xl border border-[#eadfc9] bg-white"><SectionHeader icon={<TriangleAlert size={17} />} title="风险 / 阻塞" description="会影响交付时间、质量、范围或依赖协作的具体风险。" count={items.length} />{items.length ? <div className="space-y-4 px-5 pb-5">{items.map((item) => { const level = levels[item.level]; return <article key={item.id} className={`border-l-2 pl-3 ${level.className.split(" ").find((name) => name.startsWith("border-"))}`}><div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold leading-5 text-[#3e4758]">{item.title}</h3><span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${level.className}`}>{level.label}风险</span></div>{item.owner && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#7b6e60]"><UserRound size={13} />跟进人：{item.owner}</p>}<p className="mt-2 text-xs leading-5 text-[#788493]"><strong className="font-medium text-[#626e7e]">影响：</strong>{item.impact}</p><p className="mt-1 text-xs leading-5 text-[#788493]"><strong className="font-medium text-[#626e7e]">应对：</strong>{item.mitigation}</p><EvidenceButton evidence={item} open={openEvidence.has(item.id)} onClick={() => onToggleEvidence(item.id)} /></article>; })}</div> : <EmptySection text="本次会议没有识别到明确风险或阻塞。" />}</section>;
}

function EmptySection({ text }: { text: string }) {
  return <p className="px-5 pb-6 text-sm text-[#8a94a3]">{text}</p>;
}

function EvidenceButton({ evidence, open, onClick }: { evidence: MeetingEvidence; open: boolean; onClick: () => void }) {
  return <><button onClick={onClick} className="mt-3 flex items-center gap-1.5 text-xs font-medium text-[#6179b4] hover:text-[#3370ff]"><MessageSquareQuote size={14} /> 原文溯源 <ChevronDown size={13} className={`transition ${open ? "rotate-180" : ""}`} /></button>{open && <div className="mt-2 rounded-lg border border-[#e1e7f1] bg-[#f8faff] p-3"><p className="text-xs font-medium leading-5 text-[#4a5870]">“{evidence.quote.replace(/^[“\"]|[”\"]$/g, "")}”</p><p className="mt-2 border-t border-[#e4eaf5] pt-2 text-xs leading-5 text-[#79869c]">{evidence.context}</p></div>}</>;
}

function ActionCard({ action, index, editing, saving, evidenceOpen, onToggleEvidence, onEdit, onCancel, onSave, onStatus }: { action: MeetingActionItem; index: number; editing: boolean; saving: boolean; evidenceOpen: boolean; onToggleEvidence: () => void; onEdit: () => void; onCancel: () => void; onSave: (changes: Record<string, unknown>) => void; onStatus: (status: MeetingActionStatus) => void }) {
  const [draft, setDraft] = useState(action);
  const status = actionStatusMeta[action.status];
  if (editing) return <form onSubmit={(event) => { event.preventDefault(); onSave({ who: draft.who, what: draft.what, dueAt: draft.dueAt || null, deliverable: draft.deliverable }); }} className="bg-[#fbfcfe] px-5 py-5"><div className="mb-4 flex items-center justify-between"><p className="text-sm font-semibold">编辑行动项 0{index + 1}</p><button type="button" onClick={onCancel} className="text-[#7d8797]"><X size={17} /></button></div><div className="grid gap-4 sm:grid-cols-2"><EditField label="Who · 责任人"><input required value={draft.who.name} onChange={(event) => setDraft({ ...draft, who: { ...draft.who, name: event.target.value } })} /></EditField><EditField label="Email"><input type="email" value={draft.who.email || ""} onChange={(event) => setDraft({ ...draft, who: { ...draft.who, email: event.target.value || undefined } })} /></EditField><EditField label="What · 做什么" wide><input required value={draft.what} onChange={(event) => setDraft({ ...draft, what: event.target.value })} /></EditField><EditField label="When · 截止时间"><input type="date" value={draft.dueAt?.slice(0, 10) || ""} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value || undefined })} /></EditField><EditField label="Deliverable · 交付物"><input required value={draft.deliverable} onChange={(event) => setDraft({ ...draft, deliverable: event.target.value })} /></EditField></div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border border-[#dfe4eb] px-3 py-2 text-xs font-medium">取消</button><button disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3370ff] px-3 py-2 text-xs font-medium text-white disabled:opacity-60">{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}保存</button></div></form>;
  return <article className="px-5 py-4"><div className="flex items-start gap-3"><button disabled={saving} onClick={() => onStatus(action.status === "completed" ? "in_progress" : "completed")} className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] border ${action.status === "completed" ? "border-emerald-600 bg-emerald-600 text-white" : "border-[#cfd7e3] bg-white text-transparent hover:border-[#3370ff]"}`}><Check size={14} strokeWidth={3} /></button><span className="mt-0.5 font-mono text-xs text-[#a1aab8]">0{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className={`text-[15px] font-medium leading-5 ${action.status === "completed" ? "text-[#8a94a3] line-through" : "text-[#2c3544]"}`}>{action.what}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${status.className}`}>{status.label}</span><button onClick={onEdit} className="ml-auto grid size-7 place-items-center rounded-md text-[#8993a2] hover:bg-[#f1f4f8] hover:text-[#3370ff]"><Pencil size={14} /></button></div><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><ActionField icon={<UserRound size={13} />} label="Who" value={action.who.name} />{action.who.email && <ActionField icon={<Mail size={13} />} label="Email" value={action.who.email} />}<ActionField icon={<CalendarDays size={13} />} label="When" value={formatDate(action.dueAt)} alert={!action.dueAt} /><ActionField icon={<FileText size={13} />} label="Deliverable" value={action.deliverable} /></div><EvidenceButton evidence={action} open={evidenceOpen} onClick={onToggleEvidence} /></div></div></article>;
}

function ActionField({ icon, label, value, alert }: { icon: ReactNode; label: string; value: string; alert?: boolean }) {
  return <div className="flex min-w-0 items-center gap-1.5"><span className="text-[#97a1af]">{icon}</span><span className="font-mono text-[#97a1af]">{label}</span><span className={alert ? "font-medium text-red-600" : "truncate text-[#586373]"}>{value}</span>{alert && <CircleAlert size={13} className="shrink-0 text-red-500" />}</div>;
}

function EditField({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={wide ? "sm:col-span-2" : ""}><span className="mb-1.5 block text-xs font-medium text-[#667386]">{label}</span><span className="block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-[#dce2ea] [&_input]:bg-white [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none focus-within:[&_input]:border-[#6e96f4]">{children}</span></label>;
}

function SparklesIcon() {
  return <span aria-hidden className="text-base leading-none">✦</span>;
}
