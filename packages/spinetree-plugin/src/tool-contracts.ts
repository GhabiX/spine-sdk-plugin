// Input contracts belong to SpineTree. Host and Pi only transport this metadata.
const nonEmptyString = { type: "string", minLength: 1 };
const branch = { ...nonEmptyString, description: "ProjectBranch ID" };

export const toolContracts = {
  read: {
    description: "Read a ProjectBranch, inheritance, children and its active Agent binding from one fixed HEAD. Use binding.agentId as the send recipient; binding may be null.",
    parameters: {
      type: "object",
      properties: { branch },
      required: ["branch"],
      additionalProperties: false,
    },
  },
  change: {
    description: "Atomically apply a non-empty batch of ProjectBranch updates, moves or archives using expectedHead from read. A stale HEAD rejects the whole batch. Only goal/constraints/skills/tools are editable; root/live/cyclic moves and archives containing live work are rejected.",
    parameters: {
      type: "object",
      properties: {
        expectedHead: { ...nonEmptyString, description: "HEAD returned by spinetree_read" },
        changes: {
          type: "array",
          minItems: 1,
          items: {
            anyOf: [
              {
                type: "object",
                properties: {
                  type: { const: "update", type: "string" },
                  branch,
                  attributes: {
                    type: "object",
                    properties: {
                      goal: nonEmptyString,
                      constraints: { type: "array", items: {} },
                      skills: { type: "array", items: {} },
                      tools: { type: "array", items: {} },
                    },
                    additionalProperties: false,
                  },
                },
                required: ["type", "branch", "attributes"],
                additionalProperties: false,
              },
              {
                type: "object",
                properties: { type: { const: "move", type: "string" }, branch, parent: branch },
                required: ["type", "branch", "parent"],
                additionalProperties: false,
              },
              {
                type: "object",
                properties: { type: { const: "archive", type: "string" }, branch },
                required: ["type", "branch"],
                additionalProperties: false,
              },
            ],
          },
        },
      },
      required: ["expectedHead", "changes"],
      additionalProperties: false,
    },
  },
  send: {
    description: "Queue a message to a registered non-ended AgentId and attempt delivery through its Pi session. requestId reuses the same receipt for the same message. Delivery can retry and is at least once; delivered does not mean observed.",
    parameters: {
      type: "object",
      properties: {
        to: { ...nonEmptyString, description: "Recipient AgentId, not a branch, scope or session ID" },
        message: nonEmptyString,
        from: { ...nonEmptyString, description: "Optional registered sender AgentId" },
        requestId: { ...nonEmptyString, description: "Optional caller idempotency key for this message" },
      },
      required: ["to", "message"],
      additionalProperties: false,
    },
  },
  observe: {
    description: "Explicitly confirm that the recipient Agent observed a delivered receipt. agentId must match its recipient and be non-ended. Repeated observation is idempotent; queued or leased receipts cannot be observed.",
    parameters: {
      type: "object",
      properties: {
        receiptId: nonEmptyString,
        agentId: { ...nonEmptyString, description: "Recipient AgentId" },
      },
      required: ["receiptId", "agentId"],
      additionalProperties: false,
    },
  },
  rejuvenate: {
    description: "Request a new Agent for a capped ProjectBranch through the caller's provision adapter. parent must be an ancestor and the target must have no active Agent. Returns the new binding and inherited context.",
    parameters: {
      type: "object",
      properties: {
        parent: { ...branch, description: "Ancestor ProjectBranch ID" },
        branch,
        request: { ...nonEmptyString, description: "Optional instructions for the provision adapter" },
      },
      required: ["parent", "branch"],
      additionalProperties: false,
    },
  },
} as const;
