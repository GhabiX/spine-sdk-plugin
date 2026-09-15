import assert from "node:assert/strict";
import test from "node:test";

import extension, {
  createPiExtension,
  extractTypedChildMemory,
} from "../dist/pi/extension.js";
import { createNodeSpineRuntime } from "@spinejit/spine-sdk/node";
import { resolvePiInvocation } from "../dist/pi/invocation.js";

function mockPi() {
  const handlers = new Map();
  const tools = new Map();
  const commands = new Map();
  const entries = [];
  let childFlag = false;
  return {
    handlers,
    tools,
    commands,
    entries,
    setChildFlag(value) {
      childFlag = value;
    },
    api: {
      registerFlag() {},
      getFlag(name) {
        return name === "spine-child" && childFlag;
      },
      registerTool(tool) {
        tools.set(tool.name, tool);
      },
      registerCommand(name, command) {
        commands.set(name, command);
      },
      getThinkingLevel() {
        return "low";
      },
      setActiveTools(names) {
        this.activeTools = [...names];
      },
      on(name, handler) {
        const existing = handlers.get(name) ?? [];
        existing.push(handler);
        handlers.set(name, existing);
      },
      appendEntry(customType, data) {
        entries.push({ customType, data });
      },
      async exec() {
        throw new Error("unexpected child execution");
      },
    },
    async emit(name, event, ctx) {
      let result;
      for (const handler of handlers.get(name) ?? []) {
        result = await handler(event, ctx);
      }
      return result;
    },
  };
}

function extensionContext(sessionId = "pi-session") {
  const notifications = [];
  const widgets = [];
  let aborts = 0;
  return {
    notifications,
    widgets,
    get aborts() {
      return aborts;
    },
    context: {
      mode: "tui",
      hasUI: true,
      signal: undefined,
      cwd: "/tmp",
      model: { provider: "google", id: "gemini-3.8-flash" },
      thinkingLevel: "low",
      sessionManager: {
        getSessionId: () => sessionId,
        getBranch: () => [],
      },
      ui: {
        notify(message, level) {
          notifications.push([message, level]);
        },
        setWidget(key, content, options) {
          widgets.push([key, content, options]);
        },
      },
      abort() {
        aborts += 1;
      },
    },
  };
}

function gatedRuntimeFactory() {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let first = true;
  const runtimes = [];
  return {
    runtimes,
    release() {
      release();
    },
    create(thread) {
      const runtime = createNodeSpineRuntime({ thread, features: ["jit", "spawn"] });
      let disposed = false;
      const execute = runtime.client.execute.bind(runtime.client);
      const client = {
        async execute(command) {
          if (first) {
            first = false;
            await gate;
          }
          return execute(command);
        },
      };
      const wrapped = {
        client,
        extendSystemPrompt(base) {
          return runtime.extendSystemPrompt(base);
        },
        nodePrompt() {
          return runtime.nodePrompt();
        },
        toolCatalog() {
          return runtime.toolCatalog();
        },
        get disposed() {
          return disposed;
        },
        dispose() {
          disposed = true;
          runtime.dispose();
        },
      };
      runtimes.push(wrapped);
      return wrapped;
    },
  };
}

function user(content) {
  return { role: "user", content, timestamp: 1 };
}

function assistant(content, stopReason = "stop") {
  return {
    role: "assistant",
    content,
    api: "test",
    provider: "test",
    model: "test",
    usage: { input: 7 },
    stopReason,
    timestamp: 2,
  };
}

test("default export is a loadable Pi extension with the canonical tools", () => {
  const pi = mockPi();
  extension(pi.api);
  assert.deepEqual(
    [...pi.tools.keys()].sort(),
    ["spine_close", "spine_next", "spine_open", "spine_spawn"],
  );
  assert.deepEqual([...pi.commands.keys()].sort(), ["spine-status", "spine-tree"]);
  assert.ok(pi.handlers.has("context"));
  assert.ok(pi.handlers.has("before_agent_start"));
  assert.ok(pi.handlers.has("session_before_compact"));
});

