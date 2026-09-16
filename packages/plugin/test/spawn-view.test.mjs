import assert from "node:assert/strict";
import test from "node:test";

import {
  applySpawnTerminal,
  createSpawnBatchView,
  markSpawnTask,
  renderSpawnCall,
  renderSpawnResult,
  spawnFallbackText,
} from "../dist/pi/spawn-view.js";

const theme = {
  fg(_color, text) {
    return text;
  },
  bold(text) {
    return text;
  },
};

test("spawn view assigns Codex activity words and live/settled markers", () => {
  const view = createSpawnBatchView([
    { summary: "inspect auth", prompt: "auth" },
    { summary: "inspect models", prompt: "models" },
    { summary: "inspect providers", prompt: "providers" },
  ]);
  assert.deepEqual(
    view.tasks.map((task) => task.activityWord),
    ["Germinating", "Budding", "Sprouting"],
  );
  assert.equal(view.tasks.every((task) => task.status === "running"), true);
  assert.match(spawnFallbackText(view), /  ├ ◐ Germinating inspect auth/);

  applySpawnTerminal(view, 1, {
    ordinal: 1,
    outcome: "completed",
    memory_body: "models done",
  });
  markSpawnTask(view, 2, "errored", "child failed");
  const text = spawnFallbackText(view);
  assert.match(text, /├ ◐ Germinating inspect auth/);
  assert.match(text, /├ ✓ Budding inspect models/);
  assert.match(text, /└ × Sprouting inspect providers/);
  assert.equal(text.includes("⏳"), false);
  assert.equal(text.includes("Spine Spawn"), false);
  assert.equal(text.includes("settled"), false);
});

test("spawn renderers keep the SpineCodex marker language", () => {
  const view = createSpawnBatchView([
    { summary: "inspect auth", prompt: "auth" },
    { summary: "inspect models", prompt: "models" },
  ]);
  applySpawnTerminal(view, 0, {
    ordinal: 0,
    outcome: "completed",
    memory_body: "auth memory\nsecond line\nthird",
  });
  const header = renderSpawnCall(2, theme).render(80);
  assert.deepEqual(header, ["spine_spawn  2 tasks"]);

  const collapsed = renderSpawnResult(view, false, theme).render(80);
  assert.equal(collapsed.some((line) => line.includes("Spine Spawn")), false);
  assert.match(collapsed[0], /✓ Germinating inspect auth/);
  assert.match(collapsed[1], /◐ Budding inspect models/);
  assert.equal(collapsed.some((line) => line.includes("auth memory")), false);

  const expanded = renderSpawnResult(view, true, theme).render(80);
  assert.equal(expanded.some((line) => line.includes("auth memory")), true);
  assert.equal(expanded.some((line) => /⏳|✔|❌/.test(line)), false);
});
