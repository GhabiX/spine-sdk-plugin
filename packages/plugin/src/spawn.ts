import type { SpawnResult, SpawnTask } from "@spinejit/spine-sdk";
import { decodeSpineSpawnTasks } from "./tools.js";

// Terminal receipt guards run before durable per-child staging. Input admission
// is owned by the core validator through decodeSpineSpawnTasks.
const SPINE_MAX_MEMORY_BYTES = 32 * 1024;
const SPINE_MAX_SUMMARY_BYTES = 4 * 1024;
const SPINE_MAX_SPAWN_BATCH_BYTES = 64 * 1024;

export interface SpawnChildContext {
  batchId: string;
  ordinal: number;
  signal: AbortSignal;
  attempt: number;
  mode: "initial" | "continue" | "retry";
  guidance?: string;
}

export interface SpawnChildTerminal {
  outcome: SpawnResult["outcome"];
  memoryBody: string;
  diagnostic?: string | null;
  executionRef?: string | null;
  /** Host-local recovery capability; never enters the canonical receipt. */
  recovery?: {
    continueable: boolean;
    reason?: string | null;
  };
}

export interface SpawnExecutor {
  execute(task: SpawnTask, context: SpawnChildContext): Promise<SpawnChildTerminal>;
}

export interface SpawnStagingStore {
  persistTerminal(batchId: string, result: SpawnResult): Promise<void>;
}

export type SpawnRecoveryAction = "continue" | "retry" | "abandon";

export interface SpawnRecoveryFailure extends SpawnResult {
  /** Whether reusing this child session is currently evidenced as safe. */
  continueable: boolean;
  continueReason?: string;
}

export interface SpawnRecoveryDecision {
  action: SpawnRecoveryAction;
  guidance?: string;
}

export interface SpawnRecoveryPolicy {
  choose(
    failures: readonly SpawnRecoveryFailure[],
    signal: AbortSignal,
  ): Promise<SpawnRecoveryDecision | undefined>;
}

export interface ExecuteSpawnBatchOptions {
  batchId: string;
  tasks: readonly SpawnTask[];
  executor: SpawnExecutor;
  staging: SpawnStagingStore;
  signal?: AbortSignal;
  recovery?: SpawnRecoveryPolicy;
}

export class SpawnBatchExecutionError extends Error {
  readonly batchId: string;
  readonly ordinal: number;

  constructor(batchId: string, ordinal: number, cause: unknown) {
    super(`Spine spawn batch ${batchId} failed at ordinal ${ordinal}`, { cause });
    this.name = "SpawnBatchExecutionError";
    this.batchId = batchId;
    this.ordinal = ordinal;
  }
}

export class SpawnRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpawnRecoveryError";
  }
}

export class SpawnRecoveryCancelledError extends Error {
  readonly batchId: string;

  constructor(batchId: string) {
    super(`Spine spawn recovery was cancelled for batch ${batchId}`);
    this.name = "SpawnRecoveryCancelledError";
    this.batchId = batchId;
  }
}

/**
 * Runs child work concurrently but returns only a complete task-ordered receipt.
 * The executor owns child-agent policy and must return explicit terminal memory;
 * this layer never synthesizes semantic memory from an exception or transcript.
 */
