# 来源与第三方组件说明

## 上游项目

本项目是在 [CodermanYHZ/dsh-node-flow](https://github.com/CodermanYHZ/dsh-node-flow) 的 commit `21cf06fa80b042db16b41cb6908c919042a5bfcc` 之上开发的本地扩展，拟以 [RiHannnnn/dsh-agent-workflow](https://github.com/RiHannnnn/dsh-agent-workflow) 整理公开；插件包名保留为 `dsh-node-flow`。

原项目版权为 Copyright (c) 2025 CodermanYHZ，采用 MIT License。完整许可及免责声明原样保留于 [LICENSE](<LICENSE>)，发布副本或实质部分时应继续保留。仓库改名和功能扩展不改变上游版权归属，也不表示上游维护者认可或支持此扩展。

## 第三方依赖

依赖及范围以 [package.json](<package.json>) 和 [pnpm 锁文件](<pnpm-lock.yaml>) 为准，包含 React Flow（`@xyflow/react`）、Zustand、`smol-toml`，以及由宿主提供的 React、ReactDOM、`@deepseek-ai/cordis` 等；构建工具与传递依赖也有各自的许可条款。

这些组件不因本仓库采用 MIT 而被统一重新许可。客户端构建会内联部分依赖，分发源码或构建产物时仍需遵守各组件的实际许可，保留适用的版权、许可文本与 legal comments。本说明不是完整的第三方许可证清单，也不声称已完成所有传递依赖的许可合规核验或取得额外授权；进一步发行前仍需核对产物及对应依赖版本的条款。

## 角色与配置

本仓库只实现对本地 Codex TOML 角色的发现和使用，不附带用户的 Agency Agents 角色库、真实 Codex 配置或认证文件。用户自行提供的角色、提示词、附件和其他资料由其各自权利人保留权利；使用前请自行确认来源与授权。本项目不声称取得未核实的第三方角色或内容授权。

## 固定开发包

[downloads 开发包](<downloads/dsh-node-flow-0.1.0-codex.2.tgz>) 是已验证 `0.1.0-codex.2` 包的原样复制，未因本次文档整理重新打包；本文件及更新后的仓库首页不在该既有包内。该开发包的哈希和未验证边界见 [README](<README.md>) 与 [验证记录](<VERIFICATION.md>)。
