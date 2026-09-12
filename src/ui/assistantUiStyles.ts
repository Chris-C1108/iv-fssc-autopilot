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
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 380px;
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
    max-width: 95%;
    width: fit-content;
    min-width: 280px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
    display: flex;
    flex-direction: column;
    gap: 10px;
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
   ========================================================================== */
.aui-markdown {
    font-size: 12.5px;
    line-height: 1.65;
    color: #1e293b;
    word-break: break-word;
}
.aui-markdown p {
    margin: 0 0 8px 0;
}
.aui-markdown p:last-child {
    margin-bottom: 0;
}

.aui-markdown h1, .aui-markdown h2, .aui-markdown h3, .aui-markdown h4 {
    color: #0f172a;
    font-weight: 600;
    margin: 12px 0 6px 0;
    letter-spacing: -0.01em;
}
.aui-markdown h1 { font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
.aui-markdown h2 { font-size: 14px; }
.aui-markdown h3 { font-size: 13px; }
.aui-markdown h4 { font-size: 12.5px; }

.aui-markdown ul, .aui-markdown ol {
    margin: 4px 0 8px 0;
    padding-left: 20px;
}
.aui-markdown li {
    margin-bottom: 3px;
}

.aui-markdown blockquote {
    margin: 8px 0;
    padding: 6px 12px;
    background: #f8fafc;
    border-left: 3px solid #3b82f6;
    border-radius: 0 6px 6px 0;
    color: #475569;
    font-size: 12px;
}

.aui-markdown code:not(pre code) {
    background: #f1f5f9;
    color: #0f172a;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 11.5px;
    border: 1px solid #e2e8f0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.aui-markdown pre {
    background: #0f172a;
    color: #f8fafc;
    padding: 10px 14px;
    border-radius: 8px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    line-height: 1.5;
    margin: 8px 0;
}

/* assistant-ui 高质感排期与对账表格 */
.aui-markdown-table-wrapper {
    overflow-x: auto;
    max-width: 100%;
    margin: 10px 0;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
    background: #ffffff;
}

.aui-markdown-table,
.aui-markdown table,
.markstream table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 11.5px;
    line-height: 1.4;
    text-align: left;
    margin: 8px 0;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
}

.aui-markdown-table th,
.aui-markdown th,
.markstream th {
    background: #f8fafc;
    color: #334155;
    font-weight: 600;
    padding: 8px 12px;
    border-bottom: 1px solid #e2e8f0;
    white-space: nowrap;
    position: sticky;
    top: 0;
}
.aui-markdown-table th:not(:last-child),
.aui-markdown-table td:not(:last-child),
.aui-markdown th:not(:last-child),
.aui-markdown td:not(:last-child),
.markstream th:not(:last-child),
.markstream td:not(:last-child) {
    border-right: 1px solid #f1f5f9;
}

.aui-markdown-table td,
.aui-markdown td,
.markstream td {
    padding: 7px 12px;
    border-bottom: 1px solid #f1f5f9;
    color: #1e293b;
    font-variant-numeric: tabular-nums;
}

.aui-markdown-table tbody tr:nth-child(even),
.aui-markdown tbody tr:nth-child(even),
.markstream tbody tr:nth-child(even) {
    background: #fbfcfd;
}
.aui-markdown-table tbody tr:hover,
.aui-markdown tbody tr:hover,
.markstream tbody tr:hover {
    background: #eff6ff;
}
.aui-markdown-table tbody tr:last-child td,
.aui-markdown tbody tr:last-child td,
.markstream tbody tr:last-child td {
    border-bottom: none;
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
