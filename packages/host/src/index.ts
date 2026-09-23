export const SPINE_HOST_CONTRACT_SCHEMA = "spine-host/v1" as const;

export interface PluginManifest {
  readonly schema: typeof SPINE_HOST_CONTRACT_SCHEMA;
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly string[];
  readonly owns?: readonly string[];
  readonly toolNamespace?: string;
  readonly commandNamespace?: string;
  readonly storageNamespace?: string;
}

export interface PluginToolDescription {
  readonly description: string;
  /** JSON Schema for the input object; validation is owned by the tool or its caller. */
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface PluginTool extends PluginToolDescription {
  execute(input: unknown): Promise<unknown> | unknown;
}

export interface PluginCommand {
  readonly description: string;
  execute(arguments_: readonly string[]): Promise<unknown> | unknown;
}

export interface PluginTools {
  register(localName: string, tool: PluginTool): void;
  list(): readonly string[];
}

export interface PluginCommands {
  register(localName: string, command: PluginCommand): void;
  list(): readonly string[];
}

export interface PluginStorage {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): boolean;
  keys(): readonly string[];
}

export interface SpineHostEvent {
  readonly type: string;
  readonly sequence: number;
  readonly payload: unknown;
}

export interface PluginEvents {
  observe(type: string, listener: (event: SpineHostEvent) => void): () => void;
}

export interface PiSessionRequest {
  readonly targetSessionId: string;
  readonly operation: "prompt" | "steer";
  readonly text: string;
  readonly requestId?: string;
}

export interface PiSessionResponse {
  readonly accepted: boolean;
  readonly requestId?: string;
}

export interface PiSessionAdapter {
  request(request: PiSessionRequest): Promise<PiSessionResponse>;
}

export const SPINE_TREE_EFFECT_SCHEMA = "spine-tree-effect/v1" as const;
export const SPINE_TREE_RECEIPT_SCHEMA = "spine-tree-receipt/v1" as const;
export const SPINE_TREE_POST_COMMIT_SCHEMA = "spine-tree-post-commit/v1" as const;

export type PlatformEffectActor =
  | { readonly kind: "agent"; readonly agentId: string; readonly bindingId: string; readonly epoch: number }
  | { readonly kind: "system"; readonly actorId: string };

export interface PlatformEffect {
  readonly schema: typeof SPINE_TREE_EFFECT_SCHEMA;
  readonly effectId: string;
  readonly operationId: string;
  readonly effectType: string;
  readonly targetOwner: string;
  readonly actor: PlatformEffectActor;
  readonly causationId?: string;
  readonly payload: unknown;
}

export interface CommitReceipt {
  readonly schema: typeof SPINE_TREE_RECEIPT_SCHEMA;
  readonly receiptId: string;
  readonly operationId: string;
  readonly effectId: string;
  readonly targetOwner: string;
  readonly status: "committed" | "rejected" | "failed";
  readonly commitId?: string;
  readonly sequence?: number;
  readonly binding?: { readonly bindingId: string; readonly epoch: number };
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly retryable: boolean; readonly message: string };
}

export interface OwnerCommitResult {
  readonly receipt: CommitReceipt;
  readonly record?: unknown;
  readonly projection?: unknown;
}

export type OwnerCommitter = (effect: PlatformEffect) => Promise<OwnerCommitResult> | OwnerCommitResult;

export interface PostCommitRecord {
  readonly schema: typeof SPINE_TREE_POST_COMMIT_SCHEMA;
  readonly effectType: string;
  readonly receipt: CommitReceipt;
  readonly record: unknown;
  readonly projection?: unknown;
  readonly binding?: { readonly bindingId: string; readonly epoch: number };
}

export interface PostCommitSink {
  readonly id: string;
  readonly accepts: readonly string[];
  apply(record: PostCommitRecord, deliveryId: string): Promise<void> | void;
}

export interface PluginEffects {
  submit(effect: PlatformEffect): Promise<CommitReceipt>;
  registerCommitter(owner: string, committer: OwnerCommitter): void;
  registerPostCommitSink(sink: PostCommitSink): () => void;
}

