/** Caller-owned DSH executions. No CLI, external backend fallback, or automatic runs. */
import type { IncomingMessage, ServerResponse } from 'node:http';
export interface DshContext {
    webServer: {
        register(route: {
            kind: 'exact';
            path: string;
            handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
        }): () => void;
    };
    effect(factory: () => () => void): unknown;
    get(service: string): unknown;
}
export declare const DSH_CAPABILITY_HEADER = "x-dsh-node-flow-capability";
export declare const DSH_LIMITS: Readonly<{
    concurrent: 2;
    callsPerRun: 4;
    openRuns: 16;
    runMs: 600000;
    bodyBytes: number;
    taskBytes: number;
    promptBytes: number;
    runPromptBytes: number;
    outputBytes: number;
    outputTokensPerRequest: 4096;
}>;
export declare function isDshSameOrigin(request: IncomingMessage): boolean;
export declare function registerDshAgentRoutes(ctx: DshContext, options?: {
    home?: string;
}): () => Promise<void>;
