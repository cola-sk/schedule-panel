"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, FileText, FolderInput, Loader2, MoveRight, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OtherDirectoryDocument } from "@/lib/knowledge-migration/types";

type AnalysisResult = {
  sourceDirectory: string;
  scannedAt: string;
  taxonomy: Record<string, string[]>;
  documents: OtherDirectoryDocument[];
};

type MoveResult = { targetLabel?: string; createdDirectory?: boolean; error?: string };
type MigrationIssue = { title: string; reason: string };

const selectClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring";

function targetLabel(document: OtherDirectoryDocument) {
  const suggestion = document.recommendation;
  if (suggestion.error) return "需要人工确认";
  if (suggestion.targetKind === "new_directory") {
    const parent = suggestion.newDirectoryParent === "root" ? "目标根目录" : suggestion.newDirectoryParent;
    return `新建目录：${parent} / ${suggestion.newDirectoryName}`;
  }
  return [suggestion.primaryCategory, suggestion.secondaryCategory].filter(Boolean).join(" / ") || "需要人工确认";
}

function canMigrate(document: OtherDirectoryDocument) {
  const suggestion = document.recommendation;
  if (suggestion.error) return false;
  if (suggestion.targetKind === "new_directory") {
    return Boolean(suggestion.newDirectoryName?.trim() && suggestion.newDirectoryParent);
  }
  return Boolean(suggestion.primaryCategory);
}

function markAncestors(document: OtherDirectoryDocument, byToken: Map<string, OtherDirectoryDocument>, blocked: Set<string>) {
  let parentToken: string | undefined = document.parentNodeToken;
  while (parentToken && byToken.has(parentToken) && !blocked.has(parentToken)) {
    blocked.add(parentToken);
    parentToken = byToken.get(parentToken)?.parentNodeToken;
  }
}

function isInMovedSubtree(document: OtherDirectoryDocument, movedToken: string, byToken: Map<string, OtherDirectoryDocument>) {
  let current: OtherDirectoryDocument | undefined = document;
  while (current) {
    if (current.nodeToken === movedToken) return true;
    current = current.parentNodeToken ? byToken.get(current.parentNodeToken) : undefined;
  }
  return false;
}

