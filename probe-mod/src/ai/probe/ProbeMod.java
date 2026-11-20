package ai.probe;

import arc.Events;
import arc.math.geom.Point2;
import arc.math.geom.Position;
import arc.math.geom.Vec2;
import arc.struct.Seq;
import arc.util.Log;
import arc.util.Time;
import arc.util.serialization.Jval;
import mindustry.Vars;
import mindustry.ai.UnitCommand;
import mindustry.ai.UnitStance;
import mindustry.ai.types.CommandAI;
import mindustry.entities.units.BuildPlan;
import mindustry.entities.units.UnitController;
import mindustry.game.EventType;
import mindustry.game.Team;
import mindustry.gen.Building;
import mindustry.gen.Call;
import mindustry.gen.Groups;
import mindustry.gen.Teamc;
import mindustry.gen.Unit;
import mindustry.mod.Mod;
import mindustry.type.Item;
import mindustry.type.UnitType;
import mindustry.world.Block;
import mindustry.world.Build;
import mindustry.world.Tile;
import mindustry.world.blocks.storage.CoreBlock;
import mindustry.world.blocks.storage.CoreBlock.CoreBuild;
import mindustry.world.modules.ItemModule;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;

/**
 * Minimal probe mod: local socket + a handful of real game actions.
 *
 * This is deliberately small. It proves that a mod can:
 *  - spawn a controllable unit from the core;
 *  - read real game state;
 *  - move that unit through a custom UnitController;
 *  - place a block through Build.validPlace / Build.beginPlace.
 */
public class ProbeMod extends Mod {
    private static final int PORT = 46500;
    private static final int DATA_PORT = Integer.parseInt(System.getenv().getOrDefault("PROBE_DATA_PORT", "46501"));
    private static final int MAP_CHUNK_SIZE = 32;
    private static final int PROTOCOL_VERSION = 1;
    private static final String VERSION = "0.1.0";

    private final String token = UUID.randomUUID().toString();
    private final String dataToken = UUID.randomUUID().toString();
    private final boolean requireAuth = "1".equals(System.getenv("PROBE_REQUIRE_AUTH"));
    private final Map<Long, MapSnapshot> mapSnapshots = new LinkedHashMap<>();
    private long mapRevision = 0;
    private long lastMapCaptureTick = -1;
    private final String dataBaseUrl = System.getenv().getOrDefault(
            "PROBE_DATA_BASE", "http://127.0.0.1:" + DATA_PORT + "/data");

    private final ConcurrentLinkedQueue<Command> queue = new ConcurrentLinkedQueue<>();
    private final Map<String, Op> ops = new HashMap<>();
    private final Seq<Jval> eventLog = new Seq<>();
    private long eventSeq = 0;
    private Unit assistant;
    private Unit homeBody;
    private UnitController savedController;
    private boolean possessing;
    private boolean autoRespawn = true;
    private ProbeController controller;
    private long opSeq = 0;

    @Override
    public void init() {
        Events.run(EventType.Trigger.update, this::update);
        Events.on(EventType.WorldLoadEvent.class, event -> reset());
        Events.on(EventType.UnitDestroyEvent.class, event -> {
            if (event.unit != null) {
                addEvent("unit_destroy", Jval.newObject()
                        .put("unitId", event.unit.id)
                        .put("type", event.unit.type.name)
                        .put("team", event.unit.team.id)
                        .put("x", event.unit.x)
                        .put("y", event.unit.y));
            }
        });
        Events.on(EventType.BlockDestroyEvent.class, event -> {
            if (event.tile != null) {
                addEvent("block_destroy", Jval.newObject()
                        .put("x", event.tile.x)
                        .put("y", event.tile.y)
                        .put("block", event.tile.block().name)
                        .put("team", event.tile.team().id));
            }
        });
        Events.on(EventType.BlockBuildEndEvent.class, event -> {
            if (event.tile != null) {
                addEvent("block_build_end", Jval.newObject()
                        .put("x", event.tile.x)
                        .put("y", event.tile.y)
                        .put("block", event.tile.block().name)
                        .put("team", event.team.id)
                        .put("breaking", event.breaking));
            }
        });
        Events.on(EventType.UnitCreateEvent.class, event -> {
            if (event.unit != null) {
                addEvent("unit_create", Jval.newObject()
                        .put("unitId", event.unit.id)
                        .put("type", event.unit.type.name)
                        .put("team", event.unit.team.id)
                        .put("x", event.unit.x)
                        .put("y", event.unit.y));
            }
        });
        Events.on(EventType.BuildDamageEvent.class, event -> {
            if (event.build != null) {
                addEvent("build_damage", Jval.newObject()
                        .put("buildingId", event.build.id)
                        .put("x", event.build.tile.x)
                        .put("y", event.build.tile.y)
                        .put("health", event.build.health));
            }
        });
        Events.on(EventType.UnitDamageEvent.class, event -> {
            if (event.unit != null) {
                addEvent("unit_damage", Jval.newObject()
                        .put("unitId", event.unit.id)
                        .put("health", event.unit.health)
                        .put("x", event.unit.x)
                        .put("y", event.unit.y));
            }
        });
        startSocket();
        startDataServer();
        Log.info("[ai-probe] listening on 127.0.0.1:" + PORT);
        Log.info("[ai-probe] data plane on 127.0.0.1:" + DATA_PORT + "/data");
    }

    private void addEvent(String type, Jval data) {
        long id = ++eventSeq;
        Jval event = Jval.newObject()
                .put("id", id)
                .put("type", type)
                .put("tick", Vars.state.tick)
                .put("timeMs", System.currentTimeMillis())
                .put("data", data);
        synchronized (eventLog) {
            eventLog.add(event);
            while (eventLog.size > 512) {
                eventLog.remove(0);
            }
        }
    }

    private void reset() {
        assistant = null;
        homeBody = null;
        savedController = null;
        possessing = false;
        autoRespawn = true;
        controller = null;
        ops.clear();
        synchronized (eventLog) {
            eventLog.clear();
        }
        eventSeq = 0;
        synchronized (mapSnapshots) {
            mapSnapshots.clear();
        }
        mapRevision = 0;
        lastMapCaptureTick = -1;
        Log.info("[ai-probe] world loaded, waiting for requests");
    }

    private void update() {
        if (!Vars.state.isGame()) {
            drainWithError("no_world", "No game is loaded");
            return;
        }

        ensureAssistant();

        long tick = (long) Vars.state.tick;
        if (mapSnapshotNeeded(tick)) {
            captureMapSnapshot(tick);
        }

        for (int i = 0; i < 50; i++) {
            Command command = queue.poll();
            if (command == null) break;
            try {
                handle(command);
            } catch (Throwable error) {
                replyError(command, "internal_error", error.toString());
            }
        }

        updateMoveOps();
        updateActionOps();
    }

    private void updateActionOps() {
        if (assistant == null) return;
        for (Op op : ops.values()) {
            if (!"running".equals(op.status)) continue;
            if ("attack".equals(op.kind)) {
                if (op.targetUnit != null || op.targetBuilding != null) {
                    float health = op.targetUnit != null ? op.targetUnit.health : op.targetBuilding.health;
                    if (health <= 0f) {
                        op.status = "done";
                        op.progress = 1f;
                        op.data = Jval.newObject().put("targetHealth", 0f);
                    } else {
                        op.data = Jval.newObject().put("targetHealth", health);
                    }
                } else if (op.targetPosition != null) {
                    float range = 0f;
                    for (var weapon : assistant.type.weapons) range = Math.max(range, weapon.range());
                    float distance = (float) Math.hypot(op.targetPosition.x - assistant.x, op.targetPosition.y - assistant.y);
                    if (distance <= range) {
                        op.status = "done";
                        op.progress = 1f;
                        op.data = Jval.newObject()
                                .put("kind", "position")
                                .put("x", op.targetPosition.x)
                                .put("y", op.targetPosition.y)
                                .put("inRange", true);
                        controller.attackPosition = null;
                        assistant.isShooting = false;
                    }
                }
            } else if ("mine".equals(op.kind)) {
                if (assistant.stack != null && assistant.stack.amount > 0) {
                    op.status = "done";
                    op.progress = 1f;
                    op.data = Jval.newObject()
                            .put("item", assistant.stack.item.name)
                            .put("amount", assistant.stack.amount);
                    assistant.mineTile = null;
                }
            } else if ("deconstruct".equals(op.kind)) {
                boolean remaining = false;
                if (op.targetTiles != null) {
                    for (Jval target : op.targetTiles.asArray()) {
                        int x = target.get("x").asInt();
                        int y = target.get("y").asInt();
                        if (Vars.world.tiles.in(x, y) && Vars.world.tile(x, y).build != null) {
                            remaining = true;
                            break;
                        }
                    }
                }
                if (!remaining) {
                    op.status = "done";
                    op.progress = 1f;
                    op.data = Jval.newObject().put("deconstructed", true);
                }
            } else if ("repair".equals(op.kind)) {
                if (op.targetBuilding == null || op.targetBuilding.health >= op.targetBuilding.block.health) {
                    op.status = "done";
                    op.progress = 1f;
                    op.data = Jval.newObject().put("health", op.targetBuilding == null ? 0 : op.targetBuilding.health);
                } else {
                    op.targetBuilding.heal(Time.delta * Math.max(1f, assistant.type.buildSpeed) * 10f);
                    op.data = Jval.newObject()
                            .put("x", op.targetBuilding.tile.x)
                            .put("y", op.targetBuilding.tile.y)
                            .put("health", op.targetBuilding.health)
                            .put("maxHealth", op.targetBuilding.block.health);
                }
            } else if ("follow".equals(op.kind)) {
                if (op.targetUnit == null || op.targetUnit.dead) {
                    op.status = "done";
                    op.progress = 1f;
                    op.data = Jval.newObject().put("reason", "target_gone");
                }
            }
        }
    }

