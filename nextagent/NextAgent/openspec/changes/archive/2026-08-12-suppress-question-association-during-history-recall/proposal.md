## Why

使用消息输入框的 `ArrowUp` / `ArrowDown` 回看已提交消息时，输入框会把历史文本当作新的主动输入并查询问题联想。用户只是浏览或复用历史消息，却会产生额外网络请求，且返回结果可能打开联想面板、干扰继续回看或编辑。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 用户通过上下键回看已提交消息时，系统不查询问题联想，也不显示联想面板。
- 进入历史回看时，系统取消尚未发送或仍在执行的问题联想查询，迟到结果不得重新打开面板。
- 用户实际编辑回看的文本后，系统退出历史回看，并按普通文本输入规则恢复问题联想。
- local、immersive、collaborative 三种宿主复用同一输入框行为。

**非目标：**

- 不改变上下键历史导航的进入条件、顺序、草稿恢复或面板键盘优先级。
- 不改变 `GET /api/v1/question-association` 的请求或响应契约、匹配排序和归属隔离。
- 不改变粘贴文本本身不触发输入联想，以及输入框失焦后迟到结果不打开联想面板的既有行为。
- 不改变回答完成后的推荐问题查询，也不修改斜杠命令面板行为。
- 不新增持久化、配置、公共 contract 或依赖。

## What Changes

- 仅修改输入联想的历史回看触发边界：上下键把已提交消息回填到输入框不属于主动文本编辑。
- 用户进入历史回看后，停止等待中的 debounce，取消仍在执行的联想查询，并保持联想面板关闭。
- 用户编辑回看的文本后，恢复既有 300ms debounce 查询及结果展示行为。
- 将本次触及的 legacy `question-association-ui`“联想面板触发规则”原子迁移到 `FN-1.18` 的 canonical `question-association-api` 主规格，未触及的 UI Requirements 保持原位。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.9 智能问题推荐`：收紧输入联想的黑盒触发边界；历史回看不产生联想，主动编辑历史文本后恢复联想。Feature 的 Function 组成和用户价值不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- 无。

### 修改的 Function

- `FN-1.18 输入联想` → `specs/question-association-api/spec.md`
  - 功能边界：区分主动文本编辑与上下键历史回看；历史回看期间不查询或展示输入联想，编辑回看文本后恢复既有联想行为。
  - 系统质量属性：无新增独立系统质量属性；减少冗余查询是上述功能边界的直接结果，不新增延迟或容量阈值。
  - 映射说明：canonical spec 为 `question-association-api`；本次触及 legacy spec `question-association-ui` 的“联想面板触发规则”，并将该 Requirement 原子迁移到 canonical spec。

## 影响范围（Impact）

- 受影响 actor：使用上下键回看和复用已提交消息的 Web 用户。
- 受影响前端：三种宿主共享的消息输入框、输入联想调度及对应组件测试和浏览器旅程测试。
- 公共 API：路径和 schema 均不变；历史回看不再发起现有查询。
- 后端、配置、持久化、部署与运维面：无变化。
