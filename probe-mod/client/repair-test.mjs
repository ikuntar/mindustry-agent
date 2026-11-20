import net from "node:net";

const socket = net.createConnection({ host: "127.0.0.1", port: Number(process.env.PROBE_PORT ?? 46500) });
let buffer = "";
const pending = new Map();
let nextId = 1;
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
    const timer = setTimeout(() => reject(new Error(`timeout ${op}`)), timeoutMs);
    pending.set(id, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
    socket.write(JSON.stringify({ id, op, ...args }) + "\n");
  });
}
function ok(response, what) {
  if (!response.ok) throw new Error(`${what}: ${JSON.stringify(response.error)}`);
  return response.data;
}
async function waitOp(opId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = ok(await call("get_action_result", { opId }), "get_action_result");
    if (result.status !== "running") return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("error", reject);
});
const context = ok(await call("get_context"), "get_context");
const core = context.cores?.[0];
if (!core) throw new Error("no core");
ok(await call("move_to", { x: core.x + 24, y: core.y, arriveRadius: 8 }), "move_to");
await new Promise((resolve) => setTimeout(resolve, 800));

const baseX = Math.floor(core.x / 8);
const baseY = Math.floor(core.y / 8);
let built = null;
for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [5, 0], [-5, 0], [0, 5], [0, -5]]) {
  const response = await call("build", { block: "conveyor", x: baseX + dx, y: baseY + dy });
  if (response.ok) {
    built = response.data.data;
    break;
  }
}
if (!built) throw new Error("no valid build tile");
await new Promise((resolve) => setTimeout(resolve, 600));
console.log("built:", ok(await call("get_tile", { x: built.x, y: built.y }), "get_tile"));

const damage = ok(
  await call("damage_building", { x: built.x, y: built.y, amount: 20 }),
  "damage_building",
);
console.log("damaged:", damage);

const repair = ok(await call("repair", { x: built.x, y: built.y }), "repair");
console.log("repair:", repair);
console.log("repair result:", await waitOp(repair.opId));
console.log("repaired:", ok(await call("get_tile", { x: built.x, y: built.y }), "get_tile"));
socket.end();
