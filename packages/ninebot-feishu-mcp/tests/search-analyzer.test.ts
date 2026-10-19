import assert from "node:assert/strict";
import test from "node:test";
import MiniSearch from "minisearch";
import { createSearchAnalyzer } from "../src/search-analyzer";

const analyzer = createSearchAnalyzer({
  lexicon: [
    { canonical: "typescript规范", aliases: ["typescript", "ts"] },
    { canonical: "组件库升级指南", aliases: ["组件库", "ui库"] },
    { canonical: "微前端路由规范", aliases: ["qiankun", "微前端", "路由"] },
    { canonical: "cicd发布指南", aliases: ["ci/cd", "cicd"] },
  ],
});

test("Trie keeps team technical entities intact instead of generating overlapping single-character joins", () => {
  const analysis = analyzer.analyzeQuery("组件库升级");

  assert.ok(analysis.coreTerms.includes("组件库升级指南"));
  assert.ok(analysis.exactPhrases.includes("组件库升级"));
  assert.ok(!analysis.terms.includes("件库"));
});

test("hard aliases normalize abbreviations to the same indexed entity", () => {
  assert.ok(analyzer.tokenize("TypeScript CI/CD").includes("typescript规范"));
  assert.ok(analyzer.tokenize("TypeScript CI/CD").includes("cicd发布指南"));

  const analysis = analyzer.analyzeQuery("ts 规范");
  assert.deepEqual(analysis.coreTerms, ["typescript规范"]);
});

test("query analysis removes conversational words but retains the technical intent", () => {
  const analysis = analyzer.analyzeQuery("如何给子应用接入 qiankun，路由怎么配置");

  assert.ok(analysis.coreTerms.includes("微前端路由规范"));
  assert.ok(!analysis.terms.includes("如何"));
  assert.ok(!analysis.terms.includes("配置"));
});

test("ASCII aliases do not match inside an unrelated longer token", () => {
  assert.ok(!analyzer.tokenize("nodejs").includes("javascript"));
});

test("MiniSearch retrieves an abbreviated technical term through the shared tokenizer", () => {
  const index = new MiniSearch<{ id: string; title: string }>({
    fields: ["title"],
    tokenize: analyzer.tokenize,
  });
  index.add({ id: "typescript-guide", title: "TS 工程规范" });

  assert.equal(index.search("typescript")[0]?.id, "typescript-guide");
});

test("default CJK segmentation preserves single-char morpheme compounds and avoids ICU false splits", () => {
  const defaultAnalyzer = createSearchAnalyzer();

  const microFrontend = defaultAnalyzer.analyzeQuery("微前端");
  assert.deepEqual(microFrontend.coreTerms, ["微前端"]);
  assert.equal(microFrontend.isOverviewQuery, false);

  const subApp = defaultAnalyzer.analyzeQuery("微前端子应用");
  assert.ok(subApp.coreTerms.includes("微前端"));
  assert.ok(subApp.coreTerms.includes("子应用"));
  assert.ok(!subApp.terms.includes("端子"));

  const docTokens = defaultAnalyzer.tokenize("前端埋点上报与动态路由规范");
  assert.ok(docTokens.includes("埋点"));
  assert.ok(docTokens.includes("路由"));
});

test("partial Trie match slices phrase so unmatched suffix is still segmented", () => {
  const analysis = analyzer.analyzeQuery("组件库图标");

  assert.ok(analysis.coreTerms.includes("组件库升级指南"));
  assert.ok(analysis.coreTerms.includes("图标"));
});

test("document tokenization retains prefix Trie canonicals when a longer title also matches", () => {
  const multiEntryAnalyzer = createSearchAnalyzer({
    lexicon: [
      { canonical: "微前端接入规范", aliases: ["微前端接入规范", "微前端", "qiankun"] },
      { canonical: "微前端路由指南", aliases: ["微前端路由指南", "子应用路由"] },
    ],
  });

  const tokens = multiEntryAnalyzer.tokenize("微前端路由指南");
  assert.ok(tokens.includes("微前端路由指南"));
  assert.ok(tokens.includes("微前端接入规范"));
});

