import assert from "node:assert/strict";
import test from "node:test";

import {
  executeSpawnBatch,
  recoverStagedSpawnResults,
  spawnResultsEqual,
  SpawnBatchExecutionError,
  SpawnRecoveryCancelledError,
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

test("recoverable spawn gates settled failures and stages final results once", async () => {
  const attempts = [];
  const staged = [];
  const decisions = [{ action: "continue" }, { action: "abandon" }];
  const results = await executeSpawnBatch({
    batchId: "recoverable",
    tasks,
    recovery: {
      async choose(failures) {
        assert.deepEqual(failures.map((failure) => failure.ordinal), [0]);
        return decisions.shift();
      },
    },
    executor: {
      async execute(task, context) {
        attempts.push([task.summary, context.ordinal, context.attempt, context.mode]);
        return context.ordinal === 0
          ? { outcome: "errored", memoryBody: "failed", diagnostic: "failed" }
          : { outcome: "completed", memoryBody: "done" };
      },
    },
    staging: { async persistTerminal(_batchId, result) { staged.push(result); } },
  });
  assert.deepEqual(attempts, [
    ["first", 0, 0, "initial"],
    ["second", 1, 0, "initial"],
    ["first", 0, 0, "continue"],
  ]);
  assert.deepEqual(results.map((result) => result.outcome), ["errored", "completed"]);
  assert.deepEqual(staged.map((result) => result.ordinal), [0, 1]);
});

test("recoverable spawn exposes Continue capability without changing the receipt", async () => {
  const seen = [];
  const staged = [];
  const results = await executeSpawnBatch({
    batchId: "recoverability",
    tasks,
    recovery: {
      async choose(failures) {
        seen.push(failures.map(({ ordinal, continueable, continueReason }) => ({
          ordinal,
          continueable,
          continueReason,
        })));
        return { action: "abandon" };
      },
    },
    executor: {
      async execute(task, context) {
        return context.ordinal === 0
          ? {
            outcome: "errored",
            memoryBody: "session cannot continue",
            diagnostic: "session identity changed",
            recovery: { continueable: false, reason: "session identity changed" },
          }
          : { outcome: "completed", memoryBody: `${task.summary}-memory` };
      },
    },
    staging: { async persistTerminal(_batchId, result) { staged.push(result); } },
  });
  assert.deepEqual(seen, [[{
    ordinal: 0,
    continueable: false,
    continueReason: "session identity changed",
  }]]);
  assert.equal("continueable" in results[0], false);
  assert.deepEqual(staged.map(({ ordinal }) => ordinal), [0, 1]);
});

test("recoverable spawn rejects an impossible Continue decision", async () => {
  const staged = [];
  await assert.rejects(
    executeSpawnBatch({
      batchId: "continue-unavailable",
      tasks,
      recovery: {
        async choose() {
          return { action: "continue" };
        },
      },
      executor: {
        async execute(_task, context) {
          return context.ordinal === 0
            ? {
              outcome: "errored",
              memoryBody: "session cannot continue",
              diagnostic: "session identity changed",
              recovery: { continueable: false, reason: "session identity changed" },
            }
            : { outcome: "completed", memoryBody: "done" };
        },
      },
      staging: { async persistTerminal(_batchId, result) { staged.push(result); } },
    }),
    SpawnRecoveryError,
  );
  assert.deepEqual(staged, []);
});

test("recoverable spawn cancellation does not stage provisional results", async () => {
  const attempts = [];
  const staged = [];
  const controller = new AbortController();
  await assert.rejects(
    executeSpawnBatch({
      batchId: "retry",
      tasks,
      signal: controller.signal,
      recovery: {
        async choose() {
          controller.abort();
          return { action: "retry" };
        },
      },
      executor: {
        async execute(task, context) {
          attempts.push([task.summary, context.attempt, context.mode]);
          return { outcome: "errored", memoryBody: "failed", diagnostic: "failed" };
        },
      },
      staging: { async persistTerminal(_batchId, result) { staged.push(result); } },
    }),
    SpawnRecoveryCancelledError,
  );
  assert.deepEqual(attempts, [["first", 0, "initial"], ["second", 0, "initial"]]);
  assert.deepEqual(staged, []);
});
