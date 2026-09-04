# NextAgent v1.3 Release Notes

**发布日期**: 2026-06-22
**版本范围**: v1.2 → v1.3
**变更统计**: 137 commits, 涉及 12 个核心子系统

## 🎯 核心亮点

v1.3 是一个功能增强版本，重点提升了 Agent 运行时的生命周期管理能力、安全策略执行、以及内置工具的治理水平。主要特性包括：

- **生命周期钩子执行**: 支持配置驱动的钩子目录加载，增强启动阶段的可观测性和容错能力
- **风险策略强制执行**: 实现前置策略评估，确保能力调用在执行前通过策略审查
- **内置工具 PascalCase 对齐**: 统一 Edit、Grep、Write 等核心工具的命名规范
- **Agent 路由治理**: 引入托管 Agent 发现机制，支持基于策略的技能目标解析
- **提示词模板装配**: 支持 section-level merge，允许业务配置覆盖内置模板

## 🚀 新功能

### 1. 生命周期钩子执行 (Lifecycle Hook Execution)

**OpenSpec Change**: `add-ts-lifecycle-hook-execution`

- 支持从 `config root` 加载钩子目录 (`feat(agent-app): load lifecycle hooks from config root`)
- 钩子执行错误采用 fail-open 策略，避免阻塞启动 (`fix(agent-runtime): fail open hook execution errors`)
- 支持 pending resume 语义，确保中断后可恢复 (`feat(runtime): execute lifecycle hooks with pending resume`)
- 简化钩子目录加载逻辑 (`refactor(agent-app): simplify hook directory loading`)
- 对齐失败处理和取消机制 (`refactor(runtime): align lifecycle hook failure handling and cancellation`)

### 2. 风险策略强制执行 (Risk Policy Enforcement)

**OpenSpec Change**: `add-ts-risk-policy-enforcement`

- 前置策略执行：能力调用必须通过策略审查 (`feat(risk-policy): enforce pre-execution policy outcomes`)
- 能力拒绝路由到策略层 (`fix(risk-policy): route capability denial through policy`)
- 对齐 replay 和可观测性强制执行 (`fix(risk-policy): align replay and observability enforcement`)

### 3. 内置工具增强

#### Edit 工具
- 新增精确字符串替换能力 (`feat(agent-capability): add Edit tool for exact string replacement`)
- 强化安全约束 (`fix(capability): tighten edit tool safety constraints`)

#### Grep 工具
- 新增受治理的 Grep 内置工具 (`feat(agent-capability): add governed grep builtin tool`)
- 支持全行匹配 (`fix(capability): match Grep over full lines`)
- 修正匹配计数逻辑 (`fix(capability): correct Grep match accounting`)

#### 工具命名规范化
- 统一 PascalCase 命名 (Read, Write, Edit, Grep, Bash, Python)
- 修复大小写不敏感的能力补丁引用 (`fix(context-engine): allow case-insensitive capability patch tool refs`)
- 对齐 Bash 工具的 timeout_ms 别名 (`fix(agent-capability): accept timeout_ms alias for bash tool`)

### 4. Agent 路由与发现

**OpenSpec Change**: `add-ts-agent-routing`

- 托管 Agent 发现：支持 invoked agent 模式 (`feat(capability): add invoked agent discovery`)
- 最小化策略配置契约 (`feat(routing): add minimal policy config contracts`)
- 策略输出窄化与技能目标执行 (`fix(routing): narrow policy output and execute skill targets`)
- 按运行时 Agent scope 解析策略 (`fix(agent-discovery): resolve policies by runtime agent scope`)
- 内置 Agent 包扫描与绑定 (`refactor(agent-core): scan builtin agent packages`)

### 5. 提示词模板装配

**OpenSpec Change**: `add-ts-prompt-template-assembly`

