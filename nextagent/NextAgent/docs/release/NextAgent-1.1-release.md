# NextAgent 1.1 Release Notes

> 版本基线：v1.0 → v1.1
> 发布日期：2026-06-16
> 变更统计：21 commits（20 merged + 1 pending）

## 摘要

v1.1 是 v1.0 之后的首个增量版本，聚焦于 **Skill 资源访问能力完善**、**运行时可观测性增强**、**沙箱配置灵活性** 和 **部署路径解析修复**。

### 核心变更

1. **Skill 资源访问系统** — 完成 skill 资源访问的完整实现，支持资源投影、流式内容传输、单资源根目录输出和不可变投影复用。
2. **运行时日志分离** — 将运行时诊断日志独立为专用流，提升可观测性和诊断效率。
3. **沙箱禁用开关** — 新增 `sandbox.disable` 配置项，允许在特定环境下禁用沙箱执行。
4. **部署路径自动提升** — 修复打包部署时配置路径解析错误，自动识别并提升 `config/` 子目录的相对路径基准。

### 兼容性

- 向后兼容 v1.0 配置和 API。
- Skill 资源访问为新增能力，不影响现有会话和请求流程。
- 沙箱禁用开关默认为 `false`，保持原有安全行为。

---

## 详细变更

### 1. Skill 资源访问能力完善

**变更范围**：`agent-capability`、`agent-runtime`、`agent-core`

v1.1 完成了 skill 资源访问的完整实现，使 Agent 能够在执行过程中动态加载和访问 skill 资源。

#### 关键能力

- **资源投影与流式传输**：skill 资源通过 projection 机制流式传输内容，避免一次性加载大文件。
- **单资源根目录输出**：简化资源根目录输出，统一为单个根路径。
- **身份输入简化**：简化 skill 来源身份输入参数，降低调用复杂度。
- **延迟资源列举**：仅在 projection miss 时执行资源列举，减少不必要的 I/O。
- **不可变投影复用**：复用已生成的不可变投影，避免重复计算。
- **本地只读保护**：对齐资源读取与本地只读保护机制。

#### 执行文件系统支持

- 新增 skill 资源访问根目录支持，使执行文件系统能够识别和加载 skill 资源。

**相关提交**：
- `ce6a58f` feat(execution-files): add skill resource access roots
- `2b43a79` fix(skill-resource-access): align resource reads and local readonly guard
- `f76f161` fix(skill-resource-access): reuse immutable projections
- `a5c9fde` fix(skill-resource-access): defer resource listing until projection miss
- `cab8ce5` fix(skill-resource-access): simplify skill source identity inputs
- `30f2d9a` fix(skill-resource-access): emit single resource root
- `a4a15a3` fix(skill-resource-access): stream resource projection content
- `bf2ecac` archive(skill-resource-access): promote resource access specs

---

### 2. 运行时可观测性增强

**变更范围**：`agent-observability`、`agent-runtime`

v1.1 将运行时诊断日志独立为专用流，并优化了日志格式和可读性。

#### 关键改进

- **运行时诊断日志分离**：将运行时诊断日志从通用日志中分离，便于运维监控和问题定位。
- **可读时间戳**：日志时间戳改为人类可读格式，提升诊断效率。
- **执行日志增强**：在沙箱 spawn 前确保工作空间目录存在，并添加执行日志记录。

**相关提交**：
- `fd383f4` feat(logging): separate runtime diagnostics
- `77a0d73` fix(logging): use readable timestamps
- `2f3b64f` fix(agent-runtime): ensure workspace directories exist before sandbox spawn and add execution logging
- `97c34f2` archive(observability): archive runtime logging change with baseline sync

---

### 3. 沙箱配置灵活性

**变更范围**：`agent-runtime`、`agent-app`

v1.1 新增沙箱禁用开关，允许在特定环境（如 CI/CD、测试环境）下禁用沙箱执行。

#### 关键改进

- **沙箱禁用开关**：新增 `sandbox.disable` 配置项，默认为 `false`。设置为 `true` 时，绕过沙箱执行限制。

**相关提交**：
- `617e855` fix(sandbox): add sandbox.disable switch

---

### 4. Agent 能力工具命名规范化

**变更范围**：`agent-capability`

v1.1 统一了 Agent 内置工具的命名规范，并优化了 Bash 工具的错误处理。

#### 关键改进

