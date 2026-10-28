"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AtSign,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  HelpCircle,
  Loader2,
  Moon,
  Play,
  Send,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StatCycleType, TaskNotifyConfig } from "@/lib/knowledge-migration/types";

interface BotOption {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  webhookMasked?: string;
}

interface KnowledgeMigrationNotifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskName: string;
  onConfigSaved?: () => Promise<unknown> | void;
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: "每周一" },
  { value: 2, label: "每周二" },
  { value: 3, label: "每周三" },
  { value: 4, label: "每周四" },
  { value: 5, label: "每周五 (推荐)" },
  { value: 6, label: "每周六" },
  { value: 7, label: "每周日" },
];

const CYCLE_OPTIONS: Array<{
  value: StatCycleType;
  title: string;
  badge?: string;
  desc: string;
}> = [
  {
    value: "last_week",
    title: "上个自然周",
    badge: "推荐周一推送",
    desc: "统计上一完整自然周（周一 00:00 至 周日 23:59）新增的文档贡献榜",
  },
  {
    value: "past_7_days",
    title: "到今天为止前七天",
    badge: "近7天滚动",
    desc: "统计截至今天（过去 7 天内）新增的文档贡献榜",
  },
  {
    value: "this_week",
    title: "本自然周",
    badge: "推荐周五推送",
    desc: "统计本周内（本周一 00:00 截至目前）新增的文档贡献榜",
  },
];

function formatTime(isoStr?: string) {
  if (!isoStr) return "暂无发送记录";
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return isoStr;
  }
}

