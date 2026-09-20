import { createHash, randomUUID } from "node:crypto";
import type { EpochOrdinalId, NamespacedId, NodeSnapshot, SamplingCommit, SpineProjection } from "@spinejit/spine-sdk";
import { SpineTreeChangeError } from "./index.js";
import type { SpineTreeBranch, SpineTreeSnapshot, SpineTreeSnapshotCommitStore } from "./index.js";

export interface SpineTreeScopeBinding {
  readonly agentId: string;
  readonly sessionId: string;
  readonly thread: string;
  readonly epoch: number;
  readonly nodeId: readonly number[];
}

export interface SpineTreeScopeMemorySource extends SpineTreeScopeBinding {
  readonly schema: "spinetree.scope.memory/v1";
  readonly transactionId: string;
  readonly commitId: NamespacedId;
  readonly postBoundary: EpochOrdinalId;
}

export type SpineTreeScopeSelection =
  | { readonly nodeId: readonly number[]; readonly parent: string; readonly branch?: never }
  | { readonly nodeId: readonly number[]; readonly branch: string; readonly parent?: never };

export interface SpineTreeScopeMapping {
  readonly nodeId: readonly number[];
  readonly branch: string;
}

export interface SpineTreeScopeWatermark {
  readonly epoch: number;
  readonly postBoundary: number;
  readonly commitId: string;
  readonly fingerprint: string;
  readonly selections: readonly SpineTreeScopeMapping[];
}

export interface SpineTreeScopeCommitInput {
  readonly store: SpineTreeSnapshotCommitStore;
  readonly agentId: string;
  readonly sessionId: string;
  readonly transactionId: string;
  /** Public result of an already committed canonical sampling transaction. */
  readonly record: SamplingCommit;
  readonly projection: SpineProjection;
  readonly selections: readonly SpineTreeScopeSelection[];
  readonly maxCasRetries?: number;
}

export interface SpineTreeScopeCommitResult {
  readonly schema: "spinetree.scopes.result/v1";
  readonly head: string;
  readonly replayed: boolean;
  readonly selections: readonly SpineTreeScopeMapping[];
}

export class SpineTreeScopeError extends Error {
  constructor(
    readonly code: "invalid-commit" | "stale-commit" | "conflicting-replay" | "invalid-selection"
      | "unknown-branch" | "binding-conflict" | "unknown-agent" | "unsupported-scope",
    message: string,
  ) {
    super(message);
    this.name = "SpineTreeScopeError";
  }
}

