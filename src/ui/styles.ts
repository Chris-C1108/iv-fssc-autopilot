import { BATCH_EDIT_EXPENSE_STYLES } from './batchEditExpenseStyles';
import { getBillManagementStyles } from './billManagementStyles';

export const MODAL_STYLES = `
    ${BATCH_EDIT_EXPENSE_STYLES}
    ${getBillManagementStyles()}

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

    /* ========================================== */
    /* 发票夹原生页面高亮与残缺字段徽标标注 (Zero Reflow & Non-intrusive) */
    /* ========================================== */
    .yn-invoice-row-error {
        background-color: #fff1f0 !important;
        box-shadow: inset 3px 0 0 #ff4d4f !important;
        transition: background-color 0.15s ease;
    }
    .yn-invoice-row-error:hover {
        background-color: #ffeef0 !important;
    }
    .yn-invoice-row-warning {
        background-color: #fffbe6 !important;
        box-shadow: inset 3px 0 0 #fa8c16 !important;
        transition: background-color 0.15s ease;
    }
    .yn-invoice-row-warning:hover {
        background-color: #fff8d6 !important;
    }

    /* 单元格行内紧凑徽标 (Compact Badge: 紧凑行内、不撑高单元格、不折行) */
    .yn-invoice-badge {
        display: inline-block !important;
        white-space: nowrap !important;
        font-size: 11px !important;
        line-height: 16px !important;
        height: 16px !important;
        padding: 0 4px !important;
        border-radius: 3px !important;
        font-weight: 600 !important;
        margin-left: 4px !important;
        vertical-align: middle !important;
        user-select: none !important;
        cursor: help !important;
        box-sizing: border-box !important;
    }
    .yn-badge-error {
        background: #fff1f0 !important;
        color: #cf1322 !important;
        border: 1px solid #ffa39e !important;
    }
    .yn-badge-warning {
        background: #fffbe6 !important;
        color: #d46b08 !important;
        border: 1px solid #ffe58f !important;
    }
    .yn-badge-info {
        background: #e6f7ff !important;
        color: #096dd9 !important;
        border: 1px solid #91d5ff !important;
    }

    /* 操作列「修改」原位行内强化 (纯文本高亮，零边距扩充，绝不换行，绝无抽搐动画) */
    .yn-btn-modify-highlight,
    .yn-btn-modify-error {
        display: inline !important;
        color: #ff4d4f !important;
        font-weight: bold !important;
        text-decoration: underline !important;
        text-underline-offset: 2px !important;
        transition: color 0.15s ease !important;
        margin: 0 !important;
        padding: 0 !important;
    }
    .yn-btn-modify-highlight:hover,
    .yn-btn-modify-error:hover {
        color: #cf1322 !important;
    }

    .yn-btn-modify-warning {
        display: inline !important;
        color: #fa8c16 !important;
        font-weight: 600 !important;
        text-decoration: underline !important;
        text-underline-offset: 2px !important;
        transition: color 0.15s ease !important;
        margin: 0 !important;
        padding: 0 !important;
    }
    .yn-btn-modify-warning:hover {
        color: #d46b08 !important;
    }

    /* 发票夹快捷批量生成费用记录按钮 */
    .yn-btn-create-expense-pool {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin-left: 12px;
        margin-right: 0px;
        padding: 4px 14px;
        height: 28px;
        font-size: 12.5px;
        font-weight: 600;
        border-radius: 5px;
        border: 1px solid #1890ff;
        background: linear-gradient(135deg, #1890ff 0%, #096dd9 100%);
        color: #ffffff;
        cursor: pointer;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        vertical-align: middle;
        box-shadow: 0 2px 4px rgba(24, 144, 255, 0.2);
        white-space: nowrap;
        user-select: none;
    }
    .yn-btn-create-expense-pool:hover:not(:disabled) {
        background: linear-gradient(135deg, #40a9ff 0%, #1890ff 100%);
        border-color: #40a9ff;
        box-shadow: 0 3px 8px rgba(24, 144, 255, 0.35);
        transform: translateY(-1px);
    }
    .yn-btn-create-expense-pool:active:not(:disabled) {
        background: #096dd9;
        border-color: #096dd9;
        transform: translateY(0);
        box-shadow: 0 1px 2px rgba(24, 144, 255, 0.2);
    }
    .yn-btn-create-expense-pool:disabled {
        opacity: 0.65;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
    }

    /* 费用记录页导出核对清单按钮 */
    .yn-btn-export-expense-records {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        margin-left: 8px !important;
        padding: 0 14px !important;
        height: 28px !important;
        line-height: 26px !important;
        font-size: 12.5px !important;
        font-weight: 600 !important;
        border-radius: 4px !important;
        border: 1px solid #059669 !important;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
        color: #ffffff !important;
        cursor: pointer !important;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        vertical-align: middle !important;
        box-shadow: 0 2px 4px rgba(16, 185, 129, 0.25) !important;
        white-space: nowrap !important;
        user-select: none !important;
    }
    .yn-btn-export-expense-records:hover:not(:disabled) {
        background: linear-gradient(135deg, #34d399 0%, #10b981 100%) !important;
        border-color: #10b981 !important;
        color: #ffffff !important;
        box-shadow: 0 3px 8px rgba(16, 185, 129, 0.38) !important;
        transform: translateY(-1px) !important;
    }
    .yn-btn-export-expense-records:active:not(:disabled) {
        background: #047857 !important;
        border-color: #047857 !important;
        transform: translateY(0) !important;
        box-shadow: 0 1px 2px rgba(16, 185, 129, 0.2) !important;
    }
    .yn-btn-export-expense-records:disabled,
    .yn-btn-export-expense-records.is-loading {
        opacity: 0.7 !important;
        cursor: not-allowed !important;
        box-shadow: none !important;
        transform: none !important;
    }

    /* 费用记录页一键展开全部记录按钮 */
    .yn-btn-load-all-expense-records {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        margin-left: 8px !important;
        padding: 0 12px !important;
        height: 28px !important;
        line-height: 26px !important;
        font-size: 12.5px !important;
        font-weight: 600 !important;
        border-radius: 4px !important;
        border: 1px solid #1d4ed8 !important;
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%) !important;
        color: #ffffff !important;
        cursor: pointer !important;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        vertical-align: middle !important;
        box-shadow: 0 2px 4px rgba(59, 130, 246, 0.25) !important;
        white-space: nowrap !important;
        user-select: none !important;
    }
    .yn-btn-load-all-expense-records:hover:not(:disabled) {
        background: linear-gradient(135deg, #60a5fa 0%, #2563eb 100%) !important;
        border-color: #2563eb !important;
        color: #ffffff !important;
        box-shadow: 0 3px 8px rgba(59, 130, 246, 0.38) !important;
        transform: translateY(-1px) !important;
    }
    .yn-btn-load-all-expense-records:active:not(:disabled) {
        background: #1e40af !important;
        border-color: #1e40af !important;
        transform: translateY(0) !important;
        box-shadow: 0 1px 2px rgba(59, 130, 246, 0.2) !important;
    }
    .yn-btn-load-all-expense-records:disabled,
    .yn-btn-load-all-expense-records.is-loading {
        opacity: 0.7 !important;
        cursor: not-allowed !important;
        box-shadow: none !important;
        transform: none !important;
    }

    .yn-btn-create-expense-pool.is-loading {
        pointer-events: none;
        opacity: 0.85;
    }

    /* 发票夹工具栏体检操作组 */
    .yn-invoice-audit-toolbar {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-left: 8px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 3px 10px;
        vertical-align: middle;
    }
    .yn-audit-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid #d9d9d9;
        border-radius: 4px;
        padding: 2px 10px;
        background: #ffffff;
        color: #334155;
        cursor: pointer;
        transition: all 0.2s;
    }
    .yn-audit-btn:hover {
        border-color: #1890ff;
        color: #1890ff;
    }
    .yn-audit-btn.has-issues {
        background: #fff1f0;
        color: #cf1322;
        border-color: #ffa39e;
    }
    .yn-audit-btn.has-issues:hover {
        background: #ffccc7;
        border-color: #ff4d4f;
    }
    .yn-audit-filter-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 500;
        color: #475569;
        cursor: pointer;
        user-select: none;
    }
    .yn-audit-filter-toggle input[type="checkbox"] {
        cursor: pointer;
        accent-color: #ff4d4f;
    }

    /* 快捷每页条数切换器 (支持 20 / 50 / 100 / 200) */
    .yn-page-size-selector {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11.5px;
        color: #64748b;
        margin-left: 8px;
        padding-left: 8px;
        border-left: 1px solid #e2e8f0;
    }
    .yn-page-size-btn {
        display: inline-block;
        padding: 1px 6px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid #d9d9d9;
        border-radius: 4px;
        background: #ffffff;
        color: #475569;
        cursor: pointer;
        transition: all 0.15s ease;
        line-height: 16px;
    }
    .yn-page-size-btn:hover {
        border-color: #40a9ff;
        color: #1890ff;
    }
    .yn-page-size-btn.active {
        background: #1890ff;
        color: #ffffff;
        border-color: #1890ff;
        font-weight: 600;
    }

    /* 发票详情/编辑弹窗体检警示横幅 (Modal Alert Banner) */
    .yn-modal-alert-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 14px;
        margin: 8px 16px 12px 16px;
        border-radius: 6px;
        font-size: 12.5px;
        line-height: 1.5;
        font-weight: 500;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
        animation: yn-fade-in 0.2s ease;
    }
    .yn-modal-alert-banner.yn-alert-warning {
        background: #fffbe6;
        border: 1px solid #ffe58f;
        color: #d46b08;
    }
    .yn-modal-alert-banner.yn-alert-error {
        background: #fff1f0;
        border: 1px solid #ffa39e;
        color: #cf1322;
    }
    .yn-modal-alert-banner .yn-banner-btn {
        background: #fa8c16;
        color: #fff;
        border: none;
        border-radius: 4px;
        padding: 2px 10px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s;
    }
    .yn-modal-alert-banner .yn-banner-btn:hover {
        background: #d46b08;
    }

    /* 弹窗内输入框残缺字段原位高亮 (Soft border alert in edit modal) */
    .yn-input-highlight-issue {
        border-color: #fa8c16 !important;
        background-color: #fffbe6 !important;
        box-shadow: 0 0 0 2px rgba(250, 140, 22, 0.2) !important;
        transition: all 0.2s ease !important;
    }
    .yn-input-highlight-issue:focus {
        border-color: #ff4d4f !important;
        box-shadow: 0 0 0 2px rgba(255, 77, 79, 0.25) !important;
    }

    @keyframes yn-fade-in {
        from { opacity: 0; transform: translateY(-3px); }
        to { opacity: 1; transform: translateY(0); }
    }

    /* 全局浮动批量修改费用按钮 (Entry Node - Linear/Vercel Design) */
    .yn-floating-batch-edit-btn {
        position: fixed !important;
        right: 24px !important;
        bottom: 24px !important;
        z-index: 99999 !important;
        height: 40px !important;
        padding: 0 16px !important;
        background: #0f172a !important;
        color: #ffffff !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        border-radius: 20px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        box-shadow: 0 8px 24px -4px rgba(15, 23, 42, 0.4), 0 2px 6px -1px rgba(15, 23, 42, 0.2) !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        user-select: none !important;
        backdrop-filter: blur(8px) !important;
    }
    .yn-floating-batch-edit-btn:hover {
        transform: translateY(-2px) scale(1.02) !important;
        background: #1e293b !important;
        box-shadow: 0 12px 28px -4px rgba(15, 23, 42, 0.5), 0 4px 8px -1px rgba(15, 23, 42, 0.25) !important;
    }
    .yn-floating-batch-edit-btn:active {
        transform: translateY(0) scale(0.98) !important;
    }

    /* 费用报销状态标签 (未报销 / 报销中 / 已报销) */
    .yn-bem-status-tag {
        display: inline-block;
        font-size: 10px;
        font-weight: 600;
        padding: 1px 5px;
        border-radius: 4px;
        line-height: 14px;
        margin-right: 4px;
        white-space: nowrap;
    }
    .yn-bem-status-tag.is-reimbursing {
        background: #eff6ff;
        color: #2563eb;
        border: 1px solid #bfdbfe;
    }
    .yn-bem-status-tag.is-no-reimburse {
        background: #f0fdf4;
        color: #16a34a;
        border: 1px solid #bbf7d0;
    }
    .yn-bem-status-tag.is-reimbursed {
        background: #f1f5f9;
        color: #64748b;
        border: 1px solid #cbd5e1;
    }
`;

export function injectStyles() {
    let styleEl = document.getElementById('yn-injected-styles') as HTMLStyleElement;
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'yn-injected-styles';
        document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = MODAL_STYLES;
}
