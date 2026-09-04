# NextAgent v1.6 Release Notes

**发布日期**: 2026-06-25
**版本范围**: v1.5 → v1.6 (当前 HEAD)
**变更统计**: 50 commits (32 non-merge), 221 文件变更 (+20,442 / -515), 覆盖 7 个核心子系统

## 摘要

v1.6 是一个以 **Workflow 执行引擎** 和 **Skill Catalog 治理** 为核心的版本。主要交付：

- **Workflow 执行引擎全链路实现** — 从路由契约、执行引擎、Gateway 节点语义到流式投影，构建完整的 Recipe 驱动执行管线，支持分支屏障、诊断追踪和结果投影。
- **Skill Catalog 查询与选择** — 实现 Skill 目录查询 API 和 Skill 选择器 UI，优化 manifest 校验报错信息，提升 Skill 治理的可观测性和安全性。
- **长期记忆自学习深化** — 实现记忆老化机制、本地轨迹提取和轨迹持久化，为长期记忆自学习提供数据基础。
- **Model Invocation Scope** — 新增模型调用作用域 headers，支持记忆提取时的调用上下文传递。
- **可观测性加固** — 修复运行时日志脱敏、追踪诊断和输入过滤问题。

---

## 🎯 核心亮点

### 1. Workflow 执行引擎全链路实现

**OpenSpec Change**: `add-ts-workflow-engine-contracts`

本版本最重大的变更，从零到一构建了生产级 Recipe 驱动执行引擎。

#### 路由契约与包结构
- 新增路由契约和包组合 (`feat(workflow): add routing contracts and package composition`)
- 统一 target workflow 到 target recipe 命名 (`refactor(workflow): rename target workflow to target recipe`)

#### 执行引擎核心
- 实现执行引擎 (`feat(workflow): implement execution engine`)
- 落地 Gateway 节点 Recipe 语义 (`feat(workflow): land gateway node recipe semantics`)
- 添加 Gateway 诊断追踪 (`feat(workflow): add gateway diagnostics`)
- 追踪 Gateway 分支屏障状态 (`feat(workflow): track gateway branch barrier state`)

#### 流式投影与结果处理
- 统一流式节点投影与核心能力循环 (`feat(workflow): unify streamed node projection with core capability loop`)
- 隔离结果投影和 Recipe 元数据 (`refactor(workflow): isolate result projection and recipe metadata`)
- 投影执行结果到终端路径 (`fix(workflow): project execution results into terminal path`)

#### 安全与边界
- 提前拒绝不支持的并行 Recipe (`fix(workflow): reject unsupported parallel recipes early`)
- 拆分并行 Gateway 与基础 Gateway 变更 (`refactor(workflow): split parallel gateway from base gateway change`)

### 2. Skill Catalog 查询与选择

**OpenSpec Change**: `add-ts-specify-skill-execution`

构建 Skill 目录治理体系，提升 Skill 选择的安全性和可观测性。

- 实现 Skill 目录查询 API 和 Skill 选择器 UI (`feat(skill-catalog): implement skill catalog query API and skill selector UI`)
- 优化 Skill manifest 校验报错信息，包含具体值和限制 (`fix(skill-manifest): 优化 skill manifest 校验报错信息，包含具体值和限制`)
- 解决代码审查发现的质量和安全问题 (`fix(skill-catalog): address code review findings for quality and safety`)
- 细化 Skill 目录查询设计 (`openspec(add-ts-specify-skill-execution): refine skill catalog query design`)
- 新增 Skill 目录 API 和 Skill 选择器 UI 变更规格 (`openspec(add-ts-specify-skill-execution): add skill catalog API and skill selector UI change spec`)

### 3. 长期记忆自学习深化

**OpenSpec Change**: `long-term-memory-review`

深化长期记忆自学习能力，构建记忆老化和轨迹提取机制。

#### 记忆老化
- 实现长期记忆老化 (`feat(memory): implement long-term memory aging`)
- 最终化长期记忆规格 (`archive(memory): finalize long-term memory specs`)
- 重命名核心规格为 memory-core (`docs(memory): rename core spec to memory-core`)

#### 轨迹提取与持久化
- 实现本地轨迹提取 (`feat(memory-extraction): implement local trajectory extraction`)
- 新增本地轨迹持久化 (`feat(task-trajectory): add local trajectory persistence`)

### 4. Model Invocation Scope

为模型调用增加作用域上下文，支持记忆提取时的调用链路传递。

- 新增调用作用域 headers (`feat(model): add invocation scope headers`)
- 为记忆提取模型请求添加 invocationScope (`fix(model): add invocationScope to memory extraction model request`)
- 将调用作用域设为可选 (`fix(model): make invocation scope optional`)

### 5. 可观测性加固

加固运行时日志脱敏和追踪诊断。

- 保持运行时日志中 prompt 字段脱敏 (`fix(observability): keep prompt fields redacted in runtime logs`)
- 放宽运行时输入脱敏 (`fix(observability): relax runtime input redaction`)
- 改进运行时追踪诊断 (`fix(observability): improve runtime trace diagnostics`)
- 归档 otel observability adapter (`archive(openspec): archive otel observability adapter`)

---

## 🐛 问题修复

### Workflow
- 投影执行结果到终端路径 (`fix(workflow): project execution results into terminal path`)
- 提前拒绝不支持的并行 Recipe (`fix(workflow): reject unsupported parallel recipes early`)

