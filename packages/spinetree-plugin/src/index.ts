import type { PluginManifest, PluginTool, SpinePlugin, SpinePluginContext } from "@spinejit/spine-host";

export const SPINETREE_READ_RESULT_SCHEMA = "spinetree.read.result/v1" as const;
export const SPINETREE_CHANGE_RESULT_SCHEMA = "spinetree.change.result/v1" as const;
export const SPINETREE_SEND_RESULT_SCHEMA = "spinetree.send.result/v1" as const;

export interface SpineTreeBranch {
  readonly id: string;
  readonly parent: string | null;
  readonly goal: string;
  readonly constraints: readonly unknown[];
  readonly skills: readonly unknown[];
  readonly tools: readonly unknown[];
  readonly memory: unknown;
  readonly memoryVersion: number;
  readonly memorySource: unknown;
  readonly status: string;
  readonly [key: string]: unknown;
}

export interface SpineTreeAgent {
  readonly id: string;
  readonly working: string;
  readonly live: readonly string[];
  readonly status: string;
  readonly [key: string]: unknown;
}

export interface SpineTreeSnapshot {
  readonly branches: Readonly<Record<string, SpineTreeBranch>>;
  readonly agents: Readonly<Record<string, SpineTreeAgent>>;
}

type DraftSpineTreeBranch = { -readonly [Key in keyof SpineTreeBranch]: SpineTreeBranch[Key] };

export interface SpineTreeSnapshotStore {
  head(): string | Promise<string>;
  readSnapshot(head: string): SpineTreeSnapshot | Promise<SpineTreeSnapshot>;
}

export type SpineTreeChange =
  | { readonly type: "update"; readonly branch: string; readonly attributes: Readonly<Record<string, unknown>> }
  | { readonly type: "move"; readonly branch: string; readonly parent: string }
  | { readonly type: "archive"; readonly branch: string };

export interface SpineTreeChangeResult {
  readonly schema: typeof SPINETREE_CHANGE_RESULT_SCHEMA;
  readonly parent: string;
  readonly head: string;
  readonly changes: readonly SpineTreeChange[];
}

export interface SpineTreeChangeStore extends SpineTreeSnapshotStore {
  change(expectedHead: string, changes: readonly SpineTreeChange[]): SpineTreeChangeResult | Promise<SpineTreeChangeResult>;
}

export interface SpineTreeAgentBinding {
  readonly agentId: string;
  readonly sessionId: string;
  readonly branch: string;
  readonly scope?: string;
  readonly status: "running" | "paused" | "ended";
}

export interface SpineTreeAgentRegistry {
  register(binding: SpineTreeAgentBinding): void;
  resolve(agentId: string): SpineTreeAgentBinding | undefined;
}

export class MemoryAgentRegistry implements SpineTreeAgentRegistry {
  readonly #bindings = new Map<string, SpineTreeAgentBinding>();

  register(binding: SpineTreeAgentBinding): void {
    validateBinding(binding);
    if (this.#bindings.has(binding.agentId)) {
      throw new SpineTreeRegistryError("duplicate-agent", `Agent ${binding.agentId} is already registered`);
    }
    this.#bindings.set(binding.agentId, clone(binding));
  }

  resolve(agentId: string): SpineTreeAgentBinding | undefined {
    const binding = this.#bindings.get(agentId);
    return binding === undefined ? undefined : clone(binding);
  }
}

export class SpineTreeRegistryError extends Error {
  readonly code: "invalid-binding" | "duplicate-agent";

  constructor(code: SpineTreeRegistryError["code"], message: string) {
    super(message);
    this.name = "SpineTreeRegistryError";
    this.code = code;
  }
}

export type SpineTreeReceiptStatus = "queued" | "leased" | "delivered" | "observed" | "failed";

export interface SpineTreeReceipt {
  readonly id: string;
  readonly to: string;
  readonly from: string | null;
  readonly message: string;
  readonly requestId?: string;
  readonly status: SpineTreeReceiptStatus;
  readonly attempt: number;
  readonly leaseId: string | null;
  readonly leaseUntil: number | null;
  readonly nextAttemptAt: number | null;
  readonly lastError: string | null;
}

