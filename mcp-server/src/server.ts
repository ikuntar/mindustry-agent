import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  ConfigValue,
  GameAdapter,
  GameError,
} from "./types.js";

const detailSchema = z.enum(["summary", "normal", "full"]);
const contentSchema = z.enum(["all", "blocks", "units", "items", "liquids"]);
const commandSchema = z.enum([
  "move",
  "attack",
  "repair",
  "rebuild",
  "assist",
  "mine",
  "enterPayload",
  "loadUnits",
  "loadBlocks",
  "unloadPayload",
  "loopPayload",
]);
const stanceSchema = z.enum([
  "stop",
  "holdFire",
  "pursueTarget",
  "patrol",
  "ram",
  "boost",
  "holdPosition",
  "mineAuto",
]);

const configValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ item: z.string() }),
  z.object({ liquid: z.string() }),
  z.object({ block: z.string() }),
  z.object({ unit: z.string() }),
  z.object({ x: z.number(), y: z.number() }),
]);

const targetSchema = z.object({
  unitId: z.number().int().optional(),
  buildingId: z.number().int().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

const placementSchema = z.object({
  block: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  rotation: z.number().int().optional(),
  config: configValueSchema.optional(),
});

function textResult(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError,
  };
}

async function run<T>(fn: () => Promise<T>): Promise<CallToolResult> {
  try {
    return textResult({ ok: true, data: await fn() });
  } catch (error) {
    const code = error instanceof GameError ? error.code : "internal_error";
    const message = error instanceof Error ? error.message : String(error);
    return textResult({ ok: false, error: { code, message } }, true);
  }
}

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

export function createMcpServer(adapter: GameAdapter): McpServer {
  const server = new McpServer(
    { name: "mindustry-ai-assistant", version: "0.1.0" },
    {
      maxToolInputElements: 4096,
      instructions: [
        "Mindustry AI assistant tool interface.",
        "Read get_context/get_capabilities before acting.",
        "Write tools return {accepted, opId}; use get_action_result to poll.",
        "All actions are performed by the assistant unit/team, not by the human player.",
        "No chat UI is exposed; this is a tool-only interface for a harness or MCP host.",
      ].join(" "),
    },
  );

  // ---------------------------------------------------------------- read

  server.registerTool(
    "get_context",
    {
      description: "Read a compact game context: assistant, player, team resources, cores, nearby entities, wave, current action.",
      inputSchema: {
        detail: detailSchema.optional(),
        radius: z.number().positive().optional(),
        since: z.number().int().nonnegative().optional(),
      },
      annotations: readOnly,
    },
    async (args) => run(() => adapter.getContext(args)),
  );

  server.registerTool(
    "get_capabilities",
    {
      description: "Read the current assistant body's capabilities: build/mine/attack ranges, capacities, weapons, commands.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => run(() => adapter.getCapabilities()),
  );

  server.registerTool(
    "get_content",
    {
      description: "Read the content registry for blocks, units, items, or liquids.",
      inputSchema: { type: contentSchema.optional() },
      annotations: readOnly,
    },
    async (args) => run(() => adapter.getContent(args.type)),
  );

  server.registerTool(
    "get_map_summary",
    {
      description:
        "Read a map DatasetRef and schema without tile data. Use the read-only data plane (or a client SDK) for the snapshot.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => run(() => adapter.getMapSummary()),
  );

  server.registerTool(
    "get_events",
    {
      description: "Read game events after a sequence number. Events are buffered and may report drops.",
      inputSchema: {
        since: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(200).optional(),
        summary: z.boolean().optional(),
        types: z.array(z.string()).max(32).optional(),
      },
      annotations: readOnly,
    },
    async (args) =>
      run(() => adapter.getEvents(args.since ?? 0, args.limit ?? 50, args.summary ?? false, args.types)),
  );

  server.registerTool(
    "query_area",
    {
      description: "Read units and buildings in a circular area around a point. Set includeEnemies to include non-assistant-team units.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        radius: z.number().positive(),
        includeUnits: z.boolean().optional(),
        includeBuildings: z.boolean().optional(),
        includeEnemies: z.boolean().optional(),
      },
      annotations: readOnly,
    },
    async (args) => run(() => adapter.queryArea(args)),
  );

  server.registerTool(
    "get_area",
    {
      description:
        "Read a bounded tile window for hosts without code execution. Returns block/team/drop/solid per tile, never the full map.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        radius: z.number().int().positive().max(24),
        maxTiles: z.number().int().positive().max(512).optional(),
      },
      annotations: readOnly,
    },
    async (args) => run(() => adapter.getArea(args)),
  );

  server.registerTool(
    "get_config_schema",
    {
      description: "Read the configuration value schema for a block.",
      inputSchema: { block: z.string() },
      annotations: readOnly,
    },
    async (args) => run(() => adapter.getConfigSchema(args.block)),
  );

  server.registerTool(
    "get_action_result",
    {
      description: "Get or briefly wait for an action result by opId.",
      inputSchema: {
        opId: z.string(),
        waitMs: z.number().int().nonnegative().max(5000).optional(),
      },
      annotations: readOnly,
    },
    async (args) => run(() => adapter.getActionResult(args.opId, args.waitMs ?? 0)),
  );

  // ---------------------------------------------------------------- unit actions

  server.registerTool(
    "move_to",
    {
      description: "Move the assistant body to a tile coordinate. Returns an operation to poll.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        arriveRadius: z.number().positive().optional(),
      },
    },
    async (args) => run(() => adapter.moveTo(args.x, args.y, args.arriveRadius)),
  );

  server.registerTool(
    "attack",
    {
      description: "Attack a unit, building, or position with the assistant body.",
      inputSchema: { target: targetSchema },
    },
    async (args) => run(() => adapter.attack(args.target)),
  );

  server.registerTool(
    "follow",
    {
      description: "Follow a unit at an optional distance.",
      inputSchema: {
        unitId: z.number().int(),
        distance: z.number().positive().optional(),
      },
    },
    async (args) => run(() => adapter.follow(args.unitId, args.distance)),
  );

  server.registerTool(
    "mine",
    {
      description: "Mine at a tile coordinate; the assistant must be within its mine range.",
      inputSchema: { x: z.number(), y: z.number() },
    },
    async (args) => run(() => adapter.mine(args.x, args.y)),
  );

  server.registerTool(
    "stop",
    {
      description: "Stop the current assistant action.",
      inputSchema: {},
    },
    async () => run(() => adapter.stop()),
  );

  // ---------------------------------------------------------------- build / repair

  server.registerTool(
    "build_plan",
    {
      description: "Queue a batch of placements and optional deconstructions. Each block is validated, paid for, and built over time.",
      inputSchema: {
        placements: z.array(placementSchema).max(256),
        deconstruct: z.array(z.object({ x: z.number().int(), y: z.number().int() })).max(256).optional(),
        allowPartial: z.boolean().optional(),
      },
    },
    async (args) =>
      run(() =>
        adapter.buildPlan({
          placements: args.placements,
          deconstruct: args.deconstruct,
          allowPartial: args.allowPartial,
        }),
      ),
  );

  server.registerTool(
    "deconstruct",
    {
      description: "Deconstruct buildings at tile coordinates.",
      inputSchema: {
        targets: z.array(z.object({ x: z.number().int(), y: z.number().int() })).min(1).max(256),
      },
    },
    async (args) => run(() => adapter.deconstruct(args.targets)),
  );

  server.registerTool(
    "repair",
    {
      description: "Repair a building at a tile coordinate.",
      inputSchema: { x: z.number(), y: z.number() },
    },
    async (args) => run(() => adapter.repair({ x: args.x, y: args.y })),
  );

  // ---------------------------------------------------------------- logistics

  server.registerTool(
    "withdraw",
    {
      description: "Withdraw items from a same-team building within transfer range.",
      inputSchema: {
        target: z.object({
          buildingId: z.number().int().optional(),
          x: z.number().optional(),
          y: z.number().optional(),
        }),
        item: z.string(),
        amount: z.number().int().positive(),
      },
    },
    async (args) => run(() => adapter.withdraw(args.target, args.item, args.amount)),
  );

  server.registerTool(
    "deposit",
    {
      description: "Deposit items carried by the assistant into a same-team building within transfer range.",
      inputSchema: {
        target: z.object({
          buildingId: z.number().int().optional(),
          x: z.number().optional(),
          y: z.number().optional(),
        }),
        item: z.string(),
        amount: z.number().int().positive(),
      },
    },
    async (args) => run(() => adapter.deposit(args.target, args.item, args.amount)),
  );

  // ---------------------------------------------------------------- configure

  server.registerTool(
    "configure",
    {
      description: "Configure a same-team building. Use get_config_schema for valid values.",
      inputSchema: {
        x: z.number().int(),
        y: z.number().int(),
        value: configValueSchema,
      },
    },
    async (args) => run(() => adapter.configure(args.x, args.y, args.value as ConfigValue)),
  );

  // ---------------------------------------------------------------- command

  server.registerTool(
    "command_units",
    {
      description: "Issue a command to same-team AI-controlled units.",
      inputSchema: {
        unitIds: z.array(z.number().int()).max(256).optional(),
        command: commandSchema,
        target: targetSchema.optional(),
        queue: z.boolean().optional(),
        stance: stanceSchema.optional(),
      },
    },
    async (args) =>
      run(() =>
        adapter.commandUnits({
          unitIds: args.unitIds,
          command: args.command,
          target: args.target,
          queue: args.queue,
          stance: args.stance,
        }),
      ),
  );

  server.registerTool(
    "set_stance",
    {
      description: "Set a stance on same-team AI-controlled units.",
      inputSchema: {
        unitIds: z.array(z.number().int()).min(1).max(256),
        stance: stanceSchema,
      },
    },
    async (args) => run(() => adapter.setStance(args.unitIds, args.stance)),
  );

  // ---------------------------------------------------------------- possession / respawn

  server.registerTool(
    "possess",
    {
      description: "Possess a same-team, AI-controlled, player-controllable unit. The assistant's current home body is removed.",
      inputSchema: { unitId: z.number().int() },
    },
    async (args) => run(() => adapter.possess(args.unitId)),
  );

  server.registerTool(
    "release",
    {
      description: "Release a possessed body and respawn the assistant's home body at a core.",
      inputSchema: {},
    },
    async () => run(() => adapter.release()),
  );

  server.registerTool(
    "respawn",
    {
      description: "Respawn the assistant at a core. Only valid while dead; bypasses unit population like player respawn.",
      inputSchema: { coreId: z.number().int().optional() },
    },
    async (args) => run(() => adapter.respawn(args.coreId)),
  );

  server.registerTool(
    "cancel",
    {
      description: "Cancel an action by opId, or the current action if opId is omitted.",
      inputSchema: { opId: z.string().optional() },
    },
    async (args) => run(() => adapter.cancel(args.opId)),
  );

  return server;
}
