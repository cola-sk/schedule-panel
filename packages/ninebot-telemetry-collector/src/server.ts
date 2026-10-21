import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT) || 9696;
const host = process.env.HOST || "0.0.0.0";

console.log(`[Telemetry Collector] Starting server on http://${host}:${port} ...`);

serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(`[Telemetry Collector] Running at http://${info.address}:${info.port}`);
    console.log(`[Telemetry Collector] Health: http://${info.address}:${info.port}/health`);
    console.log(`[Telemetry Collector] Ingest: http://${info.address}:${info.port}/api/v1/report`);
  }
);
