import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PiSessionAdapter, PluginManifest, PluginTool, SpinePlugin, SpinePluginContext } from "@spinejit/spine-host";
import { toolContracts } from "./tool-contracts.js";
import type { SpineTreeScopeBinding, SpineTreeScopeWatermark } from "./scopes.js";
export * from "./scopes.js";

export const SPINETREE_READ_RESULT_SCHEMA = "spinetree.read.result/v2" as const;
export const SPINETREE_CHANGE_RESULT_SCHEMA = "spinetree.change.result/v1" as const;
export const SPINETREE_SEND_RESULT_SCHEMA = "spinetree.send.result/v2" as const;
export const SPINETREE_OBSERVE_RESULT_SCHEMA = "spinetree.observe.result/v1" as const;

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
  readonly scopeBinding?: SpineTreeScopeBinding;
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
  readonly registry?: Readonly<Record<string, SpineTreeAgentBinding>>;
  readonly mailbox?: SpineTreeMailboxState;
  readonly scopeImports?: Readonly<Record<string, SpineTreeScopeWatermark>>;
}

type DraftSpineTreeBranch = { -readonly [Key in keyof SpineTreeBranch]: SpineTreeBranch[Key] };

export interface SpineTreeSnapshotStore {
  head(): string | Promise<string>;
  readSnapshot(head: string): SpineTreeSnapshot | Promise<SpineTreeSnapshot>;
}

export interface SpineTreeSnapshotCommit {
  readonly parent: string;
  readonly head: string;
}

export interface SpineTreeSnapshotCommitStore extends SpineTreeSnapshotStore {
  commitSnapshot(
    expectedHead: string,
    snapshot: SpineTreeSnapshot,
    message?: string,
  ): SpineTreeSnapshotCommit | Promise<SpineTreeSnapshotCommit>;
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

export type SpineTreeAgentStatus = SpineTreeAgentBinding["status"];

export interface SpineTreeAgentRegistry {
  register(binding: SpineTreeAgentBinding): void | Promise<void>;
  resolve(agentId: string): SpineTreeAgentBinding | undefined | Promise<SpineTreeAgentBinding | undefined>;
}

export interface SpineTreeAgentLifecycleRegistry extends SpineTreeAgentRegistry {
  transition(agentId: string, status: SpineTreeAgentStatus): SpineTreeAgentBinding | Promise<SpineTreeAgentBinding>;
}

export interface SpineTreeAgentRegistryReader {
  list(branch?: string): readonly SpineTreeAgentBinding[] | Promise<readonly SpineTreeAgentBinding[]>;
}

export interface SpineTreeExclusiveAgentRegistry {
  registerExclusive(binding: SpineTreeAgentBinding): void | Promise<void>;
}

export class MemoryAgentRegistry implements SpineTreeAgentLifecycleRegistry, SpineTreeAgentRegistryReader, SpineTreeExclusiveAgentRegistry {
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

  transition(agentId: string, status: SpineTreeAgentStatus): SpineTreeAgentBinding {
    const binding = this.#bindings.get(agentId);
    if (binding === undefined) throw new SpineTreeRegistryError("unknown-agent", `Unknown Agent ${agentId}`);
    const next = transitionBinding(binding, status);
    this.#bindings.set(agentId, next);
    return clone(next);
  }

