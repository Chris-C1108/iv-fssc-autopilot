import { GlobalState, TripApplicationConfig } from '../types/state';
import {
    buildAllTripConfigurations,
    combineTripsForMainApplicant,
    createSingleTripApplicationApi,
    calculateDaysAndNights,
    parseItineraryTable,
    DynamicTripInput
} from '../services/applicationService';
import { injectApplicationStyles } from './applicationStyles';
import { showToast } from '../utils/toast';
import { AutopilotLogger } from '../utils/logger';
import { mountToDock } from './floatingDock';

let activeFilter = 'ALL';

export function createApplicationLauncherBtn(state: GlobalState): HTMLElement {
    const btnId = 'autopilot-trip-launcher';
    injectApplicationStyles();

    const count = state.tripApp?.configs.length || 0;
    const badgeText = count > 0 ? `${count}单` : '批量规划';

    const btn = mountToDock(btnId, () => {
        const b = document.createElement('div');
        b.id = btnId;
        b.className = 'trip-app-launcher-btn';
        b.addEventListener('click', () => {
            openApplicationModal(state);
        });
        return b;
    });

    btn.innerHTML = `
        <span>✈️ 批量出差申请</span>
        <span class="trip-app-launcher-badge" id="trip-launcher-badge">${badgeText}</span>
    `;

    return btn;
}

