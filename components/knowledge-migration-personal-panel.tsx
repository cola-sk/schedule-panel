"use client";

import { useEffect, useState, useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  AtSign,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Filter,
  Loader2,
  Mail,
  Play,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  User,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KnowledgeMigrationNotifyDialog } from "@/components/knowledge-migration-notify-dialog";
import type { MemberContributionMigrationItem, TaskNotifyConfig } from "@/lib/knowledge-migration/types";

interface KnowledgeMigrationPersonalPanelProps {
  taskId: string;
  taskName: string;
}

export function KnowledgeMigrationPersonalPanel({ taskId, taskName }: KnowledgeMigrationPersonalPanelProps) {
  const [members, setMembers] = useState<MemberContributionMigrationItem[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    completed: number;
    incomplete: number;
    zeroContributorsAndIncomplete: number;
    zeroContributors: MemberContributionMigrationItem[];
  }>({
    total: 0,
    completed: 0,
    incomplete: 0,
    zeroContributorsAndIncomplete: 0,
    zeroContributors: [],
  });
  const [notifyConfig, setNotifyConfig] = useState<TaskNotifyConfig | undefined>();
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  // 筛选与搜索
  const [filterTab, setFilterTab] = useState<
    "all" | "zero_and_incomplete" | "incomplete" | "completed" | "contributed_incomplete"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 通知规则弹窗
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, [taskId]);

  async function loadData() {
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/member-status`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载成员迁移数据失败");

      setMembers(data.members || []);
      setSummary(
        data.summary || {
          total: 0,
          completed: 0,
          incomplete: 0,
          zeroContributorsAndIncomplete: 0,
          zeroContributors: [],
        },
      );
      setNotifyConfig(data.notifyConfig);
    } catch (err: any) {
      setNotice({ type: "error", text: err.message || "加载数据失败" });
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleCompleted(member: MemberContributionMigrationItem) {
    setUpdatingId(member.memberId);
    const nextCompleted = !member.completed;
    try {
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/member-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: member.memberId,
          name: member.name,
          completed: nextCompleted,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新状态失败");

      setMembers(data.members || []);
      setSummary(data.summary || summary);
    } catch (err: any) {
      alert(err.message || "更新失败");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleToggleAtZero(enabled: boolean) {
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/member-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atZeroContributors: enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新配置失败");

      setNotifyConfig(data.notifyConfig);
      setNotice({
        type: "success",
        text: enabled
          ? "已开启「推送时 @ 0贡献且未完成迁移员工」，系统将在定时或手动推送时精准提醒这些同学。"
          : "已关闭「推送时 @ 0贡献员工」。",
      });
    } catch (err: any) {
      setNotice({ type: "error", text: err.message || "更新配置失败" });
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleBatchUpdate(completed: boolean) {
    if (!confirm(`确定要将所有成员的个人文档迁移状态全部标记为「${completed ? "已完成" : "未完成"}」吗？`)) return;

    setBatchUpdating(true);
    try {
      const batch = members.map((m) => ({
        memberIdOrName: m.memberId,
        completed,
      }));
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/member-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "批量更新失败");

      setMembers(data.members || []);
      setSummary(data.summary || summary);
      setNotice({
        type: "success",
        text: `已批量将 ${members.length} 位成员标记为「${completed ? "已完成" : "未完成"}迁移」。`,
      });
    } catch (err: any) {
      setNotice({ type: "error", text: err.message || "批量更新失败" });
    } finally {
      setBatchUpdating(false);
    }
  }

  async function handleAutoMarkFromContributions() {
    const withContribution = members.filter((m) => m.nonWikiCount > 0 && !m.completed);
    if (withContribution.length === 0) {
      alert("当前没有检测到「已有贡献但未标记完成」的成员。");
      return;
    }

    if (
      !confirm(
        `检测到 ${withContribution.length} 位同学在知识库中已有新增贡献文档（如 ${withContribution
          .map((m) => m.name)
          .join("、")}），是否自动将其标记为「已完成个人文档迁移」？`,
      )
    ) {
      return;
    }

    setBatchUpdating(true);
    try {
      const batch = withContribution.map((m) => ({
        memberIdOrName: m.memberId,
        completed: true,
      }));
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/member-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "批量更新失败");

      setMembers(data.members || []);
      setSummary(data.summary || summary);
      setNotice({
        type: "success",
        text: `已自动将 ${withContribution.length} 位有贡献的同学标记为「已完成个人文档迁移」。`,
      });
    } catch (err: any) {
      setNotice({ type: "error", text: err.message || "批量更新失败" });
    } finally {
      setBatchUpdating(false);
    }
  }

  async function handleSendTestNotify() {
    setSendingTest(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atZeroContributors: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "发送失败");

      setNotice({
        type: "success",
        text: `✅ 已成功向飞书群发送催办测试卡片！已在卡片中精准 @ 了 ${summary.zeroContributorsAndIncomplete} 位零贡献待迁移同学。`,
      });
    } catch (err: any) {
      setNotice({ type: "error", text: err.message || "发送催办测试卡片失败，请检查机器人 Webhook" });
    } finally {
      setSendingTest(false);
    }
  }

  function copyText(text: string, key: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  function copyAllZeroAtTags() {
    if (summary.zeroContributors.length === 0) return;
    const allTags = summary.zeroContributors.map((m) => m.atTag).join(" ");
    copyText(allTags, "all-zero-tags");
  }

  // 过滤后的成员列表
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      // 1. Tab 过滤
      if (filterTab === "zero_and_incomplete" && !m.isZeroAndIncomplete) return false;
      if (filterTab === "incomplete" && m.completed) return false;
      if (filterTab === "completed" && !m.completed) return false;
      if (filterTab === "contributed_incomplete" && (m.completed || m.nonWikiCount === 0)) return false;

      // 2. 关键词搜索
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = m.name.toLowerCase().includes(q);
        const matchEmail = m.email && m.email.toLowerCase().includes(q);
        const matchOpenId = m.openId && m.openId.toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchOpenId) return false;
      }
      return true;
    });
  }, [members, filterTab, searchQuery]);

  return (
    <div className="space-y-6">
      {/* 顶部标题与说明 */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              个人文档迁移进度与 0 贡献催办管理
            </h2>
            <Badge variant="outline" className="text-xs">
              {taskName}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            配置飞书名单中每位员工是否已完成个人网盘/本地文档到知识库的迁移，系统自动结合知识库历史贡献数据，精准锁定「未完成迁移且贡献为
            0」的同学并在群通知中进行 @ 提醒催办。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="h-8 gap-1 text-xs"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>刷新数据</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setNotifyDialogOpen(true)}
            className="h-8 gap-1 text-xs text-indigo-700 border-indigo-200 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
          >
            <Bell className="size-3.5 text-indigo-500" />
            <span>群推送规则设置</span>
          </Button>
        </div>
      </div>

      {/* 状态与通知条 */}
      {notice && (
        <div
          className={`flex items-start gap-3 rounded-lg border p-3.5 text-xs ${
            notice.type === "success"
              ? "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {notice.type === "success" ? (
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          ) : (
            <AlertCircle className="size-4 shrink-0 text-destructive mt-0.5" />
          )}
          <div className="flex-1 leading-5">{notice.text}</div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-[11px] opacity-70 hover:opacity-100"
          >
            关闭
          </button>
        </div>
      )}

      {/* 4 个指标统计卡片 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-xs border-border">
          <CardContent className="flex items-center gap-4 p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
              <Users className="size-5" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">飞书名单员工总数</p>
              <p className="text-2xl font-bold tracking-tight text-foreground">
                {summary.total}
                <span className="ml-1 text-xs font-normal text-muted-foreground">人</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border">
          <CardContent className="flex items-center gap-4 p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <UserCheck className="size-5" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">已完成个人文档迁移</p>
              <p className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                {summary.completed}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  ({summary.total ? Math.round((summary.completed / summary.total) * 100) : 0}%)
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border">
          <CardContent className="flex items-center gap-4 p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
              <Clock className="size-5" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">未完成迁移员工</p>
              <p className="text-2xl font-bold tracking-tight text-foreground">
                {summary.incomplete}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  ({summary.total ? Math.round((summary.incomplete / summary.total) * 100) : 0}%)
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 重点卡片：未完成迁移且0贡献 */}
        <Card className="shadow-xs border-amber-300/80 bg-amber-50/30 dark:border-amber-900/50 dark:bg-amber-950/20">
          <CardContent className="flex items-center gap-4 p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
              <AlertTriangle className="size-5" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-amber-900 dark:text-amber-200 flex items-center gap-1">
                <span>待 @ 催办员工</span>
                <span className="text-[10px] text-amber-700/80 dark:text-amber-300/80">(未完成且0贡献)</span>
              </p>
              <p className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
                {summary.zeroContributorsAndIncomplete}
                <span className="ml-1 text-xs font-normal text-muted-foreground">人</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 核心控制卡片：群定时推送 @ 催办开关与一键测试 */}
      <Card className="border-amber-200 dark:border-amber-900/60 bg-gradient-to-r from-amber-50/40 via-card to-card shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-amber-500 text-white shadow-xs">
                <AtSign className="size-4" />
              </span>
              <div>
                <CardTitle className="text-sm font-semibold">
                  群推送时 @ 未完成迁移且贡献为 0 的员工
                </CardTitle>
                <CardDescription className="text-xs">
                  定时发送周度贡献榜时，自动在卡片底部附带待催办名单并精准 @ 对应成员。
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(notifyConfig?.atZeroContributors)}
                  disabled={savingConfig}
                  onChange={(e) => handleToggleAtZero(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-amber-600"></div>
                <span className="ml-2 text-xs font-semibold text-foreground">
                  {notifyConfig?.atZeroContributors ? "已开启 @ 催办" : "已停用"}
                </span>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <div className="font-semibold flex items-center gap-1.5">
                <span>当前识别到待 @ 催办人员名单（{summary.zeroContributorsAndIncomplete}人）：</span>
              </div>
              <p className="font-mono text-[11px] text-amber-800 dark:text-amber-300 select-all">
                {summary.zeroContributors.length > 0
                  ? summary.zeroContributors.map((m) => m.name).join("、")
                  : "🎉 全员均已完成迁移或已有文档贡献！"}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyAllZeroAtTags}
                disabled={summary.zeroContributors.length === 0}
                className="h-7 text-xs gap-1 border-amber-300 hover:bg-amber-100/70 dark:border-amber-800"
              >
                {copiedKey === "all-zero-tags" ? (
                  <Check className="size-3 text-emerald-600" />
                ) : (
                  <Copy className="size-3" />
                )}
                <span>一键复制待催办 @ 标签</span>
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSendTestNotify}
                disabled={sendingTest}
                className="h-7 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white"
              >
                {sendingTest ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                <span>发送一次催办测试</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 成员配置与统计明细列表 */}
      <Card className="shadow-xs border-border">
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* 标签栏筛选 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilterTab("all")}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterTab === "all"
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                }`}
              >
                全部成员 ({summary.total})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("zero_and_incomplete")}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors flex items-center gap-1 ${
                  filterTab === "zero_and_incomplete"
                    ? "bg-amber-600 text-white shadow-2xs"
                    : "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300"
                }`}
              >
                <AlertTriangle className="size-3" />
                <span>待催办 (0贡献且未完成) ({summary.zeroContributorsAndIncomplete})</span>
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("incomplete")}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterTab === "incomplete"
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                }`}
              >
                未完成个人迁移 ({summary.incomplete})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("completed")}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterTab === "completed"
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                }`}
              >
                已完成迁移 ({summary.completed})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("contributed_incomplete")}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterTab === "contributed_incomplete"
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                }`}
              >
                已有贡献未标记 ({members.filter((m) => m.nonWikiCount > 0 && !m.completed).length})
              </button>
            </div>

            {/* 搜索与批量操作 */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索员工姓名、邮箱..."
                  className="h-7 w-40 rounded-md border border-input bg-background pl-7 pr-2 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-48"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAutoMarkFromContributions}
                  disabled={batchUpdating}
                  className="h-7 px-2 text-[11px] gap-1 text-indigo-700 dark:text-indigo-300"
                  title="自动将已有贡献文档篇数 > 0 的成员标记为已完成个人迁移"
                >
                  <Sparkles className="size-3 text-indigo-500" />
                  <span>按贡献自动标记</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleBatchUpdate(true)}
                  disabled={batchUpdating}
                  className="h-7 px-2 text-[11px]"
                >
                  全部已完成
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleBatchUpdate(false)}
                  disabled={batchUpdating}
                  className="h-7 px-2 text-[11px]"
                >
                  全部重置未完成
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/30 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">员工姓名</th>
                  <th className="px-4 py-2.5 font-medium">企业邮箱</th>
                  <th className="px-4 py-2.5 font-medium">个人文档迁移状态</th>
                  <th className="px-4 py-2.5 font-medium">知识库历史贡献</th>
                  <th className="px-4 py-2.5 font-medium">催办判定</th>
                  <th className="px-4 py-2.5 font-medium">飞书 @ 语法</th>
                  <th className="px-4 py-2.5 font-medium text-right">状态切换</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      未找到符合筛选条件的员工记录
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((member) => (
                    <tr
                      key={member.memberId}
                      className={`hover:bg-secondary/20 transition-colors ${
                        member.isZeroAndIncomplete ? "bg-amber-50/30 dark:bg-amber-950/10" : ""
                      }`}
                    >
                      {/* 姓名 */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                              member.completed
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : member.isZeroAndIncomplete
                                ? "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200"
                                : "bg-secondary text-foreground"
                            }`}
                          >
                            {member.name.slice(0, 1)}
                          </span>
                          <div>
                            <span className="font-semibold text-foreground text-xs">{member.name}</span>
                            {member.openId && (
                              <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                                {member.openId.slice(0, 10)}…
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 邮箱 */}
                      <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{member.email || "—"}</span>
                          {member.email && (
                            <button
                              type="button"
                              onClick={() => copyText(member.email!, `mail-${member.memberId}`)}
                              className="opacity-40 hover:opacity-100"
                              title="复制邮箱"
                            >
                              {copiedKey === `mail-${member.memberId}` ? (
                                <Check className="size-3 text-emerald-600" />
                              ) : (
                                <Copy className="size-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>

                      {/* 个人文档迁移状态 */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleCompleted(member)}
                          disabled={updatingId === member.memberId}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border transition-all cursor-pointer ${
                            member.completed
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 hover:bg-emerald-100"
                              : "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          {member.completed ? (
                            <>
                              <CheckCircle2 className="size-3 text-emerald-600" />
                              <span>已完成个人迁移</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="size-3 text-gray-400" />
                              <span>未完成迁移</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* 知识库历史贡献 */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-semibold text-xs ${
                              member.nonWikiCount === 0
                                ? "text-amber-600 dark:text-amber-400 font-bold"
                                : "text-foreground font-mono"
                            }`}
                          >
                            {member.nonWikiCount} 篇
                          </span>
                          {member.categories && member.categories.length > 0 && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[130px]">
                              ({member.categories.map((c) => `${c.category}:${c.count}`).join(", ")})
                            </span>
                          )}
                          {member.wikiCount > 0 && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              (Wiki归档: {member.wikiCount})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 催办判定 */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {member.isZeroAndIncomplete ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:text-amber-200 border border-amber-300/80">
                            <AlertTriangle className="size-3 text-amber-600 animate-pulse" />
                            <span>⚠️ 待 @ 催办 (0贡献)</span>
                          </span>
                        ) : member.completed ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                            <Check className="size-3 text-emerald-600" />
                            <span>免催办 (已完成)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400">
                            <span>已有外部贡献 ({member.nonWikiCount}篇)</span>
                          </span>
                        )}
                      </td>

                      {/* 飞书 @ 语法 */}
                      <td className="px-4 py-3 font-mono text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-[11px] select-all">
                            {member.atTag}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyText(member.atTag, `tag-${member.memberId}`)}
                            className="opacity-40 hover:opacity-100"
                            title="复制 @ 语法"
                          >
                            {copiedKey === `tag-${member.memberId}` ? (
                              <Check className="size-3 text-emerald-600" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* 操作 */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={updatingId === member.memberId}
                          onClick={() => handleToggleCompleted(member)}
                          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {member.completed ? "标为未完成" : "标为已完成"}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 规则弹窗组件 */}
      <KnowledgeMigrationNotifyDialog
        open={notifyDialogOpen}
        onOpenChange={setNotifyDialogOpen}
        taskId={taskId}
        taskName={taskName}
        onConfigSaved={loadData}
      />
    </div>
  );
}
