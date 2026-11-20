import {
  ActionError,
  ActionLog,
  ActionResult,
  AreaQuery,
  AreaSnapshot,
  AreaTileQuery,
  AreaTileSnapshot,
  AssistantSnapshot,
  BuildPlacement,
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
  GameEvent,
  MapSummary,
  OpStatus,
  UnitCommandName,
  UnitSnapshot,
  UnitStanceName,
  Vec2,
} from "../types.js";
import { structuredError } from "../errors.js";

interface MockUnit extends UnitSnapshot {
  isAi: boolean;
  isHome?: boolean;
  command?: UnitCommandName;
  stance?: UnitStanceName;
}

interface MockOp {
  id: string;
  kind:
    | "move"
    | "attack"
    | "follow"
    | "mine"
    | "build"
    | "deconstruct"
    | "repair"
    | "withdraw"
    | "deposit"
    | "configure"
    | "command"
    | "stance"
    | "possess"
    | "release"
    | "respawn";
  status: OpStatus;
  progress: number;
  createdTick: number;
  data: Record<string, unknown>;
  result?: unknown;
  error?: ActionError;
}

interface MockOptions {
  autoTick?: boolean;
  tickMs?: number;
  seedBuildings?: boolean;
}

const MAP_SIZE = 64;
const BUILD_COST = 10;
const WITHDRAW_RANGE = 27.5;

export class MockGameAdapter implements GameAdapter {
  tick = 0;
  timeMs = 0;
  paused = false;
  gameOver = false;
  map = "mock-map";
  mode = "survival";
  wave = 1;
  enemies = 0;
  team = 1;
  teamName = "sharded";

  resources: Record<string, number> = { copper: 500, lead: 200, graphite: 100 };
  cores: CoreSnapshot[] = [];
  buildings = new Map<EntityId, BuildingSnapshot>();
  units = new Map<EntityId, MockUnit>();
  events: GameEvent[] = [];

  assistantId = 1;
  private playerUnitId = 100;
  private nextBuildingId = 2000;
  private nextUnitId = 1000;
  private nextEventId = 1;
  private droppedEvents = 0;
  private ops = new Map<string, MockOp>();
  private currentOpId: string | null = null;
  private opSeq = 0;
  private timer?: NodeJS.Timeout;
  private readonly tickMs: number;

  constructor(options: MockOptions = {}) {
    this.tickMs = options.tickMs ?? 50;
    this.resetWorld(options.seedBuildings ?? true);
    if (options.autoTick ?? true) {
      this.timer = setInterval(() => this.advance(this.tickMs), this.tickMs);
      this.timer.unref?.();
    }
  }

  // ---------------------------------------------------------------- world setup

  private resetWorld(seedBuildings: boolean): void {
    this.cores = [
      this.makeBuilding("core-shard", 10, 10, 1000, 12000, true),
      this.makeBuilding("core-shard", 30, 30, 1001, 12000, true),
    ];
    for (const core of this.cores) {
      this.buildings.set(core.id, core);
    }
    if (seedBuildings) {
      const conveyor = this.makeBuilding("conveyor", 15, 15, this.nextBuildingId++, 160, false);
      const sorter = this.makeBuilding("sorter", 16, 15, this.nextBuildingId++, 160, false);
      const processor = this.makeBuilding("micro-processor", 17, 15, this.nextBuildingId++, 160, false);
      for (const b of [conveyor, sorter, processor]) this.buildings.set(b.id, b);
    }

    const assistant: MockUnit = {
      id: this.assistantId,
      type: "alpha",
      team: this.team,
      x: 20,
      y: 20,
      health: 200,
      maxHealth: 200,
      dead: false,
      isAi: false,
      isHome: true,
    };
    const player: MockUnit = {
      id: this.playerUnitId,
      type: "alpha",
      team: this.team,
      x: 12,
      y: 12,
      health: 200,
      maxHealth: 200,
      dead: false,
      isAi: false,
    };
    const ally: MockUnit = {
      id: 200,
      type: "dagger",
      team: this.team,
      x: 22,
      y: 20,
      health: 120,
      maxHealth: 120,
      dead: false,
      isAi: true,
      command: "move",
      stance: "holdPosition",
    };
    const enemy: MockUnit = {
      id: 500,
      type: "dagger",
      team: 2,
      x: 25,
      y: 25,
      health: 100,
      maxHealth: 100,
      dead: false,
      isAi: true,
    };
    this.units.set(assistant.id, assistant);
    this.units.set(player.id, player);
    this.units.set(ally.id, ally);
    this.units.set(enemy.id, enemy);
    this.enemies = 1;
  }

