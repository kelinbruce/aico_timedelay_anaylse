## 1. Tool 契约与目录

- [x] 1.1 通过 `defineTool` 定义小写 `write` 的输入/输出 schema、`NON_IDEMPOTENT` metadata 和必需的 `workspaceFiles` 依赖
- [x] 1.2 在拥有的 builtin Tool 清单中显式注册 `write`，并验证没有引入 YAML、扫描、副作用注册、别名或并行调用契约
- [x] 1.3 验证当前产品组合以 `AVAILABLE` 暴露 `write`，不伪造审批就绪

## 2. Agent 作用域的工作区文件配置

- [x] 2.1 新增可信 `workspaceFiles.readDirectories`、`writeDirectories` 和 `maxTextBytes` 配置/编译，保持与既有 Read 的兼容性和 write-implies-read 语义
- [x] 2.2 拒绝绝对路径、穿越、glob、链接、reparse、逃逸或非法大小配置，且只使受影响的 Agent assembly 失败
- [x] 2.3 组合单个 Agent assembly/version 作用域的 workspace 文件依赖，不向模型可见边界暴露 workspace root 或授权

## 3. 共享工作区文件依赖

- [x] 3.1 扩展 `WorkspaceFilePort`，使 Read 和 Write 接收可信 Tool 执行上下文并使用同一个受控文件系统边界
- [x] 3.2 只按已接受的 Agent/version/run/path 记录单次调用完整 Read 快照；在 Write 成功后更新快照，并暴露应用内部的 run 清理操作
- [x] 3.3 在 `agent-app` 中从既有 runtime terminal observation 接线快照清理，不赋予 `workspaceFiles` 生命周期所有权
- [x] 3.4 保持快照为进程本地，并验证重启/恢复需要重新完整 Read

## 4. Write 校验与执行

- [x] 4.1 实现 workspace 相对路径规范化、写入目录授权、非空/maxTextBytes 校验和普通文件检查
- [x] 4.2 实现受支持 UTF 编码的检测/保留和精确的调用方提供行尾行为
- [x] 4.3 实现 `WRITE_REQUIRES_FULL_READ` 和 `WRITE_TARGET_CHANGED` 冲突行为，包括确认窗口内的新文件竞争
- [x] 4.4 实现递归授权父目录创建、同目录唯一临时文件、flush、原子 create/replace、取消清理，且无 unsafe 覆盖回退
- [x] 4.5 保留既有权限，并拒绝 symlink、junction、reparse point、hard-link、目录、设备、socket、FIFO、二进制、未知编码和不可写目标
- [x] 4.6 只返回 create/update 和规范化 workspace 相对路径；内容和宿主细节不进入结果和 safe 运行信号

## 5. 审批延迟边界

- [x] 5.1 保持审批留给后续通用流程，不新增面向 Tool 的确认 API、伪造就绪标记或私有 pending 生命周期
- [x] 5.2 在不启用审批的情况下启用 Write，同时保留全部既有 workspace 文件安全边界
- [x] 5.3 文档化被延迟的 Capability Approval change 要求：恢复必需依赖、runtime 拥有的暂停/恢复、完整的旧/新确认信息、回答入口、超时、取消和安全披露
- [x] 5.4 为内置 default Agent 配置显式的 workspace-root 写入授权；其他 Agent 保持配置驱动

## 6. 验证

- [x] 6.1 为 schema、编码、空/超大内容、规范化结果、重放策略和 safe error 新增 unit 测试
- [x] 6.2 为目录授权、穿越、绝对/UNC/设备路径、glob、链接、特殊文件和原子写失败新增表驱动安全测试
- [x] 6.3 为完整 Read 快照、过期更新、新文件竞争、父目录创建、取消清理、权限保留和快照清理新增集成测试
- [x] 6.4 为显式注册、无审批可用、Agent 作用域授权、无直接文件系统访问和无敏感输出新增契约/架构测试
- [x] 6.5 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate --all --strict`
- [x] 6.6 在 push 前运行仓库 `nextagent-code-review` 语义检视，并显式记录任何被延迟的审批能力
- [x] 6.7 新增一个确定性产品路径 E2E，覆盖 HTTP 请求、模型 `write` tool 调用、runtime 执行、SSE 结果、最终回答和 workspace 文件创建