export interface SpineTreeMailboxInput {
  readonly to: string;
  readonly from: string | null;
  readonly message: string;
  readonly requestId?: string;
}

export interface SpineTreeMailbox {
  enqueue(input: SpineTreeMailboxInput): SpineTreeReceipt;
  lease(receiptId: string): SpineTreeReceipt;
  delivered(receiptId: string, leaseId: string): SpineTreeReceipt;
  release(receiptId: string, leaseId: string, error: string): SpineTreeReceipt;
  fail(receiptId: string, leaseId: string, error: string): SpineTreeReceipt;
  observed(receiptId: string): SpineTreeReceipt;
}

export class SpineTreeMailboxError extends Error {
  readonly code: "unknown-receipt" | "invalid-state" | "lease-conflict";

  constructor(code: SpineTreeMailboxError["code"], message: string) {
    super(message);
    this.name = "SpineTreeMailboxError";
    this.code = code;
  }
}

/** A deterministic in-memory mailbox. It preserves receipt IDs across retries. */
export class MemorySpineTreeMailbox implements SpineTreeMailbox {
  #sequence = 0;
  #leaseSequence = 0;
  readonly #receipts = new Map<string, SpineTreeReceipt>();
  readonly #requestIds = new Map<string, string>();

  enqueue(input: SpineTreeMailboxInput): SpineTreeReceipt {
    if (input.requestId !== undefined) {
      const existingId = this.#requestIds.get(input.requestId);
      if (existingId !== undefined) {
        const existing = this.#receipt(existingId);
        if (existing.to !== input.to || existing.from !== input.from || existing.message !== input.message) {
          throw new SpineTreeMailboxError("invalid-state", `Request ${input.requestId} is already bound to another message`);
        }
        return clone(existing);
      }
    }
    const receipt: SpineTreeReceipt = {
      id: `mail-${++this.#sequence}`,
      to: input.to,
      from: input.from,
      message: input.message,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      status: "queued",
      attempt: 0,
      leaseId: null,
      leaseUntil: null,
      nextAttemptAt: null,
      lastError: null,
    };
    this.#receipts.set(receipt.id, receipt);
    if (input.requestId !== undefined) this.#requestIds.set(input.requestId, receipt.id);
    return clone(receipt);
  }

  lease(receiptId: string): SpineTreeReceipt {
    const receipt = this.receipt(receiptId);
    if (receipt.status === "delivered" || receipt.status === "observed" || receipt.status === "failed") {
      throw new SpineTreeMailboxError("invalid-state", `Receipt ${receiptId} cannot be leased from ${receipt.status}`);
    }
    if (receipt.status === "leased") throw new SpineTreeMailboxError("lease-conflict", `Receipt ${receiptId} is already leased`);
    const next = {
      ...receipt,
      status: "leased" as const,
      attempt: receipt.attempt + 1,
      leaseId: `lease-${++this.#leaseSequence}`,
      leaseUntil: Date.now() + 30_000,
      nextAttemptAt: null,
    };
    this.#receipts.set(receiptId, next);
    return clone(next);
  }

  delivered(receiptId: string, leaseId: string): SpineTreeReceipt {
    const receipt = this.#requireLease(receiptId, leaseId);
    const next = { ...receipt, status: "delivered" as const, leaseId: null, leaseUntil: null, nextAttemptAt: null };
    this.#receipts.set(receiptId, next);
    return clone(next);
  }

  release(receiptId: string, leaseId: string, error: string): SpineTreeReceipt {
    this.#requireLease(receiptId, leaseId);
    const receipt = this.receipt(receiptId);
    const next = {
      ...receipt,
      status: "queued" as const,
      leaseId: null,
      leaseUntil: null,
      nextAttemptAt: Date.now(),
      lastError: error,
    };
    this.#receipts.set(receiptId, next);
    return clone(next);
  }

  fail(receiptId: string, leaseId: string, error: string): SpineTreeReceipt {
    this.#requireLease(receiptId, leaseId);
    const receipt = this.receipt(receiptId);
    const next = {
      ...receipt,
      status: "failed" as const,
      leaseId: null,
      leaseUntil: null,
      nextAttemptAt: null,
      lastError: error,
    };
    this.#receipts.set(receiptId, next);
    return clone(next);
  }

