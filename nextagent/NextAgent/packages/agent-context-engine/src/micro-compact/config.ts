/**
 * Micro-compact configuration constants.
 *
 * Design principle: the whitelist is NOT about whether content is useful —
 * it is about whether the content can be recovered or whether losing it
 * does not harm the main pipeline. Each whitelisted tool satisfies at
 * least one of:
 *   - Replayable: Read, Grep, Glob, WebFetch, WebSearch
 *   - One-shot consumption: Bash (logs / command output consumed once)
 *   - Write confirmation: FileEdit, FileWrite (real state lives on disk)
 *
 * Custom MCP tools are NOT whitelisted: the harness does not know whether
 * they are idempotent, side-effect-free, or replayable.
 */

/**
 * Whitelist of tool names whose results may enter the micro-compact
 * candidate pool. Only CAPABILITY_RESULT records whose toolName appears
 * here are eligible for compaction.
 *
 * Tool names match the `capabilityId` / `toolName` used in the
 * CAPABILITY_RESULT JSON content. NextAgent built-in tools use
 * lowercase names.
 */
export const COMPACTABLE_TOOL_NAMES: ReadonlySet<string> = new Set(['bash', 'read', 'grep', 'glob', 'write', 'python']);

/**
 * Micro-compact tuning constants.
 *
 * These are hardcoded for the initial release. A future change may expose
 * them through `runtimeSettings` or app-composition injection.
 */
export const MICRO_COMPACT_CONFIG = {
  /** Cumulative compactable tool-result count above which compaction triggers. */
  triggerThreshold: 10,
  /** Number of most-recent tool results always retained (never compacted). */
  keepRecent: 5,
} as const;