export interface SpinePluginContext {
  readonly manifest: PluginManifest;
  readonly tools: PluginTools;
  readonly commands: PluginCommands;
  readonly storage: PluginStorage;
  readonly events: PluginEvents;
  readonly effects: PluginEffects;
  readonly sessions: PiSessionAdapter;
}

export interface SpinePlugin {
  readonly manifest: PluginManifest;
  activate(context: SpinePluginContext): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export interface SpinePluginHostOptions {
  readonly sessions?: PiSessionAdapter;
}

export class SpinePluginHostError extends Error {
  readonly code: string;
  readonly receipt: CommitReceipt | undefined;

  constructor(code: string, message: string, options: { readonly receipt?: CommitReceipt } = {}) {
    super(message);
    this.name = "SpinePluginHostError";
    this.code = code;
    this.receipt = options.receipt;
  }
}

const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

export class SpinePluginHost {
  readonly #plugins = new Map<string, SpinePlugin>();
  readonly #active = new Map<string, SpinePlugin>();
  readonly #ownerClaims = new Map<string, string>();
  readonly #committers = new Map<string, { pluginId: string; commit: OwnerCommitter }>();
  readonly #postCommitSinks = new Map<string, { pluginId: string; sink: PostCommitSink }>();
  readonly #toolNamespaces = new Map<string, string>();
  readonly #commandNamespaces = new Map<string, string>();
  readonly #storages = new Map<string, { owner: string; values: Map<string, unknown> }>();
  readonly #tools = new Map<string, PluginTool>();
  readonly #commands = new Map<string, PluginCommand>();
  readonly #listeners = new Map<string, Set<(event: SpineHostEvent) => void>>();
  readonly #resources = new Map<string, Array<() => void>>();
  readonly #sessions: PiSessionAdapter;
  #sequence = 0;
  #activating = false;
  #disposed = false;

  constructor(options: SpinePluginHostOptions = {}) {
    this.#sessions = options.sessions ?? {
      async request(request) {
        throw new SpinePluginHostError(
          "session-adapter-unavailable",
          `Pi session adapter is unavailable for ${request.targetSessionId}`,
        );
      },
    };
  }

  register(plugin: SpinePlugin): void {
    if (this.#disposed) {
      throw new SpinePluginHostError("host-disposed", "Plugin host has already been disposed");
    }
    if (this.#activating || this.#active.size > 0) {
      throw new SpinePluginHostError("host-started", "Plugins cannot be registered after activation starts");
    }
    const manifest = plugin.manifest;
    validateManifest(manifest);
    if (this.#plugins.has(manifest.id)) {
      throw new SpinePluginHostError("duplicate-plugin", `Plugin ${manifest.id} is already registered`);
    }
    for (const capability of manifest.owns ?? []) {
      const currentOwner = this.#ownerClaims.get(capability);
      if (currentOwner !== undefined) {
        throw new SpinePluginHostError(
          "owner-conflict",
          `Capability ${capability} is already owned by ${currentOwner}`,
        );
      }
    }
    const toolNamespace = manifest.toolNamespace;
    if (toolNamespace !== undefined) {
      const currentPlugin = this.#toolNamespaces.get(toolNamespace);
      if (currentPlugin !== undefined) {
        throw new SpinePluginHostError(
          "tool-namespace-conflict",
          `Tool namespace ${toolNamespace} is already owned by ${currentPlugin}`,
        );
      }
    }
    const storageNamespace = manifest.storageNamespace;
    if (storageNamespace !== undefined) {
      const currentStorage = this.#storages.get(storageNamespace);
      if (currentStorage !== undefined) {
        throw new SpinePluginHostError(
          "storage-namespace-conflict",
          `Storage namespace ${storageNamespace} is already owned by ${currentStorage.owner}`,
        );
      }
    }
    const commandNamespace = manifest.commandNamespace;
    if (commandNamespace !== undefined) {
      const currentPlugin = this.#commandNamespaces.get(commandNamespace);
      if (currentPlugin !== undefined) {
        throw new SpinePluginHostError(
          "command-namespace-conflict",
          `Command namespace ${commandNamespace} is already owned by ${currentPlugin}`,
        );
      }
    }
    for (const capability of manifest.owns ?? []) this.#ownerClaims.set(capability, manifest.id);
    if (toolNamespace !== undefined) this.#toolNamespaces.set(toolNamespace, manifest.id);
    if (commandNamespace !== undefined) {
      this.#commandNamespaces.set(commandNamespace, manifest.id);
    }
    if (storageNamespace !== undefined) {
      this.#storages.set(storageNamespace, { owner: manifest.id, values: new Map() });
    }
    this.#plugins.set(manifest.id, plugin);
  }

