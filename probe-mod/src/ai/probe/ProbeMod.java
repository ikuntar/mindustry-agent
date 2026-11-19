package ai.probe;

import arc.Events;
import arc.math.geom.Vec2;
import arc.struct.Seq;
import arc.util.Log;
import arc.util.Time;
import arc.util.serialization.Jval;
import mindustry.Vars;
import mindustry.entities.units.UnitController;
import mindustry.game.EventType;
import mindustry.game.Team;
import mindustry.gen.Building;
import mindustry.gen.Unit;
import mindustry.mod.Mod;
import mindustry.type.Item;
import mindustry.type.UnitType;
import mindustry.world.Block;
import mindustry.world.Build;
import mindustry.world.blocks.storage.CoreBlock;
import mindustry.world.blocks.storage.CoreBlock.CoreBuild;
import mindustry.world.modules.ItemModule;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;

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

    private final ConcurrentLinkedQueue<Command> queue = new ConcurrentLinkedQueue<>();
    private final Map<String, Op> ops = new HashMap<>();
    private Unit assistant;
    private ProbeController controller;
    private long opSeq = 0;

    @Override
    public void init() {
        Events.run(EventType.Trigger.update, this::update);
        Events.on(EventType.WorldLoadEvent.class, event -> reset());
        startSocket();
        Log.info("[ai-probe] listening on 127.0.0.1:" + PORT);
    }

    private void reset() {
        assistant = null;
        controller = null;
        ops.clear();
        Log.info("[ai-probe] world loaded, waiting for requests");
    }

    private void update() {
        if (!Vars.state.isGame()) {
            drainWithError("no_world", "No game is loaded");
            return;
        }

        ensureAssistant();

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
    }

    private void ensureAssistant() {
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
                    .put("team", tile.team().id);
            if (tile.build != null) {
                data.put("health", tile.build.health);
                data.put("maxHealth", tile.build.block.health);
                data.put("rotation", tile.build.rotation);
            }
            reply(command, data);
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

            Build.beginPlace(assistant, block, team, x, y, rotation, null);
            Op result = newOp("build");
            result.status = "done";
            result.progress = 1f;
            result.data = Jval.newObject()
                    .put("block", blockName)
                    .put("x", x)
                    .put("y", y)
                    .put("tileBlock", Vars.world.tile(x, y).block().name);
            reply(command, result.toJson());
            return;
        }

        replyError(command, "bad_request", "Unknown op " + op);
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
                .put("gameOver", Vars.state.gameOver);

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
                    .put("spawnedByCore", assistant.spawnedByCore());
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
                    .put("x", unit.x)
                    .put("y", unit.y)
                    .put("health", unit.health)
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

    private void startSocket() {
        Thread thread = new Thread(() -> {
            try (ServerSocket server = new ServerSocket(PORT, 50, InetAddress.getByName("127.0.0.1"))) {
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

    private static final class Op {
        String id;
        String kind;
        String status;
        float progress;
        float arriveRadius;
        float startDistance;
        double createdTick;
        Jval data;

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

    private static final class ProbeController implements UnitController {
        private Unit unit;
        volatile Vec2 target;

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
            if (unit == null || target == null) return;
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
        }
    }
}