  observed(receiptId: string): SpineTreeReceipt {
    const receipt = this.#receipt(receiptId);
    if (receipt.status === "observed") return clone(receipt);
    if (receipt.status !== "delivered") {
      throw new SpineTreeMailboxError("invalid-state", `Receipt ${receiptId} cannot be observed from ${receipt.status}`);
    }
    const next = { ...receipt, status: "observed" as const };
    this.#receipts.set(receiptId, next);
    return clone(next);
  }

  #receipt(receiptId: string): SpineTreeReceipt {
    const receipt = this.#receipts.get(receiptId);
    if (receipt === undefined) throw new SpineTreeMailboxError("unknown-receipt", `Unknown receipt ${receiptId}`);
    return receipt;
  }

  receipt(receiptId: string): SpineTreeReceipt {
    return clone(this.#receipt(receiptId));
  }

  #requireLease(receiptId: string, leaseId: string): SpineTreeReceipt {
    const receipt = this.#receipt(receiptId);
    if (receipt.status !== "leased" || receipt.leaseId !== leaseId) {
      throw new SpineTreeMailboxError("lease-conflict", `Lease ${leaseId} does not own receipt ${receiptId}`);
    }
    return receipt;
  }
}

export class SpineTreeChangeError extends Error {
  readonly code: "invalid-input" | "invalid-change" | "unknown-branch" | "unknown-head" | "stale-head";

  constructor(
    code: SpineTreeChangeError["code"],
    message: string,
  ) {
    super(message);
    this.name = "SpineTreeChangeError";
    this.code = code;
  }
}

/** A deterministic in-memory store for exercising immutable snapshots and CAS semantics. */
export class MemorySpineTreeStore implements SpineTreeChangeStore {
  #head: string;
  #revision = 0;
  readonly #snapshots = new Map<string, SpineTreeSnapshot>();

  constructor(snapshot: SpineTreeSnapshot, initialHead = "memory-0") {
    if (initialHead.length === 0) throw new TypeError("initialHead must be non-empty");
    this.#head = initialHead;
    this.#snapshots.set(initialHead, clone(snapshot));
  }

  head(): string {
    return this.#head;
  }

  readSnapshot(head: string): SpineTreeSnapshot {
    const snapshot = this.#snapshots.get(head);
    if (snapshot === undefined) {
      throw new SpineTreeChangeError("unknown-head", `Unknown SpineTree HEAD ${head}`);
    }
    return clone(snapshot);
  }

  change(expectedHead: string, changes: readonly SpineTreeChange[]): SpineTreeChangeResult {
    if (expectedHead !== this.#head) {
      throw new SpineTreeChangeError(
        "stale-head",
        `SpineTree HEAD changed: expected ${expectedHead}, found ${this.#head}`,
      );
    }
    const current = this.#snapshots.get(this.#head);
    if (current === undefined) throw new SpineTreeChangeError("unknown-head", `Unknown SpineTree HEAD ${this.#head}`);
    const draft = clone(current);
    applyChanges(draft, changes);
    const parent = this.#head;
    const head = `memory-${++this.#revision}`;
    this.#snapshots.set(head, clone(draft));
    this.#head = head;
    return {
      schema: SPINETREE_CHANGE_RESULT_SCHEMA,
      parent,
      head,
      changes: clone(changes),
    };
  }
}

/** An explicit adapter for a `.spinetree` root. It is intentionally read-only. */
export type SpineTreeRootAdapter = SpineTreeSnapshotStore;

export interface SpineTreePluginOptions {
  readonly store?: SpineTreeSnapshotStore;
  readonly root?: SpineTreeRootAdapter;
  readonly registry?: SpineTreeAgentRegistry;
  readonly mailbox?: SpineTreeMailbox;
}

export interface SpineTreeSendInput {
  readonly to: string;
  readonly message: string;
  readonly from?: string;
  readonly requestId?: string;
}

