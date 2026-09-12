import { GlobalState } from '../types/state';
import { MENU_DICTIONARY } from '../config/constants';
import { mountToDock, updateDockBadge } from './floatingDock';

export function createModalDOM(state: GlobalState): { btn: HTMLElement; modal: HTMLElement; mask: HTMLElement } {
    const btnId = 'yn-batch-helper-btn';
    const btn = mountToDock(btnId, () => {
        const b = document.createElement('button');
        b.id = btnId;
        return b;
    });

    // 仅在报销单编辑页 (#billWrite) 展示 Mode A: 报销单预算批量修改
    // 旧版 Mode B (费用记录批量助手) 已由 batchEditExpenseModal 彻底取代并下线
    const shouldShow = state.pageMode === 'BILL';
    btn.style.display = shouldShow ? 'flex' : 'none';

    btn.innerHTML = `
        <span class="yn-badge ${state.loginToken ? '' : 'offline'}"></span>
        <span>⚡ 报销单预算批量修改</span>
    `;
    updateDockBadge();

    let mask = document.getElementById('yn-modal-mask');
    if (!mask) {
        mask = document.createElement('div');
        mask.id = 'yn-modal-mask';
        document.body.appendChild(mask);
    }

    let modal = document.getElementById('yn-batch-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'yn-batch-modal';
        document.body.appendChild(modal);
    }

    if (state.pageMode === 'BILL') {
        const accountOptionsHtml = MENU_DICTIONARY.accounts.map(a => `
            <option value="${a.value}" ${a.code === 'Account_P' ? 'selected' : ''}>${a.name}</option>
        `).join('');

        const costCenterOptionsHtml = MENU_DICTIONARY.costCenters.map(c => `
            <option value="${c.value}" ${c.code === '102IT40X' ? 'selected' : ''}>${c.name}</option>
        `).join('');

        const khfdOptionsHtml = MENU_DICTIONARY.khfd.map(k => `
            <option value="${k.value}" ${k.code === 'YES' ? 'selected' : ''}>${k.name}</option>
        `).join('');

        modal.innerHTML = `
            <div class="yn-header">
                <h3>
                    <span>⚡ 经费报销单 - 批量修改预算归属 (v4.3.0 极速模式)</span>
                    <span id="yn-token-indicator" style="font-size:12px; font-weight:normal; color:${state.loginToken ? '#52c41a' : '#ff4d4f'};">
                        ${state.loginToken ? '● Token 已就绪' : '○ 正在等待 Token'}
                    </span>
                </h3>
                <button class="yn-close-btn" id="yn-modal-close">×</button>
            </div>

            <div class="yn-body">
                <!-- 1. 智能 TAG 标签云 -->
                <div class="yn-tag-cloud" id="yn-bill-tag-cloud">
                    <strong style="color:#389e0d; font-size:12px;">🏷️ 备注 TAG 速选:</strong>
                    <span id="yn-bill-tags-container">正在提取当前报销单 TAG...</span>
                </div>

                <!-- 2. 批量修改配置面板 -->
                <div class="yn-quick-bar">
                    <strong>🎯 目标预算设定：</strong>
                    <span>匹配TAG: </span>
                    <input type="text" id="yn-bill-filter-input" placeholder="如: X2605-001" style="width:105px; font-weight:bold;" />

                    <span>预算科目: </span>
                    <select id="yn-bill-account-select" style="max-width:210px; font-weight:600; color:#1890ff;">
                        ${accountOptionsHtml}
                    </select>

                    <span>部门/成本中心: </span>
                    <select id="yn-bill-cost-center-select" style="max-width:210px; font-weight:600; color:#595959;">
                        ${costCenterOptionsHtml}
                    </select>

                    <span>目标项目: </span>
                    <div style="position:relative; display:inline-flex; align-items:center; gap:4px;">
                        <input type="text" id="yn-bill-project-search" placeholder="输入代码或名称检索..." style="width:130px;" />
                        <select id="yn-bill-project-select" style="max-width:260px; font-weight:bold; color:#722ed1;">
                            <option value="">-- 请选择或检索项目 --</option>
                        </select>
                    </div>

                    <span>向客户请款: </span>
                    <select id="yn-bill-khfd-select" style="font-weight:600; color:#52c41a;">
                        ${khfdOptionsHtml}
                    </select>

                    <button class="yn-btn yn-btn-primary" id="yn-bill-btn-apply-filter" style="font-weight:600;">
                        🔍 筛选并勾选
                    </button>
                </div>

                <!-- 3. 明细表格 -->
                <div class="yn-table-container">
                    <table class="yn-table" id="yn-bill-records-table">
                        <thead>
                            <tr>
                                <th style="width:36px; text-align:center;"><input type="checkbox" id="yn-bill-th-select-all" /></th>
                                <th style="width:36px; text-align:center;">#</th>
                                <th style="width:50px; text-align:center;">行号</th>
                                <th style="width:100px;">费用类型</th>
                                <th style="width:75px; text-align:right;">报销金额</th>
                                <th style="width:140px;">支出记录备注 / TAG</th>
                                <th style="width:120px;">当前科目</th>
                                <th style="width:150px;">当前部门/成本中心</th>
                                <th style="width:170px;">当前项目</th>
                                <th style="width:65px; text-align:center;">当前请款</th>
                                <th style="width:200px; color:#1890ff;">修改后预算预览</th>
                                <th style="width:55px; text-align:center;">状态</th>
                            </tr>
                        </thead>
                        <tbody id="yn-bill-table-tbody">
                            <tr><td colspan="12" style="text-align:center; padding:50px; color:#8c8c8c;">正在解析当前报销单费用明细...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="yn-footer">
                <div class="yn-progress-bar-wrap" id="yn-bill-progress-wrap">
                    <div class="yn-progress-bar">
                        <div class="yn-progress-inner" id="yn-bill-progress-inner"></div>
                    </div>
                    <div class="yn-log-box" id="yn-bill-log-text">准备就绪</div>
                </div>
                <div style="margin-left:auto; display:flex; gap:10px;">
                    <button class="yn-btn" id="yn-bill-btn-reload">🔄 刷新报销单</button>
                    <button class="yn-btn yn-btn-success" id="yn-bill-btn-batch-execute" style="font-weight:600; padding:6px 24px;">
                        🚀 批量修改预算归属并向客户请款 (30倍极速)
                    </button>
                </div>
            </div>
        `;
    } else {
        // === 模式 A: 发票夹 / 费用记录 ===
        modal.innerHTML = `
            <div class="yn-header">
                <h3>
                    <span>元年报销批量流转与录入助手</span>
                    <span id="yn-token-indicator" style="font-size:12px; font-weight:normal; color:${state.loginToken ? '#52c41a' : '#ff4d4f'};">
                        ${state.loginToken ? '● Token 已就绪' : '○ 正在等待 Token'}
                    </span>
                </h3>
                <button class="yn-close-btn" id="yn-modal-close">×</button>
            </div>

            <div class="yn-body">
                <div class="yn-toolbar">
                    <div class="yn-toolbar-left">
                        <button class="yn-btn yn-btn-primary" id="yn-btn-fetch-all" style="font-weight:600; padding:6px 16px;">
                            🔄 一键同步待报销数据
                        </button>
                    </div>
                    <div class="yn-toolbar-right">
                        <span id="yn-select-count-info" style="font-size:12px; color:#595959; font-weight:600;">已勾选 0 行</span>
                    </div>
                </div>

                <div class="yn-group-tabs">
                    <button class="yn-tab-btn active" data-group="TAXI" id="yn-tab-taxi">
                        🚕 出租车/交通 <span class="yn-tab-count" id="yn-count-taxi">0</span>
                    </button>
                    <button class="yn-tab-btn" data-group="FLIGHT_TRAIN" id="yn-tab-flight-train">
                        ✈️ 飞机/高铁 <span class="yn-tab-count" id="yn-count-flight-train">0</span>
                    </button>
                    <button class="yn-tab-btn" data-group="HOTEL" id="yn-tab-hotel">
                        🏨 住宿费 <span class="yn-tab-count" id="yn-count-hotel">0</span>
                    </button>
                    <button class="yn-tab-btn" data-group="COMMUNICATION" id="yn-tab-comm">
                        📱 通信费 <span class="yn-tab-count" id="yn-count-comm">0</span>
                    </button>
                    <button class="yn-tab-btn" data-group="ALL" id="yn-tab-all">
                        📋 全部记录 (15类) <span class="yn-tab-count" id="yn-count-all">0</span>
                    </button>
                </div>

                <!-- 智能差旅与行程推断设定面板 -->
                <div class="yn-quick-bar" id="yn-quick-bar-trip" style="flex-wrap: wrap; gap: 8px;">
                    <strong>🎯 智能行程与分类推断：</strong>
                    <span>模式: </span>
                    <select id="yn-quick-trip-type" style="font-weight: bold; color: #1890ff;">
                        <option value="AUTO">✨ 自动识别 (根据酒店/机票)</option>
                        <option value="BUSINESS_TRIP">✈️ 异地出差模式 (机场+酒店早出晚归)</option>
                        <option value="LOCAL_COMMUTE">🏢 市内日常通勤 (公司 ⇄ 客户)</option>
                    </select>
                    <span>本公司: </span>
                    <input type="text" id="yn-quick-company" value="IVISION" style="width:75px; font-weight:bold; background:#fafafa;" />
                    <span>拜访客户: </span>
                    <input type="text" id="yn-quick-customer" value="CMP" placeholder="如: CMP" style="width:85px; font-weight:bold;" />
                    <span>入住酒店: </span>
                    <input type="text" id="yn-quick-hotel" value="" placeholder="如: 美悦酒店/亚朵" style="width:110px;" />
                    <span>机场/车站: </span>
                    <input type="text" id="yn-quick-station" value="机场/高铁站" style="width:90px;" />
                    <span>关联项目: </span>
                    <input type="text" id="yn-quick-project" value="" placeholder="如: X2605-001" style="width:95px;" />
                    <span>代外驻报销: </span>
                    <input type="text" id="yn-quick-proxy" value="" placeholder="外驻姓名，如: 成勇" style="width:95px; color:#d46b08; font-weight:600;" />
                    <button class="yn-btn yn-btn-smart" id="yn-btn-smart-commute" style="font-weight:600; padding:4px 14px;">
                        ✨ 智能推断全量行程与分类
                    </button>
                </div>

                <div class="yn-quick-bar" id="yn-quick-bar-comm" style="display:none;">
                    <strong>📱 通信费快捷设定：</strong>
                    <span>发生年月/期间: </span>
                    <input type="text" id="yn-quick-comm-period" placeholder="自动计算或输入如: 2026-05" style="width:160px;" />
                    <span>费用说明/项目: </span>
                    <input type="text" id="yn-quick-comm-desc" value="" placeholder="选填：可留空" style="width:160px;" />
                    <button class="yn-btn yn-btn-primary" id="yn-btn-apply-comm">⚡ 应用至勾选行</button>
                </div>


                <div class="yn-table-container">
                    <table class="yn-table" id="yn-records-table">
                        <thead id="yn-table-thead"></thead>
                        <tbody id="yn-table-tbody">
                            <tr>
                                <td colspan="14" style="text-align:center; padding:50px; color:#8c8c8c;">
                                    点击上方【🔄 一键同步待报销数据】自动读取！
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="yn-footer">
                <div class="yn-progress-bar-wrap" id="yn-progress-wrap">
                    <div class="yn-progress-bar">
                        <div class="yn-progress-inner" id="yn-progress-inner"></div>
                    </div>
                    <div class="yn-log-box" id="yn-log-text">准备就绪</div>
                </div>
                <div style="margin-left:auto; display:flex; gap:10px;">
                    <button class="yn-btn" id="yn-btn-cancel-modal">关闭</button>
                    <button class="yn-btn yn-btn-success" id="yn-btn-batch-save" style="font-weight:600; padding:6px 22px;">
                        🚀 批量校验并保存为有效明细
                    </button>
                </div>
            </div>
        `;
    }

    return { btn, modal, mask };
}
