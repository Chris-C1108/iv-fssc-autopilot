import { TimeMgState, ProjectExpItem, AllocatedDayPlan, BudgetShortfallInfo, AttendanceDetailItem } from '../types/timeMgTypes';
import { AutopilotLogger } from '../utils/logger';
import { computeProjectAllocationPlan, calculateBudgetShortfall } from '../services/timeMgAllocation';
import { detectActiveYearAndMonth } from '../services/timeMgService';

/**
 * 构造考勤工数副驾的主模态框与悬浮入口
 */
export function createTimeMgModalDOM(state: TimeMgState) {
    if (document.getElementById('yn-timemg-helper-btn')) return;

    // 1. 悬浮按钮
    const btn = document.createElement('div');
    btn.id = 'yn-timemg-helper-btn';
    btn.innerHTML = `
        <span class="yn-timemg-badge"></span>
        <span>⏱️ 考勤工数副驾</span>
    `;
    document.body.appendChild(btn);

    // 2. 模态框遮罩
    const mask = document.createElement('div');
    mask.id = 'yn-timemg-modal-mask';
    document.body.appendChild(mask);

    // 3. 模态框主体
    const modal = document.createElement('div');
    modal.id = 'yn-timemg-modal';

    const activeYM = detectActiveYearAndMonth();
    const currentYear = state.selectedYear || activeYM.year;
    const currentMonth = state.selectedMonth || activeYM.month;
    state.selectedYear = currentYear;
    state.selectedMonth = currentMonth;

    modal.innerHTML = `
        <!-- 头部 Header -->
        <div class="yn-timemg-header">
            <div class="yn-timemg-header-title">
                <span>⏱️ 爱模考勤工数极速分配副驾</span>
                <span class="yn-timemg-header-subtitle">time-mg.huge-vision.com | 09:00~17:30 标准基准 & 门禁智能推断</span>
            </div>
            <button class="yn-timemg-close-btn" id="yn-timemg-modal-close" title="关闭">✕</button>
        </div>

        <!-- 顶部工具栏 -->
        <div class="yn-timemg-toolbar">
            <div class="yn-timemg-toolbar-left">
                <label style="font-weight:600; color:#595959;">考勤年月：</label>
                <input type="number" id="yn-timemg-input-year" value="${currentYear}" style="width:72px; padding:4px 8px; border:1px solid #d9d9d9; border-radius:4px; font-size:13px;" />
                <span style="color:#8c8c8c;">年</span>
                <input type="number" id="yn-timemg-input-month" min="1" max="12" value="${parseInt(currentMonth, 10)}" style="width:52px; padding:4px 8px; border:1px solid #d9d9d9; border-radius:4px; font-size:13px;" />
                <span style="color:#8c8c8c;">月</span>
                <button class="yn-timemg-btn yn-timemg-btn-primary" id="yn-timemg-btn-sync">🔄 同步考勤与项目数据</button>
                <button class="yn-timemg-btn yn-timemg-btn-default" id="yn-timemg-btn-recalc">⚡ 智能重算分配</button>
            </div>
            <div class="yn-timemg-toolbar-right">
                <button class="yn-timemg-btn yn-timemg-btn-success" id="yn-timemg-btn-autofill">💾 一键填报并保存考勤 (Twin Client)</button>
            </div>
        </div>

        <!-- 主体双栏区域 -->
        <div class="yn-timemg-body">
            <!-- 左栏: 项目工时预实对比表 -->
            <div class="yn-timemg-panel">
                <div class="yn-timemg-panel-header">
                    <span>📊 项目工时预实对比表</span>
                    <span id="yn-timemg-proj-summary" style="font-size:11.5px; font-weight:normal; color:#8c8c8c;">0 个项目</span>
                </div>
                <div class="yn-timemg-panel-content">
                    <table class="yn-timemg-table">
                        <thead>
                            <tr>
                                <th style="width:68px; text-align:center;">允许超额</th>
                                <th style="width:85px;">项目编号</th>
                                <th style="width:48px; text-align:right;">预计</th>
                                <th style="width:46px; text-align:right;">已填</th>
                                <th style="width:52px; text-align:right;">拟分</th>
                                <th style="width:92px; text-align:right;">超额/剩余</th>
                                <th>项目名称</th>
                            </tr>
                        </thead>
                        <tbody id="yn-timemg-proj-tbody">
                            <tr>
                                <td colspan="7" style="text-align:center; padding:30px; color:#8c8c8c;">
                                    点击上方【🔄 同步考勤与项目数据】开始
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 右栏: 考勤一览明细与分配预览 -->
            <div class="yn-timemg-panel">
                <div class="yn-timemg-panel-header">
                    <span>📅 出勤日工时分配预览 (09:00 ~ 17:30)</span>
                    <span id="yn-timemg-plan-summary" style="font-size:11.5px; font-weight:normal; color:#8c8c8c;">0 天工作日</span>
                </div>
                <div class="yn-timemg-panel-content">
                    <table class="yn-timemg-table">
                        <thead>
                            <tr>
                                <th style="width:34px; text-align:center;">#</th>
                                <th style="width:62px;">日期</th>
                                <th style="width:108px; text-align:center;">类型</th>
                                <th style="width:105px; text-align:center;">打卡记录</th>
                                <th style="width:155px; text-align:center;">出勤时间</th>
                                <th style="width:58px; text-align:center;">地点</th>
                                <th style="width:88px;">项目编号</th>
                                <th style="max-width:240px;">项目名称</th>
                                <th style="width:75px; text-align:center;">状态</th>
                            </tr>
                        </thead>
                        <tbody id="yn-timemg-plan-tbody">
                            <tr>
                                <td colspan="9" style="text-align:center; padding:40px; color:#8c8c8c;">
                                    暂无分配数据。请点击上方【🔄 同步考勤与项目数据】！
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- 底部进度条 -->
        <div class="yn-timemg-progress-wrap" id="yn-timemg-progress-wrap">
            <div class="yn-timemg-progress-bar">
                <div class="yn-timemg-progress-inner" id="yn-timemg-progress-inner"></div>
            </div>
            <div class="yn-timemg-log-text" id="yn-timemg-log-text">准备就绪</div>
        </div>

        <!-- 底部实时运行日志控制台与一键复制 -->
        <div class="yn-timemg-footer-console">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <button id="yn-timemg-btn-togglelog" style="background:none; border:none; color:#595959; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:6px; padding:2px 0; user-select:none;">
                    <span>📝 运行与调试日志</span>
                    <span id="yn-timemg-log-count" style="font-weight:normal; color:#8c8c8c; font-size:11px;">(0 条记录)</span>
                    <span id="yn-timemg-log-arrow" style="font-size:11px; color:#096dd9;">▾ 点击展开</span>
                </button>
                <button class="yn-timemg-btn yn-timemg-btn-default" id="yn-timemg-btn-copylog" style="padding:2px 10px; font-size:11.5px; height:24px; display:flex; align-items:center; gap:4px;">
                    📋 复制完整执行日志
                </button>
            </div>
            <div id="yn-timemg-log-stream">
                <div style="color:#6a9955;">// ⏱️ 爱模考勤工数副驾日志就绪...</div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 绑定日志展开/收起切换
    const toggleLogBtn = document.getElementById('yn-timemg-btn-togglelog');
    const streamEl = document.getElementById('yn-timemg-log-stream');
    const arrowEl = document.getElementById('yn-timemg-log-arrow');
    if (toggleLogBtn && streamEl && arrowEl) {
        toggleLogBtn.addEventListener('click', () => {
            const isHidden = streamEl.style.display === 'none' || !streamEl.style.display;
            if (isHidden) {
                streamEl.style.display = 'block';
                arrowEl.innerText = '▴ 点击收起';
            } else {
                streamEl.style.display = 'none';
                arrowEl.innerText = '▾ 点击展开';
            }
        });
    }

    // 订阅全局日志流
    let logCount = 0;
    AutopilotLogger.subscribe(entry => {
        const stream = document.getElementById('yn-timemg-log-stream');
        const countEl = document.getElementById('yn-timemg-log-count');
        if (!stream) return;
        
        logCount++;
        if (countEl) countEl.innerText = `(${logCount} 条记录)`;

        const line = document.createElement('div');
        const color = entry.level === 'ERROR' ? '#f14c4c' : (entry.level === 'WARN' ? '#cca700' : (entry.level === 'SUCCESS' ? '#73c991' : '#9cdcfe'));
        line.innerHTML = `<span style="color:#6e7681;">[${entry.time}]</span> <span style="color:${color}; font-weight:600;">[${entry.level}]</span> ${entry.message}`;
        stream.appendChild(line);
        stream.scrollTop = stream.scrollHeight;
    });
}

/**
 * 渲染左侧项目预实对比表 (显示拟分工时与超额/剩余量)
 */
export function renderTimeMgExpProjects(
    projects: ProjectExpItem[],
    state?: TimeMgState,
    onToggleOverflow?: (pjNo: string, checked: boolean) => void
) {
    const tbody = document.getElementById('yn-timemg-proj-tbody');
    const summaryEl = document.getElementById('yn-timemg-proj-summary');
    if (!tbody) return;

    if (projects.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#8c8c8c;">未获取到项目预实对比数据</td></tr>`;
        if (summaryEl) summaryEl.innerText = '0 个项目';
        return;
    }

    if (summaryEl) {
        const totalExp = projects.reduce((sum, p) => sum + parseFloat(p.expWH || '0'), 0).toFixed(2);
        summaryEl.innerText = `共 ${projects.length} 个项目 (总预计 ${totalExp}h)`;
    }

    tbody.innerHTML = '';
    projects.forEach(p => {
        const exp = parseFloat(p.expWH || '0');
        const act = parseFloat(p.workingHours || '0');
        
        // 计算该项目在当月分配计划中的总拟分工时 (不含历史已填写行)
        const allocatedWh = (state?.allocatedPlans || [])
            .filter(plan => plan.isWorkDay && plan.pjNo === p.pjNo && plan.status !== '已填写')
            .reduce((sum, plan) => sum + (plan.timeWH || 0), 0);

        const totalPostFill = parseFloat((act + allocatedWh).toFixed(2));
        const isAllowed = state && state.allowedOverflowPjNos ? state.allowedOverflowPjNos.includes(p.pjNo) : false;

        let diffHtml = '';
        if (totalPostFill > exp) {
            const overHours = (totalPostFill - exp).toFixed(2);
            diffHtml = `<span class="yn-timemg-badge-overflow" title="超出预计预算 ${overHours}h">超 +${overHours}h</span>`;
        } else if (totalPostFill === exp) {
            diffHtml = `<span style="color:#52c41a; font-weight:600; white-space:nowrap;">余 0.00h</span>`;
        } else {
            const remainHours = (exp - totalPostFill).toFixed(2);
            diffHtml = `<span style="color:#fa8c16; font-weight:600; white-space:nowrap;">余 ${remainHours}h</span>`;
        }

        const tr = document.createElement('tr');
        if (isAllowed) tr.className = 'is-overflow-row';

        tr.innerHTML = `
            <td style="text-align:center; padding:6px 2px;">
                <input type="checkbox" class="yn-timemg-cb-overflow" data-pjno="${p.pjNo}" ${isAllowed ? 'checked' : ''} style="cursor:pointer; width:15px; height:15px; accent-color:#096dd9; vertical-align:middle;" title="勾选后允许【${p.pjNo}】超出预算分摊缺口工时" />
            </td>
            <td style="font-weight:700; color:#096dd9; font-family:monospace; font-size:12px;">${p.pjNo}</td>
            <td style="text-align:right; font-weight:600; color:#262626;">${p.expWH}h</td>
            <td style="text-align:right; color:#52c41a; font-weight:600;">${p.workingHours}h</td>
            <td style="text-align:right;">
                <strong style="color:${allocatedWh > 0 ? '#096dd9' : '#8c8c8c'};">${allocatedWh > 0 ? `${allocatedWh.toFixed(2)}h` : '-'}</strong>
            </td>
            <td style="text-align:right;">
                ${diffHtml}
            </td>
            <td style="color:#595959; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;" title="${p.name}">
                ${p.name}
            </td>
        `;
        tbody.appendChild(tr);
    });

    // 绑定复选框变更事件
    tbody.querySelectorAll('.yn-timemg-cb-overflow').forEach((cb: any) => {
        cb.addEventListener('change', () => {
            const pjNo = cb.getAttribute('data-pjno');
            const checked = cb.checked;
            if (onToggleOverflow) onToggleOverflow(pjNo, checked);
        });
    });
}

