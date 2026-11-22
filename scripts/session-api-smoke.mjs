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
const tools = await call("/tools", { headers: auth });
console.log("tools", tools.status, tools.body.tools?.length);
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

const since = Number(context.body.eventsSince ?? 0);
const waitPromise = call(`/events/wait?since=${since}&timeoutMs=3000&types=test`, { headers: auth });
await new Promise((resolve) => setTimeout(resolve, 100));
const emitted = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "emit_event", type: "test", data: { source: "smoke" } }),
});
const waited = await waitPromise;
console.log("emit", emitted.status);
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
if (tools.status !== 200 || tools.body.tools?.length !== 10) process.exit(1);
if (map.status !== 200 || range.status !== 206 || rangeBytes.length !== 16) process.exit(1);
if (conditionalMap.status !== 304) process.exit(1);
if (sessionMap.status !== 401) process.exit(1);
if (manifest.status !== 200 || events.status !== 200) process.exit(1);
if (second.status !== 401) process.exit(1);
if (refreshed.status !== 200 || oldData.status !== 401 || freshData.status !== 200) process.exit(1);
if (waited.status !== 200 || !waited.body.events?.length || waited.body.timedOut) process.exit(1);
if (waitTimeout.status !== 200 || !waitTimeout.body.timedOut) process.exit(1);
if (timeoutResult.body.status !== "failed" || timeoutResult.body.data?.code !== "timeout" || timeoutResult.body.paused !== false) process.exit(1);
