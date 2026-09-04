# agent-app

职责：唯一 composition root，读取配置入口，选择 local/remote gateway adapter，装配 runtime、channel、context engine、core、model、capability、gateway、attachment、memory 和 observability。

非职责：不定义具体 Web API、runtime state machine、gateway schema、Agent package 字段全集、动态插件加载或远端实现包加载。

Public exports：`@nextagent/agent-app`。

Allowed dependencies：作为唯一 composition root，可依赖各 implementation package public exports、`agent-common`、`agent-contracts` 授权 subpath 和 adapter factories；具体例外只由根 `dependency-cruiser.config.cjs` policy 维护。

Forbidden dependencies：跨包 private paths、隐藏全局 DI、启动副作用。

替换边界：否。它选择替换包。
