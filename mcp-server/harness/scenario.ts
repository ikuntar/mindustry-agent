import fs from "node:fs";

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

async function waitAction(opId: string, waitMs = 5000): Promise<any> {
  const result = await tool("get_action_result", { opId, waitMs });
  check(`action ${opId} done`, result.status === "done", String(result.status));
  return result;
}

async function main(): Promise<void> {
  await client.connect(transport);
  const started = Date.now();

  const context = await tool("get_context", { detail: "full" });
  check("assistant exists", context.assistant?.id, JSON.stringify(context.assistant));
  check("assistant alive", !context.assistant.dead);
  check("assistant has core", context.cores?.length > 0);
  if (expectedMap) check(`fixed map ${expectedMap}`, context.map === expectedMap, String(context.map));

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
  let placementTile: { x: number; y: number } | undefined;
  const placementErrors: string[] = [];
  for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [5, 0], [-5, 0], [0, 5], [0, -5]]) {
    const attempted = parse(
      await client.callTool({
        name: "build_plan",
        arguments: { placements: [{ block: "conveyor", x: baseX + dx, y: baseY + dy }] },
      }),
    );
    if (attempted.ok) {
      placement = attempted.data;
      placementTile = { x: baseX + dx, y: baseY + dy };
      break;
    }
    placementErrors.push(`${dx},${dy}: ${attempted.error?.code ?? "error"}`);
  }
  check("build queued", placement, placementErrors.join("; "));
  await waitAction(placement.opId);
  const area = await tool("query_area", { x: core.x, y: core.y, radius: 96 });
  check(
    "built conveyor visible",
    area.buildings?.some(
      (building: { block: string; tileX: number; tileY: number }) =>
        building.block === "conveyor" &&
        building.tileX === placementTile?.x &&
        building.tileY === placementTile?.y,
    ),
    JSON.stringify(placementTile),
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
