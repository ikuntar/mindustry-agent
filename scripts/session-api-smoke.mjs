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

const guide = await call("/guide", { headers: auth });
console.log("guide", guide.status, String(guide.body).split("\n")[0]);

if (context.status !== 200 || action.status !== 200 || result.status !== 200 || guide.status !== 200) {
  process.exit(1);
}
if (second.status !== 401) process.exit(1);
