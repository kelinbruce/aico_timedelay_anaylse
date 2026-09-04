# Skill Inline Body Encoding Backstop

## ADDED Requirements

### Requirement: Skill Inline Body Rejects Replacement Character

The Skill Tool inline body boundary check MUST reject a canonical Skill body that contains the Unicode replacement character `U+FFFD` before the body is injected into request-local hidden generated context.

A `U+FFFD` in the body means the body was decoded from bytes that were not valid UTF-8 (for example GBK or Latin-1). The model cannot read garbled instructions, so the body MUST be rejected rather than silently injected through the `<skill_content>` envelope. This check is a defense-in-depth backstop: the Skill manifest reader rejects non-UTF-8 sources upstream with `SKILL_MD_UNSUPPORTED_ENCODING` on both discovery and invocation paths, and this check guards any non-file body source or a race where the source encoding changes between discovery and invocation.

When the body contains `U+FFFD`, the Skill Tool MUST return a terminal `FAILED` result with `safeError.code` `EXECUTION_FAILED` and `category` `VALIDATION`. The safe error MUST NOT expose the raw body content, byte prefixes, or the detected encoding.

- **Owner Function**: Skill Tool Function
- **Function Change Type**: MODIFIED
- **Spec Role**: Incremental requirement
- **Requirement Category**: Correctness / Security

#### Scenario: Body containing a replacement character is rejected before injection

- **WHEN** an inline Skill canonical body contains one or more `U+FFFD` replacement characters
- **THEN** the Skill Tool MUST return a `FAILED` result with `safeError.code` `EXECUTION_FAILED` and `category` `VALIDATION`
- **AND** the Skill Tool MUST NOT inject the body into hidden generated context
- **AND** the safe error MUST NOT expose the raw body content or byte-level evidence

## Function 变更汇总

- ADDED `Skill Inline Body Rejects Replacement Character`: inline body 边界检查 MUST 拒绝含 `U+FFFD` 的 body，返回 `EXECUTION_FAILED`，作为编码校验的 defense-in-depth 兜底，满足既有 "expected text encoding" 检查要求。
