#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const discoveryPath =
  process.env.PROBE_DISCOVERY ?? path.join(os.tmpdir(), "mindustry-ai-probe", "bridge-info.json");
const discovery = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));

const socket = net.createConnection({ host: "127.0.0.1", port: Number(discovery.port) });
let buffer = "";
let nextId = 1;
const pending = new Map();

socket.on("data", (chunk) => {
  buffer += chunk.toString();
  for (;;) {
    const index = buffer.indexOf("\n");
    if (index < 0) break;
    const response = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    const entry = pending.get(response.id);
    if (!entry) continue;
    pending.delete(response.id);
    if (response.ok) entry.resolve(response.data);
    else entry.reject(Object.assign(new Error(response.error?.message ?? "probe error"), response.error ?? {}));
  }
});

function send(op, args = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${op}`));
    }, 5000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket.write(JSON.stringify({ id, op, ...args }) + "\n");
  });
}

async function main() {
  await send("set_require_writer", { enabled: true });
  const hello = await send("hello");
  if (!hello.requireWriter) throw new Error("writer enforcement is not enabled");

  const first = await send("claim_writer", { clientId: "client-a", ttlMs: 30000 });
  let held = false;
  try {
    await send("claim_writer", { clientId: "client-b", ttlMs: 30000 });
  } catch (error) {
    held = error.code === "writer_held";
  }

  const context = await send("get_context", { detail: "summary" });
  let missingToken = false;
  try {
    await send("move_to", { x: context.assistant.x + 16, y: context.assistant.y });
  } catch (error) {
    missingToken = error.code === "writer_required";
  }
  const allowed = await send("move_to", {
    x: context.assistant.x + 16,
    y: context.assistant.y,
    writerToken: first.writerToken,
  });
  await send("release_writer", { writerToken: first.writerToken });
  const second = await send("claim_writer", { clientId: "client-b", ttlMs: 30000 });
  await send("release_writer", { writerToken: second.writerToken });
  await send("claim_writer", { clientId: "client-expiring", ttlMs: 1000 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const afterExpiry = await send("claim_writer", { clientId: "client-after-expiry", ttlMs: 30000 });
  await send("release_writer", { writerToken: afterExpiry.writerToken });

  const result = {
    held,
    missingToken,
    allowed: allowed.status === "running" || allowed.status === "done",
    secondClaim: !!second.writerToken,
    expiryReleasesLease: !!afterExpiry.writerToken,
  };
  console.log(JSON.stringify(result));
  if (!Object.values(result).every(Boolean)) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => socket.destroy());
