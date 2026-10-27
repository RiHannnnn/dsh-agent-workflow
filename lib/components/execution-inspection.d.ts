import type { CodeRunOutcome } from '../model.js';
export type InspectionTab = 'input' | 'output' | 'error' | 'logs';
export type InspectionStatus = 'unrecorded' | 'running' | 'error' | 'completed';
/** Only recorded node outcomes establish a state; workflow activity is not node success. */
export declare function inspectionStatus(run?: CodeRunOutcome): InspectionStatus;
export declare function inspectionText(run: CodeRunOutcome | undefined, tab: InspectionTab): string | undefined;
/** Bound rendering work without modifying the source outcome or inventing data. */
export declare function inspectionPreview(text: string, limit?: number): {
    text: string;
    truncated: boolean;
};
