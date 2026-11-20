import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const childEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ),
  MINDUSTRY_AI_ADAPTER: "mock",
  MCP_WRITE_RATE_LIMIT: "1",
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/src/index.js"],
  cwd: process.cwd(),
  env: childEnv,
  stderr: "inherit",
});

const client = new Client({ name: "mindustry-rate-harness", version: "0.1.0" });

function parse(result: unknown): any {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((item) => item.type === "text")?.text ?? "{}";
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function main(): Promise<void> {
  await client.connect(transport);
  const first = parse(await client.callTool({ name: "move_to", arguments: { x: 20, y: 20 } }));
  const secondRaw = await client.callTool({ name: "move_to", arguments: { x: 24, y: 20 } });
  const second = parse(secondRaw);
  const ok =
    first.ok === true &&
    (secondRaw as { isError?: boolean }).isError === true &&
    second.error?.code === "rate_limited";
  console.log(JSON.stringify({ ok, firstOk: first.ok, secondError: second.error }));
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
