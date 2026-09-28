import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { createPiPluginExtension } from "../runtime/poc/src/poc/pi-plugin-extension.mjs";

const workspace = process.env.SPINE_PLUGIN_WORKSPACE;
if (!workspace) throw new Error("Sampling fixture requires an isolated SPINE_PLUGIN_WORKSPACE");
const { SessionManager } = await import(pathToFileURL(resolve(workspace,
  "node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js")).href);
const { createEventBus } = await import(pathToFileURL(resolve(workspace,
  "node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js")).href);

// Replace only Pi's provider/child-process boundary. Session replay, canonical
// sampling, the actual extension, Git CAS and Scope importer all execute.
export async function samplingFixture({ directory, sessionFile, options, child = false, executeChild, beforeAppend, beforeChildExec }) {
  const session = sessionFile === undefined
    ? SessionManager.create(directory, resolve(directory, "sessions"))
    : SessionManager.open(sessionFile, undefined, directory);
  const handlers = new Map();
  const tools = new Map();
  const commits = [];
  const pendingMessages = [];
  let aborts = 0;
  let turnIndex = 0;
  const pi = {
    events: createEventBus(),
    registerFlag() {}, getFlag: name => name === "spine-child" && child,
    registerCommand() {},
    getActiveTools() { return this.activeTools ?? [...tools.keys()]; },
    setActiveTools(names) { this.activeTools = [...names]; },
    registerTool(tool) { tools.set(tool.name, tool); },
    appendEntry(type, data) { beforeAppend?.(type, data); session.appendCustomEntry(type, data); },
    sendMessage(message, options) {
      assert.deepEqual(options, { triggerTurn: false });
      pendingMessages.push(message);
    },
    on(name, handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
    async exec(command, args, execOptions) {
      await beforeChildExec?.({ command, args, execOptions });
      assert.equal(command, process.execPath);
      const config = JSON.parse(args[args.indexOf("--spine-child-config") + 1]);
      const childSessionFile = args[args.indexOf("--session") + 1];
      const nested = await samplingFixture({ directory, sessionFile: childSessionFile,
        options: { spinetree: config.spinetree }, child: true, executeChild });
      assert.equal(execOptions.signal.aborted, false);
      await nested.start(args.at(-1));
      try {
        const memory = await executeChild(nested, config.spinetree);
        const result = await nested.turn([{ name: "spine_child_return", input: { memory } }]);
        return { code: 0, killed: false, stderr: "", stdout: JSON.stringify({ type: "message_end", message: result.message }) };
      } finally {
        await nested.shutdown();
      }
    },
  };
  const context = {
    mode: "rpc", hasUI: false, cwd: directory,
    sessionManager: session,
    ui: { notify() {}, setWidget() {} },
    abort() { aborts += 1; },
    isIdle() { return true; },
  };
  await createPiPluginExtension({ ...options, canonical: {
    ...options.canonical,
    async onSamplingCommit(info) {
      commits.push(structuredClone(info.commit));
      await options.canonical?.onSamplingCommit?.(info);
    },
  } })(pi);
  async function emit(name, event) {
    const results = [];
    for (const handler of handlers.get(name) ?? []) results.push(await handler(event, context));
    return results;
  }
  function assertHealthy(expectedAborts = 0) {
    assert.equal(aborts, expectedAborts, JSON.stringify(session.getBranch().filter(entry => entry.customType === "spine.fault.v1")));
  }
  async function appendCustom(message) {
    await emit("message_end", { type: "message_end", message: {
      role: "custom", ...message, timestamp: Date.now(),
    } });
    session.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
  }
  return {
    session, commits, get aborts() { return aborts; },
    async start(prompt = "Exercise general Scope ownership") {
      await emit("session_start", { type: "session_start", reason: "new" });
      assertHealthy();
      const message = { role: "user", content: prompt, timestamp: Date.now() };
      await emit("message_end", { type: "message_end", message });
      session.appendMessage(message);
      for (const result of await emit("before_agent_start", { type: "before_agent_start" })) {
        if (result?.message) await appendCustom(result.message);
      }
      assertHealthy();
    },
    async shutdown(reason = "quit") { await emit("session_shutdown", { type: "session_shutdown", reason }); },
    async reload() {
      await emit("session_shutdown", { type: "session_shutdown", reason: "reload" });
      await emit("session_start", { type: "session_start", reason: "reload" });
      assertHealthy();
    },
    async turn(calls, { beforeCommit = () => {}, expectedAborts = 0 } = {}) {
      await emit("context", { type: "context", messages: [] });
      await emit("before_provider_request", { type: "before_provider_request", payload: { model: "no-provider-fixture" } });
      assertHealthy();
      const index = ++turnIndex;
      const message = { role: "assistant", api: "test", provider: "test", model: "test",
        content: calls.length ? calls.map(({ name, input }, ordinal) => ({
          type: "toolCall", id: `fixture-${session.getSessionId()}-${index}-${ordinal}`, name, arguments: input,
        })) : [{ type: "text", text: "Parent continued after committed join" }],
        stopReason: calls.length ? "toolUse" : "stop", timestamp: Date.now(), usage: { input: 1, output: 1 },
      };
      session.appendMessage(message);
      await emit("message_end", { type: "message_end", message });
      const results = [];
      for (const call of message.content.filter(item => item.type === "toolCall")) {
        const event = { toolCallId: call.id, toolName: call.name, input: call.arguments };
        const admissions = await emit("tool_call", { type: "tool_call", ...event });
        assert.ok(admissions.every(item => !item?.block), JSON.stringify(admissions));
        let result;
        try {
          result = await tools.get(call.name).execute(call.id, call.arguments, undefined, undefined, context);
        } catch (error) {
          throw new Error(inspect(error, { depth: 8 }), { cause: error });
        }
        assert.equal(result.isError, undefined, JSON.stringify(result));
        await emit("tool_result", { type: "tool_result", ...event, ...result, isError: false });
        const resultMessage = { role: "toolResult", toolCallId: call.id, toolName: call.name,
          ...result, isError: false, timestamp: Date.now() };
        session.appendMessage(resultMessage);
        await emit("message_end", { type: "message_end", message: resultMessage });
        results.push(resultMessage);
      }
      await beforeCommit();
      await emit("turn_end", { type: "turn_end", turnIndex: index, message, toolResults: results });
      for (const message of pendingMessages.splice(0)) session.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
      assertHealthy(expectedAborts);
      return { message, results };
    },
  };
}
