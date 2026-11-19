import net from "node:net";

const x = Number(process.argv[2] ?? 0);
const y = Number(process.argv[3] ?? 0);
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
function call(op, args = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${op}`)), 5000);
    pending.set(id, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
    socket.write(JSON.stringify({ id, op, ...args }) + "\n");
  });
}
await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("error", reject);
});
console.log("tile:", JSON.stringify(await call("get_tile", { x, y })));
console.log("area:", JSON.stringify(await call("query_area", { x: x * 8 + 4, y: y * 8 + 4, radius: 16, includeBuildings: true })));
socket.end();
