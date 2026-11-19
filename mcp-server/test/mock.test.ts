import assert from "node:assert/strict";
import test from "node:test";

import { MockGameAdapter } from "../src/adapters/MockGameAdapter.js";

function advance(adapter: MockGameAdapter, ticks = 10): void {
  for (let i = 0; i < ticks; i++) adapter.advance(50);
}

test("mock: move_to reaches the target and completes", async () => {
  const adapter = new MockGameAdapter({ autoTick: false });
  const queued = await adapter.moveTo(25, 20);
  assert.equal(queued.status, "queued");
  advance(adapter, 10);
  const result = await adapter.getActionResult(queued.opId, 0);
  assert.equal(result.status, "done");
  const context = await adapter.getContext({ detail: "summary" });
  assert.ok(context.assistant.x >= 24);
  await adapter.close();
});

test("mock: build_plan pays resources and creates buildings", async () => {
  const adapter = new MockGameAdapter({ autoTick: false });
  const before = adapter.resources.copper;
  const queued = await adapter.buildPlan({
    placements: [
      { block: "conveyor", x: 20, y: 21 },
      { block: "router", x: 21, y: 21 },
    ],
  });
  assert.equal(queued.status, "running");
  assert.equal(adapter.resources.copper, before - 20);
  advance(adapter, 10);
  const result = await adapter.getActionResult(queued.opId, 0);
  assert.equal(result.status, "done");
  const page = await adapter.getEvents(0, 20);
  assert.ok(page.events.some((e) => e.type === "build_complete"));
  const context = await adapter.getContext({ detail: "summary" });
  assert.ok(context.counts.buildings >= 4);
  await adapter.close();
});

test("mock: build_plan rejects an invalid placement atomically", async () => {
  const adapter = new MockGameAdapter({ autoTick: false });
  await assert.rejects(
    () =>
      adapter.buildPlan({
        placements: [
          { block: "conveyor", x: 20, y: 21 },
          { block: "conveyor", x: 20, y: 21 },
        ],
      }),
    /Duplicate|occupied|validation/i,
  );
  await adapter.close();
});

test("mock: withdraw and deposit move items through the assistant", async () => {
  const adapter = new MockGameAdapter({ autoTick: false });
  const core = adapter.cores[0];
  const withdrawn = await adapter.withdraw({ buildingId: core.id }, "copper", 30);
  assert.equal(withdrawn.status, "done");
  assert.equal(core.items?.copper, 470);
  const context = await adapter.getContext({ detail: "summary" });
  assert.equal(context.assistant.item, "copper");
  assert.equal(context.assistant.itemAmount, 30);

  await adapter.deposit({ buildingId: core.id }, "copper", 10);
  assert.equal(core.items?.copper, 480);
  await adapter.close();
});

test("mock: configure validates configurable blocks", async () => {
  const adapter = new MockGameAdapter({ autoTick: false });
  const ok = await adapter.configure(16, 15, { item: "copper" });
  assert.equal(ok.status, "done");
  await assert.rejects(() => adapter.configure(15, 15, { item: "copper" }), /not configurable/i);
  await adapter.close();
});

test("mock: command_units only accepts same-team AI units", async () => {
  const adapter = new MockGameAdapter({ autoTick: false });
  const ok = await adapter.commandUnits({
    unitIds: [200],
    command: "attack",
    target: { unitId: 500 },
  });
  assert.equal(ok.status, "done");
  await assert.rejects(
    () => adapter.commandUnits({ unitIds: [500], command: "move", target: { x: 1, y: 1 } }),
    /not on your team|wrong_team/i,
  );
  await adapter.close();
});

test("mock: possess removes home body; release leaves borrowed body as AI", async () => {
  const adapter = new MockGameAdapter({ autoTick: false });
  const homeId = adapter.assistantId;
  await adapter.possess(200);
  assert.equal(adapter.units.has(homeId), false);
  let context = await adapter.getContext({ detail: "summary" });
  assert.equal(context.assistant.type, "dagger");
  assert.equal(context.assistant.isHome, false);
  assert.equal(context.assistant.possessing, true);

  await adapter.release();
  context = await adapter.getContext({ detail: "summary" });
  assert.equal(context.assistant.isHome, true);
  assert.equal(context.assistant.type, "alpha");
  assert.equal(adapter.units.get(200)?.isAi, true);
  await adapter.close();
});

test("mock: respawn can choose a different core and bypasses population", async () => {
  const adapter = new MockGameAdapter({ autoTick: false });
  adapter.killAssistant();
  const result = await adapter.respawn(1001);
  assert.equal(result.status, "done");
  const context = await adapter.getContext({ detail: "summary" });
  assert.equal(context.assistant.dead, false);
  assert.equal(context.assistant.x, 30);
  assert.equal(context.assistant.y, 30);
  await adapter.close();
});

test("mock: errors carry stable codes", async () => {
  const adapter = new MockGameAdapter({ autoTick: false });
  await assert.rejects(() => adapter.moveTo(999, 999), (error: unknown) => {
    return error instanceof Error && "code" in error && (error as { code: string }).code === "out_of_bounds";
  });
  await assert.rejects(() => adapter.possess(500), (error: unknown) => {
    return error instanceof Error && "code" in error && (error as { code: string }).code === "wrong_team";
  });
  await adapter.close();
});
