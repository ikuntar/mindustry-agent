import net from "node:net";
import readline from "node:readline";

const socket = net.createConnection({ host: "127.0.0.1", port: 46500 });
const rl = readline.createInterface({ input: socket });
const pending = new Map();
let nextId = 1;

rl.on("line", (line) => {
  let response;
  try {
    response = JSON.parse(line);
  } catch {
    console.error("bad line", line);
    return;
  }
  const waiter = pending.get(response.id);
  if (waiter) {
    pending.delete(response.id);
    waiter(response);
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
    socket.write(JSON.stringify({ id, op, ...args }) + "\n");
  });
}

function requireOk(response, what) {
  if (!response.ok) throw new Error(`${what}: ${JSON.stringify(response.error)}`);
  return response.data;
}

async function waitOp(opId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = requireOk(await call("get_action_result", { opId }), "get_action_result");
    if (last.status === "done" || last.status === "failed" || last.status === "cancelled") return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return last;
}

async function main() {
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const context = requireOk(await call("get_context"), "get_context");
  console.log("context:", JSON.stringify(context, null, 2));

  const core = context.cores[0];
  const move = requireOk(await call("move_to", { x: core.x + 24, y: core.y, arriveRadius: 8 }), "move_to");
  console.log("move:", move);
  console.log("move result:", await waitOp(move.opId, 4000));

  const afterMove = requireOk(await call("get_context"), "get_context");
  console.log("assistant after move:", afterMove.assistant);

  const baseX = Math.floor(core.x / 8);
  const baseY = Math.floor(core.y / 8);
  const worldWidth = context.worldWidth ?? 0;
  const worldHeight = context.worldHeight ?? 0;
  const offsets = [4, 5, 6, 7, 8, -4, -5, -6, -7, -8];
  let built = null;
  for (const offset of offsets) {
    const tx = baseX + offset;
    if (tx < 0 || tx >= worldWidth) continue;
    const ty = baseY;
    if (ty < 0 || ty >= worldHeight) continue;
    const response = await call("build", { block: "conveyor", x: tx, y: ty });
    if (response.ok) {
      built = response.data;
      console.log(`build at ${tx},${ty}:`, built);
      break;
    } else if (response.error?.code !== "invalid_placement") {
      console.log(`build at ${tx},${ty} failed:`, response.error);
    }
  }
  if (!built) throw new Error("no valid build tile found");
  const builtData = built.data;
  console.log("built data:", builtData);

  if (builtData && builtData.x >= 0 && builtData.x < worldWidth && builtData.y >= 0 && builtData.y < worldHeight) {
    const tileNow = requireOk(await call("get_tile", { x: builtData.x, y: builtData.y }), "get_tile");
    console.log("tile right after build:", tileNow);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const tileLater = requireOk(await call("get_tile", { x: builtData.x, y: builtData.y }), "get_tile");
    console.log("tile after 2s:", tileLater);
  } else {
    console.log(`skip get_tile: outside ${worldWidth}x${worldHeight}`);
  }

  const finalContext = requireOk(await call("get_context"), "get_context");
  console.log("final context:", JSON.stringify(finalContext, null, 2));
  socket.end();
}

main().catch((error) => {
  console.error(error);
  socket.destroy();
  process.exitCode = 1;
});
