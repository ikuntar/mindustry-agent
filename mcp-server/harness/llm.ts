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
const requestTimeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 120000);
const maxRetries = Number(process.env.LLM_MAX_RETRIES ?? 1);
const retryBackoffMs = Number(process.env.LLM_RETRY_BACKOFF_MS ?? 500);
let llmRetries = 0;

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
    if (task.toLowerCase().includes("withdraw") && task.toLowerCase().includes("deposit")) {
      const toolResults = messages.filter((message) => message.role === "tool").length;
      if (toolResults === 1) {
        return {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "mock-withdraw",
                type: "function",
                function: {
                  name: "withdraw",
                  arguments: JSON.stringify({ target: { buildingId: 1000 }, item: "copper", amount: 5 }),
                },
              },
            ],
          },
        };
      }
      if (toolResults === 2) {
        return {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "mock-deposit",
                type: "function",
                function: {
                  name: "deposit",
                  arguments: JSON.stringify({ target: { buildingId: 1000 }, item: "copper", amount: 5 }),
                },
              },
            ],
          },
        };
      }
    }
    return {
      message: { role: "assistant", content: "Context read. No world mutation requested." },
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    };
  }

  let response: Response;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers: {
          "Content-Type": "application/json",
          ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          tools: toOpenAITools(tools),
          tool_choice: process.env.LLM_TOOL_CHOICE ?? "auto",
        }),
      });
    } catch (error) {
      lastError =
        error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
          ? new Error(`LLM request timed out after ${requestTimeoutMs}ms`)
          : error instanceof Error
            ? error
            : new Error(String(error));
      if (attempt < maxRetries) {
        llmRetries++;
        await new Promise((resolve) => setTimeout(resolve, retryBackoffMs));
        continue;
      }
      throw lastError;
    }
    if (!response.ok) {
      const text = await response.text();
      lastError = new Error(`LLM request failed: ${response.status} ${text}`);
      if (attempt < maxRetries && (response.status >= 500 || response.status === 429)) {
        llmRetries++;
        await new Promise((resolve) => setTimeout(resolve, retryBackoffMs));
        continue;
      }
      throw lastError;
    }
    break;
  }
  if (!response!) throw lastError ?? new Error("LLM request failed without response");
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
  const toolFilter = (process.env.LLM_TOOL_FILTER ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const tools = (listed.tools as Tool[]).filter((tool) => !toolFilter.length || toolFilter.includes(tool.name));
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
  let finalContext: unknown;
  let verification: { expectedX: number; expectedY: number; tolerance: number; actualX?: number; actualY?: number; ok?: boolean } | undefined;
  const toolLog: { name: string; arguments?: Record<string, unknown>; ok: boolean; elapsedMs: number; result: string }[] = [];

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
        toolLog.push({ name: call.function.name, arguments: args, ok: true, elapsedMs: Date.now() - callStarted, result: text.slice(0, 500) });
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
      } catch (error) {
        toolCalls++;
        const text = String(error);
        toolLog.push({ name: call.function.name, arguments: args, ok: false, elapsedMs: Date.now() - callStarted, result: text });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, error: text }) });
      }
    }
  }

  if (process.env.LLM_FINAL_CONTEXT === "1") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = await client.callTool({ name: "get_context", arguments: { detail: "summary" } });
    finalContext = parse(result).parsed;
  }

  if (process.env.LLM_EXPECT_NEAR_X != null && process.env.LLM_EXPECT_NEAR_Y != null) {
    const expectedX = Number(process.env.LLM_EXPECT_NEAR_X);
    const expectedY = Number(process.env.LLM_EXPECT_NEAR_Y);
    const tolerance = Number(process.env.LLM_EXPECT_TOLERANCE ?? 32);
    const context = finalContext as { data?: { assistant?: { x?: number; y?: number } } } | undefined;
    const actualX = context?.data?.assistant?.x;
    const actualY = context?.data?.assistant?.y;
    const ok =
      actualX != null &&
      actualY != null &&
      Math.hypot(actualX - expectedX, actualY - expectedY) <= tolerance;
    verification = { expectedX, expectedY, tolerance, actualX, actualY, ok };
    if (!ok) process.exitCode = 1;
  }

  if (process.env.LLM_REQUIRE_TOOLS) {
    const required = process.env.LLM_REQUIRE_TOOLS.split(",").map((name) => name.trim()).filter(Boolean);
    const missing = required.filter(
      (name) => !toolLog.some((entry) => entry.name === name && entry.ok && entry.result.includes('"ok": true')),
    );
    if (missing.length) {
      console.error(`LLM did not successfully call required tools: ${missing.join(", ")}`);
      process.exitCode = 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: process.exitCode !== 1,
        model,
        mock,
        task,
        tools: tools.length,
        toolCalls,
        promptTokens,
        completionTokens,
        llmRetries,
        finalContent,
        finalContext,
        verification,
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
