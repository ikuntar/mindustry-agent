import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const seed = process.env.PROBE_SEED ? JSON.parse(fs.readFileSync(process.env.PROBE_SEED, "utf8")) : undefined;
const expectedMap = process.env.PROBE_EXPECT_MAP;
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/src/index.js"],
  cwd: process.cwd(),
  env: childEnv,
  stderr: "inherit",
});

const client = new Client({ name: "mindustry-ai-fixed-scenario", version: "0.1.0" });
const checks: { name: string; ok: boolean; detail?: string }[] = [];

function parse(result: unknown): any {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("tool result has no text content");
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "tool_error", message: text } };
  }
}

function check(name: string, condition: unknown, detail?: string): void {
  const ok = !!condition;
  checks.push({ name, ok, detail });
  if (!ok) throw new Error(`scenario check failed: ${name}${detail ? ` (${detail})` : ""}`);
}

async function tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = parse(await client.callTool({ name, arguments: args }));
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.error)}`);
  return result.data;
}

async function rawProbe(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const discoveryPath =
    process.env.PROBE_DISCOVERY ?? path.join(os.tmpdir(), "mindustry-ai-probe", "bridge-info.json");
  const discovery = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: Number(discovery.port) });
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`probe timeout: ${name}`));
    }, 5000);
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      const response = JSON.parse(buffer.slice(0, index));
      clearTimeout(timer);
      socket.destroy();
      if (!response.ok) reject(new Error(`${name}: ${JSON.stringify(response.error)}`));
      else resolve(response.data);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("connect", () => {
      socket.write(
        JSON.stringify({ id: 9001, op: name, ...args, ...(discovery.token ? { token: discovery.token } : {}) }) +
          "\n",
      );
    });
  });
}

async function waitAction(opId: string, waitMs = 5000): Promise<any> {
  const deadline = Date.now() + waitMs;
  let result: any;
  while (Date.now() < deadline) {
    result = await tool("get_action_result", { opId, waitMs: 100 });
    if (result.status === "done" || result.status === "failed" || result.status === "cancelled") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check(`action ${opId} done`, result?.status === "done", String(result?.status));
  return result;
}

async function main(): Promise<void> {
  await client.connect(transport);
  const started = Date.now();

  const context = await tool("get_context", { detail: "full" });
  check("assistant exists", context.assistant?.id, JSON.stringify(context.assistant));
  check("assistant alive", !context.assistant.dead);
  check("assistant has core", context.cores?.length > 0);
  check("context uses assistant team", context.team === context.assistant.team, `${context.team}/${context.assistant.team}`);
  check(
    "event delta matches summary",
    context.eventSummary?.total === context.eventsPending,
    `${context.eventSummary?.total}/${context.eventsPending}`,
  );
  const caughtUp = await tool("get_context", { detail: "summary", since: context.eventsSince });
  check("event delta does not grow", caughtUp.eventsPending <= context.eventsPending, String(caughtUp.eventsPending));
  if (expectedMap) check(`fixed map ${expectedMap}`, context.map === expectedMap, String(context.map));

  const local = await tool("get_context", { detail: "full", radius: 4 });
  const localUnits = local.nearby?.units ?? [];
  check(
    "context radius is bounded",
    localUnits.every(
      (unit: { x: number; y: number }) =>
        Math.hypot(unit.x - local.assistant.x, unit.y - local.assistant.y) <= 32.001,
    ),
    JSON.stringify(localUnits.map((unit: { x: number; y: number }) => [unit.x, unit.y])),
  );
  if (seed?.ally?.id) {
    const wide = await tool("get_context", { detail: "full", radius: 15 });
    check(
      "context radius includes nearby ally",
      wide.nearby?.units?.some((unit: { id: number }) => unit.id === seed.ally.id),
      JSON.stringify(wide.nearby?.units?.map((unit: { id: number }) => unit.id)),
    );
  }

  const summary = await tool("get_map_summary");
  check("map summary is a ref", typeof summary.ref === "string" && summary.ref.startsWith("obs://"));
  check("map summary has schema", summary.schema?.width > 0 && summary.schema?.height > 0);
  check("map summary has no tiles", !("tiles" in summary));

  const core = context.cores[0];
  const target = { x: core.x + 24, y: core.y };
  const moved = await tool("move_to", { ...target, arriveRadius: 12 });
  await waitAction(moved.opId);
  const afterMove = await tool("get_context", { detail: "summary" });
  check(
    "assistant moved",
    Math.hypot(afterMove.assistant.x - target.x, afterMove.assistant.y - target.y) < 40,
    `${afterMove.assistant.x},${afterMove.assistant.y}`,
  );

  const baseX = Math.floor(core.x / 8);
  const baseY = Math.floor(core.y / 8);
  let placement: any;
  let placementTiles: { x: number; y: number }[] = [];
  let multiBuilt = false;
  const placementErrors: string[] = [];

  // First prove a multi-placement build plan is atomic and builds every tile.
  for (const [dx, dy] of [
    [-4, 0],
    [-5, 0],
    [-4, 1],
    [4, 0],
    [5, 0],
    [0, 4],
    [0, -4],
    [4, 4],
    [-4, -4],
  ]) {
    const tiles = [
      { x: baseX + dx, y: baseY + dy },
      { x: baseX + dx + 1, y: baseY + dy },
    ];
    const attempted = parse(
      await client.callTool({
        name: "build_plan",
        arguments: { placements: tiles.map((tile) => ({ block: "conveyor", ...tile })) },
      }),
    );
    if (attempted.ok) {
      placement = attempted.data;
      placementTiles = tiles;
      multiBuilt = true;
      break;
    }
    placementErrors.push(`multi ${dx},${dy}: ${attempted.error?.code ?? "error"}`);
  }

  if (!placement) {
    for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [5, 0], [-5, 0], [0, 5], [0, -5]]) {
      const tile = { x: baseX + dx, y: baseY + dy };
      const attempted = parse(
        await client.callTool({
          name: "build_plan",
          arguments: { placements: [{ block: "conveyor", ...tile }] },
        }),
      );
      if (attempted.ok) {
        placement = attempted.data;
        placementTiles = [tile];
        break;
      }
      placementErrors.push(`${dx},${dy}: ${attempted.error?.code ?? "error"}`);
    }
  }
  check("build queued", placement, placementErrors.join("; "));
  check("multi-block build plan", multiBuilt, `multiBuilt=${multiBuilt}`);
  await waitAction(placement.opId);
  const area = await tool("query_area", { x: core.x, y: core.y, radius: 96 });
  check(
    "all planned conveyors visible",
    placementTiles.every((tile) =>
      area.buildings?.some(
        (building: { block: string; tileX: number; tileY: number }) =>
          building.block === "conveyor" && building.tileX === tile.x && building.tileY === tile.y,
      ),
    ),
    JSON.stringify(placementTiles),
  );

  const events = await tool("get_events", { since: 0, summary: true, types: ["unit_destroy", "build_damage"] });
  check("event summary is present", events.summary && events.summary.total >= 0);
  check("event summary has ref", typeof events.ref === "string" && events.ref.startsWith("obs://events/"));

  if (seed?.ally?.id) {
    const possessed = await tool("possess", { unitId: seed.ally.id });
    check("possess completed", possessed.status === "done" && possessed.data?.unitId, JSON.stringify(possessed));
    const release = await tool("release");
    check("release completed", release.status === "done", JSON.stringify(release));
  }

  const secondCore = seed?.secondCore;
  check("second core fixture", secondCore?.coreId, JSON.stringify(secondCore));
  const killed = await rawProbe("kill_assistant");
  check("assistant killed for respawn", killed?.dead === true, JSON.stringify(killed));
  await new Promise((resolve) => setTimeout(resolve, 150));
  const respawned = await tool("respawn", { coreId: secondCore.coreId });
  const respawnData = respawned.data ?? respawned;
  check("respawn at requested core", respawnData.coreId === secondCore.coreId, JSON.stringify(respawned));
  const afterRespawn = await tool("get_context", { detail: "summary" });
  const secondCoreWorld = { x: secondCore.x * 8 + 4, y: secondCore.y * 8 + 4 };
  check(
    "respawned near second core",
    Math.hypot(afterRespawn.assistant.x - secondCoreWorld.x, afterRespawn.assistant.y - secondCoreWorld.y) < 32,
    `${afterRespawn.assistant.x},${afterRespawn.assistant.y}`,
  );
  check("respawned body is home", afterRespawn.assistant.isHome === true, JSON.stringify(afterRespawn.assistant));

  const coreIds = (afterRespawn.cores ?? []).map((core: { id: number }) => core.id);
  for (const coreId of coreIds) await rawProbe("destroy_core", { coreId });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const noCores = await tool("get_context", { detail: "summary" });
  check("all cores removed", (noCores.cores ?? []).length === 0, JSON.stringify(noCores.cores));

  const killedAgain = await rawProbe("kill_assistant");
  check("assistant killed with no core", killedAgain?.dead === true, JSON.stringify(killedAgain));
  const noCoreRespawn = parse(await client.callTool({ name: "respawn", arguments: {} }));
  check(
    "respawn without core fails explicitly",
    noCoreRespawn.ok === false && noCoreRespawn.error?.code === "no_core",
    JSON.stringify(noCoreRespawn),
  );

  const recreated = await rawProbe("spawn_ally_core", {
    block: "core-shard",
    x: secondCore.x,
    y: secondCore.y,
  });
  check("core recreated after no-core failure", recreated?.coreId, JSON.stringify(recreated));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const recovered = await tool("get_context", { detail: "summary" });
  check("respawn recovers after core recreated", recovered.assistant?.dead === false, JSON.stringify(recovered.assistant));

  // Route around a solid wall: direct movement would get stuck, BFS should detour.
  const startX = Math.floor(recovered.assistant.x / 8);
  const startY = Math.floor(recovered.assistant.y / 8);
  const wallX = startX + 6;
  let wallBlocks = 0;
  for (const dy of [-6, -3, 0, 3, 6]) {
    try {
      const placed = await rawProbe("spawn_enemy_building", { block: "container", x: wallX, y: startY + dy });
      if (placed?.buildingId >= 0) wallBlocks++;
    } catch {
      // A blocked tile is fine; the wall does not need to be contiguous at every offset.
    }
  }
  check("path obstruction created", wallBlocks >= 3, String(wallBlocks));
  const pathTarget = { x: (wallX + 8) * 8 + 4, y: startY * 8 + 4 };
  const pathMove = await tool("move_to", { ...pathTarget, arriveRadius: 12 });
  await waitAction(pathMove.opId, 12000);
  const afterPath = await tool("get_context", { detail: "summary" });
  check(
    "pathfinding reaches target behind wall",
    Math.hypot(afterPath.assistant.x - pathTarget.x, afterPath.assistant.y - pathTarget.y) < 48,
    `${afterPath.assistant.x},${afterPath.assistant.y} vs ${pathTarget.x},${pathTarget.y}`,
  );

  console.log(
    JSON.stringify({
      ok: true,
      map: context.map,
      assistant: context.assistant.id,
      elapsedMs: Date.now() - started,
      checks,
    }),
  );
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, checks, error: String(error) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