### Skill Catalog
- 优化 Skill manifest 校验报错信息，包含具体值和限制 (`fix(skill-manifest): 优化 skill manifest 校验报错信息，包含具体值和限制`)
- 解决代码审查发现的质量和安全问题 (`fix(skill-catalog): address code review findings for quality and safety`)

### Model
- 为记忆提取模型请求添加 invocationScope (`fix(model): add invocationScope to memory extraction model request`)
- 将调用作用域设为可选 (`fix(model): make invocation scope optional`)

### Context
- 优化 Skill 上下文去重 (`fix(context): 优化 Skill 上下文去重`)

### Observability
- 保持运行时日志中 prompt 字段脱敏 (`fix(observability): keep prompt fields redacted in runtime logs`)
- 放宽运行时输入脱敏 (`fix(observability): relax runtime input redaction`)
- 改进运行时追踪诊断 (`fix(observability): improve runtime trace diagnostics`)

---

## 📚 文档与规范

### OpenSpec
- 细化 Skill 目录查询设计 (`openspec(add-ts-specify-skill-execution): refine skill catalog query design`)
- 新增 Skill 目录 API 和 Skill 选择器 UI 变更规格 (`openspec(add-ts-specify-skill-execution): add skill catalog API and skill selector UI change spec`)
- 归档 otel observability adapter (`archive(openspec): archive otel observability adapter`)
- 最终化长期记忆规格 (`archive(memory): finalize long-term memory specs`)

### Workflow
- 添加 Recipe 规格引用 (`docs(workflow): add recipe specification reference`)
- 移除 prompt 模板组装说明 (`docs(changes): remove prompt template assembly note`)

### Platform
- 更新平台功能规格并添加审查清单 (`docs: update platform feature spec and add review checklist`)

### Memory
- 重命名核心规格为 memory-core (`docs(memory): rename core spec to memory-core`)

### Release
- 新增 v1.5 发布说明 (`docs(release): add NextAgent v1.5 release notes`)

---

## 🔧 工程改进

### 重构
- 统一 target workflow 到 target recipe 命名 (`refactor(workflow): rename target workflow to target recipe`)
- 隔离结果投影和 Recipe 元数据 (`refactor(workflow): isolate result projection and recipe metadata`)
- 拆分并行 Gateway 与基础 Gateway 变更 (`refactor(workflow): split parallel gateway from base gateway change`)

### 测试与验证
- 新增 Workflow 执行引擎测试覆盖
- 新增 Skill Catalog 查询 API 测试
- 新增长期记忆老化测试
- 新增轨迹提取和持久化测试
- 新增 Model invocation scope 测试

---

## 📊 统计

| 指标 | 数值 |
|------|------|
| Commits | 50 (32 non-merge) |
| 文件变更 | 221 |
| 代码新增 | +20,442 |
| 代码删除 | -515 |
| 主要新功能 | 5 大类 |
| Bug 修复 | 9 |
| OpenSpec Changes 归档 | 2 |
| 新增测试 | 多文件覆盖 Workflow、Skill Catalog、Memory、Model |

---

## 🔄 升级指南

### 从 v1.5 升级

1. **Workflow 执行引擎**:
   - 新增 Recipe 驱动执行引擎，需确认 Workflow 路由契约配置
   - Gateway 节点语义已落地，如有自定义 Gateway 逻辑请验证兼容性
   - 并行 Recipe 暂不支持，提前拒绝并返回明确错误
   - 流式节点投影已统一，检查流式输出格式是否符合预期

2. **Skill Catalog**:
   - Skill 目录查询 API 已上线，确认 Skill 选择器 UI 集成
   - Manifest 校验报错信息已优化，包含具体值和限制
   - 代码审查质量和安全问题已修复，检查 Skill 治理逻辑

3. **长期记忆**:
   - 记忆老化机制已实现，确认记忆生命周期策略
   - 本地轨迹提取和持久化已上线，检查轨迹数据格式
   - 记忆核心规格已重命名为 memory-core，更新相关引用

4. **Model Invocation Scope**:
   - 模型调用作用域 headers 已新增，确认调用上下文传递
   - 记忆提取时 invocationScope 已传递，检查记忆提取行为
   - 调用作用域设为可选，兼容性更好

5. **可观测性**:
   - 运行时日志 prompt 字段保持脱敏，日志格式有变化
   - 输入脱敏策略已放宽，减少过度脱敏
   - 追踪诊断已改进，追踪数据更完整

### 兼容性

- **Breaking Changes**: 无
- **Deprecated**: 旧版小写工具名将在 v2.0 移除（延续 v1.3 声明）
- **Minimum Node.js**: LTS 版本要求不变

---

## ⚠️ 已知限制

1. **Workflow**: 并行 Recipe 暂不支持，需后续版本实现并行 Gateway 语义
2. **Skill Catalog**: 目录查询已实现基础能力，高级过滤和排序待后续完善
3. **长期记忆**: 老化机制已实现基础策略，自学习优先级排序和记忆合并待深化
4. **轨迹提取**: 本地轨迹提取已实现，分布式轨迹聚合待后续版本支持
5. **Model Scope**: 调用作用域已支持，多租户场景下的作用域隔离策略待细化

---

**下一步**: v1.7 将聚焦多 Agent 协作编排、Workflow 并行执行、Skill 智能推荐、以及长期记忆自学习高级策略。
