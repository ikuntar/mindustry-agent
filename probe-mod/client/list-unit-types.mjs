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

function call(op, args = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${op}`));
    }, 5000);
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
  const response = await call("list_unit_types");
  const units = response.data?.units ?? [];
  console.log(JSON.stringify(units.filter((unit) => !unit.playerControllable), null, 2));
  console.log("total", units.length, "non-controllable", units.filter((unit) => !unit.playerControllable).length);
  socket.end();
}

main().catch((error) => {
  console.error(error);
  socket.destroy();
  process.exitCode = 1;
});
