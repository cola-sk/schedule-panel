import { NextResponse } from "next/server";
import { getPublicAIModelConfig, saveAIModelConfig } from "@/lib/ai-config/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  return NextResponse.json({ config: getPublicAIModelConfig() });
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const llmBaseUrl = text(body.llmBaseUrl);
    if (llmBaseUrl) new URL(llmBaseUrl);
    const config = saveAIModelConfig({
      llmBaseUrl: llmBaseUrl || undefined,
      llmModel: text(body.llmModel) || undefined,
      llmApiKey: text(body.llmApiKey) || undefined,
    });
    return NextResponse.json({
      config: {
        llmBaseUrl: config.llmBaseUrl,
        llmModel: config.llmModel,
        llmApiKeyConfigured: Boolean(config.llmApiKey?.trim()),
        updatedAt: config.updatedAt,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存 AI 配置失败" }, { status: 400 });
  }
}