export async function executeSpawnBatch(
  options: ExecuteSpawnBatchOptions,
): Promise<SpawnResult[]> {
  decodeSpineSpawnTasks({ tasks: options.tasks });
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted === true) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    if (options.recovery !== undefined) {
      return await executeRecoverableSpawnBatch(options, controller);
    }
    let resultAggregateBytes = 0;
    const executions = options.tasks.map(async (task, ordinal) => {
      try {
        const terminal = await options.executor.execute(task, {
          batchId: options.batchId,
          ordinal,
          signal: controller.signal,
          attempt: 0,
          mode: "initial",
        });
        const result = toSpawnResult(ordinal, terminal);
        resultAggregateBytes += spawnResultByteSize(result);
        if (resultAggregateBytes > SPINE_MAX_SPAWN_BATCH_BYTES) {
          throw new Error(`spawn result payload exceeds ${SPINE_MAX_SPAWN_BATCH_BYTES} bytes`);
        }
        await options.staging.persistTerminal(options.batchId, result);
        return result;
      } catch (cause) {
        controller.abort(cause);
        throw new SpawnBatchExecutionError(options.batchId, ordinal, cause);
      }
    });
    const settled = await Promise.allSettled(executions);
    const failed = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed !== undefined) {
      throw failed.reason;
    }
    const results = settled.map((result) => (result as PromiseFulfilledResult<SpawnResult>).value);
    validateSpawnResults(options.tasks, results);
    return results;
  } finally {
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function executeRecoverableSpawnBatch(
  options: ExecuteSpawnBatchOptions,
  controller: AbortController,
): Promise<SpawnResult[]> {
  const results = new Map<number, SpawnResult>();
  const recovery = new Map<number, SpawnChildTerminal["recovery"]>();
  const attempts = new Map<number, number>();
  let pending = options.tasks.map((_task, ordinal) => ordinal);
  let guidance: string | undefined;
  let mode: SpawnChildContext["mode"] = "initial";

  while (true) {
    if (controller.signal.aborted) {
      throw new SpawnRecoveryCancelledError(options.batchId);
    }
    const settled = await Promise.allSettled(
      pending.map(async (ordinal) => {
        const task = options.tasks[ordinal]!;
        const attempt = attempts.get(ordinal) ?? 0;
        try {
          const terminal = await options.executor.execute(task, {
            batchId: options.batchId,
            ordinal,
            signal: controller.signal,
            attempt,
            mode,
            ...(guidance === undefined ? {} : { guidance }),
          });
          const result = toSpawnResult(ordinal, terminal);
          recovery.set(ordinal, terminal.recovery);
          return result;
        } catch (cause) {
          controller.abort(cause);
          throw new SpawnBatchExecutionError(options.batchId, ordinal, cause);
        }
      }),
    );
    const failed = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed !== undefined) throw failed.reason;
    for (const result of settled as PromiseFulfilledResult<SpawnResult>[]) {
      results.set(result.value.ordinal, result.value);
    }

    const ordered = options.tasks.map((_task, ordinal) => results.get(ordinal)!);
    validateSpawnResults(options.tasks, ordered);
    const failures: SpawnRecoveryFailure[] = ordered
      .filter((result) => result.outcome !== "completed")
      .map((result) => {
        const capability = recovery.get(result.ordinal);
        return {
          ...result,
          continueable: capability?.continueable ?? true,
          ...(capability?.reason === undefined || capability.reason === null
            ? {}
            : { continueReason: capability.reason }),
        };
      });
    if (options.signal?.aborted === true) {
      throw new SpawnRecoveryCancelledError(options.batchId);
    }
    if (failures.length === 0) {
      await persistSpawnResults(options, ordered);
      return ordered;
    }

    const decision = await options.recovery!.choose(failures, controller.signal);
    if (decision === undefined) throw new SpawnRecoveryCancelledError(options.batchId);
    if (options.signal !== undefined && options.signal.aborted) {
      throw new SpawnRecoveryCancelledError(options.batchId);
    }
    if (decision.action === "continue" && failures.some((failure) => !failure.continueable)) {
      throw new SpawnRecoveryError(
        `spawn Continue is unavailable for ordinal(s): ${failures
          .filter((failure) => !failure.continueable)
          .map((failure) => failure.ordinal)
          .join(", ")}`,
      );
    }
    if (decision.action === "abandon") {
      await persistSpawnResults(options, ordered);
      return ordered;
    }

    pending = failures.map((result) => result.ordinal);
    guidance = decision.guidance?.trim() || undefined;
    mode = decision.action === "continue" ? "continue" : "retry";
    if (decision.action === "retry") {
      for (const ordinal of pending) {
        attempts.set(ordinal, (attempts.get(ordinal) ?? 0) + 1);
      }
    }
  }
}

async function persistSpawnResults(
  options: ExecuteSpawnBatchOptions,
  results: readonly SpawnResult[],
): Promise<void> {
  for (const result of results) {
    await options.staging.persistTerminal(options.batchId, result);
  }
}

/** Rebuilds a complete receipt from durable per-ordinal staging, or fails closed. */
export function recoverStagedSpawnResults(
  tasks: readonly SpawnTask[],
  staged: readonly SpawnResult[],
): SpawnResult[] {
  decodeSpineSpawnTasks({ tasks });
  const byOrdinal = new Map<number, SpawnResult>();
  for (const result of staged) {
    if (!Number.isSafeInteger(result.ordinal) || result.ordinal < 0 || result.ordinal >= tasks.length) {
      throw new SpawnRecoveryError(`spawn staging has out-of-range ordinal ${result.ordinal}`);
    }
    if (byOrdinal.has(result.ordinal)) {
      throw new SpawnRecoveryError(`spawn staging has duplicate ordinal ${result.ordinal}`);
    }
    validateSpawnResult(result);
    byOrdinal.set(result.ordinal, result);
  }

  if (byOrdinal.size !== tasks.length) {
    throw new SpawnRecoveryError(
      `spawn staging is incomplete: found ${byOrdinal.size} of ${tasks.length} terminal results`,
    );
  }
  const results = tasks.map((_task, ordinal) => byOrdinal.get(ordinal)!);
  validateSpawnResults(tasks, results);
  return results;
}