test("before_agent_start installs the canonical Spine instruction", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);

  const result = await pi.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: "Implement the task",
      systemPrompt: "base system prompt",
      systemPromptOptions: {},
    },
    ctx.context,
  );

  const expectedRuntime = createNodeSpineRuntime({
    thread: "pi-session",
    features: ["jit", "spawn"],
  });
  try {
    const { rewriteSpineToolNamesForPi } = await import("../dist/pi/prompt.js");
    assert.equal(
      result.systemPrompt,
      rewriteSpineToolNamesForPi(expectedRuntime.extendSystemPrompt("base system prompt")),
    );
    assert.match(result.systemPrompt, /spine_open/);
    assert.doesNotMatch(result.systemPrompt, /spine\.open/);
  } finally {
    expectedRuntime.dispose();
  }
});

test("child mode is selected after Pi applies extension flags", async () => {
  const pi = mockPi();
  createPiExtension()(pi.api);
  assert.equal(pi.tools.has("spine_child_return"), false);
  pi.setChildFlag(true);
  await pi.emit(
    "session_start",
    { type: "session_start", reason: "new" },
    extensionContext().context,
  );
  assert.equal(pi.tools.has("spine_child_return"), true);
  assert.deepEqual(pi.api.activeTools, ["spine_child_return"]);
});

test("session transitions never install a stale asynchronous runtime", async () => {
  const pi = mockPi();
  const factory = gatedRuntimeFactory();
  const firstCtx = extensionContext("first-session");
  const secondCtx = extensionContext("second-session");
  createPiExtension({ runtimeFactory: factory })(pi.api);

  const first = pi.emit(
    "session_start",
    { type: "session_start", reason: "new" },
    firstCtx.context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const second = pi.emit(
    "session_tree",
    { type: "session_tree" },
    secondCtx.context,
  );
  await second;
  factory.release();
  await first;

  assert.equal(factory.runtimes.length, 2);
  assert.equal(factory.runtimes[0].disposed, true);
  assert.equal(factory.runtimes[1].disposed, false);
  await pi.emit("message_end", { type: "message_end", message: user("current") }, secondCtx.context);
  const current = await pi.emit("context", { type: "context", messages: [] }, secondCtx.context);
  assert.deepEqual(current.messages, [user("[U1]\ncurrent")]);
});

test("session_tree resets a prior lifecycle fault", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  await pi.emit(
    "turn_end",
    { type: "turn_end", message: assistant("invalid-before-sampling") },
    ctx.context,
  );
  assert.equal(ctx.aborts, 1);

  await pi.emit("session_tree", { type: "session_tree" }, ctx.context);
  await pi.emit("message_end", { type: "message_end", message: user("recovered") }, ctx.context);
  const recovered = await pi.emit("context", { type: "context", messages: [] }, ctx.context);
  assert.deepEqual(recovered.messages, [user("[U1]\nrecovered")]);
});

