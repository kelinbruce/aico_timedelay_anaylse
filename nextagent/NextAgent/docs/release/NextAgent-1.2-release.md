# NextAgent 1.2 Release Notes

> 版本基线：v1.1 → v1.2
> 发布日期：2026-06-18
> 变更统计：61 commits（59 merged + 2 pending）

## 摘要

v1.2 是一个以 **Prompt Template Assembly 重构** 和 **TESTClaw 端到端测试框架落地** 为核心的版本，同时修复了 Tool-Loop 错误恢复、Python 工具安全处理和 Windows 沙箱兼容性等生产路径问题。

### 核心变更

1. **Prompt Template Assembly 重构** — 全新模板编译/装配管线取代旧 profile-resolver 路径，支持 SYSTEM_PROMPT、SUMMARY_GENERATION、MEMORY_EXTRACTION 三类内置模板，移除 14 个旧模块。
2. **TESTClaw 端到端测试框架** — Playwright + Vitest 双栈 E2E 框架，覆盖业务流、并发、非功能、规格断言和 UI 交互五大类 100+ 测试用例。
3. **Tool-Loop 错误恢复** — 工具执行失败不再直接中断循环，按 safe error category 分类，模型可自主决策重试或换工具。
4. **Python 工具安全处理对齐** — 校验错误包装为 safe result，与 Bash 工具同形同策。
5. **Windows 沙箱兼容性** — 通过 PATH 环境变量解析可执行文件路径，不再依赖 `where` 命令硬编码。
6. **Skill 工具稳定性修复** — 修复 this 绑定丢失、空值字段处理和资源投影消息保留等问题。
7. **上下文装配优化** — 大内容分类与截断集成到 context assembly pipeline。
8. **构建与打包加固** — tsc 编译失败后仍然复制部署资产，沙箱配置语义反转为正向开关。

### 兼容性

- 向后兼容 v1.1 配置和 API。
- Prompt 模板目录从 `prompt-configs/` 迁移到 `prompt-templates/builtin/`，旧目录已删除。
- 沙箱配置项 `sandbox.disable` 语义反转为 `sandbox.enabled`，默认 `true`。
- 工具 PascalCase 重命名已回退，保持 v1.1 命名不变。

---

## 详细变更

### 1. Prompt Template Assembly 重构

**变更范围**：`agent-context-engine`、`agent-contracts`、`agent-app`

旧 `profile-resolver` + `configurable-system-prompt-builder` 路径被完全移除，新管线由五个模块组成。这是 v1.2 最重要的架构级变更。

#### 新模块

| 模块 | 职责 |
|------|------|
| `prompt-template-types.ts` | 模板类型定义（TemplateDefinition、Section、Purpose） |
| `prompt-template-registry.ts` | 内置模板注册与查找 |
| `prompt-template-compiler.ts` | 模板编译：section 加载、变量解析、policy 应用 |
| `prompt-template-assembler.ts` | 将编译产物装配为 context-engine render input |
| `prompt-template-purpose-policy.ts` | 按 purpose（SYSTEM/SUMMARY/MEMORY）选择 section 组合策略 |

#### 内置模板

- `SYSTEM_PROMPT` — 系统提示（identity、action-safety、tooling、workspace、agent-delegation 等 section）
- `SUMMARY_GENERATION` — 上下文压缩摘要生成
- `MEMORY_EXTRACTION` — 长期记忆提取

#### 移除的旧模块

- `configurable-system-prompt-builder.ts`
- `profile-resolver.ts`
- `prompt-builder-factory.ts`
- `prompt-config-paths.ts`
- `prompt-domain-resolver.ts`
- `section-content-resolver.ts`
- `section-definition-loader.ts`
- `section-definition.ts`
- `telecom-system-prompt-builder.ts`
- `template-loader.ts`
- `default-system-prompt.ts`
- `prompt-profile.ts`
- `dynamic-resolvers.ts`

