# 本地开发版验证记录

## 当前状态

- 上游基线：`21cf06fa80b042db16b41cb6908c919042a5bfcc`。
- 最新开发包：`dsh-node-flow@0.1.0-codex.2`，替代上一版 codex.1。
- 原生插件构建通过；**57 项自动测试全部通过，0 失败、0 跳过**，执行约 1.24 秒。
- 实际角色库元数据扫描当次发现 20 个本地 TOML 角色及 1 个默认 Codex 角色，无警告；新增角色可刷新发现。
- 逐段示例通过结构校验：4 个节点、3 条边。
- 用户已同意安装启用，但不重启。原生插件管理接口返回 HTTP 403，当前工具未获该接口访问权限；没有获取浏览器凭据、绕过接口限制或手改 profile。
- **尚未安装到当前 DSH，未进行真实 GUI 操作或真实模型调用。** 没有移除节点外观插件，没有启动替代 Web 服务。

## 验证命令

使用 DSH 自带 Node 24.21.0 与 pnpm 11.8.0：

```sh
pnpm run build
pnpm run test
pnpm pack --pack-destination artifacts
```

默认 build 只构建 DSH 原生插件。原项目独立 Vite 演示构建曾因 macOS Team ID 检查拒绝加载 Rollup 原生扩展而失败，未关闭系统检查或修改签名；独立演示保留为可选 build:demo，不是当前 GUI 交付路径。

## 自动测试与定向复查

测试使用 synthetic 配置和 mock transport/子进程；不把 mock 通过当作真实 Codex 登录、模型连通或 GUI 通过。

覆盖 TOML 角色元数据、非安全链接、严格同源/capability、只读策略校验、MCP 名称禁用、JSONRPC 增量、畸形协议、超时/断开/卸载清理、DAG 并行汇合、上游未完成即启动下游、UTF-8 分帧和异常断流。

客户端测试加载实际构建包，核实共享宿主 React、main/sidebar 插槽注册和释放，做内存静态渲染冒烟。React Flow 在静态渲染时产生预期 useLayoutEffect SSR 警告，未隐藏；这不等同浏览器布局或可访问性验收。

定向复查发现并修复的稳定指纹：

| 指纹 | 问题 | 回归结果 |
| --- | --- | --- |
| RUN-IMPORT-RACE | 运行时换图，旧输出可能写入同 ID 新图（CWE-362） | store 级运行锁阻止替换，通过 |
| IMPORT-RENDER-PROPS | 非法 label/style 可导致导入即崩溃（CWE-20） | 验证呈现字段，清除未支持顶层钩子，通过 |
| RUN-CANCEL-CAPABILITY | 首次 capability 请求和排队未贯通取消（CWE-400） | 请求、排队、边通道均可取消，通过 |
| PARAGRAPH-LIMIT | 已完整到达的段可绕过缓冲长度检查（CWE-770） | 每段提交前检查 UTF-8 64 KiB，通过 |
| PARAGRAPH-CONTINUE | 逐段节点错误继续未交付空输入 | 显式交付空输入，通过 |
| COMMENTARY-HANDOFF | 过程性助手消息可能被当作答案交给下游 | 不提交 commentary，未知阶段等待完成确认，通过 |
| STARTUP-AUTORUN | 启用插件可能恢复旧定时任务并调用模型 | 启用时不启动旧计划、不读取模型运行服务，通过 |

以上不是上游及第三方依赖的全面安全审计。残余边界：只读不限制读取范围；资料标记不是完整提示注入防线；capability 不是多用户认证，也不能防同源恶意插件；配置探测和加载之间可能发生外部修改；原版代码/表达式节点不享有 Codex 的只读保证。仅按本地可信开发插件使用，不作公网或生产安全声明。

## 最新发行包

包内 55 个文件、191631 字节。Host/Client、Codex 适配、调度器、图标、中英元数据、说明及示例均齐全；无 node_modules、Codex 配置/认证文件、环境文件、包外链接。

```text
artifacts/dsh-node-flow-0.1.0-codex.2.tgz
SHA-256: 2df656b65b93e0ff31b1cd53f6fe919c188926968465dd2c620c2e4df9e1c6a9
```

下一步由用户在已认证的 DSH 插件管理界面添加本地包并启用，再提供宿主显示的应用结果。若需要重启，先停止该步骤等待用户另行确认。真实模型调用同样需要单独确认。