export function KnowledgeMigrationNotifyDialog({
  open,
  onOpenChange,
  taskId,
  taskName,
  onConfigSaved,
}: KnowledgeMigrationNotifyDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [availableBots, setAvailableBots] = useState<BotOption[]>([]);
  const [incompleteMembersList, setIncompleteMembersList] = useState<Array<{ name: string; email?: string }>>([]);
  const [zeroContributorsList, setZeroContributorsList] = useState<Array<{ name: string; email?: string }>>([]);
  const [showAdvancedWebhook, setShowAdvancedWebhook] = useState(false);

  const [config, setConfig] = useState<TaskNotifyConfig>({
    enabled: false,
    botId: "",
    webhookUrl: "",
    frequency: "weekly",
    dayOfWeek: 5,
    time: "18:00",
    cycleType: "this_week",
    atAll: false,
    atIncompleteMembers: false,
    atIncompleteMode: "all_incomplete",
    atZeroContributors: false,
    silentDailyScanEnabled: true,
  });

  // 打开弹窗时拉取最新配置及系统可用机器人
  useEffect(() => {
    if (!open || !taskId) return;
    setMessage(null);
    setLoading(true);

    Promise.all([
      fetch(`/api/knowledge-migrations/tasks/${taskId}/notify`).then((res) => res.json()),
      fetch(`/api/knowledge-migrations/tasks/${taskId}/member-status`).then((res) => res.json()).catch(() => ({})),
    ])
      .then(([data, memberData]) => {
        const bots = Array.isArray(data?.availableBots) ? data.availableBots : [];
        setAvailableBots(bots);

        if (Array.isArray(memberData?.summary?.incompleteMembers)) {
          setIncompleteMembersList(memberData.summary.incompleteMembers);
        } else if (Array.isArray(memberData?.members)) {
          setIncompleteMembersList(memberData.members.filter((m: any) => !m.completed));
        }

        if (Array.isArray(memberData?.summary?.zeroContributors)) {
          setZeroContributorsList(memberData.summary.zeroContributors);
        }

        if (data?.notifyConfig) {
          const loadedConfig = data.notifyConfig as TaskNotifyConfig;
          // 如果当前未设置 botId，但存在可用机器人，默认选中第一个
          if (!loadedConfig.botId && bots.length > 0) {
            loadedConfig.botId = bots[0].id;
          }
          const isAtIncomplete = Boolean(loadedConfig.atIncompleteMembers ?? loadedConfig.atZeroContributors);
          setConfig({
            ...loadedConfig,
            cycleType: loadedConfig.cycleType || "this_week",
            atAll: Boolean(loadedConfig.atAll),
            atIncompleteMembers: isAtIncomplete,
            atZeroContributors: isAtIncomplete,
            atIncompleteMode: loadedConfig.atIncompleteMode || "all_incomplete",
            incompleteNoticeMessage: loadedConfig.incompleteNoticeMessage || loadedConfig.zeroNoticeMessage || "",
            silentDailyScanEnabled: loadedConfig.silentDailyScanEnabled !== false,
          });
          // 若原本配了自定义 webhookUrl 但没有对应 botId，自动展开高级设置
          if (loadedConfig.webhookUrl && !loadedConfig.botId) {
            setShowAdvancedWebhook(true);
          }
        }
      })
      .catch((err) => {
        console.error("加载通知配置失败:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, taskId]);

  const selectedBot = availableBots.find((b) => b.id === config.botId);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/notify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "保存失败");
      }
      setConfig(data.notifyConfig);
      setMessage({ type: "success", text: "通知配置已保存！" });
      await onConfigSaved?.();
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "保存配置时出错" });
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    if (!config.botId && !config.webhookUrl?.trim()) {
      setMessage({ type: "error", text: "请先选择用于发送的飞书机器人" });
      return;
    }

    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: config.botId || undefined,
          webhookUrl: config.webhookUrl?.trim() || undefined,
          sendMode: config.sendMode || "both",
          cycleType: config.frequency === "daily" ? "yesterday" : config.cycleType || "this_week",
          atAll: Boolean(config.atAll),
          atIncompleteMembers: Boolean(config.atIncompleteMembers ?? config.atZeroContributors),
          atZeroContributors: Boolean(config.atIncompleteMembers ?? config.atZeroContributors),
          atIncompleteMode: config.atIncompleteMode || "all_incomplete",
          incompleteNoticeMessage: config.incompleteNoticeMessage || config.zeroNoticeMessage || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "发送失败");
      }
      setConfig((prev) => ({
        ...prev,
        lastSentAt: new Date().toISOString(),
      }));
      setMessage({ type: "success", text: data?.message || "✅ 测试卡片已成功发送到飞书群，请前往群聊查收！" });
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "发送测试消息失败" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[110] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl focus:outline-none max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between pb-3 border-b border-border/60">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                <Bell className="size-4" />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold leading-none">
                  定时任务规则
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  任务：<span className="font-medium text-foreground">{taskName}</span>
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto size-6 animate-spin text-indigo-600 mb-2" />
              加载配置与可用机器人中…
            </div>
          ) : (
            <div className="mt-4 space-y-4 text-sm">
              {/* 每日 23:50 静默巡检扫描开关 */}
              <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/40 dark:border-indigo-900/50 dark:bg-indigo-950/20 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="font-medium text-foreground flex items-center gap-1.5">
                      <Moon className="size-4 text-indigo-500" />
                      <span>每日 23:50 静默巡检扫描</span>
                      {config.silentDailyScanEnabled !== false ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                          已开启 (每晚 23:50)
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px]">
                          已停用
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      每天 23:50 自动扫描知识库，将当天新移入的文档锁定入库时间并更新周度贡献榜。
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.silentDailyScanEnabled !== false}
                    onChange={(e) => setConfig({ ...config, silentDailyScanEnabled: e.target.checked })}
                    className="size-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-indigo-100/60 dark:border-indigo-900/30 text-[11px] text-muted-foreground">
                  <span>✨ 全程静默执行，不发送任何群通知消息</span>
                  <span>{config.lastSilentScannedAt ? `上次执行: ${formatTime(config.lastSilentScannedAt)}` : "今日待执行"}</span>
                </div>
              </div>

              {/* 飞书群定时消息推送开关 */}
              <div className="flex items-center justify-between rounded-xl border border-border/80 bg-muted/30 p-3.5">
                <div className="space-y-0.5">
                  <div className="font-medium text-foreground flex items-center gap-1.5">
                    <Bell className="size-3.5 text-indigo-500" />
                    <span>飞书群定时消息推送</span>
                    {config.enabled && (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                        已启用
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    系统将在设定的时间自动分析文档并将统计卡片推送到飞书群
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  className="size-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </div>

              {/* 飞书机器人选择（直接选择系统已有机器人） */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Bot className="size-3.5 text-indigo-500" />
                    选择推送机器人
                  </span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    直接选择系统中已配置的飞书机器人
                  </span>
                </label>

                {availableBots.length > 0 ? (
                  <div className="space-y-2">
                    <select
                      value={config.botId || ""}
                      onChange={(e) => setConfig({ ...config, botId: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="" disabled>
                        请选择一个已配置的飞书机器人
                      </option>
                      {availableBots.map((bot) => (
                        <option key={bot.id} value={bot.id}>
                          {bot.name} ({bot.webhookMasked || "已配置"})
                        </option>
                      ))}
                    </select>

                    {selectedBot && (
                      <div className="rounded-lg bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 px-3 py-2 text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-indigo-950 dark:text-indigo-200">
                            {selectedBot.name}
                          </span>
                          <Badge variant="outline" className="text-[10px] bg-background/60">
                            ID: {selectedBot.id}
                          </Badge>
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {selectedBot.webhookMasked}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200">
                    <p className="font-medium">系统当前暂未录入已配置的飞书机器人</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      请先前往系统首页或机器人管理页面添加机器人，或展开下方高级设置手动填写 Webhook。
                    </p>
                  </div>
                )}
              </div>

              {/* 定时周期与具体时间 */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">推送频率</label>
                <select
                  value={config.frequency || "weekly"}
                  onChange={(e) => {
                    const frequency = e.target.value as "daily" | "weekly";
                    setConfig({ ...config, frequency, cycleType: frequency === "daily" ? "yesterday" : "this_week" });
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(config.frequency || "weekly") === "weekly" && <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    推送周期（星期）
                  </label>
                  <select
                    value={config.dayOfWeek}
                    onChange={(e) => setConfig({ ...config, dayOfWeek: Number(e.target.value) })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {WEEKDAY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>}

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    推送时间（北京时间）
                  </label>
                  <input
                    type="time"
                    value={config.time || "18:00"}
                    onChange={(e) => setConfig({ ...config, time: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* 贡献榜统计周期选择 */}
              {(config.frequency || "weekly") === "daily" ? (
                <div className="rounded-lg bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
                  每天统计北京时间前一天（00:00 至 23:59:59）每位成员新增的文档，累计总贡献榜仍在文字卡片中展示。
                </div>
              ) : <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span>🏆 贡献榜统计周期</span>
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal text-muted-foreground">
                      可按需选择
                    </Badge>
                  </span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    决定定时发送时所汇总的时间跨度
                  </span>
                </label>

                <div className="grid grid-cols-1 gap-2">
                  {CYCLE_OPTIONS.map((opt) => {
                    const isSelected = (config.cycleType || "this_week") === opt.value;
                    return (
                      <div
                        key={opt.value}
                        onClick={() => setConfig({ ...config, cycleType: opt.value })}
                        className={`flex cursor-pointer items-start justify-between rounded-xl border p-3 transition-all ${
                          isSelected
                            ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20 text-foreground ring-1 ring-indigo-500"
                            : "border-border/70 bg-card hover:border-border hover:bg-muted/30"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold">{opt.title}</span>
                            {opt.badge && (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  isSelected
                                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {opt.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                        </div>
                        <div
                          className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
                            isSelected
                              ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500"
                              : "border-muted-foreground/30 bg-background"
                          }`}
                        >
                          {isSelected && <Check className="size-2.5 stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>}

              {/* 发送时 @ 所有人 开关 */}
              <div className="flex items-center justify-between rounded-xl border border-border/80 bg-muted/30 p-3.5">
                <div className="space-y-0.5">
                  <div className="font-medium text-foreground flex items-center gap-1.5">
                    <AtSign className="size-3.5 text-indigo-500" />
                    <span>发送通知时 @ 所有人</span>
                    {config.atAll && (
                      <Badge variant="outline" className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 text-[10px]">
                        已开启
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    推送群卡片时附带 @所有人，确保群内成员能及时收到提醒
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(config.atAll)}
                  onChange={(e) => setConfig({ ...config, atAll: e.target.checked })}
                  className="size-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </div>

              {/* 发送时 @ 提醒未完成迁移任务的人名 开关 */}
              {(() => {
                const isAtIncompleteEnabled = Boolean(config.atIncompleteMembers ?? config.atZeroContributors);
                const targetIncompleteList =
                  config.atIncompleteMode === "zero_only" ? zeroContributorsList : incompleteMembersList;

                return (
                  <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20 p-3.5">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 pr-3">
                        <div className="font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                          <AtSign className="size-3.5 text-amber-600 dark:text-amber-400" />
                          <span>催办：@ 提醒未完成迁移任务的人名</span>
                          {isAtIncompleteEnabled ? (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px]">
                              已开启 ({targetIncompleteList.length}人)
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground text-[10px]">
                              未开启
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          推送知识库统计时，自动提取尚未标记完成个人迁移任务的同学并精准 @ 对应人名进行提醒。
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={isAtIncompleteEnabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setConfig({
                            ...config,
                            atIncompleteMembers: checked,
                            atZeroContributors: checked,
                          });
                        }}
                        className="size-5 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer mt-0.5"
                      />
                    </div>

                    {isAtIncompleteEnabled && (
                      <div className="space-y-2.5 pt-2 border-t border-amber-200/60 dark:border-amber-900/40">
                        <div className="flex items-center gap-4 text-xs text-foreground flex-wrap">
                          <span className="text-muted-foreground text-[11px]">提醒人员范围：</span>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="atIncompleteMode"
                              checked={config.atIncompleteMode !== "zero_only"}
                              onChange={() => setConfig({ ...config, atIncompleteMode: "all_incomplete" })}
                              className="size-3.5 text-amber-600 focus:ring-amber-500"
                            />
                            <span>全部未完成成员 ({incompleteMembersList.length}人)</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="atIncompleteMode"
                              checked={config.atIncompleteMode === "zero_only"}
                              onChange={() => setConfig({ ...config, atIncompleteMode: "zero_only" })}
                              className="size-3.5 text-amber-600 focus:ring-amber-500"
                            />
                            <span>仅未完成且0贡献 ({zeroContributorsList.length}人)</span>
                          </label>
                        </div>

                        {targetIncompleteList.length > 0 ? (
                          <div className="rounded bg-amber-100/70 dark:bg-amber-900/40 px-2.5 py-1.5 text-[11px] text-amber-900 dark:text-amber-200 font-mono">
                            待催办名单 ({targetIncompleteList.length}人)：{targetIncompleteList.map((m) => m.name).join("、")}
                          </div>
                        ) : (
                          <div className="rounded bg-green-500/10 px-2.5 py-1.5 text-[11px] text-green-700 dark:text-green-300">
                            🎉 所选范围内的所有同学均已完成迁移任务！
                          </div>
                        )}

                        <div className="space-y-1">
                          <label className="text-[11px] text-muted-foreground">自定义催办提醒文案（选填）：</label>
                          <input
                            type="text"
                            value={config.incompleteNoticeMessage || config.zeroNoticeMessage || ""}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                incompleteNoticeMessage: e.target.value,
                                zeroNoticeMessage: e.target.value,
                              })
                            }
                            placeholder="以下同学尚未完成个人文档到知识库的迁移任务，请尽快完成文档归档与知识库沉淀："
                            className="w-full rounded-md border border-amber-300/60 dark:border-amber-800/60 bg-white/70 dark:bg-black/20 px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 text-foreground"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 上次发送记录 */}
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs flex items-center justify-between text-muted-foreground">
                <span>上次成功推送时间：</span>
                <span className="font-mono text-foreground">{formatTime(config.lastSentAt)}</span>
              </div>

              {/* 高级选项折叠：自定义独立 Webhook */}
              <div className="border-t border-border/50 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvancedWebhook(!showAdvancedWebhook)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <SlidersHorizontal className="size-3" />
                  <span>高级设置：指定独立 Webhook 地址（可选）</span>
                  {showAdvancedWebhook ? (
                    <ChevronUp className="size-3" />
                  ) : (
                    <ChevronDown className="size-3" />
                  )}
                </button>

                {showAdvancedWebhook && (
                  <div className="mt-2 space-y-1 rounded-lg border border-border bg-muted/20 p-2.5">
                    <label className="text-[11px] text-muted-foreground">
                      若填写，将覆盖上述选中的机器人 Webhook：
                    </label>
                    <input
                      type="text"
                      placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                      value={config.webhookUrl || ""}
                      onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
                      className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* 操作状态提示 */}
              {message && (
                <div
                  className={`rounded-lg p-2.5 text-xs font-medium ${
                    message.type === "success"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                      : "bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20"
                  }`}
                >
                  {message.text}
                </div>
              )}

              {/* 弹窗底部操作按钮 */}
              <div className="pt-2 flex items-center justify-between gap-3 border-t border-border/60">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestSend}
                  disabled={testing || saving || (!config.botId && !config.webhookUrl?.trim())}
                  className="text-xs"
                >
                  {testing ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Play className="mr-1.5 size-3.5 text-indigo-500" />
                  )}
                  {testing ? "执行中…" : "立即执行一次"}
                </Button>

                <div className="flex items-center gap-2">
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="sm" className="text-xs" disabled={saving}>
                      关闭
                    </Button>
                  </Dialog.Close>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || testing}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                  >
                    {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                    {saving ? "保存中…" : "保存配置"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
