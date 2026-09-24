import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import extension, {
  createPiExtension,
  createPiSpinePlugin,
  extractTypedChildMemory,
  SPINE_CANONICAL_PLUGIN_MANIFEST,
} from "../dist/pi/extension.js";
import { createNodeSpineRuntime } from "@spinejit/spine-sdk/node";
import { resolvePiInvocation } from "../dist/pi/invocation.js";
import { loadPiSpineConfigToml } from "../dist/pi/spine-config.js";
import { SPINE_TREE_VIEW_REQUEST } from "../dist/pi/tree-view-contract.js";

function mockPi() {
  const handlers = new Map();
  const tools = new Map();
  const commands = new Map();
  const entries = [];
  const eventListeners = new Map();
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
      events: {
        on(name, listener) {
          const listeners = eventListeners.get(name) ?? new Set();
          listeners.add(listener);
          eventListeners.set(name, listeners);
          return () => listeners.delete(listener);
        },
        emit(name, data) {
          for (const listener of eventListeners.get(name) ?? []) listener(data);
        },
      },
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
      getActiveTools() {
        return this.activeTools ?? [
          "read",
          "bash",
          "edit",
          "write",
          "spine_open",
          "spine_close",
          "spine_next",
          "spine_spawn",
        ];
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

function extensionContext(sessionId = "pi-session", options = {}) {
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
        getBranch: () => options.branch ?? [],
        getSessionFile: () => options.sessionFile,
      },
      ui: {
        notify(message, level) {
          notifications.push([message, level]);
        },
        setWidget(key, content, options) {
          widgets.push([key, content, options]);
        },
        ...(options.select === undefined ? {} : { select: options.select }),
        ...(options.input === undefined ? {} : { input: options.input }),
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

function widgetLines(widget, width = 80) {
  const content = widget[1];
  if (content === undefined) return [];
  if (Array.isArray(content)) return content;
  const theme = {
    fg(_color, text) {
      return text;
    },
    bold(text) {
      return text;
    },
  };
  return content({ terminal: { rows: 40 }, requestRender() {} }, theme).render(width);
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
  for (const name of ["spine_open", "spine_close", "spine_next"]) {
    const tool = pi.tools.get(name);
    assert.equal(tool.renderShell, "self");
    assert.deepEqual(tool.renderCall({}, {}, {}).render(80), []);
    assert.deepEqual(
      tool.renderResult(
        { content: [{ type: "text", text: `Spine ${name} staged` }], details: { staged: true } },
        { expanded: false, isPartial: false },
        { fg(_c, t) { return t; }, bold(t) { return t; } },
        { isError: false },
      ).render(80),
      [],
    );
  }
  assert.equal(typeof pi.tools.get("spine_spawn").renderCall, "function");
  assert.deepEqual([...pi.commands.keys()], []);
  assert.ok(pi.handlers.has("context"));
  assert.ok(pi.handlers.has("before_agent_start"));
  assert.ok(pi.handlers.has("session_before_compact"));
});

test("canonical Pi extension is also a SpineHost owner plugin", async () => {
  const pi = mockPi();
  const plugin = createPiSpinePlugin({ pi: pi.api });

  assert.deepEqual(plugin.manifest, SPINE_CANONICAL_PLUGIN_MANIFEST);
  await plugin.activate({});
  assert.deepEqual(
    [...pi.tools.keys()].sort(),
    ["spine_close", "spine_next", "spine_open", "spine_spawn"],
  );
  assert.ok(pi.handlers.has("context"));
  assert.ok(pi.handlers.has("before_provider_request"));
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
    configToml: loadPiSpineConfigToml(),
  });
  try {
    assert.equal(
      result.systemPrompt,
      expectedRuntime.extendSystemPrompt("base system prompt"),
    );
    assert.match(result.systemPrompt, /spine_open/);
    assert.doesNotMatch(result.systemPrompt, /spine\.open/);
    assert.match(
      result.systemPrompt,
      /A user message is not the granularity of a SpineBranch/,
    );
  } finally {
    expectedRuntime.dispose();
  }
});

