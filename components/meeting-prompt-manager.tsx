"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpenCheck,
  CircleAlert,
  CopyPlus,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { meetingScenarioMeta } from "@/lib/meeting/types";
import type { MeetingPromptTemplate, MeetingScenario } from "@/lib/meeting/types";

interface PromptDraft {
  name: string;
  description: string;
  scenario: MeetingScenario;
  instructions: string;
}

function toDraft(prompt: MeetingPromptTemplate): PromptDraft {
  return {
    name: prompt.name,
    description: prompt.description,
    scenario: prompt.scenario,
    instructions: prompt.instructions,
  };
}

const emptyDraft: PromptDraft = {
  name: "",
  description: "",
  scenario: "technical_weekly",
  instructions: "请根据会议原文分析本场会议，并按照本模板的业务目标提取关键信息。\n\n分析规则：\n1. ",
};

export function MeetingPromptManager({ initialPrompts }: { initialPrompts: MeetingPromptTemplate[] }) {
  const [prompts, setPrompts] = useState(initialPrompts);
  const [selectedId, setSelectedId] = useState(initialPrompts[0]?.id || "");
  const [draft, setDraft] = useState<PromptDraft>(initialPrompts[0] ? toDraft(initialPrompts[0]) : emptyDraft);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = prompts.find((prompt) => prompt.id === selectedId);

  function choose(prompt: MeetingPromptTemplate) {
    if (saving) return;
    setSelectedId(prompt.id);
    setDraft(toDraft(prompt));
    setCreating(false);
    setError("");
  }

  function startCreate(base?: MeetingPromptTemplate) {
    setSelectedId("");
    setCreating(true);
    setDraft(base ? { ...toDraft(base), name: `${base.name}副本`, description: `${base.description}（自定义）` } : emptyDraft);
    setError("");
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(creating ? "/api/meeting-prompts" : `/api/meeting-prompts/${selectedId}`, {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await response.json()) as { prompt?: MeetingPromptTemplate; error?: string };
      if (!response.ok || !body.prompt) throw new Error(body.error || "保存 Prompt 失败");
      if (creating) {
        setPrompts((current) => [...current, body.prompt!]);
      } else {
        setPrompts((current) => current.map((prompt) => prompt.id === body.prompt!.id ? body.prompt! : prompt));
      }
      setSelectedId(body.prompt.id);
      setDraft(toDraft(body.prompt));
      setCreating(false);
      showNotice("Prompt 已保存");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存 Prompt 失败");
    } finally {
      setSaving(false);
    }
  }

  async function resetBuiltIn() {
    if (!selected?.builtIn || saving) return;
    if (!window.confirm(`确定将「${selected.name}」恢复为系统默认内容吗？当前修改会被覆盖。`)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/meeting-prompts/${selected.id}/reset`, { method: "POST" });
      const body = (await response.json()) as { prompt?: MeetingPromptTemplate; error?: string };
      if (!response.ok || !body.prompt) throw new Error(body.error || "恢复默认失败");
      setPrompts((current) => current.map((prompt) => prompt.id === body.prompt!.id ? body.prompt! : prompt));
      setDraft(toDraft(body.prompt));
      showNotice("已恢复内置默认内容");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "恢复默认失败");
    } finally {
      setSaving(false);
    }
  }

  async function removePrompt() {
    if (!selected || selected.builtIn || saving) return;
    if (!window.confirm(`确定删除 Prompt「${selected.name}」吗？已使用该 Prompt 的历史会议不会受影响。`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/meeting-prompts/${selected.id}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "删除 Prompt 失败");
      const remaining = prompts.filter((prompt) => prompt.id !== selected.id);
      setPrompts(remaining);
      if (remaining[0]) {
        setSelectedId(remaining[0].id);
        setDraft(toDraft(remaining[0]));
        setCreating(false);
      } else {
        setSelectedId("");
        setDraft(emptyDraft);
        setCreating(true);
      }
      showNotice("Prompt 已删除");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除 Prompt 失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#202938]">
      <AppSidebar />
      <main className="ml-60 min-h-screen">
        <header className="border-b border-[#e7eaf0] bg-white">
          <div className="flex h-16 items-center justify-between px-8">
            <div className="flex items-center gap-3"><Link href="/meeting" className="grid size-8 place-items-center rounded-lg text-[#6d7889] hover:bg-[#f2f4f7]"><ArrowLeft size={18} /></Link><div><h1 className="text-[17px] font-semibold">Prompt 管理</h1><p className="mt-0.5 text-xs text-[#8a94a3]">维护会议分析模板与提取规则</p></div></div>
            <button onClick={() => startCreate()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#3370ff] px-3.5 text-sm font-medium text-white hover:bg-[#2864ed]"><Plus size={16} /> 新建 Prompt</button>
          </div>
        </header>

        <div className="grid w-full gap-5 px-8 py-7 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-xl border border-[#e2e6ec] bg-white">
            <div className="border-b border-[#e9edf2] px-4 py-3"><h2 className="text-sm font-semibold">Prompt 模板</h2><p className="mt-1 text-xs text-[#8a94a3]">{prompts.length} 个模板</p></div>
            <div className="max-h-[calc(100vh-180px)] space-y-1 overflow-y-auto p-2">
              {prompts.map((prompt) => <button key={prompt.id} onClick={() => choose(prompt)} className={`w-full rounded-lg px-3 py-3 text-left transition ${!creating && selectedId === prompt.id ? "bg-[#edf3ff]" : "hover:bg-[#f6f7f9]"}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-[#3b4657]">{prompt.name}</span>{prompt.builtIn && <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[#5273ba] ring-1 ring-[#d8e3f8]">内置</span>}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-[#7d8898]">{prompt.description}</p><span className="mt-2 inline-flex text-[10px] text-[#8793a5]">{meetingScenarioMeta[prompt.scenario].label}</span></button>)}
            </div>
          </aside>

          <form onSubmit={save} className="rounded-xl border border-[#e2e6ec] bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e9edf2] px-6 py-4"><div><div className="flex items-center gap-2"><h2 className="font-semibold">{creating ? "新建 Prompt" : selected?.name || "Prompt 编辑"}</h2>{selected?.builtIn && !creating && <span className="rounded-full bg-[#edf3ff] px-2 py-0.5 text-[11px] font-medium text-[#5273ba]">系统内置</span>}</div><p className="mt-1 text-xs text-[#8994a4]">业务规则可自由编辑；结构化输出和原文溯源协议由系统固定追加。</p></div><div className="flex items-center gap-2">{selected && !creating && <button type="button" onClick={() => startCreate(selected)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#dfe4eb] px-3 text-xs font-medium text-[#5f6c7e] hover:bg-[#f7f8fa]"><CopyPlus size={14} /> 复制</button>}{selected?.builtIn && !creating && <button type="button" onClick={resetBuiltIn} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#dfe4eb] px-3 text-xs font-medium text-[#5f6c7e] hover:bg-[#f7f8fa] disabled:opacity-60"><RotateCcw size={14} /> 恢复默认</button>}{selected && !selected.builtIn && !creating && <button type="button" onClick={removePrompt} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"><Trash2 size={14} /> 删除</button>}</div></div>

            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-2"><EditorField label="Prompt 名称"><input required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：月度项目复盘" /></EditorField><EditorField label="结果展示模式"><select value={draft.scenario} onChange={(event) => setDraft({ ...draft, scenario: event.target.value as MeetingScenario })}><option value="technical_weekly">进展 / 风险 / TODO</option><option value="technical_review">结论 / 待确定细节 / TODO</option></select></EditorField></div>
              <EditorField label="用途说明"><input required maxLength={300} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="说明适用的会议和期望结果" /></EditorField>
              <div><div className="flex items-center justify-between"><label htmlFor="prompt-instructions" className="text-sm font-medium text-[#465163]">Prompt 业务规则</label><span className="text-xs text-[#929cab]">{draft.instructions.length} / 30000</span></div><textarea id="prompt-instructions" required minLength={20} maxLength={30000} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} className="mt-2 min-h-[430px] w-full resize-y rounded-xl border border-[#dce2ea] bg-[#fbfcfe] p-4 font-mono text-[13px] leading-6 text-[#39475a] outline-none focus:border-[#6e96f4] focus:ring-2 focus:ring-[#3370ff]/10" /></div>
              <div className="flex items-start gap-2 rounded-lg border border-[#dce6fb] bg-[#f6f9ff] p-3 text-xs leading-5 text-[#617696]"><BookOpenCheck size={16} className="mt-0.5 shrink-0 text-[#4f76cb]" /><p>系统会自动追加固定的 JSON 字段协议、5W1H 行动项结构和原文 quote/context 要求，无需在 Prompt 中重复编写。</p></div>
              {error && <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700"><CircleAlert size={16} className="mt-0.5 shrink-0" />{error}</div>}
            </div>
            <div className="flex justify-end border-t border-[#e9edf2] px-6 py-4"><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#3370ff] px-4 text-sm font-medium text-white hover:bg-[#2864ed] disabled:opacity-60">{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}{saving ? "保存中…" : "保存 Prompt"}</button></div>
          </form>
        </div>
      </main>
      {notice && <div className="fixed bottom-5 left-[calc(50%+7.5rem)] z-50 -translate-x-1/2 rounded-lg bg-[#202735] px-4 py-2.5 text-sm text-white shadow-lg"><span className="mr-2 text-[#8bb0ff]"><Sparkles size={14} className="inline" /></span>{notice}</div>}
    </div>
  );
}

function EditorField({ label, children }: { label: string; children: ReactNode }) {
  return <label><span className="mb-1.5 block text-sm font-medium text-[#465163]">{label}</span><span className="block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-[#dce2ea] [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none [&_select]:h-10 [&_select]:w-full [&_select]:rounded-lg [&_select]:border [&_select]:border-[#dce2ea] [&_select]:bg-white [&_select]:px-3 [&_select]:text-sm [&_select]:outline-none focus-within:[&_input]:border-[#6e96f4] focus-within:[&_select]:border-[#6e96f4]">{children}</span></label>;
}
