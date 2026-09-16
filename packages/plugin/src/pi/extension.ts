import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  convertToLlm,
  serializeConversation,
  sessionEntryToContextMessages,
  type CompactionResult,
  type ContextEvent,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  type SessionBeforeCompactEvent,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
  createNodeSpineRuntime,
  type NodeSpineRuntime,
} from "@spinejit/spine-sdk/node";
import type { FinishSamplingResult } from "../controller.js";
import { Type } from "typebox";

import type { HostContextEnvelope } from "../host-adapter.js";
import { executeSpawnBatch, type SpawnChildTerminal } from "../spawn.js";
import { createPiSpineAdapter, createPiSpawnStagingStore } from "./index.js";
import {
  buildCompactBarrier,
  decodeSpawnTasks,
  PiSamplingLifecycle,
  PI_SPINE_TOOL_NAMES,
} from "./lifecycle.js";
import { materializePiContext, type PiAgentMessage } from "./messages.js";
import { rewriteSpineToolNamesForPi } from "./prompt.js";
import { resolvePiInvocation } from "./invocation.js";
import {
  displayTreeSignature,
  formatPrettySpineTree,
  formatThemedPrettySpineTree,
  linesComponent,
  prettySpineTreeHasTasks,
} from "./pretty-tree.js";
import { buildPiReplayPlan, recoverPiSession } from "./recovery.js";
import {
  applySpawnTerminal,
  createSpawnBatchView,
  markSpawnTask,
  renderSpawnCall,
  renderSpawnResult,
  spawnModelText,
  type SpawnBatchDetails,
} from "./spawn-view.js";

const CHILD_FLAG = "spine-child";
const CHILD_RETURN_TOOL = "spine_child_return";
const SPINE_TREE_WIDGET = "spine-tree";
const EXTENSION_MODULE_PATH = fileURLToPath(import.meta.url);

export interface PiExtensionRuntimeFactory {
  create(thread: string): NodeSpineRuntime;
}

export interface CreatePiExtensionOptions {
  runtimeFactory?: PiExtensionRuntimeFactory;
  onSessionReady?: (info: { sessionId: string; thread: string; runtime: NodeSpineRuntime; entries: readonly SessionEntry[] }) => Promise<void> | void;
  onSamplingCommit?: (info: { sessionId: string; commit: FinishSamplingResult; entries: readonly SessionEntry[] }) => Promise<void> | void;
}

interface ActivePiSession {
  lifecycle: PiSamplingLifecycle;
  runtime: NodeSpineRuntime;
  latestContext: HostContextEnvelope<PiAgentMessage>;
}

interface MutableSessionSlot {
  current: ActivePiSession | null;
  initialization: Promise<ActivePiSession> | null;
  generation: number;
  fault: unknown;
  notified: boolean;
  compactionHandled: boolean;
  compactionAbortCleanup: (() => void) | null;
  treeSignature: string | null;
}

/** Creates a real Pi 0.84 extension factory backed by the packaged Node/WASM SDK. */
export function createPiExtension(options: CreatePiExtensionOptions = {}): ExtensionFactory {
  const runtimeFactory = options.runtimeFactory ?? {
    create: (thread: string) => createNodeSpineRuntime({ thread, features: ["jit", "spawn"] }),
  };

  return (pi) => {
    pi.registerFlag(CHILD_FLAG, {
      description: "Run as a typed Spine Spawn child",
      type: "boolean",
      default: false,
    });
    const slot: MutableSessionSlot = {
      current: null,
      initialization: null,
      generation: 0,
      fault: null,
      notified: false,
      compactionHandled: false,
      compactionAbortCleanup: null,
      treeSignature: null,
    };
    registerSpineTools(pi, slot);
    registerSpineCommands(pi, slot);
    registerLifecycleHandlers(pi, slot, runtimeFactory, options.onSessionReady, options.onSamplingCommit);
  };
}

export default createPiExtension();