/** Imports selected committed scopes; canonical owns all reduction and execution. */
export async function commitSpineTreeScopes(input: SpineTreeScopeCommitInput): Promise<SpineTreeScopeCommitResult> {
  const { store, maxCasRetries = 8, ...receipt } = input;
  if (!Number.isInteger(maxCasRetries) || maxCasRetries < 1) throw new TypeError("maxCasRetries must be positive");
  // Retain one immutable receipt throughout asynchronous CAS retries.
  const fixed = structuredClone(receipt);
  validateReceipt(fixed);
  // Object key order is not part of the committed receipt's identity.
  const serialized = JSON.stringify(fixed, (_key, value) => value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  const fingerprint = createHash("sha256").update(serialized).digest("hex");
  const key = JSON.stringify([fixed.sessionId, fixed.record.commit_id.thread]);
  for (let attempt = 0; ; attempt += 1) {
    const head = await store.head();
    const snapshot = await store.readSnapshot(head);
    const prior = snapshot.scopeImports?.[key];
    if (prior !== undefined) {
      if (prior.commitId === fixed.record.commit_id.value && prior.epoch === fixed.record.epoch) {
        if (prior.fingerprint !== fingerprint) throw new SpineTreeScopeError("conflicting-replay", "Commit replay differs from the imported receipt or selection");
        return { schema: "spinetree.scopes.result/v1", head, replayed: true, selections: structuredClone(prior.selections) };
      }
      const record = fixed.record;
      if (record.epoch < prior.epoch || (record.epoch === prior.epoch && (
        record.post_boundary.ordinal < prior.postBoundary || record.previous_commit_id?.value !== prior.commitId
      ))) throw new SpineTreeScopeError("stale-commit", "Cannot import an older or divergent canonical commit");
    }
    const draft = structuredClone(snapshot);
    const selections = mapScopes(draft, fixed);
    const next: SpineTreeSnapshot = { ...draft, scopeImports: { ...draft.scopeImports, [key]: {
      epoch: fixed.record.epoch, postBoundary: fixed.record.post_boundary.ordinal,
      commitId: fixed.record.commit_id.value, fingerprint, selections,
    } } };
    try {
      const committed = await store.commitSnapshot(head, next, "spinetree: import committed scopes");
      return { schema: "spinetree.scopes.result/v1", head: committed.head, replayed: false, selections };
    } catch (error) {
      if (!(error instanceof SpineTreeChangeError) || error.code !== "stale-head" || attempt + 1 >= maxCasRetries) throw error;
    }
  }
}

type Receipt = Omit<SpineTreeScopeCommitInput, "store" | "maxCasRetries">;

function validateReceipt(input: Receipt): void {
  const { record, projection } = input;
  const thread = record.commit_id.thread;
  if (!input.agentId || !input.sessionId || !input.transactionId || !thread || !record.commit_id.value ||
    record.schema !== "spine.sampling.commit" || record.pre_boundary.thread !== thread ||
    record.post_boundary.thread !== thread || record.attempt_id.thread !== thread ||
    record.pre_boundary.epoch !== record.epoch || record.post_boundary.epoch !== record.epoch ||
    projection.last_boundary !== record.post_boundary.ordinal) {
    throw new SpineTreeScopeError("invalid-commit", "Expected a matching committed sampling record and projection");
  }
}

function mapScopes(snapshot: SpineTreeSnapshot, input: Receipt): SpineTreeScopeMapping[] {
  const { agentId, sessionId, record, projection } = input;
  const thread = record.commit_id.thread;
  const agent = snapshot.registry?.[agentId];
  if (agent === undefined || agent.sessionId !== sessionId || agent.status === "ended") {
    throw new SpineTreeScopeError("unknown-agent", "Scope import requires an active registered Agent for this Pi session");
  }
  const branches = snapshot.branches as Record<string, SpineTreeBranch>;
  const nodes = new Map(projection.nodes.map(node => [JSON.stringify(node.id), node]));
  const seen = new Set<string>();
  const selectedBranches = new Set<string>();
  const selections: SpineTreeScopeMapping[] = [];
  for (const selection of input.selections) {
    const nodeKey = JSON.stringify(selection.nodeId);
    const node = nodes.get(nodeKey);
    if (seen.has(nodeKey) || node?.kind !== "Task" || (selection.branch === undefined) === (selection.parent === undefined)) {
      throw new SpineTreeScopeError("invalid-selection", "Select each Task scope once, with either a parent or an existing branch");
    }
    seen.add(nodeKey);
    const mapped = Object.values(branches).find(branch => matchesScope(branch.scopeBinding, sessionId, thread, record.epoch, node.id));
    let branch: SpineTreeBranch;
    if (mapped !== undefined) {
      if (mapped.status === "archived" || (selection.branch !== undefined && selection.branch !== mapped.id) ||
        (selection.parent !== undefined && selection.parent !== mapped.parent) || mapped.scopeBinding?.agentId !== agentId) {
        throw new SpineTreeScopeError("binding-conflict", "Scope mapping is archived or belongs to a different ProjectBranch or Agent");
      }
      branch = mapped;
    } else if (selection.branch !== undefined) {
      const existing = branches[selection.branch];
      if (existing === undefined) throw new SpineTreeScopeError("unknown-branch", `Unknown ProjectBranch ${selection.branch}`);
      if (existing.status === "archived" || (existing.status === "live" && existing.scopeBinding !== undefined)) {
        throw new SpineTreeScopeError("binding-conflict", "Cannot replace a live mapping or bind an archived branch");
      }
      if (Object.values(snapshot.registry ?? {}).some(candidate => candidate.branch === existing.id && candidate.status !== "ended" &&
        candidate.agentId !== agentId)) {
        throw new SpineTreeScopeError("binding-conflict", "ProjectBranch belongs to another active Agent");
      }
      branch = existing;
    } else {
      const parent = branches[selection.parent!];
      if (parent === undefined) throw new SpineTreeScopeError("unknown-branch", `Unknown parent ${selection.parent}`);
      if (parent.status === "archived") throw new SpineTreeScopeError("invalid-selection", "Cannot create under an archived branch");
      branch = {
        id: randomUUID(), parent: parent.id, goal: node.summary ?? "", constraints: [], skills: [], tools: [],
        memory: null, memoryVersion: 0, memorySource: null, status: "live",
      };
    }
    if (selectedBranches.has(branch.id)) throw new SpineTreeScopeError("binding-conflict", "Two scopes cannot bind the same ProjectBranch");
    selectedBranches.add(branch.id);
    const scopeBinding: SpineTreeScopeBinding = { agentId, sessionId, thread, epoch: record.epoch, nodeId: [...node.id] };
    const sameMapping = matchesScope(branch.scopeBinding, sessionId, thread, record.epoch, node.id);
    branches[branch.id] = sameMapping ? branch : { ...branch, scopeBinding, status: "live" };
    selections.push({ nodeId: [...node.id], branch: branch.id });
  }
  for (const branch of Object.values(branches)) {
    const bound = branch.scopeBinding;
    if (bound === undefined || bound.sessionId !== sessionId || bound.thread !== thread || branch.status !== "live") continue;
    const node = nodes.get(JSON.stringify(bound.nodeId));
    if (bound.epoch !== record.epoch || node?.kind !== "Task") {
      throw new SpineTreeScopeError("unsupported-scope", "A live mapped scope disappeared; epoch/fork migration requires an explicit adapter");
    }
    if (bound.agentId !== agentId) throw new SpineTreeScopeError("binding-conflict", "A live scope belongs to a different Agent");
    branches[branch.id] = importNode(branch, node, input);
  }
  return selections;
}

function matchesScope(bound: SpineTreeScopeBinding | undefined, sessionId: string, thread: string, epoch: number, nodeId: readonly number[]): boolean {
  return bound !== undefined && bound.sessionId === sessionId && bound.thread === thread && bound.epoch === epoch &&
    JSON.stringify(bound.nodeId) === JSON.stringify(nodeId);
}

function importNode(branch: SpineTreeBranch, node: NodeSnapshot, input: Receipt): SpineTreeBranch {
  if (node.status === "Live" || node.status === "Opened") return branch;
  if (node.memory === null) throw new SpineTreeScopeError("unsupported-scope", "Terminal scope has no canonical memory");
  const source: SpineTreeScopeMemorySource = {
    ...branch.scopeBinding!, schema: "spinetree.scope.memory/v1", transactionId: input.transactionId,
    commitId: structuredClone(input.record.commit_id), postBoundary: structuredClone(input.record.post_boundary),
  };
  return {
    ...branch, status: "capped", memory: structuredClone(node.memory), memoryVersion: branch.memoryVersion + 1, memorySource: source,
  };
}