export function openApplicationModal(state: GlobalState) {
    injectApplicationStyles();

    // 初始化全局状态 (默认按最新规约启用正社员统提合并模式)
    if (!state.tripApp) {
        state.tripApp = {
            configs: [],
            rawInputs: [],
            mode: 'COMBINED',
            selectedTripIds: new Set(),
            isProcessing: false,
            progressText: '就绪，点击「一键极速批量创建草稿」开始执行',
            cityBufferPerDay: 100,
            trafficBufferPercent: 0.15,
            cityCache: {},
            personCache: {},
            projectCache: {}
        };
    } else if (!state.tripApp.mode) {
        state.tripApp.mode = 'COMBINED';
    }

    const modalId = 'trip-app-modal-overlay';
    let overlay = document.getElementById(modalId);
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.className = 'trip-app-modal-overlay';

    const firstProj = state.tripApp.configs.find(c => c.projectName)?.projectName;
    const headerTagText = firstProj || '企业差旅规划驾驶舱';

    overlay.innerHTML = `
        <div class="trip-app-modal-container">
            <!-- 头部 -->
            <div class="trip-app-header">
                <div class="trip-app-header-title">
                    <span>✈️ 出差申请批量驾驶舱</span>
                    <span class="trip-app-header-tag" id="trip-header-tag">${headerTagText}</span>
                    <span style="font-size: 11px; color: #94a3b8; font-weight: normal;">(支持正社员统提合并外驻、多行旅程、弹性Buffer预留与极速批量入库)</span>
                </div>
                <button class="trip-app-close-btn" id="trip-app-close">✕</button>
            </div>

            <!-- 统计指示栏 -->
            <div class="trip-app-stat-bar">
                <div class="trip-app-stat-group">
                    <div class="trip-app-stat-item">
                        <span class="trip-app-stat-label">待生成单据</span>
                        <span class="trip-app-stat-value" id="stat-total-count">${state.tripApp.configs.length} 张</span>
                    </div>
                    <div class="trip-app-stat-item">
                        <span class="trip-app-stat-label">已勾选单据</span>
                        <span class="trip-app-stat-value highlight" id="stat-selected-count">0 张</span>
                    </div>
                    <div class="trip-app-stat-item">
                        <span class="trip-app-stat-label">总预算金额 (含Buffer)</span>
                        <span class="trip-app-stat-value highlight" id="stat-total-amount">¥0</span>
                    </div>
                    <div class="trip-app-stat-item">
                        <span class="trip-app-stat-label">出行人员</span>
                        <span class="trip-app-stat-value" id="stat-persons-list" style="font-size: 13px;">暂无</span>
                    </div>
                </div>
                <div class="trip-app-actions">
                    <button class="trip-btn trip-btn-secondary" id="trip-btn-import-table">📥 导入行程表 (CSV)</button>
                    <button class="trip-btn trip-btn-secondary" id="trip-btn-open-webmcp">🤖 WebMCP 智能副驾</button>
                    <button class="trip-btn trip-btn-secondary" id="trip-btn-select-all">全选 / 反选</button>
                    <button class="trip-btn trip-btn-primary" id="trip-btn-batch-create">🚀 一键极速批量创建草稿</button>
                </div>
            </div>

            <!-- 控制与Buffer设置栏 -->
            <div class="trip-app-ctrl-bar">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="trip-app-filter-tabs" id="trip-filter-tabs">
                        <button class="trip-app-filter-tab active" data-filter="ALL">全部 (0)</button>
                    </div>
                    <button class="trip-btn ${state.tripApp.mode === 'COMBINED' ? 'trip-btn-primary' : 'trip-btn-secondary'}" id="trip-btn-mode-toggle" style="padding: 4px 10px; font-size: 11px; font-weight: 600;" title="点击切换申报模式">
                        👥 ${state.tripApp.mode === 'COMBINED' ? '模式: 正社员统提 (合报外驻)' : '模式: 每人独立提单'}
                    </button>
                </div>

                <div class="trip-app-buffer-settings">
                    <div class="trip-app-buffer-item">
                        <span>市内交通预留 (その他):</span>
                        <input type="number" id="input-city-buffer" class="trip-app-buffer-input" value="${state.tripApp.cityBufferPerDay}" step="50" min="0" max="500">
                        <span>元/天</span>
                    </div>
                    <div class="trip-app-buffer-item">
                        <span>交通改签弹性:</span>
                        <input type="number" id="input-traffic-buffer" class="trip-app-buffer-input" value="${Math.round(state.tripApp.trafficBufferPercent * 100)}" step="5" min="0" max="50">
                        <span>%</span>
                    </div>
                    <button class="trip-btn trip-btn-secondary" style="padding: 4px 10px; font-size: 11px;" id="trip-btn-recalc">重新测算金额</button>
                </div>
            </div>

            <!-- 数据明细表格 -->
            <div class="trip-app-table-wrapper">
                <table class="trip-app-table">
                    <thead>
                        <tr>
                            <th style="width: 36px; text-align: center;"><input type="checkbox" id="th-select-all" checked></th>
                            <th style="width: 55px;">行程</th>
                            <th style="width: 100px;">出行人</th>
                            <th style="width: 130px;">出差期间 (天数)</th>
                            <th style="width: 110px;">目的地</th>
                            <th style="min-width: 160px;">调研拠点/工厂</th>
                            <th style="width: 90px; text-align: right;">交通费(含改签)</th>
                            <th style="width: 80px; text-align: right;">住宿预估</th>
                            <th style="width: 75px; text-align: right;">误餐补助</th>
                            <th style="width: 80px; text-align: right;">市内Buffer</th>
                            <th style="width: 95px; text-align: right;">总预算</th>
                            <th style="width: 100px; text-align: center;">状态/单号</th>
                        </tr>
                    </thead>
                    <tbody id="trip-table-body">
                    </tbody>
                </table>
            </div>

            <!-- 底部执行日志与进度 -->
            <div class="trip-app-footer">
                <div class="trip-app-progress-bar-bg">
                    <div class="trip-app-progress-bar-fill" id="trip-progress-fill"></div>
                </div>
                <div class="trip-app-log-text" id="trip-log-text">
                    ${state.tripApp.progressText}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // 绑定关闭事件
    const closeBtn = overlay.querySelector('#trip-app-close');
    closeBtn?.addEventListener('click', () => overlay?.remove());

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    // 绑定导入行程表
    const importBtn = overlay.querySelector('#trip-btn-import-table');
    importBtn?.addEventListener('click', () => {
        showImportItineraryDialog(state, overlay);
    });

    // 绑定呼出 WebMCP
    const openMcpBtn = overlay.querySelector('#trip-btn-open-webmcp');
    openMcpBtn?.addEventListener('click', () => {
        overlay.remove();
        import('./webmcpModal').then(m => m.openWebMcpModal(state));
    });

    // 渲染表格数据与统计
    renderTableAndStats(state, overlay);

    // 重新测算金额
    const recalcBtn = overlay.querySelector('#trip-btn-recalc');
    recalcBtn?.addEventListener('click', () => {
        const cityBufInput = overlay.querySelector('#input-city-buffer') as HTMLInputElement;
        const trafBufInput = overlay.querySelector('#input-traffic-buffer') as HTMLInputElement;
        const cityBuf = Number(cityBufInput?.value || 100);
        const trafBuf = Number(trafBufInput?.value || 15) / 100;

        if (state.tripApp) {
            state.tripApp.cityBufferPerDay = cityBuf;
            state.tripApp.trafficBufferPercent = trafBuf;

            // 依据新 Buffer 动态重算当前所有行的金额
            state.tripApp.configs = state.tripApp.configs.map(c => {
                const { days } = calculateDaysAndNights(c.startDate, c.endDate);
                const otherFee = days * cityBuf;
                const baseTraffic = (c.trafficFee - c.trafficBuffer) > 0 ? (c.trafficFee - c.trafficBuffer) : c.trafficFee;
                const trafficBuffer = Math.round(baseTraffic * trafBuf);
                const trafficFee = baseTraffic + trafficBuffer;
                const totalAmount = trafficFee + c.hotelFee + c.mealFee + otherFee;
                return {
                    ...c,
                    otherFee,
                    trafficBuffer,
                    trafficFee,
                    totalAmount
                };
            });

            renderTableAndStats(state, overlay);
            showToast('info', '已更新预算 Buffer 并重新测算金额');
        }
    });

    // 切换提单模式 (正社员统提合并外驻 vs 每人独立提单)
    const modeToggleBtn = overlay.querySelector('#trip-btn-mode-toggle') as HTMLButtonElement;
    modeToggleBtn?.addEventListener('click', () => {
        if (!state.tripApp) return;
        const loginUser = state.currentUser?.userName || '';
        const rawInputs = (state.tripApp.rawInputs && state.tripApp.rawInputs.length > 0)
            ? state.tripApp.rawInputs
            : state.tripApp.configs.map(c => ({
                tripNo: c.tripNo,
                applicantName: c.applicantName,
                isProxy: c.isProxy,
                destination: c.destination,
                startDate: c.startDate,
                endDate: c.endDate,
                purpose: c.purpose,
                baseTrafficFee: c.trafficFee - c.trafficBuffer,
                projectName: c.projectName,
                legs: c.legs
            }));
        state.tripApp.rawInputs = rawInputs;

        if (state.tripApp.mode === 'COMBINED') {
            state.tripApp.mode = 'SEPARATE';
            state.tripApp.configs = buildAllTripConfigurations(
                state.tripApp.cityBufferPerDay,
                state.tripApp.trafficBufferPercent,
                rawInputs
            );
            showToast('info', '已切换为【每人独立提单模式】');
        } else {
            state.tripApp.mode = 'COMBINED';
            state.tripApp.configs = combineTripsForMainApplicant(
                rawInputs,
                loginUser,
                state.tripApp.cityBufferPerDay,
                state.tripApp.trafficBufferPercent
            );
            showToast('info', '已切换为【正社员统提模式】（合报外驻预算与多行旅程）');
        }
        state.tripApp.selectedTripIds = new Set(state.tripApp.configs.map(c => c.id));

        if (modeToggleBtn) {
            modeToggleBtn.className = `trip-btn ${state.tripApp.mode === 'COMBINED' ? 'trip-btn-primary' : 'trip-btn-secondary'}`;
            modeToggleBtn.innerHTML = `👥 ${state.tripApp.mode === 'COMBINED' ? '模式: 正社员统提 (合报外驻)' : '模式: 每人独立提单'}`;
        }

        renderTableAndStats(state, overlay);
    });

    // 全选 / 反选
    const selectAllBtn = overlay.querySelector('#trip-btn-select-all');
    selectAllBtn?.addEventListener('click', () => {
        if (!state.tripApp) return;
        const filtered = getFilteredConfigs(state);
        const allSelected = filtered.every(c => state.tripApp?.selectedTripIds.has(c.id));
        filtered.forEach(c => {
            if (allSelected) {
                state.tripApp?.selectedTripIds.delete(c.id);
            } else {
                state.tripApp?.selectedTripIds.add(c.id);
            }
        });
        renderTableAndStats(state, overlay);
    });

    // 表头全选
    const thSelectAll = overlay.querySelector('#th-select-all') as HTMLInputElement;
    thSelectAll?.addEventListener('change', () => {
        if (!state.tripApp) return;
        const filtered = getFilteredConfigs(state);
        filtered.forEach(c => {
            if (thSelectAll.checked) {
                state.tripApp?.selectedTripIds.add(c.id);
            } else {
                state.tripApp?.selectedTripIds.delete(c.id);
            }
        });
        renderTableAndStats(state, overlay);
    });

    // 🚀 一键批量创建执行
    const batchCreateBtn = overlay.querySelector('#trip-btn-batch-create') as HTMLButtonElement;
    batchCreateBtn?.addEventListener('click', async () => {
        if (!state.tripApp || state.tripApp.isProcessing) return;

        const targetConfigs = state.tripApp.configs.filter(c =>
            state.tripApp?.selectedTripIds.has(c.id) && c.status !== '已生成草稿'
        );

        if (targetConfigs.length === 0) {
            showToast('warning', '没有待创建的勾选单据');
            return;
        }

        const uniqueApplicants = Array.from(new Set(targetConfigs.map(c => c.applicantName))).join('、');
        const confirmMsg = `即将为【${uniqueApplicants}】极速创建 ${targetConfigs.length} 张出差申请草稿，是否继续？`;
        if (!confirm(confirmMsg)) return;

        state.tripApp.isProcessing = true;
        batchCreateBtn.disabled = true;
        batchCreateBtn.textContent = '⏳ 正在批量生成中...';

        const progressFill = overlay.querySelector('#trip-progress-fill') as HTMLElement;
        const logText = overlay.querySelector('#trip-log-text') as HTMLElement;

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < targetConfigs.length; i++) {
            const config = targetConfigs[i];
            config.status = '创建中';
            renderTableAndStats(state, overlay);

            const percent = Math.round(((i + 1) / targetConfigs.length) * 100);
            if (progressFill) progressFill.style.width = `${percent}%`;
            if (logText) {
                logText.textContent = `[${i + 1}/${targetConfigs.length}] 正在创建 Trip ${config.tripNo} (${config.applicantName} - ${config.destination})...`;
            }

            const res = await createSingleTripApplicationApi(config, state);

            if (res.success) {
                config.status = '已生成草稿';
                config.billCode = res.billCode;
                config.billMainId = res.billMainId;
                successCount++;
            } else {
                config.status = '失败';
                config.error = res.message;
                failCount++;
            }

            renderTableAndStats(state, overlay);
            // 稍作微小延迟避免过频
            await new Promise(r => setTimeout(r, 600));
        }

        state.tripApp.isProcessing = false;
        batchCreateBtn.disabled = false;
        batchCreateBtn.textContent = '🚀 一键极速批量创建草稿';

        if (logText) {
            logText.textContent = `🎉 批量处理完成！成功生成 ${successCount} 张草稿单据${failCount > 0 ? `，失败 ${failCount} 张` : ''}。可在申请单列表刷新查看。`;
        }
        showToast('success', `🎉 批量处理完毕！成功创建 ${successCount} 张出差申请草稿`);
    });
}

function getFilteredConfigs(state: GlobalState): TripApplicationConfig[] {
    if (!state.tripApp) return [];
    if (activeFilter === 'ALL') return state.tripApp.configs;
    return state.tripApp.configs.filter(c => c.applicantName === activeFilter);
}

function renderTableAndStats(state: GlobalState, overlay: HTMLElement) {
    if (!state.tripApp) return;

    // 动态构建 Filter Tabs
    const filterContainer = overlay.querySelector('#trip-filter-tabs');
    if (filterContainer) {
        const applicants = Array.from(new Set(state.tripApp.configs.map(c => c.applicantName)));
        const tabsHtml = [
            `<button class="trip-app-filter-tab ${activeFilter === 'ALL' ? 'active' : ''}" data-filter="ALL">全部 (${state.tripApp.configs.length})</button>`
        ];
        applicants.forEach(app => {
            const count = state.tripApp?.configs.filter(c => c.applicantName === app).length || 0;
            const isActive = activeFilter === app ? 'active' : '';
            tabsHtml.push(`<button class="trip-app-filter-tab ${isActive}" data-filter="${app}">${app} (${count})</button>`);
        });
        filterContainer.innerHTML = tabsHtml.join('');

        filterContainer.querySelectorAll('.trip-app-filter-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                activeFilter = tab.getAttribute('data-filter') || 'ALL';
                renderTableAndStats(state, overlay);
            });
        });
    }

    const filtered = getFilteredConfigs(state);
    const tbody = overlay.querySelector('#trip-table-body');
    if (!tbody) return;

    // 计算统计值
    const totalCount = state.tripApp.configs.length;
    const selectedCount = state.tripApp.configs.filter(c => state.tripApp?.selectedTripIds.has(c.id)).length;
    const totalSelectedAmount = state.tripApp.configs
        .filter(c => state.tripApp?.selectedTripIds.has(c.id))
        .reduce((sum, c) => sum + c.totalAmount, 0);

    const statTotalCount = overlay.querySelector('#stat-total-count');
    const statSelectedCount = overlay.querySelector('#stat-selected-count');
    const statTotalAmount = overlay.querySelector('#stat-total-amount');
    const statPersons = overlay.querySelector('#stat-persons-list');

    if (statTotalCount) statTotalCount.textContent = `${totalCount} 张`;
    if (statSelectedCount) statSelectedCount.textContent = `${selectedCount} 张`;
    if (statTotalAmount) statTotalAmount.textContent = `¥${totalSelectedAmount.toLocaleString()}`;

    if (statPersons) {
        const uniqueNames = Array.from(new Set(state.tripApp.configs.map(c => {
            return `${c.applicantName}${c.isProxy ? '(代办)' : '(本人)'}`;
        })));
        statPersons.textContent = uniqueNames.length > 0 ? uniqueNames.join(' · ') : '暂无数据';
    }

    // 表格为空状态渲染
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" style="text-align: center; padding: 48px 20px; color: #64748b;">
                    <div style="font-size: 32px; margin-bottom: 8px;">📋</div>
                    <div style="font-size: 15px; font-weight: 600; color: #334155; margin-bottom: 6px;">
                        ${state.tripApp.configs.length === 0 ? '暂无待生成的出差申请单' : '当前筛选人员无匹配行程'}
                    </div>
                    <div style="font-size: 12px; color: #94a3b8; max-width: 500px; margin: 0 auto 16px auto; line-height: 1.6;">
                        支持直接 <b>「📥 导入行程表」</b> (粘贴 Excel/CSV) 或呼出 <b>「🤖 WebMCP 智能副驾」</b> 自然语言自动规划。
                    </div>
                    ${state.tripApp.configs.length === 0 ? `
                    <div style="display: flex; justify-content: center; gap: 10px;">
                        <button class="trip-btn trip-btn-secondary" id="empty-import-btn">📥 导入行程表 (CSV/粘贴)</button>
                        <button class="trip-btn trip-btn-primary" id="empty-ai-btn">🤖 呼出 WebMCP 智能副驾</button>
                    </div>
                    ` : ''}
                </td>
            </tr>
        `;
        overlay.querySelector('#empty-import-btn')?.addEventListener('click', () => showImportItineraryDialog(state, overlay));
        overlay.querySelector('#empty-ai-btn')?.addEventListener('click', () => {
            overlay.remove();
            import('./webmcpModal').then(m => m.openWebMcpModal(state));
        });
        return;
    }

    // 渲染表格行
    tbody.innerHTML = filtered.map(c => {
        const isChecked = state.tripApp?.selectedTripIds.has(c.id) ? 'checked' : '';
        const isCombined = Boolean(c.isCombined || (c.travelers && c.travelers.length > 1));

        let applicantHtml = '';
        if (isCombined) {
            applicantHtml = `
                <div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-weight: 700; color: #0f172a;">${c.applicantName}</span>
                        <span class="trip-badge trip-badge-combined">正社员统提</span>
                    </div>
                    ${c.travelers && c.travelers.length > 1 ? `<div style="font-size: 11px; color: #0284c7; margin-top: 3px;">👥 含合报: ${c.travelers.join('、')}</div>` : ''}
                </div>
            `;
        } else {
            const proxyBadge = c.isProxy
                ? `<span class="trip-badge trip-badge-proxy">代办</span>`
                : `<span class="trip-badge trip-badge-self">本人</span>`;
            applicantHtml = `
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-weight: 600;">${c.applicantName}</span>
                    ${proxyBadge}
                </div>
            `;
        }

        let statusBadge = `<span class="trip-badge trip-badge-status-ready">就绪</span>`;
        if (c.status === '创建中') {
            statusBadge = `<span class="trip-badge trip-badge-status-busy">⏳ 创建中</span>`;
        } else if (c.status === '已生成草稿') {
            statusBadge = `<span class="trip-badge trip-badge-status-done" title="${c.billCode || ''}">✓ ${c.billCode || '已生成'}</span>`;
        } else if (c.status === '失败') {
            statusBadge = `<span class="trip-badge trip-badge-status-fail" title="${c.error || ''}">✕ 失败</span>`;
        }

        const datePeriod = `${c.startDate.slice(5)} ~ ${c.endDate.slice(5)} (${c.days}天${c.nights}晚)`;
        const legsCount = c.legs ? c.legs.length : 0;

        const legsPreviewHtml = legsCount > 0 ? `
            <div class="trip-legs-preview-box" id="legs-box-${c.id}" style="display: none;">
                <div style="font-size: 10px; font-weight: 700; color: #0284c7; margin-bottom: 4px;">✈️ 旅程明细 (ITINERARY - ${legsCount}行):</div>
                ${c.legs.map((leg, lIdx) => {
                    let flightTag = (leg.flightOrTrain || leg.transport || '飞机/高铁').trim();
                    const tName = (leg.travelerName || c.applicantName || '').trim();
                    const cleanT = tName.replace(/（.*）|\(.*\)/g, '').trim();
                    if (cleanT && !flightTag.includes(cleanT)) {
                        flightTag = `${flightTag} (${tName})`;
                    }
                    return `
                        <div class="trip-leg-item-row">
                            <span style="color: #94a3b8; font-size: 10px; width: 20px;">#${lIdx + 1}</span>
                            <span style="font-weight: 600; color: #1e293b; min-width: 75px;">${leg.date}</span>
                            <span style="color: #475569; min-width: 90px;">${leg.fromCity} ➔ ${leg.toCity}</span>
                            <span class="trip-leg-flight-pill" title="班次/工具 (出差人员名)">${flightTag}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        ` : '';

        return `
            <tr data-id="${c.id}">
                <td style="text-align: center;">
                    <input type="checkbox" class="trip-row-checkbox" data-id="${c.id}" ${isChecked}>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span style="font-weight: 600; color: #0284c7;">Trip ${c.tripNo}</span>
                            ${legsCount > 0 ? `<button class="trip-legs-toggle-btn" data-toggle-id="${c.id}" title="点击展开/收起多行旅程明细">${legsCount}行旅程 ▾</button>` : ''}
                        </div>
                        ${c.matchedHistoryBill ? `
                            <span style="font-size: 10px; color: #b45309; background: #fef3c7; border-radius: 4px; padding: 1px 4px; width: fit-content;" title="历史存在单据: ${c.matchedHistoryBill.billCode}">
                                已有草稿: ${c.matchedHistoryBill.billCode}
                            </span>
                        ` : ''}
                    </div>
                </td>
                <td>${applicantHtml}</td>
                <td>${datePeriod}</td>
                <td><span style="font-weight: 600;">${c.destination}</span></td>
                <td style="color: #64748b; font-size: 11px;" title="${c.targetFactories}">
                    ${c.targetFactories || '-'}
                    ${legsPreviewHtml}
                </td>
                <td style="text-align: right; color: #334155;" title="${c.feeFormulas?.trafficFormula || ''}">
                    ¥${c.trafficFee}
                    <div style="font-size: 10px; color: #94a3b8;">(缓冲+¥${c.trafficBuffer})</div>
                </td>
                <td style="text-align: right; color: #334155;" title="${c.feeFormulas?.hotelFormula || ''}">¥${c.hotelFee}</td>
                <td style="text-align: right; color: #334155;" title="${c.feeFormulas?.mealFormula || ''}">¥${c.mealFee}</td>
                <td style="text-align: right; color: #334155;" title="${c.feeFormulas?.otherFormula || ''}">
                    ¥${c.otherFee}
                    <div style="font-size: 10px; color: #94a3b8;">(¥${state.tripApp?.cityBufferPerDay}/天)</div>
                </td>
                <td style="text-align: right; font-weight: 700; color: #0f172a; font-size: 13px;" title="${c.feeFormulas?.totalFormula || ''}">
                    ¥${c.totalAmount.toLocaleString()}
                </td>
                <td style="text-align: center;">${statusBadge}</td>
            </tr>
        `;
    }).join('');

    // 绑定多行旅程展开/收起按钮
    tbody.querySelectorAll('.trip-legs-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = (e.currentTarget as HTMLElement).getAttribute('data-toggle-id');
            const box = tbody.querySelector(`#legs-box-${id}`) as HTMLElement;
            if (box) {
                const isHidden = box.style.display === 'none';
                box.style.display = isHidden ? 'block' : 'none';
                const rowsCount = box.querySelectorAll('.trip-leg-item-row').length;
                (e.currentTarget as HTMLElement).textContent = isHidden ? `${rowsCount}行旅程 ▴` : `${rowsCount}行旅程 ▾`;
            }
        });
    });

    // 绑定行 Checkbox 事件
    tbody.querySelectorAll('.trip-row-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            const id = target.getAttribute('data-id');
            if (id) {
                if (target.checked) {
                    state.tripApp?.selectedTripIds.add(id);
                } else {
                    state.tripApp?.selectedTripIds.delete(id);
                }
                renderTableAndStats(state, overlay);
            }
        });
    });
}