test("Spawn child invocation isolates the extension and preserves the prompt argument", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  let childCommand;
  let childArgs;
  pi.api.exec = async (command, args) => {
    childCommand = command;
    childArgs = args;
    return {
      stdout: JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{
            type: "toolCall",
            name: "spine_child_return",
            arguments: { memory: "typed child memory" },
          }],
        },
      }),
      stderr: "",
      code: 0,
      killed: false,
    };
  };
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  await pi.emit(
    "before_provider_request",
    { type: "before_provider_request", payload: { input: [] } },
    ctx.context,
  );
  await pi.emit(
    "tool_call",
    {
      type: "tool_call",
      toolCallId: "spawn-1",
      toolName: "spine_spawn",
      input: { tasks: [{ summary: "child", prompt: "do exact work" }, { summary: "peer", prompt: "do peer work" }] },
    },
    ctx.context,
  );
  const result = await pi.tools.get("spine_spawn").execute(
    "spawn-1",
    { tasks: [{ summary: "child", prompt: "do exact work" }, { summary: "peer", prompt: "do peer work" }] },
    undefined,
    undefined,
    ctx.context,
  );

  const invocation = resolvePiInvocation({
    execPath: process.execPath,
    execArgv: process.execArgv,
    argv: process.argv,
  });
  assert.equal(childCommand, invocation.command);
  assert.deepEqual(childArgs.slice(0, invocation.args.length), invocation.args);
  assert.ok(childArgs.includes("--no-extensions"));
  assert.ok(childArgs.includes("--extension"));
  assert.ok(childArgs.includes("--spine-child=true"));
  assert.ok(childArgs.includes("--provider"));
  assert.equal(childArgs[childArgs.indexOf("--provider") + 1], "google");
  assert.ok(childArgs.includes("--model"));
  assert.equal(childArgs[childArgs.indexOf("--model") + 1], "gemini-3.8-flash");
  assert.ok(childArgs.includes("--thinking"));
  assert.equal(childArgs[childArgs.indexOf("--thinking") + 1], "low");
  assert.match(childArgs.at(-1), /^do peer work\n\nBefore ending/);
  assert.equal(result.details.results[0].memory_body, "typed child memory");
  assert.equal(pi.entries.at(-1).customType, "spine.spawn-terminal.v1");
});

test("Spawn records typed nonzero child memory but rejects an untyped crash", async () => {
  const typed = mockPi();
  const typedCtx = extensionContext();
  typed.api.exec = async () => ({
    stdout: JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{
          type: "toolCall",
          name: "spine_child_return",
          arguments: { memory: "bounded failure memory" },
        }],
      },
    }),
    stderr: "child failed after return",
    code: 2,
    killed: false,
  });
  createPiExtension()(typed.api);
  await typed.emit("session_start", { type: "session_start", reason: "new" }, typedCtx.context);
  await typed.emit(
    "before_provider_request",
    { type: "before_provider_request", payload: { input: [] } },
    typedCtx.context,
  );
  await typed.emit(
    "tool_call",
    {
      type: "tool_call",
      toolCallId: "spawn-typed-failure",
      toolName: "spine_spawn",
      input: { tasks: [{ summary: "child", prompt: "fail after return" }, { summary: "peer", prompt: "peer fallback" }] },
    },
    typedCtx.context,
  );
  const typedResult = await typed.tools.get("spine_spawn").execute(
    "spawn-typed-failure",
    { tasks: [{ summary: "child", prompt: "fail after return" }, { summary: "peer", prompt: "peer fallback" }] },
    undefined,
    undefined,
    typedCtx.context,
  );
  assert.deepEqual(
    {
      outcome: typedResult.details.results[0].outcome,
      memory: typedResult.details.results[0].memory_body,
      diagnostic: typedResult.details.results[0].diagnostic,
    },
    {
      outcome: "errored",
      memory: "bounded failure memory",
      diagnostic: "child failed after return",
    },
  );

  const untyped = mockPi();
  const untypedCtx = extensionContext();
  untyped.api.exec = async () => ({
    stdout: "child process crashed",
    stderr: "fatal",
    code: 2,
    killed: false,
  });
  createPiExtension()(untyped.api);
  await untyped.emit("session_start", { type: "session_start", reason: "new" }, untypedCtx.context);
  await untyped.emit(
    "before_provider_request",
    { type: "before_provider_request", payload: { input: [] } },
    untypedCtx.context,
  );
  await untyped.emit(
    "tool_call",
    {
      type: "tool_call",
      toolCallId: "spawn-untyped-failure",
      toolName: "spine_spawn",
      input: { tasks: [{ summary: "child", prompt: "crash" }, { summary: "peer", prompt: "peer crash" }] },
    },
    untypedCtx.context,
  );
  await assert.rejects(
    untyped.tools.get("spine_spawn").execute(
      "spawn-untyped-failure",
      { tasks: [{ summary: "child", prompt: "crash" }, { summary: "peer", prompt: "peer crash" }] },
      undefined,
      undefined,
      untypedCtx.context,
    ),
    (error) =>
      error?.name === "SpawnBatchExecutionError" &&
      /Pi Spawn child returned 0 typed terminal memories/.test(String(error.cause)),
  );
  assert.equal(
    untyped.entries.some((entry) => entry.customType === "spine.spawn-terminal.v1"),
    false,
  );
});

