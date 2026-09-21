import { NextResponse } from "next/server";
import { getPublicLLMConfig, saveLLMConfig } from "@/lib/knowledge-migration/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  try {
    return NextResponse.json({ config: getPublicLLMConfig() });
  } catch (error) {
    console.error("GET /api/knowledge-migrations/llm 错误:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取模型配置失败", config: {} },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const llmBaseUrl = text(body.llmBaseUrl);
    const llmApiKey = text(body.llmApiKey);
    const llmModel = text(body.llmModel);

    const saved = saveLLMConfig({
      llmBaseUrl: llmBaseUrl || undefined,
      llmApiKey: llmApiKey || undefined,
      llmModel: llmModel || undefined,
    });

    return NextResponse.json({
      config: {
        llmBaseUrl: saved.llmBaseUrl,
        llmModel: saved.llmModel,
        llmApiKeyConfigured: Boolean(saved.llmApiKey && saved.llmApiKey.trim()),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存模型配置失败" }, { status: 400 });
  }
}