/**
 * 宿主页面数据加载后即时自动计算并渲染工时缺口 Badge，并实时监听宿主月份切换
 */
export function autoInitHostCollapseBadge() {
    let isWatching = false;

    const calcAndApply = () => {
        const allEls = Array.from(document.querySelectorAll('*'));
        let editComp: any = null;
        for (const el of allEls) {
            const v = (el as any).__vue__;
            if (v && v.hotSettings && Array.isArray(v.hotSettings.data) && Array.isArray(v.expWhs)) {
                editComp = v;
                break;
            }
        }
        if (editComp && editComp.expWhs.length > 0 && editComp.hotSettings.data.length > 0) {
            // 绑定 Vue 响应式监听 (仅需绑定一次)
            if (!isWatching && typeof editComp.$watch === 'function') {
                isWatching = true;
                editComp.$watch('attendance.ym', () => {
                    setTimeout(() => calcAndApply(), 300);
                });
                editComp.$watch(() => editComp.hotSettings && editComp.hotSettings.data, () => {
                    setTimeout(() => calcAndApply(), 300);
                });
                editComp.$watch(() => editComp.expWhs, () => {
                    setTimeout(() => calcAndApply(), 300);
                });
            }

            const expProjects: ProjectExpItem[] = editComp.expWhs.map((item: any) => {
                const exp = parseFloat(item.expWH || '0');
                const act = parseFloat(item.workingHours || '0');
                return {
                    pjNo: item.pjNo || '',
                    name: item.name || '',
                    expWH: item.expWH || '0.00',
                    workingHours: item.workingHours || '0.00',
                    remainWH: Math.max(0, parseFloat((exp - act).toFixed(2))),
                    pjInfoID: item.pjInfoID || '',
                    pjgID: item.pjgID || null,
                    flgPJG: item.flgPJG || '2',
                    department: item.department || ''
                };
            });

            const detailDays: AttendanceDetailItem[] = editComp.hotSettings.data.map((item: any) => ({
                ymd: item.ymd || '',
                objYMD: item.objYMD || null,
                showDate: item.showDate || '',
                month: item.month || '',
                date: item.date || '',
                weekDate: Number(item.weekDate || 0),
                dtDayType: Number(item.dtDayType || 1),
                onDutyStatus: String(item.onDutyStatus || '1'),
                inTime: item.inTime || null,
                outTime: item.outTime || null,
                fromDt: item.fromDt || null,
                toDt: item.toDt || null,
                timeWH: item.timeWH || null,
                pjNo: item.pjNo || null,
                name: item.name || null,
                flgOut: item.flgOut || null,
                flgOutShow: item.flgOutShow || null,
                whFormID: item.whFormID || null,
                whFormDetailID: item.whFormDetailID || null,
                dtAppStatus: item.dtAppStatus || null,
                applyFlowStatus: item.applyFlowStatus || null,
                department: item.department || null,
                memo: item.memo || null
            }));

            const plans = computeProjectAllocationPlan(expProjects, detailDays);
            const shortfall = calculateBudgetShortfall(expProjects, detailDays, plans);
            updateCollapseHeaderShortfallBadge(shortfall);
            return true;
        }
        return false;
    };

    // 初始快速轮询检测挂载
    let attempts = 0;
    const timer = setInterval(() => {
        attempts++;
        if (calcAndApply() || attempts > 20) {
            clearInterval(timer);
        }
    }, 800);

    // 建立 DOM 日期选择器变化监听，确保即使未触发 Vue watch 也能即时响应月份切换
    const dpInput = document.querySelector('.el-date-editor--month input, .el-date-editor input');
    if (dpInput) {
        dpInput.addEventListener('change', () => {
            setTimeout(() => calcAndApply(), 500);
        });
    }

    // 监听全局前一月/后一月按钮点击
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target && (target.closest('.el-date-picker') || target.closest('.el-picker-panel') || target.closest('.el-month-table') || target.closest('.el-date-editor') || target.classList.contains('el-icon-d-arrow-left') || target.classList.contains('el-icon-d-arrow-right'))) {
            setTimeout(() => calcAndApply(), 600);
        }
    });
}

