import test from "node:test";
import assert from "node:assert/strict";
import { createCollectorApp } from "../src/app.js";
import { TelemetryStorage } from "../src/storage.js";

test("Collector App - Health endpoint returns 200", async () => {
  const storage = new TelemetryStorage();
  const app = createCollectorApp(storage);

  const res = await app.request("/health");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
});

test("Collector App - Ingest telemetry event and calculate stats", async () => {
  const storage = new TelemetryStorage();
  const app = createCollectorApp(storage);

  const payload = {
    eventId: "test-evt-1",
    timestamp: new Date().toISOString(),
    durationMs: 120,
    toolName: "feishu_search_wiki",
    success: true,
    environment: {
      clientType: "cursor",
      projectName: "ninebot-frontend",
      platform: "darwin",
    },
    query: "规范文档",
    hasIndexed: true,
    resultCount: 2,
    resultsSummary: [
      {
        title: "⭐ [团队索引推荐] 前端工程规范",
        url: "https://ninebot.feishu.cn/wiki/test",
      },
    ],
  };

  const reportRes = await app.request("/api/v1/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  assert.equal(reportRes.status, 200);
  const reportData = await reportRes.json();
  assert.equal(reportData.success, true);
  assert.equal(reportData.receivedCount, 1);

  // 验证 stats
  const statsRes = await app.request("/api/v1/stats");
  assert.equal(statsRes.status, 200);
  const statsData = await statsRes.json();

  assert.equal(statsData.stats.totalEvents, 1);
  assert.equal(statsData.stats.searchEvents, 1);
  assert.equal(statsData.stats.indexedHits, 1);
  assert.equal(statsData.stats.indexHitRate, "100.0%");
  assert.equal(statsData.stats.topQueries[0].query, "规范文档");
  assert.equal(statsData.stats.topProjects[0].project, "ninebot-frontend");
});

test("Collector App - Handles invalid payload gracefully", async () => {
  const storage = new TelemetryStorage();
  const app = createCollectorApp(storage);

  const badRes = await app.request("/api/v1/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invalidField: 123 }),
  });

  assert.equal(badRes.status, 400);
});
