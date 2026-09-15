import assert from "node:assert/strict";
import test from "node:test";

import {
  executeSpawnBatch,
  recoverStagedSpawnResults,
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
  assert.deepEqual(staged.map(([, result]) => result.ordinal).sort(), [0, 1]);
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
