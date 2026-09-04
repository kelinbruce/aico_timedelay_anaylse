# establish-ts-backend-architecture

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：串行底座

状态：complete
类型：串行先导 change
主要 owner：架构 / app composition
依赖：无

目标：
- 建立 TS 后端 workspace、package topology、runtime、channel、本地 Web auth endpoint adapter、core、context、gateway、capability、observability 和 app composition 的架构边界。
- 补齐 `agent-channel-web-auth-local` 模块边界：localhost-only local configured authentication 启用时拥有本地登录/登出 endpoint adapter、local auth cookie 写入/清除和认证 challenge response；credential 校验与 identity 解析通过 gateway/auth contract，且不访问 request lifecycle、session/message、memory、attachment、RequestRun 或 capability durable facts。
- 明确 local auth 是可选 composition package：`agent-channel-web` 不依赖它；local 产品入口显式 import/register；remote/IAM 产品入口不得 import/register、bundle 或暴露；首阶段不引入运行时动态插件系统、热加载或隐藏 DI。
- 明确首版本地认证只支持 localhost-only：不提供页面修改认证配置、多用户管理、注册、密码修改、remember-me、refresh token 或服务端认证 session store。

后续整理状态：
- 已有 active change，本文档后续只引用其稳定边界。
