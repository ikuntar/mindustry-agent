import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = new URL("../..", import.meta.url).pathname;
const childEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ),
  MINDUSTRY_AI_ADAPTER: process.env.MINDUSTRY_AI_ADAPTER ?? "mock",
};

function parse(result: unknown): any {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("tool result has no text content");
  return JSON.parse(text);
}

const transport = new StdioClientTransport({
  command: `${root}/scripts/mindustry-mcp`,
  cwd: root,
  env: childEnv,
  stderr: "inherit",
});
const client = new Client({ name: "mindustry-host-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  if (listed.tools.length !== 27) throw new Error(`expected 27 tools, got ${listed.tools.length}`);
  const context = parse(await client.callTool({ name: "get_context", arguments: { detail: "summary" } }));
  if (!context.ok) throw new Error(`get_context failed: ${JSON.stringify(context)}`);
  const core = context.data?.cores?.[0];
  const target = core ? { x: core.x + 24, y: core.y } : { x: 24, y: 20 };
  const moved = parse(await client.callTool({ name: "move_to", arguments: target }));
  if (!moved.ok) throw new Error(`move_to failed: ${JSON.stringify(moved)}`);
  const result = parse(
    await client.callTool({ name: "get_action_result", arguments: { opId: moved.data.opId, waitMs: 300 } }),
  );
  if (result.data?.status !== "done") throw new Error(`move did not finish: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({
    ok: true,
    tools: listed.tools.length,
    adapter: childEnv.MINDUSTRY_AI_ADAPTER,
    moveStatus: result.data.status,
  }));
} finally {
  await client.close();
}
