import { createHash, randomUUID } from "node:crypto";
import type { EpochOrdinalId, NamespacedId, NodeSnapshot, SamplingCommit, SpineProjection } from "@spinejit/spine-sdk";
import { SpineTreeChangeError } from "./index.js";
import type { SpineTreeBranch, SpineTreeSnapshot, SpineTreeSnapshotCommitStore, SpineTreeWorkingBinding } from "./index.js";

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

type SpineTreeAlignedSelection =
  | SpineTreeScopeSelection
  | { readonly nodeId: readonly number[]; readonly parentNodeId: readonly number[] };

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

export interface SpineTreeScopeWorkingBinding {
  readonly bindingId: string;
  readonly leaseId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly branch: string;
  readonly epoch: number;
  readonly scopeCursor: readonly number[];
}

export interface SpineTreeScopeCommitInput {
  readonly store: SpineTreeSnapshotCommitStore;
  readonly agentId: string;
  readonly sessionId: string;
  readonly binding?: SpineTreeScopeWorkingBinding;
  readonly transactionId: string;
  /** Public result of an already committed canonical sampling transaction. */
  readonly record: SamplingCommit;
  readonly projection: SpineProjection;
  /** Explicit mapping policy; omitted when `selections` is supplied. */
  readonly alignment?: "one-to-one";
  readonly selections?: readonly SpineTreeScopeSelection[];
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
  const key = JSON.stringify([fixed.sessionId, fixed.record.commit_id.thread]);
  for (let attempt = 0; ; attempt += 1) {
    const head = await store.head();
    const snapshot = await store.readSnapshot(head);
    const prior = snapshot.scopeImports?.[key];
    // Alignment fingerprints only the canonical receipt and policy. Generated
    // ProjectBranch UUIDs are persisted output, not replay input.
    const fingerprint = fingerprintReceipt(fixed);
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
    validateSnapshotBinding(snapshot, fixed);
    const selections: readonly SpineTreeAlignedSelection[] = fixed.selections === undefined
      ? deriveAlignedSelections(snapshot, fixed)
      : fixed.selections;
    const draft = structuredClone(snapshot);
    const mapped = mapScopes(draft, { ...fixed, selections } as MappingReceipt);
    const next: SpineTreeSnapshot = { ...draft, scopeImports: { ...draft.scopeImports, [key]: {
      epoch: fixed.record.epoch, postBoundary: fixed.record.post_boundary.ordinal,
      commitId: fixed.record.commit_id.value, fingerprint, selections: mapped,
    } } };
    try {
      const committed = await store.commitSnapshot(head, next, "spinetree: import committed scopes");
      return { schema: "spinetree.scopes.result/v1", head: committed.head, replayed: false, selections: mapped };
    } catch (error) {
      if (!(error instanceof SpineTreeChangeError) || error.code !== "stale-head" || attempt + 1 >= maxCasRetries) throw error;
    }
  }
}

type Receipt = Omit<SpineTreeScopeCommitInput, "store" | "maxCasRetries">;
type MappingReceipt = Omit<Receipt, "selections"> & { selections: readonly SpineTreeAlignedSelection[] };

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
  if (input.binding !== undefined && (
    input.binding.agentId !== input.agentId || input.binding.sessionId !== input.sessionId ||
    input.binding.epoch !== record.epoch ||
    JSON.stringify(input.binding.scopeCursor) !== JSON.stringify(projection.cursor)
  )) {
    throw new SpineTreeScopeError("binding-conflict", "WorkingBinding does not match the committed Scope projection");
  }
  if (input.alignment !== undefined && input.alignment !== "one-to-one") {
    throw new SpineTreeScopeError("invalid-selection", "Unknown Scope alignment policy");
  }
  if (input.selections === undefined && input.alignment !== "one-to-one") {
    throw new SpineTreeScopeError("invalid-selection", "Provide explicit selections or one-to-one alignment");
  }
}

