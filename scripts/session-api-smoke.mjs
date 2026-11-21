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

const map = await fetch(`${base}/data/map/latest`, { headers: auth });
const mapBytes = Buffer.from(await map.arrayBuffer());
fs.writeFileSync("/tmp/mindustry-session-map.bin", mapBytes);
const range = await fetch(`${base}/data/map/latest`, {
  headers: { ...auth, range: "bytes=0-15" },
});
const rangeBytes = Buffer.from(await range.arrayBuffer());
const manifest = await call("/data/manifest/latest", { headers: auth });
const events = await fetch(`${base}/data/events/latest/page/0?limit=1`, { headers: auth });
const eventsBody = await events.text();
console.log(
  "data",
  "map", map.status, mapBytes.length, mapBytes.subarray(0, 4).toString("ascii"),
  "range", range.status, rangeBytes.length, range.headers.get("content-range"),
  "manifest", manifest.status, manifest.body.access?.baseUrl,
  "events", events.status, eventsBody.split("\n").filter(Boolean).length,
);

const guide = await call("/guide", { headers: auth });
console.log("guide", guide.status, String(guide.body).split("\n")[0]);

if (context.status !== 200 || action.status !== 200 || result.status !== 200 || guide.status !== 200) {
  process.exit(1);
}
if (map.status !== 200 || range.status !== 206 || rangeBytes.length !== 16) process.exit(1);
if (manifest.status !== 200 || events.status !== 200) process.exit(1);
if (second.status !== 401) process.exit(1);
