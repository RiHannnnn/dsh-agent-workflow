export declare const AGENT_LIMITS: Readonly<{
    dirs: 400;
    metaBytes: number;
    bodyBytes: number;
}>;
export interface DshAgent {
    id: string;
    name: string;
    description: string;
    engine: 'dsh';
}
/** Split YAML frontmatter from the Markdown body. */
export declare function splitFrontmatter(text: string): {
    meta: Record<string, string>;
    body: string;
};
/** Prefer the role's own H1 title; the frontmatter name is a slug. */
export declare function displayName(meta: Record<string, string>, body: string, fallback: string): string;
/** Enumerate DSH skill roles; unreadable entries are skipped, not fatal. */
export declare function listDshAgents(home: string): Promise<{
    agents: DshAgent[];
    warnings: string[];
}>;
/** Read one role's instruction body (frontmatter stripped), guarded against traversal. */
export declare function readDshAgentBody(home: string, id: string): Promise<string>;
export declare function dshHome(): string;