function registerSpineTools(pi: ExtensionAPI, slot: MutableSessionSlot): void {
  for (const tool of loadCanonicalSpineTools()) {
    if (tool.name === "spine_spawn") {
      pi.registerTool({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          const session = await requireSession(slot);
          const tasks = decodeSpawnTasks(params as unknown as Record<string, unknown>);
          const view = createSpawnBatchView(tasks);
          const publish = () => {
            onUpdate?.(spawnToolUpdate(view));
          };
          publish();
          const staging = createPiSpawnStagingStore({
            async claimOwnership() {},
            async appendCustomEntry(type, entry) {
              pi.appendEntry(type, entry);
            },
            async materializeContext() {
              return [];
            },
            async replaceContext() {},
          });
          const results = await executeSpawnBatch({
            batchId: toolCallId,
            tasks,
            ...(signal === undefined ? {} : { signal }),
            staging,
            executor: {
              async execute(task, child) {
                try {
                  const terminal = await executePiChild(pi, ctx, task.prompt, child);
                  applySpawnTerminal(view, child.ordinal, {
                    ordinal: child.ordinal,
                    outcome: terminal.outcome,
                    memory_body: terminal.memoryBody,
                    ...(terminal.diagnostic === undefined ? {} : { diagnostic: terminal.diagnostic }),
                    ...(terminal.executionRef === undefined ? {} : { execution_ref: terminal.executionRef }),
                  });
                  publish();
                  return terminal;
                } catch (cause) {
                  markSpawnTask(
                    view,
                    child.ordinal,
                    child.signal.aborted ? "aborted" : "errored",
                    spawnFailureDiagnostic(cause),
                  );
                  publish();
                  throw cause;
                }
              },
            },
          });
          await session.lifecycle.stageSpawn(toolCallId, tasks, results);
          for (const result of results) applySpawnTerminal(view, result.ordinal, result);
          return {
            content: [{ type: "text", text: spawnModelText(view) }],
            details: { ...snapshotSpawnView(view), batchId: toolCallId, results },
          };
        },
        renderCall(args, theme) {
          const record = isRecord(args) ? args : {};
          const tasks = Array.isArray(record.tasks) ? record.tasks : [];
          return renderSpawnCall(tasks.length, theme);
        },
        renderResult(result, { expanded }, theme) {
          const details = spawnViewFromResult(result.details);
          if (details === null) {
            const text = result.content[0];
            return linesComponent([text?.type === "text" ? text.text : "Spine Spawn"]);
          }
          return renderSpawnResult(details, expanded, theme);
        },
      });
      continue;
    }
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      renderShell: "self",
      async execute() {
        return toolResult(`Spine ${tool.name} staged`);
      },
      renderCall() {
        return linesComponent([]);
      },
      renderResult(result, _options, theme, context) {
        if (context.isError) {
          const text = result.content[0];
          const message = text?.type === "text" ? text.text : `${tool.name} failed`;
          return linesComponent([theme.fg("error", message)]);
        }
        return linesComponent([]);
      },
    });
  }
}

function loadCanonicalSpineTools(): Array<{
  name: string;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Unsafe>;
}> {
  const runtime = createNodeSpineRuntime({ thread: "pi-tool-catalog", features: ["jit", "spawn"] });
  try {
    return runtime.toolCatalog().map((tool) => ({
      name: `spine_${tool.id}`,
      label: `Spine ${tool.id[0]?.toUpperCase() ?? ""}${tool.id.slice(1)}`,
      description: rewriteSpineToolNamesForPi(tool.description),
      parameters: Type.Unsafe(tool.parameters),
    }));
  } finally {
    runtime.dispose();
  }
}

function registerChildReturnTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: CHILD_RETURN_TOOL,
    label: "Return Spine Memory",
    description: "Return the complete model-authored terminal memory for this Spawn child.",
    parameters: Type.Object({ memory: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Spine child memory accepted" }],
        details: { accepted: true, memoryBytes: params.memory.length },
        terminate: true,
      };
    },
  });
}

function registerSpineCommands(pi: ExtensionAPI, slot: MutableSessionSlot): void {
  pi.registerCommand("spine-tree", {
    description: "Show the current Spine tree",
    handler: async (_args, ctx) => {
      const session = await requireSession(slot);
      const projection = session.latestContext.projection;
      const lines = prettySpineTreeHasTasks(projection) ? formatPrettySpineTree(projection) : [];
      ctx.ui.notify(lines.length === 0 ? "Spine tree is empty" : lines.join("\n"), "info");
    },
  });
}

