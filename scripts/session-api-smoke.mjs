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
  return { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) };
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
const bootstrapHeaders = { ...headers, authorization: "Bearer " + bootstrap };
const bootstrapGuide = await call("/guide", { headers: bootstrapHeaders });
const bootstrapTools = await call("/tools", { headers: bootstrapHeaders });
console.log("bootstrap read", bootstrapGuide.status, bootstrapTools.status, String(bootstrapGuide.body).length);
if (bootstrapGuide.status !== 200 || bootstrapTools.status !== 200) process.exit(1);
const first = await call("/session", {
  method: "POST",
  headers: bootstrapHeaders,
});
console.log("session", first.status, Boolean(first.body?.sessionToken), first.body?.guideBytes, first.body?.guideHash?.slice(0, 8), first.body?.guideFallback);
if (first.status !== 200) process.exit(1);
if (!first.body?.guideBytes || String(first.body.guideHash ?? "").length !== 64 || first.body.guideFallback !== false) process.exit(1);

const second = await call("/session", {
  method: "POST",
  headers: { ...headers, authorization: `Bearer ${bootstrap}` },
});
console.log("reused bootstrap", second.status);

const auth = { ...headers, authorization: `Bearer ${first.body.sessionToken}` };
const dataAuth = { ...headers, authorization: `Bearer ${first.body.dataToken}` };
const health = await call("/health", { headers: auth });
console.log("health", health.status, health.body.tick, health.body.queueDepth, health.body.lastUpdateAgo);
if (health.status !== 200 || typeof health.body.tick !== "number" || !("captured" in health.body)) process.exit(1);

const index = await call("/", { headers: auth });
console.log("index", index.status, index.body.control?.length, index.body.data?.length);
if (index.status !== 200 || !Array.isArray(index.body.control) || !Array.isArray(index.body.data)) process.exit(1);

const guideBuild = await call("/guide?topic=build", { headers: auth });
const guideText = String(guideBuild.body);
console.log("guide build", guideBuild.status, guideText.includes("get_config_schema"), guideText.includes("canvas."));
if (guideBuild.status !== 200 || !guideText.includes("get_config_schema") || guideText.includes("canvas.")) process.exit(1);

const tools = await call("/tools", { headers: auth });
const expectedTools = [
  "get_context", "get_area", "get_tile", "query_area", "get_unit", "list_unit_types",
  "move_to", "attack", "mine", "build_plan", "withdraw", "deposit", "configure",
  "deconstruct", "repair", "set_stance", "release", "follow", "research",
  "get_action_result", "cancel", "stop", "possess", "respawn", "pause", "resume", "command_units",
  "get_config_schema", "get_tech_tree", "control_building", "release_building", "boost", "pickup_payload", "drop_payload",
];
const toolNames = new Set((tools.body.tools ?? []).map((tool) => tool.name));
const missingTools = expectedTools.filter((name) => !toolNames.has(name));
console.log("tools", tools.status, tools.body.tools?.length, "missing", missingTools.join(",") || "none");
if (tools.status !== 200 || missingTools.length > 0) process.exit(1);
const content = await call("/content?type=blocks&query=conveyor&limit=1", { headers: auth });
const contentMeta = content.body.blocks?.[0]?.meta;
console.log("content meta", content.status, content.body.blocks?.[0]?.name, contentMeta?.description ? "description" : "no-description", contentMeta?.databaseCategory);
if (content.status !== 200 || !contentMeta || contentMeta.databaseCategory !== "block") process.exit(1);
const crafted = await call("/content?type=blocks&query=graphite-press&limit=1", { headers: auth });
const generator = await call("/content?type=blocks&query=combustion-generator&limit=1", { headers: auth });
const consumer = await call("/content?type=blocks&query=silicon-smelter&limit=1", { headers: auth });
const unitContent = await call("/content?type=units&query=dagger&limit=1", { headers: auth });
const itemContent = await call("/content?type=items&query=copper&limit=1", { headers: auth });
const liquidContent = await call("/content?type=liquids&query=water&limit=1", { headers: auth });
const turretContent = await call("/content?type=blocks&query=duo&limit=1", { headers: auth });
const separatorContent = await call("/content?type=blocks&query=separator&limit=1", { headers: auth });
const drillContent = await call("/content?type=blocks&query=mechanical-drill&limit=1", { headers: auth });
console.log(
  "content params",
  crafted.body.blocks?.[0]?.parameters?.craftTimeTicks,
  generator.body.blocks?.[0]?.parameters?.powerProductionPerSecond,
  consumer.body.blocks?.[0]?.parameters?.power?.usePerSecond,
  unitContent.body.units?.[0]?.parameters?.weapons?.length,
  itemContent.body.items?.[0]?.parameters?.hardness,
  liquidContent.body.liquids?.[0]?.parameters?.heatCapacity,
  turretContent.body.blocks?.[0]?.parameters?.turret?.ammoTypes?.length,
  separatorContent.body.blocks?.[0]?.parameters?.outputs?.[0]?.chance,
  drillContent.body.blocks?.[0]?.parameters?.drillSpeeds?.[0]?.itemsPerSecond,
);
if (!crafted.body.blocks?.[0]?.parameters?.craftTimeTicks
    || !generator.body.blocks?.[0]?.parameters?.powerProductionPerSecond
    || !consumer.body.blocks?.[0]?.parameters?.power?.usePerSecond
    || !unitContent.body.units?.[0]?.parameters?.weapons?.length
    || itemContent.body.items?.[0]?.parameters?.hardness !== 1
    || liquidContent.body.liquids?.[0]?.parameters?.heatCapacity !== 0.4
    || !turretContent.body.blocks?.[0]?.parameters?.turret?.ammoTypes?.length
    || !separatorContent.body.blocks?.[0]?.parameters?.outputs?.[0]?.chance
    || !drillContent.body.blocks?.[0]?.parameters?.drillSpeeds?.length) process.exit(1);
