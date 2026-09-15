import { getMarkstreamCss } from './markdownRenderer';

/**
 * assistant-ui 现代费控智能副驾组件系统样式表
 * 融合 assistant-ui 与 Vercel / Apple HIG 质感规范
 * 包含：Thinking 深度思考折叠手风琴、ToolCall 工具执行卡片、高质感 Markdown 表格与流式 Composer
 */
export const ASSISTANT_UI_STYLES = `
/* 引入 markstream-react 官方核心流式渲染样式 */
${getMarkstreamCss()}

/* ==========================================================================
   assistant-ui Root Thread 容器与视口
   ========================================================================== */
.aui-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--coss-bg-base, #ffffff);
    color: var(--coss-fg-default, #09090b);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    position: relative;
    overflow: hidden;
}

.aui-thread-viewport {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    scroll-behavior: smooth;
    background: linear-gradient(180deg, #fafafa 0%, #ffffff 100%);
}

.aui-thread-viewport::-webkit-scrollbar {
    width: 5px;
}
.aui-thread-viewport::-webkit-scrollbar-track {
    background: transparent;
}
.aui-thread-viewport::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.12);
    border-radius: 4px;
}
.aui-thread-viewport::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.22);
}

/* ==========================================================================
   Empty State 空白欢迎状态与 Suggestion Chips
   ========================================================================== */
.aui-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    margin: auto 0;
    padding: 24px 8px;
    text-align: center;
    animation: auiFadeIn 0.3s ease-out;
}

.aui-sparkle-logo {
    width: 54px;
    height: 54px;
    border-radius: 16px;
    background: linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%);
    border: 1px solid #bfdbfe;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 14px;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.08);
}
.aui-sparkle-logo .sparkle-char {
    font-size: 28px;
    background: linear-gradient(135deg, #2563eb, #7c3aed, #db2777);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    display: inline-block;
    animation: auiPulse 3s infinite ease-in-out;
}

.aui-empty-title {
    font-size: 18px;
    font-weight: 600;
    color: #0f172a;
    letter-spacing: -0.02em;
    margin-bottom: 6px;
}

.aui-empty-subtitle {
    font-size: 12px;
    color: #64748b;
    max-width: 320px;
    line-height: 1.5;
    margin-bottom: 20px;
}

.aui-suggestions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
    width: 100%;
    max-width: 720px;
}

.aui-suggestion-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}
.aui-suggestion-card:hover {
    border-color: #2563eb;
    background: #f8faff;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.08);
}
.aui-suggestion-card:active {
    transform: scale(0.99);
}
.aui-suggestion-icon {
    font-size: 18px;
    flex-shrink: 0;
}
.aui-suggestion-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
}
.aui-suggestion-text .title {
    font-size: 12px;
    font-weight: 600;
    color: #1e293b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.aui-suggestion-text .desc {
    font-size: 11px;
    color: #64748b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ==========================================================================
   Message Rows 消息行布局
   ========================================================================== */
.aui-message-row {
    display: flex;
    flex-direction: column;
    width: 100%;
    animation: auiFadeIn 0.2s ease-out;
}

.aui-message-row.user {
    align-items: flex-end;
}
.aui-message-row.assistant {
    align-items: flex-start;
}

.aui-message-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #94a3b8;
    margin-bottom: 4px;
    padding: 0 4px;
}
.aui-message-meta .badge-model {
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    color: #475569;
}

/* 用户气泡 */
.aui-bubble-user {
    background: #2563eb;
    color: #ffffff;
    border-radius: 16px 16px 4px 16px;
    padding: 10px 14px;
    font-size: 12.5px;
    line-height: 1.55;
    max-width: 88%;
    word-break: break-word;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.18);
    white-space: pre-wrap;
}

/* 关联费用上下文徽章 */
.aui-bubble-context-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 10.5px;
    font-weight: 500;
    margin-bottom: 5px;
    align-self: flex-end;
}

/* 附件缩略列表 */
.aui-attachments-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
}
.aui-attachment-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 11px;
    color: #334155;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

/* 助理消息卡片容器 */
.aui-bubble-assistant {
    background: #ffffff;
    color: #0f172a;
    border: 1px solid #e2e8f0;
    border-radius: 16px 16px 16px 4px;
    padding: 14px 16px;
    max-width: 100%;
    width: 100%;
    box-sizing: border-box;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
    display: flex;
    flex-direction: column;
    gap: 10px;
}

/* ==========================================================================
   HITL Confirmation Card 人在回路操作卡片 (用于出差排期规划与字段应用)
   ========================================================================== */
.aui-confirmation-card {
    margin-top: 10px;
    border: 1px solid #bfdbfe;
    border-radius: 12px;
    background: linear-gradient(180deg, #f0f7ff 0%, #ffffff 100%);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.06);
    transition: all 0.2s ease;
}
.aui-confirmation-card.is-applied {
    border-color: #bbf7d0;
    background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%);
    box-shadow: 0 1px 4px rgba(22, 163, 74, 0.05);
}

.aui-confirmation-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.aui-confirmation-title {
    display: flex;
    align-items: center;
    gap: 6px;
}
.aui-confirmation-icon {
    font-size: 15px;
}
.aui-confirmation-title-text {
    font-size: 12.5px;
    font-weight: 600;
    color: #1e293b;
}
.aui-confirmation-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 9999px;
    background: #dbeafe;
    color: #1d4ed8;
}
.aui-confirmation-card.is-applied .aui-confirmation-badge {
    background: #dcfce7;
    color: #15803d;
}

.aui-confirmation-desc {
    font-size: 11.5px;
    line-height: 1.5;
    color: #475569;
}
.aui-confirmation-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
}
.aui-confirmation-btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 16px;
    border-radius: 8px;
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
    transition: all 0.15s ease;
}
.aui-confirmation-btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
    transform: translateY(-1px);
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.35);
}
.aui-confirmation-btn-primary:active:not(:disabled) {
    transform: scale(0.98);
}
.aui-confirmation-btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.aui-confirmation-applied-note {
    font-size: 11px;
    font-weight: 600;
    color: #16a34a;
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
}

/* ==========================================================================
   Thinking Accordion 深度思考手风琴折叠面板 (assistant-ui 特色)
   ========================================================================== */
.aui-thinking-accordion {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    overflow: hidden;
    margin-bottom: 6px;
    transition: all 0.2s ease;
}
.aui-thinking-accordion.is-expanded {
    border-color: #cbd5e1;
    background: #f8fafc;
}

.aui-thinking-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    cursor: pointer;
    user-select: none;
    background: transparent;
    transition: background 0.15s ease;
}
.aui-thinking-header:hover {
    background: rgba(0, 0, 0, 0.02);
}

.aui-thinking-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: #475569;
    font-weight: 500;
}

.aui-thinking-sparkle {
    display: inline-block;
    font-size: 13px;
    color: #6366f1;
}
.aui-thinking-sparkle.is-pulsing {
    animation: auiPulse 1.8s infinite ease-in-out;
}

.aui-thinking-duration {
    font-size: 10px;
    color: #94a3b8;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 1px 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.aui-thinking-chevron {
    font-size: 11px;
    color: #94a3b8;
    transition: transform 0.2s ease;
}
.aui-thinking-chevron.is-expanded {
    transform: rotate(180deg);
}

.aui-thinking-body {
    padding: 8px 12px 12px 14px;
    border-top: 1px solid #e2e8f0;
    font-size: 11.5px;
    line-height: 1.6;
    color: #64748b;
    border-left: 3px solid #818cf8;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    max-height: 260px;
    overflow-y: auto;
    background: #ffffff;
}

/* ==========================================================================
   Tool Call Card 结构化工具调用卡片 (assistant-ui 标准规范)
   ========================================================================== */
.aui-tool-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #ffffff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
    margin: 6px 0;
    overflow: hidden;
    transition: all 0.15s ease;
}
.aui-tool-card:hover {
    border-color: #cbd5e1;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.05);
}

.aui-tool-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    cursor: pointer;
    user-select: none;
}
.aui-tool-card-header:hover {
    background: #f1f5f9;
}

.aui-tool-card-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: #1e293b;
}

.aui-tool-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 6px;
}
.aui-tool-status-badge.running {
    background: #eff6ff;
    color: #2563eb;
    border: 1px solid #bfdbfe;
}
.aui-tool-status-badge.done {
    background: #ecfdf5;
    color: #059669;
    border: 1px solid #a7f3d0;
}
.aui-tool-status-badge.error {
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
}

.aui-tool-spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid #93c5fd;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: auiSpin 0.8s linear infinite;
}

.aui-tool-progress-text {
    padding: 6px 12px;
    font-size: 11.5px;
    color: #475569;
    background: #f8fafc;
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid #f1f5f9;
}

.aui-tool-details {
    padding: 10px 12px;
    font-size: 11px;
    color: #334155;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.aui-tool-code-block {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 6px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
    color: #1e293b;
    max-height: 160px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
}

/* ==========================================================================
   Markdown Content Markdown 内容与表格设计系统 (assistant-ui 特色)
   彻底重置并收敛 markstream-react 庞大 rem 字号、2rem外边距与表格过度膨胀
   ========================================================================== */
.aui-markdown {
    font-size: 12px;
    line-height: 1.45;
    color: #1e293b;
    word-break: break-word;
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    box-sizing: border-box;
}

/* 核心字号与段落重置，彻底禁用 content-visibility 与 800x600 预留画幅 */
.aui-markdown .markstream-react,
.aui-markdown .markdown-renderer,
.aui-markdown :where(.markstream-react).markdown-renderer {
    font-size: 12px !important;
    line-height: 1.45 !important;
    color: #1e293b !important;
    content-visibility: visible !important;
    contain: none !important;
    contain-intrinsic-size: auto !important;
}

/* 彻底隐藏虚拟化高度占位撑开的巨大空白块 (杜绝 600px 巨型空白) */
.aui-markdown .node-spacer,
.aui-markdown .node-placeholder {
    display: none !important;
    height: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
}

.aui-markdown p,
.aui-markdown .paragraph-node {
    font-size: 12px !important;
    line-height: 1.45 !important;
    margin: 0 0 5px 0 !important;
    color: #1e293b !important;
}
.aui-markdown p:last-child,
.aui-markdown .paragraph-node:last-child {
    margin-bottom: 0 !important;
}

/* 标题精细化收敛 (严禁 2.25rem/1.5rem 巨型标题在侧栏撑爆) */
.aui-markdown h1, .aui-markdown .heading-1 {
    font-size: 14px !important;
    font-weight: 700 !important;
    color: #0f172a !important;
    margin: 8px 0 4px 0 !important;
    line-height: 1.35 !important;
    border-bottom: 1px solid #e2e8f0 !important;
    padding-bottom: 3px !important;
}
.aui-markdown h2, .aui-markdown .heading-2 {
    font-size: 13px !important;
    font-weight: 600 !important;
    color: #0f172a !important;
    margin: 6px 0 3px 0 !important;
    line-height: 1.35 !important;
}
.aui-markdown h3, .aui-markdown .heading-3 {
    font-size: 12.5px !important;
    font-weight: 600 !important;
    color: #0f172a !important;
    margin: 5px 0 2px 0 !important;
    line-height: 1.35 !important;
}
.aui-markdown h4, .aui-markdown .heading-4,
.aui-markdown h5, .aui-markdown .heading-5,
.aui-markdown h6, .aui-markdown .heading-6 {
    font-size: 12px !important;
    font-weight: 600 !important;
    color: #334155 !important;
    margin: 4px 0 2px 0 !important;
    line-height: 1.35 !important;
}

/* 分隔线收敛 (杜绝 3rem/48px 巨型外边距) */
.aui-markdown hr,
.aui-markdown .thematic-break,
.aui-markdown .hr-node {
    margin: 8px 0 !important;
    border: none !important;
    border-top: 1px solid #e2e8f0 !important;
    height: 1px !important;
}

/* 列表与引用 (收紧行距与嵌套列表外边距，彻底解决行间距巨大) */
.aui-markdown ul, .aui-markdown ol,
.aui-markdown .list-node,
.aui-markdown .markstream-react ul, .aui-markdown .markstream-react ol {
    margin: 3px 0 5px 0 !important;
    padding-left: 18px !important;
}
.aui-markdown li,
.aui-markdown .list-item {
    font-size: 12px !important;
    line-height: 1.45 !important;
    margin: 2px 0 !important;
    padding: 0 !important;
    color: #1e293b !important;
}
/* 彻底压平宽松列表 (Loose Lists) 中 li 嵌套 p 带来的巨大空行 */
.aui-markdown li > p,
.aui-markdown li > .paragraph-node,
.aui-markdown .list-item > p,
.aui-markdown .list-item > .paragraph-node {
    margin: 0 !important;
    line-height: 1.45 !important;
    display: inline !important;
}
.aui-markdown li > ul,
.aui-markdown li > ol,
.aui-markdown .list-item > .list-node {
    margin: 2px 0 2px 12px !important;
    padding-left: 0 !important;
}

/* 强制重置 Tailwind 注入的巨大外边距类名 */
.aui-markdown .my-8,
.aui-markdown .my-5,
.aui-markdown .my-4 {
    margin-top: 6px !important;
    margin-bottom: 6px !important;
}
.aui-markdown .my-2 {
    margin-top: 2px !important;
    margin-bottom: 2px !important;
}
.aui-markdown .mb-4 {
    margin-bottom: 6px !important;
}
.aui-markdown .mt-2 {
    margin-top: 4px !important;
}

.aui-markdown blockquote,
.aui-markdown .blockquote-node {
    margin: 5px 0 !important;
    padding: 4px 8px !important;
    background: #f8fafc !important;
    border-left: 3px solid #3b82f6 !important;
    border-radius: 0 4px 4px 0 !important;
    color: #475569 !important;
    font-size: 11.5px !important;
    line-height: 1.45 !important;
}

/* 行内与块级代码 */
.aui-markdown code:not(pre code),
.aui-markdown .inline-code {
    background: #f1f5f9 !important;
    color: #0f172a !important;
    padding: 1px 4px !important;
    border-radius: 3px !important;
    font-size: 11px !important;
    border: 1px solid #e2e8f0 !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
}
.aui-markdown pre,
.aui-markdown .code-block-node {
    background: #0f172a !important;
    color: #f8fafc !important;
    padding: 8px 10px !important;
    border-radius: 6px !important;
    overflow-x: auto !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 11px !important;
    line-height: 1.45 !important;
    margin: 6px 0 !important;
}

/* ==========================================================================
   assistant-ui 高质感排期与对账表格重塑 (彻底修复表格巨型字号与2rem边距)
   ========================================================================== */
.aui-markdown .table-node-wrapper,
.aui-markdown-table-wrapper {
    overflow-x: auto !important;
    max-width: 100% !important;
    margin: 6px 0 !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 6px !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03) !important;
    background: #ffffff !important;
}

.aui-markdown table,
.aui-markdown .table-node,
.aui-markdown .markstream-react table,
.aui-markdown table.my-8,
.aui-markdown table.text-sm {
    width: 100% !important;
    min-width: 100% !important;
    border-collapse: collapse !important;
    font-size: 11px !important;
    line-height: 1.35 !important;
    text-align: left !important;
    margin: 0 !important;
    border: none !important;
    border-radius: 0 !important;
}

.aui-markdown th,
.aui-markdown .table-node th,
.aui-markdown .table-node thead th {
    background: #f8fafc !important;
    color: #475569 !important;
    font-weight: 600 !important;
    font-size: 10.5px !important;
    padding: 4px 6px !important;
    border-bottom: 1px solid #e2e8f0 !important;
    border-right: 1px solid #f1f5f9 !important;
    white-space: nowrap !important;
    position: sticky !important;
    top: 0 !important;
    line-height: 1.3 !important;
    text-align: left !important;
}

.aui-markdown td,
.aui-markdown .table-node td,
.aui-markdown .table-node tbody td {
    padding: 3px 6px !important;
    border-bottom: 1px solid #f1f5f9 !important;
    border-right: 1px solid #f1f5f9 !important;
    color: #1e293b !important;
    font-size: 10.5px !important;
    line-height: 1.35 !important;
    font-variant-numeric: tabular-nums !important;
    white-space: normal !important;
    word-break: break-all !important;
}

/* 单元格内部文本节点字号收敛 */
.aui-markdown .table-node td *,
.aui-markdown .table-node th * {
    font-size: 10.5px !important;
    line-height: 1.3 !important;
}

.aui-markdown th:last-child,
.aui-markdown td:last-child,
.aui-markdown .table-node th:last-child,
.aui-markdown .table-node td:last-child {
    border-right: none !important;
}

.aui-markdown tbody tr:nth-child(even),
.aui-markdown .table-node tbody tr:nth-child(even) {
    background: #fafbfc !important;
}
.aui-markdown tbody tr:hover,
.aui-markdown .table-node tbody tr:hover {
    background: #eff6ff !important;
}
.aui-markdown tbody tr:last-child td,
.aui-markdown .table-node tbody tr:last-child td {
    border-bottom: none !important;
}

/* ==========================================================================
   Assistant Composer 复合输入框 (assistant-ui 标准卡片设计)
   ========================================================================== */
.aui-composer-container {
    padding: 10px 14px 14px;
    border-top: 1px solid #e2e8f0;
    background: #ffffff;
}

.aui-composer-card {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 16px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    gap: 6px;
    transition: all 0.15s ease;
    position: relative;
}
.aui-composer-card:focus-within {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15), 0 4px 16px rgba(37, 99, 235, 0.08);
}
.aui-composer-card.is-dragover {
    border-color: #2563eb;
    background: #f8faff;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25);
}

.aui-composer-textarea {
    width: 100%;
    min-height: 42px;
    max-height: 180px;
    border: none;
    outline: none;
    resize: none;
    font-size: 12.5px;
    line-height: 1.55;
    color: #0f172a;
    background: transparent;
    padding: 4px 0;
    font-family: inherit;
}
.aui-composer-textarea::placeholder {
    color: #94a3b8;
}

.aui-composer-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 4px;
    border-top: 1px solid #f1f5f9;
}

.aui-toolbar-left {
    display: flex;
    align-items: center;
    gap: 6px;
}

.aui-btn-tool {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    color: #475569;
    font-size: 11px;
    padding: 4px 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.12s ease;
}
.aui-btn-tool:hover {
    background: #f8fafc;
    border-color: #cbd5e1;
    color: #0f172a;
}
.aui-btn-tool.active {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #2563eb;
    font-weight: 600;
}

.aui-btn-send {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #2563eb;
    color: #ffffff;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    transition: all 0.15s ease;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);
}
.aui-btn-send:hover:not(:disabled) {
    background: #1d4ed8;
    transform: scale(1.05);
}
.aui-btn-send:disabled {
    background: #e2e8f0;
    color: #94a3b8;
    cursor: not-allowed;
    box-shadow: none;
}

/* 常用动效 */
@keyframes auiFadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes auiPulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.1); opacity: 0.8; }
}

@keyframes auiSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
`;
