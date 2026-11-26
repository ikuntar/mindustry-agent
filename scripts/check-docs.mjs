#!/usr/bin/env node
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const guide = read("docs/GAME-GUIDE.md");
const contract = read("docs/API-DATA-CONTRACT.md");
const session = read("docs/SESSION-API.md");
const source = read("probe-mod/src/ai/probe/ProbeMod.java");

const checks = [];
function check(ok, message) {
  checks.push({ ok, message });
}

check(guide.includes("## 目录"), "GAME-GUIDE has a table of contents");
check(guide.includes("/docs/API-DATA-CONTRACT.md"), "GAME-GUIDE points to the field contract");
for (const endpoint of ["/context", "/tools", "/content", "/actions", "/data"]) {
  check(guide.includes(endpoint), `GAME-GUIDE mentions ${endpoint}`);
}
check(guide.includes("data.results") && guide.includes("opId"), "GAME-GUIDE describes build_plan initial results/opId");
check(contract.includes("counts") && contract.includes("truncated"), "API contract documents content counts/truncation");
check(contract.includes("manifest.schema.blocks"), "API contract documents block_id mapping");
check(contract.includes("configure") && contract.includes("{\"item\":\"copper\"}"), "API contract documents configure write shape");
check(contract.includes("enemy_core_build_radius") && contract.includes("spawnZone"), "API contract documents spawn protection fields");
check(session.includes("guideVersion") && session.includes("guideTopics"), "SESSION-API documents guide version/topics");
check(session.includes("ETag") && session.includes("HEAD"), "SESSION-API documents control-plane cache/HEAD behavior");
check(!/Accept-Ranges: bytes/.test(session) || session.includes("不再声明"), "SESSION-API does not falsely promise control-plane ranges");

const toolNames = [...source.matchAll(/tools\.add\(tool\("([^"]+)"/g)].map((m) => m[1]);
check(toolNames.length === 35, `ProbeMod exposes 35 tools (found ${toolNames.length})`);
for (const name of toolNames) {
  check(session.includes(name), `SESSION-API lists tool ${name}`);
}

for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.message}`);
}
if (checks.some((item) => !item.ok)) process.exit(1);
console.log(`DOC PASS (${checks.length} checks, ${toolNames.length} tools)`);
