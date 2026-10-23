/**
 * Display-only Chinese localization for local Codex roles.
 *
 * The role files under CODEX_HOME/agents are never modified: their English
 * names/descriptions stay the source of truth and remain visible in tooltips.
 * Unknown roles fall back to the English metadata unchanged.
 */
export type RoleLike = { id: string; name: string; description: string }
export type LocalizedRole = { name: string; description: string; localized: boolean; englishName: string }

/** id → [中文名称, 中文简介]. Keep entries concise and faithful to the source role. */
const ZH: Record<string, [string, string]> = {
  'codex-default': ['Codex 默认角色', '使用本机 Codex 默认配置的通用只读角色。'],
  'engineering-backend-architect': ['后端架构师', '设计可扩展的后端系统、数据库架构与 API。'],
  'engineering-devops-automator': ['DevOps 自动化工程师', '基础设施自动化、CI/CD 流水线与云运维。'],
  'engineering-frontend-developer': ['前端开发工程师', '现代 Web 框架、界面实现与性能优化。'],
  'engineering-sre': ['站点可靠性工程师', 'SLO、错误预算、可观测性与降本减负。'],
  'product-behavioral-nudge-engine': ['行为助推设计师', '用行为心理学调整交互节奏，提升用户坚持度。'],
  'product-dx-engineer': ['开发者体验工程师', '减少从零到成功之间的摩擦：示例、报错与反馈闭环。'],
  'product-feedback-synthesizer': ['用户反馈分析师', '汇总多渠道反馈，提炼可执行的产品结论。'],
  'product-manager': ['产品经理', '负责产品全生命周期：发现、路线图与交付。'],
  'product-sprint-prioritizer': ['迭代优先级规划师', '敏捷迭代规划与需求排序，提升团队交付价值。'],
  'product-trend-researcher': ['趋势研究员', '识别新兴趋势、竞争格局与机会评估。'],
  'research-synthesist': ['研究综合分析师', '系统检索、评估来源并综合证据，理清哪些结论真正站得住。'],
  'testing-accessibility-auditor': ['无障碍审查员', '按 WCAG 标准审查界面，并做辅助技术测试。'],
  'testing-api-tester': ['API 测试工程师', '系统验证接口的正确性、性能与第三方集成。'],
  'testing-evidence-collector': ['证据收集 QA', '强调可复现证据的质检：标出可复现问题，并如实标注未测范围。'],
  'testing-performance-benchmarker': ['性能基准测试工程师', '测量、分析并优化应用与基础设施性能。'],
  'testing-reality-checker': ['现实核查员', '阻止“想当然的通过”：默认判为待改进，要求充分证据才认定可交付。'],
  'testing-test-automation-engineer': ['测试自动化工程师', 'Playwright/Cypress 端到端测试、稳定选择器与 CI 并行。'],
  'testing-test-results-analyzer': ['测试结果分析师', '评估测试结果、质量指标并提炼可执行改进建议。'],
  'testing-tool-evaluator': ['技术工具评估师', '评估、试用并推荐可提升生产力的工具与平台。'],
  'testing-workflow-optimizer': ['工作流优化师', '分析并自动化各业务职能的流程，提升整体效率。'],
}

export function localizeRole(role: RoleLike): LocalizedRole {
  const zh = ZH[role.id]
  if (!zh) return { name: role.name, description: role.description, localized: false, englishName: role.name }
  return { name: zh[0], description: zh[1], localized: true, englishName: role.name }
}

/** Chinese label plus the English original, for pickers and node titles. */
export function roleLabel(role: RoleLike): string {
  const localized = localizeRole(role)
  return localized.localized && localized.englishName !== localized.name
    ? `${localized.name}（${localized.englishName}）`
    : localized.name
}

/** Chinese name for a role id alone (node cards carry no library payload). */
export function roleDisplayName(id: string | undefined): string {
  const key = id || 'codex-default'
  return ZH[key]?.[0] ?? key
}

/** Search across Chinese and English metadata so either language finds the role. */
export function roleMatches(role: RoleLike, query: string): boolean {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return true
  const localized = localizeRole(role)
  return `${localized.name} ${localized.description} ${role.name} ${role.id} ${role.description}`.toLocaleLowerCase().includes(q)
}
