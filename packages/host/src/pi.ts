import { SpinePluginHostError, type PiSessionAdapter, type PiSessionRequest } from "./index.js";

/** The public Pi SessionLease subset needed for session requests. */
export interface PiSessionLease {
  readonly id: string;
  readonly active: boolean;
  prompt(text: string): Promise<unknown>;
  steer(text: string): Promise<unknown>;
}

/** The caller owns connection, acquisition, disposal and reconnection. */
export type PiSessionLeaseResolver = (
  sessionId: string,
) => PiSessionLease | undefined | Promise<PiSessionLease | undefined>;

/**
 * Uses PiClient's existing transport through a caller-owned SessionLease.
 * Acceptance means the Pi command resolved; it does not mean observed.
 * Pi prompt/steer have no mailbox requestId: the ID is echoed locally only.
 */
export function createPiSessionAdapter(resolveSession: PiSessionLeaseResolver): PiSessionAdapter {
  return {
    async request(request) {
      validateRequest(request);
      const correlation = request.requestId === undefined ? {} : { requestId: request.requestId };
      const lease = await resolveSession(request.targetSessionId);
      if (lease === undefined) return { accepted: false, ...correlation };
      if (lease.id !== request.targetSessionId) {
        throw new SpinePluginHostError(
          "session-lease-mismatch",
          `Requested Pi session ${request.targetSessionId}, resolved ${lease.id}`,
        );
      }
      if (!lease.active) return { accepted: false, ...correlation };
      try {
        await lease[request.operation](request.text);
      } catch (error) {
        if (isPiBusyError(error)) return { accepted: false, ...correlation };
        throw error;
      }
      return { accepted: true, ...correlation };
    },
  };
}

function validateRequest(request: PiSessionRequest): void {
  if (
    request === null || typeof request !== "object" ||
    typeof request.targetSessionId !== "string" || request.targetSessionId.length === 0 ||
    (request.operation !== "prompt" && request.operation !== "steer") ||
    typeof request.text !== "string" ||
    (request.requestId !== undefined && (typeof request.requestId !== "string" || request.requestId.length === 0))
  ) {
    throw new SpinePluginHostError("invalid-session-request", "Expected a Pi session ID, prompt/steer operation and text");
  }
}

function isPiBusyError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "PiServerError") return false;
  const code = (error as Error & { code?: unknown }).code;
  return code === "busy" || code === "session_locked";
}
