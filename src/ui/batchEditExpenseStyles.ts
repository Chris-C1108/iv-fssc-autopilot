/**
 * 批量修改费用信息模态框 - Vercel 设计风格高质感样式系统 (assets/design.md 规范)
 * 核心哲学：单色优先、克制高级、等宽数字、精确对齐、无花哨渐变与无意义装饰
 */
export const BATCH_EDIT_EXPENSE_STYLES = `
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
    position: fixed;
    top: 0; left: 0;
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    background: #ffffff;
    border-radius: 0;
    box-shadow: none;
    z-index: 999999;
    display: none;
    flex-direction: column;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #171717;
    animation: ynFadeIn 0.15s ease-out;
    -webkit-font-smoothing: antialiased;
}

@keyframes ynFadeIn {
    from { opacity: 0; transform: scale(0.995); }
    to { opacity: 1; transform: scale(1); }
}

/* 顶部融合控制条 (Vercel Shell & Toolbar) */
.yn-bem-top-bar {
    background: #ffffff;
    border-bottom: 1px solid #eaeaea;
    display: flex;
    flex-direction: column;
    padding: 10px 20px;
    gap: 10px;
    user-select: none;
}

.yn-bem-bar-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
}

/* 顶部第 1 行：品牌标题与元数据 */
.yn-bem-header-left {
    display: inline-flex;
    align-items: center;
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
    background: #f5f5f5;
    color: #525252;
    border: 1px solid #e5e5e5;
    border-radius: 4px;
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
}

.yn-bem-warn-indicator {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 500;
    color: #d97706;
    background: #fffbeb;
    border: 1px solid #fef3c7;
    padding: 2px 8px;
    border-radius: 4px;
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
    border: 1px solid #eaeaea;
    border-radius: 6px;
    padding: 5px 9px;
    font-size: 12px;
    background: #ffffff;
    color: #171717;
    transition: all 0.15s ease;
    height: 28px;
    box-sizing: border-box;
}
.yn-bem-input:focus {
    outline: none;
    border-color: #000000;
    box-shadow: 0 0 0 1px #000000;
}
.yn-bem-input::placeholder {
    color: #a3a3a3;
}

.yn-bem-select {
    border: 1px solid #eaeaea;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
    background: #ffffff;
    color: #171717;
    cursor: pointer;
    height: 28px;
    box-sizing: border-box;
    transition: all 0.15s ease;
}
.yn-bem-select:focus {
    outline: none;
    border-color: #000000;
    box-shadow: 0 0 0 1px #000000;
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

/* Segmented Control 格式选项卡 (Vercel 风格) */
.yn-bem-segmented-wrap {
    display: inline-flex;
    align-items: center;
    background: #f5f5f5;
    border: 1px solid #eaeaea;
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
}
.yn-bem-preset-btn {
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    color: #737373;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.12s;
    user-select: none;
    border: none;
    background: transparent;
}
.yn-bem-preset-btn:hover {
    color: #000000;
}
.yn-bem-preset-btn.active {
    background: #ffffff;
    color: #000000;
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

/* 实时预览 Mono 胶囊 */
.yn-bem-preview-pill {
    background: #f5f5f5;
    color: #171717;
    border: 1px solid #eaeaea;
    padding: 4px 8px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 快捷动作链接 (Ghost / Action Link) */
.yn-bem-quick-link {
    font-size: 11px;
    color: #525252;
    cursor: pointer;
    background: #ffffff;
    padding: 3px 7px;
    border-radius: 4px;
    border: 1px solid #eaeaea;
    transition: all 0.15s ease;
    user-select: none;
    height: 24px;
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
}
.yn-bem-quick-link:hover {
    color: #000000;
    background: #f5f5f5;
    border-color: #d4d4d4;
}

/* Vercel 按钮系统 (Button System) */
.yn-bem-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 12px;
    height: 28px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    user-select: none;
    box-sizing: border-box;
}

/* Vercel 标志性纯黑主按钮 (Solid Black Primary) */
.yn-bem-btn-primary,
.yn-bem-btn-apply {
    background: #000000;
    color: #ffffff;
    border: 1px solid #000000;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.yn-bem-btn-primary:hover:not(:disabled),
.yn-bem-btn-apply:hover {
    background: #262626;
    border-color: #262626;
}
.yn-bem-btn-primary:active:not(:disabled),
.yn-bem-btn-apply:active {
    background: #404040;
}
.yn-bem-btn-primary:disabled {
    background: #e5e5e5;
    color: #a3a3a3;
    border-color: #e5e5e5;
    cursor: not-allowed;
    box-shadow: none;
}

/* Vercel 次级白底按钮 (Secondary) */
.yn-bem-btn-secondary {
    background: #ffffff;
    color: #171717;
    border: 1px solid #eaeaea;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}
.yn-bem-btn-secondary:hover {
    background: #fafafa;
    border-color: #d4d4d4;
    color: #000000;
}
.yn-bem-btn-secondary:disabled,
.yn-bem-btn-secondary[disabled] {
    background: #f5f5f5 !important;
    color: #a3a3a3 !important;
    border-color: #e5e5e5 !important;
    cursor: not-allowed !important;
    box-shadow: none !important;
    opacity: 0.55 !important;
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
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    white-space: nowrap;
}

.yn-bem-table thead th {
    position: sticky;
    top: 0;
    background: #fafafa;
    color: #666666;
    font-weight: 500;
    font-size: 11px;
    padding: 8px 12px;
    border-bottom: 1px solid #eaeaea;
    border-right: 1px solid #f2f2f2;
    text-align: left;
    z-index: 10;
    user-select: none;
    letter-spacing: 0.01em;
}
.yn-bem-table thead th.sortable {
    cursor: pointer;
    transition: color 0.12s;
}
.yn-bem-table thead th.sortable:hover {
    color: #000000;
    background: #f5f5f5;
}
.yn-bem-table thead th.sorted-active {
    color: #000000;
    font-weight: 600;
    background: #f5f5f5;
}

.yn-bem-table tbody td {
    padding: 7px 12px;
    border-bottom: 1px solid #f5f5f5;
    border-right: 1px solid #f9f9f9;
    color: #171717;
    vertical-align: middle;
    transition: background 0.12s;
}

/* 行鼠标悬浮高亮 (优雅浅灰蓝) */
.yn-bem-table tbody tr:hover td {
    background-color: #f1f5f9 !important;
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
    vertical-align: top !important;
    padding-top: 9px !important;
}

.yn-bem-table tbody tr.is-selected td {
    background: #fcfcfc;
}

/* 多发票合并微标签 */
.yn-bem-multi-inv-badge {
    display: inline-block;
    background: #f5f5f5;
    color: #525252;
    border: 1px solid #e5e5e5;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 500;
    margin-top: 3px;
}

/* 粘性固定列 (Sticky Columns) */
.yn-bem-col-sticky-cb {
    position: sticky;
    left: 0;
    background: #ffffff;
    z-index: 5;
    text-align: center;
    width: 38px;
    min-width: 38px;
}
.yn-bem-table thead th.yn-bem-col-sticky-cb {
    z-index: 15;
    background: #fafafa;
}
.yn-bem-col-sticky-date {
    position: sticky;
    left: 38px;
    background: #ffffff;
    z-index: 5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: #000000;
}
.yn-bem-table thead th.yn-bem-col-sticky-date {
    z-index: 15;
    background: #fafafa;
}
.yn-bem-table tbody tr.is-selected .yn-bem-col-sticky-cb,
.yn-bem-table tbody tr.is-selected .yn-bem-col-sticky-date {
    background: #fcfcfc !important;
}

/* 单列费用说明文本框 (Clean Inset Textarea) */
.yn-bem-desc-box {
    width: 290px;
    height: 38px;
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

/* 底栏操作区 (Vercel Footer) */
.yn-bem-footer {
    padding: 10px 20px;
    background: #ffffff;
    border-top: 1px solid #eaeaea;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    user-select: none;
}
.yn-bem-footer-stats {
    color: #737373;
    display: flex;
    align-items: center;
    gap: 16px;
    font-variant-numeric: tabular-nums;
}
.yn-bem-footer-stats strong {
    color: #000000;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.yn-bem-footer-stats .yn-bem-stat-highlight {
    color: #171717;
    font-weight: 600;
}
.yn-bem-footer-stats .yn-bem-stat-amount {
    color: #096dd9;
    font-weight: 600;
    font-size: 13px;
    letter-spacing: -0.01em;
}
.yn-bem-footer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

/* 列头标题与排序/筛选触发器 (Header Content with Sort & Filter) */
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

/* 单元格就地直接编辑样式 (Inline Cell Editing) */
.yn-bem-cell-interactive {
    padding: 3px 6px !important;
}
.yn-bem-cell-date-input {
    border: 1px solid #e5e7eb;
    background: #fafafa;
    border-radius: 4px;
    padding: 3px 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    color: #171717;
    width: 122px;
    box-sizing: border-box;
    outline: none;
    transition: all 0.15s ease;
}
.yn-bem-cell-date-input:hover,
.yn-bem-cell-date-input:focus {
    border-color: #000000;
    background: #ffffff;
    box-shadow: 0 0 0 1px #000000;
}
.yn-bem-cell-date-input.has-changed {
    border-color: #059669;
    background: #f0fdf4;
    color: #065f46;
    font-weight: 600;
}

.yn-bem-cell-type-wrapper {
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: flex-start;
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
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 11px;
    color: #171717;
    width: 100%;
    min-width: 80px;
    box-sizing: border-box;
    outline: none;
    transition: all 0.15s ease;
    font-family: inherit;
}
.yn-bem-cell-text-input:hover {
    border-color: #e5e7eb;
    background: #fafafa;
}
.yn-bem-cell-text-input:focus {
    border-color: #000000;
    background: #ffffff;
    box-shadow: 0 0 0 1px #000000;
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
    font-size: 10px;
    font-weight: 600;
}

/* 专属字段就地直接编辑输入框 */
.yn-bem-dyn-input {
    width: 100%;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 11px;
    background: transparent;
    color: #171717;
    box-sizing: border-box;
    font-family: inherit;
    transition: all 0.15s ease;
    height: 24px;
}
.yn-bem-dyn-input:hover {
    border-color: #d4d4d4;
    background: #ffffff;
}
.yn-bem-dyn-input:focus {
    border-color: #000000;
    background: #ffffff;
    box-shadow: 0 0 0 1px #000000;
    outline: none;
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
    align-items: center;
    width: 100%;
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
   出差行程排期辅助推断模态框 (Itinerary Helper Modal)
   ========================================================================== */
#yn-bem-itinerary-mask {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
    z-index: 1000000;
    display: none;
    align-items: center;
    justify-content: center;
    animation: ynBemFadeIn 0.15s ease-out;
}

.yn-bem-itinerary-card {
    background: #ffffff;
    border: 1px solid #eaeaea;
    border-radius: 8px;
    box-shadow: 0 16px 50px rgba(0, 0, 0, 0.22);
    width: 720px;
    max-width: 92vw;
    padding: 24px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: ynBemFadeIn 0.15s ease-out;
}

.yn-bem-itinerary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #f0f0f0;
    padding-bottom: 12px;
}
.yn-bem-itinerary-title {
    font-size: 15px;
    font-weight: 600;
    color: #000000;
    display: flex;
    align-items: center;
    gap: 8px;
}
.yn-bem-itinerary-tip {
    font-size: 12px;
    line-height: 1.55;
    color: #525252;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 12px;
}
.yn-bem-itinerary-tip strong {
    color: #0f172a;
}
.yn-bem-prompt-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #fafafa;
    border: 1px solid #eaeaea;
    border-radius: 6px;
    padding: 8px 12px;
}
.yn-bem-prompt-bar-text {
    font-size: 11px;
    color: #737373;
    display: flex;
    align-items: center;
    gap: 6px;
}
.yn-bem-btn-copy-prompt {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 500;
    color: #171717;
    background: #ffffff;
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    transition: all 0.15s ease;
}
.yn-bem-btn-copy-prompt:hover {
    background: #f5f5f5;
    border-color: #a3a3a3;
}
.yn-bem-btn-copy-prompt:active {
    transform: scale(0.98);
}
.yn-bem-itinerary-textarea {
    width: 100%;
    height: 160px;
    border: 1px solid #eaeaea;
    border-radius: 6px;
    padding: 10px;
    font-size: 12px;
    color: #171717;
    background: #fafafa;
    resize: vertical;
    box-sizing: border-box;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    line-height: 1.45;
    transition: all 0.15s ease;
}
.yn-bem-itinerary-textarea:focus {
    border-color: #000000;
    background: #ffffff;
    box-shadow: 0 0 0 1px #000000;
    outline: none;
}
.yn-bem-itinerary-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 6px;
}
`;