- Section-level merge：业务配置可覆盖内置模板 (`feat: agent prompt template section-level merge with builtin fallback`)
- 上下文引擎提示词装配 (`feat(prompt-assembly): add context-engine prompt template assembly`)
- 隔离系统提示词策略 (`refactor(prompt-assembly): isolate system prompt policies`)
- 中立的渲染上下文 (`refactor(prompt-assembly): use neutral render context`)

### 6. SkillHub 源集成

**OpenSpec Change**: `add-ts-skillhub-source`

- 源授权句柄管理 (`fix(skillhub): enforce source authorization handles`)
- 同步源加载到能力目录 (`feat(skillhub): sync source loading through capability catalog`)
- 硬化安装索引和首次发布范围 (`fix(skillhub): harden install index and first-release scope`)

### 7. 配置与环境

- 支持 `NEXTAGENT_CONFIG_DIR` 环境变量 (`fix(agent-app): honor NEXTAGENT_CONFIG_DIR for default config root`)
- 配置文件重命名为 `default-system.yaml` (`chore(packaging): rename config file to default-system.yaml`)
- 模型配置使用环境变量引用 (`chore(agent-app): use env references for model name and base URL`)

## 🐛 问题修复

### Runtime & Lifecycle
- 钩子目录执行错误 fail-open，避免启动阻塞
- 修复生命周期钩子集成门禁 (`fix(runtime): restore lifecycle hook integration gates`)
- Bash 非零退出结果降级处理 (`fix(capability): degrade bash non-zero exit results`)

### 工具调用
- 工具失败时模型可恢复，不中断循环 (`fix(core): let model recover from tool failures`)
- 工具循环支持可重试错误 (`feat(tool-loop): support retryable errors in UNAVAILABLE scenarios`)
- 工具失败分类基于 safeError 类别 (`refine(tool-loop): categorize tool failures by safeError category`)

### Windows & 沙箱
- 清除过期的 icacls deny 权限 (`fix(agent-platform-gateway-local): clear stale icacls deny`)
- 恢复 Windows 只读技能沙箱 (`fix(agent-platform-gateway-local): recover windows readonly skill sandbox`)
- 修复 Windows whoami.exe 绝对路径 (`fix(agent-platform-gateway-local): use absolute path for Windows whoami.exe`)
- Windows 路径解析使用 PATH 环境变量 (`fix(sandbox): resolve git path via PATH env`)

### Skill & Capability
- 技能资源投影消息保留 (`fix(agent-core): preserve skill resource projection messages`)
- 技能资源依赖投影 (`fix(capability): project skill resource dependencies`)
- 允许点前缀的技能资源路径 (`fix(agent-capability): allow dot-prefixed skill resource paths`)
- 技能扫描启动日志 (`feat(agent-capability): add skill scan startup logging`)

### 提示词 & 装配
- 迁移内置提示词语义保留 (`fix(prompt-assembly): preserve migrated builtin prompt semantics`)
- 摘要模板模型选项应用 (`fix(prompt-assembly): apply summary template model options`)
- 启用技能标题输出 (`fix: move enabledSkills heading into variable output`)

### Web & Channel
- 稳定能力结果详情刷新 (`fix(agent-web): stabilize capability result details across refresh`)
- 安全失败可理解化 (`fix(agent-web): make safe failures understandable`)
- 服务器监听启动失败日志 (`fix(agent-app): log server listen startup failures`)

### 构建 & 部署
- TypeScript 失败后仍复制资产 (`fix(build): copy assets after TypeScript failures`)
- 跨平台兼容：合并 tsc -b 到 copy 脚本 (`refactor(build): merge tsc -b into copy script`)
- 验证门禁恢复绿色 (`fix(build): restore green validation gates`)

## 📊 测试与质量

### 测试框架 (TESTClaw)
- 新增 TESTClaw 测试框架 (`feat: Add TESTClaw test framework with OpenSpec change`)
- 稳定 E2E 门禁和依赖设置 (`test(testclaw): stabilize e2e gate and dependency setup`)
- 修复 10 个 Playwright SSE 竞态条件 (`test(testclaw): fix SSE race condition`)
- 增加 Playwright workers 提升性能 (`perf: Increase Playwright E2E workers`)
- 清理历史测试套件 (`chore: Remove legacy basic/ and New/ suite directories`)

