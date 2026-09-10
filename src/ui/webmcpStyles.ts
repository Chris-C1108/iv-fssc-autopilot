import { getMarkstreamCss } from './markdownRenderer';

export function injectWebMcpStyles() {
    const styleId = 'autopilot-webmcp-styles-v3';
    // 彻底清除历史残留样式，确保版本热更新时样式 100% 刷新生效
    document.querySelectorAll('style[id^="autopilot-webmcp-styles"]').forEach(el => el.remove());

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = getMarkstreamCss() + '\n' + `
        /* ====================================================
           HeroUI Pro & CRM Agent Pop Design Tokens
           ==================================================== */
        :root {
            --wm-bg: #ffffff;
            --wm-panel: #f8fafc;
            --wm-card: #ffffff;
            --wm-border: rgba(226, 232, 240, 0.9);
            --wm-border-subtle: rgba(0, 0, 0, 0.06);
            --wm-border-hover: rgba(99, 102, 241, 0.4);
            --wm-primary: #6366f1;
            --wm-primary-gradient: linear-gradient(135deg, #6366f1 0%, #4f46e5 50%, #7c3aed 100%);
            --wm-accent-purple: #7828c8;
            --wm-text-primary: #0f172a;
            --wm-text-secondary: #475569;
            --wm-text-muted: #94a3b8;
            --wm-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05);
            --wm-shadow-md: 0 4px 16px -2px rgba(0, 0, 0, 0.08);
            --wm-shadow-drawer: -12px 0 40px -10px rgba(15, 23, 42, 0.22);
            --wm-shadow-popup: 0 24px 60px -12px rgba(15, 23, 42, 0.35);
            --wm-radius-lg: 16px;
            --wm-radius-md: 10px;
            --wm-radius-sm: 6px;
        }

        /* 悬浮微标 (Launcher Pill) */
        .webmcp-copilot-pill {
            position: fixed;
            bottom: 135px;
            right: 24px;
            z-index: 99999;
            background: var(--wm-primary-gradient);
            color: #ffffff;
            font-size: 13px;
            font-weight: 600;
            padding: 9px 18px;
            border-radius: 30px;
            box-shadow: 0 8px 24px rgba(99, 102, 241, 0.4);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 9px;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            border: 1px solid rgba(255, 255, 255, 0.3);
            user-select: none;
            backdrop-filter: blur(8px);
        }
        .webmcp-copilot-pill:hover {
            transform: translateY(-3px) scale(1.03);
            box-shadow: 0 12px 28px rgba(99, 102, 241, 0.55);
        }
        .webmcp-copilot-pill:active {
            transform: translateY(0) scale(0.98);
        }
        .webmcp-pill-indicator {
            width: 8px;
            height: 8px;
            background: #10b981;
            border-radius: 50%;
            box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3);
            animation: webmcpPulse 2s infinite;
        }
        @keyframes webmcpPulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
            70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
            100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        /* ====================================================
           主容器: 支持 侧边抽屉 (Drawer) 与 悬浮视窗 (Popup)
           ==================================================== */
        .webmcp-container {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: var(--wm-bg);
            color: var(--wm-text-primary);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-sizing: border-box;
            user-select: text;
        }

        /* 模式 1: 侧边抽屉 (Side Drawer) - 停靠右侧，左侧留出单据操作区 */
        .webmcp-container.mode-drawer {
            position: fixed;
            top: 0;
            right: 0;
            height: 100vh;
            width: 620px;
            max-width: 95vw;
            z-index: 100000;
            box-shadow: var(--wm-shadow-drawer);
            border-left: 1px solid var(--wm-border);
            transition: width 0.05s ease, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .webmcp-container.mode-drawer.is-hidden {
            transform: translateX(105%);
            pointer-events: none;
        }

        /* 拖拽与缩放进行中: 强制关闭动画，保证绝对跟随鼠标 */
        .webmcp-container.is-resizing {
            transition: none !important;
            user-select: none !important;
        }

        /* 拖拽全屏捕获遮罩 */
        .webmcp-drag-overlay {
            position: fixed;
            inset: 0;
            z-index: 999999;
            background: transparent;
            user-select: none;
        }

        /* 拖拽文件进入容器的高亮效果 */
        .webmcp-container.is-dragover {
            box-shadow: 0 0 0 3px var(--wm-primary), var(--wm-shadow-popup) !important;
            outline: 2px dashed var(--wm-primary);
            outline-offset: -4px;
        }

        /* 抽屉左侧可拖拽把手 (Drawer Resizer Handle) */
        .webmcp-drawer-resizer {
            position: absolute;
            top: 0;
            left: 0;
            width: 8px;
            height: 100%;
            cursor: ew-resize;
            z-index: 1000;
            background: transparent;
            transition: background-color 0.15s;
        }
        .webmcp-drawer-resizer:hover,
        .webmcp-drawer-resizer.is-resizing {
            background-color: var(--wm-primary);
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.6);
        }

        /* 模式 2: 悬浮视窗 (Pop-up Window) - 自由拖动与缩放 */
        .webmcp-container.mode-popup {
            position: fixed;
            z-index: 100000;
            width: 860px;
            max-width: 96vw;
            height: 86vh;
            max-height: 96vh;
            border-radius: var(--wm-radius-lg);
            box-shadow: var(--wm-shadow-popup);
            border: 1px solid var(--wm-border);
            transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .webmcp-container.mode-popup.is-hidden {
            opacity: 0;
            transform: scale(0.95);
            pointer-events: none;
        }
        .webmcp-container.mode-popup .webmcp-header {
            cursor: grab;
        }
        .webmcp-container.mode-popup .webmcp-header:active {
            cursor: grabbing;
        }

        /* 弹窗右下角缩放手柄 (Corner Resizer Handle) */
        .webmcp-popup-resizer {
            position: absolute;
            right: 0;
            bottom: 0;
            width: 20px;
            height: 20px;
            cursor: nwse-resize;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--wm-text-muted);
            user-select: none;
            transition: color 0.15s;
        }
        .webmcp-popup-resizer:hover,
        .webmcp-popup-resizer.is-resizing {
            color: var(--wm-primary);
        }

        /* ====================================================
           头部 (Header): 玻璃质感 + 分段Tab + 布局切换
           ==================================================== */
        .webmcp-header {
            padding: 0 16px;
            height: 54px;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid var(--wm-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            shrink-0: 0;
            user-select: none;
            gap: 12px;
        }
        .webmcp-header-left {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }
        .webmcp-logo-icon {
            width: 28px;
            height: 28px;
            background: var(--wm-primary-gradient);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            font-size: 15px;
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.35);
            flex-shrink: 0;
        }
        .webmcp-header-title {
            font-size: 14px;
            font-weight: 700;
            color: var(--wm-text-primary);
            white-space: nowrap;
            letter-spacing: -0.2px;
        }
        .webmcp-badge-status {
            background: #ecfdf5;
            color: #059669;
            border: 1px solid #a7f3d0;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 12px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
        }
        .webmcp-model-badge {
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #cbd5e1;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 12px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.15s;
        }
        .webmcp-model-badge:hover {
            background: #e2e8f0;
            border-color: #94a3b8;
        }
        .webmcp-model-badge.configured {
            background: #ede9fe;
            color: #6d28d9;
            border-color: #ddd6fe;
        }

        /* 头部中心分段器 (Segmented Tabs) */
        .webmcp-tabs {
            display: flex;
            background: #f1f5f9;
            padding: 3px;
            border-radius: 8px;
            gap: 2px;
        }
        .webmcp-tab-btn {
            background: transparent;
            border: none;
            color: var(--wm-text-secondary);
            font-size: 12px;
            font-weight: 600;
            padding: 5px 12px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.18s ease;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .webmcp-tab-btn:hover {
            color: var(--wm-text-primary);
        }
        .webmcp-tab-btn.active {
            background: #ffffff;
            color: var(--wm-primary);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }

        /* 头部右侧操作区 */
        .webmcp-header-right {
            display: flex;
            align-items: center;
            gap: 6px;
            position: relative;
        }
        .webmcp-icon-btn {
            width: 32px;
            height: 32px;
            border-radius: 6px;
            border: 1px solid transparent;
            background: transparent;
            color: var(--wm-text-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.18s;
        }
        .webmcp-icon-btn:hover {
            background: #f1f5f9;
            color: var(--wm-text-primary);
        }

        /* 布局切换下拉菜单 (Layout Dropdown) */
        .webmcp-layout-dropdown {
            position: absolute;
            top: 40px;
            right: 36px;
            width: 190px;
            background: #ffffff;
            border: 1px solid var(--wm-border);
            border-radius: var(--wm-radius-md);
            box-shadow: var(--wm-shadow-md);
            padding: 6px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            z-index: 100010;
            animation: webmcpFadeDown 0.18s ease-out;
        }
        @keyframes webmcpFadeDown {
            from { opacity: 0; transform: translateY(-6px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .webmcp-dropdown-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 10px;
            border-radius: var(--wm-radius-sm);
            font-size: 12.5px;
            color: var(--wm-text-secondary);
            cursor: pointer;
            transition: all 0.15s;
        }
        .webmcp-dropdown-item:hover {
            background: #f8fafc;
            color: var(--wm-text-primary);
        }
        .webmcp-dropdown-item.active {
            background: #eef2ff;
            color: var(--wm-primary);
            font-weight: 600;
        }

        /* ====================================================
           主体内容区
           ==================================================== */
        .webmcp-content-view {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: #ffffff;
        }

        /* 快捷 Prompt 栏 */
        .webmcp-quick-prompts {
            padding: 10px 16px;
            background: #f8fafc;
            border-bottom: 1px solid var(--wm-border);
            display: flex;
            gap: 8px;
            overflow-x: auto;
            align-items: center;
            scrollbar-width: none;
        }
        .webmcp-quick-prompts::-webkit-scrollbar {
            display: none;
        }
        .webmcp-prompt-chip {
            background: #ffffff;
            border: 1px solid var(--wm-border);
            color: var(--wm-text-secondary);
            padding: 4px 12px;
            border-radius: 16px;
            font-size: 11.5px;
            font-weight: 500;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        }
        .webmcp-prompt-chip:hover {
            border-color: var(--wm-primary);
            color: var(--wm-primary);
            background: #eef2ff;
            transform: translateY(-1px);
        }

        /* 对话流区 */
        .webmcp-chat-stream {
            flex: 1;
            overflow-y: auto;
            padding: 20px 18px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            background: #ffffff;
        }

        .webmcp-msg {
            max-width: 92%;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .webmcp-msg.user {
            align-self: flex-end;
        }
        .webmcp-msg.assistant {
            align-self: flex-start;
        }
        .webmcp-msg-bubble {
            padding: 12px 16px;
            border-radius: 14px;
            font-size: 13.5px;
            line-height: 1.55;
        }
        .webmcp-msg.user .webmcp-msg-bubble {
            background: var(--wm-primary-gradient);
            color: #ffffff;
            border-bottom-right-radius: 3px;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
        }
        .webmcp-msg.assistant .webmcp-msg-bubble {
            background: #f8fafc;
            color: var(--wm-text-primary);
            border-bottom-left-radius: 3px;
            border: 1px solid var(--wm-border);
        }

        /* ====================================================
           Markstream React Streaming Markdown Bubble
           ==================================================== */
        .webmcp-msg-bubble.markstream-bubble {
            padding: 12px 16px;
            overflow-x: auto;
            max-width: 100%;
        }
        .markstream-bubble .markstream-react {
            font-size: 13.5px;
            line-height: 1.65;
            color: var(--wm-text-primary);
        }
        .markstream-bubble .markstream-react p {
            margin: 6px 0;
        }
        .markstream-bubble .markstream-react p:first-child {
            margin-top: 0;
        }
        .markstream-bubble .markstream-react p:last-child {
            margin-bottom: 0;
        }
        .markstream-bubble .markstream-react ul,
        .markstream-bubble .markstream-react ol {
            margin: 6px 0;
            padding-left: 20px;
        }
        .markstream-bubble .markstream-react li {
            margin: 3px 0;
        }
        .markstream-bubble .markstream-react table {
            margin: 10px 0;
            font-size: 12px;
            border-collapse: collapse;
            width: 100%;
            background: #ffffff;
            border-radius: 6px;
            overflow: hidden;
            border: 1px solid #e2e8f0;
        }
        .markstream-bubble .markstream-react th,
        .markstream-bubble .markstream-react td {
            padding: 7px 10px;
            border: 1px solid #e2e8f0;
        }
        .markstream-bubble .markstream-react th {
            background: #f1f5f9;
            font-weight: 600;
            color: #334155;
        }
        .markstream-bubble .markstream-react pre,
        .markstream-bubble .markstream-react .code-block-node {
            margin: 8px 0;
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 12px;
            background: #0f172a;
            color: #f8fafc;
        }
        .markstream-bubble .markstream-react code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .markstream-bubble .markstream-react blockquote {
            border-left: 3px solid #6366f1;
            padding-left: 12px;
            margin: 8px 0;
            color: #475569;
            background: #f8faff;
            border-radius: 0 6px 6px 0;
            padding: 6px 12px;
        }
        .markstream-bubble .markstream-react strong {
            font-weight: 700;
            color: #0f172a;
        }


        /* ====================================================
           CRM Agent Pop 风格: 折叠式 Tool Pocket
           ==================================================== */
        .webmcp-tool-pocket {
            margin: 6px 0;
            border: 1px solid #e0e7ff;
            border-radius: var(--wm-radius-md);
            background: #f8faff;
            overflow: hidden;
            transition: all 0.2s ease;
            box-sizing: border-box;
            width: 100%;
        }
        .webmcp-pocket-header {
            padding: 8px 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            color: #4338ca;
            user-select: none;
            min-height: 30px;
            line-height: 1.4;
            box-sizing: border-box;
        }
        .webmcp-pocket-header:hover {
            background: #eef2ff;
        }
        .webmcp-pocket-title {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .webmcp-pocket-chevron {
            font-size: 11px;
            transition: transform 0.2s ease;
        }
        .webmcp-pocket-chevron.open {
            transform: rotate(180deg);
        }
        .webmcp-pocket-body {
            padding: 8px 12px;
            border-top: 1px solid #e0e7ff;
            background: #ffffff;
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 11.5px;
            box-sizing: border-box;
        }
        .webmcp-pocket-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 0;
            color: #334155;
            border-bottom: 1px dashed #f1f5f9;
        }
        .webmcp-pocket-item:last-child {
            border-bottom: none;
        }

        /* 优雅降级与业务告警通知卡片 */
        .webmcp-notice-card {
            margin: 8px 0;
            padding: 10px 14px;
            border-radius: var(--wm-radius-md);
            background: #fff7ed;
            border: 1px solid #fed7aa;
            display: flex;
            gap: 10px;
            align-items: flex-start;
            box-sizing: border-box;
            animation: fadeIn 0.3s ease;
        }

        /* ====================================================
           HeroUI Pro Generative UI 行程卡片
           ==================================================== */
        .webmcp-trip-card {
            border: 1px solid var(--wm-border);
            border-radius: var(--wm-radius-md);
            padding: 12px 14px;
            background: #ffffff;
            box-shadow: var(--wm-shadow-sm);
            margin: 6px 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .webmcp-trip-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .webmcp-trip-route {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 700;
            font-size: 13.5px;
            color: var(--wm-text-primary);
        }
        .webmcp-trip-person-badge {
            font-size: 11px;
            font-weight: 600;
            padding: 2px 7px;
            border-radius: 6px;
        }
        .webmcp-person-self {
            background: #e0e7ff;
            color: #4338ca;
        }
        .webmcp-person-proxy {
            background: #fef3c7;
            color: #b45309;
        }
        .webmcp-trip-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .webmcp-trip-chip {
            background: #f1f5f9;
            color: var(--wm-text-secondary);
            font-size: 11px;
            padding: 3px 8px;
            border-radius: 4px;
        }
        .webmcp-trip-chip.amount {
            background: #ecfdf5;
            color: #047857;
            font-weight: 700;
            margin-left: auto;
            font-size: 12.5px;
            font-variant-numeric: tabular-nums;
        }

        /* ====================================================
           HeroUI Pro 审批门禁 (Approval Gate)
           ==================================================== */
        .webmcp-approval-card {
            background: linear-gradient(180deg, #fffbeb 0%, #ffffff 100%);
            border: 1.5px solid #fcd34d;
            border-radius: var(--wm-radius-md);
            padding: 16px;
            margin: 10px 0;
            box-shadow: 0 6px 20px rgba(245, 158, 11, 0.12);
        }
        .webmcp-approval-title {
            font-size: 13.5px;
            font-weight: 700;
            color: #92400e;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }
        .webmcp-approval-body {
            font-size: 12.5px;
            color: #78350f;
            line-height: 1.6;
        }
        .webmcp-approval-amount {
            font-size: 20px;
            font-weight: 800;
            color: #b45309;
            font-variant-numeric: tabular-nums;
            margin: 6px 0;
        }
        .webmcp-approval-actions {
            margin-top: 14px;
            display: flex;
            gap: 10px;
        }
        .webmcp-btn-approve {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: #ffffff;
            border: none;
            padding: 8px 18px;
            border-radius: 8px;
            font-size: 12.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35);
        }
        .webmcp-btn-approve:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.45);
        }
        .webmcp-btn-reject {
            background: #ffffff;
            color: #64748b;
            border: 1px solid #cbd5e1;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 12.5px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .webmcp-btn-reject:hover {
            background: #f8fafc;
            color: var(--wm-text-primary);
        }

        /* 对话建议芯片 (Conversation Suggestions) */
        .webmcp-suggestions-box {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin: 8px 0;
            padding: 10px 14px;
            background: #f8fafc;
            border-radius: var(--wm-radius-md);
            border: 1px solid var(--wm-border);
        }
        .webmcp-suggestions-title {
            font-size: 11.5px;
            font-weight: 600;
            color: var(--wm-text-muted);
        }
        .webmcp-suggestions-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .webmcp-suggestion-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            border-radius: 6px;
            background: #ffffff;
            border: 1px solid var(--wm-border);
            font-size: 12px;
            color: var(--wm-text-secondary);
            cursor: pointer;
            transition: all 0.15s;
        }
        .webmcp-suggestion-row:hover {
            border-color: var(--wm-primary);
            color: var(--wm-primary);
            background: #f5f7ff;
            transform: translateX(2px);
        }

        /* 底部 Composer */
        .webmcp-composer-box {
            padding: 12px 18px 16px;
            background: #ffffff;
            border-top: 1px solid var(--wm-border);
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .webmcp-input-container {
            border: 1px solid var(--wm-border);
            border-radius: 12px;
            padding: 8px 12px;
            background: #f8fafc;
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .webmcp-input-container:focus-within {
            background: #ffffff;
            border-color: var(--wm-primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }
        .webmcp-textarea {
            width: 100%;
            border: none;
            background: transparent;
            font-size: 13.5px;
            color: var(--wm-text-primary);
            outline: none;
            resize: none;
            font-family: inherit;
            min-height: 24px;
            max-height: 120px;
        }
        .webmcp-composer-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11px;
            color: var(--wm-text-muted);
        }
        .webmcp-btn-send {
            background: var(--wm-primary-gradient);
            color: #ffffff;
            border: none;
            border-radius: 8px;
            padding: 6px 16px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.18s;
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }
        .webmcp-btn-send:hover {
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
        }
        .webmcp-btn-send:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .webmcp-btn-send.is-stopping {
            background: linear-gradient(135deg, #ef4444 0%, #ea580c 100%) !important;
            color: #ffffff !important;
            box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4) !important;
            animation: webmcp-pulse-stop 1.5s infinite;
        }
        @keyframes webmcp-pulse-stop {
            0% { transform: scale(1); }
            50% { transform: scale(1.03); }
            100% { transform: scale(1); }
        }

        /* 消息悬浮操作浮条 */
        .webmcp-msg {
            position: relative;
        }
        .webmcp-msg-actions {
            opacity: 0;
            pointer-events: none;
            position: absolute;
            top: -12px;
            right: 8px;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            border-radius: 6px;
            padding: 2px 4px;
            display: inline-flex;
            align-items: center;
            gap: 2px;
            z-index: 10;
            transition: opacity 0.15s ease;
        }
        .webmcp-msg:hover .webmcp-msg-actions {
            opacity: 1;
            pointer-events: auto;
        }
        .webmcp-msg.user .webmcp-msg-actions {
            right: auto;
            left: 8px;
        }
        .webmcp-msg-action-btn {
            background: transparent;
            border: none;
            border-radius: 4px;
            padding: 3px 6px;
            font-size: 11px;
            color: #64748b;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            line-height: 1;
            transition: all 0.15s;
        }
        .webmcp-msg-action-btn:hover {
            background: #f1f5f9;
            color: #1e293b;
        }

        /* Agentic 状态卡片 (思考/工具/流式全链路呼吸指示与毫秒秒表) */
        .webmcp-status-card {
            border: 1px solid #e0e7ff;
            border-radius: 12px;
            background: linear-gradient(135deg, #f8faff 0%, #f1f5fd 100%);
            padding: 10px 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            box-sizing: border-box;
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.08);
            animation: webmcp-status-glow 2s infinite alternate;
        }
        @keyframes webmcp-status-glow {
            0% { border-color: #c7d2fe; box-shadow: 0 2px 8px rgba(99, 102, 241, 0.08); }
            100% { border-color: #818cf8; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.22); }
        }
        .webmcp-status-card-left {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
            flex: 1;
        }
        .webmcp-status-icon {
            font-size: 14px;
            animation: webmcp-spin-slow 3s linear infinite;
        }
        @keyframes webmcp-spin-slow {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .webmcp-status-text {
            font-size: 12px;
            color: #3730a3;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .webmcp-status-timer {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11.5px;
            font-weight: 700;
            color: #6366f1;
            background: rgba(255, 255, 255, 0.85);
            padding: 2px 6px;
            border-radius: 6px;
            border: 1px solid #e0e7ff;
            letter-spacing: 0.5px;
            flex-shrink: 0;
        }

        /* 性能与工具指标徽章 */
        .webmcp-metrics-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            color: #94a3b8;
            margin-top: 4px;
            padding: 2px 8px;
            border-radius: 4px;
            background: #f8fafc;
            border: 1px solid #f1f5f9;
            align-self: flex-start;
        }
        .webmcp-metrics-badge span {
            display: inline-flex;
            align-items: center;
            gap: 3px;
        }

        /* 就地编辑框 */
        .webmcp-inline-editor {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 8px;
            background: #ffffff;
            border: 1px solid #6366f1;
            border-radius: 10px;
            padding: 10px;
            box-shadow: 0 4px 14px rgba(99, 102, 241, 0.15);
            box-sizing: border-box;
        }
        .webmcp-inline-textarea {
            width: 100%;
            min-height: 60px;
            max-height: 200px;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 8px;
            font-size: 13px;
            font-family: inherit;
            resize: vertical;
            outline: none;
            box-sizing: border-box;
        }
        .webmcp-inline-textarea:focus {
            border-color: #6366f1;
        }
        .webmcp-inline-editor-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }
        .webmcp-inline-btn {
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            transition: all 0.15s;
        }
        .webmcp-inline-btn.cancel {
            background: #f1f5f9;
            color: #475569;
        }
        .webmcp-inline-btn.cancel:hover {
            background: #e2e8f0;
        }
        .webmcp-inline-btn.submit {
            background: var(--wm-primary-gradient);
            color: #ffffff;
        }
        .webmcp-inline-btn.submit:hover {
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
        }

        /* 附件列表区 */
        .webmcp-attachments-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            padding-bottom: 4px;
            border-bottom: 1px solid #f1f5f9;
        }
        .webmcp-attachment-chip {
            background: #f8fafc;
            border: 1px solid var(--wm-border);
            border-radius: 6px;
            padding: 3px 8px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 11.5px;
            color: var(--wm-text-secondary);
            max-width: 220px;
        }
        .webmcp-attachment-thumb {
            width: 20px;
            height: 20px;
            border-radius: 4px;
            object-fit: cover;
            border: 1px solid rgba(0,0,0,0.1);
        }
        .webmcp-attachment-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .webmcp-attachment-remove {
            cursor: pointer;
            color: #94a3b8;
            font-size: 11px;
            margin-left: 2px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            width: 14px;
            height: 14px;
            transition: all 0.15s;
        }
        .webmcp-attachment-remove:hover {
            background: #fee2e2;
            color: #ef4444;
        }
        .webmcp-btn-attach {
            background: transparent;
            border: 1px solid transparent;
            border-radius: 6px;
            color: #64748b;
            padding: 4px 8px;
            font-size: 11.5px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.15s;
        }
        .webmcp-btn-attach:hover {
            background: #f1f5f9;
            color: var(--wm-primary);
        }

        /* ====================================================
           Tab 2: WebMCP 原生工具监视器 & 事件流面板
           ==================================================== */
        .webmcp-inspector-view {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: #0f172a;
            color: #f8fafc;
        }
        .webmcp-inspector-tools-list {
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            overflow-y: auto;
            max-height: 48%;
            border-bottom: 1px solid #1e293b;
        }
        .webmcp-tool-card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: var(--wm-radius-sm);
            padding: 10px 12px;
            font-size: 11.5px;
        }
        .webmcp-tool-name {
            color: #38bdf8;
            font-weight: 700;
            font-family: monospace;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .webmcp-tool-desc {
            color: #94a3b8;
            margin-top: 4px;
            line-height: 1.4;
        }
        .webmcp-logs-panel {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            font-family: monospace;
            font-size: 11px;
            background: #090d16;
        }
        .webmcp-log-item {
            padding: 6px 0;
            border-bottom: 1px solid #1e293b;
            line-height: 1.4;
            color: #cbd5e1;
        }
        .webmcp-log-time {
            color: #64748b;
            margin-right: 6px;
        }
        .webmcp-log-tool {
            color: #a855f7;
            font-weight: 700;
        }

        /* ====================================================
           设置弹窗 (Settings Modal)
           ==================================================== */
        .webmcp-settings-backdrop {
            position: fixed;
            inset: 0;
            z-index: 100020;
            background: rgba(15, 23, 42, 0.55);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            animation: webmcpFadeIn 0.2s ease-out;
        }
        @keyframes webmcpFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .webmcp-settings-card {
            width: 540px;
            max-width: 92vw;
            background: #ffffff;
            border-radius: var(--wm-radius-lg);
            box-shadow: 0 24px 50px -12px rgba(15, 23, 42, 0.35);
            border: 1px solid var(--wm-border);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            animation: webmcpScaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes webmcpScaleUp {
            from { transform: scale(0.95); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
        .webmcp-settings-header {
            padding: 16px 20px;
            border-bottom: 1px solid var(--wm-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .webmcp-settings-body {
            padding: 18px 20px;
            display: flex;
            flex-direction: column;
            gap: 14px;
            overflow-y: auto;
            max-height: 75vh;
        }
        .webmcp-settings-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .webmcp-settings-row {
            display: flex;
            gap: 12px;
        }
        .webmcp-settings-label {
            font-size: 12px;
            font-weight: 600;
            color: var(--wm-text-secondary);
        }
        .webmcp-settings-hint {
            font-size: 11px;
            color: var(--wm-text-muted);
        }
        .webmcp-settings-input {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--wm-border);
            border-radius: var(--wm-radius-sm);
            font-size: 13px;
            color: var(--wm-text-primary);
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.15s;
        }
        .webmcp-settings-input:focus {
            border-color: var(--wm-primary);
            box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
        }
        .webmcp-presets-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .webmcp-preset-chip {
            background: #f8fafc;
            border: 1px solid var(--wm-border);
            border-radius: 6px;
            padding: 4px 10px;
            font-size: 11.5px;
            font-weight: 500;
            color: var(--wm-text-secondary);
            cursor: pointer;
            transition: all 0.15s;
        }
        .webmcp-preset-chip:hover {
            border-color: var(--wm-primary);
            color: var(--wm-primary);
        }
        .webmcp-preset-chip.active {
            background: #ede9fe;
            border-color: #8b5cf6;
            color: #6d28d9;
            font-weight: 600;
        }
        .webmcp-test-box {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: #f8fafc;
            border: 1px solid var(--wm-border);
            border-radius: var(--wm-radius-sm);
        }
        .webmcp-btn-test {
            background: #ffffff;
            border: 1px solid var(--wm-border);
            color: var(--wm-text-secondary);
            padding: 5px 12px;
            border-radius: 6px;
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
        }
        .webmcp-btn-test:hover {
            border-color: var(--wm-primary);
            color: var(--wm-primary);
        }
        .webmcp-test-status {
            font-size: 11.5px;
            max-width: 320px;
            text-align: right;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .webmcp-settings-footer {
            padding: 14px 20px;
            background: #f8fafc;
            border-top: 1px solid var(--wm-border);
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
        }
        .webmcp-btn-secondary {
            background: #ffffff;
            border: 1px solid var(--wm-border);
            color: var(--wm-text-secondary);
            padding: 7px 16px;
            border-radius: 6px;
            font-size: 12.5px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
        }
        .webmcp-btn-secondary:hover {
            background: #f1f5f9;
            color: var(--wm-text-primary);
        }
        .webmcp-btn-primary {
            background: var(--wm-primary-gradient);
            border: none;
            color: #ffffff;
            padding: 7px 18px;
            border-radius: 6px;
            font-size: 12.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
        }
        .webmcp-btn-primary:hover {
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.45);
        }

        /* ====================================================
           WebMCP Generative Artifact 方案全景透视看板样式
           ==================================================== */
        .webmcp-artifact-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(15, 23, 42, 0.65);
            backdrop-filter: blur(6px);
            z-index: 10000002;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            box-sizing: border-box;
            animation: webmcp-fade-in 0.2s ease-out;
        }
        .webmcp-artifact-modal {
            width: 94vw;
            max-width: 1400px;
            height: 90vh;
            max-height: 920px;
            background: #ffffff;
            border-radius: 18px;
            box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        .webmcp-artifact-header {
            padding: 16px 24px;
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        }
        .webmcp-artifact-title-group {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .webmcp-artifact-icon {
            font-size: 26px;
        }
        .webmcp-artifact-title {
            font-size: 16px;
            font-weight: 700;
            color: #0f172a;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .webmcp-artifact-subtitle {
            font-size: 12px;
            color: #64748b;
            margin-top: 2px;
        }
        .webmcp-artifact-badge-count {
            font-size: 11px;
            font-weight: 700;
            background: #e0e7ff;
            color: #4338ca;
            padding: 2px 8px;
            border-radius: 10px;
        }
        .webmcp-artifact-badge-mode {
            font-size: 11px;
            font-weight: 700;
            background: #dcfce7;
            color: #15803d;
            padding: 2px 8px;
            border-radius: 10px;
        }
        .webmcp-artifact-header-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .webmcp-artifact-action-btn {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            color: #334155;
            padding: 6px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
        }
        .webmcp-artifact-action-btn:hover {
            background: #f1f5f9;
            color: #0f172a;
            border-color: #94a3b8;
        }
        .webmcp-artifact-close-btn {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: none;
            background: #e2e8f0;
            color: #475569;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
        }
        .webmcp-artifact-close-btn:hover {
            background: #cbd5e1;
            color: #0f172a;
        }
        .webmcp-artifact-kpi-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 12px;
            padding: 14px 24px;
            background: #f1f5f9;
            border-bottom: 1px solid #e2e8f0;
            flex-shrink: 0;
        }
        .webmcp-artifact-kpi-card {
            background: #ffffff;
            border-radius: 10px;
            padding: 10px 14px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }
        .webmcp-artifact-kpi-card.highlight {
            border-color: #818cf8;
            background: #eef2ff;
        }
        .webmcp-kpi-label {
            font-size: 11.5px;
            font-weight: 600;
            color: #64748b;
        }
        .webmcp-kpi-val {
            font-size: 17px;
            font-weight: 800;
            color: #1e293b;
            font-family: monospace;
            margin-top: 4px;
        }
        .webmcp-kpi-val.highlight {
            color: #4338ca;
        }
        .webmcp-kpi-sub {
            font-size: 10.5px;
            color: #94a3b8;
            margin-top: 2px;
        }
        .webmcp-artifact-body {
            flex: 1;
            overflow-y: auto;
            padding: 18px 24px;
        }
        .webmcp-artifact-table-container {
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.03);
        }
        .webmcp-artifact-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12.5px;
        }
        .webmcp-artifact-table thead th {
            background: #f8fafc;
            color: #475569;
            font-weight: 600;
            padding: 10px 12px;
            border-bottom: 1px solid #e2e8f0;
            text-align: left;
            position: sticky;
            top: 0;
            z-index: 2;
        }
        .webmcp-artifact-table tbody tr.art-row {
            border-bottom: 1px solid #f1f5f9;
            transition: background 0.1s ease;
        }
        .webmcp-artifact-table tbody tr.art-row:hover {
            background: #faf5ff;
        }
        .webmcp-artifact-table tbody td {
            padding: 11px 12px;
            vertical-align: middle;
        }
        .art-tag {
            font-size: 10px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 4px;
        }
        .art-tag.proxy {
            background: #fef3c7;
            color: #92400e;
        }
        .art-tag.self {
            background: #e0e7ff;
            color: #4338ca;
        }
        .art-tag.combined {
            background: #dcfce7;
            color: #15803d;
        }
        .art-toggle-legs-btn {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            color: #4338ca;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.15s;
        }
        .art-toggle-legs-btn:hover {
            background: #e0e7ff;
            border-color: #818cf8;
        }
        .art-legs-detail-panel {
            padding: 4px 0;
        }
        .art-legs-detail-title {
            font-size: 12px;
            font-weight: 700;
            color: #334155;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }
        .art-legs-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 8px;
        }
        .art-leg-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .art-leg-seq {
            font-size: 11px;
            font-weight: 700;
            color: #6366f1;
            background: #e0e7ff;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .art-leg-date {
            font-size: 11px;
            color: #475569;
            font-family: monospace;
        }
        .art-leg-route {
            font-size: 12px;
            font-weight: 600;
            color: #0f172a;
            margin: 2px 0;
        }
        .art-leg-pill {
            font-size: 10.5px;
            font-weight: 600;
            background: #eff6ff;
            color: #1d4ed8;
            padding: 2px 6px;
            border-radius: 4px;
            display: inline-block;
        }
        .art-legs-footer {
            margin-top: 8px;
            font-size: 11.5px;
            color: #64748b;
            background: #ffffff;
            padding: 6px 10px;
            border-radius: 6px;
            border: 1px dashed #cbd5e1;
        }
        .webmcp-artifact-footer {
            padding: 14px 24px;
            background: #f8fafc;
            border-top: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        }
        .webmcp-artifact-footer-info {
            font-size: 12px;
            color: #475569;
        }
        .webmcp-artifact-footer-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .webmcp-artifact-btn-secondary {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            color: #475569;
            padding: 8px 18px;
            border-radius: 8px;
            font-size: 12.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
        }
        .webmcp-artifact-btn-secondary:hover {
            background: #f1f5f9;
            color: #0f172a;
        }
        .webmcp-artifact-btn-primary {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border: none;
            color: #ffffff;
            padding: 8px 20px;
            border-radius: 8px;
            font-size: 12.5px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35);
            transition: all 0.15s;
        }
        .webmcp-artifact-btn-primary:hover {
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.5);
            transform: translateY(-1px);
        }

        /* 展开收起切换条与全景 Artifact 快捷按钮 */
        .webmcp-expand-bar {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 6px 0 10px 0;
        }
        .webmcp-expand-toggle-btn {
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            color: #4338ca;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;
        }
        .webmcp-expand-toggle-btn:hover {
            background: #e0e7ff;
            border-color: #818cf8;
            transform: translateY(-1px);
        }
        .webmcp-open-artifact-btn {
            background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
            border: none;
            color: #ffffff;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
            transition: all 0.15s ease;
        }
        .webmcp-open-artifact-btn:hover {
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.45);
            transform: translateY(-1px);
        }

        /* 单卡片内多行明细折叠展示 */
        .webmcp-card-details-toggle {
            font-size: 11px;
            color: #4338ca;
            font-weight: 600;
            cursor: pointer;
            user-select: none;
            margin-left: auto;
        }
        .webmcp-card-details-box {
            margin-top: 8px;
            padding: 8px 10px;
            background: #f8fafc;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            font-size: 11.5px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .webmcp-card-leg-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            color: #334155;
            font-family: monospace;
            font-size: 11px;
        }
        .webmcp-card-leg-tag {
            background: #eff6ff;
            color: #1d4ed8;
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 10.5px;
            font-weight: 600;
        }

        /* ====================================================
           WebMCP A2UI 预算归属交互决策卡片 (Agent-to-User Interface)
           ==================================================== */
        .webmcp-a2ui-card {
            margin: 10px 0;
            padding: 14px 16px;
            background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
            border: 1.5px solid #cbd5e1;
            border-radius: 12px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
            display: flex;
            flex-direction: column;
            gap: 10px;
            position: relative;
            box-sizing: border-box;
        }
        .webmcp-a2ui-header {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .webmcp-a2ui-badge {
            display: inline-flex;
            align-self: flex-start;
            font-size: 10px;
            font-weight: 700;
            color: #4338ca;
            background: #e0e7ff;
            padding: 2px 8px;
            border-radius: 10px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }
        .webmcp-a2ui-title {
            font-size: 13.5px;
            font-weight: 700;
            color: #0f172a;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .webmcp-a2ui-desc {
            font-size: 11.5px;
            color: #64748b;
            line-height: 1.5;
        }
        .webmcp-a2ui-mode-toggle {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 2px;
        }
        .webmcp-a2ui-mode-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 9px 12px;
            border-radius: 8px;
            border: 1.5px solid #e2e8f0;
            background: #ffffff;
            color: #475569;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .webmcp-a2ui-mode-btn:hover {
            border-color: #94a3b8;
            background: #f8fafc;
        }
        .webmcp-a2ui-mode-btn.active {
            border-color: #6366f1;
            background: #eef2ff;
            color: #4338ca;
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.15);
        }
        .webmcp-a2ui-proj-section {
            position: relative;
            margin-top: 2px;
        }
        .webmcp-a2ui-search-box {
            position: relative;
            display: flex;
            align-items: center;
        }
        .webmcp-a2ui-search-icon {
            position: absolute;
            left: 10px;
            font-size: 13px;
            color: #94a3b8;
            pointer-events: none;
        }
        .webmcp-a2ui-search-input {
            width: 100%;
            box-sizing: border-box;
            padding: 8px 30px 8px 32px;
            font-size: 12px;
            border: 1.5px solid #cbd5e1;
            border-radius: 8px;
            background: #ffffff;
            outline: none;
            transition: all 0.15s ease;
            color: #1e293b;
        }
        .webmcp-a2ui-search-input:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }
        .webmcp-a2ui-search-clear {
            position: absolute;
            right: 8px;
            background: transparent;
            border: none;
            color: #94a3b8;
            cursor: pointer;
            font-size: 12px;
            padding: 2px 6px;
        }
        .webmcp-a2ui-search-clear:hover {
            color: #334155;
        }
        .webmcp-a2ui-dropdown {
            position: absolute;
            top: calc(100% + 4px);
            left: 0;
            right: 0;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
            max-height: 180px;
            overflow-y: auto;
            z-index: 1000;
        }
        .webmcp-a2ui-dropdown-loading, .webmcp-a2ui-dropdown-empty {
            padding: 10px 12px;
            font-size: 11.5px;
            color: #64748b;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .webmcp-a2ui-dropdown-item {
            padding: 8px 12px;
            font-size: 12px;
            color: #1e293b;
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            border-bottom: 1px solid #f1f5f9;
            transition: background 0.1s ease;
        }
        .webmcp-a2ui-dropdown-item:last-child {
            border-bottom: none;
        }
        .webmcp-a2ui-dropdown-item:hover {
            background: #f8fafc;
            color: #4338ca;
        }
        .webmcp-a2ui-item-code {
            font-family: monospace;
            font-size: 10.5px;
            color: #6366f1;
            background: #eef2ff;
            padding: 1px 5px;
            border-radius: 4px;
            font-weight: 600;
        }
        .webmcp-a2ui-item-name {
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .webmcp-a2ui-selected-chip {
            display: flex;
            align-items: center;
            gap: 8px;
            background: #ecfdf5;
            border: 1px solid #a7f3d0;
            border-radius: 6px;
            padding: 5px 10px;
            font-size: 11.5px;
            color: #065f46;
            margin-top: 6px;
        }
        .webmcp-a2ui-chip-remove {
            margin-left: auto;
            background: transparent;
            border: none;
            color: #059669;
            font-size: 11px;
            cursor: pointer;
            text-decoration: underline;
        }
        .webmcp-a2ui-status-bar {
            font-size: 11px;
            color: #64748b;
            background: #f1f5f9;
            padding: 6px 10px;
            border-radius: 6px;
            border-left: 3px solid #94a3b8;
        }
        .webmcp-a2ui-status-bar.success {
            color: #166534;
            background: #f0fdf4;
            border-left-color: #22c55e;
        }
        .webmcp-a2ui-status-bar.warn {
            color: #92400e;
            background: #fffbeb;
            border-left-color: #f59e0b;
        }
        .webmcp-trip-project-badge {
            background: #f5f3ff;
            color: #7c3aed;
            font-size: 11px;
            font-weight: 600;
            padding: 2px 7px;
            border-radius: 6px;
            border: 1px solid #ddd6fe;
        }
        .webmcp-trip-dept-badge {
            background: #f8fafc;
            color: #64748b;
            font-size: 11px;
            font-weight: 500;
            padding: 2px 7px;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
        }

        /* ====================================================
           A2UI 声明式 AST 组件增强样式
           ==================================================== */
        .webmcp-a2ui-alert {
            padding: 9px 12px;
            border-radius: 8px;
            font-size: 11.5px;
            display: flex;
            align-items: flex-start;
            gap: 8px;
            line-height: 1.45;
            box-sizing: border-box;
        }
        .webmcp-a2ui-alert.info {
            background: #eff6ff;
            color: #1e40af;
            border: 1px solid #bfdbfe;
        }
        .webmcp-a2ui-alert.success {
            background: #f0fdf4;
            color: #166534;
            border: 1px solid #bbf7d0;
        }
        .webmcp-a2ui-alert.warn {
            background: #fffbeb;
            color: #92400e;
            border: 1px solid #fde68a;
        }
        .webmcp-a2ui-alert.error {
            background: #fef2f2;
            color: #991b1b;
            border: 1px solid #fecaca;
        }

        .webmcp-a2ui-timeline {
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 9px 10px;
            max-height: 200px;
            overflow-y: auto;
            box-sizing: border-box;
        }
        .webmcp-a2ui-timeline-item {
            display: flex;
            align-items: center;
            gap: 8px;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 6px 10px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
            font-size: 11px;
            transition: all 0.15s ease;
        }
        .webmcp-a2ui-timeline-item:hover {
            border-color: #6366f1;
            box-shadow: 0 2px 6px rgba(99, 102, 241, 0.1);
        }
        .webmcp-a2ui-wave-badge {
            background: #e0e7ff;
            color: #4338ca;
            font-size: 10px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            white-space: nowrap;
        }
        .webmcp-a2ui-wave-date {
            font-weight: 600;
            color: #0f172a;
            white-space: nowrap;
            font-size: 11px;
        }
        .webmcp-a2ui-wave-dest {
            background: #ecfdf5;
            color: #059669;
            padding: 1.5px 5px;
            border-radius: 4px;
            font-weight: 600;
            white-space: nowrap;
            font-size: 10.5px;
        }
        .webmcp-a2ui-wave-hotel {
            color: #475569;
            white-space: nowrap;
            font-size: 11px;
            font-weight: 500;
        }
        .webmcp-a2ui-wave-customer {
            color: #64748b;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
            font-size: 11px;
        }

        .webmcp-a2ui-grid {
            display: grid;
            gap: 8px;
            margin: 4px 0;
            box-sizing: border-box;
        }
        .webmcp-a2ui-field {
            display: flex;
            flex-direction: column;
            gap: 3px;
            font-size: 11.5px;
        }
        .webmcp-a2ui-label {
            font-weight: 600;
            color: #475569;
            font-size: 11.5px;
        }
        .webmcp-a2ui-input {
            width: 100%;
            box-sizing: border-box;
            padding: 6px 10px;
            font-size: 11.5px;
            border: 1.5px solid #cbd5e1;
            border-radius: 6px;
            background: #ffffff;
            outline: none;
            transition: all 0.15s ease;
            color: #1e293b;
        }
        .webmcp-a2ui-input:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
        }

        /* ====================================================
           会话历史抽屉 (Session History Drawer)
           ==================================================== */
        .webmcp-history-backdrop {
            position: absolute;
            inset: 0;
            background: rgba(15, 23, 42, 0.35);
            backdrop-filter: blur(2px);
            z-index: 100010;
            opacity: 0;
            transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
        }
        .webmcp-history-backdrop.is-open {
            opacity: 1;
            pointer-events: auto;
        }
        .webmcp-history-drawer {
            position: absolute;
            top: 0;
            left: 0;
            bottom: 0;
            width: 320px;
            max-width: 85%;
            background: #ffffff;
            box-shadow: 8px 0 28px rgba(15, 23, 42, 0.18);
            border-right: 1px solid var(--wm-border);
            z-index: 100015;
            display: flex;
            flex-direction: column;
            transform: translateX(-102%);
            transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
            box-sizing: border-box;
            user-select: none;
        }
        .webmcp-history-drawer.is-open {
            transform: translateX(0);
        }

        /* 历史抽屉头部 */
        .webmcp-history-header {
            padding: 12px 14px;
            border-bottom: 1px solid var(--wm-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #f8fafc;
            flex-shrink: 0;
        }
        .webmcp-history-header-left {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .webmcp-history-title {
            font-size: 13.5px;
            font-weight: 700;
            color: #0f172a;
        }
        .webmcp-history-badge {
            background: #e2e8f0;
            color: #475569;
            font-size: 10.5px;
            font-weight: 600;
            padding: 1.5px 6px;
            border-radius: 10px;
        }
        .webmcp-history-header-right {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .webmcp-history-btn-new {
            background: var(--wm-primary-gradient);
            color: #ffffff;
            border: none;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.15s;
            box-shadow: 0 1px 4px rgba(99, 102, 241, 0.3);
        }
        .webmcp-history-btn-new:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 6px rgba(99, 102, 241, 0.45);
        }
        .webmcp-history-btn-close {
            background: transparent;
            border: none;
            color: #64748b;
            font-size: 14px;
            cursor: pointer;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: all 0.15s;
        }
        .webmcp-history-btn-close:hover {
            background: #e2e8f0;
            color: #0f172a;
        }

        /* 搜索与筛选栏 */
        .webmcp-history-search-bar {
            padding: 8px 12px;
            background: #ffffff;
            border-bottom: 1px solid var(--wm-border-subtle);
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }
        .webmcp-history-search-wrapper {
            position: relative;
            flex: 1;
            display: flex;
            align-items: center;
        }
        .webmcp-history-search-icon {
            position: absolute;
            left: 8px;
            font-size: 11px;
            color: #94a3b8;
            pointer-events: none;
        }
        .webmcp-history-search-wrapper input {
            width: 100%;
            padding: 5px 24px 5px 26px;
            font-size: 11.5px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            background: #f8fafc;
            outline: none;
            transition: all 0.15s;
            color: #1e293b;
            box-sizing: border-box;
        }
        .webmcp-history-search-wrapper input:focus {
            background: #ffffff;
            border-color: #6366f1;
            box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
        }
        .webmcp-history-search-clear {
            position: absolute;
            right: 6px;
            font-size: 11px;
            color: #94a3b8;
            cursor: pointer;
            padding: 2px;
        }
        .webmcp-history-search-clear:hover {
            color: #0f172a;
        }
        .webmcp-history-filter-chip {
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            color: #64748b;
            font-size: 11px;
            font-weight: 600;
            padding: 4px 7px;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 3px;
            white-space: nowrap;
            transition: all 0.15s;
        }
        .webmcp-history-filter-chip:hover {
            background: #e2e8f0;
            color: #1e293b;
        }
        .webmcp-history-filter-chip.active {
            background: #ede9fe;
            color: #6366f1;
            border-color: #a5b4fc;
        }

        /* 历史列表区 */
        .webmcp-history-list {
            flex: 1;
            overflow-y: auto;
            padding: 6px 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .webmcp-history-group-title {
            padding: 6px 6px 2px 6px;
            font-size: 10.5px;
            font-weight: 700;
            color: #64748b;
            letter-spacing: 0.3px;
            text-transform: uppercase;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        /* 历史卡片项 */
        .webmcp-history-item {
            padding: 8px 10px;
            border-radius: 8px;
            background: #ffffff;
            border: 1px solid transparent;
            cursor: pointer;
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            transition: all 0.15s ease;
            position: relative;
            gap: 6px;
        }
        .webmcp-history-item:hover {
            background: #f8fafc;
            border-color: #e2e8f0;
        }
        .webmcp-history-item.active {
            background: #f5f3ff;
            border-color: #c7d2fe;
            box-shadow: 0 1px 4px rgba(99, 102, 241, 0.08);
        }
        .webmcp-history-item-main {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .webmcp-history-item-top {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .webmcp-history-item-title {
            font-size: 12px;
            font-weight: 600;
            color: #1e293b;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
        }
        .webmcp-history-item.active .webmcp-history-item-title {
            color: #4f46e5;
        }
        .webmcp-history-active-tag {
            background: #10b981;
            color: #ffffff;
            font-size: 9.5px;
            font-weight: 700;
            padding: 1px 4px;
            border-radius: 4px;
            white-space: nowrap;
        }
        .webmcp-history-pin-badge {
            font-size: 10px;
        }
        .webmcp-history-item-preview {
            font-size: 11px;
            color: #64748b;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            line-height: 1.3;
        }
        .webmcp-history-item-meta {
            font-size: 10px;
            color: #94a3b8;
            display: flex;
            align-items: center;
            gap: 4px;
            margin-top: 1px;
        }

        /* 悬浮操作按钮组 */
        .webmcp-history-item-actions {
            display: none;
            align-items: center;
            gap: 2px;
            flex-shrink: 0;
        }
        .webmcp-history-item:hover .webmcp-history-item-actions {
            display: flex;
        }
        .webmcp-history-action-btn {
            background: transparent;
            border: none;
            padding: 2px 4px;
            font-size: 11px;
            border-radius: 4px;
            cursor: pointer;
            color: #64748b;
            transition: all 0.12s;
        }
        .webmcp-history-action-btn:hover {
            background: #e2e8f0;
            color: #0f172a;
        }
        .webmcp-history-action-btn.danger:hover {
            background: #fee2e2;
            color: #ef4444;
        }
        .webmcp-history-rename-input {
            width: 100%;
            padding: 2px 6px;
            font-size: 12px;
            font-weight: 600;
            border: 1.5px solid #6366f1;
            border-radius: 4px;
            outline: none;
            box-sizing: border-box;
            background: #ffffff;
            color: #1e293b;
        }

        .webmcp-history-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 10px;
            text-align: center;
            gap: 6px;
        }

        /* 底部工具条 */
        .webmcp-history-footer {
            padding: 8px 10px;
            background: #f8fafc;
            border-top: 1px solid var(--wm-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            flex-shrink: 0;
        }
        .webmcp-history-footer-btn {
            flex: 1;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            color: #475569;
            font-size: 11px;
            font-weight: 600;
            padding: 5px 0;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            transition: all 0.15s;
        }
        .webmcp-history-footer-btn:hover {
            background: #f1f5f9;
            color: #0f172a;
            border-color: #94a3b8;
        }
        .webmcp-history-footer-btn.danger:hover {
            background: #fef2f2;
            color: #dc2626;
            border-color: #fca5a5;
        }
    `;
    document.head.appendChild(style);
}
