/** Pi/xAI Chat Completions cannot carry `spine.open` as a function name. */
const PI_SPINE_TOOL_REWRITES: ReadonlyArray<readonly [string, string]> = [
  ["spine.spawn", "spine_spawn"],
  ["spine.open", "spine_open"],
  ["spine.close", "spine_close"],
  ["spine.next", "spine_next"],
];

export function rewriteSpineToolNamesForPi(text: string): string {
  let rewritten = text;
  for (const [canonical, piName] of PI_SPINE_TOOL_REWRITES) {
    rewritten = rewritten.split(canonical).join(piName);
  }
  return rewritten;
}
