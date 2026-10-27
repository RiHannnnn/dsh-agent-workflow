import type { WorkflowNode } from './model.js';
import { type DshExecution } from './dsh-execution-client.js';
export declare function executeAgent(node: WorkflowNode, input: string, delta: (text: string) => void, signal: AbortSignal, execution?: DshExecution): Promise<string>;
/** NDJSON parser: preserve split UTF-8, require a terminal done frame. */
export declare function readAgentStream(body: ReadableStream<Uint8Array>, delta: (text: string) => void, signal: AbortSignal): Promise<string>;
export declare function executeCode(node: WorkflowNode, input: string, signal: AbortSignal): Promise<{
    value: string;
    logs: string[];
}>;