test("child mode keeps ordinary tools, Spine tree tools, nested spawn, and typed return", async () => {
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
  assert.deepEqual(pi.api.activeTools, [
    "read",
    "bash",
    "edit",
    "write",
    "spine_open",
    "spine_close",
    "spine_next",
    "spine_spawn",
    "spine_child_return",
  ]);
});

test("child mode installs Spine lifecycle so descendant open/close/next can run", async () => {
  const pi = mockPi();
  pi.setChildFlag(true);
  createPiExtension()(pi.api);
  const ctx = extensionContext();
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  const result = await pi.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: "child work",
      systemPrompt: "base system prompt",
      systemPromptOptions: {},
    },
    ctx.context,
  );
  assert.match(result.systemPrompt, /spine_open/);
  assert.match(result.systemPrompt, /spine_close/);
  assert.match(result.systemPrompt, /spine_next/);
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
    "tool_call",
    {
      type: "tool_call",
      toolCallId: "open-1",
      toolName: "spine_open",
      input: { goal: "inspect" },
    },
    ctx.context,
  );
  assert.equal(ctx.aborts, 1);

  await pi.emit("session_tree", { type: "session_tree" }, ctx.context);
  await pi.emit("message_end", { type: "message_end", message: user("recovered") }, ctx.context);
  const recovered = await pi.emit("context", { type: "context", messages: [] }, ctx.context);
  assert.deepEqual(recovered.messages, [user("[U1]\nrecovered")]);
});

test("user abort of a host tool does not latch a fault on a stray follow-up turn_end", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const commits = [];
  createPiExtension({
    onSamplingCommit(info) {
      commits.push(info.commit);
    },
  })(pi.api);

  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  await pi.emit("message_end", { type: "message_end", message: user("investigate") }, ctx.context);
  const firstPrompt = await pi.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: "investigate",
      systemPrompt: "base system prompt",
      systemPromptOptions: {},
    },
    ctx.context,
  );
  assert.match(firstPrompt.systemPrompt, /spine_open/);
  await pi.emit(
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "test", input: ["investigate"] } },
    ctx.context,
  );

  const callMessage = assistant(
    [{ type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "find /data /home" } }],
    "toolUse",
  );
  await pi.emit("message_end", { type: "message_end", message: callMessage }, ctx.context);
  await pi.emit(
    "tool_call",
    {
      type: "tool_call",
      toolCallId: "bash-1",
      toolName: "bash",
      input: { command: "find /data /home" },
    },
    ctx.context,
  );

  const aborted = new AbortController();
  aborted.abort();
  ctx.context.signal = aborted.signal;
  await pi.emit(
    "tool_result",
    {
      type: "tool_result",
      toolCallId: "bash-1",
      toolName: "bash",
      input: { command: "find /data /home" },
      content: [{ type: "text", text: "Command aborted" }],
      details: {},
      isError: true,
    },
    ctx.context,
  );
  await pi.emit(
    "turn_end",
    { type: "turn_end", turnIndex: 0, message: callMessage, toolResults: [] },
    ctx.context,
  );
  await pi.emit(
    "turn_end",
    { type: "turn_end", turnIndex: 1, message: assistant([], "error") },
    ctx.context,
  );

  assert.equal(ctx.aborts, 0);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].type, "committed");
  assert.equal(commits[0].record.type, "sampling_commit");
  assert.equal(
    pi.entries.filter((entry) => entry.customType === "spine.archive.v1").length,
    2,
  );

  ctx.context.signal = new AbortController().signal;
  const continued = await pi.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: "continue",
      systemPrompt: "base system prompt",
      systemPromptOptions: {},
    },
    ctx.context,
  );
  assert.match(continued.systemPrompt, /spine_open/);
  await pi.emit(
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "test", input: ["continue"] } },
    ctx.context,
  );
  const done = assistant([{ type: "text", text: "ok" }], "stop");
  await pi.emit("message_end", { type: "message_end", message: done }, ctx.context);
  await pi.emit("turn_end", { type: "turn_end", turnIndex: 2, message: done }, ctx.context);

  assert.equal(ctx.aborts, 0);
  assert.equal(commits.length, 2);
  assert.equal(
    pi.entries.filter((entry) => entry.customType === "spine.archive.v1").length,
    4,
  );
});

