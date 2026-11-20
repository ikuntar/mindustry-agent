import assert from "node:assert/strict";
import net, { type AddressInfo, type Socket } from "node:net";
import test from "node:test";

import { ProbeGameAdapter } from "../src/adapters/ProbeGameAdapter.js";

interface FakeProbe {
  port: number;
  close: () => Promise<void>;
}

function contextPayload(map: string): Record<string, unknown> {
  return {
    tick: 1,
    timeMs: 1,
    map,
    worldWidth: 100,
    worldHeight: 100,
    wave: 1,
    enemies: 0,
    team: 1,
    teamName: "sharded",
    paused: false,
    gameOver: false,
    assistant: {
      id: 1,
      type: "alpha",
      team: 1,
      x: 15,
      y: 15,
      health: 150,
      maxHealth: 150,
      dead: false,
      isAI: false,
      isHome: true,
      possessing: false,
    },
    resources: {},
    cores: [],
    units: [],
    unitCount: 1,
    eventsSince: 0,
    eventsPending: 0,
    eventSummary: { total: 0, byType: {} },
  };
}

async function startFakeProbe(port: number | 0, map: string): Promise<FakeProbe> {
  const sockets = new Set<Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const request = JSON.parse(line);
        let data: Record<string, unknown>;
        if (request.op === "hello") {
          data = { protocol: 1, version: "0.1.0", requireAuth: false };
        } else if (request.op === "ping") {
          data = { pong: true, protocol: 1, version: "0.1.0", tick: 1 };
        } else if (request.op === "get_context") {
          data = contextPayload(map);
        } else {
          socket.write(
            JSON.stringify({
              id: request.id,
              ok: false,
              error: { code: "unsupported", message: String(request.op) },
            }) + "\n",
          );
          continue;
        }
        socket.write(JSON.stringify({ id: request.id, ok: true, data }) + "\n");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("probe adapter reconnects after the probe server restarts", async () => {
  const first = await startFakeProbe(0, "first");
  const adapter = new ProbeGameAdapter({
    host: "127.0.0.1",
    port: first.port,
    heartbeatMs: 0,
    timeoutMs: 1000,
  });
  try {
    const before = await adapter.getContext({ detail: "summary" });
    assert.equal(before.map, "first");

    await first.close();
    await delay(100);

    let second: FakeProbe | undefined;
    for (let attempt = 0; attempt < 5 && !second; attempt++) {
      try {
        second = await startFakeProbe(first.port, "second");
      } catch {
        await delay(100);
      }
    }
    assert.ok(second, "could not restart fake probe on the same port");

    const after = await adapter.getContext({ detail: "summary" });
    assert.equal(after.map, "second");
    await second.close();
  } finally {
    await adapter.close();
    await first.close().catch(() => undefined);
  }
});
