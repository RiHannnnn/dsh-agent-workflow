# DSH Agent Workflow · n8n 式工作台（开发中）

在 **DeepSeek Harness 内**编排输入、DSH Agent、代码、条件和输出。目标是接近 n8n 的工作流产品，而不是每个节点另起一个 Codex CLI。

**当前体验包为 `0.2.0-dsh.1`，不是完整 n8n，尚未完成真实 DSH GUI／模型端到端验收。** 本版包含新工作台与受限 DSH 原生执行；旧 codex.5 包不包含这些修复。完整范围见 [交付路线](./N8N-ROADMAP.md)。

## 当前源码实现

- **编辑工作台**：左侧节点／Agent 库、中间拖拽画布、右侧参数，保留导入导出和连线。
- **执行检查**：查看各节点当前最近一次输入、输出、错误、日志、状态和耗时；不是持久执行历史，循环只保留最后一次结果。
- **中文角色库**：支持43个常驻角色的静态中文显示与双语搜索；角色从 DSH 技能目录发现，未收录的角色保留原文，不改原始技能指令。
- **DSH 原生执行**：调用宿主 startActivation／spawn，由工作流持有执行句柄；选择确切父会话，传递节点模型；不回退 CLI 或 fork。
- **受限运行与停止**：服务端每轮最多4次外层 Agent 调用、全局并发2、最长10分钟；断开、超时和卸载等待真正清理，清理失败则禁止新执行。
- **完整交接**：当前 DSH Agent 完成后交接结果；NDJSON 状态帧不是 token 实时增量，不宣称已支持逐段执行。

HTTP 请求、凭据管理、持久执行历史、可靠触发器和子工作流仍待后续批次。If/Switch/Loop/While 与代码节点保留原有执行器，不等于已经兼容 n8n 的 JSON items 和恢复语义。旧无预算 Agent 路由已停用，自动任务中的 Agent 暂时明确拒绝执行，避免绕过本轮保护。

## 权限与费用

- DSH 子 Agent 继承所选父会话的目录、工具与权限，**不是 Codex 的只读沙箱**。只运行信任的工作流、代码和表达式。
- 点击运行前会确认风险；导入、浏览节点、静态汉化、构建和模拟测试不会主动调用模型。明确运行才会向所选模型服务发送资料，可能产生费用。
- 调用数、并发、字节限制、4096单次输出 token 设置都**不是累计金额或总 token 硬预算**；子 Agent 内部步骤、工具及提供方计量还需要进一步治理。
- 同源 loopback 和内存 capability 防跨站触发，不是多用户身份认证；同源恶意插件不在该保护边界内。不要把开发插件暴露到公网。
- 不把密钥粘进节点、任务文本或导出文件。目前尚未提供安全凭据库；分享前检查内嵌附件。
- 导出不带运行快照、日志或输出；临时执行授权不进入工作流文档。

## 本地开发

使用 Node.js 22+ 与 pnpm：

```sh
pnpm install --ignore-scripts
pnpm run typecheck
pnpm run build
pnpm run test
```

本轮原生构建及91项自动测试通过；测试使用合成数据和模拟服务，没有调用真实模型。构建通过不代表宿主已加载，不代表 GUI／模型连通已通过。详见 [验证记录](./VERIFICATION.md)。

默认 build 构建原生插件，不是替代 DSH 服务。独立 build:demo 不能替代宿主验收；先前 macOS Rollup 原生扩展签名问题没有通过关闭系统检查绕过。

## 下载与升级状态

体验包：[dsh-node-flow-0.2.0-dsh.1.tgz](./downloads/dsh-node-flow-0.2.0-dsh.1.tgz)。在 DSH 的插件管理中添加以下安装地址，安装后启用「Agent 工作流」：

```text
https://raw.githubusercontent.com/RiHannnnn/dsh-agent-workflow/main/downloads/dsh-node-flow-0.2.0-dsh.1.tgz
```

包名仍为 dsh-node-flow，将升级已有旧版。仓库保留的历史 codex.5 包不包含本批工作台、执行票据和取消修复。需要重启时由用户自行确认；打包与提供安装地址不代表当前桌面已安装成功。

后续通过已认证的 DSH 插件管理界面升级，并在现有 GUI 验证。不会手改桌面 profile、提取浏览器凭据、自动重启或启动替代服务器。

## 来源与许可证

本项目基于 [CodermanYHZ/dsh-node-flow](https://github.com/CodermanYHZ/dsh-node-flow) 的 commit 21cf06fa80b042db16b41cb6908c919042a5bfcc 扩展，保留上游 Copyright (c) 2025 CodermanYHZ 和 [MIT License](./LICENSE)。仓库为 [RiHannnnn/dsh-agent-workflow](https://github.com/RiHannnnn/dsh-agent-workflow)，不暗示上游为此扩展背书。

第三方组件说明见 [NOTICE](./NOTICE.md)。不打包用户技能正文、认证文件、真实本地配置、个人审计报告或备份。

[README.local.md](./README.local.md)、[英文 README](./README.en.md) 与验证记录中的历史章节保留早期上游／Codex 开发资料；与当前范围不一致时，以本首页及交付路线为准。