/** Validates the complete task and receipt shape before controller staging. */
export function validateSpawnResults(
  tasks: readonly SpawnTask[],
  results: readonly SpawnResult[],
): void {
  decodeSpineSpawnTasks({ tasks });
  if (results.length !== tasks.length) {
    throw new Error(
      `spawn result count ${results.length} does not match task count ${tasks.length}`,
    );
  }
  let aggregateBytes = 0;
  for (const [expected, result] of results.entries()) {
    if (result.ordinal !== expected) {
      throw new Error(
        `spawn result ordinal ${result.ordinal} does not match expected ${expected}`,
      );
    }
    validateSpawnResult(result);
    aggregateBytes += spawnResultByteSize(result);
  }
  if (aggregateBytes > SPINE_MAX_SPAWN_BATCH_BYTES) {
    throw new Error(
      `spawn result payload exceeds ${SPINE_MAX_SPAWN_BATCH_BYTES} bytes`,
    );
  }
}

function spawnResultByteSize(result: SpawnResult): number {
  return (
    utf8ByteLength(result.memory_body) +
    (result.diagnostic === undefined || result.diagnostic === null
      ? 0
      : utf8ByteLength(result.diagnostic)) +
    (result.execution_ref === undefined || result.execution_ref === null
      ? 0
      : utf8ByteLength(result.execution_ref))
  );
}

/**
 * Semantic equality for spawn receipts.
 * WASM serializes `Option::None` as JSON `null`; JS staging may omit the field.
 * Recovery must not treat those encodings as drift.
 */
export function spawnResultsEqual(left: SpawnResult, right: SpawnResult): boolean {
  return (
    left.ordinal === right.ordinal &&
    left.outcome === right.outcome &&
    left.memory_body === right.memory_body &&
    optionalSpawnTextEqual(left.diagnostic, right.diagnostic) &&
    optionalSpawnTextEqual(left.execution_ref, right.execution_ref)
  );
}

export function spawnResultListsEqual(
  left: readonly SpawnResult[],
  right: readonly SpawnResult[],
): boolean {
  return left.length === right.length && left.every((result, index) => spawnResultsEqual(result, right[index]!));
}

function optionalSpawnTextEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

function toSpawnResult(ordinal: number, terminal: SpawnChildTerminal): SpawnResult {
  const result: SpawnResult = {
    ordinal,
    outcome: terminal.outcome,
    memory_body: terminal.memoryBody,
    diagnostic: terminal.diagnostic ?? null,
    execution_ref: terminal.executionRef ?? null,
  };
  validateSpawnResult(result);
  return result;
}

function validateSpawnResult(result: SpawnResult): void {
  if (result.memory_body.trim().length === 0) {
    throw new Error("spawn child terminal memory must not be empty");
  }
  if (utf8ByteLength(result.memory_body) > SPINE_MAX_MEMORY_BYTES) {
    throw new Error(`spawn child terminal memory exceeds ${SPINE_MAX_MEMORY_BYTES} bytes`);
  }
  if (
    result.outcome !== "completed" &&
    (result.diagnostic === undefined ||
      result.diagnostic === null ||
      result.diagnostic.trim().length === 0)
  ) {
    throw new Error("non-completed spawn child terminal requires a diagnostic");
  }
  if (result.diagnostic !== undefined && result.diagnostic !== null && result.diagnostic.trim().length === 0) {
    throw new Error("spawn child terminal diagnostic must not be empty");
  }
  if (
    result.diagnostic !== undefined &&
    result.diagnostic !== null &&
    utf8ByteLength(result.diagnostic) > SPINE_MAX_SUMMARY_BYTES
  ) {
    throw new Error(`spawn child terminal diagnostic exceeds ${SPINE_MAX_SUMMARY_BYTES} bytes`);
  }
  if (result.execution_ref !== undefined && result.execution_ref !== null && result.execution_ref.trim().length === 0) {
    throw new Error("spawn child execution reference must not be empty");
  }
  if (
    result.execution_ref !== undefined &&
    result.execution_ref !== null &&
    utf8ByteLength(result.execution_ref) > SPINE_MAX_SUMMARY_BYTES
  ) {
    throw new Error(`spawn child execution reference exceeds ${SPINE_MAX_SUMMARY_BYTES} bytes`);
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
