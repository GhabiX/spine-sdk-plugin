import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { strict as assert } from "node:assert";

test("composition uses the latest runtime snapshot for the previously verified mixed contract", () => {
  const root = "/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/runtime-composition";
  const manifest = JSON.parse(readFileSync("/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/collaboration/runtime-manifest-live.json", "utf8"));
  assert.equal(manifest.sdkCommit, "eeea5d68ff1231be43206c4038f43dc2154d8ddf");
  assert.equal(readFileSync(join(root, "sdk/packages/spinetree-plugin/package.json"), "utf8").includes("spinetree"), true);
});
