import net from "node:net";
const discoveryPath = "/tmp/mindustry-ai-probe/bridge-info.json";
const fs = await import("node:fs");
const info = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
const base = `http://127.0.0.1:${info.sessionPort}`;
const headers = { "content-type": "application/json" };

async function call(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function rawProbe(payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: info.port });
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw probe timeout"));
    }, 3000);
    socket.on("connect", () => {
      socket.write(JSON.stringify({ id: 9001, token: info.token, ...payload }) + "\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      const line = buffer.slice(0, newline);
      socket.end();
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", reject);
  });
}

const bootstrap = info.sessionBootstrapToken;
const first = await call("/session", {
  method: "POST",
  headers: { ...headers, authorization: `Bearer ${bootstrap}` },
});
console.log("session", first.status, Boolean(first.body?.sessionToken));
if (first.status !== 200) process.exit(1);

const second = await call("/session", {
  method: "POST",
  headers: { ...headers, authorization: `Bearer ${bootstrap}` },
});
console.log("reused bootstrap", second.status);

const auth = { ...headers, authorization: `Bearer ${first.body.sessionToken}` };
const dataAuth = { ...headers, authorization: `Bearer ${first.body.dataToken}` };
const index = await call("/", { headers: auth });
console.log("index", index.status, index.body.control?.length, index.body.data?.length);
if (index.status !== 200 || !Array.isArray(index.body.control) || !Array.isArray(index.body.data)) process.exit(1);

const guideBuild = await call("/guide?topic=build", { headers: auth });
const guideText = String(guideBuild.body);
console.log("guide build", guideBuild.status, guideText.includes("get_config_schema") || guideText.includes("canvas."));
if (guideBuild.status !== 200 || guideText.includes("get_config_schema") || guideText.includes("canvas.")) process.exit(1);

const tools = await call("/tools", { headers: auth });
const expectedTools = [
  "get_context", "get_area", "get_tile", "query_area", "get_unit", "list_unit_types",
  "move_to", "attack", "mine", "build_plan", "withdraw", "deposit", "configure",
  "deconstruct", "repair", "set_stance", "release", "follow",
  "get_action_result", "cancel", "stop",
];
const toolNames = new Set((tools.body.tools ?? []).map((tool) => tool.name));
const missingTools = expectedTools.filter((name) => !toolNames.has(name));
console.log("tools", tools.status, tools.body.tools?.length, "missing", missingTools.join(",") || "none");
if (tools.status !== 200 || missingTools.length > 0) process.exit(1);
const forbidden = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "get_capabilities" }),
});
const plan = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "build_plan", placements: [] }),
});
console.log("session action gate", forbidden.status, plan.status, plan.body.message ?? plan.body.code);
const context = await call("/context?detail=summary", { headers: auth });
console.log("context", context.status, context.body.map, context.body.assistant?.x, context.body.assistant?.y);

const targetX = Number(context.body.assistant?.x ?? 0) + 40;
const targetY = Number(context.body.assistant?.y ?? 0);
const action = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "move_to", x: targetX, y: targetY }),
});
console.log("action", action.status, action.body.opId ?? action.body.code);
if (action.status !== 200 || !action.body.opId) process.exit(1);

let result;
for (let i = 0; i < 30; i++) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  result = await call(`/actions/${action.body.opId}`, { headers: auth });
  if (result.body.status && result.body.status !== "running") break;
}
console.log("result", result.status, result.body.status, result.body.data?.code ?? result.body.data?.distance ?? "");

const timeoutMove = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({
    kind: "move_to",
    x: Number(context.body.assistant?.x ?? 0) + 120,
    y: Number(context.body.assistant?.y ?? 0),
    timeoutTicks: 1,
  }),
});
let timeoutResult;
for (let i = 0; i < 30; i++) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  timeoutResult = await call(`/actions/${timeoutMove.body.opId}`, { headers: auth });
  if (timeoutResult.body.status && timeoutResult.body.status !== "running") break;
}
console.log("timeout data", timeoutResult.body.status, timeoutResult.body.data?.code, timeoutResult.body.paused);

