// エレベータ操作画面のサーバー: 静的ファイル配信 + 状態の SSE 配信 + 指令・乗客の書き込み API
// 依存ライブラリなし（Node 標準の http のみ）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModbusTcpClient } from "./modbus.ts";
import { elevatorConfig as cfg, HR, IR } from "./config.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const READ_COUNT = IR.heartbeat + 1;
const ACK_TIMEOUT_MS = 2000;

const client = new ModbusTcpClient(cfg.host, cfg.port, cfg.unitId);
const clients = new Set<http.ServerResponse>();
let snapshot: Record<string, unknown> = { connected: false, error: null };
let seq = -1; // 指令の通し番号。接続後に PLC 側の値から始める

const signed = (v: number) => (v >= 0x8000 ? v - 0x10000 : v);

// 定期読み出しと指令が同時に接続しにいっても、接続は1本だけにする
let connecting: Promise<void> | null = null;
function ensureConnected(): Promise<void> {
  if (connecting) return connecting;
  if (client.connected) return Promise.resolve();
  connecting = (async () => {
    try {
      await client.connect();
      const [current] = await client.readHoldingRegisters(HR.cmdSeq, 1);
      seq = current; // 前回の続きから番号を振る（同じ番号を送ると無視されるため）
    } catch (e) {
      client.close();
      throw e;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

async function poll() {
  try {
    await ensureConnected();
    const r = await client.readInputRegisters(0, READ_COUNT);
    const flags = r[IR.flags];
    snapshot = {
      connected: true,
      error: null,
      state: r[IR.state],
      position: signed(r[IR.position]) / 100,
      floor: r[IR.floor],
      direction: r[IR.direction],
      doorPct: r[IR.doorPct],
      carCalls: r[IR.carCalls],
      hallCalls: r[IR.hallCalls],
      persons: r[IR.persons],
      loadKg: r[IR.loadKg],
      overload: (flags & 1) !== 0,
      buzzer: (flags & 2) !== 0,
      moving: (flags & 16) !== 0,
      ackSeq: r[IR.ackSeq],
      maxLoadKg: r[IR.maxLoadKg],
      maxPersons: r[IR.maxPersons],
      floorCount: r[IR.floorCount],
      heartbeat: r[IR.heartbeat],
    };
  } catch (e) {
    client.close();
    snapshot = { ...snapshot, connected: false, error: (e as Error).message };
  }
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const res of clients) res.write(payload);
}
setInterval(poll, cfg.intervalMs);

// 指令は1つずつ送り、PLC が受け付けた（IR の ackSeq が一致した）のを確かめてから次へ進む。
// 連打しても、PLC の1サイクルの間に指令が上書きされて消えないようにするため
let queue: Promise<void> = Promise.resolve();
function sendCommand(code: number, floor: number): Promise<void> {
  const job = queue.then(async () => {
    await ensureConnected();
    seq = (seq + 1) & 0xffff;
    await client.writeMultipleRegisters(HR.cmdCode, [code, floor, seq]);
    const start = Date.now();
    while (Date.now() - start < ACK_TIMEOUT_MS) {
      const [ack] = await client.readInputRegisters(IR.ackSeq, 1);
      if (ack === seq) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("PLC が指令を受け付けませんでした（タイムアウト）");
  });
  queue = job.catch(() => {});
  return job;
}

async function readBody(req: http.IncomingMessage) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname === "/api/command" && req.method === "POST") {
    try {
      const { code, floor } = await readBody(req);
      await sendCommand(Number(code) | 0, Number(floor ?? 0) | 0);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { ok: false, error: (e as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/passengers" && req.method === "POST") {
    try {
      const { persons, loadKg } = await readBody(req);
      const clamp = (v: unknown) => Math.min(9999, Math.max(0, Math.round(Number(v) || 0)));
      await ensureConnected();
      await client.writeMultipleRegisters(HR.persons, [clamp(persons), clamp(loadKg)]);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { ok: false, error: (e as Error).message });
    }
    return;
  }

  const filePath = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  });
});

server.listen(cfg.webPort, () => {
  console.log(`Elevator UI: http://localhost:${cfg.webPort}   (PLC: ${cfg.host}:${cfg.port})`);
});
