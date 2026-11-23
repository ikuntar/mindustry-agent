const fs = await import("node:fs");
const info = JSON.parse(fs.readFileSync("/tmp/mindustry-ai-probe/bridge-info.json", "utf8"));
const base = `http://127.0.0.1:${info.sessionPort}`;
const headers = { "content-type": "application/json" };

async function post(path, body, token, extra = {}) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, headers: response.headers, body: json };
}

const session = await post("/session", {}, info.sessionBootstrapToken);
console.log("session", session.status);
if (session.status !== 200) process.exit(1);
const token = session.body.sessionToken;

const init = await post("/mcp", {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mindustry-http-smoke", version: "0.1.0" },
  },
}, token);
console.log("initialize", init.status, init.body.result?.serverInfo?.name, init.body.result?.protocolVersion);
if (init.status !== 200 || !init.body.result) process.exit(1);
const sessionId = init.headers.get("mcp-session-id");
if (!sessionId) process.exit(1);

const notice = await post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, token, {
  "mcp-session-id": sessionId,
});
console.log("initialized notification", notice.status);
if (notice.status !== 202) process.exit(1);

const listed = await post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" }, token, {
  "mcp-session-id": sessionId,
});
const tools = listed.body.result?.tools ?? [];
console.log("tools/list", listed.status, tools.length);
if (listed.status !== 200 || tools.length !== 27) process.exit(1);

const contextCall = await post("/mcp", {
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "get_context", arguments: { detail: "summary" } },
}, token, { "mcp-session-id": sessionId });
const contextText = contextCall.body.result?.content?.[0]?.text;
const context = JSON.parse(contextText);
console.log("tools/call get_context", contextCall.status, context.map, context.assistant?.x, context.assistant?.y);
if (contextCall.status !== 200 || contextCall.body.result?.isError) process.exit(1);

const moveCall = await post("/mcp", {
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: {
    name: "move_to",
    arguments: { x: Number(context.assistant.x) + 24, y: Number(context.assistant.y) },
  },
}, token, { "mcp-session-id": sessionId });
const move = JSON.parse(moveCall.body.result.content[0].text);
console.log("tools/call move_to", moveCall.status, move.opId, move.status);
if (moveCall.status !== 200 || !move.opId) process.exit(1);

let result;
for (let i = 0; i < 30; i++) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const poll = await post("/mcp", {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "get_action_result", arguments: { opId: move.opId } },
  }, token, { "mcp-session-id": sessionId });
  result = JSON.parse(poll.body.result.content[0].text);
  if (result.status && result.status !== "running") break;
}
console.log("tools/call get_action_result", result?.status);
if (result?.status !== "done") process.exit(1);

const unknown = await post("/mcp", { jsonrpc: "2.0", id: 6, method: "does/not/exist" }, token, {
  "mcp-session-id": sessionId,
});
console.log("unknown method", unknown.status, unknown.body.error?.code);
if (unknown.status !== 200 || unknown.body.error?.code !== -32601) process.exit(1);