  private makeBuilding(
    block: string,
    x: number,
    y: number,
    id: number,
    maxHealth: number,
    core: boolean,
  ): CoreSnapshot & BuildingSnapshot {
    const build: CoreSnapshot = {
      id,
      block,
      team: this.team,
      x,
      y,
      tileX: x,
      tileY: y,
      health: maxHealth,
      maxHealth,
      rotation: 0,
      enabled: true,
      efficiency: 1,
      items: core ? { ...this.resources } : {},
      core: true,
    };
    return core ? build : ({ ...build, core: undefined } as unknown as CoreSnapshot & BuildingSnapshot);
  }

  private assistant(): MockUnit {
    const u = this.units.get(this.assistantId);
    if (!u) throw new GameError("assistant_missing", "Assistant has no body");
    return u;
  }

  private player(): MockUnit {
    const u = this.units.get(this.playerUnitId);
    if (!u) throw new GameError("player_missing", "Player has no body");
    return u;
  }

  private emit(type: string, data: Record<string, unknown> = {}): void {
    const event: GameEvent = {
      id: this.nextEventId++,
      type,
      tick: this.tick,
      timeMs: this.timeMs,
      data,
    };
    this.events.push(event);
    if (this.events.length > 500) {
      this.events.shift();
      this.droppedEvents++;
    }
  }

  private requireAlive(): MockUnit {
    const a = this.assistant();
    if (a.dead) throw new GameError("assistant_dead", "Assistant is dead");
    return a;
  }