export interface SpineTreeSendResult {
  readonly schema: typeof SPINETREE_SEND_RESULT_SCHEMA;
  readonly receipt: SpineTreeReceipt;
  readonly status: "delivered" | "queued" | "failed";
  readonly to: string;
  readonly sessionId: string;
}

export class SpineTreeSendError extends Error {
  readonly code: "invalid-input" | "unknown-recipient" | "recipient-ended" | "mailbox-error";

  constructor(code: SpineTreeSendError["code"], message: string) {
    super(message);
    this.name = "SpineTreeSendError";
    this.code = code;
  }
}

export interface SpineTreeReadInput {
  readonly branch: string;
}

export interface SpineTreeInheritedValue {
  readonly value: unknown;
  readonly source: string;
}

export interface SpineTreeInheritance {
  readonly path: readonly string[];
  readonly constraints: readonly SpineTreeInheritedValue[];
  readonly skills: readonly SpineTreeInheritedValue[];
  readonly tools: readonly SpineTreeInheritedValue[];
  readonly memories: readonly {
    branch: string;
    memory: unknown;
    memoryVersion: number;
  }[];
}

export interface SpineTreeBinding {
  readonly agent: string;
  readonly working: string;
  readonly live: readonly string[];
}

export interface SpineTreeReadResult {
  readonly schema: typeof SPINETREE_READ_RESULT_SCHEMA;
  readonly head: string;
  readonly branch: SpineTreeBranch;
  readonly inherit: SpineTreeInheritance;
  readonly children: readonly string[];
  readonly binding: SpineTreeBinding | null;
}

export class SpineTreeReadError extends Error {
  readonly code: "invalid-input" | "store-unavailable" | "unknown-branch";

  constructor(code: SpineTreeReadError["code"], message: string) {
    super(message);
    this.name = "SpineTreeReadError";
    this.code = code;
  }
}

export const SPINETREE_PLUGIN_MANIFEST: PluginManifest = {
  schema: "spine-host/v1",
  id: "@spinetree/plugin",
  version: "0.1.0",
  requires: ["@spinejit/spine-plugin"],
  owns: ["spinetree.project-state"],
  toolNamespace: "spinetree",
  commandNamespace: "spinetree",
  storageNamespace: "spinetree",
};

export function createSpineTreePlugin(options: SpineTreePluginOptions = {}): SpinePlugin {
  if (options.store !== undefined && options.root !== undefined) {
    throw new TypeError("SpineTree plugin accepts either store or root, not both");
  }
  const store = options.store ?? options.root;
  const changeStore = options.store !== undefined && isChangeStore(options.store) ? options.store : undefined;
  const sendReady = options.registry !== undefined && options.mailbox !== undefined;
  return {
    manifest: SPINETREE_PLUGIN_MANIFEST,
    activate(context) {
      for (const operation of ["read", "change", "send", "rejuvenate"] as const) {
        context.tools.register(
          operation,
          operation === "read" && store !== undefined
            ? readTool(store)
            : operation === "change" && changeStore !== undefined
              ? changeTool(changeStore)
            : operation === "send" && sendReady
              ? sendTool(options.registry!, options.mailbox!, context)
            : contractTool(context, operation),
        );
      }
      context.commands.register("status", {
        description: "Inspect the SpineTree plugin contract status",
        execute: async () => ({ status: "contract-only" }),
      });
    },
  };
}