### 覆盖率增强
- 生命周期钩子执行覆盖 (`test(agent-kernel): split lifecycle hook execution coverage`)
- PascalCase Edit 和 Grep E2E 测试 (`test(capability): cover PascalCase Edit and Grep e2e`)
- 工作区工具调用技能 fixture (`test(e2e): add workspace tool calling skill fixture`)
- 产品路径授权流程对齐 (`test(risk-policy): align product paths with authorization flow`)

## 🔧 重构与优化

### Agent Core
- 内置 Agent 包所有权 (`refactor(agent-core): own builtin agent packages`)
- 按 active id 加载内置 Agent (`refactor(agent-app): load builtin agents by active id`)
- 清理 invoked agent discovery assembly (`refactor(agent-app): clean invoked agent discovery assembly`)

### Capability
- 折叠编译的 Agent assembly records (`refactor(agent-discovery): collapse compiled agent assembly records`)
- 重命名目标技能解析变量 (`refactor(agent-core): rename targeted skill resolution variable`)
- 沙箱启用标志重命名 (`refactor(sandbox): rename disable to enabled and default to true`)

### Prompt Assembly
- 移除遗留系统构建器路径 (`refactor(prompt-assembly): remove legacy system builder path`)

## 📚 文档更新

### OpenSpec
- 归档已完成的 OpenSpec changes:
  - `add-ts-lifecycle-hook-execution`
  - `add-ts-agent-routing`
  - `add-ts-skillhub-source`
  - `add-ts-edit-tool`
  - `add-ts-testclaw`

### 开发者指南
- 新增 Inspector 本地代理指南 (`docs(developer): add Inspector local proxy guide`)
- TESTClaw README 更新 (`docs(testclaw): document npm run pack command`)

### 发布说明
- v1.1 发布说明 (`docs(release): add v1.1 release notes`)
- v1.2 发布说明 (`docs(release): add NextAgent v1.2 release notes`)

## ⚠️ 已知限制

1. **生命周期钩子**: 当前仅支持配置驱动的钩子目录，动态注册待后续版本实现
2. **风险策略**: 策略评估结果暂不支持外部审计系统集成
3. **Agent 路由**: invoked agent discovery 仅支持 builtin 模式，hosted agent 集成待完善

## 📦 打包产物

- `nextagent-local-win32-x64.zip`: Windows 本地运行时包
- 包含 E2E 测试套件 (9 passed, 3 skipped)
- 验证门禁: 构建、测试、契约测试、架构检查全部通过

## 🔄 升级指南

### 从 v1.2 升级

1. **配置迁移**:
   - 检查 `NEXTAGENT_CONFIG_DIR` 环境变量配置
   - 配置文件重命名为 `default-system.yaml`

2. **工具调用**:
   - 更新客户端代码使用 PascalCase 工具名 (Read, Write, Edit, Grep)
   - Bash 工具 timeout_ms 参数保持兼容

3. **钩子目录**:
   - 如需使用生命周期钩子，在 config root 下创建 `hooks/` 目录
   - 钩子执行错误不会阻塞启动 (fail-open)

4. **Agent 路由**:
   - 如使用 invoked agent，确保配置了 minimal policy contracts
   - 检查 Agent scope 解析逻辑

### 兼容性

- **Breaking Changes**: 无
- **Deprecated**: 旧版工具名小写格式 (read, write, edit) 将在 v2.0 移除
- **Minimum Node.js**: LTS 版本要求不变

## 📊 统计

- **Commits**: 137
- **Packages Changed**: 12/14
- **Tests Added**: 45+
- **OpenSpec Changes**: 5 archived, 2 active
- **Bug Fixes**: 35+
- **New Features**: 7 major categories

---

**下一步**: v1.4 将聚焦长期记忆 2.0、Agent 自学习机制、以及生产环境可观测性增强。