test("WASM-backed extension completes one Pi Open sampling transaction", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  createPiExtension()(pi.api);

  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  await pi.emit("message_end", { type: "message_end", message: user("request") }, ctx.context);
  const before = await pi.emit("context", { type: "context", messages: [] }, ctx.context);
  assert.deepEqual(before.messages, [user("[U1]\nrequest")]);

  await pi.emit(
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "test", input: ["request"] } },
    ctx.context,
  );
  const callMessage = assistant([
    { type: "toolCall", id: "open-1", name: "spine_open", arguments: { goal: "inspect" } },
  ]);
  await pi.emit("message_end", { type: "message_end", message: callMessage }, ctx.context);
  await pi.emit(
    "tool_call",
    { type: "tool_call", toolCallId: "open-1", toolName: "spine_open", input: { goal: "inspect" } },
    ctx.context,
  );
  const openResult = await pi.tools.get("spine_open").execute(
    "open-1",
    { goal: "inspect" },
    undefined,
    undefined,
    ctx.context,
  );
  assert.equal(openResult.details.staged, true);
  await pi.emit(
    "tool_result",
    {
      type: "tool_result",
      toolCallId: "open-1",
      toolName: "spine_open",
      input: { goal: "inspect" },
      content: openResult.content,
      details: openResult.details,
      isError: false,
    },
    ctx.context,
  );
  const resultMessage = {
    role: "toolResult",
    toolCallId: "open-1",
    toolName: "spine_open",
    content: openResult.content,
    details: openResult.details,
    isError: false,
    timestamp: 3,
  };
  await pi.emit("message_end", { type: "message_end", message: resultMessage }, ctx.context);
  await pi.emit(
    "turn_end",
    { type: "turn_end", turnIndex: 0, message: callMessage, toolResults: [resultMessage] },
    ctx.context,
  );

  const widget = ctx.widgets.at(-1);
  assert.equal(widget[0], "spine-tree");
  assert.deepEqual(widget[2], { placement: "aboveEditor" });
  assert.match(widget[1].join("\n"), /1\.1 inspect current/);

  assert.deepEqual(pi.entries.map((entry) => entry.customType), [
    "spine.archive.v1",
    "spine.archive.v1",
  ]);
  assert.equal(pi.entries[0].data.record.type, "sampling_started");
  assert.equal(pi.entries[1].data.record.type, "sampling_commit");
  const after = await pi.emit("context", { type: "context", messages: [] }, ctx.context);
  assert.match(after.messages[1].content, /<spine_node id="1\.1" summary="inspect" status="opened">/);
  assert.equal(ctx.aborts, 0);

  const compact = await pi.emit(
    "session_before_compact",
    { type: "session_before_compact" },
    ctx.context,
  );
  assert.deepEqual(compact, { cancel: true });
  await pi.emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx.context);
  assert.deepEqual(ctx.widgets.at(-1), ["spine-tree", undefined, undefined]);
});

