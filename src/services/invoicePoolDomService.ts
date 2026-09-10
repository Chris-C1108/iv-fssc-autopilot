import { validateSingleInvoice } from './invoiceValidationService';
import { InvoiceValidationResult, GlobalState, InvoiceItem } from '../types/state';
import { injectStyles, MODAL_STYLES } from '../ui/styles';
import { AutopilotLogger } from '../utils/logger';
import { detectInvoiceCategory, isTollInvoice, bindTollsToTaxiExpenses } from './commuteService';
import { EXPENSE_TYPES } from '../config/constants';
import { normalizeDate } from '../utils/date';
import { batchSaveExpenseItemsApi, getInvoiceDetailByDataIdApi } from './expenseService';
import { fetchLoginUserInfo } from './applicationService';
import { apiRequest } from '../utils/http';
import { mapConcurrent } from '../utils/concurrency';

let cachedGlobalState: GlobalState | null = null;
export function getInvoicePoolGlobalState(): GlobalState {
    if (cachedGlobalState) return cachedGlobalState;
    let st = typeof window !== 'undefined' ? (window as any).__fssc_state : null;
    if (!st) {
        st = {
            pageMode: 'POOL',
            loginToken: '',
            ecsToken: '',
            userOrigin: typeof window !== 'undefined' ? window.location.origin : 'https://ync37.yuanian.com',
            appId: 'e3d5e4787ff911e88b1997bee3518b4d',
            menuId: '11eedb8f8a31cd8f8a25f721e03d0caa',
            eicds: '',
            v: '',
            applicantId: '',
            invoices: [],
            activeGroup: 'TAXI',
            selectedIndices: new Set(),
            currentBillMainId: '',
            currentBillData: null,
            currentBillDefineTemplate: null,
            billRows: [],
            billTags: new Map(),
            activeBillTag: '',
            billSelectedIndices: new Set(),
            projectSearchResults: [],
            selectedAccount: null,
            selectedCostCenter: null,
            selectedProject: null,
            selectedKhfd: null,
            isProcessing: false
        } as GlobalState;
        if (typeof window !== 'undefined') (window as any).__fssc_state = st;
    }
    if (capturedAuthHeaders) {
        if (capturedAuthHeaders['logintoken']) st.loginToken = capturedAuthHeaders['logintoken'];
        if (capturedAuthHeaders['ecstoken']) st.ecsToken = capturedAuthHeaders['ecstoken'];
        if (capturedAuthHeaders['appid']) st.appId = capturedAuthHeaders['appid'];
        if (capturedAuthHeaders['menuid']) st.menuId = capturedAuthHeaders['menuid'];
        if (capturedAuthHeaders['eicds']) st.eicds = capturedAuthHeaders['eicds'];
        if (capturedAuthHeaders['v']) st.v = capturedAuthHeaders['v'];
    }
    return st;
}

interface TableColumnMapping {
    typeIdx: number;
    codeIdx: number;
    noIdx: number;
    dateIdx: number;
    amtIdx: number;
    sellerIdx: number;
    opIdx: number;
}

// 全局发票底层 OCR 详情缓存 (通过 invoiceDataId / invoiceNo 索引)
export const invoiceDetailCache = new Map<string, any>();
// 记录已发起详情请求的发票主键集合 (避免重复发起网络请求)
export const checkedInvoiceDataIds = new Set<string>();

// 全局状态跟踪
let isOnlyFilterIssuesActive = false;
let lastAuditSummary = {
    total: 0,
    invalidCount: 0,
    warningCount: 0,
    missingTimeCount: 0,
    totalTaxiCount: 0,
    verifiedTaxiCount: 0
};

// 针对每个 Document 独立加锁：扫描并更新 DOM 期间拦截 MutationObserver 回调，杜绝循环死锁与跨文档阻塞
const scanningDocs = new WeakSet<Document>();

// 缓存拦截到的安全认证请求头
let capturedAuthHeaders: Record<string, string> | null = null;

/**
 * 钩住宿主窗口的 XHR 与 fetch，自动捕获已请求的发票详情并录入缓存
 */
export function hookInvoiceDetailNetwork(win: Window) {
    if (!win || (win as any).__yn_invoice_hook_installed) return;
    (win as any).__yn_invoice_hook_installed = true;

    try {
        const winAny = win as any;
        if (!winAny.XMLHttpRequest) return;
        const origOpen = winAny.XMLHttpRequest.prototype.open;
        const origSetHeader = winAny.XMLHttpRequest.prototype.setRequestHeader;

        winAny.XMLHttpRequest.prototype.setRequestHeader = function (header: string, value: string) {
            if (!capturedAuthHeaders) capturedAuthHeaders = {};
            const lower = (header || '').toLowerCase();
            if (['logintoken', 'ecstoken', 'token', 'appid', 'menuid', 'userorigin', 'eicds', 'v'].includes(lower) || lower.includes('token')) {
                capturedAuthHeaders[header] = value;
                capturedAuthHeaders[lower] = value;
            }
            return origSetHeader.apply(this, arguments as any);
        };

        winAny.XMLHttpRequest.prototype.open = function (method: string, url: string | URL) {
            const urlStr = typeof url === 'string' ? url : url.toString();
            if (urlStr.includes('getBoDataAndTemplateWF') || urlStr.includes('getInvoiceByDataId')) {
                this.addEventListener('load', () => {
                    try {
                        const json = JSON.parse(this.responseText);
                        if (json && json.data) {
                            if (json.data.boData?.area?.rowDatas?.[0]?.datas) {
                                const row = json.data.boData.area.rowDatas[0].datas;
                                const boId = json.data.boDataId || json.data.boMainId;
                                const detail = {
                                    id: boId,
                                    invoiceNo: row.INVOICE_NO?.value || '',
                                    invoiceCode: row.INVOICE_CODE?.value || '',
                                    invoiceDate: row.INVOICE_DATE?.value || '',
                                    timeGetOn: row.TIME_GETON?.value || '',
                                    timeGetOff: row.TIME_GETOFF?.value || '',
                                    mileage: row.MILEAGE?.value || '',
                                    amount: (row.AMOUNT_TAX?.value && row.AMOUNT_TAX?.value.amount !== undefined)
                                        ? row.AMOUNT_TAX?.value.amount
                                        : (row.AMOUNT_TAX?.value || 0),
                                    place: row.PLACE?.value || '',
                                    serialNumber: row.SERIALNUMBER?.value || ''
                                };
                                if (boId) invoiceDetailCache.set(boId, detail);
                                if (detail.invoiceNo) invoiceDetailCache.set(detail.invoiceNo, detail);
                            } else if (json.data.invoiceDataId || json.data.invoiceNo) {
                                const inv = json.data;
                                if (inv.invoiceDataId) invoiceDetailCache.set(inv.invoiceDataId, inv);
                                if (inv.invoiceNo) invoiceDetailCache.set(inv.invoiceNo, inv);
                            }
                            // 异步触发一次安静的扫描刷新
                            const docs = getInvoicePoolTargetDocs();
                            docs.forEach(d => scanAndEnhanceInvoicePoolDOM(d));
                        }
                    } catch (e) { }
                });
            }
            return origOpen.apply(this, arguments as any);
        };
    } catch (e) { }
}

/**
 * 判断指定文档是否为发票夹目标文档
 */
function isInvoicePoolDoc(d: Document | null | undefined, urlStr: string = ''): boolean {
    if (!d || !d.body) return false;
    if (
        urlStr.includes('businessapplication') ||
        urlStr.includes('11ec6dd3fd5cb161bff83bb033997150') ||
        urlStr.includes('5f0971df7a4411e9b0edd9fcadd69462')
    ) {
        return true;
    }
    const thead = d.querySelector('.ant-table-thead');
    if (thead) {
        const ths = Array.from(thead.querySelectorAll('th')).map(th => (th as HTMLElement).innerText || '');
        if (ths.some(t => t.includes('发票类型') || t.includes('发票号码') || t.includes('发票代码'))) {
            return true;
        }
    }
    return false;
}

/**
 * 获取可操作的发票夹 DOM 文档列表 (支持直接在发票夹 iframe 内部或顶级控制台向下穿透)
 */
export function getInvoicePoolTargetDocs(): Document[] {
    const docs: Document[] = [];
    if (typeof document === 'undefined') return docs;

    // 1. 当前窗口 document (如果当前就是发票夹页面)
    if (isInvoicePoolDoc(document, typeof window !== 'undefined' ? window.location.href : '')) {
        docs.push(document);
    }

    // 2. 顶级窗口向下穿透同源 iframe
    try {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        iframes.forEach(f => {
            try {
                const fDoc = f.contentDocument || f.contentWindow?.document;
                if (fDoc && isInvoicePoolDoc(fDoc, f.src || f.contentWindow?.location?.href || '')) {
                    docs.push(fDoc);
                }
            } catch (e) { }
        });
    } catch (e) { }

    return docs;
}

/**
 * 从表格 TR 元素上快速提取 React 挂载的底层数据主键 (boDataId / ID)
 */
export function getRowDataId(tr: HTMLTableRowElement): string | null {
    if (!tr) return null;
    const reactKey = Object.keys(tr).find(k => k.startsWith('__react'));
    if (!reactKey) return null;
    let curr = (tr as any)[reactKey];
    while (curr) {
        const rec = curr.memoizedProps?.record || curr.memoizedProps?.data;
        if (rec) {
            return rec.ID?.value || rec.BO_DATA_ID?.value || (typeof rec.boSourceRowId === 'object' ? rec.boSourceRowId?.value : rec.boSourceRowId) || null;
        }
        curr = curr.return;
    }
    return null;
}

/**
 * 从表格 TR 元素上提取 React 挂载的完整底层 record 数据对象
 */
export function getRowRecord(tr: HTMLTableRowElement): any | null {
    if (!tr) return null;
    const reactKey = Object.keys(tr).find(k => k.startsWith('__react'));
    if (!reactKey) return null;
    let curr = (tr as any)[reactKey];
    while (curr) {
        const rec = curr.memoizedProps?.record || curr.memoizedProps?.data;
        if (rec) return rec;
        curr = curr.return;
    }
    return null;
}

