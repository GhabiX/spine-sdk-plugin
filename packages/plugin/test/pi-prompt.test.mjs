import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptSpineSystemPromptForPi,
  PI_SPINE_FINALIZE_INSTRUCTION,
  rewriteSpineToolNamesForPi,
} from "../dist/pi/prompt.js";

test("Pi instruction uses underscored tool names because providers reject spine.open", () => {
  const rewritten = rewriteSpineToolNamesForPi(
    "Use `spine.open`, then `spine.next` or `spine.close`. Parallel work uses `spine.spawn`.",
  );
  assert.equal(
    rewritten,
    "Use `spine_open`, then `spine_next` or `spine_close`. Parallel work uses `spine_spawn`.",
  );
  assert.doesNotMatch(rewritten, /spine\.(open|close|next|spawn)/);
});

test("Pi system prompt overlays the finalize instruction after D&C ownership", () => {
  const source = [
    "<spine_instruction>",
    "When progress exposes a recognizable semantic work unit, first determine its nearest owning scope on the active path. Child relationships **MUST** follow direct semantic ownership: a child goal **MUST** be a direct sub-obligation in the active branch goal's decomposition. Work does not belong to the active branch merely because it was discovered or became actionable while working there.",
    "",
    "Create a SpineBranch for each semantic work unit promptly at its owning level before doing substantive work on it. If the active branch owns it, immediately use `spine.open`.",
    "</spine_instruction>",
  ].join("\n");

  const adapted = adaptSpineSystemPromptForPi(source);
  assert.match(adapted, /spine_open/);
  assert.doesNotMatch(adapted, /spine\.open/);
  assert.equal(adapted.split(PI_SPINE_FINALIZE_INSTRUCTION).length - 1, 1);
  assert.equal(
    adapted.includes(
      `became actionable while working there.\n\n${PI_SPINE_FINALIZE_INSTRUCTION}\n\nCreate a SpineBranch`,
    ),
    true,
  );
  assert.equal(adaptSpineSystemPromptForPi(adapted), adapted);
});

test("Pi overlay is a no-op without the Spine instruction", () => {
  assert.equal(adaptSpineSystemPromptForPi("base system prompt"), "base system prompt");
});

test("Pi overlay fails closed if the instruction is present but the ownership paragraph is missing", () => {
  assert.throws(
    () => adaptSpineSystemPromptForPi("<spine_instruction>\nUse spine.open\n</spine_instruction>"),
    /D&C ownership paragraph/,
  );
});