    private void ensureAssistant() {
        if (possessing) return;
        if (!autoRespawn && assistant != null && assistant.dead) return;
        if (assistant != null && assistant.isValid() && !assistant.dead) return;

        Team team = Vars.state.rules.defaultTeam;
        CoreBuild core = team.core();
        if (core == null) return;

        UnitType type = ((CoreBlock) core.block).unitType;
        Unit unit = type.create(team);
        unit.x = core.x;
        unit.y = core.y;
        unit.health = type.health;
        unit.maxHealth = type.health;
        // Do NOT set spawnedByCore here: the engine despawns any non-player unit
        // with that flag on its next update. The probe tracks home bodies itself.
        unit.spawnedByCore(false);
        controller = new ProbeController();
        unit.controller(controller);
        unit.add();
        assistant = unit;
        homeBody = unit;
        Log.info("[ai-probe] assistant spawned: id=" + unit.id + " type=" + type.name + " team=" + team.name
                + " valid=" + unit.isValid() + " added=" + unit.isAdded() + " dead=" + unit.dead + " health=" + unit.health);
    }

    private void updateMoveOps() {
        if (assistant == null || controller == null) return;
        Vec2 target = controller.target;
        if (target == null) return;

        float distance = (float) Math.hypot(target.x - assistant.x, target.y - assistant.y);
        for (Op op : ops.values()) {
            if (!"move".equals(op.kind) || !"running".equals(op.status)) continue;
            op.progress = Math.max(0f, Math.min(0.99f, 1f - distance / Math.max(1f, op.startDistance)));
            if (distance <= op.arriveRadius) {
                op.status = "done";
                op.progress = 1f;
                op.data = Jval.newObject()
                        .put("x", assistant.x)
                        .put("y", assistant.y);
                controller.target = null;
            }
        }
    }

