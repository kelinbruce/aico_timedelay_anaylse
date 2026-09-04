# ADR: 本地共享数据根

## 状态（Status）

Accepted.

## 背景与现状（Context）

本地部署需要一个稳定位置存放公共电信诊断输入，如告警导出、拓扑文件、样例 trace、参考数据集和可复用 Python 脚本。既有执行 workspace 是 owner/agent/session 范围的，把公共数据放在特定 `execution/<scope>/workspace/` 下会复制数据，并把公共输入与模型输出混在一起。

直接开放 `paths.workspaceRoot` 会暴露 runtime/系统目录，如 `execution/`、`data/`、SQLite 文件、日志和 provider 私有存储。按 request 导入更安全，但对大型本地数据集太重。

## 决策（Decision）

本地模式将 `<workspaceRoot>/shared-data/` 暴露为逻辑根 `shared-data/`。该根是只读、仅本地且根限定的。Read/Glob/Grep、sandbox 文件系统准备、Python 显式脚本执行和 Skill/生成代码都通过既有执行根词汇表和 resolver 支撑的文件访问边界消费它。

`agent-app` 派生并校验物理 `sharedDataRoot`；`AgentAssembly.workspacePolicy` 只携带逻辑根策略。`agent-runtime` 只在 LOCAL 部署模式解析该根。`agent-capability` 和 sandbox 请求准备消费已解析的根，不独立启用它。

## 结果（Consequences）

`shared-data/` 可以被 tool 和脚本读取，但输出必须写入 `workspace/` 或 `temp/`。该根不被加入 `PATH`、`PYTHONPATH`、import 搜索路径或可执行查找。共享数据下的 Python 脚本只能通过显式解释器和显式根限定路径运行，例如 `python shared-data/scripts/diagnose.py`。

REMOTE/PaaS 部署模式在 runtime 侧策略中出现 `sharedData` 根时必须 fail closed。本 ADR 不定义远程对象存储或共享远程宿主路径。

## 被否决的选项（Rejected Options）

- 暴露 `workspaceRoot`：被否决，因为它泄漏运行时数据并破坏 scope 边界。
- 把共享数据导入每个 request workspace：被否决，因为它复制大数据并污染范围化输出空间。
- 把共享数据放在每个范围化的 `workspace/` 下：被否决，因为公共输入会被复制且被 owner 范围化。
- 只对 Bash/Python 路径特判：被否决，因为文件 tool 和 sandbox 可见性会漂移。
