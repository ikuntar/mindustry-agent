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

async function expectToolError(
  name: string,
  args: Record<string, unknown>,
  contains: string,
  label = `${name} rejects ${contains}`,
): Promise<void> {
  const result = parse(await client.callTool({ name, arguments: args }));
  const text = JSON.stringify(result);
  check(label, !result.ok && text.includes(contains), text.slice(0, 300));
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
  const content = await tool("get_content", { type: "units" });
  check(
    "real content includes units",
    content.units?.some((unit: { name: string }) => unit.name === "dagger") && content.units.length > 4,
    String(content.units?.length),
  );
  if (expectedMap) check(`fixed map ${expectedMap}`, context.map === expectedMap, String(context.map));

  const coreId = context.cores?.[0]?.id;
  if (coreId != null) {
    await expectToolError(
      "withdraw",
      { target: { buildingId: coreId }, item: "unobtainium-test", amount: 1 },
      "Unknown item",
    );
  }
  await expectToolError("possess", { unitId: context.assistant.id }, "own body");
  await expectToolError(
    "deposit",
    { target: { buildingId: 999999 }, item: "copper", amount: 1 },
    "No target building",
  );
  await expectToolError("mine", { x: -1, y: -1 }, "outside the map");
  await expectToolError("move_to", { x: -999, y: -999 }, "outside the map");
  await expectToolError(
    "build_plan",
    { placements: [{ block: "conveyor", x: -1, y: -1 }] },
    "outside the map",
  );
  const copperForFixture = Number(context.resources?.copper ?? 100);
  await rawProbe("set_core_items", { item: "copper", amount: 0 });
  try {
    await expectToolError(
      "build_plan",
      { placements: [{ block: "conveyor", x: 112, y: 75 }] },
      "insufficient_resources",
    );
  } finally {
    await rawProbe("set_core_items", { item: "copper", amount: copperForFixture });
  }
  const enemyForPossession = await rawProbe("spawn_enemy", {
    type: "dagger",
    x: context.cores[0].x + 200,
    y: context.cores[0].y,
  });
  await expectToolError("possess", { unitId: enemyForPossession.id }, "not on the assistant's team");
  const nonControllable = await rawProbe("spawn_ally", {
    type: "dagger",
    x: context.cores[0].x + 260,
    y: context.cores[0].y,
  });
  await rawProbe("set_type_player_controllable", { name: "dagger", allowed: false });
  await expectToolError("possess", { unitId: nonControllable.id }, "not player-controllable");
  await rawProbe("set_type_player_controllable", { name: "dagger", allowed: true });
  await rawProbe("set_writes_enabled", { enabled: false });
  try {
    await expectToolError("move_to", { x: context.cores[0].x + 32, y: context.cores[0].y }, "writes_disabled");
  } finally {
    await rawProbe("set_writes_enabled", { enabled: true });
  }
  if (seed?.ally?.id) {
    await expectToolError("attack", { target: { unitId: seed.ally.id } }, "Refusing to attack a unit");
  }

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
  const baseX = Math.floor(core.x / 8);
  const baseY = Math.floor(core.y / 8);
  const tileWindow = await tool("get_area", { x: core.x, y: core.y, radius: 2 });
  check("bounded area is available", tileWindow.tiles?.length === 25, String(tileWindow.tiles?.length));
  check("bounded area reports no truncation", tileWindow.truncated === false);
  const truncatedWindow = await tool("get_area", { x: core.x, y: core.y, radius: 24, maxTiles: 10 });
  check(
    "bounded area truncates at maxTiles",
    truncatedWindow.tiles?.length === 10 && truncatedWindow.truncated === true,
    JSON.stringify({ tiles: truncatedWindow.tiles?.length, truncated: truncatedWindow.truncated }),
  );

  // Supply loop: build a turret, load it from the core, and prove it can fire.
  let turretPlacement: any;
  const turretErrors: string[] = [];
  for (const [dx, dy] of [[-3, 2], [3, 2], [-3, -2], [3, -2], [2, 3], [-2, 3], [4, 2], [-4, 2]]) {
    const attempted = parse(
      await client.callTool({
        name: "build_plan",
        arguments: { placements: [{ block: "duo", x: baseX + dx, y: baseY + dy }] },
      }),
    );
    if (attempted.ok) {
      turretPlacement = { ...attempted.data, tile: { x: baseX + dx, y: baseY + dy } };
      break;
    }
    turretErrors.push(`${dx},${dy}: ${attempted.error?.code ?? "error"}`);
  }
  check("turret built", turretPlacement, turretErrors.join("; "));
  await waitAction(turretPlacement.opId);
  let turret: any;
  let turretArea: any;
  for (let attempt = 0; attempt < 20 && !turret; attempt++) {
    turretArea = await tool("query_area", { x: core.x, y: core.y, radius: 96 });
    turret = turretArea.buildings?.find(
      (building: { block: string; tileX: number; tileY: number }) =>
        building.block === "duo" &&
        building.tileX === turretPlacement.tile.x &&
        building.tileY === turretPlacement.tile.y,
    );
    if (!turret) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  check("turret visible", turret?.buildingId ?? turret?.id, JSON.stringify(turretArea?.buildings));

  let feeder: any;
  let feederTile: { x: number; y: number } | undefined;
  const feederErrors: string[] = [];
  for (const [dx, dy, rotation] of [
    [-1, 0, 0],
    [0, 1, 1],
    [0, -1, 3],
    [1, 0, 2],
    [-1, 1, 0],
  ]) {
    const tile = { x: turret.tileX + dx, y: turret.tileY + dy };
    const attempted = parse(
      await client.callTool({
        name: "build_plan",
        arguments: { placements: [{ block: "conveyor", ...tile, rotation }] },
      }),
    );
    if (!attempted.ok) {
      feederErrors.push(`${tile.x},${tile.y}: ${attempted.error?.code ?? "error"}`);
      continue;
    }
    for (let poll = 0; poll < 20 && !feeder; poll++) {
      const area = await tool("query_area", { x: core.x, y: core.y, radius: 96 });
      feeder = area.buildings?.find(
        (building: { block: string; tileX: number; tileY: number }) =>
          building.block === "conveyor" && building.tileX === tile.x && building.tileY === tile.y,
      );
      if (!feeder) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (feeder) {
      feederTile = tile;
      break;
    }
    feederErrors.push(`${tile.x},${tile.y}: not visible`);
  }
  check("feeder conveyor built", feeder?.buildingId ?? feeder?.id, feederErrors.join("; "));

  const withdrawnForTurret = await tool("withdraw", {
    target: { buildingId: core.id },
    item: "copper",
    amount: 30,
  });
  check("withdraw for turret", withdrawnForTurret.data?.amount === 30, JSON.stringify(withdrawnForTurret));
  const depositedToTurret = await tool("deposit", {
    target: { buildingId: feeder.buildingId ?? feeder.id },
    item: "copper",
    amount: 30,
  });
  let feederMoved = Number(depositedToTurret.data?.amount ?? 0);
  for (let attempt = 0; attempt < 40 && feederMoved < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const next = await tool("deposit", {
        target: { buildingId: feeder.buildingId ?? feeder.id },
        item: "copper",
        amount: 30 - feederMoved,
      });
      feederMoved += Number(next.data?.amount ?? 0);
    } catch {
      // Feeder is still moving its current stack.
    }
  }
  check("feeder accepts copper", feederMoved >= 15, JSON.stringify({ feederMoved }));
  await new Promise((resolve) => setTimeout(resolve, 900));

  const defenseWaves: { before: number; after: number; dead: boolean }[] = [];
  for (const [dx, dy] of [[64, 0], [64, 24], [64, 48], [64, 72]]) {
    const turretEnemy = await rawProbe("spawn_enemy", {
      type: "dagger",
      x: turret.tileX * 8 + dx,
      y: turret.tileY * 8 + dy,
    });
    const turretEnemyBefore = await rawProbe("get_unit", { unitId: turretEnemy.id });
    let turretEnemyAfter = turretEnemyBefore;
    for (let attempt = 0; attempt < 80 && !turretEnemyAfter.dead; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      turretEnemyAfter = await rawProbe("get_unit", { unitId: turretEnemy.id });
      if (turretEnemyAfter.health < turretEnemyBefore.health && attempt > 5) break;
    }
    check(
      `turret damages enemy wave ${defenseWaves.length + 1}`,
      turretEnemyAfter?.dead === true || turretEnemyAfter.health < turretEnemyBefore.health,
      JSON.stringify({ before: turretEnemyBefore.health, after: turretEnemyAfter.health, dead: turretEnemyAfter.dead }),
    );
    defenseWaves.push({
      before: turretEnemyBefore.health,
      after: turretEnemyAfter.health,
      dead: turretEnemyAfter.dead,
    });
  }
  check("turret defends multiple waves", defenseWaves.length === 4, JSON.stringify(defenseWaves));

  const target = { x: core.x + 24, y: core.y };
  const moved = await tool("move_to", { ...target, arriveRadius: 12 });
  await waitAction(moved.opId);
  const afterMove = await tool("get_context", { detail: "summary" });
  check(
    "assistant moved",
    Math.hypot(afterMove.assistant.x - target.x, afterMove.assistant.y - target.y) < 40,
    `${afterMove.assistant.x},${afterMove.assistant.y}`,
  );

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
  check(
    "event type filter is enforced",
    Object.keys(events.summary?.byType ?? {}).every((type) => type === "unit_destroy" || type === "build_damage"),
    JSON.stringify(events.summary?.byType),
  );
  const firstEventPage = await tool("get_events", { since: 0, limit: 1, summary: true });
  check("event page has a cursor", !firstEventPage.hasMore || Number(firstEventPage.next) > 0, JSON.stringify(firstEventPage));
  if (firstEventPage.hasMore) {
    const secondEventPage = await tool("get_events", { since: firstEventPage.next, limit: 1, summary: true });
    check("event page cursor advances", Number(secondEventPage.next) > Number(firstEventPage.next), JSON.stringify(secondEventPage));
  }
  const rawFirstPage = await tool("get_events", { since: 0, limit: 1 });
  check("raw event page returns one event", rawFirstPage.events?.length === 1, JSON.stringify(rawFirstPage));
  if (rawFirstPage.hasMore) {
    const rawSecondPage = await tool("get_events", { since: rawFirstPage.next, limit: 1 });
    check(
      "raw event pagination advances",
      rawSecondPage.events?.[0]?.id > rawFirstPage.events?.[0]?.id,
      JSON.stringify({ first: rawFirstPage.events?.[0]?.id, second: rawSecondPage.events?.[0]?.id }),
    );
  }

  if (seed?.ally?.id) {
    const ally = { ...seed.ally, x: core.x + 80, y: core.y };
    await tool("command_units", {
      unitIds: [ally.id],
      command: "move",
      target: { x: ally.x + 160, y: ally.y },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await tool("follow", { unitId: ally.id, distance: 48 });
    let followed = false;
    let lastDistance = Infinity;
    for (let i = 0; i < 30 && !followed; i++) {
      const snapshot = await tool("get_context", { detail: "full", radius: 300 });
      const allyNow = snapshot.nearby?.units?.find((unit: { id: number }) => unit.id === ally.id);
      if (allyNow) {
        lastDistance = Math.hypot(snapshot.assistant.x - allyNow.x, snapshot.assistant.y - allyNow.y);
        followed = lastDistance <= 80;
      }
      if (!followed) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    check("follow keeps within range", followed, String(lastDistance));
    await tool("cancel");
  }

  if (seed?.ally?.id) {
    const possessed = await tool("possess", { unitId: seed.ally.id });
    check("possess completed", possessed.status === "done" && possessed.data?.unitId, JSON.stringify(possessed));
    const release = await tool("release");
    check("release completed", release.status === "done", JSON.stringify(release));
    const releasedInfo = await rawProbe("get_unit", { unitId: release.data?.releasedUnitId });
    check(
      "release restores non-probe controller",
      releasedInfo?.controller && releasedInfo.controller !== "ProbeController",
      JSON.stringify(releasedInfo),
    );
    await rawProbe("set_possession_allowed", { allowed: false });
    await expectToolError("possess", { unitId: seed.ally.id }, "possession_disabled");
    await rawProbe("set_possession_allowed", { allowed: true });
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

  // Attack approach must use the same path around another wall.
  const attackStartX = Math.floor(afterPath.assistant.x / 8);
  const attackStartY = Math.floor(afterPath.assistant.y / 8);
  const attackWallX = attackStartX + 5;
  let attackWallBlocks = 0;
  for (const dy of [-4, -2, 0, 2, 4]) {
    try {
      const placed = await rawProbe("spawn_enemy_building", {
        block: "container",
        x: attackWallX,
        y: attackStartY + dy,
      });
      if (placed?.buildingId >= 0) attackWallBlocks++;
    } catch {
      // Ignore blocked tiles.
    }
  }
  check("attack wall created", attackWallBlocks >= 3, String(attackWallBlocks));
  const attackTargets: any[] = [];
  for (const offset of [22, 24, 26, 28]) {
    for (const dy of [0, 2, -2, 4, -4, 6, -6]) {
      try {
        const placed = await rawProbe("spawn_enemy_building", {
          block: "container",
          force: true,
          x: attackStartX + offset,
          y: attackStartY + dy,
        });
        if (placed?.buildingId >= 0) attackTargets.push(placed);
      } catch {
        // Try another target tile.
      }
    }
    if (attackTargets.length) break;
  }
  const attackTarget = attackTargets[0];
  check("attack target created", attackTarget?.buildingId >= 0, JSON.stringify(attackTargets));
  await tool("attack", { target: { buildingId: attackTarget.buildingId } });
  const attackTargetWorld = { x: attackTarget.x * 8 + 4, y: attackTarget.y * 8 + 4 };
  let approached = false;
  for (let i = 0; i < 30 && !approached; i++) {
    const snapshot = await tool("get_context", { detail: "summary" });
    approached =
      Math.hypot(snapshot.assistant.x - attackTargetWorld.x, snapshot.assistant.y - attackTargetWorld.y) < 150;
    if (!approached) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check("attack approach crosses wall region", approached);
  await tool("cancel");

  const autoStart = await tool("get_context", { detail: "summary" });
  const autoEnemy = await rawProbe("spawn_enemy", {
    type: "dagger",
    x: autoStart.assistant.x + 30,
    y: autoStart.assistant.y,
  });
  const autoBefore = await rawProbe("get_unit", { unitId: autoEnemy.id });
  let autoAfter = autoBefore;
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    autoAfter = await rawProbe("get_unit", { unitId: autoEnemy.id });
    if (autoAfter.dead || autoAfter.health < autoBefore.health) break;
  }
  check(
    "auto defense damages nearby enemy",
    autoAfter?.dead === true || autoAfter.health < autoBefore.health,
    JSON.stringify({ before: autoBefore.health, after: autoAfter.health, dead: autoAfter.dead }),
  );

  const retreatStart = await tool("get_context", { detail: "summary" });
  await rawProbe("set_health", { health: 20 });
  const threatUnit = await rawProbe("get_unit", { unitId: autoEnemy.id });
  const beforeDistance = Math.hypot(
    retreatStart.assistant.x - threatUnit.x,
    retreatStart.assistant.y - threatUnit.y,
  );
  const coreBefore = retreatStart.cores?.[0];
  const beforeCoreDistance = coreBefore
    ? Math.hypot(retreatStart.assistant.x - coreBefore.x, retreatStart.assistant.y - coreBefore.y)
    : Infinity;
  await new Promise((resolve) => setTimeout(resolve, 900));
  const retreatAfter = await tool("get_context", { detail: "summary" });
  const threatAfter = await rawProbe("get_unit", { unitId: autoEnemy.id });
  const afterDistance = Math.hypot(
    retreatAfter.assistant.x - threatAfter.x,
    retreatAfter.assistant.y - threatAfter.y,
  );
  const coreAfter = retreatAfter.cores?.[0];
  const afterCoreDistance = coreAfter
    ? Math.hypot(retreatAfter.assistant.x - coreAfter.x, retreatAfter.assistant.y - coreAfter.y)
    : Infinity;
  check(
    "low-health retreat increases distance",
    afterDistance > beforeDistance + 10,
    `${beforeDistance} -> ${afterDistance}`,
  );
  check(
    "low-health retreat moves toward safe core",
    afterCoreDistance < beforeCoreDistance - 20,
    `${beforeCoreDistance} -> ${afterCoreDistance}`,
  );

  const cancelMove = await tool("move_to", { x: core.x + 80, y: core.y, arriveRadius: 8 });
  const cancelResult = await tool("cancel", { opId: cancelMove.opId });
  const cancelledOp = await tool("get_action_result", { opId: cancelMove.opId });
  check(
    "targeted cancel marks op cancelled",
    cancelResult.data?.cancelled >= 1 && cancelledOp.status === "cancelled",
    JSON.stringify({ cancelResult, cancelledOp }),
  );
  const actionLog = await rawProbe("get_action_log", { limit: 128 });
  check(
    "action log contains cancelled action",
    actionLog?.actions?.some((action: { opId: string; status: string }) => action.opId === cancelMove.opId && action.status === "cancelled"),
    JSON.stringify({ count: actionLog?.count }),
  );

  const waveHistory: { waveBefore: number; waveAfter: number; enemies: number }[] = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    const waveBefore = (await tool("get_context", { detail: "summary" })).wave;
    const waveStart = await rawProbe("start_wave");
    check("survival wave fixture has spawn groups", waveStart?.spawnGroups > 0, JSON.stringify(waveStart));
    let survivalWave = waveBefore;
    let survivalEnemies = 0;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const snapshot = await tool("get_context", { detail: "summary" });
      survivalWave = snapshot.wave;
      survivalEnemies = snapshot.counts?.enemyUnits ?? snapshot.enemies ?? 0;
      if (survivalWave > waveBefore && survivalEnemies > 0) break;
    }
    check(
      `survival wave ${cycle + 1} advances and spawns enemies`,
      survivalWave > waveBefore && survivalEnemies > 0,
      JSON.stringify({ waveBefore, survivalWave, survivalEnemies }),
    );
    waveHistory.push({ waveBefore, waveAfter: survivalWave, enemies: survivalEnemies });
  }
  check(
    "survival waves advance consecutively",
    waveHistory[1].waveAfter > waveHistory[0].waveAfter,
    JSON.stringify(waveHistory),
  );
  const enemyArea = await tool("query_area", {
    x: core.x,
    y: core.y,
    radius: 1000,
    includeBuildings: false,
    includeEnemies: true,
  });
  const enemyUnits = (enemyArea.units ?? []).filter((unit: { team: number }) => unit.team !== context.team);
  check("enemy area query includes wave enemies", enemyUnits.length > 0, JSON.stringify(enemyUnits.slice(0, 3)));
  const threatContext = await tool("get_context", { detail: "full", radius: 300, includeEnemies: true });
  check(
    "context threats include wave enemies",
    (threatContext.threats ?? []).some((unit: { team: number }) => unit.team !== context.team),
    JSON.stringify(threatContext.threats?.slice(0, 3)),
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
