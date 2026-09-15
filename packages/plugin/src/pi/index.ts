import type { CompactBarrier, SpineRuntimeClient } from "@spinejit/spine-sdk";

import {
  createHostAdapter,
  type HostContextEnvelope,
  type HostOwnershipClaim,
  type PublishedContext,
  type SpawnStagingStore,
  type SpineHostAdapter,
} from "../index.js";

export * from "./messages.js";
export * from "./lifecycle.js";
export * from "./protocol.js";
export * from "./recovery.js";
import {
  PI_ADAPTER_ID,
  PI_ARCHIVE_ENTRY_TYPE,
  PI_COMPACT_ENTRY_TYPE,
  PI_SPAWN_TERMINAL_ENTRY_TYPE,
  type PiSpineArchiveEntry,
  type PiSpineCompactEntry,
  type PiSpawnTerminalEntry,
} from "./protocol.js";

export interface PiSpinePort<TMessage> {
  claimOwnership(claim: HostOwnershipClaim): Promise<void>;
  appendCustomEntry(type: typeof PI_ARCHIVE_ENTRY_TYPE, entry: PiSpineArchiveEntry): Promise<void>;
  appendCustomEntry(
    type: typeof PI_SPAWN_TERMINAL_ENTRY_TYPE,
    entry: PiSpawnTerminalEntry,
  ): Promise<void>;
  appendCustomEntry(
    type: typeof PI_COMPACT_ENTRY_TYPE,
    entry: PiSpineCompactEntry,
  ): Promise<void>;
  materializeContext(context: PublishedContext): Promise<readonly TMessage[]>;
  replaceContext(context: HostContextEnvelope<TMessage>): Promise<void>;
}

export function createPiSpawnStagingStore<TMessage>(
  host: PiSpinePort<TMessage>,
): SpawnStagingStore {
  return {
      persistTerminal: (batchId, result) =>
      host.appendCustomEntry(PI_SPAWN_TERMINAL_ENTRY_TYPE, {
        schema: PI_ADAPTER_ID,
        batchId,
        result,
      }),
  };
}

export interface PiSpineAdapterOptions<TMessage> {
  enabled: boolean;
  runtime: SpineRuntimeClient;
  host: PiSpinePort<TMessage>;
}

export async function createPiSpineAdapter<TMessage>(
  options: PiSpineAdapterOptions<TMessage>,
): Promise<SpineHostAdapter | null> {
  if (!options.enabled) {
    return null;
  }

  return createHostAdapter({
    runtime: options.runtime,
    host: {
      claimOwnership: (claim) => options.host.claimOwnership(claim),
      persistArchive: (entry) =>
        options.host.appendCustomEntry(PI_ARCHIVE_ENTRY_TYPE, {
          schema: PI_ADAPTER_ID,
          durabilityId: entry.durabilityId,
          record: entry.record,
        }),
      persistCompact: (barrier, metadata) => {
        if (metadata === undefined || metadata.length === 0) {
          throw new Error("Pi compact persistence requires replacement metadata");
        }
        return options.host.appendCustomEntry(PI_COMPACT_ENTRY_TYPE, {
          schema: PI_ADAPTER_ID,
          barrier,
          replacementMessages: metadata,
        });
      },
      context: {
        materialize: (context) => options.host.materializeContext(context),
        publishAtomic: (context) => options.host.replaceContext(context),
      },
    },
  });
}