test("Spawn child invocation inherits parent extensions and preserves the prompt argument", async () => {
  const pi = mockPi();
  const ctx = extensionContext("pi-session", {
    sessionFile: "/tmp/parent-session.jsonl",
    branch: [{
      type: "message",
      id: "aaaaaaaa",
      parentId: null,
      timestamp: "2026-09-17T12:00:00.000Z",
      message: { role: "user", content: "parent prefix TOKEN", timestamp: 1 },
    }],
  });
  let childCommand;
  let childArgs;
  const childInvocations = [];
  pi.api.exec = async (command, args) => {
    childCommand = command;
    childArgs = args;
    childInvocations.push(args);
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
  assert.equal(childArgs.includes("--no-session"), false);
  assert.ok(childArgs.includes("--session"));
  assert.equal(childArgs.includes("--no-extensions"), false);
  assert.ok(childArgs.includes("--extension"));
  assert.ok(childArgs.includes("--spine-child=true"));
  assert.ok(childArgs.includes("--tools"));
  const tools = childArgs[childArgs.indexOf("--tools") + 1];
  assert.match(tools, /\bread\b/);
  assert.match(tools, /\bbash\b/);
  assert.match(tools, /\bspine_child_return\b/);
  assert.ok(childArgs.includes("--provider"));
  assert.equal(childArgs[childArgs.indexOf("--provider") + 1], "google");
  assert.ok(childArgs.includes("--model"));
  assert.equal(childArgs[childArgs.indexOf("--model") + 1], "gemini-3.8-flash");
  assert.ok(childArgs.includes("--thinking"));
  assert.equal(childArgs[childArgs.indexOf("--thinking") + 1], "low");
  const peerArgs = childInvocations.find((args) => args.at(-1)?.includes("You are: peer"));
  assert.ok(peerArgs);
  const sessionPath = peerArgs[peerArgs.indexOf("--session") + 1];
  assert.equal(sessionPath, "/tmp/spine-spawn/spawn-1/1.jsonl");
  const prefix = await readFile(sessionPath, "utf8");
  assert.match(prefix, /parent prefix TOKEN/);
  assert.match(prefix, /"parentSession":"\/tmp\/parent-session.jsonl"/);
  assert.match(peerArgs.at(-1), /You are: peer/);
  assert.match(peerArgs.at(-1), /already an active branch scope/);
  assert.match(peerArgs.at(-1), /Assignment:\ndo peer work/);
  assert.equal(result.details.results[0].memory_body, "typed child memory");
  assert.equal(pi.entries.at(-1).customType, "spine.spawn-terminal.v1");
});

test("Spawn records typed nonzero child memory as an errored receipt", async () => {
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
});

test("Spawn records mixed receipts when one child omits typed return", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  pi.api.exec = async (_command, args) => {
    const assignment = args.at(-1);
    if (typeof assignment === "string" && assignment.includes("You are: peer")) {
      return {
        stdout: JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{
              type: "toolCall",
              name: "spine_child_return",
              arguments: { memory: "typed sibling memory" },
            }],
          },
        }),
        stderr: "",
        code: 0,
        killed: false,
      };
    }
    return {
      stdout: "child process crashed",
      stderr: "fatal",
      code: 2,
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
      toolCallId: "spawn-mixed",
      toolName: "spine_spawn",
      input: { tasks: [{ summary: "child", prompt: "crash" }, { summary: "peer", prompt: "succeed" }] },
    },
    ctx.context,
  );
  const result = await pi.tools.get("spine_spawn").execute(
    "spawn-mixed",
    { tasks: [{ summary: "child", prompt: "crash" }, { summary: "peer", prompt: "succeed" }] },
    undefined,
    undefined,
    ctx.context,
  );
  assert.equal(result.details.results.length, 2);
  assert.equal(result.details.results[0].outcome, "errored");
  assert.match(result.details.results[0].memory_body, /0 typed terminal memories/);
  assert.match(result.details.results[0].diagnostic, /fatal/);
  assert.equal(result.details.results[1].outcome, "completed");
  assert.equal(result.details.results[1].memory_body, "typed sibling memory");
  assert.equal(
    pi.entries.filter((entry) => entry.customType === "spine.spawn-terminal.v1").length,
    2,
  );
});

