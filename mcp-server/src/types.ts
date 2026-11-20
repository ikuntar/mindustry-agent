export type Vec2 = { x: number; y: number };
export type EntityId = number;
export type Detail = "summary" | "normal" | "full";
export type ContentType = "all" | "blocks" | "units" | "items" | "liquids";

export interface UnitSnapshot {
  id: EntityId;
  type: string;
  team: number;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  dead: boolean;
  rotation?: number;
  item?: string;
  itemAmount?: number;
}

export interface BuildingSnapshot {
  id: EntityId;
  block: string;
  team: number;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  health: number;
  maxHealth: number;
  rotation?: number;
  enabled?: boolean;
  efficiency?: number;
  itemList?: { item: string; amount: number }[];
  ammoTotal?: number;
  items?: Record<string, number>;
  config?: unknown;
  core?: boolean;
}

export interface CoreSnapshot extends BuildingSnapshot {
  core: true;
}

export interface PlayerSnapshot {
  name: string;
  team: number;
  unitId?: EntityId;
  dead: boolean;
}

export interface AssistantSnapshot extends UnitSnapshot {
  isHome: boolean;
  possessing: boolean;
  currentAction?: string;
}

export interface GameContext {
  tick: number;
  timeMs: number;
  paused: boolean;
  gameOver: boolean;
  map: string;
  mode: string;
  wave: number;
  enemies: number;
  team: number;
  teamName: string;
  player: PlayerSnapshot;
  assistant: AssistantSnapshot;
  resources: Record<string, number>;
  cores: CoreSnapshot[];
  counts: {
    units: number;
    buildings: number;
    enemyUnits: number;
  };
  nearby?: {
    units: UnitSnapshot[];
    buildings: BuildingSnapshot[];
  };
  threats?: UnitSnapshot[];
  unitsTruncated?: boolean;
  threatsTruncated?: boolean;
  bytesTruncated?: boolean;
  bytes?: number;
  eventsSince?: number;
  eventsPending?: number;
  eventSummary?: {
    total: number;
    byType: Record<string, number>;
  };
}

export interface Capabilities {
  unitId: EntityId;
  type: string;
  health: number;
  maxHealth: number;
  speed: number;
  flying: boolean;
  buildSpeed: number;
  buildRange: number;
  mineSpeed: number;
  mineTier: number;
  mineRange: number;
  itemCapacity: number;
  payloadCapacity: number;
  canBoost: boolean;
  weapons: { name: string; range: number; damage: number }[];
  commands: string[];
  canBuild: boolean;
  canMine: boolean;
  canAttack: boolean;
  canPossess: boolean;
}

export interface ContentEntry {
  name: string;
  localizedName?: string;
  [key: string]: unknown;
}

export interface ContentSnapshot {
  blocks?: ContentEntry[];
  units?: ContentEntry[];
  items?: ContentEntry[];
  liquids?: ContentEntry[];
}

export interface GameEvent {
  id: number;
  type: string;
  tick: number;
  timeMs: number;
  data: Record<string, unknown>;
}

export interface EventPage {
  events: GameEvent[];
  next: number;
  dropped: number;
  summary?: {
    total: number;
    byType: Record<string, number>;
  };
  ref?: string;
  hasMore?: boolean;
  bytes?: number;
}

export interface AreaQuery {
  x: number;
  y: number;
  radius: number;
  includeUnits?: boolean;
  includeBuildings?: boolean;
  includeEnemies?: boolean;
}

export interface AreaSnapshot {
  x: number;
  y: number;
  radius: number;
  units: UnitSnapshot[];
  buildings: BuildingSnapshot[];
}

export interface TileSnapshot {
  x: number;
  y: number;
  block: string;
  team: number;
  drop?: string;
  solid: boolean;
  items?: { item: string; amount: number }[];
  ammoTotal?: number;
  config?: string;
}

export interface AreaTileQuery {
  x: number;
  y: number;
  radius: number;
  maxTiles?: number;
}

export interface AreaTileSnapshot {
  x: number;
  y: number;
  radius: number;
  tiles: TileSnapshot[];
  truncated: boolean;
}

export interface ConfigField {
  key: string;
  type: "item" | "liquid" | "block" | "unit" | "boolean" | "string" | "number" | "point";
  values?: string[];
}

export interface ConfigSchema {
  block: string;
  configurable: boolean;
  fields: ConfigField[];
}

export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | { item: string }
  | { liquid: string }
  | { block: string }
  | { unit: string }
  | { x: number; y: number };

