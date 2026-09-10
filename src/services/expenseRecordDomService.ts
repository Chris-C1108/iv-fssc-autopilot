import { GlobalState } from '../types/state';
import { AutopilotLogger } from '../utils/logger';
import { showToast } from '../utils/toast';
import {
    fetchExpenseRecordsWithInvoiceDetails,
    convertExpenseRecordsToCsv,
    downloadCsvFile
} from './expenseService';
import { getInvoicePoolGlobalState } from './invoicePoolDomService';
import { openBatchEditExpenseModal } from '../ui/batchEditExpenseModal';

let isObserverAttached = false;
const observedDocs = new WeakSet<Document>();

/**
 * 判断指定文档是否为费用记录页面文档
 */
export function isExpenseRecordDoc(d: Document | null | undefined, urlStr: string = ''): boolean {
    if (!d || !d.body) return false;
    if (
        urlStr.includes('expenserecord') ||
        urlStr.includes('56dd4bb8a5bf11e8a1a1d174f439477e') ||
        decodeURIComponent(urlStr).includes('menuName=费用记录')
    ) {
        return true;
    }
    // 检查页面是否存在费用记录特有元素或文字
    const hasAddExpense = Array.from(d.querySelectorAll('button, span')).some(el =>
        (el as HTMLElement).innerText?.includes('新增费用') || (el as HTMLElement).innerText?.includes('去报销')
    );
    if (hasAddExpense) return true;

    return false;
}

/**
 * 获取费用记录所在的所有同源 DOM 文档
 */
export function getExpenseRecordTargetDocs(): Document[] {
    const docs: Document[] = [];
    if (typeof document === 'undefined') return docs;

    // 1. 当前主文档
    if (isExpenseRecordDoc(document, typeof window !== 'undefined' ? window.location.href : '')) {
        docs.push(document);
    }

    // 2. 穿透所有同源 iframe
    try {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        iframes.forEach(f => {
            try {
                const fDoc = f.contentDocument || f.contentWindow?.document;
                if (fDoc && isExpenseRecordDoc(fDoc, f.src || f.contentWindow?.location?.href || '')) {
                    docs.push(fDoc);
                }
            } catch (e) { }
        });
    } catch (e) { }

    return docs;
}

/**
 * 从列表行元素提取 React 挂载的底层费用记录数据
 */
function getExpenseRecordFromRow(row: HTMLElement): any | null {
    if (!row) return null;
    const reactKey = Object.keys(row).find(k => k.startsWith('__react'));
    if (!reactKey) return null;
    let curr = (row as any)[reactKey];
    while (curr) {
        const props = curr.memoizedProps;
        if (props && (props.data || props.item || props.record || props.expenseRecord)) {
            return props.data || props.item || props.record || props.expenseRecord;
        }
        curr = curr.return;
    }
    return null;
}

/**
 * 提取当前页面被选中的费用记录 ID 集合
 */
export interface ExpenseSelectionInfo {
    isSelectAll: boolean;
    selectedIds: string[];
    domItemCount: number;
}

let isAutoExpanding = false;

/**
 * 自动滚动加载全部动态/懒加载的费用记录到 DOM 中
 */
export async function loadAllExpenseRecordsInDom(
    doc: Document,
    onProgress?: (loaded: number) => void
): Promise<number> {
    if (isAutoExpanding) return 0;
    isAutoExpanding = true;

    try {
        const body = doc.querySelector<HTMLElement>('[class*="lists_body"]') ||
            doc.querySelector<HTMLElement>('.ps') ||
            doc.querySelector<HTMLElement>('[class*="record_lists"]');
        if (!body) return 0;

        let lastCount = doc.querySelectorAll('[class*="list_item"]:not([class*="lists_header"])').length;
        let sameCountTicks = 0;
        const maxIterations = 30;
        let iteration = 0;

        while (sameCountTicks < 2 && iteration < maxIterations) {
            iteration++;
            body.scrollTop = body.scrollHeight;
            body.dispatchEvent(new Event('scroll', { bubbles: true }));
            await new Promise(r => setTimeout(r, 160));

            const currentCount = doc.querySelectorAll('[class*="list_item"]:not([class*="lists_header"])').length;
            if (currentCount === lastCount) {
                sameCountTicks++;
            } else {
                sameCountTicks = 0;
                lastCount = currentCount;
                if (onProgress) onProgress(currentCount);
            }
        }

        // 平滑滚回顶部
        body.scrollTop = 0;
        body.dispatchEvent(new Event('scroll', { bubbles: true }));
        return lastCount;
    } finally {
        isAutoExpanding = false;
    }
}