    private void handle(Command command) {
        Jval request = command.request;
        String op = request.getString("op", "");

        if (requireAuth && !"hello".equals(op) && !token.equals(request.getString("token", ""))) {
            replyError(command, "unauthorized", "Missing or invalid probe token");
            return;
        }

        if ("hello".equals(op)) {
            reply(command, Jval.newObject()
                    .put("protocol", PROTOCOL_VERSION)
                    .put("version", VERSION)
                    .put("port", PORT)
                    .put("dataPort", DATA_PORT)
                    .put("dataBaseUrl", dataBaseUrl)
                    .put("requireAuth", requireAuth));
            return;
        }

        if ("get_map_manifest".equals(op)) {
            if (mapRevision == 0) captureMapSnapshot((long) Vars.state.tick);
            MapSnapshot snapshot = findMapSnapshot(mapRevision);
            if (snapshot == null) {
                replyError(command, "map_not_ready", "Map snapshot is not ready");
                return;
            }
            reply(command, snapshot.manifest(dataBaseUrl));
            return;
        }

        if ("get_context".equals(op)) {
            reply(command, context());
            return;
        }

        if ("get_action_result".equals(op)) {
            String opId = request.getString("opId", "");
            Op result = ops.get(opId);
            if (result == null) {
                replyError(command, "op_not_found", "Unknown opId " + opId);
                return;
            }
            reply(command, result.toJson());
            return;
        }

        if ("get_events".equals(op)) {
            int since = request.getInt("since", 0);
            int limit = Math.max(1, Math.min(200, request.getInt("limit", 50)));
            boolean summary = request.getBool("summary", false);
            Jval types = request.get("types");
            Jval events = Jval.newArray();
            Jval byType = Jval.newObject();
            int total = 0;
            long next = since;
            long oldest;
            boolean hasMore = false;
            synchronized (eventLog) {
                oldest = eventLog.isEmpty() ? 0 : eventLog.first().getInt("id", 0);
                for (Jval event : eventLog) {
                    int id = event.getInt("id", 0);
                    if (id <= since) continue;
                    if (types != null && types.isArray()) {
                        String eventType = event.get("type") == null ? "" : event.get("type").asString();
                        boolean allowed = false;
                        for (Jval type : types.asArray()) {
                            if (eventType.equals(type.asString())) {
                                allowed = true;
                                break;
                            }
                        }
                        if (!allowed) continue;
                    }
                    if (summary) {
                        total++;
                        String eventType = event.get("type") == null ? "unknown" : event.get("type").asString();
                        Jval count = byType.get(eventType);
                        byType.put(eventType, (count == null ? 0 : count.asInt()) + 1);
                        next = id;
                    } else {
                        if (events.asArray().size >= limit) {
                            hasMore = true;
                            break;
                        }
                        events.add(event);
                        next = id;
                    }
                }
            }
            int dropped = since < oldest - 1 ? (int) (oldest - 1 - since) : 0;
            if (summary) {
                Jval data = Jval.newObject()
                        .put("summary", Jval.newObject().put("total", total).put("byType", byType))
                        .put("next", next)
                        .put("dropped", dropped)
                        .put("ref", "obs://events/rev/" + next)
                        .put("hasMore", false);
                data.put("bytes", data.toString(Jval.Jformat.plain).getBytes(StandardCharsets.UTF_8).length);
                reply(command, data);
            } else {
                reply(command, Jval.newObject()
                        .put("events", events)
                        .put("next", next)
                        .put("dropped", dropped)
                        .put("hasMore", hasMore));
            }
            return;
        }

        if ("get_tile".equals(op)) {
            int x = request.getInt("x", Integer.MIN_VALUE);
            int y = request.getInt("y", Integer.MIN_VALUE);
            if (!Vars.world.tiles.in(x, y)) {
                replyError(command, "out_of_bounds", "Tile is outside the map");
                return;
            }
            var tile = Vars.world.tile(x, y);
            Jval data = Jval.newObject()
                    .put("x", x)
                    .put("y", y)
                    .put("block", tile.block().name)
                    .put("team", tile.team().id)
                    .put("drop", tile.drop() == null ? "" : tile.drop().name);
            if (tile.build != null) {
                data.put("health", tile.build.health);
                data.put("maxHealth", tile.build.block.health);
                data.put("rotation", tile.build.rotation);
            }
            reply(command, data);
            return;
        }

        if ("get_capabilities".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            UnitType type = assistant.type;
            Jval weapons = Jval.newArray();
            for (var weapon : type.weapons) {
                weapons.add(Jval.newObject()
                        .put("name", weapon.name)
                        .put("range", weapon.range())
                        .put("damage", 0));
            }
            Jval commands = Jval.newArray();
            for (var unitCommand : type.commands) {
                commands.add(unitCommand.name);
            }
            Jval data = Jval.newObject()
                    .put("unitId", assistant.id)
                    .put("type", type.name)
                    .put("health", assistant.health)
                    .put("maxHealth", assistant.maxHealth)
                    .put("speed", type.speed)
                    .put("flying", type.flying)
                    .put("buildSpeed", type.buildSpeed)
                    .put("buildRange", type.buildRange)
                    .put("mineSpeed", type.mineSpeed)
                    .put("mineTier", type.mineTier)
                    .put("mineRange", type.mineRange)
                    .put("itemCapacity", type.itemCapacity)
                    .put("payloadCapacity", type.payloadCapacity)
                    .put("canBoost", type.canBoost)
                    .put("weapons", weapons)
                    .put("commands", commands)
                    .put("canBuild", type.buildSpeed > 0)
                    .put("canMine", type.mineTier >= 0)
                    .put("canAttack", type.weapons.size > 0)
                    .put("canPossess", !assistant.dead);
            reply(command, data);
            return;
        }

        if ("query_area".equals(op)) {
            float x = request.getFloat("x", 0f);
            float y = request.getFloat("y", 0f);
            float radius = request.getFloat("radius", 20f);
            boolean includeUnits = request.getBool("includeUnits", true);
            boolean includeBuildings = request.getBool("includeBuildings", true);
            Team team = assistant != null ? assistant.team : Vars.state.rules.defaultTeam;

            Jval units = Jval.newArray();
            if (includeUnits) {
                for (Unit unit : mindustry.gen.Groups.unit) {
                    if (unit.team != team) continue;
                    if (Math.hypot(unit.x - x, unit.y - y) > radius) continue;
                    units.add(Jval.newObject()
                            .put("id", unit.id)
                            .put("type", unit.type.name)
                            .put("team", unit.team.id)
                            .put("x", unit.x)
                            .put("y", unit.y)
                            .put("health", unit.health)
                            .put("maxHealth", unit.maxHealth)
                            .put("dead", unit.dead));
                }
            }

            Jval buildings = Jval.newArray();
            if (includeBuildings) {
                int tileX = Vars.world.toTile(x);
                int tileY = Vars.world.toTile(y);
                int tileRadius = (int) Math.ceil(radius / 8f);
                for (int dx = -tileRadius; dx <= tileRadius; dx++) {
                    for (int dy = -tileRadius; dy <= tileRadius; dy++) {
                        Tile tile = Vars.world.tile(tileX + dx, tileY + dy);
                        Building building = tile == null ? null : tile.build;
                        if (building == null || building.team != team) continue;
                        if (tile.x != building.tile.x || tile.y != building.tile.y) continue;
                        if (Math.hypot(building.x - x, building.y - y) > radius) continue;
                        buildings.add(Jval.newObject()
                                .put("id", building.id)
                                .put("block", building.block.name)
                                .put("team", building.team.id)
                                .put("x", building.x)
                                .put("y", building.y)
                                .put("tileX", building.tile.x)
                                .put("tileY", building.tile.y)
                                .put("health", building.health)
                                .put("maxHealth", building.block.health)
                                .put("rotation", building.rotation));
                    }
                }
            }

            reply(command, Jval.newObject()
                    .put("x", x)
                    .put("y", y)
                    .put("radius", radius)
                    .put("units", units)
                    .put("buildings", buildings));
            return;
        }

        if ("withdraw".equals(op) || "deposit".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            Building building = findBuilding(request.get("target"));
            if (building == null) {
                replyError(command, "building_not_found", "No target building");
                return;
            }
            if (building.team != assistant.team) {
                replyError(command, "wrong_team", "Target building is not on the assistant's team");
                return;
            }
            if (Math.hypot(building.x - assistant.x, building.y - assistant.y) > Vars.itemTransferRange) {
                replyError(command, "out_of_range", "Target building is outside itemTransferRange");
                return;
            }
            Item item = Vars.content.item(request.getString("item", ""));
            if (item == null) {
                replyError(command, "not_found", "Unknown item");
                return;
            }
            int amount = request.getInt("amount", 0);
            if ("withdraw".equals(op)) {
                int available = building.items == null ? 0 : building.items.get(item);
                int capacity = assistant.maxAccepted(item) - (assistant.stack == null ? 0 : assistant.stack.amount);
                int taken = Math.min(Math.min(amount, available), Math.max(0, capacity));
                if (taken <= 0) {
                    replyError(command, "not_found", "No item or no capacity");
                    return;
                }
                building.removeStack(item, taken);
                assistant.addItem(item, taken);
                reply(command, Jval.newObject().put("item", item.name).put("amount", taken));
            } else {
                if (assistant.stack == null || assistant.stack.amount <= 0 || assistant.stack.item != item) {
                    replyError(command, "not_found", "Assistant is not carrying that item");
                    return;
                }
                int accepted = building.acceptStack(item, Math.min(amount, assistant.stack.amount), assistant);
                int moved = Math.min(accepted, assistant.stack.amount);
                if (moved <= 0) {
                    replyError(command, "not_found", "Building does not accept the item");
                    return;
                }
                building.handleStack(item, moved, assistant);
                assistant.stack.amount -= moved;
                if (assistant.stack.amount <= 0) assistant.clearItem();
                reply(command, Jval.newObject().put("item", item.name).put("amount", moved));
            }
            return;
        }

        if ("configure".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            Building building = findBuilding(request);
            if (building == null) {
                replyError(command, "building_not_found", "No target building");
                return;
            }
            if (building.team != assistant.team) {
                replyError(command, "wrong_team", "Target building is not on the assistant's team");
                return;
            }
            if (!building.block.configurable) {
                replyError(command, "not_configurable", "Target block is not configurable");
                return;
            }
            Object value = configValue(request.get("value"));
            building.configured(assistant, value);
            reply(command, Jval.newObject()
                    .put("block", building.block.name)
                    .put("x", building.tileX())
                    .put("y", building.tileY()));
            return;
        }

        if ("command_units".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            UnitCommand unitCommand = Vars.content.unitCommand(request.getString("command", ""));
            if (unitCommand == null) {
                replyError(command, "bad_request", "Unknown unit command");
                return;
            }
            Jval ids = request.get("unitIds");
            if (ids == null || !ids.isArray()) {
                replyError(command, "bad_request", "Missing unitIds");
                return;
            }
            Jval target = request.get("target");
            boolean queue = request.getBool("queue", false);
            Jval commanded = Jval.newArray();
            for (Jval idValue : ids.asArray()) {
                Unit unit = Groups.unit.getByID(idValue.asInt());
                if (unit == null || unit.dead) {
                    replyError(command, "unit_not_found", "Unit " + idValue.asInt() + " not found");
                    return;
                }
                if (unit.team != assistant.team) {
                    replyError(command, "wrong_team", "Unit " + unit.id + " is not on the assistant's team");
                    return;
                }
                if (!(unit.controller() instanceof CommandAI commandAI)) {
                    replyError(command, "not_commandable", "Unit " + unit.id + " is not CommandAI");
                    return;
                }
                if (!unit.type.allowCommand(unit, unitCommand)) {
                    replyError(command, "not_commandable", "Unit type does not allow command " + unitCommand.name);
                    return;
                }
                commandAI.command(unitCommand);
                if (target != null && target.get("x") != null && target.get("y") != null) {
                    Vec2 position = new Vec2(target.get("x").asFloat(), target.get("y").asFloat());
                    if (queue) {
                        commandAI.commandQueue(position);
                    } else {
                        commandAI.commandPosition(position);
                    }
                } else if (target != null && target.get("unitId") != null) {
                    Unit targetUnit = Groups.unit.getByID(target.get("unitId").asInt());
                    if (targetUnit != null) commandAI.commandTarget(targetUnit);
                } else if (target != null && target.get("buildingId") != null) {
                    Building targetBuilding = findBuilding(target);
                    if (targetBuilding != null) commandAI.commandTarget(targetBuilding);
                }
                commanded.add(unit.id);
            }
            reply(command, Jval.newObject().put("commanded", commanded));
            return;
        }

        if ("set_stance".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            UnitStance stance = findStance(request.getString("stance", ""));
            if (stance == null) {
                replyError(command, "bad_request", "Unknown stance");
                return;
            }
            Jval ids = request.get("unitIds");
            if (ids == null || !ids.isArray()) {
                replyError(command, "bad_request", "Missing unitIds");
                return;
            }
            Jval changed = Jval.newArray();
            for (Jval idValue : ids.asArray()) {
                Unit unit = Groups.unit.getByID(idValue.asInt());
                if (unit == null || unit.dead) {
                    replyError(command, "unit_not_found", "Unit " + idValue.asInt() + " not found");
                    return;
                }
                if (unit.team != assistant.team) {
                    replyError(command, "wrong_team", "Unit " + unit.id + " is not on the assistant's team");
                    return;
                }
                if (!(unit.controller() instanceof CommandAI commandAI)) {
                    replyError(command, "not_commandable", "Unit " + unit.id + " is not CommandAI");
                    return;
                }
                commandAI.setStance(stance);
                changed.add(unit.id);
            }
            reply(command, Jval.newObject().put("units", changed).put("stance", stance.name));
            return;
        }

        if ("stop".equals(op)) {
            if (controller != null) controller.target = null;
            if (assistant != null) {
                assistant.clearBuilding();
            }
            reply(command, Jval.newObject().put("stopped", true));
            return;
        }

        if ("spawn_ally".equals(op)) {
            // Probe/debug helper for command tests; not part of the MCP surface.
            UnitType type = Vars.content.unit(request.getString("type", "dagger"));
            if (type == null) {
                replyError(command, "not_found", "Unknown unit type");
                return;
            }
            Team team = assistant == null ? Vars.state.rules.defaultTeam : assistant.team;
            float x = request.getFloat("x", assistant == null ? 0f : assistant.x + 24f);
            float y = request.getFloat("y", assistant == null ? 0f : assistant.y);
            Unit unit = type.create(team);
            unit.x = x;
            unit.y = y;
            unit.health = type.health;
            unit.maxHealth = type.health;
            unit.add();
            reply(command, Jval.newObject()
                    .put("id", unit.id)
                    .put("type", type.name)
                    .put("controller", unit.controller().getClass().getSimpleName()));
            return;
        }

        if ("give".equals(op)) {
            // Probe/debug helper for configuring/building tests; not part of the MCP surface.
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            CoreBuild core = assistant.closestCore();
            if (core == null) {
                replyError(command, "not_found", "No core for assistant");
                return;
            }
            Item item = Vars.content.item(request.getString("item", ""));
            if (item == null) {
                replyError(command, "not_found", "Unknown item");
                return;
            }
            int amount = request.getInt("amount", 0);
            core.items.add(item, amount);
            reply(command, Jval.newObject().put("item", item.name).put("amount", amount));
            return;
        }

        if ("kill_assistant".equals(op)) {
            // Probe/debug helper for death/respawn tests; not part of the MCP surface.
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            autoRespawn = false;
            int id = assistant.id;
            assistant.kill();
            reply(command, Jval.newObject().put("unitId", id).put("dead", assistant.dead));
            return;
        }

        if ("possess".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            if (possessing) {
                replyError(command, "already_possessing", "Assistant is already possessing a body");
                return;
            }
            Unit target = findUnit(request);
            if (target == null || target.dead) {
                replyError(command, "unit_not_found", "Target unit not found");
                return;
            }
            if (target == assistant) {
                replyError(command, "bad_target", "Cannot possess the assistant's own body");
                return;
            }
            if (target.team != assistant.team) {
                replyError(command, "wrong_team", "Target unit is not on the assistant's team");
                return;
            }
            if (target.isPlayer() || !target.isAI()) {
                replyError(command, "not_possessable", "Target unit is not an AI body");
                return;
            }
            if (!target.type.playerControllable) {
                replyError(command, "not_possessable", "Target unit type is not player-controllable");
                return;
            }

            Unit oldHome = homeBody;
            savedController = target.controller();
            target.controller(controller);
            controller.unit(target);
            controller.target = null;
            controller.attackEntity = null;
            controller.attackPosition = null;
            controller.followTarget = null;
            assistant = target;
            homeBody = null;
            possessing = true;
            if (oldHome != null) {
                Call.unitDespawn(oldHome);
            }
            reply(command, Jval.newObject()
                    .put("unitId", target.id)
                    .put("type", target.type.name)
                    .put("homeBodyRemoved", oldHome == null ? -1 : oldHome.id));
            return;
        }

        if ("release".equals(op)) {
            if (!possessing || assistant == null) {
                replyError(command, "not_possessing", "Assistant is not possessing a body");
                return;
            }
            Unit target = assistant;
            if (savedController != null) {
                target.controller(savedController);
            }
            possessing = false;
            assistant = null;
            homeBody = null;
            controller = null;
            savedController = null;
            ensureAssistant();
            if (assistant == null) {
                replyError(command, "no_core", "Released body but no core is available for a home body");
                return;
            }
            reply(command, Jval.newObject()
                    .put("releasedUnitId", target.id)
                    .put("homeUnitId", assistant.id)
                    .put("homeType", assistant.type.name));
            return;
        }

        if ("respawn".equals(op)) {
            autoRespawn = true;
            if (!possessing && assistant != null && !assistant.dead) {
                replyError(command, "assistant_alive", "Assistant body is alive");
                return;
            }
            if (possessing) {
                possessing = false;
                savedController = null;
                assistant = null;
                homeBody = null;
                controller = null;
            }
            ensureAssistant();
            if (assistant == null) {
                replyError(command, "no_core", "No core is available for respawn");
                return;
            }
            reply(command, Jval.newObject()
                    .put("unitId", assistant.id)
                    .put("type", assistant.type.name)
                    .put("health", assistant.health));
            return;
        }

        if ("spawn_enemy_building".equals(op)) {
            // Probe/debug helper for attack tests; not part of the MCP surface.
            Block block = Vars.content.block(request.getString("block", "container"));
            if (block == null) {
                replyError(command, "not_found", "Unknown block");
                return;
            }
            int x = request.getInt("x", Integer.MIN_VALUE);
            int y = request.getInt("y", Integer.MIN_VALUE);
            if (!Vars.world.tiles.in(x, y)) {
                replyError(command, "out_of_bounds", "Tile is outside the map");
                return;
            }
            Tile tile = Vars.world.tile(x, y);
            if (tile.build != null || !tile.block().isAir()) {
                replyError(command, "occupied", "Tile is not empty");
                return;
            }
            Team team = assistant != null && assistant.team == Team.crux ? Team.sharded : Team.crux;
            tile.setBlock(block, team, 0);
            Building building = tile.build;
            reply(command, Jval.newObject()
                    .put("buildingId", building == null ? -1 : building.id)
                    .put("block", block.name)
                    .put("x", x)
                    .put("y", y)
                    .put("health", building == null ? 0 : building.health));
            return;
        }

        if ("deconstruct".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            Jval targets = request.get("targets");
            if (targets == null && request.get("x") != null && request.get("y") != null) {
                targets = Jval.newArray().add(Jval.newObject()
                        .put("x", request.getInt("x", 0))
                        .put("y", request.getInt("y", 0)));
            }
            if (targets == null || !targets.isArray() || targets.asArray().isEmpty()) {
                replyError(command, "bad_request", "deconstruct requires targets[]");
                return;
            }
            Jval planned = Jval.newArray();
            for (Jval target : targets.asArray()) {
                int x = target.get("x").asInt();
                int y = target.get("y").asInt();
                if (!Vars.world.tiles.in(x, y) || Vars.world.tile(x, y).build == null) {
                    replyError(command, "building_not_found", "No building at " + x + "," + y);
                    return;
                }
                if (!Build.validBreak(assistant.team, x, y)) {
                    replyError(command, "invalid_deconstruct", "Build.validBreak returned false at " + x + "," + y);
                    return;
                }
                assistant.addBuild(new BuildPlan(x, y));
                planned.add(Jval.newObject().put("x", x).put("y", y));
            }
            Op result = newOp("deconstruct");
            result.status = "running";
            result.targetTiles = targets;
            result.data = Jval.newObject().put("targets", planned);
            reply(command, result.toJson());
            return;
        }

        if ("repair".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            Building building = findBuilding(request);
            if (building == null) {
                replyError(command, "building_not_found", "No target building");
                return;
            }
            if (building.team != assistant.team) {
                replyError(command, "wrong_team", "Target building is not on the assistant's team");
                return;
            }
            if (building.health >= building.block.health) {
                replyError(command, "already_full", "Target building is already at full health");
                return;
            }
            if (Math.hypot(building.x - assistant.x, building.y - assistant.y) > assistant.type.buildRange) {
                replyError(command, "out_of_range", "Target building is outside buildRange");
                return;
            }
            Op result = newOp("repair");
            result.status = "running";
            result.targetBuilding = building;
            result.targetPosition = new Vec2(building.x, building.y);
            result.data = Jval.newObject()
                    .put("x", building.tile.x)
                    .put("y", building.tile.y)
                    .put("health", building.health)
                    .put("maxHealth", building.block.health);
            reply(command, result.toJson());
            return;
        }

        if ("cancel".equals(op)) {
            String opId = request.getString("opId", "");
            int cancelled = 0;
            for (Op result : ops.values()) {
                if (!opId.isEmpty() && !opId.equals(result.id)) continue;
                if ("running".equals(result.status) || "queued".equals(result.status)) {
                    result.status = "cancelled";
                    result.progress = 0f;
                    cancelled++;
                    if (controller != null) {
                        if ("move".equals(result.kind)) controller.target = null;
                        if ("attack".equals(result.kind)) {
                            controller.attackEntity = null;
                            controller.attackPosition = null;
                            if (assistant != null) assistant.isShooting = false;
                        }
                        if ("follow".equals(result.kind)) controller.followTarget = null;
                        if ("build".equals(result.kind) || "deconstruct".equals(result.kind) || "repair".equals(result.kind)) {
                            if (assistant != null) assistant.clearBuilding();
                        }
                    }
                }
            }
            if (opId.isEmpty()) {
                if (assistant != null) assistant.clearBuilding();
                if (controller != null) {
                    controller.target = null;
                    controller.attackEntity = null;
                    controller.attackPosition = null;
                    controller.followTarget = null;
                }
            }
            reply(command, Jval.newObject().put("cancelled", cancelled).put("opId", opId));
            return;
        }

        if ("damage_building".equals(op)) {
            // Probe/debug helper for repair tests; not part of the MCP surface.
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            Building building = findBuilding(request);
            if (building == null) {
                replyError(command, "building_not_found", "No target building");
                return;
            }
            if (building.team != assistant.team) {
                replyError(command, "wrong_team", "Target building is not on the assistant's team");
                return;
            }
            float amount = request.getFloat("amount", 10f);
            building.damage(amount);
            reply(command, Jval.newObject()
                    .put("buildingId", building.id)
                    .put("health", building.health)
                    .put("maxHealth", building.block.health));
            return;
        }

        if ("attack".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            if (assistant.type.weapons.isEmpty()) {
                replyError(command, "cannot_attack", "Assistant body has no weapons");
                return;
            }
            Jval target = request.get("target");
            Unit targetUnit = null;
            Building targetBuilding = null;
            Position position = null;
            Teamc entity = null;
            String kind = "";
            if (target == null) {
                replyError(command, "bad_request", "Missing target");
                return;
            }
            if (target.get("unitId") != null) {
                targetUnit = findUnit(target);
                if (targetUnit == null) {
                    replyError(command, "unit_not_found", "Target unit not found");
                    return;
                }
                if (targetUnit.team == assistant.team) {
                    replyError(command, "wrong_team", "Refusing to attack a unit on the assistant's team");
                    return;
                }
                position = targetUnit;
                entity = targetUnit;
                kind = "unit";
            } else if (target.get("buildingId") != null) {
                targetBuilding = findBuilding(target);
                if (targetBuilding == null) {
                    replyError(command, "building_not_found", "Target building not found");
                    return;
                }
                if (targetBuilding.team == assistant.team) {
                    replyError(command, "wrong_team", "Refusing to attack a building on the assistant's team");
                    return;
                }
                position = targetBuilding;
                entity = targetBuilding;
                kind = "building";
            } else if (target.get("x") != null && target.get("y") != null) {
                position = new Vec2(target.get("x").asFloat(), target.get("y").asFloat());
                kind = "position";
            } else {
                replyError(command, "bad_request", "Target must contain unitId, buildingId, or x/y");
                return;
            }
            controller.target = null;
            controller.followTarget = null;
            controller.attackEntity = entity;
            controller.attackPosition = new Vec2(position.getX(), position.getY());
            Op result = newOp("attack");
            result.status = "running";
            result.targetUnit = targetUnit;
            result.targetBuilding = targetBuilding;
            result.targetPosition = new Vec2(position.getX(), position.getY());
            result.data = Jval.newObject()
                    .put("kind", kind)
                    .put("unitId", targetUnit == null ? -1 : targetUnit.id)
                    .put("buildingId", targetBuilding == null ? -1 : targetBuilding.id)
                    .put("x", position.getX())
                    .put("y", position.getY());
            reply(command, result.toJson());
            return;
        }

        if ("follow".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            Unit targetUnit = findUnit(request);
            if (targetUnit == null || targetUnit.dead) {
                replyError(command, "unit_not_found", "Target unit not found");
                return;
            }
            controller.attackEntity = null;
            controller.attackPosition = null;
            controller.followTarget = targetUnit;
            controller.followDistance = request.getFloat("distance", 48f);
            Op result = newOp("follow");
            result.status = "running";
            result.targetUnit = targetUnit;
            result.data = Jval.newObject().put("unitId", targetUnit.id);
            reply(command, result.toJson());
            return;
        }

        if ("mine".equals(op)) {
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }
            int x = request.getInt("x", Integer.MIN_VALUE);
            int y = request.getInt("y", Integer.MIN_VALUE);
            Tile tile = Vars.world.tiles.in(x, y) ? Vars.world.tile(x, y) : null;
            if (tile == null) {
                replyError(command, "out_of_bounds", "Tile is outside the map");
                return;
            }
            Item drop = tile.drop();
            if (drop == null || !assistant.canMine(drop)) {
                replyError(command, "not_mineable", "Tile has no mineable item for this body");
                return;
            }
            if (Math.hypot(tile.worldx() - assistant.x, tile.worldy() - assistant.y) > assistant.type.mineRange) {
                replyError(command, "out_of_range", "Tile is outside mineRange");
                return;
            }
            controller.target = null;
            controller.attackEntity = null;
            controller.attackPosition = null;
            controller.followTarget = null;
            assistant.mineTile = tile;
            assistant.mineTimer = 0f;
            Op result = newOp("mine");
            result.status = "running";
            result.data = Jval.newObject()
                    .put("x", x)
                    .put("y", y)
                    .put("item", drop.name);
            reply(command, result.toJson());
            return;
        }