/**
 * 辅助从 record 对象或其动态列属性中安全取值
 */
function getRecordColumnValue(rec: any, code: string): any {
    if (!rec || typeof rec !== 'object') return undefined;
    if (rec[code]?.value !== undefined) return rec[code].value;
    for (const key of Object.keys(rec)) {
        const item = rec[key];
        if (item && typeof item === 'object' && item.columnCode === code) {
            return item.value;
        }
    }
    return undefined;
}

/**
 * 检测发票表格中当前被用户勾选选中的行索引列表
 */
export function getTableSelectedRowIndices(doc: Document): number[] {
    const indices: number[] = [];
    const scrollBody = doc.querySelector('.ant-table-scroll .ant-table-body') ||
        doc.querySelector('.ant-table-body') ||
        doc.querySelector('.ant-table-tbody');
    if (!scrollBody) return indices;

    const rows = Array.from(scrollBody.querySelectorAll('tbody tr')).filter(r => r.querySelectorAll('td').length > 4) as HTMLTableRowElement[];
    if (rows.length === 0) return indices;

    const fixedLeftBody = doc.querySelector('.ant-table-fixed-left .ant-table-body-inner') || doc.querySelector('.ant-table-fixed-left');
    const fixedLeftRows = fixedLeftBody
        ? Array.from(fixedLeftBody.querySelectorAll('tbody tr')).filter(r => r.querySelectorAll('td').length > 0) as HTMLTableRowElement[]
        : [];

    // 穿透 Ant Table React Fiber 的 memoizedProps.rowSelection.selectedRowKeys (如有)
    const selectedKeys = new Set<string>();
    try {
        const tableEl = doc.querySelector('.ant-table');
        if (tableEl) {
            const rk = Object.keys(tableEl).find(k => k.startsWith('__react'));
            if (rk) {
                let f = (tableEl as any)[rk];
                while (f) {
                    const rSel = f.memoizedProps?.rowSelection;
                    if (rSel && Array.isArray(rSel.selectedRowKeys)) {
                        rSel.selectedRowKeys.forEach((k: any) => selectedKeys.add(String(k)));
                        break;
                    }
                    if (f.memoizedState?.selectedRowKeys && Array.isArray(f.memoizedState.selectedRowKeys)) {
                        f.memoizedState.selectedRowKeys.forEach((k: any) => selectedKeys.add(String(k)));
                        break;
                    }
                    f = f.return;
                }
            }
        }
    } catch (e) { }

    rows.forEach((tr, idx) => {
        const fixedLeftTr = fixedLeftRows[idx];
        const isChecked = Boolean(
            fixedLeftTr?.querySelector('.ant-checkbox-checked, input[type="checkbox"]:checked') ||
            tr.querySelector('.ant-checkbox-checked, input[type="checkbox"]:checked') ||
            fixedLeftTr?.classList.contains('ant-table-row-selected') ||
            tr.classList.contains('ant-table-row-selected')
        );

        const dataId = getRowDataId(tr) || (fixedLeftTr ? getRowDataId(fixedLeftTr) : null);
        if (isChecked || (dataId && selectedKeys.has(String(dataId)))) {
            indices.push(idx);
        }
    });

    return indices;
}

/**
 * 从发票表格中提取当前勾选选中的发票项列表，并智能并发补全 OCR 详情
 */
export async function getSelectedInvoicesFromTable(doc: Document, state: GlobalState): Promise<InvoiceItem[]> {
    const scrollBody = doc.querySelector('.ant-table-scroll .ant-table-body') ||
        doc.querySelector('.ant-table-body') ||
        doc.querySelector('.ant-table-tbody');
    if (!scrollBody) return [];

    const table = doc.querySelector('.ant-table') as HTMLElement;
    if (!table) return [];

    const mapping = parseTableColumnMapping(table);
    if (!mapping) return [];

    const rows = Array.from(scrollBody.querySelectorAll('tbody tr')).filter(r => r.querySelectorAll('td').length > 4) as HTMLTableRowElement[];
    const fixedLeftBody = doc.querySelector('.ant-table-fixed-left .ant-table-body-inner') || doc.querySelector('.ant-table-fixed-left');
    const fixedLeftRows = fixedLeftBody
        ? Array.from(fixedLeftBody.querySelectorAll('tbody tr')).filter(r => r.querySelectorAll('td').length > 0) as HTMLTableRowElement[]
        : [];

    const selectedIndices = getTableSelectedRowIndices(doc);
    if (selectedIndices.length === 0) return [];

    const selectedItems: InvoiceItem[] = [];

    for (const idx of selectedIndices) {
        const tr = rows[idx];
        const fixedLeftTr = fixedLeftRows[idx];
        if (!tr) continue;

        const rec = getRowRecord(tr) || (fixedLeftTr ? getRowRecord(fixedLeftTr) : null);

        const cells = Array.from(tr.querySelectorAll('td'));
        let invType = mapping.typeIdx >= 0 ? getCellOriginalText(cells[mapping.typeIdx]) : '';
        let invCode = mapping.codeIdx >= 0 ? getCellOriginalText(cells[mapping.codeIdx]) : '';
        let invNo = mapping.noIdx >= 0 ? getCellOriginalText(cells[mapping.noIdx]) : '';
        let invDate = mapping.dateIdx >= 0 ? getCellOriginalText(cells[mapping.dateIdx]) : '';
        const rawAmt = mapping.amtIdx >= 0 ? getCellOriginalText(cells[mapping.amtIdx]) : '';
        let amt = parseFloat(rawAmt.replace(/[^0-9.]/g, '')) || 0;
        let seller = mapping.sellerIdx >= 0 ? getCellOriginalText(cells[mapping.sellerIdx]) : '';

        const dataId = getRowDataId(tr) || (fixedLeftTr ? getRowDataId(fixedLeftTr) : null) || '';

        // 若 Fiber record 中有更准确的数据，做智能补足
        if (rec) {
            if (!invNo) invNo = getRecordColumnValue(rec, 'INVOICE_NO') || '';
            if (!invCode) invCode = getRecordColumnValue(rec, 'INVOICE_CODE') || '';
            if (!invDate) invDate = getRecordColumnValue(rec, 'INVOICE_DATE') || '';
            if (!amt) {
                const taxVal = getRecordColumnValue(rec, 'AMOUNT_TAX');
                amt = typeof taxVal === 'object' ? (taxVal?.amount ?? 0) : (Number(taxVal) || 0);
            }
            if (!seller) {
                const sVal = getRecordColumnValue(rec, 'SALES_NAME');
                seller = typeof sVal === 'string' ? sVal : (sVal?.title?.zh_CN || '');
            }
            if (!invType) {
                invType = rec.BO_TYPE_DEFINE_ID?.value?.onlyTitle?.zh_CN || rec.BO_TYPE_DEFINE_ID?.value?.title?.zh_CN || '';
            }
        }

        const cached = (dataId && invoiceDetailCache.get(dataId)) || (invNo && invoiceDetailCache.get(invNo)) || null;
        const normDate = normalizeDate(invDate || cached?.invoiceDate || '');

        const invoiceVO: any = {
            invoiceDataId: dataId,
            invoiceNo: invNo || cached?.invoiceNo || '',
            invoiceCode: invCode || cached?.invoiceCode || '',
            invoiceDate: normDate,
            amountTax: amt || cached?.amount || 0,
            salesName: seller || cached?.salesName || '',
            seller: seller || cached?.salesName || '',
            invoiceTypeAbbreviation: cached?.invoiceTypeAbbreviation || invType,
            commodityNames: cached?.commodityNames || cached?.goodsName || invType,
            invoiceDetails: cached?.invoiceDetails || '',
            timeGetOn: cached?.timeGetOn || '',
            timeGetOff: cached?.timeGetOff || '',
            mileage: cached?.mileage || '',
            fileName: `${normDate}_${invType || '发票'}_¥${amt}`
        };

        const item: InvoiceItem = {
            id: dataId || `inv-${Date.now()}-${idx}`,
            boDataId: dataId,
            version: 1,
            invoiceVO,
            invoiceNo: invoiceVO.invoiceNo,
            invoiceCode: invoiceVO.invoiceCode,
            invoiceDate: normDate,
            amount: amt || invoiceVO.amountTax || 0,
            type: (detectInvoiceCategory(invoiceVO, {}, invType) || 'TAXI') as any,
            typeName: invType,
            salesName: seller || invoiceVO.salesName,
            timeGetOn: invoiceVO.timeGetOn,
            timeGetOff: invoiceVO.timeGetOff,
            mileage: invoiceVO.mileage ? `${invoiceVO.mileage}km` : '',
            status: '待流转',
            isModified: false
        };

        selectedItems.push(item);
    }

    // 重点对出租车和通行费发票进行详情预取，确保 timeGetOn / timeGetOff / commodityNames 100% 具备
    const missingDetailItems = selectedItems.filter(item => {
        const text = `${item.typeName || ''} ${item.invoiceVO?.commodityNames || ''} ${item.salesName || ''}`;
        const isTaxiOrToll = text.includes('出租车') || text.includes('打车') || text.includes('网约') || isTollInvoice(item);
        return isTaxiOrToll && item.boDataId && !item.invoiceVO?.timeGetOn;
    });

    if (missingDetailItems.length > 0) {
        await Promise.all(
            missingDetailItems.map(async (item) => {
                if (!item.boDataId) return;
                try {
                    const detail = await getInvoiceDetailByDataIdApi(item.boDataId, state);
                    if (detail) {
                        invoiceDetailCache.set(item.boDataId, detail);
                        if (detail.invoiceNo) invoiceDetailCache.set(detail.invoiceNo, detail);
                        if (detail.timeGetOn) {
                            item.timeGetOn = detail.timeGetOn;
                            item.invoiceVO.timeGetOn = detail.timeGetOn;
                        }
                        if (detail.timeGetOff) {
                            item.timeGetOff = detail.timeGetOff;
                            item.invoiceVO.timeGetOff = detail.timeGetOff;
                        }
                        if (detail.mileage) {
                            item.mileage = `${detail.mileage}km`;
                            item.invoiceVO.mileage = detail.mileage;
                        }
                        if (detail.commodityNames) {
                            item.invoiceVO.commodityNames = detail.commodityNames;
                        }
                        if (detail.salesName && !item.salesName) {
                            item.salesName = detail.salesName;
                            item.invoiceVO.salesName = detail.salesName;
                        }
                    }
                } catch (e) {
                    AutopilotLogger.warn(`[InvoicePool] 预取选中发票详情失败 (${item.boDataId}): ${e}`);
                }
            })
        );
    }

    return selectedItems;
}