  list(branch?: string): readonly SpineTreeAgentBinding[] {
    return [...this.#bindings.values()]
      .filter(binding => branch === undefined || binding.branch === branch)
      .map(binding => clone(binding));
  }

  registerExclusive(binding: SpineTreeAgentBinding): void {
    validateBinding(binding);
    if (this.#bindings.has(binding.agentId)) {
      throw new SpineTreeRegistryError("duplicate-agent", `Agent ${binding.agentId} is already registered`);
    }
    if ([...this.#bindings.values()].some(existing => existing.branch === binding.branch && existing.status !== "ended")) {
      throw new SpineTreeRegistryError("branch-occupied", `ProjectBranch ${binding.branch} already has an active Agent`);
    }
    this.#bindings.set(binding.agentId, clone(binding));
  }
}

/** A registry persisted in the same immutable snapshot/HEAD as the tree. */
export class GitSpineTreeAgentRegistry implements SpineTreeAgentLifecycleRegistry, SpineTreeAgentRegistryReader, SpineTreeExclusiveAgentRegistry {
  readonly store: SpineTreeSnapshotCommitStore;
  readonly #maxCasRetries: number;

  constructor(storeOrRoot: SpineTreeSnapshotCommitStore | string, options: { maxCasRetries?: number } = {}) {
    this.store = asCommitStore(storeOrRoot);
    this.#maxCasRetries = validateCasRetries(options.maxCasRetries);
  }

  async register(binding: SpineTreeAgentBinding): Promise<void> {
    validateBinding(binding);
    await mutateSnapshotWithRetry(
      this.store,
      this.#maxCasRetries,
      "spinetree: registry register",
      snapshot => {
        const registry = { ...(snapshot.registry ?? {}) };
        if (registry[binding.agentId] !== undefined) {
          throw new SpineTreeRegistryError("duplicate-agent", `Agent ${binding.agentId} is already registered`);
        }
        registry[binding.agentId] = clone(binding);
        return { snapshot: { ...snapshot, registry }, value: undefined };
      },
    );
  }

  async resolve(agentId: string): Promise<SpineTreeAgentBinding | undefined> {
    const head = await this.store.head();
    const snapshot = await this.store.readSnapshot(head);
    const binding = snapshot.registry?.[agentId];
    return binding === undefined ? undefined : clone(binding);
  }

  async transition(agentId: string, status: SpineTreeAgentStatus): Promise<SpineTreeAgentBinding> {
    validateAgentStatus(status);
    return mutateSnapshotWithRetry(
      this.store,
      this.#maxCasRetries,
      "spinetree: registry status transition",
      snapshot => {
        const registry = { ...(snapshot.registry ?? {}) };
        const binding = registry[agentId];
        if (binding === undefined) throw new SpineTreeRegistryError("unknown-agent", `Unknown Agent ${agentId}`);
        const next = transitionBinding(binding, status);
        if (next.status === binding.status) return { snapshot, value: clone(next) };
        registry[agentId] = next;
        return { snapshot: { ...snapshot, registry }, value: clone(next) };
      },
    );
  }

  async list(branch?: string): Promise<readonly SpineTreeAgentBinding[]> {
    const head = await this.store.head();
    const snapshot = await this.store.readSnapshot(head);
    return Object.values(snapshot.registry ?? {})
      .filter(binding => branch === undefined || binding.branch === branch)
      .map(binding => clone(binding));
  }

  async registerExclusive(binding: SpineTreeAgentBinding): Promise<void> {
    validateBinding(binding);
    await mutateSnapshotWithRetry(
      this.store,
      this.#maxCasRetries,
      "spinetree: registry exclusive register",
      snapshot => {
        const registry = { ...(snapshot.registry ?? {}) };
        if (registry[binding.agentId] !== undefined) {
          throw new SpineTreeRegistryError("duplicate-agent", `Agent ${binding.agentId} is already registered`);
        }
        if (activeBranchBindings(snapshot, binding.branch).length > 0) {
          throw new SpineTreeRegistryError("branch-occupied", `ProjectBranch ${binding.branch} already has an active Agent`);
        }
        registry[binding.agentId] = clone(binding);
        return { snapshot: { ...snapshot, registry }, value: undefined };
      },
    );
  }
}

export class SpineTreeRegistryError extends Error {
  readonly code: "invalid-binding" | "duplicate-agent" | "branch-occupied" | "unknown-agent" | "invalid-transition";

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

export interface SpineTreeMailboxState {
  readonly sequence: number;
  readonly leaseSequence: number;
  readonly receipts: Readonly<Record<string, SpineTreeReceipt>>;
  readonly requestIds: Readonly<Record<string, string>>;
}

export interface SpineTreeMailboxInput {
  readonly to: string;
  readonly from: string | null;
  readonly message: string;
  readonly requestId?: string;
}

export interface SpineTreeMailbox {
  enqueue(input: SpineTreeMailboxInput): SpineTreeReceipt | Promise<SpineTreeReceipt>;
  lease(receiptId: string): SpineTreeReceipt | Promise<SpineTreeReceipt>;
  delivered(receiptId: string, leaseId: string): SpineTreeReceipt | Promise<SpineTreeReceipt>;
  release(receiptId: string, leaseId: string, error: string): SpineTreeReceipt | Promise<SpineTreeReceipt>;
  fail(receiptId: string, leaseId: string, error: string): SpineTreeReceipt | Promise<SpineTreeReceipt>;
  observed(receiptId: string, leaseId?: string): SpineTreeReceipt | Promise<SpineTreeReceipt>;
}

export interface SpineTreeMailboxReader {
  receipt(receiptId: string): SpineTreeReceipt | Promise<SpineTreeReceipt>;
}

export interface SpineTreeDispatchMailbox extends SpineTreeMailbox {
  /** Read-only selection of due queued receipts and expired leases, in enqueue order. */
  pending(limit: number): readonly SpineTreeReceipt[] | Promise<readonly SpineTreeReceipt[]>;
}

export const SPINETREE_MESSAGE_SCHEMA = "spinetree.message/v1" as const;

/** Recipient-visible prompt payload; leaseId identifies this delivery attempt. */
export interface SpineTreeMessage {
  readonly schema: typeof SPINETREE_MESSAGE_SCHEMA;
  readonly receiptId: string;
  readonly leaseId: string;
  readonly to: string;
  readonly from: string | null;
  readonly message: string;
}

export interface SpineTreeDispatchResult {
  readonly receipts: readonly SpineTreeReceipt[];
  readonly skipped: readonly string[];
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
export class MemorySpineTreeMailbox implements SpineTreeDispatchMailbox {
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
    const now = Date.now();
    requireLeaseable(receipt, now);
    const next = {
      ...receipt,
      status: "leased" as const,
      attempt: receipt.attempt + 1,
      leaseId: `lease-${++this.#leaseSequence}`,
      leaseUntil: now + 30_000,
      nextAttemptAt: null,
    };
    this.#receipts.set(receiptId, next);
    return clone(next);
  }

  delivered(receiptId: string, leaseId: string): SpineTreeReceipt {
    return this.#leaseMutation(receiptId, leaseId, "delivered", null);
  }

  release(receiptId: string, leaseId: string, error: string): SpineTreeReceipt {
    return this.#leaseMutation(receiptId, leaseId, "queued", error);
  }

  fail(receiptId: string, leaseId: string, error: string): SpineTreeReceipt {
    return this.#leaseMutation(receiptId, leaseId, "failed", error);
  }

  #leaseMutation(receiptId: string, leaseId: string, status: "queued" | "delivered" | "failed", error: string | null): SpineTreeReceipt {
    const receipt = this.#receipt(receiptId);
    const next = completeDelivery(receipt, leaseId, status, error);
    if (next !== receipt) this.#receipts.set(receiptId, next);
    return clone(next);
  }

  observed(receiptId: string, leaseId?: string): SpineTreeReceipt {
    const receipt = this.#receipt(receiptId);
    const next = observeReceipt(receipt, leaseId);
    if (next !== receipt) this.#receipts.set(receiptId, next);
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

  pending(limit: number): readonly SpineTreeReceipt[] {
    return pendingReceipts(this.#receipts.values(), limit, Date.now());
  }
}

/** A mailbox persisted in the same immutable snapshot/HEAD as the tree. */
export class GitSpineTreeMailbox implements SpineTreeDispatchMailbox {
  readonly store: SpineTreeSnapshotCommitStore;
  readonly #maxCasRetries: number;

  constructor(storeOrRoot: SpineTreeSnapshotCommitStore | string, options: { maxCasRetries?: number } = {}) {
    this.store = asCommitStore(storeOrRoot);
    this.#maxCasRetries = validateCasRetries(options.maxCasRetries);
  }

  async enqueue(input: SpineTreeMailboxInput): Promise<SpineTreeReceipt> {
    validateMailboxInput(input);
    return mutateSnapshotWithRetry(
      this.store,
      this.#maxCasRetries,
      "spinetree: mailbox enqueue",
      snapshot => {
        const state = mailboxState(snapshot.mailbox);
        if (input.requestId !== undefined) {
          const existingId = state.requestIds[input.requestId];
          if (existingId !== undefined) {
            const existing = receiptFromState(state, existingId);
            if (existing.to !== input.to || existing.from !== input.from || existing.message !== input.message) {
              throw new SpineTreeMailboxError("invalid-state", `Request ${input.requestId} is already bound to another message`);
            }
            return { snapshot, value: existing };
          }
        }
        const receipt: SpineTreeReceipt = {
          id: `mail-${state.sequence + 1}`,
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
        state.sequence += 1;
        state.receipts[receipt.id] = receipt;
        if (input.requestId !== undefined) state.requestIds[input.requestId] = receipt.id;
        return { snapshot: { ...snapshot, mailbox: state }, value: clone(receipt) };
      },
    );
  }

  async lease(receiptId: string): Promise<SpineTreeReceipt> {
    return mutateSnapshotWithRetry(
      this.store,
      this.#maxCasRetries,
      "spinetree: mailbox lease",
      snapshot => {
        const state = mailboxState(snapshot.mailbox);
        const receipt = receiptFromState(state, receiptId);
        const now = Date.now();
        requireLeaseable(receipt, now);
        const next: SpineTreeReceipt = {
          ...receipt,
          status: "leased",
          attempt: receipt.attempt + 1,
          leaseId: `lease-${state.leaseSequence + 1}`,
          leaseUntil: now + 30_000,
          nextAttemptAt: null,
        };
        state.leaseSequence += 1;
        state.receipts[receiptId] = next;
        return { snapshot: { ...snapshot, mailbox: state }, value: clone(next) };
      },
    );
  }

  async delivered(receiptId: string, leaseId: string): Promise<SpineTreeReceipt> {
    return this.#leaseMutation(receiptId, leaseId, "delivered", null, "spinetree: mailbox delivered");
  }

  async release(receiptId: string, leaseId: string, error: string): Promise<SpineTreeReceipt> {
    return this.#leaseMutation(receiptId, leaseId, "queued", error, "spinetree: mailbox release");
  }

  async fail(receiptId: string, leaseId: string, error: string): Promise<SpineTreeReceipt> {
    return this.#leaseMutation(receiptId, leaseId, "failed", error, "spinetree: mailbox fail");
  }

  async observed(receiptId: string, leaseId?: string): Promise<SpineTreeReceipt> {
    return mutateSnapshotWithRetry(
      this.store,
      this.#maxCasRetries,
      "spinetree: mailbox observed",
      snapshot => {
        const state = mailboxState(snapshot.mailbox);
        const receipt = receiptFromState(state, receiptId);
        const next = observeReceipt(receipt, leaseId);
        if (next === receipt) return { snapshot, value: receipt };
        state.receipts[receiptId] = next;
        return { snapshot: { ...snapshot, mailbox: state }, value: clone(next) };
      },
    );
  }

  async receipt(receiptId: string): Promise<SpineTreeReceipt> {
    const head = await this.store.head();
    const snapshot = await this.store.readSnapshot(head);
    return receiptFromState(mailboxState(snapshot.mailbox), receiptId);
  }

  async pending(limit: number): Promise<readonly SpineTreeReceipt[]> {
    validateDispatchLimit(limit);
    const now = Date.now();
    const head = await this.store.head();
    const snapshot = await this.store.readSnapshot(head);
    return pendingReceipts(Object.values(snapshot.mailbox?.receipts ?? {}), limit, now);
  }

  async #leaseMutation(
    receiptId: string,
    leaseId: string,
    status: "queued" | "delivered" | "failed",
    error: string | null,
    message: string,
  ): Promise<SpineTreeReceipt> {
    return mutateSnapshotWithRetry(
      this.store,
      this.#maxCasRetries,
      message,
      snapshot => {
        const state = mailboxState(snapshot.mailbox);
        const receipt = receiptFromState(state, receiptId);
        const next = completeDelivery(receipt, leaseId, status, error);
        if (next === receipt) return { snapshot, value: receipt };
        state.receipts[receiptId] = next;
        return { snapshot: { ...snapshot, mailbox: state }, value: clone(next) };
      },
    );
  }
}

/** Dispatch one bounded batch. The caller owns scheduling and the session adapter. */
export async function dispatchSpineTreeMailbox(options: {
  readonly registry: SpineTreeAgentRegistry;
  readonly mailbox: SpineTreeDispatchMailbox;
  readonly sessions: PiSessionAdapter;
  readonly limit?: number;
}): Promise<SpineTreeDispatchResult> {
  const { registry, mailbox, sessions, limit = 100 } = options;
  validateDispatchLimit(limit);
  const pending = await mailbox.pending(limit);
  const receipts: SpineTreeReceipt[] = [];
  const skipped: string[] = [];
  for (const candidate of pending.slice(0, limit)) {
    let leased: SpineTreeReceipt;
    try {
      leased = await mailbox.lease(candidate.id);
    } catch (error) {
      if (error instanceof SpineTreeMailboxError && (error.code === "lease-conflict" || error.code === "invalid-state")) {
        skipped.push(candidate.id);
        continue;
      }
      throw error;
    }
    const target = await registry.resolve(leased.to);
    if (target === undefined || target.status === "ended") {
      receipts.push(await mailbox.fail(leased.id, leased.leaseId!,
        target === undefined ? `Unknown Agent ${leased.to}` : `Agent ${leased.to} has ended`));
    } else {
      receipts.push(await deliverReceipt(mailbox, sessions, leased, target.sessionId));
    }
  }
  return { receipts, skipped };
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
    const committed = this.commitSnapshot(parent, draft, "spinetree: change");
    return {
      schema: SPINETREE_CHANGE_RESULT_SCHEMA,
      parent,
      head: committed.head,
      changes: clone(changes),
    };
  }

  commitSnapshot(expectedHead: string, snapshot: SpineTreeSnapshot, _message = "spinetree: state"): SpineTreeSnapshotCommit {
    if (expectedHead !== this.#head) {
      throw new SpineTreeChangeError(
        "stale-head",
        `SpineTree HEAD changed: expected ${expectedHead}, found ${this.#head}`,
      );
    }
    const parent = this.#head;
    const head = `memory-${++this.#revision}`;
    this.#snapshots.set(head, clone(snapshot));
    this.#head = head;
    return { parent, head };
  }
}

export class SpineTreeGitStoreError extends Error {
  readonly code: "invalid-root" | "not-initialized" | "invalid-head" | "invalid-snapshot" | "git-error";

  constructor(
    code: SpineTreeGitStoreError["code"],
    message: string,
  ) {
    super(message);
    this.name = "SpineTreeGitStoreError";
    this.code = code;
  }
}

/** A real `.spinetree` Git object store with immutable snapshots and ref-level CAS. */
export class GitSpineTreeStore implements SpineTreeChangeStore {
  readonly root: string;

  constructor(root: string) {
    if (typeof root !== "string" || root.length === 0) {
      throw new SpineTreeGitStoreError("invalid-root", "SpineTree Git root must be a non-empty path");
    }
    this.root = root;
    if (!existsSync(join(root, ".git"))) {
      throw new SpineTreeGitStoreError("not-initialized", `SpineTree Git root is not initialized: ${root}`);
    }
  }

  static initialize(root: string, snapshot: SpineTreeSnapshot): GitSpineTreeStore {
    if (typeof root !== "string" || root.length === 0) {
      throw new SpineTreeGitStoreError("invalid-root", "SpineTree Git root must be a non-empty path");
    }
    mkdirSync(root, { recursive: true });
    const gitDir = join(root, ".git");
    if (existsSync(gitDir)) {
      throw new SpineTreeGitStoreError("invalid-root", `SpineTree Git root already exists: ${root}`);
    }
    runGit(root, ["init", "-q"]);
    runGit(root, ["config", "user.email", "spinetree@localhost"]);
    runGit(root, ["config", "user.name", "SpineTree"]);
    const store = new GitSpineTreeStore(root);
    const commit = store.#commitSnapshot(snapshot, "spinetree: initialize", null);
    runGit(root, ["update-ref", "HEAD", commit, "0".repeat(40)]);
    return store;
  }

  head(): string {
    try {
      return runGit(this.root, ["rev-parse", "HEAD"]).trim();
    } catch (error) {
      throw new SpineTreeChangeError("unknown-head", `SpineTree Git HEAD is unavailable: ${formatError(error)}`);
    }
  }

  readSnapshot(head: string): SpineTreeSnapshot {
    validateGitHead(head);
    let raw: string;
    try {
      raw = runGit(this.root, ["show", `${head}:state.json`]);
    } catch (error) {
      throw new SpineTreeChangeError("unknown-head", `Unknown SpineTree Git HEAD ${head}: ${formatError(error)}`);
    }
    try {
      return clone(parseSnapshot(JSON.parse(raw)));
    } catch (error) {
      if (error instanceof SpineTreeGitStoreError) throw error;
      throw new SpineTreeGitStoreError("invalid-snapshot", `Invalid snapshot at ${head}: ${formatError(error)}`);
    }
  }

  change(expectedHead: string, changes: readonly SpineTreeChange[]): SpineTreeChangeResult {
    validateGitHead(expectedHead);
    const currentHead = this.head();
    if (currentHead !== expectedHead) {
      throw new SpineTreeChangeError(
        "stale-head",
        `SpineTree HEAD changed: expected ${expectedHead}, found ${currentHead}`,
      );
    }
    const draft = clone(this.readSnapshot(expectedHead));
    applyChanges(draft, changes);
    const committed = this.commitSnapshot(expectedHead, draft, "spinetree: change");
    return {
      schema: SPINETREE_CHANGE_RESULT_SCHEMA,
      parent: expectedHead,
      head: committed.head,
      changes: clone(changes),
    };
  }

  commitSnapshot(expectedHead: string, snapshot: SpineTreeSnapshot, message = "spinetree: state"): SpineTreeSnapshotCommit {
    validateGitHead(expectedHead);
    const currentHead = this.head();
    if (currentHead !== expectedHead) {
      throw new SpineTreeChangeError(
        "stale-head",
        `SpineTree HEAD changed: expected ${expectedHead}, found ${currentHead}`,
      );
    }
    const nextHead = this.#commitSnapshot(snapshot, message, expectedHead);
    try {
      runGit(this.root, ["update-ref", "HEAD", nextHead, expectedHead]);
    } catch (error) {
      const observed = this.head();
      if (observed !== expectedHead) {
        throw new SpineTreeChangeError(
          "stale-head",
          `SpineTree HEAD changed: expected ${expectedHead}, found ${observed}`,
        );
      }
      throw new SpineTreeGitStoreError("git-error", `Unable to publish SpineTree HEAD: ${formatError(error)}`);
    }
    return { parent: expectedHead, head: nextHead };
  }

  #commitSnapshot(snapshot: SpineTreeSnapshot, message: string, parent: string | null): string {
    const content = `${JSON.stringify(parseSnapshot(snapshot), null, 2)}\n`;
    const blob = runGit(this.root, ["hash-object", "-w", "--stdin"], content).trim();
    const tree = runGit(this.root, ["mktree"], `100644 blob ${blob}\tstate.json\n`).trim();
    const args = ["commit-tree", tree, "-m", message];
    if (parent !== null) args.push("-p", parent);
    return runGit(this.root, args).trim();
  }
}

/** An explicit adapter for a `.spinetree` root. */
export type SpineTreeRootAdapter = SpineTreeSnapshotStore;

export interface SpineTreeRejuvenateContext {
  readonly parent: SpineTreeBranch;
  readonly branch: SpineTreeBranch;
  readonly inherit: SpineTreeInheritance;
  readonly request?: string;
}

export interface SpineTreeRejuvenator {
  provision(context: SpineTreeRejuvenateContext): SpineTreeAgentBinding | Promise<SpineTreeAgentBinding>;
}

export interface SpineTreePluginOptions {
  readonly store?: SpineTreeSnapshotStore;
  readonly root?: SpineTreeRootAdapter;
  readonly registry?: SpineTreeAgentRegistry;
  readonly mailbox?: SpineTreeMailbox;
  readonly rejuvenator?: SpineTreeRejuvenator;
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
  readonly status: SpineTreeReceipt["status"];
  readonly to: string;
  readonly sessionId: string;
}

export interface SpineTreeObserveInput {
  readonly receiptId: string;
  readonly agentId: string;
  readonly leaseId?: string;
}

export interface SpineTreeObserveResult {
  readonly schema: typeof SPINETREE_OBSERVE_RESULT_SCHEMA;
  readonly receipt: SpineTreeReceipt;
  readonly agentId: string;
  readonly sessionId: string;
}

export const SPINETREE_REJUVENATE_RESULT_SCHEMA = "spinetree.rejuvenate.result/v1" as const;

export interface SpineTreeRejuvenateInput {
  readonly parent: string;
  readonly branch: string;
  readonly request?: string;
}

export interface SpineTreeRejuvenateResult {
  readonly schema: typeof SPINETREE_REJUVENATE_RESULT_SCHEMA;
  readonly parent: string;
  readonly branch: string;
  readonly binding: SpineTreeAgentBinding;
  readonly context: SpineTreeRejuvenateContext;
}

export class SpineTreeSendError extends Error {
  readonly code: "invalid-input" | "unknown-recipient" | "recipient-ended" | "mailbox-error";

  constructor(code: SpineTreeSendError["code"], message: string) {
    super(message);
    this.name = "SpineTreeSendError";
    this.code = code;
  }
}

export class SpineTreeObserveError extends Error {
  readonly code: "invalid-input" | "unknown-agent" | "agent-ended" | "unknown-receipt" | "not-recipient" | "invalid-state" | "lease-conflict" | "mailbox-error";

  constructor(code: SpineTreeObserveError["code"], message: string) {
    super(message);
    this.name = "SpineTreeObserveError";
    this.code = code;
  }
}

export class SpineTreeRejuvenateError extends Error {
  readonly code:
    | "invalid-input"
    | "unavailable"
    | "unknown-branch"
    | "branch-not-capped"
    | "invalid-parent"
    | "branch-occupied"
    | "invalid-binding"
    | "registry-error";

  constructor(code: SpineTreeRejuvenateError["code"], message: string) {
    super(message);
    this.name = "SpineTreeRejuvenateError";
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

export type SpineTreeBinding = SpineTreeAgentBinding;

export interface SpineTreeReadResult {
  readonly schema: typeof SPINETREE_READ_RESULT_SCHEMA;
  readonly head: string;
  readonly branch: SpineTreeBranch;
  readonly inherit: SpineTreeInheritance;
  readonly children: readonly string[];
  readonly binding: SpineTreeBinding | null;
}

export class SpineTreeReadError extends Error {
  readonly code: "invalid-input" | "store-unavailable" | "unknown-branch" | "ambiguous-binding";

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
  const observeReady = sendReady && isMailboxReader(options.mailbox!);
  const rejuvenateReady = store !== undefined && options.registry !== undefined &&
    isRegistryReader(options.registry) && isExclusiveRegistry(options.registry) && options.rejuvenator !== undefined;
  return {
    manifest: SPINETREE_PLUGIN_MANIFEST,
    activate(context) {
      for (const operation of ["read", "change", "send", "observe", "rejuvenate"] as const) {
        context.tools.register(
          operation,
          operation === "read" && store !== undefined
            ? readTool(store)
            : operation === "change" && changeStore !== undefined
              ? changeTool(changeStore)
            : operation === "send" && sendReady
              ? sendTool(options.registry!, options.mailbox!)
            : operation === "observe" && observeReady
              ? observeTool(options.registry!, options.mailbox!, options.mailbox!)
            : operation === "rejuvenate" && rejuvenateReady
              ? rejuvenateTool(store!, options.registry!, options.rejuvenator!)
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
): PluginTool {
  return {
    ...toolContracts.send,
    execute: async (input: unknown) => {
      const parsed = parseSendInput(input);
      const target = await registry.resolve(parsed.to);
      if (target === undefined) {
        throw new SpineTreeSendError("unknown-recipient", `Unknown Agent ${parsed.to}`);
      }
      if (target.status === "ended") {
        throw new SpineTreeSendError("recipient-ended", `Agent ${parsed.to} has ended`);
      }
      if (parsed.from !== undefined) {
        const source = await registry.resolve(parsed.from);
        if (source === undefined) throw new SpineTreeSendError("unknown-recipient", `Unknown Agent ${parsed.from}`);
        if (source.status === "ended") throw new SpineTreeSendError("recipient-ended", `Agent ${parsed.from} has ended`);
      }
      try {
        const receipt = await mailbox.enqueue({
          to: parsed.to,
          from: parsed.from ?? null,
          message: parsed.message,
          ...(parsed.requestId === undefined ? {} : { requestId: parsed.requestId }),
        });
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

async function deliverReceipt(
  mailbox: SpineTreeMailbox,
  sessions: PiSessionAdapter,
  leased: SpineTreeReceipt,
  sessionId: string,
): Promise<SpineTreeReceipt> {
  let accepted: boolean;
  try {
    const response = await sessions.request({
      targetSessionId: sessionId,
      operation: "prompt",
      text: JSON.stringify({
        schema: SPINETREE_MESSAGE_SCHEMA,
        receiptId: leased.id,
        leaseId: leased.leaseId!,
        to: leased.to,
        from: leased.from,
        message: leased.message,
      } satisfies SpineTreeMessage),
      requestId: leased.id,
    });
    accepted = response.accepted;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isPermanentError(error)
      ? mailbox.fail(leased.id, leased.leaseId!, message)
      : mailbox.release(leased.id, leased.leaseId!, message);
  }
  // An acknowledgement write failure is not a transport rejection. Leave it recoverable.
  return accepted
    ? mailbox.delivered(leased.id, leased.leaseId!)
    : mailbox.release(leased.id, leased.leaseId!, "session request was not accepted");
}

function sendResult(receipt: SpineTreeReceipt, sessionId: string): SpineTreeSendResult {
  return {
    schema: SPINETREE_SEND_RESULT_SCHEMA,
    receipt: clone(receipt),
    status: receipt.status,
    to: receipt.to,
    sessionId,
  };
}

function observeTool(
  registry: SpineTreeAgentRegistry,
  mailbox: SpineTreeMailbox,
  reader: SpineTreeMailboxReader,
): PluginTool {
  return {
    ...toolContracts.observe,
    execute: async (input: unknown) => {
      const parsed = parseObserveInput(input);
      const agent = await registry.resolve(parsed.agentId);
      if (agent === undefined) {
        throw new SpineTreeObserveError("unknown-agent", `Unknown Agent ${parsed.agentId}`);
      }
      if (agent.status === "ended") {
        throw new SpineTreeObserveError("agent-ended", `Agent ${parsed.agentId} has ended`);
      }
      let current: SpineTreeReceipt;
      try {
        current = await reader.receipt(parsed.receiptId);
      } catch (error) {
        throw observeMailboxError(error, parsed.receiptId);
      }
      if (current.to !== parsed.agentId) {
        throw new SpineTreeObserveError(
          "not-recipient",
          `Agent ${parsed.agentId} is not the recipient of receipt ${parsed.receiptId}`,
        );
      }
      try {
        const receipt = await mailbox.observed(parsed.receiptId, parsed.leaseId);
        return {
          schema: SPINETREE_OBSERVE_RESULT_SCHEMA,
          receipt: clone(receipt),
          agentId: parsed.agentId,
          sessionId: agent.sessionId,
        } satisfies SpineTreeObserveResult;
      } catch (error) {
        throw observeMailboxError(error, parsed.receiptId);
      }
    },
  };
}

function parseObserveInput(input: unknown): SpineTreeObserveInput {
  if (input === null || typeof input !== "object") {
    throw new SpineTreeObserveError("invalid-input", "spinetree_observe requires an object input");
  }
  const value = input as { receiptId?: unknown; agentId?: unknown; leaseId?: unknown };
  if (typeof value.receiptId !== "string" || value.receiptId.length === 0 || typeof value.agentId !== "string" || value.agentId.length === 0) {
    throw new SpineTreeObserveError("invalid-input", "spinetree_observe requires non-empty receiptId and agentId strings");
  }
  if (value.leaseId !== undefined && (typeof value.leaseId !== "string" || value.leaseId.length === 0)) {
    throw new SpineTreeObserveError("invalid-input", "leaseId must be a non-empty string when supplied");
  }
  return { receiptId: value.receiptId, agentId: value.agentId, ...(value.leaseId === undefined ? {} : { leaseId: value.leaseId }) };
}

function observeMailboxError(error: unknown, receiptId: string): SpineTreeObserveError {
  if (error instanceof SpineTreeMailboxError) {
    if (error.code === "unknown-receipt") {
      return new SpineTreeObserveError("unknown-receipt", error.message);
    }
    if (error.code === "invalid-state" || error.code === "lease-conflict") {
      return new SpineTreeObserveError(error.code, error.message);
    }
    return new SpineTreeObserveError("mailbox-error", error.message);
  }
  return new SpineTreeObserveError("mailbox-error", `Could not observe receipt ${receiptId}: ${error instanceof Error ? error.message : String(error)}`);
}

function rejuvenateTool(
  store: SpineTreeSnapshotStore,
  registry: SpineTreeAgentRegistry & SpineTreeAgentRegistryReader & SpineTreeExclusiveAgentRegistry,
  rejuvenator: SpineTreeRejuvenator,
): PluginTool {
  return {
    ...toolContracts.rejuvenate,
    execute: async (input: unknown) => {
      const parsed = parseRejuvenateInput(input);
      const head = await store.head();
      const snapshot = await store.readSnapshot(head);
      const target = snapshot.branches[parsed.branch];
      if (target === undefined) {
        throw new SpineTreeRejuvenateError("unknown-branch", `Unknown ProjectBranch ${parsed.branch}`);
      }
      const parent = snapshot.branches[parsed.parent];
      if (parent === undefined || !isDescendant(snapshot, target.id, parent.id)) {
        throw new SpineTreeRejuvenateError(
          "invalid-parent",
          `ProjectBranch ${parsed.parent} is not an ancestor of ${parsed.branch}`,
        );
      }
      if (target.status !== "capped") {
        throw new SpineTreeRejuvenateError("branch-not-capped", `ProjectBranch ${target.id} is ${target.status}, not capped`);
      }
      let bindings: readonly SpineTreeAgentBinding[];
      try {
        bindings = await registry.list(target.id);
      } catch (error) {
        throw new SpineTreeRejuvenateError("registry-error", formatError(error));
      }
      if (bindings.some(binding => binding.status !== "ended")) {
        throw new SpineTreeRejuvenateError("branch-occupied", `ProjectBranch ${target.id} already has an active Agent`);
      }
      const context: SpineTreeRejuvenateContext = {
        parent: clone(parent),
        branch: clone(target),
        inherit: inheritance(snapshot, target),
        ...(parsed.request === undefined ? {} : { request: parsed.request }),
      };
      let binding: SpineTreeAgentBinding;
      try {
        binding = await rejuvenator.provision(context);
        validateBinding(binding);
        if (binding.branch !== target.id) {
          throw new SpineTreeRejuvenateError("invalid-binding", `Provisioned Agent must bind ProjectBranch ${target.id}`);
        }
      } catch (error) {
        if (error instanceof SpineTreeRejuvenateError) throw error;
        if (error instanceof SpineTreeRegistryError) {
          throw new SpineTreeRejuvenateError("invalid-binding", error.message);
        }
        throw error;
      }
      try {
        await registry.registerExclusive(binding);
      } catch (error) {
        if (error instanceof SpineTreeRegistryError && error.code === "branch-occupied") {
          throw new SpineTreeRejuvenateError("branch-occupied", error.message);
        }
        if (error instanceof SpineTreeRegistryError && error.code === "invalid-binding") {
          throw new SpineTreeRejuvenateError("invalid-binding", error.message);
        }
        throw new SpineTreeRejuvenateError("registry-error", formatError(error));
      }
      return {
        schema: SPINETREE_REJUVENATE_RESULT_SCHEMA,
        parent: parsed.parent,
        branch: target.id,
        binding: clone(binding),
        context,
      } satisfies SpineTreeRejuvenateResult;
    },
  };
}

function parseRejuvenateInput(input: unknown): SpineTreeRejuvenateInput {
  if (input === null || typeof input !== "object") {
    throw new SpineTreeRejuvenateError("invalid-input", "spinetree_rejuvenate requires an object input");
  }
  const value = input as { parent?: unknown; branch?: unknown; request?: unknown };
  if (typeof value.parent !== "string" || value.parent.length === 0 || typeof value.branch !== "string" || value.branch.length === 0) {
    throw new SpineTreeRejuvenateError("invalid-input", "spinetree_rejuvenate requires non-empty parent and branch strings");
  }
  if (value.request !== undefined && (typeof value.request !== "string" || value.request.length === 0)) {
    throw new SpineTreeRejuvenateError("invalid-input", "spinetree_rejuvenate request must be a non-empty string");
  }
  return {
    parent: value.parent,
    branch: value.branch,
    ...(value.request === undefined ? {} : { request: value.request }),
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

function validateAgentStatus(status: unknown): asserts status is SpineTreeAgentStatus {
  if (!(["running", "paused", "ended"] as readonly unknown[]).includes(status)) {
    throw new SpineTreeRegistryError("invalid-transition", `Invalid Agent status ${String(status)}`);
  }
}

function transitionBinding(binding: SpineTreeAgentBinding, status: SpineTreeAgentStatus): SpineTreeAgentBinding {
  validateAgentStatus(status);
  if (binding.status === "ended" && status !== "ended") {
    throw new SpineTreeRegistryError(
      "invalid-transition",
      `Ended Agent ${binding.agentId} cannot transition to ${status}`,
    );
  }
  return { ...binding, status };
}

function contractTool(context: SpinePluginContext, operation: keyof typeof toolContracts): PluginTool {
  return {
    ...toolContracts[operation],
    description: `${toolContracts[operation].description} Unavailable in this host: required adapters are not configured; returns contract-only without performing the operation.`,
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
    ...toolContracts.read,
    execute: async (input: unknown) => readSnapshot(store, input),
  };
}

function changeTool(store: SpineTreeChangeStore): PluginTool {
  return {
    ...toolContracts.change,
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

function isMailboxReader(mailbox: SpineTreeMailbox): mailbox is SpineTreeMailbox & SpineTreeMailboxReader {
  return typeof (mailbox as Partial<SpineTreeMailboxReader>).receipt === "function";
}

function isRegistryReader(registry: SpineTreeAgentRegistry): registry is SpineTreeAgentRegistry & SpineTreeAgentRegistryReader {
  return typeof (registry as Partial<SpineTreeAgentRegistryReader>).list === "function";
}

function isExclusiveRegistry(registry: SpineTreeAgentRegistry): registry is SpineTreeAgentRegistry & SpineTreeExclusiveAgentRegistry {
  return typeof (registry as Partial<SpineTreeExclusiveAgentRegistry>).registerExclusive === "function";
}

function asCommitStore(storeOrRoot: SpineTreeSnapshotCommitStore | string): SpineTreeSnapshotCommitStore {
  if (typeof storeOrRoot === "string") return new GitSpineTreeStore(storeOrRoot);
  if (storeOrRoot !== null && typeof storeOrRoot.commitSnapshot === "function") return storeOrRoot;
  throw new TypeError("SpineTree persistent adapters require a commit-capable snapshot store");
}

function validateCasRetries(value: number | undefined): number {
  if (value === undefined) return 8;
  if (!Number.isInteger(value) || value < 1) throw new TypeError("maxCasRetries must be a positive integer");
  return value;
}

interface MutableMailboxState {
  sequence: number;
  leaseSequence: number;
  receipts: Record<string, SpineTreeReceipt>;
  requestIds: Record<string, string>;
}

function mailboxState(value: SpineTreeMailboxState | undefined): MutableMailboxState {
  if (value === undefined) return { sequence: 0, leaseSequence: 0, receipts: {}, requestIds: {} };
  if (
    !Number.isInteger(value.sequence) || value.sequence < 0 ||
    !Number.isInteger(value.leaseSequence) || value.leaseSequence < 0 ||
    !isRecord(value.receipts) || !isRecord(value.requestIds)
  ) {
    throw new SpineTreeMailboxError("invalid-state", "Invalid persisted SpineTree mailbox state");
  }
  return {
    sequence: value.sequence,
    leaseSequence: value.leaseSequence,
    receipts: clone(value.receipts) as Record<string, SpineTreeReceipt>,
    requestIds: clone(value.requestIds) as Record<string, string>,
  };
}

function validateMailboxInput(input: SpineTreeMailboxInput): void {
  if (
    input === null || typeof input !== "object" ||
    typeof input.to !== "string" || input.to.length === 0 ||
    typeof input.message !== "string" || input.message.length === 0 ||
    (input.from !== null && (typeof input.from !== "string" || input.from.length === 0)) ||
    (input.requestId !== undefined && (typeof input.requestId !== "string" || input.requestId.length === 0))
  ) {
    throw new SpineTreeMailboxError("invalid-state", "Mailbox input requires non-empty to/message and valid from/requestId");
  }
}

function receiptFromState(state: MutableMailboxState, receiptId: string): SpineTreeReceipt {
  const receipt = state.receipts[receiptId];
  if (receipt === undefined) throw new SpineTreeMailboxError("unknown-receipt", `Unknown receipt ${receiptId}`);
  return clone(receipt);
}

// A receiver can acknowledge while prompt is still running. That terminal state
// wins over completion/rejection, but only for the same delivery attempt.
function completeDelivery(
  receipt: SpineTreeReceipt,
  leaseId: string,
  status: "queued" | "delivered" | "failed",
  error: string | null,
): SpineTreeReceipt {
  if ((receipt.status !== "leased" && receipt.status !== "observed") || receipt.leaseId !== leaseId) {
    throw new SpineTreeMailboxError("lease-conflict", `Lease ${leaseId} does not own receipt ${receipt.id}`);
  }
  if (receipt.status === "observed") return receipt;
  return {
    ...receipt, status, leaseId: status === "delivered" ? leaseId : null, leaseUntil: null,
    nextAttemptAt: status === "queued" ? Date.now() : null, lastError: error,
  };
}

function observeReceipt(receipt: SpineTreeReceipt, leaseId?: string): SpineTreeReceipt {
  if (receipt.status !== "leased" && receipt.status !== "delivered" && receipt.status !== "observed") {
    throw new SpineTreeMailboxError("invalid-state", `Receipt ${receipt.id} cannot be observed from ${receipt.status}`);
  }
  if ((receipt.status === "leased" && leaseId === undefined) ||
      (leaseId !== undefined && receipt.leaseId !== leaseId)) {
    throw new SpineTreeMailboxError("lease-conflict", `Lease ${leaseId} does not own receipt ${receipt.id}`);
  }
  if (receipt.status === "observed") return receipt;
  return { ...receipt, status: "observed", leaseUntil: null, nextAttemptAt: null, lastError: null };
}

function isPending(receipt: SpineTreeReceipt, now: number): boolean {
  return receipt.status === "queued"
    ? receipt.nextAttemptAt === null || receipt.nextAttemptAt <= now
    : receipt.status === "leased" && (receipt.leaseUntil === null || receipt.leaseUntil <= now);
}

function requireLeaseable(receipt: SpineTreeReceipt, now: number): void {
  if (receipt.status !== "queued" && receipt.status !== "leased") {
    throw new SpineTreeMailboxError("invalid-state", `Receipt ${receipt.id} cannot be leased from ${receipt.status}`);
  }
  if (!isPending(receipt, now)) {
    throw new SpineTreeMailboxError("lease-conflict", `Receipt ${receipt.id} is leased or not yet due`);
  }
}

function validateDispatchLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("Mailbox dispatch limit must be a positive safe integer");
}

function pendingReceipts(receipts: Iterable<SpineTreeReceipt>, limit: number, now: number): readonly SpineTreeReceipt[] {
  validateDispatchLimit(limit);
  const pending: SpineTreeReceipt[] = [];
  for (const receipt of receipts) {
    if (isPending(receipt, now)) pending.push(clone(receipt));
    if (pending.length === limit) break;
  }
  return pending;
}

async function mutateSnapshotWithRetry<T>(
  store: SpineTreeSnapshotCommitStore,
  maxCasRetries: number,
  message: string,
  mutate: (snapshot: SpineTreeSnapshot) => { snapshot: SpineTreeSnapshot; value: T },
): Promise<T> {
  let lastStale: unknown;
  for (let attempt = 0; attempt < maxCasRetries; attempt += 1) {
    const head = await store.head();
    const snapshot = await store.readSnapshot(head);
    const result = mutate(snapshot);
    if (result.snapshot === snapshot) return result.value;
    try {
      await store.commitSnapshot(head, result.snapshot, message);
      return result.value;
    } catch (error) {
      if (!isStaleHead(error)) throw error;
      lastStale = error;
    }
  }
  throw lastStale ?? new SpineTreeChangeError("stale-head", "SpineTree snapshot changed during persistent mutation");
}

function isStaleHead(error: unknown): boolean {
  return error instanceof SpineTreeChangeError && error.code === "stale-head";
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
  const branch = snapshot.branches[branchId]!;
  if (branch.scopeBinding !== undefined && branch.status !== "live") return null;
  const bindings = activeBranchBindings(snapshot, branchId);
  if (bindings.length > 1) {
    throw new SpineTreeReadError("ambiguous-binding", `ProjectBranch ${branchId} has multiple active Agents`);
  }
  return bindings[0] === undefined ? null : clone(bindings[0]);
}

/** Scope ownership supplements the Agent's immutable home-branch identity. */
function activeBranchBindings(snapshot: SpineTreeSnapshot, branchId: string): SpineTreeAgentBinding[] {
  const branch = snapshot.branches[branchId];
  const mapped = branch?.scopeBinding;
  return Object.values(snapshot.registry ?? {}).filter(candidate => {
    if (candidate.status === "ended") return false;
    return candidate.branch === branchId || (candidate.agentId === mapped?.agentId &&
      branch?.status === "live" && candidate.sessionId === mapped.sessionId);
  });
}

function validateGitHead(head: string): void {
  if (typeof head !== "string" || !/^[0-9a-f]{40,64}$/.test(head)) {
    throw new SpineTreeGitStoreError("invalid-head", "SpineTree Git HEAD must be a hexadecimal object id");
  }
}

function parseSnapshot(value: unknown): SpineTreeSnapshot {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !isRecord((value as { branches?: unknown }).branches) ||
    !isRecord((value as { agents?: unknown }).agents)
  ) {
    throw new SpineTreeGitStoreError("invalid-snapshot", "SpineTree snapshot requires branches and agents maps");
  }
  return value as SpineTreeSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runGit(cwd: string, args: readonly string[], input?: string): string {
  try {
    return execFileSync("git", [...args], {
      cwd,
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new SpineTreeGitStoreError("git-error", formatError(error));
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
