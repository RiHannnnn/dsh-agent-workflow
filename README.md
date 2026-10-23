# DSH Agent Workflow · Codex 开发版

> 面向 DeepSeek Harness 的 **Codex 角色库 + DSH 原生画布 + 真实增量事件 / 逐段 handoff** 工作流插件。

本仓库计划公开于 [RiHannnnn/dsh-agent-workflow](https://github.com/RiHannnnn/dsh-agent-workflow)。当前版本为 `dsh-node-flow@0.1.0-codex.2`，是在 [CodermanYHZ/dsh-node-flow](https://github.com/CodermanYHZ/dsh-node-flow) 的 commit [`21cf06fa80b042db16b41cb6908c919042a5bfcc`](https://github.com/CodermanYHZ/dsh-node-flow/commit/21cf06fa80b042db16b41cb6908c919042a5bfcc) 之上的本地扩展，保留上游 MIT 许可证和版权归属。仓库名称改变，插件包名仍为 `dsh-node-flow`。

**这是开发版，不是已上线可用的产品。** 已有本地原生插件构建和 57 项 mock 自动测试通过记录；尚未在真实 DSH 中验证入口、样式、插件共存、Codex 登录及真实模型端到端交接。构建通过不代表宿主已加载，也不代表真实模型可用。详见 [验证记录](<VERIFICATION.md>)。

## 解决什么问题

把本地 Codex 角色放到 DSH 的原生工作流画布上，通过输入、角色和输出节点组织多步骤任务；在上游生成内容时查看真实增量输出，并按需让下游提前处理已完成的段落，而不必总是等整篇结果结束。

## 当前实现

- **原生画布**：向 DSH 的 main/sidebar 插槽贡献「Agent 工作流」入口，不替换应用根节点、不挂独立 iframe。
- **Codex 角色库**：从 `CODEX_HOME/agents`（未设置时使用 Codex 默认主目录）发现 TOML 角色，支持搜索、点击加入和拖拽。角色指令进入 Codex `developerInstructions`，任务资料进入 user 输入；不是给每个角色另装一套模型。
- **真实增量事件**：通过 Codex app-server stdio JSON-RPC 接收增量事件，经同源 NDJSON 路由送到浏览器；不是定时器模拟打字，也不把 JSONL 日志冒充 token 流。这里描述的是实现方式，真实模型联调仍待验证。
- **完整 / 逐段 handoff**：完整模式等上游完成；逐段模式按空行划分段落，在上游结束前把已形成的段交给下游。
- **普通无环图执行**：支持串行、并行、完整输入汇合、实时文字、输入输出查看、日志和错误查看，以及手动停止。
- **输入与分享**：输入节点支持文本及合计不超过 1 MiB 的 UTF-8 文本附件；工作流可导入导出。导出剔除运行快照、日志和输出，但嵌入附件仍会保留，分享前必须检查。

上游的代码、分支、循环和定时任务实现仍保留，但它们与新增 Codex 调度的支持范围不同，不应把全部上游能力视为已完成 Codex 联调。

## 获取开发包（上传后可用）

已验证包将以原始字节放在 [downloads 开发包](<downloads/dsh-node-flow-0.1.0-codex.2.tgz>)。**当前尚未上传到 GitHub，以下公开下载地址仅在仓库及文件上传后可用，本次没有验证远端可达性：**

[下载 dsh-node-flow-0.1.0-codex.2.tgz（上传后可用）](https://github.com/RiHannnnn/dsh-agent-workflow/raw/refs/heads/main/downloads/dsh-node-flow-0.1.0-codex.2.tgz)

```text
SHA-256: 2df656b65b93e0ff31b1cd53f6fe919c188926968465dd2c620c2e4df9e1c6a9
```

此文件是已验证开发包的原样复制，没有重打包；包内说明保留打包时版本，不包含本次仓库首页更新。它不是 npm 正式发布版。

### 试用前提与操作顺序（尚未端到端验证）

需要支持原生插件及所需插槽/API 的 DSH、本地可用的 Codex CLI 和用户自行配置的登录/模型服务。当前没有经过真实宿主验证的兼容版本矩阵。

1. 先核对下载包的 SHA-256，再由用户通过 DSH 已认证的插件管理界面添加并启用；是否需要刷新或重启，以宿主实际反馈为准，不直接修改应用安装包或 profile。
2. 在侧边栏打开「Agent 工作流」→「添加节点」→「Codex 角色库」。如果入口没有出现，不要以构建通过当作安装成功。
3. 导入 [逐段交接示例](<examples/codex-paragraph.workflow.json>)，或手动连接输入、两个 Codex 角色和输出节点。导入本身不会执行。
4. 为 Codex 节点填写自己机器上实际存在的工作目录并确认；模型留空时沿用本机 Codex 默认配置。
5. 逐段试验时要求上游每个条目单独一段、段落间留空行，再选择逐段交接。
6. 运行前核对资料发送、费用、目录、调用次数和代码节点风险；只在明确确认后运行。安装、重启和真实模型测试均不是本次发布清理执行的操作。

详细字段、安全边界和本地说明见 [开发说明](<README.local.md>)。该文档与 [验证记录](<VERIFICATION.md>) 保留既有本地开发记录，不是生产可用承诺。

## 逐段交接的边界

- 每个输入段触发下游一次独立调用，不共享会话记忆；下游不能假定自己看到了整篇资料。
- 普通图最多 64 个执行节点、128 条边；并发最多 2 个任务，每次运行最多 32 次 Agent 调用。
- 每条增量边最多排队 32 段，每段 UTF-8 最大 64 KiB；节点结果与 Codex 请求提示最大 2 MiB，HTTP 请求体最大 4 MiB。超限停止并提示，不提供无限吞吐保证。
- 逐段节点暂不支持直接进入多路汇合，需要先用完整交接节点聚合；Codex 暂不接 If / Switch / Loop / While 或定时任务。
- 已交付的段不能回滚。选择失败后继续时，保留已交付段并另交付一次空输入；需要严格原子性时使用完整交接。
- PDF、Office、图片与二进制附件不在当前范围。原版控制流与新增普通图调度语义不能混用推断。

## 权限、隐私与费用

- Codex 请求固定只读文件沙箱和 `approvalPolicy: never`；若启动返回更宽权限，在提交任务前拒绝继续。**只读不等于只能读取所选目录**，不要向不可信角色或提示词开放敏感工作区。
- 实现会关闭 hooks、plugins、apps、多 Agent、web search、notify、登录 shell 和发现的 MCP；对无法确定或不安全的配置拒绝运行，但不宣称可隔离恶意同用户进程或消除配置读取竞争窗口。
- 本地同源 loopback 与每次加载的 capability 只用于防跨站触发，不是多用户认证，不能防同源恶意插件。不要把此开发插件暴露为公网服务。
- 原版代码节点和表达式可以执行用户代码，不享有 Codex 只读保证。仅运行可信工作流；资料标记也不是完整的提示注入防线。
- 点击运行会使用本机 Codex 配置的模型服务，可能向该服务发送资料并产生费用。角色库扫描、构建与 mock 测试不调用模型。
- 不要上传真实 Codex 配置、认证文件、依赖目录、临时协议 schema 或个人资料目录；分享工作流前检查附件内容。

## 本地开发与验证范围

使用 Node.js 22+ 和 pnpm。以下是开发流程说明，本次公开发布清理没有安装依赖、重建、重打包或调用模型：

```sh
pnpm install --ignore-scripts
pnpm run typecheck
pnpm run build
pnpm run test
```

默认构建只生成 DSH 原生插件；独立演示保留为可选 `build:demo`，不是当前 DSH 页面或交付验证路径。已有记录中，可选演示因 macOS 对 Rollup 原生扩展的 Team ID 检查而构建失败，未绕过系统检查。

已有 57 项测试使用 synthetic 配置、mock transport 和模拟子进程，覆盖角色元数据、目录/链接校验、同源/capability、权限策略、JSON-RPC 增量、取消与超时、无环图汇合、上游未完成时下游启动、UTF-8 分帧、断流与导入校验。**不覆盖真实登录、真实模型服务、浏览器布局或真实 DSH 的端到端运行。**

## 来源与许可证

- 上游项目：[CodermanYHZ/dsh-node-flow](https://github.com/CodermanYHZ/dsh-node-flow)，Copyright (c) 2025 CodermanYHZ。
- 本地扩展以仓库名 `dsh-agent-workflow` 整理公开；保留上游 [MIT License](<LICENSE>)，不暗示上游维护者为此扩展背书。
- 第三方组件保留各自许可证，说明见 [NOTICE](<NOTICE.md>)；本仓库不附带用户的 Agency Agents TOML 角色、真实 Codex 配置或认证文件，也不声称已获得未核实的第三方授权。
- [英文 README](<README.en.md>) 保留上游介绍，尚未同步本扩展，请以本中文首页说明当前开发版范围。
