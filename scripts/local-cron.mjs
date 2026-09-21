/**
 * 本地定时派发服务。
 *
 * 与 Vercel Cron 调用同一个 HTTP 接口，避免本地和线上维护两套派发逻辑。
 * 使用方式：先启动 Next，再执行 `npm run cron:local`。
 */
import { createServer } from "node:http";

const endpoint = process.env.LOCAL_CRON_URL || "http://localhost:9595/api/cron/dispatch";
const port = Number(process.env.LOCAL_CRON_PORT || 9596);
const intervalMinutes = Number(process.env.LOCAL_CRON_INTERVAL_MINUTES || 5);
const intervalMs = Math.max(1, intervalMinutes) * 60_000;
const secret = process.env.CRON_SECRET;
let running = false;
let timer;

const healthServer = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, service: "local-cron" }));
    return;
  }
  response.writeHead(404);
  response.end();
});
healthServer.on("error", (error) => {
  console.error(`[local-cron] 无法监听端口 ${port}:`, error);
  process.exitCode = 1;
});
healthServer.listen(port, "127.0.0.1");

async function dispatch() {
  if (running) return;
  running = true;
  try {
    const response = await fetch(endpoint, {
      headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (!response.ok) {
      console.error(`[local-cron] ${new Date().toISOString()} 请求失败 (${response.status}): ${body}`);
    } else {
      console.log(`[local-cron] ${new Date().toISOString()} 派发结果: ${body}`);
    }
  } catch (error) {
    console.error(`[local-cron] ${new Date().toISOString()} 无法连接 ${endpoint}:`, error);
  } finally {
    running = false;
  }
}

function scheduleNext() {
  const delay = intervalMs - (Date.now() % intervalMs);
  timer = setTimeout(async () => {
    await dispatch();
    scheduleNext();
  }, delay);
}

function stop() {
  if (timer) clearTimeout(timer);
  healthServer.close();
  console.log("[local-cron] 已停止");
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(`[local-cron] 已启动，监听 127.0.0.1:${port}，每 ${intervalMinutes} 分钟检查 ${endpoint}`);
await dispatch();
scheduleNext();