        if ("get_unit".equals(op)) {
            Unit unit = findUnit(request);
            if (unit == null) {
                replyError(command, "unit_not_found", "Unit not found");
                return;
            }
            reply(command, Jval.newObject()
                    .put("id", unit.id)
                    .put("type", unit.type.name)
                    .put("team", unit.team.id)
                    .put("x", unit.x)
                    .put("y", unit.y)
                    .put("health", unit.health)
                    .put("maxHealth", unit.maxHealth)
                    .put("dead", unit.dead)
                    .put("item", unit.item() == null ? "" : unit.item().name)
                    .put("itemAmount", unit.stack == null ? 0 : unit.stack.amount));
            return;
        }

        if ("spawn_enemy".equals(op)) {
            UnitType type = Vars.content.unit(request.getString("type", "dagger"));
            if (type == null) {
                replyError(command, "not_found", "Unknown unit type");
                return;
            }
            Team team = assistant != null && assistant.team == Team.crux ? Team.sharded : Team.crux;
            float x = request.getFloat("x", assistant == null ? 0f : assistant.x + 80f);
            float y = request.getFloat("y", assistant == null ? 0f : assistant.y);
            Unit unit = type.create(team);
            unit.x = x;
            unit.y = y;
            unit.health = type.health;
            unit.maxHealth = type.health;
            unit.spawnedByCore(false);
            unit.controller(new IdleController());
            unit.add();
            reply(command, Jval.newObject().put("id", unit.id).put("type", type.name).put("team", team.id));
            return;
        }

