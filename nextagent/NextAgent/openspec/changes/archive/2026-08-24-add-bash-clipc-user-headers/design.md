## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.5 执行命令和脚本` | Bash Tool 仅在 Skill 通过 `api_header_params` opt-in 时，为 `clipc --params.header` 注入可信 `X-Subject-Id` / `X-Display-Name`，不注入 `tenantId` | `command-script-tools` | `FN-5.5 执行命令和脚本` |

## `FN-5.5 执行命令和脚本`

### 目标与规范依据

本设计落实 proposal 中“Skill 显式 opt-in 后，Bash + `clipc` 才携带当前用户身份，且身份来源必须为可信执行上下文”的目标。实现只改变 Bash Tool 在提交 sandbox 前对 `clipc --params` 的有限参数改写，不改变 Bash 的 tokenization、沙箱策略、执行结果、超时或输出语义。

#### 本 Function 的目标 Requirements

canonical spec：`command-script-tools`

- `ADDED`：`Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header`

### 当前实现

- `packages/agent-capability/src/builtins/bash/bash-tool.ts` 已把 Bash command 解析为 executable + argv，并在提交 sandbox 前注入 `NEXTAGENT_USER_ID`、`NEXTAGENT_USER_NAME`、`NEXTAGENT_CHAT_ID` 和 `NEXTAGENT_CONVERSATION_ID` 环境变量。
- 该实现不会解析 `clipc --params`，也不会把 `identityContext.subjectId` 或 `displayName` 写入 `--params.header`。
- `clipc` 直接以 argv 形式执行，不做 shell 变量展开，因此 Skill 不能通过 `$NEXTAGENT_USER_ID` 之类写法可靠传参。
- 当前 Bash Tool 对非 `clipc` 命令没有 `--params` 语义，也不应引入通用 JSON 参数改写。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| `opt-in 的 `clipc --params.header` 自动包含 `X-Subject-Id` 和 `X-Display-Name` | Bash Tool 不解析 `--params` | 需要在提交 sandbox 前做受限 JSON 解析与合并 |
| 身份来自可信执行上下文 | 当前仅有环境变量注入，不能覆盖模型传入的 `--params.header` | 需要把 `identityContext.subjectId/displayName` 写入 `--params.header` 并覆盖同名键 |
| 不注入 `tenantId` | 当前无该行为 | 明确不生成、不覆盖 `tenantId` 或 `Agent-Tenant-ID` |
| 非 `clipc` 命令不受影响 | 当前无 `--params` 处理 | 注入逻辑必须限定 executable 精确等于 `clipc` |
| `--params` 缺失或非法时不合成参数 | 当前无该行为 | 保持原 argv 不变，避免为未知 `clipc` 语法引入新行为 |

### 修改方案

唯一实现路径是在 `bash-tool.ts` 的命令解析完成后、Skill 相对路径解析和 sandbox 提交前读取 active Skill 的 `apiHeaderParams`，并只保留 `X-Subject-Id` / `X-Display-Name` 中已声明的字段：

1. 仅当 `parsed.executable === 'clipc'` 且 active Skill 的 `apiHeaderParams` 声明了至少一个支持的身份 header 时执行。
2. 在 argv 中精确查找 `--params` token。
3. 仅当 `--params` 后续 token 存在且能解析为 JSON object 时执行改写；其他情况原样返回。
4. 读取或初始化 `params.header` 为 JSON object。
5. 仅合并已声明的字段：
   - `header.X-Subject-Id = identityContext.subjectId`
   - `header.X-Display-Name = identityContext.displayName`
6. 用 `JSON.stringify` 重新序列化整个 `--params` object，替换原 token，其他 argv 位置不变。
7. 不添加、不删除、不覆盖 `tenantId` 或 `Agent-Tenant-ID`。
8. 继续走既有 `resolveSkillRelativeScriptArgs`、sandbox policy 和 execution path。

同步更新 Bash Tool 的模型可见 description，说明只有 Skill 通过 `api_header_params` 声明时，`clipc --params` 中的 `X-Subject-Id` 和 `X-Display-Name` 才由 runtime 注入，模型不应手写这两个身份字段，也不应询问用户。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header` | 身份值只来自 `identityContext`，并覆盖模型输入；不注入租户字段 | 覆盖伪造值、未 opt-in 不注入、非 `clipc` 不注入、非法 `--params` 不改写 |
| 可测试性 | `Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header` | 注入逻辑在 Bash Tool 内可由单元测试直接观察最终 sandbox argv | opt-in 注入、保留其他字段、未 opt-in 不改写、无 `--params` 不改写 |

## 验证策略（Verification Strategy）

- 单元测试覆盖 `clipc` 正常注入、模型同名值覆盖、保留其他字段、不注入租户字段。
- 单元测试覆盖 executable 不是 `clipc`、`--params` 缺失、`--params` 非 JSON object 时不变更 argv。
- 模型可见 Tool description 测试确认新增指导不导致模型手写身份字段。
- Bash Tool 及全部内置工具的模型可见 description 必须保持在 `ModelToolDescriptorSchema` 既有 4096 字符门禁内；新增统一的 builtin tool description 长度回归测试防止后续膨胀再次触发模型调用前置校验失败。
- 保持既有 Bash tokenization、sandbox 提交和执行结果测试不回退。
- OpenSpec strict validation 验证 change 文档一致性。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/command-script-tools/spec.md`：归档时合并 `Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header`。
- `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.5-执行命令和脚本.md`：归档时补充 `clipc` 身份 header 行为。
- `openspec/designs/features/D5-Capability能力体系/D5.2-内置工具/F-5.3-命令执行工具.md`：归档时补充用户身份注入的用户价值。
- `openspec/designs/modules/agent-capability.md`：如已有 Bash Tool 设计章节，则补充该受限注入边界。
- `openspec/designs/spec-to-design-map.md`：补充或确认 `command-script-tools` 到 Bash Tool 设计的导航。
- `openspec/overview.md`、architecture、ADR：无。

## 风险与取舍（Risks / Trade-offs）

- 只支持 `--params` 后续值为 JSON object 的形态，不支持 `--params=<json>` 或其他等价写法；这是为了保持最小变更并与现有 `clipc` 用例一致。
- 不在 `--params` 缺失或非法时合成身份参数，避免 Bash Tool 猜测 `clipc` 的未知语法。
- 不注入 `tenantId`，避免把用户当前明确排除的字段带入契约；后续如需要，另开 change。

## 待确认问题（Open Questions）

无。
