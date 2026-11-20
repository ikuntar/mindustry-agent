import fs from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const probeMode = (process.env.MINDUSTRY_AI_ADAPTER ?? "mock").toLowerCase() === "probe";
const seed = process.env.PROBE_SEED ? JSON.parse(fs.readFileSync(process.env.PROBE_SEED, "utf8")) : undefined;
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

const client = new Client({ name: "mindustry-ai-smoke", version: "0.1.0" });

function parse(result: unknown): any {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Tool result has no text content");
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "tool_error", message: text } };
  }
}

async function main(): Promise<void> {
  await client.connect(transport);

  const listed = await client.listTools();
  console.log(`tools: ${listed.tools.length}`);
  console.log(listed.tools.map((tool) => tool.name).join(", "));

  const context = parse(
    await client.callTool({ name: "get_context", arguments: { detail: probeMode ? "full" : "summary" } }),
  );
  console.log("context:", JSON.stringify(context.data, null, 2));

  const core = context.data.cores?.[0];
  const moveTarget = probeMode && core
    ? { x: core.x + 24, y: core.y }
    : { x: 25, y: 20 };
  const moved = parse(await client.callTool({ name: "move_to", arguments: moveTarget }));
  console.log("move queued:", moved);
  const moveResult = parse(
    await client.callTool({ name: "get_action_result", arguments: { opId: moved.data?.opId, waitMs: 1500 } }),
  );
  console.log("move result:", moveResult);

  let planned: any;
  if (probeMode && core) {
    const baseX = Math.floor(core.x / 8);
    const baseY = Math.floor(core.y / 8);
    const offsets = [[4, 0], [-4, 0], [0, 4], [0, -4], [5, 0], [-5, 0], [0, 5], [0, -5], [4, 4], [-4, 4], [4, -4], [-4, -4]];
    for (const [dx, dy] of offsets) {
      const candidate = [{ block: "sorter", x: baseX + dx, y: baseY + dy }];
      const attempt = parse(
        await client.callTool({ name: "build_plan", arguments: { placements: candidate } }),
      );
      if (attempt.ok) {
        planned = attempt;
        break;
      }
      console.log(`placement ${baseX + dx},${baseY + dy} rejected:`, attempt.error?.code);
    }
    if (!planned) throw new Error("no valid placement near core");
  } else {
    const placements = [
      { block: "conveyor", x: 20, y: 21 },
      { block: "router", x: 21, y: 21 },
    ];
    planned = parse(await client.callTool({ name: "build_plan", arguments: { placements } }));
  }
  console.log("build queued:", planned);
  const buildResult = parse(
    await client.callTool({ name: "get_action_result", arguments: { opId: planned.data?.opId, waitMs: 1500 } }),
  );
  console.log("build result:", buildResult);

  if (probeMode) {
    const built = buildResult.data?.data;
    if (!built) throw new Error("probe build returned no data");
    let found: any;
    for (let attempt = 0; attempt < 12 && !found; attempt++) {
      const area = parse(
        await client.callTool({
          name: "query_area",
          arguments: { x: built.x * 8 + 4, y: built.y * 8 + 4, radius: 12, includeBuildings: true },
        }),
      );
      found = area.data.buildings.find(
        (building: { tileX: number; tileY: number }) => building.tileX === built.x && building.tileY === built.y,
      );
      if (!found) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!found) throw new Error(`build was not visible in query_area at ${built.x},${built.y}`);
    console.log("verified building:", found);

    const coreId = core?.id;
    if (!coreId) throw new Error("probe context has no core");
    const withdrawn = parse(
      await client.callTool({
        name: "withdraw",
        arguments: { target: { buildingId: coreId }, item: "copper", amount: 5 },
      }),
    );
    console.log("withdraw:", withdrawn);
    const afterWithdraw = parse(await client.callTool({ name: "get_context", arguments: { detail: "summary" } }));
    console.log("carry after withdraw:", afterWithdraw.data.assistant.item, afterWithdraw.data.assistant.itemAmount);

    const deposited = parse(
      await client.callTool({
        name: "deposit",
        arguments: { target: { buildingId: coreId }, item: "copper", amount: 5 },
      }),
    );
    console.log("deposit:", deposited);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const configured = parse(
      await client.callTool({
        name: "configure",
        arguments: { x: built.x, y: built.y, value: { item: "copper" } },
      }),
    );
    console.log("configure:", configured);
    const stopped = parse(await client.callTool({ name: "stop", arguments: {} }));
    console.log("stop:", stopped.data);

    const ally = context.data.nearby?.units?.find(
      (unit: { id: number }) => unit.id !== context.data.assistant.id,
    );
    if (ally) {
      const commanded = parse(
        await client.callTool({
          name: "command_units",
          arguments: {
            unitIds: [ally.id],
            command: "move",
            target: { x: ally.x + 32, y: ally.y },
          },
        }),
      );
      console.log("command_units:", commanded);
      await new Promise((resolve) => setTimeout(resolve, 800));
      const afterCommand = parse(
        await client.callTool({ name: "get_context", arguments: { detail: "full" } }),
      );
      const allyAfter = afterCommand.data.nearby?.units?.find(
        (unit: { id: number }) => unit.id === ally.id,
      );
      console.log("ally after command:", allyAfter);

      const stance = parse(
        await client.callTool({
          name: "set_stance",
          arguments: { unitIds: [ally.id], stance: "holdPosition" },
        }),
      );
      console.log("set_stance:", stance);

      const possessed = parse(
        await client.callTool({ name: "possess", arguments: { unitId: ally.id } }),
      );
      console.log("possess:", possessed);
      const afterPossess = parse(
        await client.callTool({ name: "get_context", arguments: { detail: "summary" } }),
      );
      console.log("after possess:", afterPossess.data.assistant);

      const released = parse(await client.callTool({ name: "release", arguments: {} }));
      console.log("release:", released);
      const afterRelease = parse(
        await client.callTool({ name: "get_context", arguments: { detail: "summary" } }),
      );
      console.log("after release:", afterRelease.data.assistant);

      const respawnAlive = parse(await client.callTool({ name: "respawn", arguments: {} }));
      console.log("respawn while alive (expected error):", respawnAlive);
    } else {
      console.log("no ally found for command test");
    }

    if (seed?.enemy) {
      const attacked = parse(
        await client.callTool({
          name: "attack",
          arguments: { target: { unitId: seed.enemy.id } },
        }),
      );
      console.log("attack:", attacked);
      let attackResult: any;
      for (let attempt = 0; attempt < 16; attempt++) {
        attackResult = parse(
          await client.callTool({ name: "get_action_result", arguments: { opId: attacked.data?.opId, waitMs: 500 } }),
        );
        const health = attackResult.data?.data?.targetHealth;
        if (attackResult.data?.status !== "running" || health === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      console.log("attack result:", attackResult);
    }

    if (seed?.ore) {
      const oreCenter = { x: seed.ore.x * 8 + 4, y: seed.ore.y * 8 + 4 };
      const oreMove = parse(await client.callTool({ name: "move_to", arguments: oreCenter }));
      await client.callTool({ name: "get_action_result", arguments: { opId: oreMove.data?.opId, waitMs: 5000 } });
      const mined = parse(
        await client.callTool({ name: "mine", arguments: { x: seed.ore.x, y: seed.ore.y } }),
      );
      console.log("mine:", mined);
      let mineResult: any = mined;
      if (mined.ok) {
        for (let attempt = 0; attempt < 12; attempt++) {
          mineResult = parse(
            await client.callTool({ name: "get_action_result", arguments: { opId: mined.data?.opId, waitMs: 500 } }),
          );
          if (mineResult.data?.status !== "running") break;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      console.log("mine result:", mineResult);
      const afterMine = parse(await client.callTool({ name: "get_context", arguments: { detail: "summary" } }));
      console.log("carry after mine:", afterMine.data.assistant.item, afterMine.data.assistant.itemAmount);
    }
  }

  const events = parse(await client.callTool({ name: "get_events", arguments: { since: 0, limit: 20 } }));
  console.log("events:", events.data.events.map((event: { type: string }) => event.type));

  if (!probeMode) {
    const possessed = parse(await client.callTool({ name: "possess", arguments: { unitId: 200 } }));
    console.log("possess:", possessed.data);
    const released = parse(await client.callTool({ name: "release", arguments: {} }));
    console.log("release:", released.data);
  } else {
    console.log("probe mode: skip possess/release (not implemented by probe adapter)");
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
