import { open, stat, watch } from "node:fs/promises";
import type { ServerResponse } from "node:http";

const TAIL_LINES = 80;
const MAX_LINE = 4096;

function sseSend(res: ServerResponse, data: string) {
  for (const line of data.split("\n")) {
    res.write(`data: ${line}\n`);
  }
  res.write("\n");
}

function ellipsize(line: string): string {
  if (line.length <= MAX_LINE) return line;
  return line.slice(0, MAX_LINE) + ` … [+${line.length - MAX_LINE}b]`;
}

async function readTailLines(file: string, fromOffset: number, lines: number): Promise<{ text: string; offset: number }> {
  const fh = await open(file, "r");
  try {
    const stats = await fh.stat();
    const start = Math.max(fromOffset, Math.max(0, stats.size - lines * 4096));
    const len = stats.size - start;
    if (len <= 0) return { text: "", offset: stats.size };
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    const all = buf.toString("utf8");
    const split = all.split("\n");
    const tail = split.slice(-lines - 1, -1);
    return { text: tail.join("\n"), offset: stats.size };
  } finally {
    await fh.close();
  }
}

async function readNew(file: string, fromOffset: number): Promise<{ text: string; offset: number }> {
  const stats = await stat(file).catch(() => null);
  if (!stats) return { text: "", offset: fromOffset };
  if (stats.size <= fromOffset) return { text: "", offset: fromOffset };
  const fh = await open(file, "r");
  try {
    const len = stats.size - fromOffset;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, fromOffset);
    return { text: buf.toString("utf8"), offset: stats.size };
  } finally {
    await fh.close();
  }
}

export async function tailSession(file: string, res: ServerResponse, signal: AbortSignal): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  let offset = 0;
  let pending = "";

  try {
    const initial = await readTailLines(file, 0, TAIL_LINES);
    offset = initial.offset;
    for (const line of initial.text.split("\n")) {
      if (line.length > 0) sseSend(res, ellipsize(line));
    }
  } catch (err) {
    sseSend(res, `[error reading initial tail: ${(err as Error).message}]`);
    res.end();
    return;
  }

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15_000);

  signal.addEventListener("abort", () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  });

  const flushNew = async () => {
    try {
      const next = await readNew(file, offset);
      if (next.text) {
        offset = next.offset;
        pending += next.text;
        const parts = pending.split("\n");
        pending = parts.pop() ?? "";
        for (const line of parts) {
          if (line.length > 0) sseSend(res, ellipsize(line));
        }
      }
    } catch {
      // file may have rotated; retry on next tick
    }
  };

  try {
    const watcher = watch(file, { signal });
    for await (const _ of watcher) {
      await flushNew();
      if (signal.aborted) break;
    }
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== "AbortError") {
      sseSend(res, `[watch ended: ${(err as Error).message}]`);
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}
