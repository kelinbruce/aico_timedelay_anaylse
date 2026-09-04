# add-context-monitor-plugin

新增一个仅观察的 context-monitor 生命周期 hook plugin，记录每个 session 的 context 演化：压缩前后 delta 以及最后一轮的组装消息 + 回答，由配置注册控制开启。