function registerLifecycleHandlers(
  pi: ExtensionAPI,
  slot: MutableSessionSlot,
  runtimeFactory: PiExtensionRuntimeFactory,
  onSessionReady?: CreatePiExtensionOptions["onSessionReady"],
  onSamplingCommit?: CreatePiExtensionOptions["onSamplingCommit"],
): void {
  let childMode = false;
  pi.on("session_start", async (_event, ctx) => {
    childMode = pi.getFlag(CHILD_FLAG) === true;
    if (childMode) {
      registerChildReturnTool(pi);
      pi.setActiveTools([CHILD_RETURN_TOOL]);
      return;
    }
    await guardHook(slot, ctx, async () => {
      slot.fault = null;
      slot.notified = false;
      slot.compactionHandled = false;
      slot.compactionAbortCleanup?.();
      slot.compactionAbortCleanup = null;
      slot.treeSignature = null;
      await beginSessionInitialization(slot, () => initializeSession(pi, ctx, runtimeFactory, onSessionReady));
      renderSpineTree(ctx, slot, await requireSession(slot));
    });
  });
  pi.on("session_tree", async (_event, ctx) => {
    if (childMode) return;
    await guardHook(slot, ctx, async () => {
      slot.fault = null;
      slot.notified = false;
      slot.compactionHandled = false;
      slot.compactionAbortCleanup?.();
      slot.compactionAbortCleanup = null;
      slot.treeSignature = null;
      await beginSessionInitialization(slot, () => initializeSession(pi, ctx, runtimeFactory, onSessionReady));
      renderSpineTree(ctx, slot, await requireSession(slot));
    });
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (childMode) return;
    slot.generation += 1;
    slot.compactionHandled = false;
    slot.compactionAbortCleanup?.();
    slot.compactionAbortCleanup = null;
    slot.treeSignature = null;
    disposeCurrent(slot);
    slot.initialization = null;
    if (ctx.mode === "tui") {
      ctx.ui.setWidget(SPINE_TREE_WIDGET, undefined);
    }
  });
  pi.on("message_end", async (event, ctx) => {
    if (childMode) return;
    await guardHook(slot, ctx, async () => {
      await (await requireSession(slot)).lifecycle.observeMessage(event.message as PiAgentMessage);
    });
  });
  pi.on("context", async (_event, ctx): Promise<{ messages?: ContextEvent["messages"] }> => {
    if (childMode) return {};
    try {
      const session = await requireSession(slot);
      await session.lifecycle.previewContext();
      renderSpineTree(ctx, slot, session);
      return {
        messages: structuredClone(session.latestContext.messages) as unknown as ContextEvent["messages"],
      };
    } catch (cause) {
      faultAndAbort(slot, ctx, cause);
      return { messages: [] };
    }
  });
  pi.on("before_provider_request", async (event, ctx) => {
    if (childMode) return;
    await guardHook(slot, ctx, async () => {
      await (await requireSession(slot)).lifecycle.beginSampling(event.payload);
    });
  });
  pi.on("before_agent_start", async (event) => {
    if (childMode) return;
    const session = await requireSession(slot);
    return {
      systemPrompt: rewriteSpineToolNamesForPi(session.runtime.extendSystemPrompt(event.systemPrompt)),
    };
  });
  pi.on("tool_call", async (event, ctx) => {
    if (childMode) return undefined;
    try {
      await (await requireSession(slot)).lifecycle.registerToolCall(
        event.toolCallId,
        event.toolName,
        event.input,
      );
      return undefined;
    } catch (cause) {
      faultAndAbort(slot, ctx, cause);
      if ((PI_SPINE_TOOL_NAMES as readonly string[]).includes(event.toolName)) {
        return { block: true, reason: "Spine lifecycle fault", terminate: true };
      }
      return undefined;
    }
  });
  pi.on("tool_result", async (event, ctx) => {
    if (childMode) return;
    await guardHook(slot, ctx, async () => {
      await (await requireSession(slot)).lifecycle.finishToolCall(event.toolCallId, !event.isError);
    });
  });
  pi.on("turn_end", async (event, ctx) => {
    if (childMode) return;
    await guardHook(slot, ctx, async () => {
      const commit = await (await requireSession(slot)).lifecycle.finishTurn({
        message: event.message as PiAgentMessage,
        aborted: ctx.signal?.aborted === true,
      });
      await onSamplingCommit?.({ sessionId: ctx.sessionManager.getSessionId(), commit, entries: ctx.sessionManager.getBranch() });
      renderSpineTree(ctx, slot, await requireSession(slot));
    });
  });
  pi.on(
    "session_before_compact",
    async (
      event: SessionBeforeCompactEvent,
      ctx: ExtensionContext,
    ): Promise<{ cancel?: boolean; compaction?: CompactionResult } | undefined> => {
    if (childMode) return undefined;
    try {
      const session = await requireSession(slot);
      const summaryResult = await summarizePiCompaction(event, ctx);
      const retained = retainedPiMessages(event, event.willRetry);
      const replacementMessages: PiAgentMessage[] = [
        {
          role: "compactionSummary",
          summary: summaryResult.summary,
          tokensBefore: event.preparation.tokensBefore,
          timestamp: Date.now(),
        },
        ...retained,
      ];
      const source = await session.lifecycle.sourceSnapshot();
      const barrier = buildCompactBarrier(source, replacementMessages.length);
      await session.lifecycle.compact(barrier, replacementMessages);
      renderSpineTree(ctx, slot, session);
      slot.compactionHandled = true;
      const onAbort = () => {
        if (!slot.compactionHandled) return;
        slot.compactionHandled = false;
        slot.compactionAbortCleanup = null;
        faultAndAbort(slot, ctx, new Error("Pi compaction aborted after Spine compact completed"));
      };
      event.signal.addEventListener("abort", onAbort, { once: true });
      slot.compactionAbortCleanup = () => event.signal.removeEventListener("abort", onAbort);
      if (event.signal.aborted) {
        onAbort();
        return { cancel: true };
      }
      const compaction: CompactionResult = {
        summary: summaryResult.summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      };
      if (summaryResult.usage !== undefined) compaction.usage = summaryResult.usage;
      return {
        compaction,
      };
    } catch (cause) {
      faultAndAbort(slot, ctx, cause);
      return { cancel: true };
    }
  });
  pi.on("session_compact", (_event, ctx) => {
    if (childMode) return;
    if (slot.compactionHandled) {
      slot.compactionHandled = false;
      slot.compactionAbortCleanup?.();
      slot.compactionAbortCleanup = null;
      return;
    }
    if (slot.fault !== null) return;
    faultAndAbort(slot, ctx, new Error("Pi native compaction completed without Spine interception"));
  });
}

