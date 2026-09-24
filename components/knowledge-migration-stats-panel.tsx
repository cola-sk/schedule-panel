"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderOpen,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KnowledgeMigrationNotifyDialog } from "@/components/knowledge-migration-notify-dialog";
import type { FeishuFullDocItem, TaskMigrationStats } from "@/lib/knowledge-migration/types";
import type { TaskNotifyConfig } from "@/lib/knowledge-migration/types";

const WEEKDAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function formatDate(isoStr?: string) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return isoStr;
  }
}

interface KnowledgeMigrationStatsPanelProps {
  taskId: string;
  taskName: string;
  stats?: TaskMigrationStats | null;
  onRefresh: () => Promise<unknown> | void;
  loading?: boolean;
  notifySchedule?: Pick<TaskNotifyConfig, "enabled" | "dayOfWeek" | "time" | "lastSentAt"> & { nextRunAt?: string };
  onNotifyConfigSaved?: () => Promise<unknown> | void;
}

export function KnowledgeMigrationStatsPanel({
  taskId,
  taskName,
  stats,
  onRefresh,
  loading = false,
  notifySchedule,
  onNotifyConfigSaved,
}: KnowledgeMigrationStatsPanelProps) {
  const [selectedWeek, setSelectedWeek] = useState<string>("all");
  const [selectedOrigin, setSelectedOrigin] = useState<string>("all"); // "all" | "external_feishu" | "wiki_migration"
  const [selectedPerson, setSelectedPerson] = useState<string>("all");
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
  const [notifyDialogOpen, setNotifyDialogOpen] = useState<boolean>(false);

  // 默认展开最近一周
  const toggleWeek = (weekKey: string) => {
    setExpandedWeeks((prev) => ({
      ...prev,
      [weekKey]: !prev[weekKey],
    }));
  };

  const expandAll = () => {
    if (!stats?.weeks) return;
    const next: Record<string, boolean> = {};
    stats.weeks.forEach((w) => {
      next[w.weekKey] = true;
    });
    setExpandedWeeks(next);
  };

  const collapseAll = () => {
    setExpandedWeeks({});
  };

  // 过滤周度列表与文档
  const filteredWeeks = useMemo(() => {
    if (!stats?.weeks) return [];

    return stats.weeks
      .filter((week) => {
        if (selectedWeek !== "all" && week.weekKey !== selectedWeek) return false;
        return true;
      })
      .map((week) => {
        // 过滤文档明细
        const filteredItems = week.items.filter((item) => {
          if (selectedOrigin !== "all" && item.origin !== selectedOrigin) return false;
          if (selectedPerson !== "all" && item.creatorName !== selectedPerson) return false;
          if (searchKeyword.trim()) {
            const kw = searchKeyword.toLowerCase();
            const matchTitle = item.title.toLowerCase().includes(kw);
            const matchToken = item.nodeToken.toLowerCase().includes(kw);
            const matchPerson = item.creatorName.toLowerCase().includes(kw);
            if (!matchTitle && !matchToken && !matchPerson) return false;
          }
          return true;
        });

        // 重新按过滤后的 items 计算统计
        const nonWikiCount = filteredItems.filter((i) => i.origin === "external_feishu").length;
        const wikiCount = filteredItems.filter((i) => i.origin === "wiki_migration").length;

        const personMap = new Map<string, { nonWiki: number; wiki: number }>();
        for (const item of filteredItems) {
          if (!personMap.has(item.creatorName)) {
            personMap.set(item.creatorName, { nonWiki: 0, wiki: 0 });
          }
          const p = personMap.get(item.creatorName)!;
          if (item.origin === "wiki_migration") p.wiki++;
          else p.nonWiki++;
        }

        const persons = Array.from(personMap.entries())
          .map(([personName, count]) => ({
            personName,
            nonWikiCount: count.nonWiki,
            wikiCount: count.wiki,
            totalCount: count.nonWiki + count.wiki,
          }))
          .sort((a, b) => b.nonWikiCount - a.nonWikiCount || b.totalCount - a.totalCount);

        return {
          ...week,
          totalCount: filteredItems.length,
          nonWikiCount,
          wikiCount,
          persons,
          items: filteredItems,
        };
      })
      .filter((w) => w.items.length > 0 || (selectedOrigin === "all" && selectedPerson === "all" && !searchKeyword));
  }, [stats?.weeks, selectedWeek, selectedOrigin, selectedPerson, searchKeyword]);

  // 人员贡献排行榜（排除机器人与系统归档）
  const humanRank = useMemo(() => {
    return (stats?.personsRank || []).filter(
      (p) =>
        p.personName !== "Wiki 归档系统" &&
        p.personName !== "迁移机器人" &&
        !p.personName.includes("8eb8") &&
        !p.personName.includes("机器人") &&
        p.userId !== "ou_8a0d18f26e02a0a5add005b36c2d8eb8"
    );
  }, [stats?.personsRank]);

  // 所有涉及的人员名单（包含系统归档与机器人，以便单独按需筛选明细）
  const allPersons = useMemo(() => {
    const list = humanRank.map((p) => p.personName);
    if (!list.includes("迁移机器人")) {
      list.push("迁移机器人");
    }
    if (stats?.totalWikiDocs && stats.totalWikiDocs > 0 && !list.includes("Wiki 归档系统")) {
      list.push("Wiki 归档系统");
    }
    return list;
  }, [humanRank, stats?.totalWikiDocs]);

  // 点击贡献榜人员，联动筛选非 Wiki 外部迁移并平滑滚动到文档列表
  const handleSelectLeaderboardPerson = (personName: string) => {
    if (selectedPerson === personName) {
      setSelectedPerson("all");
      setSelectedOrigin("all");
    } else {
      setSelectedPerson(personName);
      setSelectedOrigin("external_feishu");
      expandAll();
      setTimeout(() => {
        const el = document.getElementById("weekly-details-section");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 50);
    }
  };

  // 点击周度柱状图联动筛选
  const handleSelectWeek = (weekKey: string) => {
    setSelectedWeek(selectedWeek === weekKey ? "all" : weekKey);
    setTimeout(() => {
      const el = document.getElementById("weekly-details-section");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  };

  // 计算当前过滤条件下的总览指标
  const filteredOverview = useMemo(() => {
    if (!stats) return { total: 0, nonWiki: 0, wiki: 0 };
    let total = 0;
    let nonWiki = 0;
    let wiki = 0;
    for (const w of filteredWeeks) {
      total += w.totalCount;
      nonWiki += w.nonWikiCount;
      wiki += w.wikiCount;
    }
    return { total, nonWiki, wiki };
  }, [filteredWeeks, stats]);

  // 最大单周数量用于渲染柱状图比例
  const maxWeeklyCount = useMemo(() => {
    if (!stats?.weeks || stats.weeks.length === 0) return 1;
    return Math.max(...stats.weeks.map((w) => w.totalCount), 1);
  }, [stats?.weeks]);

  return (
    <div className="space-y-6">
      {/* 顶部操作与控制卡片 */}
      <Card className="shadow-none border-border">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <BarChart3 className="size-5 text-indigo-500" />
                <h3 className="text-base font-semibold text-foreground">
                  目标飞书全量文档与周度迁移对比分析
                </h3>
                <Badge variant="outline" className="text-xs">
                  {taskName}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                以 Wiki 已迁移数据为基准，深度拉取目标飞书知识库全量节点与创建人，对比分析除 Wiki 之外的每周新增迁移量与贡献人。
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              {stats?.updatedAt && (
                <span className="text-xs text-muted-foreground mr-1 hidden sm:inline">
                  上次分析：{formatDate(stats.updatedAt)}
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNotifyDialogOpen(true)}
                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
              >
                <Bell className="mr-1.5 size-3.5 text-indigo-500" />
                定时群推送
              </Button>
              <Button
                size="sm"
                onClick={() => void onRefresh()}
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {loading ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 size-3.5" />
                )}
                {loading ? "全量扫描分析中…" : "扫描并更新统计"}
              </Button>
            </div>

            {notifySchedule?.enabled && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  定时任务已启动
                </span>
                <span>每{WEEKDAY_LABELS[notifySchedule.dayOfWeek] || "周"} {notifySchedule.time}（北京时间）执行</span>
                <span className="inline-flex items-center gap-1 text-emerald-800/80 dark:text-emerald-200/80">
                  <Calendar className="size-3.5" />
                  下次执行：{formatDate(notifySchedule.nextRunAt)}
                </span>
                {notifySchedule.lastSentAt && <span>上次成功推送：{formatDate(notifySchedule.lastSentAt)}</span>}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!stats ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <BarChart3 className="mx-auto size-12 text-muted-foreground/60" />
          <h4 className="mt-3 text-sm font-semibold">暂无全量对比分析数据</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            点击上方“扫描并更新统计”按钮，系统将自动递归读取目标飞书知识库中的所有文档、解析创建人并按周度生成对比报表。
          </p>
          <Button
            size="sm"
            onClick={() => void onRefresh()}
            disabled={loading}
            className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {loading && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            立即开始全量扫描
          </Button>
        </div>
      ) : (
        <>
          {/* 核心指标统计卡片 (KPI) */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-indigo-100/30 dark:border-indigo-900/50 dark:from-indigo-950/20 dark:to-indigo-900/10 shadow-none">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-indigo-700 dark:text-indigo-300 font-medium">
                  <span>非 Wiki 外部迁移 / 新增</span>
                  <Sparkles className="size-4 text-indigo-500" />
                </div>
                <p className="mt-2 font-mono text-3xl font-bold text-indigo-950 dark:text-indigo-100">
                  {stats.totalNonWikiDocs}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">篇</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  占飞书全量文档的{" "}
                  {stats.totalFeishuDocs > 0
                    ? Math.round((stats.totalNonWikiDocs / stats.totalFeishuDocs) * 100)
                    : 0}
                  %
                </p>
              </CardContent>
            </Card>

            <Card className="border-blue-100 bg-gradient-to-br from-blue-50/50 to-blue-100/30 dark:border-blue-900/50 dark:from-blue-950/20 dark:to-blue-900/10 shadow-none">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-blue-700 dark:text-blue-300 font-medium">
                  <span>Wiki 归档系统迁移文档</span>
                  <CheckCircle2 className="size-4 text-blue-500" />
                </div>
                <p className="mt-2 font-mono text-3xl font-bold text-blue-950 dark:text-blue-100">
                  {stats.totalWikiDocs}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">篇</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  由当前归档任务成功导入飞书
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-none border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                  <span>飞书知识库全量文档总数</span>
                  <Layers className="size-4 text-muted-foreground" />
                </div>
                <p className="mt-2 font-mono text-3xl font-bold text-foreground">
                  {stats.totalFeishuDocs}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">篇</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  涵盖 {stats.weeks?.length || 0} 个自然周的历史增量
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-none border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                  <span>涉及迁移 / 创建人员</span>
                  <Users className="size-4 text-emerald-500" />
                </div>
                <p className="mt-2 font-mono text-3xl font-bold text-foreground">
                  {stats.totalPersons}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">人</span>
                </p>
              </CardContent>
            </Card>
          </section>

          {/* 非 Wiki 文档分类累计分布概览 */}
          {stats.categoryRank && stats.categoryRank.length > 0 && (
            <Card className="shadow-none border-border bg-gradient-to-r from-muted/30 via-background to-muted/20">
              <CardContent className="p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="size-4 text-indigo-500" />
                    <span className="text-xs font-semibold text-foreground">
                      除 Wiki 之外 · 分类累计分布
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      (共 {stats.totalNonWikiDocs} 篇，涵盖 {stats.categoryRank.length} 个分类)
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {stats.categoryRank.map((cat) => {
                    const pct =
                      stats.totalNonWikiDocs > 0
                        ? Math.round((cat.count / stats.totalNonWikiDocs) * 100)
                        : 0;
                    return (
                      <div
                        key={cat.category}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/90 px-2.5 py-1 text-xs shadow-2xs"
                      >
                        <span className="font-medium text-foreground">{cat.category}</span>
                        <Badge
                          variant="secondary"
                          className="px-1.5 py-0 font-mono text-[10px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-none"
                        >
                          {cat.count} 篇
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-mono">({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 周度趋势柱状可视化与人员榜单 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* 左侧：周度对比趋势柱状图 */}
            <Card className="lg:col-span-8 shadow-none border-border">
              <CardHeader className="p-4 pb-2 border-b border-border">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="size-4 text-indigo-500" />
                    各周迁移量趋势对比 (非 Wiki 外部迁移 vs Wiki 迁移)
                  </CardTitle>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm bg-indigo-500 inline-block" />
                      <span>非 Wiki 外部迁移</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm bg-blue-300 dark:bg-blue-600 inline-block" />
                      <span>Wiki 归档迁移</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3 max-h-[360px] overflow-y-auto">
                {stats.weeks.map((week) => {
                  const nonWikiPct = Math.round((week.nonWikiCount / maxWeeklyCount) * 100);
                  const wikiPct = Math.round((week.wikiCount / maxWeeklyCount) * 100);

                  return (
                    <div
                      key={week.weekKey}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectWeek(week.weekKey)}
                      className={`group flex flex-col gap-1 rounded-md p-1.5 transition-colors cursor-pointer ${
                        selectedWeek === week.weekKey
                          ? "bg-indigo-50/80 ring-1 ring-indigo-400 dark:bg-indigo-950/40"
                          : "hover:bg-secondary/40"
                      }`}
                      title={`点击筛选 ${week.weekLabel}`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground flex items-center gap-1.5">
                          <Calendar className="size-3 text-muted-foreground" />
                          {week.weekLabel}
                        </span>
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                            非Wiki: {week.nonWikiCount}
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-blue-600 dark:text-blue-400">
                            Wiki: {week.wikiCount}
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-foreground font-bold">
                            总计: {week.totalCount} 篇
                          </span>
                        </div>
                      </div>

                      {/* 堆叠柱状条 */}
                      <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-secondary/80">
                        {week.nonWikiCount > 0 && (
                          <div
                            style={{ width: `${Math.max(nonWikiPct, 2)}%` }}
                            className="bg-indigo-500 transition-all hover:bg-indigo-600"
                            title={`非 Wiki 外部迁移: ${week.nonWikiCount} 篇`}
                          />
                        )}
                        {week.wikiCount > 0 && (
                          <div
                            style={{ width: `${Math.max(wikiPct, 2)}%` }}
                            className="bg-blue-300 dark:bg-blue-600 transition-all hover:bg-blue-400"
                            title={`Wiki 归档迁移: ${week.wikiCount} 篇`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* 右侧：迁移人贡献总榜 */}
            <Card className="lg:col-span-4 shadow-none border-border">
              <CardHeader className="p-4 pb-2 border-b border-border">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <User className="size-4 text-emerald-500" />
                  迁移人总贡献榜 (按非 Wiki 迁移量)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2 max-h-[360px] overflow-y-auto divide-y divide-border/60">
                {humanRank.map((person, idx) => {
                  const isSelected = selectedPerson === person.personName;
                  return (
                    <div
                      key={person.personName}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectLeaderboardPerson(person.personName)}
                      className={`flex items-center justify-between p-2.5 text-xs rounded-md transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-indigo-50 text-indigo-900 ring-1 ring-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-200 font-semibold"
                          : "hover:bg-secondary/60"
                      }`}
                      title={isSelected ? "点击取消筛选" : `点击筛选 ${person.personName} 贡献的非 Wiki 文档`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            idx === 0
                              ? "bg-amber-500 text-white"
                              : idx === 1
                              ? "bg-slate-400 text-white"
                              : idx === 2
                              ? "bg-amber-700 text-white"
                              : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <span className="truncate font-medium block">{person.personName}</span>
                          {person.categories && person.categories.length > 0 && (
                            <span className="text-[10px] text-muted-foreground block truncate">
                              {person.categories.slice(0, 2).map((c) => `${c.category}(${c.count})`).join(", ")}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 font-mono text-[11px] shrink-0 text-right">
                        <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                          {person.nonWikiCount} 篇
                        </span>
                        <span className="text-muted-foreground text-[10px]">
                          (共 {person.totalCount})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* 筛选与搜索控制栏 */}
          <Card className="shadow-none border-border bg-secondary/20">
            <CardContent className="p-3">
              <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
                <div className="lg:col-span-2 relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                  <input
                    className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="搜索文档标题、飞书 Token 或姓名…"
                  />
                </div>

                <select
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(e.target.value)}
                >
                  <option value="all">全部自然周</option>
                  {stats.weeks.map((w) => (
                    <option key={w.weekKey} value={w.weekKey}>
                      {w.weekLabel}
                    </option>
                  ))}
                </select>

                <select
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  value={selectedOrigin}
                  onChange={(e) => setSelectedOrigin(e.target.value)}
                >
                  <option value="all">全部文档来源</option>
                  <option value="external_feishu">仅除 Wiki 之外的外部迁移文档</option>
                  <option value="wiki_migration">仅 Wiki 归档迁移文档</option>
                </select>

                <select
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  value={selectedPerson}
                  onChange={(e) => setSelectedPerson(e.target.value)}
                >
                  <option value="all">全部迁移 / 创建人</option>
                  {allPersons.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              {(selectedWeek !== "all" ||
                selectedOrigin !== "all" ||
                selectedPerson !== "all" ||
                searchKeyword) && (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground font-medium">当前生效筛选：</span>
                    {selectedPerson !== "all" && (
                      <Badge
                        variant="secondary"
                        className="gap-1 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                      >
                        迁移人: {selectedPerson}
                        <button
                          type="button"
                          className="ml-0.5 hover:text-red-500 font-bold"
                          onClick={() => setSelectedPerson("all")}
                          title="清除人员筛选"
                        >
                          ×
                        </button>
                      </Badge>
                    )}
                    {selectedOrigin !== "all" && (
                      <Badge
                        variant="secondary"
                        className="gap-1 bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
                      >
                        来源: {selectedOrigin === "external_feishu" ? "仅非 Wiki 外部迁移" : "仅 Wiki 归档"}
                        <button
                          type="button"
                          className="ml-0.5 hover:text-red-500 font-bold"
                          onClick={() => setSelectedOrigin("all")}
                          title="清除来源筛选"
                        >
                          ×
                        </button>
                      </Badge>
                    )}
                    {selectedWeek !== "all" && (
                      <Badge variant="secondary" className="gap-1">
                        自然周: {selectedWeek}
                        <button
                          type="button"
                          className="ml-0.5 hover:text-red-500 font-bold"
                          onClick={() => setSelectedWeek("all")}
                          title="清除周度筛选"
                        >
                          ×
                        </button>
                      </Badge>
                    )}
                    {searchKeyword && (
                      <Badge variant="secondary" className="gap-1">
                        关键词: {searchKeyword}
                        <button
                          type="button"
                          className="ml-0.5 hover:text-red-500 font-bold"
                          onClick={() => setSearchKeyword("")}
                          title="清除关键词"
                        >
                          ×
                        </button>
                      </Badge>
                    )}
                    <span className="text-muted-foreground ml-1">
                      (共过滤出 <strong className="text-foreground">{filteredOverview.total}</strong> 篇文档)
                    </span>
                    {selectedPerson !== "all" && selectedOrigin === "external_feishu" && (
                      <button
                        type="button"
                        onClick={() => setSelectedOrigin("all")}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline ml-1"
                      >
                        [查看该成员全部文档(含Wiki)]
                      </button>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setSelectedWeek("all");
                      setSelectedOrigin("all");
                      setSelectedPerson("all");
                      setSearchKeyword("");
                    }}
                  >
                    重置所有筛选
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 周度折叠明细与文档列表 */}
          <div id="weekly-details-section" className="space-y-4 pt-1">
            <div className="flex items-center justify-between px-1">
              <h4 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <FileSpreadsheet className="size-4 text-primary" />
                周度明细与文档清单 ({filteredWeeks.length} 个自然周)
              </h4>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={expandAll}
                >
                  全部展开
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={collapseAll}
                >
                  全部折叠
                </Button>
              </div>
            </div>

            {filteredWeeks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                未找到匹配筛选条件的周度数据
              </div>
            ) : (
              filteredWeeks.map((week) => {
                const isExpanded = expandedWeeks[week.weekKey] !== false; // 默认展开

                return (
                  <Card key={week.weekKey} className="shadow-none border-border overflow-hidden">
                    <CardHeader
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleWeek(week.weekKey)}
                      className="flex flex-row flex-wrap items-center justify-between gap-3 p-3.5 bg-secondary/30 hover:bg-secondary/60 transition-colors cursor-pointer border-b border-border/60"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {week.weekLabel}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              ({week.startDate} ~ {week.endDate})
                            </span>
                          </div>

                          {/* 本周人员分布 */}
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground">本周贡献：</span>
                            {week.persons.slice(0, 6).map((p) => (
                              <Badge
                                key={p.personName}
                                variant="secondary"
                                className="text-[10px] font-normal"
                              >
                                {p.personName}: {p.nonWikiCount > 0 ? `非Wiki ${p.nonWikiCount}` : `Wiki ${p.wikiCount}`}
                              </Badge>
                            ))}
                            {week.persons.length > 6 && (
                              <span className="text-[10px] text-muted-foreground">
                                等共 {week.persons.length} 人
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 本周总量统计徽标 */}
                      <div className="flex items-center gap-2">
                        <Badge className="bg-indigo-600 hover:bg-indigo-700 text-white font-mono text-xs">
                          非 Wiki: {week.nonWikiCount} 篇
                        </Badge>
                        <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300 font-mono text-xs">
                          Wiki: {week.wikiCount} 篇
                        </Badge>
                        <Badge variant="secondary" className="font-mono text-xs">
                          总计: {week.totalCount} 篇
                        </Badge>
                      </div>
                    </CardHeader>

                    {isExpanded && (
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-border bg-muted/40 text-[11px] text-muted-foreground">
                              <tr>
                                <th className="px-4 py-2.5 font-medium">文档标题</th>
                                <th className="px-4 py-2.5 font-medium">来源属性</th>
                                <th className="px-4 py-2.5 font-medium">飞书 ID / Token</th>
                                <th className="px-4 py-2.5 font-medium">迁移人 / 创建人</th>
                                <th className="px-4 py-2.5 font-medium">创建 / 迁移时间</th>
                                <th className="px-4 py-2.5 font-medium text-right">操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {week.items.map((item) => (
                                <tr
                                  key={item.nodeToken}
                                  className="transition-colors hover:bg-secondary/20"
                                >
                                  {/* 标题 */}
                                  <td className="max-w-72 px-4 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      <FileText className="size-3.5 text-muted-foreground shrink-0" />
                                      <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-medium text-foreground hover:text-primary hover:underline truncate"
                                        title={item.title}
                                      >
                                        {item.title}
                                      </a>
                                    </div>
                                    {(item.primaryCategory || item.secondaryCategory) && (
                                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                                        分类：{item.primaryCategory || "—"} / {item.secondaryCategory || "—"}
                                      </p>
                                    )}
                                  </td>

                                  {/* 来源类型 */}
                                  <td className="px-4 py-2.5">
                                    {item.origin === "external_feishu" ? (
                                      <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800 text-[10px]">
                                        非 Wiki 外部迁移
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-900 dark:text-blue-300 text-[10px]">
                                        Wiki 归档迁移
                                      </Badge>
                                    )}
                                  </td>

                                  {/* 飞书 Token */}
                                  <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                                    {item.nodeToken}
                                  </td>

                                  {/* 迁移人 / 创建人 */}
                                  <td className="px-4 py-2.5 font-medium text-foreground">
                                    <div className="flex items-center gap-1.5">
                                      <User className="size-3 text-muted-foreground" />
                                      <span>{item.creatorName}</span>
                                    </div>
                                  </td>

                                  {/* 创建时间 */}
                                  <td className="px-4 py-2.5 text-muted-foreground text-[11px]">
                                    {formatDate(item.createTime)}
                                  </td>

                                  {/* 操作 */}
                                  <td className="px-4 py-2.5 text-right">
                                    <a
                                      href={item.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                                    >
                                      查看飞书
                                      <ExternalLink className="size-3" />
                                    </a>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </>
      )}

      {/* 定时群推送配置对话框 */}
      <KnowledgeMigrationNotifyDialog
        open={notifyDialogOpen}
        onOpenChange={setNotifyDialogOpen}
        taskId={taskId}
        taskName={taskName}
        onConfigSaved={onNotifyConfigSaved}
      />
    </div>
  );
}
