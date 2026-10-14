"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  AtSign,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_ROSTER_SOURCE_URL, RosterConfig, RosterMember } from "@/lib/roster/types";

interface BotOption {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
}

export function RosterManagementPanel() {
  const [config, setConfig] = useState<RosterConfig>({
    sourceUrl: DEFAULT_ROSTER_SOURCE_URL,
  });
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [bots, setBots] = useState<BotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);
  const [sourceUrlInput, setSourceUrlInput] = useState(DEFAULT_ROSTER_SOURCE_URL);

  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string }>();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 演练区状态
  const [testNameInput, setTestNameInput] = useState("刘哲");
  const [selectedBotId, setSelectedBotId] = useState<string>("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testNotice, setTestNotice] = useState<{ type: "success" | "error"; text: string }>();

  // 列表检索
  const [searchFilter, setSearchFilter] = useState("");

  // 手动编辑/添加弹窗
  const [editingMember, setEditingMember] = useState<Partial<RosterMember> | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    loadData();
    loadBots();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/roster", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载飞书名单失败");

      const loadedConfig = data.config || { sourceUrl: DEFAULT_ROSTER_SOURCE_URL };
      setConfig(loadedConfig);
      setSourceUrlInput(loadedConfig.sourceUrl || DEFAULT_ROSTER_SOURCE_URL);
      setMembers(data.members || []);

      // 如果还没有成员，自动触发首次初始化或提示
      if (!data.members || data.members.length === 0) {
        // 可以自动同步一次
      }
    } catch (err: any) {
      setNotice({ type: "error", text: err.message || "加载数据失败" });
    } finally {
      setLoading(false);
    }
  }

  async function loadBots() {
    try {
      const res = await fetch("/api/bots", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && Array.isArray(data.bots)) {
        setBots(data.bots);
        if (data.bots.length > 0 && !selectedBotId) {
          setSelectedBotId(data.bots[0].id);
        }
      }
    } catch {
      // ignore
    }
  }

  async function handleSync(urlToSync?: string) {
    setSyncing(true);
    setNotice(undefined);
    try {
      const url = urlToSync || sourceUrlInput.trim();
      const res = await fetch("/api/settings/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", sourceUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步飞书名单失败");

      setConfig(data.config);
      setMembers(data.members);
      setNotice({
        type: "success",
        text: `同步成功！已成功解析 ${data.count} 名成员，飞书 Open ID 均已关联更新。`,
      });
    } catch (err: any) {
      setNotice({
        type: "error",
        text: err.message || "同步失败，请检查飞书文档权限及应用凭证配置",
      });
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveSourceUrl() {
    setSavingUrl(true);
    setNotice(undefined);
    try {
      const res = await fetch("/api/settings/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveConfig", sourceUrl: sourceUrlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存飞书数据源地址失败");

      setConfig(data.config);
      setNotice({ type: "success", text: "飞书数据源地址已保存。" });
    } catch (err: any) {
      setNotice({ type: "error", text: err.message || "保存失败" });
    } finally {
      setSavingUrl(false);
    }
  }

  function handleResetDefault() {
    setSourceUrlInput(DEFAULT_ROSTER_SOURCE_URL);
  }

  function copyText(text: string, key: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey(null);
    }, 2000);
  }

  // 演练区查询逻辑
  const matchedTestMember = members.find((m) => {
    const q = testNameInput.trim().toLowerCase();
    if (!q) return false;
    return (
      m.name.toLowerCase() === q ||
      m.name.toLowerCase().includes(q) ||
      q.includes(m.name.toLowerCase()) ||
      (m.email && m.email.toLowerCase().includes(q))
    );
  });

  async function handleSendTestAt() {
    if (!selectedBotId) {
      setTestNotice({ type: "error", text: "请先选择一个机器人" });
      return;
    }
    if (!testNameInput.trim()) {
      setTestNotice({ type: "error", text: "请输入要测试 @ 的成员姓名" });
      return;
    }

    setSendingTest(true);
    setTestNotice(undefined);
    try {
      const res = await fetch("/api/settings/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "testAt",
          botId: selectedBotId,
          memberName: matchedTestMember?.name || testNameInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "发送测试消息失败");

      setTestNotice({
        type: "success",
        text: `已向所选机器人发送测试卡片！飞书群中已成功触发 @${matchedTestMember?.name || testNameInput}。`,
      });
    } catch (err: any) {
      setTestNotice({
        type: "error",
        text: err.message || "测试消息发送失败，请确认机器人的 Webhook 有效性",
      });
    } finally {
      setSendingTest(false);
    }
  }

  async function handleSaveMember(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMember?.name?.trim()) return;

    try {
      const res = await fetch("/api/settings/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsertMember",
          member: editingMember,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存成员信息失败");

      setMembers(data.members);
      setIsModalOpen(false);
      setEditingMember(null);
      setNotice({ type: "success", text: `成员「${editingMember.name}」已更新保存。` });
    } catch (err: any) {
      alert(err.message || "保存失败");
    }
  }

  async function handleDeleteMember(id: string, name: string) {
    if (!confirm(`确定要移除成员「${name}」吗？（重新从飞书同步时将重新恢复）`)) return;

    try {
      const res = await fetch("/api/settings/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deleteMember",
          id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除成员失败");

      setMembers(data.members);
      setNotice({ type: "success", text: `已移除成员「${name}」。` });
    } catch (err: any) {
      setNotice({ type: "error", text: err.message || "删除成员失败" });
    }
  }

  // 过滤后的成员列表
  const filteredMembers = members.filter((m) => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      (m.openId && m.openId.toLowerCase().includes(q))
    );
  });

  const totalMembersCount = members.length;
  const resolvedOpenIdCount = members.filter((m) => Boolean(m.openId)).length;
  const withEmailCount = members.filter((m) => Boolean(m.email)).length;

  return (
    <div className="space-y-6">
      {/* 头部介绍 */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">飞书成员名单与通用 @ 能力</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          将飞书电子表格/多维表格名单沉淀为全系统通用的成员通讯录。任意业务功能均可通过姓名反查邮箱、生成精准
          飞书 <code>&lt;at id=&quot;ou_xxx&quot;&gt;姓名&lt;/at&gt;</code> 标签。
        </p>
      </div>

      {/* 状态与通知条 */}
      {notice && (
        <div
          className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
            notice.type === "success"
              ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {notice.type === "success" ? (
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="size-5 shrink-0 text-destructive" />
          )}
          <div className="flex-1 leading-5">{notice.text}</div>
          <button
            type="button"
            onClick={() => setNotice(undefined)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            关闭
          </button>
        </div>
      )}

      {/* 统计指标卡片网格 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-xs">
          <CardContent className="flex items-center gap-4 p-5">
            <span className="grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
              <Users className="size-5" />
            </span>
            <div>
              <p className="text-xs font-medium text-muted-foreground">团队成员总数</p>
              <p className="text-2xl font-bold tracking-tight text-foreground">
                {loading ? "..." : totalMembersCount}
                <span className="ml-1 text-xs font-normal text-muted-foreground">人</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardContent className="flex items-center gap-4 p-5">
            <span className="grid size-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <UserCheck className="size-5" />
            </span>
            <div>
              <p className="text-xs font-medium text-muted-foreground">飞书 Open ID 关联</p>
              <p className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                {loading ? "..." : `${resolvedOpenIdCount}/${totalMembersCount}`}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  ({totalMembersCount ? Math.round((resolvedOpenIdCount / totalMembersCount) * 100) : 0}%)
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardContent className="flex items-center gap-4 p-5">
            <span className="grid size-11 place-items-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400">
              <Mail className="size-5" />
            </span>
            <div>
              <p className="text-xs font-medium text-muted-foreground">企业邮箱覆盖</p>
              <p className="text-2xl font-bold tracking-tight text-foreground">
                {loading ? "..." : `${withEmailCount}/${totalMembersCount}`}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  ({totalMembersCount ? Math.round((withEmailCount / totalMembersCount) * 100) : 0}%)
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardContent className="flex items-center gap-4 p-5">
            <span className="grid size-11 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
              <Clock className="size-5" />
            </span>
            <div className="overflow-hidden">
              <p className="text-xs font-medium text-muted-foreground">最近同步时间</p>
              <p className="truncate text-sm font-semibold tracking-tight text-foreground">
                {config.lastSyncAt ? new Date(config.lastSyncAt).toLocaleString("zh-CN") : "尚未同步"}
              </p>
              <span className="text-[11px] text-muted-foreground">
                {config.lastSyncStatus === "success" ? "✓ 状态正常" : config.lastSyncStatus === "error" ? "✕ 同步异常" : "待同步"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 数据源配置与同步操作栏 */}
      <Card className="shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">飞书数据源配置与同步</CardTitle>
              <CardDescription className="text-xs">
                支持飞书知识库节点（Wiki）、电子表格（Sheet）、多维表格（Bitable）以及普通文档（Docx）链接。
              </CardDescription>
            </div>
            {config.sourceUrl && (
              <a
                href={config.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <span>在飞书中打开表格</span>
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <input
                type="text"
                value={sourceUrlInput}
                onChange={(e) => setSourceUrlInput(e.target.value)}
                placeholder="请输入飞书名单文档或表格链接..."
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetDefault}
                disabled={sourceUrlInput === DEFAULT_ROSTER_SOURCE_URL || syncing}
                title="重置为 Segway-Ninebot 团队看板默认地址"
              >
                恢复默认
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveSourceUrl}
                disabled={savingUrl || syncing}
              >
                {savingUrl ? <Loader2 className="size-3.5 animate-spin" /> : null}
                <span>保存地址</span>
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => handleSync()}
                disabled={syncing}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {syncing ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                <span>{syncing ? "同步中..." : "立即从飞书同步"}</span>
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <p>
              💡 提示：同步时将自动调用飞书企业通讯录，将名单中成员的邮箱精准解析为飞书 Open ID 并写入本地高效缓存。
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 实时演练与查询测试区 */}
      <Card className="border-primary/20 shadow-xs">
        <CardHeader className="bg-secondary/20 pb-3">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded bg-primary text-primary-foreground">
              <AtSign className="size-3.5" />
            </span>
            <CardTitle className="text-base font-semibold">@ 能力与邮箱查询演练</CardTitle>
          </div>
          <CardDescription className="text-xs">
            输入任何同学的名字，即可实时反查对应的企业邮箱、飞书 Open ID，并生成可直接使用的 @ 语法标签。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            {/* 输入姓名 */}
            <div className="space-y-1.5 md:col-span-4">
              <label className="text-xs font-medium text-foreground">输入姓名查询</label>
              <div className="relative">
                <input
                  type="text"
                  value={testNameInput}
                  onChange={(e) => setTestNameInput(e.target.value)}
                  placeholder="如：刘哲、任鹏、王钰涵..."
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {["刘哲", "任鹏", "韩志强", "王钰涵", "刘云"].map((quickName) => (
                  <button
                    key={quickName}
                    type="button"
                    onClick={() => setTestNameInput(quickName)}
                    className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-secondary/80 hover:text-foreground"
                  >
                    {quickName}
                  </button>
                ))}
              </div>
            </div>

            {/* 查询结果详情 */}
            <div className="md:col-span-8">
              {matchedTestMember ? (
                <div className="space-y-3 rounded-lg border border-border bg-card p-3.5 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground text-sm">
                        {matchedTestMember.name}
                      </span>
                      <Badge variant="success" className="text-[10px]">
                        飞书已关联
                      </Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      ID: {matchedTestMember.id}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 text-xs">
                    {/* 邮箱 */}
                    <div className="rounded border border-border/70 bg-secondary/30 p-2">
                      <div className="text-[11px] text-muted-foreground mb-1 flex items-center justify-between">
                        <span>企业邮箱</span>
                        <button
                          type="button"
                          onClick={() => copyText(matchedTestMember.email, "test-email")}
                          className="hover:text-foreground"
                          title="复制邮箱"
                        >
                          {copiedKey === "test-email" ? (
                            <Check className="size-3 text-emerald-600" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      </div>
                      <div className="font-mono text-foreground font-medium truncate select-all">
                        {matchedTestMember.email || "未填写"}
                      </div>
                    </div>

                    {/* Open ID */}
                    <div className="rounded border border-border/70 bg-secondary/30 p-2">
                      <div className="text-[11px] text-muted-foreground mb-1 flex items-center justify-between">
                        <span>飞书 Open ID</span>
                        <button
                          type="button"
                          onClick={() => copyText(matchedTestMember.openId || "", "test-openid")}
                          className="hover:text-foreground"
                          title="复制 Open ID"
                        >
                          {copiedKey === "test-openid" ? (
                            <Check className="size-3 text-emerald-600" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      </div>
                      <div className="font-mono text-foreground font-medium truncate select-all">
                        {matchedTestMember.openId || "未解析"}
                      </div>
                    </div>

                    {/* @ 标签语法 */}
                    <div className="rounded border border-border/70 bg-secondary/30 p-2">
                      <div className="text-[11px] text-muted-foreground mb-1 flex items-center justify-between">
                        <span>飞书 @ 语法</span>
                        <button
                          type="button"
                          onClick={() => copyText(matchedTestMember.atTag, "test-attag")}
                          className="hover:text-foreground"
                          title="复制 @ 语法"
                        >
                          {copiedKey === "test-attag" ? (
                            <Check className="size-3 text-emerald-600" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      </div>
                      <div className="font-mono text-emerald-700 dark:text-emerald-400 font-medium truncate select-all">
                        {matchedTestMember.atTag}
                      </div>
                    </div>
                  </div>

                  {/* 真实测试发送 */}
                  <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between border-t border-border/60">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground whitespace-nowrap">测试机器人:</span>
                      <select
                        value={selectedBotId}
                        onChange={(e) => setSelectedBotId(e.target.value)}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {bots.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} {!b.configured ? "(未配URL)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={sendingTest || !selectedBotId}
                      onClick={handleSendTestAt}
                      className="h-8 gap-1.5 text-xs"
                    >
                      {sendingTest ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                      <span>向飞书群发送一条真实 @ 测试</span>
                    </Button>
                  </div>

                  {testNotice && (
                    <div
                      className={`text-xs p-2 rounded ${
                        testNotice.type === "success"
                          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {testNotice.text}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full min-h-[90px] items-center justify-center rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                  未在名单中检索到「{testNameInput}」，请核实姓名或尝试点击上方「立即从飞书同步」。
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 成员名单详细表格 */}
      <Card className="shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">团队成员通讯录</CardTitle>
              <CardDescription className="text-xs">
                当前维护的所有人员列表，共 {filteredMembers.length} 条记录。
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="搜索姓名、邮箱或 ID..."
                  className="h-8 w-48 rounded-md border border-input bg-background pl-8 pr-3 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-64"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() => {
                  setEditingMember({ name: "", email: "", openId: "" });
                  setIsModalOpen(true);
                }}
              >
                <Plus className="size-3.5" />
                <span>手动添加</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/30 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">姓名</th>
                  <th className="px-4 py-3 font-medium">企业邮箱</th>
                  <th className="px-4 py-3 font-medium">飞书 Open ID</th>
                  <th className="px-4 py-3 font-medium">飞书 @ 语法</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      {members.length === 0
                        ? "暂无成员数据，请点击上方「立即从飞书同步」按钮获取数据"
                        : "未匹配到符合搜索条件的成员"}
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                        {member.name}
                      </td>
                      <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{member.email || "—"}</span>
                          {member.email && (
                            <button
                              type="button"
                              onClick={() => copyText(member.email, `mail-${member.id}`)}
                              className="opacity-40 hover:opacity-100"
                              title="复制邮箱"
                            >
                              {copiedKey === `mail-${member.id}` ? (
                                <Check className="size-3 text-emerald-600" />
                              ) : (
                                <Copy className="size-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="max-w-[140px] truncate">{member.openId || "—"}</span>
                          {member.openId && (
                            <button
                              type="button"
                              onClick={() => copyText(member.openId!, `oid-${member.id}`)}
                              className="opacity-40 hover:opacity-100"
                              title="复制 Open ID"
                            >
                              {copiedKey === `oid-${member.id}` ? (
                                <Check className="size-3 text-emerald-600" />
                              ) : (
                                <Copy className="size-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 text-[11px]">
                            {member.atTag}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyText(member.atTag, `tag-${member.id}`)}
                            className="opacity-40 hover:opacity-100"
                            title="复制 @ 语法"
                          >
                            {copiedKey === `tag-${member.id}` ? (
                              <Check className="size-3 text-emerald-600" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {member.openId ? (
                          <Badge variant="success" className="text-[10px]">
                            已关联
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            未匹配 ID
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMember(member);
                              setIsModalOpen(true);
                            }}
                            className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMember(member.id, member.name)}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="删除成员"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 通用开发与调用指南卡片 */}
      <Card className="shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Code2 className="size-4 text-foreground" />
            <CardTitle className="text-base font-semibold">通用功能调用指南（供开发者与各业务模块接入）</CardTitle>
          </div>
          <CardDescription className="text-xs">
            名单数据已收口至统一服务层，在系统内任何功能（如会议行动跟进、周报通知、定时提醒）中均可按以下方式便捷调用。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <div className="space-y-2">
            <p className="font-semibold text-foreground">1. 服务端 TypeScript / Node 模块直接调用：</p>
            <pre className="overflow-x-auto rounded-lg bg-secondary/40 p-3 font-mono text-[11px] leading-5 text-foreground">
{`import { getEmailByName, getAtTagByName, findMemberByName } from "@/lib/roster";

// ① 通过名字反查邮箱
const email = getEmailByName("刘哲"); // => "zhe.liu01@ninebot.com"

// ② 通过名字生成飞书 @ 语法标签（直接用于飞书卡片或富文本消息）
const atTag = getAtTagByName("刘哲"); // => '<at id="ou_9dae6d2b1b9fdaa4e2980fe7bbb655a7">刘哲</at>'

// ③ 完整成员对象查询（含 openId、手机号等）
const member = findMemberByName("任鹏");`}
            </pre>
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-foreground">2. 客户端或外部系统 REST API 调用：</p>
            <pre className="overflow-x-auto rounded-lg bg-secondary/40 p-3 font-mono text-[11px] leading-5 text-foreground">
{`// 按姓名精确/模糊查询
GET /api/roster/query?name=刘哲
// 返回: { found: true, name: "刘哲", email: "zhe.liu01@ninebot.com", atTag: "<at id=...>刘哲</at>", openId: "ou_..." }

// 关键词下拉联想搜索
GET /api/roster/query?q=刘`}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* 手动添加/编辑成员模态框 */}
      {isModalOpen && editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-foreground">
              {editingMember.id ? "编辑成员信息" : "手动添加成员"}
            </h3>

            <form onSubmit={handleSaveMember} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-medium text-foreground">姓名 *</label>
                <input
                  type="text"
                  required
                  value={editingMember.name || ""}
                  onChange={(e) => setEditingMember({ ...editingMember, name: e.target.value })}
                  placeholder="如：张三"
                  className="h-8 w-full rounded-md border border-input bg-background px-3 py-1 shadow-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground">企业邮箱</label>
                <input
                  type="email"
                  value={editingMember.email || ""}
                  onChange={(e) => setEditingMember({ ...editingMember, email: e.target.value })}
                  placeholder="如：san.zhang@ninebot.com"
                  className="h-8 w-full rounded-md border border-input bg-background px-3 py-1 shadow-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground">飞书 Open ID (选填)</label>
                <input
                  type="text"
                  value={editingMember.openId || ""}
                  onChange={(e) => setEditingMember({ ...editingMember, openId: e.target.value })}
                  placeholder="如：ou_xxxxxxxxxxxxxxxx"
                  className="h-8 w-full rounded-md border border-input bg-background px-3 py-1 font-mono shadow-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  若留空，保存时或下次同步时将自动通过邮箱查询。
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingMember(null);
                  }}
                >
                  取消
                </Button>
                <Button type="submit" size="sm">
                  保存成员
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
