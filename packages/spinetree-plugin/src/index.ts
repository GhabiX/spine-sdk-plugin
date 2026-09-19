import type { PluginManifest, PluginTool, SpinePlugin, SpinePluginContext } from "@spinejit/spine-host";

export const SPINETREE_PLUGIN_MANIFEST: PluginManifest = {
  schema: "spine-host/v1",
  id: "@spinetree/plugin",
  version: "0.1.0",
  requires: ["@spinejit/spine-plugin"],
  owns: ["spinetree.project-state"],
  toolNamespace: "spinetree",
  commandNamespace: "spinetree",
  storageNamespace: "spinetree",
};

export function createSpineTreePlugin(): SpinePlugin {
  return {
    manifest: SPINETREE_PLUGIN_MANIFEST,
    activate(context) {
      for (const operation of ["read", "change", "send", "rejuvenate"] as const) {
        context.tools.register(operation, contractTool(context, operation));
      }
      context.commands.register("status", {
        description: "Inspect the SpineTree plugin contract status",
        execute: async () => ({ status: "contract-only" }),
      });
    },
  };
}

function contractTool(context: SpinePluginContext, operation: string): PluginTool {
  return {
    description: `SpineTree ${operation} contract placeholder`,
    execute: async () => ({
      schema: "spinetree.operation.result/v1",
      operation,
      status: "contract-only",
      storageNamespace: context.manifest.storageNamespace ?? null,
    }),
  };
}
