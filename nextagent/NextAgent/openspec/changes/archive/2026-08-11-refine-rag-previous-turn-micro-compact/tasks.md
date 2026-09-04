## 1. Context Engine implementation

- [x] 1.1 新增上一完整轮次 RAG 候选识别，并验证当前 request、较早历史轮次和非法结果不会被误选。
- [x] 1.2 新增 RAG 专用有界占位与 model-visible replacement，保持 capability result envelope、tool call 配对和 canonical record 不变。
- [x] 1.3 将 RAG 专用规则与既有通用 `>10 / keepRecent=5` 规则独立组合，保证重复 assembly 重放替换但只提交新增 state。

## 2. Tests and validation

- [x] 2.1 增加集成测试，覆盖历史轮次一条/多条 RAG 全部替换、当前轮 RAG 保留、通用规则不变和重复 assembly 幂等。
- [x] 2.2 增加 render/state 测试，覆盖 canonical reload 后重放 RAG 占位、非法 state 安全降级及 summary compression 清理兼容性。
- [x] 2.3 运行受影响包测试、workspace build/test/contract/architecture 门禁以及 `openspec validate --all --strict`，记录实际结果。

## 3. Review and delivery

- [x] 3.1 使用 `nextagent-code-review` 对最终 diff 和验证证据进行语义检视，修复所有 P0/P1 问题。
- [x] 3.2 创建单一职责 commit，推送 `codex/fix-rag-previous-turn-micro-compact` 并创建一个 PR。

## 4. Assemble-to-render reliability correction

- [x] 4.1 检查 micro-compact metadata 版本化写入结果，版本冲突时合并最新 state 并有界重试。
- [x] 4.2 render 合并持久化 state 与本次 selected history 可确定识别的上一轮 RAG ids，不以 metadata 写入成功作为本次投影前提。
- [x] 4.3 增加真实 `assemble → render` 回归测试，覆盖正常写入、版本冲突和写入异常，且当前轮 RAG 保持完整。
- [x] 4.4 运行受影响测试、workspace/OpenSpec 门禁和语义检视，更新并推送原 PR。

## 5. Final ModelMessage projection invariant

- [x] 5.1 在 render 最终投影边界对已选中的上一轮 RAG `tool-result.output` 强制重放占位，不依赖中间 record mutation。
- [x] 5.2 使用真实 `USER → ASSISTANT(text + tool-call) → TOOL → ASSISTANT → USER` 结构和多条 RAG 结果精确断言最终 output。
- [x] 5.3 运行验证、语义检视并更新原 PR。

## 6. Cumulative historical RAG recomputation

- [x] 6.1 将 RAG 专用扫描扩展为全部 `priorTurnCandidates`，保持通用白名单阈值与当前 request 保护不变。
- [x] 6.2 增加第三轮 metadata 缺失时第一、二轮 RAG 均保持占位的 assemble-to-render 回归测试。
- [x] 6.3 合并最新主线、解决 PR 冲突，运行验证和语义检视并更新原 PR。
