/** Codex 0.163 app-server stdio adapter. No shell, auth/session reads or exec fallback. */
import { spawn } from 'node:child_process';
export type CodexEvent = {
    type: 'delta';
    text: string;
} | {
    type: 'status';
    message: string;
} | {
    type: 'done';
    output: string;
} | {
    type: 'error';
    message: string;
};
export interface CodexTurnRequest {
    prompt: string;
    cwd: string;
    codexModel?: string;
    developerInstructions?: string;
    /** Server names from the fail-closed, runtime-only local MCP policy probe. */
    disabledMcpServers?: string[];
}
export interface CodexProcessOptions {
    executable: string;
    signal: AbortSignal;
    onEvent: (event: CodexEvent) => void;
    /** Test seam: production always uses node:child_process.spawn, with shell:false. */
    spawnProcess?: typeof spawn;
}
export declare const CODEX_LIMITS: Readonly<{
    bodyBytes: number;
    promptBytes: number;
    roleBytes: number;
    outputBytes: number;
    rpcLineBytes: number;
    protocolBytes: number;
    responseBufferBytes: number;
    concurrent: 2;
    minTimeout: 1;
    maxTimeout: 600;
    defaultTimeout: 120;
}>;
/**
 * Verified against generated 0.163.0 ThreadStartParams / TurnStartParams.
 * Global hooks/plugins/apps are disabled before app-server initialization.
 * The route's runtime-only config probe supplies every known local MCP server
 * name, disabled individually before app-server starts (an empty table alone
 * does not remove inherited entries). Unknown configuration sources fail closed.
 * Server-side tool/permission requests are refused, never granted.
 */
export declare function codexSpawnArgs(disabledMcpServers?: string[]): string[];
/** Starts one ephemeral thread and one turn, returning only after terminal cleanup. */
export declare function runCodexTurn(request: CodexTurnRequest, options: CodexProcessOptions): Promise<void>;