const flatTree = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "get_tech_tree", flat: true, limit: 5 }),
});
console.log("tech flat", flatTree.status, flatTree.body?.total, flatTree.body?.nodes?.length, flatTree.body?.nodes?.[0]?.planet);
if (flatTree.status !== 200 || !flatTree.body?.total || flatTree.body.nodes?.[0]?.planet !== "serpulo") process.exit(1);
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
const contextFields = ["mission", "objectives", "tutorial", "rules", "wavetime", "waveTimer", "captured", "power"];
const missingContextFields = contextFields.filter((key) => !(key in (context.body ?? {})));
console.log("context fields", missingContextFields.join(",") || "none");
if (context.status !== 200 || missingContextFields.length > 0) process.exit(1);

const badPlan = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "build_plan", placements: [{ block: "conveyor", x: -1, y: -1 }] }),
});
const badResult = badPlan.body?.data?.results?.[0];
console.log("build_plan failure shape", badPlan.status, badPlan.body?.status, "opId" in (badPlan.body ?? {}), badResult?.x, badResult?.y, badResult?.block);
if (badPlan.status !== 200 || badPlan.body?.status !== "failed" || "opId" in (badPlan.body ?? {}) || badResult?.x !== -1 || badResult?.y !== -1 || badResult?.block !== "conveyor") process.exit(1);

const tile = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "get_tile", x: Math.floor(Number(context.body.assistant?.x ?? 0) / 8), y: Math.floor(Number(context.body.assistant?.y ?? 0) / 8), block: "conveyor", rotation: 0 }),
});
console.log("tile terrain/preflight", tile.status, Boolean(tile.body.floor), "canPlace" in (tile.body ?? {}));
if (tile.status !== 200 || !("floor" in (tile.body ?? {})) || !("canPlace" in (tile.body ?? {}))) process.exit(1);

const schema = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "get_config_schema", block: "ground-factory" }),
});
const tech = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "get_tech_tree", content: "duo", limit: 12 }),
});
console.log("schema/tech", schema.status, schema.body.configurable, schema.body.plans?.length, tech.status, tech.body.count);
if (schema.status !== 200 || schema.body.configurable !== true || !schema.body.plans?.length) process.exit(1);
if (tech.status !== 200 || !tech.body.nodes?.length) process.exit(1);

const cappedArea = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "query_area", x: Number(context.body.assistant?.x ?? 0), y: Number(context.body.assistant?.y ?? 0), radius: 1600 }),
});
console.log("query cap", cappedArea.status, cappedArea.body.radius, cappedArea.body.truncated?.radius);
if (cappedArea.status !== 200 || cappedArea.body.radius > 256 || cappedArea.body.truncated?.radius !== true) process.exit(1);

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
const sessionEventStart = Number((await call("/context?detail=summary", { headers: auth })).body.eventsSince ?? 0);
const sessionPause = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "pause" }),
});
const sessionPausedContext = await call("/context?detail=summary", { headers: auth });
const sessionResume = await call("/actions", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ kind: "resume" }),
});
const sessionResumedContext = await call("/context?detail=summary", { headers: auth });
console.log("session pause", sessionPause.status, sessionPause.body.paused, sessionPausedContext.body.paused, sessionResume.status, sessionResume.body.paused, sessionResumedContext.body.paused);
const sessionPauseEvents = await call(`/events/wait?since=${sessionEventStart}&timeoutMs=1000&types=game_pause,game_resume`, { headers: auth });
console.log("session pause events", sessionPauseEvents.body.events?.map((event) => `${event.type}:${event.data?.source}`).join(","));
if (!sessionPauseEvents.body.events?.some((event) => event.type === "game_pause" && event.data?.source === "api")
    || !sessionPauseEvents.body.events?.some((event) => event.type === "game_resume" && event.data?.source === "api")) {
  process.exit(1);
}

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
console.log(
  "guide",
  guide.status,
  String(guide.body).split("\n")[0],
  guide.headers["x-guide-bytes"],
  guide.headers["x-guide-hash"]?.slice(0, 8),
  guide.headers["x-guide-fallback"],
);
if (guide.status !== 200 || guide.headers["x-guide-fallback"] !== "false") process.exit(1);

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
if (tools.status !== 200 || tools.body.tools?.length !== 34) process.exit(1);
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
if (sessionPause.status !== 200 || sessionPause.body.paused !== true || sessionPausedContext.body.paused !== true || sessionResume.status !== 200 || sessionResume.body.paused !== false || sessionResumedContext.body.paused !== false) process.exit(1);