**相关提交**：
- `4cb8863` feat(prompt-assembly): add context-engine prompt template assembly
- `3d38a91` refactor(prompt-assembly): remove legacy system builder path
- `c2d4322` refactor(prompt-assembly): use neutral render context
- `ce46416` refactor(prompt-assembly): isolate system prompt policies
- `de2db22` fix(prompt-assembly): preserve migrated builtin prompt semantics
- `f22d791` fix(prompt-assembly): apply summary template model options

---

### 2. TESTClaw 端到端测试框架

**变更范围**：`tests/TESTClaw/`（新增 package）

全新端到端测试框架，采用 Playwright（SSE stream 消费）+ Vitest（断言与编排）双栈架构，替代原有零散 E2E 脚本。

#### 测试分类

| 类别 | 用例数 | 覆盖范围 |
|------|--------|----------|
| `business-flow/` | 40+ | 会话、请求、附件、历史、技能调用、上下文管理 |
| `concurrency/` | 9 | 并发请求、lane 冲突、gateway 竞争、run 状态并发 |
| `non-functional/` | 14 | 性能、可靠性、弹性、安全 |
| `spec-shall/` | 120+ | OpenSpec SHALL 断言（架构、契约、安全、生命周期） |
| `ui-interaction/` | 16 | SSE stream 消费、transport 切换、心跳 |

#### 基础设施

- `scripts/run-tests.ps1` — PowerShell 测试运行器
- `scripts/setup-package.mjs` — 测试包初始化
- `scripts/lint-tests.mjs` — 测试用例静态检查
- `helpers/` — HTTP client、SSE 消费、进程管理、证据读取
- `fixtures/` — local-gateway、test-agent 预设

#### 稳定性修复

- SSE race condition 修复 — 10 个 Playwright 测试中的并发竞态已解决
- SSE stream 消费稳定性 — 断流和超时问题已加固
- zip-based pack entry — 新增基于 zip 的打包入口测试
- E2E gate 依赖稳定化 — 解决依赖安装和环境准备的偶发失败

**相关提交**：
- `16bb039` feat: Add TESTClaw test framework with OpenSpec change
- `73b4010` test(testclaw): fix SSE race condition in 10 playwright tests
- `fe6b5c8` test(testclaw): stabilize e2e gate and dependency setup
- `16341b0` test(testclaw): add zip-based pack entry and stabilize gates
- `d481318` test(testclaw): stabilize playwright sse stream consumption
- `24de596` perf: increase Playwright E2E workers, add TESTCLAW-PW-WORKERS-010 spec
- `e7634c5` chore: remove legacy basic/ and New/ suite directories

---

### 3. Tool-Loop 错误恢复

**变更范围**：`agent-core`

v1.2 最关键的运行时行为变更之一。工具执行失败不再直接终止 tool-loop，而是分类为 safe error category，模型可根据错误类别自主决策重试、换工具或结束。

#### 错误分类与行为

| 错误类别 | 行为 |
|----------|------|
| `PERMISSION_DENIED` / `VALIDATION_ERROR` | 不可重试，立即终止并返回错误摘要 |
| `UNAVAILABLE` | 可重试，模型可再次调用同一工具 |
| `EXECUTION_ERROR` / `TIMEOUT` | 模型可换工具或调整参数重试 |
| `UNKNOWN` | safe failure，终止并返回错误摘要 |

#### 变更前后对比

- **v1.1**：任何工具失败 → tool-loop 立即终止 → `REQUEST_FAILED`
- **v1.2**：工具失败 → 分类错误 → 模型决策重试/换工具/结束 → 可能恢复或 safe failure

**相关提交**：
- `48343aa` fix(core): let model recover from tool failures instead of aborting the loop
- `b42e672` refine(tool-loop): categorize tool failures by safeError category
- `0b0c3c9` feat(tool-loop): support retryable errors in UNAVAILABLE scenarios
- `6058b2f` test: update logging test expectation after tool-loop continue fix