async function summarizePiCompaction(
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
): Promise<{ summary: string; usage?: CompactionResult["usage"] }> {
  const model = ctx.model;
  if (model === undefined) throw new Error("Pi compaction requires an active model");
  const preparation = event.preparation;
  const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
  const conversation = serializeConversation(convertToLlm(messages));
  const previous = preparation.previousSummary === undefined
    ? ""
    : `\n\nPrevious summary:\n${preparation.previousSummary}`;
  const response = await ctx.modelRegistry.complete(
    model,
    {
      messages: [{
        role: "user",
        content: [{
          type: "text",
          text: `Create a concise structured continuation summary for this session.${previous}\n\nConversation:\n${conversation}`,
        }],
        timestamp: Date.now(),
      }],
    },
    { maxTokens: 8192, signal: event.signal, cacheRetention: "none", sessionId: randomUUID() },
  );
  const summary = response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (summary.length === 0) throw new Error("Pi compaction model returned an empty summary");
  const usage = response.usage as CompactionResult["usage"];
  return usage === undefined ? { summary } : { summary, usage };
}

function retainedPiMessages(
  event: { branchEntries: readonly SessionEntry[]; preparation: { firstKeptEntryId: string } },
  willRetry: boolean,
): PiAgentMessage[] {
  const start = event.branchEntries.findIndex((entry) => entry.id === event.preparation.firstKeptEntryId);
  if (start < 0) throw new Error("Pi compaction first-kept entry is missing from the active branch");
  const retained = event.branchEntries
    .slice(start)
    .flatMap((entry) => sessionEntryToContextMessages(entry as SessionEntry) as PiAgentMessage[]);
  if (!willRetry) return retained;
  const final = retained.at(-1);
  return final?.role === "assistant" && (final.stopReason === "error" || final.stopReason === "length")
    ? retained.slice(0, -1)
    : retained;
}

