import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { structuredError } from "../errors.js";
import {
  ActionLog,
  ActionResult,
  AreaQuery,
  AreaSnapshot,
  AreaTileQuery,
  AreaTileSnapshot,
  AssistantSnapshot,
  BuildPlanRequest,
  BuildingSnapshot,
  Capabilities,
  CommandTarget,
  CommandUnitsRequest,
  ConfigSchema,
  ConfigValue,
  ContentSnapshot,
  ContentType,
  ContextOptions,
  CoreSnapshot,
  EntityId,
  EventPage,
  GameAdapter,
  GameContext,
  GameError,
  MapSummary,
  OpStatus,
  TileSnapshot,
  UnitSnapshot,
  UnitStanceName,
  Vec2,
} from "../types.js";

interface ProbeResponse {
  id?: number;
  ok: boolean;
  data?: any;
  error?: { code?: string; message?: string };
}

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ProbeAdapterOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
  token?: string;
  heartbeatMs?: number;
}

/**
 * Real-game adapter for probe-mod.
 *
 * Connects to the local probe socket, performs a `hello` protocol handshake,
 * and maps the 24 MCP tools to real game operations where the probe supports
 * them. Unsupported operations fail explicitly rather than pretending to work.
 */
export class ProbeGameAdapter implements GameAdapter {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly token?: string;
  private readonly heartbeatMs: number;
  private socket?: net.Socket;
  private buffer = "";
  private nextId = 1;
  private actionSeq = 0;
  private handshaken = false;
  private writerToken?: string;
  private writerExpires = 0;
  private heartbeat?: NodeJS.Timeout;
  private pending = new Map<number, Pending>();

  constructor(options: ProbeAdapterOptions = {}) {
    let discovery: { port?: number; token?: string } | undefined;
    try {
      const discoveryPath =
        process.env.PROBE_DISCOVERY ?? path.join(os.tmpdir(), "mindustry-ai-probe", "bridge-info.json");
      discovery = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
    } catch {
      discovery = undefined;
    }
    this.host = options.host ?? process.env.PROBE_HOST ?? "127.0.0.1";
    this.port = options.port ?? Number(process.env.PROBE_PORT ?? discovery?.port ?? 46500);
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.token = options.token ?? process.env.PROBE_TOKEN ?? discovery?.token;
    this.heartbeatMs = options.heartbeatMs ?? Number(process.env.PROBE_HEARTBEAT_MS ?? 15000);
  }

  // ---------------------------------------------------------------- transport