function sendTool(
  registry: SpineTreeAgentRegistry,
  mailbox: SpineTreeMailbox,
  context: SpinePluginContext,
): PluginTool {
  return {
    description: "Queue and deliver a message to a registered Agent through its Pi session",
    execute: async (input: unknown) => {
      const parsed = parseSendInput(input);
      const target = registry.resolve(parsed.to);
      if (target === undefined) {
        throw new SpineTreeSendError("unknown-recipient", `Unknown Agent ${parsed.to}`);
      }
      if (target.status === "ended") {
        throw new SpineTreeSendError("recipient-ended", `Agent ${parsed.to} has ended`);
      }
      if (parsed.from !== undefined) {
        const source = registry.resolve(parsed.from);
        if (source === undefined) throw new SpineTreeSendError("unknown-recipient", `Unknown Agent ${parsed.from}`);
        if (source.status === "ended") throw new SpineTreeSendError("recipient-ended", `Agent ${parsed.from} has ended`);
      }
      let receipt: SpineTreeReceipt;
      try {
        receipt = mailbox.enqueue({
          to: parsed.to,
          from: parsed.from ?? null,
          message: parsed.message,
          ...(parsed.requestId === undefined ? {} : { requestId: parsed.requestId }),
        });
        if (receipt.status === "delivered" || receipt.status === "observed" || receipt.status === "failed") {
          return sendResult(receipt, target.sessionId);
        }
        const leased = mailbox.lease(receipt.id);
        try {
          const response = await context.sessions.request({
            targetSessionId: target.sessionId,
            operation: "prompt",
            text: parsed.message,
            requestId: receipt.id,
          });
          if (response.accepted) {
            receipt = mailbox.delivered(leased.id, leased.leaseId!);
          } else {
            receipt = mailbox.release(leased.id, leased.leaseId!, "session request was not accepted");
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          receipt = isPermanentError(error)
            ? mailbox.fail(leased.id, leased.leaseId!, message)
            : mailbox.release(leased.id, leased.leaseId!, message);
        }
        return sendResult(receipt, target.sessionId);
      } catch (error) {
        if (error instanceof SpineTreeSendError) throw error;
        if (error instanceof SpineTreeMailboxError) {
          throw new SpineTreeSendError("mailbox-error", error.message);
        }
        throw error;
      }
    },
  };
}

function sendResult(receipt: SpineTreeReceipt, sessionId: string): SpineTreeSendResult {
  return {
    schema: SPINETREE_SEND_RESULT_SCHEMA,
    receipt: clone(receipt),
    status: receipt.status === "failed" ? "failed" : receipt.status === "delivered" || receipt.status === "observed" ? "delivered" : "queued",
    to: receipt.to,
    sessionId,
  };
}

function parseSendInput(input: unknown): SpineTreeSendInput {
  if (input === null || typeof input !== "object") {
    throw new SpineTreeSendError("invalid-input", "spinetree_send requires an object input");
  }
  const value = input as { to?: unknown; message?: unknown; from?: unknown; requestId?: unknown };
  if (typeof value.to !== "string" || value.to.length === 0 || typeof value.message !== "string" || value.message.length === 0) {
    throw new SpineTreeSendError("invalid-input", "spinetree_send requires non-empty to and message strings");
  }
  if (value.from !== undefined && (typeof value.from !== "string" || value.from.length === 0)) {
    throw new SpineTreeSendError("invalid-input", "spinetree_send from must be a non-empty string");
  }
  if (value.requestId !== undefined && (typeof value.requestId !== "string" || value.requestId.length === 0)) {
    throw new SpineTreeSendError("invalid-input", "spinetree_send requestId must be a non-empty string");
  }
  return {
    to: value.to,
    message: value.message,
    ...(value.from === undefined ? {} : { from: value.from }),
    ...(value.requestId === undefined ? {} : { requestId: value.requestId }),
  };
}

function isPermanentError(error: unknown): boolean {
  return error !== null && typeof error === "object" && (error as { permanent?: unknown }).permanent === true;
}

function validateBinding(binding: SpineTreeAgentBinding): void {
  if (
    binding === null ||
    typeof binding !== "object" ||
    typeof binding.agentId !== "string" || binding.agentId.length === 0 ||
    typeof binding.sessionId !== "string" || binding.sessionId.length === 0 ||
    typeof binding.branch !== "string" || binding.branch.length === 0 ||
    !["running", "paused", "ended"].includes(binding.status)
  ) {
    throw new SpineTreeRegistryError("invalid-binding", "Agent binding requires non-empty agentId, sessionId, branch and valid status");
  }
  if (binding.scope !== undefined && (typeof binding.scope !== "string" || binding.scope.length === 0)) {
    throw new SpineTreeRegistryError("invalid-binding", "Agent binding scope must be a non-empty string");
  }
}

function contractTool(context: SpinePluginContext, operation: string): PluginTool {
  return {
    description: `SpineTree ${operation} contract placeholder`,
    execute: async () => ({
      schema: "spinetree.operation.result/v1",
      operation,
      status: "contract-only",
      storageNamespace: context.manifest.storageNamespace ?? null,
    }),
  };
}

function readTool(store: SpineTreeSnapshotStore): PluginTool {
  return {
    description: "Read one ProjectBranch from a fixed SpineTree HEAD snapshot",
    execute: async (input: unknown) => readSnapshot(store, input),
  };
}

function changeTool(store: SpineTreeChangeStore): PluginTool {
  return {
    description: "Atomically change ProjectBranch topology and attributes with a fixed HEAD CAS token",
    execute: async (input: unknown) => {
      const parsed = parseChangeInput(input);
      return store.change(parsed.expectedHead, parsed.changes);
    },
  };
}

function parseChangeInput(input: unknown): { expectedHead: string; changes: readonly SpineTreeChange[] } {
  if (input === null || typeof input !== "object") {
    throw new SpineTreeChangeError("invalid-input", "spinetree_change requires an object input");
  }
  const value = input as { expectedHead?: unknown; changes?: unknown };
  if (typeof value.expectedHead !== "string" || value.expectedHead.length === 0) {
    throw new SpineTreeChangeError("invalid-input", "spinetree_change requires a non-empty expectedHead string");
  }
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    throw new SpineTreeChangeError("invalid-input", "spinetree_change requires a non-empty changes array");
  }
  return { expectedHead: value.expectedHead, changes: value.changes as readonly SpineTreeChange[] };
}

