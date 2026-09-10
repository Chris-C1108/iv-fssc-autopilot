export function injectApplicationStyles() {
    const styleId = 'autopilot-trip-app-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* 批量申请单悬浮入口胶囊 */
        .trip-app-launcher-btn {
            position: fixed;
            bottom: 85px;
            right: 25px;
            z-index: 99999;
            background: linear-gradient(135deg, #0ea5e9 0%, #3b82f6 50%, #6366f1 100%);
            color: #ffffff;
            font-size: 13px;
            font-weight: 600;
            padding: 10px 18px;
            border-radius: 30px;
            box-shadow: 0 8px 24px rgba(14, 165, 233, 0.45);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            border: 1px solid rgba(255, 255, 255, 0.3);
            user-select: none;
        }
        .trip-app-launcher-btn:hover {
            transform: translateY(-3px) scale(1.02);
            box-shadow: 0 12px 28px rgba(14, 165, 233, 0.6);
        }
        .trip-app-launcher-badge {
            background: rgba(255, 255, 255, 0.25);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
        }

        /* 模态弹窗遮罩 */
        .trip-app-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(15, 23, 42, 0.65);
            backdrop-filter: blur(8px);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: tripModalFadeIn 0.25s ease-out;
        }
        @keyframes tripModalFadeIn {
            from { opacity: 0; transform: scale(0.98); }
            to { opacity: 1; transform: scale(1); }
        }

        /* 模态主容器 */
        .trip-app-modal-container {
            width: 95vw;
            max-width: 1320px;
            height: 88vh;
            background: #ffffff;
            border-radius: 16px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid #e2e8f0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #1e293b;
        }

        /* 头部 */
        .trip-app-header {
            padding: 16px 24px;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid #334155;
        }
        .trip-app-header-title {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 17px;
            font-weight: 700;
            letter-spacing: 0.3px;
        }
        .trip-app-header-tag {
            background: linear-gradient(135deg, #0ea5e9, #3b82f6);
            color: #fff;
            padding: 2px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
        }
        .trip-app-close-btn {
            background: transparent;
            border: none;
            color: #94a3b8;
            font-size: 22px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 6px;
            transition: all 0.2s;
        }
        .trip-app-close-btn:hover {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.1);
        }

        /* 统计指示栏 */
        .trip-app-stat-bar {
            padding: 14px 24px;
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            flex-wrap: wrap;
        }
        .trip-app-stat-group {
            display: flex;
            align-items: center;
            gap: 20px;
        }
        .trip-app-stat-item {
            display: flex;
            flex-direction: column;
        }
        .trip-app-stat-label {
            font-size: 11px;
            color: #64748b;
            font-weight: 500;
        }
        .trip-app-stat-value {
            font-size: 16px;
            font-weight: 700;
            color: #0f172a;
        }
        .trip-app-stat-value.highlight {
            color: #0284c7;
        }

        /* 控制选项栏 */
        .trip-app-ctrl-bar {
            padding: 10px 24px;
            background: #ffffff;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }
        .trip-app-filter-tabs {
            display: flex;
            background: #f1f5f9;
            padding: 3px;
            border-radius: 8px;
            gap: 4px;
        }
        .trip-app-filter-tab {
            padding: 6px 14px;
            font-size: 12px;
            font-weight: 600;
            color: #64748b;
            background: transparent;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .trip-app-filter-tab.active {
            background: #ffffff;
            color: #0284c7;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .trip-app-buffer-settings {
            display: flex;
            align-items: center;
            gap: 16px;
            font-size: 12px;
            color: #475569;
        }
        .trip-app-buffer-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .trip-app-buffer-input {
            width: 60px;
            padding: 4px 6px;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            color: #0f172a;
            text-align: center;
        }

        /* 操作按钮组 */
        .trip-app-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .trip-btn {
            padding: 8px 16px;
            font-size: 12px;
            font-weight: 600;
            border-radius: 8px;
            border: 1px solid transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .trip-btn-primary {
            background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
            color: #ffffff;
            box-shadow: 0 2px 8px rgba(2, 132, 199, 0.35);
        }
        .trip-btn-primary:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(2, 132, 199, 0.45);
        }
        .trip-btn-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .trip-btn-secondary {
            background: #f8fafc;
            border-color: #cbd5e1;
            color: #475569;
        }
        .trip-btn-secondary:hover {
            background: #f1f5f9;
            color: #0f172a;
        }

        /* 表格区域 */
        .trip-app-table-wrapper {
            flex: 1;
            overflow-y: auto;
            padding: 0 24px;
        }
        .trip-app-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            margin-top: 10px;
        }
        .trip-app-table th {
            position: sticky;
            top: 0;
            background: #f8fafc;
            color: #475569;
            font-weight: 600;
            padding: 10px 8px;
            text-align: left;
            border-bottom: 2px solid #e2e8f0;
            z-index: 10;
        }
        .trip-app-table td {
            padding: 10px 8px;
            border-bottom: 1px solid #f1f5f9;
            vertical-align: middle;
        }
        .trip-app-table tr:hover td {
            background: #f8fafc;
        }

        /* 徽章 */
        .trip-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
        }
        .trip-badge-self {
            background: #e0f2fe;
            color: #0369a1;
        }
        .trip-badge-proxy {
            background: #fef3c7;
            color: #92400e;
        }
        .trip-badge-status-ready {
            background: #f1f5f9;
            color: #475569;
        }
        .trip-badge-combined {
            background: #ecfdf5;
            color: #047857;
            border: 1px solid #a7f3d0;
        }
        .trip-legs-toggle-btn {
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            color: #0369a1;
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 10px;
            cursor: pointer;
            margin-left: 4px;
            transition: all 0.15s;
        }
        .trip-legs-toggle-btn:hover {
            background: #e0f2fe;
            border-color: #38bdf8;
        }
        .trip-legs-preview-box {
            background: #f8fafc;
            border: 1px dashed #cbd5e1;
            border-radius: 6px;
            padding: 6px 10px;
            margin-top: 6px;
            font-size: 11px;
            line-height: 1.6;
        }
        .trip-leg-item-row {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #334155;
            padding: 2px 0;
            border-bottom: 1px solid #f1f5f9;
        }
        .trip-leg-item-row:last-child {
            border-bottom: none;
        }
        .trip-leg-flight-pill {
            background: #e0e7ff;
            color: #3730a3;
            font-weight: 600;
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 10px;
        }
        .trip-badge-status-busy {
            background: #e0f2fe;
            color: #0284c7;
            animation: pulse 1.5s infinite;
        }
        .trip-badge-status-done {
            background: #dcfce7;
            color: #15803d;
        }
        .trip-badge-status-fail {
            background: #fee2e2;
            color: #b91c1c;
        }

        /* 底部日志与进度 */
        .trip-app-footer {
            padding: 12px 24px;
            background: #f8fafc;
            border-top: 1px solid #e2e8f0;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .trip-app-progress-bar-bg {
            width: 100%;
            height: 6px;
            background: #e2e8f0;
            border-radius: 3px;
            overflow: hidden;
        }
        .trip-app-progress-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #0ea5e9, #3b82f6);
            width: 0%;
            transition: width 0.3s ease;
        }
        .trip-app-log-text {
            font-size: 11px;
            color: #64748b;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    `;
    document.head.appendChild(style);
}
