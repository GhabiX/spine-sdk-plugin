import type {
  ReplayItem,
  SamplingArchiveRecord,
  SourceSnapshot,
  SpawnResult,
  SpineRuntimeClient,
} from "@spinejit/spine-sdk";

import type { SpineHostAdapter } from "../host-adapter.js";
import { recoverStagedSpawnResults, spawnResultListsEqual } from "../spawn.js";
import { PiSourceBindings, sourceObservation, type PiAgentMessage } from "./messages.js";
import {
  PI_ADAPTER_ID,
  PI_ARCHIVE_ENTRY_TYPE,
  PI_COMPACT_ENTRY_TYPE,
  PI_SPAWN_TERMINAL_ENTRY_TYPE,
  type PiSpineArchiveEntry,
  type PiSpineCompactEntry,
  type PiSpawnTerminalEntry,
} from "./protocol.js";

export interface PiBranchEntry {
  type: string;
  customType?: string;
  data?: unknown;
  fromHook?: boolean;
}

export interface PiReplaySource {
  boundary: number;
  message: PiAgentMessage;
}

export interface PiReplayPlan {
  runtimeThread: string;
  currentSessionId: string;
  inputs: ReplayItem[];
  sources: PiReplaySource[];
}

export interface BuildPiReplayPlanOptions {
  currentSessionId: string;
  branch: readonly PiBranchEntry[];
  messagesForEntry(entry: PiBranchEntry): readonly PiAgentMessage[];
}

export interface RecoverPiSessionOptions {
  plan: PiReplayPlan;
  runtimeFactory(thread: string): SpineRuntimeClient;
  adapterFactory(runtime: SpineRuntimeClient, bindings: PiSourceBindings): Promise<SpineHostAdapter>;
}

export interface RecoveredPiSession {
  adapter: SpineHostAdapter;
  bindings: PiSourceBindings;
  source: SourceSnapshot;
}

export class PiSessionRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiSessionRecoveryError";
  }
}

export function buildPiReplayPlan(options: BuildPiReplayPlanOptions): PiReplayPlan {
  const inputs: ReplayItem[] = [];
  let sources: PiReplaySource[] = [];
  let firstArchiveThread: string | null = null;
  let boundary = 0;
  const spawnStaging = new Map<string, SpawnResult[]>();
  let compactAwaitingPiEntry = false;

  for (const entry of options.branch) {
    if (entry.type === "compaction") {
      if (!compactAwaitingPiEntry) {
        throw new PiSessionRecoveryError(
          "Pi native compaction entry violates Spine compaction ownership",
        );
      }
      if (entry.fromHook !== true) {
        throw new PiSessionRecoveryError(
          "Pi native compaction acknowledgement is not owned by the Spine hook",
        );
      }
      compactAwaitingPiEntry = false;
      continue;
    }
    if (compactAwaitingPiEntry) {
      throw new PiSessionRecoveryError(
        "Pi Spine compact entry was not immediately acknowledged by native compaction",
      );
    }

    if (entry.type === "custom" && entry.customType === PI_ARCHIVE_ENTRY_TYPE) {
      const archive = decodeArchiveEntry(entry.data);
      firstArchiveThread ??= archive.record.record.attempt_id.thread;
      verifyCommittedSpawnStaging(archive.record, spawnStaging);
      inputs.push({ type: "archive", record: archive.record });
      continue;
    }
    if (entry.type === "custom" && entry.customType === PI_COMPACT_ENTRY_TYPE) {
      const compact = decodeCompactEntry(entry.data);
      firstArchiveThread ??= compact.barrier.thread;
      compactAwaitingPiEntry = true;
      inputs.push({ type: "compact", barrier: compact.barrier });
      if (
        compact.replacementMessages.length === 0 ||
        compact.replacementMessages.length !== compact.barrier.replacement_boundaries.length
      ) {
        throw new PiSessionRecoveryError(
          "Pi Spine compact replacement message count does not match barrier boundaries",
        );
      }
      sources = compact.replacementMessages.map((message, index) => ({
        boundary: compact.barrier.replacement_boundaries[index]!,
        message: message as PiAgentMessage,
      }));
      boundary = compact.barrier.replacement_boundaries.at(-1)! + 1;
      continue;
    }
    if (entry.type === "custom" && entry.customType === PI_SPAWN_TERMINAL_ENTRY_TYPE) {
      const staged = decodeSpawnTerminalEntry(entry.data);
      const results = spawnStaging.get(staged.batchId) ?? [];
      results.push(staged.result);
      spawnStaging.set(staged.batchId, results);
      continue;
    }

    for (const message of options.messagesForEntry(entry)) {
      const observation = sourceObservation(message, boundary);
      inputs.push({ type: "source", character: observation.character });
      sources.push({ boundary, message: observation.message });
      boundary += 1;
    }
  }

  if (spawnStaging.size !== 0) {
    throw new PiSessionRecoveryError(
      `Pi session has uncommitted Spine Spawn staging for ${[...spawnStaging.keys()].join(", ")}; ` +
        "the Pi extension API cannot restore a native tool result after restart",
    );
  }
  if (compactAwaitingPiEntry) {
    throw new PiSessionRecoveryError(
      "Pi Spine compact entry is missing its native compaction acknowledgement",
    );
  }

  return {
    runtimeThread: firstArchiveThread ?? options.currentSessionId,
    currentSessionId: options.currentSessionId,
    inputs,
    sources,
  };
}

