/** DSH-native agent library and execution routes (no Codex dependency). */
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
export declare function registerDshAgentRoutes(ctx: DshContext): () => void;