/**
 * 向宿主页面折叠面板表头注入/更新预算工时缺口红字提示
 */
export function updateCollapseHeaderShortfallBadge(shortfall?: BudgetShortfallInfo) {
    try {
        const titleEl = document.querySelector('#projectCompare .collapse-title') ||
                        Array.from(document.querySelectorAll('.collapse-title'))
                            .find(el => (el.textContent || '').includes('项目工时预实对比'));

        if (!titleEl) return;

        let badge = document.getElementById('yn-timemg-collapse-shortfall-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'yn-timemg-collapse-shortfall-badge';
            titleEl.appendChild(badge);
        }

        const deficit = shortfall ? (shortfall.monthShortfallHours || shortfall.shortfallHours) : 0;
        if (shortfall && deficit > 0) {
            badge.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                color: #cf1322;
                background: #fff1f0;
                border: 1px solid #ffa39e;
                font-size: 12px;
                font-weight: 700;
                padding: 2px 8px;
                border-radius: 10px;
                margin-left: 12px;
                line-height: 1.2;
                vertical-align: middle;
                box-shadow: 0 1px 3px rgba(207, 19, 34, 0.12);
            `;
            badge.innerHTML = `⚠️ 当月项目工时缺口: ${deficit.toFixed(2)}h (总预算 ${shortfall.totalMonthBudget.toFixed(2)}h / 出勤需求 ${shortfall.totalMonthHours.toFixed(2)}h)`;
        } else if (shortfall) {
            const surplus = parseFloat(Math.max(0, shortfall.totalMonthBudget - shortfall.totalMonthHours).toFixed(2));
            badge.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                color: #389e0d;
                background: #f6ffed;
                border: 1px solid #b7eb8f;
                font-size: 12px;
                font-weight: 600;
                padding: 2px 8px;
                border-radius: 10px;
                margin-left: 12px;
                line-height: 1.2;
                vertical-align: middle;
                box-shadow: 0 1px 3px rgba(56, 158, 13, 0.12);
            `;
            badge.innerHTML = `✓ 当月项目工时预算充足 (富余 ${surplus.toFixed(2)}h | 总预算 ${shortfall.totalMonthBudget.toFixed(2)}h / 出勤需求 ${shortfall.totalMonthHours.toFixed(2)}h)`;
        }
    } catch (e) {}
}

