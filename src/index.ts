import { GlobalState, PageMode, InvoiceItem } from './types/state';
import { BUDGET_CONSTANTS, EXPENSE_TYPES, MENU_DICTIONARY } from './config/constants';
import { normalizeDate, computePreviousMonthPeriod } from './utils/date';
import { mapConcurrent } from './utils/concurrency';
import { searchDimProjectApi } from './services/projectService';
import {
    prepareBillSceneVO,
    changeBillFieldValueApi,
    saveBillDataApi,
    fetchBillDataAndTemplateApi,
    parseBillDataStructure
} from './services/billService';
import {
    queryInvoicePoolListApi,
    queryExpenseRecordListApi,
    getExpenseTypeRuleAndRowDatasApi,
    initExpenseRecordWithTypeApi,
    createDraftExpenseRecordFromInvoiceApi,
    saveFinalExpenseRecordApi,
    getInvoiceDetailByDataIdApi
} from './services/expenseService';
import { injectStyles } from './ui/styles';
import { createModalDOM } from './ui/modal';
import { fetchExpWHInfoApi, fetchDetailWHInfoApi, getCsrfToken, detectActiveYearAndMonth } from './services/timeMgService';
import { computeProjectAllocationPlan, calculateBudgetShortfall } from './services/timeMgAllocation';
import { saveAttendanceTwinClient, syncHostMonth } from './services/timeMgDomService';
import { injectTimeMgStyles } from './ui/timeMgStyles';
import {
    createTimeMgModalDOM,
    renderTimeMgExpProjects,
    renderTimeMgPlans,
    updateCollapseHeaderShortfallBadge,
    autoInitHostCollapseBadge
} from './ui/timeMgModal';
import { showToast } from './utils/toast';
import { AutopilotLogger } from './utils/logger';

// ==========================================
// 1. 全局状态单例
// ==========================================
const STATE: GlobalState = {
    pageMode: 'UNKNOWN',
    loginToken: '',
    ecsToken: '',
    userOrigin: 'https://ync37.yuanian.com',
    appId: 'e3d5e4787ff911e88b1997bee3518b4d',
    menuId: '11eedb8f8a31cd8f8a25f721e03d0caa',
    eicds: '',
    v: '',
    applicantId: '11eee047a80566bca18367ceb209b2e1',

    // 模式 A: 发票夹与费用记录数据
    invoices: [],
    activeGroup: 'TAXI',
    selectedIndices: new Set(),

    // 模式 B: 经费报销单数据
    currentBillMainId: '',
    currentBillData: null,
    currentBillDefineTemplate: null,
    billRows: [],
    billTags: new Map(),
    activeBillTag: '',
    billSelectedIndices: new Set(),
    projectSearchResults: [],
    selectedAccount: { value: '03561d1db6a345af7f1906ec05cc0000', title: '项目预算' },
    selectedCostCenter: { value: '0356194b8b3de1653e55bb00bc610000', title: 'IT服务G-安全咨询BU(制造)' },
    selectedProject: null,
    selectedKhfd: { value: '6b8ff07f9ebe11e88b7247d35c1e5077', title: '是(YES)' },

    isProcessing: false
};

// ==========================================
// 2. 页面模式识别与白名单检测
// ==========================================
function detectPageMode(): PageMode {
    const url = window.location.href;
    const decodedUrl = decodeURIComponent(url);

    // 0. 【考勤工数系统】页面特征检测 (与元年完全独立)
    if (window.location.hostname.includes('time-mg.huge-vision.com') || url.includes('time-mg.huge-vision.com')) {
        return 'TIME_MG';
    }

    // 1. 【经费报销单页】特征检测
    const isBillPage = (
        decodedUrl.includes('menuName=经费报销单') ||
        decodedUrl.includes('menuName=报销单') ||
        url.includes('menuId=11eedb8f8a31cd8f8a25f721e03d0caa') ||
        url.includes('menuId=68c5b963240677b2a836195d3b50e84e') ||
        url.includes('#billWrite') ||
        url.includes('billMainId=') ||
        url.includes('boDefineCode=FYBX') ||
        url.includes('billTypeCode=FYBX') ||
        Boolean(STATE.currentBillData)
    );
    if (isBillPage) return 'BILL';

    // 2. 【发票夹】 iframe 页面特征
    const isInvoicePool = (
        url.includes('#businessapplication') ||
        url.includes('5f0971df7a4411e9b0edd9fcadd69462') ||
        decodedUrl.includes('menuName=发票夹') ||
        url.includes('11ec6dd3fd5cb161bff83bb033997150')
    );
    if (isInvoicePool) return 'POOL';

    // 3. 【费用记录】 iframe 页面特征
    const isExpenseRecord = (
        url.includes('#expenserecord') ||
        decodedUrl.includes('menuName=费用记录') ||
        url.includes('56dd4bb8a5bf11e8a1a1d174f439477e')
    );
    if (isExpenseRecord) return 'EXPENSE';

    return 'UNKNOWN';
}

function extractUrlParams() {
    const full = window.location.href;
    const qIndex = full.indexOf('?');
    if (qIndex !== -1) {
        const query = full.substring(qIndex + 1);
        const params = new URLSearchParams(query);
        if (params.get('TOKEN') && !STATE.loginToken) {
            STATE.loginToken = params.get('TOKEN') || '';
        }
        if (params.get('appId')) STATE.appId = params.get('appId') || STATE.appId;
        if (params.get('menuId')) STATE.menuId = params.get('menuId') || STATE.menuId;
        if (params.get('billMainId')) STATE.currentBillMainId = params.get('billMainId') || STATE.currentBillMainId;
    }
}

function updateTokenStatus() {
    const btnBadge = document.querySelector('#yn-batch-helper-btn .yn-badge');
    if (btnBadge) btnBadge.className = `yn-badge ${STATE.loginToken ? '' : 'offline'}`;
    const indicator = document.getElementById('yn-token-indicator');
    if (indicator) {
        indicator.style.color = STATE.loginToken ? '#52c41a' : '#ff4d4f';
        indicator.innerHTML = STATE.loginToken ? '● Token 已就绪' : '○ 正在等待 Token';
    }
}

// ==========================================
// 3. 自动拦截与捕获网络请求 / 报销单数据
// ==========================================
function initInterceptor() {
    extractUrlParams();
    STATE.loginToken = STATE.loginToken || sessionStorage.getItem('LoginToken') || localStorage.getItem('LoginToken') || sessionStorage.getItem('token') || '';
    STATE.ecsToken = sessionStorage.getItem('EcsToken') || localStorage.getItem('EcsToken') || '';

    const captureHeaders = (headers: any) => {
        if (!headers) return;
        const getH = (k: string) => headers[k] || headers[k.toLowerCase()] || '';
        if (getH('LoginToken')) STATE.loginToken = getH('LoginToken');
        if (getH('EcsToken')) STATE.ecsToken = getH('EcsToken');
        if (getH('UserOrigin')) STATE.userOrigin = getH('UserOrigin');
        if (getH('appid')) STATE.appId = getH('appid');
        if (getH('menuid')) STATE.menuId = getH('menuid');
        if (getH('eicds')) STATE.eicds = getH('eicds');
        if (getH('v')) STATE.v = getH('v');
        if (getH('X-CSRF-TOKEN') || getH('x-csrf-token')) {
            if (!STATE.timeMg) {
                const now = new Date();
                STATE.timeMg = {
                    selectedYear: String(now.getFullYear()),
                    selectedMonth: String(now.getMonth() + 1).padStart(2, '0'),
                    csrfToken: '',
                    expProjects: [],
                    detailDays: [],
                    allocatedPlans: [],
                    isProcessing: false,
                    lastSyncTime: ''
                };
            }
            STATE.timeMg.csrfToken = getH('X-CSRF-TOKEN') || getH('x-csrf-token');
            updateTimeMgTokenStatus();
        }
        updateTokenStatus();
    };

    const handleInterceptedResponse = (url: string, jsonText: string) => {
        try {
            if (url.includes('/fssc/bill/billdata/getBillDataAndTemplateByBillMainId') ||
                url.includes('/fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange')) {
                const parsed = JSON.parse(jsonText);
                if (parsed && parsed.data) {
                    if (parsed.data.billData) {
                        STATE.currentBillData = parsed.data.billData;
                        STATE.currentBillMainId = parsed.data.billData.billMainId || STATE.currentBillMainId;
                    }
                    if (parsed.data.billDefineTemplate) {
                        STATE.currentBillDefineTemplate = parsed.data.billDefineTemplate;
                    }
                    const parsedStructure = parseBillDataStructure(STATE.currentBillData);
                    STATE.billRows = parsedStructure.billRows;
                    STATE.billTags = parsedStructure.billTags;
                    renderBillTable();
                }
            }
        } catch (e) { }
    };

    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const rawSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (this: any, method: string, url: string) {
        this._url = url;
        this._headers = {};
        return rawOpen.apply(this, arguments as any);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (this: any, header: string, value: string) {
        this._headers[header] = value;
        captureHeaders(this._headers);
        return rawSetRequestHeader.apply(this, arguments as any);
    };

    XMLHttpRequest.prototype.send = function (this: any) {
        this.addEventListener('load', () => {
            if (this.responseText && this._url) {
                handleInterceptedResponse(this._url, this.responseText);
            }
        });
        return rawSend.apply(this, arguments as any);
    };

    const rawFetch = window.fetch;
    window.fetch = async function (...args: any[]) {
        try {
            if (args[1] && args[1].headers) {
                captureHeaders(args[1].headers);
            }
        } catch (e) { }
        const resp = await rawFetch.apply(this, args as any);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
            if (url && (url.includes('getBillDataAndTemplateByBillMainId') || url.includes('fieldValueChange'))) {
                const cloned = resp.clone();
                cloned.text().then(txt => handleInterceptedResponse(url, txt));
            }
        } catch (e) { }
        return resp;
    };
}

initInterceptor();

// ==========================================
// 4. 辅助函数
// ==========================================
function normalizeTime(t: any): string {
    if (!t) return '';
    const clean = t.toString().trim();
    const parts = clean.split(':');
    if (parts.length >= 2) {
        return `${parts[0].trim().padStart(2, '0')}:${parts[1].trim().padStart(2, '0')}`;
    }
    return clean;
}

function computePeriod(dateStr: string, isCommunication = false): string {
    if (!dateStr) return '';
    const cleanDate = normalizeDate(dateStr);
    if (cleanDate.length >= 7) {
        const parts = cleanDate.split('-');
        let year = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10);

        if (isCommunication) {
            month -= 1;
            if (month < 1) {
                month = 12;
                year -= 1;
            }
        }
        return `${year}-${String(month).padStart(2, '0')}`;
    }
    return '';
}

