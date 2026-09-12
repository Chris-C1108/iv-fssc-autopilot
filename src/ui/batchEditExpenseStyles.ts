import { ASSISTANT_UI_STYLES } from './assistantUiStyles';

/**
 * 批量修改费用信息模态框 - Vercel 设计风格高质感样式系统 (assets/design.md 规范)
 * 核心哲学：单色优先、克制高级、等宽数字、精确对齐、无花哨渐变与无意义装饰
 */
export const BATCH_EDIT_EXPENSE_STYLES = `
${ASSISTANT_UI_STYLES}

/* 遮罩层：高质感毛玻璃半透明黑色 */
#yn-batch-edit-mask {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(6px);
    z-index: 999998;
    display: none;
    animation: ynFadeIn 0.15s ease-out;
}

/* 模态框主体：100% 全屏沉浸式无边框，极简浅色背景 */
#yn-batch-edit-modal {
    /* ==========================================================================
       coss.com/ui & Vercel Design Guidelines Design Tokens (Strictly Scoped)
       ========================================================================== */
    --coss-bg-base: #ffffff;
    --coss-bg-surface: #fafafa;
    --coss-bg-muted: #f4f4f5;
    --coss-bg-subtle: #f9fafb;
    --coss-fg-default: #09090b;
    --coss-fg-muted: #52525b;
    --coss-fg-subtle: #71717a;
    --coss-border: rgba(0, 0, 0, 0.08);
    --coss-border-hover: rgba(0, 0, 0, 0.16);
    --coss-border-strong: #d4d4d8;
    --coss-primary: #18181b;
    --coss-primary-hover: #27272a;
    --coss-primary-fg: #ffffff;
    --coss-success: #059669;
    --coss-success-bg: #ecfdf5;
    --coss-warning: #d97706;
    --coss-warning-bg: #fffbeb;
    --coss-danger: #dc2626;
    --coss-danger-bg: #fef2f2;
    --coss-info: #2563eb;
    --coss-info-bg: #eff6ff;
    --coss-ring: rgba(24, 24, 27, 0.18);
    --coss-radius-xs: 4px;
    --coss-radius-sm: 6px;
    --coss-radius-md: 8px;
    --coss-radius-lg: 12px;
    --coss-radius-full: 9999px;
    --coss-shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --coss-shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.07), 0 1px 2px -1px rgba(0, 0, 0, 0.05);
    --coss-shadow-card: 0 4px 16px -2px rgba(0, 0, 0, 0.06), 0 2px 6px -1px rgba(0, 0, 0, 0.03);
    --coss-shadow-popover: 0 12px 32px -4px rgba(0, 0, 0, 0.12), 0 4px 12px -2px rgba(0, 0, 0, 0.04);
    --coss-ease: cubic-bezier(0.16, 1, 0.3, 1);
    --coss-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

    position: fixed;
    top: 0; left: 0;
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    background: var(--coss-bg-base);
    border-radius: 0;
    box-shadow: none;
    z-index: 999999;
    display: none;
    flex-direction: column;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: var(--coss-fg-default);
    animation: ynFadeIn 0.15s var(--coss-ease);
    -webkit-font-smoothing: antialiased;
}

@keyframes ynFadeIn {
    from { opacity: 0; transform: scale(0.995); }
    to { opacity: 1; transform: scale(1); }
}

/* ==========================================================================
   coss.com/ui Atomic Components System (Zero Host Pollution)
   ========================================================================== */

/* Buttons (coss.com/ui Base UI Pattern) */
.yn-coss-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 12px;
    height: 28px;
    border-radius: var(--coss-radius-sm);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: -0.01em;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    box-sizing: border-box;
    outline: none;
    text-decoration: none;
    transition: transform 100ms var(--coss-ease),
                background-color 120ms var(--coss-ease),
                border-color 120ms var(--coss-ease),
                box-shadow 120ms var(--coss-ease),
                color 120ms var(--coss-ease),
                opacity 120ms var(--coss-ease);
}
.yn-coss-btn:active:not(:disabled) {
    transform: scale(0.98);
}
.yn-coss-btn:focus-visible {
    box-shadow: 0 0 0 2px var(--coss-bg-base), 0 0 0 4px var(--coss-ring);
}
.yn-coss-btn:disabled,
.yn-coss-btn[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
}

/* Button Variants */
.yn-coss-btn-default {
    background: var(--coss-primary);
    color: var(--coss-primary-fg);
    border: 1px solid var(--coss-primary);
    box-shadow: var(--coss-shadow-xs), inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.yn-coss-btn-default:hover:not(:disabled) {
    background: var(--coss-primary-hover);
    border-color: var(--coss-primary-hover);
}

.yn-coss-btn-secondary {
    background: var(--coss-bg-base);
    color: var(--coss-fg-default);
    border: 1px solid var(--coss-border);
    box-shadow: var(--coss-shadow-xs);
}
.yn-coss-btn-secondary:hover:not(:disabled) {
    background: var(--coss-bg-surface);
    border-color: var(--coss-border-hover);
}

.yn-coss-btn-outline {
    background: transparent;
    color: var(--coss-fg-default);
    border: 1px solid var(--coss-border);
}
.yn-coss-btn-outline:hover:not(:disabled) {
    background: var(--coss-bg-muted);
    border-color: var(--coss-border-hover);
}

.yn-coss-btn-ghost {
    background: transparent;
    color: var(--coss-fg-muted);
    border: 1px solid transparent;
}
.yn-coss-btn-ghost:hover:not(:disabled) {
    background: var(--coss-bg-muted);
    color: var(--coss-fg-default);
}

.yn-coss-btn-danger {
    background: var(--coss-danger-bg);
    color: var(--coss-danger);
    border: 1px solid rgba(220, 38, 38, 0.2);
}
.yn-coss-btn-danger:hover:not(:disabled) {
    background: #fee2e2;
    border-color: rgba(220, 38, 38, 0.35);
}

.yn-coss-btn-ai {
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    border: 1px solid #cbd5e1;
    color: #0f172a;
    box-shadow: var(--coss-shadow-xs);
}
.yn-coss-btn-ai:hover:not(:disabled) {
    background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
    border-color: #94a3b8;
    box-shadow: var(--coss-shadow-sm);
}

/* Button Sizes */
.yn-coss-btn-sm {
    height: 24px;
    padding: 0 8px;
    font-size: 11px;
    border-radius: var(--coss-radius-xs);
}
.yn-coss-btn-md {
    height: 32px;
    padding: 0 14px;
    font-size: 13px;
    border-radius: var(--coss-radius-sm);
}

/* Badges / Chips (coss.com/ui Status Token System) */
.yn-coss-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: var(--coss-radius-xs);
    font-size: 11px;
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
    user-select: none;
    white-space: nowrap;
    box-sizing: border-box;
}
.yn-coss-badge.pill {
    border-radius: var(--coss-radius-full);
}
.yn-coss-badge-default {
    background: var(--coss-bg-muted);
    color: var(--coss-fg-default);
    border: 1px solid var(--coss-border);
}
.yn-coss-badge-secondary {
    background: var(--coss-bg-surface);
    color: var(--coss-fg-muted);
    border: 1px solid var(--coss-border);
}
.yn-coss-badge-success {
    background: var(--coss-success-bg);
    color: var(--coss-success);
    border: 1px solid rgba(5, 150, 105, 0.2);
}
.yn-coss-badge-warning {
    background: var(--coss-warning-bg);
    color: var(--coss-warning);
    border: 1px solid rgba(217, 119, 6, 0.2);
}
.yn-coss-badge-danger {
    background: var(--coss-danger-bg);
    color: var(--coss-danger);
    border: 1px solid rgba(220, 38, 38, 0.2);
}
.yn-coss-badge-info {
    background: var(--coss-info-bg);
    color: var(--coss-info);
    border: 1px solid rgba(37, 99, 235, 0.2);
}

/* Inputs & Selects */
.yn-coss-input,
.yn-coss-select {
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-sm);
    padding: 4px 8px;
    font-size: 12px;
    background: var(--coss-bg-base);
    color: var(--coss-fg-default);
    height: 28px;
    box-sizing: border-box;
    transition: border-color 120ms var(--coss-ease), box-shadow 120ms var(--coss-ease);
}
.yn-coss-input:focus,
.yn-coss-select:focus {
    outline: none;
    border-color: var(--coss-primary);
    box-shadow: 0 0 0 1px var(--coss-primary);
}
.yn-coss-input::placeholder {
    color: var(--coss-fg-subtle);
}

/* Cards & Surface Containers */
.yn-coss-card {
    background: var(--coss-bg-base);
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-md);
    box-shadow: var(--coss-shadow-card);
}

/* ==========================================================================
   全新架构：一体化极简单行顶栏 (Single-Row Top Bar 46px) + 居中搜索 + 固定端点
   ========================================================================== */
.yn-bem-top-bar {
    background: var(--coss-bg-base);
    border-bottom: 1px solid var(--coss-border);
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    height: 46px;
    padding: 0 16px;
    user-select: none;
    box-sizing: border-box;
    width: 100%;
    position: relative;
    z-index: 10000;
    flex-shrink: 0;
}

/* 顶部左侧：品牌标题 + 分组 + 切换展开折叠 + 选择与过滤 */
.yn-bem-header-left {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    min-width: 0;
    z-index: 1001;
}

/* 顶部中间：严格水平居中搜索框 */
.yn-bem-header-center {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1001;
    pointer-events: auto;
}

.yn-bem-search-center {
    width: 260px;
    height: 28px;
    background: var(--coss-bg-surface);
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-sm);
    padding: 0 12px;
    font-size: 12px;
    color: var(--coss-fg-default);
    outline: none;
    box-sizing: border-box;
    transition: all 0.15s var(--coss-ease);
}
.yn-bem-search-center:focus {
    width: 320px;
    background: #ffffff;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

/* 顶部右侧：AI 助手切换 + 关闭 (全宽固定在顶栏最右端，永不被侧边栏挤压) */
.yn-bem-header-right {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    z-index: 1002;
    flex: 0 0 auto;
}

.yn-bem-bar-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
}

.yn-bem-brand {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: #000000;
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.yn-bem-brand-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 7px;
    background: var(--coss-bg-muted);
    color: var(--coss-fg-muted);
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-xs);
    font-size: 11px;
    font-family: var(--coss-font-mono);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
}

.yn-bem-warn-indicator {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 500;
    color: var(--coss-warning);
    background: var(--coss-warning-bg);
    border: 1px solid rgba(217, 119, 6, 0.2);
    padding: 2px 8px;
    border-radius: var(--coss-radius-xs);
    font-variant-numeric: tabular-nums;
}

.yn-bem-close-x {
    background: transparent;
    border: 1px solid transparent;
    font-size: 14px;
    color: #737373;
    cursor: pointer;
    line-height: 1;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    transition: all 0.15s ease;
}
.yn-bem-close-x:hover {
    background: #f5f5f5;
    color: #000000;
    border-color: #eaeaea;
}

/* 控件单元与排版 (Fields) */
.yn-bem-field-group {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
}
.yn-bem-field-group label {
    font-weight: 500;
    color: #666666;
    white-space: nowrap;
    letter-spacing: -0.01em;
}

.yn-bem-input {
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-sm);
    padding: 5px 9px;
    font-size: 12px;
    background: var(--coss-bg-base);
    color: var(--coss-fg-default);
    transition: border-color 120ms var(--coss-ease), box-shadow 120ms var(--coss-ease);
    height: 28px;
    box-sizing: border-box;
}
.yn-bem-input:focus {
    outline: none;
    border-color: var(--coss-primary);
    box-shadow: 0 0 0 1px var(--coss-primary);
}
.yn-bem-input::placeholder {
    color: var(--coss-fg-subtle);
}

.yn-bem-select {
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-sm);
    padding: 4px 8px;
    font-size: 12px;
    background: var(--coss-bg-base);
    color: var(--coss-fg-default);
    cursor: pointer;
    height: 28px;
    box-sizing: border-box;
    transition: border-color 120ms var(--coss-ease), box-shadow 120ms var(--coss-ease);
}
.yn-bem-select:focus {
    outline: none;
    border-color: var(--coss-primary);
    box-shadow: 0 0 0 1px var(--coss-primary);
}

/* 项目实时搜索容器与下拉浮层 */
.yn-bem-project-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
}
.yn-bem-project-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 360px;
    max-height: 280px;
    overflow-y: auto;
    background: #ffffff;
    border: 1px solid #eaeaea;
    border-radius: 6px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
    z-index: 1000;
    display: none;
}
.yn-bem-project-item {
    padding: 8px 12px;
    font-size: 12px;
    cursor: pointer;
    border-bottom: 1px solid #f5f5f5;
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: background 0.12s;
}
.yn-bem-project-item:last-child {
    border-bottom: none;
}
.yn-bem-project-item:hover {
    background: #f5f5f5;
}
.yn-bem-project-code {
    font-weight: 600;
    color: #000000;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.yn-bem-project-name {
    color: #737373;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* Segmented Control 格式选项卡 (coss.com/ui 风格) */
.yn-bem-segmented-wrap {
    display: inline-flex;
    align-items: center;
    background: var(--coss-bg-muted);
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-sm);
    padding: 2px;
    gap: 2px;
}
.yn-bem-preset-btn {
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--coss-fg-muted);
    border-radius: var(--coss-radius-xs);
    cursor: pointer;
    transition: all 120ms var(--coss-ease);
    user-select: none;
    border: none;
    background: transparent;
}
.yn-bem-preset-btn:hover {
    color: var(--coss-fg-default);
}
.yn-bem-preset-btn.active {
    background: var(--coss-bg-base);
    color: var(--coss-fg-default);
    font-weight: 600;
    box-shadow: var(--coss-shadow-xs);
}

/* 实时预览 Mono 胶囊 */
.yn-bem-preview-pill {
    background: var(--coss-bg-muted);
    color: var(--coss-fg-default);
    border: 1px solid var(--coss-border);
    padding: 4px 8px;
    border-radius: var(--coss-radius-xs);
    font-family: var(--coss-font-mono);
    font-size: 11px;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 快捷动作链接 (Ghost / Action Link - coss.com/ui 风格) */
.yn-bem-quick-link {
    font-size: 11px;
    font-weight: 500;
    color: var(--coss-fg-muted);
    cursor: pointer;
    background: var(--coss-bg-base);
    padding: 2px 7px;
    border-radius: var(--coss-radius-xs);
    border: 1px solid var(--coss-border);
    transition: transform 100ms var(--coss-ease),
                background-color 120ms var(--coss-ease),
                border-color 120ms var(--coss-ease),
                color 120ms var(--coss-ease);
    user-select: none;
    height: 24px;
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    font-variant-numeric: tabular-nums;
}
.yn-bem-quick-link:hover {
    color: var(--coss-fg-default);
    background: var(--coss-bg-surface);
    border-color: var(--coss-border-hover);
}
.yn-bem-quick-link:active {
    transform: scale(0.96);
}

/* Vercel & coss.com/ui 按钮系统 (Button System) */
.yn-bem-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 12px;
    height: 28px;
    border-radius: var(--coss-radius-sm);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: -0.01em;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    box-sizing: border-box;
    outline: none;
    transition: transform 100ms var(--coss-ease),
                background-color 120ms var(--coss-ease),
                border-color 120ms var(--coss-ease),
                box-shadow 120ms var(--coss-ease);
}
.yn-bem-btn:active:not(:disabled) {
    transform: scale(0.98);
}
.yn-bem-btn:focus-visible {
    box-shadow: 0 0 0 2px var(--coss-bg-base), 0 0 0 4px var(--coss-ring);
}

/* 标志性深黑主按钮 (Solid Black Primary) */
.yn-bem-btn-primary,
.yn-bem-btn-apply {
    background: var(--coss-primary);
    color: var(--coss-primary-fg);
    border: 1px solid var(--coss-primary);
    box-shadow: var(--coss-shadow-xs), inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.yn-bem-btn-primary:hover:not(:disabled),
.yn-bem-btn-apply:hover {
    background: var(--coss-primary-hover);
    border-color: var(--coss-primary-hover);
}
.yn-bem-btn-primary:active:not(:disabled),
.yn-bem-btn-apply:active {
    background: #3f3f46;
}
.yn-bem-btn-primary:disabled {
    background: var(--coss-bg-muted);
    color: var(--coss-fg-subtle);
    border-color: var(--coss-border);
    cursor: not-allowed;
    box-shadow: none;
    transform: none !important;
}

/* 次级白底按钮 (Secondary) */
.yn-bem-btn-secondary {
    background: var(--coss-bg-base);
    color: var(--coss-fg-default);
    border: 1px solid var(--coss-border);
    box-shadow: var(--coss-shadow-xs);
}
.yn-bem-btn-secondary:hover:not(:disabled) {
    background: var(--coss-bg-surface);
    border-color: var(--coss-border-hover);
    color: var(--coss-fg-default);
}
.yn-bem-btn-secondary:disabled,
.yn-bem-btn-secondary[disabled] {
    background: var(--coss-bg-muted) !important;
    color: var(--coss-fg-subtle) !important;
    border-color: var(--coss-border) !important;
    cursor: not-allowed !important;
    box-shadow: none !important;
    opacity: 0.55 !important;
    transform: none !important;
}

/* 专属动态必填字段卡片 (Vercel Inset Panel) */
.yn-bem-dynamic-fields-card {
    background: #fafafa;
    border: 1px solid #eaeaea;
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 12px;
    transition: border-color 0.2s;
}
.yn-bem-dynamic-fields-card.type-neutral {
    background: #ffffff;
    border: 1px dashed #eaeaea;
}
.yn-bem-dynamic-fields-card.type-highlight {
    background: #fafafa;
    border: 1px solid #171717;
}
.yn-bem-dyn-title {
    font-weight: 600;
    color: #000000;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
}
.yn-bem-dyn-fields {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

/* 表格容器与证据驱动多行渲染 (Evidence Table) */
.yn-bem-table-wrap {
    flex: 1;
    overflow: auto;
    position: relative;
    background: #ffffff;
}

.yn-bem-table {
    min-width: 100%;
    width: max-content;
    border-collapse: collapse;
    font-size: 12px;
    white-space: nowrap;
    table-layout: fixed;
}

.yn-bem-table thead th {
    position: sticky;
    top: 0;
    background: var(--coss-bg-surface);
    color: var(--coss-fg-muted);
    font-weight: 600;
    font-size: 11px;
    padding: 4px 6px;
    border-bottom: 1px solid var(--coss-border);
    border-right: 1px solid var(--coss-border);
    text-align: left;
    z-index: 10;
    user-select: none;
    letter-spacing: 0.01em;
}
.yn-bem-table thead th.sortable {
    cursor: pointer;
    transition: color 120ms var(--coss-ease), background-color 120ms var(--coss-ease);
}
.yn-bem-table thead th.sortable:hover {
    color: var(--coss-fg-default);
    background: var(--coss-bg-muted);
}
.yn-bem-table thead th.sorted-active {
    color: var(--coss-fg-default);
    font-weight: 600;
    background: var(--coss-bg-muted);
}

/* 表头类别微徽章 (Category Badges - 高密微型化) */
.yn-bem-th-cat-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 600;
    line-height: 1;
    padding: 1px 3px;
    border-radius: 2px;
    margin-right: 0;
    vertical-align: middle;
    white-space: nowrap;
    user-select: none;
    letter-spacing: -0.02em;
}
.yn-bem-th-cat-pill.yn-th-cat-transit {
    background: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
}
.yn-bem-th-cat-pill.yn-th-cat-hotel {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
}
.yn-bem-th-cat-pill.yn-th-cat-taxi {
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fde68a;
}
.yn-bem-th-cat-pill.yn-th-cat-mobile {
    background: #ede9fe;
    color: #6d28d9;
    border: 1px solid #ddd6fe;
}
.yn-bem-th-cat-pill.yn-th-cat-invoice {
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #e2e8f0;
}
.yn-bem-th-cat-pill.yn-th-cat-base {
    background: #f4f4f5;
    color: #52525b;
    border: 1px solid #e4e4e7;
}

.yn-bem-table tbody td {
    padding: 4px 6px;
    border-bottom: 1px solid var(--coss-border);
    border-right: 1px solid rgba(0, 0, 0, 0.04);
    color: var(--coss-fg-default);
    vertical-align: middle;
    font-variant-numeric: tabular-nums;
    /* 彻底消除 background-color transition，杜绝鼠标在表格移动时触发数百个并发 CSS 动画造成的掉帧 */
}

/* 行鼠标悬浮高亮 (标准高效瞬时微底色，0ms 延迟，不占主线程) */
.yn-bem-table tbody tr:hover td {
    background-color: #f8fafc;
}

/* 用户点击激活的当前所在行 (高亮浅天蓝，便于长行水平横向比对) */
.yn-bem-table tbody tr.is-active-row td {
    background-color: #e0f2fe !important;
}
.yn-bem-table tbody tr.is-active-row .yn-bem-col-sticky-cb,
.yn-bem-table tbody tr.is-active-row .yn-bem-col-sticky-date {
    background-color: #e0f2fe !important;
}

/* 分组首行细边线 */
.yn-bem-table tbody tr.yn-bem-group-first td {
    border-top: 1px solid #e5e5e5;
}

/* 费用聚合单元格 (rowspan) 样式 */
.yn-bem-group-cell {
    background: #ffffff;
    vertical-align: top;
    padding-top: 9px;
}

/* 现代无缝电子表格交互单元格 (Excel / Airtable 级 100% 满高贴合) */
td.yn-bem-cell-interactive {
    padding: 0 !important;
    vertical-align: middle !important;
    position: relative;
    height: 100% !important;
}

.yn-bem-table tbody tr.is-selected td {
    background: #fcfcfc;
}

/* 粘性固定列 (Sticky Columns) */
.yn-bem-col-sticky-cb {
    position: sticky;
    left: 0;
    background: #ffffff;
    z-index: 5;
    text-align: center;
    width: 34px;
    min-width: 34px;
}
.yn-bem-table thead th.yn-bem-col-sticky-cb {
    z-index: 20;
    background: #fafafa;
}
.yn-bem-col-sticky-date {
    position: sticky;
    left: 34px;
    background: #ffffff;
    z-index: 5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: #000000;
    width: 76px;
    min-width: 76px;
}
.yn-bem-table thead th.yn-bem-col-sticky-date {
    z-index: 20;
    background: #fafafa;
}
.yn-bem-table tbody tr.is-selected .yn-bem-col-sticky-cb,
.yn-bem-table tbody tr.is-selected .yn-bem-col-sticky-date {
    background: #fcfcfc !important;
}

/* 单列费用说明文本框 (Clean Inset Textarea) */
.yn-bem-desc-box {
    width: 100%;
    min-width: 80px;
    max-width: 100%;
    height: 34px;
    border: 1px solid #eaeaea;
    border-radius: 4px;
    padding: 5px 7px;
    font-size: 12px;
    color: #171717;
    background: #ffffff;
    resize: vertical;
    line-height: 1.35;
    font-family: inherit;
    transition: all 0.15s ease;
    box-sizing: border-box;
}
.yn-bem-desc-box:focus {
    outline: none;
    border-color: #000000;
    box-shadow: 0 0 0 1px #000000;
}
.yn-bem-desc-box.has-changed {
    border-color: #059669;
    background: #f0fdf4;
    color: #065f46;
    font-weight: 500;
}

/* 费用类型标签与变动对比 (Type Tags) */
.yn-bem-type-tag {
    display: inline-block;
    padding: 2px 7px;
    background: #f5f5f5;
    color: #171717;
    border: 1px solid #eaeaea;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
}
.yn-bem-type-changed-wrapper {
    display: inline-flex;
    flex-direction: column;
    gap: 3px;
}
.yn-bem-type-changed-wrapper .type-flow {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
}
.yn-bem-type-changed-wrapper .old-type {
    color: #a3a3a3;
    text-decoration: line-through;
    font-size: 11px;
}
.yn-bem-type-changed-wrapper .arrow {
    color: #171717;
    font-weight: 600;
    font-size: 11px;
}
.yn-bem-type-changed-wrapper .new-type {
    color: #ffffff;
    background: #000000;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
}
.yn-bem-sub-field-tag {
    display: inline-block;
    font-size: 10px;
    color: #525252;
    background: #f5f5f5;
    border: 1px solid #eaeaea;
    padding: 2px 6px;
    border-radius: 4px;
    margin-top: 3px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* 预警徽章 (Subtle Warning & OK Badges) */
.yn-bem-badge-warn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #fffbeb;
    color: #b45309;
    border: 1px solid #fef3c7;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
}
.yn-bem-badge-ok {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #f0fdf4;
    color: #15803d;
    border: 1px solid #dcfce7;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
}

/* 底栏状态统计条 (Sleek Minimal Status Strip) */
.yn-bem-footer {
    height: 36px;
    padding: 0 16px;
    background: #fafafa;
    border-top: 1px solid var(--coss-border);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    font-size: 11.5px;
    user-select: none;
    flex-shrink: 0;
}
.yn-bem-footer-stats {
    color: var(--coss-fg-muted);
    display: flex;
    align-items: center;
    gap: 16px;
    font-variant-numeric: tabular-nums;
}
.yn-bem-footer-stats strong {
    color: var(--coss-fg-default);
    font-family: var(--coss-font-mono);
}
.yn-bem-footer-stats .yn-bem-stat-highlight {
    color: var(--coss-fg-default);
    font-weight: 600;
}
.yn-bem-footer-stats .yn-bem-stat-amount {
    color: var(--coss-primary);
    font-weight: 700;
    font-size: 12.5px;
    font-family: var(--coss-font-mono);
    letter-spacing: -0.01em;
}

/* 列头垂直两行高密度架构 (Senior B-End Two-Tier Header Cell Architecture) */
.yn-bem-th-cell-stack {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 38px;
    justify-content: space-between;
    gap: 2px;
    position: relative;
    box-sizing: border-box;
}
.yn-bem-th-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: 14px;
    gap: 2px;
}
.yn-bem-th-pill-spacer {
    display: inline-block;
    height: 12px;
    width: 1px;
}
.yn-bem-th-bottom-row {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 2px;
    line-height: 1.25;
    min-height: 16px;
}
.yn-bem-th-title {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    cursor: pointer;
    user-select: none;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 600;
    color: #1e293b;
    flex: 1;
}
.yn-bem-th-title:hover {
    color: #0f172a;
}
.yn-bem-th-label-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.yn-bem-th-sort-arrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 700;
    font-size: 10px;
    color: #0284c7;
    flex-shrink: 0;
}
.yn-bem-th-filter-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 2px;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.12s ease;
    font-size: 9px;
    border: 1px solid transparent;
    user-select: none;
    background: transparent;
    flex-shrink: 0;
    margin-left: auto;
}
.yn-bem-th-filter-trigger:hover {
    background: #e2e8f0;
    color: #0f172a;
}
.yn-bem-th-filter-trigger.is-active {
    background: #0284c7;
    color: #ffffff;
    border-color: #0284c7;
}

/* 兼容旧单行表头引用 */
.yn-bem-th-content {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 4px;
    position: relative;
}
.yn-bem-th-title {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    cursor: pointer;
    user-select: none;
    flex: 1;
}
.yn-bem-th-title:hover {
    color: #000000;
}
.yn-bem-th-sort-arrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 700;
    font-size: 11px;
    color: #000000;
}
.yn-bem-th-filter-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    color: #a3a3a3;
    cursor: pointer;
    transition: all 0.12s ease;
    font-size: 9px;
    border: 1px solid transparent;
    user-select: none;
    background: transparent;
    flex-shrink: 0;
}
.yn-bem-th-filter-trigger:hover {
    background: #eaeaea;
    color: #000000;
}
.yn-bem-th-filter-trigger.is-active {
    background: #000000;
    color: #ffffff;
    border-color: #000000;
}

/* 列头筛选下拉浮层 (Vercel Popover) */
.yn-bem-filter-popover {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    min-width: 220px;
    max-width: 320px;
    background: #ffffff;
    border: 1px solid #eaeaea;
    border-radius: 6px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
    z-index: 100;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-align: left;
    font-weight: normal;
    cursor: default;
    animation: ynFadeIn 0.12s ease-out;
    box-sizing: border-box;
}
.yn-bem-filter-popover-search {
    width: 100%;
    height: 26px;
    border: 1px solid #eaeaea;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    box-sizing: border-box;
    outline: none;
    color: #171717;
    background: #ffffff;
}
.yn-bem-filter-popover-search:focus {
    border-color: #000000;
    box-shadow: 0 0 0 1px #000000;
}
.yn-bem-filter-popover-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 4px;
    border-bottom: 1px solid #f5f5f5;
    font-size: 11px;
}
.yn-bem-filter-popover-link {
    color: #737373;
    cursor: pointer;
    user-select: none;
}
.yn-bem-filter-popover-link:hover {
    color: #000000;
    text-decoration: underline;
}
.yn-bem-filter-val-list {
    max-height: 180px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0;
}
.yn-bem-filter-val-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    border-radius: 4px;
    font-size: 11px;
    color: #171717;
    cursor: pointer;
    transition: background 0.1s;
    user-select: none;
}
.yn-bem-filter-val-item:hover {
    background: #f5f5f5;
}
.yn-bem-filter-val-text {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.yn-bem-filter-val-count {
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: #a3a3a3;
}

/* 顶部活跃筛选条件标签栏 */
.yn-bem-active-filter-tags {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px 0;
    font-size: 11px;
}
.yn-bem-active-filter-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #f5f5f5;
    border: 1px solid #eaeaea;
    color: #171717;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11px;
}
.yn-bem-active-filter-tag .tag-field {
    color: #737373;
    font-weight: 500;
}
.yn-bem-active-filter-tag .tag-val {
    font-weight: 600;
    color: #000000;
    font-family: ui-monospace, monospace;
}
.yn-bem-active-filter-tag .tag-close {
    cursor: pointer;
    color: #a3a3a3;
    font-size: 12px;
    margin-left: 2px;
    line-height: 1;
}
.yn-bem-active-filter-tag .tag-close:hover {
    color: #000000;
}
.yn-bem-clear-all-filters {
    font-size: 11px;
    color: #737373;
    cursor: pointer;
    text-decoration: underline;
    margin-left: 4px;
}
.yn-bem-clear-all-filters:hover {
    color: #000000;
}

/* 单元格就地直接编辑样式 (Inline Cell Editing - 100% 满高满宽贴合) */
.yn-bem-cell-date-input {
    width: 100%;
    height: 100%;
    min-height: 34px;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 0;
    padding: 0 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    color: #171717;
    box-sizing: border-box;
    outline: none;
    display: block;
    transition: background-color 0.12s ease, border-color 0.12s ease;
}
.yn-bem-cell-date-input:hover {
    background: rgba(0, 0, 0, 0.02);
}
.yn-bem-cell-date-input:focus {
    border-color: #2563eb !important;
    background: #ffffff !important;
    box-shadow: inset 0 0 0 2px #2563eb !important;
    outline: none !important;
    z-index: 3;
    position: relative;
}
.yn-bem-cell-date-input.has-changed {
    border-color: #10b981;
    background: #f0fdf4 !important;
    color: #065f46;
    font-weight: 600;
}

.yn-bem-cell-type-wrapper {
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: flex-start;
    padding: 3px 6px;
    box-sizing: border-box;
    width: 100%;
}
.yn-bem-cell-type-select {
    border: 1px solid #e5e7eb;
    background: #ffffff;
    border-radius: 4px;
    padding: 3px 4px;
    font-size: 11px;
    color: #171717;
    max-width: 150px;
    font-weight: 500;
    outline: none;
    cursor: pointer;
    transition: all 0.15s ease;
}
.yn-bem-cell-type-select:hover,
.yn-bem-cell-type-select:focus {
    border-color: #000000;
}
.yn-bem-cell-type-select.has-type-changed {
    border-color: #059669;
    background: #f0fdf4;
    color: #065f46;
    font-weight: 600;
}

.yn-bem-cell-dyn-trigger {
    font-size: 10px;
    color: #525252;
    background: #f5f5f5;
    border: 1px solid #eaeaea;
    border-radius: 3px;
    padding: 1px 5px;
    cursor: pointer;
    line-height: 1.4;
    transition: all 0.15s ease;
    white-space: nowrap;
}
.yn-bem-cell-dyn-trigger:hover {
    background: #000000;
    color: #ffffff;
    border-color: #000000;
}

.yn-bem-cell-text-input {
    border: 1px solid transparent;
    background: transparent;
    border-radius: 0;
    padding: 0 8px;
    font-size: 12px;
    color: #171717;
    width: 100%;
    height: 100%;
    min-height: 34px;
    box-sizing: border-box;
    outline: none;
    font-family: inherit;
    display: block;
}
.yn-bem-cell-text-input:hover {
    background: rgba(0, 0, 0, 0.02);
}
.yn-bem-cell-text-input:focus {
    border-color: #2563eb !important;
    background: #ffffff !important;
    box-shadow: inset 0 0 0 2px #2563eb !important;
    outline: none !important;
    z-index: 3;
    position: relative;
}
.yn-bem-cell-text-input.has-changed {
    border-color: #059669;
    background: #f0fdf4;
    color: #065f46;
}

/* 行级专属必填字段编辑模态浮层 (Row Dynamic Fields Modal) */
.yn-bem-row-dyn-mask {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    z-index: 10000002;
    display: flex;
    align-items: center;
    justify-content: center;
}
.yn-bem-row-dyn-card {
    background: #ffffff;
    border: 1px solid #eaeaea;
    border-radius: 8px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
    width: 460px;
    max-width: 90vw;
    padding: 20px;
    box-sizing: border-box;
    animation: ynBemFadeIn 0.15s ease-out;
}
.yn-bem-row-dyn-title {
    font-size: 14px;
    font-weight: 600;
    color: #000000;
    margin-bottom: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.yn-bem-row-dyn-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.yn-bem-row-dyn-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.yn-bem-row-dyn-field label {
    font-size: 12px;
    font-weight: 500;
    color: #525252;
}
.yn-bem-row-dyn-field input,
.yn-bem-row-dyn-field select {
    border: 1px solid #eaeaea;
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
    color: #171717;
    background: #fafafa;
    outline: none;
    transition: all 0.15s ease;
}
.yn-bem-row-dyn-field input:focus,
.yn-bem-row-dyn-field select:focus {
    border-color: #000000;
    background: #ffffff;
    box-shadow: 0 0 0 1px #000000;
}
.yn-bem-row-dyn-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
}

/* ==========================================================================
   专属必填字段独立列与就地直接编辑样式系统 (v4.34.0)
   ========================================================================== */

/* 专属字段各类型背景着色 */
.yn-bem-dyn-cell-flight {
    background: #f0f9ff !important;
}
.yn-bem-dyn-cell-train {
    background: #f0fdf4 !important;
}
.yn-bem-dyn-cell-hotel {
    background: #fefce8 !important;
}
.yn-bem-dyn-cell-taxi {
    background: #faf5ff !important;
}
.yn-bem-dyn-cell-mobile {
    background: #eef2ff !important;
}

/* 非适用类型禁用单元格 */
.yn-bem-dyn-cell-na {
    background: #fafafa !important;
    color: #a3a3a3;
    text-align: center;
    font-size: 11px;
    user-select: none;
}

/* 专属必填字段空缺高亮警告 */
.yn-bem-dyn-cell-empty {
    background: #fef2f2 !important;
    border-left: 3px solid #ef4444 !important;
}
.yn-bem-dyn-cell-empty .yn-bem-dyn-input {
    background: #fef2f2 !important;
}
.yn-bem-dyn-cell-empty .yn-bem-dyn-input::placeholder {
    color: #ef4444 !important;
    font-size: 11px;
    font-weight: 500;
}

/* 专属字段就地直接编辑输入框 (无缝等高填满单元格) */
.yn-bem-dyn-input {
    width: 100%;
    height: 100%;
    min-height: 34px;
    border: 1px solid transparent;
    border-radius: 0;
    padding: 0 8px;
    font-size: 12px;
    background: transparent;
    color: #171717;
    box-sizing: border-box;
    font-family: inherit;
    outline: none;
    display: block;
}
.yn-bem-dyn-input:hover {
    background: rgba(0, 0, 0, 0.02);
}
.yn-bem-dyn-input:focus {
    border-color: #2563eb !important;
    background: #ffffff !important;
    box-shadow: inset 0 0 0 2px #2563eb !important;
    outline: none !important;
    z-index: 3;
    position: relative;
}
.yn-bem-dyn-input.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
}
.yn-bem-dyn-input.has-changed {
    border-color: #10b981;
    background: #f0fdf4 !important;
}

/* ==========================================================================
   AI 智能推断与修改单元格高亮标记系统 (v4.34.2)
   ========================================================================== */

.yn-bem-dyn-cell-inner {
    position: relative;
    display: flex;
    align-items: stretch;
    width: 100%;
    height: 100%;
    min-height: 34px;
    box-sizing: border-box;
}

/* 专属必填字段 AI 推断生成单元格 (清新翠绿微色阶 + 鲜亮边框 + 提示光标) */
.yn-bem-dyn-cell-ai {
    background-color: #ecfdf5 !important;
    box-shadow: inset 0 0 0 1.5px #10b981 !important;
    position: relative;
}

.yn-bem-dyn-cell-ai .yn-bem-dyn-input.is-ai-inferred {
    background-color: #ecfdf5 !important;
    color: #065f46 !important;
    font-weight: 600 !important;
    padding-right: 18px !important;
}

/* 单元格右上/居中微型 ✨ AI 标记图标 */
.yn-bem-ai-sparkle-dot {
    position: absolute;
    right: 3px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 11px;
    line-height: 1;
    pointer-events: none;
    color: #059669;
    z-index: 3;
    opacity: 0.9;
    user-select: none;
}

/* 业务日期 AI 自动同步单元格高亮 */
.yn-bem-cell-ai-date {
    background-color: #ecfdf5 !important;
    box-shadow: inset 0 0 0 1.5px #10b981 !important;
    position: relative;
}

.yn-bem-cell-ai-date .yn-bem-cell-date-input.is-ai-inferred {
    background-color: #ecfdf5 !important;
    color: #065f46 !important;
    font-weight: 600 !important;
    border-color: #10b981 !important;
    padding-right: 18px !important;
}

/* 超标说明微型拷贝按钮与单元格样式 */
.yn-bem-cell-copy-desc-btn {
    padding: 1px 4px;
    font-size: 11px;
    border: 1px solid #d1d5db;
    background: #f8fafc;
    border-radius: 3px;
    cursor: pointer;
    color: #2563eb;
    flex-shrink: 0;
    transition: all 0.15s ease;
    margin-left: 2px;
}
.yn-bem-cell-copy-desc-btn:hover {
    background: #eff6ff;
    border-color: #93c5fd;
    color: #1d4ed8;
}
.yn-bem-btn-copy-desc {
    transition: all 0.15s ease;
}
.yn-bem-btn-copy-desc:hover {
    background: #eff6ff !important;
    border-color: #93c5fd !important;
    color: #1d4ed8 !important;
}
.yn-bem-dyn-cell-over-standard {
    background-color: #fefce8 !important;
    border-left: 3px solid #f59e0b !important;
}


/* 业务日期下方提示徽章 */
.yn-bem-ai-date-badge {
    display: inline-block;
    font-size: 10px;
    color: #047857;
    font-weight: 600;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin-top: 2px;
    padding: 1px 5px;
    background: #d1fae5;
    border: 1px solid #a7f3d0;
    border-radius: 3px;
    white-space: nowrap;
}

/* 当整行被激活选中 (is-active-row) 时，AI推断单元格保留独特的淡绿与边框 */
.yn-bem-table tbody tr.is-active-row td.yn-bem-dyn-cell-ai,
.yn-bem-table tbody tr.is-active-row td.yn-bem-cell-ai-date {
    background-color: #d1fae5 !important;
    box-shadow: inset 0 0 0 1.5px #059669 !important;
}

/* 顶部融合操作条 AI 智能推断按钮 */
.yn-bem-btn-ai {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #000000;
    color: #ffffff;
    border: 1px solid #000000;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    padding: 3px 10px;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    height: 24px;
}
.yn-bem-btn-ai:hover {
    background: #262626;
    border-color: #262626;
}
.yn-bem-btn-ai:active {
    transform: scale(0.98);
}
.yn-bem-btn-ai:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
}
.yn-bem-btn-ai .spinner {
    width: 11px;
    height: 11px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: ynBemSpin 0.8s linear infinite;
    display: inline-block;
}
@keyframes ynBemSpin {
    to { transform: rotate(360deg); }
}

/* ==========================================================================
   AI 智能副驾技能体系与 Slash Command 指令集 (AI Skills & Slash Autocomplete)
   ========================================================================== */
.yn-gemini-composer-skill-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 20px;
    font-size: 11px;
    color: #1d4ed8;
    font-weight: 600;
    width: fit-content;
    user-select: none;
    animation: ynBemFadeIn 0.15s ease-out;
}
.yn-gemini-composer-skill-chip .yn-gemini-chip-dismiss {
    cursor: pointer;
    color: #93c5fd;
    font-size: 12px;
    line-height: 1;
    margin-left: 2px;
    transition: color 0.15s ease;
}
.yn-gemini-composer-skill-chip .yn-gemini-chip-dismiss:hover {
    color: #ef4444;
}

/* 输入框上方技能提示词与行程辅助指引横幅 */
.yn-gemini-skill-prompt-hint {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 3px solid #3b82f6;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.5;
    color: #475569;
    display: flex;
    flex-direction: column;
    gap: 4px;
    animation: ynBemFadeIn 0.15s ease-out;
}
.yn-gemini-skill-prompt-hint .hint-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #1e293b;
    font-weight: 600;
    font-size: 11px;
}
.yn-gemini-skill-prompt-hint .hint-header .btn-copy-template {
    border: 1px solid #cbd5e1;
    background: #ffffff;
    border-radius: 4px;
    padding: 2px 7px;
    font-size: 10px;
    color: #334155;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.15s ease;
}
.yn-gemini-skill-prompt-hint .hint-header .btn-copy-template:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
    color: #0f172a;
}
.yn-gemini-skill-prompt-hint .hint-text {
    font-size: 11px;
    color: #64748b;
    line-height: 1.45;
}
.yn-gemini-skill-prompt-hint .hint-text strong {
    color: #0f172a;
}

/* Composer 底部技能按钮 (⚡ 技能 ▾) */
.yn-gemini-skill-select-wrapper {
    position: relative;
    display: inline-flex;
}
.yn-gemini-btn-skill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 9px;
    border-radius: 13px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    color: #475569;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
}
.yn-gemini-btn-skill:hover {
    background: #f1f5f9;
    color: #1d4ed8;
    border-color: #93c5fd;
}
.yn-gemini-btn-skill.is-active {
    background: #eff6ff;
    color: #1d4ed8;
    border-color: #3b82f6;
}

/* 技能选择下拉菜单 */
.yn-gemini-skill-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    width: 290px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: ynBemFadeIn 0.15s ease-out;
}
.yn-gemini-skill-menu.is-hidden {
    display: none !important;
}
.yn-gemini-skill-menu-header {
    padding: 7px 10px;
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    background: #f8fafc;
    border-bottom: 1px solid #f1f5f9;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.yn-gemini-skill-menu-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    border-bottom: 1px solid #f8fafc;
    transition: background-color 0.12s ease;
}
.yn-gemini-skill-menu-item:last-child {
    border-bottom: none;
}
.yn-gemini-skill-menu-item:hover,
.yn-gemini-skill-menu-item.is-selected {
    background: #f1f5f9;
}
.yn-gemini-skill-menu-item .skill-icon {
    font-size: 14px;
    line-height: 1.2;
    flex-shrink: 0;
    margin-top: 1px;
}
.yn-gemini-skill-menu-item .skill-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
}
.yn-gemini-skill-menu-item .skill-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
}
.yn-gemini-skill-menu-item .skill-name {
    font-size: 11px;
    font-weight: 600;
    color: #0f172a;
}
.yn-gemini-skill-menu-item .skill-cmd {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    color: #2563eb;
    background: #eff6ff;
    padding: 1px 4px;
    border-radius: 3px;
}
.yn-gemini-skill-menu-item .skill-desc {
    font-size: 10px;
    color: #64748b;
    line-height: 1.35;
    white-space: normal;
}

/* 输入框键入 '/' 触发的 Slash Command 自动补全浮层 */
.yn-gemini-slash-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 8px;
    right: 8px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.16), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    z-index: 1050;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-height: 250px;
    overflow-y: auto;
    animation: ynBemFadeIn 0.12s ease-out;
}
.yn-gemini-slash-menu.is-hidden {
    display: none !important;
}
.yn-gemini-slash-menu-header {
    padding: 6px 10px;
    font-size: 10px;
    font-weight: 700;
    color: #475569;
    background: #f1f5f9;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.yn-gemini-slash-menu-header .slash-hint {
    font-weight: normal;
    color: #64748b;
    font-size: 9px;
}
.yn-gemini-slash-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    cursor: pointer;
    border-bottom: 1px solid #f8fafc;
    transition: background-color 0.1s ease;
}
.yn-gemini-slash-menu-item:last-child {
    border-bottom: none;
}
.yn-gemini-slash-menu-item:hover,
.yn-gemini-slash-menu-item.is-selected {
    background: #eff6ff;
}
.yn-gemini-slash-menu-item.is-selected .skill-name {
    color: #1d4ed8;
}
.yn-gemini-slash-menu-item .skill-icon {
    font-size: 13px;
    line-height: 1;
}
.yn-gemini-slash-menu-item .skill-cmd {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    font-weight: 600;
    color: #2563eb;
    background: #dbeafe;
    padding: 1px 4px;
    border-radius: 3px;
}
.yn-gemini-slash-menu-item .skill-name {
    font-size: 11px;
    font-weight: 600;
    color: #1e293b;
}
.yn-gemini-slash-menu-item .skill-desc {
    font-size: 10px;
    color: #64748b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-left: auto;
}

/* ============================================================ */
/* 出差排期 Trip 区间识别与主动推荐卡片 (Ground Truth Recommendation) */
/* ============================================================ */
.yn-bem-itin-rec-card {
    display: none;
    margin-top: 10px;
    padding: 10px 12px;
    background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
    border: 1px solid #86efac;
    border-radius: 6px;
    font-size: 12px;
    animation: ynBemFadeIn 0.2s ease;
}
.yn-bem-itin-rec-card.is-visible {
    display: block;
}
.yn-bem-itin-rec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}
.yn-bem-itin-rec-title {
    font-size: 12px;
    font-weight: 600;
    color: #166534;
    display: flex;
    align-items: center;
    gap: 6px;
}
.yn-bem-itin-rec-badge {
    display: inline-block;
    padding: 1px 6px;
    font-size: 10px;
    font-weight: 700;
    border-radius: 10px;
    background: #22c55e;
    color: #ffffff;
}
.yn-bem-itin-rec-list {
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 10px;
    padding-right: 4px;
}
.yn-bem-itin-rec-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: #ffffff;
    border: 1px solid #bbf7d0;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 11px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.yn-bem-itin-rec-item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.yn-bem-itin-rec-item-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.yn-bem-itin-rec-item-no {
    font-weight: 700;
    color: #047857;
    background: #d1fae5;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;
}
.yn-bem-itin-rec-item-dates {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 600;
    color: #1e293b;
    font-size: 11px;
}
.yn-bem-itin-rec-item-dest {
    font-weight: 700;
    color: #0369a1;
    background: #e0f2fe;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
}
.yn-bem-itin-rec-item-trans {
    font-weight: 600;
    color: #475569;
    background: #f1f5f9;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
}
.yn-bem-itin-rec-item-details {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    color: #475569;
    font-size: 11px;
    padding-top: 4px;
    border-top: 1px dashed #dcfce7;
}
.yn-bem-itin-rec-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #334155;
}
.yn-bem-itin-rec-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 8px;
    border-top: 1px dashed #bbf7d0;
}
.yn-bem-itin-rec-checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: #15803d;
    cursor: pointer;
    user-select: none;
}
.yn-bem-itin-rec-checkbox-label input[type="checkbox"] {
    cursor: pointer;
    accent-color: #16a34a;
    width: 14px;
    height: 14px;
}
.yn-bem-itin-rec-hint {
    font-size: 10px;
    color: #4b5563;
}

/* ============================================================ */
/* 多级分组展示、纯 CSS 折叠与单据流向 Tag 样式系统 (Vercel 质感) */
/* ============================================================ */

/* 分组表头容器与行 (现代视口外剔除优化，极大释放主线程渲染负载) */
.yn-bem-group-tbody {
    border-bottom: 2px solid #e5e7eb;
    content-visibility: auto;
    contain-intrinsic-size: 0 42px;
}
.yn-bem-group-header-row {
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    border-bottom: 1px solid #cbd5e1;
    user-select: none;
}
.yn-bem-group-header-cell {
    padding: 8px 16px !important;
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
    position: sticky;
    left: 0;
    z-index: 10;
}
.yn-bem-group-header-content {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    width: 100%;
}

/* 折叠/展开箭头 */
.yn-bem-group-toggle-btn {
    background: none;
    border: none;
    font-size: 12px;
    cursor: pointer;
    color: #64748b;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: transform 0.15s ease, color 0.15s ease, background 0.15s ease;
    padding: 0;
}
.yn-bem-group-toggle-btn:hover {
    background: #e2e8f0;
    color: #0f172a;
}
.yn-bem-group-tbody.is-collapsed .yn-bem-group-toggle-btn {
    transform: rotate(-90deg);
}

/* 核心折叠规则：极速纯 CSS 隐藏，绝不销毁 DOM 节点 */
.yn-bem-group-tbody.is-collapsed tr.yn-bem-data-row {
    display: none !important;
}

/* 分组复选框 */
.yn-bem-group-cb {
    cursor: pointer;
    width: 15px;
    height: 15px;
    accent-color: #0f172a;
    margin: 0 4px 0 0;
}

/* 分组标题与徽章 */
.yn-bem-group-title {
    font-size: 13px;
    font-weight: 600;
    color: #0f172a;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.yn-bem-group-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    color: #475569;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.yn-bem-group-amount {
    margin-left: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
    background: #e2e8f0;
    padding: 2px 8px;
    border-radius: 4px;
}

/* Trip 草稿已创建标识 */
.yn-bem-trip-created-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    color: #059669;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* 二级子分组头 (Trip + 费用类型) */
.yn-bem-subgroup-header-row {
    background: #fdfdfd;
    border-bottom: 1px dashed #cbd5e1;
}
.yn-bem-subgroup-header-cell {
    padding: 6px 16px 6px 36px !important;
    font-size: 12px;
    font-weight: 600;
    color: #475569;
}

/* 单据流向徽章 (BC vs BJ) */
.yn-bem-tag-bc {
    display: inline-flex;
    align-items: center;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    white-space: nowrap;
}
.yn-bem-tag-bj {
    display: inline-flex;
    align-items: center;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    background: #f0fdf4;
    color: #15803d;
    border: 1px solid #bbf7d0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    white-space: nowrap;
}

/* 错配智能微纠错灯泡 */
.yn-bem-type-misclass-bulb {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    font-size: 11px;
    color: #b45309;
    background: #fffbeb;
    border: 1px solid #fde68a;
    padding: 1px 4px;
    border-radius: 3px;
    margin-left: 4px;
    transition: all 0.15s ease;
}
.yn-bem-type-misclass-bulb:hover {
    background: #fef3c7;
    transform: scale(1.04);
}

/* 顶部 AI 端到端指挥舱 */
.yn-bem-autopilot-command-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    width: 100%;
    box-sizing: border-box;
}
.yn-bem-autopilot-input {
    flex: 1;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 12px;
    color: #0f172a;
    background: #ffffff;
    outline: none;
    transition: all 0.15s ease;
}
.yn-bem-autopilot-input:focus {
    border-color: #0f172a;
    box-shadow: 0 0 0 1px #0f172a;
}
.yn-bem-btn-autopilot {
    background: #0f172a;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s ease;
    white-space: nowrap;
}
.yn-bem-btn-autopilot:hover {
    background: #1e293b;
    transform: translateY(-1px);
}

/* ============================================================ */
/* 全景报销决策复核与极速建单看板 (HITL Dashboard Overlay) */
/* ============================================================ */
.yn-bem-decision-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(5px);
    z-index: 1000002;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: ynBemFadeIn 0.2s ease-out;
}
.yn-bem-decision-modal {
    background: #ffffff;
    width: 960px;
    max-width: 95vw;
    max-height: 90vh;
    border-radius: 12px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #0f172a;
    border: 1px solid #e2e8f0;
    animation: ynBemScaleUp 0.2s ease-out;
}
.yn-bem-decision-modal-header {
    padding: 16px 24px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #ffffff;
}
.yn-bem-decision-modal-title,
.yn-bem-decision-modal-header .title {
    font-size: 16px;
    font-weight: 700;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 4px 0;
}
.yn-bem-decision-modal-header .subtitle {
    font-size: 12px;
    color: #64748b;
    margin: 0;
}
.yn-bem-decision-modal-close {
    background: transparent;
    border: none;
    font-size: 18px;
    color: #94a3b8;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.15s ease;
}
.yn-bem-decision-modal-close:hover {
    color: #0f172a;
    background: #f1f5f9;
}
.yn-bem-decision-modal-body {
    padding: 20px 24px;
    overflow-y: auto;
    flex: 1;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.yn-bem-dashboard-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    transition: all 0.15s ease;
}
.yn-bem-dashboard-card:hover {
    border-color: #cbd5e1;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.08);
}
.yn-bem-dashboard-card.is-focused {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}
.yn-bem-dashboard-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid #f1f5f9;
}
.yn-bem-dashboard-card-title {
    font-size: 14px;
    font-weight: 700;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
}
.yn-bem-badge-trip {
    background: #0f172a;
    color: #ffffff;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
}
.yn-bem-dashboard-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px 16px;
    margin-bottom: 12px;
    font-size: 12px;
}
.yn-bem-dashboard-field {
    display: flex;
    align-items: baseline;
    gap: 8px;
}
.yn-bem-dashboard-field .label {
    color: #64748b;
    font-weight: 500;
    white-space: nowrap;
    min-width: 80px;
}
.yn-bem-dashboard-field .val {
    color: #1e293b;
    font-weight: 500;
    word-break: break-all;
}
.yn-bem-dashboard-budget-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    background: #f8fafc;
    border: 1px solid #f1f5f9;
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 10px;
}
.yn-bem-budget-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.yn-bem-budget-item .b-label {
    font-size: 10px;
    color: #64748b;
}
.yn-bem-budget-item .b-val {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.yn-bem-decision-modal-footer {
    padding: 14px 24px;
    border-top: 1px solid #e2e8f0;
    background: #ffffff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
}
.yn-bem-dashboard-status {
    font-size: 12px;
    color: #64748b;
    flex: 1;
}
.yn-bem-btn-autopilot-execute {
    background: linear-gradient(135deg, #059669 0%, #047857 100%);
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.15s ease;
    box-shadow: 0 2px 4px rgba(5, 150, 105, 0.25);
}
.yn-bem-btn-autopilot-execute:hover {
    background: linear-gradient(135deg, #047857 0%, #065f46 100%);
    transform: translateY(-1px);
    box-shadow: 0 4px 6px rgba(5, 150, 105, 0.35);
}
.yn-bem-btn-autopilot-execute:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
}

/* 组表头 Trip 编辑微按钮 */
.yn-bem-btn-trip-edit {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    color: #334155;
    cursor: pointer;
    margin-left: 8px;
    transition: all 0.15s ease;
}
.yn-bem-btn-trip-edit:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
    color: #0f172a;
}

/* Trip 深度编辑模态框 */
#yn-bem-edit-trip-mask {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(4px);
    z-index: 1000003;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: ynBemFadeIn 0.2s ease-out;
}
.yn-bem-edit-trip-card {
    background: #ffffff;
    width: 680px;
    max-width: 95vw;
    max-height: 90vh;
    border-radius: 10px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #e2e8f0;
}
.yn-bem-edit-trip-header {
    padding: 14px 20px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.yn-bem-edit-trip-title {
    font-size: 15px;
    font-weight: 700;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
}
.yn-bem-edit-trip-body {
    padding: 18px 20px;
    overflow-y: auto;
    flex: 1;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.yn-bem-form-row {
    display: flex;
    gap: 12px;
}
.yn-bem-form-group {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.yn-bem-form-label {
    font-size: 11px;
    font-weight: 600;
    color: #475569;
}
.yn-bem-form-input, .yn-bem-form-textarea {
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 12px;
    color: #0f172a;
    background: #ffffff;
    outline: none;
    transition: all 0.15s ease;
}
.yn-bem-form-input:focus, .yn-bem-form-textarea:focus {
    border-color: #0f172a;
    box-shadow: 0 0 0 1px #0f172a;
}
.yn-bem-edit-trip-footer {
    padding: 12px 20px;
    border-top: 1px solid #e2e8f0;
    background: #ffffff;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
}

/* ==========================================================================
   全新架构：精简双行顶栏 + 批量设置下拉面板 + Gemini 风格 AI 助手侧边栏
   ========================================================================== */

/* 模态框主体内容自适应容器 (当 AI 助手展开时平滑添加右侧 margin，杜绝遮挡) */
.yn-bem-modal-main-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: calc(100vh - 46px);
    min-height: 0;
    overflow: hidden;
    transition: margin-right 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    position: relative;
}

/* 主工作区弹性分栏容器 */
.yn-bem-main-layout {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
    position: relative;
}

/* 表格包裹区自适应宽度 */
.yn-bem-main-layout .yn-bem-table-wrap {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: auto;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 顶部操作区按钮美化 (coss.com/ui 风格) */
.yn-bem-btn-toggle-settings, .yn-bem-btn-toggle-ai {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    height: 28px;
    border-radius: var(--coss-radius-sm);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    box-sizing: border-box;
    outline: none;
    border: 1px solid var(--coss-border);
    background: var(--coss-bg-base);
    color: var(--coss-fg-default);
    box-shadow: var(--coss-shadow-xs);
    transition: transform 100ms var(--coss-ease),
                background-color 120ms var(--coss-ease),
                border-color 120ms var(--coss-ease),
                box-shadow 120ms var(--coss-ease);
}
.yn-bem-btn-toggle-settings:active:not(:disabled),
.yn-bem-btn-toggle-ai:active:not(:disabled) {
    transform: scale(0.98);
}
.yn-bem-btn-toggle-settings:focus-visible,
.yn-bem-btn-toggle-ai:focus-visible {
    box-shadow: 0 0 0 2px var(--coss-bg-base), 0 0 0 4px var(--coss-ring);
}
.yn-bem-btn-toggle-settings:hover {
    background: var(--coss-bg-surface);
    border-color: var(--coss-border-hover);
}
.yn-bem-btn-toggle-settings.is-active {
    background: var(--coss-primary);
    color: var(--coss-primary-fg);
    border-color: var(--coss-primary);
    box-shadow: var(--coss-shadow-xs), inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.yn-bem-btn-toggle-ai {
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    border-color: #cbd5e1;
    color: #0f172a;
}
.yn-bem-btn-toggle-ai:hover {
    background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
    border-color: #94a3b8;
    box-shadow: var(--coss-shadow-sm);
}
.yn-bem-btn-toggle-ai.is-active {
    background: linear-gradient(135deg, #18181b 0%, #09090b 100%);
    color: #ffffff;
    border-color: #18181b;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}

/* ==========================================================================
   现代底部悬浮操作岛 (Floating Action Island - Linear/Stripe Grade)
   ========================================================================== */
.yn-bem-floating-island {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(0);
    background: rgba(24, 24, 27, 0.94);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: var(--coss-radius-full);
    box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08);
    padding: 6px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    color: #ffffff;
    z-index: 9999;
    transition: transform 200ms var(--coss-ease), opacity 200ms var(--coss-ease);
}
.yn-bem-floating-island.is-hidden {
    transform: translateX(-50%) translateY(30px);
    opacity: 0;
    pointer-events: none;
}
.yn-bem-island-stat {
    font-size: 12px;
    font-weight: 500;
    color: #e4e4e7;
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 4px;
}
.yn-bem-island-stat strong {
    color: #ffffff;
    font-family: var(--coss-font-mono);
}
.yn-bem-island-stat .island-amount {
    color: #60a5fa;
    font-weight: 700;
}
.yn-bem-island-divider {
    width: 1px;
    height: 16px;
    background: rgba(255, 255, 255, 0.2);
}
.yn-bem-island-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 11px;
    height: 28px;
    border-radius: var(--coss-radius-full);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
    outline: none;
    transition: transform 100ms var(--coss-ease), background 120ms var(--coss-ease);
    user-select: none;
    white-space: nowrap;
}
.yn-bem-island-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.35);
}
.yn-bem-island-btn:active {
    transform: scale(0.96);
}
.yn-bem-island-btn-primary {
    background: #ffffff;
    color: #09090b;
    border-color: #ffffff;
    font-weight: 600;
}
.yn-bem-island-btn-primary:hover {
    background: #f4f4f5;
    border-color: #f4f4f5;
}
.yn-bem-island-btn-ai {
    background: linear-gradient(135deg, rgba(66, 133, 244, 0.35) 0%, rgba(155, 114, 203, 0.35) 100%);
    border-color: rgba(155, 114, 203, 0.5);
    color: #ffffff;
}
.yn-bem-island-btn-ai:hover {
    background: linear-gradient(135deg, rgba(66, 133, 244, 0.55) 0%, rgba(155, 114, 203, 0.55) 100%);
    border-color: rgba(155, 114, 203, 0.8);
}

/* ==========================================================================
   居中专注批量设置弹窗 (Dedicated Batch Settings Modal Dialog)
   ========================================================================== */
.yn-bem-batch-dialog-mask {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 1000005;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: ynFadeIn 0.15s var(--coss-ease);
}
.yn-bem-batch-dialog {
    background: var(--coss-bg-base);
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-lg);
    box-shadow: var(--coss-shadow-popover);
    width: 720px;
    max-width: 92vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--coss-fg-default);
    animation: ynScaleIn 0.15s var(--coss-ease);
}
@keyframes ynScaleIn {
    from { opacity: 0; transform: scale(0.97); }
    to { opacity: 1; transform: scale(1); }
}
.yn-bem-dialog-header {
    padding: 14px 20px;
    border-bottom: 1px solid var(--coss-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--coss-bg-surface);
}
.yn-bem-dialog-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--coss-fg-default);
    display: flex;
    align-items: center;
    gap: 8px;
}
.yn-bem-dialog-body {
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.yn-bem-dialog-section {
    background: var(--coss-bg-surface);
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-md);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.yn-bem-dialog-section-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--coss-fg-default);
    display: flex;
    align-items: center;
    gap: 6px;
}
.yn-bem-dialog-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--coss-border);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    background: var(--coss-bg-surface);
}

/* 行程与证据明细微胶囊 (Itinerary Route Capsule) */
.yn-bem-route-capsule {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--coss-bg-muted);
    border: 1px solid var(--coss-border);
    padding: 3px 8px;
    border-radius: var(--coss-radius-xs);
    font-size: 11px;
    color: var(--coss-fg-default);
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: background 120ms var(--coss-ease), border-color 120ms var(--coss-ease);
}
.yn-bem-route-capsule:hover {
    background: var(--coss-bg-surface);
    border-color: var(--coss-border-hover);
}
.yn-bem-route-arrow {
    color: var(--coss-fg-subtle);
    font-size: 10px;
}
.yn-bem-desc-input {
    width: 100%;
    height: 100%;
    min-height: 34px;
    border: 1px solid transparent;
    border-radius: 0 !important;
    padding: 0 8px;
    font-size: 12px;
    background: transparent;
    color: var(--coss-fg-default);
    box-sizing: border-box;
    outline: none;
    display: block;
}
.yn-bem-desc-input:hover {
    background: rgba(0, 0, 0, 0.02);
}
.yn-bem-desc-input:focus {
    outline: none !important;
    border-color: #2563eb !important;
    background: #ffffff !important;
    box-shadow: inset 0 0 0 2px #2563eb !important;
    z-index: 3;
    position: relative;
}

/* AI 智能副驾悬浮抽屉容器 (位于顶栏下方 top: 46px，从右侧硬件加速平滑滑入/滑出，零主表格挤压与布局偏移) */
#yn-bem-ai-panel-wrap {
    position: fixed;
    top: 46px;
    right: 0;
    bottom: 0;
    height: calc(100vh - 46px);
    z-index: 9999;
    display: flex;
    flex-direction: row;
    box-shadow: -12px 0 36px rgba(0, 0, 0, 0.18), -2px 0 8px rgba(0, 0, 0, 0.08);
    background: var(--coss-bg-base);
    transform: translate3d(100%, 0, 0);
    transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.28s ease;
    visibility: hidden;
    pointer-events: none;
    will-change: transform;
}
#yn-bem-ai-panel-wrap.is-open {
    transform: translate3d(0, 0, 0);
    visibility: visible;
    pointer-events: auto;
}

.yn-bem-ai-panel {
    width: 100%;
    height: 100%;
    background: var(--coss-bg-base);
    border-left: 1px solid var(--coss-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
}

/* AI 助手侧边栏左边缘拖拽把手 (自由调整宽度) */
.yn-bem-ai-resizer {
    position: absolute;
    left: -4px;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: col-resize;
    z-index: 1000000;
    user-select: none;
    transition: background-color 0.15s ease;
}
.yn-bem-ai-resizer:hover,
.yn-bem-ai-resizer.is-resizing {
    background: #2563eb;
    box-shadow: 0 0 6px rgba(37, 99, 235, 0.5);
}
@keyframes ynBemSlideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

.yn-bem-ai-panel-header {
    padding: 14px 18px;
    border-bottom: 1px solid var(--coss-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.yn-bem-ai-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--coss-fg-default);
    letter-spacing: -0.01em;
}
.yn-gemini-sparkle-icon {
    font-size: 18px;
    background: linear-gradient(135deg, #4285F4, #9B72CB, #D96570, #F4B400);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    display: inline-block;
    animation: ynSparklePulse 3s infinite ease-in-out;
}
@keyframes ynSparklePulse {
    0%, 100% { transform: scale(1) rotate(0deg); }
    50% { transform: scale(1.15) rotate(15deg); }
}

.yn-bem-ai-panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    background: linear-gradient(180deg, var(--coss-bg-surface) 0%, var(--coss-bg-base) 100%);
}

.yn-gemini-center-logo {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    margin-bottom: 6px;
}
.yn-gemini-center-logo .sparkle-big {
    font-size: 38px;
    background: linear-gradient(135deg, #4285F4 0%, #9B72CB 35%, #D96570 70%, #F4B400 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}
.yn-gemini-center-logo .greeting-text {
    font-size: 20px;
    font-weight: 600;
    color: var(--coss-fg-default);
    letter-spacing: -0.02em;
}

/* Gemini Suggestion Chips (coss.com/ui Pill Button Pattern) */
.yn-gemini-chips-container {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.yn-gemini-chip-btn {
    width: 100%;
    background: var(--coss-bg-base);
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-full);
    padding: 9px 16px;
    text-align: left;
    font-size: 13px;
    font-weight: 500;
    color: var(--coss-fg-default);
    cursor: pointer;
    box-shadow: var(--coss-shadow-xs);
    outline: none;
    transition: transform 100ms var(--coss-ease),
                background-color 120ms var(--coss-ease),
                border-color 120ms var(--coss-ease),
                box-shadow 120ms var(--coss-ease);
    display: flex;
    align-items: center;
    gap: 10px;
}
.yn-gemini-chip-btn:hover {
    background: var(--coss-bg-surface);
    border-color: var(--coss-border-hover);
    color: var(--coss-primary);
    transform: translateY(-1px);
    box-shadow: var(--coss-shadow-sm);
}
.yn-gemini-chip-btn:active {
    transform: scale(0.98);
    box-shadow: var(--coss-shadow-xs);
}
.yn-gemini-chip-btn:focus-visible {
    box-shadow: 0 0 0 2px var(--coss-bg-base), 0 0 0 4px var(--coss-ring);
}
.yn-gemini-chip-btn .chip-icon {
    font-size: 15px;
    flex-shrink: 0;
}

/* 上下文数据药丸徽章 (Context Pill) */
.yn-gemini-context-pill {
    width: 100%;
    background: var(--coss-success-bg);
    border: 1px solid rgba(5, 150, 105, 0.25);
    border-radius: var(--coss-radius-md);
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--coss-success);
    box-shadow: var(--coss-shadow-xs);
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.yn-gemini-context-pill.has-no-selection {
    background: var(--coss-bg-muted);
    border-color: var(--coss-border);
    color: var(--coss-fg-subtle);
}

/* AI 结果/状态消息卡片流 */
.yn-gemini-feed-stream {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.yn-gemini-feed-card {
    background: var(--coss-bg-base);
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-md);
    padding: 12px 14px;
    font-size: 12px;
    color: var(--coss-fg-default);
    box-shadow: var(--coss-shadow-xs);
    animation: ynBemFadeIn 0.2s ease-out;
}
.yn-gemini-feed-card.success {
    border-left: 3px solid var(--coss-success);
}
.yn-gemini-feed-card.info {
    border-left: 3px solid var(--coss-info);
}
.yn-gemini-feed-card.warn {
    border-left: 3px solid var(--coss-warning);
}

/* 彻底隐藏宿主或全局悬浮副驾坞，杜绝遮挡 */
#autopilot-floating-dock {
    display: none !important;
}

/* Gemini AI 助手面板头部会话历史菜单 (Screenshot 4) */
.yn-gemini-header-right {
    display: flex;
    align-items: center;
    gap: 6px;
    position: relative;
}
.yn-gemini-menu-trigger {
    background: transparent;
    border: 1px solid var(--coss-border);
    border-radius: var(--coss-radius-sm);
    color: var(--coss-fg-muted);
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 120ms var(--coss-ease);
}
.yn-gemini-menu-trigger:hover {
    background: var(--coss-bg-surface);
    color: var(--coss-fg-default);
    border-color: var(--coss-border-hover);
}
.yn-gemini-history-dropdown {
    position: absolute;
    top: 32px;
    right: 0;
    width: 240px;
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.14);
    z-index: 1000;
    padding: 6px 0;
    display: flex;
    flex-direction: column;
    animation: ynBemFadeIn 0.15s ease-out;
}
.yn-gemini-history-dropdown.is-hidden {
    display: none !important;
}
.yn-gemini-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    font-size: 12px;
    color: #1e293b;
    cursor: pointer;
    text-decoration: none;
    transition: background 100ms ease;
    user-select: none;
}
.yn-gemini-menu-item:hover {
    background: #f1f5f9;
}
.yn-gemini-menu-item.is-active {
    background: #eff6ff;
    color: #2563eb;
    font-weight: 600;
}
.yn-gemini-menu-divider {
    height: 1px;
    background: #e2e8f0;
    margin: 4px 0;
}
.yn-gemini-menu-header {
    padding: 4px 14px;
    font-size: 10px;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.yn-gemini-history-list {
    max-height: 180px;
    overflow-y: auto;
}

/* 连续多轮对话气泡流 (Multi-turn Chat Feed) */
.yn-gemini-chat-msg {
    display: flex;
    flex-direction: column;
    margin-bottom: 14px;
    animation: ynBemFadeIn 0.15s ease-out;
}
.yn-gemini-chat-msg.user {
    align-items: flex-end;
}
.yn-gemini-chat-msg.assistant {
    align-items: flex-start;
}
.yn-gemini-msg-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: #94a3b8;
    margin-bottom: 4px;
}
.yn-gemini-msg-bubble-user {
    background: #f1f5f9;
    color: #0f172a;
    border-radius: 14px 14px 2px 14px;
    padding: 8px 12px;
    font-size: 12px;
    max-width: 88%;
    word-break: break-word;
    border: 1px solid #e2e8f0;
}
.yn-gemini-msg-bubble-assistant {
    background: #ffffff;
    color: #0f172a;
    border-radius: 14px 14px 14px 2px;
    padding: 10px 14px;
    font-size: 12px;
    max-width: 92%;
    word-break: break-word;
    border: 1px solid #e2e8f0;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
}

/* 底部 Gemini 风格复合输入卡片 (Gemini Composer Card - Screenshot 3) */
.yn-bem-ai-panel-footer {
    padding: 10px 14px 14px;
    border-top: 1px solid var(--coss-border);
    background: var(--coss-bg-base);
}
.yn-gemini-composer-card {
    background: #ffffff;
    border: 1px solid #d4d4d8;
    border-radius: 16px;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.06);
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    gap: 6px;
    transition: all 0.15s ease;
}
.yn-gemini-composer-card.is-dragover {
    border-color: #2563eb !important;
    background: #f8faff !important;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25) !important;
}
.yn-gemini-composer-card:focus-within {
    border-color: #2563eb;
    box-shadow: 0 4px 16px rgba(37, 99, 235, 0.12);
}

/* 顶部上下文携带胶囊与附件流 */
.yn-gemini-composer-header {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.yn-gemini-composer-context-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 20px;
    font-size: 11px;
    color: #334155;
    font-weight: 500;
    width: fit-content;
    user-select: none;
}
.yn-gemini-chip-dismiss {
    cursor: pointer;
    color: #94a3b8;
    font-size: 12px;
    line-height: 1;
    margin-left: 2px;
}
.yn-gemini-chip-dismiss:hover {
    color: #ef4444;
}

/* 附件缩略卡片流 */
.yn-gemini-attachment-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.yn-gemini-attachment-doc {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 11px;
    color: #1e293b;
    max-width: 180px;
    position: relative;
}
.yn-gemini-attachment-doc .doc-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.yn-gemini-attachment-img-wrap {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #e2e8f0;
    cursor: pointer;
}
.yn-gemini-attachment-img-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.yn-gemini-attachment-del {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 16px;
    height: 16px;
    background: rgba(0, 0, 0, 0.6);
    color: #ffffff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    cursor: pointer;
    line-height: 1;
}
.yn-gemini-attachment-del:hover {
    background: #ef4444;
}

/* 输入框本体 */
.yn-gemini-composer-textarea {
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    font-size: 12px;
    color: #0f172a;
    font-family: inherit;
    background: transparent;
    padding: 2px 0;
    min-height: 28px;
    max-height: 100px;
}
.yn-gemini-composer-textarea::placeholder {
    color: #94a3b8;
}

/* Composer 底部操作栏 */
.yn-gemini-composer-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 4px;
}
.yn-gemini-btn-add {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    color: #64748b;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
    line-height: 1;
}
.yn-gemini-btn-add:hover {
    background: #f1f5f9;
    color: #0f172a;
    border-color: #cbd5e1;
}
.yn-gemini-composer-right-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}
.yn-gemini-model-select {
    appearance: none;
    -webkit-appearance: none;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 2px 10px;
    font-size: 11px;
    font-weight: 600;
    color: #475569;
    cursor: pointer;
    outline: none;
    transition: all 0.15s ease;
}
.yn-gemini-model-select:hover {
    background: #e2e8f0;
    color: #1e293b;
}
.yn-gemini-composer-send-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: #2563eb;
    color: #ffffff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 700;
    transition: transform 100ms ease, background-color 120ms ease;
    padding: 0;
    line-height: 1;
}
.yn-gemini-composer-send-btn:hover:not(:disabled) {
    background: #1d4ed8;
    transform: scale(1.06);
}
.yn-gemini-composer-send-btn:active:not(:disabled) {
    transform: scale(0.92);
}
.yn-gemini-composer-send-btn:disabled {
    background: #cbd5e1;
    cursor: not-allowed;
}

/* 大图预览 Lightbox 模态浮层 */
.yn-gemini-lightbox-mask {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    z-index: 1000000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: ynBemFadeIn 0.15s ease-out;
}
.yn-gemini-lightbox-content {
    position: relative;
    max-width: 85vw;
    max-height: 85vh;
}
.yn-gemini-lightbox-content img {
    max-width: 85vw;
    max-height: 85vh;
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
    object-fit: contain;
}
.yn-gemini-lightbox-close {
    position: absolute;
    top: -14px;
    right: -14px;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #ffffff;
    color: #0f172a;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

/* ==========================================================================
   保存失败视觉指示器与高亮系统 (Save Error Feedback System)
   ========================================================================== */
.yn-bem-data-row.is-save-error {
    background-color: #fef2f2 !important;
}
.yn-bem-data-row.is-save-error td {
    background-color: #fef2f2 !important;
    border-top: 1px solid #fca5a5 !important;
    border-bottom: 1px solid #fca5a5 !important;
}
.yn-bem-data-row.is-save-error td.yn-bem-col-sticky-cb {
    border-left: 4px solid #dc2626 !important;
}
.yn-bem-save-error-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    border-radius: 4px;
    background: #dc2626;
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    margin-top: 4px;
    cursor: help;
    white-space: nowrap;
    box-shadow: 0 1px 3px rgba(220, 38, 38, 0.3);
}
.yn-bem-row-error-hint {
    margin-top: 4px;
    font-size: 11px;
    color: #991b1b;
    background: #fee2e2;
    padding: 3px 6px;
    border-radius: 4px;
    border: 1px solid #f87171;
    line-height: 1.35;
    word-break: break-all;
    font-weight: 500;
    display: flex;
    align-items: flex-start;
    gap: 4px;
}
.yn-bem-dyn-cell-inner .yn-bem-dyn-input.has-save-error,
td.has-save-error {
    border: 2px solid #dc2626 !important;
    background-color: #fff1f2 !important;
    box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.25) !important;
}
.yn-host-expense-error-row {
    border-left: 4px solid #dc2626 !important;
    background-color: #fff5f5 !important;
}
.yn-host-expense-error-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border-radius: 3px;
    background: #fee2e2;
    border: 1px solid #fca5a5;
    color: #b91c1c;
    font-size: 11px;
    font-weight: 600;
    margin-left: 6px;
}
`;
