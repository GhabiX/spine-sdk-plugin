import { createRequire } from "node:module";

import {
  encodeInit,
  type FeatureFlag,
  type SafeInteger,
  type ThreadNamespace,
} from "./protocol.js";
import { SpineRuntimeClient, type RuntimeTransport } from "./runtime.js";

interface WasmSpineRuntime {
  dispatch(requestJson: string): string;
  extend_system_prompt(base: string): string;
  node_prompt(): string;
  tool_catalog_json(): string;
  free(): void;
}

interface WasmSpineRuntimeConstructor {
  new(initJson: string): WasmSpineRuntime;
}

const require = createRequire(import.meta.url);
const binding = require("../wasm/node/spine_wasm.cjs") as {
  SpineRuntime: WasmSpineRuntimeConstructor;
};

export interface NodeSpineRuntimeOptions {
  thread: ThreadNamespace;
  epoch?: SafeInteger;
  configToml?: string | null;
  features?: FeatureFlag[];
  sourceDigestVersion?: "v1" | "v2";
}

export interface SpineToolSpec {
  id: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NodeSpineRuntime {
  client: SpineRuntimeClient;
  extendSystemPrompt(base: string): string;
  nodePrompt(): string;
  toolCatalog(): SpineToolSpec[];
  dispose(): void;
}

/** Creates one stateful portable runtime backed by the packaged Node WASM artifact. */
export function createNodeSpineRuntime(options: NodeSpineRuntimeOptions): NodeSpineRuntime {
  const native = new binding.SpineRuntime(
    encodeInit({
      thread: options.thread,
      ...(options.epoch === undefined ? {} : { epoch: options.epoch }),
      ...(options.configToml === undefined ? {} : { config_toml: options.configToml }),
      ...(options.features === undefined ? {} : { features: options.features }),
      ...(options.sourceDigestVersion === undefined
        ? {}
        : { source_digest_version: options.sourceDigestVersion }),
    }),
  );
  let disposed = false;
  const transport: RuntimeTransport = {
    dispatch(requestJson) {
      if (disposed) {
        throw new Error("Spine Node runtime is disposed");
      }
      return native.dispatch(requestJson);
    },
  };
  return {
    client: new SpineRuntimeClient(transport),
    extendSystemPrompt(base: string) {
      if (disposed) {
        throw new Error("Spine Node runtime is disposed");
      }
      return native.extend_system_prompt(base);
    },
    nodePrompt() {
      if (disposed) {
        throw new Error("Spine Node runtime is disposed");
      }
      return native.node_prompt();
    },
    toolCatalog() {
      if (disposed) {
        throw new Error("Spine Node runtime is disposed");
      }
      return JSON.parse(native.tool_catalog_json()) as SpineToolSpec[];
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        native.free();
      }
    },
  };
}
