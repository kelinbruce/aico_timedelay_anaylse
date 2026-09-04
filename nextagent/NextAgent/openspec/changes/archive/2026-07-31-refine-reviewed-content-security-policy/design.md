## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.9 调用技能` | Skill Content 中的认证与凭据文本不再触发额外拒绝 | `skill-tool` | `FN-5.9 调用技能` |
| `FN-10.1 注册和执行钩子` | 终态输出保护不再改写 IP 地址 | `lifecycle-hook-execution` | `FN-10.1 注册和执行钩子` |

## `FN-5.9 调用技能`

### 目标与规范依据

本设计使已授权 Skill 的 canonical markdown body 按 authoring content 原样进入 hidden generated context，同时保留与凭据文本无关的来源、结构和注入安全边界。

#### 本 Function 的目标 Requirements

canonical spec：`skill-tool`

- `ADDED`：`Skill Content 不实施认证与凭据值检查`

### 当前实现

`packages/agent-capability/src/builtins/skill-tool.ts` 在已授权 source 返回 canonical body 后调用 `validateInlineBody(...)`。该校验先检查空正文、UTF-8 byte budget 和控制字符，再由 `containsSkillBodyLeakage(...)` 检查 host path、Authorization value 和 credential assignment。正文随后单独接受 `<skill_content>` wrapper-boundary 检查，并进入既有 Skill resource projection 与 hidden generated message 路径。

现有 `packages/agent-capability/tests/skill-tool.test.ts` 已证明安全领域术语和 placeholder 可加载，但把看似真实的 Authorization、Token、Password、API key、Secret 和 host path 放入同一个拒绝用例。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Skill Content 中的认证与凭据文本不构成额外拒绝条件 | `containsSkillBodyLeakage(...)` 对 Authorization value 和 credential assignment 执行形态匹配并失败 | 移除凭据值匹配，同时保留 host path 泄漏判断 |
| `/tmp/` 可作为 Skill Content 中的常见业务目录 | host path pattern 当前把 `/tmp/` 与受保护宿主路径统一拒绝 | 从该 pattern 移除 `/tmp/`，其余路径类别不变 |
| 非凭据内容边界保持生效 | 空正文、byte budget、控制字符、host path 和 wrapper boundary 已分别校验 | 测试需要把 credential 正路径与 host path negative case 分离 |

### 修改方案

`agent-capability` 保持 Skill inline load 的唯一 owner。`validateInlineBody(...)` 继续执行空正文、byte budget、控制字符和受保护 host path 检查，但删除 Authorization value、credential assignment、placeholder 判定及其辅助 normalization，并从 host path pattern 中移除 `/tmp/`。`containsSkillBoundary(...)`、来源授权、descriptor/body consistency、resource projection 和 generated message 构造均不修改。

测试把现有高置信凭据值拒绝用例改为成功加载并断言 hidden generated context 保留原文；`/tmp/` 作为业务路径进入正路径，其他受保护 host path 继续单独断言 safe failure。该路径不增加配置，不形成第二套 scanner，也不改变公共 contract。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全、可维护性、可测试性 | `skill-tool` / `Skill Content 不实施认证与凭据值检查` | 删除凭据内容启发式并允许 `/tmp/` 业务路径，只保留确定的来源、结构和注入边界校验 | credential/auth 与 `/tmp/` 正路径原文保留；其他受保护 host path、wrapper breakout 和控制字符负路径继续失败 |

## `FN-10.1 注册和执行钩子`

### 目标与规范依据

本设计使最终 client-visible 内容保留业务 IP 事实，同时维持 `system.output-redaction-guard` 对其他既有终态保护内容的转换和控制。

#### 本 Function 的目标 Requirements

canonical spec：`lifecycle-hook-execution`

- `MODIFIED`：`System output redaction guard protects final client-visible content`

### 当前实现

