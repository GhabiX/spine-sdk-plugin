import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";

export const CHILD_RETURN_TOOL = "spine_child_return";

export interface ChildAssignmentTask {
  summary: string;
  prompt: string;
}

/** FormularDef 2.5 Δ_child: identity, peers, inherited-scope rules, and typed return. */
export function buildChildAssignment(
  task: ChildAssignmentTask,
  peers: readonly ChildAssignmentTask[],
): string {
  const identity = task.summary.trim();
  const peerLines = peers
    .map((peer) => peer.summary.trim())
    .filter((summary) => summary !== identity)
    .map((summary) => `- ${summary}`);
  const peersBlock = peerLines.length === 0 ? "- (none)" : peerLines.join("\n");
  return `You are a spawned execution branch. Your role is to complete exactly the assignment below and return bounded terminal memory to the spawning continuation.

You are: ${identity}

Peer branches in this spawn:
${peersBlock}

The assignment is already an active branch scope. Begin the assigned work directly. Use spine_open, spine_close, and spine_next only to manage genuine descendant work within this assignment. Use spine_spawn only when this assignment itself has two or more independent parallel sub-assignments.

Executable work is defined by the assignment. Inherited context supplies constraints and evidence for that work.

When the assignment declares a collaboration contract, follow its named root, peer roles, artifact format, update/read protocol, synchronization points, and bounded fallback. Inspect the coordination root before substantive work. Coordinate through it to minimize unnecessary duplicate work: respect assigned scopes, share reusable evidence early, and independently verify load-bearing or disputed claims. Within the coordination root, write only your declared single-writer artifact and read peer artifacts through the declared protocol, even when the investigated source and evidence are otherwise read-only. Unless the contract provides locking or atomic append, preserve your artifact append-only. Publish findings, conflicts, or requests useful to peers at the declared synchronization points. Before returning your final memory, perform the declared final peer read and state which peer deltas you incorporated. Never write a peer artifact, let collaboration expand the assignment, make completion depend on peer state, or treat collaboration artifacts as correctness-critical evidence. If the root or peer state is unavailable or incomplete, use the declared bounded fallback; do not invent another coordination path.

Other shared-workspace changes remain context for the assignment and do not add executable work. Production-file ownership and any integration responsibility remain exactly as declared in the assignment.

Complete this branch by calling ${CHILD_RETURN_TOOL} exactly once with the complete continuation memory. After that call, execution ends.

Assignment:
${task.prompt}`;
}

export function childSessionPath(options: {
  batchId: string;
  ordinal: number;
  parentSessionFile?: string;
}): string {
  const root = options.parentSessionFile === undefined
    ? join(tmpdir(), "pi-spine-spawn")
    : join(dirname(options.parentSessionFile), "spine-spawn");
  return join(root, safeSegment(options.batchId), `${options.ordinal}.jsonl`);
}

export async function writeChildPrefixSession(options: {
  cwd: string;
  destPath: string;
  entries: readonly unknown[];
  parentSession?: string;
}): Promise<string> {
  await mkdir(dirname(options.destPath), { recursive: true });
  const id = randomUUID();
  const header: Record<string, unknown> = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id,
    timestamp: new Date().toISOString(),
    cwd: options.cwd,
  };
  if (options.parentSession !== undefined) {
    header.parentSession = options.parentSession;
  }
  const lines = [JSON.stringify(header)];
  for (const entry of options.entries) {
    lines.push(JSON.stringify(entry));
  }
  await writeFile(options.destPath, `${lines.join("\n")}\n`);
  return id;
}

function safeSegment(value: string): string {
  const trimmed = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "");
  return (trimmed.length === 0 ? "call" : trimmed).slice(0, 64);
}
