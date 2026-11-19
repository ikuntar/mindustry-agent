import net from "node:net";

import {
  ActionError,
  ActionResult,
  AreaQuery,
  AreaSnapshot,
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
  OpStatus,
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
}

/**
 * Real-game adapter for probe-mod.
 *
 * The probe only implements a subset: get_context, get_capabilities, get_tile,
 * move_to, build, get_action_result. Everything else fails with
 * `not_implemented` rather than pretending to work.
 */
export class ProbeGameAdapter implements GameAdapter {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private socket?: net.Socket;
  private buffer = "";
  private nextId = 1;
  private actionSeq = 0;
  private pending = new Map<number, Pending>();

  constructor(options: ProbeAdapterOptions = {}) {
    this.host = options.host ?? process.env.PROBE_HOST ?? "127.0.0.1";
    this.port = options.port ?? Number(process.env.PROBE_PORT ?? 46500);
    this.timeoutMs = options.timeoutMs ?? 5000;
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
        this.rejectAll(new GameError("probe_closed", "Probe socket closed"));
      });
    });
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
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new GameError("probe_unavailable", "Probe socket is not connected");
    const id = this.nextId++;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GameError("probe_timeout", `Probe request timed out: ${op}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.write(JSON.stringify({ id, op, ...args }) + "\n");
    });
  }

  // ---------------------------------------------------------------- read

  async getContext(options: ContextOptions = {}): Promise<GameContext> {
    const raw = await this.call("get_context");
    const assistantRaw = raw.assistant ?? {};
    const units: UnitSnapshot[] = (raw.units ?? []).map((unit: any) => this.mapUnit(unit));
    const assistant: AssistantSnapshot = {
      ...this.mapUnit(assistantRaw),
      isHome: true,
      possessing: false,
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
      eventsSince: 0,
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

  async getContent(type: ContentType = "all"): Promise<ContentSnapshot> {
    const blocks = [
      { name: "conveyor", size: 1, rotate: true },
      { name: "router", size: 1, rotate: false },
      { name: "sorter", size: 1, rotate: false },
      { name: "unloader", size: 1, rotate: true },
      { name: "micro-processor", size: 1, rotate: false },
      { name: "core-shard", size: 3, rotate: false },
      { name: "core-foundation", size: 4, rotate: false },
      { name: "core-nucleus", size: 5, rotate: false },
    ];
    const units = ["alpha", "beta", "gamma", "dagger"].map((name) => ({ name }));
    const items = ["copper", "lead", "graphite", "metaglass", "silicon", "titanium"].map((name) => ({ name }));
    const liquids = [{ name: "water" }];
    if (type === "blocks") return { blocks };
    if (type === "units") return { units };
    if (type === "items") return { items };
    if (type === "liquids") return { liquids };
    return { blocks, units, items, liquids };
  }

  async getEvents(since: number, _limit = 50): Promise<EventPage> {
    // Probe does not record events yet; expose an explicit empty page.
    return { events: [], next: since, dropped: 0 };
  }

  async queryArea(query: AreaQuery): Promise<AreaSnapshot> {
    const raw = await this.call("query_area", {
      x: query.x,
      y: query.y,
      radius: query.radius,
      includeUnits: query.includeUnits ?? true,
      includeBuildings: query.includeBuildings ?? true,
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
    if (request.placements.length !== 1 || request.deconstruct?.length) {
      throw new GameError("not_implemented", "Probe adapter only supports a single placement without deconstruct");
    }
    const placement = request.placements[0];
    return this.mapResult(
      await this.call("build", {
        block: placement.block,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation ?? 0,
      }),
    );
  }

  async deconstruct(_targets: Vec2[]): Promise<ActionResult> {
    throw this.notImplemented("deconstruct");
  }

  async repair(_target: Vec2): Promise<ActionResult> {
    throw this.notImplemented("repair");
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

  async possess(_unitId: EntityId): Promise<ActionResult> {
    throw this.notImplemented("possess");
  }

  async release(): Promise<ActionResult> {
    throw this.notImplemented("release");
  }

  async respawn(_coreId?: EntityId): Promise<ActionResult> {
    throw this.notImplemented("respawn");
  }

  async cancel(_opId?: string): Promise<ActionResult> {
    throw this.notImplemented("cancel");
  }

  async close(): Promise<void> {
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
      result.error = {
        code: String(raw.error.code ?? "probe_error"),
        message: String(raw.error.message ?? "Probe action failed"),
      } satisfies ActionError;
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