---

### 4. Python 工具安全处理对齐

**变更范围**：`agent-capability`

Python 工具的校验错误和执行错误处理方式与 Bash 工具完全对齐，遵循同形同策原则：

- **校验错误**（schema 不匹配、参数缺失）— 包装为 safe result，不抛异常
- **执行错误**（脚本运行时错误）— 返回 safe error envelope，不中断请求

变更前后对比：

| 场景 | v1.1 | v1.2 |
|------|------|------|
| Python 参数校验失败 | 抛异常，请求中断 | safe result，模型可读错误并决策 |
| Python 脚本运行失败 | 异常传播 | safe error envelope，模型可重试 |

**相关提交**：
- `9fbc35d` fix(python-tool): align error handling with bash pattern
- `c0b604f` fix(agent-capability): align Python tool error handling with Bash pattern
- `f66c503` fix(capability): wrap python-tool validation errors in safe result

---

### 5. Windows 沙箱兼容性

**变更范围**：`agent-platform-gateway-local`

修复 Windows 环境下沙箱可执行文件路径解析问题，提升跨平台部署可靠性。

#### 关键改进

- 优先通过 `process.env.PATH` 查找可执行文件
- 回退到 `where <command>` 解析
- `git` 路径解析不再依赖硬编码路径
- `whoami.exe` 使用绝对路径避免 PATH 缺失场景

**相关提交**：
- `fe1eaee` fix(sandbox): resolve executables via where git and PATH fallback on Windows
- `f58f507` fix(sandbox): resolve git path via PATH env instead of where command on Windows
- `658dd7f` fix(agent-platform-gateway-local): use absolute path for Windows whoami.exe

---

### 6. Skill 工具稳定性修复

**变更范围**：`agent-capability`、`agent-core`

修复多个 Skill 工具在生产路径中的稳定性问题。

#### 修复内容

- **this 绑定丢失** — skill 资源读取器中 `this` 绑定在异步调用链中丢失，导致资源加载失败
- **空值字段处理** — skill manifest 中 optional 字段的空字符串、null、undefined 统一视为未提供
- **资源投影消息保留** — skill resource projection messages 在 core 层被意外丢弃
- **skill body 输出修正** — skill body 从 `generatedMessages`（USER 消息）改为 `structuredPayload`（tool result），与能力结果输出对齐
- **Skill 发现日志增强** — 添加 skill 资源操作的错误日志和日志调用签名修复

**相关提交**：
- `24358ad` fix(agent-capability): preserve this binding in skill resource reader
- `e7313bf` fix(skill): handle all empty value formats for optional fields
- `eb539cb` fix(skill): treat empty string optional fields as not provided
- `08b1142` fix(agent-core): preserve skill resource projection messages
- `937d38b` fix: skill body 从 generatedMessages (USER 消息) 改为 structuredPayload (tool result)
- `d4d6214` feat(skill-discovery): add error logging for skill resource operations and fix logger call signatures

---

### 7. 沙箱配置语义反转

**变更范围**：`agent-runtime`、`agent-app`

沙箱配置从负向开关 `sandbox.disable`（默认 `false`）改为正向开关 `sandbox.enabled`（默认 `true`），语义更直观，与行业惯例一致。

| 阶段 | 配置项 | 默认值 | 含义 |
|------|--------|--------|------|
| v1.1 | `sandbox.disable` | `false` | 禁用沙箱 |
| v1.2 | `sandbox.enabled` | `true` | 启用沙箱 |

**相关提交**：
- `f20f690` refactor(sandbox): rename disable to enabled and default to true

---

### 8. 上下文装配优化

**变更范围**：`agent-context-engine`

将大内容分类与截断逻辑集成到 context assembly pipeline，避免大内容导致上下文溢出或静默丢失。

#### 关键改进

