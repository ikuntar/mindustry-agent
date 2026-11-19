import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/src/index.js"],
  cwd: process.cwd(),
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

  const moved = parse(await client.callTool({ name: "move_to", arguments: { x: 25, y: 20 } }));
  console.log("move queued:", moved.data);
  const moveResult = parse(
    await client.callTool({ name: "get_action_result", arguments: { opId: moved.data.opId, waitMs: 1500 } }),
  );
  console.log("move result:", moveResult.data);

  const planned = parse(
    await client.callTool({
      name: "build_plan",
      arguments: {
        placements: [
          { block: "conveyor", x: 20, y: 21 },
          { block: "router", x: 21, y: 21 },
        ],
      },
    }),
  );
  console.log("build queued:", planned.data);
  const buildResult = parse(
    await client.callTool({ name: "get_action_result", arguments: { opId: planned.data.opId, waitMs: 1500 } }),
  );
  console.log("build result:", buildResult.data);

  const events = parse(await client.callTool({ name: "get_events", arguments: { since: 0, limit: 20 } }));
  console.log("events:", events.data.events.map((event: { type: string }) => event.type));

  const possessed = parse(await client.callTool({ name: "possess", arguments: { unitId: 200 } }));
  console.log("possess:", possessed.data);
  const released = parse(await client.callTool({ name: "release", arguments: {} }));
  console.log("release:", released.data);

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