function detectInvoiceType(invVO: any = {}, expenseItem: any = {}, rowDatas: any = {}): 'TAXI' | 'COMMUNICATION' {
    const seller = (invVO.salesName || invVO.seller || '').toLowerCase();
    const details = (invVO.invoiceDetails || '').toLowerCase();
    const expName = (expenseItem.expenseTypeName || '').toLowerCase();
    const text = `${seller} ${details} ${expName}`;

    const isComm = (expenseItem.expenseTypeId === EXPENSE_TYPES.COMMUNICATION.id) ||
                   ['移动', '联通', '电信', '通信', '手机'].some(kw => text.includes(kw));
    return isComm ? 'COMMUNICATION' : 'TAXI';
}

function sortInvoices(list: InvoiceItem[]) {
    return list.sort((a, b) => {
        const dateA = normalizeDate(a.invoiceDate || '');
        const dateB = normalizeDate(b.invoiceDate || '');
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return normalizeTime(a.timeGetOn).localeCompare(normalizeTime(b.timeGetOn));
    });
}

// ==========================================
// 5. 模式 B: 报销单表格渲染与交互
// ==========================================
function autoSelectBillRowsByTag(tag: string) {
    STATE.billSelectedIndices.clear();
    STATE.billRows.forEach((row, idx) => {
        if (!tag || (row.recDesc && row.recDesc.includes(tag))) {
            STATE.billSelectedIndices.add(idx);
        }
    });
}

async function triggerProjectSearch(keyword: string) {
    const select = document.getElementById('yn-bill-project-select') as HTMLSelectElement;
    if (!select) return;

    select.innerHTML = `<option value="">⏳ 正在检索项目 [${keyword}]...</option>`;
    try {
        const projects = await searchDimProjectApi(keyword, STATE);
        STATE.projectSearchResults = projects;
        select.innerHTML = '';

        if (projects.length === 0) {
            select.innerHTML = `<option value="">未找到匹配项目</option>`;
            STATE.selectedProject = null;
            return;
        }

        projects.forEach((p, pIdx) => {
            const opt = document.createElement('option');
            opt.value = p.id || p.value;
            opt.innerText = `[${p.code}] ${p.title}`;
            if (pIdx === 0) opt.selected = true;
            select.appendChild(opt);
        });

        STATE.selectedProject = {
            value: projects[0].id || projects[0].value,
            title: projects[0].title
        };
    } catch (e: any) {
        select.innerHTML = `<option value="">检索失败: ${e.message}</option>`;
    }
}