- **大内容分类** — 在 pipeline 中识别大内容并分类
- **策略截断** — 按分类策略截断而非静默丢弃
- **共享截断函数** — 提取公共截断逻辑，消除重复
- **原地修改** — 截断采用 record content 原地修改，减少内存拷贝

**相关提交**：
- `a4c3cd2` feat: integrate large-content classification into context assembly pipeline
- `38fd0a5` refactor: extract shared large-content truncation functions
- `de3bb17` fix: mutate record content in-place for large-content truncation

---

### 9. 模型配置优化

**变更范围**：`agent-model`、`agent-app`

#### 关键改进

- **credentialRef 可选化** — 本地模型场景（如本地部署的开源模型）可省略 credential 引用
- **环境变量引用** — 默认配置中 model name 和 base URL 改为环境变量引用，避免硬编码
- **最大重试次数提升** — max retries 从 2 提升到 3，降低瞬态网络故障导致的请求失败率
- **NextAgent path link 遍历** — 允许 nextagent path link traversal，支持符号链接部署场景

**相关提交**：
- `4a7ee45` feat(model-profile): make credentialRef optional for local model scenarios
- `7e921b6` chore(agent-app): use env references for model name and base URL in default config
- `e624b82` chore(agent-app): bump max retries from 2 to 3
- `347b7f8` fix(agent-capability): allow nextagent path link traversal

---

### 10. 构建与打包加固

**变更范围**：`agent-app`、`scripts/`

#### 关键改进

- **tsc 构建合并** — 将 `tsc -b` 合并到 copy 脚本，跨平台兼容
- **asset 复制解耦** — asset 复制不再依赖 tsc 编译结果，即使 TypeScript 编译失败也始终复制部署所需文件
- **tsc 失败后 asset 复制** — 确保 TypeScript 编译失败后仍然复制必要资产到打包目录
- **配置文件重命名** — `default-system.json` 重命名为 `default-system.yaml` 保持命名一致性
- **服务器启动失败日志** — 记录 server listen 启动失败的详细信息，便于部署诊断

**相关提交**：
- `a4082fb` refactor(build): merge tsc -b into copy script for cross-platform compatibility
- `73df8aa` fix(build): decouple asset copy from tsc result so deployment packaging always copies files
- `48606b2` fix(build): copy assets after TypeScript failures
- `a6c756b` chore(packaging): rename config file to default-system.yaml for consistency
- `d5b56d8` fix(agent-app): log server listen startup failures

---

### 11. 工具命名回退

**变更范围**：`agent-capability`

v1.1 中尝试将内置工具（read/write）重命名为 PascalCase（Read/Write），因与外部兼容性要求冲突，v1.2 中完全回退。

**相关提交**：
- `ee04238` Revert "fix(agent-capability): rename read/write tools to PascalCase"
- `463a277` fix(agent-capability): rename read/write tools to PascalCase（被回退）

---

## 配置变更

### 变更配置项

| 配置项 | v1.1 | v1.2 | 说明 |
|--------|------|------|------|
| `sandbox.disable` | boolean (默认 `false`) | **已移除** | 改用 `sandbox.enabled` |
| `sandbox.enabled` | — | boolean (默认 `true`) | 启用沙箱执行 |

### 新增配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `sandbox.enabled` | boolean | `true` | 启用沙箱执行（测试环境可设为 `false`） |
| `modelProfiles[].credentialRef` | string | 可选 | 本地模型场景可省略 credential 引用 |

### 移除配置

- `default-agent.yaml` 中的 `prompts.system` 和 `prompts.summary` 配置项已移除，改为内置模板自动装配。
- 默认配置中硬编码的 model name 和 base URL 改为环境变量引用（`MODEL_NAME`、`MODEL_BASE_URL`）。

### 配置迁移示例

```yaml
# v1.1 配置
sandbox:
  disable: true    # 禁用沙箱

# v1.2 配置（等价）
sandbox:
  enabled: false   # 禁用沙箱
```