  private connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new GameError("probe_unavailable", `Timed out connecting to ${this.host}:${this.port}`));
      }, this.timeoutMs);

      socket.once("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(new GameError("probe_unavailable", `Probe connection failed: ${error.message}`));
      });
      socket.on("data", (chunk) => this.handleData(chunk));
      socket.on("close", () => {
        this.socket = undefined;
        this.handshaken = false;
        this.stopHeartbeat();
        this.rejectAll(new GameError("probe_closed", "Probe socket closed"));
      });
    });
  }

  private async connectWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.connect();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new GameError("probe_unavailable", "Probe connection failed");
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.heartbeatMs <= 0) return;
    this.heartbeat = setInterval(() => {
      this.send("ping", {}).catch(() => {
        this.socket?.destroy();
      });
      if (this.writerToken) {
        this.send("renew_writer", { writerToken: this.writerToken, ttlMs: 30000 })
          .then((renewed) => {
            this.writerExpires = Number(renewed?.expires ?? this.writerExpires);
          })
          .catch(() => {
            // A failed renewal will surface on the next protected write.
          });
      }
    }, this.heartbeatMs);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let response: ProbeResponse;
      try {
        response = JSON.parse(line) as ProbeResponse;
      } catch {
        continue;
      }
      const id = response.id;
      if (id == null) continue;
      const pending = this.pending.get(id);
      if (!pending) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (!response.ok) {
        pending.reject(
          new GameError(response.error?.code ?? "probe_error", response.error?.message ?? "Probe request failed"),
        );
      } else {
        pending.resolve(response.data);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private async call(op: string, args: Record<string, unknown> = {}): Promise<any> {
    await this.connectWithRetry();
    if (!this.handshaken) {
      const hello = await this.send("hello", { token: this.token });
      if (Number(hello?.protocol ?? 0) !== 1) {
        this.socket?.destroy();
        throw new GameError("probe_incompatible", `Unsupported probe protocol: ${String(hello?.protocol)}`);
      }
      if (hello?.requireWriter) {
        const claimed = await this.send("claim_writer", {
          clientId: `mcp-${process.pid}-${Date.now()}`,
        });
        this.writerToken = String(claimed?.writerToken ?? "");
        this.writerExpires = Number(claimed?.expires ?? 0);
      }
      this.handshaken = true;
      this.startHeartbeat();
    }
    return await this.send(op, args);
  }

  private async send(op: string, args: Record<string, unknown> = {}): Promise<any> {
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new GameError("probe_unavailable", "Probe socket is not connected");
    const id = this.nextId++;
    const payload = {
      id,
      op,
      ...args,
      ...(this.token ? { token: this.token } : {}),
      ...(this.writerToken ? { writerToken: this.writerToken } : {}),
    };
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GameError("probe_timeout", `Probe request timed out: ${op}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.write(JSON.stringify(payload) + "\n");
    });
  }

  // ---------------------------------------------------------------- read

  async getContext(options: ContextOptions = {}): Promise<GameContext> {
    const raw = await this.call("get_context", {
      radius: options.radius ?? 0,
      since: options.since ?? 0,
      includeEnemies: options.includeEnemies ?? false,
      maxUnits: options.maxUnits ?? 20,
      maxBytes: options.maxBytes ?? 0,
    });
    const assistantRaw = raw.assistant ?? {};
    const units: UnitSnapshot[] = (raw.units ?? []).map((unit: any) => this.mapUnit(unit));
    const assistant: AssistantSnapshot = {
      ...this.mapUnit(assistantRaw),
      isHome: assistantRaw.isHome !== false,
      possessing: !!assistantRaw.possessing,
    };
    const cores: CoreSnapshot[] = (raw.cores ?? []).map((core: any) => ({
      id: core.id,
      block: core.block,
      team: core.team ?? raw.team,
      x: core.x,
      y: core.y,
      tileX: Math.floor(core.x / 8),
      tileY: Math.floor(core.y / 8),
      health: core.health,
      maxHealth: core.maxHealth,
      core: true,
      items: {},
    }));

    return {
      tick: Number(raw.tick ?? 0),
      timeMs: Number(raw.timeMs ?? 0),
      paused: !!raw.paused,
      gameOver: !!raw.gameOver,
      map: String(raw.map ?? ""),
      mode: "survival",
      wave: Number(raw.wave ?? 0),
      enemies: Number(raw.enemies ?? 0),
      team: Number(raw.team ?? 0),
      teamName: String(raw.teamName ?? ""),
      player: {
        name: "player",
        team: Number(raw.team ?? 0),
        dead: true,
      },
      assistant,
      resources: raw.resources ?? {},
      cores,
      counts: {
        units: Number(raw.unitCount ?? units.length),
        buildings: cores.length,
        enemyUnits: Number(raw.enemies ?? 0),
      },
      nearby:
        options.detail === "summary"
          ? undefined
          : {
              units: units.filter((unit) => unit.id !== assistant.id),
              buildings: cores,
            },
      threats: Array.isArray(raw.threats) ? raw.threats.map((unit: any) => this.mapUnit(unit)) : undefined,
      unitsTruncated: !!raw.unitsTruncated,
      threatsTruncated: !!raw.threatsTruncated,
      bytesTruncated: !!raw.bytesTruncated,
      bytes: raw.bytes == null ? undefined : Number(raw.bytes),
      eventsSince: Number(raw.eventsSince ?? 0),
      eventsPending: Number(raw.eventsPending ?? 0),
      eventSummary: raw.eventSummary
        ? {
            total: Number(raw.eventSummary.total ?? 0),
            byType: (raw.eventSummary.byType ?? {}) as Record<string, number>,
          }
        : undefined,
    };
  }

  async getCapabilities(): Promise<Capabilities> {
    const raw = await this.call("get_capabilities");
    return {
      unitId: Number(raw.unitId),
      type: String(raw.type ?? ""),
      health: Number(raw.health ?? 0),
      maxHealth: Number(raw.maxHealth ?? 0),
      speed: Number(raw.speed ?? 0),
      flying: !!raw.flying,
      buildSpeed: Number(raw.buildSpeed ?? 0),
      buildRange: Number(raw.buildRange ?? 0),
      mineSpeed: Number(raw.mineSpeed ?? 0),
      mineTier: Number(raw.mineTier ?? -1),
      mineRange: Number(raw.mineRange ?? 0),
      itemCapacity: Number(raw.itemCapacity ?? 0),
      payloadCapacity: Number(raw.payloadCapacity ?? 0),
      canBoost: !!raw.canBoost,
      weapons: (raw.weapons ?? []).map((weapon: any) => ({
        name: String(weapon.name ?? ""),
        range: Number(weapon.range ?? 0),
        damage: Number(weapon.damage ?? 0),
      })),
      commands: (raw.commands ?? []).map(String),
      canBuild: !!raw.canBuild,
      canMine: !!raw.canMine,
      canAttack: !!raw.canAttack,
      canPossess: !!raw.canPossess,
    };
  }

  async getContent(type: ContentType = "all", query = "", limit = 0): Promise<ContentSnapshot> {
    return (await this.call("get_content", { type, query, limit })) as ContentSnapshot;
  }

  async getMapSummary(): Promise<MapSummary> {
    const raw = await this.call("get_map_manifest");
    return {
      ref: String(raw.ref ?? ""),
      revision: Number(raw.revision ?? 0),
      kind: "map",
      format: String(raw.format ?? "raw-v1"),
      schema: {
        width: Number(raw.schema?.width ?? 0),
        height: Number(raw.schema?.height ?? 0),
        layers: (raw.schema?.layers ?? []) as string[],
        dtype: String(raw.schema?.dtype ?? "int16-le"),
        coord: String(raw.schema?.coord ?? "tile"),
        chunkSize: raw.schema?.chunkSize == null ? undefined : Number(raw.schema.chunkSize),
      },
      bytes: raw.bytes == null ? undefined : Number(raw.bytes),
      access: raw.access
        ? {
            mode: String(raw.access.mode ?? "http-readonly"),
            baseUrl: String(raw.access.baseUrl ?? ""),
            readOnly: raw.access.readOnly !== false,
            expires: Number(raw.access.expires ?? 0),
          }
        : undefined,
    };
  }

  async getEvents(since: number, limit = 50, summary = false, types?: string[]): Promise<EventPage> {
    const raw = await this.call("get_events", { since, limit, summary, types });
    return {
      events: (raw.events ?? []).map((event: any) => ({
        id: Number(event.id),
        type: String(event.type ?? ""),
        tick: Number(event.tick ?? 0),
        timeMs: Number(event.timeMs ?? 0),
        data: (event.data ?? {}) as Record<string, unknown>,
      })),
      next: Number(raw.next ?? since),
      dropped: Number(raw.dropped ?? 0),
      summary: raw.summary
        ? {
            total: Number(raw.summary.total ?? 0),
            byType: (raw.summary.byType ?? {}) as Record<string, number>,
          }
        : undefined,
      ref: raw.ref == null ? undefined : String(raw.ref),
      hasMore: !!raw.hasMore,
      bytes: raw.bytes == null ? undefined : Number(raw.bytes),
    };
  }

  async getActionLog(limit = 50): Promise<ActionLog> {
    const raw = await this.call("get_action_log", { limit });
    return {
      actions: (raw.actions ?? []).map((action: any) => ({
        ...this.mapResult(action),
        kind: String(action.kind ?? ""),
        createdTick: action.createdTick == null ? undefined : Number(action.createdTick),
      })),
      count: Number(raw.count ?? 0),
    };
  }

  async queryArea(query: AreaQuery): Promise<AreaSnapshot> {
    const raw = await this.call("query_area", {
      x: query.x,
      y: query.y,
      radius: query.radius,
      includeUnits: query.includeUnits ?? true,
      includeBuildings: query.includeBuildings ?? true,
      includeEnemies: query.includeEnemies ?? false,
    });
    const units: UnitSnapshot[] = (raw.units ?? []).map((unit: any) => this.mapUnit(unit));
    const buildings: BuildingSnapshot[] = (raw.buildings ?? []).map((building: any) => ({
      id: Number(building.id),
      block: String(building.block ?? ""),
      team: Number(building.team ?? 0),
      x: Number(building.x ?? 0),
      y: Number(building.y ?? 0),
      tileX: Number(building.tileX ?? 0),
      tileY: Number(building.tileY ?? 0),
      health: Number(building.health ?? 0),
      maxHealth: Number(building.maxHealth ?? 0),
      rotation: Number(building.rotation ?? 0),
      core: String(building.block ?? "").startsWith("core-"),
    }));
    return {
      x: query.x,
      y: query.y,
      radius: query.radius,
      units,
      buildings,
    };
  }

  async getArea(query: AreaTileQuery): Promise<AreaTileSnapshot> {
    const raw = await this.call("get_area", {
      x: query.x,
      y: query.y,
      radius: query.radius,
      maxTiles: query.maxTiles,
    });
    const tiles: TileSnapshot[] = (raw.tiles ?? []).map((tile: any) => ({
      x: Number(tile.x ?? 0),
      y: Number(tile.y ?? 0),
      block: String(tile.block ?? ""),
      team: Number(tile.team ?? 0),
      drop: tile.drop == null ? undefined : String(tile.drop),
      solid: !!tile.solid,
      items: (tile.items ?? []).map((item: { item: string; amount: number }) => ({
        item: String(item.item),
        amount: Number(item.amount ?? 0),
      })),
      ammoTotal: tile.ammoTotal == null ? undefined : Number(tile.ammoTotal),
    }));
    return {
      x: Number(raw.x ?? query.x),
      y: Number(raw.y ?? query.y),
      radius: Number(raw.radius ?? query.radius),
      tiles,
      truncated: !!raw.truncated,
    };
  }

  async getConfigSchema(block: string): Promise<ConfigSchema> {
    const schemas: Record<string, ConfigSchema> = {
      sorter: {
        block,
        configurable: true,
        fields: [{ key: "value", type: "item", values: ["copper", "lead", "graphite", "metaglass"] }],
      },
      unloader: {
        block,
        configurable: true,
        fields: [{ key: "value", type: "string", values: ["north", "east", "south", "west"] }],
      },
      "micro-processor": {
        block,
        configurable: true,
        fields: [{ key: "code", type: "string" }],
      },
      message: { block, configurable: true, fields: [{ key: "text", type: "string" }] },
      switch: { block, configurable: true, fields: [{ key: "enabled", type: "boolean" }] },
    };
    return schemas[block] ?? { block, configurable: false, fields: [] };
  }

  async getActionResult(opId: string, waitMs = 0): Promise<ActionResult> {
    // Probe completes or runs actions immediately; waitMs is only a small
    // client-side delay for callers that expect polling semantics.
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 200)));
    const raw = await this.call("get_action_result", { opId });
    return this.mapResult(raw);
  }

  // ---------------------------------------------------------------- actions

  async moveTo(x: number, y: number, arriveRadius = 8): Promise<ActionResult> {
    return this.mapResult(await this.call("move_to", { x, y, arriveRadius }));
  }

  async attack(target: CommandTarget): Promise<ActionResult> {
    return this.immediate(await this.call("attack", { target }));
  }

  async follow(unitId: EntityId, distance?: number): Promise<ActionResult> {
    return this.immediate(await this.call("follow", { unitId, distance }));
  }

  async mine(x: number, y: number): Promise<ActionResult> {
    return this.immediate(await this.call("mine", { x, y }));
  }

  async stop(): Promise<ActionResult> {
    return this.immediate(await this.call("stop"));
  }

  async buildPlan(request: BuildPlanRequest): Promise<ActionResult> {
    const results: ActionResult[] = [];
    if (request.deconstruct?.length) {
      results.push(await this.deconstruct(request.deconstruct));
    }
    for (const placement of request.placements) {
      results.push(
        this.mapResult(
          await this.call("build", {
            block: placement.block,
            x: placement.x,
            y: placement.y,
            rotation: placement.rotation ?? 0,
          }),
        ),
      );
    }
    if (results.length === 0) {
      throw new GameError("bad_request", "build_plan has no placements or deconstruct targets");
    }
    const failed = results.find((result) => result.error);
    const last = results[results.length - 1];
    return {
      opId: last.opId,
      status: failed ? "failed" : "queued",
      progress: 0,
      data: { results },
      error: failed?.error,
    };
  }

  async deconstruct(targets: Vec2[]): Promise<ActionResult> {
    return this.immediate(
      await this.call("deconstruct", {
        targets: targets.map((target) => ({ x: target.x, y: target.y })),
      }),
    );
  }

  async repair(target: Vec2): Promise<ActionResult> {
    return this.immediate(await this.call("repair", { x: target.x, y: target.y }));
  }

  async withdraw(
    target: { buildingId?: EntityId; x?: number; y?: number },
    item: string,
    amount: number,
  ): Promise<ActionResult> {
    return this.immediate(await this.call("withdraw", { target, item, amount }));
  }

  async deposit(
    target: { buildingId?: EntityId; x?: number; y?: number },
    item: string,
    amount: number,
  ): Promise<ActionResult> {
    return this.immediate(await this.call("deposit", { target, item, amount }));
  }

  async configure(x: number, y: number, value: ConfigValue): Promise<ActionResult> {
    return this.immediate(await this.call("configure", { x, y, value }));
  }

  async commandUnits(request: CommandUnitsRequest): Promise<ActionResult> {
    return this.immediate(await this.call("command_units", request as unknown as Record<string, unknown>));
  }

  async setStance(unitIds: EntityId[], stance: UnitStanceName): Promise<ActionResult> {
    return this.immediate(await this.call("set_stance", { unitIds, stance }));
  }

  async possess(unitId: EntityId): Promise<ActionResult> {
    return this.immediate(await this.call("possess", { unitId }));
  }

  async release(): Promise<ActionResult> {
    return this.immediate(await this.call("release"));
  }

  async respawn(coreId?: EntityId): Promise<ActionResult> {
    return this.immediate(await this.call("respawn", { coreId }));
  }

  async cancel(_opId?: string): Promise<ActionResult> {
    return this.immediate(await this.call("cancel", { opId: _opId }));
  }

  async close(): Promise<void> {
    if (this.writerToken) {
      try {
        await this.send("release_writer", { writerToken: this.writerToken });
      } catch {
        // Lease has a TTL; release is best effort.
      }
      this.writerToken = undefined;
    }
    this.stopHeartbeat();
    this.rejectAll(new GameError("probe_closed", "Probe adapter closed"));
    this.socket?.destroy();
    this.socket = undefined;
  }

  // ---------------------------------------------------------------- mapping

  private mapUnit(raw: any): UnitSnapshot {
    return {
      id: Number(raw.id ?? -1),
      type: String(raw.type ?? ""),
      team: Number(raw.team ?? 0),
      x: Number(raw.x ?? 0),
      y: Number(raw.y ?? 0),
      health: Number(raw.health ?? 0),
      maxHealth: Number(raw.maxHealth ?? 0),
      dead: !!raw.dead,
      item: raw.item ? String(raw.item) : undefined,
      itemAmount: raw.itemAmount == null ? undefined : Number(raw.itemAmount),
    };
  }

  private mapResult(raw: any): ActionResult {
    const status = String(raw.status ?? "queued") as OpStatus;
    const result: ActionResult = {
      opId: String(raw.opId ?? raw.op_id ?? ""),
      status,
      progress: Number(raw.progress ?? 0),
      data: raw.data,
    };
    if (raw.error) {
      result.error = structuredError(
        String(raw.error.code ?? "probe_error"),
        String(raw.error.message ?? "Probe action failed"),
      );
    }
    return result;
  }

  private immediate(raw: unknown): ActionResult {
    const value = raw as { opId?: string; status?: OpStatus; progress?: number; data?: unknown } | undefined;
    return {
      opId: value?.opId ?? `probe-${++this.actionSeq}`,
      status: value?.status ?? "done",
      progress: value?.progress ?? 1,
      data: value?.data ?? value,
    };
  }

  private notImplemented(method: string): GameError {
    return new GameError("not_implemented", `Probe adapter does not implement ${method}`);
  }
}
