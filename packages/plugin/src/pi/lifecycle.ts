import { createHash } from "node:crypto";

import type {
  CompactBarrier,
  SourceSnapshot,
  SpawnResult,
  SpawnTask,
  SpineOperation,
  Terminal,
} from "@spinejit/spine-sdk";

import type { SpineHostAdapter } from "../host-adapter.js";
import type { FinishSamplingResult } from "../controller.js";
import { PiSourceBindings, sourceObservation, type PiAgentMessage } from "./messages.js";
import {
  decodeSpineSpawnTasks,
  isSpineToolName,
  operationFromSpineToolCall,
  SPINE_TOOL_NAMES,
  type SpineToolName,
} from "../tools.js";

export const PI_SPINE_TOOL_NAMES = SPINE_TOOL_NAMES;

export type PiSpineToolName = SpineToolName;

export interface PiTurnEnd {
  message: PiAgentMessage;
  aborted: boolean;
}

export class PiSamplingLifecycleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PiSamplingLifecycleError";
  }
}

/** Owns the exact one-Pi-provider-turn to one-Spine-sampling transaction mapping. */
export class PiSamplingLifecycle {
  readonly #adapter: SpineHostAdapter;
  readonly #bindings: PiSourceBindings;
  readonly #executions = new Set<string>();
  #nextBoundary: number;
  #samplingActive = false;
  #fault: unknown = null;

  constructor(
    adapter: SpineHostAdapter,
    bindings: PiSourceBindings,
    source: SourceSnapshot,
  ) {
    this.#adapter = adapter;
    this.#bindings = bindings;
    this.#nextBoundary = nextSourceBoundary(source);
  }

  get fault(): unknown {
    return this.#fault ?? this.#adapter.fault;
  }

  async observeMessage(message: PiAgentMessage): Promise<void> {
    await this.#guard(async () => {
      const observation = sourceObservation(message, this.#nextBoundary);
      const sourceIds = await this.#adapter.observeSources([observation.character]);
      const sourceId = sourceIds[0];
      if (sourceIds.length !== 1 || sourceId === undefined) {
        throw new PiSamplingLifecycleError(
          `Spine admitted ${sourceIds.length} source IDs for one Pi message`,
        );
      }
      this.#bindings.bind(sourceId, observation.message);
      this.#nextBoundary += 1;
    });
  }

  async previewContext(): Promise<void> {
    await this.#guard(() => this.#adapter.previewAndPublish().then(() => undefined));
  }

  async sourceSnapshot(): Promise<SourceSnapshot> {
    return this.#guard(() => this.#adapter.sourceSnapshot());
  }

  async compact(barrier: CompactBarrier, replacementMessages: readonly PiAgentMessage[]): Promise<void> {
    await this.#guard(async () => {
      if (this.#samplingActive) {
        throw new PiSamplingLifecycleError("Pi compaction started before the sampling turn ended");
      }
      if (replacementMessages.length !== barrier.replacement_boundaries.length) {
        throw new PiSamplingLifecycleError(
          "Pi compact replacement messages do not match replacement boundaries",
        );
      }
      await this.#adapter.compact(barrier, {
        publish: false,
        metadata: replacementMessages,
      });
      const source = await this.#adapter.sourceSnapshot();
      if (source.cells.length !== replacementMessages.length) {
        throw new PiSamplingLifecycleError(
          `Spine compact returned ${source.cells.length} source cells for ${replacementMessages.length} replacements`,
        );
      }
      this.#bindings.clear();
      for (const cell of source.cells) {
        const index = barrier.replacement_boundaries.indexOf(cell.boundary);
        if (index < 0) {
          throw new PiSamplingLifecycleError(
            `Spine compact returned an unexpected replacement boundary ${cell.boundary}`,
          );
        }
        this.#bindings.bind(cell.source_id, replacementMessages[index]!);
      }
      this.#nextBoundary = nextSourceBoundary(source);
      await this.#adapter.previewAndPublish();
    });
  }

  async beginSampling(providerPayload: unknown): Promise<void> {
    await this.#guard(async () => {
      if (this.#samplingActive) {
        throw new PiSamplingLifecycleError("Pi started a provider request before the prior turn ended");
      }
      await this.#adapter.beginSampling(providerPayloadDigest(providerPayload));
      this.#samplingActive = true;
      this.#executions.clear();
    });
  }

  async registerToolCall(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<boolean> {
    if (!isSpineToolName(toolName)) {
      return false;
    }
    await this.#guard(async () => {
      this.#assertSamplingActive();
      if (this.#executions.has(toolCallId)) {
        throw new PiSamplingLifecycleError(`duplicate Pi Spine tool call ${toolCallId}`);
      }
      await this.#adapter.registerExecution(toolCallId);
      this.#executions.add(toolCallId);
      if (toolName !== "spine_spawn") {
        await this.#adapter.stageExecution(
          toolCallId,
          toolCallId,
          operationFromSpineToolCall(toolName, input),
        );
      }
    });
    return true;
  }

  async stageSpawn(
    toolCallId: string,
    tasks: SpawnTask[],
    terminalResults: SpawnResult[],
  ): Promise<void> {
    await this.#guard(async () => {
      this.#assertTrackedExecution(toolCallId);
      await this.#adapter.stageExecution(toolCallId, toolCallId, {
        type: "spawn",
        tasks,
        terminal_results: terminalResults,
      });
    });
  }

  async finishToolCall(toolCallId: string, succeeded: boolean): Promise<boolean> {
    if (!this.#executions.has(toolCallId)) {
      return false;
    }
    await this.#guard(async () => {
      await this.#adapter.finishExecution(toolCallId, succeeded);
      this.#executions.delete(toolCallId);
    });
    return true;
  }

  async finishTurn(turn: PiTurnEnd): Promise<FinishSamplingResult> {
    return this.#guard(async () => {
      this.#assertSamplingActive();
      if (this.#executions.size !== 0) {
        throw new PiSamplingLifecycleError(
          `Pi turn ended with unfinished Spine executions: ${[...this.#executions].join(", ")}`,
        );
      }
      const result = await this.#adapter.finishSampling(
        samplingTerminal(turn),
        assistantInputTokens(turn.message),
      );
      this.#samplingActive = false;
      return result;
    });
  }

  async #guard<T>(operation: () => Promise<T>): Promise<T> {
    if (this.fault !== null) {
      throw new PiSamplingLifecycleError("Pi Spine lifecycle is faulted", {
        cause: this.fault,
      });
    }
    try {
      return await operation();
    } catch (cause) {
      this.#fault ??= cause;
      throw new PiSamplingLifecycleError("Pi Spine lifecycle fault", { cause });
    }
  }

  #assertSamplingActive(): void {
    if (!this.#samplingActive) {
      throw new PiSamplingLifecycleError("Pi Spine operation occurred outside sampling");
    }
  }

  #assertTrackedExecution(toolCallId: string): void {
    this.#assertSamplingActive();
    if (!this.#executions.has(toolCallId)) {
      throw new PiSamplingLifecycleError(`unknown Pi Spine tool call ${toolCallId}`);
    }
  }
}

