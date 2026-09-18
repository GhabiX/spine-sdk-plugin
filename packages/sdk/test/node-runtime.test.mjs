import assert from "node:assert/strict";
import test from "node:test";

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