function renderBillTable() {
    if (STATE.pageMode !== 'BILL') return;

    const tbody = document.getElementById('yn-bill-table-tbody');
    const tagContainer = document.getElementById('yn-bill-tags-container');
    const filterInput = document.getElementById('yn-bill-filter-input') as HTMLInputElement;
    const thSelectAll = document.getElementById('yn-bill-th-select-all') as HTMLInputElement;
    const btnExecute = document.getElementById('yn-bill-btn-batch-execute') as HTMLButtonElement;

    if (!tbody) return;

    // 1. 渲染 TAG 标签云
    if (tagContainer) {
        tagContainer.innerHTML = '';
        const allChip = document.createElement('span');
        allChip.className = `yn-tag-chip ${STATE.activeBillTag === '' ? 'active' : ''}`;
        allChip.innerHTML = `🏷️ 全部 <span class="yn-tag-count">${STATE.billRows.length}</span>`;
        allChip.addEventListener('click', () => {
            STATE.activeBillTag = '';
            if (filterInput) filterInput.value = '';
            autoSelectBillRowsByTag('');
            renderBillTable();
        });
        tagContainer.appendChild(allChip);

        STATE.billTags.forEach((cnt, tag) => {
            const chip = document.createElement('span');
            chip.className = `yn-tag-chip ${STATE.activeBillTag === tag ? 'active' : ''}`;
            chip.innerHTML = `🏷️ ${tag} <span class="yn-tag-count">${cnt}</span>`;
            chip.addEventListener('click', async () => {
                STATE.activeBillTag = tag;
                if (filterInput) filterInput.value = tag;
                autoSelectBillRowsByTag(tag);

                const pSearch = document.getElementById('yn-bill-project-search') as HTMLInputElement;
                if (pSearch) pSearch.value = tag;
                await triggerProjectSearch(tag);

                renderBillTable();
            });
            tagContainer.appendChild(chip);
        });
    }

    // 2. 渲染明细表格行
    if (STATE.billRows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" style="text-align:center; padding:50px; color:#8c8c8c;">
                    未读取到当前报销单中的费用明细。请点击右下方【🔄 刷新报销单】！
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';
    let selectedCount = 0;

    const targetAccountTitle = STATE.selectedAccount ? STATE.selectedAccount.title : '项目预算';
    const targetProjTitle = STATE.selectedProject ? STATE.selectedProject.title : '';
    const targetKhfdTitle = STATE.selectedKhfd ? STATE.selectedKhfd.title : '是(YES)';

    STATE.billRows.forEach((row, idx) => {
        const isSelected = STATE.billSelectedIndices.has(idx);
        if (isSelected) selectedCount++;

        const tr = document.createElement('tr');
        if (isSelected) tr.className = 'selected';

        const previewTarget = isSelected ? `
            <div style="font-size:11.5px;">
                <span style="color:#1890ff; font-weight:600;">[${targetAccountTitle}]</span>
                <span style="color:#722ed1; font-weight:600;">${targetProjTitle || (row.curProject || '--')}</span>
                <span style="color:#52c41a; font-weight:600;">[请款: ${targetKhfdTitle}]</span>
            </div>
        ` : `<span style="color:#bfbfbf;">(未勾选修改)</span>`;

        tr.innerHTML = `
            <td style="text-align:center;">
                <input type="checkbox" class="yn-bill-row-check" data-idx="${idx}" ${isSelected ? 'checked' : ''} />
            </td>
            <td style="color:#8c8c8c; text-align:center;">${idx + 1}</td>
            <td style="text-align:center; font-weight:600;">${row.rowNum}</td>
            <td><span style="color:#595959;">${row.expTypeName}</span></td>
            <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(String(row.amount || 0)).toFixed(2)}</span></td>
            <td><strong style="color:${row.recDesc ? '#096dd9' : '#8c8c8c'};">${row.recDesc || '-'}</strong></td>
            <td><span style="color:#595959;">${row.curAccount || '-'}</span></td>
            <td><span style="color:#595959; font-size:11.5px;">${row.curCostCenter || '-'}</span></td>
            <td><span style="color:#595959; font-size:11.5px;">${row.curProject || '-'}</span></td>
            <td style="text-align:center;"><span style="font-weight:600; color:${row.curKhfd === '是' || row.curKhfd.includes('YES') ? '#52c41a' : '#8c8c8c'};">${row.curKhfd || '否'}</span></td>
            <td>${previewTarget}</td>
            <td style="text-align:center;"><span class="yn-status-tag ${row.status === '成功' ? 'yn-status-success' : (row.status === '失败' ? 'yn-status-error' : 'yn-status-pending')}">${row.status || '就绪'}</span></td>
        `;
        tbody.appendChild(tr);
    });

    if (thSelectAll) {
        thSelectAll.checked = STATE.billRows.length > 0 && selectedCount === STATE.billRows.length;
    }

    if (btnExecute) {
        btnExecute.innerText = `🚀 批量修改预算归属并向客户请款 (${selectedCount} 条)`;
    }

    tbody.querySelectorAll('.yn-bill-row-check').forEach(ck => {
        ck.addEventListener('change', (e: any) => {
            const idx = parseInt(e.target.getAttribute('data-idx'));
            if (e.target.checked) STATE.billSelectedIndices.add(idx);
            else STATE.billSelectedIndices.delete(idx);
            renderBillTable();
        });
    });
}

// ==========================================
// 6. 报销单批量修改执行引擎 (v4.3.0 极速模式)
// ==========================================
async function executeBatchBillBudgetUpdate() {
    const targetIndices = Array.from(STATE.billSelectedIndices);
    if (targetIndices.length === 0) {
        alert('请先勾选需要修改预算归属的费用明细行！');
        return;
    }

    if (!STATE.currentBillData && STATE.currentBillMainId) {
        try {
            await fetchBillDataAndTemplateApi(STATE.currentBillMainId, STATE);
        } catch (e: any) {
            alert(`读取报销单数据失败: ${e.message}`);
            return;
        }
    }
    if (!STATE.currentBillData) {
        alert('未获取到报销单完整数据，请在页面刷新或点击右下方【🔄 刷新报销单】！');
        return;
    }

    const isProjBudget = STATE.selectedAccount && STATE.selectedAccount.value === '03561d1db6a345af7f1906ec05cc0000';
    if (isProjBudget && (!STATE.selectedProject || !STATE.selectedProject.value)) {
        alert('当前预算科目为【项目预算】，请先在上方检索并选择目标【项目】！');
        return;
    }

    const accountTitle = STATE.selectedAccount ? STATE.selectedAccount.title : '项目预算';
    const projTitle = STATE.selectedProject ? STATE.selectedProject.title : '(无项目)';
    const costCenterTitle = STATE.selectedCostCenter ? STATE.selectedCostCenter.title : '(未指定成本中心)';
    const khfdTitle = STATE.selectedKhfd ? STATE.selectedKhfd.title : '是(YES)';

    const confirmMsg = `确定要将已勾选的 ${targetIndices.length} 条费用明细批量修改为：\n` +
                       `• 预算科目: ${accountTitle}\n` +
                       (isProjBudget ? `• 关联项目: ${projTitle}\n` : `• 部门/成本中心: ${costCenterTitle}\n`) +
                       `• 向客户请款: ${khfdTitle}\n\n` +
                       `⚡ 极速模式: 首行蝴蝶计算 + 内存批量克隆 + 一次性入库\n` +
                       `点击【确定】开始执行！`;
    if (!confirm(confirmMsg)) return;

    const progressWrap = document.getElementById('yn-bill-progress-wrap')!;
    const progressInner = document.getElementById('yn-bill-progress-inner')!;
    const logText = document.getElementById('yn-bill-log-text')!;
    const btnExec = document.getElementById('yn-bill-btn-batch-execute') as HTMLButtonElement;

    progressWrap.style.display = 'block';
    btnExec.disabled = true;
    btnExec.innerText = `⏳ 极速批量更新中...`;

    const total = targetIndices.length;
    let currentBillData = JSON.parse(JSON.stringify(STATE.currentBillData));

    // 阶段1: 对第1行执行完整蝴蝶效应计算
    const firstRowIdx = targetIndices[0];
    const firstRow = STATE.billRows[firstRowIdx];
    progressInner.style.width = '10%';
    logText.innerText = `[阶段1/3] 首行蝴蝶效应计算: 行 ${firstRow.rowNum} (${firstRow.recDesc || firstRow.expTypeName})...`;

    let refBudgetDatas: any = null;

    try {
        const claimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];
        const firstClaimRow = claimRows[firstRowIdx];
        if (!firstClaimRow) throw new Error(`未找到第 ${firstRowIdx + 1} 行费用明细数据`);

        const bArea = firstClaimRow.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId];
        const bRow = bArea?.rowDatas?.[0];
        const budgetRowId = bRow?.rowId || bRow?.datas?.BILL_ROW_ID?.value || firstRow.budgetRowId;
        if (!budgetRowId) throw new Error('首行未找到预算区 RowId');

        // 1a. 修改科目 (DIM_ACCOUNT)
        logText.innerText = `[阶段1/3] 首行蝴蝶效应 ① 修改科目...`;
        let sceneVO = prepareBillSceneVO(currentBillData);
        currentBillData = await changeBillFieldValueApi(
            BUDGET_CONSTANTS.fields.account.fieldCode,
            BUDGET_CONSTANTS.fields.account.fieldName,
            BUDGET_CONSTANTS.fields.account.fieldId,
            { value: STATE.selectedAccount.value, title: { zh_CN: accountTitle } },
            budgetRowId,
            sceneVO,
            STATE
        );

        // 1b. 修改项目 (DIM_PROJECT) 或 部门/成本中心 (F_BM)
        if (isProjBudget && STATE.selectedProject && STATE.selectedProject.value) {
            logText.innerText = `[阶段1/3] 首行蝴蝶效应 ② 修改项目...`;
            sceneVO = prepareBillSceneVO(currentBillData);
            currentBillData = await changeBillFieldValueApi(
                BUDGET_CONSTANTS.fields.project.fieldCode,
                BUDGET_CONSTANTS.fields.project.fieldName,
                BUDGET_CONSTANTS.fields.project.fieldId,
                { value: STATE.selectedProject.value, title: { zh_CN: STATE.selectedProject.title } },
                budgetRowId,
                sceneVO,
                STATE
            );
        } else if (!isProjBudget && STATE.selectedCostCenter && STATE.selectedCostCenter.value) {
            logText.innerText = `[阶段1/3] 首行蝴蝶效应 ② 修改成本中心...`;
            sceneVO = prepareBillSceneVO(currentBillData);
            currentBillData = await changeBillFieldValueApi(
                BUDGET_CONSTANTS.fields.costCenter.fieldCode,
                BUDGET_CONSTANTS.fields.costCenter.fieldName,
                BUDGET_CONSTANTS.fields.costCenter.fieldId,
                { value: STATE.selectedCostCenter.value, title: { zh_CN: costCenterTitle } },
                budgetRowId,
                sceneVO,
                STATE
            );
        }

        // 1c. 修改是否向客户请款 (F_KHFD)
        logText.innerText = `[阶段1/3] 首行蝴蝶效应 ③ 修改向客户请款...`;
        sceneVO = prepareBillSceneVO(currentBillData);
        currentBillData = await changeBillFieldValueApi(
            BUDGET_CONSTANTS.fields.khfd.fieldCode,
            BUDGET_CONSTANTS.fields.khfd.fieldName,
            BUDGET_CONSTANTS.fields.khfd.fieldId,
            { value: STATE.selectedKhfd.value, title: { zh_CN: khfdTitle } },
            budgetRowId,
            sceneVO,
            STATE
        );

        const refClaimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];
        const refBudgetRow = refClaimRows[firstRowIdx]?.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId]?.rowDatas?.[0];
        if (!refBudgetRow) throw new Error('蝴蝶效应计算后未获取到首行预算区数据');
        refBudgetDatas = refBudgetRow.datas;

        firstRow.curAccount = accountTitle;
        firstRow.curProject = isProjBudget ? (STATE.selectedProject ? STATE.selectedProject.title : '') : '';
        firstRow.curCostCenter = !isProjBudget ? costCenterTitle : (firstRow.curCostCenter || '');
        firstRow.curKhfd = khfdTitle;
        firstRow.status = '成功';
        renderBillTable();
    } catch (err: any) {
        console.error('First row butterfly failed:', err);
        btnExec.disabled = false;
        btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
        alert(`❌ 首行蝴蝶效应计算失败: ${err.message}\n\n请检查网络连接和 Token 状态！`);
        return;
    }

    // 阶段2: 内存批量克隆 (0ms 级)
    progressInner.style.width = '50%';
    logText.innerText = `[阶段2/3] 内存批量克隆: 将首行计算结果写入剩余 ${total - 1} 行...`;

    const CLONE_FIELDS = ['DIM_ACCOUNT', 'DIM_PROJECT', 'DIM_COST_CENTER', 'F_BM', 'F_KHFD', 'F_FYKM', 'BUDGET_DIM'];
    let cloneSuccessCount = 0;
    let cloneFailCount = 0;
    const allClaimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];

    for (let i = 1; i < total; i++) {
        const rowIdx = targetIndices[i];
        const row = STATE.billRows[rowIdx];
        try {
            const claimRow = allClaimRows[rowIdx];
            if (!claimRow) throw new Error(`未找到第 ${rowIdx + 1} 行明细数据`);
            const budgetRow = claimRow.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId]?.rowDatas?.[0];
            if (!budgetRow || !budgetRow.datas) throw new Error('预算区数据结构异常');

            for (const fieldKey of CLONE_FIELDS) {
                if (refBudgetDatas[fieldKey] !== undefined) {
                    budgetRow.datas[fieldKey] = JSON.parse(JSON.stringify(refBudgetDatas[fieldKey]));
                }
            }

            row.curAccount = accountTitle;
            row.curProject = isProjBudget ? (STATE.selectedProject ? STATE.selectedProject.title : '') : '';
            row.curCostCenter = !isProjBudget ? costCenterTitle : (row.curCostCenter || '');
            row.curKhfd = khfdTitle;
            row.status = '成功';
            cloneSuccessCount++;
        } catch (err) {
            console.error(`Clone failed on row ${row.rowNum}:`, err);
            row.status = '失败';
            cloneFailCount++;
        }
    }

    renderBillTable();
    const successCount = 1 + cloneSuccessCount;
    const failCount = cloneFailCount;

    // 阶段3: 一次性持久化入库保存 (saveBillData)
    progressInner.style.width = '80%';
    logText.innerText = `[阶段3/3] 正在执行整单持久化入库保存 (saveBillData)...`;

    try {
        const savedData = await saveBillDataApi(currentBillData, STATE);
        STATE.currentBillData = savedData;
        const parsed = parseBillDataStructure(savedData);
        STATE.billRows = parsed.billRows;
    } catch (saveErr: any) {
        console.error('saveBillData failed:', saveErr);
        btnExec.disabled = false;
        btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
        renderBillTable();
        alert(`⚠️ 内存计算已完成，但持久化保存失败: ${saveErr.message}\n\n将自动降级为逐行串行模式重试...`);
        await executeBatchBillBudgetUpdateFallback(targetIndices);
        return;
    }

    progressInner.style.width = '100%';
    btnExec.disabled = false;
    btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
    renderBillTable();
    logText.innerText = `⚡ 极速模式完成！成功: ${successCount} 条，失败: ${failCount} 条。`;

    const doReload = confirm(
        `✅ 极速批量修改并保存成功！\n` +
        `• 成功更新并入库: ${successCount} 条\n` +
        `• 失败: ${failCount} 条\n` +
        `• 模式: 极速 (首行蝴蝶 + 内存克隆 + 一次性入库)\n\n` +
        `数据已成功写入元年数据库！点击【确定】立即刷新页面！`
    );
    if (doReload) {
        window.location.reload();
    }
}

