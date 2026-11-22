import type { ActionError, ErrorCategory } from "./types.js";

const TRANSIENT = new Set([
  "probe_unavailable",
  "probe_closed",
  "timeout",
  "busy",
  "op_capacity",
  "rate_limited",
  "temporarily_unavailable",
]);

const INPUT = new Set([
  "bad_request",
  "not_found",
  "building_not_found",
  "invalid_placement",
  "out_of_bounds",
  "bad_target",
  "unreachable",
  "target_not_found",
  "out_of_range",
  "configure_rejected",
]);

const RULE = new Set([
  "wrong_team",
  "possession_disabled",
  "writes_disabled",
  "not_possessable",
  "writer_required",
  "writer_held",
]);

const WORLD = new Set(["no_assistant", "no_core", "cannot_build", "stuck"]);

export function classifyError(code: string): { category: ErrorCategory; retryable: boolean } {
  if (TRANSIENT.has(code)) return { category: "transport", retryable: true };
  if (INPUT.has(code)) return { category: "input", retryable: false };
  if (RULE.has(code)) return { category: "rule", retryable: false };
  if (code === "insufficient_resources") return { category: "resource", retryable: false };
  if (code === "game_paused") return { category: "world", retryable: true };
  if (code === "block_locked") return { category: "rule", retryable: false };
  if (code === "build_dropped") return { category: "world", retryable: false };
  if (code === "deconstruct_dropped") return { category: "world", retryable: false };
  if (code === "assistant_gone" || code === "target_gone") return { category: "world", retryable: false };
  if (WORLD.has(code)) return { category: "world", retryable: code === "stuck" };
  return { category: "internal", retryable: false };
}

export function structuredError(code: string, message: string): ActionError {
  return { code, message, ...classifyError(code) };
}
