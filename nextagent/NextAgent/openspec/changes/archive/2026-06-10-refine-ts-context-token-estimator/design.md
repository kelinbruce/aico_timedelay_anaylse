## Contract Decisions

### TokenEstimator Interface

`agent-contracts/context` 新增以下类型：

```ts
export interface TokenEstimator {
  /** 估算纯文本的 token 数；空字符串返回 0；非空文本至少返回 1。 */
  estimateTokens(text: string): number

  /** 估算单条 message 的 token 数：内容 token 数 + per-message overhead。 */
  estimateMessageTokens(role: "system" | "user" | "assistant" | "tool", content: string): number

  /**
   * 估算单条 tool-message 的 token 数：toolCallId + toolName + content 内容 token 之和
   * 再加 per-tool-message overhead（高于普通 message，因为协议要 carry tool_call_id / tool_name）。
   */
  estimateToolMessageTokens(toolCallId: string, toolName: string, content: string): number

  /** 批量估算；语义等价于逐个调用 estimateTokens 后 sum，但实现可以做内部优化。 */
  estimateTokensBatch(texts: readonly string[]): number
}
```

接口归 `agent-contracts/context`，跟 `ContextAssemblyRequest` / `ContextAssembly` / `SystemPrompt` 同 subpath；不新增 `agent-contracts/token-estimator` 子路径，避免 contract 边界过度碎片化。

### DefaultTokenEstimator Algorithm

实现位置：`packages/agent-context-engine/src/budget/default-token-estimator.ts`。归 `agent-context-engine` 的理由是它在上下文工程链路里被多方消费（budget / shaping / memory / capability），但所有这些消费方都已经依赖 `agent-context-engine`，不需要新拆 package。

**码点感知迭代**（不用 UTF-16 length，避免 surrogate pair 切错）：

```ts
for (let i = 0; i < text.length; ) {
  const cp = text.codePointAt(i)!
  i += cp > 0xFFFF ? 2 : 1
  weightedSum += weightFor(cp)
}
return text.length === 0 ? 0 : Math.max(1, Math.ceil(weightedSum))
```

**权重**：

| 范围 | 权重 | 理由 |
|---|---|---|
| `cp > 0xFFFF`（增补面，emoji / CJK Extension B-G / 罕用字） | 2.0 | 这些码点在大多数 tokenizer 里平均占 2-3 个 token；2.0 是保守中位估计 |
| CJK 基本面（`0x3000-0x9FFF` 与 `0xFF00-0xFFEF`） | 1.5 | 包含 CJK Unified Ideographs basic / Extension A / Hiragana / Katakana / Hangul / CJK punctuation / fullwidth；BPE tokenizer 平均每个 CJK 字符约 1.5 token |
| ASCII（`< 0x80`） | 0.25 | 英文 BPE tokenizer 平均每 4 字符约 1 token |
| 其它 BMP（拉丁扩展、希腊、西里尔、阿拉伯、希伯来等） | 1.0 | 中性默认，避免对未列出语言系统性低估 |

**最小返回值**：非空文本至少 1 token（防止极短 ASCII 文本被估算成 0）。

### Message Overhead Constants

参考 OpenAI Chat API tokenizer 经验值（不绑定到特定 provider，作为通用上限保守估计）：

```ts
const MESSAGE_OVERHEAD_TOKENS = 4   // role marker + separators
const TOOL_MESSAGE_OVERHEAD_TOKENS = 10  // tool_call_id + tool_name + tool message wrapping
```

`estimateMessageTokens(role, content)` = `MESSAGE_OVERHEAD_TOKENS + estimateTokens(content)`。
`estimateToolMessageTokens(toolCallId, toolName, content)` = `TOOL_MESSAGE_OVERHEAD_TOKENS + estimateTokens(toolCallId) + estimateTokens(toolName) + estimateTokens(content)`。

替换实现可以重定义这些常量。本 change 把它们作为模块内部常量，不导出为公共契约——这样未来切换到精确 tokenizer 时不会破坏 ABI。

### Why Not Per-Provider Tokenizer

- 精确 tokenizer（tiktoken / huggingface tokenizers）依赖 provider-specific 资源，引入 native binding / WASM 加载，不适合放在跨 provider 的核心契约里。
- 真正需要 provider 精度的场景（如严格 token 计费）由 future implementation change 通过注入替换 `TokenEstimator` 实现解决，**不**改本 change 的接口形态。
- 当前算法为启发式估计；spec 的"估算"语义本来就承认 ±10-15% 误差。`add-ts-context-budget-explainability` 的预算决策有 60% history cap + 88.5% pre-send check ratio 双重缓冲，吸收估算偏差。

## Rejected Alternatives

- **每 message 由消费方自己 estimate**：拒绝，会导致 budget / shaping / memory 各自重新发明加权策略，无法跨模块一致。
- **把 TokenEstimator 放进 `agent-common`**：拒绝，agent-common 不应该依赖任何具体业务语义；token 估算是 context 工程的概念。
- **使用 UTF-16 length / `str.length`**：拒绝，会把 `"🎉"` 这种增补面字符算成 2 个"char"——但权重又被算两次（一次 0x3C + 一次 0x9C），结果完全错乱。必须 code-point-aware。
- **简单 `chars / 4`**：拒绝，对 CJK 文本系统性低估 6 倍以上，会让 budget gate 通过明显超限的输入。