test("Spawn Continue reuses the same session and restores missing assignment context once", async () => {
  const calls = [];
  const choices = [];
  const ctx = extensionContext("pi-session", {
    sessionFile: "/tmp/parent-spawn-recovery.jsonl",
    select: async (_title, options) => {
      choices.push(options);
      return "Continue";
    },
    input: async () => "focus on the existing work",
  });
  const pi = mockPi();
  pi.api.exec = async (_command, args) => {
    const sessionPath = args[args.indexOf("--session") + 1];
    const prompt = args.at(-1);
    calls.push({ sessionPath, prompt });
    if (prompt.includes("You are: peer")) {
      return {
        stdout: JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{
              type: "toolCall",
              name: "spine_child_return",
              arguments: { memory: "peer child memory" },
            }],
          },
        }),
        stderr: "",
        code: 0,
        killed: false,
      };
    }
    const childAttempts = calls.filter(({ prompt: childPrompt }) =>
      childPrompt.includes("You are: child"),
    ).length;
    if (childAttempts === 1) {
      return { stdout: "", stderr: "first attempt failed", code: 1, killed: false };
    }
    return {
      stdout: JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{
            type: "toolCall",
            name: "spine_child_return",
            arguments: { memory: "continued child memory" },
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
  const tasks = [
    { summary: "child", prompt: "recover exact work" },
    { summary: "peer", prompt: "complete peer work" },
  ];
  await pi.emit(
    "tool_call",
    {
      type: "tool_call",
      toolCallId: "spawn-gated-continue",
      toolName: "spine_spawn",
      input: { tasks },
    },
    ctx.context,
  );
  const result = await pi.tools.get("spine_spawn").execute(
    "spawn-gated-continue",
    { tasks },
    undefined,
    undefined,
    ctx.context,
  );

  assert.deepEqual(choices, [["Continue", "Retry", "Abandon"]]);
  const childCalls = calls.filter(({ prompt }) => prompt.includes("You are: child"));
  assert.equal(childCalls.length, 2);
  assert.equal(childCalls[0].sessionPath, childCalls[1].sessionPath);
  assert.match(childCalls[1].prompt, /Assignment context:/);
  assert.equal(result.details.results[0].outcome, "completed");
  assert.equal(result.details.results[0].memory_body, "continued child memory");
});