export async function recoverPiSession(
  options: RecoverPiSessionOptions,
): Promise<RecoveredPiSession> {
  const bindings = new PiSourceBindings();
  const runtime = options.runtimeFactory(options.plan.runtimeThread);
  const adapter = await options.adapterFactory(runtime, bindings);
  let source: SourceSnapshot | null = null;

  await adapter.replayWithSources(options.plan.inputs, async (snapshot) => {
    installSourceBindings(bindings, snapshot, options.plan.sources);
    source = snapshot;
  });

  if (options.plan.runtimeThread !== options.plan.currentSessionId) {
    source = await adapter.continueNamespace(options.plan.currentSessionId);
    installSourceBindings(bindings, source, options.plan.sources);
    await adapter.previewAndPublish();
  }

  if (source === null) {
    throw new PiSessionRecoveryError("Spine replay returned no source snapshot");
  }
  return { adapter, bindings, source };
}

export function installSourceBindings(
  bindings: PiSourceBindings,
  source: SourceSnapshot,
  observations: readonly PiReplaySource[],
): void {
  if (source.cells.length !== observations.length) {
    throw new PiSessionRecoveryError(
      `Spine source snapshot has ${source.cells.length} cells for ${observations.length} Pi messages`,
    );
  }

  const byBoundary = new Map<number, PiAgentMessage>();
  for (const observation of observations) {
    if (byBoundary.has(observation.boundary)) {
      throw new PiSessionRecoveryError(
        `Pi replay has duplicate source boundary ${observation.boundary}`,
      );
    }
    byBoundary.set(observation.boundary, observation.message);
  }

  bindings.clear();
  for (const cell of source.cells) {
    const message = byBoundary.get(cell.boundary);
    if (message === undefined) {
      throw new PiSessionRecoveryError(
        `Spine source cell ${cell.source_id.ordinal} has unknown boundary ${cell.boundary}`,
      );
    }
    bindings.bind(cell.source_id, message);
  }
}

function decodeArchiveEntry(value: unknown): PiSpineArchiveEntry {
  if (!isRecord(value) || value.schema !== PI_ADAPTER_ID) {
    throw new PiSessionRecoveryError("Pi Spine archive has an invalid adapter schema");
  }
  if (typeof value.durabilityId !== "string" || value.durabilityId.length === 0) {
    throw new PiSessionRecoveryError("Pi Spine archive has no durability ID");
  }
  if (!isRecord(value.record) || !isRecord(value.record.record)) {
    throw new PiSessionRecoveryError("Pi Spine archive has no typed record");
  }
  if (
    value.record.type !== "sampling_started" &&
    value.record.type !== "sampling_commit"
  ) {
    throw new PiSessionRecoveryError("Pi Spine archive has an unknown record type");
  }
  const record = value.record.record;
  if (
    !isRecord(record.attempt_id) ||
    typeof record.attempt_id.thread !== "string" ||
    typeof record.record_digest !== "string" ||
    value.durabilityId !== record.record_digest
  ) {
    throw new PiSessionRecoveryError("Pi Spine archive identity is inconsistent");
  }
  return value as unknown as PiSpineArchiveEntry;
}

function decodeSpawnTerminalEntry(value: unknown): PiSpawnTerminalEntry {
  if (
    !isRecord(value) ||
    value.schema !== PI_ADAPTER_ID ||
    typeof value.batchId !== "string" ||
    value.batchId.length === 0 ||
    !isRecord(value.result)
  ) {
    throw new PiSessionRecoveryError("Pi Spine Spawn staging entry is malformed");
  }
  return value as unknown as PiSpawnTerminalEntry;
}

function decodeCompactEntry(value: unknown): PiSpineCompactEntry {
  if (
    !isRecord(value) ||
    value.schema !== PI_ADAPTER_ID ||
    !isRecord(value.barrier) ||
    !Array.isArray(value.replacementMessages)
  ) {
    throw new PiSessionRecoveryError("Pi Spine compact entry is malformed");
  }
  return value as unknown as PiSpineCompactEntry;
}

function verifyCommittedSpawnStaging(
  archive: SamplingArchiveRecord,
  staging: Map<string, SpawnResult[]>,
): void {
  if (archive.type !== "sampling_commit") return;
  for (const execution of archive.record.executions) {
    if (execution.operation.type !== "spawn" || execution.origin.type !== "direct") continue;
    const batchId = execution.origin.execution_ref;
    const staged = staging.get(batchId);
    if (staged === undefined) continue;
    let recovered: SpawnResult[];
    try {
      recovered = recoverStagedSpawnResults(execution.operation.tasks, staged);
    } catch (cause) {
      throw new PiSessionRecoveryError(
        `Pi Spine Spawn staging for ${batchId} does not form a complete ordered receipt: ${String(cause)}`,
      );
    }
    if (!spawnResultListsEqual(recovered, execution.operation.terminal_results)) {
      throw new PiSessionRecoveryError(
        `Pi Spine Spawn staging for ${batchId} disagrees with the canonical commit`,
      );
    }
    staging.delete(batchId);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
