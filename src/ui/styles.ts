export const MODAL_STYLES = `
    /* 主悬浮按钮 */
    #yn-batch-helper-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        background: linear-gradient(135deg, #1890ff, #096dd9);
        color: #fff;
        border: none;
        border-radius: 24px;
        padding: 10px 20px;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(24, 144, 255, 0.4);
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        gap: 8px;
    }
    #yn-batch-helper-btn:hover {
        transform: translateY(-2px) scale(1.02);
        box-shadow: 0 6px 16px rgba(24, 144, 255, 0.5);
    }
    .yn-badge {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: #52c41a;
        display: inline-block;
    }
    .yn-badge.offline { background: #ff4d4f; }

    /* 模态框遮罩 */
    #yn-modal-mask {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 999998;
        display: none;
        backdrop-filter: blur(2px);
    }

    /* 模态框主体 */
    #yn-batch-modal {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 92vw;
        max-width: 1440px;
        height: 88vh;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
        z-index: 999999;
        display: none;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    /* 头部 */
    .yn-header {
        padding: 14px 20px;
        border-bottom: 1px solid #f0f0f0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #fafafa;
    }
    .yn-header h3 {
        margin: 0;
        font-size: 16px;
        color: #262626;
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .yn-close-btn {
        background: transparent;
        border: none;
        font-size: 20px;
        color: #8c8c8c;
        cursor: pointer;
    }
    .yn-close-btn:hover { color: #262626; }

    /* 内容区 */
    .yn-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 12px 20px;
        overflow: hidden;
        background: #fdfdfd;
    }

    /* 工具栏 */
    .yn-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
    }
    .yn-toolbar-left {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    /* 分类标签页 */
    .yn-group-tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
        border-bottom: 1px solid #e8e8e8;
        padding-bottom: 8px;
    }
    .yn-tab-btn {
        background: #f5f5f5;
        border: 1px solid #d9d9d9;
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .yn-tab-btn.active {
        background: #1890ff;
        color: #fff;
        border-color: #1890ff;
        font-weight: bold;
    }
    .yn-tab-count {
        background: rgba(0, 0, 0, 0.08);
        padding: 1px 6px;
        border-radius: 10px;
        font-size: 11px;
    }
    .yn-tab-btn.active .yn-tab-count {
        background: rgba(255, 255, 255, 0.25);
        color: #fff;
    }

    /* TAG 标签云 */
    .yn-tag-cloud {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 10px;
        padding: 8px 12px;
        background: #f6ffed;
        border: 1px solid #b7eb8f;
        border-radius: 6px;
    }
    .yn-tag-chip {
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: bold;
        background: #fff;
        border: 1px solid #d9d9d9;
        color: #595959;
        cursor: pointer;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .yn-tag-chip:hover, .yn-tag-chip.active {
        background: #52c41a;
        color: #fff;
        border-color: #52c41a;
    }
    .yn-tag-count {
        background: rgba(0, 0, 0, 0.08);
        padding: 1px 5px;
        border-radius: 8px;
        font-size: 10.5px;
    }
    .yn-tag-chip.active .yn-tag-count {
        background: rgba(255, 255, 255, 0.3);
        color: #fff;
    }

    /* 快捷配置栏 */
    .yn-quick-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #e6f7ff;
        border: 1px solid #91d5ff;
        border-radius: 6px;
        margin-bottom: 10px;
        flex-wrap: wrap;
        font-size: 13px;
    }
    .yn-quick-bar input, .yn-quick-bar select {
        padding: 4px 8px;
        border: 1px solid #d9d9d9;
        border-radius: 4px;
        font-size: 12.5px;
        outline: none;
    }

    /* 表格区域 */
    .yn-table-container {
        flex: 1;
        overflow: auto;
        border: 1px solid #e8e8e8;
        border-radius: 6px;
        background: #fff;
    }
    .yn-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
        text-align: left;
    }
    .yn-table th {
        background: #fafafa;
        color: #595959;
        font-weight: 600;
        padding: 10px 8px;
        border-bottom: 1px solid #e8e8e8;
        position: sticky;
        top: 0;
        z-index: 10;
    }
    .yn-table td {
        padding: 8px;
        border-bottom: 1px solid #f0f0f0;
        color: #262626;
    }
    .yn-table tr:hover { background: #fafafa; }
    .yn-table tr.selected { background: #f6ffed; }

    .yn-type-select {
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
    }
    .type-taxi { border: 1px solid #9C61FF; color: #9C61FF; }
    .type-comm { border: 1px solid #2B85FF; color: #2B85FF; }

    .yn-time-badge {
        font-family: monospace;
        font-size: 11.5px;
        color: #595959;
    }
    .yn-time-highlight { font-weight: bold; color: #1890ff; }
    .yn-swap-btn {
        background: #f0f0f0;
        border: 1px solid #d9d9d9;
        border-radius: 3px;
        cursor: pointer;
        padding: 1px 5px;
        font-size: 12px;
    }
    .yn-dropzone {
        border: 1px dashed #1890ff;
        background: #f0f5ff;
        padding: 3px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11.5px;
        color: #1890ff;
        text-align: center;
    }

    /* 状态标签 */
    .yn-status-tag {
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 10px;
        display: inline-block;
    }
    .yn-status-success { background: #f6ffed; color: #52c41a; }
    .yn-status-error { background: #fff2f0; color: #ff4d4f; }
    .yn-status-pending { background: #fafafa; color: #8c8c8c; }

    /* 底部操作区 */
    .yn-footer {
        padding: 12px 20px;
        border-top: 1px solid #f0f0f0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #fafafa;
    }
    .yn-progress-bar-wrap {
        flex: 1;
        margin-right: 20px;
        display: none;
    }
    .yn-progress-bar {
        height: 6px;
        width: 100%;
        background: #f5f5f5;
        border-radius: 3px;
        overflow: hidden;
    }
    .yn-progress-inner {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #52c41a, #1890ff);
        transition: width 0.2s;
    }
    .yn-log-box {
        font-size: 12px;
        color: #8c8c8c;
        margin-top: 4px;
    }

    .yn-btn {
        background: #fff;
        color: #595959;
        border: 1px solid #d9d9d9;
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
    }
    .yn-btn:hover { border-color: #1890ff; color: #1890ff; }
    .yn-btn-primary {
        background: #1890ff;
        color: #fff;
        border-color: #1890ff;
    }
    .yn-btn-primary:hover { background: #40a9ff; }
    .yn-btn-success {
        background: #52c41a;
        color: #fff;
        border-color: #52c41a;
    }
    .yn-btn-success:hover { background: #73d13d; }
    .yn-btn-smart {
        background: #722ed1;
        color: #fff;
        border-color: #722ed1;
    }
    .yn-btn-smart:hover { background: #9254de; }
    .yn-btn:disabled {
        background: #d9d9d9 !important;
        border-color: #d9d9d9 !important;
        color: #8c8c8c !important;
        cursor: not-allowed !important;
    }
`;

export function injectStyles() {
    if (document.getElementById('yn-injected-styles')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'yn-injected-styles';
    styleEl.innerHTML = MODAL_STYLES;
    document.head.appendChild(styleEl);
}
