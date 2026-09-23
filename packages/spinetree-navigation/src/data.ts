import type { NodeSnapshot } from "@spinejit/spine-sdk";
import type { SpineTreeSnapshot } from "@spinejit/spine-plugin/pi/tree-view";
import type { SpineTreeSpawnOutcome } from "@spinejit/spine-plugin/pi/tree-style";

export interface NavigationNode {
  id: string;
  parent: string | null;
  children: string[];
  summary: string;
  status: NodeSnapshot["status"];
  kind: NodeSnapshot["kind"];
  spawnOutcome: SpineTreeSpawnOutcome | null;
}
export interface NavigationData {
  nodes: readonly NavigationNode[];
  cursor: string;
  memorySections(nodeId: string, full?: boolean): readonly string[];
  memoryText(nodeId: string, full?: boolean): string;
}

const id = (parts: readonly number[]): string => parts.join(".");

/** Read-only node and memory view of one published Spine snapshot. */
export function createNavigationData(snapshot: SpineTreeSnapshot): NavigationData {
  const rawNodes = new Map(snapshot.nodes.map(node => [id(node.id), node]));
  const nodes = snapshot.nodes.map(node => ({
    id: id(node.id), parent: node.parent === null ? null : id(node.parent),
    children: node.children.map(id), summary: node.summary ?? (node.kind === "RootEpoch" ? "Session epoch" : "Task"),
    status: node.status, kind: node.kind,
    spawnOutcome: spawnOutcome(node),
  }));
  return {
    nodes, cursor: id(snapshot.cursor),
    memorySections(nodeId, full = false) {
      const node = rawNodes.get(nodeId);
      if (node === undefined) return ["Node is unavailable in this snapshot."];
      const slots = node.memory ?? [];
      if (full) return slots.length === 0 ? [noMemory(node)] : slots.map(slot => {
        if ("Summary" in slot) {
          const s = slot.Summary;
          return `### Memory · ${id(s.owner_node)} · source ${s.source.start}–${s.source.end}\n\n${s.body}`;
        }
        if ("User" in slot) {
          const u = slot.User;
          return `### User evidence · ${id(u.owner_node)} · anchor ${u.anchor}\n\nRole: ${u.message.role}; boundary: ${u.message.boundary}\n\n${u.message.content}`;
        }
        return spawnText(slot.SpawnEvidence);
      });
      const own = slots.flatMap(slot => "Summary" in slot && id(slot.Summary.owner_node) === nodeId ? [slot.Summary.body] : []);
      const evidence = slots.flatMap(slot => "SpawnEvidence" in slot && id(slot.SpawnEvidence.owner_node) === nodeId ? [spawnText(slot.SpawnEvidence)] : []);
      // Keep each owned summary as its own section so the browser can render
      // only the section currently in view, even when a node has multiple summaries.
      return [...evidence, ...(own.length === 0 ? [noMemory(node)] : own)];
    },
    memoryText(nodeId, full = false) {
      return this.memorySections(nodeId, full).join("\n\n---\n\n");
    },
  };
}

function noMemory(node: NodeSnapshot): string {
  return `No final memory for this node (${node.status}).`;
}
function spawnText(s: { owner_node: number[]; task: { summary: string; prompt: string }; outcome: string; diagnostic: string | null; execution_ref: string | null; source: { start: number; end: number } }): string {
  return `### Spawn · ${id(s.owner_node)} · ${s.outcome}\n\n${s.task.summary}\n\n${s.task.prompt}\n\nSource: ${s.source.start}–${s.source.end}${s.diagnostic === null ? "" : `\n\nDiagnostic: ${s.diagnostic}`}${s.execution_ref === null ? "" : `\n\nExecution: ${s.execution_ref}`}`;
}

function spawnOutcome(node: NodeSnapshot): SpineTreeSpawnOutcome | null {
  const owner = id(node.id);
  for (const slot of node.memory ?? []) {
    if ("SpawnEvidence" in slot && id(slot.SpawnEvidence.owner_node) === owner) return slot.SpawnEvidence.outcome;
  }
  return null;
}