export function KnowledgeMigrationOtherDirectory({ taskId }: { taskId: string }) {
  const [result, setResult] = useState<AnalysisResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [movingNodeToken, setMovingNodeToken] = useState<string>();
  const [actionNotice, setActionNotice] = useState<string>();
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number }>();
  const [bulkIssues, setBulkIssues] = useState<MigrationIssue[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(() => new Set());
  const isBusy = loading || Boolean(movingNodeToken) || Boolean(bulkProgress);

  async function analyze() {
    setLoading(true);
    setError(undefined);
    setActionNotice(undefined);
    setBulkIssues([]);
    try {
      const response = await fetch(`/api/knowledge-migrations/tasks/${taskId}/other-directory`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as AnalysisResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "读取“其他”目录失败");
      setResult(data);
      setSelectedTokens(new Set());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取“其他”目录失败");
    } finally {
      setLoading(false);
    }
  }

  async function move(document: OtherDirectoryDocument): Promise<MoveResult> {
    const response = await fetch(`/api/knowledge-migrations/tasks/${taskId}/other-directory/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeToken: document.nodeToken, recommendation: document.recommendation }),
    });
    const data = (await response.json().catch(() => ({}))) as MoveResult;
    if (!response.ok) throw new Error(data.error || "迁移飞书知识库文档失败");
    return data;
  }

  function removeMovedNode(nodeToken: string) {
    const byToken = new Map(result?.documents.map((item) => [item.nodeToken, item]) || []);
    const movedTokens = new Set(result?.documents.filter((item) => isInMovedSubtree(item, nodeToken, byToken)).map((item) => item.nodeToken) || []);
    setResult((current) => {
      if (!current) return current;
      return { ...current, documents: current.documents.filter((item) => !movedTokens.has(item.nodeToken)) };
    });
    setSelectedTokens((current) => new Set([...current].filter((token) => !movedTokens.has(token))));
  }

  async function migrate(document: OtherDirectoryDocument) {
    if (!canMigrate(document)) return;
    const childWarning = document.hasChildren ? "该节点包含子文档，飞书会一并移动其子节点。\n\n" : "";
    if (!window.confirm(`${childWarning}确认将「${document.title}」迁移到「${targetLabel(document)}」吗？`)) return;

    setMovingNodeToken(document.nodeToken);
    setError(undefined);
    setActionNotice(undefined);
    setBulkIssues([]);
    try {
      const data = await move(document);
      removeMovedNode(document.nodeToken);
      setActionNotice(`已迁移到「${data.targetLabel || targetLabel(document)}」${data.createdDirectory ? "，并已创建目标目录" : ""}。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "迁移飞书知识库文档失败");
    } finally {
      setMovingNodeToken(undefined);
    }
  }

  async function migrateSelected() {
    if (!result || isBusy) return;
    const documents = result.documents.filter((document) => selectedTokens.has(document.nodeToken)).sort((left, right) => right.path.length - left.path.length);
    if (!documents.length) return;
    const invalidCount = documents.filter((document) => !canMigrate(document)).length;
    const warning = invalidCount ? `其中 ${invalidCount} 篇没有有效建议，会保留在“其他”目录。\n` : "";
    if (!window.confirm(`确认按当前目标目录迁移选中的 ${documents.length} 篇文档吗？\n${warning}子文档会先于上级文档迁移；上级节点包含未选中或迁移失败的子文档时会保留，避免移动未选中的内容。`)) return;

    const byToken = new Map(result.documents.map((document) => [document.nodeToken, document]));
    const blockedByUnselected = new Set<string>();
    const blockedByFailure = new Set<string>();
    for (const document of result.documents) {
      if (!selectedTokens.has(document.nodeToken)) markAncestors(document, byToken, blockedByUnselected);
    }
    const issues: MigrationIssue[] = [];
    let migrated = 0;
    setError(undefined);
    setActionNotice(undefined);
    setBulkIssues([]);
    setBulkProgress({ completed: 0, total: documents.length });

    for (const [index, document] of documents.entries()) {
      if (!canMigrate(document)) {
        issues.push({ title: document.path.join(" / "), reason: document.recommendation.error || "没有有效的目标目录建议" });
        markAncestors(document, byToken, blockedByFailure);
      } else if (blockedByUnselected.has(document.nodeToken)) {
        issues.push({ title: document.path.join(" / "), reason: "包含未选中的子文档，为避免移动未选中的内容，已保留该节点" });
      } else if (blockedByFailure.has(document.nodeToken)) {
        issues.push({ title: document.path.join(" / "), reason: "下级文档未迁移，为避免连同下级文档一起移动，已保留该节点" });
      } else {
        try {
          await move(document);
          removeMovedNode(document.nodeToken);
          migrated += 1;
        } catch (reason) {
          issues.push({ title: document.path.join(" / "), reason: reason instanceof Error ? reason.message : "迁移失败" });
          markAncestors(document, byToken, blockedByFailure);
        }
      }
      setBulkProgress({ completed: index + 1, total: documents.length });
    }

    setBulkIssues(issues);
    setActionNotice(`批量迁移完成：已迁移 ${migrated} 篇，保留 ${issues.length} 篇。`);
    setBulkProgress(undefined);
  }

  function selectDocument(nodeToken: string, checked: boolean) {
    setSelectedTokens((current) => {
      const next = new Set(current);
      if (checked) next.add(nodeToken);
      else next.delete(nodeToken);
      return next;
    });
  }

  function selectAll(checked: boolean) {
    setSelectedTokens(checked ? new Set(result?.documents.map((document) => document.nodeToken)) : new Set());
  }

  function changeDirectory(document: OtherDirectoryDocument, primaryCategory: string, secondaryCategory: string) {
    setResult((current) => current && {
      ...current,
      documents: current.documents.map((item) =>
        item.nodeToken === document.nodeToken
          ? {
              ...item,
              recommendation: {
                ...item.recommendation,
                targetKind: "existing_directory",
                primaryCategory,
                secondaryCategory,
                newDirectoryName: undefined,
                newDirectoryParent: undefined,
                error: undefined,
              },
            }
          : item,
      ),
    });
  }

  return (
    <section className="space-y-5">
      <Card className="shadow-none">
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderInput className="size-4 text-violet-600" />
                其他目录整理建议
              </CardTitle>
              <p className="mt-1.5 max-w-3xl text-sm font-normal text-muted-foreground">
                读取飞书知识库一级目录「其他」下的全部文档，结合标题、正文与当前目录结构，推荐迁移到现有目录或新建目录。附件不下载正文，直接依据文件标题和路径生成建议。分析后可多选、全选并批量迁移；新目录仅会在对应文档迁移时创建。
              </p>
            </div>
            <Button size="sm" onClick={() => void analyze()} disabled={isBusy}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : result ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
              {loading ? "读取与分析中…" : result ? "重新分析" : "读取其他目录并分析"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p>在线文档会读取正文；附件仅使用文件标题和路径。发送给模型的正文摘录最多 3,000 字。</p>
        </CardContent>
      </Card>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {actionNotice && <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="size-4" />{actionNotice}</p>}
      {bulkIssues.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">以下文档未完成批量迁移，可调整建议后重试或重新分析核对：</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {bulkIssues.map((issue, index) => <li key={`${issue.title}-${index}`}>{issue.title}：{issue.reason}</li>)}
          </ul>
        </div>
      )}

      {result && (
        <Card className="shadow-none">
          <CardHeader className="border-b border-border py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm">「{result.sourceDirectory}」目录文档</CardTitle>
                <p className="mt-1 text-xs font-normal text-muted-foreground">
                  待迁移 {result.documents.length} 篇 · {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(result.scannedAt))}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">现有目录 {result.documents.filter((item) => item.recommendation.targetKind === "existing_directory" && !item.recommendation.error).length}</Badge>
                <Badge variant="secondary">建议新建 {result.documents.filter((item) => item.recommendation.targetKind === "new_directory" && !item.recommendation.error).length}</Badge>
                {result.documents.length > 0 && (
                  <Button size="sm" onClick={() => void migrateSelected()} disabled={isBusy || selectedTokens.size === 0}>
                    {bulkProgress ? <Loader2 className="size-3.5 animate-spin" /> : <MoveRight className="size-3.5" />}
                    {bulkProgress ? `迁移中 ${bulkProgress.completed}/${bulkProgress.total}` : `迁移选中（${selectedTokens.size}）`}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {result.documents.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">「其他」目录下暂无待迁移文档。</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1240px] text-left text-sm">
                  <thead className="bg-secondary/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">
                        <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap">
                          <input
                            type="checkbox"
                            className="size-4 accent-violet-600"
                            ref={(checkbox) => {
                              if (checkbox) checkbox.indeterminate = selectedTokens.size > 0 && selectedTokens.size < result.documents.length;
                            }}
                            checked={result.documents.length > 0 && selectedTokens.size === result.documents.length}
                            disabled={isBusy}
                            onChange={(event) => selectAll(event.target.checked)}
                            aria-label="全选其他目录文档"
                          />
                          全选
                        </label>
                      </th>
                      <th className="px-4 py-3">文档</th>
                      <th className="px-4 py-3">来源路径</th>
                      <th className="px-4 py-3">推荐目录</th>
                      <th className="px-4 py-3">依据与摘要</th>
                      <th className="px-4 py-3 text-right">置信度</th>
                      <th className="px-4 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.documents.map((document) => (
                      <tr key={document.nodeToken} className="align-top">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            className="size-4 accent-violet-600"
                            checked={selectedTokens.has(document.nodeToken)}
                            disabled={isBusy}
                            onChange={(event) => selectDocument(document.nodeToken, event.target.checked)}
                            aria-label={`选择${document.title}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex max-w-64 items-start gap-2">
                            <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              {document.url ? (
                                <a href={document.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-medium hover:underline">
                                  <span className="truncate">{document.title}</span><ExternalLink className="size-3 shrink-0" />
                                </a>
                              ) : <span className="font-medium">{document.title}</span>}
                              {document.contentLength !== undefined && <p className="mt-1 text-[11px] text-muted-foreground">正文 {document.contentLength.toLocaleString()} 字</p>}
                            </div>
                          </div>
                        </td>
                        <td className="max-w-64 px-4 py-3 text-xs text-muted-foreground">{document.path.join(" / ")}</td>
                        <td className="px-4 py-3">
                          <div className="w-52 space-y-1.5">
                            {document.recommendation.targetKind === "new_directory" && (
                              <Badge variant="secondary" className="whitespace-normal text-left font-medium">{targetLabel(document)}</Badge>
                            )}
                            <select
                              className={selectClass}
                              disabled={isBusy}
                              value={document.recommendation.targetKind === "existing_directory" ? document.recommendation.primaryCategory || "" : ""}
                              onChange={(event) => changeDirectory(document, event.target.value, "")}
                              aria-label={`${document.title}的一级目标目录`}
                            >
                              <option value="">选择一级目录</option>
                              {Object.keys(result.taxonomy).map((primary) => <option key={primary} value={primary}>{primary}</option>)}
                            </select>
                            <select
                              className={selectClass}
                              value={document.recommendation.targetKind === "existing_directory" ? document.recommendation.secondaryCategory || "" : ""}
                              disabled={isBusy || !document.recommendation.primaryCategory || document.recommendation.targetKind !== "existing_directory"}
                              onChange={(event) => changeDirectory(document, document.recommendation.primaryCategory || "", event.target.value)}
                              aria-label={`${document.title}的二级目标目录`}
                            >
                              <option value="">直接放入一级目录</option>
                              {((document.recommendation.targetKind === "existing_directory" && result.taxonomy[document.recommendation.primaryCategory || ""]) || []).map((secondary) => (
                                <option key={secondary} value={secondary}>{secondary}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="max-w-md px-4 py-3 text-xs leading-5 text-muted-foreground">
                          {document.contentWarning && <p className="mb-1 text-amber-700">{document.contentWarning}</p>}
                          {document.recommendation.error ? (
                            <span className="text-red-600">{document.recommendation.error}</span>
                          ) : (
                            <><p>{document.recommendation.reason}</p>{document.recommendation.summary && <p className="mt-1 text-foreground/80">{document.recommendation.summary}</p>}</>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{document.recommendation.confidence !== undefined ? `${Math.round(document.recommendation.confidence * 100)}%` : "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canMigrate(document) || isBusy}
                            title={document.hasChildren ? "迁移该节点及其下级子文档" : "按推荐路径移动此文档"}
                            onClick={() => void migrate(document)}
                          >
                            {movingNodeToken === document.nodeToken ? <Loader2 className="size-3.5 animate-spin" /> : <MoveRight className="size-3.5" />}
                            {movingNodeToken === document.nodeToken ? "迁移中…" : "确认迁移"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