`packages/agent-runtime/src/lifecycle/system-output-redaction-guard.ts` 使用顺序固定的 replacement 列表处理 credential-like assignment、Bearer token、`sk-` token、手机号、内网 IPv4 和本地/内部路径。任一 replacement 命中后返回带 `AgentTerminalMutation.finalContent` 的 `PASS`；private key 仍在 replacement 之前返回 `BLOCK`。

现有 runtime 与 lifecycle hook 测试断言内网 IPv4 被替换为 `[REDACTED_INTERNAL_IP]`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| IPv4/IPv6 不因 IP 形态被改写或阻止 | replacement 列表会替换内网 IPv4；IPv6 当前不匹配 | 删除内部 IPv4 replacement，并用 IPv4/IPv6 正路径锁定目标行为 |
| 其他终态内容保护不变 | 其他 replacement 和 private-key `BLOCK` 与 IP pattern 解耦 | 更新混合内容测试，证明只改写非 IP 命中项 |

### 修改方案

`agent-runtime` 保持 lifecycle hook 执行与终态 mutation 的唯一 owner。唯一实现改动是从默认 replacement 列表移除内部 IPv4 pattern；不新增 IP allowlist、地址 parser 或配置开关。IPv6 没有现有 replacement，测试显式固定其原文通过行为。

现有 private-key blocking、credential-like、Bearer、`sk-` token、手机号、路径 replacement、custom rules、redaction token 和 hook wiring 均不修改。若 IP 与其他命中项共存，replacement pipeline 仍对其他命中项生成 mutation，IP 字符串自然保留。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全、可测试性 | `lifecycle-hook-execution` / `System output redaction guard protects final client-visible content` | 从既有终态 replacement 集合移除 IP 类别，不引入旁路或新策略 owner | IPv4/IPv6 单独出现时无 mutation；与其他敏感项混合时仅其他项被处理 |

## 验证策略（Verification Strategy）

- unit/contract 测试覆盖两个 Function 的可观察行为：Skill Content 凭据文本成功加载并保持原文，IP-only 终态内容保持原文。
- negative case 覆盖未放宽边界：Skill wrapper breakout、控制字符和除 `/tmp/` 外的受保护 host path 仍失败；private key 与其他终态敏感模式仍按既有策略处理。
- OpenSpec strict validation 与模型语义审查覆盖 Function/spec 映射、目标态措辞、owner 边界和范围一致性。
- 后端 build、相关 package 测试、contract tests 与 architecture lint 证明没有公共 contract 或 package 边界回归。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/skill-tool/spec.md`：归档时增加 Skill Content 不实施认证与凭据值检查的 Requirement，并收敛现有 inline body check 表述。
- `openspec/specs/lifecycle-hook-execution/spec.md`：归档时更新终态输出保护 Requirement，移除 IP 脱敏义务。
- `openspec/designs/functions/D5-Capability能力体系/D5.3-Skill与检索/FN-5.9-调用技能.md`：归档时更新处理过程和结果摘要。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.1-注册和执行钩子.md`：归档时更新处理过程和结果摘要。
- `openspec/designs/features/D5-Capability能力体系/D5.3-Skill与检索/F-5.6-Skill系统.md`：归档时更新用户可依赖的 Skill Content 边界摘要。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.1-扩展生命周期钩子.md`：归档时更新终态 IP 保留的用户可依赖质量保证。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无。
- `openspec/designs/modules/agent-capability.md`：归档时更新 Skill inline body 校验边界。
- `openspec/designs/modules/agent-runtime.md`：归档时更新 system output redaction guard 的默认保护类别。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化。

## 风险与取舍（Risks / Trade-offs）

- Skill Content 可能包含真实凭据；本次评审结论明确选择在已授权 Skill authoring content 边界不做额外内容扫描。缓解方式是继续禁止 source-private fact 泄漏，并保持日志、audit、stream、safe error、配置和 provider 边界的既有 credential/token 保护。
- 最终回答可能展示内网 IP；这是网络诊断可用性的目标行为。其他内容类别仍由终态 guard 独立处理，避免扩大到未评审边界。

## 待确认问题（Open Questions）

无。
