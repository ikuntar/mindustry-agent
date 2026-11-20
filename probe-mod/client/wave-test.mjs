import net from "node:net";
import readline from "node:readline";

const socket = net.createConnection({ host: "127.0.0.1", port: Number(process.env.PROBE_PORT ?? 46500) });
const rl = readline.createInterface({ input: socket });
const pending = new Map();
let nextId = 1;

rl.on("line", (line) => {
  const response = JSON.parse(line);
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

async function main() {
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const before = await call("get_context");
  console.log("before:", JSON.stringify(before.data));
  console.log("start_wave:", JSON.stringify(await call("start_wave")));
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const context = await call("get_context", { detail: "summary" });
    console.log(`after ${i}:`, JSON.stringify({
      tick: context.data?.tick,
      wave: context.data?.wave,
      enemies: context.data?.enemies,
      counts: context.data?.counts,
    }));
    if (context.data?.enemies > 0) break;
  }
  socket.end();
}

main().catch((error) => {
  console.error(error);
  socket.destroy();
  process.exitCode = 1;
});
