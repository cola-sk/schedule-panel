import * as lark from "@larksuiteoapi/node-sdk";
import fs from "fs";
import path from "path";

// 尝试加载 .env.local
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["'](.*)["']$/, "$1");
      process.env[key] = val;
    }
  }
}

const appId = process.env.FEISHU_APP_ID || "cli_aa1cf4558ef89ccd";
const appSecret = process.env.FEISHU_APP_SECRET || "9AtDFdbPk5JpFr97TNzXShU6Sfj0wTpm";

const client = new lark.Client({
  appId,
  appSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

async function main() {
  const query = process.argv[2] || "前端";
  console.log(`[测试] 正在测试飞书知识库检索能力，关键词: "${query}"...`);

  // 1. 测试空间列表
  try {
    console.log("\n1. 正在获取可访问的知识库空间列表 (wiki.space.list)...");
    const spacesRes = await client.wiki.space.list({ params: { page_size: 10 } });
    if (spacesRes.code === 0) {
      const items = spacesRes.data?.items || [];
      console.log(`✅ 成功获取空间列表，共 ${items.length} 个空间:`);
      for (const s of items) {
        console.log(`   - [${s.name}] (Space ID: ${s.space_id})`);
      }
    } else {
      console.log(`⚠️ 获取空间列表返回 code: ${spacesRes.code}, msg: ${spacesRes.msg}`);
    }
  } catch (err) {
    console.log(`❌ 获取知识空间异常:`, err?.message || err);
  }

  // 2. 测试知识库节点搜索
  try {
    console.log(`\n2. 正在搜索知识库节点 (wiki.v1.node.search)...`);
    const searchRes = await client.wiki.v1.node.search({
      data: { query },
      params: { page_size: 5 },
    });
    if (searchRes.code === 0) {
      const items = searchRes.data?.items || [];
      console.log(`✅ 成功检索到 ${items.length} 篇知识库文档:`);
      for (const doc of items) {
        console.log(`   - ${doc.title} (wikiToken: ${doc.node_id}, objType: ${doc.obj_type})`);
        console.log(`     链接: ${doc.url || `https://open.feishu.cn/wiki/${doc.node_id}`}`);
      }
    } else {
      console.log(`⚠️ 知识库检索返回 code: ${searchRes.code}, msg: ${searchRes.msg}`);
    }
  } catch (err) {
    console.log(`❌ 知识库检索异常:`, err?.message || err);
  }
}

main();
