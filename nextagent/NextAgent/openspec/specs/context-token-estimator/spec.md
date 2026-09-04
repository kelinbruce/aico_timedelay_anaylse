# context-token-estimator Specification

## Purpose
TBD - created by archiving change refine-ts-context-token-estimator. Update Purpose after archive.
## Requirements
### Requirement: Context Engine carries a pluggable TokenEstimator contract

`agent-contracts/context` SHALL expose a `TokenEstimator` interface with four methods: `estimateTokens(text)`, `estimateMessageTokens(role, content)`, `estimateToolMessageTokens(toolCallId, toolName, content)`, and `estimateTokensBatch(texts)`. The contract SHALL NOT bind to any provider-specific tokenizer; replacement implementations MAY override the estimator port for provider-precise estimation without changing the interface shape.

#### Scenario: Interface lives in agent-contracts/context

- **WHEN** a downstream consumer imports `TokenEstimator`
- **THEN** the type comes from `@nextagent/agent-contracts/context`
- **AND** no parallel `TokenEstimator` definition lives in `agent-common`, `agent-model`, or any other contract subpath

#### Scenario: All four methods are required

- **WHEN** an implementation satisfies the `TokenEstimator` contract
- **THEN** it MUST provide all four methods with the documented signatures
- **AND** the result of every method MUST be a non-negative integer (never NaN, never negative, never fractional)

#### Scenario: Replacement implementation is supported

- **WHEN** an application or test injects a custom `TokenEstimator`
- **THEN** consumers receive the injected implementation through dependency wiring
- **AND** the default implementation is not implicitly forced

### Requirement: DefaultTokenEstimator uses code-point-aware weighting

The default `TokenEstimator` implementation shipped with `agent-context-engine` SHALL iterate text by Unicode code point (using `codePointAt`, not by UTF-16 length) and SHALL weight each code point by one of these rules in priority order:

1. Code point `> U+FFFF` (supplementary plane, including emoji / CJK Extension B-G / rare ideographs): weight `2.0`
2. CJK basic-plane ranges (`U+3000` – `U+9FFF` and `U+FF00` – `U+FFEF`, covering CJK Unified Ideographs / Hiragana / Katakana / Hangul / CJK punctuation / fullwidth forms): weight `1.5`
3. ASCII (code point `< U+0080`): weight `0.25`
4. Other BMP code points (extended Latin, Greek, Cyrillic, Arabic, Hebrew, etc.): weight `1.0`

The final return value SHALL be `0` for empty text and `Math.max(1, Math.ceil(weightedSum))` for non-empty text — ensuring no non-empty input is estimated as 0 tokens.

#### Scenario: Empty text returns zero

- **WHEN** `estimateTokens("")` is called
- **THEN** the result is exactly `0`

#### Scenario: ASCII text uses 0.25 per code point with floor of one

- **WHEN** `estimateTokens("hello")` is called (5 ASCII code points × 0.25 = 1.25)
- **THEN** the result is `Math.max(1, Math.ceil(1.25))` = `2`
- **AND** a single ASCII character such as `"a"` (0.25) returns `Math.max(1, Math.ceil(0.25))` = `1`

#### Scenario: CJK basic-plane text uses 1.5 per code point

- **WHEN** `estimateTokens("你好")` is called (2 CJK basic-plane code points × 1.5 = 3.0)
- **THEN** the result is `Math.max(1, Math.ceil(3.0))` = `3`

#### Scenario: Supplementary plane code point counts as one weighted unit

- **WHEN** `estimateTokens("🎉")` is called (1 supplementary-plane code point, NOT 2 UTF-16 chars)
- **THEN** the result is `Math.max(1, Math.ceil(2.0))` = `2`
- **AND** iteration MUST NOT treat the high/low surrogate pair as two separate code points

#### Scenario: Mixed content sums weights

- **WHEN** `estimateTokens("hi 你 🎉")` is called
- **THEN** the weighted sum is `(0.25 + 0.25)` for `"hi"` ASCII + `0.25` for the space + `1.5` for `"你"` + `0.25` for the space + `2.0` for `"🎉"` = `4.5`
- **AND** the result is `Math.max(1, Math.ceil(4.5))` = `5`

### Requirement: DefaultTokenEstimator adds protocol overhead for messages

`DefaultTokenEstimator.estimateMessageTokens` and `estimateToolMessageTokens` SHALL include a per-message overhead constant that approximates role markers, separators, and (for tool messages) tool-call wrapping. The overhead SHALL be non-zero for every non-empty message and SHALL be larger for tool messages than for regular messages.

#### Scenario: Per-message overhead is applied

- **WHEN** `estimateMessageTokens("user", "hi")` is called
- **THEN** the result is greater than `estimateTokens("hi")` by the per-message overhead constant

#### Scenario: Tool message overhead is at least as large as message overhead

- **WHEN** `estimateToolMessageTokens(toolCallId, toolName, content)` and `estimateMessageTokens("tool", content)` are computed for the same content
- **THEN** the tool-message overhead is greater than or equal to the regular message overhead, reflecting the additional protocol fields a tool message carries