/**
 * 从宿主窗口中提取 YuanNian 原生 HTTP 客户端（基于 webpackJsonp 封装的 axios 实例）
 */
let cachedNativeHttp: any = null;
export function getNativeHttp(win?: Window | null): any {
    if (cachedNativeHttp) return cachedNativeHttp;
    const targetWin = win || (typeof window !== 'undefined' ? window : null);
    if (!targetWin) return null;
    if ((targetWin as any).__nativeHttp) {
        cachedNativeHttp = (targetWin as any).__nativeHttp;
        return cachedNativeHttp;
    }
    try {
        const wp = (targetWin as any).webpackJsonp;
        if (wp && Array.isArray(wp)) {
            wp.push([
                ['__native_http_extractor__'],
                {
                    '__native_http_extractor__': function (module: any, exports: any, __webpack_require__: any) {
                        if (__webpack_require__ && __webpack_require__.c) {
                            for (const id in __webpack_require__.c) {
                                const m = __webpack_require__.c[id]?.exports;
                                if (m && (m.default?.post && m.default?.getHt)) {
                                    cachedNativeHttp = m.default;
                                    (targetWin as any).__nativeHttp = cachedNativeHttp;
                                    break;
                                }
                            }
                        }
                    }
                },
                [['__native_http_extractor__']]
            ]);
        }
    } catch (e) { }
    return cachedNativeHttp;
}

/**
 * 原生发票批量校验与换取费用草稿 VO (POST /standbyInvoiceController/batchExpenseCheck)
 */
export async function batchExpenseCheckApi(
    invoiceMainIds: string[],
    win: Window,
    state: GlobalState
): Promise<{ success: boolean; data?: { expenseRecordDataVOList: any[]; standByInvoiceCheckVOList: any[] }; message?: string }> {
    const native = getNativeHttp(win);
    if (native && typeof native.post === 'function') {
        return new Promise((resolve) => {
            native.post('/standbyInvoiceController/batchExpenseCheck', {
                source: 'pc',
                invoiceMainIds: invoiceMainIds
            }, (res: any) => resolve(res || { success: false, message: '无响应' }));
        });
    }
    return apiRequest('/fssc/standbyInvoiceController/batchExpenseCheck', 'POST', {
        source: 'pc',
        invoiceMainIds: invoiceMainIds
    }, state);
}

/**
 * 原生初始化并保存费用记录草稿 (POST /expenseClaim/expenseRecord/initAndSaveExpenseRecordData)
 */
export async function initAndSaveExpenseRecordDataApi(
    expenseRecordDataVO: any,
    win: Window,
    state: GlobalState
): Promise<{ success: boolean; data?: any; message?: string }> {
    const native = getNativeHttp(win);
    if (native && typeof native.post === 'function') {
        return new Promise((resolve) => {
            native.post('/expenseClaim/expenseRecord/initAndSaveExpenseRecordData', expenseRecordDataVO, (res: any) => {
                resolve(res || { success: false, message: '无响应' });
            });
        });
    }
    return apiRequest('/fssc/expenseClaim/expenseRecord/initAndSaveExpenseRecordData', 'POST', expenseRecordDataVO, state);
}

/**
 * 核心执行流程：发票夹勾选发票 -> 两批次处理（批次1：同期过路费与出租车合并；批次2：其余单发票平台默认逐条生成）
 */
export async function handleGenerateExpensesFromSelected(
    doc: Document,
    state: GlobalState,
    btn: HTMLButtonElement
) {
    const selectedIndices = getTableSelectedRowIndices(doc);
    if (selectedIndices.length === 0) {
        alert('⚠️ 请先在发票列表中勾选需要生成费用记录的发票！');
        return;
    }

    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    if (!win) {
        alert('⚠️ 无法获取当前窗口上下文，请刷新页面后重试。');
        return;
    }

    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.innerText = `⏳ 正在读取发票详情 (${selectedIndices.length}张)...`;

    try {
        try {
            await fetchLoginUserInfo(state);
        } catch (e) { }

        const selectedInvoices = await getSelectedInvoicesFromTable(doc, state);
        if (selectedInvoices.length === 0) {
            alert('⚠️ 未能提取到选中发票数据，请刷新页面后重试。');
            return;
        }

        // 提取待转换发票主键集合
        const invoiceMainIds = selectedInvoices
            .map(it => it.boDataId || it.id)
            .filter(Boolean);

        btn.innerText = `⏳ 正在请求平台发票校验与转换...`;
        const checkRes = await batchExpenseCheckApi(invoiceMainIds, win, state);
        if (!checkRes || !checkRes.success) {
            throw new Error(checkRes?.message || '调用平台发票校验接口失败');
        }

        const validVOList = checkRes.data?.expenseRecordDataVOList || [];
        const alreadyLinkedVOList = checkRes.data?.standByInvoiceCheckVOList || [];

        if (validVOList.length === 0) {
            let warnMsg = '⚠️ 所选发票均不可生成费用记录';
            if (alreadyLinkedVOList.length > 0) {
                warnMsg += `（${alreadyLinkedVOList.length} 张发票已在费用记录中关联，不可重复生成）`;
            }
            alert(warnMsg);
            return;
        }

        // 建立 invoiceMainId -> expenseRecordDataVO 快速映射
        const voByInvoiceId = new Map<string, any>();
        validVOList.forEach(vo => {
            const invVO = vo.expenseRecordInvoiceVOList?.[0]?.invoiceVO;
            const invId = invVO?.invoiceMainId || invVO?.invoiceDataId;
            if (invId) voByInvoiceId.set(String(invId), vo);
        });

        // 智能识别同期过路费与出租车发票 (严格判定日期与时间窗口)
        const validInvoices = selectedInvoices.filter(it => voByInvoiceId.has(String(it.boDataId || it.id)));
        const { mergedItems, boundTollsCount } = bindTollsToTaxiExpenses(validInvoices);

        // 分批编排 (Two-Batch Partitioning)
        // 批次 1: 合并组 (同日同期出租车 + 过路费合并生成单笔费用)
        const batch1MergedVOs: any[] = [];
        const handledInvoiceIds = new Set<string>();

        mergedItems.forEach(item => {
            if (item.subInvoices && item.subInvoices.length > 0) {
                const taxiId = String(item.boDataId || item.id);
                const taxiVO = voByInvoiceId.get(taxiId);
                if (taxiVO) {
                    const tollVOs = item.subInvoices
                        .map(sub => voByInvoiceId.get(String(sub.boDataId || sub.id)))
                        .filter(Boolean);

                    const mergedVO = {
                        accountCurrencyId: taxiVO.accountCurrencyId,
                        applicantId: taxiVO.applicantId,
                        executeType: 'OPERATING_INVOICE',
                        expenseTypeId: taxiVO.expenseTypeId || 'UNIDENTIFIED',
                        invoiceGeneration: true,
                        triggerTiming: 'ADD_ROW',
                        expenseRecordInvoiceVOList: [
                            { invoiceVO: taxiVO.expenseRecordInvoiceVOList[0].invoiceVO, position: 1 },
                            ...tollVOs.map((tVO, idx) => ({
                                invoiceVO: tVO.expenseRecordInvoiceVOList[0].invoiceVO,
                                position: idx + 2
                            }))
                        ]
                    };

                    batch1MergedVOs.push(mergedVO);
                    handledInvoiceIds.add(taxiId);
                    item.subInvoices.forEach(sub => handledInvoiceIds.add(String(sub.boDataId || sub.id)));
                }
            }
        });

        // 批次 2: 逐条组 (其余未被合并的发票，逐条使用平台默认接口生成费用)
        const batch2SingleVOs: any[] = [];
        validVOList.forEach(vo => {
            const invId = String(vo.expenseRecordInvoiceVOList?.[0]?.invoiceVO?.invoiceMainId || vo.expenseRecordInvoiceVOList?.[0]?.invoiceVO?.invoiceDataId || '');
            if (invId && !handledInvoiceIds.has(invId)) {
                batch2SingleVOs.push(vo);
            }
        });

        const totalToSave = batch1MergedVOs.length + batch2SingleVOs.length;
        let confirmMsg = `确定将发票夹选中的 ${validInvoices.length} 张可用发票分批生成 ${totalToSave} 笔费用记录草稿？`;
        if (boundTollsCount > 0) {
            confirmMsg += `\n\n🛣️ 批次一（智能同期合并）：发现 ${boundTollsCount} 张同期过路费发票，已自动与同程出租车合并为 ${batch1MergedVOs.length} 笔费用（1笔费用挂载2张发票，金额自动累加）。`;
        }
        if (batch2SingleVOs.length > 0) {
            confirmMsg += `\n\n⚡ 批次二（平台默认逐条）：其余 ${batch2SingleVOs.length} 张发票将逐条生成单笔费用记录。`;
        }
        if (alreadyLinkedVOList.length > 0) {
            confirmMsg += `\n\n⚠️ 注：另有 ${alreadyLinkedVOList.length} 张发票已在费用记录中关联，已自动跳过。`;
        }

        if (!confirm(confirmMsg)) {
            return;
        }

        let batch1Success = 0;
        let batch1Fail = 0;
        let batch2Success = 0;
        let batch2Fail = 0;

        // 执行批次 1：合并组生成
        if (batch1MergedVOs.length > 0) {
            for (let i = 0; i < batch1MergedVOs.length; i++) {
                btn.innerText = `⏳ 正在合并生成费用 (${i + 1}/${batch1MergedVOs.length})...`;
                try {
                    const saveRes = await initAndSaveExpenseRecordDataApi(batch1MergedVOs[i], win, state);
                    if (saveRes && saveRes.success) {
                        batch1Success++;
                    } else {
                        batch1Fail++;
                        AutopilotLogger.warn(`[InvoicePool] 合并费用生成失败: ${saveRes?.message}`);
                    }
                } catch (e: any) {
                    batch1Fail++;
                    AutopilotLogger.warn(`[InvoicePool] 合并费用保存异常: ${e.message}`);
                }
            }
        }

        // 执行批次 2：逐条组并发生成
        if (batch2SingleVOs.length > 0) {
            let completedCount = 0;
            btn.innerText = `⏳ 正在逐条生成费用 (0/${batch2SingleVOs.length})...`;

            await mapConcurrent(batch2SingleVOs, 4, async (vo) => {
                try {
                    const saveRes = await initAndSaveExpenseRecordDataApi(vo, win, state);
                    if (saveRes && saveRes.success) {
                        batch2Success++;
                    } else {
                        batch2Fail++;
                        AutopilotLogger.warn(`[InvoicePool] 逐条费用生成失败: ${saveRes?.message}`);
                    }
                } catch (e: any) {
                    batch2Fail++;
                    AutopilotLogger.warn(`[InvoicePool] 逐条费用保存异常: ${e.message}`);
                } finally {
                    completedCount++;
                    btn.innerText = `⏳ 正在逐条生成费用 (${completedCount}/${batch2SingleVOs.length})...`;
                }
            });
        }

        // 统计反馈
        const totalSuccess = batch1Success + batch2Success;
        const totalFail = batch1Fail + batch2Fail;

        let resultMsg = `✅ 费用记录生成完成！\n\n`;
        if (batch1Success > 0) {
            resultMsg += `• 同期合并生成: ${batch1Success} 笔（已合并 ${boundTollsCount} 张过路费发票）\n`;
        }
        if (batch2Success > 0) {
            resultMsg += `• 平台默认逐条生成: ${batch2Success} 笔单张发票费用\n`;
        }
        resultMsg += `• 累计成功入库: ${totalSuccess} 笔费用记录草稿\n`;
        if (totalFail > 0) {
            resultMsg += `• 失败: ${totalFail} 笔（详情见控制台日志）\n`;
        }
        if (alreadyLinkedVOList.length > 0) {
            resultMsg += `• 跳过已关联发票: ${alreadyLinkedVOList.length} 张\n`;
        }
        resultMsg += `\n可在【费用记录】页面一键查看并批量完善明细。\n点击【确定】刷新当前发票列表。`;
        alert(resultMsg);

        const paginationFiber = getTablePaginationFiber(doc);
        if (paginationFiber && typeof paginationFiber.memoizedProps?.onShowSizeChange === 'function') {
            const current = paginationFiber.memoizedProps.current || 1;
            const currentSize = paginationFiber.memoizedProps.pageSize || 100;
            paginationFiber.memoizedProps.onShowSizeChange(current, currentSize);
        } else {
            window.location.reload();
        }
    } catch (err: any) {
        AutopilotLogger.error(`[InvoicePool] 生成费用记录异常: ${err.message}`);
        alert(`❌ 生成费用记录失败: ${err.message || '未知异常'}`);
    } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        const selCount = getTableSelectedRowIndices(doc).length;
        btn.innerText = selCount > 0 ? `⚡ 生成费用记录 (已选 ${selCount} 条)` : `⚡ 生成费用记录`;
    }
}

