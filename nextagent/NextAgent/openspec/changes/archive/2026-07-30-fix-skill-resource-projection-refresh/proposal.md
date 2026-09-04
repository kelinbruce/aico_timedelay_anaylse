# Fix Skill Resource Projection Refresh

## 背景与问题（Why）

Skill 资源授权有意保持 run-local，但多轮上下文可能把先前 run 的 `Skill resource root: .nextagent/skills/...` 文本带入后续 run。当后续 run 尝试在不重新加载 Skill 的情况下复用脚本路径时，文件工具和 sandbox 执行会因该路径对新 run 未授权而拒绝。

## 变更范围（What Changes）

- 保持 `.nextagent/skills/...` 为只读系统资源。
- 保持 Skill 资源授权限定在当前已接受的 run。
- 新增当前 run 重授权路径：为当前可见的受治理 Skill descriptor 复用已提交的 Skill 投影。
- 从被选中的文本、tool 结果和先前 tool-call 参数中发现匹配的逻辑 Skill 投影路径，包括复用了投影脚本的先前 Bash/Python 命令。
- 当被选中的上下文包含匹配的先前逻辑 Skill 资源路径时，在模型调用前重披露当前 run 已授权的 Skill 资源 root。
- 宿主绝对路径和 source/install 路径保持在重授权输入之外。

## 影响范围（Impact）

- 后续 run 只有在当前 run 重授权成功后才能复用先前的 Skill 脚本。
- 仅旧路径文本仍然不构成充分授权。
- 被保留的先前 Bash/Python tool call 只能通过其逻辑 `.nextagent/skills/...` 路径触发当前 run 重授权。
- Skill 脚本日志仍然必须使用 `temp/` 或 `workspace/`，不得使用 `.nextagent/skills/...`。