function isChangeStore(store: SpineTreeSnapshotStore): store is SpineTreeChangeStore {
  return typeof (store as Partial<SpineTreeChangeStore>).change === "function";
}

const CHANGEABLE_ATTRIBUTES = new Set(["goal", "constraints", "skills", "tools"]);

function applyChanges(snapshot: SpineTreeSnapshot, changes: readonly SpineTreeChange[]): void {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new SpineTreeChangeError("invalid-input", "spinetree_change requires a non-empty changes array");
  }
  for (const change of changes) {
    if (change === null || typeof change !== "object" || typeof change.branch !== "string" || change.branch.length === 0) {
      throw new SpineTreeChangeError("invalid-change", "Every change requires a non-empty branch string");
    }
    const branch = snapshot.branches[change.branch] as DraftSpineTreeBranch | undefined;
    if (branch === undefined) {
      throw new SpineTreeChangeError("unknown-branch", `Unknown ProjectBranch ${change.branch}`);
    }
    if (change.type === "update") {
      applyUpdate(branch, change.attributes);
    } else if (change.type === "move") {
      applyMove(snapshot, branch, change.parent);
    } else if (change.type === "archive") {
      if (hasLiveWork(snapshot, branch.id)) {
        throw new SpineTreeChangeError("invalid-change", `Cannot archive live work ${branch.id}`);
      }
      branch.status = "archived";
    } else {
      throw new SpineTreeChangeError("invalid-change", `Unknown change type ${(change as { type?: unknown }).type ?? ""}`);
    }
  }
}

function applyUpdate(branch: DraftSpineTreeBranch, attributes: Readonly<Record<string, unknown>>): void {
  if (attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) {
    throw new SpineTreeChangeError("invalid-change", "update attributes must be an object");
  }
  for (const key of Object.keys(attributes)) {
    if (!CHANGEABLE_ATTRIBUTES.has(key)) {
      throw new SpineTreeChangeError("invalid-change", `Cannot update ${key}`);
    }
    if (key === "goal" && (typeof attributes[key] !== "string" || attributes[key].length === 0)) {
      throw new SpineTreeChangeError("invalid-change", "goal must be a non-empty string");
    }
    if (key !== "goal" && !Array.isArray(attributes[key])) {
      throw new SpineTreeChangeError("invalid-change", `${key} must be an array`);
    }
  }
  Object.assign(branch, clone(attributes));
}