const pauseState = await call("/context?detail=summary", { headers: auth });
const pauseWait = call(`/events/wait?since=${pauseState.body.eventsSince}&timeoutMs=2000&types=game_pause`, { headers: auth });
await new Promise((resolve) => setTimeout(resolve, 100));
const paused = await rawProbe({ op: "set_paused", paused: true });
const pauseEvent = await pauseWait;
const pausedContext = await call("/context?detail=summary", { headers: auth });
const blocked = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "move_to", x: 1000, y: 584 }),
});
const unpaused = await rawProbe({ op: "set_paused", paused: false });
console.log("pause gate", paused.ok, pauseEvent.body.events?.length, pausedContext.body.paused, blocked.status, blocked.body.code, unpaused.ok);

const since = Number(context.body.eventsSince ?? 0);
const waitPromise = call(`/events/wait?since=${since}&timeoutMs=3000&types=test`, { headers: auth });
await new Promise((resolve) => setTimeout(resolve, 100));
const emitted = await rawProbe({ op: "emit_event", type: "test", data: { source: "raw" } });
const waited = await waitPromise;
console.log("emit", emitted.ok);
console.log("events wait", waited.status, waited.body.events?.length, waited.body.timedOut, waited.body.paused);
const waitTimeout = await call(`/events/wait?since=${waited.body.next}&timeoutMs=100`, { headers: auth });
console.log("events timeout", waitTimeout.status, waitTimeout.body.timedOut);

const map = await fetch(`${base}/data/map/latest`, { headers: dataAuth });
const mapEtag = map.headers.get("etag");
const conditionalMap = await fetch(`${base}/data/map/latest`, {
  headers: { ...dataAuth, "if-none-match": mapEtag },
});
const sessionMap = await fetch(`${base}/data/map/latest`, { headers: auth });
const mapBytes = Buffer.from(await map.arrayBuffer());
fs.writeFileSync("/tmp/mindustry-session-map.bin", mapBytes);
const range = await fetch(`${base}/data/map/latest`, {
  headers: { ...dataAuth, range: "bytes=0-15" },
});
const rangeBytes = Buffer.from(await range.arrayBuffer());
const manifest = await call("/data/manifest/latest", { headers: dataAuth });
const events = await fetch(`${base}/data/events/latest`, { headers: dataAuth });
const eventsBody = await events.text();
console.log(
  "data",
  "map", map.status, mapBytes.length, mapBytes.subarray(0, 4).toString("ascii"),
  "sessionData", sessionMap.status,
  "etag", conditionalMap.status,
  "range", range.status, rangeBytes.length, range.headers.get("content-range"),
  "manifest", manifest.status, manifest.body.access?.baseUrl,
  "events", events.status, eventsBody.split("\n").filter(Boolean).length,
);

const guide = await call("/guide", { headers: auth });
console.log("guide", guide.status, String(guide.body).split("\n")[0]);

const refreshed = await call("/session/data-token", {
  method: "POST",
  headers: auth,
  body: "{}",
});
console.log("data token refresh", refreshed.status, Boolean(refreshed.body.dataToken));
const oldData = await fetch(`${base}/data/map/latest`, { headers: dataAuth });
const freshDataAuth = { ...headers, authorization: `Bearer ${refreshed.body.dataToken}` };
const freshData = await fetch(`${base}/data/map/latest`, { headers: freshDataAuth });
console.log("data token rotation", oldData.status, freshData.status);

if (context.status !== 200 || action.status !== 200 || result.status !== 200 || guide.status !== 200) {
  process.exit(1);
}
if (tools.status !== 200 || tools.body.tools?.length !== 12) process.exit(1);
if (forbidden.status !== 403 || plan.status !== 400 || !String(plan.body.message ?? "").includes("no placements")) process.exit(1);
if (map.status !== 200 || range.status !== 206 || rangeBytes.length !== 16) process.exit(1);
if (conditionalMap.status !== 304) process.exit(1);
if (sessionMap.status !== 401) process.exit(1);
if (manifest.status !== 200 || events.status !== 200) process.exit(1);
if (second.status !== 401) process.exit(1);
if (refreshed.status !== 200 || oldData.status !== 401 || freshData.status !== 200) process.exit(1);
if (waited.status !== 200 || !waited.body.events?.length || waited.body.timedOut) process.exit(1);
if (waitTimeout.status !== 200 || !waitTimeout.body.timedOut) process.exit(1);
if (timeoutResult.body.status !== "failed" || timeoutResult.body.data?.code !== "timeout" || timeoutResult.body.paused !== false) process.exit(1);
if (!paused.ok || !pauseEvent.body.events?.length || pausedContext.body.paused !== true || blocked.status !== 400 || blocked.body.code !== "game_paused" || !unpaused.ok) process.exit(1);
