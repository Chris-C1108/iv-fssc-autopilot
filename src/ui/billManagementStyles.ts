export function getBillManagementStyles(): string {
  return `
/* ==========================================================================
   Bill Management Pure Table Grid Mode (High-Density Spreadsheet Layout)
   ========================================================================== */

.yn-bm-fullscreen-workspace {
  --bm-bg: #ffffff;
  --bm-bg-sub: #f8fafc;
  --bm-text: #0f172a;
  --bm-text-sec: #475569;
  --bm-text-muted: #94a3b8;
  --bm-border: #e2e8f0;
  --bm-border-hover: #cbd5e1;
  --bm-primary: #2563eb;
  --bm-primary-hover: #1d4ed8;
  --bm-success: #16a34a;
  --bm-warning: #d97706;
  --bm-error: #dc2626;
  --bm-selected: #eff6ff;
  --bm-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --bm-mono: ui-monospace, 'SF Mono', 'Cascadia Code', monospace;

  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bm-bg);
  color: var(--bm-text);
  font-family: var(--bm-font);
  font-size: 12px;
  overflow: hidden;
  position: relative;
}

/* 顶部操作条 */
.yn-bm-workspace-topbar {
  height: 40px;
  padding: 0 14px;
  border-bottom: 1px solid var(--bm-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  background: #f8fafc;
}

.yn-bm-topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.yn-bm-workspace-title {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.2px;
}
.yn-bm-top-stat {
  font-size: 11px;
  color: var(--bm-text-sec);
}
.yn-bm-tag {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
}
.yn-bm-tag--bc {
  background: #eff6ff;
  color: #2563eb;
  border: 1px solid #bfdbfe;
}
.yn-bm-tag--bj {
  background: #f0fdf4;
  color: #16a34a;
  border: 1px solid #bbf7d0;
}

/* 必填项健康度状态指示徽章 */
.yn-bm-health-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  height: 24px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: default;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.yn-bm-health-badge.is-warning {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fca5a5;
  cursor: pointer;
}
.yn-bm-health-badge.is-warning:hover {
  background: #fee2e2;
  box-shadow: 0 1px 4px rgba(220, 38, 38, 0.18);
  transform: translateY(-0.5px);
}
.yn-bm-health-badge.is-ok {
  background: #f0fdf4;
  color: #15803d;
  border: 1px solid #bbf7d0;
}

.yn-bm-topbar-center {
  flex: 1;
  max-width: 320px;
  margin: 0 16px;
}
.yn-bm-search-input {
  width: 100%;
  height: 26px;
  background: #ffffff;
  border: 1px solid var(--bm-border);
  border-radius: 4px;
  padding: 0 8px;
  font-size: 11px;
  outline: none;
}
.yn-bm-search-input:focus {
  border-color: var(--bm-primary);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.yn-bm-topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 滚动容器 */
.yn-bm-table-scroll-wrap {
  flex: 1;
  overflow: auto;
  background: #ffffff;
}

/* 主二维网格大表格 (适配 1920*1080 纯表格全景) */
.yn-bm-spread-table {
  width: 100%;
  min-width: 1720px;
  border-collapse: collapse;
  text-align: left;
}

.yn-bm-spread-table th {
  position: sticky;
  top: 0;
  background: #f1f5f9;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  border-bottom: 1px solid #cbd5e1;
  border-right: 1px solid #e2e8f0;
  z-index: 10;
  white-space: nowrap;
}

/* 必填星号标 */
.yn-bm-req-star {
  color: #ef4444;
  font-weight: 700;
  margin-left: 2px;
  font-size: 12px;
  display: inline-block;
}

.yn-bm-spread-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--bm-border);
  border-right: 1px solid #f1f5f9;
  vertical-align: middle;
  font-size: 12px;
}

/* 主表行 */
.yn-bm-master-row {
  background: #ffffff;
  transition: background 0.1s ease;
}
.yn-bm-master-row:hover {
  background: #f8fafc;
}
.yn-bm-master-row.is-selected {
  background: #eff6ff;
}

/* 展开小按钮 */
.yn-bm-expand-btn {
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 3px;
  transition: transform 0.15s, color 0.15s;
}
.yn-bm-expand-btn:hover {
  color: #0f172a;
  background: #e2e8f0;
}
.yn-bm-expand-btn.is-open {
  transform: rotate(90deg);
  color: var(--bm-primary);
}

/* 单元格紧凑输入框 */
.yn-bm-cell-input {
  width: 100%;
  height: 24px;
  padding: 1px 6px;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  font-family: var(--bm-font);
  font-size: 11px;
  color: var(--bm-text);
  background: #ffffff;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s;
}
.yn-bm-cell-input:hover {
  border-color: #94a3b8;
}
.yn-bm-cell-input:focus {
  border-color: var(--bm-primary);
  box-shadow: 0 0 0 1.5px rgba(37, 99, 235, 0.2);
}

/* 必填项漏填/未填高亮样式 (醒目红框与淡红底) */
.yn-bm-cell-input.is-missing {
  border: 1.5px solid #ef4444 !important;
  background-color: #fef2f2 !important;
  color: #991b1b !important;
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.25) !important;
}
.yn-bm-cell-input.is-missing::placeholder {
  color: #f87171 !important;
  font-weight: 500;
}
.yn-bm-cell-input.is-missing:focus {
  border-color: #dc2626 !important;
  box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.3) !important;
}

/* AI 智能副驾已填充字段优雅微光指示 */
.yn-bm-cell-input.is-ai-filled {
  border-color: #818cf8 !important;
  background-color: #f5f3ff !important;
  box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.25) !important;
}
.yn-bm-ai-sparkle-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: #6366f1;
  font-weight: 700;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  padding: 0 4px;
  border-radius: 3px;
  line-height: 14px;
  margin-left: 4px;
  vertical-align: middle;
}

.yn-bm-number-input {
  font-family: var(--bm-mono);
  font-weight: 600;
  text-align: right;
}

/* 维表联想推荐组件 */
.yn-bm-project-search-wrap {
  position: relative;
  width: 100%;
}
.yn-bm-project-input {
  font-family: var(--bm-mono);
  font-weight: 500;
  color: #1d4ed8;
}
.yn-bm-project-dropdown {
  position: absolute;
  top: 28px;
  left: 0;
  width: 320px;
  max-height: 220px;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 100;
  padding: 4px;
}
.yn-bm-dropdown-item {
  padding: 5px 8px;
  border-radius: 3px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.yn-bm-dropdown-item:hover {
  background: #eff6ff;
}
.yn-bm-project-code {
  font-family: var(--bm-mono);
  font-size: 11px;
  font-weight: 700;
  color: #1d4ed8;
}
.yn-bm-project-name {
  font-size: 11px;
  color: #475569;
}
.yn-bm-dropdown-loading,
.yn-bm-dropdown-empty {
  padding: 10px;
  text-align: center;
  font-size: 11px;
  color: var(--bm-text-muted);
}

/* Toggle Switch (微动效) */
.yn-bm-toggle-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}
.yn-bm-toggle-input {
  display: none;
}
.yn-bm-toggle-track {
  width: 28px;
  height: 16px;
  background: #cbd5e1;
  border-radius: 8px;
  position: relative;
  transition: background 0.15s ease;
}
.yn-bm-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  background: #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
  transition: transform 0.15s ease;
}
.yn-bm-toggle-input:checked + .yn-bm-toggle-track {
  background: var(--bm-primary);
}
.yn-bm-toggle-input:checked + .yn-bm-toggle-track .yn-bm-toggle-thumb {
  transform: translateX(12px);
}
.yn-bm-toggle-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
}
.yn-bm-toggle-label.is-active {
  color: var(--bm-primary);
}

/* 单元格特殊样式 */
.yn-bm-budget-total-col {
  font-family: var(--bm-mono);
  font-size: 12px;
  font-weight: 700;
  color: #2563eb;
}
.yn-bm-budget-total-col.is-budget-insufficient {
  color: #dc2626 !important;
  background: #fef2f2 !important;
  border: 1px dashed #f87171 !important;
  padding: 2px 5px !important;
  border-radius: 3px;
  display: inline-block;
}
.yn-bm-currency-val {
  font-family: var(--bm-mono);
  font-size: 12px;
  font-weight: 700;
  color: #0f172a;
}
.yn-bm-report-pill {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s;
}
.yn-bm-report-pill:hover {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}
.yn-bm-report-pill.has-content {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #15803d;
}
.yn-bm-muted {
  color: var(--bm-text-muted);
  font-size: 11px;
}

/* 状态徽章 */
.yn-bm-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
}
.yn-bm-badge--draft { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
.yn-bm-badge--saving { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }
.yn-bm-badge--saved { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
.yn-bm-badge--error { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.yn-bm-badge-pulse {
  width: 5px; height: 5px; background: #2563eb; border-radius: 50%;
  animation: ynBmPulse 1s infinite;
}
@keyframes ynBmPulse {
  0% { transform: scale(0.8); opacity: 0.5; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.8); opacity: 0.5; }
}

/* ==========================================================================
   展开区：3 张纯二维数据子表格 (Pure Table Sub-Grids)
   ========================================================================== */

.yn-bm-subtables-row {
  background: #f8fafc;
}
.yn-bm-subtables-cell {
  padding: 8px 14px 14px 28px !important;
  border-bottom: 2px solid #cbd5e1 !important;
}
.yn-bm-subtables-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yn-bm-subgrid-box {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  overflow: hidden;
}

.yn-bm-subgrid-header {
  height: 30px;
  padding: 0 10px;
  background: #f1f5f9;
  border-bottom: 1px solid #cbd5e1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.yn-bm-subgrid-header .title {
  font-size: 11px;
  font-weight: 700;
  color: #1e293b;
}
.yn-bm-subgrid-header .hint {
  font-size: 10px;
  color: #64748b;
  margin-left: 8px;
  flex: 1;
}

.yn-bm-btn-table-action {
  border: none;
  background: #2563eb;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
}
.yn-bm-btn-table-action:hover {
  background: #1d4ed8;
}

.yn-bm-detail-table {
  width: 100%;
  border-collapse: collapse;
}
.yn-bm-detail-table th {
  background: #f8fafc;
  padding: 5px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  border-bottom: 1px solid #cbd5e1;
  border-right: 1px solid #e2e8f0;
}
.yn-bm-detail-table td {
  padding: 4px 8px;
  border-bottom: 1px solid #e2e8f0;
  border-right: 1px solid #f1f5f9;
  font-size: 11px;
  vertical-align: middle;
}

.yn-bm-exp-type-badge {
  display: inline-block;
  padding: 2px 6px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  font-weight: 600;
  color: #334155;
}

.yn-bm-currency-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}
.yn-bm-currency-cell .prefix {
  font-family: var(--bm-mono);
  color: #94a3b8;
  font-weight: 600;
}
.yn-bm-budget-total-val {
  font-family: var(--bm-mono);
  font-size: 14px;
  font-weight: 800;
  color: #2563eb;
}

.diff-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
}
.diff-ok {
  background: #f0fdf4;
  color: #15803d;
  border: 1px solid #bbf7d0;
}
.diff-warn {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

.yn-bm-btn-split-row {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #2563eb;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}
.yn-bm-btn-split-row:hover {
  background: #eff6ff;
  border-color: #93c5fd;
}
.yn-bm-btn-delete-row {
  border: none;
  background: transparent;
  color: #ef4444;
  font-size: 11px;
  padding: 2px 5px;
  cursor: pointer;
  border-radius: 3px;
}
.yn-bm-btn-delete-row:hover {
  background: #fee2e2;
}

/* ==========================================================================
   出差总结报告抽屉 (Markdown)
   ========================================================================== */

.yn-bm-drawer-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  z-index: 1000000;
  display: flex;
  justify-content: flex-end;
}
.yn-bm-drawer-content {
  width: 580px;
  max-width: 90vw;
  height: 100vh;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.15);
}
.yn-bm-drawer-header {
  height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid var(--bm-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.yn-bm-drawer-header .title {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}
.yn-bm-drawer-header .subtitle {
  font-size: 11px;
  color: #64748b;
  display: block;
}
.yn-bm-btn--ai {
  background: #0f172a;
  color: #ffffff;
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.yn-bm-btn--ai .sparkle {
  color: #60a5fa;
}
.yn-bm-drawer-body {
  flex: 1;
  padding: 14px 16px;
  overflow: hidden;
  display: flex;
}
.yn-bm-report-textarea {
  width: 100%;
  height: 100%;
  border: 1px solid var(--bm-border);
  border-radius: 4px;
  padding: 12px;
  font-family: var(--bm-font);
  font-size: 12px;
  line-height: 1.6;
  outline: none;
  resize: none;
}
.yn-bm-report-textarea:focus {
  border-color: var(--bm-primary);
}
.yn-bm-drawer-footer {
  height: 48px;
  padding: 0 16px;
  border-top: 1px solid var(--bm-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f8fafc;
}
.yn-bm-drawer-footer .count {
  font-size: 11px;
  color: #64748b;
}

/* ==========================================================================
   底部常驻操作岛
   ========================================================================== */

.yn-bm-workspace-footer {
  height: 46px;
  padding: 0 14px;
  border-top: 1px solid var(--bm-border);
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.03);
  z-index: 20;
}
.yn-bm-footer-summary {
  display: flex;
  align-items: center;
  gap: 8px;
}
.yn-bm-footer-summary .pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  color: #475569;
}
.yn-bm-footer-summary .pill strong {
  font-family: var(--bm-mono);
  color: #0f172a;
  margin: 0 2px;
}
.yn-bm-footer-summary .pill-primary {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}
.yn-bm-footer-summary .pill-primary strong { color: #1e40af; }
.yn-bm-footer-summary .pill-sc {
  background: #fefce8;
  border-color: #fef08a;
  color: #a16207;
}
.yn-bm-footer-summary .pill-sc strong { color: #854d0e; }

.yn-bm-footer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.yn-bm-progress-msg {
  font-size: 11px;
  font-weight: 600;
  color: var(--bm-primary);
}
.yn-bm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  font-family: var(--bm-font);
  border: 1px solid transparent;
}
.yn-bm-btn--primary {
  background: var(--bm-primary);
  color: #ffffff;
}
.yn-bm-btn--primary:hover:not(:disabled) {
  background: var(--bm-primary-hover);
}
.yn-bm-btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.yn-bm-btn--secondary {
  background: #ffffff;
  color: #334155;
  border-color: #cbd5e1;
}
.yn-bm-btn--secondary:hover {
  background: #f1f5f9;
}
.yn-bm-btn--sm {
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
}
.yn-bm-btn--lg {
  height: 30px;
  padding: 0 14px;
  font-size: 12px;
}
.yn-bm-btn--ai-hero {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%) !important;
  color: #ffffff !important;
  border: none !important;
  box-shadow: 0 2px 6px rgba(79, 70, 229, 0.28);
  transition: all 0.15s ease;
  font-weight: 700;
}
.yn-bm-btn--ai-hero:hover {
  background: linear-gradient(135deg, #4338ca 0%, #6d28d9 100%) !important;
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4);
  transform: translateY(-1px);
}
.yn-bm-btn--ai-hero:active {
  transform: translateY(0);
}

/* 空状态 */
.yn-bm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
}
.yn-bm-empty .icon {
  font-size: 32px;
  margin-bottom: 8px;
}
.yn-bm-empty .text {
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}
.yn-bm-empty .sub {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 4px;
}

/* 顶栏 Tab 按钮 */
.yn-bem-nav-tabs {
  display: inline-flex;
  align-items: center;
  background: #e2e8f0;
  padding: 2px;
  border-radius: 4px;
  gap: 2px;
}
.yn-bem-tab-btn {
  border: none;
  background: transparent;
  padding: 3px 10px;
  height: 26px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}
.yn-bem-tab-btn:hover {
  color: #0f172a;
}
.yn-bem-tab-btn.is-active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
}
  `;
}
