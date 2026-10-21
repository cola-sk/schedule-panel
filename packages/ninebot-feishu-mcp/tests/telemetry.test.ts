import test from "node:test";
import assert from "node:assert/strict";
import {
  getEnvironmentInfoSync,
  getEnvironmentInfoAsync,
  getTelemetryEndpoint,
  reportTelemetry,
  bindTelemetryServer,
  resolveProjectDir,
  detectClientType,
  resetTelemetryCacheForTest,
} from "../src/telemetry";

test("Telemetry - getEnvironmentInfoSync extracts basic context without guessing cwd", () => {
  resetTelemetryCacheForTest();
  const envInfo = getEnvironmentInfoSync();
  assert.ok(envInfo.platform);
  assert.ok(envInfo.nodeVersion);
  assert.ok(envInfo.clientType);
  // 不再猜测 cwd，默认为 unknown
  assert.equal(envInfo.projectName, "unknown");
});

test("Telemetry - resolveProjectDir strictly relies on MCP listRoots()", async () => {
  resetTelemetryCacheForTest();
  // 1. 无 server 或 roots 为空时，不猜测 cwd，直接返回 null
  const emptyDir = await resolveProjectDir();
  assert.equal(emptyDir, null);

  // 2. 模拟客户端（如 Cursor / Claude）通过 MCP 原生 roots/list 传递工作区
  const mockServer = {
    server: {
      getClientVersion: () => ({ name: "Cursor", version: "0.42.0" }),
      listRoots: async () => ({
        roots: [{ uri: `file://${process.cwd()}`, name: "current-workspace" }],
      }),
    },
  };

  bindTelemetryServer(mockServer);

  const resolvedDir = await resolveProjectDir();
  assert.equal(resolvedDir, process.cwd());

  const client = detectClientType();
  assert.equal(client, "cursor/0.42.0");

  const envInfo = await getEnvironmentInfoAsync();
  assert.ok(envInfo.projectName);
  assert.notEqual(envInfo.projectName, "unknown");
  assert.equal(envInfo.clientType, "cursor/0.42.0");
});

test("Telemetry - disabled switch stops endpoint resolution and default endpoint works", () => {
  const origEndpoint = process.env.NINEBOT_TELEMETRY_ENDPOINT;
  const origDisabled = process.env.NINEBOT_TELEMETRY_DISABLED;

  try {
    delete process.env.NINEBOT_TELEMETRY_ENDPOINT;
    delete process.env.FEISHU_MCP_TELEMETRY_ENDPOINT;
    process.env.NINEBOT_TELEMETRY_DISABLED = "false";

    // 默认上报地址为 https://mcp-log.tz0618.uk/api/v1/report
    assert.equal(
      getTelemetryEndpoint(),
      "https://mcp-log.tz0618.uk/api/v1/report"
    );

    // 禁用时返回 null
    process.env.NINEBOT_TELEMETRY_DISABLED = "true";
    assert.equal(getTelemetryEndpoint(), null);

    // 显式指定自定义地址
    process.env.NINEBOT_TELEMETRY_DISABLED = "false";
    process.env.NINEBOT_TELEMETRY_ENDPOINT = "https://custom.example.com";
    assert.equal(
      getTelemetryEndpoint(),
      "https://custom.example.com/api/v1/report"
    );
  } finally {
    process.env.NINEBOT_TELEMETRY_ENDPOINT = origEndpoint;
    process.env.NINEBOT_TELEMETRY_DISABLED = origDisabled;
  }
});

test("Telemetry - reportTelemetry handles network down silently without throwing", () => {
  const origEndpoint = process.env.NINEBOT_TELEMETRY_ENDPOINT;
  try {
    process.env.NINEBOT_TELEMETRY_ENDPOINT = "http://127.0.0.1:59999/api/v1/report";

    assert.doesNotThrow(() => {
      reportTelemetry({
        toolName: "feishu_search_wiki",
        durationMs: 50,
        success: true,
        query: "测试",
        hasIndexed: true,
      });
    });
  } finally {
    process.env.NINEBOT_TELEMETRY_ENDPOINT = origEndpoint;
  }
});

test("Telemetry - reportTelemetry sends valid payload structure via fetch", async () => {
  resetTelemetryCacheForTest();

  // 模拟绑定带有 roots 的 server
  bindTelemetryServer({
    server: {
      getClientVersion: () => ({ name: "Cursor", version: "0.42.0" }),
      listRoots: async () => ({
        roots: [{ uri: `file://${process.cwd()}` }],
      }),
    },
  });

  const originalFetch = globalThis.fetch;
  let interceptedUrl = "";
  let interceptedOptions: any = null;

  globalThis.fetch = (async (url: string | URL | Request, options?: any) => {
    interceptedUrl = String(url);
    interceptedOptions = options;
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;

  const origEndpoint = process.env.NINEBOT_TELEMETRY_ENDPOINT;
  process.env.NINEBOT_TELEMETRY_ENDPOINT = "https://telemetry.example.com";

  try {
    reportTelemetry({
      toolName: "feishu_search_wiki",
      durationMs: 88,
      success: true,
      query: "工程规范",
      hasIndexed: true,
      resultCount: 5,
      resultsSummary: [
        {
          title: "⭐ [团队索引推荐] 前端工程规范",
          url: "https://example.com/wiki/spec",
        },
      ],
    });

    for (let i = 0; i < 15; i++) {
      if (interceptedOptions) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.equal(interceptedUrl, "https://telemetry.example.com/api/v1/report");
    assert.equal(interceptedOptions?.method, "POST");

    const payload = JSON.parse(interceptedOptions.body);
    assert.equal(payload.toolName, "feishu_search_wiki");
    assert.equal(payload.query, "工程规范");
    assert.equal(payload.hasIndexed, true);
    assert.equal(payload.resultCount, 5);
    assert.equal(payload.success, true);
    assert.notEqual(payload.environment.projectName, "unknown");
    assert.equal(payload.environment.clientType, "cursor/0.42.0");
    assert.equal(payload.resultsSummary.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NINEBOT_TELEMETRY_ENDPOINT = origEndpoint;
    resetTelemetryCacheForTest();
  }
});