export function providerPayloadDigest(payload: unknown): string {
  const encoded = JSON.stringify(payload);
  if (encoded === undefined) {
    throw new PiSamplingLifecycleError("Pi provider payload is not JSON serializable");
  }
  return createHash("sha256").update(encoded).digest("hex");
}

export function buildCompactBarrier(
  source: SourceSnapshot,
  replacementCount: number,
): CompactBarrier {
  if (!Number.isSafeInteger(replacementCount) || replacementCount <= 0) {
    throw new PiSamplingLifecycleError("Pi compact requires at least one replacement message");
  }
  const boundary = nextSourceBoundary(source);
  if (!Number.isSafeInteger(boundary)) {
    throw new PiSamplingLifecycleError("Pi compact source boundary is exhausted");
  }
  const nextEpoch = source.epoch + 1;
  if (!Number.isSafeInteger(nextEpoch)) {
    throw new PiSamplingLifecycleError("Pi compact context epoch is exhausted");
  }
  const replacementBoundaries = Array.from(
    { length: replacementCount },
    (_, index) => boundary + index + 1,
  );
  if (!Number.isSafeInteger(replacementBoundaries.at(-1))) {
    throw new PiSamplingLifecycleError("Pi compact replacement boundary is exhausted");
  }
  const unsigned = {
    schema: "spine.compact.barrier.v1" as const,
    thread: source.thread,
    previous_epoch: source.epoch,
    next_epoch: nextEpoch,
    boundary,
    replacement_boundaries: replacementBoundaries,
    replacement_digest: "0".repeat(64),
  };
  const replacement_digest = createHash("sha256")
    .update(JSON.stringify(unsigned))
    .digest("hex");
  return { ...unsigned, replacement_digest };
}

export function operationFromPiToolCall(
  toolName: Exclude<PiSpineToolName, "spine_spawn">,
  input: Record<string, unknown>,
): SpineOperation {
  try {
    return operationFromSpineToolCall(toolName, input);
  } catch (cause) {
    throw new PiSamplingLifecycleError("invalid Pi Spine tool input", { cause });
  }
}

export function decodeSpawnTasks(input: Record<string, unknown>): SpawnTask[] {
  try {
    return decodeSpineSpawnTasks(input);
  } catch (cause) {
    throw new PiSamplingLifecycleError("invalid Pi Spine Spawn input", { cause });
  }
}

function samplingTerminal(turn: PiTurnEnd): Terminal {
  if (turn.aborted) {
    return "cancelled";
  }
  if (turn.message.role !== "assistant") {
    throw new PiSamplingLifecycleError("Pi turn_end did not carry an assistant message");
  }
  switch (turn.message.stopReason) {
    case "aborted":
      return "cancelled";
    case "error":
      return "failed";
    case "stop":
    case "toolUse":
    case "length":
      return "completed";
    case "deferred":
      throw new PiSamplingLifecycleError(
        "Pi deferred assistant responses are unsupported by the Spine sampling contract",
      );
    default:
      throw new PiSamplingLifecycleError(
        `Pi assistant response has unsupported stop reason ${String(turn.message.stopReason)}`,
      );
  }
}

function assistantInputTokens(message: PiAgentMessage): number | undefined {
  if (message.role !== "assistant") {
    throw new PiSamplingLifecycleError("Pi turn_end did not carry an assistant message");
  }
  const usage = message.usage;
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
    return undefined;
  }
  const usageRecord = usage as Record<string, unknown>;
  const components = [usageRecord.input, usageRecord.cacheRead, usageRecord.cacheWrite];
  if (
    !components.every(
      (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    )
  ) {
    return undefined;
  }
  let total = 0;
  for (const value of components) {
    total += value as number;
  }
  return Number.isSafeInteger(total) ? total : undefined;
}

function nextSourceBoundary(source: SourceSnapshot): number {
  let next = 0;
  for (const cell of source.cells) {
    next = Math.max(next, cell.boundary + 1);
  }
  return next;
}
