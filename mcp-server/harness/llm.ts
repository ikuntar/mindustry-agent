import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Minimal OpenAI-compatible tool-calling harness.
 *
 * This intentionally has no provider SDK: any endpoint exposing
 * POST {LLM_BASE_URL}/chat/completions with OpenAI tools works.
 * LLM_MOCK=1 runs a deterministic local planner so the MCP loop and
 * metrics can be tested without credentials or network access.
 */

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface Tool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const baseUrl = (process.env.LLM_BASE_URL ?? "http://127.0.0.1:8000/v1").replace(/\/$/, "");
const model = process.env.LLM_MODEL ?? "mock-model";
const task = process.env.LLM_TASK ?? "Read the game context, summarize the assistant's situation, and report one safe next action. Do not mutate the world.";
const mock = process.env.LLM_MOCK === "1";
const maxSteps = Number(process.env.LLM_MAX_STEPS ?? 6);

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

const client = new Client({ name: "mindustry-ai-llm-harness", version: "0.1.0" });

function parse(result: unknown): { text: string; parsed?: unknown } {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((item) => item.type === "text")?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { text, parsed };
}

function toOpenAITools(tools: Tool[]): { type: "function"; function: Record<string, unknown> }[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  }));
}

async function callModel(messages: ChatMessage[], tools: Tool[]): Promise<{
  message: ChatMessage;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}> {
  if (mock) {
    const sawContext = messages.some(
      (message) => message.role === "tool" && message.content?.includes("\"assistant\""),
    );
    if (!sawContext) {
      return {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "mock-context",
              type: "function",
              function: { name: "get_context", arguments: JSON.stringify({ detail: "summary" }) },
            },
          ],
        },
      };
    }
    return {
      message: { role: "assistant", content: "Context read. No world mutation requested." },
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      tools: toOpenAITools(tools),
      tool_choice: "auto",
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    choices?: { message?: ChatMessage }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("LLM returned no message");
  return { message, usage: payload.usage };
}

async function main(): Promise<void> {
  const started = Date.now();
  await client.connect(transport);
  const listed = await client.listTools();
  const tools = listed.tools as Tool[];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a Mindustry co-op assistant. Use the provided MCP tools to inspect the game. " +
        "Never claim an action succeeded without checking its action result. Prefer read-only tools unless the task asks for an action.",
    },
    { role: "user", content: task },
  ];
  let toolCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let finalContent = "";
  const toolLog: { name: string; ok: boolean; elapsedMs: number; result: string }[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const { message, usage } = await callModel(messages, tools);
    promptTokens += usage?.prompt_tokens ?? 0;
    completionTokens += usage?.completion_tokens ?? 0;
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (!calls.length) {
      finalContent = message.content ?? "";
      break;
    }
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const callStarted = Date.now();
      try {
        const result = await client.callTool({ name: call.function.name, arguments: args });
        const { text } = parse(result);
        toolCalls++;
        toolLog.push({ name: call.function.name, ok: true, elapsedMs: Date.now() - callStarted, result: text.slice(0, 500) });
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
      } catch (error) {
        toolCalls++;
        const text = String(error);
        toolLog.push({ name: call.function.name, ok: false, elapsedMs: Date.now() - callStarted, result: text });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, error: text }) });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        model,
        mock,
        task,
        tools: tools.length,
        toolCalls,
        promptTokens,
        completionTokens,
        finalContent,
        elapsedMs: Date.now() - started,
        toolLog,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
