import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const probeMode = (process.env.MINDUSTRY_AI_ADAPTER ?? "mock").toLowerCase() === "probe";
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
  return JSON.parse(text);
}

async function main(): Promise<void> {
  await client.connect(transport);

  const listed = await client.listTools();
  console.log(`tools: ${listed.tools.length}`);
  console.log(listed.tools.map((tool) => tool.name).join(", "));

  const context = parse(await client.callTool({ name: "get_context", arguments: { detail: "summary" } }));
  console.log("context:", JSON.stringify(context.data, null, 2));

  const core = context.data.cores?.[0];
  const moveTarget = probeMode && core
    ? { x: core.x + 24, y: core.y }
    : { x: 25, y: 20 };
  const moved = parse(await client.callTool({ name: "move_to", arguments: moveTarget }));
  console.log("move queued:", moved.data);
  const moveResult = parse(
    await client.callTool({ name: "get_action_result", arguments: { opId: moved.data.opId, waitMs: 1500 } }),
  );
  console.log("move result:", moveResult.data);

  const placements = probeMode && core
    ? [{
        block: "conveyor",
        x: Math.floor(core.x / 8) + (Math.floor(core.x / 8) + 4 < (context.data.worldWidth ?? 256) ? 4 : -4),
        y: Math.floor(core.y / 8),
      }]
    : [
        { block: "conveyor", x: 20, y: 21 },
        { block: "router", x: 21, y: 21 },
      ];
  const planned = parse(
    await client.callTool({
      name: "build_plan",
      arguments: { placements },
    }),
  );
  console.log("build queued:", planned.data);
  const buildResult = parse(
    await client.callTool({ name: "get_action_result", arguments: { opId: planned.data.opId, waitMs: 1500 } }),
  );
  console.log("build result:", buildResult.data);

  if (probeMode) {
    const built = buildResult.data?.data;
    if (!built) throw new Error("probe build returned no data");
    let found: any;
    for (let attempt = 0; attempt < 5 && !found; attempt++) {
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
