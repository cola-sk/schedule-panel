"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bot, CheckCircle2, CircleAlert, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PublicBotConfig } from "@/lib/types";

const inputControlClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function BotManagementPanel() {
  const [bots, setBots] = useState<PublicBotConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [editingBot, setEditingBot] = useState<PublicBotConfig | "new" | undefined>();
  const [deletingBot, setDeletingBot] = useState<PublicBotConfig | undefined>();
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" }>();

  function showToast(message: string, tone: "success" | "error" = "success") {
    setToast({ message, tone });
    setTimeout(() => {
      setToast(undefined);
    }, 3000);
  }

  async function loadBots() {
    try {
      const res = await fetch("/api/bots", { cache: "no-store" });
      const data = (await res.json()) as { bots?: PublicBotConfig[]; error?: string };
      if (!res.ok) throw new Error(data.error || "加载机器人列表失败");
      setBots(data.bots ?? []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "加载机器人列表失败", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBots();
  }, []);

  async function handleSaveBot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingBot) return;

    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const name = String(form.get("name") ?? "").trim();
      const webhookUrl = String(form.get("webhookUrl") ?? "").trim();
      const enabled = form.get("enabled") === "on";

      const isNew = editingBot === "new";
      const res = await fetch(isNew ? "/api/bots" : `/api/bots/${editingBot.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          webhookUrl: webhookUrl || undefined,
          enabled,
        }),
      });

      const data = (await res.json()) as { bots?: PublicBotConfig[]; error?: string };
      if (!res.ok) throw new Error(data.error || "保存机器人失败");

      setBots(data.bots ?? []);
      setEditingBot(undefined);
      showToast(isNew ? `已成功添加机器人「${name}」` : `已更新机器人「${name}」配置`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存机器人失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBot() {
    if (!deletingBot) return;

    setDeletingId(deletingBot.id);
    try {
      const res = await fetch(`/api/bots/${deletingBot.id}`, { method: "DELETE" });
      const data = (await res.json()) as { bots?: PublicBotConfig[]; error?: string };
      if (!res.ok) throw new Error(data.error || "删除机器人失败");

      setBots(data.bots ?? []);
      showToast(`已删除机器人「${deletingBot.name}」`);
      setDeletingBot(undefined);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "删除机器人失败", "error");
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`fixed right-6 top-6 z-[120] flex max-w-md items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            toast.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="alert"
        >
          {toast.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : (
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
          )}
          <span className="flex-1">{toast.message}</span>
        </div>
      )}

      {/* 顶部操作与说明 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">飞书群 Webhook 机器人</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            一个机器人对应一个飞书群自定义 Webhook，定时任务、周报归档提醒可灵活选择已配置的机器人。
          </p>
        </div>
        <Button size="sm" onClick={() => setEditingBot("new")}>
          <Plus className="size-3.5" />
          <span>添加机器人</span>
        </Button>
      </div>

      {/* 机器人列表 */}
      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>正在加载机器人配置…</span>
        </div>
      ) : bots.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 text-center bg-card">
          <Bot className="mb-3 size-10 text-muted-foreground/40" />
          <p className="text-base font-medium text-foreground">暂未添加机器人</p>
          <p className="mt-1.5 text-xs text-muted-foreground max-w-sm">
            点击上方“添加机器人”，填入飞书群自定义机器人的 Webhook 地址即可完成绑定。
          </p>
          <Button size="sm" className="mt-4" onClick={() => setEditingBot("new")}>
            <Plus className="size-3.5" />
            <span>添加第一个机器人</span>
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
          {bots.map((bot) => (
            <Card key={bot.id} className="transition-all hover:border-foreground/20">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
                      <Bot className="size-4" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{bot.name}</span>
                        <Badge variant={bot.enabled ? "success" : "secondary"}>
                          {bot.enabled ? "已启用" : "已停用"}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        ID: <span className="text-foreground/70">{bot.id}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditingBot(bot)}>
                      <Pencil className="size-3.5" />
                      <span>编辑</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeletingBot(bot)}
                    >
                      <Trash2 className="size-3.5" />
                      <span>删除</span>
                    </Button>
                  </div>
                </div>

                <div className="mt-4 rounded-md border border-border/60 bg-secondary/30 p-2.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>飞书群 Webhook</span>
                    <span className="font-mono text-[11px] text-foreground/80">{bot.webhookMasked}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 编辑 / 新建模态弹窗 */}
      {editingBot && (
        <Dialog.Root open onOpenChange={(open) => !open && setEditingBot(undefined)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xl focus:outline-none">
              <div className="flex items-center justify-between pb-4 border-b border-border">
                <Dialog.Title className="text-base font-semibold leading-none tracking-tight">
                  {editingBot === "new" ? "添加机器人" : `编辑机器人「${editingBot.name}」`}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <Button variant="ghost" size="sm">
                    关闭
                  </Button>
                </Dialog.Close>
              </div>

              <form onSubmit={handleSaveBot} className="mt-5 space-y-4">
                <label className="grid gap-2 text-sm font-medium">
                  <span>机器人名称</span>
                  <input
                    className={inputControlClass}
                    name="name"
                    defaultValue={editingBot === "new" ? "" : editingBot.name}
                    placeholder="例如：前端轮值播报助手"
                    required
                  />
                  <span className="text-xs font-normal text-muted-foreground">
                    易于辨识的别名，在定时任务关联机器人时展示。
                  </span>
                </label>

                <label className="grid gap-2 text-sm font-medium">
                  <span>飞书自定义 Webhook 地址</span>
                  <input
                    className={`${inputControlClass} font-mono text-xs`}
                    name="webhookUrl"
                    type="url"
                    placeholder={
                      editingBot === "new"
                        ? "https://open.feishu.cn/open-apis/bot/v2/hook/…"
                        : "留空以保持当前已配置 Webhook 不变"
                    }
                    required={editingBot === "new"}
                  />
                  <span className="text-xs font-normal text-muted-foreground">
                    在飞书群设置 → 群机器人 → 添加“自定义机器人”获取 Webhook 地址。
                  </span>
                </label>

                <label className="flex items-center gap-2.5 text-sm select-none pt-1">
                  <input
                    name="enabled"
                    type="checkbox"
                    className="size-4 rounded border-input text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    defaultChecked={editingBot === "new" || editingBot.enabled}
                  />
                  <span>启用此机器人</span>
                </label>

                <div className="rounded-lg bg-secondary/40 p-3 text-xs leading-5 text-muted-foreground">
                  安全提示：Webhook URL 属于群组消息推送凭证，保存后系统仅保留脱敏掩码，不会在前端暴露明文。
                </div>

                <div className="mt-6 flex justify-end gap-2.5 pt-4 border-t border-border">
                  <Button variant="outline" size="sm" type="button" onClick={() => setEditingBot(undefined)}>
                    取消
                  </Button>
                  <Button size="sm" type="submit" disabled={saving}>
                    {saving && <Loader2 className="size-3.5 animate-spin" />}
                    {saving ? "保存中…" : "确认保存"}
                  </Button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={Boolean(deletingBot)}
        title="确认删除该机器人？"
        description={
          deletingBot
            ? `确定要删除机器人「${deletingBot.name}」吗？如果已有定时任务正在使用该机器人，删除可能被阻止。`
            : ""
        }
        confirmLabel="确认删除"
        loading={Boolean(deletingId)}
        onOpenChange={(open) => !open && setDeletingBot(undefined)}
        onConfirm={() => void handleDeleteBot()}
      />
    </div>
  );
}
