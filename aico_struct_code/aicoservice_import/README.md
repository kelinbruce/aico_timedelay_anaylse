# aicoservice ChatGPT 项目导入

导入时间：2026-09-01

来源：ChatGPT 项目 `aicoservice`（项目 ID：`g-p-6a967a1c4da48191a9281752980c52b3`）。

## 已导入内容

- `deployment.yaml`：从对话附件 `粘贴的文本 (1).txt` 中恢复的 Kubernetes Deployment。ChatGPT 预览会丢失 YAML 缩进，因此该文件按 Kubernetes 对象结构重新排版，并非附件的逐字节副本。
- `bin/start.sh`：从聊天中粘贴的终端输出提取并恢复格式的 AICOService 启动脚本。
- `conversations/判断路径来源.md`：关于 `/opt/pkgs/aicoservice@27.68.169` 来源的对话要点。
- `conversations/确认启动脚本.md`：关于容器启动链路和 `start.sh` 的对话要点。
- `../aicoservice@27.68.169/`：后续补充到本地的完整 AICOService 运行包，包含 `agents/`、`config/`、`node_modules/@nextagent/` 等静态分析所需内容。
- `pod-recipe-invocation.md`：结合完整运行包重新还原的 A2A-T、Agent 路由、Skill、Workflow、sandbox、CLIP 和模型调用链。

## 重要边界

`aicoservice_import/` 本身仍是最初从 ChatGPT 项目恢复的材料目录；但其同级目录现已补充完整运行包：

```text
../aicoservice@27.68.169/
├── AFWebsite/
├── agents/
├── bin/
├── config/
├── etc/
├── init/
├── node_modules/
├── pub/
└── upgrade/
```

真正的 Node.js 业务入口是：

```text
../aicoservice@27.68.169/node_modules/
  @nextagent/agent-channel-aico/dist/entrypoints/start.js
```

现在已经可以对 `agents/`、`config/` 和 `node_modules/@nextagent/` 做静态分析。最新结论见 [`pod-recipe-invocation.md`](./pod-recipe-invocation.md)。其中一个重要修正是：当前版本会从本地 Agent `recipes/` 目录读取并解析 `WATT_PLEX.yaml`，且 `workflow-execution` 的部署模式为 `LOCAL`。

## 如需与运行 Pod 再次核对

本地包已经具备完整静态分析条件。若需排除运行中热更新或升级流程造成的差异，可从目标 Pod 再次只读复制并做 checksum 对比：

```bash
kubectl cp -n sop \
  <pod-name>:/opt/pkgs/aicoservice@27.68.169 \
  ./aicoservice@27.68.169 \
  -c aicoservice
```

由于 `/opt/pkgs` 是只读 CSI 挂载，复制出来的目录适合静态分析；本地运行通常还需要 `nodejs@27.66.12`、`python@27.66.12`、`pythonruntime@27.66.12`、sidecar socket 和生产环境变量。
