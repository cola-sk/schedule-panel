import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import type { AIModelConfig } from "@/lib/ai-config/store";
import {
  isValidCategory,
  resolveCategory,
  type CategorySuggestion,
  type DynamicTaxonomy,
  type SourceDocument,
} from "./types";

const resultSchema = z.object({
  primaryCategory: z.string().optional().default(""),
  secondaryCategory: z.string().optional().default(""),
  confidence: z.coerce.number().min(0).max(1).optional().default(0.8),
  reason: z.string().max(400).optional().default(""),
  summary: z.string().max(500).optional().default(""),
});

function parseJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || content.match(/\{[\s\S]*\}/)?.[0] || content;
  return JSON.parse(candidate);
}

export async function classifyDocument(
  llmConfig: AIModelConfig,
  source: SourceDocument,
  markdown: string,
  taxonomy: DynamicTaxonomy,
): Promise<CategorySuggestion> {
  if (!llmConfig.llmBaseUrl || !llmConfig.llmApiKey || !llmConfig.llmModel) {
    return { error: "未配置 LLM，等待人工选择迁移路径" };
  }
  const taxonomyText = Object.entries(taxonomy)
    .map(([primary, secondaries]) => `- ${primary}：${secondaries.join("、")}`)
    .join("\n");
  if (!taxonomyText) return { error: "目标飞书知识库未读取到可用的一级/二级目录" };

  // 严格限制送入大模型的正文长度，绝不获取或发送长文档完整内容。
  // 大多数技术 Wiki 的核心意图、业务域在前部说明中，文末常包含归属团队或结论。
  // 中间海量细节、详尽排查、大表数据自动截断切除，既保证大模型分类精准、大幅节省 Token，又保护企业敏感数据。
  const maxExcerpt = 3000;
  let excerpt = "";
  if (!markdown || markdown.trim().length === 0) {
    excerpt = "（该文档为 Wiki 目录节点或无正文内容）";
  } else if (markdown.length <= maxExcerpt) {
    excerpt = markdown;
  } else {
    excerpt = `${markdown.slice(0, 2200)}\n\n…（正文中间内容已自动截断省略，原文共 ${markdown.length} 字）…\n\n${markdown.slice(-800)}`;
  }

  const systemPrompt = `你是一名专业的技术知识库架构师与分类专家。你的任务是分析输入的 Confluence 技术文档，将其精准归类到目标飞书知识库目录中，并根据资产类型侧重生成精炼摘要。

### 1. 目标飞书分类表（必须以此表为准进行输出）
${taxonomyText}

### 2. 资产类型参考指引（供理解文档属性与撰写摘要侧重点参考，输出的分类必须映射到上方分类表真实存在的名称中）：
- **规范、流程与制度**：如代码规范、研发流程、团队制度等。输出应对应【规范与标准】对应子分类。
  → 摘要侧重：「约束覆盖范围(代码/CR/发布) + 核心规则要点 + 保障的质量/安全目标」。
- **方案与架构决策**：如架构设计、通用技术方案、业务技术方案、性能优化方案、技术选型等。输出应对应【方案与架构】对应子分类。
  → 摘要侧重：「设计背景 + 核心架构模式/技术选型 + 解决的系统级解耦/扩展/性能问题」。
- **组件与基础库 (SDK)**：如公共 SDK、UI 组件库、通用工具库、插件等。输出应对应【基础库与能力】对应子分类。
  → 摘要侧重：「核心能力/暴露的功能 + 解决的代码复用/通信/状态痛点 + 适用技术栈与端」。
- **工程与开发工具**：如脚手架和模板、本地开发和调试、构建与编译、质量与测试、CICD与部署等。输出应对应【工程与效能】对应子分类。
  → 摘要侧重：「工具定位(CLI/脚手架/调试) + 解决的研发效率问题 + 核心支持的功能」。
- **故障排查与应急**：如数据指标定义、监控报警、故障排查手册、应急与容灾预案。输出应对应【监控和运维】对应子分类。
  → 摘要侧重：「针对的异常现象/报错/告警 + 核心排查链路与工具 + 应急恢复/降级策略」。
- **AI 资产与扩展**：如 MCP、Agent 工具。输出应对应【AI研发资产】对应子分类。
  → 摘要侧重：「提供给 Agent 的工具能力/数据源 + 调用触发场景与功能边界」。
- **经验沉淀 / 业务概览 / 其他**：如事故复盘、技术总结、技术分享、新人文档、周会记录或项目跟进。输出应对应【知识与成长】或【团队协作与项目跟进】对应子分类。
  → 摘要侧重：「业务领域/项目背景 + 核心沉淀经验与最佳实践」。

### 3. 分类要求
- 综合权衡【页面标题】、【来源目录路径】与【正文摘录】的实际意图进行归类。
- 请从【目标飞书分类表】中选择最为贴切的「一级类 (primaryCategory)」和「二级类 (secondaryCategory)」。
- 严禁自行编造不在分类表中的一级分类名称。

### 4. 输出格式规范
请严格输出合法 JSON，禁止输出任何额外分析文本或 Markdown 标记：
{
  "primaryCategory": "一级类名称（选自目标飞书分类表）",
  "secondaryCategory": "二级类名称（选自对应一级类下的子列表）",
  "confidence": 0.0到1.0之间的浮点数置信度,
  "reason": "简要说明判定依据（不超过100字）",
  "summary": "依据上述分类侧重指引写出的精炼摘要（不超过160字）"
}`;

  const client = new OpenAI({ apiKey: llmConfig.llmApiKey, baseURL: llmConfig.llmBaseUrl });
  try {
    // 注意：部分 Reasoning / Luna 模型不支持 temperature: 0.1（会报 400 Unsupported value: 'temperature'），因此不显式传递 temperature
    const response = await client.chat.completions.create({
      model: llmConfig.llmModel!,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `【待分类文档信息】\n标题：${source.title}\n来源 Wiki 路径：${source.path.join(" / ") || "根目录"}\n正文摘录：\n${excerpt}`,
        },
      ],
    });
    const rawContent = response.choices[0]?.message?.content || "";
    const parsed = resultSchema.parse(parseJson(rawContent));

    // 智能解析并映射归一化到飞书目录
    const resolved = resolveCategory(parsed.primaryCategory, parsed.secondaryCategory, taxonomy);

    const primaryCategory = resolved.primary || parsed.primaryCategory;
    const secondaryCategory = resolved.secondary !== undefined ? resolved.secondary : parsed.secondaryCategory;

    if (!isValidCategory(primaryCategory, secondaryCategory, taxonomy)) {
      // 容错：如果依然无法完全命中，尝试只检验一级
      if (primaryCategory && taxonomy[primaryCategory]) {
        const fallbackSecondary = taxonomy[primaryCategory][0] || "";
        return {
          ...parsed,
          primaryCategory,
          secondaryCategory: fallbackSecondary,
        };
      }
      return {
        ...parsed,
        error: `模型推测分类「${parsed.primaryCategory} / ${parsed.secondaryCategory}」未能匹配到目标飞书目录，请手动选择`,
      };
    }

    return {
      ...parsed,
      primaryCategory,
      secondaryCategory,
    };
  } catch (error) {
    return { error: error instanceof Error ? `LLM 分类失败：${error.message}` : "LLM 分类失败" };
  }
}