test("Pi exec rejection remains host-fatal and does not open the recovery gate", async () => {
  let selectCalls = 0;
  const ctx = extensionContext("pi-session", {
    sessionFile: "/tmp/parent-spawn-reject.jsonl",
    select: async () => {
      selectCalls += 1;
      return "Retry";
    },
    input: async () => "",
  });
  const pi = mockPi();
  pi.api.exec = async () => {
    throw new Error("host transport failure");
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
      toolCallId: "spawn-gated-reject",
      toolName: "spine_spawn",
      input: { tasks: [
        { summary: "child", prompt: "fail host" },
        { summary: "peer", prompt: "peer host" },
      ] },
    },
    ctx.context,
  );
  await assert.rejects(
    pi.tools.get("spine_spawn").execute(
      "spawn-gated-reject",
      { tasks: [
        { summary: "child", prompt: "fail host" },
        { summary: "peer", prompt: "peer host" },
      ] },
      undefined,
      undefined,
      ctx.context,
    ),
    /failed at ordinal 0/,
  );
  assert.equal(selectCalls, 0);
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
  const tree = widgetLines(widget).join("\n");
  assert.match(tree, /Spine Tree/);
  assert.match(tree, /◉/);
  assert.match(tree, /inspect/);
  assert.equal(tree.includes("1.1"), false);

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

test("WASM-backed extension blocks spawn mixed with open without aborting the session", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  createPiExtension()(pi.api);

  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  await pi.emit("message_end", { type: "message_end", message: user("request") }, ctx.context);
  await pi.emit(
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "test", input: ["request"] } },
    ctx.context,
  );
  const spawnInput = {
    tasks: [
      { summary: "child", prompt: "do child work" },
      { summary: "peer", prompt: "do peer work" },
    ],
  };
  const callMessage = assistant([
    { type: "toolCall", id: "open-1", name: "spine_open", arguments: { goal: "inspect" } },
    { type: "toolCall", id: "spawn-1", name: "spine_spawn", arguments: spawnInput },
  ], "toolUse");
  await pi.emit("message_end", { type: "message_end", message: callMessage }, ctx.context);

  const openAdmission = await pi.emit(
    "tool_call",
    { type: "tool_call", toolCallId: "open-1", toolName: "spine_open", input: { goal: "inspect" } },
    ctx.context,
  );
  const spawnAdmission = await pi.emit(
    "tool_call",
    { type: "tool_call", toolCallId: "spawn-1", toolName: "spine_spawn", input: spawnInput },
    ctx.context,
  );
  assert.equal(openAdmission, undefined);
  assert.deepEqual(spawnAdmission, {
    block: true,
    reason: "spine_spawn cannot be mixed with spine_open, spine_close, or spine_next",
  });
  assert.equal(ctx.aborts, 0);

  const openResult = await pi.tools.get("spine_open").execute(
    "open-1",
    { goal: "inspect" },
    undefined,
    undefined,
    ctx.context,
  );
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

  assert.equal(ctx.aborts, 0);
  assert.equal(
    pi.entries.filter((entry) => entry.customType === "spine.archive.v1").at(-1).data.record.type,
    "sampling_commit",
  );

  const continued = await pi.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: "continue",
      systemPrompt: "base system prompt",
      systemPromptOptions: {},
    },
    ctx.context,
  );
  assert.match(continued.systemPrompt, /spine_open/);
  assert.equal(ctx.aborts, 0);
});

test("Pi overflow retry keeps an earlier error assistant after the null edit", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const earlierError = assistant([{ type: "text", text: "keep earlier" }], "error");
  const retryTarget = assistant([{ type: "text", text: "drop final" }], "length");
  const entries = [
    { type: "message", id: "earlier", parentId: null, timestamp: "1", message: earlierError },
    { type: "message", id: "final", parentId: "earlier", timestamp: "2", message: retryTarget },
    {
      type: "context_edit",
      id: "edit-final",
      parentId: "final",
      timestamp: "3",
      targetId: "final",
      replacement: null,
    },
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
  assert.equal(JSON.stringify(compact.data.replacementMessages).includes("drop final"), false);
  assert.deepEqual(compact.data.replacementEntryIds, [null, "earlier"]);
});

test("Pi context applies null and non-null context edits by entry id", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const kept = user("keep-user");
  const omitted = user("OMITTED");
  const entries = [];
  ctx.context.sessionManager.getBranch = () => entries;
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);

  await pi.emit("message_end", { type: "message_end", message: kept }, ctx.context);
  entries.push({ type: "message", id: "keep", parentId: null, timestamp: "1", message: kept });
  await pi.emit("message_end", { type: "message_end", message: omitted }, ctx.context);
  entries.push({
    type: "message",
    id: "omit",
    parentId: "keep",
    timestamp: "2",
    message: omitted,
  });
  entries.push({
    type: "context_edit",
    id: "edit-omit",
    parentId: "omit",
    timestamp: "3",
    targetId: "omit",
    replacement: null,
  });
  entries.push({
    type: "context_edit",
    id: "edit-keep",
    parentId: "edit-omit",
    timestamp: "4",
    targetId: "keep",
    replacement: { content: "rewritten-user" },
  });

  const context = await pi.emit("context", { type: "context", messages: [] }, ctx.context);
  const text = JSON.stringify(context.messages);
  assert.equal(text.includes("OMITTED"), false);
  assert.equal(text.includes("keep-user"), false);
  assert.equal(text.includes("rewritten-user"), true);
  assert.equal(ctx.aborts, 0);
});

