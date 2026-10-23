/**
 * Standalone local-development Codex routes. Call registerCodexRoutes(ctx) from
 * the host apply() (inject webServer). It registers its own ctx.effect and also
 * returns an idempotent disposer. No other plugin module is imported.
 *
 * Authentication contract: WebServer.register has no auth hook. The Desktop
 * wrapper still applies its own browser-access gate, but that is NOT asserted
 * to authenticate ordinary browser requests. Both endpoints require strict
 * same-origin, loopback authority. POST agent-library returns a per-registration
 * random capability in X-DSH-Node-Flow-Codex-Capability; run-codex must echo that
 * header. No CORS exposure, query token, logging, persistent token or UI secret.
 * timeout is seconds (1..600, default 120). Cancellation is HTTP disconnect.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type CodexProcessOptions, type CodexTurnRequest } from './codex-process.js';
export { CODEX_LIMITS } from './codex-process.js';
export declare const CODEX_CAPABILITY_HEADER = "x-dsh-node-flow-codex-capability";
export declare const CODEX_MCP_WARNING = "\u8FD0\u884C\u524D\u4F1A\u63A2\u6D4B\u672C\u5730\u914D\u7F6E\u4E2D\u7684 MCP \u540D\u79F0\u5E76\u9010\u4E00\u7981\u7528\uFF0C\u540C\u65F6\u5173\u95ED hooks\u3001plugins \u548C apps\uFF1B\u9047\u5230\u6258\u7BA1\u6216\u65E0\u6CD5\u5224\u65AD\u7684\u914D\u7F6E\u4F1A\u62D2\u7EDD\u8FD0\u884C\u3002\u8BF7\u52FF\u5728\u8FD0\u884C\u65F6\u66F4\u6539 Codex \u914D\u7F6E\u3002\u53EA\u8BFB\u6587\u4EF6\u6C99\u7BB1\u4E0D\u7B49\u4E8E\u53EA\u5141\u8BB8\u8BFB\u53D6\u6240\u9009\u76EE\u5F55\u3002";
export interface CodexContext {
    webServer: {
        register(route: {
            kind: 'exact';
            path: string;
            handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
        }): () => void;
    };
    effect(callback: () => () => void): unknown;
}
export interface CodexRouteOptions {
    /** Optional trusted host-side executable override, never taken from an HTTP body. */
    executable?: string;
    codexHome?: string;
    /** Test seam; never expose to untrusted clients. */
    spawnProcess?: CodexProcessOptions['spawnProcess'];
}
export interface CodexAgent {
    id: string;
    name: string;
    description: string;
    engine: 'codex';
}
/** Enumerates only agents/*.toml; never opens Codex auth/config/session files. */
export declare function loadCodexAgentLibrary(home: string): Promise<{
    agents: CodexAgent[];
    warnings: string[];
}>;
/** Reject missing/opaque origins, scheme mismatches, DNS rebinding and cross-site fetches. */
export declare function isCodexSameOrigin(request: IncomingMessage): boolean;
export declare function validateCodexRequest(value: unknown): Promise<CodexTurnRequest & {
    roleId: string;
    timeout: number;
}>;
export declare function registerCodexRoutes(ctx: CodexContext, options?: CodexRouteOptions): () => void;
