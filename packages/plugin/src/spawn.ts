import type { SpawnResult, SpawnTask } from "@spinejit/spine-sdk";

export interface SpawnChildContext {
  batchId: string;
  ordinal: number;
  signal: AbortSignal;
}

export interface SpawnChildTerminal {
  outcome: SpawnResult["outcome"];
  memoryBody: string;
  diagnostic?: string | null;
  executionRef?: string | null;
}

export interface SpawnExecutor {
  execute(task: SpawnTask, context: SpawnChildContext): Promise<SpawnChildTerminal>;
}

export interface SpawnStagingStore {
  persistTerminal(batchId: string, result: SpawnResult): Promise<void>;
}

export interface ExecuteSpawnBatchOptions {
  batchId: string;
  tasks: readonly SpawnTask[];
  executor: SpawnExecutor;
  staging: SpawnStagingStore;
  signal?: AbortSignal;
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

/**
 * Runs child work concurrently but returns only a complete task-ordered receipt.
 * The executor owns child-agent policy and must return explicit terminal memory;
 * this layer never synthesizes semantic memory from an exception or transcript.
 */
export async function executeSpawnBatch(
  options: ExecuteSpawnBatchOptions,
): Promise<SpawnResult[]> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted === true) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const executions = options.tasks.map(async (task, ordinal) => {
      try {
        const terminal = await options.executor.execute(task, {
          batchId: options.batchId,
          ordinal,
          signal: controller.signal,
        });
        const result = toSpawnResult(ordinal, terminal);
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
    return settled.map((result) => (result as PromiseFulfilledResult<SpawnResult>).value);
  } finally {
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/** Rebuilds a complete receipt from durable per-ordinal staging, or fails closed. */
export function recoverStagedSpawnResults(
  tasks: readonly SpawnTask[],
  staged: readonly SpawnResult[],
): SpawnResult[] {
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
  return tasks.map((_task, ordinal) => byOrdinal.get(ordinal)!);
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
  if (result.execution_ref !== undefined && result.execution_ref !== null && result.execution_ref.trim().length === 0) {
    throw new Error("spawn child execution reference must not be empty");
  }
}
