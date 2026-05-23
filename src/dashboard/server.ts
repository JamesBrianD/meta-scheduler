import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { SupervisorState } from "../supervisor/types.ts";
import { renderDetail } from "./views/detail.ts";
import { renderList } from "./views/list.ts";
import { dropTask, InboxError } from "./inbox.ts";
import { tailSession } from "./sse.ts";

interface ServerOpts {
  host: string;
  port: number;
  getState: () => SupervisorState;
}

const FORM_LIMIT = 256 * 1024;

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(new InboxError("Request body too large.", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function html(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function text(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function notFound(res: ServerResponse) {
  text(res, 404, "404 not found");
}

function findAgent(state: SupervisorState, name: string) {
  return state.agents.find((a) => a.name === name);
}

export function startServer(opts: ServerOpts) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";
    const state = opts.getState();

    try {
      if (method === "GET" && url.pathname === "/") {
        return html(res, 200, renderList(state));
      }
      if (method === "GET" && url.pathname === "/api/state") {
        return json(res, 200, state);
      }
      if (method === "GET" && url.pathname === "/healthz") {
        const age = state.lastProbeAt ? Date.now() - state.lastProbeAt : null;
        const healthy = age != null && age < 60_000;
        return json(res, healthy ? 200 : 503, {
          ok: healthy,
          startedAt: state.startedAt,
          lastProbeAt: state.lastProbeAt,
          probeAgeMs: age,
          agents: state.agents.length,
        });
      }

      const agentMatch = /^\/agent\/([^/]+)(\/(tail|inbox))?$/.exec(url.pathname);
      if (agentMatch) {
        const name = decodeURIComponent(agentMatch[1]);
        const sub = agentMatch[3];
        const agent = findAgent(state, name);
        if (!agent) return notFound(res);

        if (method === "GET" && !sub) {
          return html(res, 200, renderDetail(state, agent));
        }
        if (method === "GET" && sub === "tail") {
          if (!agent.sessionFile) return text(res, 409, "no session file yet");
          const ac = new AbortController();
          req.on("close", () => ac.abort());
          await tailSession(agent.sessionFile, res, ac.signal);
          return;
        }
        if (method === "POST" && sub === "inbox") {
          const buf = await readBody(req, FORM_LIMIT);
          const params = new URLSearchParams(buf.toString("utf8"));
          const filename = params.get("filename") ?? "";
          const content = params.get("content") ?? "";
          const { path } = await dropTask(agent.home, filename, content);
          res.writeHead(303, { Location: `/agent/${encodeURIComponent(name)}?dropped=${encodeURIComponent(path)}` });
          res.end();
          return;
        }
        return notFound(res);
      }

      notFound(res);
    } catch (err) {
      const status = err instanceof InboxError ? err.status : 500;
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) text(res, status, msg);
      else res.end();
      if (status >= 500) console.error("[dashboard]", err);
    }
  });

  server.listen(opts.port, opts.host, () => {
    console.log(`[dashboard] http://${opts.host}:${opts.port}`);
  });
  return server;
}