/**
 * 解析发票表格的表头列映射
 */
function parseTableColumnMapping(tableEl: HTMLElement): TableColumnMapping | null {
    const thead = tableEl.querySelector('.ant-table-thead');
    if (!thead) return null;

    const ths = Array.from(thead.querySelectorAll('th')).map(th => th.innerText.trim());
    if (ths.length === 0) return null;

    let typeIdx = ths.findIndex(t => t.includes('发票类型'));
    let codeIdx = ths.findIndex(t => t.includes('发票代码'));
    let noIdx = ths.findIndex(t => t.includes('发票号码'));
    let dateIdx = ths.findIndex(t => t.includes('开票日期'));
    let amtIdx = ths.findIndex(t => t.includes('价税金额'));
    if (amtIdx === -1) amtIdx = ths.findIndex(t => t.includes('金额') && !t.includes('不含税'));
    let sellerIdx = ths.findIndex(t => t.includes('销方名称'));
    let opIdx = ths.findIndex(t => t.includes('操作'));

    // 兜底：如果操作列未按文字匹配上，通常为最后一列
    if (opIdx === -1 && ths.length > 5) opIdx = ths.length - 1;

    // 核心硬规则：必须至少匹配到发票类型或发票号码或发票代码，否则坚决拒绝识别为发票表格！
    if (typeIdx === -1 && codeIdx === -1 && noIdx === -1) {
        return null;
    }

    return { typeIdx, codeIdx, noIdx, dateIdx, amtIdx, sellerIdx, opIdx };
}

/**
 * 辅助函数：安全提取单元格纯净原生文本（彻底隔离并剔除插件注入的徽标文本）
 */
function getCellOriginalText(cell: HTMLElement | undefined): string {
    if (!cell) return '';
    const contentSpan = cell.querySelector('.platform-businessobject-businessapplication-index__bo_table_tr_span--iWL52nmG') as HTMLElement;
    if (contentSpan) return contentSpan.innerText.trim();

    const clone = cell.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.yn-invoice-badge, [data-yn-badge]').forEach(el => el.remove());
    return clone.innerText.trim();
}

/**
 * 辅助函数：幂等设置单元格内的警示徽标（已存在相同徽标时不增删 DOM）
 */
function ensureBadge(cell: HTMLElement | undefined, fieldKey: string, text: string, title: string, severity: 'error' | 'warning' | 'info' = 'error') {
    if (!cell) return;
    const existing = cell.querySelector(`[data-yn-badge="${fieldKey}"]`) as HTMLElement;
    if (existing) {
        if (existing.innerText !== text) existing.innerText = text;
        if (existing.title !== title) existing.title = title;
        return;
    }
    const badge = cell.ownerDocument.createElement('span');
    badge.className = `yn-invoice-badge ${severity === 'error' ? 'yn-badge-error' : 'yn-badge-warning'}`;
    badge.setAttribute('data-yn-badge', fieldKey);
    badge.title = title;
    badge.innerText = text;
    cell.appendChild(badge);
}

/**
 * 辅助函数：移除指定字段的警示徽标
 */
function removeBadge(cell: HTMLElement | undefined, fieldKey: string) {
    if (!cell) return;
    const existing = cell.querySelector(`[data-yn-badge="${fieldKey}"]`);
    if (existing) existing.remove();
}

/**
 * 针对单行表格执行发票数据提取、深度详情校验并注入视觉标记与徽标
 * 同步主表、固定左侧表、固定右侧表，实现零重排、零换行与像素级行高对齐
 */
