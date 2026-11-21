import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const info = JSON.parse(fs.readFileSync("/tmp/mindustry-ai-probe/bridge-info.json", "utf8"));
const base = `http://127.0.0.1:${info.sessionPort}`;

async function openSession(): Promise<string> {
  const response = await fetch(base + "/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${info.sessionBootstrapToken}`,
    },
  });
  if (response.status !== 200) throw new Error(`session ${response.status}`);
  return ((await response.json()) as { sessionToken: string }).sessionToken;
}

const token = await openSession();
const transport = new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "mindustry-sdk-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.log("sdk tools", tools.tools.length);

  const resources = await client.listResources();
  console.log("sdk resources", resources.resources.length);
  if (resources.resources.length !== 1) process.exitCode = 1;

  const guide = await client.readResource({ uri: "mindustry://guide" });
  const firstContent = guide.contents?.[0];
  const guideText = firstContent && "text" in firstContent ? firstContent.text : undefined;
  console.log("sdk guide", typeof guideText === "string" && guideText.startsWith("# Mindustry AI session"));
  if (typeof guideText !== "string" || !guideText.startsWith("# Mindustry AI session")) process.exitCode = 1;

  const prompts = await client.listPrompts();
  console.log("sdk prompts", prompts.prompts.length);
  if (prompts.prompts.length !== 3) process.exitCode = 1;

  const prompt = await client.getPrompt({ name: "defend-core" });
  const promptMessage = prompt.messages?.[0];
  const promptText = promptMessage && "content" in promptMessage && promptMessage.content.type === "text"
    ? promptMessage.content.text
    : undefined;
  console.log("sdk prompt text", typeof promptText === "string" && promptText.includes("Defend the team core"));
  if (typeof promptText !== "string" || !promptText.includes("Defend the team core")) process.exitCode = 1;

  const context = (await client.callTool({
    name: "get_context",
    arguments: { detail: "summary" },
  })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  const text = context.content?.find((item) => item.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as { map?: string; assistant?: { x: number; y: number } };
  console.log("sdk context", parsed.map, parsed.assistant?.x, parsed.assistant?.y);

  const move = (await client.callTool({
    name: "move_to",
    arguments: { x: Number(parsed.assistant?.x ?? 0) + 24, y: Number(parsed.assistant?.y ?? 0) },
  })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  const moveText = move.content?.find((item) => item.type === "text")?.text ?? "";
  const moveData = JSON.parse(moveText) as { opId?: string; status?: string };
  console.log("sdk move", moveData.opId, moveData.status);
  if (!moveData.opId) process.exitCode = 1;
} finally {
  await client.close();
}