async function executeBatchBillBudgetUpdateFallback(targetIndices: number[]) {
    const progressInner = document.getElementById('yn-bill-progress-inner')!;
    const logText = document.getElementById('yn-bill-log-text')!;
    const btnExec = document.getElementById('yn-bill-btn-batch-execute') as HTMLButtonElement;

    btnExec.disabled = true;
    btnExec.innerText = `⏳ 降级串行模式...`;

    const isProjBudget = STATE.selectedAccount && STATE.selectedAccount.value === '03561d1db6a345af7f1906ec05cc0000';
    const accountTitle = STATE.selectedAccount ? STATE.selectedAccount.title : '项目预算';
    const khfdTitle = STATE.selectedKhfd ? STATE.selectedKhfd.title : '是(YES)';
    const costCenterTitle = STATE.selectedCostCenter ? STATE.selectedCostCenter.title : '(未指定成本中心)';

    try {
        await fetchBillDataAndTemplateApi(STATE.currentBillMainId, STATE);
    } catch (e: any) {
        alert(`降级模式: 重新读取报销单失败: ${e.message}`);
        btnExec.disabled = false;
        btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
        return;
    }

    let currentBillData = STATE.currentBillData;
    let successCount = 0;
    let failCount = 0;
    const total = targetIndices.length;

    for (let i = 0; i < total; i++) {
        const rowIdx = targetIndices[i];
        const row = STATE.billRows[rowIdx];
        const percent = Math.round(((i + 1) / total) * 100);
        progressInner.style.width = `${percent}%`;
        logText.innerText = `[降级串行 ${i + 1}/${total}] 正在更新行 ${row.rowNum}...`;

        try {
            const claimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];
            const curClaimRow = claimRows[rowIdx];
            if (!curClaimRow) throw new Error(`未找到第 ${rowIdx + 1} 行数据`);

            const bRow = curClaimRow.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId]?.rowDatas?.[0];
            const budgetRowId = bRow?.rowId || bRow?.datas?.BILL_ROW_ID?.value || row.budgetRowId;
            if (!budgetRowId) throw new Error('未找到预算区 RowId');

            let sceneVO = prepareBillSceneVO(currentBillData);
            currentBillData = await changeBillFieldValueApi(
                BUDGET_CONSTANTS.fields.account.fieldCode,
                BUDGET_CONSTANTS.fields.account.fieldName,
                BUDGET_CONSTANTS.fields.account.fieldId,
                { value: STATE.selectedAccount.value, title: { zh_CN: accountTitle } },
                budgetRowId, sceneVO, STATE
            );

            if (isProjBudget && STATE.selectedProject?.value) {
                sceneVO = prepareBillSceneVO(currentBillData);
                currentBillData = await changeBillFieldValueApi(
                    BUDGET_CONSTANTS.fields.project.fieldCode,
                    BUDGET_CONSTANTS.fields.project.fieldName,
                    BUDGET_CONSTANTS.fields.project.fieldId,
                    { value: STATE.selectedProject.value, title: { zh_CN: STATE.selectedProject.title } },
                    budgetRowId, sceneVO, STATE
                );
            } else if (!isProjBudget && STATE.selectedCostCenter?.value) {
                sceneVO = prepareBillSceneVO(currentBillData);
                currentBillData = await changeBillFieldValueApi(
                    BUDGET_CONSTANTS.fields.costCenter.fieldCode,
                    BUDGET_CONSTANTS.fields.costCenter.fieldName,
                    BUDGET_CONSTANTS.fields.costCenter.fieldId,
                    { value: STATE.selectedCostCenter.value, title: { zh_CN: costCenterTitle } },
                    budgetRowId, sceneVO, STATE
                );
            }

            sceneVO = prepareBillSceneVO(currentBillData);
            currentBillData = await changeBillFieldValueApi(
                BUDGET_CONSTANTS.fields.khfd.fieldCode,
                BUDGET_CONSTANTS.fields.khfd.fieldName,
                BUDGET_CONSTANTS.fields.khfd.fieldId,
                { value: STATE.selectedKhfd.value, title: { zh_CN: khfdTitle } },
                budgetRowId, sceneVO, STATE
            );

            row.status = '成功';
            successCount++;
        } catch (err) {
            console.error(`Fallback update failed on row ${row.rowNum}:`, err);
            row.status = '失败';
            failCount++;
        }
        renderBillTable();
    }

    STATE.currentBillData = currentBillData;

    logText.innerText = `降级串行模式: 正在保存...`;
    try {
        const savedData = await saveBillDataApi(currentBillData, STATE);
        STATE.currentBillData = savedData;
        const parsed = parseBillDataStructure(savedData);
        STATE.billRows = parsed.billRows;
    } catch (saveErr: any) {
        alert(`⚠️ 降级模式保存也失败: ${saveErr.message}`);
        btnExec.disabled = false;
        btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
        return;
    }

    btnExec.disabled = false;
    btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
    renderBillTable();
    logText.innerText = `降级串行模式完成！成功: ${successCount} 条，失败: ${failCount} 条。`;

    const doReload = confirm(
        `✅ 降级串行模式完成！\n成功: ${successCount} 条，失败: ${failCount} 条\n\n点击【确定】刷新页面！`
    );
    if (doReload) window.location.reload();
}

// ==========================================
// 7. 模式 A: 发票夹与费用记录表格渲染与数据流
// ==========================================
function executeSmartCommuteInference(showNotice = true) {
    const company = ((document.getElementById('yn-quick-company') as HTMLInputElement)?.value || 'IVISION').trim();
    const customer = ((document.getElementById('yn-quick-customer') as HTMLInputElement)?.value || 'CMP').trim();
    const customDesc = ((document.getElementById('yn-quick-taxi-desc') as HTMLInputElement)?.value || '').trim();

    const visibleIndices = STATE.invoices
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => STATE.activeGroup === 'ALL' || row.type === STATE.activeGroup)
        .map(({ idx }) => idx);

    let targetIndices = visibleIndices.filter(idx => STATE.selectedIndices.has(idx));
    if (targetIndices.length === 0) targetIndices = visibleIndices;

    const taxiIndices = targetIndices.filter(idx => STATE.invoices[idx] && STATE.invoices[idx].type === 'TAXI');
    if (taxiIndices.length === 0) {
        if (showNotice) alert('当前分组下未找到出租车发票！');
        return;
    }

    const dateGroups: Record<string, number[]> = {};
    taxiIndices.forEach(idx => {
        const row = STATE.invoices[idx];
        const dt = normalizeDate(row.invoiceDate || '') || '未知日期';
        if (!dateGroups[dt]) dateGroups[dt] = [];
        dateGroups[dt].push(idx);
    });

    let filledCount = 0;
    const uncertainDates: string[] = [];

    Object.keys(dateGroups).forEach(dt => {
        const dayIndices = dateGroups[dt];
        dayIndices.sort((i1, i2) => normalizeTime(STATE.invoices[i1].timeGetOn).localeCompare(normalizeTime(STATE.invoices[i2].timeGetOn)));

        if (dayIndices.length === 2) {
            const idx1 = dayIndices[0];
            const idx2 = dayIndices[1];
            STATE.invoices[idx1].startAddress = company;
            STATE.invoices[idx1].endAddress = customer;
            if (customDesc) STATE.invoices[idx1].description = customDesc;
            STATE.invoices[idx2].startAddress = customer;
            STATE.invoices[idx2].endAddress = company;
            if (customDesc) STATE.invoices[idx2].description = customDesc;
            filledCount += 2;
        } else if (dayIndices.length === 1) {
            const idx1 = dayIndices[0];
            const hour = parseInt(normalizeTime(STATE.invoices[idx1].timeGetOn).split(':')[0]) || 0;
            if (hour < 14) {
                STATE.invoices[idx1].startAddress = company;
                STATE.invoices[idx1].endAddress = customer;
            } else {
                STATE.invoices[idx1].startAddress = customer;
                STATE.invoices[idx1].endAddress = company;
            }
            if (customDesc) STATE.invoices[idx1].description = customDesc;
            filledCount += 1;
        } else {
            const firstIdx = dayIndices[0];
            const lastIdx = dayIndices[dayIndices.length - 1];
            STATE.invoices[firstIdx].startAddress = company;
            STATE.invoices[firstIdx].endAddress = customer;
            if (customDesc) STATE.invoices[firstIdx].description = customDesc;
            STATE.invoices[lastIdx].startAddress = customer;
            STATE.invoices[lastIdx].endAddress = company;
            if (customDesc) STATE.invoices[lastIdx].description = customDesc;
            for (let k = 1; k < dayIndices.length - 1; k++) {
                const midIdx = dayIndices[k];
                STATE.invoices[midIdx].startAddress = '';
                STATE.invoices[midIdx].endAddress = '';
                if (customDesc) STATE.invoices[midIdx].description = customDesc;
            }
            filledCount += 2;
            uncertainDates.push(dt);
        }
    });

    renderInvoiceTable();
    if (showNotice) {
        let msg = `✅ 智能推断完成！已自动为 ${filledCount} 条出租车行程填入往返地点：\n` +
                  `• 公司基准: ${company}\n• 拜访客户: ${customer}\n` +
                  `• 行程规则: 当天第1程【${company} ➔ ${customer}】，第2程【${customer} ➔ ${company}】`;
        if (uncertainDates.length > 0) {
            msg += `\n\n⚠️ 注意：以下日期包含 3 笔以上打车记录，中间行程已留空：\n${uncertainDates.join(', ')}`;
        }
        alert(msg);
    }
}

