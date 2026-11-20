import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const childEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ),
  MINDUSTRY_AI_ADAPTER: "mock",
  MCP_ALLOWED_TOOLS: "get_context",
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/src/index.js"],
  cwd: process.cwd(),
  env: childEnv,
  stderr: "inherit",
});

const client = new Client({ name: "mindustry-allowlist-harness", version: "0.1.0" });

function parse(result: unknown): any {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((item) => item.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

async function main(): Promise<void> {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  const context = parse(await client.callTool({ name: "get_context", arguments: { detail: "summary" } }));
  let moveRejected = false;
  try {
    const result = await client.callTool({ name: "move_to", arguments: { x: 20, y: 20 } });
    moveRejected = (result as { isError?: boolean }).isError === true;
  } catch {
    moveRejected = true;
  }
  const ok = names.length === 1 && names[0] === "get_context" && context.ok && moveRejected;
  console.log(JSON.stringify({ ok, tools: names, contextOk: context.ok, moveRejected }));
  if (!ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
