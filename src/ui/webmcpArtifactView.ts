import { TripApplicationConfig, TripLeg } from '../types/state';
import { showToast } from '../utils/toast';

let currentArtifactOverlay: HTMLElement | null = null;

/**
 * 弹出出差申请全景透视 Artifact (Generative Trip Plan Artifact)
 * 提供一屏全览、KPI 汇总、横向对比表格、旅程多行穿透与就地审批
 */
export function openTripPlanArtifact(
    configs: TripApplicationConfig[],
    onApprove?: () => Promise<void>
): void {
    if (currentArtifactOverlay) {
        currentArtifactOverlay.remove();
        currentArtifactOverlay = null;
    }

    const totalBills = configs.length;
    const totalBudget = configs.reduce((s, c) => s + c.totalAmount, 0);
    const totalTraffic = configs.reduce((s, c) => s + c.trafficFee, 0);
    const totalHotel = configs.reduce((s, c) => s + c.hotelFee, 0);
    const totalMeal = configs.reduce((s, c) => s + c.mealFee, 0);
    const totalOther = configs.reduce((s, c) => s + c.otherFee, 0);

    const isAnyCombined = configs.some(c => c.isCombined || (c.travelers && c.travelers.length > 1));

    const overlay = document.createElement('div');
    overlay.className = 'webmcp-artifact-overlay';
    overlay.id = 'webmcp-artifact-overlay';

    overlay.innerHTML = `
        <div class="webmcp-artifact-modal">
            <!-- 头部导航与操作栏 -->
            <div class="webmcp-artifact-header">
                <div class="webmcp-artifact-title-group">
                    <span class="webmcp-artifact-icon">📑</span>
                    <div>
                        <div class="webmcp-artifact-title">
                            出差规划方案全景透视 (Trip Plan Artifact)
                            <span class="webmcp-artifact-badge-count">共 ${totalBills} 张单据</span>
                            ${isAnyCombined ? '<span class="webmcp-artifact-badge-mode">正社员统提 (合报外驻)</span>' : '<span class="webmcp-artifact-badge-mode">每人独立申报</span>'}
                        </div>
                        <div class="webmcp-artifact-subtitle">
                            由 WebMCP 5 维要素引擎智能装配，覆盖交通票价与改签弹性 (15%) 及市内出租车 Buffer (¥100/天)
                        </div>
                    </div>
                </div>
                <div class="webmcp-artifact-header-actions">
                    <button class="webmcp-artifact-action-btn" id="art-btn-copy-md" title="复制 Markdown 规划总表">📋 复制 Markdown</button>
                    <button class="webmcp-artifact-action-btn" id="art-btn-export-json" title="导出 JSON 方案数据">📥 导出 JSON</button>
                    <button class="webmcp-artifact-close-btn" id="art-btn-close" title="关闭">✕</button>
                </div>
            </div>

            <!-- 核心 KPI 汇总看板 -->
            <div class="webmcp-artifact-kpi-grid">
                <div class="webmcp-artifact-kpi-card highlight">
                    <div class="webmcp-kpi-label">💰 申请总预算 (含Buffer)</div>
                    <div class="webmcp-kpi-val highlight">¥${totalBudget.toLocaleString()}</div>
                    <div class="webmcp-kpi-sub">累计 ${totalBills} 张出差申请</div>
                </div>
                <div class="webmcp-artifact-kpi-card">
                    <div class="webmcp-kpi-label">🎫 交通费 (含改签Buffer)</div>
                    <div class="webmcp-kpi-val">¥${totalTraffic.toLocaleString()}</div>
                    <div class="webmcp-kpi-sub">往返大交通及浮动弹性</div>
                </div>
                <div class="webmcp-artifact-kpi-card">
                    <div class="webmcp-kpi-label">🏨 酒店住宿预估</div>
                    <div class="webmcp-kpi-val">¥${totalHotel.toLocaleString()}</div>
                    <div class="webmcp-kpi-sub">匹配一二线城市限额</div>
                </div>
                <div class="webmcp-artifact-kpi-card">
                    <div class="webmcp-kpi-label">🍱 误餐生活补贴</div>
                    <div class="webmcp-kpi-val">¥${totalMeal.toLocaleString()}</div>
                    <div class="webmcp-kpi-sub">按起止天数自动核算</div>
                </div>
                <div class="webmcp-artifact-kpi-card">
                    <div class="webmcp-kpi-label">🚗 市内交通 Buffer</div>
                    <div class="webmcp-kpi-val">¥${totalOther.toLocaleString()}</div>
                    <div class="webmcp-kpi-sub">¥100/人/天 出租/网约车预留</div>
                </div>
            </div>

            <!-- 全量单据对比表格 -->
            <div class="webmcp-artifact-body">
                <div class="webmcp-artifact-table-container">
                    <table class="webmcp-artifact-table">
                        <thead>
                            <tr>
                                <th style="width: 55px; text-align: center;">序号</th>
                                <th style="width: 140px;">出行人员 / 申请人</th>
                                <th style="width: 130px;">目的地</th>
                                <th style="width: 150px;">出差日期 / 时长</th>
                                <th style="width: 110px; text-align: right;">交通+改签</th>
                                <th style="width: 100px; text-align: right;">酒店住宿</th>
                                <th style="width: 90px; text-align: right;">误餐补贴</th>
                                <th style="width: 95px; text-align: right;">市内Buffer</th>
                                <th style="width: 120px; text-align: right;">预算总计</th>
                                <th style="width: 110px; text-align: center;">旅程多行明细</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${configs.map((c, idx) => {
                                const travelersStr = c.travelers && c.travelers.length > 1
                                    ? c.travelers.join('、')
                                    : c.applicantName;
                                const isProxyTag = c.isProxy ? '<span class="art-tag proxy">代办</span>' : '<span class="art-tag self">本人</span>';
                                const combinedTag = c.isCombined ? '<span class="art-tag combined">合报外驻</span>' : '';
                                const legCount = c.legs ? c.legs.length : 2;

                                return `
                                    <tr class="art-row" data-idx="${idx}">
                                        <td style="text-align: center; font-weight: 700; color: #4338ca;">Trip ${c.tripNo || (idx + 1)}</td>
                                        <td>
                                            <div style="font-weight: 600; color: #1e293b;">${c.applicantName}</div>
                                            <div style="display: flex; gap: 4px; align-items: center; margin-top: 2px;">
                                                ${isProxyTag}
                                                ${combinedTag}
                                            </div>
                                            ${c.travelers && c.travelers.length > 1 ? `<div style="font-size: 11px; color: #64748b; margin-top: 3px;">含合报: ${travelersStr}</div>` : ''}
                                        </td>
                                        <td>
                                            <div style="font-weight: 600; color: #0f172a;">上海 ➔ ${c.destination}</div>
                                            ${c.targetFactories ? `<div style="font-size: 11px; color: #4338ca; margin-top: 2px;">🏭 ${c.targetFactories}</div>` : ''}
                                            ${c.hotelName ? `<div style="font-size: 11px; color: #0284c7; margin-top: 2px;">🏨 ${c.hotelName}</div>` : ''}
                                            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${c.purpose || '业务出差调研'}</div>
                                        </td>
                                        <td>
                                            <div style="font-family: monospace; font-size: 12px; color: #334155;">${c.startDate} ~ ${c.endDate}</div>
                                            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">共 ${c.days} 天 ${c.nights} 晚</div>
                                        </td>
                                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: #0284c7;" title="${c.feeFormulas?.trafficFormula || ''}">¥${c.trafficFee.toLocaleString()}</td>
                                        <td style="text-align: right; font-family: monospace; color: #475569;" title="${c.feeFormulas?.hotelFormula || ''}">¥${c.hotelFee.toLocaleString()}</td>
                                        <td style="text-align: right; font-family: monospace; color: #475569;" title="${c.feeFormulas?.mealFormula || ''}">¥${c.mealFee.toLocaleString()}</td>
                                        <td style="text-align: right; font-family: monospace; color: #d97706;" title="${c.feeFormulas?.otherFormula || ''}">¥${c.otherFee.toLocaleString()}</td>
                                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: #15803d; font-size: 13.5px;" title="${c.feeFormulas?.totalFormula || ''}">¥${c.totalAmount.toLocaleString()}</td>
                                        <td style="text-align: center;">
                                            <button class="art-toggle-legs-btn" data-target="legs-row-${idx}">
                                                <span>行程 (${legCount}行)</span>
                                                <span class="art-toggle-arrow">▼</span>
                                            </button>
                                        </td>
                                    </tr>
                                    <tr class="art-legs-expand-row" id="legs-row-${idx}" style="display: none;">
                                        <td colspan="10" style="padding: 10px 16px; background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                                            <div class="art-legs-detail-panel">
                                                ${c.matchedHistoryBill ? `
                                                    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 12px; margin-bottom: 8px; font-size: 11.5px; color: #92400e; display: flex; justify-content: space-between; align-items: center;">
                                                        <span>⚠️ <strong>系统历史单据交叉比对</strong>: 命中历史单据 <strong>${c.matchedHistoryBill.billCode}</strong> (${c.matchedHistoryBill.statusName} · 金额: ${c.matchedHistoryBill.amount})</span>
                                                        <span style="font-size: 10.5px; color: #b45309;">申请日: ${c.matchedHistoryBill.billDate}</span>
                                                    </div>
                                                ` : ''}
                                                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 8px; font-size: 11.5px; line-height: 1.6; color: #475569;">
                                                    <div style="font-weight: 700; color: #0f172a; margin-bottom: 2px;">📐 费用测算依据公式:</div>
                                                    <div>• <strong>交通+改签</strong>: ${c.feeFormulas?.trafficFormula || `¥${c.trafficFee}`}</div>
                                                    <div>• <strong>酒店住宿</strong>: ${c.feeFormulas?.hotelFormula || `¥${c.hotelFee}`}</div>
                                                    <div>• <strong>误餐补贴</strong>: ${c.feeFormulas?.mealFormula || `¥${c.mealFee}`}</div>
                                                    <div>• <strong>市内Buffer</strong>: ${c.feeFormulas?.otherFormula || `¥${c.otherFee}`}</div>
                                                </div>
                                                <div class="art-legs-detail-title">
                                                    <span>🗺️ 旅程明细区 (T_BILL_AREA_CCS_DEF_001) · 共 ${legCount} 段行程</span>
                                                    <span style="font-size: 11px; color: #64748b;">(班次/交通工具均按规约标注出差人员姓名)</span>
                                                </div>
                                                <div class="art-legs-grid">
                                                    ${(c.legs || []).map((l: TripLeg, lIdx: number) => {
                                                        const trav = l.travelerName || c.applicantName;
                                                        const cleanT = trav.replace(/（.*）|\(.*\)/g, '').trim();
                                                        let flightDisplay = l.flightOrTrain || l.transport || '飞机/高铁';
                                                        if (!flightDisplay.includes(cleanT)) {
                                                            flightDisplay = `${flightDisplay} | (${trav})`;
                                                        }
                                                        return `
                                                            <div class="art-leg-card">
                                                                <div class="art-leg-seq">#${lIdx + 1}</div>
                                                                <div class="art-leg-info">
                                                                    <div class="art-leg-date">📅 ${l.date}</div>
                                                                    <div class="art-leg-route">${l.fromCity} ➔ ${l.toCity}</div>
                                                                    <div class="art-leg-transport">
                                                                        <span class="art-leg-pill">${flightDisplay}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        `;
                                                    }).join('')}
                                                </div>
                                                <div class="art-legs-footer">
                                                    <strong>单据备注 (F_BKREMA):</strong> 预留市内交通Buffer: ¥${c.otherFee}; 改签Buffer: ¥${c.trafficBuffer}${c.travelers && c.travelers.length > 1 ? `; 合报出差人员: ${c.travelers.join('、')}` : ''}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 底部操作与审批门禁联动栏 -->
            <div class="webmcp-artifact-footer">
                <div class="webmcp-artifact-footer-info">
                    <span>🛡️ <strong>人在回路 (HITL) 决策支持</strong>：您可在此全景审核全量单据，核准后即刻入库为元年草稿。</span>
                </div>
                <div class="webmcp-artifact-footer-actions">
                    <button class="webmcp-artifact-btn-secondary" id="art-btn-bottom-close">稍后决定 (关闭)</button>
                    ${onApprove ? `
                        <button class="webmcp-artifact-btn-primary" id="art-btn-execute-approve">
                            ✅ 批准并保存入库草稿 (Save Draft · ${totalBills}张)
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    currentArtifactOverlay = overlay;

    // 绑定事件: 关闭
    const closeBtn = overlay.querySelector('#art-btn-close');
    const bottomCloseBtn = overlay.querySelector('#art-btn-bottom-close');
    const doClose = () => {
        overlay.classList.add('fade-out');
        setTimeout(() => {
            overlay.remove();
            if (currentArtifactOverlay === overlay) currentArtifactOverlay = null;
        }, 200);
    };
    closeBtn?.addEventListener('click', doClose);
    bottomCloseBtn?.addEventListener('click', doClose);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) doClose();
    });

    // 绑定事件: 展开/折叠单条旅程明细
    overlay.querySelectorAll('.art-toggle-legs-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            if (!targetId) return;
            const row = overlay.querySelector(`#${targetId}`) as HTMLElement;
            const arrow = btn.querySelector('.art-toggle-arrow') as HTMLElement;
            if (row) {
                const isHidden = row.style.display === 'none';
                row.style.display = isHidden ? 'table-row' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
            }
        });
    });

    // 绑定事件: 导出 JSON
    const exportJsonBtn = overlay.querySelector('#art-btn-export-json');
    exportJsonBtn?.addEventListener('click', () => {
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(configs, null, 2));
        const a = document.createElement('a');
        a.setAttribute('href', dataStr);
        a.setAttribute('download', `trip_application_plan_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast('success', '已成功导出方案 JSON 数据文件');
    });

    // 绑定事件: 复制 Markdown
    const copyMdBtn = overlay.querySelector('#art-btn-copy-md');
    copyMdBtn?.addEventListener('click', () => {
        let md = `# 出差申请规划方案全景表\n\n`;
        md += `> **总计**: ${totalBills} 张单据 | **总预算预留**: ¥${totalBudget.toLocaleString()} | **测算时间**: ${new Date().toLocaleString()}\n\n`;
        md += `| 序号 | 申请人/出行人员 | 目的地 | 出差起止日期 | 交通+改签 | 酒店住宿 | 误餐补贴 | 市内Buffer | 预算总计 |\n`;
        md += `| :---: | :--- | :--- | :---: | ---: | ---: | ---: | ---: | ---: |\n`;
        configs.forEach((c, i) => {
            const travelers = c.travelers && c.travelers.length > 1 ? c.travelers.join('、') : c.applicantName;
            md += `| Trip ${c.tripNo || (i + 1)} | ${travelers} | 上海 ➔ ${c.destination} | ${c.startDate} ~ ${c.endDate} (${c.days}天${c.nights}晚) | ¥${c.trafficFee} | ¥${c.hotelFee} | ¥${c.mealFee} | ¥${c.otherFee} | **¥${c.totalAmount}** |\n`;
        });
        navigator.clipboard.writeText(md).then(() => {
            showToast('success', '全量规划方案 Markdown 表格已复制到剪贴板！');
        }).catch(() => {
            showToast('info', '复制失败，请手动选择');
        });
    });

    // 绑定事件: 就地批准执行
    if (onApprove) {
        const executeBtn = overlay.querySelector('#art-btn-execute-approve') as HTMLButtonElement;
        executeBtn?.addEventListener('click', async () => {
            executeBtn.disabled = true;
            executeBtn.textContent = '⏳ 正在入库执行中...';
            try {
                await onApprove();
                executeBtn.textContent = '✓ 已批准入库';
                executeBtn.style.background = '#15803d';
                setTimeout(doClose, 1000);
            } catch (err: any) {
                executeBtn.disabled = false;
                executeBtn.textContent = '❌ 执行失败，点击重试';
                showToast('error', `入库失败: ${err.message}`);
            }
        });
    }
}
