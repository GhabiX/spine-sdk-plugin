import type { SpawnTask, SpineOperation } from "@spinejit/spine-sdk";

export const SPINE_TOOL_NAMES = [
  "spine_open",
  "spine_close",
  "spine_next",
  "spine_spawn",
] as const;

export type SpineToolName = (typeof SPINE_TOOL_NAMES)[number];

export class SpineToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpineToolInputError";
  }
}

export function isSpineToolName(name: string): name is SpineToolName {
  return (SPINE_TOOL_NAMES as readonly string[]).includes(name);
}

export function operationFromSpineToolCall(
  toolName: Exclude<SpineToolName, "spine_spawn">,
  input: Record<string, unknown>,
): SpineOperation {
  switch (toolName) {
    case "spine_open":
      return { type: "open", summary: requiredString(input, "goal") };
    case "spine_close":
      return { type: "close", memory: requiredString(input, "memory") };
    case "spine_next":
      return {
        type: "next",
        closed_memory: requiredString(input, "memory"),
        next_summary: requiredString(input, "goal"),
      };
    default:
      return assertNever(toolName);
  }
}

export function decodeSpineSpawnTasks(input: Record<string, unknown>): SpawnTask[] {
  if (!Array.isArray(input.tasks)) {
    throw new SpineToolInputError("spine_spawn requires a tasks array");
  }
  return input.tasks.map((task, ordinal) => {
    if (task === null || typeof task !== "object" || Array.isArray(task)) {
      throw new SpineToolInputError(`spine_spawn task ${ordinal} is not an object`);
    }
    const record = task as Record<string, unknown>;
    return {
      summary: requiredString(record, "summary"),
      prompt: requiredString(record, "prompt"),
    };
  });
}

function requiredString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SpineToolInputError(`Spine tool field ${field} must be a non-empty string`);
  }
  return value;
}

function assertNever(value: never): never {
  throw new SpineToolInputError(`unsupported Spine tool ${String(value)}`);
}
