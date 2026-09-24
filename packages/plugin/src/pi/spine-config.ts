import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PI_SPINE_CONFIG_URL = new URL("../../spine.toml", import.meta.url);

/** Loads the Pi-owned SpineConfig. Missing file is an error; there is no embedded fallback. */
export function loadPiSpineConfigToml(): string {
  return readFileSync(fileURLToPath(PI_SPINE_CONFIG_URL), "utf8");
}
