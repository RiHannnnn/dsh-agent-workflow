import type { WorkflowDocument, WorkflowNode } from './model.js';
export type RunUpdate = {
    input?: string;
    value?: string;
    logs?: string[];
    running?: boolean;
    error?: string;
    duration?: number;
    at: string;
};
export type RunDependencies = {
    signal: AbortSignal;
    runAgent: (node: WorkflowNode, input: string, delta: (text: string) => void, signal: AbortSignal) => Promise<string>;
    runCode: (node: WorkflowNode, input: string, signal: AbortSignal) => Promise<{
        value: string;
        logs: string[];
    }>;
    update: (id: string, patch: RunUpdate) => void;
    edge: (id: string) => void;
};
export declare function supportsDag(doc: WorkflowDocument): boolean;
export declare function triggerInput(node: WorkflowNode): string;
export declare function renderResult(template: string | undefined, input: string): string;
/** Only blank-line-delimited paragraphs are committed; no half-token handoff. */
export declare class Paragraphs {
    private emit;
    private pending;
    constructor(emit: (paragraph: string) => void);
    add(text: string): void;
    private checkSize;
    private commit;
    finish(): void;
}
/** DAG runner with real fan-out, full-input joins and bounded incremental edges. */
export declare function runDagWorkflow(doc: WorkflowDocument, deps: RunDependencies): Promise<void>;
