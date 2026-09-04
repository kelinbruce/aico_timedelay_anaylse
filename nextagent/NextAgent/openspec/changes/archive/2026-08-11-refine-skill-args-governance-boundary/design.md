## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.9 调用技能` | 移除 `Skill.args` 字段名黑名单，同时保持可信执行治理来源不变 | `skill-tool` | `FN-5.9 调用技能` |

## `FN-5.9 调用技能`

### 目标与规范依据

本设计落实 proposal 中 `Skill.args` 不按字段名拒绝业务 task data 的目标，不改变 Skill 执行链路或治理 owner。

#### 本 Function 的目标 Requirements

canonical spec：`skill-tool`

- `ADDED`：`Skill args 不按字段名承担执行治理`

### 当前实现

- `packages/agent-capability/src/builtins/skill-tool.ts` 的 `validateInput(...)` 在目标解析和 Skill source loading 前校验 `args`。
- `forbiddenArgKeys` 与 `findForbiddenKey(...)` 当前递归拒绝 `timeoutMs`、`timeout_ms`、`childBudget`、`child_budget` 和 `providerOverride`。
- Skill Tool description 与 `args` property description 当前指示模型不得提交这五个字段。
- JSON object、可序列化、8 层深度和 8,192 UTF-8 bytes 校验与字段名扫描彼此独立。
- `args` 不会映射到 runtime timeout、child budget、provider selection、Skill resolver 或 source loading 参数；实际治理继续来自 `ToolExecuteOptions.context`、policy 和受治理 metadata。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 任意字段名都不因名称被全局拒绝 | 仍存在五字段递归黑名单 | 合法业务 task data 会被误拒绝 |
| `args` 不承担执行治理 | 当前执行路径已经不消费这些字段 | 无执行路径 GAP；只需删除多余的字段名防线 |
| descriptor 准确说明边界 | 当前描述禁止五个具体字段 | 模型指导与目标输入边界冲突 |

### 修改方案

唯一实现路径保留 `agent-capability` 作为 Skill Tool input validation owner，并收敛现有私有校验链：

1. 删除 `forbiddenArgKeys`、`findForbiddenKey(...)` 及 `validateInput(...)` 中的字段名扫描，不创建替代黑名单、allowlist 或配置。
2. 删除本 change 前一版引入但目标态不再使用的 reserved-key `safeDetails` 支持；保留私有 `failed(...)` helper 的既有 retryable 行为。
3. 更新 Tool description 和 `args` property description：说明 `args` 只承载 task data，不能改变 runtime timeout、child budget 或 provider selection，不列禁止字段。
4. 更新现有 Skill Tool 单元测试，使十二个治理同名字段在根层和嵌套层都成功通过；保留非法 root shape、JSON serializability、深度和字节数测试。

不修改 `agent-contracts`、Capability invocation envelope、runtime timeout policy、Skill source、resolver 或 per-Skill schema。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；由 `Skill args 不按字段名承担执行治理` 的功能性边界保持 | `args` 与可信治理输入不存在映射，删除字段名猜测不扩大治理 authority | 治理同名字段成功，但执行路径仍只消费可信 context/policy/metadata |
| 可维护性 | 无新增黑盒质量目标；由同一功能性 Requirement 派生 | 删除黑名单、递归扫描和专用错误分支 | 不残留未使用 helper、错误码或描述文本 |
| 可测试性 | 无新增黑盒质量目标；由同一功能性 Requirement 派生 | 通过 model-facing Skill Tool invocation 观察字段名无关行为 | 十二字段根层/嵌套正例与既有 envelope 负例同时通过 |

## 验证策略（Verification Strategy）

- unit tests 通过 model-facing Skill Tool invocation 覆盖十二个治理同名字段在根层和嵌套层的成功结果。
- 既有 negative tests 继续覆盖非法 root shape、不可序列化输入、深度和字节数限制，证明仅字段名黑名单被移除。
- descriptor tests 验证模型指导只声明 task-data 与 trusted-governance 边界，不再列出禁止字段。
- OpenSpec strict validation 检查 Function/spec 映射与目标态一致性；TypeScript build 检查删除后无残留引用。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/skill-tool/spec.md`：归档时新增 `Skill args 不按字段名承担执行治理` Requirement。
- `openspec/designs/functions/D5-Capability能力体系/D5.3-Skill与检索/FN-5.9-调用技能.md`：归档时新增 `args` 字段名规则规格。
- Feature：无。
- `openspec/overview.md`：无。
- architecture：无；继续遵守既有 capability SPI 与 core contracts。
- `openspec/designs/modules/agent-capability.md`：归档时补充 Skill Tool task-data 与 trusted-governance 边界摘要。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化。

## 风险与取舍（Risks / Trade-offs）

- 字段名不再提供 defense-in-depth。该取舍是有意的：`args` 不进入治理输入，按名称猜测风险既不能证明越权，也会误伤电信业务数据；安全审查应关注是否存在从 `args` 到治理控制的真实数据流。
- 本 change 不提供 per-Skill 参数提示。精确参数 schema 属于独立能力，不进入当前范围。

## 待确认问题（Open Questions）

无。