        if ("move_to".equals(op)) {
            float x = request.getFloat("x", Float.NaN);
            float y = request.getFloat("y", Float.NaN);
            float arriveRadius = request.getFloat("arriveRadius", 8f);
            if (Float.isNaN(x) || Float.isNaN(y)) {
                replyError(command, "bad_request", "Missing x/y");
                return;
            }
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }

            Op result = newOp("move");
            result.arriveRadius = arriveRadius;
            result.startDistance = (float) Math.hypot(x - assistant.x, y - assistant.y);
            result.status = "running";
            controller.target = new Vec2(x, y);
            reply(command, result.toJson());
            return;
        }

        if ("build".equals(op)) {
            String blockName = request.getString("block", "");
            int x = request.getInt("x", Integer.MIN_VALUE);
            int y = request.getInt("y", Integer.MIN_VALUE);
            int rotation = request.getInt("rotation", 0);
            if (assistant == null) {
                replyError(command, "no_assistant", "Assistant is not spawned");
                return;
            }

            Block block = Vars.content.block(blockName);
            if (block == null) {
                replyError(command, "not_found", "Unknown block " + blockName);
                return;
            }
            Team team = assistant.team;
            if (!Vars.world.tiles.in(x, y)) {
                replyError(command, "out_of_bounds", "Tile is outside the map");
                return;
            }
            if (!Build.validPlace(block, team, x, y, rotation)) {
                replyError(command, "invalid_placement", "Build.validPlace returned false");
                return;
            }
            if (!assistant.canBuild()) {
                replyError(command, "cannot_build", "Assistant body has buildSpeed <= 0");
                return;
            }

            // Queue a real BuildPlan; BuilderComp will call Build.beginPlace and
            // ConstructBuild.construct on the game thread when in range.
            assistant.updateBuilding(true);
            assistant.addBuild(new BuildPlan(x, y, rotation, block));
            Op result = newOp("build");
            result.status = "done";
            result.progress = 0f;
            result.data = Jval.newObject()
                    .put("block", blockName)
                    .put("x", x)
                    .put("y", y)
                    .put("queued", true);
            reply(command, result.toJson());
            return;
        }

        replyError(command, "bad_request", "Unknown op " + op);
    }

    private Unit findUnit(Jval target) {
        if (target == null) return null;
        Jval unitId = target.get("unitId");
        if (unitId == null) unitId = target.get("id");
        if (unitId == null) return null;
        int id = unitId.asInt();
        for (Unit unit : Groups.unit) {
            if (unit.id == id) return unit;
        }
        return null;
    }

    private UnitStance findStance(String name) {
        UnitStance stance = Vars.content.unitStance(name);
        if (stance != null) return stance;
        if ("stop".equals(name)) return UnitStance.stop;
        if ("holdFire".equals(name)) return UnitStance.holdFire;
        if ("pursueTarget".equals(name)) return UnitStance.pursueTarget;
        if ("patrol".equals(name)) return UnitStance.patrol;
        if ("ram".equals(name)) return UnitStance.ram;
        if ("boost".equals(name)) return UnitStance.boost;
        if ("holdPosition".equals(name)) return UnitStance.holdPosition;
        if ("mineAuto".equals(name)) return UnitStance.mineAuto;
        return null;
    }

    private Building findBuilding(Jval target) {
        if (target == null) return null;
        Jval buildingId = target.get("buildingId");
        if (buildingId != null) {
            int id = buildingId.asInt();
            for (Building building : Groups.build) {
                if (building.id == id) return building;
            }
            for (int ty = 0; ty < Vars.world.height(); ty++) {
                for (int tx = 0; tx < Vars.world.width(); tx++) {
                    Tile tile = Vars.world.tile(tx, ty);
                    if (tile != null && tile.build != null && tile.build.id == id) {
                        return tile.build;
                    }
                }
            }
        }
        Jval x = target.get("x");
        Jval y = target.get("y");
        if (x != null && y != null) {
            Tile tile = Vars.world.tile(x.asInt(), y.asInt());
            return tile == null ? null : tile.build;
        }
        return null;
    }

    private Object configValue(Jval value) {
        if (value == null || value.isNull()) return null;
        if (value.isString()) return value.asString();
        if (value.isBoolean()) return value.asInt() != 0;
        if (value.isNumber()) return value.asInt();
        if (value.isObject()) {
            Jval item = value.get("item");
            if (item != null) return Vars.content.item(item.asString());
            Jval liquid = value.get("liquid");
            if (liquid != null) return Vars.content.liquid(liquid.asString());
            Jval block = value.get("block");
            if (block != null) return Vars.content.block(block.asString());
            Jval unit = value.get("unit");
            if (unit != null) return Vars.content.unit(unit.asString());
            Jval x = value.get("x");
            Jval y = value.get("y");
            if (x != null && y != null) return new Point2(x.asInt(), y.asInt());
        }
        return null;
    }

    private Op newOp(String kind) {
        Op op = new Op();
        op.id = "op-" + (++opSeq);
        op.kind = kind;
        op.status = "queued";
        op.createdTick = Vars.state.tick;
        ops.put(op.id, op);
        return op;
    }

    private Jval context() {
        Team team = Vars.state.rules.defaultTeam;
        Jval data = Jval.newObject()
                .put("tick", Vars.state.tick)
                .put("timeMs", Time.millis())
                .put("map", Vars.state.map == null ? "" : Vars.state.map.name())
                .put("worldWidth", Vars.world.width())
                .put("worldHeight", Vars.world.height())
                .put("wave", Vars.state.wave)
                .put("enemies", Vars.state.enemies)
                .put("team", team.id)
                .put("teamName", team.name)
                .put("paused", Vars.state.isPaused())
                .put("gameOver", Vars.state.gameOver)
                .put("eventsSince", eventSeq);

        Jval assistantJson = Jval.newObject();
        if (assistant != null) {
            assistantJson.put("id", assistant.id)
                    .put("type", assistant.type.name)
                    .put("team", assistant.team.id)
                    .put("x", assistant.x)
                    .put("y", assistant.y)
                    .put("health", assistant.health)
                    .put("maxHealth", assistant.maxHealth)
                    .put("dead", assistant.dead)
                    .put("isAI", assistant.isAI())
                    .put("isPlayer", assistant.isPlayer())
                    .put("spawnedByCore", assistant.spawnedByCore())
                    .put("isHome", !possessing && assistant == homeBody)
                    .put("possessing", possessing)
                    .put("homeBodyId", homeBody == null ? -1 : homeBody.id)
                    .put("item", assistant.item() == null ? "" : assistant.item().name)
                    .put("itemAmount", assistant.stack == null ? 0 : assistant.stack.amount);
        }
        data.put("assistant", assistantJson);

        Jval resources = Jval.newObject();
        ItemModule items = team.items();
        for (Item item : Vars.content.items()) {
            int amount = items.get(item);
            if (amount > 0) resources.put(item.name, amount);
        }
        data.put("resources", resources);

        Jval cores = Jval.newArray();
        for (CoreBuild core : team.cores()) {
            cores.add(Jval.newObject()
                    .put("id", core.id)
                    .put("block", core.block.name)
                    .put("x", core.x)
                    .put("y", core.y)
                    .put("health", core.health)
                    .put("maxHealth", core.block.health)
                    .put("unitType", ((CoreBlock) core.block).unitType.name));
        }
        data.put("cores", cores);

        Jval units = Jval.newArray();
        Seq<Unit> teamUnits = team.data().units;
        for (int i = 0; i < teamUnits.size && i < 20; i++) {
            Unit unit = teamUnits.get(i);
            units.add(Jval.newObject()
                    .put("id", unit.id)
                    .put("type", unit.type.name)
                    .put("team", unit.team.id)
                    .put("x", unit.x)
                    .put("y", unit.y)
                    .put("health", unit.health)
                    .put("maxHealth", unit.maxHealth)
                    .put("dead", unit.dead)
                    .put("item", unit.item() == null ? "" : unit.item().name)
                    .put("itemAmount", unit.stack == null ? 0 : unit.stack.amount)
                    .put("isAI", unit.isAI()));
        }
        data.put("units", units);
        data.put("unitCount", team.data().unitCount);

        return data;
    }

    private void drainWithError(String code, String message) {
        Command command;
        while ((command = queue.poll()) != null) {
            replyError(command, code, message);
        }
    }

    private void reply(Command command, Jval data) {
        command.send(Jval.newObject()
                .put("id", command.request.getInt("id", 0))
                .put("ok", true)
                .put("data", data));
    }

    private void replyError(Command command, String code, String message) {
        command.send(Jval.newObject()
                .put("id", command.request.getInt("id", 0))
                .put("ok", false)
                .put("error", Jval.newObject().put("code", code).put("message", message)));
    }

    private boolean mapSnapshotNeeded(long tick) {
        return mapRevision == 0 || tick - lastMapCaptureTick >= 600;
    }

    private void captureMapSnapshot(long tick) {
        int width = Vars.world.width();
        int height = Vars.world.height();
        if (width <= 0 || height <= 0) return;
        int cells = width * height;
        short[] blocks = new short[cells];
        short[] teams = new short[cells];
        short[] drops = new short[cells];
        short[] solids = new short[cells];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                Tile tile = Vars.world.tile(x, y);
                int index = y * width + x;
                if (tile == null) continue;
                blocks[index] = (short) tile.block().id;
                teams[index] = (short) tile.team().id;
                Item drop = tile.drop();
                drops[index] = (short) (drop == null ? 0 : drop.id);
                solids[index] = (short) (tile.block().solid ? 1 : 0);
            }
        }
        long revision = ++mapRevision;
        MapSnapshot snapshot = new MapSnapshot(revision, width, height, blocks, teams, drops, solids);
        synchronized (mapSnapshots) {
            mapSnapshots.put(revision, snapshot);
            while (mapSnapshots.size() > 8) {
                mapSnapshots.remove(mapSnapshots.keySet().iterator().next());
            }
        }
        lastMapCaptureTick = tick;
    }

    private MapSnapshot findMapSnapshot(long revision) {
        synchronized (mapSnapshots) {
            return mapSnapshots.get(revision);
        }
    }

    private void startDataServer() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", DATA_PORT), 0);
            server.createContext("/data", this::handleData);
            server.setExecutor(Executors.newCachedThreadPool());
            server.start();
            Log.info("[ai-probe] data plane started: " + dataBaseUrl);
        } catch (IOException error) {
            Log.err("[ai-probe] data plane failed", error);
        }
    }

    private void handleData(HttpExchange exchange) {
        try {
            String method = exchange.getRequestMethod();
            if (!"GET".equals(method) && !"HEAD".equals(method)) {
                sendText(exchange, 405, "method not allowed", "text/plain", true);
                return;
            }
            String auth = exchange.getRequestHeaders().getFirst("Authorization");
            if (!("Bearer " + dataToken).equals(auth)) {
                sendText(exchange, 401, "unauthorized", "text/plain", false);
                return;
            }
            String path = exchange.getRequestURI().getPath();
            if (!path.startsWith("/data/")) {
                sendText(exchange, 404, "not found", "text/plain", false);
                return;
            }
            String[] parts = path.substring("/data/".length()).split("/");
            if (parts.length < 2) {
                sendText(exchange, 404, "not found", "text/plain", false);
                return;
            }
            long revision;
            try {
                if ("current".equals(parts[1])) {
                    revision = "events".equals(parts[0]) ? eventSeq : mapRevision;
                } else {
                    revision = Long.parseLong(parts[1]);
                }
            } catch (NumberFormatException error) {
                sendText(exchange, 400, "bad revision", "text/plain", false);
                return;
            }
            if ("manifest".equals(parts[0])) {
                MapSnapshot snapshot = findMapSnapshot(revision);
                if (snapshot == null) {
                    sendText(exchange, 410, "ref_expired", "text/plain", false);
                    return;
                }
                sendBytes(exchange, 200, snapshot.manifest(dataBaseUrl).toString(Jval.Jformat.plain).getBytes(StandardCharsets.UTF_8), "application/json", "\"map-" + revision + "\"", method.equals("HEAD"));
                return;
            }
            if ("map".equals(parts[0])) {
                MapSnapshot snapshot = findMapSnapshot(revision);
                if (snapshot == null) {
                    sendText(exchange, 410, "ref_expired", "text/plain", false);
                    return;
                }
                byte[] body;
                String etag;
                if (parts.length == 2) {
                    body = snapshot.toBytes();
                    etag = "\"map-" + revision + "\"";
                } else if (parts.length == 5 && "chunk".equals(parts[2])) {
                    try {
                        int cx = Integer.parseInt(parts[3]);
                        int cy = Integer.parseInt(parts[4]);
                        body = snapshot.chunkBytes(cx, cy);
                        if (body == null) {
                            sendText(exchange, 404, "chunk out of range", "text/plain", false);
                            return;
                        }
                        etag = "\"map-" + revision + "-chunk-" + cx + "-" + cy + "\"";
                    } catch (NumberFormatException error) {
                        sendText(exchange, 400, "bad chunk coordinates", "text/plain", false);
                        return;
                    }
                } else {
                    sendText(exchange, 404, "not found", "text/plain", false);
                    return;
                }

                int start = 0;
                int end = body.length - 1;
                int status = 200;
                String rangeHeader = exchange.getRequestHeaders().getFirst("Range");
                if (rangeHeader != null) {
                    String trimmed = rangeHeader.trim();
                    if (!trimmed.startsWith("bytes=") || trimmed.contains(",")) {
                        exchange.getResponseHeaders().set("Content-Range", "bytes */" + body.length);
                        sendText(exchange, 416, "invalid range", "text/plain", false);
                        return;
                    }
                    String spec = trimmed.substring("bytes=".length());
                    int dash = spec.indexOf('-');
                    try {
                        if (dash < 0) throw new NumberFormatException();
                        if (dash == 0) {
                            int suffix = Integer.parseInt(spec.substring(1));
                            if (suffix <= 0) throw new NumberFormatException();
                            start = Math.max(0, body.length - suffix);
                        } else {
                            start = Integer.parseInt(spec.substring(0, dash));
                            if (dash + 1 < spec.length()) {
                                end = Integer.parseInt(spec.substring(dash + 1));
                            }
                        }
                        if (start < 0 || start >= body.length || end < start) throw new NumberFormatException();
                        end = Math.min(end, body.length - 1);
                        status = 206;
                        exchange.getResponseHeaders().set(
                                "Content-Range", "bytes " + start + "-" + end + "/" + body.length);
                    } catch (NumberFormatException error) {
                        exchange.getResponseHeaders().set("Content-Range", "bytes */" + body.length);
                        sendText(exchange, 416, "invalid range", "text/plain", false);
                        return;
                    }
                }
                byte[] payload = status == 206
                        ? java.util.Arrays.copyOfRange(body, start, end + 1)
                        : body;
                sendBytes(exchange, status, payload, "application/octet-stream", etag, method.equals("HEAD"));
                return;
            }
            if ("events".equals(parts[0])) {
                synchronized (eventLog) {
                    StringBuilder output = new StringBuilder();
                    for (Jval event : eventLog) {
                        if (event.getInt("id", 0) <= revision) {
                            output.append(event.toString(Jval.Jformat.plain)).append('\n');
                        }
                    }
                    sendBytes(exchange, 200, output.toString().getBytes(StandardCharsets.UTF_8), "application/x-ndjson", "\"events-" + revision + "\"", method.equals("HEAD"));
                }
                return;
            }
            sendText(exchange, 404, "not found", "text/plain", false);
        } catch (Throwable error) {
            try {
                sendText(exchange, 500, "internal error", "text/plain", false);
            } catch (Throwable ignored) {
            }
        } finally {
            exchange.close();
        }
    }

    private void sendText(HttpExchange exchange, int status, String text, String contentType, boolean head) {
        sendBytes(exchange, status, text.getBytes(StandardCharsets.UTF_8), contentType, null, head);
    }

    private void sendBytes(HttpExchange exchange, int status, byte[] bytes, String contentType, String etag, boolean head) {
        try {
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.getResponseHeaders().set("Cache-Control", "no-store");
            exchange.getResponseHeaders().set("Accept-Ranges", "bytes");
            if (etag != null) exchange.getResponseHeaders().set("ETag", etag);
            if (head) {
                exchange.sendResponseHeaders(status, -1);
                return;
            }
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(bytes);
            }
        } catch (IOException ignored) {
        }
    }

    private void startSocket() {
        Thread thread = new Thread(() -> {
            try (ServerSocket server = new ServerSocket(PORT, 50, InetAddress.getByName("127.0.0.1"))) {
                writeDiscovery();
                while (true) {
                    Socket socket = server.accept();
                    Thread client = new Thread(() -> clientLoop(socket), "ai-probe-client");
                    client.setDaemon(true);
                    client.start();
                }
            } catch (IOException error) {
                Log.err("[ai-probe] socket server failed", error);
            }
        }, "ai-probe-socket");
        thread.setDaemon(true);
        thread.start();
    }

    private void writeDiscovery() {
        try {
            Path directory = Path.of(System.getProperty("java.io.tmpdir"), "mindustry-ai-probe");
            Files.createDirectories(directory);
            Path file = directory.resolve("bridge-info.json");
            String json = Jval.newObject()
                    .put("port", PORT)
                    .put("token", token)
                    .put("protocol", PROTOCOL_VERSION)
                    .put("version", VERSION)
                    .put("requireAuth", requireAuth)
                    .put("dataPort", DATA_PORT)
                    .put("dataToken", dataToken)
                    .put("dataBaseUrl", dataBaseUrl)
                    .put("pid", ProcessHandle.current().pid())
                    .toString(Jval.Jformat.plain);
            Files.writeString(file, json, StandardCharsets.UTF_8);
            try {
                Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
            } catch (UnsupportedOperationException ignored) {
                // Windows/non-POSIX fallback: the file is still local-only.
            }
            Log.info("[ai-probe] discovery written: " + file);
        } catch (IOException error) {
            Log.err("[ai-probe] failed to write discovery file", error);
        }
    }

    private void clientLoop(Socket socket) {
        try (Socket s = socket;
             BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
             BufferedWriter out = new BufferedWriter(new OutputStreamWriter(s.getOutputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = in.readLine()) != null) {
                if (line.isBlank()) continue;
                try {
                    queue.add(new Command(Jval.read(line), out));
                } catch (Throwable error) {
                    synchronized (out) {
                        out.write(Jval.newObject()
                                .put("ok", false)
                                .put("error", Jval.newObject().put("code", "bad_json").put("message", error.toString()))
                                .toString(Jval.Jformat.plain));
                        out.newLine();
                        out.flush();
                    }
                }
            }
        } catch (IOException error) {
            Log.err("[ai-probe] client failed", error);
        }
    }

    private static final class Command {
        final Jval request;
        final BufferedWriter out;

        Command(Jval request, BufferedWriter out) {
            this.request = request;
            this.out = out;
        }

        void send(Jval response) {
            try {
                synchronized (out) {
                    out.write(response.toString(Jval.Jformat.plain));
                    out.newLine();
                    out.flush();
                }
            } catch (IOException error) {
                Log.err("[ai-probe] write failed", error);
            }
        }
    }

    private static final class MapSnapshot {
        final long revision;
        final int width;
        final int height;
        final short[] blocks;
        final short[] teams;
        final short[] drops;
        final short[] solids;

        MapSnapshot(long revision, int width, int height, short[] blocks, short[] teams, short[] drops, short[] solids) {
            this.revision = revision;
            this.width = width;
            this.height = height;
            this.blocks = blocks;
            this.teams = teams;
            this.drops = drops;
            this.solids = solids;
        }

        byte[] toBytes() {
            ByteBuffer buffer = ByteBuffer.allocate(16 + width * height * 8).order(ByteOrder.LITTLE_ENDIAN);
            buffer.put((byte) 'M').put((byte) 'N').put((byte) 'D').put((byte) '1');
            buffer.putInt(width);
            buffer.putInt(height);
            buffer.putInt(4);
            for (short value : blocks) buffer.putShort(value);
            for (short value : teams) buffer.putShort(value);
            for (short value : drops) buffer.putShort(value);
            for (short value : solids) buffer.putShort(value);
            return buffer.array();
        }

        byte[] chunkBytes(int cx, int cy) {
            int startX = cx * MAP_CHUNK_SIZE;
            int startY = cy * MAP_CHUNK_SIZE;
            if (startX < 0 || startY < 0 || startX >= width || startY >= height) return null;
            int chunkWidth = Math.min(MAP_CHUNK_SIZE, width - startX);
            int chunkHeight = Math.min(MAP_CHUNK_SIZE, height - startY);
            int cells = chunkWidth * chunkHeight;
            ByteBuffer buffer = ByteBuffer.allocate(24 + cells * 8).order(ByteOrder.LITTLE_ENDIAN);
            buffer.put((byte) 'M').put((byte) 'N').put((byte) 'C').put((byte) '1');
            buffer.putInt(cx);
            buffer.putInt(cy);
            buffer.putInt(chunkWidth);
            buffer.putInt(chunkHeight);
            buffer.putInt(4);
            for (int y = 0; y < chunkHeight; y++) {
                for (int x = 0; x < chunkWidth; x++) {
                    buffer.putShort(blocks[(startY + y) * width + startX + x]);
                }
            }
            for (int y = 0; y < chunkHeight; y++) {
                for (int x = 0; x < chunkWidth; x++) {
                    buffer.putShort(teams[(startY + y) * width + startX + x]);
                }
            }
            for (int y = 0; y < chunkHeight; y++) {
                for (int x = 0; x < chunkWidth; x++) {
                    buffer.putShort(drops[(startY + y) * width + startX + x]);
                }
            }
            for (int y = 0; y < chunkHeight; y++) {
                for (int x = 0; x < chunkWidth; x++) {
                    buffer.putShort(solids[(startY + y) * width + startX + x]);
                }
            }
            return buffer.array();
        }

        Jval manifest(String baseUrl) {
            return Jval.newObject()
                    .put("ref", "obs://map/rev/" + revision)
                    .put("revision", revision)
                    .put("kind", "map")
                    .put("format", "raw-v1")
                    .put("schema", Jval.newObject()
                            .put("width", width)
                            .put("height", height)
                            .put("layers", Jval.newArray().add("block_id").add("team").add("drop_id").add("solid"))
                            .put("dtype", "int16-le")
                            .put("coord", "tile")
                            .put("chunkSize", MAP_CHUNK_SIZE))
                    .put("bytes", 16 + width * height * 8)
                    .put("access", Jval.newObject()
                            .put("mode", "http-readonly")
                            .put("baseUrl", baseUrl)
                            .put("readOnly", true)
                            .put("expires", System.currentTimeMillis() + 3600000L));
        }
    }

    private static final class Op {
        String id;
        String kind;
        String status;
        float progress;
        float arriveRadius;
        float startDistance;
        double createdTick;
        Jval data;
        Unit targetUnit;
        Building targetBuilding;
        Vec2 targetPosition;
        Jval targetTiles;

        Jval toJson() {
            Jval json = Jval.newObject()
                    .put("opId", id)
                    .put("kind", kind)
                    .put("status", status)
                    .put("progress", progress);
            if (data != null) json.put("data", data);
            return json;
        }
    }

    private static final class IdleController implements UnitController {
        private Unit unit;

        @Override
        public void unit(Unit unit) {
            this.unit = unit;
        }

        @Override
        public Unit unit() {
            return unit;
        }

        @Override
        public void updateUnit() {
        }

        @Override
        public void removed(Unit unit) {
            this.unit = null;
        }
    }

    private static final class ProbeController implements UnitController {
        private Unit unit;
        volatile Vec2 target;
        volatile Unit followTarget;
        volatile float followDistance = 48f;
        volatile Teamc attackEntity;
        volatile Vec2 attackPosition;

        @Override
        public void unit(Unit unit) {
            this.unit = unit;
        }

        @Override
        public Unit unit() {
            return unit;
        }

        @Override
        public void updateUnit() {
            if (unit == null) return;

            if (followTarget != null) {
                if (followTarget.dead || followTarget.health <= 0) {
                    followTarget = null;
                } else {
                    float distance = (float) Math.hypot(followTarget.x - unit.x, followTarget.y - unit.y);
                    if (distance > followDistance) {
                        Vec2 desired = new Vec2(followTarget.x - unit.x, followTarget.y - unit.y).limit(unit.speed());
                        unit.moveAt(desired);
                    }
                    return;
                }
            }

            if (attackPosition != null) {
                if (attackEntity instanceof Unit targetUnit && (targetUnit.dead || targetUnit.health <= 0)) {
                    attackEntity = null;
                    attackPosition = null;
                } else if (attackEntity instanceof Building targetBuilding && targetBuilding.health <= 0) {
                    attackEntity = null;
                    attackPosition = null;
                } else {
                    float range = 0f;
                    for (var weapon : unit.type.weapons) {
                        range = Math.max(range, weapon.range());
                    }
                    float distance = (float) Math.hypot(attackPosition.x - unit.x, attackPosition.y - unit.y);
                    unit.aimX = attackPosition.x;
                    unit.aimY = attackPosition.y;
                    unit.isShooting = distance <= range;
                    if (distance > Math.max(8f, range * 0.8f)) {
                        Vec2 desired = new Vec2(attackPosition.x - unit.x, attackPosition.y - unit.y).limit(unit.speed());
                        unit.moveAt(desired);
                    }
                    return;
                }
            }

            if (target == null) return;
            float dx = target.x - unit.x;
            float dy = target.y - unit.y;
            if (Math.hypot(dx, dy) < 1f) {
                target = null;
                return;
            }
            Vec2 desired = new Vec2(target).sub(unit.x, unit.y).limit(unit.speed());
            unit.moveAt(desired);
        }

        @Override
        public void removed(Unit unit) {
            this.unit = null;
            this.target = null;
            this.attackEntity = null;
            this.attackPosition = null;
            this.followTarget = null;
        }
    }
}
