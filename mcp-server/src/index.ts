#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { MockGameAdapter } from "./adapters/MockGameAdapter.js";
import { createMcpServer } from "./server.js";

const adapter = new MockGameAdapter({ autoTick: true });
const server = createMcpServer(adapter);
const transport = new StdioServerTransport();

await server.connect(transport);

const shutdown = async (): Promise<void> => {
  try {
    await server.close();
  } finally {
    await adapter.close();
    process.exit(0);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