export interface BuildPlacement {
  block: string;
  x: number;
  y: number;
  rotation?: number;
  config?: ConfigValue;
}

export interface BuildPlanRequest {
  placements: BuildPlacement[];
  deconstruct?: Vec2[];
  allowPartial?: boolean;
}

export type UnitCommandName =
  | "move"
  | "attack"
  | "repair"
  | "rebuild"
  | "assist"
  | "mine"
  | "enterPayload"
  | "loadUnits"
  | "loadBlocks"
  | "unloadPayload"
  | "loopPayload";

export type UnitStanceName =
  | "stop"
  | "holdFire"
  | "pursueTarget"
  | "patrol"
  | "ram"
  | "boost"
  | "holdPosition"
  | "mineAuto";

export interface CommandTarget {
  unitId?: EntityId;
  buildingId?: EntityId;
  x?: number;
  y?: number;
}

export interface CommandUnitsRequest {
  unitIds?: EntityId[];
  command: UnitCommandName;
  target?: CommandTarget;
  queue?: boolean;
  stance?: UnitStanceName;
}

export type OpStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type ErrorCategory = "input" | "rule" | "resource" | "world" | "transport" | "internal";

export interface ActionError {
  code: string;
  message: string;
  category?: ErrorCategory;
  retryable?: boolean;
}

export interface ActionResult {
  opId: string;
  status: OpStatus;
  progress?: number;
  data?: unknown;
  error?: ActionError;
}

export interface ActionLogEntry extends ActionResult {
  kind: string;
  createdTick?: number;
}

export interface ActionLog {
  actions: ActionLogEntry[];
  count: number;
}

export interface ContextOptions {
  detail?: Detail;
  radius?: number;
  since?: number;
  includeEnemies?: boolean;
  maxUnits?: number;
  maxBytes?: number;
}

export interface DatasetSchema {
  width: number;
  height: number;
  layers: string[];
  dtype: string;
  coord: string;
  chunkSize?: number;
}

export interface DatasetAccess {
  mode: string;
  baseUrl: string;
  readOnly: boolean;
  expires: number;
}

export interface DatasetRef {
  ref: string;
  revision: number;
  kind: string;
  format: string;
  schema: DatasetSchema;
  bytes?: number;
  counts?: Record<string, number>;
  access?: DatasetAccess;
}

export interface MapSummary extends DatasetRef {
  kind: "map";
}

export interface GameAdapter {
  getContext(options?: ContextOptions): Promise<GameContext>;
  getCapabilities(): Promise<Capabilities>;
  getContent(type?: ContentType, query?: string, limit?: number): Promise<ContentSnapshot>;
  getMapSummary(): Promise<MapSummary>;
  getEvents(since: number, limit: number, summary?: boolean, types?: string[]): Promise<EventPage>;
  getActionLog(limit?: number): Promise<ActionLog>;
  queryArea(query: AreaQuery): Promise<AreaSnapshot>;
  getArea(query: AreaTileQuery): Promise<AreaTileSnapshot>;
  getConfigSchema(block: string): Promise<ConfigSchema>;
  getActionResult(opId: string, waitMs: number): Promise<ActionResult>;

  moveTo(x: number, y: number, arriveRadius?: number, timeoutTicks?: number): Promise<ActionResult>;
  attack(target: CommandTarget, timeoutTicks?: number): Promise<ActionResult>;
  follow(unitId: EntityId, distance?: number, timeoutTicks?: number): Promise<ActionResult>;
  mine(x: number, y: number): Promise<ActionResult>;
  stop(): Promise<ActionResult>;
  buildPlan(request: BuildPlanRequest): Promise<ActionResult>;
  deconstruct(targets: Vec2[], timeoutTicks?: number): Promise<ActionResult>;
  repair(target: Vec2): Promise<ActionResult>;
  withdraw(target: { buildingId?: EntityId; x?: number; y?: number }, item: string, amount: number): Promise<ActionResult>;
  deposit(target: { buildingId?: EntityId; x?: number; y?: number }, item: string, amount: number): Promise<ActionResult>;
  configure(x: number, y: number, value: ConfigValue): Promise<ActionResult>;
  commandUnits(request: CommandUnitsRequest): Promise<ActionResult>;
  setStance(unitIds: EntityId[], stance: UnitStanceName): Promise<ActionResult>;
  possess(unitId: EntityId): Promise<ActionResult>;
  release(): Promise<ActionResult>;
  respawn(coreId?: EntityId): Promise<ActionResult>;
  cancel(opId?: string): Promise<ActionResult>;
  close(): Promise<void>;
}

export class GameError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}