async function initializeSession(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  runtimeFactory: PiExtensionRuntimeFactory,
  onSessionReady?: CreatePiExtensionOptions["onSessionReady"],
): Promise<ActivePiSession> {
  const plan = buildPiReplayPlan({
    currentSessionId: ctx.sessionManager.getSessionId(),
    branch: ctx.sessionManager.getBranch(),
    messagesForEntry: (entry) =>
      sessionEntryToContextMessages(entry as SessionEntry) as PiAgentMessage[],
  });
  let runtime: NodeSpineRuntime | null = null;
  let runtimeThread: string | null = null;
  let latestContext: HostContextEnvelope<PiAgentMessage> | null = null;

  try {
    const recovered = await recoverPiSession({
      plan,
      runtimeFactory(thread) {
        runtimeThread = thread;
        runtime = runtimeFactory.create(thread);
        return runtime.client;
      },
      async adapterFactory(client, bindings) {
        const adapter = await createPiSpineAdapter({
          enabled: true,
          runtime: client,
          host: {
            async claimOwnership(claim) {
              if (claim.context !== "exclusive-final" || claim.compaction !== "exclusive") {
                throw new Error("Pi Spine received an invalid ownership claim");
              }
            },
            async appendCustomEntry(type, entry) {
              pi.appendEntry(type, entry);
            },
            async materializeContext(context) {
              return materializePiContext(context, bindings, {
                nodePrompt: rewriteSpineToolNamesForPi(runtime?.nodePrompt() ?? ""),
              });
            },
            async replaceContext(context) {
              const installed = structuredClone(context);
              if (latestContext === null) {
                latestContext = installed;
              } else {
                Object.assign(latestContext, installed);
              }
            },
          },
        });
        if (adapter === null) {
          throw new Error("Pi Spine adapter unexpectedly disabled");
        }
        return adapter;
      },
    });
    if (runtime === null || latestContext === null) {
      throw new Error("Pi Spine recovery did not install runtime context");
    }
    const active = {
      lifecycle: new PiSamplingLifecycle(recovered.adapter, recovered.bindings, recovered.source),
      runtime,
      latestContext,
    };
    if (onSessionReady && runtimeThread !== null) {
      await onSessionReady({ sessionId: ctx.sessionManager.getSessionId(), thread: runtimeThread, runtime, entries: ctx.sessionManager.getBranch() });
    }
    return active;
  } catch (cause) {
    (runtime as NodeSpineRuntime | null)?.dispose();
    throw cause;
  }
}

function childRuntimeFlags(ctx: ExtensionContext): string[] {
  const flags: string[] = [];
  const model = ctx.model;
  if (model !== undefined) {
    flags.push("--provider", model.provider, "--model", model.id);
  }
  if (ctx.thinkingLevel !== undefined) {
    flags.push("--thinking", ctx.thinkingLevel);
  }
  if (process.argv.includes("--approve")) {
    flags.push("--approve");
  }
  return flags;
}

async function executePiChild(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  prompt: string,
  child: { batchId: string; ordinal: number; signal: AbortSignal },
): Promise<SpawnChildTerminal> {
  const invocation = piInvocation();
  const task = [
    prompt,
    "",
    `Before ending, call ${CHILD_RETURN_TOOL} exactly once with the complete continuation memory for this task.`,
  ].join("\n");
  const result = await pi.exec(
    invocation.command,
    [
      ...invocation.args,
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-extensions",
      "--extension",
      EXTENSION_MODULE_PATH,
      `--${CHILD_FLAG}=true`,
      ...childRuntimeFlags(ctx),
      task,
    ],
    { cwd: ctx.cwd, signal: child.signal },
  );
  let memory: string;
  try {
    memory = extractTypedChildMemory(result.stdout);
  } catch (cause) {
    const diagnostic = result.stderr.trim() || `Pi child exited with code ${result.code}`;
    throw new Error(
      `${cause instanceof Error ? cause.message : String(cause)}; ${diagnostic}`.slice(0, 1200),
      { cause },
    );
  }
  const diagnostic = result.stderr.trim() || `Pi child exited with code ${result.code}`;
  if (result.killed) {
    return {
      outcome: "aborted",
      memoryBody: memory,
      diagnostic,
      executionRef: `${child.batchId}:${child.ordinal}`,
    };
  }
  if (result.code !== 0) {
    return {
      outcome: "errored",
      memoryBody: memory,
      diagnostic,
      executionRef: `${child.batchId}:${child.ordinal}`,
    };
  }
  return {
    outcome: "completed",
    memoryBody: memory,
    executionRef: `${child.batchId}:${child.ordinal}`,
  };
}

