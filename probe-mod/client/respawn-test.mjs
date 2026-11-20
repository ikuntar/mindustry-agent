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
await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("error", reject);
});

const before = ok(await call("get_context"), "get_context");
console.log("before:", before.assistant);
console.log("kill:", ok(await call("kill_assistant"), "kill_assistant"));
await new Promise((resolve) => setTimeout(resolve, 400));
const dead = ok(await call("get_context"), "get_context");
console.log("dead:", dead.assistant);
console.log("respawn:", ok(await call("respawn"), "respawn"));
const after = ok(await call("get_context"), "get_context");
console.log("after:", after.assistant);
socket.end();