test("Pi overflow retry drops only the final retryable assistant", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const earlierError = assistant([{ type: "text", text: "keep earlier" }], "error");
  const retryTarget = assistant([{ type: "text", text: "drop final" }], "length");
  const entries = [
    { type: "message", id: "earlier", parentId: null, timestamp: "1", message: earlierError },
    { type: "message", id: "final", parentId: "earlier", timestamp: "2", message: retryTarget },
  ];
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      return { content: [{ type: "text", text: "retry summary" }] };
    },
  };
  ctx.context.sessionManager.getBranch = () => entries;
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  const result = await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: {
        firstKeptEntryId: "earlier",
        messagesToSummarize: [earlierError, retryTarget],
        turnPrefixMessages: [],
        tokensBefore: 12,
      },
      branchEntries: entries,
      signal: new AbortController().signal,
      reason: "overflow",
      willRetry: true,
    },
    ctx.context,
  );
  assert.equal(result.compaction.summary, "retry summary");
  const compact = pi.entries.find((entry) => entry.customType === "spine.compact.v1");
  assert.equal(compact.data.replacementMessages.length, 2);
  assert.deepEqual(compact.data.replacementMessages[1].content, [{ type: "text", text: "keep earlier" }]);
});

test("Pi compact abort after Spine completion faults the live session", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const kept = user("keep this recent request");
  const entry = { type: "message", id: "kept-1", parentId: null, timestamp: "1", message: kept };
  const signal = new AbortController();
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() { return { content: [{ type: "text", text: "summary" }] }; },
  };
  ctx.context.sessionManager.getBranch = () => [entry];
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: { firstKeptEntryId: "kept-1", messagesToSummarize: [kept], turnPrefixMessages: [], tokensBefore: 1 },
      branchEntries: [entry],
      signal: signal.signal,
      reason: "manual",
      willRetry: false,
    },
    ctx.context,
  );
  signal.abort();
  assert.equal(ctx.aborts, 1);
  await pi.emit("session_compact", { type: "session_compact", compactionEntry: {}, fromExtension: true, reason: "manual", willRetry: false }, ctx.context);
  assert.equal(ctx.aborts, 1);
});

test("Pi custom compaction summarizes, durably barriers, and publishes replacement context", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const kept = user("keep this recent request");
  const entry = {
    type: "message",
    id: "kept-1",
    parentId: null,
    timestamp: new Date().toISOString(),
    message: kept,
  };
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      return {
        content: [{ type: "text", text: "## Goal\nPreserve the active work." }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      };
    },
  };
  ctx.context.sessionManager.getBranch = () => [entry];
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  await pi.emit("message_end", { type: "message_end", message: kept }, ctx.context);

  const result = await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: {
        firstKeptEntryId: "kept-1",
        messagesToSummarize: [kept],
        turnPrefixMessages: [],
        tokensBefore: 12,
        previousSummary: undefined,
      },
      branchEntries: [entry],
      signal: new AbortController().signal,
      reason: "manual",
      willRetry: false,
    },
    ctx.context,
  );
  assert.equal(result.compaction.summary, "## Goal\nPreserve the active work.");
  assert.equal(pi.entries.filter((entry) => entry.customType === "spine.compact.v1").length, 1);

  await pi.emit(
    "session_compact",
    { type: "session_compact", compactionEntry: {}, fromExtension: true, reason: "manual", willRetry: false },
    ctx.context,
  );
  const context = await pi.emit("context", { type: "context", messages: [] }, ctx.context);
  assert.equal(ctx.aborts, 0);
  assert.match(context.messages[0].summary, /Preserve the active work/);
  assert.deepEqual(context.messages[1], kept);
});

test("typed child-memory extraction rejects prose and duplicate returns", () => {
  const event = JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          name: "spine_child_return",
          arguments: { memory: "bounded child memory" },
        },
      ],
    },
  });
  assert.equal(extractTypedChildMemory(`not-json\n${event}\n`), "bounded child memory");
  assert.throws(() => extractTypedChildMemory("plain final answer"), /0 typed terminal memories/);
  assert.throws(() => extractTypedChildMemory(`${event}\n${event}`), /2 typed terminal memories/);
});