/**
 * 渲染右侧考勤一览与分配方案预览表
 */
export function renderTimeMgPlans(plans: AllocatedDayPlan[]) {
    const tbody = document.getElementById('yn-timemg-plan-tbody');
    const summaryEl = document.getElementById('yn-timemg-plan-summary');
    if (!tbody) return;

    if (plans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:40px; color:#8c8c8c;">暂无分配计划</td></tr>`;
        if (summaryEl) summaryEl.innerText = '0 天工作日';
        return;
    }

    const workPlans = plans.filter(p => p.isWorkDay);
    const uniqueWorkDays = new Set(workPlans.map(p => p.ymd)).size;
    const totalAllocatedHours = workPlans.filter(p => Boolean(p.pjNo)).reduce((sum, p) => sum + (p.timeWH || 0), 0).toFixed(2);
    const shortfallHours = workPlans.filter(p => !p.pjNo).reduce((sum, p) => sum + (p.timeWH || 0), 0).toFixed(2);

    if (summaryEl) {
        if (parseFloat(shortfallHours) > 0) {
            summaryEl.innerHTML = `共 ${uniqueWorkDays} 个出勤日 (已分配项目: <strong style="color:#096dd9;">${totalAllocatedHours}h</strong>, 预算不足缺口: <strong style="color:#fa8c16;">${shortfallHours}h</strong>)`;
        } else {
            summaryEl.innerText = `共 ${uniqueWorkDays} 个出勤日 (${workPlans.length} 条记录, 已分配 ${totalAllocatedHours}h)`;
        }
    }

    tbody.innerHTML = '';
    plans.forEach((plan, idx) => {
        const tr = document.createElement('tr');
        if (!plan.isWorkDay) {
            tr.className = 'holiday';
        } else if (plan.totalSegmentsInDay && plan.totalSegmentsInDay > 1) {
            tr.style.backgroundColor = '#fafafa';
        }

        const inOutDisplay = (plan.inTime || plan.outTime) ? `
            <div style="font-size:11px; font-family:monospace; color:#595959;">
                ${plan.outTime ? plan.outTime.substring(11, 16) : '--:--'} ~ ${plan.inTime ? plan.inTime.substring(11, 16) : '--:--'}
            </div>
        ` : `<span style="color:#bfbfbf; font-size:11px;">(无门禁记录)</span>`;

        const locationTag = plan.isWorkDay ? `
            <span class="yn-timemg-tag ${plan.isOut ? 'yn-timemg-tag-out' : 'yn-timemg-tag-office'}" title="${plan.locationReason}">
                ${plan.locationName}
            </span>
        ` : `<span style="color:#bfbfbf;">-</span>`;

        let typeTag = `<span class="yn-timemg-tag yn-timemg-tag-holiday">休假</span>`;
        if (plan.isWorkDay) {
            if (plan.totalSegmentsInDay && plan.totalSegmentsInDay > 1) {
                typeTag = `<span class="yn-timemg-tag" style="background:#fff0f6; color:#c41d7f; border:1px solid #ffadd2;" title="该出勤日由多项目拼凑">🧩 拼凑 ${(plan.segmentIndex ?? 0) + 1}/${plan.totalSegmentsInDay}</span>`;
            } else {
                typeTag = `<span class="yn-timemg-tag yn-timemg-tag-work">出勤日</span>`;
            }
        }

        const timeDisplay = plan.isWorkDay ? `
            <div>
                <span style="font-weight:600; color:#262626;">${plan.startTime}~${plan.endTime}</span>
                <span style="font-size:11px; color:#fa8c16; font-weight:600; margin-left:4px;">(${plan.timeWH}h)</span>
            </div>
        ` : `<span style="color:#bfbfbf;">-</span>`;

        let statusHtml = `<span style="color:#8c8c8c;">${plan.status}</span>`;
        if (plan.status === '成功') {
            statusHtml = `<span style="color:#52c41a; font-weight:600;">✓ 成功</span>`;
        } else if (plan.status === '失败') {
            statusHtml = `<span style="color:#ff4d4f; font-weight:600;">✗ 失败</span>`;
        } else if (plan.status === '已填写') {
            statusHtml = `<span style="color:#096dd9; font-weight:600; background:#e6f7ff; border:1px solid #91d5ff; border-radius:3px; padding:1px 5px; font-size:11px;">已存在</span>`;
        } else if (plan.status === '就绪') {
            if (!plan.pjNo) {
                statusHtml = `<span style="color:#d46b08; font-weight:600; background:#fffbe6; border:1px solid #ffe58f; border-radius:3px; padding:1px 5px; font-size:11px;">预算缺口</span>`;
            } else {
                statusHtml = `<span style="color:#fa8c16; font-weight:600;">待回填</span>`;
            }
        }

        const pjNoHtml = plan.pjNo ? `
            <strong style="color:#096dd9;">${plan.pjNo}</strong>
        ` : (plan.isWorkDay ? `<span style="color:#fa8c16; font-weight:600; font-size:12px;">⚠️ 待补项目</span>` : `<span style="color:#bfbfbf;">-</span>`);

        const pjNameHtml = plan.pjName ? `
            <div style="color:#595959; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px;" title="${plan.pjName}">${plan.pjName}</div>
        ` : (plan.isWorkDay ? `<span style="color:#d46b08; font-size:11.5px; font-style:italic;">(工时缺口，可在左表勾选或手动填报)</span>` : `<span style="color:#bfbfbf;">-</span>`);

        tr.innerHTML = `
            <td style="text-align:center; color:#8c8c8c;">${idx + 1}</td>
            <td style="font-weight:600; white-space:nowrap;">${plan.showDate}</td>
            <td style="text-align:center;">${typeTag}</td>
            <td style="text-align:center;">${inOutDisplay}</td>
            <td style="text-align:center;">${timeDisplay}</td>
            <td style="text-align:center;">${locationTag}</td>
            <td>${pjNoHtml}</td>
            <td>${pjNameHtml}</td>
            <td style="text-align:center;">${statusHtml}</td>
        `;

        tbody.appendChild(tr);
    });
}