function processTableRow(
    tr: HTMLTableRowElement,
    mapping: TableColumnMapping,
    fixedRightTr?: HTMLTableRowElement,
    fixedLeftTr?: HTMLTableRowElement
): InvoiceValidationResult | null {
    const cells = Array.from(tr.querySelectorAll('td'));
    if (cells.length < 5) return null;

    const invType = mapping.typeIdx >= 0 ? getCellOriginalText(cells[mapping.typeIdx]) : '';
    const invCode = mapping.codeIdx >= 0 ? getCellOriginalText(cells[mapping.codeIdx]) : '';
    const invNo = mapping.noIdx >= 0 ? getCellOriginalText(cells[mapping.noIdx]) : '';
    const invDate = mapping.dateIdx >= 0 ? getCellOriginalText(cells[mapping.dateIdx]) : '';
    const rawAmt = mapping.amtIdx >= 0 ? getCellOriginalText(cells[mapping.amtIdx]) : '';
    const amt = parseFloat(rawAmt.replace(/[^0-9.]/g, '')) || 0;
    const seller = mapping.sellerIdx >= 0 ? getCellOriginalText(cells[mapping.sellerIdx]) : '';

    // 尝试穿透发票详情缓存读取乘车时间与里程
    const dataId = getRowDataId(tr);
    const detail = (dataId && invoiceDetailCache.get(dataId)) || (invNo && invoiceDetailCache.get(invNo)) || null;
    const detailChecked = Boolean(detail) || (dataId ? checkedInvoiceDataIds.has(dataId) : false);

    const mockInvoiceItem = {
        invoiceNo: invNo,
        invoiceCode: invCode,
        invoiceDate: invDate,
        amount: amt,
        typeName: invType,
        sellerName: seller,
        timeGetOn: detail ? (detail.timeGetOn || '') : '',
        timeGetOff: detail ? (detail.timeGetOff || '') : '',
        mileage: detail ? (detail.mileage ? String(detail.mileage) : '') : '',
        detailChecked
    };

    const res = validateSingleInvoice(mockInvoiceItem);

    // 查找操作列修改按钮 (主表及固定右列表格)
    const opCell = mapping.opIdx >= 0 && mapping.opIdx < cells.length ? cells[mapping.opIdx] : cells[cells.length - 1];
    const modifyLink = opCell ? Array.from(opCell.querySelectorAll('a')).find(a => a.innerText.trim() === '修改') : null;
    const fixedModifyLink = fixedRightTr ? Array.from(fixedRightTr.querySelectorAll('a')).find(a => a.innerText.trim() === '修改') : null;

    const typeCell = mapping.typeIdx >= 0 ? cells[mapping.typeIdx] : undefined;
    const amtCell = mapping.amtIdx >= 0 ? cells[mapping.amtIdx] : undefined;
    const dateCell = mapping.dateIdx >= 0 ? cells[mapping.dateIdx] : undefined;
    const noCell = mapping.noIdx >= 0 ? cells[mapping.noIdx] : undefined;

    const allTrs = [tr, fixedRightTr, fixedLeftTr].filter(Boolean) as HTMLTableRowElement[];

    const timeIssue = res.issues.find(i => i.field === 'time');
    const dateIssue = res.issues.find(i => i.field === 'date');
    const amtIssue = res.issues.find(i => i.field === 'amount');
    const noIssue = res.issues.find(i => i.field === 'invoiceNo');

    if (!res.isValid) {
        // 🔴 阻断性残缺行高亮 (主表、固定左列、固定右列表格三表像素级同步)
        allTrs.forEach(t => {
            if (!t.classList.contains('yn-invoice-row-error')) {
                t.classList.remove('yn-invoice-row-warning');
                t.classList.add('yn-invoice-row-error');
            }
        });

        // 1. 金额列徽标
        if (amtIssue) {
            ensureBadge(amtCell, 'amount', `⚠️ ${amtIssue.shortBadge}`, amtIssue.message, amtIssue.severity);
        } else {
            removeBadge(amtCell, 'amount');
        }

        // 2. 日期列徽标 (无论整行其他字段是否有错误，日期异常均必须高亮提示，绝不吞没)
        if (dateIssue) {
            ensureBadge(dateCell, 'date', `⚠️ ${dateIssue.shortBadge}`, dateIssue.message, dateIssue.severity);
        } else {
            removeBadge(dateCell, 'date');
        }

        // 3. 发票号码列徽标
        if (noIssue) {
            ensureBadge(noCell, 'invoiceNo', `⚠️ ${noIssue.shortBadge}`, noIssue.message, noIssue.severity);
        } else {
            removeBadge(noCell, 'invoiceNo');
        }

        // 4. 出租车乘车时间徽标 (接口核实后若缺失则显示)
        if (timeIssue) {
            ensureBadge(typeCell, 'taxiTime', `⚠️ ${timeIssue.shortBadge}`, timeIssue.message, timeIssue.severity);
        } else {
            removeBadge(typeCell, 'taxiTime');
        }

        // 5. 操作列高亮强化【修改】链接 (阻断级必改：红字加粗下划线)
        if (fixedModifyLink) {
            fixedModifyLink.classList.remove('yn-btn-modify-warning');
            if (!fixedModifyLink.classList.contains('yn-btn-modify-error')) {
                fixedModifyLink.classList.add('yn-btn-modify-error');
            }
            fixedModifyLink.title = `该发票缺少必要字段: ${res.missingFieldsDesc}，点击修改补齐`;
        }
        if (modifyLink) {
            modifyLink.classList.remove('yn-btn-modify-warning');
            if (!modifyLink.classList.contains('yn-btn-modify-error')) {
                modifyLink.classList.add('yn-btn-modify-error');
            }
            modifyLink.title = `该发票缺少必要字段: ${res.missingFieldsDesc}，点击修改补齐`;
        }
    } else if (res.hasWarnings) {
        // 🟡 警示性提示 (例如出租车发票详情中缺失乘车时间，或年份超期)
        allTrs.forEach(t => {
            if (!t.classList.contains('yn-invoice-row-warning')) {
                t.classList.remove('yn-invoice-row-error');
                t.classList.add('yn-invoice-row-warning');
            }
        });

        if (amtIssue) {
            ensureBadge(amtCell, 'amount', `⚠️ ${amtIssue.shortBadge}`, amtIssue.message, amtIssue.severity);
        } else {
            removeBadge(amtCell, 'amount');
        }

        if (noIssue) {
            ensureBadge(noCell, 'invoiceNo', `⚠️ ${noIssue.shortBadge}`, noIssue.message, noIssue.severity);
        } else {
            removeBadge(noCell, 'invoiceNo');
        }

        if (dateIssue) {
            ensureBadge(dateCell, 'date', `⚠️ ${dateIssue.shortBadge}`, dateIssue.message, dateIssue.severity);
        } else {
            removeBadge(dateCell, 'date');
        }

        if (timeIssue) {
            ensureBadge(typeCell, 'taxiTime', `⚠️ ${timeIssue.shortBadge}`, timeIssue.message, timeIssue.severity);
        } else {
            removeBadge(typeCell, 'taxiTime');
        }

        // 警示行操作列强化提示 (建议级：温和琥珀橙色加粗，不报严重红标)
        if (fixedModifyLink) {
            fixedModifyLink.classList.remove('yn-btn-modify-error', 'yn-btn-modify-highlight');
            if (!fixedModifyLink.classList.contains('yn-btn-modify-warning')) {
                fixedModifyLink.classList.add('yn-btn-modify-warning');
            }
            fixedModifyLink.title = `该发票信息待完善: ${res.missingFieldsDesc}，点击修改补充`;
        }
        if (modifyLink) {
            modifyLink.classList.remove('yn-btn-modify-error', 'yn-btn-modify-highlight');
            if (!modifyLink.classList.contains('yn-btn-modify-warning')) {
                modifyLink.classList.add('yn-btn-modify-warning');
            }
            modifyLink.title = `该发票信息待完善: ${res.missingFieldsDesc}，点击修改补充`;
        }
    } else {
        // 🟢 正常状态清理
        allTrs.forEach(t => {
            if (t.classList.contains('yn-invoice-row-error') || t.classList.contains('yn-invoice-row-warning')) {
                t.classList.remove('yn-invoice-row-error', 'yn-invoice-row-warning');
            }
        });

        removeBadge(typeCell, 'taxiTime');
        removeBadge(amtCell, 'amount');
        removeBadge(dateCell, 'date');
        removeBadge(noCell, 'invoiceNo');

        if (fixedModifyLink) {
            fixedModifyLink.classList.remove('yn-btn-modify-highlight', 'yn-btn-modify-error', 'yn-btn-modify-warning');
            fixedModifyLink.title = '';
        }
        if (modifyLink) {
            modifyLink.classList.remove('yn-btn-modify-highlight', 'yn-btn-modify-error', 'yn-btn-modify-warning');
            modifyLink.title = '';
        }
    }

    // 处理「仅看残缺/问题发票」过滤 (包含严重阻断或缺少乘车时间的行)
    const isProblematic = !res.isValid || Boolean(timeIssue);
    if (isOnlyFilterIssuesActive) {
        const displayStyle = isProblematic ? '' : 'none';
        allTrs.forEach(t => {
            if (t.style.display !== displayStyle) t.style.display = displayStyle;
        });
    } else {
        allTrs.forEach(t => {
            if (t.style.display === 'none') t.style.display = '';
        });
    }

    return res;
}

/**
 * 针对当前页出租车发票执行后台详情穿透预取并缓存 (分批全量并发拉取)
 */
let isPrefetchingTaxiDetails = false;
async function prefetchTaxiDetails(doc: Document, rows: HTMLTableRowElement[], mapping: TableColumnMapping) {
    if (isPrefetchingTaxiDetails) return;
    const win = doc.defaultView || window;
    const sessionToken = (win as any).sessionStorage?.getItem('ecs_TOKEN') || (win as any).sessionStorage?.getItem('console_TOKEN') || '';
    const sessionEcsToken = (win as any).sessionStorage?.getItem('ecs_token') || '';
    const urlParams = new URLSearchParams(win.location.search || (win.location.hash.includes('?') ? win.location.hash.split('?')[1] : ''));
    const urlToken = urlParams.get('TOKEN') || '';

    const headers = capturedAuthHeaders || (win as any).__capturedHeaders || {
        LoginToken: sessionToken || urlToken,
        EcsToken: sessionEcsToken,
        appId: urlParams.get('appId') || 'e3d5e4787ff911e88b1997bee3518b4d',
        MenuId: urlParams.get('menuId') || '11ec6dd3fd5cb161bff83bb033997150',
        UserOrigin: win.location.origin
    };
    const loginToken = headers.LoginToken || headers.TOKEN || sessionToken || urlToken;
    if (!loginToken) return;

    // 挂载全局缓存对象便于诊断
    (win as any).__yn_invoice_cache = invoiceDetailCache;

    const needed: { dataId: string; invNo: string }[] = [];
    rows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        const invType = mapping.typeIdx >= 0 ? getCellOriginalText(cells[mapping.typeIdx]) : '';
        const invNo = mapping.noIdx >= 0 ? getCellOriginalText(cells[mapping.noIdx]) : '';
        if (invType.includes('出租车')) {
            const dataId = getRowDataId(tr);
            if (dataId && !checkedInvoiceDataIds.has(dataId) && !invoiceDetailCache.has(dataId) && (!invNo || !invoiceDetailCache.has(invNo))) {
                if (!needed.some(n => n.dataId === dataId)) {
                    needed.push({ dataId, invNo });
                }
            }
        }
    });

    if (needed.length === 0) return;
    isPrefetchingTaxiDetails = true;

    try {
        // 分批并发拉取当前页全部出租车详情 (每批 6 个并发，覆盖当前页全部出租车发票)
        const BATCH_SIZE = 6;
        for (let i = 0; i < needed.length; i += BATCH_SIZE) {
            const batch = needed.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async item => {
                checkedInvoiceDataIds.add(item.dataId);
                try {
                    const appId = headers.appId || headers.appid || urlParams.get('appId') || 'e3d5e4787ff911e88b1997bee3518b4d';
                    const reqHeaders: Record<string, string> = {
                        'Content-Type': 'application/json;charset=UTF-8',
                        'LoginToken': loginToken,
                        'appId': appId,
                        'MenuId': headers.MenuId || headers.menuid || urlParams.get('menuId') || '11ec6dd3fd5cb161bff83bb033997150',
                        'UserOrigin': headers.UserOrigin || headers.userorigin || win.location.origin
                    };
                    const ecs = headers.EcsToken || headers.ecstoken || sessionEcsToken;
                    if (ecs) reqHeaders['EcsToken'] = ecs;
                    const eicds = headers.eicds || headers.Eicds;
                    if (eicds) reqHeaders['eicds'] = eicds;

                    const res = await win.fetch('/fssc/bo/bodata/getBoDataAndTemplateWF', {
                        method: 'POST',
                        headers: reqHeaders,
                        body: JSON.stringify({
                            boMainId: item.dataId,
                            scene: 'VIEW',
                            appId: appId
                        })
                    });
                    const json = await res.json();
                    const row = json?.data?.boData?.area?.rowDatas?.[0]?.datas;
                    if (row) {
                        const detail = {
                            id: item.dataId,
                            invoiceNo: row.INVOICE_NO?.value || item.invNo || '',
                            invoiceCode: row.INVOICE_CODE?.value || '',
                            invoiceDate: row.INVOICE_DATE?.value || '',
                            timeGetOn: row.TIME_GETON?.value || '',
                            timeGetOff: row.TIME_GETOFF?.value || '',
                            mileage: row.MILEAGE?.value || '',
                            amount: (row.AMOUNT_TAX?.value && row.AMOUNT_TAX?.value.amount !== undefined)
                                ? row.AMOUNT_TAX?.value.amount
                                : (row.AMOUNT_TAX?.value || 0),
                            place: row.PLACE?.value || '',
                            serialNumber: row.SERIALNUMBER?.value || ''
                        };
                        invoiceDetailCache.set(item.dataId, detail);
                        if (detail.invoiceNo) invoiceDetailCache.set(detail.invoiceNo, detail);
                    }
                } catch (e) { }
            }));
            // 每批完成后安静触发一次扫描刷新，渐进式呈现核查结果
            scanAndEnhanceInvoicePoolDOM(doc);
        }
    } finally {
        isPrefetchingTaxiDetails = false;
    }
}

