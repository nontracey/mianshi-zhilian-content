// Minimal MCP stdio client for optional quality backends.
// It implements the JSON-RPC pieces the refiner needs: initialize,
// tools/list and tools/call. Servers are configured through env JSON; the
// repository does not depend on any specific MCP package.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class McpStdioClient {
  constructor(config) {
    this.name = config.name;
    this.command = config.command;
    this.args = config.args ?? [];
    this.cwd = config.cwd;
    this.env = config.env ?? {};
    this.timeoutMs = Number(config.timeoutMs ?? 120000);
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.started = false;
    this.toolsCache = null;
  }

  async start() {
    if (this.started) return;
    if (!this.command) throw new Error(`[mcp:${this.name}] command is required`);
    this.proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.on("exit", (code, signal) => {
      const error = new Error(`[mcp:${this.name}] exited code=${code} signal=${signal || ""}`);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      this.started = false;
    });
    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this.#handleLine(line));
    this.proc.stderr?.on("data", () => {});
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mianshi-zhilian-content-refiner", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
    this.started = true;
  }

  #handleLine(line) {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.id == null) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(`[mcp:${this.name}] ${msg.error.message || JSON.stringify(msg.error)}`));
    else pending.resolve(msg.result);
  }

  notify(method, params = {}) {
    this.proc?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
    return withTimeout(promise, this.timeoutMs, `[mcp:${this.name}] ${method}`);
  }

  async listTools() {
    await this.start();
    if (!this.toolsCache) {
      const result = await this.request("tools/list", {});
      this.toolsCache = Array.isArray(result?.tools) ? result.tools : [];
    }
    return this.toolsCache;
  }

  async callTool(name, args = {}) {
    await this.start();
    return await this.request("tools/call", { name, arguments: args });
  }

  stop() {
    try { this.proc?.kill("SIGTERM"); } catch {}
    this.proc = null;
    this.started = false;
  }
}
