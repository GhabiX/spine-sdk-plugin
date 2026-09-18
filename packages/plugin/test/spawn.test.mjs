import assert from "node:assert/strict";
import test from "node:test";

import {
  executeSpawnBatch,
  recoverStagedSpawnResults,
  spawnResultsEqual,
  SpawnBatchExecutionError,
  SpawnRecoveryError,
} from "../dist/index.js";

const tasks = [
  { summary: "first", prompt: "run first" },
  { summary: "second", prompt: "run second" },
];

test("spawn returns task order and durably stages each terminal result", async () => {
  const releases = Promise.withResolvers();
  const staged = [];
  const results = await executeSpawnBatch({
    batchId: "batch-1",
    tasks,
    executor: {
      async execute(task, { ordinal }) {
        if (ordinal === 0) await releases.promise;
        else releases.resolve();
        return {
          outcome: "completed",
          memoryBody: `${task.summary}-memory`,
          executionRef: `child-${ordinal}`,
        };
      },
    },
    staging: {
      async persistTerminal(batchId, result) {
        staged.push([batchId, result]);
      },
    },
  });

  assert.deepEqual(results.map(({ ordinal }) => ordinal), [0, 1]);
  assert.deepEqual(results.map(({ memory_body }) => memory_body), ["first-memory", "second-memory"]);
  assert.deepEqual(results.map(({ diagnostic }) => diagnostic), [null, null]);
  assert.deepEqual(staged.map(([, result]) => result.ordinal).sort(), [0, 1]);
  assert.deepEqual(staged.map(([, result]) => result.diagnostic).sort(), [null, null]);
});

test("spawn rejects over-limit batches before starting child work", async () => {
  let executed = 0;
  const tooMany = Array.from({ length: 17 }, (_, ordinal) => ({
    summary: `task-${ordinal}`,
    prompt: "bounded assignment",
  }));
  await assert.rejects(
    executeSpawnBatch({
      batchId: "batch-too-many",
      tasks: tooMany,
      executor: {
        async execute() {
          executed += 1;
          return { outcome: "completed", memoryBody: "should not run" };
        },
      },
      staging: { async persistTerminal() {} },
    }),
    /at most 16 tasks/,
  );
  assert.equal(executed, 0);
});

test("spawn aborts siblings and rejects the whole batch without invented memory", async () => {
  let siblingAborted = false;
  const execution = executeSpawnBatch({
    batchId: "batch-fail",
    tasks,
    executor: {
      async execute(_task, { ordinal, signal }) {
        if (ordinal === 0) throw new Error("child crashed");
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        siblingAborted = true;
        throw signal.reason;
      },
    },
    staging: { async persistTerminal() {} },
  });

  await assert.rejects(
    execution,
    (error) => error instanceof SpawnBatchExecutionError && error.batchId === "batch-fail",
  );
  assert.equal(siblingAborted, true);
});

test("spawn waits for aborted siblings to terminate before rejecting", async () => {
  const siblingRelease = Promise.withResolvers();
  let siblingSettled = false;
  const execution = executeSpawnBatch({
    batchId: "batch-settle",
    tasks,
    executor: {
      async execute(_task, { ordinal, signal }) {
        if (ordinal === 0) throw new Error("child crashed");
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        await siblingRelease.promise;
        siblingSettled = true;
        throw signal.reason;
      },
    },
    staging: { async persistTerminal() {} },
  });
  const rejection = assert.rejects(execution, SpawnBatchExecutionError);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(siblingSettled, false);
  siblingRelease.resolve();
  await rejection;
  assert.equal(siblingSettled, true);
});

test("spawn rejects structurally invalid terminal results before staging", async () => {
  let persisted = false;
  await assert.rejects(
    executeSpawnBatch({
      batchId: "batch-invalid",
      tasks,
      executor: {
        async execute() {
          return { outcome: "errored", memoryBody: "bounded failure memory" };
        },
      },
      staging: { async persistTerminal() { persisted = true; } },
    }),
    SpawnBatchExecutionError,
  );
  assert.equal(persisted, false);
});

test("spawn rejects a terminal memory that exceeds the core byte limit", async () => {
  let persisted = false;
  await assert.rejects(
    executeSpawnBatch({
      batchId: "batch-large-memory",
      tasks,
      executor: {
        async execute() {
          return { outcome: "completed", memoryBody: "m".repeat(32 * 1024 + 1) };
        },
      },
      staging: { async persistTerminal() { persisted = true; } },
    }),
    SpawnBatchExecutionError,
  );
  assert.equal(persisted, false);
});

test("spawn result equality treats omitted optional fields as JSON null", () => {
  const omitted = {
    ordinal: 0,
    outcome: "completed",
    memory_body: "ALPHA",
    execution_ref: "spawn-1:0",
  };
  const wasm = {
    ordinal: 0,
    outcome: "completed",
    memory_body: "ALPHA",
    diagnostic: null,
    execution_ref: "spawn-1:0",
  };
  assert.equal(spawnResultsEqual(omitted, wasm), true);
  assert.notEqual(JSON.stringify(omitted), JSON.stringify(wasm));
  assert.equal(spawnResultsEqual(omitted, { ...wasm, memory_body: "BETA" }), false);
  assert.equal(spawnResultsEqual(omitted, { ...wasm, diagnostic: "child stderr" }), false);
  assert.equal(
    spawnResultsEqual(
      { ordinal: 0, outcome: "completed", memory_body: "ALPHA" },
      { ordinal: 0, outcome: "completed", memory_body: "ALPHA", diagnostic: null, execution_ref: null },
    ),
    true,
  );
});

test("spawn recovery restores task order and rejects partial staging", () => {
  const staged = [
    { ordinal: 1, outcome: "completed", memory_body: "second memory" },
    { ordinal: 0, outcome: "completed", memory_body: "first memory" },
  ];
  assert.deepEqual(
    recoverStagedSpawnResults(tasks, staged).map(({ ordinal }) => ordinal),
    [0, 1],
  );
  assert.throws(
    () => recoverStagedSpawnResults(tasks, staged.slice(0, 1)),
    SpawnRecoveryError,
  );
});
