import assert from "node:assert/strict";
import test from "node:test";

import { rewriteSpineToolNamesForPi } from "../dist/pi/prompt.js";

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