### 配置示例

```yaml
sandbox:
  enabled: true  # 生产环境保持默认启用
  clipcExecutableDirectoryEnv: CLIP_HOME
  builtinExecutables:
    - ls
    - cat
    - grep
    - head
    - tail
    - wc
    - curl
    - python
    - python3
    - clipc
```

---

## 打包与部署

### 打包目录结构

v1.2 打包产物包含以下目录：

```
nextagent-local-<platform>-<arch>/
├── bin/              # 入口脚本
├── config/           # 配置文件（default-system.yaml）
├── backend/          # 后端代码
├── data/             # 数据目录
├── logs/             # 日志目录
├── run/              # 运行时状态
├── skills/           # Skill 资源目录
├── workspaces/       # 工作空间
└── node_modules/     # 依赖
```

### 构建行为变更

v1.2 的构建流程中，asset 复制与 TypeScript 编译解耦：

- `npm run build` 即使 tsc 编译失败，也会复制部署所需的 asset 文件
- 打包目录中配置文件已统一使用 `.yaml` 后缀

---

## 测试与验证

### 测试覆盖

- **单元测试**：300+ passed
- **集成测试**：12 passed | 3 skipped
- **Contract 测试**：9 suites passed
- **E2E 测试（TESTClaw）**：100+ 用例
- **Architecture 测试**：workspace、packaging、prompt-template-assembly boundary

### 新增测试

| 测试文件 | 覆盖范围 |
|----------|----------|
| `tests/architecture/prompt-template-assembly-boundary.test.ts` | prompt 装配架构边界 |
| `packages/agent-capability/tests/path-security.test.ts` | 路径安全校验 |
| `packages/agent-context-engine/tests/large-content-render.test.ts` | 大内容截断策略 |
| `tests/TESTClaw/tests/` | 全量 E2E 测试套件 |

### 验证命令

```bash
npm run build
npm test
npm run test:contract
npm run lint:architecture
npm run pack:release
npm run release:qualify
```

TESTClaw 测试：

```bash
cd tests/TESTClaw
npm run test:e2e
```

---

## 已知边界

- Prompt Template Assembly 重构已完成，但自定义模板扩展点尚未在复杂场景下充分验证。
- TESTClaw 框架已落地，部分 Playwright 测试在 CI 环境下存在偶发 SSE race condition，已增加重试机制。
- Tool-Loop 错误恢复仅在单工具场景下验证，多工具长链路恢复路径待后续版本补充。
- 上下文大内容截断策略已完成，但极端大小内容（>1MB）的行为待进一步验证。
- 工具 PascalCase 重命名已回退，后续版本可能重新评估命名策略。

---

## 升级指南

### 从 v1.1 升级到 v1.2

1. **配置迁移**：
   - `sandbox.disable: true` → `sandbox.enabled: false`
   - `default-agent.yaml` 中的 `prompts.system` 和 `prompts.summary` 配置可移除，内置模板自动生效。
2. **重新构建**：执行 `npm run build` 后重新打包 `npm run pack:release`。
3. **运行 TESTClaw**：`cd tests/TESTClaw && npm run test:e2e` 验证部署健康。
4. **模型配置**：本地模型场景可省略 `credentialRef`，远程模型保持不变。

### 回滚方案

如需回滚到 v1.1：

```bash
git checkout v1.1
npm install
npm run build
```

---

## 变更统计

| 类别 | 提交数 |
|------|--------|
| feat（新功能） | 7 |
| fix（缺陷修复） | 24 |
| refactor（重构） | 6 |
| test（测试） | 7 |
| chore（杂项） | 8 |
| docs（文档） | 5 |
| perf（性能） | 1 |
| revert（回退） | 2 |
| **合计** | **61** |

---

## 贡献者

本次发布包含来自以下贡献者的提交：

- Gongxuping
- Codex AI Assistant

感谢所有参与 v1.2 开发和测试的贡献者。