/**
 * 监听并扫描查看发票 / 编辑发票弹窗，实现发票详情深度字段校验与可视化引导
 */
export function enhanceInvoiceDetailModal(doc: Document) {
    const modal = doc.querySelector('.ant-modal-content') as HTMLElement;
    if (!modal) return;

    const modalBody = modal.querySelector('.ant-modal-body') as HTMLElement;
    if (!modalBody) return;

    // 检查是否包含发票详情字段
    const fieldBlocks = Array.from(modal.querySelectorAll('.field_block_horzontal')) as HTMLElement[];
    if (fieldBlocks.length === 0) return;

    const fieldMap = new Map<string, { el: HTMLElement; label: string; val: string; input: HTMLInputElement | null }>();
    fieldBlocks.forEach(fb => {
        const code = fb.getAttribute('code') || '';
        const label = (fb.querySelector('.field_label') as HTMLElement)?.innerText?.trim() || fb.querySelector('.field_label')?.textContent?.trim() || '';
        const input = fb.querySelector('input') as HTMLInputElement;
        const val = input ? (input.value || '').trim() : ((fb.querySelector('.field_control') as HTMLElement)?.innerText?.trim() || fb.querySelector('.field_control')?.textContent?.trim() || '');
        if (code) fieldMap.set(code, { el: fb, label, val, input });
    });

    const typeItem = fieldMap.get('BO_TYPE_DEFINE_ID');
    const invType = typeItem ? typeItem.val : '';
    const amtItem = fieldMap.get('AMOUNT_TAX');
    const timeOnItem = fieldMap.get('TIME_GETON');
    const timeOffItem = fieldMap.get('TIME_GETOFF');

    const issues: { type: 'error' | 'warning'; message: string; shortBadge: string; targetItem?: any }[] = [];

    // 1. 金额校验
    if (amtItem) {
        const amtVal = parseFloat(amtItem.val.replace(/[^0-9.]/g, '')) || 0;
        if (!amtVal || amtVal <= 0 || amtItem.val === '-') {
            issues.push({
                type: 'error',
                message: '该发票未识别到金额（或金额为 0 元），请核实票面实付金额并手动补齐！',
                shortBadge: '缺金额',
                targetItem: amtItem
            });
            ensureBadge(amtItem.el.querySelector('.field_label') as HTMLElement, 'modal-amt', '⚠️ 缺金额', '发票金额未识别', 'error');
            if (amtItem.input) amtItem.input.classList.add('yn-input-highlight-issue');
        } else {
            removeBadge(amtItem.el.querySelector('.field_label') as HTMLElement, 'modal-amt');
            if (amtItem.input) amtItem.input.classList.remove('yn-input-highlight-issue');
        }
    }

    // 2. 出租车发票上下车时间校验
    if (invType.includes('出租车')) {
        const hasTimeOn = timeOnItem && timeOnItem.val && timeOnItem.val !== '-' && timeOnItem.val.trim() !== '';
        const hasTimeOff = timeOffItem && timeOffItem.val && timeOffItem.val !== '-' && timeOffItem.val.trim() !== '';

        if (!hasTimeOn || !hasTimeOff) {
            const missingText = (!hasTimeOn && !hasTimeOff) ? '上下车时间' : (!hasTimeOn ? '上车时间' : '下车时间');
            issues.push({
                type: 'warning',
                message: `该出租车发票未提取到${missingText}（显示为“-”），无法与考勤排期自动对齐行程，建议手动输入乘车时间后保存！`,
                shortBadge: `缺${missingText}`
            });

            if (!hasTimeOn && timeOnItem) {
                ensureBadge(timeOnItem.el.querySelector('.field_label') as HTMLElement, 'modal-timeOn', '⚠️ 缺上车时间', '未提取到上车时间', 'warning');
                if (timeOnItem.input) timeOnItem.input.classList.add('yn-input-highlight-issue');
            } else if (timeOnItem) {
                removeBadge(timeOnItem.el.querySelector('.field_label') as HTMLElement, 'modal-timeOn');
                if (timeOnItem.input) timeOnItem.input.classList.remove('yn-input-highlight-issue');
            }

            if (!hasTimeOff && timeOffItem) {
                ensureBadge(timeOffItem.el.querySelector('.field_label') as HTMLElement, 'modal-timeOff', '⚠️ 缺下车时间', '未提取到下车时间', 'warning');
                if (timeOffItem.input) timeOffItem.input.classList.add('yn-input-highlight-issue');
            } else if (timeOffItem) {
                removeBadge(timeOffItem.el.querySelector('.field_label') as HTMLElement, 'modal-timeOff');
                if (timeOffItem.input) timeOffItem.input.classList.remove('yn-input-highlight-issue');
            }
        } else {
            if (timeOnItem) {
                removeBadge(timeOnItem.el.querySelector('.field_label') as HTMLElement, 'modal-timeOn');
                if (timeOnItem.input) timeOnItem.input.classList.remove('yn-input-highlight-issue');
            }
            if (timeOffItem) {
                removeBadge(timeOffItem.el.querySelector('.field_label') as HTMLElement, 'modal-timeOff');
                if (timeOffItem.input) timeOffItem.input.classList.remove('yn-input-highlight-issue');
            }
        }
    }

    // 3. 弹窗顶部警示 Banner
    let banner = modalBody.querySelector('#yn-modal-alert-banner') as HTMLElement;
    if (issues.length > 0) {
        const topIssue = issues[0];
        if (!banner) {
            banner = doc.createElement('div');
            banner.id = 'yn-modal-alert-banner';
            modalBody.insertBefore(banner, modalBody.firstChild);
        }
        banner.className = `yn-modal-alert-banner ${topIssue.type === 'error' ? 'yn-alert-error' : 'yn-alert-warning'}`;

        const editBtnInTable = doc.querySelector('.ant-table-fixed-right .yn-btn-modify-highlight') || doc.querySelector('.ant-table .yn-btn-modify-highlight');
        const modalTitle = (modal.querySelector('.ant-modal-title') as HTMLElement)?.innerText || modal.querySelector('.ant-modal-title')?.textContent || '';
        const isViewMode = modalTitle.includes('查看');

        banner.innerHTML = `
            <span><strong>【发票体检】</strong>${topIssue.message}</span>
            ${isViewMode ? '<button type="button" class="yn-banner-btn" id="yn-btn-modal-switch-edit">✏️ 前往修改</button>' : ''}
        `;

        const btnSwitchEdit = banner.querySelector('#yn-btn-modal-switch-edit') as HTMLButtonElement;
        if (btnSwitchEdit) {
            btnSwitchEdit.addEventListener('click', (e) => {
                e.preventDefault();
                const closeBtn = modal.querySelector('.ant-modal-close') as HTMLElement;
                if (closeBtn) closeBtn.click();
                setTimeout(() => {
                    if (editBtnInTable) (editBtnInTable as HTMLElement).click();
                }, 150);
            });
        }
    } else if (banner) {
        banner.remove();
    }
}

/**
 * 扫描指定文档内的发票夹表格并注入体检工具胶囊与标记
 */
