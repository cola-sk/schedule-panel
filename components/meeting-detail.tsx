"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bot,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  Eye,
  FileEdit,
  FileText,
  History,
  ListTodo,
  LoaderCircle,
  Mail,
  MessageSquare,
  MessageSquareQuote,
  Pencil,
  Save,
  Send,
  ShieldAlert,
  Sparkles,
  Table2,
  TriangleAlert,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { DEFAULT_FEISHU_BITABLE_URL, meetingScenarioMeta } from "@/lib/meeting/types";
import type {
  MeetingActionItem,
  MeetingActionStatus,
  MeetingAnalysis,
  MeetingDecision,
  MeetingEvidence,
  MeetingProgressItem,
  MeetingRisk,
} from "@/lib/meeting/types";

const actionStatusMeta: Record<MeetingActionStatus, { label: string; className: string }> = {
  pending: { label: "待确认", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  in_progress: { label: "进行中", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  completed: { label: "已完成", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

function formatDate(value?: string, includeTime = false) {
  if (!value) return "未定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(
    "zh-CN",
    includeTime
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "short", day: "numeric" },
  ).format(date);
}

export function MeetingDetail({
  initialMeeting,
  previousMeeting,
}: {
  initialMeeting: MeetingAnalysis;
  previousMeeting?: MeetingAnalysis;
}) {
  const [meeting, setMeeting] = useState(initialMeeting);
  const [openEvidence, setOpenEvidence] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string>();
  const [savingId, setSavingId] = useState<string>();

  // 开会日期快速编辑
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState(meeting.meetingDate ? meeting.meetingDate.slice(0, 10) : "");
  const [savingDate, setSavingDate] = useState(false);

  // 导出到多维表格状态
  const [exportOpen, setExportOpen] = useState(false);
  const [targetUrl, setTargetUrl] = useState(DEFAULT_FEISHU_BITABLE_URL);
  const [includeDecisions, setIncludeDecisions] = useState(true);
  const [includeActionItems, setIncludeActionItems] = useState(true);
  const [includeRisks, setIncludeRisks] = useState(true);
  const [createNewTab, setCreateNewTab] = useState(false);
  const [tabName, setTabName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [exportError, setExportError] = useState("");
  const [notice, setNotice] = useState("");

  function openExportModal() {
    if (!tabName) {
      const datePart = (meeting.meetingDate || meeting.createdAt || "").slice(0, 10);
      setTabName(`${datePart} ${meeting.title || "会议行动项"}`.trim());
    }
    setExportOpen(true);
  }

  // 机器人卡片预览与发送状态
  const [botModalOpen, setBotModalOpen] = useState(false);
  const [availableBots, setAvailableBots] = useState<
    Array<{ id: string; name: string; configured: boolean; webhookMasked: string }>
  >([]);
  const [selectedBotId, setSelectedBotId] = useState("");
  const [useCustomWebhook, setUseCustomWebhook] = useState(false);
  const [customWebhookUrl, setCustomWebhookUrl] = useState("");
  const [botIntroText, setBotIntroText] = useState("请各事项负责人关注相关风险，按时推进会后行动项闭环！");
  const [botIncludeDecisions, setBotIncludeDecisions] = useState(true);
  const [botIncludeActions, setBotIncludeActions] = useState(true);
  const [botIncludeRisks, setBotIncludeRisks] = useState(true);
  const [sendingBot, setSendingBot] = useState(false);
  const [sendBotError, setSendBotError] = useState("");

  const scenario = meeting.scenario || "meeting_action";
  const unfinishedPrevious = previousMeeting?.actionItems?.filter((item) => item.status !== "completed") ?? [];

  const totalExportItems =
    (includeDecisions ? meeting.decisions?.length || 0 : 0) +
    (includeActionItems ? meeting.actionItems?.length || 0 : 0) +
    (includeRisks ? meeting.risks?.length || 0 : 0);

  function toggleEvidence(id: string) {
    setOpenEvidence((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openBotModal() {
    setBotModalOpen(true);
    setSendBotError("");
    try {
      const res = await fetch("/api/bots");
      const data = await res.json();
      if (Array.isArray(data.bots)) {
        const configured = data.bots.filter((b: any) => b.configured);
        setAvailableBots(configured);
        if (configured.length > 0 && !selectedBotId) {
          setSelectedBotId(configured[0].id);
        }
      }
    } catch {
      // ignore
    }
  }

  async function handleSendToBot(event: React.FormEvent) {
    event.preventDefault();
    setSendingBot(true);
    setSendBotError("");
    try {
      const payload: Record<string, unknown> = {
        introText: botIntroText,
        includeDecisions: botIncludeDecisions,
        includeActionItems: botIncludeActions,
        includeRisks: botIncludeRisks,
      };
      if (useCustomWebhook) {
        if (!customWebhookUrl.trim()) throw new Error("请输入自定义 Webhook 地址");
        payload.customWebhook = customWebhookUrl.trim();
      } else {
        if (!selectedBotId) throw new Error("请选择要发送的机器人");
        payload.botId = selectedBotId;
      }

      const res = await fetch(`/api/meetings/${meeting.id}/send-bot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "机器人发送失败");
      setBotModalOpen(false);
      setNotice(`✅ 已成功将卡片推送至「${data.botName}」所在群聊！`);
      window.setTimeout(() => setNotice(""), 3500);
    } catch (err: any) {
      setSendBotError(err.message || "发送失败");
    } finally {
      setSendingBot(false);
    }
  }

  async function saveMeetingDate() {
    setSavingDate(true);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingDate: dateDraft.trim() || undefined }),
      });
      const body = (await response.json()) as { meeting?: MeetingAnalysis; error?: string };
      if (!response.ok || !body.meeting) throw new Error(body.error || "更新日期失败");
      setMeeting(body.meeting);
      setEditingDate(false);
      setNotice("开会日期已更新");
      window.setTimeout(() => setNotice(""), 2200);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "更新日期失败");
    } finally {
      setSavingDate(false);
    }
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
        body: JSON.stringify({
          targetUrl,
          includeDecisions,
          includeActionItems,
          includeRisks,
          createNewTab,
          tabName: createNewTab ? tabName : undefined,
        }),
      });
      const body = (await response.json()) as {
        exported?: MeetingAnalysis["exports"][number];
        tableName?: string;
        error?: string;
      };
      if (!response.ok || !body.exported) throw new Error(body.error || "导出失败");
      setMeeting((current) => ({ ...current, exports: [body.exported!, ...current.exports] }));
      setExportOpen(false);
      setNotice(`已写入${body.tableName ? `「${body.tableName}」` : "目标多维表格"}，共 ${body.exported.recordCount} 条记录`);
      window.setTimeout(() => setNotice(""), 3500);
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
              <Link
                href="/meeting"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-[#687486] hover:bg-[#f2f4f7]"
              >
                <ArrowLeft size={18} />
              </Link>
              <div className="min-w-0">
                <h1 className="truncate text-[16px] font-semibold">{meeting.title}</h1>
                <p className="mt-0.5 truncate text-xs text-[#8a94a3]">
                  {meeting.seriesName || "技术会议"} · 开会日期：{formatDate(meeting.meetingDate || meeting.createdAt)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                disabled={meeting.status !== "completed"}
                onClick={openBotModal}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#3370ff]/40 bg-[#f4f7fe] px-3.5 text-sm font-medium text-[#3370ff] hover:bg-[#ebf2fe] disabled:cursor-not-allowed disabled:opacity-50 transition"
              >
                <Bot size={16} /> 预览并发送到群
              </button>
              <button
                disabled={meeting.status !== "completed"}
                onClick={openExportModal}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#3370ff] px-3.5 text-sm font-medium text-white shadow-sm hover:bg-[#2864ed] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Table2 size={16} /> 导出到多维表格
              </button>
            </div>
          </div>
        </header>

        <div className="w-full px-8 py-7">
          {meeting.status === "failed" ? (
            <section className="rounded-xl border border-red-200 bg-white p-8 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-xl bg-red-50 text-red-600">
                <CircleAlert size={23} />
              </span>
              <h2 className="mt-4 font-semibold">这次分析没有完成</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#6f7b8c]">{meeting.error}</p>
              <div className="mt-5 flex items-center justify-center gap-3">
                <Link
                  href="/meeting"
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#dfe4eb] px-4 text-sm font-medium text-[#5e6b7d]"
                >
                  返回会议记录
                </Link>
                <button
                  disabled={retrying}
                  onClick={retryAnalysis}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#3370ff] px-4 text-sm font-medium text-white hover:bg-[#2864ed] disabled:opacity-70"
                >
                  {retrying ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {retrying ? "正在重新分析…" : "重新分析"}
                </button>
              </div>
            </section>
          ) : (
            <>
              {/* 会议概要卡片 */}
              <section className="rounded-xl border border-[#e1e6ed] bg-white p-5 shadow-[0_1px_2px_rgba(24,36,56,.03)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        分析完成
                      </span>
                      <span className="rounded-full bg-[#eef3ff] px-2.5 py-1 text-xs font-medium text-[#4d6fb8]">
                        模板 · {meeting.promptName || meetingScenarioMeta[scenario]?.label || "通用行动闭环"}
                      </span>
                      {meeting.seriesName && (
                        <span className="rounded-full bg-[#f1f4f8] px-2.5 py-1 text-xs text-[#677487]">
                          {meeting.seriesName}
                        </span>
                      )}
                      {meeting.personalNotes && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                          融合个人速记
                        </span>
                      )}
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{meeting.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-[#6f7b8d]">{meeting.summary}</p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    {meeting.sourceUrl ? (
                      <a
                        href={meeting.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-[#5273ba] hover:text-[#3370ff]"
                      >
                        <FileText size={15} /> 查看飞书文档 <ExternalLink size={13} />
                      </a>
                    ) : (
                      <span className="text-xs text-[#8a95a5]">纯文本/个人记录纪要</span>
                    )}
                  </div>
                </div>

                {/* 元信息与开会日期可编辑 */}
                <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#edf0f4] pt-4 text-xs text-[#7d8899]">
                  <div className="flex items-center gap-1.5 font-medium text-[#3b4758]">
                    <CalendarDays size={14} className="text-[#3370ff]" />
                    <span>开会日期：</span>
                    {editingDate ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="date"
                          value={dateDraft}
                          onChange={(e) => setDateDraft(e.target.value)}
                          className="h-7 rounded border border-[#ccd4e0] px-2 text-xs outline-none focus:border-[#3370ff]"
                        />
                        <button
                          disabled={savingDate}
                          onClick={saveMeetingDate}
                          className="rounded bg-[#3370ff] px-2 py-1 text-white hover:bg-[#2864ed]"
                        >
                          {savingDate ? "..." : "保存"}
                        </button>
                        <button
                          onClick={() => setEditingDate(false)}
                          className="rounded border border-[#dfe4eb] px-2 py-1 text-[#667282] hover:bg-[#f7f8fa]"
                        >
                          取消
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[#1a2332] font-semibold">
                          {formatDate(meeting.meetingDate || meeting.createdAt)}
                        </span>
                        <button
                          onClick={() => {
                            setDateDraft(meeting.meetingDate ? meeting.meetingDate.slice(0, 10) : "");
                            setEditingDate(true);
                          }}
                          className="text-[#3370ff] hover:underline flex items-center gap-0.5 text-[11px]"
                        >
                          <Pencil size={11} /> 修改
                        </button>
                      </span>
                    )}
                  </div>

                  {meeting.durationMinutes && (
                    <span className="flex items-center gap-1.5">
                      <Clock3 size={14} />
                      {meeting.durationMinutes} 分钟
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <UsersRound size={14} />
                    {meeting.participants?.length ? meeting.participants.join("、") : "参会人未识别"}
                  </span>
                </div>
              </section>

              {/* 指标条 */}
              <section className="my-5 grid gap-3 sm:grid-cols-3">
                <Metric
                  icon={<BadgeCheck size={18} />}
                  count={meeting.decisions?.length || 0}
                  label="核心结论 / 决议"
                  tone="green"
                />
                <Metric
                  icon={<ListTodo size={18} />}
                  count={meeting.actionItems?.length || 0}
                  label={`${meeting.actionItems?.filter((item) => item.status !== "completed").length || 0} 项待推进 TODO`}
                  tone="blue"
                />
                <Metric
                  icon={<TriangleAlert size={18} />}
                  count={meeting.risks?.length || 0}
                  label="识别风险 / 阻塞"
                  tone="orange"
                />
              </section>

              {/* 核心内容网格 */}
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,.85fr)]">
                <div className="space-y-5">
                  {/* 1. 核心结论 (Decisions) */}
                  <section className="overflow-hidden rounded-xl border border-[#d6e3f8] bg-white">
                    <SectionHeader
                      icon={<BadgeCheck size={17} className="text-emerald-600" />}
                      title="核心结论 · Decisions"
                      description="会上明确敲定、达成共识的技术决策与业务认定。"
                      count={meeting.decisions?.length || 0}
                    />
                    {meeting.decisions?.length ? (
                      <div className="grid gap-3.5 px-5 pb-5 md:grid-cols-2">
                        {meeting.decisions.map((decision) => (
                          <div
                            key={decision.id}
                            className="rounded-lg border border-[#e5ebf3] bg-[#fafcff] p-4 flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                                <BadgeCheck size={14} /> 已达成共识
                              </div>
                              <h3 className="mt-2 text-sm font-semibold text-[#2c3647]">{decision.title}</h3>
                              <p className="mt-1.5 text-xs leading-5 text-[#637286]">{decision.detail}</p>
                            </div>
                            <EvidenceButton
                              evidence={decision}
                              open={openEvidence.has(decision.id)}
                              onClick={() => toggleEvidence(decision.id)}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptySection text="原文中没有识别到明确拍板的决议事项。" />
                    )}
                  </section>

                  {/* 2. 行动项 (Action Items / TODOs) */}
                  <section className="overflow-hidden rounded-xl border border-[#e2e6ec] bg-white">
                    <SectionHeader
                      icon={<ListTodo size={17} className="text-[#3370ff]" />}
                      title="待办行动项 · TODO"
                      description="明确责任人、动作、截止时间与可交付物（支持就地编辑与状态流转）。"
                      count={meeting.actionItems?.length || 0}
                    />
                    {meeting.actionItems?.length ? (
                      <div className="divide-y divide-[#edf0f4]">
                        {meeting.actionItems.map((action, index) => (
                          <ActionCard
                            key={action.id}
                            action={action}
                            index={index}
                            editing={editingId === action.id}
                            saving={savingId === action.id}
                            evidenceOpen={openEvidence.has(action.id)}
                            onToggleEvidence={() => toggleEvidence(action.id)}
                            onEdit={() => setEditingId(action.id)}
                            onCancel={() => setEditingId(undefined)}
                            onSave={(changes) => updateAction(action.id, changes)}
                            onStatus={(status) => updateAction(action.id, { status })}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptySection text="原文中没有识别到可归属、可执行的行动项。" />
                    )}
                  </section>

                  {/* 3. 事项进展 (如有) */}
                  {meeting.progressItems && meeting.progressItems.length > 0 && (
                    <ProgressSection
                      items={meeting.progressItems}
                      openEvidence={openEvidence}
                      onToggleEvidence={toggleEvidence}
                    />
                  )}

                  {/* 4. 个人记录纪要原文卡片 (如有) */}
                  {meeting.personalNotes && (
                    <section className="overflow-hidden rounded-xl border border-amber-200/70 bg-amber-50/20 p-5">
                      <div className="flex items-center gap-2 mb-2 font-semibold text-sm text-[#483a27]">
                        <FileEdit size={16} className="text-amber-600" /> 个人记录文本纪要原文
                      </div>
                      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-[#5c4f3d] bg-white/80 rounded-lg p-3 border border-amber-100 max-h-60 overflow-y-auto">
                        {meeting.personalNotes}
                      </pre>
                    </section>
                  )}
                </div>

                {/* 右侧栏：群播报、风险、多维表格导出与跨会议追踪 */}
                <aside className="space-y-5">
                  {/* 快速群通知卡片 */}
                  <section className="rounded-xl border border-[#dce6fb] bg-[#f8faff] p-5">
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#3370ff] text-white">
                        <Bot size={18} />
                      </span>
                      <div>
                        <h3 className="font-semibold text-[#294675]">群内机器人播报</h3>
                        <p className="mt-1 text-xs leading-5 text-[#667d9f]">
                          支持预览卡片效果，手动选择机器人一键推送到群。
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={openBotModal}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#3370ff] py-2.5 text-sm font-medium text-white hover:bg-[#2864ed]"
                    >
                      <Eye size={15} /> 预览卡片并发送
                    </button>
                  </section>

                  {/* 风险模块 */}
                  <RiskSection
                    items={meeting.risks ?? []}
                    openEvidence={openEvidence}
                    onToggleEvidence={toggleEvidence}
                  />

                  {/* 分歧 / 留存项 */}
                  {meeting.openQuestions && meeting.openQuestions.length > 0 && (
                    <section className="overflow-hidden rounded-xl border border-[#eadfc9] bg-white">
                      <SectionHeader
                        icon={<CircleAlert size={17} />}
                        title="分歧 / 留存项"
                        description="需要继续拉齐、仍未形成结论的事项。"
                        count={meeting.openQuestions.length}
                      />
                      <div className="space-y-4 px-5 pb-5">
                        {meeting.openQuestions.map((question) => (
                          <div key={question.id} className="border-l-2 border-[#eeb759] pl-3">
                            <h3 className="text-sm font-semibold leading-5 text-[#3e4758]">{question.question}</h3>
                            <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-[#847563]">
                              <UsersRound size={13} className="mt-0.5 shrink-0" />
                              需拉齐：{question.stakeholders?.join("、") || "未明确"}
                            </p>
                            <p className="mt-1.5 text-xs leading-5 text-[#788493]">下一步：{question.nextStep}</p>
                            <EvidenceButton
                              evidence={question}
                              open={openEvidence.has(question.id)}
                              onClick={() => toggleEvidence(question.id)}
                            />
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 跨会议行动项追踪 */}
                  {previousMeeting && (
                    <section className="overflow-hidden rounded-xl border border-[#dce6fb] bg-white">
                      <SectionHeader
                        icon={<History size={17} />}
                        title="跨会议行动项追踪"
                        description={`来自上次「${previousMeeting.title}」的未完成事项。`}
                        count={unfinishedPrevious.length}
                      />
                      {unfinishedPrevious.length ? (
                        <div className="space-y-3 px-5 pb-5">
                          {unfinishedPrevious.map((item) => (
                            <div key={item.id} className="rounded-lg bg-[#f5f8ff] p-3">
                              <div className="flex items-start gap-2">
                                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[#dfe9ff] text-[11px] font-semibold text-[#4a6fbd]">
                                  {item.who.name.slice(0, 1)}
                                </span>
                                <div>
                                  <p className="text-sm font-medium leading-5 text-[#465775]">{item.what}</p>
                                  <p className="mt-1 text-xs text-[#7d8da7]">
                                    {item.who.name} · 截止 {formatDate(item.dueAt)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                          <Link
                            href={`/meeting/${previousMeeting.id}`}
                            className="flex items-center justify-center gap-1.5 pt-1 text-xs font-medium text-[#4d72c5]"
                          >
                            查看上次会议 <ArrowRight size={13} />
                          </Link>
                        </div>
                      ) : (
                        <EmptySection text="上次会议的行动项已全部完成。" />
                      )}
                    </section>
                  )}

                  {/* 多维表格导出卡片 */}
                  <section className="rounded-xl border border-[#dce6fb] bg-[#f8faff] p-5">
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#3370ff] text-white">
                        <Table2 size={18} />
                      </span>
                      <div>
                        <h3 className="font-semibold text-[#294675]">输出到飞书多维表格</h3>
                        <p className="mt-1 text-xs leading-5 text-[#667d9f]">
                          按照结论、TODO、风险结构化输出，包含开会日期。
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={openExportModal}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#3370ff] py-2.5 text-sm font-medium text-white hover:bg-[#2864ed]"
                    >
                      <Send size={15} /> 导出到多维表格
                    </button>
                    {meeting.exports.length > 0 && (
                      <div className="mt-4 border-t border-[#dfe7f5] pt-3">
                        <p className="text-xs font-medium text-[#687c9d]">最近导出记录</p>
                        {meeting.exports.slice(0, 3).map((item) => (
                          <a
                            key={item.id}
                            href={item.targetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 flex items-center justify-between text-xs text-[#637797] hover:text-[#3370ff]"
                          >
                            <span>
                              {formatDate(item.exportedAt, true)} · {item.recordCount} 条
                            </span>
                            <ExternalLink size={12} />
                          </a>
                        ))}
                      </div>
                    )}
                  </section>
                </aside>
              </div>
            </>
          )}
        </div>
      </main>

      {/* 机器人卡片预览与发送模态弹窗 */}
      {botModalOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#172033]/45 p-4 backdrop-blur-[2px] overflow-y-auto"
          onMouseDown={(event) => event.target === event.currentTarget && !sendingBot && setBotModalOpen(false)}
        >
          <div className="w-full max-w-4xl my-6 rounded-2xl bg-white p-6 shadow-2xl border border-white/60">
            <div className="flex items-start justify-between pb-4 border-b border-[#edf0f4]">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-[#3370ff]">
                  <Bot size={20} />
                </span>
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.025em]">群通知卡片预览与手动发送</h2>
                  <p className="mt-0.5 text-xs text-[#7c8798]">
                    预览将在飞书群内呈现的完整富交互卡片，支持勾选内容与选择目标群机器人
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={sendingBot}
                onClick={() => setBotModalOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-[#7c8797] hover:bg-[#f3f5f7]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              {/* 左侧：真实的飞书卡片样式预览 */}
              <div>
                <p className="text-xs font-semibold text-[#546274] mb-2 flex items-center gap-1.5">
                  <Eye size={14} className="text-[#3370ff]" /> 飞书群卡片效果预览 (Live Preview)
                </p>
                <div className="rounded-xl border border-[#d8e0ed] bg-[#f5f6f8] p-4 shadow-inner">
                  {/* 模拟飞书聊天气泡 */}
                  <div className="max-w-md mx-auto rounded-lg border border-[#dee3ea] bg-white shadow-sm overflow-hidden text-xs text-[#1f2735]">
                    {/* 卡片彩色 Header */}
                    <div
                      className={`px-4 py-3 text-white font-medium flex items-center justify-between ${
                        botIncludeRisks && meeting.risks?.some((r) => r.level === "high")
                          ? "bg-gradient-to-r from-amber-600 to-orange-500"
                          : "bg-gradient-to-r from-[#3370ff] to-[#2859c7]"
                      }`}
                    >
                      <span className="font-semibold text-sm truncate">📋 会议行动闭环 · {meeting.title}</span>
                      <span className="text-[10px] opacity-80 shrink-0">群通知卡片</span>
                    </div>

                    <div className="p-4 space-y-3">
                      {/* 播报前言 */}
                      {botIntroText.trim() && (
                        <div className="rounded-md bg-[#edf3ff] p-2 text-[#35528c] font-medium leading-relaxed">
                          {botIntroText.trim()}
                        </div>
                      )}

                      {/* 元信息分栏 */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] bg-[#f9fafc] p-2.5 rounded-lg border border-[#edf0f4]">
                        <div>
                          <span className="text-[#8492a6]">📅 开会日期：</span>
                          <span className="font-semibold text-[#293444] block">
                            {formatDate(meeting.meetingDate || meeting.createdAt)}
                          </span>
                        </div>
                        {meeting.seriesName && (
                          <div>
                            <span className="text-[#8492a6]">🏷️ 会议系列：</span>
                            <span className="font-medium text-[#293444] block truncate">{meeting.seriesName}</span>
                          </div>
                        )}
                        {meeting.participants?.length > 0 && (
                          <div className="col-span-2 mt-1">
                            <span className="text-[#8492a6]">👥 参会人：</span>
                            <span className="text-[#293444]">{meeting.participants.join("、")}</span>
                          </div>
                        )}
                      </div>

                      {/* 摘要 */}
                      {meeting.summary && (
                        <div className="leading-relaxed text-[#4b5869]">
                          <strong className="text-[#252f3d]">📝 会议总结：</strong>
                          <p className="mt-0.5 line-clamp-3">{meeting.summary}</p>
                        </div>
                      )}

                      {/* 结论预览 */}
                      {botIncludeDecisions && (meeting.decisions?.length || 0) > 0 && (
                        <div className="border-t border-[#edf0f4] pt-2">
                          <p className="font-semibold text-emerald-700 flex items-center gap-1">
                            <BadgeCheck size={13} /> 核心结论 ({meeting.decisions.length})
                          </p>
                          <div className="mt-1 space-y-1.5 pl-1">
                            {meeting.decisions.slice(0, 3).map((d, i) => (
                              <div key={d.id} className="text-[#3b4758]">
                                <span className="font-medium text-[#202735]">
                                  {i + 1}. {d.title}
                                </span>
                                <span className="text-[#6d798a] block text-[11px] line-clamp-1">{d.detail}</span>
                              </div>
                            ))}
                            {meeting.decisions.length > 3 && (
                              <p className="text-[10px] text-[#8a95a5]">… 等共 {meeting.decisions.length} 条决议</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* TODO 预览 */}
                      {botIncludeActions && (meeting.actionItems?.length || 0) > 0 && (
                        <div className="border-t border-[#edf0f4] pt-2">
                          <p className="font-semibold text-[#3370ff] flex items-center gap-1">
                            <ListTodo size={13} /> 行动项 TODO ({meeting.actionItems.length})
                          </p>
                          <div className="mt-1 space-y-1 pl-1">
                            {meeting.actionItems.slice(0, 3).map((act, i) => (
                              <div key={act.id} className="text-[#3b4758]">
                                <span className="font-medium text-[#202735]">
                                  {i + 1}. {act.who.name}
                                </span>
                                ：{act.what}
                                {act.dueAt && <span className="text-amber-600"> (截止 {act.dueAt.slice(0, 10)})</span>}
                              </div>
                            ))}
                            {meeting.actionItems.length > 3 && (
                              <p className="text-[10px] text-[#8a95a5]">… 等共 {meeting.actionItems.length} 条待办</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 风险预览 */}
                      {botIncludeRisks && (meeting.risks?.length || 0) > 0 && (
                        <div className="border-t border-[#edf0f4] pt-2">
                          <p className="font-semibold text-amber-700 flex items-center gap-1">
                            <TriangleAlert size={13} /> 潜在风险 ({meeting.risks.length})
                          </p>
                          <div className="mt-1 space-y-1 pl-1">
                            {meeting.risks.map((r, i) => (
                              <div key={r.id} className="text-[#3b4758]">
                                <span
                                  className={`font-semibold ${
                                    r.level === "high"
                                      ? "text-red-600"
                                      : r.level === "medium"
                                      ? "text-amber-600"
                                      : "text-slate-600"
                                  }`}
                                >
                                  {r.level === "high" ? "🔴" : "🟡"} [{r.level === "high" ? "高危" : "中度"}]{" "}
                                </span>
                                <span className="font-medium">{r.title}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 底部按钮预览 */}
                      <div className="border-t border-[#edf0f4] pt-2 flex gap-2">
                        <span className="flex-1 text-center py-1.5 rounded bg-[#3370ff] text-white font-medium text-[11px]">
                          查看飞书文档
                        </span>
                        <span className="flex-1 text-center py-1.5 rounded bg-[#edf1f7] text-[#4d5968] font-medium text-[11px]">
                          查看多维表格
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 右侧：播报参数设置与机器人选择 */}
              <form onSubmit={handleSendToBot} className="flex flex-col justify-between">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#485566] mb-1.5">
                      播报前言 / 群内附言
                    </label>
                    <textarea
                      rows={2}
                      value={botIntroText}
                      onChange={(e) => setBotIntroText(e.target.value)}
                      placeholder="可在卡片开头附带 @全体 或关键提醒..."
                      className="w-full rounded-lg border border-[#dce2ea] p-2.5 text-xs outline-none focus:border-[#6e96f4] resize-none leading-relaxed"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#485566] mb-1.5">
                      选择包含内容模块
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-[#2c3645] bg-[#f8fafc] p-2 rounded-lg border border-[#e4e9f0] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={botIncludeDecisions}
                          onChange={(e) => setBotIncludeDecisions(e.target.checked)}
                          className="rounded text-[#3370ff]"
                        />
                        <span>结论 ({meeting.decisions?.length || 0})</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-[#2c3645] bg-[#f8fafc] p-2 rounded-lg border border-[#e4e9f0] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={botIncludeActions}
                          onChange={(e) => setBotIncludeActions(e.target.checked)}
                          className="rounded text-[#3370ff]"
                        />
                        <span>TODO ({meeting.actionItems?.length || 0})</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-[#2c3645] bg-[#f8fafc] p-2 rounded-lg border border-[#e4e9f0] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={botIncludeRisks}
                          onChange={(e) => setBotIncludeRisks(e.target.checked)}
                          className="rounded text-[#3370ff]"
                        />
                        <span>风险 ({meeting.risks?.length || 0})</span>
                      </label>
                    </div>
                  </div>

                  {/* 机器人选择 */}
                  <div className="rounded-xl border border-[#e0e7f3] bg-[#f8faff] p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#2a3c5a] flex items-center gap-1.5">
                        <Bot size={14} className="text-[#3370ff]" /> 选择推送机器人
                      </span>
                      <label className="flex items-center gap-1 text-[11px] text-[#556988] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useCustomWebhook}
                          onChange={(e) => setUseCustomWebhook(e.target.checked)}
                          className="rounded text-[#3370ff]"
                        />
                        <span>自定义 Webhook</span>
                      </label>
                    </div>

                    {!useCustomWebhook ? (
                      <div>
                        {availableBots.length > 0 ? (
                          <select
                            value={selectedBotId}
                            onChange={(e) => setSelectedBotId(e.target.value)}
                            className="h-10 w-full rounded-lg border border-[#d6dfea] bg-white px-3 text-xs outline-none focus:border-[#3370ff]"
                          >
                            {availableBots.map((bot) => (
                              <option key={bot.id} value={bot.id}>
                                🤖 {bot.name} ({bot.webhookMasked})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                            系统尚未配置可用机器人，请勾选“自定义 Webhook”输入地址。
                          </div>
                        )}
                        <p className="mt-1 text-[11px] text-[#7a8da3]">
                          将把卡片直接推送到该机器人所在的飞书群聊。
                        </p>
                      </div>
                    ) : (
                      <div>
                        <input
                          type="url"
                          required={useCustomWebhook}
                          value={customWebhookUrl}
                          onChange={(e) => setCustomWebhookUrl(e.target.value)}
                          placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                          className="h-10 w-full rounded-lg border border-[#d6dfea] bg-white px-3 text-xs outline-none focus:border-[#3370ff]"
                        />
                        <p className="mt-1 text-[11px] text-[#7a8da3]">
                          可从飞书群聊设置 &gt; 群机器人 &gt; 添加自定义机器人获取 Webhook。
                        </p>
                      </div>
                    )}
                  </div>

                  {sendBotError && (
                    <div className="flex gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
                      <CircleAlert size={15} className="mt-0.5 shrink-0" />
                      <div>{sendBotError}</div>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-end gap-2 border-t border-[#edf0f4] pt-4">
                  <button
                    type="button"
                    disabled={sendingBot}
                    onClick={() => setBotModalOpen(false)}
                    className="h-9 rounded-lg border border-[#dfe4eb] px-4 text-xs font-medium text-[#566273] hover:bg-[#f7f8fa]"
                  >
                    取消
                  </button>
                  <button
                    disabled={sendingBot || (!selectedBotId && !customWebhookUrl)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#3370ff] px-4 text-xs font-medium text-white hover:bg-[#2864ed] disabled:opacity-60 shadow-sm"
                  >
                    {sendingBot ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
                    {sendingBot ? "正在发送至群聊…" : "确认发送到群"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 导出弹窗 */}
      {exportOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#172033]/40 p-4 backdrop-blur-[2px] overflow-y-auto"
          onMouseDown={(event) => event.target === event.currentTarget && !exporting && setExportOpen(false)}
        >
          <form
            onSubmit={exportActions}
            className="w-full max-w-lg my-8 rounded-2xl bg-white p-6 shadow-2xl border border-white/60"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">导出到飞书多维表格</h2>
                <p className="mt-1 text-sm text-[#798597]">
                  按结论、TODO、风险的方式格式化输出，并附带开会日期（
                  {formatDate(meeting.meetingDate || meeting.createdAt)}）。
                </p>
              </div>
              <button
                type="button"
                disabled={exporting}
                onClick={() => setExportOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-[#7c8797] hover:bg-[#f3f5f7]"
              >
                <X size={18} />
              </button>
            </div>

            {/* 导出品类勾选 */}
            <div className="mt-5 rounded-xl border border-[#e5e9f2] bg-[#f9fafc] p-3.5">
              <p className="text-xs font-semibold text-[#546274] mb-2.5">选择导出品类：</p>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex items-center gap-2 text-xs font-medium text-[#2d3748] cursor-pointer bg-white px-2.5 py-2 rounded-lg border border-[#e1e6ed]">
                  <input
                    type="checkbox"
                    checked={includeDecisions}
                    onChange={(e) => setIncludeDecisions(e.target.checked)}
                    className="rounded text-[#3370ff]"
                  />
                  <span>结论 ({meeting.decisions?.length || 0})</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-[#2d3748] cursor-pointer bg-white px-2.5 py-2 rounded-lg border border-[#e1e6ed]">
                  <input
                    type="checkbox"
                    checked={includeActionItems}
                    onChange={(e) => setIncludeActionItems(e.target.checked)}
                    className="rounded text-[#3370ff]"
                  />
                  <span>TODO ({meeting.actionItems?.length || 0})</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-[#2d3748] cursor-pointer bg-white px-2.5 py-2 rounded-lg border border-[#e1e6ed]">
                  <input
                    type="checkbox"
                    checked={includeRisks}
                    onChange={(e) => setIncludeRisks(e.target.checked)}
                    className="rounded text-[#3370ff]"
                  />
                  <span>风险 ({meeting.risks?.length || 0})</span>
                </label>
              </div>
              <p className="mt-2 text-[11px] text-[#8c97a8]">
                预计共导出 {totalExportItems} 条结构化记录到目标表格。
              </p>
            </div>

            {/* 写入模式单选 */}
            <div className="mt-4 rounded-xl border border-[#e5e9f2] bg-[#f9fafc] p-3.5">
              <p className="text-xs font-semibold text-[#546274] mb-2">多维表格写入模式：</p>
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer rounded-lg bg-white p-2.5 border border-[#e1e6ed] transition-colors hover:border-[#3370ff]/40">
                  <input
                    type="radio"
                    name="exportMode"
                    checked={!createNewTab}
                    onChange={() => setCreateNewTab(false)}
                    className="mt-0.5 text-[#3370ff] focus:ring-[#3370ff]"
                  />
                  <div>
                    <div className="text-xs font-semibold text-[#2d3748] flex items-center gap-1.5">
                      <span>追加到当前汇总数据表</span>
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">推荐</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#718096] leading-relaxed">
                      集中沉淀在同一表中，带「开会日期」字段，方便多维表格视图分组与后续<strong>跨多次会议风险评估</strong>。
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer rounded-lg bg-white p-2.5 border border-[#e1e6ed] transition-colors hover:border-[#3370ff]/40">
                  <input
                    type="radio"
                    name="exportMode"
                    checked={createNewTab}
                    onChange={() => {
                      setCreateNewTab(true);
                      if (!tabName) {
                        const datePart = (meeting.meetingDate || meeting.createdAt || "").slice(0, 10);
                        setTabName(`${datePart} ${meeting.title || "会议行动项"}`.trim());
                      }
                    }}
                    className="mt-0.5 text-[#3370ff] focus:ring-[#3370ff]"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-[#2d3748]">
                      在多维表格中新建独立 Tab
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#718096] leading-relaxed">
                      将在目标多维表格自动创建新工作表（Tab），单次会议独立隔离。
                    </p>
                    {createNewTab && (
                      <div className="mt-2.5">
                        <label className="block text-[11px] font-medium text-[#4a5568]">新 Tab 名称：</label>
                        <input
                          type="text"
                          required={createNewTab}
                          value={tabName}
                          onChange={(e) => setTabName(e.target.value)}
                          placeholder="例如：2026-10-14 需求对齐会"
                          className="mt-1 h-8 w-full rounded border border-[#cbd5e1] px-2.5 text-xs outline-none focus:border-[#3370ff]"
                        />
                      </div>
                    )}
                  </div>
                </label>
              </div>

              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-[#2b6cb0] bg-blue-50/70 rounded-md px-2.5 py-1.5">
                <Sparkles size={13} className="shrink-0 text-[#3182ce]" />
                <span>已启用<strong>文字简要化</strong>：结论、任务与风险标题控制在 40~60 字以内，清爽干练。</span>
              </div>
            </div>

            <label className="mt-5 block text-sm font-medium text-[#3e4959]">
              多维表格链接 <span className="text-red-500">*</span>
            </label>
            <input
              required
              type="text"
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              placeholder="https://segway-ninebot.feishu.cn/wiki/... 或 /base/..."
              className="mt-1.5 h-11 w-full rounded-lg border border-[#dce2ea] px-3 text-sm outline-none placeholder:text-[#a6afbb] focus:border-[#6e96f4] focus:ring-2 focus:ring-[#3370ff]/10"
            />
            <p className="mt-1.5 text-xs leading-5 text-[#8994a4]">
              已默认填入您的指定目标多维表格链接。
            </p>

            {/* 权限提示指引 */}
            <div className="mt-3.5 rounded-lg border border-blue-100 bg-[#f4f7fe] p-3 text-xs leading-relaxed text-[#4b6088]">
              💡 <strong>写入提示：</strong>请确保在飞书打开目标多维表格页面，在右上角点击「···」或「分享/协同」，将飞书自建应用「<strong>FEB</strong>」添加为可编辑协作者。
            </div>

            {exportError && (
              <div className="mt-4 flex gap-2 rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">
                <CircleAlert size={16} className="mt-0.5 shrink-0" />
                <div>{exportError}</div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={exporting}
                onClick={() => setExportOpen(false)}
                className="h-10 rounded-lg border border-[#dfe4eb] px-4 text-sm font-medium text-[#566273] hover:bg-[#f7f8fa]"
              >
                取消
              </button>
              <button
                disabled={exporting || totalExportItems === 0}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#3370ff] px-4 text-sm font-medium text-white hover:bg-[#2864ed] disabled:opacity-60"
              >
                {exporting ? <LoaderCircle size={16} className="animate-spin" /> : <Table2 size={16} />}
                {exporting ? "正在写入目标表格…" : `确认导出 (${totalExportItems} 条)`}
              </button>
            </div>
          </form>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-5 left-[calc(50%+7.5rem)] z-[60] -translate-x-1/2 rounded-lg bg-[#202735] px-4 py-2.5 text-sm text-white shadow-lg">
          {notice}
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  description,
  count,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  count: number;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[#edf3ff] text-[#3370ff]">
          {icon}
        </span>
        <div>
          <h2 className="font-semibold tracking-[-0.02em]">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-[#8590a0]">{description}</p>
        </div>
      </div>
      <span className="rounded-full bg-[#f2f5f9] px-2.5 py-1 text-xs font-medium text-[#617083]">{count} 项</span>
    </div>
  );
}

function Metric({
  icon,
  count,
  label,
  tone,
}: {
  icon: ReactNode;
  count: number;
  label: string;
  tone: "green" | "orange" | "blue";
}) {
  const colors = {
    green: "bg-emerald-50 text-emerald-600",
    orange: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-blue-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#e5e9ef] bg-white px-4 py-3.5">
      <span className={`grid size-9 place-items-center rounded-lg ${colors[tone]}`}>{icon}</span>
      <div>
        <p className="text-xl font-semibold leading-5">{count}</p>
        <p className="mt-1 text-xs text-[#7e8898]">{label}</p>
      </div>
    </div>
  );
}

const progressStatusMeta = {
  not_started: { label: "未开始", className: "bg-slate-100 text-slate-600" },
  on_track: { label: "正常推进", className: "bg-emerald-50 text-emerald-700" },
  at_risk: { label: "有风险", className: "bg-amber-50 text-amber-700" },
  blocked: { label: "已阻塞", className: "bg-red-50 text-red-700" },
  completed: { label: "已完成", className: "bg-blue-50 text-blue-700" },
} as const;

function ProgressSection({
  items,
  openEvidence,
  onToggleEvidence,
}: {
  items: MeetingProgressItem[];
  openEvidence: Set<string>;
  onToggleEvidence: (id: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#e2e6ec] bg-white">
      <SectionHeader
        icon={<Activity size={17} />}
        title="事项进展"
        description="按技术需求或项目聚合当前状态、实际进展与下一里程碑。"
        count={items.length}
      />
      {items.length ? (
        <div className="divide-y divide-[#edf0f4]">
          {items.map((item) => {
            const status = progressStatusMeta[item.status];
            return (
              <article key={item.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-[#354052]">{item.project}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>
                    {status.label}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#788496]">
                  <span className="flex items-center gap-1.5">
                    <UserRound size={13} />
                    {item.owner}
                  </span>
                  <span className={`flex items-center gap-1.5 ${item.dueAt ? "" : "text-red-600"}`}>
                    <CalendarDays size={13} />
                    {item.dueAt ? `目标 ${formatDate(item.dueAt)}` : "完成时间未定"}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 rounded-lg bg-[#f8fafc] p-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-medium text-[#929cab]">当前进展</p>
                    <p className="mt-1 text-sm leading-6 text-[#536071]">{item.progress}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[#929cab]">下一步</p>
                    <p className="mt-1 text-sm leading-6 text-[#536071]">{item.nextStep}</p>
                  </div>
                </div>
                <EvidenceButton
                  evidence={item}
                  open={openEvidence.has(item.id)}
                  onClick={() => onToggleEvidence(item.id)}
                />
              </article>
            );
          })}
        </div>
      ) : (
        <EmptySection text="本次会议没有识别到明确的事项进展。" />
      )}
    </section>
  );
}

function RiskSection({
  items,
  openEvidence,
  onToggleEvidence,
}: {
  items: MeetingRisk[];
  openEvidence: Set<string>;
  onToggleEvidence: (id: string) => void;
}) {
  const levels = {
    low: { label: "低风险", className: "bg-slate-100 text-slate-700 border-slate-300" },
    medium: { label: "中风险", className: "bg-amber-50 text-amber-700 border-amber-300" },
    high: { label: "高危风险", className: "bg-red-50 text-red-700 border-red-400" },
  } as const;

  return (
    <section className="overflow-hidden rounded-xl border border-[#eadfc9] bg-white">
      <SectionHeader
        icon={<TriangleAlert size={17} className="text-amber-600" />}
        title="潜在风险 / 阻塞 · Risks"
        description="影响交付时间、质量、范围或依赖协作的风险项（用于后续多会议评估）。"
        count={items.length}
      />
      {items.length ? (
        <div className="space-y-4 px-5 pb-5">
          {items.map((item) => {
            const level = levels[item.level] || levels.medium;
            return (
              <article
                key={item.id}
                className={`border-l-3 pl-3.5 py-1 ${level.className.split(" ").find((name) => name.startsWith("border-"))}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-5 text-[#303a4b]">{item.title}</h3>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${level.className}`}>
                    {level.label}
                  </span>
                </div>
                {item.owner && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#7b6e60]">
                    <UserRound size={13} />
                    跟进人：{item.owner}
                  </p>
                )}
                <p className="mt-2 text-xs leading-5 text-[#6c7787]">
                  <strong className="font-semibold text-[#485363]">业务影响：</strong>
                  {item.impact}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#6c7787]">
                  <strong className="font-semibold text-[#485363]">缓解措施：</strong>
                  {item.mitigation}
                </p>
                <EvidenceButton
                  evidence={item}
                  open={openEvidence.has(item.id)}
                  onClick={() => onToggleEvidence(item.id)}
                />
              </article>
            );
          })}
        </div>
      ) : (
        <EmptySection text="本次会议未发现明显阻碍与交付风险。" />
      )}
    </section>
  );
}

function EmptySection({ text }: { text: string }) {
  return <p className="px-5 pb-6 text-sm text-[#8a94a3]">{text}</p>;
}

function EvidenceButton({
  evidence,
  open,
  onClick,
}: {
  evidence: MeetingEvidence;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <>
      <button
        onClick={onClick}
        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-[#6179b4] hover:text-[#3370ff]"
      >
        <MessageSquareQuote size={14} /> 原文溯源{" "}
        <ChevronDown size={13} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-[#e1e7f1] bg-[#f8faff] p-3">
          <p className="text-xs font-medium leading-5 text-[#4a5870]">
            “{evidence.quote ? evidence.quote.replace(/^[“\"]|[”\"]$/g, "") : ""}”
          </p>
          <p className="mt-2 border-t border-[#e4eaf5] pt-2 text-xs leading-5 text-[#79869c]">
            {evidence.context}
          </p>
        </div>
      )}
    </>
  );
}

function ActionCard({
  action,
  index,
  editing,
  saving,
  evidenceOpen,
  onToggleEvidence,
  onEdit,
  onCancel,
  onSave,
  onStatus,
}: {
  action: MeetingActionItem;
  index: number;
  editing: boolean;
  saving: boolean;
  evidenceOpen: boolean;
  onToggleEvidence: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (changes: Record<string, unknown>) => void;
  onStatus: (status: MeetingActionStatus) => void;
}) {
  const [draft, setDraft] = useState(action);
  const status = actionStatusMeta[action.status];
  if (editing)
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            who: draft.who,
            what: draft.what,
            dueAt: draft.dueAt || null,
            deliverable: draft.deliverable,
          });
        }}
        className="bg-[#fbfcfe] px-5 py-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">编辑行动项 0{index + 1}</p>
          <button type="button" onClick={onCancel} className="text-[#7d8797]">
            <X size={17} />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <EditField label="Who · 责任人">
            <input
              required
              value={draft.who.name}
              onChange={(event) => setDraft({ ...draft, who: { ...draft.who, name: event.target.value } })}
            />
          </EditField>
          <EditField label="Email">
            <input
              type="email"
              value={draft.who.email || ""}
              onChange={(event) => setDraft({ ...draft, who: { ...draft.who, email: event.target.value || undefined } })}
            />
          </EditField>
          <EditField label="What · 做什么" wide>
            <input
              required
              value={draft.what}
              onChange={(event) => setDraft({ ...draft, what: event.target.value })}
            />
          </EditField>
          <EditField label="When · 截止时间">
            <input
              type="date"
              value={draft.dueAt?.slice(0, 10) || ""}
              onChange={(event) => setDraft({ ...draft, dueAt: event.target.value || undefined })}
            />
          </EditField>
          <EditField label="Deliverable · 交付物">
            <input
              required
              value={draft.deliverable}
              onChange={(event) => setDraft({ ...draft, deliverable: event.target.value })}
            />
          </EditField>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[#dfe4eb] px-3 py-2 text-xs font-medium"
          >
            取消
          </button>
          <button
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3370ff] px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
          >
            {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}保存
          </button>
        </div>
      </form>
    );

  return (
    <article className="px-5 py-4">
      <div className="flex items-start gap-3">
        <button
          disabled={saving}
          onClick={() => onStatus(action.status === "completed" ? "in_progress" : "completed")}
          className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] border ${
            action.status === "completed"
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-[#cfd7e3] bg-white text-transparent hover:border-[#3370ff]"
          }`}
        >
          <Check size={14} strokeWidth={3} />
        </button>
        <span className="mt-0.5 font-mono text-xs text-[#a1aab8]">0{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`text-[15px] font-medium leading-5 ${
                action.status === "completed" ? "text-[#8a94a3] line-through" : "text-[#2c3544]"
              }`}
            >
              {action.what}
            </h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${status.className}`}>
              {status.label}
            </span>
            <button
              onClick={onEdit}
              className="ml-auto grid size-7 place-items-center rounded-md text-[#8993a2] hover:bg-[#f1f4f8] hover:text-[#3370ff]"
            >
              <Pencil size={14} />
            </button>
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <ActionField icon={<UserRound size={13} />} label="Who" value={action.who.name} />
            {action.who.email && <ActionField icon={<Mail size={13} />} label="Email" value={action.who.email} />}
            <ActionField
              icon={<CalendarDays size={13} />}
              label="When"
              value={formatDate(action.dueAt)}
              alert={!action.dueAt}
            />
            <ActionField icon={<FileText size={13} />} label="Deliverable" value={action.deliverable} />
          </div>
          <EvidenceButton evidence={action} open={evidenceOpen} onClick={onToggleEvidence} />
        </div>
      </div>
    </article>
  );
}

function ActionField({
  icon,
  label,
  value,
  alert,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="text-[#97a1af]">{icon}</span>
      <span className="font-mono text-[#97a1af]">{label}</span>
      <span className={alert ? "font-medium text-red-600" : "truncate text-[#586373]"}>{value}</span>
      {alert && <CircleAlert size={13} className="shrink-0 text-red-500" />}
    </div>
  );
}

function EditField({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={wide ? "sm:col-span-2" : ""}>
      <span className="mb-1.5 block text-xs font-medium text-[#667386]">{label}</span>
      <span className="block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-[#dce2ea] [&_input]:bg-white [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none focus-within:[&_input]:border-[#6e96f4]">
        {children}
      </span>
    </label>
  );
}