export function extractTypedChildMemory(stdout: string): string {
  const memories: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event) || event.type !== "message_end" || !isRecord(event.message)) continue;
    const message = event.message;
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const item of message.content) {
      if (
        isRecord(item) &&
        item.type === "toolCall" &&
        item.name === CHILD_RETURN_TOOL &&
        isRecord(item.arguments) &&
        typeof item.arguments.memory === "string" &&
        item.arguments.memory.trim().length > 0
      ) {
        memories.push(item.arguments.memory);
      }
    }
  }
  if (memories.length !== 1) {
    throw new Error(`Pi Spawn child returned ${memories.length} typed terminal memories`);
  }
  return memories[0]!;
}

async function requireSession(slot: MutableSessionSlot): Promise<ActivePiSession> {
  if (slot.fault !== null) throw new Error("Pi Spine extension is faulted", { cause: slot.fault });
  if (slot.current !== null) return slot.current;
  if (slot.initialization !== null) return slot.initialization;
  throw new Error("Pi Spine session is not initialized");
}

async function beginSessionInitialization(
  slot: MutableSessionSlot,
  initialize: () => Promise<ActivePiSession>,
): Promise<void> {
  const generation = slot.generation + 1;
  slot.generation = generation;
  disposeCurrent(slot);
  const pending = initialize();
  slot.initialization = pending;
  try {
    const session = await pending;
    if (slot.generation !== generation) {
      session.runtime.dispose();
      return;
    }
    slot.current = session;
    slot.initialization = null;
  } catch (cause) {
    if (slot.generation !== generation) return;
    slot.initialization = null;
    throw cause;
  }
}

async function guardHook(
  slot: MutableSessionSlot,
  ctx: ExtensionContext,
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (cause) {
    faultAndAbort(slot, ctx, cause);
  }
}

function faultAndAbort(slot: MutableSessionSlot, ctx: ExtensionContext, cause: unknown): void {
  slot.fault ??= cause;
  ctx.abort();
  if (!slot.notified && ctx.hasUI) {
    slot.notified = true;
    ctx.ui.notify("Spine faulted; current Pi operation aborted", "error");
  }
}

function disposeCurrent(slot: MutableSessionSlot): void {
  slot.current?.runtime.dispose();
  slot.current = null;
}

function toolResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: { staged: true } };
}

function piInvocation(): { command: string; args: string[] } {
  return resolvePiInvocation({
    execPath: process.execPath,
    execArgv: process.execArgv,
    argv: process.argv,
  });
}

function renderSpineTree(ctx: ExtensionContext, slot: MutableSessionSlot, session: ActivePiSession): void {
  if (ctx.mode !== "tui") return;
  const projection = session.latestContext.projection;
  if (!prettySpineTreeHasTasks(projection)) {
    slot.treeSignature = null;
    ctx.ui.setWidget(SPINE_TREE_WIDGET, undefined);
    return;
  }
  const signature = displayTreeSignature(projection);
  if (signature === slot.treeSignature) return;
  slot.treeSignature = signature;
  ctx.ui.setWidget(
    SPINE_TREE_WIDGET,
    (_tui, theme) => linesComponent(formatThemedPrettySpineTree(projection, theme)),
    { placement: "aboveEditor" },
  );
}

function spawnToolUpdate(view: SpawnBatchDetails) {
  return {
    content: [{ type: "text" as const, text: spawnModelText(view) }],
    details: snapshotSpawnView(view),
  };
}

function snapshotSpawnView(view: SpawnBatchDetails): SpawnBatchDetails {
  return {
    schema: "spine.spawn.view.v1",
    tasks: view.tasks.map((task) => ({ ...task })),
  };
}

function spawnViewFromResult(details: unknown): SpawnBatchDetails | null {
  if (!isRecord(details) || details.schema !== "spine.spawn.view.v1" || !Array.isArray(details.tasks)) {
    return null;
  }
  return details as unknown as SpawnBatchDetails;
}

function spawnFailureDiagnostic(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim() !== "") return cause.message.slice(0, 240);
  const text = String(cause).trim();
  return text === "" ? "spawn child failed" : text.slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
