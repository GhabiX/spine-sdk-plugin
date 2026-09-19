import type { PluginManifest, PluginTool, SpinePlugin, SpinePluginContext } from "@spinejit/spine-host";

export const SPINETREE_READ_RESULT_SCHEMA = "spinetree.read.result/v1" as const;
export const SPINETREE_CHANGE_RESULT_SCHEMA = "spinetree.change.result/v1" as const;

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
