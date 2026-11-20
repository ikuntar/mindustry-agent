import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const discoveryPath = process.env.PROBE_DISCOVERY ?? path.join(os.tmpdir(), "mindustry-ai-probe", "bridge-info.json");
let token;
try {
  token = JSON.parse(fs.readFileSync(discoveryPath, "utf8")).token;
} catch {
  token = undefined;
}

const socket = net.createConnection({ host: "127.0.0.1", port: Number(process.env.PROBE_PORT ?? 46500) });
const pending = new Map();
let nextId = 1;
let buffer = "";

socket.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    const response = JSON.parse(line);
    const waiter = pending.get(response.id);
    if (waiter) {
      pending.delete(response.id);
      waiter(response);
    }
  }
});

function call(op, args = {}, timeoutMs = 5000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${op}`));
    }, timeoutMs);
    pending.set(id, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
    socket.write(JSON.stringify({ id, op, ...args, ...(token ? { token } : {}) }) + "\n");
  });
}

function requireOk(response, what) {
  if (!response.ok) throw new Error(`${what}: ${JSON.stringify(response.error)}`);
  return response.data;
}

async function main() {
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const context = requireOk(await call("get_context"), "get_context");
  const core = context.cores?.[0];
  if (!core) throw new Error("no core");

  for (const item of ["copper", "lead", "silicon", "graphite", "titanium", "metaglass"]) {
    requireOk(await call("give", { item, amount: 200 }), `give ${item}`);
  }
  const ally = requireOk(
    await call("spawn_ally", { type: "dagger", x: core.x + 80, y: core.y }),
    "spawn_ally",
  );
  const enemy = requireOk(
    await call("spawn_enemy", { type: "dagger", x: core.x + 350, y: core.y }),
    "spawn_enemy",
  );

  let enemyBuilding = null;
  const coreTileX = Math.floor(core.x / 8);
  const coreTileY = Math.floor(core.y / 8);
  let secondCore = null;
  const coreOffsets = [];
  for (const radius of [5, 6, 7, 8, 10, 12, 16]) {
    coreOffsets.push([radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius, radius], [-radius, -radius]);
  }
  for (const [dx, dy] of coreOffsets) {
    const response = await call("spawn_ally_core", {
      block: "core-shard",
      x: coreTileX + dx,
      y: coreTileY + dy,
    });
    if (response.ok) {
      secondCore = response.data;
      break;
    }
  }
  for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6], [7, 0], [-7, 0]]) {
    const response = await call("spawn_enemy_building", {
      block: "container",
      x: coreTileX + dx,
      y: coreTileY + dy,
    });
    if (response.ok) {
      enemyBuilding = response.data;
      break;
    }
  }

  let ore = null;
  const baseX = Math.floor(core.x / 8);
  const baseY = Math.floor(core.y / 8);
  for (let radius = 2; radius <= 4 && !ore; radius++) {
    for (let dx = -radius; dx <= radius && !ore; dx++) {
      for (let dy = -radius; dy <= radius && !ore; dy++) {
        const tile = requireOk(await call("get_tile", { x: baseX + dx, y: baseY + dy }), "get_tile");
        if (tile.drop) ore = { x: baseX + dx, y: baseY + dy, item: tile.drop };
      }
    }
  }
  console.log(JSON.stringify({ core, ally, enemy, enemyBuilding, secondCore, ore }));
  socket.end();
}

main().catch((error) => {
  console.error(error);
  socket.destroy();
  process.exitCode = 1;
});