  private distance(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private buildingAt(x: number, y: number): BuildingSnapshot | undefined {
    for (const b of this.buildings.values()) {
      if (b.tileX === x && b.tileY === y) return b;
    }
    return undefined;
  }

  private unitAt(id: EntityId): MockUnit {
    const u = this.units.get(id);
    if (!u || u.dead) throw new GameError("unit_not_found", `Unit ${id} not found`);
    return u;
  }

  private newOp(kind: MockOp["kind"], data: Record<string, unknown>): MockOp {
    const op: MockOp = {
      id: `op-${++this.opSeq}`,
      kind,
      status: "queued",
      progress: 0,
      createdTick: this.tick,
      data,
    };
    this.ops.set(op.id, op);
    this.currentOpId = op.id;
    return op;
  }

  private opResult(op: MockOp): ActionResult {
    return {
      opId: op.id,
      status: op.status,
      progress: Math.max(0, Math.min(1, op.progress)),
      data: op.result,
      error: op.error,
    };
  }

  private finish(op: MockOp, result?: unknown): void {
    op.status = "done";
    op.progress = 1;
    op.result = result;
    if (this.currentOpId === op.id) this.currentOpId = null;
    this.emit("action_done", { opId: op.id, kind: op.kind });
  }

  private fail(op: MockOp, code: string, message: string): void {
    op.status = "failed";
    op.error = structuredError(code, message);
    if (this.currentOpId === op.id) this.currentOpId = null;
    this.emit("action_failed", { opId: op.id, kind: op.kind, code, message });
  }

  // ---------------------------------------------------------------- read surface

  async getContext(options: ContextOptions = {}): Promise<GameContext> {
    const a = this.assistant();
    const radius = options.radius ?? 15;
    const nearby =
      options.detail === "summary"
        ? undefined
        : {
            units: [...this.units.values()]
              .filter((u) => !u.dead && u.id !== a.id && this.distance(a, u) <= radius)
              .map((u) => this.snapshotUnit(u)),
            buildings: [...this.buildings.values()]
              .filter((b) => this.distance(a, b) <= radius)
              .map((b) => this.snapshotBuilding(b)),
          };

    return {
      tick: this.tick,
      timeMs: this.timeMs,
      paused: this.paused,
      gameOver: this.gameOver,
      map: this.map,
      mode: this.mode,
      wave: this.wave,
      enemies: this.enemies,
      team: this.team,
      teamName: this.teamName,
      player: {
        name: "player",
        team: this.team,
        unitId: this.playerUnitId,
        dead: this.player().dead,
      },
      assistant: this.snapshotAssistant(a),
      resources: { ...this.resources },
      cores: this.cores.map((c) => this.snapshotCore(c)),
      counts: {
        units: [...this.units.values()].filter((u) => !u.dead).length,
        buildings: this.buildings.size,
        enemyUnits: [...this.units.values()].filter((u) => !u.dead && u.team !== this.team).length,
      },
      nearby,
      eventsSince: this.nextEventId - 1,
      eventsPending: this.events.filter((event) => event.id > (options.since ?? 0)).length,
      eventSummary: (() => {
        const byType: Record<string, number> = {};
        for (const event of this.events) {
          if (event.id <= (options.since ?? 0)) continue;
          byType[event.type] = (byType[event.type] ?? 0) + 1;
        }
        return { total: Object.values(byType).reduce((sum, count) => sum + count, 0), byType };
      })(),
    };
  }

  async getCapabilities(): Promise<Capabilities> {
    const a = this.assistant();
    return {
      unitId: a.id,
      type: a.type,
      health: a.health,
      maxHealth: a.maxHealth,
      speed: 1,
      flying: false,
      buildSpeed: 1,
      buildRange: 5,
      mineSpeed: 1,
      mineTier: 1,
      mineRange: 5,
      itemCapacity: 30,
      payloadCapacity: 0,
      canBoost: false,
      weapons: [{ name: "laser", range: 5, damage: 5 }],
      commands: ["move", "repair", "rebuild", "assist", "mine"],
      canBuild: true,
      canMine: true,
      canAttack: true,
      canPossess: !a.dead,
    };
  }

  async getContent(type: ContentType = "all", query = "", limit = 0): Promise<ContentSnapshot> {
    const match = <T extends { name: string }>(items: T[]): T[] => {
      const normalized = query.toLowerCase();
      const filtered = normalized ? items.filter((item) => item.name.toLowerCase().includes(normalized)) : items;
      return limit > 0 ? filtered.slice(0, limit) : filtered;
    };
    const blocks = match([
      { name: "core-shard", localizedName: "Core: Shard", size: 3, rotate: false },
      { name: "conveyor", localizedName: "Conveyor", size: 1, rotate: true },
      { name: "router", localizedName: "Router", size: 1, rotate: false },
      { name: "sorter", localizedName: "Sorter", size: 1, rotate: false },
      { name: "unloader", localizedName: "Unloader", size: 1, rotate: true },
      { name: "micro-processor", localizedName: "Micro Processor", size: 1, rotate: false },
      { name: "message", localizedName: "Message", size: 1, rotate: false },
      { name: "switch", localizedName: "Switch", size: 1, rotate: false },
      { name: "duo", localizedName: "Duo", size: 1, rotate: true },
    ]);
    const units = match([
      { name: "alpha", localizedName: "Alpha", flying: true, health: 200, speed: 1 },
      { name: "dagger", localizedName: "Dagger", flying: true, health: 120, speed: 1.3 },
    ]);
    const items = match(["copper", "lead", "graphite", "silicon", "titanium"].map((name) => ({
      name,
      localizedName: name,
    })));
    const liquids = match([{ name: "water", localizedName: "Water" }]);

    if (type === "blocks") return { blocks };
    if (type === "units") return { units };
    if (type === "items") return { items };
    if (type === "liquids") return { liquids };
    return { blocks, units, items, liquids };
  }

  async getMapSummary(): Promise<MapSummary> {
    const width = MAP_SIZE;
    const height = MAP_SIZE;
    return {
      ref: "obs://map/rev/1",
      revision: 1,
      kind: "map",
      format: "raw-v1",
      schema: {
        width,
        height,
        layers: ["block_id", "team", "drop_id", "solid"],
        dtype: "int16-le",
        coord: "tile",
        chunkSize: 32,
      },
      bytes: 16 + width * height * 8,
      access: {
        mode: "mock",
        baseUrl: "mock://data",
        readOnly: true,
        expires: Date.now() + 3_600_000,
      },
    };
  }

  async getEvents(since: number, limit = 50, summary = false, types?: string[]): Promise<EventPage> {
    const filtered = this.events.filter(
      (event) => event.id > since && (!types?.length || types.includes(event.type)),
    );
    if (summary) {
      const byType: Record<string, number> = {};
      for (const event of filtered) byType[event.type] = (byType[event.type] ?? 0) + 1;
      return {
        events: [],
        next: filtered.length ? filtered[filtered.length - 1].id : since,
        dropped: this.droppedEvents,
        summary: { total: filtered.length, byType },
        ref: `obs://events/rev/${filtered.length ? filtered[filtered.length - 1].id : since}`,
        hasMore: false,
      };
    }
    const events = filtered.slice(0, Math.max(1, limit));
    return {
      events,
      next: events.length ? events[events.length - 1].id : since,
      dropped: this.droppedEvents,
      hasMore: filtered.length > events.length,
    };
  }

  async getActionLog(limit = 50): Promise<ActionLog> {
    const actions = [...this.ops.values()].slice(0, Math.max(1, limit)).map((op) => ({
      ...this.opResult(op),
      kind: op.kind,
      createdTick: op.createdTick,
    }));
    return { actions, count: this.ops.size };
  }

  async queryArea(query: AreaQuery): Promise<AreaSnapshot> {
    const units =
      query.includeUnits === false
        ? []
        : [...this.units.values()]
            .filter((u) => !u.dead && this.distance(u, { x: query.x, y: query.y }) <= query.radius)
            .map((u) => this.snapshotUnit(u));
    const buildings =
      query.includeBuildings === false
        ? []
        : [...this.buildings.values()]
            .filter((b) => this.distance(b, { x: query.x, y: query.y }) <= query.radius)
            .map((b) => this.snapshotBuilding(b));
    return { x: query.x, y: query.y, radius: query.radius, units, buildings };
  }

  async getArea(query: AreaTileQuery): Promise<AreaTileSnapshot> {
    const tiles = [];
    const centerX = Math.floor(query.x / 8);
    const centerY = Math.floor(query.y / 8);
    for (let dx = -query.radius; dx <= query.radius; dx++) {
      for (let dy = -query.radius; dy <= query.radius; dy++) {
        tiles.push({
          x: centerX + dx,
          y: centerY + dy,
          block: "air",
          team: 0,
          solid: false,
        });
      }
    }
    return {
      x: query.x,
      y: query.y,
      radius: query.radius,
      tiles,
      truncated: false,
    };
  }

  async getConfigSchema(block: string): Promise<ConfigSchema> {
    switch (block) {
      case "sorter":
        return {
          block,
          configurable: true,
          fields: [{ key: "value", type: "item", values: ["copper", "lead", "graphite", "silicon", "titanium"] }],
        };
      case "unloader":
        return {
          block,
          configurable: true,
          fields: [{ key: "value", type: "string", values: ["north", "east", "south", "west"] }],
        };
      case "micro-processor":
        return { block, configurable: true, fields: [{ key: "code", type: "string" }] };
      case "message":
        return { block, configurable: true, fields: [{ key: "text", type: "string" }] };
      case "switch":
        return { block, configurable: true, fields: [{ key: "enabled", type: "boolean" }] };
      default:
        return { block, configurable: false, fields: [] };
    }
  }

  async getActionResult(opId: string, waitMs = 0): Promise<ActionResult> {
    const op = this.ops.get(opId);
    if (!op) throw new GameError("op_not_found", `Operation ${opId} not found`);
    const deadline = Date.now() + Math.max(0, Math.min(waitMs, 5000));
    while (
      (op.status === "queued" || op.status === "running") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return this.opResult(op);
  }

  // ---------------------------------------------------------------- action surface

  async moveTo(x: number, y: number, arriveRadius = 1, _timeoutTicks?: number): Promise<ActionResult> {
    const a = this.requireAlive();
    if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) {
      throw new GameError("out_of_bounds", "Target outside the map");
    }
    const op = this.newOp("move", { x, y, arriveRadius });
    if (this.distance(a, { x, y }) <= arriveRadius) {
      this.finish(op, { x: a.x, y: a.y });
    }
    return this.opResult(op);
  }

  async attack(target: CommandTarget, _timeoutTicks?: number): Promise<ActionResult> {
    this.requireAlive();
    const resolved = this.resolveTarget(target);
    const op = this.newOp("attack", { target: resolved });
    return this.opResult(op);
  }

  async follow(unitId: EntityId, distance = 3): Promise<ActionResult> {
    this.requireAlive();
    this.unitAt(unitId);
    const op = this.newOp("follow", { unitId, distance });
    op.status = "running";
    return this.opResult(op);
  }

  async mine(x: number, y: number): Promise<ActionResult> {
    const a = this.requireAlive();
    if (this.distance(a, { x, y }) > 5) {
      throw new GameError("out_of_range", "Mining target is out of range");
    }
    const op = this.newOp("mine", { x, y });
    return this.opResult(op);
  }

  async stop(): Promise<ActionResult> {
    const op = this.currentOpId ? this.ops.get(this.currentOpId) : undefined;
    if (op && (op.status === "queued" || op.status === "running")) {
      op.status = "cancelled";
      this.currentOpId = null;
      this.emit("action_cancelled", { opId: op.id, kind: op.kind });
      return this.opResult(op);
    }
    return { opId: "noop", status: "done", data: { stopped: true } };
  }

  async buildPlan(request: BuildPlanRequest): Promise<ActionResult> {
    this.requireAlive();
    if (!request.placements.length && !request.deconstruct?.length) {
      throw new GameError("bad_request", "Build plan is empty");
    }

    const totalCost = request.placements.length * BUILD_COST;
    if (this.resources.copper < totalCost && !request.allowPartial) {
      throw new GameError("insufficient_resources", `Need ${totalCost} copper`);
    }

    const failures: { placement: BuildPlacement; error: string }[] = [];
    const accepted: BuildPlacement[] = [];
    const pending = new Set<string>();
    let budget = this.resources.copper;
    for (const placement of request.placements) {
      const key = `${placement.x},${placement.y}`;
      const error = this.validatePlacement(placement) ?? (pending.has(key) ? "Duplicate tile in plan" : null);
      if (error) {
        if (!request.allowPartial) throw new GameError("invalid_placement", error);
        failures.push({ placement, error });
        continue;
      }
      if (budget < BUILD_COST) {
        if (!request.allowPartial) throw new GameError("insufficient_resources", "Not enough copper for the full plan");
        failures.push({ placement, error: "Insufficient copper" });
        continue;
      }
      pending.add(key);
      budget -= BUILD_COST;
      accepted.push(placement);
    }

    const op = this.newOp("build", {
      placements: accepted,
      deconstruct: request.deconstruct ?? [],
      failures,
      index: 0,
      allowPartial: request.allowPartial ?? false,
    });
    op.status = "running";
    this.resources.copper -= accepted.length * BUILD_COST;
    return this.opResult(op);
  }

  async deconstruct(targets: Vec2[]): Promise<ActionResult> {
    this.requireAlive();
    if (!targets.length) throw new GameError("bad_request", "No deconstruct targets");
    for (const t of targets) {
      const b = this.buildingAt(t.x, t.y);
      if (!b) throw new GameError("not_found", `No building at ${t.x},${t.y}`);
      if (b.core) throw new GameError("bad_request", "Cannot deconstruct a core");
    }
    const op = this.newOp("deconstruct", { targets, index: 0 });
    op.status = "running";
    return this.opResult(op);
  }

  async repair(target: Vec2): Promise<ActionResult> {
    const a = this.requireAlive();
    const b = this.buildingAt(target.x, target.y);
    if (!b) throw new GameError("not_found", `No building at ${target.x},${target.y}`);
    if (this.distance(a, b) > 5) throw new GameError("out_of_range", "Repair target is out of range");
    const op = this.newOp("repair", { target, index: 0 });
    op.status = "running";
    return this.opResult(op);
  }

  async withdraw(
    target: { buildingId?: EntityId; x?: number; y?: number },
    item: string,
    amount: number,
  ): Promise<ActionResult> {
    const a = this.requireAlive();
    if (amount <= 0) throw new GameError("bad_request", "Amount must be positive");
    const b = this.resolveBuilding(target);
    if (this.distance(a, b) > WITHDRAW_RANGE) {
      throw new GameError("out_of_range", `Withdraw range is ${WITHDRAW_RANGE}`);
    }
    const available = b.items?.[item] ?? 0;
    if (available <= 0) throw new GameError("not_found", `No ${item} in target building`);
    const taken = Math.min(available, amount, 30 - (a.itemAmount ?? 0));
    if (taken <= 0) throw new GameError("full", "Assistant inventory is full");
    b.items![item] = available - taken;
    a.item = item;
    a.itemAmount = (a.itemAmount ?? 0) + taken;
    this.emit("withdraw", { item, amount: taken, buildingId: b.id });
    const op = this.newOp("withdraw", { item, amount: taken, buildingId: b.id });
    this.finish(op, { item, amount: taken });
    return this.opResult(op);
  }

  async deposit(
    target: { buildingId?: EntityId; x?: number; y?: number },
    item: string,
    amount: number,
  ): Promise<ActionResult> {
    const a = this.requireAlive();
    if (amount <= 0) throw new GameError("bad_request", "Amount must be positive");
    const b = this.resolveBuilding(target);
    if (this.distance(a, b) > WITHDRAW_RANGE) {
      throw new GameError("out_of_range", `Deposit range is ${WITHDRAW_RANGE}`);
    }
    if (a.item !== item || (a.itemAmount ?? 0) <= 0) {
      throw new GameError("not_found", `Assistant is not carrying ${item}`);
    }
    const moved = Math.min(a.itemAmount ?? 0, amount);
    b.items ??= {};
    b.items[item] = (b.items[item] ?? 0) + moved;
    a.itemAmount = (a.itemAmount ?? 0) - moved;
    if ((a.itemAmount ?? 0) <= 0) a.item = undefined;
    this.emit("deposit", { item, amount: moved, buildingId: b.id });
    const op = this.newOp("deposit", { item, amount: moved, buildingId: b.id });
    this.finish(op, { item, amount: moved });
    return this.opResult(op);
  }

  async configure(x: number, y: number, value: ConfigValue): Promise<ActionResult> {
    this.requireAlive();
    const b = this.buildingAt(x, y);
    if (!b) throw new GameError("not_found", `No building at ${x},${y}`);
    const schema = await this.getConfigSchema(b.block);
    if (!schema.configurable) throw new GameError("not_configurable", `${b.block} is not configurable`);
    b.config = value;
    this.emit("configured", { x, y, block: b.block, value });
    const op = this.newOp("configure", { x, y, value });
    this.finish(op, { block: b.block, config: value });
    return this.opResult(op);
  }

  async commandUnits(request: CommandUnitsRequest): Promise<ActionResult> {
    this.requireAlive();
    const ids = request.unitIds ?? [];
    if (!ids.length) throw new GameError("bad_request", "No unit IDs provided");
    for (const id of ids) {
      const u = this.unitAt(id);
      if (u.team !== this.team) throw new GameError("wrong_team", `Unit ${id} is not on your team`);
      if (!u.isAi) throw new GameError("not_commandable", `Unit ${id} is not AI-controlled`);
    }
    for (const id of ids) {
      const u = this.units.get(id)!;
      u.command = request.command;
      if (request.stance) u.stance = request.stance;
    }
    this.emit("units_commanded", { unitIds: ids, command: request.command, target: request.target });
    const op = this.newOp("command", { ...request });
    this.finish(op, { commanded: ids });
    return this.opResult(op);
  }

  async setStance(unitIds: EntityId[], stance: UnitStanceName): Promise<ActionResult> {
    this.requireAlive();
    if (!unitIds.length) throw new GameError("bad_request", "No unit IDs provided");
    for (const id of unitIds) {
      const u = this.unitAt(id);
      if (u.team !== this.team) throw new GameError("wrong_team", `Unit ${id} is not on your team`);
      u.stance = stance;
    }
    this.emit("stance_changed", { unitIds, stance });
    const op = this.newOp("stance", { unitIds, stance });
    this.finish(op, { unitIds, stance });
    return this.opResult(op);
  }

  async possess(unitId: EntityId): Promise<ActionResult> {
    const a = this.requireAlive();
    const target = this.units.get(unitId);
    if (!target || target.dead) throw new GameError("unit_not_found", `Unit ${unitId} not found`);
    if (target.team !== this.team) throw new GameError("wrong_team", "Cannot possess an enemy unit");
    if (!target.isAi) throw new GameError("not_possessable", "Target is not AI-controlled");
    if (target.id === this.playerUnitId) throw new GameError("not_possessable", "Cannot possess the player unit");
    if (target.id === a.id) throw new GameError("not_possessable", "Cannot possess your own body");

    // Home body disappears on possession, like a player core body.
    if (a.isHome) {
      this.units.delete(a.id);
    } else {
      // Borrowed body is released back to AI and stays in the world.
      a.isAi = true;
    }

    target.isAi = false;
    target.isHome = false;
    this.assistantId = target.id;
    this.emit("possessed", { unitId: target.id, type: target.type });
    const op = this.newOp("possess", { unitId: target.id });
    this.finish(op, { unitId: target.id, type: target.type });
    return this.opResult(op);
  }

  async release(): Promise<ActionResult> {
    const a = this.assistant();
    if (a.isHome) throw new GameError("not_possessing", "Assistant is already in its home body");
    a.isAi = true;
    a.isHome = undefined;
    const home = this.spawnHomeBody();
    this.assistantId = home.id;
    this.emit("released", { unitId: home.id });
    const op = this.newOp("release", { unitId: home.id });
    this.finish(op, { unitId: home.id, type: home.type });
    return this.opResult(op);
  }

  async respawn(coreId?: EntityId): Promise<ActionResult> {
    if (this.gameOver) throw new GameError("game_over", "Game is over");
    const a = this.units.get(this.assistantId);
    if (a && !a.dead) throw new GameError("alive", "Assistant is still alive");
    const core = coreId ? this.cores.find((c) => c.id === coreId) : this.cores[0];
    if (!core) throw new GameError("no_core", "No core available for respawn");
    const home = this.spawnHomeBody(core);
    this.assistantId = home.id;
    this.emit("respawned", { unitId: home.id, coreId: core.id });
    const op = this.newOp("respawn", { unitId: home.id, coreId: core.id });
    this.finish(op, { unitId: home.id, coreId: core.id, type: home.type });
    return this.opResult(op);
  }

  async cancel(opId?: string): Promise<ActionResult> {
    const id = opId ?? this.currentOpId;
    if (!id) return { opId: "noop", status: "done", data: { cancelled: false } };
    const op = this.ops.get(id);
    if (!op) throw new GameError("op_not_found", `Operation ${id} not found`);
    if (op.status === "queued" || op.status === "running") {
      op.status = "cancelled";
      this.currentOpId = this.currentOpId === id ? null : this.currentOpId;
      this.emit("action_cancelled", { opId: id, kind: op.kind });
    }
    return this.opResult(op);
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- simulation

  /** Advance the mock world. Public so tests and a harness can drive it deterministically. */
  advance(dtMs: number): void {
    this.tick++;
    this.timeMs += dtMs;
    if (this.paused || this.gameOver) return;
    for (const op of this.ops.values()) {
      if (op.status === "queued") op.status = "running";
      if (op.status !== "running") continue;
      try {
        this.stepOp(op);
      } catch (error) {
        if (op.status === "running") {
          this.fail(
            op,
            error instanceof GameError ? error.code : "internal_error",
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
  }

  private stepOp(op: MockOp): void {
    const a = this.units.get(this.assistantId);
    if (!a || a.dead) {
      this.fail(op, "assistant_dead", "Assistant died while the action was running");
      return;
    }

    switch (op.kind) {
      case "move": {
        const x = op.data.x as number;
        const y = op.data.y as number;
        const radius = op.data.arriveRadius as number;
        const d = this.distance(a, { x, y });
        if (d <= radius) {
          this.finish(op, { x: a.x, y: a.y });
          return;
        }
        const step = Math.min(1, d);
        a.x += ((x - a.x) / d) * step;
        a.y += ((y - a.y) / d) * step;
        op.progress = 1 - Math.min(1, this.distance(a, { x, y }) / Math.max(1e-9, d + step));
        return;
      }
      case "follow": {
        const target = this.units.get(op.data.unitId as number);
        if (!target || target.dead) {
          this.fail(op, "target_lost", "Follow target is gone");
          return;
        }
        const distance = op.data.distance as number;
        const d = this.distance(a, target);
        if (d > distance) {
          const step = Math.min(1, d - distance);
          a.x += ((target.x - a.x) / d) * step;
          a.y += ((target.y - a.y) / d) * step;
        }
        op.progress = 0;
        return;
      }
      case "attack": {
        const target = this.resolveTarget(op.data.target as CommandTarget);
        if (target.kind === "unit") {
          const u = this.units.get(target.id);
          if (!u || u.dead) {
            this.fail(op, "target_lost", "Attack target is gone");
            return;
          }
          u.health -= 10;
          if (u.health <= 0) {
            u.health = 0;
            u.dead = true;
            this.enemies = Math.max(0, this.enemies - (u.team !== this.team ? 1 : 0));
            this.emit("unit_destroyed", { unitId: u.id, type: u.type, team: u.team });
            this.finish(op, { unitId: u.id, destroyed: true });
          } else {
            op.progress = Math.min(0.95, 1 - u.health / u.maxHealth);
          }
        } else {
          const b = this.buildings.get(target.id);
          if (!b) {
            this.fail(op, "target_lost", "Attack target is gone");
            return;
          }
          b.health -= 10;
          if (b.health <= 0) {
            this.buildings.delete(b.id);
            this.emit("building_destroyed", { buildingId: b.id, block: b.block });
            this.finish(op, { buildingId: b.id, destroyed: true });
          } else {
            op.progress = Math.min(0.95, 1 - b.health / b.maxHealth);
          }
        }
        return;
      }
      case "mine": {
        op.data.ticks = ((op.data.ticks as number) ?? 0) + 1;
        op.progress = Math.min(1, (op.data.ticks as number) / 5);
        if ((op.data.ticks as number) >= 5) {
          this.resources.copper += 10;
          this.emit("mined", { item: "copper", amount: 10 });
          this.finish(op, { item: "copper", amount: 10 });
        }
        return;
      }
      case "build": {
        const placements = op.data.placements as BuildPlacement[];
        const deconstruct = op.data.deconstruct as Vec2[];
        const index = op.data.index as number;
        if (index < deconstruct.length) {
          const target = deconstruct[index];
          const b = this.buildingAt(target.x, target.y);
          if (b && !b.core) {
            this.buildings.delete(b.id);
            this.emit("deconstructed", { x: target.x, y: target.y, block: b.block });
          }
          op.data.index = index + 1;
          op.progress = (index + 1) / (deconstruct.length + placements.length);
          return;
        }
        const pIndex = index - deconstruct.length;
        if (pIndex >= placements.length) {
          this.finish(op, { built: placements.length, failures: op.data.failures });
          return;
        }
        const placement = placements[pIndex];
        const b: BuildingSnapshot = {
          id: this.nextBuildingId++,
          block: placement.block,
          team: this.team,
          x: placement.x,
          y: placement.y,
          tileX: placement.x,
          tileY: placement.y,
          health: 160,
          maxHealth: 160,
          rotation: placement.rotation ?? 0,
          enabled: true,
          efficiency: 1,
          items: {},
          config: placement.config,
        };
        this.buildings.set(b.id, b);
        this.emit("build_complete", { buildingId: b.id, block: b.block, x: b.tileX, y: b.tileY });
        op.data.index = index + 1;
        op.progress = (index + 1) / (deconstruct.length + placements.length);
        return;
      }
      case "deconstruct": {
        const targets = op.data.targets as Vec2[];
        const index = op.data.index as number;
        if (index >= targets.length) {
          this.finish(op, { deconstructed: targets.length });
          return;
        }
        const target = targets[index];
        const b = this.buildingAt(target.x, target.y);
        if (b && !b.core) {
          this.buildings.delete(b.id);
          this.emit("deconstructed", { x: target.x, y: target.y, block: b.block });
        }
        op.data.index = index + 1;
        op.progress = (index + 1) / targets.length;
        return;
      }
      case "repair": {
        const target = op.data.target as Vec2;
        const b = this.buildingAt(target.x, target.y);
        if (!b) {
          this.fail(op, "target_lost", "Repair target is gone");
          return;
        }
        b.health = Math.min(b.maxHealth, b.health + 20);
        op.progress = b.health / b.maxHealth;
        if (b.health >= b.maxHealth) this.finish(op, { buildingId: b.id, health: b.health });
        return;
      }
      case "withdraw":
      case "deposit":
      case "configure":
      case "command":
      case "stance":
      case "possess":
      case "release":
      case "respawn":
        if (op.status === "running") this.finish(op, op.result);
        return;
      default:
        this.fail(op, "internal_error", `Unknown op kind ${op.kind}`);
    }
  }

  private validatePlacement(placement: BuildPlacement): string | null {
    if (!Number.isInteger(placement.x) || !Number.isInteger(placement.y)) {
      return "Coordinates must be integers";
    }
    if (placement.x < 0 || placement.y < 0 || placement.x >= MAP_SIZE || placement.y >= MAP_SIZE) {
      return "Out of bounds";
    }
    if (!["conveyor", "router", "sorter", "unloader", "micro-processor", "message", "switch", "duo"].includes(placement.block)) {
      return `Unknown or unsupported block ${placement.block}`;
    }
    if (this.buildingAt(placement.x, placement.y)) {
      return "Tile is occupied";
    }
    if ((this.resources.copper ?? 0) < BUILD_COST) {
      return "Insufficient copper";
    }
    return null;
  }

  private resolveTarget(target: CommandTarget): { kind: "unit"; id: EntityId } | { kind: "building"; id: EntityId } {
    if (target.unitId != null) {
      const u = this.units.get(target.unitId);
      if (!u || u.dead) throw new GameError("unit_not_found", `Unit ${target.unitId} not found`);
      return { kind: "unit", id: u.id };
    }
    if (target.buildingId != null) {
      const b = this.buildings.get(target.buildingId);
      if (!b) throw new GameError("building_not_found", `Building ${target.buildingId} not found`);
      return { kind: "building", id: b.id };
    }
    if (target.x != null && target.y != null) {
      for (const u of this.units.values()) {
        if (!u.dead && Math.hypot(u.x - target.x, u.y - target.y) < 1) return { kind: "unit", id: u.id };
      }
      const b = this.buildingAt(target.x, target.y);
      if (b) return { kind: "building", id: b.id };
      throw new GameError("target_not_found", `No target at ${target.x},${target.y}`);
    }
    throw new GameError("bad_request", "Target must include unitId, buildingId, or x/y");
  }

  private resolveBuilding(target: { buildingId?: EntityId; x?: number; y?: number }): BuildingSnapshot {
    if (target.buildingId != null) {
      const b = this.buildings.get(target.buildingId);
      if (!b) throw new GameError("building_not_found", `Building ${target.buildingId} not found`);
      return b;
    }
    if (target.x != null && target.y != null) {
      const b = this.buildingAt(target.x, target.y);
      if (!b) throw new GameError("building_not_found", `No building at ${target.x},${target.y}`);
      return b;
    }
    throw new GameError("bad_request", "Target must include buildingId or x/y");
  }

  private spawnHomeBody(core?: CoreSnapshot): MockUnit {
    const targetCore = core ?? this.cores[0];
    if (!targetCore) throw new GameError("no_core", "No core available");
    const id = this.nextUnitId++;
    const home: MockUnit = {
      id,
      type: "alpha",
      team: this.team,
      x: targetCore.x,
      y: targetCore.y,
      health: 200,
      maxHealth: 200,
      dead: false,
      isAi: false,
      isHome: true,
    };
    this.units.set(home.id, home);
    return home;
  }

  // ---------------------------------------------------------------- snapshots

  private snapshotUnit(u: MockUnit): UnitSnapshot {
    return {
      id: u.id,
      type: u.type,
      team: u.team,
      x: Number(u.x.toFixed(2)),
      y: Number(u.y.toFixed(2)),
      health: Math.max(0, Math.round(u.health)),
      maxHealth: u.maxHealth,
      dead: u.dead,
      rotation: u.rotation,
      item: u.item,
      itemAmount: u.itemAmount,
    };
  }

  private snapshotAssistant(u: MockUnit): AssistantSnapshot {
    return {
      ...this.snapshotUnit(u),
      isHome: !!u.isHome,
      possessing: !u.isHome,
      currentAction: this.currentOpId ? this.ops.get(this.currentOpId)?.kind : undefined,
    };
  }

  private snapshotBuilding(b: BuildingSnapshot): BuildingSnapshot {
    return { ...b, items: b.items ? { ...b.items } : undefined };
  }

  private snapshotCore(c: CoreSnapshot): CoreSnapshot {
    return { ...this.snapshotBuilding(c), core: true };
  }

  // ---------------------------------------------------------------- test helpers

  killAssistant(): void {
    const a = this.units.get(this.assistantId);
    if (!a) return;
    a.dead = true;
    a.health = 0;
    this.emit("unit_destroyed", { unitId: a.id, type: a.type, team: a.team });
  }
}
