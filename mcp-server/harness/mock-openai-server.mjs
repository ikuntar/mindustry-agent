import http from "node:http";

const port = Number(process.env.MOCK_LLM_PORT ?? 18080);
let requests = 0;

const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404);
    response.end("not found");
    return;
  }
  let body = "";
  request.on("data", (chunk) => {
    body += chunk.toString();
  });
  request.on("end", () => {
    requests++;
    const payload = JSON.parse(body);
    const messages = payload.messages ?? [];
    const hasToolResult = messages.some((message) => message.role === "tool");
    const message = hasToolResult
      ? { role: "assistant", content: "Mock model read the context and stopped." }
      : {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `mock-http-${requests}`,
              type: "function",
              function: { name: "get_context", arguments: JSON.stringify({ detail: "summary" }) },
            },
          ],
        };
    const result = {
      id: `mock-${requests}`,
      object: "chat.completion",
      model: payload.model ?? "mock",
      choices: [{ index: 0, message, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock OpenAI endpoint: http://127.0.0.1:${port}/v1`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
