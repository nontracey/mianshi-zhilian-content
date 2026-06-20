// scripts/llm/health-server.mjs
// 健康检查 HTTP 端点：长跑监控用。
// GET / → { state, cost, progress, autoscale, mcpHealth }
// POST /pause / POST /resume 远程控制

import { createServer } from "node:http";
import { envConfig } from "./env-config.mjs";

export function startHealthServer({ port = 9876, getState, pause, resume } = {}) {
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method === "POST" && req.url === "/pause") {
      try { await pause?.(); res.end(JSON.stringify({ ok: true, action: "paused" })); }
      catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: e.message })); }
      return;
    }
    if (req.method === "POST" && req.url === "/resume") {
      try { await resume?.(); res.end(JSON.stringify({ ok: true, action: "resumed" })); }
      catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: e.message })); }
      return;
    }

    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      try {
        const state = await getState?.();
        res.end(JSON.stringify({ ok: true, ...state }, null, 2));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  server.listen(port, "127.0.0.1");
  return server;
}
