/* tslint:disable */
/* eslint-disable */

/**
 * JavaScript owns only this coarse runtime object. Rust ownership-bearing
 * sampling handles and prepared commits never cross the ABI.
 */
export class SpineRuntime {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Returns a success or error envelope for every request. Semantic errors
     * are data so every host can apply the same fault-latch policy.
     */
    dispatch(request_json: string): string;
    /**
     * Extends a host system prompt with the configured canonical Spine
     * instruction segments. Prompt composition stays in spine-core so hosts
     * do not duplicate model-visible instruction text.
     */
    extend_system_prompt(base: string): string;
    constructor(init_json: string);
    node_prompt(): string;
    tool_catalog_json(): string;
}
