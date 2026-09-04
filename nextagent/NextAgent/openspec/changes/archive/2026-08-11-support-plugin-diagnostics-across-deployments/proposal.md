## Why

Agent 开发者和运维人员在不同部署模式中启用同一个调测插件时，当前只能在 LOCAL 模式获得 developer diagnostic artifact；REMOTE 模式虽然仍会完成 hook 调用，却不会生成对应物理记录。这使相同插件配置因部署模式产生不可见的诊断能力差异，REMOTE 环境中的模型与 Tool 调用问题无法通过既有调测产物复盘。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 在任一受支持部署模式中启动、已通过校验并被 Agent 激活的调测插件，均可向 developer diagnostic artifact sink 提交记录。
- 两种部署模式使用相同的物理文件族、目录、记录格式、容量边界、保留周期和失败隔离语义。
- 未激活调测插件时不生成对应记录；产物不可用时不改变 hook 或请求结果。

**非目标：**

- 不新增配置开关、Web API、stream event、timeline、audit、metric 或 operational log 投影。
- 不修改插件提交的记录结构、可信坐标、日志目录、文件命名、轮转、压缩或保留规则。
- 不允许插件选择物理输出位置，也不增加远端日志上传或外部日志服务。

## What Changes

- 修改 developer diagnostic artifact 的部署支持边界：系统默认向全部已加载插件提供可写 sink，部署模式不再产生能力差异。
- 修改独立短期产物文件族的适用范围：两种部署模式都把已接受记录写入既有 `paths.logDirectory` 文件族。
- 保持插件激活为是否产生具体调测记录的控制条件，部署模式不再决定 sink 是否可用。

## Feature 影响（Features）

### 修改的 Feature

- `F-10.2 装配插件`：已装配并激活的调测插件在 LOCAL 和 REMOTE 部署中获得一致的 developer diagnostic artifact 输出能力。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-10.32 管理插件开发诊断产物` → `specs/plugin-developer-diagnostic-artifacts/spec.md`
  - 功能边界：系统接收已加载插件提交的结构化开发诊断记录，绑定可信插件身份，并在全部受支持部署模式中输出独立、有界、短期保留的物理产物。
  - 系统质量属性：安全、性能/容量、可靠性/恢复、可维护性、可测试性。
  - 映射说明：既有 `plugin-developer-diagnostic-artifacts` stable spec 尚未归属 Function；本 change 为该唯一 capability 建立 `FN-10.32` 1:1 映射，不拆分或复制 spec。

### 修改的 Function

无。

## 影响范围（Impact）

- REMOTE 部署启用调测插件后会在既有日志目录产生 developer diagnostic artifact 文件，需要沿用现有敏感内容访问控制和短期保留要求。
- LOCAL 部署的输出行为、物理文件布局和失败隔离保持不变。
- 应用公共 composition、日志输出实现归属和相应测试会受影响；部署专用产品入口、公共插件 API 与 `agent-contracts` 不变。