/**
 * 提取当前页面费用记录的勾选状态（全选识别、DOM打勾项、React Fiber多维校验）
 */
function getExpenseSelectionInfo(doc: Document): ExpenseSelectionInfo {
    const headerCb = doc.querySelector<HTMLInputElement>('input[id*="selectAll"]') ||
        doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0];
    const isSelectAll = !!(headerCb && headerCb.checked);

    const checkedInputs = Array.from(
        doc.querySelectorAll<HTMLInputElement>('.ant-checkbox-input:checked:not([id*="selectAll"])')
    );

    const domIds: string[] = [];
    for (const input of checkedInputs) {
        const row = input.closest<HTMLElement>('[class*="list_item"]') || input.closest<HTMLElement>('div');
        if (row) {
            const rec = getExpenseRecordFromRow(row);
            if (rec && (rec.expenseRecordId || rec.id)) {
                domIds.push(rec.expenseRecordId || rec.id);
            }
        }
    }

    // 从 React Fiber 状态获取 selectedIds (如全选或虚拟滚动时)
    let fiberSelectedIds: string[] = [];
    try {
        const items = Array.from(doc.querySelectorAll('[class*="list_item"]'));
        for (const item of items) {
            const rKey = Object.keys(item).find(k => k.startsWith('__react'));
            if (!rKey) continue;
            let curr = (item as any)[rKey];
            while (curr) {
                const sIds = curr.memoizedState?.selectedIds;
                if (Array.isArray(sIds) && sIds.length > fiberSelectedIds.length) {
                    fiberSelectedIds = sIds;
                }
                curr = curr.return;
            }
        }
    } catch (e) { }

    const totalDomItems = doc.querySelectorAll('[class*="list_item"]:not([class*="lists_header"])').length;

    let finalIds: string[] = [];
    if (isSelectAll) {
        finalIds = fiberSelectedIds.length > 0 ? fiberSelectedIds : domIds;
    } else {
        finalIds = domIds;
    }

    return {
        isSelectAll,
        selectedIds: Array.from(new Set(finalIds)),
        domItemCount: totalDomItems
    };
}

/**
 * 保持兼容原有接口
 */
function getSelectedExpenseRecordIds(doc: Document): string[] {
    return getExpenseSelectionInfo(doc).selectedIds;
}

/**
 * 生成时间戳字符串 YYYYMMDD_HHmmss
 */
