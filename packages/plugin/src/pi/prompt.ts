/** Pi/xAI Chat Completions cannot carry `spine.open` as a function name. */
const PI_SPINE_TOOL_REWRITES: ReadonlyArray<readonly [string, string]> = [
  ["spine.spawn", "spine_spawn"],
  ["spine.open", "spine_open"],
  ["spine.close", "spine_close"],
  ["spine.next", "spine_next"],
];

/** Idempotent overlay: canonical `spine.toml` JIT already contains this sentence. */
export const PI_SPINE_FINALIZE_INSTRUCTION =
  "Finalize a SpineBranch when its owned obligation is complete; if a user message is a new obligation rather than the current one, it exposes a semantic work unit that belongs at its owning level.";

const D_AND_C_OWNERSHIP_PARAGRAPH_END =
  "Work does not belong to the active branch merely because it was discovered or became actionable while working there.\n\n";

export function rewriteSpineToolNamesForPi(text: string): string {
  let rewritten = text;
  for (const [canonical, piName] of PI_SPINE_TOOL_REWRITES) {
    rewritten = rewritten.split(canonical).join(piName);
  }
  return rewritten;
}

export function adaptSpineSystemPromptForPi(text: string): string {
  return insertPiFinalizeInstruction(rewriteSpineToolNamesForPi(text));
}

function insertPiFinalizeInstruction(text: string): string {
  if (text.includes(PI_SPINE_FINALIZE_INSTRUCTION)) {
    return text;
  }
  if (!text.includes(D_AND_C_OWNERSHIP_PARAGRAPH_END)) {
    if (text.includes("<spine_instruction>")) {
      throw new Error("Pi Spine instruction overlay could not find the D&C ownership paragraph");
    }
    return text;
  }
  return text.replace(
    D_AND_C_OWNERSHIP_PARAGRAPH_END,
    `${D_AND_C_OWNERSHIP_PARAGRAPH_END}${PI_SPINE_FINALIZE_INSTRUCTION}\n\n`,
  );
}
