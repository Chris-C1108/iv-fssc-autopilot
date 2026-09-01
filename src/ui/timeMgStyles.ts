/**
 * 考勤工数副驾专属样式
 */
export function injectTimeMgStyles() {
    if (document.getElementById('yn-timemg-styles')) return;

    const style = document.createElement('style');
    style.id = 'yn-timemg-styles';
    style.textContent = `
        /* 考勤副驾悬浮入口按钮 */
        #yn-timemg-helper-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 999999;
            background: linear-gradient(135deg, #13c2c2 0%, #08979c 100%);
            color: #fff;
            padding: 12px 20px;
            border-radius: 50px;
            box-shadow: 0 4px 16px rgba(19, 194, 194, 0.4);
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            user-select: none;
            border: 2px solid rgba(255, 255, 255, 0.2);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
        }
        #yn-timemg-helper-btn:hover {
            transform: translateY(-2px) scale(1.03);
            box-shadow: 0 8px 24px rgba(19, 194, 194, 0.55);
            background: linear-gradient(135deg, #36cfc9 0%, #13c2c2 100%);
        }
        #yn-timemg-helper-btn .yn-timemg-badge {
            width: 9px;
            height: 9px;
            background-color: #52c41a;
            border-radius: 50%;
            display: inline-block;
            box-shadow: 0 0 6px #52c41a;
        }
        #yn-timemg-helper-btn .yn-timemg-badge.offline {
            background-color: #faad14;
            box-shadow: 0 0 6px #faad14;
        }

        /* 模态弹窗遮罩 */
        #yn-timemg-modal-mask {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(4px);
            z-index: 999998;
            display: none;
        }

        /* 考勤副驾模态弹窗主容器 (全屏最大化利用 1920*1080 空间) */
        #yn-timemg-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: calc(100vw - 40px);
            height: calc(100vh - 40px);
            background: #ffffff;
            border-radius: 10px;
            box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
            z-index: 999999;
            display: none;
            flex-direction: column;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
            font-size: 13px;
            color: #262626;
        }

        /* 弹窗 Header */
        .yn-timemg-header {
            padding: 12px 24px;
            background: linear-gradient(90deg, #f6ffed 0%, #e6fffb 100%);
            border-bottom: 1px solid #b5f5ec;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .yn-timemg-header-title {
            font-size: 16px;
            font-weight: 700;
            color: #00474f;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .yn-timemg-header-subtitle {
            font-size: 12px;
            font-weight: normal;
            color: #595959;
            margin-left: 8px;
        }
        .yn-timemg-close-btn {
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: #8c8c8c;
            line-height: 1;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s;
        }
        .yn-timemg-close-btn:hover {
            color: #ff4d4f;
            background: rgba(0,0,0,0.05);
        }

        /* 顶部操作工具栏 */
        .yn-timemg-toolbar {
            padding: 10px 24px;
            background: #fafafa;
            border-bottom: 1px solid #f0f0f0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;
        }
        .yn-timemg-toolbar-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .yn-timemg-toolbar-right {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .yn-timemg-btn {
            padding: 7px 16px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            border: 1px solid transparent;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .yn-timemg-btn-primary {
            background: #13c2c2;
            color: #fff;
        }
        .yn-timemg-btn-primary:hover {
            background: #08979c;
        }
        .yn-timemg-btn-success {
            background: #52c41a;
            color: #fff;
            box-shadow: 0 2px 8px rgba(82, 196, 26, 0.35);
        }
        .yn-timemg-btn-success:hover {
            background: #389e0d;
        }
        .yn-timemg-btn-default {
            background: #fff;
            color: #595959;
            border-color: #d9d9d9;
        }
        .yn-timemg-btn-default:hover {
            color: #13c2c2;
            border-color: #13c2c2;
        }

        /* 主体内容双栏布局 (左栏 650px 项目对比表, 右栏自适应出勤分配表) */
        .yn-timemg-body {
            flex: 1;
            display: grid;
            grid-template-columns: 650px 1fr;
            overflow: hidden;
            background: #f5f5f5;
            gap: 1px;
        }

        .yn-timemg-panel {
            background: #fff;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .yn-timemg-panel-header {
            padding: 10px 16px;
            background: #fafafa;
            border-bottom: 1px solid #f0f0f0;
            font-weight: 700;
            color: #262626;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .yn-timemg-panel-content {
            flex: 1;
            overflow-y: auto;
            padding: 0;
        }

        /* 紧凑项目对比卡片与表格 */
        .yn-timemg-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        .yn-timemg-table th {
            background: #fafafa;
            color: #595959;
            font-weight: 600;
            padding: 8px 6px;
            border-bottom: 1px solid #e8e8e8;
            text-align: left;
            position: sticky;
            top: 0;
            z-index: 2;
            white-space: nowrap;
        }
        .yn-timemg-table td {
            padding: 7px 6px;
            border-bottom: 1px solid #f0f0f0;
            color: #262626;
            vertical-align: middle;
            white-space: nowrap;
        }
        .yn-timemg-table tr:hover td {
            background: #e6fffb;
        }
        .yn-timemg-table tr.holiday td {
            background: #fafafa;
            color: #bfbfbf;
        }
        .yn-timemg-table tr.is-overflow-row td {
            background: #fffbe6 !important;
        }

        /* 标签与徽章 */
        .yn-timemg-tag {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11.5px;
            font-weight: 600;
            white-space: nowrap;
        }
        .yn-timemg-tag-out {
            background: #fff7e6;
            color: #d46b08;
            border: 1px solid #ffd591;
        }
        .yn-timemg-tag-office {
            background: #f6ffed;
            color: #389e0d;
            border: 1px solid #b7eb8f;
        }
        .yn-timemg-tag-work {
            background: #e6f7ff;
            color: #096dd9;
            border: 1px solid #91d5ff;
        }
        .yn-timemg-tag-holiday {
            background: #f5f5f5;
            color: #8c8c8c;
            border: 1px solid #d9d9d9;
        }
        .yn-timemg-badge-overflow {
            color: #cf1322;
            font-weight: 700;
            background: #fff1f0;
            padding: 1px 6px;
            border-radius: 3px;
            border: 1px solid #ffa39e;
            white-space: nowrap;
            display: inline-block;
        }

        /* 进度条与日志 */
        .yn-timemg-progress-wrap {
            padding: 10px 24px;
            background: #fafafa;
            border-top: 1px solid #f0f0f0;
            display: none;
        }
        .yn-timemg-progress-bar {
            width: 100%;
            height: 6px;
            background: #f0f0f0;
            border-radius: 3px;
            overflow: hidden;
            margin-bottom: 6px;
        }
        .yn-timemg-progress-inner {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #13c2c2 0%, #52c41a 100%);
            transition: width 0.3s ease;
        }
        .yn-timemg-log-text {
            font-size: 12px;
            color: #595959;
        }

        /* 预算不足预警横幅与推荐项目标签 */
        .yn-timemg-shortfall-alert {
            margin: 12px 24px 0 24px;
            padding: 10px 16px;
            background: #fffbe6;
            border: 1px solid #ffe58f;
            border-radius: 8px;
            color: #d46b08;
            font-size: 12.5px;
            line-height: 1.6;
        }
        .yn-timemg-shortfall-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 6px;
        }
        .yn-timemg-tag-proj {
            background: #ffffff;
            border: 1px solid #ffd591;
            padding: 2px 10px;
            border-radius: 4px;
            font-weight: 600;
            color: #d4380d;
            cursor: pointer;
            transition: all 0.2s;
        }
        /* 底部日志控制台 (默认收起，点击展开) */
        .yn-timemg-footer-console {
            padding: 6px 20px;
            background: #fafafa;
            border-top: 1px solid #f0f0f0;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        #yn-timemg-log-stream {
            display: none;
            max-height: 90px;
            overflow-y: auto;
            background: #1e1e1e;
            color: #d4d4d4;
            font-family: Consolas, Monaco, monospace;
            font-size: 11px;
            padding: 6px 10px;
            border-radius: 4px;
            line-height: 1.5;
        }

        /* 确保宿主系统 (Element UI) 弹窗、确认框与提示浮层始终浮现在副驾界面之上 */
        .el-message-box__wrapper,
        .el-dialog__wrapper,
        .el-message,
        .el-notification,
        .el-loading-mask,
        .el-popover,
        .el-tooltip__popper,
        .el-select-dropdown,
        .el-autocomplete-suggestion {
            z-index: 10000001 !important;
        }
        .v-modal {
            z-index: 10000000 !important;
        }
    `;
    document.head.appendChild(style);
}