export function scanAndEnhanceInvoicePoolDOM(doc: Document) {
    if (!doc || !doc.body) return;
    if (scanningDocs.has(doc)) return;
    scanningDocs.add(doc);

    try {
        // 确保样式已注入到该文档头部且为最新内容
        let styleEl = doc.getElementById('yn-injected-styles');
        if (!styleEl) {
            styleEl = doc.createElement('style');
            styleEl.id = 'yn-injected-styles';
            doc.head.appendChild(styleEl);
        }
        if (styleEl.textContent !== MODAL_STYLES) {
            styleEl.textContent = MODAL_STYLES;
        }

        // 扫描详情/编辑弹窗 (若当前有弹窗打开)
        enhanceInvoiceDetailModal(doc);

        const table = doc.querySelector('.ant-table') as HTMLElement;
        if (!table) return;

        const mapping = parseTableColumnMapping(table);
        if (!mapping) return;

        // 尝试自动优化表格分页每页显示条数（默认升档为用户偏好的大分页，如 100 条/页）
        autoOptimizeTablePageSize(doc);

        // 获取主表格滚动区的 tbody
        const scrollBody = doc.querySelector('.ant-table-scroll .ant-table-body') ||
            doc.querySelector('.ant-table-body') ||
            table.querySelector('.ant-table-tbody');
        if (!scrollBody) return;

        // 主表格行 (滚动区)
        const rows = Array.from(scrollBody.querySelectorAll('tbody tr')).filter(r => r.querySelectorAll('td').length > 4) as HTMLTableRowElement[];
        if (rows.length === 0) return;

        // 固定左侧列 (若有)
        const fixedLeftBody = doc.querySelector('.ant-table-fixed-left .ant-table-body-inner') || doc.querySelector('.ant-table-fixed-left');
        const fixedLeftRows = fixedLeftBody
            ? Array.from(fixedLeftBody.querySelectorAll('tbody tr')).filter(r => r.querySelectorAll('td').length > 0) as HTMLTableRowElement[]
            : [];

        // 固定右侧操作列表格行 (若有)
        const fixedRightBody = doc.querySelector('.ant-table-fixed-right .ant-table-body-inner') || doc.querySelector('.ant-table-fixed-right');
        const fixedRightRows = fixedRightBody
            ? Array.from(fixedRightBody.querySelectorAll('tbody tr')).filter(r => r.querySelectorAll('td').length > 0) as HTMLTableRowElement[]
            : [];

        let total = 0;
        let invalidCount = 0;
        let warningCount = 0;
        let missingTimeCount = 0;
        let totalTaxiCount = 0;
        let verifiedTaxiCount = 0;

        rows.forEach((tr, idx) => {
            total++;
            const fixedRightTr = fixedRightRows[idx];
            const fixedLeftTr = fixedLeftRows[idx];
            const cells = tr.querySelectorAll('td');
            const invType = mapping.typeIdx >= 0 ? getCellOriginalText(cells[mapping.typeIdx]) : '';
            if (invType.includes('出租车')) {
                totalTaxiCount++;
                const dataId = getRowDataId(tr);
                const invNo = mapping.noIdx >= 0 ? getCellOriginalText(cells[mapping.noIdx]) : '';
                if ((dataId && (invoiceDetailCache.has(dataId) || checkedInvoiceDataIds.has(dataId))) ||
                    (invNo && invoiceDetailCache.has(invNo))) {
                    verifiedTaxiCount++;
                }
            }

            const res = processTableRow(tr, mapping, fixedRightTr, fixedLeftTr);
            if (res) {
                if (!res.isValid) invalidCount++;
                else if (res.hasWarnings) warningCount++;
                if (res.issues.some(i => i.field === 'time')) {
                    missingTimeCount++;
                }
            }
        });

        lastAuditSummary = { total, invalidCount, warningCount, missingTimeCount, totalTaxiCount, verifiedTaxiCount };

        // 注入/刷新操作工具栏胶囊
        mountAuditToolbar(doc, total, invalidCount, warningCount, missingTimeCount, totalTaxiCount, verifiedTaxiCount);

        // 触发未缓存出租车发票的后台预取
        prefetchTaxiDetails(doc, rows, mapping);
    } finally {
        setTimeout(() => {
            scanningDocs.delete(doc);
        }, 100);
    }
}

/**
 * 获取表格 Ant Design Pagination 组件的 React Fiber 实例
 */
export function getTablePaginationFiber(doc: Document): any {
    const sizeChanger = doc.querySelector('.ant-pagination-options-size-changer') || doc.querySelector('.ant-pagination');
    if (!sizeChanger) return null;

    const reactKey = Object.keys(sizeChanger).find(k => k.startsWith('__react'));
    if (!reactKey) return null;

    let curr = (sizeChanger as any)[reactKey];
    while (curr) {
        if (curr.memoizedProps && typeof curr.memoizedProps.onShowSizeChange === 'function') {
            return curr;
        }
        curr = curr.return;
    }
    return null;
}

/**
 * 动态切换表格每页显示条数并持久化用户偏好
 */
export function changeTablePageSize(doc: Document, targetSize: number): boolean {
    const paginationFiber = getTablePaginationFiber(doc);
    if (!paginationFiber) return false;

    const current = paginationFiber.memoizedProps.current || 1;
    const currentSize = paginationFiber.memoizedProps.pageSize;

    try {
        localStorage.setItem('yn_preferred_page_size', String(targetSize));
    } catch (e) { }

    if (currentSize !== targetSize) {
        paginationFiber.memoizedProps.onShowSizeChange(current, targetSize);
        return true;
    }
    return false;
}

/**
 * 自动将表格默认分页从 20 升档为用户偏好大小（默认 100 条/页）
 */
function autoOptimizeTablePageSize(doc: Document) {
    if (!doc || (doc as any).__yn_page_size_auto_optimized) return;

    const paginationFiber = getTablePaginationFiber(doc);
    if (!paginationFiber) return;

    let preferredSize = 100;
    try {
        const stored = localStorage.getItem('yn_preferred_page_size');
        if (stored) {
            const parsed = parseInt(stored, 10);
            if ([20, 50, 100, 200].includes(parsed)) preferredSize = parsed;
        }
    } catch (e) { }

    const currentSize = paginationFiber.memoizedProps.pageSize;
    (doc as any).__yn_page_size_auto_optimized = true;

    // 如果当前仍为宿主系统默认的 20 条，且用户的偏好大于 20，则自动平滑升档
    if (currentSize === 20 && preferredSize > 20) {
        changeTablePageSize(doc, preferredSize);
    }
}

/**
 * 在发票夹表格操作栏注入「🩺 发票智能体检」胶囊与「仅看残缺」开关
 */
