import type { WorkflowNode } from '../model.js';
export declare function ExecutionPanel({ nodes, selectedId, running, expanded, onSelect, onExpand, onClose }: {
    nodes: WorkflowNode[];
    selectedId: string | null;
    running: boolean;
    expanded: boolean;
    onSelect: (id: string) => void;
    onExpand: () => void;
    onClose: () => void;
}): import("react").JSX.Element;
