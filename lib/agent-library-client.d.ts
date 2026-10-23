/** Browser-only client. Capability is held in module memory, never disk/storage. */
export type LibraryAgent = {
    id: string;
    name: string;
    description: string;
    engine: 'dsh' | 'codex';
};
export type AgentLibraryResult = {
    ok: boolean;
    agents: LibraryAgent[];
    codexAvailable?: boolean;
    available?: boolean;
    warnings?: string[];
    capability?: string;
};
export declare const CODEX_CAPABILITY_HEADER = "X-DSH-Node-Flow-Codex-Capability";
export declare function getAgentLibraryCapability(): string | undefined;
export declare function fetchAgentLibrary(options?: {
    signal?: AbortSignal;
}): Promise<AgentLibraryResult>;
export declare function ensureAgentLibraryCapability(options?: {
    signal?: AbortSignal;
}): Promise<string | undefined>;