function getNowTimestamp(): string {
    const now = new Date();
    const YYYY = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${YYYY}${MM}${DD}_${hh}${mm}${ss}`;
}

/**
 * 执行费用记录与关联发票明细导出
 */
async function handleExportExpenseRecords(doc: Document, btn: HTMLButtonElement) {
    const state = getInvoicePoolGlobalState();
    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);

    // 刚性容灾提取最新 TOKEN
    if (!state.loginToken) {
        try {
            const m = (doc.defaultView?.location?.href || window.location.href).match(/TOKEN=([a-zA-Z0-9_\-]+)/);
            if (m) state.loginToken = m[1];
        } catch (e) { }
        if (!state.loginToken && typeof document !== 'undefined') {
            const iframes = Array.from(document.querySelectorAll('iframe'));
            for (const f of iframes) {
                const m = (f.src || '').match(/TOKEN=([a-zA-Z0-9_\-]+)/);
                if (m) { state.loginToken = m[1]; break; }
            }
        }
        if (!state.loginToken && typeof sessionStorage !== 'undefined') {
            state.loginToken = sessionStorage.getItem('ecs_TOKEN') || sessionStorage.getItem('console_TOKEN') || '';
        }
        if (!state.loginToken && typeof window !== 'undefined' && (window.top as any)?.sessionStorage) {
            try {
                state.loginToken = (window.top as any).sessionStorage.getItem('ecs_TOKEN') || (window.top as any).sessionStorage.getItem('console_TOKEN') || '';
            } catch (e) { }
        }
    }
    if (!state.ecsToken && typeof sessionStorage !== 'undefined') {
        state.ecsToken = sessionStorage.getItem('ecs_token') || sessionStorage.getItem('EcsToken') || '';
        if (!state.ecsToken && typeof window !== 'undefined' && (window.top as any)?.sessionStorage) {
            try {
                state.ecsToken = (window.top as any).sessionStorage.getItem('ecs_token') || (window.top as any).sessionStorage.getItem('EcsToken') || '';
            } catch (e) { }
        }
    }

    const selection = getExpenseSelectionInfo(doc);
    // 当全选或未勾选任何项时，均导出全量未报销；当个别勾选时，按勾选导出
    const isExportingSpecific = selection.selectedIds.length > 0 && !selection.isSelectAll;

    btn.classList.add('is-loading');
    btn.disabled = true;
    const originalText = selection.isSelectAll
        ? `📥 导出已选费用 (全部 ${selection.selectedIds.length} 条)`
        : (isExportingSpecific ? `📥 导出已选费用 (已选 ${selection.selectedIds.length} 条)` : '📥 导出费用与发票清单');
    btn.innerHTML = `<span>⏳ 正在查询费用记录...</span>`;

    try {
        showToast('info', isExportingSpecific
            ? `正在提取已选 ${selection.selectedIds.length} 笔费用及关联发票详情...`
            : '正在提取全量未报销费用及关联发票详情...');

        const rows = await fetchExpenseRecordsWithInvoiceDetails(
            state,
            isExportingSpecific ? selection.selectedIds : undefined,
            (curr, total) => {
                btn.innerHTML = `<span>⏳ 正在提取发票 (${curr}/${total})...</span>`;
            },
            win
        );

        if (!rows || rows.length === 0) {
            showToast('warning', '未找到可导出的费用记录');
            btn.innerHTML = `<span>${originalText}</span>`;
            btn.disabled = false;
            btn.classList.remove('is-loading');
            return;
        }

        // 统计行程核对预警数量
        const warnCount = rows.filter(r => r.reconciliationNote && r.reconciliationNote.includes('⚠️')).length;

        // 生成标准 CSV 内容 (带 UTF-8 BOM)
        const csvContent = convertExpenseRecordsToCsv(rows);
        const filename = `费用记录与发票行程核对清单_${getNowTimestamp()}.csv`;
        downloadCsvFile(csvContent, filename, win);

        const successMsg = warnCount > 0
            ? `🎉 成功导出 ${rows.length} 条发票记录！(检测到 ${warnCount} 处开票与行程日期差异，已在最后一列标注)`
            : `🎉 成功导出 ${rows.length} 条发票记录！已开始下载`;
        showToast('success', successMsg, 4500);

        btn.innerHTML = `<span>✅ 导出成功 (${rows.length} 条)</span>`;

        setTimeout(() => {
            btn.disabled = false;
            btn.classList.remove('is-loading');
            const currentSel = getExpenseSelectionInfo(doc);
            if (currentSel.isSelectAll) {
                btn.innerHTML = `<span>📥 导出已选费用 (全部 ${currentSel.selectedIds.length} 条)</span>`;
            } else if (currentSel.selectedIds.length > 0) {
                btn.innerHTML = `<span>📥 导出已选费用 (已选 ${currentSel.selectedIds.length} 条)</span>`;
            } else {
                btn.innerHTML = `<span>📥 导出费用与发票清单</span>`;
            }
        }, 3500);

    } catch (err: any) {
        AutopilotLogger.error(`[ExpenseRecordDomService] 导出失败: ${err.message}`);
        showToast('error', `❌ 导出失败: ${err.message || '网络或系统异常'}`);
        btn.innerHTML = `<span>${originalText}</span>`;
        btn.disabled = false;
        btn.classList.remove('is-loading');
    }
}

/**
 * 扫描并挂载导出按钮及展开全部按钮到操作栏
 */
export function scanAndEnhanceExpenseRecordDOM(doc: Document) {
    if (!doc || !doc.body) return;

    // 寻找操作栏容器
    const container = doc.querySelector('.platform-expenseclaim-expenseRecord-index__operate_record_btn_container--3Yccrbqk') ||
        doc.querySelector('[class*="operate_record_btn_container"]') ||
        doc.querySelector('.ant-btn-primary')?.parentElement?.parentElement;

    if (!container) return;

    // 1. 导出按钮
    let btnExport = doc.getElementById('yn-btn-export-expense-records') as HTMLButtonElement;
    if (!btnExport) {
        btnExport = doc.createElement('button');
        btnExport.type = 'button';
        btnExport.id = 'yn-btn-export-expense-records';
        btnExport.className = 'ant-btn yn-btn-export-expense-records';
        btnExport.title = '导出费用记录及其关联发票的完整行程时间与开票核对清单 (Excel CSV)';
        btnExport.innerHTML = '<span>📥 导出费用与发票清单</span>';

        btnExport.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleExportExpenseRecords(doc, btnExport);
        });

        container.appendChild(btnExport);
    }

    // 2. 一键展开全部记录按钮
    let btnLoadAll = doc.getElementById('yn-btn-load-all-expense-records') as HTMLButtonElement;
    if (!btnLoadAll) {
        btnLoadAll = doc.createElement('button');
        btnLoadAll.type = 'button';
        btnLoadAll.id = 'yn-btn-load-all-expense-records';
        btnLoadAll.className = 'ant-btn yn-btn-load-all-expense-records';
        btnLoadAll.title = '一键向下滚动展开加载全部动态分页费用记录';
        btnLoadAll.innerHTML = '<span>⚡ 展开全部记录</span>';

        btnLoadAll.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (btnLoadAll.classList.contains('is-loading')) return;

            btnLoadAll.classList.add('is-loading');
            btnLoadAll.disabled = true;
            btnLoadAll.innerHTML = '<span>⏳ 正在展开全部...</span>';

            try {
                const total = await loadAllExpenseRecordsInDom(doc, (count) => {
                    btnLoadAll.innerHTML = `<span>⏳ 正在加载 (${count}条)...</span>`;
                });
                btnLoadAll.innerHTML = `<span>✅ 已加载全量 (${total}条)</span>`;
                showToast('success', `🎉 成功展开全部 ${total} 条费用记录！`, 3000);
            } catch (err: any) {
                btnLoadAll.innerHTML = '<span>⚡ 展开全部记录</span>';
            } finally {
                setTimeout(() => {
                    btnLoadAll.disabled = false;
                    btnLoadAll.classList.remove('is-loading');
                }, 1500);
            }
        });

        container.appendChild(btnLoadAll);
    }

    // 3. 批量修改费用信息按钮
    let btnBatchEdit = doc.getElementById('yn-btn-batch-edit-expenses') as HTMLButtonElement;
    if (!btnBatchEdit) {
        btnBatchEdit = doc.createElement('button');
        btnBatchEdit.type = 'button';
        btnBatchEdit.id = 'yn-btn-batch-edit-expenses';
        btnBatchEdit.className = 'ant-btn yn-btn-batch-edit-expenses';
        btnBatchEdit.title = '打开批量修改费用信息模态框 (按开票日期排序与外驻代报销规范)';
        btnBatchEdit.innerHTML = '<span>✏️ 批量修改费用</span>';

        btnBatchEdit.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sel = getExpenseSelectionInfo(doc);
            openBatchEditExpenseModal(doc, sel.selectedIds.length > 0 && !sel.isSelectAll ? sel.selectedIds : undefined);
        });

        container.appendChild(btnBatchEdit);
    }

    // 4. 监听行复选框与表头全选变动
    if (!(doc as any).__yn_expense_selection_listener_attached) {
        (doc as any).__yn_expense_selection_listener_attached = true;
        const updateSelectionBtn = () => {
            const currentBtn = doc.getElementById('yn-btn-export-expense-records') as HTMLButtonElement;
            if (currentBtn && !currentBtn.classList.contains('is-loading')) {
                const sel = getExpenseSelectionInfo(doc);
                const count = sel.isSelectAll ? sel.domItemCount : sel.selectedIds.length;
                if (sel.isSelectAll) {
                    currentBtn.innerHTML = `<span>📥 导出已选费用 (全部 ${count} 条)</span>`;
                } else if (sel.selectedIds.length > 0) {
                    currentBtn.innerHTML = `<span>📥 导出已选费用 (已选 ${sel.selectedIds.length} 条)</span>`;
                } else {
                    currentBtn.innerHTML = `<span>📥 导出费用与发票清单</span>`;
                }
            }
        };

        // 监听表头全选联动：当用户勾选全选时，若列表未展开完，自动流式加载所有剩余记录并全选
        doc.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target && target.closest && (
                target.closest('[id*="selectAll"]') ||
                target.closest('[class*="lists_header"] .ant-checkbox-wrapper') ||
                target.closest('[class*="lists_header"] .ant-checkbox')
            )) {
                setTimeout(async () => {
                    const headerCheckbox = doc.querySelector<HTMLInputElement>('input[id*="selectAll"]');
                    if (headerCheckbox && headerCheckbox.checked) {
                        const beforeCount = doc.querySelectorAll('[class*="list_item"]:not([class*="lists_header"])').length;
                        // 触发平滑展开加载全部
                        const total = await loadAllExpenseRecordsInDom(doc);
                        if (total > beforeCount) {
                            const cbs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
                            if (cbs[0]) {
                                const rowCbs = cbs.slice(1);
                                const checkedCount = rowCbs.filter(c => c.checked).length;
                                if (checkedCount < rowCbs.length) {
                                    if (checkedCount > 0 && !cbs[0].checked) {
                                        cbs[0].click();
                                        setTimeout(() => {
                                            if (!cbs[0].checked) cbs[0].click();
                                            updateSelectionBtn();
                                        }, 60);
                                    } else if (!cbs[0].checked) {
                                        cbs[0].click();
                                    }
                                }
                            }
                            showToast('info', `⚡ 动态列表已自动补齐剩余费用记录并完成全选 (共 ${total} 条)！`, 3000);
                        }
                    }
                    updateSelectionBtn();
                }, 50);
                return;
            }

            if (target && target.closest && (target.closest('.ant-checkbox') || target.closest('.ant-checkbox-wrapper'))) {
                setTimeout(updateSelectionBtn, 80);
            }
        });

        doc.addEventListener('change', (e) => {
            const target = e.target as HTMLElement;
            if (target && target.matches && (target.matches('.ant-checkbox-input') || target.matches('input[type="checkbox"]'))) {
                setTimeout(updateSelectionBtn, 50);
            }
        });
    } else if (!btnExport.classList.contains('is-loading')) {
        // 动态同步按钮文本
        const sel = getExpenseSelectionInfo(doc);
        const count = sel.isSelectAll ? sel.domItemCount : sel.selectedIds.length;
        const expected = sel.isSelectAll
            ? `<span>📥 导出已选费用 (全部 ${count} 条)</span>`
            : (sel.selectedIds.length > 0 ? `<span>📥 导出已选费用 (已选 ${sel.selectedIds.length} 条)</span>` : `<span>📥 导出费用与发票清单</span>`);
        if (btnExport.innerHTML !== expected) {
            btnExport.innerHTML = expected;
        }
    }
}

/**
 * 为单个 Document 绑定 MutationObserver 自动感知页面渲染与切页
 */
function ensureDocObserver(doc: Document, onChange: () => void) {
    if (!doc || !doc.body || observedDocs.has(doc)) return;
    observedDocs.add(doc);

    try {
        const obs = new MutationObserver(() => {
            onChange();
        });
        obs.observe(doc.body, { childList: true, subtree: true });
    } catch (e) { }
}

/**
 * 启动费用记录页面 DOM 增强服务
 */
export function initExpenseRecordDomService(state: GlobalState) {
    let scanTimeout: any = null;
    const triggerScan = () => {
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
            const currentDocs = getExpenseRecordTargetDocs();
            currentDocs.forEach(doc => {
                ensureDocObserver(doc, triggerScan);
                scanAndEnhanceExpenseRecordDOM(doc);
            });
        }, 150);
    };

    // 立即扫描一次
    const initialDocs = getExpenseRecordTargetDocs();
    initialDocs.forEach(doc => {
        ensureDocObserver(doc, triggerScan);
        scanAndEnhanceExpenseRecordDOM(doc);
    });

    if (isObserverAttached) return;
    isObserverAttached = true;

    // 周期性心跳巡检保活 (2.5 秒)
    setInterval(() => {
        const currentDocs = getExpenseRecordTargetDocs();
        currentDocs.forEach(doc => {
            ensureDocObserver(doc, triggerScan);
            scanAndEnhanceExpenseRecordDOM(doc);
        });
    }, 2500);

    AutopilotLogger.info('✨ [ExpenseRecordDomService] 费用记录清单导出与开票行程核对服务已成功启动！');
}
