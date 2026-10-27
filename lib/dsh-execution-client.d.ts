/** In-memory, per-click execution context. Never stored in/exported with workflows. */
export interface DshExecution {
    runId: string;
    capability: string;
    parentSessionId: string;
    callsPerRun: number;
}
export declare function beginDshExecution(signal: AbortSignal, chooseParent?: (ids: string[]) => string | undefined): Promise<DshExecution>;
export declare function finishDshExecution(execution: DshExecution): Promise<number>;
export declare function dshExecutionRequest(execution: DshExecution | undefined): {
    runId: string;
    headers: Record<string, string>;
};
