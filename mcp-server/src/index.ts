#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { MockGameAdapter } from "./adapters/MockGameAdapter.js";
import { ProbeGameAdapter } from "./adapters/ProbeGameAdapter.js";
import { createMcpServer } from "./server.js";

const adapterMode = (process.env.MINDUSTRY_AI_ADAPTER ?? "mock").toLowerCase();
const adapter =
  adapterMode === "probe"
    ? new ProbeGameAdapter({
        host: process.env.PROBE_HOST,
        port: process.env.PROBE_PORT ? Number(process.env.PROBE_PORT) : undefined,
      })
    : new MockGameAdapter({ autoTick: true });
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
