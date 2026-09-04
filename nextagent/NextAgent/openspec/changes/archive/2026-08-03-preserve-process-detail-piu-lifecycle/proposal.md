## Why

电信网络运维用户在 Process Detail 中查看 PIU 交互内容时，折叠条目或整个过程面板会销毁当前 PIU 视图；再次展开会重新初始化 PIU。用户可观察到筛选、分页、展开层级和未提交输入丢失，外部系统还可能收到由界面折叠触发的重复加载或重复调用。折叠是展示操作，不应改变同一过程条目的交互生命周期，因此需要在现有 disclosure 行为上补齐生命周期保证。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 同一 run 中已显示过的 PIU Process Detail 在条目自动收起、手工收起、整个过程面板收起以及 reduced-motion 模式下保持同一交互实例。
- 折叠期间 PIU 内容不可见且不可交互；再次展开时恢复原有交互状态，不重复执行初始化调用。
- 当所属过程条目、run、Turn 或 session 从当前对话投影中移除时，PIU 容器随其 owner 一起卸载并清理容器内容。

**非目标：**

- 不改变普通文本、Markdown、RAG、DSL 或其他结构化 Process Detail 的既有卸载策略。
- 不改变最终答案 PIU、Expand Panel PIU、多宿主入口、后端 stream/history truth 或请求生命周期。
- 不新增 PIU host 公共销毁事件；宿主未提供的外部资源销毁协议不在本 change 内定义。

## What Changes

- 修改 Process Detail disclosure：已挂载且包含 PIU 的 Detail 在视觉折叠时保持挂载，折叠只改变可见性与交互可达性。
- 修改整个过程面板的折叠行为：面板包含已挂载 PIU Detail 时保留该 React 子树，重新展开复用同一 PIU 实例。
- 修改 PIU 容器 owner 移除行为：阻止卸载后仍未完成的加载触发 emit，并清空已经挂载的容器 DOM。
- 新增覆盖自动/手工/面板级折叠、reduced-motion、owner 移除和非 PIU Detail 既有卸载行为的回归验证。

## Feature 影响（Features）

### 新增 Feature

无。

### 修改的 Feature

- `F-10.6 前端定制`：Process Detail 中的 PIU 定制视图获得“折叠不重置、owner 移除才卸载”的用户可依赖生命周期保证。

### 移除的 Feature

无。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.6 前端定制` → `specs/agent-web-process-panel/spec.md`
  - 功能边界：修改 Process Detail 中 PIU 定制视图在视觉折叠与 owner 移除时的可观察生命周期。
  - 系统质量属性：可靠性/恢复、性能/容量、可测试性。
  - 映射说明：`agent-web-process-panel` 是与过程面板 disclosure 黑盒边界匹配的 canonical spec。本 change 将其登记为 `FN-10.6` 主规格，不新增 Function，也不建立一 spec 对多个 Functions 的映射。

## 影响范围（Impact）

- 最终用户折叠和恢复 PIU Process Detail 时不再丢失交互状态或产生重复初始化。
- PIU 集成方不需要修改 payload、host API 或配置。
- 前端过程面板 disclosure、结构化 PIU 容器清理和相应组件测试受到影响；后端、公共 Web API、stream event 和持久化契约不受影响。