function validateSnapshotBinding(snapshot: SpineTreeSnapshot, input: Receipt): void {
  const binding = input.binding;
  if (binding === undefined) return;
  const current = snapshot.registry?.[binding.agentId] as SpineTreeWorkingBinding | undefined;
  const branch = snapshot.branches[binding.branch];
  if (current === undefined || current.status !== "running" ||
      current.sessionId !== binding.sessionId || current.branch !== binding.branch ||
      !("bindingId" in current) || current.bindingId !== binding.bindingId ||
      !("leaseId" in current) || current.leaseId !== binding.leaseId ||
      !("epoch" in current) || current.epoch !== binding.epoch ||
      !Array.isArray(current.scopeCursor) || JSON.stringify(current.scopeCursor) !== JSON.stringify(binding.scopeCursor)) {
    throw new SpineTreeScopeError("binding-conflict", "ProjectTree snapshot does not hold the active WorkingBinding");
  }
  if (branch === undefined || branch.status !== "live") {
    throw new SpineTreeScopeError("binding-conflict", "WorkingBinding must point to a live ProjectBranch");
  }
}

function fingerprintReceipt(input: Receipt): string {
  const identity = input.alignment === "one-to-one" ? { ...input, selections: undefined } : input;
  const serialized = JSON.stringify(identity, (_key, value) => value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return createHash("sha256").update(serialized).digest("hex");
}

function deriveAlignedSelections(snapshot: SpineTreeSnapshot, input: Receipt): SpineTreeAlignedSelection[] {
  const { agentId, sessionId, record, projection } = input;
  const thread = record.commit_id.thread;
  const agent = snapshot.registry?.[agentId];
  if (agent === undefined || agent.sessionId !== sessionId || agent.status === "ended") {
    throw new SpineTreeScopeError("unknown-agent", "Scope import requires an active registered Agent for this Pi session");
  }
  const nodes = new Map(projection.nodes.map(node => [JSON.stringify(node.id), node]));
  const branches = snapshot.branches as Record<string, SpineTreeBranch>;
  const ordered = projection.nodes.filter(node => node.kind === "Task").sort((left, right) => {
    const depth = (node: NodeSnapshot) => {
      let value = 0;
      let current = node;
      const seen = new Set<string>();
      while (current.parent !== null) {
        const key = JSON.stringify(current.parent);
        if (seen.has(key)) break;
        seen.add(key);
        const parent = nodes.get(key);
        if (parent === undefined) break;
        value += 1;
        current = parent;
      }
      return value;
    };
    return depth(left) - depth(right) || JSON.stringify(left.id).localeCompare(JSON.stringify(right.id));
  });
  const branchByNode = new Map<string, string>();
  const assigned = new Set<string>();
  const selections: SpineTreeAlignedSelection[] = [];
  for (const node of ordered) {
    const nodeKey = JSON.stringify(node.id);
    const mapped = Object.values(branches).find(branch => matchesScope(branch.scopeBinding, sessionId, thread, record.epoch, node.id));
    if (mapped !== undefined) {
      branchByNode.set(nodeKey, mapped.id);
      assigned.add(mapped.id);
      selections.push({ nodeId: [...node.id], branch: mapped.id });
      continue;
    }
    const parent = node.parent === null ? undefined : nodes.get(JSON.stringify(node.parent));
    const parentBranch = parent?.kind === "Task" ? branchByNode.get(JSON.stringify(parent.id)) : undefined;
    const projectParent = parentBranch ?? agent.branch;
    const home = branches[projectParent];
    if (home === undefined) throw new SpineTreeScopeError("unknown-branch", `Unknown ProjectBranch ${projectParent}`);
    const homeBinding = home.scopeBinding;
    const canReuseHome = parentBranch === undefined && !assigned.has(home.id) && home.status !== "archived" &&
      (homeBinding === undefined || (home.status === "capped" &&
        (homeBinding.sessionId !== sessionId || homeBinding.thread !== thread || homeBinding.epoch !== record.epoch)));
    if (canReuseHome) {
      branchByNode.set(nodeKey, home.id);
      assigned.add(home.id);
      selections.push({ nodeId: [...node.id], branch: home.id });
    } else if (parent?.kind === "Task") {
      selections.push({ nodeId: [...node.id], parentNodeId: [...parent.id] });
    } else {
      selections.push({ nodeId: [...node.id], parent: projectParent });
    }
  }
  return selections;
}

function mapScopes(snapshot: SpineTreeSnapshot, input: MappingReceipt): SpineTreeScopeMapping[] {
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
  const branchByNode = new Map<string, string>();
  for (const selection of input.selections) {
    const nodeKey = JSON.stringify(selection.nodeId);
    const node = nodes.get(nodeKey);
    const parentNodeId = "parentNodeId" in selection ? selection.parentNodeId : undefined;
    const branchSelection = "branch" in selection ? selection.branch : undefined;
    const parentSelection = "parent" in selection ? selection.parent : undefined;
    const hasBranch = branchSelection !== undefined;
    const hasParent = parentSelection !== undefined || parentNodeId !== undefined;
    if (seen.has(nodeKey) || node?.kind !== "Task" || hasBranch === hasParent) {
      throw new SpineTreeScopeError("invalid-selection", "Select each Task scope once, with either a parent or an existing branch");
    }
    seen.add(nodeKey);
    const mapped = Object.values(branches).find(branch => matchesScope(branch.scopeBinding, sessionId, thread, record.epoch, node.id));
    let branch: SpineTreeBranch;
    if (mapped !== undefined) {
      if (mapped.status === "archived" || (branchSelection !== undefined && branchSelection !== mapped.id) ||
        (parentSelection !== undefined && parentSelection !== mapped.parent) || mapped.scopeBinding?.agentId !== agentId) {
        throw new SpineTreeScopeError("binding-conflict", "Scope mapping is archived or belongs to a different ProjectBranch or Agent");
      }
      if (input.binding !== undefined && mapped.id === agent.branch && agent.status === "running" && isTerminalNode(node)) {
        // The Agent's home branch is its live execution lease. A terminal
        // Scope cannot cap that branch; materialize the Scope as a child and
        // keep the home branch available for the next Agent turn.
        const { scopeBinding: _scopeBinding, ...home } = mapped;
        branches[mapped.id] = home;
        branch = {
          ...home,
          id: randomUUID(),
          parent: mapped.id,
          goal: node.summary ?? home.goal,
          status: "live",
        };
      } else {
        branch = mapped;
      }
    } else if (branchSelection !== undefined) {
      const existing = branches[branchSelection];
      if (existing === undefined) throw new SpineTreeScopeError("unknown-branch", `Unknown ProjectBranch ${branchSelection}`);
      if (existing.status === "archived" || (existing.status === "live" && existing.scopeBinding !== undefined)) {
        throw new SpineTreeScopeError("binding-conflict", "Cannot replace a live mapping or bind an archived branch");
      }
      if (Object.values(snapshot.registry ?? {}).some(candidate => candidate.branch === existing.id && candidate.status !== "ended" &&
        candidate.agentId !== agentId)) {
        throw new SpineTreeScopeError("binding-conflict", "ProjectBranch belongs to another active Agent");
      }
      branch = existing;
    } else {
      const parentId = parentSelection ?? (parentNodeId === undefined ? undefined : branchByNode.get(JSON.stringify(parentNodeId)));
      if (parentId === undefined) throw new SpineTreeScopeError("invalid-selection", "A canonical parent scope must be mapped before its child");
      const parent = branches[parentId];
      if (parent === undefined) throw new SpineTreeScopeError("unknown-branch", `Unknown parent ${parentId}`);
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
    branchByNode.set(nodeKey, branch.id);
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
    if (input.binding !== undefined && branch.id === agent.branch && agent.status === "running" && isTerminalNode(node)) {
      // A close of the current home Scope must not end the Agent's working
      // ProjectBranch. Move the terminal memory to a child branch instead.
      const { scopeBinding: _scopeBinding, ...home } = branch;
      branches[branch.id] = home;
      const child = {
        ...home,
        id: randomUUID(),
        parent: branch.id,
        goal: node.summary ?? home.goal,
        scopeBinding: structuredClone(bound),
        status: "live",
      };
      branches[child.id] = importNode(child, node, input);
      selections.push({ nodeId: [...bound.nodeId], branch: child.id });
      continue;
    }
    branches[branch.id] = importNode(branch, node, input);
  }
  return selections;
}

function isTerminalNode(node: NodeSnapshot): boolean {
  return node.status !== "Live" && node.status !== "Opened";
}

function matchesScope(bound: SpineTreeScopeBinding | undefined, sessionId: string, thread: string, epoch: number, nodeId: readonly number[]): boolean {
  return bound !== undefined && bound.sessionId === sessionId && bound.thread === thread && bound.epoch === epoch &&
    JSON.stringify(bound.nodeId) === JSON.stringify(nodeId);
}

function importNode(branch: SpineTreeBranch, node: NodeSnapshot, input: MappingReceipt): SpineTreeBranch {
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