test("Pi compact tail uses the host projection for omissions and rewrites", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const omitted = assistant([{ type: "text", text: "OMITTED" }], "error");
  const kept = user("keep-user");
  const rewritten = user("old-text");
  const entries = [
    { type: "message", id: "omit", parentId: null, timestamp: "1", message: omitted },
    { type: "message", id: "keep", parentId: "omit", timestamp: "2", message: kept },
    {
      type: "context_edit",
      id: "edit-omit",
      parentId: "keep",
      timestamp: "3",
      targetId: "omit",
      replacement: null,
    },
    { type: "message", id: "rewrite", parentId: "edit-omit", timestamp: "4", message: rewritten },
    {
      type: "context_edit",
      id: "edit-text",
      parentId: "rewrite",
      timestamp: "5",
      targetId: "rewrite",
      replacement: { content: "new-text" },
    },
  ];
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      return { content: [{ type: "text", text: "projected summary" }] };
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
        firstKeptEntryId: "omit",
        messagesToSummarize: [omitted, kept, rewritten],
        turnPrefixMessages: [],
        tokensBefore: 12,
      },
      branchEntries: entries,
      signal: new AbortController().signal,
      reason: "overflow",
      willRetry: false,
    },
    ctx.context,
  );
  assert.equal(result.compaction.summary, "projected summary");
  const compact = pi.entries.find((entry) => entry.customType === "spine.compact.v1");
  const rendered = JSON.stringify(compact.data.replacementMessages);
  assert.equal(rendered.includes("OMITTED"), false);
  assert.equal(rendered.includes("old-text"), false);
  assert.equal(rendered.includes("keep-user"), true);
  assert.equal(rendered.includes("new-text"), true);
  assert.deepEqual(compact.data.replacementEntryIds, [null, "keep", "rewrite"]);
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

test("Pi compact abort before Spine compact cancels without latching a fault", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const kept = user("keep this recent request");
  const entry = { type: "message", id: "kept-1", parentId: null, timestamp: "1", message: kept };
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      return { content: [{ type: "text", text: "partial summary" }], stopReason: "aborted" };
    },
  };
  ctx.context.sessionManager.getBranch = () => [entry];
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  const result = await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: { firstKeptEntryId: "kept-1", messagesToSummarize: [kept], turnPrefixMessages: [], tokensBefore: 1 },
      branchEntries: [entry],
      signal: new AbortController().signal,
      reason: "manual",
      willRetry: false,
    },
    ctx.context,
  );
  assert.deepEqual(result, { cancel: true });
  assert.equal(ctx.aborts, 0);
  assert.deepEqual(ctx.notifications, []);
  assert.equal(pi.entries.filter((item) => item.customType === "spine.compact.v1").length, 0);
  const continued = await pi.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: "continue",
      systemPrompt: "base system prompt",
      systemPromptOptions: {},
    },
    ctx.context,
  );
  assert.match(continued.systemPrompt, /spine_open/);
});

test("Pi compact summarization AbortError cancels without latching a fault", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const kept = user("keep this recent request");
  const entry = { type: "message", id: "kept-1", parentId: null, timestamp: "1", message: kept };
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  };
  ctx.context.sessionManager.getBranch = () => [entry];
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  const result = await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: { firstKeptEntryId: "kept-1", messagesToSummarize: [kept], turnPrefixMessages: [], tokensBefore: 1 },
      branchEntries: [entry],
      signal: new AbortController().signal,
      reason: "manual",
      willRetry: false,
    },
    ctx.context,
  );
  assert.deepEqual(result, { cancel: true });
  assert.equal(ctx.aborts, 0);
  assert.deepEqual(ctx.notifications, []);
  assert.equal(pi.entries.filter((item) => item.customType === "spine.compact.v1").length, 0);
  const continued = await pi.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: "continue",
      systemPrompt: "base system prompt",
      systemPromptOptions: {},
    },
    ctx.context,
  );
  assert.match(continued.systemPrompt, /spine_open/);
});

async function continueAfterSoftCancel(pi, ctx) {
  assert.equal(ctx.aborts, 0);
  assert.equal(pi.entries.filter((item) => item.customType === "spine.compact.v1").length, 0);
  const continued = await pi.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: "continue",
      systemPrompt: "base system prompt",
      systemPromptOptions: {},
    },
    ctx.context,
  );
  assert.match(continued.systemPrompt, /spine_open/);
}

