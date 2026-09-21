import { NextResponse } from "next/server";
import { getMigrationOverview } from "@/lib/knowledge-migration/service";
import { getKnowledgeDirectories, getMigrationItems, getPublicMigrationConfig, saveMigrationConfig } from "@/lib/knowledge-migration/store";
import { taxonomyFromDirectories, type ConfluenceAuthType, type ItemFilters } from "@/lib/knowledge-migration/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filters: ItemFilters = {
      status: (searchParams.get("status") || undefined) as ItemFilters["status"],
      primaryCategory: (searchParams.get("primaryCategory") || undefined) as ItemFilters["primaryCategory"],
      secondaryCategory: searchParams.get("secondaryCategory") || undefined,
      keyword: searchParams.get("keyword") || undefined,
      createdBy: searchParams.get("createdBy") || undefined,
      updatedBy: searchParams.get("updatedBy") || undefined,
      approvedBy: searchParams.get("approvedBy") || undefined,
      jobId: searchParams.get("jobId") || undefined,
    };
    const directories = getKnowledgeDirectories();
    return NextResponse.json({
      config: getPublicMigrationConfig(),
      overview: getMigrationOverview(),
      items: getMigrationItems(filters),
      directories,
      taxonomy: taxonomyFromDirectories(directories),
    });
  } catch (error) {
    console.error("GET /api/knowledge-migrations 错误:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取知识库迁移信息失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const confluenceBaseUrl = text(body.confluenceBaseUrl);
    const confluenceRootPageId = text(body.confluenceRootPageId);
    const targetWikiRoot = text(body.targetWikiRoot);
    const confluenceAuthType = text(body.confluenceAuthType) as ConfluenceAuthType;
    if (!confluenceBaseUrl || !confluenceRootPageId || !targetWikiRoot) throw new Error("请填写 Confluence 地址、根页面 ID 和飞书知识库根节点");
    if (!(["pat", "basic", "cookie"] as const).includes(confluenceAuthType)) throw new Error("请选择有效的 Confluence 认证方式");
    try {
      new URL(confluenceBaseUrl);
      new URL(targetWikiRoot);
    } catch {
      throw new Error("Confluence 地址和飞书知识库根节点必须是有效 URL");
    }
    if (confluenceAuthType === "basic" && !text(body.confluenceUsername)) throw new Error("Basic Auth 需要填写 Confluence 用户名");
    const config = saveMigrationConfig({
      confluenceBaseUrl,
      confluenceRootPageId,
      confluenceAuthType,
      confluenceUsername: text(body.confluenceUsername) || undefined,
      confluenceSecret: text(body.confluenceSecret) || undefined,
      targetWikiRoot,
      llmBaseUrl: text(body.llmBaseUrl) || undefined,
      llmApiKey: text(body.llmApiKey) || undefined,
      llmModel: text(body.llmModel) || undefined,
      defaultOperatorName: text(body.defaultOperatorName) || "未填写",
    });
    const { confluenceSecret, llmApiKey, ...publicConfig } = config;
    return NextResponse.json({ ...publicConfig, confluenceSecretConfigured: Boolean(confluenceSecret), llmApiKeyConfigured: Boolean(llmApiKey) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存配置失败" }, { status: 400 });
  }
}