function mountAuditToolbar(
    doc: Document,
    total: number,
    invalidCount: number,
    warningCount: number,
    missingTimeCount: number = 0,
    totalTaxiCount: number = 0,
    verifiedTaxiCount: number = 0
) {
    const container = doc.querySelector('.btn_overflow_leftArea') ||
        doc.querySelector('.btn_overflow_dimMenu')?.parentElement ||
        doc.querySelector('.btn_overflow_dimMenu') ||
        doc.querySelector('.ant-btn-primary')?.parentElement;

    if (!container) return;

    let bar = doc.getElementById('yn-invoice-audit-toolbar');
    let btnCreateExpense = doc.getElementById('yn-btn-generate-expense-record') as HTMLButtonElement;

    if (!btnCreateExpense) {
        btnCreateExpense = doc.createElement('button');
        btnCreateExpense.type = 'button';
        btnCreateExpense.id = 'yn-btn-generate-expense-record';
        btnCreateExpense.className = 'yn-btn yn-btn-primary yn-btn-create-expense-pool';
        btnCreateExpense.title = '将发票夹选中的发票批量生成费用记录（同日同期出租车与过路费自动合并为1笔费用）';
        btnCreateExpense.innerText = '⚡ 生成费用记录';

        btnCreateExpense.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const state = getInvoicePoolGlobalState();
            handleGenerateExpensesFromSelected(doc, state, btnCreateExpense);
        });

        // 监听表格勾选变动实时更新计数
        if (!(doc as any).__yn_invoice_selection_listener_attached) {
            (doc as any).__yn_invoice_selection_listener_attached = true;
            doc.addEventListener('change', (e) => {
                const target = e.target as HTMLElement;
                if (target && target.matches && (target.matches('.ant-checkbox-input') || target.matches('input[type="checkbox"]'))) {
                    setTimeout(() => {
                        const btn = doc.getElementById('yn-btn-generate-expense-record') as HTMLButtonElement;
                        if (btn && !btn.classList.contains('is-loading')) {
                            const sel = getTableSelectedRowIndices(doc);
                            btn.innerText = sel.length > 0 ? `⚡ 生成费用记录 (已选 ${sel.length} 条)` : `⚡ 生成费用记录`;
                        }
                    }, 50);
                }
            });
        }
    }

    if (!bar) {
        bar = doc.createElement('div');
        bar.id = 'yn-invoice-audit-toolbar';
        bar.className = 'yn-invoice-audit-toolbar';

        bar.innerHTML = `
            <button type="button" class="yn-audit-btn" id="yn-btn-run-audit" title="点击重新扫描与体检当前未使用发票">
                🩺 <span id="yn-audit-btn-text">发票体检</span>
            </button>
            <label class="yn-audit-filter-toggle" title="勾选后隐藏已完备发票，仅显示缺少金额、日期、乘车时间等必要字段的发票">
                <input type="checkbox" id="yn-checkbox-only-issues" />
                <span id="yn-filter-toggle-label">仅看残缺发票</span>
            </label>
            <div class="yn-page-size-selector" title="点击快速切换每页显示条数，自动持久化记忆">
                <span>每页:</span>
                <button type="button" class="yn-page-size-btn" data-size="20">20</button>
                <button type="button" class="yn-page-size-btn" data-size="50">50</button>
                <button type="button" class="yn-page-size-btn" data-size="100">100</button>
                <button type="button" class="yn-page-size-btn" data-size="200">200</button>
            </div>
        `;

        container.appendChild(bar);

        // 绑定事件
        const btnAudit = bar.querySelector('#yn-btn-run-audit') as HTMLButtonElement;
        const ckFilter = bar.querySelector('#yn-checkbox-only-issues') as HTMLInputElement;

        btnAudit?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            scanAndEnhanceInvoicePoolDOM(doc);
            const totalIssues = lastAuditSummary.invalidCount + lastAuditSummary.missingTimeCount;
            const taxiDetailInfo = lastAuditSummary.totalTaxiCount > 0
                ? `\n（已调用 /getBoDataAndTemplateWF 接口核验 ${lastAuditSummary.verifiedTaxiCount}/${lastAuditSummary.totalTaxiCount} 张出租车发票详情）`
                : '';
            if (totalIssues === 0) {
                alert(`✅ 体检完成：当前列表中全部 ${lastAuditSummary.total} 张发票关键信息及详情完备！${taxiDetailInfo}`);
            } else {
                let detailMsg = '';
                if (lastAuditSummary.invalidCount > 0) detailMsg += `${lastAuditSummary.invalidCount} 张缺少金额/日期/号码；`;
                if (lastAuditSummary.missingTimeCount > 0) detailMsg += `${lastAuditSummary.missingTimeCount} 张出租车票缺少上下车时间；`;
                alert(`⚠️ 体检完成：共发现问题发票：${detailMsg}${taxiDetailInfo}\n已标红/标黄并强化【修改】按钮！`);
            }
        });

        ckFilter?.addEventListener('change', (e: any) => {
            isOnlyFilterIssuesActive = Boolean(e.target.checked);
            scanAndEnhanceInvoicePoolDOM(doc);
        });

        // 快捷分页按钮点击绑定
        bar.querySelectorAll('.yn-page-size-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const size = parseInt((btn as HTMLElement).getAttribute('data-size') || '100', 10);
                changeTablePageSize(doc, size);
            });
        });
    } else if (bar.parentElement !== container) {
        container.appendChild(bar);
    }

    // 严格确保 btnCreateExpense 注入并始终位于 bar 的左侧
    if (btnCreateExpense.parentElement !== container || btnCreateExpense.nextSibling !== bar) {
        container.insertBefore(btnCreateExpense, bar);
    }

    // 动态刷新生成费用记录按钮当前勾选计数
    if (!btnCreateExpense.classList.contains('is-loading')) {
        const selCount = getTableSelectedRowIndices(doc).length;
        const targetBtnText = selCount > 0 ? `⚡ 生成费用记录 (已选 ${selCount} 条)` : `⚡ 生成费用记录`;
        if (btnCreateExpense.innerText !== targetBtnText) {
            btnCreateExpense.innerText = targetBtnText;
        }
    }

    // 动态刷新胶囊状态文案与样式（严格幂等，避免无谓 DOM 赋值）
    const btnAudit = bar.querySelector('#yn-btn-run-audit') as HTMLButtonElement;
    const btnText = bar.querySelector('#yn-audit-btn-text') as HTMLElement;
    const toggleLabel = bar.querySelector('#yn-filter-toggle-label') as HTMLElement;
    const ckFilter = bar.querySelector('#yn-checkbox-only-issues') as HTMLInputElement;

    if (ckFilter && ckFilter.checked !== isOnlyFilterIssuesActive) {
        ckFilter.checked = isOnlyFilterIssuesActive;
    }

    if (btnAudit && btnText) {
        const taxiCheckProgress = (totalTaxiCount > 0 && verifiedTaxiCount < totalTaxiCount)
            ? ` [核验中 ${verifiedTaxiCount}/${totalTaxiCount}]`
            : '';

        if (invalidCount > 0) {
            if (!btnAudit.classList.contains('has-issues')) btnAudit.classList.add('has-issues');
            const timeExtra = missingTimeCount > 0 ? ` (含${missingTimeCount}张缺乘车时间)` : '';
            const newText = `发现 ${invalidCount} 张残缺发票${timeExtra}${taxiCheckProgress}`;
            if (btnText.innerText !== newText) btnText.innerText = newText;
            const newTitle = `⚠️ 发现 ${invalidCount} 张发票缺少必要字段(如OCR未识别金额/日期)，${missingTimeCount > 0 ? `含 ${missingTimeCount} 张出租车发票缺少上下车时间` : ''}${totalTaxiCount > 0 ? ` (出租车详情已核验 ${verifiedTaxiCount}/${totalTaxiCount} 张)` : ''}，点击查看详情`;
            if (btnAudit.title !== newTitle) btnAudit.title = newTitle;
        } else if (missingTimeCount > 0) {
            if (!btnAudit.classList.contains('has-issues')) btnAudit.classList.add('has-issues');
            const newText = `发现 ${missingTimeCount} 张发票缺乘车时间${taxiCheckProgress}`;
            if (btnText.innerText !== newText) btnText.innerText = newText;
            const newTitle = `发票金额与日期完备，但已通过接口核验的 ${verifiedTaxiCount}/${totalTaxiCount} 张出租车发票未提取到上下车时间，无法自动对齐行程，建议修改补充`;
            if (btnAudit.title !== newTitle) btnAudit.title = newTitle;
        } else if (warningCount > 0) {
            if (btnAudit.classList.contains('has-issues')) btnAudit.classList.remove('has-issues');
            const newText = `发票完备 (${warningCount}项存疑)${taxiCheckProgress}`;
            if (btnText.innerText !== newText) btnText.innerText = newText;
            const newTitle = `发票金额与日期完备，但有 ${warningCount} 张发票类型或销方待复核${totalTaxiCount > 0 ? ` (出租车详情已核验 ${verifiedTaxiCount}/${totalTaxiCount} 张)` : ''}`;
            if (btnAudit.title !== newTitle) btnAudit.title = newTitle;
        } else {
            if (btnAudit.classList.contains('has-issues')) btnAudit.classList.remove('has-issues');
            const newText = `发票信息全完备 (${total})${taxiCheckProgress}`;
            if (btnText.innerText !== newText) btnText.innerText = newText;
            const newTitle = `✅ 当前全部 ${total} 张发票关键字段 100% 完备${totalTaxiCount > 0 ? ` (出租车详情已全量核验: ${verifiedTaxiCount}/${totalTaxiCount} 张)` : ''}`;
            if (btnAudit.title !== newTitle) btnAudit.title = newTitle;
        }
    }

    if (toggleLabel) {
        const issueTotal = invalidCount + missingTimeCount;
        const newLabel = isOnlyFilterIssuesActive
            ? `已过滤残缺 (${issueTotal}/${total})`
            : `仅看残缺 (${issueTotal})`;
        if (toggleLabel.innerText !== newLabel) toggleLabel.innerText = newLabel;
    }

    // 动态同步每页条数按钮的高亮状态
    const paginationFiber = getTablePaginationFiber(doc);
    let activeSize = paginationFiber?.memoizedProps?.pageSize;
    if (!activeSize) {
        try {
            activeSize = parseInt(localStorage.getItem('yn_preferred_page_size') || '100', 10);
        } catch (e) {
            activeSize = 100;
        }
    }
    bar.querySelectorAll('.yn-page-size-btn').forEach(btn => {
        const btnSize = parseInt((btn as HTMLElement).getAttribute('data-size') || '0', 10);
        if (btnSize === activeSize) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

/**
 * 为指定发票夹文档挂载 MutationObserver (幂等防重复)
 */
function ensureDocObserver(doc: Document, triggerScan: () => void) {
    if (!doc || !doc.body || (doc as any).__yn_observer_attached) return;
    (doc as any).__yn_observer_attached = true;

    try {
        const observer = new MutationObserver((mutations) => {
            if (scanningDocs.has(doc)) return;
            let shouldRefresh = false;
            for (const m of mutations) {
                if (m.type === 'childList') {
                    for (let i = 0; i < m.addedNodes.length; i++) {
                        const node = m.addedNodes[i];
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const el = node as HTMLElement;
                            if (el.id === 'yn-invoice-audit-toolbar' ||
                                el.id === 'yn-btn-generate-expense-record' ||
                                el.classList?.contains('yn-btn-create-expense-pool') ||
                                el.classList?.contains('yn-invoice-badge') ||
                                el.hasAttribute?.('data-yn-badge') ||
                                el.id === 'yn-injected-styles' ||
                                el.id === 'yn-modal-alert-banner' ||
                                el.closest?.('#yn-invoice-audit-toolbar') ||
                                el.closest?.('#yn-btn-generate-expense-record')) {
                                continue;
                            }
                            if (el.tagName === 'TR' || el.querySelector?.('tr') || el.classList?.contains('ant-table-tbody') || el.classList?.contains('ant-modal') || el.querySelector?.('.ant-modal-content')) {
                                shouldRefresh = true;
                                break;
                            }
                        }
                    }
                    if (shouldRefresh) break;

                    for (let i = 0; i < m.removedNodes.length; i++) {
                        const node = m.removedNodes[i];
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const el = node as HTMLElement;
                            if (el.tagName === 'TR' || el.querySelector?.('tr') || el.classList?.contains('ant-modal')) {
                                shouldRefresh = true;
                                break;
                            }
                        }
                    }
                    if (shouldRefresh) break;
                }
            }
            if (shouldRefresh) triggerScan();
        });
        observer.observe(doc.body, { childList: true, subtree: true });
    } catch (e) { }
}

/**
 * 建立 MutationObserver 监听器，自动侦测发票夹表格与弹窗变化
 */
let isObserverAttached = false;
export function initInvoicePoolDomService(state?: GlobalState) {
    if (state) cachedGlobalState = state;
    let debounceTimer: any = null;
    const triggerScan = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const currentDocs = getInvoicePoolTargetDocs();
            currentDocs.forEach(doc => {
                ensureDocObserver(doc, triggerScan);
                if (doc.defaultView) hookInvoiceDetailNetwork(doc.defaultView);
                scanAndEnhanceInvoicePoolDOM(doc);
            });
        }, 150);
    };

    // 立即执行一次探测扫描
    const initialDocs = getInvoicePoolTargetDocs();
    initialDocs.forEach(doc => {
        ensureDocObserver(doc, triggerScan);
        if (doc.defaultView) hookInvoiceDetailNetwork(doc.defaultView);
        scanAndEnhanceInvoicePoolDOM(doc);
    });

    // 监听顶层 document.body，侦测 iframe 创建或移除
    if (typeof document !== 'undefined' && document.body && !(document as any).__yn_top_observer_attached) {
        (document as any).__yn_top_observer_attached = true;
        try {
            const topObserver = new MutationObserver((mutations) => {
                let hasNewIframe = false;
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        for (let i = 0; i < m.addedNodes.length; i++) {
                            const node = m.addedNodes[i];
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const el = node as HTMLElement;
                                if (el.tagName === 'IFRAME' || el.querySelector?.('iframe')) {
                                    hasNewIframe = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (hasNewIframe) break;
                }
                if (hasNewIframe) {
                    setTimeout(triggerScan, 300);
                }
            });
            topObserver.observe(document.body, { childList: true, subtree: true });
        } catch (e) { }
    }

    if (isObserverAttached) return;
    isObserverAttached = true;

    // 周期性心跳巡检保活 (2 秒，确保在异步切页/加载完成后 100% 自动挂载)
    setInterval(() => {
        const currentDocs = getInvoicePoolTargetDocs();
        currentDocs.forEach(doc => {
            ensureDocObserver(doc, triggerScan);
            if (doc.defaultView) hookInvoiceDetailNetwork(doc.defaultView);
            scanAndEnhanceInvoicePoolDOM(doc);
        });
    }, 2000);

    AutopilotLogger.info('✨ [InvoicePoolDomService] 发票夹发票完整性校验、详情穿透与弹窗引导服务已成功启动！');
}