function compactFixture() {
  const kept = user("keep this recent request");
  const entry = { type: "message", id: "kept-1", parentId: null, timestamp: "1", message: kept };
  return { kept, entry };
}

test("Pi compact model error notifies the provider reason and does not use the error body", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const { kept, entry } = compactFixture();
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      return {
        content: [{ type: "text", text: "## Goal\nDo not keep this error body." }],
        stopReason: "error",
        errorMessage: "provider overloaded",
      };
    },
  };
  ctx.context.sessionManager.getBranch = () => [entry];
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  const result = await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: { firstKeptEntryId: "kept-1", messagesToSummarize: [kept], turnPrefixMessages: [], tokensBefore: 1 },
      branchEntries: [entry],
      signal: new AbortController().signal,
      reason: "manual",
      willRetry: false,
    },
    ctx.context,
  );
  assert.deepEqual(result, { cancel: true });
  assert.deepEqual(ctx.notifications, [["provider overloaded", "error"]]);
  await continueAfterSoftCancel(pi, ctx);
});

test("Pi compact model error without errorMessage uses the stopReason fallback", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const { kept, entry } = compactFixture();
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      return {
        content: [{ type: "text", text: "looks like a summary" }],
        stopReason: "error",
        errorMessage: "   ",
      };
    },
  };
  ctx.context.sessionManager.getBranch = () => [entry];
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  const result = await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: { firstKeptEntryId: "kept-1", messagesToSummarize: [kept], turnPrefixMessages: [], tokensBefore: 1 },
      branchEntries: [entry],
      signal: new AbortController().signal,
      reason: "manual",
      willRetry: false,
    },
    ctx.context,
  );
  assert.deepEqual(result, { cancel: true });
  assert.deepEqual(ctx.notifications, [["Pi compaction model returned stopReason=error", "error"]]);
  await continueAfterSoftCancel(pi, ctx);
});

test("Pi compact empty summary cancels without latching a fault", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const { kept, entry } = compactFixture();
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      return { content: [{ type: "text", text: "   " }], stopReason: "stop" };
    },
  };
  ctx.context.sessionManager.getBranch = () => [entry];
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  const result = await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: { firstKeptEntryId: "kept-1", messagesToSummarize: [kept], turnPrefixMessages: [], tokensBefore: 1 },
      branchEntries: [entry],
      signal: new AbortController().signal,
      reason: "manual",
      willRetry: false,
    },
    ctx.context,
  );
  assert.deepEqual(result, { cancel: true });
  assert.deepEqual(ctx.notifications, [["Pi compaction model returned an empty summary", "error"]]);
  await continueAfterSoftCancel(pi, ctx);
});

test("Pi compact missing first-kept entry cancels without latching a fault", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const { kept, entry } = compactFixture();
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      return { content: [{ type: "text", text: "summary" }], stopReason: "stop" };
    },
  };
  ctx.context.sessionManager.getBranch = () => [entry];
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  const result = await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: { firstKeptEntryId: "missing", messagesToSummarize: [kept], turnPrefixMessages: [], tokensBefore: 1 },
      branchEntries: [entry],
      signal: new AbortController().signal,
      reason: "manual",
      willRetry: false,
    },
    ctx.context,
  );
  assert.deepEqual(result, { cancel: true });
  assert.deepEqual(ctx.notifications, [["Pi compaction first-kept entry is missing from the active branch", "error"]]);
  await continueAfterSoftCancel(pi, ctx);
});

test("Pi compact complete failure cancels without latching a fault", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const { kept, entry } = compactFixture();
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      throw new Error("summary model unavailable");
    },
  };
  ctx.context.sessionManager.getBranch = () => [entry];
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  const result = await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: { firstKeptEntryId: "kept-1", messagesToSummarize: [kept], turnPrefixMessages: [], tokensBefore: 1 },
      branchEntries: [entry],
      signal: new AbortController().signal,
      reason: "manual",
      willRetry: false,
    },
    ctx.context,
  );
  assert.deepEqual(result, { cancel: true });
  assert.deepEqual(ctx.notifications, [["summary model unavailable", "error"]]);
  await continueAfterSoftCancel(pi, ctx);
});