async function fetchAllPendingData() {
    const btnFetch = document.getElementById('yn-btn-fetch-all') as HTMLButtonElement;
    const originalText = btnFetch ? btnFetch.innerText : '';
    if (btnFetch) {
        btnFetch.disabled = true;
        btnFetch.innerText = '⏳ 正在全量同步发票夹与费用记录...';
    }

    try {
        const loaded: InvoiceItem[] = [];
        const processedRecordIds = new Set<string>();
        const processedInvoiceDataIds = new Set<string>();
        const processedInvoiceNos = new Set<string>();

        const poolList = await queryInvoicePoolListApi(STATE);
        const poolInvoices = await mapConcurrent(poolList, 8, async (pItem: any) => {
            const dataId = pItem.boSourceRowId || (pItem.datas && pItem.datas.ID ? pItem.datas.ID.value : '');
            if (!dataId) return null;
            try {
                const invDetail = await getInvoiceDetailByDataIdApi(dataId, STATE);
                return { dataId, invDetail, pItem };
            } catch (e) { return null; }
        });

        const invoiceOcrMap = new Map<string, any>();
        poolInvoices.forEach(item => {
            if (!item || !item.invDetail) return;
            const inv = item.invDetail;
            if (inv.invoiceNo) invoiceOcrMap.set(inv.invoiceNo, inv);
            if (item.dataId) invoiceOcrMap.set(item.dataId, inv);
            if (inv.invoiceDate && inv.amountTax !== undefined) {
                invoiceOcrMap.set(`${normalizeDate(inv.invoiceDate)}_${inv.amountTax}`, inv);
            }
        });

        const recordList = await queryExpenseRecordListApi(STATE);
        const parsedRecords = await mapConcurrent(recordList, 8, async (item: any) => {
            const recId = item.expenseRecordId;
            if (!recId) return null;
            try {
                const ruleData = await getExpenseTypeRuleAndRowDatasApi(recId, item.expenseTypeId || 'UNIDENTIFIED', STATE);
                const rowDatas = ruleData.rowDatas || {};
                const v = ruleData.version || 1;

                let invVO: any = {};
                const invListField = rowDatas.expenseRecordInvoiceList;
                if (invListField && invListField.value && invListField.value.length > 0) {
                    invVO = invListField.value[0].invoiceVO || {};
                }

                let matchedInv: any = null;
                if (invVO.invoiceNo && invoiceOcrMap.has(invVO.invoiceNo)) matchedInv = invoiceOcrMap.get(invVO.invoiceNo);
                else if (invVO.invoiceDataId && invoiceOcrMap.has(invVO.invoiceDataId)) matchedInv = invoiceOcrMap.get(invVO.invoiceDataId);
                else if (item.businessDate && item.amountObj) {
                    const key = `${normalizeDate(item.businessDate)}_${item.amountObj.amount}`;
                    if (invoiceOcrMap.has(key)) matchedInv = invoiceOcrMap.get(key);
                }

                if (matchedInv) {
                    if (!invVO.timeGetOn && matchedInv.timeGetOn) invVO.timeGetOn = matchedInv.timeGetOn;
                    if (!invVO.timeGetOff && matchedInv.timeGetOff) invVO.timeGetOff = matchedInv.timeGetOff;
                    if (!invVO.mileage && matchedInv.mileage) invVO.mileage = matchedInv.mileage;
                    if (!invVO.salesName && (matchedInv.salesName || matchedInv.seller)) invVO.salesName = matchedInv.salesName || matchedInv.seller;
                    if (!invVO.seller && (matchedInv.seller || matchedInv.salesName)) invVO.seller = matchedInv.seller || matchedInv.salesName;
                    if (!invVO.invoiceNo && matchedInv.invoiceNo) invVO.invoiceNo = matchedInv.invoiceNo;
                    if (!invVO.invoiceCode && matchedInv.invoiceCode) invVO.invoiceCode = matchedInv.invoiceCode;
                    if (matchedInv.invoiceDataId) invVO.invoiceDataId = matchedInv.invoiceDataId;
                }

                let attachList: any[] = [];
                if (rowDatas.expenseRecordAttachmentList && rowDatas.expenseRecordAttachmentList.value) {
                    attachList = rowDatas.expenseRecordAttachmentList.value;
                }

                const type = detectInvoiceType(invVO, item, rowDatas);
                const isComm = type === 'COMMUNICATION';
                const rawDate = invVO.invoiceDate || (item.businessDate ? item.businessDate.split(' ')[0] : '');
                const invDate = normalizeDate(rawDate);
                const amt = item.amountObj ? item.amountObj.amount : (invVO.amountTax || 0);

                let cleanPeriod = '';
                const existingPeriod = (rowDatas.F_ZY_DEF_001 ? rowDatas.F_ZY_DEF_001.value : '').replace(/^期间[：:]\s*/, '').trim();
                cleanPeriod = (existingPeriod && existingPeriod.length === 7) ? existingPeriod : computePeriod(invDate, isComm);

                return {
                    expenseRecordId: recId,
                    version: v,
                    invoiceVO: invVO,
                    invoiceNo: invVO.invoiceNo || '',
                    invoiceCode: invVO.invoiceCode || '',
                    invoiceDate: invDate,
                    timeGetOn: normalizeTime(invVO.timeGetOn),
                    timeGetOff: normalizeTime(invVO.timeGetOff),
                    mileage: invVO.mileage ? `${invVO.mileage}km` : '',
                    amount: amt,
                    type: type,
                    startAddress: rowDatas.START_ADDRESS ? (rowDatas.START_ADDRESS.value || '') : '',
                    endAddress: rowDatas.END_ADDRESS ? (rowDatas.END_ADDRESS.value || '') : '',
                    description: item.description || (rowDatas.DESCRIPTION ? rowDatas.DESCRIPTION.value || '' : ''),
                    period: cleanPeriod,
                    attachments: attachList,
                    status: (item.expenseTypeName && item.expenseTypeName !== 'None') ? '成功' : '就绪'
                } as InvoiceItem;
            } catch (e) {
                const invDate = normalizeDate(item.businessDate ? item.businessDate.split(' ')[0] : '');
                return {
                    expenseRecordId: recId,
                    version: item.version || 1,
                    invoiceVO: {},
                    invoiceNo: '',
                    invoiceCode: '',
                    invoiceDate: invDate,
                    timeGetOn: '',
                    timeGetOff: '',
                    mileage: '',
                    amount: item.amountObj ? item.amountObj.amount : 0,
                    type: 'TAXI',
                    startAddress: '',
                    endAddress: '',
                    description: item.description || '',
                    period: computePeriod(invDate, false),
                    attachments: [],
                    status: '就绪'
                } as InvoiceItem;
            }
        });

        parsedRecords.forEach(r => {
            if (r) {
                loaded.push(r);
                if (r.expenseRecordId) processedRecordIds.add(r.expenseRecordId);
                if (r.invoiceVO && r.invoiceVO.invoiceDataId) processedInvoiceDataIds.add(r.invoiceVO.invoiceDataId);
                if (r.invoiceNo) processedInvoiceNos.add(r.invoiceNo);
            }
        });

        poolInvoices.forEach(item => {
            if (!item || !item.invDetail) return;
            const invDetail = item.invDetail;
            const dataId = item.dataId;
            const invNo = invDetail.invoiceNo || '';

            if (processedInvoiceDataIds.has(dataId) || (invNo && processedInvoiceNos.has(invNo))) return;

            const invDate = normalizeDate(invDetail.invoiceDate || '');
            const amt = invDetail.amountTax !== undefined ? invDetail.amountTax : 0;
            const type = detectInvoiceType(invDetail, {}, {});
            const isComm = type === 'COMMUNICATION';

            loaded.push({
                expenseRecordId: '',
                version: 1,
                boDataId: dataId,
                invoiceVO: invDetail,
                invoiceNo: invNo,
                invoiceCode: invDetail.invoiceCode || '',
                invoiceDate: invDate,
                timeGetOn: normalizeTime(invDetail.timeGetOn),
                timeGetOff: normalizeTime(invDetail.timeGetOff),
                mileage: invDetail.mileage ? `${invDetail.mileage}km` : '',
                amount: amt,
                type: type,
                startAddress: '',
                endAddress: '',
                description: '',
                period: computePeriod(invDate, isComm),
                attachments: [],
                status: '待流转'
            });
        });

        STATE.invoices = sortInvoices(loaded);
        STATE.selectedIndices.clear();
        STATE.invoices.forEach((_, idx) => STATE.selectedIndices.add(idx));
        executeSmartCommuteInference(false);
        renderInvoiceTable();

        alert(`✅ 成功同步全部 ${STATE.invoices.length} 笔待报销记录！已全量补全乘车时间与里程。`);
    } catch (err: any) {
        alert(`同步失败: ${err.message}`);
    } finally {
        if (btnFetch) {
            btnFetch.disabled = false;
            btnFetch.innerText = originalText;
        }
    }
}

