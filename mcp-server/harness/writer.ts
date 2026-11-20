import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

const client = new Client({ name: "mindustry-writer-harness", version: "0.1.0" });

function parse(result: unknown): any {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((item) => item.type === "text")?.text ?? "";
  return JSON.parse(text);
}

async function main(): Promise<void> {
  await client.connect(transport);
  const context = parse(await client.callTool({ name: "get_context", arguments: { detail: "summary" } }));
  if (!context.ok) throw new Error(`get_context failed: ${JSON.stringify(context.error)}`);
  const assistant = context.data.assistant;
  const move = parse(
    await client.callTool({
      name: "move_to",
      arguments: { x: assistant.x + 12, y: assistant.y, arriveRadius: 8 },
    }),
  );
  if (!move.ok) throw new Error(`move_to failed: ${JSON.stringify(move.error)}`);
  const result = parse(
    await client.callTool({
      name: "get_action_result",
      arguments: { opId: move.data.opId, waitMs: 3000 },
    }),
  );
  console.log(
    JSON.stringify({
      ok: result.ok && (result.data.status === "done" || result.data.status === "running"),
      map: context.data.map,
      opId: move.data.opId,
      status: result.data.status,
    }),
  );
  if (!result.ok || (result.data.status !== "done" && result.data.status !== "running")) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