test("Pi compact commit failure still faults the live session", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  const { kept, entry } = compactFixture();
  ctx.context.model = { provider: "test", id: "test-model" };
  ctx.context.modelRegistry = {
    async complete() {
      return { content: [{ type: "text", text: "summary" }], stopReason: "stop" };
    },
  };
  ctx.context.sessionManager.getBranch = () => [entry];
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  await pi.emit(
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "test", input: ["keep"] } },
    ctx.context,
  );
  const result = await pi.emit(
    "session_before_compact",
    {
      type: "session_before_compact",
      preparation: { firstKeptEntryId: "kept-1", messagesToSummarize: [kept], turnPrefixMessages: [], tokensBefore: 1 },
      branchEntries: [entry],
      signal: new AbortController().signal,
      reason: "manual",
      willRetry: false,
    },
    ctx.context,
  );
  assert.deepEqual(result, { cancel: true });
  assert.equal(ctx.aborts, 1);
  assert.deepEqual(ctx.notifications, [["Spine faulted; current Pi operation aborted", "error"]]);
  await assert.rejects(
    () => pi.emit(
      "before_agent_start",
      {
        type: "before_agent_start",
        prompt: "continue",
        systemPrompt: "base system prompt",
        systemPromptOptions: {},
      },
      ctx.context,
    ),
    /Pi Spine extension is faulted/,
  );
});

test("user abort after Spine tool register drains leftover execution without latching", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  await pi.emit(
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "test", input: ["inspect"] } },
    ctx.context,
  );
  await pi.emit(
    "tool_call",
    {
      type: "tool_call",
      toolCallId: "open-1",
      toolName: "spine_open",
      input: { goal: "inspect" },
    },
    ctx.context,
  );
  assert.equal(ctx.aborts, 0);

  const aborted = new AbortController();
  aborted.abort();
  ctx.context.signal = aborted.signal;
  await pi.emit(
    "turn_end",
    { type: "turn_end", turnIndex: 0, message: assistant([], "error") },
    ctx.context,
  );
  assert.equal(ctx.aborts, 0);

  ctx.context.signal = new AbortController().signal;
  const continued = await pi.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: "continue",
      systemPrompt: "base system prompt",
      systemPromptOptions: {},
    },
    ctx.context,
  );
  assert.match(continued.systemPrompt, /spine_open/);
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


test("optional browser connects synchronously and core invalidates it on session shutdown", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  createPiExtension()(pi.api);
  const connections = [];
  const request = { version: 1, sessionId: "pi-session", accept: value => connections.push(value) };
  pi.api.events.emit(SPINE_TREE_VIEW_REQUEST, request);
  assert.equal(connections.length, 0);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  pi.api.events.emit(SPINE_TREE_VIEW_REQUEST, request);
  assert.equal(connections.length, 1);
  assert.equal(connections[0].snapshot.sessionId, "pi-session");
  const ended = [];
  connections[0].attach({ render: () => ["browser"], invalidate() {} }, reason => ended.push(reason));
  assert.deepEqual(widgetLines(ctx.widgets.at(-1)), ["browser"]);
  await pi.emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx.context);
  assert.deepEqual(ended, ["invalidated"]);
  pi.api.events.emit(SPINE_TREE_VIEW_REQUEST, request);
  assert.equal(connections.length, 1);
  assert.equal(ctx.aborts, 0);
});

test("widget registration failure does not poison canonical session initialization", async () => {
  const pi = mockPi();
  const ctx = extensionContext();
  ctx.context.ui.setWidget = () => { throw new Error("UI unavailable"); };
  createPiExtension()(pi.api);
  await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx.context);
  assert.equal(ctx.aborts, 0);
  const reply = await pi.emit("before_agent_start", { systemPrompt: "base" }, ctx.context);
  assert.ok(reply.systemPrompt.length > 0);
  let offered = false;
  pi.api.events.emit(SPINE_TREE_VIEW_REQUEST, { version: 1, sessionId: "pi-session", accept() { offered = true; } });
  assert.equal(offered, false);
  await pi.emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx.context);
  assert.equal(ctx.aborts, 0);
});