function applyMove(snapshot: SpineTreeSnapshot, branch: DraftSpineTreeBranch, parent: unknown): void {
  if (typeof parent !== "string" || parent.length === 0) {
    throw new SpineTreeChangeError("invalid-change", "move requires a non-empty parent string");
  }
  if (branch.id === "root") throw new SpineTreeChangeError("invalid-change", "Cannot move root");
  if (branch.status === "live") throw new SpineTreeChangeError("invalid-change", `Cannot move live branch ${branch.id}`);
  if (snapshot.branches[parent] === undefined) {
    throw new SpineTreeChangeError("unknown-branch", `Unknown ProjectBranch ${parent}`);
  }
  if (parent === branch.id || isDescendant(snapshot, parent, branch.id)) {
    throw new SpineTreeChangeError("invalid-change", "Move would create a cycle");
  }
  branch.parent = parent;
}

function isDescendant(snapshot: SpineTreeSnapshot, candidate: string, ancestor: string): boolean {
  let current: string | null = candidate;
  while (current !== null) {
    if (current === ancestor) return true;
    current = snapshot.branches[current]?.parent ?? null;
  }
  return false;
}

function hasLiveWork(snapshot: SpineTreeSnapshot, branchId: string): boolean {
  return Object.values(snapshot.branches).some(candidate =>
    candidate.status === "live" && (candidate.id === branchId || isDescendant(snapshot, candidate.id, branchId)),
  );
}

async function readSnapshot(
  store: SpineTreeSnapshotStore,
  input: unknown,
): Promise<SpineTreeReadResult> {
  const branchId = parseBranchId(input);
  const head = await store.head();
  const snapshot = await store.readSnapshot(head);
  const branch = snapshot.branches[branchId];
  if (branch === undefined) {
    throw new SpineTreeReadError("unknown-branch", `Unknown ProjectBranch ${branchId}`);
  }
  return {
    schema: SPINETREE_READ_RESULT_SCHEMA,
    head,
    branch: clone(branch),
    inherit: inheritance(snapshot, branch),
    children: Object.values(snapshot.branches)
      .filter(candidate => candidate.parent === branch.id)
      .map(candidate => candidate.id),
    binding: binding(snapshot, branch.id),
  };
}

function parseBranchId(input: unknown): string {
  if (
    input === null ||
    typeof input !== "object" ||
    typeof (input as { branch?: unknown }).branch !== "string" ||
    (input as { branch: string }).branch.length === 0
  ) {
    throw new SpineTreeReadError("invalid-input", "spinetree_read requires a non-empty branch string");
  }
  return (input as { branch: string }).branch;
}

function inheritance(snapshot: SpineTreeSnapshot, branch: SpineTreeBranch): SpineTreeInheritance {
  const path = pathTo(snapshot, branch.id);
  return {
    path: path.map(item => item.id),
    constraints: path.flatMap(item => item.constraints.map(value => ({ value: clone(value), source: item.id }))),
    skills: overlay(path, "skills"),
    tools: overlay(path, "tools"),
    memories: path.map(item => ({
      branch: item.id,
      memory: clone(item.memory),
      memoryVersion: item.memoryVersion,
    })),
  };
}

function pathTo(snapshot: SpineTreeSnapshot, branchId: string): SpineTreeBranch[] {
  const path: SpineTreeBranch[] = [];
  let current: SpineTreeBranch | undefined = snapshot.branches[branchId];
  while (current !== undefined) {
    path.push(current);
    current = current.parent === null ? undefined : snapshot.branches[current.parent];
  }
  return path.reverse();
}

function overlay(path: readonly SpineTreeBranch[], key: "skills" | "tools"): SpineTreeInheritedValue[] {
  const values = new Map<string, SpineTreeInheritedValue>();
  for (const branch of path) {
    for (const item of branch[key]) {
      const name = typeof item === "string"
        ? item
        : item !== null && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
          ? (item as { name: string }).name
          : JSON.stringify(item);
      values.set(name, { value: clone(item), source: branch.id });
    }
  }
  return [...values.values()];
}

function binding(snapshot: SpineTreeSnapshot, branchId: string): SpineTreeBinding | null {
  const agent = Object.values(snapshot.agents).find(
    candidate => candidate.status !== "ended" && candidate.live.includes(branchId),
  );
  return agent === undefined
    ? null
    : { agent: agent.id, working: agent.working, live: [...agent.live] };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
