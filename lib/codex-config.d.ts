/** Pure parser: errors never include TOML contents or provider credentials. */
export declare function codexMcpNamesFromToml(text: string): string[];
/**
 * Collect all potentially active ordinary local layers, not merely the chosen
 * legacy profile. Managed sources that can override CLI policy fail closed.
 * Does not inspect auth.json, keychain, SQLite or session/rollout content.
 */
export declare function probeCodexMcpNames(home: string, cwd: string): Promise<string[]>;
/** Whole-table TOML avoids Codex's naïve dotted-path split for names with dots. */
export declare function codexMcpOverride(names: string[]): string;