  async activateAll(): Promise<void> {
    if (this.#disposed) {
      throw new SpinePluginHostError("host-disposed", "Plugin host has already been disposed");
    }
    if (this.#activating || this.#active.size > 0) return;
    this.#activating = true;
    const activated: SpinePlugin[] = [];
    let currentPlugin: SpinePlugin | undefined;
    try {
      const order = resolveActivationOrder(this.#plugins);
      for (const plugin of order) {
        currentPlugin = plugin;
        const manifest = plugin.manifest;
        await plugin.activate(this.#contextFor(plugin));
        this.#active.set(manifest.id, plugin);
        activated.push(plugin);
      }
    } catch (cause) {
      if (currentPlugin !== undefined && !this.#active.has(currentPlugin.manifest.id)) {
        try {
          await currentPlugin.dispose?.();
        } finally {
          this.#cleanup(currentPlugin.manifest.id);
        }
      }
      for (const plugin of activated.reverse()) {
        try {
          await plugin.dispose?.();
        } finally {
          this.#cleanup(plugin.manifest.id);
          this.#active.delete(plugin.manifest.id);
        }
      }
      this.#activating = false;
      throw cause;
    }
    this.#activating = false;
  }

  async dispose(): Promise<void> {
    const plugins = [...this.#active.values()].reverse();
    for (const plugin of plugins) {
      try {
        await plugin.dispose?.();
      } finally {
        this.#cleanup(plugin.manifest.id);
        this.#active.delete(plugin.manifest.id);
      }
    }
    this.#disposed = true;
  }

  listPlugins(): readonly string[] {
    return [...this.#plugins.keys()];
  }

  listTools(): readonly string[] {
    return [...this.#tools.keys()].sort();
  }

  describeTool(name: string): PluginToolDescription {
    const tool = this.#tools.get(name);
    if (tool === undefined) {
      throw new SpinePluginHostError("unknown-tool", `Tool ${name} is not registered`);
    }
    return {
      description: tool.description,
      ...(tool.parameters === undefined ? {} : { parameters: structuredClone(tool.parameters) }),
    };
  }

  listCommands(): readonly string[] {
    return [...this.#commands.keys()].sort();
  }

  async executeTool(name: string, input: unknown): Promise<unknown> {
    const tool = this.#tools.get(name);
    if (tool === undefined) {
      throw new SpinePluginHostError("unknown-tool", `Tool ${name} is not registered`);
    }
    return tool.execute(input);
  }

  submitEffect(effect: PlatformEffect): Promise<CommitReceipt> {
    return this.#submitEffect(effect);
  }

  async executeCommand(name: string, arguments_: readonly string[] = []): Promise<unknown> {
    const command = this.#commands.get(name);
    if (command === undefined) {
      throw new SpinePluginHostError("unknown-command", `Command ${name} is not registered`);
    }
    return command.execute(arguments_);
  }

  publish(type: string, payload: unknown): void {
    const event: SpineHostEvent = Object.freeze({
      type,
      sequence: ++this.#sequence,
      payload: deepFreeze(payload),
    });
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }

  #contextFor(plugin: SpinePlugin): SpinePluginContext {
    const manifest = plugin.manifest;
    const toolNamespace = manifest.toolNamespace;
    const commandNamespace = manifest.commandNamespace;
    const storageNamespace = manifest.storageNamespace;
    const resources: Array<() => void> = [];
    this.#resources.set(manifest.id, resources);
    const storage = storageNamespace === undefined
      ? emptyStorage()
      : scopedStorage(this.#storages.get(storageNamespace)!.values);
    return {
      manifest,
      tools: scopedTools(toolNamespace, this.#tools, resources),
      commands: scopedCommands(commandNamespace, this.#commands, resources),
      storage,
      events: {
        observe: (type, listener) => {
          const listeners = this.#listeners.get(type) ?? new Set();
          listeners.add(listener);
          this.#listeners.set(type, listeners);
          const unsubscribe = () => listeners.delete(listener);
          resources.push(unsubscribe);
          return unsubscribe;
        },
      },
      effects: this.#effectsFor(manifest.id, manifest, resources),
      sessions: this.#sessions,
    };
  }

  #effectsFor(
    pluginId: string,
    manifest: PluginManifest,
    resources: Array<() => void>,
  ): PluginEffects {
    const assertActivation = () => {
      if (!this.#activating) {
        throw new SpinePluginHostError("host-started", "Effect handlers can only be registered during activation");
      }
    };
    return {
      submit: (effect) => this.#submitEffect(effect),
      registerCommitter: (owner, commit) => {
        assertActivation();
        if (!(manifest.owns ?? []).includes(owner)) {
          throw new SpinePluginHostError(
            "effect-owner",
            `Plugin ${pluginId} does not own effect target ${owner}`,
          );
        }
        if (this.#committers.has(owner)) {
          throw new SpinePluginHostError("committer-conflict", `Effect committer for ${owner} is already registered`);
        }
        if (typeof commit !== "function") {
          throw new SpinePluginHostError("committer-invalid", `Effect committer for ${owner} is not callable`);
        }
        const entry = { pluginId, commit };
        this.#committers.set(owner, entry);
        resources.push(() => {
          if (this.#committers.get(owner) === entry) this.#committers.delete(owner);
        });
      },
      registerPostCommitSink: (sink) => {
        assertActivation();
        validatePostCommitSink(sink);
        if (this.#postCommitSinks.has(sink.id)) {
          throw new SpinePluginHostError("sink-conflict", `Post-commit sink ${sink.id} is already registered`);
        }
        const entry = { pluginId, sink };
        this.#postCommitSinks.set(sink.id, entry);
        const unsubscribe = () => {
          if (this.#postCommitSinks.get(sink.id) === entry) this.#postCommitSinks.delete(sink.id);
        };
        resources.push(unsubscribe);
        return unsubscribe;
      },
    };
  }

  async #submitEffect(effect: PlatformEffect): Promise<CommitReceipt> {
    if (this.#disposed) {
      throw new SpinePluginHostError("host-disposed", "Plugin host has already been disposed");
    }
    validateEffect(effect);
    const owner = this.#committers.get(effect.targetOwner);
    if (owner === undefined) {
      throw new SpinePluginHostError(
        "owner-committer-unavailable",
        `No active effect committer is registered for ${effect.targetOwner}`,
      );
    }
    const result = await owner.commit(effect);
    validateCommitResult(effect, result);
    const receipt = deepFreeze(result.receipt);
    if (receipt.status !== "committed") return receipt;
    const postCommit = deepFreeze({
      schema: SPINE_TREE_POST_COMMIT_SCHEMA,
      effectType: effect.effectType,
      receipt,
      record: result.record,
      ...(result.projection === undefined ? {} : { projection: result.projection }),
      ...(receipt.binding === undefined ? {} : { binding: receipt.binding }),
    });
    for (const { sink } of this.#postCommitSinks.values()) {
      if (!sink.accepts.includes(effect.targetOwner) && !sink.accepts.includes(effect.effectType)) continue;
      const deliveryId = `${sink.id}:${effect.targetOwner}:${effect.operationId}`;
      try {
        await sink.apply(postCommit, deliveryId);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new SpinePluginHostError(
          "post-commit-sink-failed",
          `Post-commit sink ${sink.id} failed after ${receipt.receiptId}: ${message}`,
          { receipt },
        );
      }
    }
    return receipt;
  }

  #cleanup(pluginId: string): void {
    for (const cleanup of this.#resources.get(pluginId) ?? []) cleanup();
    this.#resources.delete(pluginId);
  }
}

function validateEffect(effect: PlatformEffect): void {
  if (effect === null || typeof effect !== "object" || effect.schema !== SPINE_TREE_EFFECT_SCHEMA) {
    throw new SpinePluginHostError("effect-schema", "Unsupported platform effect schema");
  }
  for (const [name, value] of [
    ["effectId", effect.effectId],
    ["operationId", effect.operationId],
    ["effectType", effect.effectType],
    ["targetOwner", effect.targetOwner],
  ] as const) {
    if (typeof value !== "string" || value.length === 0) {
      throw new SpinePluginHostError("effect-identity", `Effect ${name} must be a non-empty string`);
    }
  }
  if (effect.causationId !== undefined && (typeof effect.causationId !== "string" || effect.causationId.length === 0)) {
    throw new SpinePluginHostError("effect-causation", "Effect causationId must be a non-empty string when present");
  }
  if (effect.actor === null || typeof effect.actor !== "object") {
    throw new SpinePluginHostError("effect-actor", "Effect actor is required");
  }
  if (effect.actor.kind === "agent") {
    if (
      typeof effect.actor.agentId !== "string" || effect.actor.agentId.length === 0 ||
      typeof effect.actor.bindingId !== "string" || effect.actor.bindingId.length === 0 ||
      !Number.isInteger(effect.actor.epoch) || effect.actor.epoch < 0
    ) {
      throw new SpinePluginHostError("effect-actor", "Agent effect actor requires agentId, bindingId and non-negative epoch");
    }
  } else if (
    effect.actor.kind !== "system" ||
    typeof effect.actor.actorId !== "string" || effect.actor.actorId.length === 0
  ) {
    throw new SpinePluginHostError("effect-actor", "Effect actor must be an agent or explicit system actor");
  }
}

function validateCommitResult(effect: PlatformEffect, result: OwnerCommitResult): void {
  if (result === null || typeof result !== "object" || result.receipt === undefined) {
    throw new SpinePluginHostError("receipt-invalid", `Owner ${effect.targetOwner} returned no commit receipt`);
  }
  const receipt = result.receipt;
  if (receipt.schema !== SPINE_TREE_RECEIPT_SCHEMA) {
    throw new SpinePluginHostError("receipt-schema", `Owner ${effect.targetOwner} returned an unsupported receipt schema`);
  }
  if (
    receipt.operationId !== effect.operationId ||
    receipt.effectId !== effect.effectId ||
    receipt.targetOwner !== effect.targetOwner
  ) {
    throw new SpinePluginHostError("receipt-mismatch", `Receipt does not match effect ${effect.operationId}`);
  }
  if (!["committed", "rejected", "failed"].includes(receipt.status)) {
    throw new SpinePluginHostError("receipt-status", `Receipt has an unsupported status for ${effect.operationId}`);
  }
  if (typeof receipt.receiptId !== "string" || receipt.receiptId.length === 0) {
    throw new SpinePluginHostError("receipt-identity", "Receipt receiptId must be a non-empty string");
  }
  if (receipt.status === "committed" && !Object.prototype.hasOwnProperty.call(result, "record")) {
    throw new SpinePluginHostError("receipt-record", `Committed effect ${effect.operationId} returned no post-commit record`);
  }
}

function validatePostCommitSink(sink: PostCommitSink): void {
  if (
    sink === null || typeof sink !== "object" ||
    typeof sink.id !== "string" || sink.id.length === 0 ||
    !Array.isArray(sink.accepts) || sink.accepts.length === 0 ||
    sink.accepts.some((value) => typeof value !== "string" || value.length === 0) ||
    typeof sink.apply !== "function"
  ) {
    throw new SpinePluginHostError("sink-invalid", "Post-commit sink requires id, accepts and apply");
  }
}

function validateManifest(manifest: PluginManifest): void {
  if (manifest.schema !== SPINE_HOST_CONTRACT_SCHEMA) {
    throw new SpinePluginHostError("manifest-schema", `Unsupported manifest schema for ${manifest.id}`);
  }
  if (!manifest.id || !manifest.version) {
    throw new SpinePluginHostError("manifest-identity", "Plugin manifest requires id and version");
  }
  for (const namespace of [
    manifest.toolNamespace,
    manifest.commandNamespace,
    manifest.storageNamespace,
  ]) {
    if (namespace !== undefined && !NAME_PATTERN.test(namespace)) {
      throw new SpinePluginHostError("manifest-namespace", `Invalid plugin namespace ${namespace}`);
    }
  }
  const seen = new Set<string>();
  for (const capability of manifest.owns ?? []) {
    if (seen.has(capability)) {
      throw new SpinePluginHostError("manifest-owner", `Duplicate owner capability ${capability}`);
    }
    seen.add(capability);
  }
}

function resolveActivationOrder(plugins: Map<string, SpinePlugin>): SpinePlugin[] {
  const order: SpinePlugin[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(pluginId: string): void {
    if (visited.has(pluginId)) return;
    if (visiting.has(pluginId)) {
      throw new SpinePluginHostError("dependency-cycle", `Plugin dependency cycle at ${pluginId}`);
    }
    const plugin = plugins.get(pluginId);
    if (plugin === undefined) {
      throw new SpinePluginHostError("missing-dependency", `Plugin dependency ${pluginId} is not registered`);
    }
    visiting.add(pluginId);
    for (const dependency of plugin.manifest.requires ?? []) visit(dependency);
    visiting.delete(pluginId);
    visited.add(pluginId);
    order.push(plugin);
  }

  for (const pluginId of plugins.keys()) visit(pluginId);
  return order;
}

function scopedTools(
  namespace: string | undefined,
  tools: Map<string, PluginTool>,
  resources: Array<() => void>,
): PluginTools {
  return {
    register(localName, tool) {
      if (namespace === undefined) {
        throw new SpinePluginHostError("tool-namespace-required", "Plugin has no tool namespace");
      }
      if (!NAME_PATTERN.test(localName)) {
        throw new SpinePluginHostError("tool-name", `Invalid local tool name ${localName}`);
      }
      const fullName = `${namespace}_${localName}`;
      if (tools.has(fullName)) {
        throw new SpinePluginHostError("tool-conflict", `Tool ${fullName} is already registered`);
      }
      tools.set(fullName, tool);
      resources.push(() => tools.delete(fullName));
    },
    list() {
      const prefix = namespace === undefined ? "" : `${namespace}_`;
      return [...tools.keys()].filter((name) => name.startsWith(prefix)).sort();
    },
  };
}

function scopedCommands(
  namespace: string | undefined,
  commands: Map<string, PluginCommand>,
  resources: Array<() => void>,
): PluginCommands {
  return {
    register(localName, command) {
      if (namespace === undefined) {
        throw new SpinePluginHostError("command-namespace-required", "Plugin has no command namespace");
      }
      if (!NAME_PATTERN.test(localName)) {
        throw new SpinePluginHostError("command-name", `Invalid local command name ${localName}`);
      }
      const fullName = `${namespace}:${localName}`;
      if (commands.has(fullName)) {
        throw new SpinePluginHostError("command-conflict", `Command ${fullName} is already registered`);
      }
      commands.set(fullName, command);
      resources.push(() => commands.delete(fullName));
    },
    list() {
      const prefix = namespace === undefined ? "" : `${namespace}:`;
      return [...commands.keys()].filter((name) => name.startsWith(prefix)).sort();
    },
  };
}

function scopedStorage(store: Map<string, unknown>): PluginStorage {
  return {
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    keys: () => [...store.keys()].sort(),
  };
}

function emptyStorage(): PluginStorage {
  return {
    get: () => undefined,
    set: () => {
      throw new SpinePluginHostError("storage-unavailable", "Plugin has no storage namespace");
    },
    delete: () => false,
    keys: () => [],
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
