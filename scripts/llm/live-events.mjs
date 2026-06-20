// scripts/llm/live-events.mjs
// JSONL 事件总线:
//   - 内存订阅(TUI 渲染器、后续 web shell 都是订阅者)
//   - 可选落盘(LLM_LIVE_EVENTS=path 时,以 JSONL append 写,断点重连/调试用)
//
// 事件类型:
//   refine.start   { topicRef, worker, attempt, model }
//   refine.done    { topicRef, worker, ok, durationMs, scoreBefore, scoreAfter, reason }
//   llm.request    { reqId, worker, topicRef, kind, spec }
//   llm.token      { reqId, tokens, lastLine }
//   llm.done       { reqId, ok, durationMs, model, usage }
//   llm.retry      { reqId, attempt, reason, spec, nextSpec? }
//   llm.pause      { reason, spec, error }
//   llm.resume     { source, pausedFor }
//   judge.batch    { batchIdx, count, model }
//   audit.summary  { round, total, failing, avgScore }
//   user.input     { kind, payload }   // 用户手动操作:resume/skip/policy
//
// v3.3 新增事件类型:
//   llm.pool.wait      { spec, kind, waitedMs, limits, accountId }    — 队列等待超 250ms
//   llm.pool.start     { spec, kind, limits, accountId }              — 拿到 slot 开始调用
//   llm.pool.done      { spec, kind, durationMs, accountId, ok, error }
//   llm.pool.unhealthy { spec, kind, until }                          — 模型连续失败被隔离
//   mcp.unhealthy      { server, until }                              — MCP server 故障隔离
//   diagram.candidates { ref, cardTitle, count, ok, stuck }           — 图候选选优进度
//   diagram.selected   { ref, cardTitle, format, score, keptOld }     — 图候选落盘
//   factcheck.start    { ref, backend }                               — 联网搜索开始
//   factcheck.done     { ref, backend, ok, findings, sources }        — 联网搜索完成
//   cost.tick          { totalUsd, tokens, budgetPct }                — 成本快照
//   judge.disagreement { ref, dims }                                  — 判官分歧度告警
//
// 任何模块都可以 emit;TUI 是消费者。

import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { envConfig } from "./env-config.mjs";

class LiveEvents extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this._fileSink = null;
    this._tickSeq = 0;
  }

  configureFileSink(filePath) {
    if (!filePath) {
      this._fileSink = null;
      return;
    }
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this._fileSink = filePath;
  }

  emitEvent(type, payload = {}) {
    const evt = {
      type,
      ts: Date.now(),
      seq: ++this._tickSeq,
      ...payload,
    };
    this.emit("event", evt);
    this.emit(type, evt);
    if (this._fileSink) {
      try {
        appendFileSync(this._fileSink, JSON.stringify(evt) + "\n");
      } catch {
        // 忽略落盘失败,不影响主流程
      }
    }
    return evt;
  }
}

export const liveEvents = new LiveEvents();

// 一上来读 env 自动配置 sink
const sinkPath = envConfig.getEnv("LLM_LIVE_EVENTS");
if (sinkPath) liveEvents.configureFileSink(sinkPath);

let _reqSeq = 0;
export function newReqId() {
  return `r${(++_reqSeq).toString(36).padStart(4, "0")}`;
}
