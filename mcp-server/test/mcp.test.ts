import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { MockGameAdapter } from "../src/adapters/MockGameAdapter.js";
import { createMcpServer } from "../src/server.js";

interface Connected {
  adapter: MockGameAdapter;
  client: Client;
  close: () => Promise<void>;
}

async function connect(): Promise<Connected> {
  const adapter = new MockGameAdapter({ autoTick: false });
  const server = createMcpServer(adapter);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "mcp-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    adapter,
    client,
    close: async () => {
      await client.close();
      await server.close();
      await adapter.close();
    },
  };
}

function parse(result: unknown): any {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Tool result has no text content");
  return JSON.parse(text);
}

test("mcp: exposes the core read and action tools", async () => {
  const c = await connect();
  try {
    const listed = await c.client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    for (const expected of [
      "get_context",
      "get_capabilities",
      "get_events",
      "build_plan",
      "withdraw",
      "configure",
      "command_units",
      "possess",
      "release",
      "respawn",
    ]) {
      assert.ok(names.includes(expected), `missing tool ${expected}`);
    }
  } finally {
    await c.close();
  }
});

test("mcp: context and capabilities are readable", async () => {
  const c = await connect();
  try {
    const context = parse(await c.client.callTool({ name: "get_context", arguments: { detail: "summary" } }));
    assert.equal(context.ok, true);
    assert.equal(context.data.assistant.type, "alpha");
    assert.equal(context.data.team, 1);

    const caps = parse(await c.client.callTool({ name: "get_capabilities", arguments: {} }));
    assert.equal(caps.ok, true);
    assert.equal(caps.data.canBuild, true);
    assert.ok(caps.data.buildRange > 0);
  } finally {
    await c.close();
  }
});

test("mcp: move_to is async and observable through get_action_result", async () => {
  const c = await connect();
  try {
    const moved = parse(await c.client.callTool({ name: "move_to", arguments: { x: 25, y: 20 } }));
    assert.equal(moved.ok, true);
    assert.equal(moved.data.status, "queued");
    const opId = moved.data.opId as string;

    for (let i = 0; i < 10; i++) c.adapter.advance(50);
    const result = parse(await c.client.callTool({ name: "get_action_result", arguments: { opId } }));
    assert.equal(result.ok, true);
    assert.equal(result.data.status, "done");
  } finally {
    await c.close();
  }
});

test("mcp: build_plan, events and resources work end to end", async () => {
  const c = await connect();
  try {
    const before = 500;
    const planned = parse(
      await c.client.callTool({
        name: "build_plan",
        arguments: {
          placements: [
            { block: "conveyor", x: 20, y: 21 },
            { block: "conveyor", x: 21, y: 21 },
          ],
        },
      }),
    );
    assert.equal(planned.ok, true);
    assert.equal(planned.data.status, "running");
    assert.equal(c.adapter.resources.copper, before - 20);

    for (let i = 0; i < 10; i++) c.adapter.advance(50);
    const result = parse(
      await c.client.callTool({ name: "get_action_result", arguments: { opId: planned.data.opId } }),
    );
    assert.equal(result.data.status, "done");

    const events = parse(await c.client.callTool({ name: "get_events", arguments: { since: 0, limit: 50 } }));
    assert.equal(events.ok, true);
    assert.ok(events.data.events.some((event: { type: string }) => event.type === "build_complete"));
  } finally {
    await c.close();
  }
});

test("mcp: logistics, configure, command, possess, release and respawn", async () => {
  const c = await connect();
  try {
    const withdrawn = parse(
      await c.client.callTool({
        name: "withdraw",
        arguments: { target: { buildingId: 1000 }, item: "copper", amount: 30 },
      }),
    );
    assert.equal(withdrawn.ok, true);

    const configured = parse(
      await c.client.callTool({ name: "configure", arguments: { x: 16, y: 15, value: { item: "copper" } } }),
    );
    assert.equal(configured.ok, true);

    const commanded = parse(
      await c.client.callTool({
        name: "command_units",
        arguments: { unitIds: [200], command: "attack", target: { unitId: 500 } },
      }),
    );
    assert.equal(commanded.ok, true);

    const possessed = parse(await c.client.callTool({ name: "possess", arguments: { unitId: 200 } }));
    assert.equal(possessed.ok, true);
    let context = parse(await c.client.callTool({ name: "get_context", arguments: { detail: "summary" } }));
    assert.equal(context.data.assistant.type, "dagger");
    assert.equal(context.data.assistant.possessing, true);

    const released = parse(await c.client.callTool({ name: "release", arguments: {} }));
    assert.equal(released.ok, true);
    context = parse(await c.client.callTool({ name: "get_context", arguments: { detail: "summary" } }));
    assert.equal(context.data.assistant.type, "alpha");
    assert.equal(context.data.assistant.isHome, true);

    c.adapter.killAssistant();
    const respawned = parse(await c.client.callTool({ name: "respawn", arguments: { coreId: 1001 } }));
    assert.equal(respawned.ok, true);
    context = parse(await c.client.callTool({ name: "get_context", arguments: { detail: "summary" } }));
    assert.equal(context.data.assistant.x, 30);
    assert.equal(context.data.assistant.y, 30);
  } finally {
    await c.close();
  }
});

test("mcp: invalid actions return structured tool errors", async () => {
  const c = await connect();
  try {
    const result = parse(await c.client.callTool({ name: "possess", arguments: { unitId: 500 } }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "wrong_team");
  } finally {
    await c.close();
  }
});