function renderInvoiceTable() {
    if (STATE.pageMode === 'BILL') return;

    const thead = document.getElementById('yn-table-thead');
    const tbody = document.getElementById('yn-table-tbody');
    const countInfo = document.getElementById('yn-select-count-info');
    const btnSave = document.getElementById('yn-btn-batch-save');
    const grp = STATE.activeGroup;

    if (!thead || !tbody) return;

    const taxiCount = STATE.invoices.filter(r => r.type === 'TAXI').length;
    const commCount = STATE.invoices.filter(r => r.type === 'COMMUNICATION').length;
    const countTaxiEl = document.getElementById('yn-count-taxi');
    const countCommEl = document.getElementById('yn-count-comm');
    const countAllEl = document.getElementById('yn-count-all');
    if (countTaxiEl) countTaxiEl.innerText = String(taxiCount);
    if (countCommEl) countCommEl.innerText = String(commCount);
    if (countAllEl) countAllEl.innerText = String(STATE.invoices.length);

    const visibleIndices: number[] = [];
    STATE.invoices.forEach((row, idx) => {
        if (grp === 'ALL' || row.type === grp) visibleIndices.push(idx);
    });

    let selectedInView = 0;
    visibleIndices.forEach(idx => {
        if (STATE.selectedIndices.has(idx)) selectedInView++;
    });

    const grpName = grp === 'TAXI' ? '出租车' : (grp === 'COMMUNICATION' ? '通信费' : '全部');
    if (countInfo) countInfo.innerText = `当前【${grpName}】已勾选 ${selectedInView} / ${visibleIndices.length} 行 (总计 ${STATE.invoices.length} 笔)`;
    if (btnSave) btnSave.innerText = `🚀 批量保存当前【${grpName}】已勾选记录 (${selectedInView} 条)`;

    if (grp === 'TAXI') {
        thead.innerHTML = `
            <tr>
                <th style="width:36px; text-align:center;"><input type="checkbox" id="yn-th-select-all" /></th>
                <th style="width:36px;">#</th>
                <th style="width:105px;">报销分类</th>
                <th style="width:90px;">发票日期</th>
                <th style="width:145px;">乘车时间 (上车 ~ 下车)</th>
                <th style="width:65px;">里程</th>
                <th style="width:70px;">金额</th>
                <th style="width:115px;">出发地</th>
                <th style="width:32px; text-align:center;"></th>
                <th style="width:115px;">到达地</th>
                <th style="width:125px;">目的说明(选填)</th>
                <th style="width:90px;">发票号码</th>
                <th style="width:55px; text-align:center;">状态</th>
            </tr>
        `;
    } else if (grp === 'COMMUNICATION') {
        thead.innerHTML = `
            <tr>
                <th style="width:36px; text-align:center;"><input type="checkbox" id="yn-th-select-all" /></th>
                <th style="width:36px;">#</th>
                <th style="width:105px;">报销分类</th>
                <th style="width:90px;">发票日期</th>
                <th style="width:75px;">金额</th>
                <th style="width:120px;">发生年月 / 期间</th>
                <th style="width:130px;">目的说明(选填)</th>
                <th style="width:180px;">账单 PDF 附件</th>
                <th style="width:90px;">发票号码</th>
                <th style="width:55px; text-align:center;">状态</th>
            </tr>
        `;
    } else {
        thead.innerHTML = `
            <tr>
                <th style="width:36px; text-align:center;"><input type="checkbox" id="yn-th-select-all" /></th>
                <th style="width:36px;">#</th>
                <th style="width:105px;">报销分类</th>
                <th style="width:90px;">发票日期</th>
                <th style="width:130px;">乘车时间</th>
                <th style="width:70px;">金额</th>
                <th style="width:95px;">出发地</th>
                <th style="width:95px;">到达地</th>
                <th style="width:105px;">目的说明</th>
                <th style="width:100px;">期间年月</th>
                <th style="width:55px; text-align:center;">状态</th>
            </tr>
        `;
    }

    const thSelectAll = document.getElementById('yn-th-select-all') as HTMLInputElement;
    if (thSelectAll) {
        thSelectAll.checked = visibleIndices.length > 0 && selectedInView === visibleIndices.length;
        thSelectAll.addEventListener('change', (e: any) => {
            visibleIndices.forEach(idx => {
                if (e.target.checked) STATE.selectedIndices.add(idx);
                else STATE.selectedIndices.delete(idx);
            });
            renderInvoiceTable();
        });
    }

    if (visibleIndices.length === 0) {
        tbody.innerHTML = `<tr><td colspan="14" style="text-align:center; padding:50px; color:#8c8c8c;">当前分类下暂无记录。</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    visibleIndices.forEach((realIdx, rowNum) => {
        const row = STATE.invoices[realIdx];
        const isSelected = STATE.selectedIndices.has(realIdx);
        const tr = document.createElement('tr');
        if (isSelected) tr.className = 'selected';

        const typeSelectorHtml = `
            <select class="yn-type-select ${row.type === 'COMMUNICATION' ? 'type-comm' : 'type-taxi'}" data-idx="${realIdx}" data-field="type">
                <option value="TAXI" ${row.type === 'TAXI' ? 'selected' : ''}>🚕 出租车</option>
                <option value="COMMUNICATION" ${row.type === 'COMMUNICATION' ? 'selected' : ''}>📱 通信费</option>
            </select>
        `;

        if (grp === 'TAXI') {
            tr.innerHTML = `
                <td style="text-align:center;"><input type="checkbox" class="yn-row-check" data-idx="${realIdx}" ${isSelected ? 'checked' : ''} /></td>
                <td style="color:#8c8c8c; text-align:center;">${rowNum + 1}</td>
                <td>${typeSelectorHtml}</td>
                <td><input type="date" data-idx="${realIdx}" data-field="invoiceDate" value="${row.invoiceDate || ''}" style="font-size:11.5px;" /></td>
                <td><div class="yn-time-badge"><span class="yn-time-highlight">${row.timeGetOn || '--:--'}</span> ~ <span class="yn-time-highlight">${row.timeGetOff || '--:--'}</span></div></td>
                <td style="color:#595959; font-size:11.5px; text-align:center;">${row.mileage || '-'}</td>
                <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(String(row.amount || 0)).toFixed(2)}</span></td>
                <td><input type="text" data-idx="${realIdx}" data-field="startAddress" value="${row.startAddress || ''}" placeholder="如: IVISION" /></td>
                <td style="text-align:center;"><button class="yn-swap-btn" data-idx="${realIdx}">⇄</button></td>
                <td><input type="text" data-idx="${realIdx}" data-field="endAddress" value="${row.endAddress || ''}" placeholder="如: CMP" /></td>
                <td><input type="text" data-idx="${realIdx}" data-field="description" value="${row.description || ''}" placeholder="选填" /></td>
                <td><span style="font-family:monospace; color:#595959; font-size:11px;">${row.invoiceNo || '-'}</span></td>
                <td style="text-align:center;"><span class="yn-status-tag ${row.status === '成功' ? 'yn-status-success' : (row.status === '失败' ? 'yn-status-error' : 'yn-status-pending')}">${row.status || '就绪'}</span></td>
            `;
        } else if (grp === 'COMMUNICATION') {
            tr.innerHTML = `
                <td style="text-align:center;"><input type="checkbox" class="yn-row-check" data-idx="${realIdx}" ${isSelected ? 'checked' : ''} /></td>
                <td style="text-align:center; color:#8c8c8c;">${rowNum + 1}</td>
                <td>${typeSelectorHtml}</td>
                <td><input type="date" data-idx="${realIdx}" data-field="invoiceDate" value="${row.invoiceDate || ''}" style="font-size:11.5px;" /></td>
                <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(String(row.amount || 0)).toFixed(2)}</span></td>
                <td><input type="text" data-idx="${realIdx}" data-field="period" value="${row.period || ''}" placeholder="如: 2026-05" /></td>
                <td><input type="text" data-idx="${realIdx}" data-field="description" value="${row.description || ''}" placeholder="选填" /></td>
                <td><div class="yn-dropzone" data-idx="${realIdx}"><span class="yn-dropzone-prompt">📎 拖入/选择账单PDF</span><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style="display:none;" /></div></td>
                <td><span style="font-family:monospace; color:#595959; font-size:11px;">${row.invoiceNo || '-'}</span></td>
                <td style="text-align:center;"><span class="yn-status-tag ${row.status === '成功' ? 'yn-status-success' : (row.status === '失败' ? 'yn-status-error' : 'yn-status-pending')}">${row.status || '就绪'}</span></td>
            `;
        } else {
            tr.innerHTML = `
                <td style="text-align:center;"><input type="checkbox" class="yn-row-check" data-idx="${realIdx}" ${isSelected ? 'checked' : ''} /></td>
                <td style="text-align:center; color:#8c8c8c;">${rowNum + 1}</td>
                <td>${typeSelectorHtml}</td>
                <td><input type="date" data-idx="${realIdx}" data-field="invoiceDate" value="${row.invoiceDate || ''}" style="font-size:11px;" /></td>
                <td><div class="yn-time-badge">${row.timeGetOn || '-'} ~ ${row.timeGetOff || '-'}</div></td>
                <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(String(row.amount || 0)).toFixed(2)}</span></td>
                <td><input type="text" data-idx="${realIdx}" data-field="startAddress" value="${row.startAddress || ''}" ${row.type !== 'TAXI' ? 'disabled' : ''} /></td>
                <td><input type="text" data-idx="${realIdx}" data-field="endAddress" value="${row.endAddress || ''}" ${row.type !== 'TAXI' ? 'disabled' : ''} /></td>
                <td><input type="text" data-idx="${realIdx}" data-field="description" value="${row.description || ''}" /></td>
                <td><input type="text" data-idx="${realIdx}" data-field="period" value="${row.period || ''}" /></td>
                <td style="text-align:center;"><span class="yn-status-tag ${row.status === '成功' ? 'yn-status-success' : (row.status === '失败' ? 'yn-status-error' : 'yn-status-pending')}">${row.status || '就绪'}</span></td>
            `;
        }
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.yn-row-check').forEach(ck => {
        ck.addEventListener('change', (e: any) => {
            const idx = parseInt(e.target.getAttribute('data-idx'));
            if (e.target.checked) STATE.selectedIndices.add(idx);
            else STATE.selectedIndices.delete(idx);
            renderInvoiceTable();
        });
    });

    tbody.querySelectorAll('.yn-swap-btn').forEach(btn => {
        btn.addEventListener('click', (e: any) => {
            const idx = parseInt(e.target.getAttribute('data-idx'));
            if (!isNaN(idx) && STATE.invoices[idx]) {
                const temp = STATE.invoices[idx].startAddress;
                STATE.invoices[idx].startAddress = STATE.invoices[idx].endAddress;
                STATE.invoices[idx].endAddress = temp;
                renderInvoiceTable();
            }
        });
    });

    tbody.querySelectorAll('input[data-field], select[data-field]').forEach(el => {
        el.addEventListener('change', (e: any) => {
            const idx = parseInt(e.target.getAttribute('data-idx'));
            const field = e.target.getAttribute('data-field');
            if (field && !isNaN(idx) && STATE.invoices[idx]) {
                (STATE.invoices[idx] as any)[field] = e.target.value;
                if (field === 'type') {
                    const isComm = e.target.value === 'COMMUNICATION';
                    STATE.invoices[idx].period = computePeriod(STATE.invoices[idx].invoiceDate || '', isComm);
                    if (!isComm && !STATE.invoices[idx].startAddress) STATE.invoices[idx].startAddress = 'IVISION';
                    if (!isComm && !STATE.invoices[idx].endAddress) STATE.invoices[idx].endAddress = 'CMP';
                    renderInvoiceTable();
                }
            }
        });
    });
}

async function executeBatchSave() {
    const grp = STATE.activeGroup;
    const visibleIndices = STATE.invoices
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => grp === 'ALL' || row.type === grp)
        .map(({ idx }) => idx);

    const targetIndices = visibleIndices.filter(idx => STATE.selectedIndices.has(idx));
    if (targetIndices.length === 0) {
        alert('请先在表格左侧勾选需要保存的发票行。');
        return;
    }

    const progressWrap = document.getElementById('yn-progress-wrap')!;
    const progressInner = document.getElementById('yn-progress-inner')!;
    const logText = document.getElementById('yn-log-text')!;
    const btnSave = document.getElementById('yn-btn-batch-save') as HTMLButtonElement;

    progressWrap.style.display = 'block';
    btnSave.disabled = true;
    btnSave.innerText = '⏳ 正在保存中...';

    let successCount = 0;
    let failCount = 0;
    const total = targetIndices.length;

    for (let i = 0; i < total; i++) {
        const rowIdx = targetIndices[i];
        const row = STATE.invoices[rowIdx];
        const percent = Math.round(((i + 1) / total) * 100);
        progressInner.style.width = `${percent}%`;
        logText.innerText = `[${i + 1}/${total}] 正在保存: ${row.invoiceNo || '第' + (rowIdx + 1) + '行'}...`;

        try {
            const targetExpenseTypeConfig = row.type === 'COMMUNICATION' ? EXPENSE_TYPES.COMMUNICATION : EXPENSE_TYPES.TAXI;
            let recordId = row.expenseRecordId;
            if (!recordId) {
                recordId = await createDraftExpenseRecordFromInvoiceApi(row.invoiceVO, row.boDataId || row.invoiceVO?.invoiceDataId, STATE);
                row.expenseRecordId = recordId;
            }

            const ruleData = await getExpenseTypeRuleAndRowDatasApi(recordId, 'UNIDENTIFIED', STATE);
            const version = ruleData.version !== undefined ? ruleData.version : 1;
            const baseRowDatas = ruleData.rowDatas || {};

            const initData = await initExpenseRecordWithTypeApi(recordId, targetExpenseTypeConfig.id, baseRowDatas, STATE);
            const rowDatas = initData.rowDatas || {};

            const cleanPeriod = (row.period || computePeriod(row.invoiceDate || '', row.type === 'COMMUNICATION')).replace(/^期间[：:]\s*/, '').trim();

            if (row.type === 'TAXI') {
                if (rowDatas.START_ADDRESS) rowDatas.START_ADDRESS.value = row.startAddress || 'IVISION';
                if (rowDatas.END_ADDRESS) rowDatas.END_ADDRESS.value = row.endAddress || 'CMP';
                if (rowDatas.DESCRIPTION) rowDatas.DESCRIPTION.value = row.description ? row.description.trim() : '';
                if (rowDatas.F_ZY_DEF_001) rowDatas.F_ZY_DEF_001.value = cleanPeriod;
            } else if (row.type === 'COMMUNICATION') {
                const yyyy_mm = cleanPeriod.length >= 7 ? cleanPeriod.substring(0, 7) : computePeriod(row.invoiceDate || '', true);
                if (rowDatas.FLIGHT_START_DATE) rowDatas.FLIGHT_START_DATE.value = `${yyyy_mm}-01 00:00:00`;
                if (rowDatas.F_ZY_DEF_001) rowDatas.F_ZY_DEF_001.value = yyyy_mm;
                if (rowDatas.DESCRIPTION) rowDatas.DESCRIPTION.value = row.description ? row.description.trim() : '';
                if (row.attachments && row.attachments.length > 0) {
                    rowDatas.expenseRecordAttachmentList = { value: row.attachments };
                    const firstAtt = row.attachments[0];
                    if (rowDatas.ATTACH_NAME) rowDatas.ATTACH_NAME.value = (firstAtt.fileName || '账单').replace(/\.[^/.]+$/, "");
                    if (rowDatas.ATTACH_COUNT) rowDatas.ATTACH_COUNT.value = row.attachments.length;
                }
            }

            await saveFinalExpenseRecordApi(recordId, targetExpenseTypeConfig.id, rowDatas, version, STATE);
            row.status = '成功';
            successCount++;
        } catch (err) {
            console.error('Save error on row', rowIdx, err);
            row.status = '失败';
            failCount++;
        }
        renderInvoiceTable();
    }

    btnSave.disabled = false;
    renderInvoiceTable();
    logText.innerText = `处理完成！成功: ${successCount} 条，失败: ${failCount} 条。`;
    alert(`批量处理完成！\n成功: ${successCount} 条\n失败: ${failCount} 条\n已成功保存为有效费用明细！`);
}

// ==========================================
// 8. 事件绑定与初始化挂载
// ==========================================
function bindEvents() {
    const btn = document.getElementById('yn-batch-helper-btn');
    const modal = document.getElementById('yn-batch-modal');
    const mask = document.getElementById('yn-modal-mask');
    const closeBtn = document.getElementById('yn-modal-close');
    const cancelBtn = document.getElementById('yn-btn-cancel-modal');

    if (!btn || !modal) return;

    const openModal = async () => {
        modal.style.display = 'flex';
        if (mask) mask.style.display = 'block';
        updateTokenStatus();

        if (STATE.pageMode === 'BILL') {
            if (STATE.currentBillData) {
                const parsed = parseBillDataStructure(STATE.currentBillData);
                STATE.billRows = parsed.billRows;
                STATE.billTags = parsed.billTags;
            } else if (STATE.currentBillMainId) {
                try {
                    await fetchBillDataAndTemplateApi(STATE.currentBillMainId, STATE);
                } catch (e) { }
            }
            renderBillTable();
            if (STATE.activeBillTag) {
                triggerProjectSearch(STATE.activeBillTag);
            }
        } else {
            renderInvoiceTable();
        }
    };

    const closeModal = () => {
        modal.style.display = 'none';
        if (mask) mask.style.display = 'none';
    };

    btn.addEventListener('click', openModal);
    if (mask) mask.addEventListener('click', closeModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // 报销单模式专用事件
    if (STATE.pageMode === 'BILL') {
        const filterInput = document.getElementById('yn-bill-filter-input') as HTMLInputElement;
        const btnApplyFilter = document.getElementById('yn-bill-btn-apply-filter');
        const thSelectAll = document.getElementById('yn-bill-th-select-all') as HTMLInputElement;
        const projSearch = document.getElementById('yn-bill-project-search') as HTMLInputElement;
        const projSelect = document.getElementById('yn-bill-project-select') as HTMLSelectElement;
        const accountSelect = document.getElementById('yn-bill-account-select') as HTMLSelectElement;
        const costCenterSelect = document.getElementById('yn-bill-cost-center-select') as HTMLSelectElement;
        const khfdSelect = document.getElementById('yn-bill-khfd-select') as HTMLSelectElement;
        const btnReload = document.getElementById('yn-bill-btn-reload');
        const btnExec = document.getElementById('yn-bill-btn-batch-execute');

        if (accountSelect) {
            accountSelect.addEventListener('change', (e: any) => {
                const opt = e.target.selectedOptions[0];
                STATE.selectedAccount = { value: e.target.value, title: opt ? opt.innerText : '' };
                renderBillTable();
            });
        }

        if (costCenterSelect) {
            costCenterSelect.addEventListener('change', (e: any) => {
                const opt = e.target.selectedOptions[0];
                STATE.selectedCostCenter = { value: e.target.value, title: opt ? opt.innerText : '' };
                renderBillTable();
            });
        }

        if (khfdSelect) {
            khfdSelect.addEventListener('change', (e: any) => {
                const opt = e.target.selectedOptions[0];
                STATE.selectedKhfd = { value: e.target.value, title: opt ? opt.innerText : '' };
                renderBillTable();
            });
        }

        if (btnApplyFilter) {
            btnApplyFilter.addEventListener('click', async () => {
                const tag = filterInput ? filterInput.value.trim() : '';
                STATE.activeBillTag = tag;
                autoSelectBillRowsByTag(tag);
                if (tag) await triggerProjectSearch(tag);
                renderBillTable();
            });
        }

        if (thSelectAll) {
            thSelectAll.addEventListener('change', (e: any) => {
                if (e.target.checked) {
                    STATE.billRows.forEach((_, idx) => STATE.billSelectedIndices.add(idx));
                } else {
                    STATE.billSelectedIndices.clear();
                }
                renderBillTable();
            });
        }

        let searchTimeout: any = null;
        if (projSearch) {
            projSearch.addEventListener('input', (e: any) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    triggerProjectSearch(e.target.value);
                }, 350);
            });
        }

        if (projSelect) {
            projSelect.addEventListener('change', (e: any) => {
                const val = e.target.value;
                const match = STATE.projectSearchResults.find(p => p.id === val || p.value === val);
                if (match) {
                    STATE.selectedProject = { value: match.id || match.value, title: match.title };
                }
                renderBillTable();
            });
        }

        if (btnReload) {
            btnReload.addEventListener('click', async () => {
                if (STATE.currentBillMainId) {
                    await fetchBillDataAndTemplateApi(STATE.currentBillMainId, STATE);
                    alert('已重新读取报销单最新数据！');
                } else {
                    alert('未检测到报销单 ID，请在报销单页面操作后重试。');
                }
            });
        }

        if (btnExec) {
            btnExec.addEventListener('click', executeBatchBillBudgetUpdate);
        }
    } else {
        // 发票夹/费用记录模式事件
        document.querySelectorAll('.yn-tab-btn').forEach(tab => {
            tab.addEventListener('click', () => {
                const grp = tab.getAttribute('data-group') as any;
                STATE.activeGroup = grp;
                document.querySelectorAll('.yn-tab-btn').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const barTaxi = document.getElementById('yn-quick-bar-taxi');
                const barComm = document.getElementById('yn-quick-bar-comm');
                if (barTaxi) barTaxi.style.display = (grp === 'TAXI' || grp === 'ALL') ? 'flex' : 'none';
                if (barComm) barComm.style.display = grp === 'COMMUNICATION' ? 'flex' : 'none';
                renderInvoiceTable();
            });
        });

        const btnFetch = document.getElementById('yn-btn-fetch-all');
        if (btnFetch) btnFetch.addEventListener('click', fetchAllPendingData);
        const btnCommute = document.getElementById('yn-btn-smart-commute');
        if (btnCommute) btnCommute.addEventListener('click', () => executeSmartCommuteInference(true));
        const btnSave = document.getElementById('yn-btn-batch-save');
        if (btnSave) btnSave.addEventListener('click', executeBatchSave);
    }
}

// ==========================================
// 9. 模式 C: 考勤工数系统 (time-mg.huge-vision.com) 核心逻辑与事件
// ==========================================
function updateTimeMgTokenStatus() {
    const badge = document.querySelector('#yn-timemg-helper-btn .yn-timemg-badge');
    const csrf = getCsrfToken(STATE.timeMg);
    if (badge) {
        badge.className = `yn-timemg-badge ${csrf ? '' : 'offline'}`;
    }
}

function initTimeMgSystem() {
    const activeYM = detectActiveYearAndMonth();
    if (!STATE.timeMg) {
        STATE.timeMg = {
            selectedYear: activeYM.year,
            selectedMonth: activeYM.month,
            csrfToken: getCsrfToken(),
            expProjects: [],
            detailDays: [],
            allocatedPlans: [],
            isProcessing: false,
            lastSyncTime: ''
        };
    } else {
        STATE.timeMg.selectedYear = activeYM.year;
        STATE.timeMg.selectedMonth = activeYM.month;
    }
    injectTimeMgStyles();
    createTimeMgModalDOM(STATE.timeMg);
    bindTimeMgEvents();
    updateTimeMgTokenStatus();
    autoInitHostCollapseBadge();
}

let timeMgEventsBound = false;

function bindTimeMgEvents() {
    if (timeMgEventsBound) return;
    timeMgEventsBound = true;

    const btn = document.getElementById('yn-timemg-helper-btn');
    const modal = document.getElementById('yn-timemg-modal');
    const mask = document.getElementById('yn-timemg-modal-mask');
    const closeBtn = document.getElementById('yn-timemg-modal-close');
    const btnSync = document.getElementById('yn-timemg-btn-sync');
    const btnRecalc = document.getElementById('yn-timemg-btn-recalc');
    const btnAutofill = document.getElementById('yn-timemg-btn-autofill');
    const btnCopyLog = document.getElementById('yn-timemg-btn-copylog');
    const yearInput = document.getElementById('yn-timemg-input-year') as HTMLInputElement;
    const monthInput = document.getElementById('yn-timemg-input-month') as HTMLInputElement;

    if (!btn || !modal) return;

    const openModal = async () => {
        // 打开模态框时，优先嗅探宿主页面当前正在展示的最新年月
        const activeYM = detectActiveYearAndMonth();
        if (yearInput) yearInput.value = activeYM.year;
        if (monthInput) monthInput.value = String(parseInt(activeYM.month, 10));

        let monthChanged = false;
        if (STATE.timeMg) {
            monthChanged = (STATE.timeMg.selectedYear !== activeYM.year) || (STATE.timeMg.selectedMonth !== activeYM.month);
            STATE.timeMg.selectedYear = activeYM.year;
            STATE.timeMg.selectedMonth = activeYM.month;
            if (monthChanged) {
                STATE.timeMg.expProjects = [];
                STATE.timeMg.detailDays = [];
                STATE.timeMg.allocatedPlans = [];
            }
        }

        modal.style.display = 'flex';
        if (mask) mask.style.display = 'block';
        updateTimeMgTokenStatus();

        if (STATE.timeMg && (STATE.timeMg.expProjects.length === 0 || monthChanged)) {
            await syncTimeMgData();
        }
    };

    const closeModal = () => {
        modal.style.display = 'none';
        if (mask) mask.style.display = 'none';
    };

    btn.addEventListener('click', openModal);
    if (mask) mask.addEventListener('click', closeModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    if (btnSync) btnSync.addEventListener('click', () => syncTimeMgData());
    if (btnRecalc) btnRecalc.addEventListener('click', () => recalcTimeMgAllocation());
    if (btnAutofill) btnAutofill.addEventListener('click', () => executeTimeMgAutofill());
    if (btnCopyLog) {
        btnCopyLog.addEventListener('click', async () => {
            const ok = await AutopilotLogger.copyLogsToClipboard();
            if (ok) {
                showToast('success', '📋 完整运行日志已成功复制到剪贴板！');
            } else {
                showToast('error', '❌ 复制失败，请手动选择日志文本复制。');
            }
        });
    }

    if (yearInput) {
        yearInput.addEventListener('change', () => {
            if (STATE.timeMg) STATE.timeMg.selectedYear = yearInput.value;
        });
    }
    if (monthInput) {
        monthInput.addEventListener('change', () => {
            if (STATE.timeMg) STATE.timeMg.selectedMonth = String(monthInput.value).padStart(2, '0');
        });
    }
}

function handleToggleOverflow(pjNo: string, checked: boolean) {
    if (!STATE.timeMg) return;
    const set = new Set(STATE.timeMg.allowedOverflowPjNos || []);
    if (checked) set.add(pjNo);
    else set.delete(pjNo);
    STATE.timeMg.allowedOverflowPjNos = Array.from(set);

    const plans = computeProjectAllocationPlan(
        STATE.timeMg.expProjects,
        STATE.timeMg.detailDays,
        STATE.timeMg.allowedOverflowPjNos
    );
    STATE.timeMg.allocatedPlans = plans;

    renderTimeMgExpProjects(STATE.timeMg.expProjects, STATE.timeMg, handleToggleOverflow);
    renderTimeMgPlans(plans);

    const assignedDays = plans.filter(p => p.isWorkDay && p.pjNo).length;
    AutopilotLogger.info(`已更新项目超额配置：${pjNo} (${checked ? '允许超预算' : '不超预算'})，当前已分摊出勤日: ${assignedDays} 天`);
    showToast('info', checked ? `已允许【${pjNo}】超出预算吸收缺口工时` : `已取消【${pjNo}】超预算分摊`, 2500);
}

async function syncTimeMgData() {
    if (!STATE.timeMg) return;
    const yearInput = document.getElementById('yn-timemg-input-year') as HTMLInputElement;
    const monthInput = document.getElementById('yn-timemg-input-month') as HTMLInputElement;
    const btnSync = document.getElementById('yn-timemg-btn-sync') as HTMLButtonElement;

    const y = yearInput ? yearInput.value : STATE.timeMg.selectedYear;
    const m = monthInput ? String(monthInput.value).padStart(2, '0') : STATE.timeMg.selectedMonth;
    STATE.timeMg.selectedYear = y;
    STATE.timeMg.selectedMonth = m;

    if (btnSync) {
        btnSync.disabled = true;
        btnSync.innerText = '⏳ 正在同步...';
    }

    AutopilotLogger.info(`开始同步 ${y}年${m}月 考勤与项目预实工时数据...`);

    try {
        await syncHostMonth(y, m);

        const [expProjects, detailDays] = await Promise.all([
            fetchExpWHInfoApi(y, m, STATE.timeMg),
            fetchDetailWHInfoApi(y, m, STATE.timeMg)
        ]);

        STATE.timeMg.expProjects = expProjects;
        STATE.timeMg.detailDays = detailDays;
        AutopilotLogger.success(`数据拉取完成：获取到 ${expProjects.length} 个项目预实对比项，${detailDays.length} 天考勤明细`);

        // 执行智能分配 (支持勾选超预算项目)
        const plans = computeProjectAllocationPlan(expProjects, detailDays, STATE.timeMg.allowedOverflowPjNos || []);
        STATE.timeMg.allocatedPlans = plans;

        // 计算预算工时缺口
        const shortfall = calculateBudgetShortfall(expProjects, detailDays, plans);
        STATE.timeMg.budgetShortfall = shortfall;

        updateCollapseHeaderShortfallBadge(shortfall);
        renderTimeMgExpProjects(expProjects, STATE.timeMg, handleToggleOverflow);
        renderTimeMgPlans(plans);

        const workDays = plans.filter(p => p.isWorkDay);
        const assignedHours = workDays.filter(p => Boolean(p.pjNo)).reduce((s, p) => s + (p.timeWH || 0), 0);
        AutopilotLogger.success(`智能工数分配完成：${workDays.length} 个出勤日，已分配工时 ${assignedHours.toFixed(2)}h`);

        if (shortfall.shortfallHours > 0) {
            showToast('info', `✅ 成功同步！当月出勤需求 ${shortfall.totalRequiredHours}h，预算缺口 ${shortfall.shortfallHours}h。可在左侧勾选允许超出的项目，或保持缺口留空。`, 5000);
        } else {
            showToast('success', `✅ 成功同步 ${y}年${m}月 数据！共 ${expProjects.length} 个项目，已自动完成分配。`, 4000);
        }
    } catch (err: any) {
        AutopilotLogger.error(`同步失败: ${err.message}`);
        showToast('error', `❌ 同步失败: ${err.message}，请检查登录状态或网络`, 5000);
    } finally {
        if (btnSync) {
            btnSync.disabled = false;
            btnSync.innerText = '🔄 同步考勤与项目数据';
        }
    }
}

function recalcTimeMgAllocation() {
    if (!STATE.timeMg) return;
    if (STATE.timeMg.expProjects.length === 0 || STATE.timeMg.detailDays.length === 0) {
        showToast('warning', '请先点击【🔄 同步考勤与项目数据】获取当月考勤！');
        return;
    }

    AutopilotLogger.info('正在重新试算工数分配方案...');
    const plans = computeProjectAllocationPlan(
        STATE.timeMg.expProjects,
        STATE.timeMg.detailDays,
        STATE.timeMg.allowedOverflowPjNos || []
    );
    STATE.timeMg.allocatedPlans = plans;

    const shortfall = calculateBudgetShortfall(STATE.timeMg.expProjects, STATE.timeMg.detailDays, plans);
    STATE.timeMg.budgetShortfall = shortfall;

    updateCollapseHeaderShortfallBadge(shortfall);
    renderTimeMgExpProjects(STATE.timeMg.expProjects, STATE.timeMg, handleToggleOverflow);
    renderTimeMgPlans(plans);
    AutopilotLogger.success('智能工数分配已重新刷新！');
    showToast('info', '⚡ 智能工数分配已刷新！');
}

async function executeTimeMgAutofill() {
    if (!STATE.timeMg || STATE.timeMg.allocatedPlans.length === 0) {
        showToast('warning', '请先同步数据并生成分配方案！');
        return;
    }

    const workDays = STATE.timeMg.allocatedPlans.filter(p => p.isWorkDay);
    const existingDays = STATE.timeMg.allocatedPlans.filter(p => p.status === '已填写');
    const toFillDays = STATE.timeMg.allocatedPlans.filter(p => p.status === '就绪');
    const outCount = toFillDays.filter(p => p.isOut).length;
    const officeCount = toFillDays.length - outCount;
    const shortfall = STATE.timeMg.budgetShortfall;

    AutopilotLogger.info(`准备执行孪生客户端填报：保留已有 ${existingDays.length} 条，装载待填 ${toFillDays.length} 条 (外出 ${outCount} 天, 公司 ${officeCount} 天)...`);

    const progressWrap = document.getElementById('yn-timemg-progress-wrap')!;
    const progressInner = document.getElementById('yn-timemg-progress-inner')!;
    const logText = document.getElementById('yn-timemg-log-text')!;
    const btnAutofill = document.getElementById('yn-timemg-btn-autofill') as HTMLButtonElement;

    progressWrap.style.display = 'block';
    btnAutofill.disabled = true;
    btnAutofill.innerText = '⏳ 正在填报并保存...';

    const res = await saveAttendanceTwinClient(STATE.timeMg.allocatedPlans, STATE.timeMg, (idx, total, msg) => {
        const percent = Math.round((idx / total) * 100);
        progressInner.style.width = `${percent}%`;
        logText.innerText = `[${idx}/${total}] ${msg}`;
        AutopilotLogger.info(`[进度 ${idx}/${total}] ${msg}`);
    });

    progressInner.style.width = '100%';
    btnAutofill.disabled = false;
    btnAutofill.innerText = '💾 一键填报并保存考勤 (Twin Client)';
    renderTimeMgPlans(STATE.timeMg.allocatedPlans);

    if (res.failCount === 0) {
        logText.innerText = `✅ 全部 ${res.successCount} 条记录填报并生效保存！`;
        AutopilotLogger.success(`🎉 填报成功完成：全部 ${res.successCount} 条记录已装载并触发生效保存！`);
        let toastMsg = `🎉 全部 ${res.successCount} 条出勤记录已成功装载并触发生效保存！`;
        if (shortfall && shortfall.shortfallHours > 0) {
            toastMsg += `\n（注：缺口 ${shortfall.shortfallHours}h 的行项目编号已留空，请按需手动选择项目）`;
        }
        showToast('success', toastMsg, 6000);
    } else {
        logText.innerText = `⚠️ 填报完成：成功 ${res.successCount} 条，失败 ${res.failCount} 条`;
        AutopilotLogger.warn(`填报部分异常：成功 ${res.successCount} 条，失败 ${res.failCount} 条。详情: ${res.errors.join('; ')}`);
        showToast('warning', `⚠️ 填报完成：成功 ${res.successCount} 条，失败 ${res.failCount} 条`, 5000);
    }
}

function checkAndMount() {
    if (typeof window !== 'undefined' && window.top !== window.self) return;
    const mode = detectPageMode();
    if (mode === 'TIME_MG') {
        STATE.pageMode = mode;
        initTimeMgSystem();
        console.log(`[IVision FSSC Autopilot v4.4.0] Mounted successfully in [TIME_MG] mode.`);
        return;
    }
    if (mode && mode !== 'UNKNOWN') {
        STATE.pageMode = mode;
        extractUrlParams();
        injectStyles();
        createModalDOM(STATE);
        bindEvents();
        updateTokenStatus();
        console.log(`[IVision FSSC Autopilot v4.4.0] Mounted successfully in [${mode}] mode.`);
    }
}

window.addEventListener('DOMContentLoaded', checkAndMount);
window.addEventListener('hashchange', checkAndMount);
window.addEventListener('popstate', checkAndMount);

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    checkAndMount();
}

// 轮询检查避免 Vue 异步路由渲染遗漏
setInterval(() => {
    if (!document.getElementById('yn-batch-helper-btn') && !document.getElementById('yn-timemg-helper-btn')) {
        checkAndMount();
    }
}, 1500);