- **PascalCase 命名**：将 `read` 和 `write` 工具重命名为 `Read` 和 `Write`，符合 PascalCase 规范。
- **内置工具重命名**：将所有内置工具统一为 PascalCase 命名。
- **Bash 结果非致命化**：Bash 工具执行失败时不再标记为致命错误，而是返回错误结果供 Agent 决策。

**相关提交**：
- `0c4d50f` fix(agent-capability): rename read/write tools to PascalCase
- `ebf321b` fix(agent-capability): rename read/write tools to PascalCase
- `c330a6c` fix(agent-capability): rename builtin tools to PascalCase and make Bash results non-fatal

---

### 5. 部署路径解析修复

**变更范围**：`agent-app`、`local-runtime-package`

v1.1 修复了打包部署时的路径解析错误，并优化了打包目录结构。

#### 关键改进

- **配置路径自动提升**：当 `configRoot` 位于 `config/` 子目录时，自动将相对路径基准提升到父目录，避免路径解析错误（如 `"logs"` 被解析为 `<package>/config/logs` 而非 `<package>/logs`）。
- **Skills 目录自动创建**：打包时自动创建 `skills/` 目录，与 `config/`、`data/`、`logs/` 等目录平级。
- **移除路径重写逻辑**：不再需要在 `createPackageConfigSample` 中手动重写路径（如 `"workspaces"` → `"../workspaces"`）。
- **测试用例更新**：更新工作空间边界验证测试，使用 `"data"` 而非 `"../data"`。

**相关提交**：
- `74bf9a2` fix(agent-app): auto-promote relative paths when configRoot is under config/ directory（pending）

---

### 6. 应用配置安全性

**变更范围**：`agent-app`

v1.1 增强了应用配置的安全性，拒绝不安全的执行根路径。

#### 关键改进

- **拒绝不安全执行根**：验证执行根路径时，拒绝指向系统目录或符号链接的路径，防止路径遍历攻击。

**相关提交**：
- `349fde0` fix(app-config): reject unsafe execution roots

---

### 7. 前端用户体验优化

**变更范围**：`agent-web`

v1.1 优化了前端错误展示，使安全失败更易于理解。

#### 关键改进

- **安全失败可读性**：优化错误展示逻辑，使用户能够理解安全失败的原因和建议操作。

**相关提交**：
- `307db60` fix(agent-web): make safe failures understandable

---

## 配置变更

### 新增配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `sandbox.disable` | boolean | `false` | 禁用沙箱执行（用于测试环境） |

### 配置示例

```yaml
sandbox:
  disable: false  # 生产环境保持默认启用
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

v1.1 打包产物包含以下目录：

```
nextagent-local-<platform>-<arch>/
├── bin/              # 入口脚本
├── config/           # 配置文件（default-system.json 等）
├── backend/          # 后端代码
├── data/             # 数据目录
├── logs/             # 日志目录
├── run/              # 运行时状态
├── skills/           # Skill 资源目录（新增）
├── workspaces/       # 工作空间
└── node_modules/     # 依赖
```

### 路径解析行为

当 `configRoot` 目录名为 `config` 时，相对路径自动提升到父目录：

- 配置：`"logDirectory": "logs"`
- 解析：`<package>/logs`（而非 `<package>/config/logs`）

---

## 测试与验证

### 测试覆盖

- **单元测试**：282 passed
- **集成测试**：9 passed | 3 skipped
- **E2E 测试**：29 passed | 6 skipped

### 验证命令

```bash
npm run build
npm test
npm run test:contract
npm run lint:architecture
npm run pack:release
npm run release:qualify
```

---

## 已知边界

- Skill 资源访问能力已完成实现，但尚未在复杂场景下充分验证。
- 沙箱禁用开关仅用于测试环境，生产环境应保持启用。
- 前端优化仅涉及错误展示，未涉及核心交互流程。

---

## 升级指南

### 从 v1.0 升级到 v1.1

1. **配置兼容性**：v1.0 配置文件无需修改，可直接使用。
2. **新增配置项**：如需禁用沙箱，在 `default-system.yaml` 中添加 `sandbox.disable: true`。
3. **打包部署**：重新执行 `npm run pack:release`，新打包产物自动包含 `skills/` 目录。
4. **Skill 资源访问**：如需使用 skill 资源访问能力，在 Agent 配置中注册相关 skill。

### 回滚方案

如需回滚到 v1.0：

```bash
git checkout v1.0
npm install
npm run build
```

---

## 贡献者

本次发布包含来自以下贡献者的提交：

- Gongxuping
- Codex AI Assistant

感谢所有参与 v1.1 开发和测试的贡献者。
