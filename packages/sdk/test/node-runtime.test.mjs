import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

import { encodeInit, SPINE_SDK_SCHEMA } from "../dist/index.js";

import { createNodeSpineRuntime, validateSpineToolInput } from "../dist/node.js";

test("Node SDK delegates tool input admission to the pure core validator", () => {
  assert.deepEqual(
    validateSpineToolInput("open", { goal: " inspect " }),
    { type: "open", summary: "inspect" },
  );
  assert.throws(
    () => validateSpineToolInput("spawn", {
      tasks: Array.from({ length: 17 }, () => ({ summary: "s", prompt: "p" })),
    }),
    /at most 16 tasks/,
  );
});

test("packaged Node WASM runtime executes the portable SDK protocol", async () => {
  const runtime = createNodeSpineRuntime({
    thread: "pi-session",
    features: ["jit", "spawn"],
  });
  try {
    const source = await runtime.client.execute({ type: "source_snapshot" });
    assert.equal(source.type, "source_snapshot");
    assert.equal(source.source.thread, "pi-session");
    assert.deepEqual(source.source.cells, []);
  } finally {
    runtime.dispose();
  }

  await assert.rejects(
    runtime.client.execute({ type: "source_snapshot" }),
    /Spine Node runtime is disposed/,
  );
});

test("Node runtime delegates canonical prompt composition and preserves feature-off identity", () => {
  const enabled = createNodeSpineRuntime({ thread: "prompt-enabled", features: ["jit", "spawn"] });
  const disabled = createNodeSpineRuntime({ thread: "prompt-disabled" });
  try {
    assert.match(enabled.extendSystemPrompt("base"), /^base\n\n<spine_instruction>/);
    assert.equal(disabled.extendSystemPrompt("base"), "base");
  } finally {
    enabled.dispose();
    disabled.dispose();
  }
});


test("packaged v2 runtime rejects old initialization and commands without changing its plan", () => {
  const { SpineRuntime } = createRequire(import.meta.url)("../wasm/node/spine_wasm.cjs");
  assert.throws(
    () => new SpineRuntime(JSON.stringify({ schema: "spine-sdk/v1", thread: "old-client" })),
    (error) => String(error).includes("unsupported_schema"),
  );
  const runtime = new SpineRuntime(encodeInit({ thread: "protocol-pair" }));
  try {
    const command = (schema) => JSON.parse(runtime.dispatch(JSON.stringify({
      schema, request: { type: "preview" },
    })));
    const before = command(SPINE_SDK_SCHEMA);
    assert.equal(before.ok, true);
    assert.deepEqual(before.result.context_plan, {
      schema: "spine.context.plan.v2", thread: "protocol-pair", epoch: 0, cells: [],
    });
    const rejected = command("spine-sdk/v1");
    assert.deepEqual(rejected, {
      schema: SPINE_SDK_SCHEMA,
      ok: false,
      error: {
        code: "unsupported_schema",
        message: `expected ${SPINE_SDK_SCHEMA}, received spine-sdk/v1`,
      },
    });
    assert.deepEqual(command(SPINE_SDK_SCHEMA), before);
  } finally {
    runtime.free();
  }
});
