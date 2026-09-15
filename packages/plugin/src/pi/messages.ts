import type {
  ContextItem,
  ContextPlanCell,
  EpochOrdinalId,
  SourceCharacter,
} from "@spinejit/spine-sdk";
import type { PublishedContext } from "../controller.js";

interface PiTextContent {
  type: "text";
  text: string;
}

interface PiImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

interface PiToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface PiThinkingContent {
  type: "thinking";
  thinking: string;
}

export type PiAgentMessage =
  | {
      role: "user";
      content: string | Array<PiTextContent | PiImageContent>;
      timestamp: number;
    }
  | {
      role: "assistant";
      content: Array<PiTextContent | PiThinkingContent | PiToolCall>;
      [key: string]: unknown;
    }
  | {
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: Array<PiTextContent | PiImageContent>;
      isError: boolean;
      timestamp: number;
      [key: string]: unknown;
    }
  | {
      role: "custom";
      customType: string;
      content: string | Array<PiTextContent | PiImageContent>;
      display: boolean;
      timestamp: number;
      details?: unknown;
    }
  | {
      role: "bashExecution";
      command: string;
      output: string;
      exitCode: number | undefined;
      cancelled: boolean;
      truncated: boolean;
      timestamp: number;
      excludeFromContext?: boolean;
      fullOutputPath?: string;
    }
  | { role: "branchSummary"; summary: string; fromId: string; timestamp: number }
  | { role: "compactionSummary"; summary: string; tokensBefore: number; timestamp: number };

interface TextPart {
  type: "text";
  text: string;
}

export interface PiSourceObservation {
  character: SourceCharacter;
  message: PiAgentMessage;
}

export class PiContextMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiContextMaterializationError";
  }
}

export function sourceObservation(
  message: PiAgentMessage,
  boundary: number,
): PiSourceObservation {
  if (message.role === "toolResult") {
    return { character: { type: "opaque", boundary }, message };
  }
  const role = sourceRole(message);
  return {
    character: {
      type: "message",
      boundary,
      role,
      content: stableJson(message),
    },
    message,
  };
}

export class PiSourceBindings {
  readonly #messages = new Map<string, PiAgentMessage>();

  bind(sourceId: EpochOrdinalId, message: PiAgentMessage): void {
    const key = sourceIdKey(sourceId);
    if (this.#messages.has(key)) {
      throw new PiContextMaterializationError(`duplicate Pi source binding ${key}`);
    }
    this.#messages.set(key, structuredClone(message));
  }

  resolve(sourceId: EpochOrdinalId): PiAgentMessage {
    const message = this.#messages.get(sourceIdKey(sourceId));
    if (message === undefined) {
      throw new PiContextMaterializationError(
        `missing Pi message for source ${sourceIdKey(sourceId)}`,
      );
    }
    return structuredClone(message);
  }

  clear(): void {
    this.#messages.clear();
  }
}

export function materializePiContext(
  context: PublishedContext,
  bindings: PiSourceBindings,
): PiAgentMessage[] {
  const plan = context.contextPlan;
  if (plan === null) {
    return [];
  }

  const messages: PiAgentMessage[] = [];
  for (const cell of plan.cells) {
    if (cell.type === "source") {
      let message = bindings.resolve(cell.source_id);
      for (const label of cell.labels) {
        message = prependUserAnchor(message, label.UserAnchor);
      }
      messages.push(message);
      continue;
    }
    messages.push(materializeProjection(cell));
  }
  return messages;
}

function materializeProjection(
  cell: Extract<ContextPlanCell, { type: "projection" }>,
): PiAgentMessage {
  const item = cell.item;
  if ("SyntheticNode" in item) {
    const { node_id: nodeId, summary, status } = item.SyntheticNode;
    return userMessage(
      `<spine_node id="${nodeId.join(".")}" summary="${escapeXmlAttribute(summary)}" status="${status.toLowerCase()}">\n</spine_node>`,
    );
  }
  if ("MemorySlot" in item) {
    const slot = item.MemorySlot;
    if ("Summary" in slot) {
      return userMessage(
        `<spine_memory node_id="${slot.Summary.owner_node.join(".")}">\n${slot.Summary.body}\n</spine_memory>`,
      );
    }
    if ("SpawnEvidence" in slot) {
      const evidence = slot.SpawnEvidence;
      return userMessage(
        `<spine_spawn_evidence node_id="${evidence.owner_node.join(".")}">\n${JSON.stringify(
          {
            summary: evidence.task.summary,
            prompt: evidence.task.prompt,
            outcome: evidence.outcome,
            diagnostic: evidence.diagnostic,
            execution_ref: evidence.execution_ref,
          },
          null,
          2,
        )}\n</spine_spawn_evidence>`,
      );
    }
  }
  throw unsupportedProjection(item);
}

function unsupportedProjection(item: ContextItem): PiContextMaterializationError {
  return new PiContextMaterializationError(
    `Pi cannot materialize Spine projection item ${Object.keys(item)[0] ?? "unknown"}`,
  );
}

function prependUserAnchor(message: PiAgentMessage, anchor: number): PiAgentMessage {
  const copy = structuredClone(message);
  if (sourceRole(copy) !== "user") {
    throw new PiContextMaterializationError(`Spine user anchor U${anchor} targets a non-user message`);
  }

  if (copy.role === "user" || copy.role === "custom") {
    if (typeof copy.content === "string") {
      copy.content = `[U${anchor}]\n${copy.content}`;
      return copy;
    }
    const firstText = copy.content.find((part): part is TextPart => part.type === "text");
    if (firstText !== undefined) {
      firstText.text = `[U${anchor}]\n${firstText.text}`;
    } else {
      copy.content.unshift({ type: "text", text: `[U${anchor}]\n` });
    }
    return copy;
  }

  if (copy.role === "bashExecution") {
    throw new PiContextMaterializationError(
      `Spine user anchor U${anchor} cannot preserve Pi bashExecution identity`,
    );
  }
  if (copy.role === "branchSummary" || copy.role === "compactionSummary") {
    throw new PiContextMaterializationError(
      `Spine user anchor U${anchor} cannot target Pi native summary messages`,
    );
  }
  throw new PiContextMaterializationError(`unknown Pi user message for anchor U${anchor}`);
}

function sourceRole(message: PiAgentMessage): "user" | "contextual_user" | "assistant" {
  switch (message.role) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "custom":
    case "bashExecution":
    case "branchSummary":
    case "compactionSummary":
      return "contextual_user";
    case "toolResult":
      throw new PiContextMaterializationError("Pi tool result must be recorded as opaque source");
    default:
      return assertNever(message);
  }
}

function assertNever(value: never): never {
  throw new PiContextMaterializationError(
    `unsupported Pi AgentMessage role ${String((value as { role?: unknown }).role)}`,
  );
}

function userMessage(content: string): PiAgentMessage {
  return { role: "user", content, timestamp: 0 };
}

function sourceIdKey(id: EpochOrdinalId): string {
  return `${id.thread}\u0000${id.epoch}\u0000${id.ordinal}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