/**
 * 弹出导入行程表模态窗 (支持用户粘贴 CSV / TSV / Markdown 表格或上传文件)
 */
function showImportItineraryDialog(state: GlobalState, parentOverlay: HTMLElement) {
    const dialogId = 'trip-import-dialog-overlay';
    let dialog = document.getElementById(dialogId);
    if (dialog) dialog.remove();

    dialog = document.createElement('div');
    dialog.id = dialogId;
    dialog.className = 'trip-app-modal-overlay';
    dialog.style.zIndex = '100010';

    dialog.innerHTML = `
        <div class="trip-app-modal-container" style="max-width: 680px; max-height: 85vh;">
            <div class="trip-app-header">
                <div class="trip-app-header-title">
                    <span>📥 导入出差行程表</span>
                    <span class="trip-app-header-tag">CSV / Excel 粘贴 / Markdown</span>
                </div>
                <button class="trip-app-close-btn" id="import-close-btn">✕</button>
            </div>
            <div style="padding: 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;">
                <div style="font-size: 13px; color: #475569; line-height: 1.6;">
                    请在下方直接粘贴行程表格文本（支持逗号逗分、制表符 Tab、竖线 Markdown 表格）：<br>
                    <span style="font-size: 12px; color: #64748b;">
                        包含列名：<b>批次/序号</b>（可选）、<b>出行人</b>、<b>目的地</b>、<b>出发日期</b>、<b>返程日期</b>、<b>交通费</b>（可选）、<b>班次/车次/交通工具</b>（可选）、<b>事由</b>（可选）
                    </span>
                </div>
                <textarea id="import-text-area" style="width: 100%; height: 180px; padding: 10px; font-family: monospace; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 8px; box-sizing: border-box; resize: vertical;" placeholder="批次, 出行人, 目的地, 出发日期, 返程日期, 交通费, 班次/工具, 事由
1, 正社员, 金山, 2026-07-20, 2026-07-24, 600, 汽车/高铁, 现场实施与实地调研
1, 外驻员工A, 金山, 2026-07-21, 2026-07-24, 600, 汽车/高铁, 现场实施与实地调研"></textarea>

                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; gap: 8px;">
                        <button class="trip-btn trip-btn-secondary" id="import-sample-btn" style="font-size: 12px;">填充示范数据</button>
                        <label class="trip-btn trip-btn-secondary" style="font-size: 12px; cursor: pointer;">
                            📂 选择文件 (.csv/.txt)
                            <input type="file" id="import-file-input" accept=".csv,.txt,.tsv" style="display: none;">
                        </label>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="trip-btn trip-btn-secondary" id="import-cancel-btn">取消</button>
                        <button class="trip-btn trip-btn-primary" id="import-confirm-btn">⚡ 智能解析并载入驾驶舱</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    const close = () => dialog?.remove();
    dialog.querySelector('#import-close-btn')?.addEventListener('click', close);
    dialog.querySelector('#import-cancel-btn')?.addEventListener('click', close);

    const textArea = dialog.querySelector('#import-text-area') as HTMLTextAreaElement;

    // 填充示范数据 (展示新规约：正社员统提合并外驻多行旅程)
    dialog.querySelector('#import-sample-btn')?.addEventListener('click', () => {
        const loginName = state.currentUser?.userName || '当前用户';
        textArea.value = `批次, 出行人, 目的地, 出发日期, 返程日期, 交通费, 班次/工具, 事由
1, ${loginName}, 金山, 2026-07-20, 2026-07-24, 600, 汽车/高铁, 金山现场实施与实地调研
1, 外驻员工A, 金山, 2026-07-21, 2026-07-24, 600, 汽车/高铁, 金山现场实施与实地调研
1, 外驻员工B, 金山, 2026-07-21, 2026-07-24, 600, 汽车/高铁, 金山现场实施与实地调研
2, ${loginName}, 广州, 2026-08-10, 2026-08-13, 1850, MU5101, 广州技术研讨与实地调研
2, 外驻员工A, 广州, 2026-08-10, 2026-08-13, 1850, MU5101, 广州技术研讨与实地调研`;
    });

    // 文件选择读取
    const fileInput = dialog.querySelector('#import-file-input') as HTMLInputElement;
    fileInput?.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (typeof e.target?.result === 'string') {
                    textArea.value = e.target.result;
                }
            };
            reader.readAsText(file);
        }
    });

    // 确认解析载入
    dialog.querySelector('#import-confirm-btn')?.addEventListener('click', () => {
        const text = textArea.value.trim();
        if (!text) {
            showToast('warning', '请先粘贴或上传行程数据');
            return;
        }

        const parsed = parseItineraryTable(text);
        if (parsed.length === 0) {
            showToast('error', '未能识别有效行程，请检查表格是否包含出行人、目的地、出发日期、返程日期');
            return;
        }

        if (!state.tripApp) return;

        const loginUser = state.currentUser?.userName || '';
        // 自动识别是否属于本人或代办
        parsed.forEach(p => {
            p.isProxy = Boolean(loginUser && p.applicantName && p.applicantName !== loginUser && p.applicantName !== '本人');
        });

        state.tripApp.rawInputs = parsed;

        let newConfigs: TripApplicationConfig[] = [];
        if (state.tripApp.mode === 'COMBINED') {
            newConfigs = combineTripsForMainApplicant(
                parsed,
                loginUser,
                state.tripApp.cityBufferPerDay,
                state.tripApp.trafficBufferPercent
            );
        } else {
            newConfigs = buildAllTripConfigurations(
                state.tripApp.cityBufferPerDay,
                state.tripApp.trafficBufferPercent,
                parsed
            );
        }

        state.tripApp.configs = newConfigs;
        state.tripApp.selectedTripIds = new Set(newConfigs.map(c => c.id));

        const badge = document.getElementById('trip-launcher-badge');
        if (badge) badge.textContent = `${newConfigs.length}单`;

        renderTableAndStats(state, parentOverlay);
        close();
        showToast('success', `🎉 成功解析并导入！已按【${state.tripApp.mode === 'COMBINED' ? '正社员统提模式' : '每人独立模式'}】生成 ${newConfigs.length} 笔单据`);
    });
}
