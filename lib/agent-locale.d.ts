/**
 * Display-only Chinese localization for local Codex roles.
 *
 * The role files under CODEX_HOME/agents are never modified: their English
 * names/descriptions stay the source of truth and remain visible in tooltips.
 * Unknown roles fall back to the English metadata unchanged.
 */
export type RoleLike = {
    id: string;
    name: string;
    description: string;
};
export type LocalizedRole = {
    name: string;
    description: string;
    localized: boolean;
    englishName: string;
};
export declare function localizeRole(role: RoleLike): LocalizedRole;
/** Chinese label plus the English original, for pickers and node titles. */
export declare function roleLabel(role: RoleLike): string;
/** Chinese name for a role id alone (node cards carry no library payload). */
export declare function roleDisplayName(id: string | undefined): string;
/** Search across Chinese and English metadata so either language finds the role. */
export declare function roleMatches(role: RoleLike, query: string): boolean;
