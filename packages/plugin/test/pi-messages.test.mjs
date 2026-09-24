import assert from "node:assert/strict";
import test from "node:test";

import {
  isPiHostSystemMessage,
  materializePiContext,
  PiContextMaterializationError,
  PiSourceBindings,
  sourceObservation,
} from "../dist/pi/index.js";

const SOURCE_ID = { thread: "pi-session", epoch: 0, ordinal: 0 };

test("Pi host system messages are not conversation sources", () => {
  assert.equal(isPiHostSystemMessage({ role: "system" }), true);
  assert.equal(isPiHostSystemMessage({ role: "user" }), false);
  assert.equal(isPiHostSystemMessage({ role: "toolResult" }), false);
});

test("Pi source observations preserve native messages outside the semantic core", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "abc", mimeType: "image/png" },
      { type: "text", text: "inspect" },
    ],
    timestamp: 42,
  };
  const observation = sourceObservation(message, 7);

  assert.equal(observation.character.type, "message");
  assert.equal(observation.character.role, "user");
  assert.equal(observation.character.boundary, 7);
  assert.equal(observation.character.type === "message" ? observation.character.content : null, "<image>inspect");
  assert.deepEqual(observation.message, message);
  assert.deepEqual(sourceObservation({
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "read",
    content: [{ type: "text", text: "contents" }],
    isError: false,
    timestamp: 43,
  }, 8).character, { type: "opaque", boundary: 8 });
});

test("Pi context materialization resolves exact source identity and user anchors", () => {
  const bindings = new PiSourceBindings();
  const original = { role: "user", content: "request", timestamp: 42 };
  bindings.bind(SOURCE_ID, original);
  const context = {
    transactionId: "preview:plan-1",
    contextPlan: {
      schema: "spine.context.plan.v1",
      thread: "pi-session",
      epoch: 0,
      source_snapshot_digest: "source",
      cells: [
        { type: "source", source_id: SOURCE_ID, labels: [{ UserAnchor: 3 }] },
      ],
      memory_slots: [],
      plan_digest: "plan-1",
    },
    projection: { nodes: [], cursor: [0], visible_context: [], last_boundary: 0 },
  };

  assert.deepEqual(materializePiContext(context, bindings), [
    { role: "user", content: "[U3]\nrequest", timestamp: 42 },
  ]);
  assert.deepEqual(original, { role: "user", content: "request", timestamp: 42 });
});

test("Pi renders only the canonical Spine-owned projection forms", () => {
  const bindings = new PiSourceBindings();
  const projection = (item, ordinal) => ({
    type: "projection",
    projection_id: { thread: "pi-session", epoch: 0, ordinal },
    item,
  });
  const context = {
    transactionId: "commit-1",
    contextPlan: {
      schema: "spine.context.plan.v1",
      thread: "pi-session",
      epoch: 0,
      source_snapshot_digest: "source",
      cells: [
        projection({ SyntheticNode: {
          node_id: [0, 1], summary: "child <scope>", status: "Opened",
        } }, 0),
        projection({ MemorySlot: { Summary: {
          owner_node: [0, 2], source: { start: 1, end: 2 }, body: "memory",
        } } }, 1),
        projection({ MemorySlot: { SpawnEvidence: {
          owner_node: [0],
          source: { start: 3, end: 3 },
          task: { summary: "task", prompt: "prompt" },
          outcome: "completed",
          diagnostic: null,
          execution_ref: "child-1",
        } } }, 2),
      ],
      memory_slots: [],
      plan_digest: "plan-1",
    },
    projection: { nodes: [], cursor: [0], visible_context: [], last_boundary: 0 },
  };

  const messages = materializePiContext(context, bindings, {
    nodePrompt: "KEEP subsequent work inside this branch.",
  });
  assert.equal(messages[0].content,
    '<spine_node id="0.1" summary="child &lt;scope&gt;" status="opened">\nKEEP subsequent work inside this branch.\n</spine_node>');
  assert.equal(messages[1].content,
    '<spine_memory node_id="0.2">\nmemory\n</spine_memory>');
  assert.match(messages[2].content, /^<spine_spawn_evidence node_id="0">/);
});

test("Pi materialization applies an entry projection without matching message text", () => {
  const bindings = new PiSourceBindings();
  const kept = { role: "user", content: "keep", timestamp: 1 };
  const omitted = { role: "user", content: "OMITTED", timestamp: 2 };
  const rewritten = {
    role: "assistant",
    content: [{ type: "text", text: "old" }],
    timestamp: 3,
  };
  const source = (ordinal) => ({ thread: "pi-session", epoch: 0, ordinal });
  bindings.bind(source(0), kept, "keep");
  bindings.bind(source(1), omitted, "omit");
  bindings.bind(source(2), rewritten, "edit");
  const cell = (ordinal, labels = []) => ({
    type: "source",
    source_id: source(ordinal),
    labels,
  });
  const messages = materializePiContext({
    transactionId: "preview:plan",
    contextPlan: {
      schema: "spine.context.plan.v1",
      thread: "pi-session",
      epoch: 0,
      source_snapshot_digest: "source",
      cells: [
        cell(0, [{ UserAnchor: 4 }]),
        cell(1, [{ UserAnchor: 5 }]),
        cell(2),
      ],
      memory_slots: [],
      plan_digest: "plan",
    },
    projection: { nodes: [], cursor: [], visible_context: [], last_boundary: null },
  }, bindings, {
    projectedMessages: new Map([
      ["keep", [kept]],
      ["omit", []],
      ["edit", [{ ...rewritten, content: [{ type: "text", text: "new" }] }]],
    ]),
  });

  assert.deepEqual(messages, [
    { role: "user", content: "[U4]\nkeep", timestamp: 1 },
    { ...rewritten, content: [{ type: "text", text: "new" }] },
  ]);
});

test("Pi fails closed for missing source identity and unsupported projection", () => {
  const plan = (cell) => ({
    transactionId: "preview:plan",
    contextPlan: {
      schema: "spine.context.plan.v1",
      thread: "pi-session",
      epoch: 0,
      source_snapshot_digest: "source",
      cells: [cell],
      memory_slots: [],
      plan_digest: "plan",
    },
    projection: { nodes: [], cursor: [], visible_context: [], last_boundary: null },
  });
  const bindings = new PiSourceBindings();

  assert.throws(
    () => materializePiContext(plan({ type: "source", source_id: SOURCE_ID, labels: [] }), bindings),
    PiContextMaterializationError,
  );
  assert.throws(
    () => materializePiContext(plan({
      type: "projection",
      projection_id: SOURCE_ID,
      item: { Message: { message: { boundary: 0, role: "User", content: "x" }, user_anchor: null } },
    }), bindings),
    PiContextMaterializationError,
  );
});
