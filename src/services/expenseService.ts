import { apiRequest, callNativeHttp, getNativeHttp, extractLatestTokens } from '../utils/http';
import { touchSessionKeepalive } from './sessionKeepaliveService';
import { GlobalState, InvoiceItem } from '../types/state';
import { EXPENSE_TYPES, ALL_EXPENSE_TYPE_LIST } from '../config/constants';
import { computePeriod, normalizeDate } from '../utils/date';
import { mapConcurrent } from '../utils/concurrency';
import { detectInvoiceCategory } from './commuteService';
import { AutopilotLogger } from '../utils/logger';
import { fetchLoginUserInfo, fetchCityVO, calculateDaysAndNights, computeMealAllowance, generateUuid } from './applicationService';
import { fetchBillDataAndTemplateApi, parseBillDataStructure } from './billService';
import { enrichInvoiceWithValidation } from './invoiceValidationService';

declare const unsafeWindow: any;
declare const GM_download: any;

function normalizeTimeHelper(t: any): string {
    if (!t) return '';
    const clean = t.toString().trim();
    const parts = clean.split(':');
    if (parts.length >= 2) {
        return `${parts[0].trim().padStart(2, '0')}:${parts[1].trim().padStart(2, '0')}`;
    }
    return clean;
}

export function sortInvoices(list: InvoiceItem[]): InvoiceItem[] {
    return list.sort((a, b) => {
        const dateA = normalizeDate(a.invoiceDate || '') || '9999-99-99';
        const dateB = normalizeDate(b.invoiceDate || '') || '9999-99-99';
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        const timeA = normalizeTimeHelper(a.timeGetOn) || '99:99';
        const timeB = normalizeTimeHelper(b.timeGetOn) || '99:99';
        return timeA.localeCompare(timeB);
    });
}

/**
 * 全量同步发票夹与未报销费用记录列表（带多级容灾与 DOM 降级兜底）
 */
export async function loadAllInvoicesAndExpenses(state: GlobalState): Promise<InvoiceItem[]> {
    // 0. 刷新当前真实登录人信息
    try {
        await fetchLoginUserInfo(state);
    } catch (e) { }

    const loaded: InvoiceItem[] = [];
    const processedRecordIds = new Set<string>();
    const processedInvoiceDataIds = new Set<string>();
    const processedInvoiceNos = new Set<string>();

    // 1. 发票夹池
    const poolList = await queryInvoicePoolListApi(state);
    const poolInvoices = await mapConcurrent(poolList, 8, async (pItem: any) => {
        const dataId = pItem.boSourceRowId || (pItem.datas && pItem.datas.ID ? pItem.datas.ID.value : '');
        if (!dataId) return null;
        try {
            const invDetail = await getInvoiceDetailByDataIdApi(dataId, state);
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

    // 2. 未报销费用明细
    const recordList = await queryExpenseRecordListApi(state);
    const parsedRecords = await mapConcurrent(recordList, 8, async (item: any) => {
        const recId = item.expenseRecordId;
        if (!recId) return null;
        try {
            const ruleData = await getExpenseTypeRuleAndRowDatasApi(recId, item.expenseTypeId || 'UNIDENTIFIED', state);
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
                if (!invVO.commodityNames && matchedInv.commodityNames) invVO.commodityNames = matchedInv.commodityNames;
                if (!invVO.cargoInformation && matchedInv.cargoInformation) invVO.cargoInformation = matchedInv.cargoInformation;
                if (!invVO.invoiceDetails && matchedInv.invoiceDetails) invVO.invoiceDetails = matchedInv.invoiceDetails;
                if (!invVO.goodsName && matchedInv.goodsName) invVO.goodsName = matchedInv.goodsName;
                if (!invVO.invoiceTypeAbbreviation && matchedInv.invoiceTypeAbbreviation) invVO.invoiceTypeAbbreviation = matchedInv.invoiceTypeAbbreviation;
                if (!invVO.invoiceTypeCode && matchedInv.invoiceTypeCode) invVO.invoiceTypeCode = matchedInv.invoiceTypeCode;
            }

            let attachList: any[] = [];
            if (rowDatas.expenseRecordAttachmentList && rowDatas.expenseRecordAttachmentList.value) {
                attachList = rowDatas.expenseRecordAttachmentList.value;
            }

            const cat = detectInvoiceCategory(invVO, item, item.expenseTypeName || '');
            const rawDate = invVO.invoiceDate || (item.businessDate ? item.businessDate.split(' ')[0] : '');
            const invDate = normalizeDate(rawDate);
            const amt = item.amountObj ? item.amountObj.amount : (invVO.amountTax || 0);

            const isComm = cat === 'COMMUNICATION';
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
                fileName: invVO.fileName || '',
                salesName: invVO.salesName || invVO.seller || '',
                timeGetOn: normalizeTimeHelper(invVO.timeGetOn),
                timeGetOff: normalizeTimeHelper(invVO.timeGetOff),
                mileage: invVO.mileage ? `${invVO.mileage}km` : '',
                amount: amt,
                type: cat as any,
                expenseTypeId: item.expenseTypeId || '',
                expenseTypeName: item.expenseTypeName || '',
                startAddress: rowDatas.START_ADDRESS ? (rowDatas.START_ADDRESS.value || '') : '',
                endAddress: rowDatas.END_ADDRESS ? (rowDatas.END_ADDRESS.value || '') : '',
                description: item.description || (rowDatas.DESCRIPTION ? rowDatas.DESCRIPTION.value || '' : ''),
                period: cleanPeriod,
                attachments: attachList,
                errorMessages: item.expenseRecordTypeMessageVO?.errorMessages || [],
                status: (item.expenseRecordTypeMessageVO?.errorMessages && item.expenseRecordTypeMessageVO.errorMessages.length > 0)
                    ? '异常'
                    : ((item.expenseTypeName && item.expenseTypeName !== 'None') ? '成功' : '就绪')
            } as InvoiceItem;
        } catch (e: any) {
            AutopilotLogger.warn(`[ExpenseService] 解析单笔费用记录详情异常 (${recId}): ${e.message}`);
            const invDate = normalizeDate(item.businessDate ? item.businessDate.split(' ')[0] : '');
            const amt = item.amountObj ? item.amountObj.amount : 0;
            const fallbackCat = detectInvoiceCategory({}, item, item.expenseTypeName || '');
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
                amount: amt,
                type: fallbackCat !== 'OTHER' ? (fallbackCat as any) : (amt >= 350 ? 'HOTEL' : 'TAXI'),
                startAddress: '',
                endAddress: '',
                description: item.description || '',
                period: computePeriod(invDate, false),
                attachments: [],
                errorMessages: item.expenseRecordTypeMessageVO?.errorMessages || [],
                status: (item.expenseRecordTypeMessageVO?.errorMessages && item.expenseRecordTypeMessageVO.errorMessages.length > 0) ? '异常' : '就绪'
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
        const cat = detectInvoiceCategory(invDetail, {}, '');
        const isComm = cat === 'COMMUNICATION';

        loaded.push({
            expenseRecordId: '',
            version: 1,
            boDataId: dataId,
            invoiceVO: invDetail,
            invoiceNo: invNo,
            invoiceCode: invDetail.invoiceCode || '',
            invoiceDate: invDate,
            timeGetOn: normalizeTimeHelper(invDetail.timeGetOn),
            timeGetOff: normalizeTimeHelper(invDetail.timeGetOff),
            mileage: invDetail.mileage ? `${invDetail.mileage}km` : '',
            amount: amt,
            type: cat as any,
            startAddress: '',
            endAddress: '',
            description: '',
            period: computePeriod(invDate, isComm),
            attachments: [],
            status: '待流转'
        });
    });

    // 智能容灾层 1：若发票池和费用记录均为 0，检测是否在报销单编辑页 (#billWrite)
    if (loaded.length === 0) {
        let billMainId = state.currentBillMainId;
        if (!billMainId && typeof window !== 'undefined') {
            const hash = window.location.hash || '';
            const match = hash.match(/billMainId=([a-zA-Z0-9_\-]+)/) || hash.match(/id=([a-zA-Z0-9_\-]+)/);
            if (match) billMainId = match[1];
            if (!billMainId) {
                const search = window.location.search || '';
                const m2 = search.match(/billMainId=([a-zA-Z0-9_\-]+)/) || search.match(/id=([a-zA-Z0-9_\-]+)/);
                if (m2) billMainId = m2[1];
            }
        }
        if (billMainId && (!state.billRows || state.billRows.length === 0)) {
            try {
                const { billData } = await fetchBillDataAndTemplateApi(billMainId, state);
                state.currentBillData = billData;
                const parsed = parseBillDataStructure(billData);
                state.billRows = parsed.billRows;
                state.billTags = parsed.billTags;
            } catch (e: any) {
                AutopilotLogger.warn(`[ExpenseService] 自动拉取报销单明细行失败: ${e.message}`);
            }
        }

        if (state.billRows && state.billRows.length > 0) {
            state.billRows.forEach((row, idx) => {
                loaded.push({
                    id: row.claimRowId || `bill-row-${idx}`,
                    expenseRecordId: row.claimRowId,
                    version: 1,
                    invoiceVO: {},
                    invoiceNo: '',
                    invoiceCode: '',
                    invoiceDate: '',
                    timeGetOn: '',
                    timeGetOff: '',
                    mileage: '',
                    amount: row.amount,
                    type: detectInvoiceCategory({}, {}, row.expTypeName),
                    expenseTypeName: row.expTypeName || '市内交通费',
                    startAddress: '',
                    endAddress: '',
                    description: row.recDesc || '',
                    period: '',
                    attachments: [],
                    status: '就绪',
                    isModified: false
                });
            });
        }
    }

    // 智能融合层：从当前宿主页面 DOM / React Fiber 中增量融合发票（保障 100% 提取发票夹全部发票）
    const domItems = scrapeInvoicesFromDom(state);
    if (domItems.length > 0) {
        domItems.forEach(d => {
            const dataId = d.boDataId || d.id;
            const invNo = d.invoiceNo || '';
            if (dataId && processedInvoiceDataIds.has(dataId)) return;
            if (invNo && processedInvoiceNos.has(invNo)) return;
            loaded.push(d);
            if (dataId) processedInvoiceDataIds.add(dataId);
            if (invNo) processedInvoiceNos.add(invNo);
        });
    }

    const sorted = sortInvoices(loaded);
    // 对每条发票执行完整性体检与残缺字段标记
    sorted.forEach(item => enrichInvoiceWithValidation(item));
    state.invoices = sorted;
    state.selectedIndices.clear();
    sorted.forEach((_, idx) => state.selectedIndices.add(idx));
    return sorted;
}

/**
 * 宿主页面 DOM 表格穿透兜底爬取
 * 当后端接口因权限、状态过滤返回 0 条时，直接从用户屏幕可见的表格中提取数据
 */
export function scrapeInvoicesFromDom(state: GlobalState): InvoiceItem[] {
    if (typeof document === 'undefined') return [];

    const results: InvoiceItem[] = [];
    const seenIds = new Set<string>();
    const seenNos = new Set<string>();

    // 辅助：从 DOM 节点探测 React Fiber
    function findFiber(el: Element): any {
        if (!el) return null;
        const key = Object.keys(el).find(k => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$'));
        return key ? (el as any)[key] : null;
    }

    // 辅助：从单个 document 中提取 React Table dataSource
    function extractFromDocFiber(doc: Document): any[] | null {
        if (!doc) return null;
        const trs = Array.from(doc.querySelectorAll('tbody tr'));
        for (const tr of trs) {
            let fiber = findFiber(tr);
            while (fiber) {
                if (fiber.memoizedProps?.dataSource && Array.isArray(fiber.memoizedProps.dataSource) && fiber.memoizedProps.dataSource.length > 0) {
                    return fiber.memoizedProps.dataSource;
                }
                fiber = fiber.return;
            }
        }
        return null;
    }

    // 收集主文档及所有同源 iframe 文档
    const docs: Document[] = [document];
    document.querySelectorAll('iframe').forEach(f => {
        try {
            const d = f.contentDocument || f.contentWindow?.document;
            if (d && !docs.includes(d)) docs.push(d);
        } catch (e) { }
    });

    // 辅助：从 Fiber 节点数据对象中按 columnCode 动态提取值
    function getColumnValue(record: any, code: string): any {
        if (!record || typeof record !== 'object') return undefined;
        if (record[code]?.value !== undefined) return record[code].value;
        for (const key of Object.keys(record)) {
            const item = record[key];
            if (item && typeof item === 'object' && item.columnCode === code) {
                return item.value;
            }
        }
        return undefined;
    }

    // 1. 优先从 React Fiber 提取最完整的发票池原生数据 (穿透发票夹 iframe 与宿主页面)
    for (const doc of docs) {
        const dataSource = extractFromDocFiber(doc);
        if (dataSource && dataSource.length > 0) {
            for (let idx = 0; idx < dataSource.length; idx++) {
                const d = dataSource[idx];
                const dataId = d.ID?.value || d.boSourceRowId?.value || d.boSourceRowId || getColumnValue(d, 'ID') || `inv-fiber-${idx}`;
                const typeName = d.BO_TYPE_DEFINE_ID?.value?.onlyTitle?.zh_CN || d.BO_TYPE_DEFINE_ID?.value?.title?.zh_CN || d.BO_TYPE_DEFINE_ID?.title?.zh_CN || '';
                const invCode = getColumnValue(d, 'INVOICE_CODE') || d['8f8eb6197a4411e9b0eddf7f464b08f2']?.value || '';
                const invNo = getColumnValue(d, 'INVOICE_NO') || d['9b1993717a4411e9b0ed17d010f97c63']?.value || '';
                const rawDate = getColumnValue(d, 'INVOICE_DATE') || d['ba31ef167a4411e9b0ed9162dd502459']?.value || '';
                const invDate = normalizeDate(rawDate);
                
                const taxAmtObj = getColumnValue(d, 'AMOUNT_TAX') ?? d['d3f7fcbc7a4411e9b0ed576d29ce88e9']?.value;
                const amt = typeof taxAmtObj === 'object' ? (taxAmtObj?.amount ?? 0) : (Number(taxAmtObj) || 0);

                const rawSales = getColumnValue(d, 'SALES_NAME');
                const salesName = typeof rawSales === 'string' ? rawSales : (rawSales?.title?.zh_CN || rawSales?.[0]?.title?.zh_CN || '');

                const rawPurchaser = getColumnValue(d, 'PURCHASER_NAME');
                const purchaserName = typeof rawPurchaser === 'string' ? rawPurchaser : (rawPurchaser?.title?.zh_CN || rawPurchaser?.[0]?.title?.zh_CN || '');

                if (seenIds.has(dataId) || (invNo && seenNos.has(invNo))) continue;
                if (dataId) seenIds.add(dataId);
                if (invNo) seenNos.add(invNo);

                const invoiceVO: any = {
                    invoiceDataId: dataId,
                    invoiceNo: invNo,
                    invoiceCode: invCode,
                    invoiceDate: invDate,
                    amountTax: amt,
                    salesName: salesName,
                    seller: salesName,
                    purchaserName: purchaserName,
                    invoiceTypeAbbreviation: typeName,
                    commodityNames: typeName,
                    fileName: `${invDate}_${typeName}_¥${amt}`
                };

                const cat = detectInvoiceCategory(invoiceVO, {}, typeName);
                const isComm = cat === 'COMMUNICATION';

                results.push({
                    id: dataId,
                    boDataId: dataId,
                    expenseRecordId: '',
                    version: 1,
                    invoiceVO: invoiceVO,
                    invoiceNo: invNo,
                    invoiceCode: invCode,
                    invoiceDate: invDate,
                    salesName: salesName,
                    timeGetOn: '',
                    timeGetOff: '',
                    mileage: '',
                    amount: amt,
                    type: cat as any,
                    expenseTypeName: typeName || (cat === 'HOTEL' ? '住宿费' : cat === 'FLIGHT' ? '飞机票' : cat === 'TRAIN' ? '火车票' : '市内交通费'),
                    startAddress: '',
                    endAddress: '',
                    description: '',
                    period: computePeriod(invDate, isComm),
                    attachments: [],
                    status: '待流转',
                    isModified: false
                });
            }
            if (results.length > 0) {
                AutopilotLogger.info(`[ExpenseService] 成功通过 React Fiber 穿透提取发票池数据 (${results.length} 笔记录)`);
                return results;
            }
        }
    }

    // 2. 降级：从 HTML 表格 DOM 中爬取
    for (const doc of docs) {
        const allTables = Array.from(doc.querySelectorAll('table')).filter(t => {
            const id = t.id || '';
            const cls = t.className || '';
            return !id.includes('yn-') && !cls.includes('webmcp') && !id.includes('webmcp') && !id.includes('trip-');
        });

        for (const table of allTables) {
            const rows = Array.from(table.querySelectorAll('tbody tr'));
            if (rows.length === 0) continue;

            const headers = Array.from(table.querySelectorAll('thead th, thead td')).map(h => (h.textContent || '').trim());

            const dateColIdx = headers.findIndex(h => /日期|时间|date/i.test(h));
            const typeColIdx = headers.findIndex(h => /类型|类别|科目|type|category/i.test(h));
            const amtColIdx = headers.findIndex(h => /金额|价税|含税|amount|price/i.test(h));
            const descColIdx = headers.findIndex(h => /说明|事由|描述|备注|desc/i.test(h));
            const startColIdx = headers.findIndex(h => /出发|起点|origin|from/i.test(h));
            const endColIdx = headers.findIndex(h => /到达|目的|destination|to/i.test(h));
            const invNoColIdx = headers.findIndex(h => /发票号|单据号|no|code/i.test(h));

            for (let i = 0; i < rows.length; i++) {
                const tr = rows[i];
                const cells = Array.from(tr.querySelectorAll('td'));
                if (cells.length < 3) continue;

                const getCellText = (idx: number) => (idx !== -1 && idx < cells.length ? (cells[idx].textContent || '').trim() : '');
                const fullRowText = cells.map(c => c.textContent || '').join(' ');

                let invDate = '';
                if (dateColIdx !== -1) {
                    invDate = normalizeDate(getCellText(dateColIdx));
                }
                if (!invDate) {
                    const m = fullRowText.match(/\b(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})\b/);
                    if (m) invDate = normalizeDate(m[1]);
                }

                let amount = 0;
                if (amtColIdx !== -1) {
                    const amtStr = getCellText(amtColIdx).replace(/[^\d.]/g, '');
                    amount = parseFloat(amtStr) || 0;
                }
                if (!amount) {
                    const m = fullRowText.match(/(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)/);
                    if (m) amount = parseFloat(m[1]) || 0;
                }

                const typeName = typeColIdx !== -1 ? getCellText(typeColIdx) : '';
                const cat = detectInvoiceCategory({}, {}, typeName || fullRowText);

                let startAddress = startColIdx !== -1 ? getCellText(startColIdx) : '';
                let endAddress = endColIdx !== -1 ? getCellText(endColIdx) : '';
                if (!startAddress && !endAddress) {
                    const m = fullRowText.match(/([^\s,，]+)\s*(?:至|➔|->|-->|到)\s*([^\s,，]+)/);
                    if (m) {
                        startAddress = m[1].trim();
                        endAddress = m[2].trim();
                    }
                }

                const description = descColIdx !== -1 ? getCellText(descColIdx) : '';
                const invoiceNo = invNoColIdx !== -1 ? getCellText(invNoColIdx) : '';
                const rowId = tr.getAttribute('data-id') || tr.getAttribute('row-key') || tr.getAttribute('id') || `dom-row-${i}`;

                if (amount > 0 || invDate || typeName) {
                    results.push({
                        id: rowId,
                        expenseRecordId: rowId,
                        version: 1,
                        invoiceVO: {},
                        invoiceNo: invoiceNo,
                        invoiceCode: '',
                        invoiceDate: invDate,
                        timeGetOn: '',
                        timeGetOff: '',
                        mileage: '',
                        amount,
                        type: cat as any,
                        expenseTypeName: typeName || (cat === 'HOTEL' ? '住宿费' : cat === 'FLIGHT' ? '飞机票' : cat === 'TRAIN' ? '火车票' : '市内交通费'),
                        startAddress,
                        endAddress,
                        description,
                        period: computePeriod(invDate, cat === 'COMMUNICATION'),
                        attachments: [],
                        status: '待流转',
                        isModified: false
                    });
                }
            }

            if (results.length > 0) break;
        }
        if (results.length > 0) break;
    }

    if (results.length > 0) {
        AutopilotLogger.info(`[ExpenseService] 从宿主 DOM 表格中兜底爬取成功 (${results.length} 笔记录)`);
    }

    return results;
}

export async function queryInvoicePoolListApi(state: GlobalState) {
    if (state.lastInterceptedInvoicePool && state.lastInterceptedInvoicePool.length > 0) {
        AutopilotLogger.info(`[ExpenseService] 复用最近拦截到的发票池数据 (${state.lastInterceptedInvoicePool.length} 条)`);
        return state.lastInterceptedInvoicePool;
    }

    const payload: any = {
        boDefineId: '5f0971df7a4411e9b0edd9fcadd69462',
        appId: state.appId || 'e3d5e4787ff911e88b1997bee3518b4d',
        relationBO: {
            boType: 'OBJECT_TYPE',
            boDefineId: '5f0971df7a4411e9b0edd9fcadd69462'
        },
        conditions: '',
        conditionMap: {},
        pageOrderParam: {
            pageNum: 1,
            pageSize: 500,
            enableCountLimit: true,
            countLimit: 1000,
            count: false,
            orderList: {
                column: 'ba31ef167a4411e9b0ed9162dd502459',
                desc: false
            }
        },
        boQuerySheetId: '026ef6e4a8a56756ace70c2002000001',
        authority: 0
    };
    try {
        let res = await apiRequest('/fssc/bo/boQuery/getBOQueryDataList', 'POST', payload, state);
        let list = res.data && (res.data.pageInfoBOQueryRowDataList?.list || res.data.boQueryRowDataList || res.data.rowDatas)
            ? (res.data.pageInfoBOQueryRowDataList?.list || res.data.boQueryRowDataList || res.data.rowDatas)
            : [];
        return list;
    } catch (e: any) {
        AutopilotLogger.warn(`[ExpenseService] 查询发票池异常: ${e.message}`);
        return [];
    }
}

export async function getInvoiceDetailByDataIdApi(dataId: string, state: GlobalState) {
    const res = await apiRequest('/fssc/expenseClaim/expenseRecordInvoice/getInvoiceByDataId', 'POST', { invoiceDataId: dataId }, state);
    return res.data;
}

export async function queryExpenseRecordListApi(
    state: GlobalState,
    win?: Window | null,
    forceRefresh: boolean = true,
    statusList?: string[]
) {
    // 只有在非强制刷新模式下，才允许复用最近拦截到的记录
    if (!forceRefresh && state.lastInterceptedExpenseRecords && state.lastInterceptedExpenseRecords.length > 0) {
        AutopilotLogger.info(`[ExpenseService] 复用最近拦截到的宿主费用记录 (${state.lastInterceptedExpenseRecords.length} 条)`);
        return state.lastInterceptedExpenseRecords;
    }

    const applicantId = state.currentUser?.userId || state.applicantId;

    // 1. 标准分页结构请求 (大分页 200 条)
    // statusList 传 undefined 时默认查询未报销与报销中；传 [] 时代表全量查询全部状态 (含未报销、报销中、已报销)
    const statusParam = statusList === undefined ? ['NO_REIMBURSE', 'REIMBURSING'] : [...statusList];
    const standardPayload: any = {
        pageOrderParam: { pageNum: 1, pageSize: 200 },
        status: statusParam,
        requestDate: null,
        sortOrder: 'DESC',
        sortColumnCode: 'CREATE_DATE'
    };

    try {
        // 优先使用原生 HTTP 客户端 (100% 具备 session 与安全鉴权)
        const nativeRes = await callNativeHttp('/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO', 'POST', standardPayload, win);
        if (nativeRes && nativeRes.success && nativeRes.data) {
            let list: any[] = nativeRes.data.list || nativeRes.data.expenseRecordList || [];
            if (list.length === 0 && statusParam.length > 0) {
                // 若指定状态查询为 0 条，尝试全部状态查询
                standardPayload.status = [];
                const allRes = await callNativeHttp('/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO', 'POST', standardPayload, win);
                list = (allRes?.data?.list || allRes?.data?.expenseRecordList) || [];
            }
            // 自动多页循环拼接 (当记录数超过一页 pageSize 时)
            const totalPages = nativeRes.data.pages || 1;
            if (totalPages > 1) {
                for (let p = 2; p <= totalPages; p++) {
                    standardPayload.pageOrderParam.pageNum = p;
                    try {
                        const nextRes = await callNativeHttp('/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO', 'POST', standardPayload, win);
                        const nextItems = nextRes?.data && (nextRes.data.list || nextRes.data.expenseRecordList) ? (nextRes.data.list || nextRes.data.expenseRecordList) : [];
                        list = list.concat(nextItems);
                    } catch (e: any) {
                        AutopilotLogger.warn(`[ExpenseService] 原生 HTTP 拉取第 ${p} 页失败: ${e.message}`);
                    }
                }
            }
            if (list.length > 0) {
                const uniqueMap = new Map<string, any>();
                for (const item of list) {
                    if (item && item.expenseRecordId) {
                        uniqueMap.set(item.expenseRecordId, item);
                    }
                }
                const deduplicated = Array.from(uniqueMap.values());
                state.lastInterceptedExpenseRecords = deduplicated;
                AutopilotLogger.info(`[ExpenseService] 成功通过原生 HTTP 获取费用记录列表共 ${deduplicated.length} 条`);
                return deduplicated;
            }
        }

        let res = await apiRequest('/fssc/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO', 'POST', standardPayload, state);
        let list: any[] = (res.data && (res.data.list || res.data.expenseRecordList)) ? (res.data.list || res.data.expenseRecordList) : [];

        // 智能容灾 1：若 status=['NO_REIMBURSE'] 查询为 0 条，尝试全部状态 (status: []) 查询
        if (list.length === 0) {
            standardPayload.status = [];
            res = await apiRequest('/fssc/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO', 'POST', standardPayload, state);
            list = (res.data && (res.data.list || res.data.expenseRecordList)) ? (res.data.list || res.data.expenseRecordList) : [];
        }

        // 自动多页拼接 (当记录数超过一页 pageSize 时)
        if (res.data && res.data.pages && res.data.pages > 1 && res.data.list) {
            const totalPages = res.data.pages;
            for (let p = 2; p <= totalPages; p++) {
                standardPayload.pageOrderParam.pageNum = p;
                try {
                    const nextRes = await apiRequest('/fssc/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO', 'POST', standardPayload, state);
                    const nextItems = nextRes.data && (nextRes.data.list || nextRes.data.expenseRecordList) ? (nextRes.data.list || nextRes.data.expenseRecordList) : [];
                    list = list.concat(nextItems);
                } catch (e) { }
            }
        }

        // 智能容灾 2：若标准结构仍为 0，尝试历史兼容扁平结构
        if (list.length === 0) {
            const legacyPayload: any = {
                applicantId: applicantId,
                costCenterId: '',
                dateInterval: { dateType: 'ALL' },
                departmentId: '',
                expenseTypeId: '',
                hasBill: '',
                isAsc: true,
                orderField: 'CREATE_DATE',
                pageNo: 1,
                pageSize: 500,
                queryType: 'MY_CREATE',
                status: 'NO_REIMBURSE',
                subCompanyId: ''
            };
            const legRes = await apiRequest('/fssc/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO', 'POST', legacyPayload, state);
            const legList = legRes.data && (legRes.data.list || legRes.data.expenseRecordList) ? (legRes.data.list || legRes.data.expenseRecordList) : [];
            if (legList.length > 0) list = legList;
        }

        if (list.length > 0) {
            const uniqueMap = new Map<string, any>();
            for (const item of list) {
                if (item && item.expenseRecordId) {
                    uniqueMap.set(item.expenseRecordId, item);
                }
            }
            const deduplicated = Array.from(uniqueMap.values());
            state.lastInterceptedExpenseRecords = deduplicated;
            AutopilotLogger.info(`[ExpenseService] 成功获取费用记录列表共 ${deduplicated.length} 条`);
            return deduplicated;
        }
        return [];
    } catch (e: any) {
        AutopilotLogger.warn(`[ExpenseService] 查询费用记录列表异常: ${e.message}`);
        // 灾备兜底：若网络请求异常且本地有历史拦截记录，作为离线灾备返回
        if (state.lastInterceptedExpenseRecords && state.lastInterceptedExpenseRecords.length > 0) {
            AutopilotLogger.warn(`[ExpenseService] 网络查询失败，降级使用历史缓存的 ${state.lastInterceptedExpenseRecords.length} 笔记录`);
            return state.lastInterceptedExpenseRecords;
        }
        return [];
    }
}

export async function getExpenseTypeRuleAndRowDatasApi(
    expenseRecordId: string,
    expenseTypeId: string,
    state: GlobalState,
    win?: Window | null
) {
    const payload: any = {
        expenseRecordId,
        expenseTypeId: expenseTypeId || 'UNIDENTIFIED',
        intersectionScope: null,
        dimensionMappingQueryVOList: [],
        accountCurrencyId: state.accountCurrencyId || '6e589eb2dd9f11e8b5a69590a14a4e34'
    };

    // 优先尝试宿主原生 Axios/HTTP 客户端 (自带动态签名拦截器，100% 鉴权与防伪失效维持)
    const nativeRes = await callNativeHttp('/expenseClaim/expenseRecord/getExpenseTypeFieldRuleListAndAllValueVO', 'POST', payload, win);
    if (nativeRes) {
        if (nativeRes.success && nativeRes.data) {
            return {
                rowDatas: nativeRes.data.rowDatas || {},
                version: nativeRes.data.version !== undefined ? nativeRes.data.version : 1,
                fullData: nativeRes.data
            };
        }
        if (nativeRes.success === false) {
            throw new Error(`获取费用详情与规则失败: ${nativeRes.message || '后端异常'}`);
        }
    }

    // 仅在完全没有原生客户端的环境下使用备用请求
    const res = await apiRequest('/fssc/expenseClaim/expenseRecord/getExpenseTypeFieldRuleListAndAllValueVO', 'POST', payload, state);
    if (res && res.success && res.data) {
        return {
            rowDatas: res.data.rowDatas || {},
            version: res.data.version !== undefined ? res.data.version : 1,
            fullData: res.data
        };
    }
    throw new Error(res?.message || '获取费用详情与规则失败，请刷新重试');
}

export async function initExpenseRecordWithTypeApi(
    expenseRecordId: string,
    targetExpenseTypeId: string,
    baseRowDatas: any = {},
    state: GlobalState,
    win?: Window | null
) {
    const applicantId = baseRowDatas?.APPLICANT_ID?.value?.value ||
        state.currentUser?.userId ||
        state.applicantId ||
        (typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem('userId') || sessionStorage.getItem('loginUserId')) : '') || '';

    const payload = {
        accountCurrencyId: state.accountCurrencyId || '6e589eb2dd9f11e8b5a69590a14a4e34',
        applicantId: applicantId || undefined,
        expenseRecordId,
        expenseTypeId: targetExpenseTypeId,
        executeType: 'CHANGE_EXPENSE_TYPE',
        triggerTiming: 'ADD_ROW',
        source: 'CHANGE_EXPENSE_TYPE',
        rowDatas: baseRowDatas
    };
    let res: any = await callNativeHttp('/expenseClaim/expenseRecord/initExpenseRecordData', 'POST', payload, win);
    if (res) {
        if (res.success && res.data) {
            return res.data;
        }
        if (res.success === false) {
            throw new Error(`初始化费用类型失败: ${res.message || '后端异常'}`);
        }
    }
    res = await apiRequest('/fssc/expenseClaim/expenseRecord/initExpenseRecordData', 'POST', payload, state);
    if (!res || !res.success) {
        throw new Error(res?.message || '初始化费用类型失败');
    }
    return res.data || {};
}

export async function createDraftExpenseRecordFromInvoiceApi(
    invoiceVO: any,
    boDataId: string,
    state: GlobalState,
    subInvoices?: InvoiceItem[]
) {
    const list: any[] = [{
        invoiceVO: invoiceVO || {},
        invoiceDataId: boDataId || (invoiceVO ? (invoiceVO.invoiceDataId || invoiceVO.invoiceId) : '')
    }];
    if (subInvoices && subInvoices.length > 0) {
        for (const sub of subInvoices) {
            list.push({
                invoiceVO: sub.invoiceVO || {},
                invoiceDataId: sub.boDataId || (sub.invoiceVO ? (sub.invoiceVO.invoiceDataId || sub.invoiceVO.invoiceId) : '')
            });
        }
    }
    const payload = {
        expenseRecordInvoiceList: list
    };
    const res = await apiRequest('/fssc/expenseClaim/expenseRecord/initAndSaveExpenseRecordData', 'POST', payload, state);
    if (res.data && res.data.expenseRecordId) {
        return res.data.expenseRecordId;
    }
    if (Array.isArray(res.data) && res.data.length > 0 && res.data[0]?.expenseRecordId) {
        return res.data[0].expenseRecordId;
    }
    if (typeof res.data === 'string' && res.data.length > 10) {
        return res.data;
    }
    throw new Error(res.message || '初始化发票草稿失败');
}

/**
 * 执行费用记录规则联动重算 (Butterfly Effect / fieldValueChange)
 * 典型场景：出差城市选择后，后端规则自动推导住宿城市类型 (F_ZSC_DEF_001) 与费用标准金额 (STANDARD_VALUE)
 */
export async function executeExpenseRecordFieldValueChangeApi(
    fieldId: string,
    fieldName: string,
    columnCode: string,
    fieldValue: any,
    expenseTypeId: string,
    rowDatas: any,
    state: GlobalState,
    win?: Window | null
): Promise<any> {
    const payload = {
        fieldId: fieldId || '0356c803fdbde1653e55bb00bc610006',
        fieldName: fieldName || '出差城市',
        columnCode: columnCode || 'CITY',
        fieldValue: fieldValue,
        recordDataVO: {
            accountCurrencyId: state.accountCurrencyId || '6e589eb2dd9f11e8b5a69590a14a4e34',
            expenseTypeId: expenseTypeId || '0356c4e2b72de1653e55bb00bc610001',
            rowDatas: rowDatas,
            expenseRecordMessageList: []
        }
    };

    try {
        const nativeRes = await callNativeHttp(
            '/expenseClaim/expenseRecordRuleExecute/fieldValueChange',
            'POST',
            payload,
            win
        );
        if (nativeRes) {
            if (nativeRes.success && nativeRes.data) {
                return nativeRes.data.rowDatas || nativeRes.data.recordDataVO?.rowDatas || nativeRes.data;
            }
            if (nativeRes.success === false) {
                AutopilotLogger.warn(`[expenseRecordFieldValueChange] 原生联动规则校验提示: ${nativeRes.message || ''}`);
                return null;
            }
        }
    } catch (e: any) {
        AutopilotLogger.warn(`[expenseRecordFieldValueChange] 原生请求异常: ${e?.message || e}`);
    }

    try {
        const res = await apiRequest(
            '/fssc/expenseClaim/expenseRecordRuleExecute/fieldValueChange',
            'POST',
            payload,
            state
        );
        if (res && res.success && res.data) {
            return res.data.rowDatas || res.data.recordDataVO?.rowDatas || res.data;
        }
    } catch (e: any) {
        AutopilotLogger.warn(`[expenseRecordFieldValueChange] API 请求异常: ${e?.message || e}`);
    }

    return null;
}

export async function saveFinalExpenseRecordApi(
    expenseRecordId: string,
    expenseTypeId: string,
    rowDatas: any,
    version: number,
    state: GlobalState,
    fallbackApplicantId?: string,
    win?: Window | null
) {
    const applicantId = fallbackApplicantId ||
        rowDatas?.APPLICANT_ID?.value?.value ||
        state.currentUser?.userId ||
        state.applicantId ||
        (typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem('userId') || sessionStorage.getItem('loginUserId')) : '') || '';

    const payload = {
        expenseRecordId,
        expenseTypeId,
        rowDatas,
        version: version || 1,
        operationType: 'UPDATE',
        applicantId: applicantId || undefined,
        accountCurrencyId: state.accountCurrencyId || '6e589eb2dd9f11e8b5a69590a14a4e34',
        dimensionMappingQueryVOList: [],
        expenseRecordMessageList: []
    };

    const extractAndThrowValidationErrors = (resp: any) => {
        if (!resp) return;
        const msgList = resp.data?.expenseRecordMessageList || resp.expenseRecordMessageList || [];
        const errList = Array.isArray(msgList) ? msgList.filter((m: any) => m.messageType === 'ERROR' || m.messageType === 'FAIL') : [];
        if (errList.length > 0) {
            const detail = errList.map((e: any) => e.message || '未知错误').join('; ');
            throw new Error(`保存校验拦截: ${detail}`);
        }
        if (resp.data?.expenseRecordTypeMessageVO?.errorMessages?.length > 0) {
            throw new Error(`保存校验拦截: ${resp.data.expenseRecordTypeMessageVO.errorMessages.join('; ')}`);
        }
    };

    let res: any = await callNativeHttp('/expenseClaim/expenseRecord/validateAndSaveExpenseRecord', 'POST', payload, win);
    if (res) {
        extractAndThrowValidationErrors(res);
        if (res.success) {
            return res.data;
        }
        // 原生客户端明确返回失败时，直接抛出真实业务报错，绝对不可降级到无签名的 apiRequest (防止网关将缺少 eicds 签名的请求误报为“登录失效”)
        throw new Error(res.message || '保存费用明细失败');
    }

    // 仅在完全没有原生客户端的环境下进行备用降级
    res = await apiRequest('/fssc/expenseClaim/expenseRecord/validateAndSaveExpenseRecord', 'POST', payload, state);
    if (!res || !res.success) {
        throw new Error(res?.message || '保存费用明细失败');
    }
    extractAndThrowValidationErrors(res);
    return res.data;
}

export async function deleteExpenseRecordListApi(selectedIds: string[], state: GlobalState): Promise<any> {
    if (!selectedIds || selectedIds.length === 0) return { success: true };
    return await apiRequest('/fssc/expenseClaim/expenseRecord/deleteExpenseRecordList', 'POST', selectedIds, state);
}

export async function deleteInvoiceBOListApi(invoiceIds: string[], state: GlobalState): Promise<any> {
    if (!invoiceIds || invoiceIds.length === 0) return { success: true };
    try {
        const res = await apiRequest(
            '/fssc/expenseClaim/expenseRecordInvoice/invoiceBOListDelete',
            'POST',
            invoiceIds,
            state
        );
        if (res && res.success) {
            return res;
        }
    } catch (e: any) {
        // 若发票处于“已生成费用但下游费用已死”的死锁状态，接口会拦截并提示“该发票已报销，禁止删除”
        // 此时自动降级至 BO 底座物理删除接口 deleteBoByBoMainId 强制解套
    }
    for (const id of invoiceIds) {
        await apiRequest(
            '/fssc/bo/bodata/deleteBoByBoMainId',
            'POST',
            `boMainId=${encodeURIComponent(id)}`,
            state,
            true
        );
    }
    return { data: [], message: '删除成功！', success: true };
}

/**
 * 通用单条费用记录保存入库（支持全部 15 种费用类型，支持一笔费用多张发票）
 */
export async function saveSingleExpenseItemApi(row: InvoiceItem, state: GlobalState): Promise<string> {
    // 1. 确定 targetExpenseType
    let targetTypeConfig = ALL_EXPENSE_TYPE_LIST.find(t => t.id === row.expenseTypeId || t.code === row.expenseTypeCode);
    if (!targetTypeConfig) {
        if (row.type && EXPENSE_TYPES[row.type as keyof typeof EXPENSE_TYPES]) {
            targetTypeConfig = EXPENSE_TYPES[row.type as keyof typeof EXPENSE_TYPES];
        } else {
            targetTypeConfig = EXPENSE_TYPES.TAXI;
        }
    }

    // 2. 检查并实例化草稿（支持一笔费用挂载多张发票草稿初始化）
    let recordId = row.expenseRecordId;
    if (!recordId) {
        recordId = await createDraftExpenseRecordFromInvoiceApi(
            row.invoiceVO,
            row.boDataId || row.invoiceVO?.invoiceDataId,
            state,
            row.subInvoices
        );
        row.expenseRecordId = recordId;
    }

    // 3. 获取版本与基础数据 (乐观锁)
    const ruleData = await getExpenseTypeRuleAndRowDatasApi(recordId, 'UNIDENTIFIED', state);
    const version = ruleData.version !== undefined ? ruleData.version : 1;
    const baseRowDatas = ruleData.rowDatas || {};

    // 4. 切换费用类型初始化 rowDatas
    const initData = await initExpenseRecordWithTypeApi(recordId, targetTypeConfig.id, baseRowDatas, state);
    const rowDatas = initData.rowDatas || {};

    // 5. 回填各类型字段数据
    // 5. 回填各类型字段数据
    const isHotel = targetTypeConfig?.code === EXPENSE_TYPES.HOTEL.code || targetTypeConfig?.id === EXPENSE_TYPES.HOTEL.id || row.type === 'HOTEL';
    const isFlight = targetTypeConfig?.code === EXPENSE_TYPES.FLIGHT.code || targetTypeConfig?.id === EXPENSE_TYPES.FLIGHT.id || row.type === 'FLIGHT';
    const isTrain = targetTypeConfig?.code === EXPENSE_TYPES.TRAIN.code || targetTypeConfig?.id === EXPENSE_TYPES.TRAIN.id || row.type === 'TRAIN';
    const isComm = targetTypeConfig?.code === EXPENSE_TYPES.COMMUNICATION.code || targetTypeConfig?.code === EXPENSE_TYPES.COMMUNICATION_FAX.code || row.type === 'COMMUNICATION';

    const cleanPeriod = (row.period || computePeriod(row.invoiceDate || '', isComm)).replace(/^期间[：:]\s*/, '').trim();

    if (rowDatas.DESCRIPTION) {
        rowDatas.DESCRIPTION.value = row.description ? row.description.trim() : '';
    }
    if (rowDatas.F_ZY_DEF_001) {
        rowDatas.F_ZY_DEF_001.value = isComm ? (cleanPeriod.length >= 7 ? cleanPeriod.substring(0, 7) : cleanPeriod) : cleanPeriod;
    }

    const normDate = row.invoiceDate ? normalizeDate(row.invoiceDate) : '';
    if (rowDatas.BUSINESS_DATE && normDate && !rowDatas.BUSINESS_DATE.value) {
        rowDatas.BUSINESS_DATE.value = `${normDate} 00:00:00`;
    }

    if (isComm) {
        const yyyy_mm = cleanPeriod.length >= 7 ? cleanPeriod.substring(0, 7) : computePeriod(row.invoiceDate || '', true);
        if (rowDatas.FLIGHT_START_DATE) rowDatas.FLIGHT_START_DATE.value = `${yyyy_mm}-01 00:00:00`;
        if (row.attachments && row.attachments.length > 0) {
            rowDatas.expenseRecordAttachmentList = { value: row.attachments };
            const firstAtt = row.attachments[0];
            if (rowDatas.ATTACH_NAME) rowDatas.ATTACH_NAME.value = (firstAtt.fileName || '账单').replace(/\.[^/.]+$/, "");
            if (rowDatas.ATTACH_COUNT) rowDatas.ATTACH_COUNT.value = row.attachments.length;
        }
    } else if (isHotel) {
        const checkIn = row.checkInDate ? normalizeDate(row.checkInDate) : normDate;
        const checkOut = row.checkOutDate ? normalizeDate(row.checkOutDate) : normDate;
        let stayDays = row.stayDays || 1;
        if ((!stayDays || stayDays <= 0) && checkIn && checkOut) {
            const d1 = new Date(checkIn).getTime();
            const d2 = new Date(checkOut).getTime();
            const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
            stayDays = diff > 0 ? diff : 1;
        }

        const roomNum = Math.max(1, Number((row as any).roomNum) || 1);
        const totalAmount = (row.amount && row.amount > 0) ? row.amount : (rowDatas.AMOUNT?.value?.amount || 0);
        const totalRoomNights = Math.max(1, stayDays * roomNum);
        const unitPriceVal = Math.round((totalAmount / totalRoomNights) * 100) / 100;

        if (rowDatas.HOTEL_NAME) rowDatas.HOTEL_NAME.value = row.hotelName || row.endAddress || '';
        if (rowDatas.CHECK_IN_DATE && checkIn) rowDatas.CHECK_IN_DATE.value = `${checkIn} 00:00:00`;
        if (rowDatas.CHECK_OUT_DATE && checkOut) rowDatas.CHECK_OUT_DATE.value = `${checkOut} 00:00:00`;
        if (rowDatas.STAY_DAYS) rowDatas.STAY_DAYS.value = stayDays;
        if (rowDatas.ROOM_NUM) rowDatas.ROOM_NUM.value = roomNum;

        if (rowDatas.UNIT_PRICE) {
            rowDatas.UNIT_PRICE.value = {
                amount: unitPriceVal,
                currencyId: state.accountCurrencyId || '6e589eb2dd9f11e8b5a69590a14a4e34',
                currencySymbol: '¥'
            };
        }

        // 动态城市维表匹配与 IV住宿区分 联动
        let targetCity = (row.city || row.startAddress || '').replace(/省|市|（.*）|\(.*\)/g, '').trim();
        if ((!targetCity || /亚朵|全季|上引|如家|汉庭|锦江|美悦|出差/.test(targetCity)) && row.hotelName) {
            const innerMatch = row.hotelName.match(/[（(]([\u4e00-\u9fa5]{2,3}?)(?:市|区|镇|县|店|新区|经开区|[\u4e00-\u9fa5]*?店)/);
            if (innerMatch && !/金山|中山|国家|滨湖|云谷|金融|台山|白山|会展/.test(innerMatch[1])) {
                targetCity = innerMatch[1];
            } else {
                const prefixMatch = row.hotelName.match(/^([\u4e00-\u9fa5]{2,3}?)(?:市|酒店|宾馆|饭店|客栈)/);
                if (prefixMatch && !/亚朵|全季|上引|如家|汉庭|锦江|美悦|希尔|万豪|洲际|格林|维也|桔子|宜必|凯悦|喜来|香格/.test(prefixMatch[1])) {
                    targetCity = prefixMatch[1];
                }
            }
        }
        if (targetCity === '金山') targetCity = '上海';

        if (targetCity) {
            try {
                const cityVO = await fetchCityVO(targetCity, state, '6b8ff0649ebe11e88b72df10cd5db793');
                if (cityVO && cityVO.value) {
                    rowDatas.CITY = {
                        dataType: 'DROPDOWN',
                        required: true,
                        value: {
                            value: cityVO.value,
                            title: { zh_CN: (cityVO.title && cityVO.title.zh_CN) || targetCity }
                        }
                    };
                }
            } catch (e) { }

            const isTier1 = /北京|上海|广州|深圳/.test(targetCity);
            rowDatas.F_ZSC_DEF_001 = {
                dataType: 'DROPDOWN',
                required: true,
                value: {
                    value: isTier1 ? '035a402fee2345af7f1906ec05cc0000' : '035a403ff62345af7f1906ec05cc0000',
                    title: { zh_CN: isTier1 ? '境内-北上广深' : '境内-其他' }
                }
            };
        }
    } else if (isFlight) {
        if (rowDatas.START_ADDRESS) rowDatas.START_ADDRESS.value = row.startAddress || '';
        if (rowDatas.END_ADDRESS) rowDatas.END_ADDRESS.value = row.endAddress || '';
        if (rowDatas.FLIGHT_START_DATE && normDate) rowDatas.FLIGHT_START_DATE.value = `${normDate} 00:00:00`;
        if (rowDatas.FLIGHT_END_DATE && normDate && !rowDatas.FLIGHT_END_DATE.value) rowDatas.FLIGHT_END_DATE.value = `${normDate} 00:00:00`;
        if (rowDatas.FLIGHT_FROM_CITY) rowDatas.FLIGHT_FROM_CITY.value = row.startAddress || '';
        if (rowDatas.FLIGHT_TO_CITY) rowDatas.FLIGHT_TO_CITY.value = row.endAddress || '';
    } else if (isTrain) {
        if (rowDatas.START_ADDRESS) rowDatas.START_ADDRESS.value = row.startAddress || '';
        if (rowDatas.END_ADDRESS) rowDatas.END_ADDRESS.value = row.endAddress || '';
        if (rowDatas.TRAIN_START_DATE && normDate) rowDatas.TRAIN_START_DATE.value = `${normDate} 00:00:00`;
    } else {
        // TAXI / TRIP_TAXI / OTHER
        if (rowDatas.START_ADDRESS) rowDatas.START_ADDRESS.value = row.startAddress || 'IVISION';
        if (rowDatas.END_ADDRESS) rowDatas.END_ADDRESS.value = row.endAddress || 'CMP';
    }

    if (rowDatas.AMOUNT && rowDatas.AMOUNT.value) {
        if (rowDatas.AMOUNT.value.amount === undefined || rowDatas.AMOUNT.value.amount === null || rowDatas.AMOUNT.value.amount === 0) {
            rowDatas.AMOUNT.value.amount = row.amount;
        }
    }

    // 5.1 处理一笔费用多张发票绑定（例如出租车 + 过路费/通行费发票）
    if (row.subInvoices && row.subInvoices.length > 0) {
        // 先清理被合并子发票的冗余独立草稿记录，释放发票占用
        const redundantDraftIds = row.subInvoices
            .map(s => s.expenseRecordId)
            .filter((id): id is string => Boolean(id) && id !== recordId);
        if (redundantDraftIds.length > 0) {
            try {
                AutopilotLogger.info(`[ExpenseService] 释放被合并子发票原独立草稿: ${JSON.stringify(redundantDraftIds)}`);
                await deleteExpenseRecordListApi(redundantDraftIds, state);
                row.subInvoices.forEach(s => { s.expenseRecordId = undefined; });
            } catch (e: any) {
                AutopilotLogger.warn(`[ExpenseService] 释放子发票草稿异常: ${e.message}`);
            }
        }

        if (!rowDatas.expenseRecordInvoiceList) {
            rowDatas.expenseRecordInvoiceList = { value: [] };
        }
        if (!Array.isArray(rowDatas.expenseRecordInvoiceList.value)) {
            rowDatas.expenseRecordInvoiceList.value = [];
        }

        const existingInvIds = new Set<string>();
        const existingInvNos = new Set<string>();
        rowDatas.expenseRecordInvoiceList.value.forEach((x: any) => {
            if (x.invoiceId) existingInvIds.add(String(x.invoiceId));
            if (x.invoiceVO?.invoiceId) existingInvIds.add(String(x.invoiceVO.invoiceId));
            if (x.invoiceVO?.invoiceDataId) existingInvIds.add(String(x.invoiceVO.invoiceDataId));
            if (x.invoiceVO?.invoiceNo) existingInvNos.add(String(x.invoiceVO.invoiceNo));
        });

        if (rowDatas.expenseRecordInvoiceList.value.length === 0 && row.invoiceVO) {
            rowDatas.expenseRecordInvoiceList.value.push({
                invoiceVO: row.invoiceVO,
                invoiceId: row.invoiceVO.invoiceId || row.boDataId || '',
                position: 1
            });
        }

        let pos = rowDatas.expenseRecordInvoiceList.value.length + 1;
        for (const sub of row.subInvoices) {
            const subVO = sub.invoiceVO || {
                amountTax: sub.amount,
                fileName: sub.fileName,
                salesName: sub.salesName,
                invoiceDate: sub.invoiceDate,
                invoiceDetails: sub.invoiceDetails || '过路费发票',
                invoiceTypeAbbreviation: '通行费'
            };
            const subId = sub.boDataId || subVO.invoiceDataId || subVO.invoiceId || '';
            const subNo = subVO.invoiceNo || '';

            if ((subId && existingInvIds.has(String(subId))) || (subNo && existingInvNos.has(String(subNo)))) {
                continue;
            }

            rowDatas.expenseRecordInvoiceList.value.push({
                invoiceVO: subVO,
                invoiceId: subId,
                position: pos++,
                createDate: subVO.createDate || new Date().toISOString().replace('T', ' ').substring(0, 19),
                version: 1
            });
            if (subId) existingInvIds.add(String(subId));
            if (subNo) existingInvNos.add(String(subNo));
        }

        const totalInvoiceCount = rowDatas.expenseRecordInvoiceList.value.length;
        if (rowDatas.INVOICE_COUNT) {
            rowDatas.INVOICE_COUNT.value = totalInvoiceCount;
        } else {
            rowDatas.INVOICE_COUNT = { dataType: 'NUMBER', hidden: true, readOnly: true, value: totalInvoiceCount };
        }
        if (rowDatas.NUM_INVOICE) {
            rowDatas.NUM_INVOICE.value = totalInvoiceCount;
        }

        const totalCombinedAmount = row.amount;
        if (rowDatas.AMOUNT && rowDatas.AMOUNT.value) {
            rowDatas.AMOUNT.value.amount = totalCombinedAmount;
            if (rowDatas.AMOUNT.value.accountAmount) {
                rowDatas.AMOUNT.value.accountAmount.amount = totalCombinedAmount;
            }
        }
        if (rowDatas.F_FPJ_DEF_001 && rowDatas.F_FPJ_DEF_001.value) {
            rowDatas.F_FPJ_DEF_001.value.amount = totalCombinedAmount;
            if (rowDatas.F_FPJ_DEF_001.value.accountAmount) {
                rowDatas.F_FPJ_DEF_001.value.accountAmount.amount = totalCombinedAmount;
            }
        }
        if (rowDatas.STANDARD_VALUE && rowDatas.STANDARD_VALUE.value !== undefined) {
            rowDatas.STANDARD_VALUE.value = totalCombinedAmount;
        }
        if (rowDatas.BUDGET_DE_AMOUNT && rowDatas.BUDGET_DE_AMOUNT.value) {
            rowDatas.BUDGET_DE_AMOUNT.value.amount = totalCombinedAmount;
        }
    }

    // 6. 保存持久化
    await saveFinalExpenseRecordApi(recordId, targetTypeConfig.id, rowDatas, version, state);
    return recordId;
}

export interface BatchExpenseSaveResult {
    total: number;
    successCount: number;
    failCount: number;
    results: Array<{ recordId: string; expenseTypeName: string; amount: number; description: string }>;
    errors: Array<{ index: number; description: string; error: string }>;
}

/**
 * 批量持久化保存多条费用明细（带进度回调与容错）
 */
export async function batchSaveExpenseItemsApi(
    items: InvoiceItem[],
    state: GlobalState,
    onProgress?: (current: number, total: number) => void
): Promise<BatchExpenseSaveResult> {
    const results: Array<{ recordId: string; expenseTypeName: string; amount: number; description: string }> = [];
    const errors: Array<{ index: number; description: string; error: string }> = [];
    let successCount = 0;
    let failCount = 0;

    // 0. 前置批量物理清理：若存在已被合并入出租车的过路费独立草稿，提前释放
    const redundantRecordIds: string[] = [];
    for (const item of items) {
        if (item.subInvoices && item.subInvoices.length > 0) {
            for (const sub of item.subInvoices) {
                if (sub.expenseRecordId && !redundantRecordIds.includes(sub.expenseRecordId)) {
                    redundantRecordIds.push(sub.expenseRecordId);
                }
            }
        }
    }
    if (redundantRecordIds.length > 0) {
        AutopilotLogger.info(`[ExpenseService] 批量保存前释放 ${redundantRecordIds.length} 笔冗余过路费草稿`);
        try {
            await deleteExpenseRecordListApi(redundantRecordIds, state);
            for (const item of items) {
                if (item.subInvoices) {
                    item.subInvoices.forEach(s => { s.expenseRecordId = undefined; });
                }
            }
        } catch (e: any) {
            AutopilotLogger.warn(`[ExpenseService] 批量清理冗余过路费草稿异常: ${e.message}`);
        }
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
            const recId = await saveSingleExpenseItemApi(item, state);
            item.status = '成功';
            item.isModified = false;
            successCount++;
            results.push({
                recordId: recId,
                expenseTypeName: item.expenseTypeName || item.type || '',
                amount: item.amount,
                description: item.description || ''
            });
        } catch (err: any) {
            item.status = '失败';
            failCount++;
            errors.push({
                index: i,
                description: item.description || `第 ${i + 1} 笔`,
                error: err.message || '保存失败'
            });
        }
        if (onProgress) onProgress(i + 1, items.length);
        await new Promise(r => setTimeout(r, 200));
    }

    return {
        total: items.length,
        successCount,
        failCount,
        results,
        errors
    };
}

export interface ExpenseRecordAuditReport {
    total: number;
    errorCount: number;
    validCount: number;
    errorSummary: Record<string, number>;
    errorRecords: Array<{
        recordId: string;
        expenseTypeName: string;
        amount: number;
        description: string;
        errorMessages: string[];
    }>;
}

/**
 * Agentic 全量主动审计费用记录（检测 getExpenseRecordListBySearchVO 返回的 errorMessages）
 */
export async function auditExpenseRecordsApi(state: GlobalState): Promise<ExpenseRecordAuditReport> {
    // 强制穿透查询最新的宿主费用记录
    state.lastInterceptedExpenseRecords = null;
    const rawList = await queryExpenseRecordListApi(state);
    const errorRecords: any[] = [];
    const errorSummary: Record<string, number> = {};

    for (const item of rawList) {
        const msgs = item.expenseRecordTypeMessageVO?.errorMessages;
        if (msgs && msgs.length > 0) {
            errorRecords.push({
                recordId: item.expenseRecordId,
                expenseTypeName: item.expenseType?.title?.zh_CN || item.expenseTypeName || '未分类',
                amount: item.amountObj?.amount || 0,
                description: item.description || '',
                errorMessages: msgs
            });
            msgs.forEach((m: string) => {
                errorSummary[m] = (errorSummary[m] || 0) + 1;
            });
        }
    }

    return {
        total: rawList.length,
        errorCount: errorRecords.length,
        validCount: rawList.length - errorRecords.length,
        errorSummary,
        errorRecords
    };
}

/**
 * Agentic 智能自愈修复费用记录错误（如补全出差城市维表、联动北上广深住宿区分）
 */
export async function autoFixExpenseRecordsApi(state: GlobalState): Promise<{
    fixedCount: number;
    failCount: number;
    details: Array<{ recordId: string; fixApplied: string; success: boolean; error?: string }>;
    remainingAudit: ExpenseRecordAuditReport;
}> {
    const audit = await auditExpenseRecordsApi(state);
    const details: any[] = [];
    let fixedCount = 0;
    let failCount = 0;

    if (audit.errorCount === 0) {
        return {
            fixedCount: 0,
            failCount: 0,
            details: [],
            remainingAudit: audit
        };
    }

    // 动态提取差旅波次中的目的城市集合
    const dynamicTripCities = Array.from(new Set([
        ...(state.tripApp?.configs || []).map(c => c.destination),
        ...(state.expensePlan?.matchedTrips || []).map(t => t.destination || (t as any).destCity),
        ...(state.invoices || []).map(i => i.city)
    ])).filter(Boolean) as string[];

    for (const errRec of audit.errorRecords) {
        const recId = errRec.recordId;
        try {
            // 获取最新 rowDatas 与版本号
            const ruleData = await getExpenseTypeRuleAndRowDatasApi(recId, '0356c4e2b72de1653e55bb00bc610001', state);
            const rowDatas = ruleData.rowDatas || {};
            const version = ruleData.version || 1;
            let fixApplied = '';

            // 1. 修复【出差城市必填】
            if (errRec.errorMessages.includes('出差城市必填')) {
                let targetCity = '';
                const desc = errRec.description || '';

                // 优先从已对齐行程波次或发票池中匹配
                if (state.expensePlan?.records) {
                    const matchedInv = state.expensePlan.records.find(r => r.expenseRecordId === recId);
                    if (matchedInv && matchedInv.city) targetCity = matchedInv.city;
                }
                if (!targetCity && state.invoices) {
                    const matchedInv = state.invoices.find(r => r.expenseRecordId === recId);
                    if (matchedInv && matchedInv.city) targetCity = matchedInv.city;
                }

                // 其次从当前已规划行程目的城市动态匹配
                if (!targetCity && dynamicTripCities.length > 0) {
                    for (const c of dynamicTripCities) {
                        const cleanC = c.replace(/市|区|县/g, '').trim();
                        if (cleanC && desc.includes(cleanC)) {
                            targetCity = cleanC;
                            break;
                        }
                    }
                }

                // 再次从费用描述格式 [出差:姓名] YYYY-MM-DD~YYYY-MM-DD 城市客户 中抽取
                if (!targetCity) {
                    const descMatch = desc.match(/\[(?:出差|外驻):[^\]]+\]\s*\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}\s*([\u4e00-\u9fa5]{2,4}?)(?:[A-Z0-9_\-]+|模具|工厂|据点|项目|\s)/);
                    if (descMatch && descMatch[1]) {
                        targetCity = descMatch[1];
                    }
                }

                // 再次从酒店名称括号中智能抽取
                if (!targetCity && rowDatas.HOTEL_NAME && rowDatas.HOTEL_NAME.value) {
                    const innerMatch = String(rowDatas.HOTEL_NAME.value).match(/[（(]([\u4e00-\u9fa5]{2,3}?)(?:市|区|镇|县|店|新区|经开区|[\u4e00-\u9fa5]*?店)/);
                    if (innerMatch && !/金山|中山|国家|滨湖|云谷|金融|台山|白山|会展/.test(innerMatch[1])) {
                        targetCity = innerMatch[1];
                    }
                }

                // 兜底从行程波次的首个目的地推导
                if (!targetCity && dynamicTripCities.length > 0) {
                    targetCity = dynamicTripCities[0].replace(/市|区|县/g, '').trim();
                }

                // 动态获取 DIM_CITY 城市维表对象
                const cityVO = targetCity ? await fetchCityVO(targetCity, state, '6b8ff0649ebe11e88b72df10cd5db793') : null;
                if (cityVO && cityVO.value) {
                    rowDatas.CITY = {
                        dataType: 'DROPDOWN',
                        required: true,
                        value: {
                            value: cityVO.value,
                            title: { zh_CN: (cityVO.title && cityVO.title.zh_CN) || targetCity }
                        }
                    };

                    const isTier1 = /北京|上海|广州|深圳/.test(targetCity);
                    rowDatas.F_ZSC_DEF_001 = {
                        dataType: 'DROPDOWN',
                        required: true,
                        value: {
                            value: isTier1 ? '035a402fee2345af7f1906ec05cc0000' : '035a403ff62345af7f1906ec05cc0000',
                            title: { zh_CN: isTier1 ? '境内-北上广深' : '境内-其他' }
                        }
                    };
                    fixApplied += `自动补齐出差城市【${targetCity}】(${cityVO.value})及住宿区分; `;
                }
            }

            if (fixApplied) {
                await saveFinalExpenseRecordApi(recId, '0356c4e2b72de1653e55bb00bc610001', rowDatas, version, state);
                fixedCount++;
                details.push({ recordId: recId, fixApplied, success: true });
            } else {
                details.push({ recordId: recId, fixApplied: '未匹配到可自动修复的规则', success: false });
            }
        } catch (e: any) {
            failCount++;
            details.push({ recordId: recId, fixApplied: '自愈保存异常', success: false, error: e.message });
        }
        await new Promise(r => setTimeout(r, 150));
    }

    state.lastInterceptedExpenseRecords = null;
    const remainingAudit = await auditExpenseRecordsApi(state);

    return {
        fixedCount,
        failCount,
        details,
        remainingAudit
    };
}

export interface DynamicExpenseFieldValues {
    // 住宿费 (宿泊代)
    checkInDate?: string;
    checkOutDate?: string;
    city?: string;
    cityType?: string; // 住宿城市类型 (如: 境内-北上广深 / 境内-其他)
    hotelName?: string;
    roomNum?: number;
    overStandardDescription?: string;

    // 飞机票 (航空券)
    flightStartDate?: string;
    flightEndDate?: string;
    flightFromCity?: string;
    flightToCity?: string;
    flightNum?: string;

    // 火车公交车票
    trainStartDate?: string;
    trainEndDate?: string;
    trainFromStation?: string;
    trainToStation?: string;
    trainNum?: string;

    // 交通/出租车
    startAddress?: string;
    endAddress?: string;

    // 通信费
    billMonth?: string;

    // 额外说明 / 业务事由
    extraDesc?: string;
    [key: string]: any;
}

function extractDropdownText(val: any): string {
    if (!val) return '';
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number') return String(val);
    if (typeof val === 'object') {
        if (val.title) {
            if (typeof val.title === 'string' && val.title.trim()) return val.title.trim();
            if (val.title.zh_CN && String(val.title.zh_CN).trim()) return String(val.title.zh_CN).trim();
            if (val.title.zh_TW && String(val.title.zh_TW).trim()) return String(val.title.zh_TW).trim();
            if (val.title.en_US && String(val.title.en_US).trim()) return String(val.title.en_US).trim();
        }
        if (val.label && typeof val.label === 'string' && val.label.trim()) return val.label.trim();
        if (val.name && typeof val.name === 'string' && val.name.trim()) return val.name.trim();
        if (val.value !== undefined && val.value !== null) {
            const vStr = String(val.value).trim();
            if (!/^[0-9a-fA-F]{32}$/.test(vStr) || (!val.title?.zh_CN && !val.label)) {
                return vStr;
            }
        }
    }
    return '';
}

function extractDateOnly(val: any): string {
    if (!val) return '';
    const str = String(val).trim();
    return normalizeDate(str) || '';
}

/**
 * 全方位探测并提取超标说明 (兼容 rowDatas、rec 列表项及详情 fullData 中的所有变体字段与数据包装)
 */
export function extractOverStandardDescription(rowDatas: any, rec?: any, fullData?: any): string {
    const isMeaningful = (s: any): boolean => {
        if (!s || typeof s !== 'string') return false;
        const clean = s.trim();
        return clean.length > 0 && clean !== 'true' && clean !== 'false' && clean !== '是' && clean !== '否' && clean !== '[object Object]';
    };

    const tryExtract = (cand: any): string => {
        if (!cand) return '';
        if (typeof cand === 'string' && isMeaningful(cand)) return cand.trim();
        if (typeof cand === 'object') {
            if (cand.value !== undefined && cand.value !== null) {
                if (typeof cand.value === 'string' && isMeaningful(cand.value)) return cand.value.trim();
                const dt = extractDropdownText(cand.value);
                if (isMeaningful(dt)) return dt;
            }
            if (cand.showValue && typeof cand.showValue === 'string' && isMeaningful(cand.showValue)) return cand.showValue.trim();
            if (cand.text && typeof cand.text === 'string' && isMeaningful(cand.text)) return cand.text.trim();
            const dt = extractDropdownText(cand);
            if (isMeaningful(dt)) return dt;
        }
        return '';
    };

    // 1. rowDatas 常见别名
    const rowCandidates = [
        rowDatas?.OVER_STANDARD_DESCRIPTION,
        rowDatas?.OVER_STANDARD_REASON,
        rowDatas?.OVER_STANDARD_DESC,
        rowDatas?.OVER_STAND_DESC,
        rowDatas?.EXCEED_STANDARD_DESCRIPTION,
        rowDatas?.EXCEED_STANDARD_REASON,
        rowDatas?.OVER_REASON,
        rowDatas?.REASON_OVER_STANDARD,
        rowDatas?.OVER_STANDARD_MEMO,
        rowDatas?.F_OVER_STANDARD_DESC,
        rowDatas?.F_OVER_STANDARD_REASON,
        rowDatas?.F_ZSC_DEF_002
    ];
    for (const c of rowCandidates) {
        const val = tryExtract(c);
        if (val) return val;
    }

    // 2. rowDatas 正则模糊扫描 (防止租户自定义别名)
    if (rowDatas && typeof rowDatas === 'object') {
        for (const [key, field] of Object.entries(rowDatas)) {
            if (/OVER.*STAND|EXCEED.*STAND|超标/i.test(key)) {
                const val = tryExtract(field);
                if (val) return val;
            }
        }
    }

    // 3. rec (宿主列表项) 探测
    const recCandidates = [
        rec?.overStandardDescription,
        rec?.overStandardReason,
        rec?.overStandardDesc,
        rec?.overStandardRemark,
        rec?.OVER_STANDARD_DESCRIPTION,
        rec?.OVER_STANDARD_REASON,
        rec?.exceedStandardDescription,
        rec?.exceedStandardReason,
        rec?.rowDatas?.OVER_STANDARD_DESCRIPTION
    ];
    for (const c of recCandidates) {
        const val = tryExtract(c);
        if (val) return val;
    }

    // 4. fullData (详情接口完整响应) 探测
    const fullCandidates = [
        fullData?.expenseRecord?.overStandardDescription,
        fullData?.expenseRecord?.overStandardReason,
        fullData?.expenseRecord?.OVER_STANDARD_DESCRIPTION,
        fullData?.expenseRecord?.OVER_STANDARD_REASON,
        fullData?.overStandardDescription,
        fullData?.overStandardReason,
        fullData?.mainData?.overStandardDescription,
        fullData?.mainData?.OVER_STANDARD_DESCRIPTION
    ];
    for (const c of fullCandidates) {
        const val = tryExtract(c);
        if (val) return val;
    }

    return '';
}

/**
 * 从 YuanNian 费用记录行数据 (rowDatas) 中精准提取已持久化保存的动态必填字段
 */
export function extractSavedDynamicFields(rowDatas: any, rec?: any, fullData?: any): DynamicExpenseFieldValues {
    if (!rowDatas || typeof rowDatas !== 'object') return {};
    const dyn: DynamicExpenseFieldValues = {};

    // 1. 住宿费
    if (rowDatas.CHECK_IN_DATE?.value) {
        dyn.checkInDate = extractDateOnly(rowDatas.CHECK_IN_DATE.value);
    }
    if (rowDatas.CHECK_OUT_DATE?.value) {
        dyn.checkOutDate = extractDateOnly(rowDatas.CHECK_OUT_DATE.value);
    }
    if (rowDatas.CITY?.value) {
        dyn.city = extractDropdownText(rowDatas.CITY.value);
    }
    if (rowDatas.F_ZSC_DEF_001?.value) {
        dyn.cityType = extractDropdownText(rowDatas.F_ZSC_DEF_001.value);
    }
    if (dyn.city && !dyn.cityType) {
        const c = dyn.city.replace(/市|区|县/g, '').trim();
        const isTier1 = /北京|上海|广州|深圳/.test(c);
        dyn.cityType = isTier1 ? '境内-北上广深' : '境内-其他';
    }
    if (rowDatas.HOTEL_NAME?.value) {
        dyn.hotelName = String(rowDatas.HOTEL_NAME.value).trim();
    }
    if (rowDatas.ROOM_NUM?.value !== undefined && rowDatas.ROOM_NUM?.value !== null) {
        dyn.roomNum = Number(rowDatas.ROOM_NUM.value) || 1;
    }
    
    // 超标说明 (全方位探测提取)
    const overDesc = extractOverStandardDescription(rowDatas, rec, fullData);
    if (overDesc) {
        dyn.overStandardDescription = overDesc;
    }

    // 2. 飞机票
    if (rowDatas.FLIGHT_START_DATE?.value) {
        dyn.flightStartDate = extractDateOnly(rowDatas.FLIGHT_START_DATE.value);
    }
    if (rowDatas.FLIGHT_END_DATE?.value) {
        dyn.flightEndDate = extractDateOnly(rowDatas.FLIGHT_END_DATE.value);
    }
    if (rowDatas.FLIGHT_FROM_CITY?.value) {
        dyn.flightFromCity = extractDropdownText(rowDatas.FLIGHT_FROM_CITY.value);
    }
    if (rowDatas.FLIGHT_TO_CITY?.value) {
        dyn.flightToCity = extractDropdownText(rowDatas.FLIGHT_TO_CITY.value);
    }
    if (rowDatas.FLIGHT_NUM?.value) {
        dyn.flightNum = String(rowDatas.FLIGHT_NUM.value).trim();
    }

    // 3. 火车票
    if (rowDatas.TRAIN_START_DATE?.value) {
        dyn.trainStartDate = extractDateOnly(rowDatas.TRAIN_START_DATE.value);
    }
    if (rowDatas.TRAIN_END_DATE?.value) {
        dyn.trainEndDate = extractDateOnly(rowDatas.TRAIN_END_DATE.value);
    }
    if (rowDatas.TRAIN_FROM_CITY?.value) {
        dyn.trainFromStation = extractDropdownText(rowDatas.TRAIN_FROM_CITY.value);
    } else if (rowDatas.START_ADDRESS?.value) {
        dyn.trainFromStation = String(rowDatas.START_ADDRESS.value).trim();
    }
    if (rowDatas.TRAIN_TO_CITY?.value) {
        dyn.trainToStation = extractDropdownText(rowDatas.TRAIN_TO_CITY.value);
    } else if (rowDatas.END_ADDRESS?.value) {
        dyn.trainToStation = String(rowDatas.END_ADDRESS.value).trim();
    }
    if (rowDatas.TRAIN_NUM?.value) {
        dyn.trainNum = String(rowDatas.TRAIN_NUM.value).trim();
    }

    // 4. 出租车/交通
    if (rowDatas.START_ADDRESS?.value) {
        dyn.startAddress = String(rowDatas.START_ADDRESS.value).trim();
    }
    if (rowDatas.END_ADDRESS?.value) {
        dyn.endAddress = String(rowDatas.END_ADDRESS.value).trim();
    }

    // 5. 通信费
    if (rowDatas.BILL_MONTH?.value) {
        dyn.billMonth = String(rowDatas.BILL_MONTH.value).trim();
    } else if (rowDatas.F_ZY_DEF_001?.value) {
        const p = String(rowDatas.F_ZY_DEF_001.value).replace(/^期间[：:]\s*/, '').trim();
        if (/^\d{4}-\d{2}$/.test(p)) {
            dyn.billMonth = p;
        }
    }

    return dyn;
}

/**
 * 标准化费用记录状态为中文显示
 * 彻底解决系统底层 REIMBURSE / ALREADY_REIMBURSE / NO_REIMBURSE 显示为英文的问题
 */
export function normalizeExpenseStatus(status?: string): string {
    if (!status) return '未报销';
    const s = String(status).trim().toUpperCase();
    if (s === 'NO_REIMBURSE' || s === 'UNREIMBURSED' || s === 'DRAFT' || s === '未报销') {
        return '未报销';
    }
    if (s === 'REIMBURSING' || s === 'IN_REIMBURSE' || s === '报销中') {
        return '报销中';
    }
    if (s === 'REIMBURSE' || s === 'ALREADY_REIMBURSE' || s === 'ALREADY_REIMBURSED' || s === 'REIMBURSED' || s === '已报销') {
        return '已报销';
    }
    return status;
}

// ==========================================
// 8. 费用记录与关联发票全量明细核对导出体系 (Excel CSV)
// ==========================================

export interface ExpenseRecordExportRow {
    // 费用主表信息
    expenseRecordId: string;
    expenseTypeId?: string;
    status: string;
    expenseTypeName: string;
    expenseAmount: number | string;
    businessDate: string;
    description: string;
    newDescription?: string;
    invoiceCount: number;
    applicantName: string;
    createDate: string;

    // 已持久化保存的动态字段与完整行数据 (解决重新打开弹窗时数据丢失重置为空的问题)
    savedDynamicFields?: DynamicExpenseFieldValues;
    savedRowDatas?: any;

    // 发票附件照片 ID (用于悬浮无阻遮挡预览：attachmentId 优先为 OCR 裁切单张特写，rawAttachmentId 为原始全图)
    attachmentId?: string;
    rawAttachmentId?: string;
    invoiceDataId?: string;

    // 发票明细信息
    invoiceIndex: number;
    invoiceType: string;
    invoiceCode: string;
    invoiceNo: string;
    invoiceDate: string;
    amountTax: number | string;
    totalAmount: number | string;
    totalTax: number | string;
    departureDate: string;
    departureTime: string;
    timeGetOn?: string;
    timeGetOff: string;
    stationGetOn: string;
    stationGetOff: string;
    trainNo: string;
    salesName: string;
    purchaserName: string;
    commodityNames: string;
    fileName: string;
    remarks: string;

    // 行程与开票日期差异对比与人工核验预警
    reconciliationNote: string;
}

/**
 * 智能生成开票日期与行程日期的差异核验预警
 */
export function generateReconciliationNote(rec: any, inv: any): string {
    if (!inv || (!inv.invoiceDate && !inv.departureDate && !inv.amountTax)) {
        return '无挂载发票';
    }

    const invDate = (inv.invoiceDate || '').trim();
    const depDate = (inv.departureDate || '').trim();
    const timeOn = (inv.timeGetOn || inv.departureTime || '').trim();
    const timeOff = (inv.timeGetOff || '').trim();
    const stOn = (inv.stationGetOn || inv.from || '').trim();
    const stOff = (inv.stationGetOff || inv.to || '').trim();
    const train = (inv.trainNo || inv.trainNumber || '').trim();
    const type = (inv.invoiceTypeAbbreviation || inv.invoiceType || '').trim();
    const sales = (inv.salesName || '').trim();
    const details = (inv.invoiceDetails || inv.commodityNames || '').trim();
    const fileName = (inv.fileName || '').trim();
    const bizDate = (rec.businessDate ? rec.businessDate.split(' ')[0] : '').trim();

    const notes: string[] = [];

    // 1. 若发票中自带明确的行程出发日期 (departureDate)
    if (depDate) {
        if (invDate && depDate !== invDate) {
            let diffDaysStr = '';
            try {
                const d1 = new Date(depDate).getTime();
                const d2 = new Date(invDate).getTime();
                const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
                diffDaysStr = ` (相差 ${Math.abs(diffDays)} 天，${diffDays > 0 ? '开票晚于行程' : '开票早于行程'})`;
            } catch (e) { }
            notes.push(`⚠️ 开票日期(${invDate})与行程日期(${depDate})不一致${diffDaysStr}`);
        } else {
            notes.push(`✅ 行程日期与开票日期一致(${depDate})`);
        }
    }

    // 2. 针对火车票 / 铁路客票
    if (type.includes('火车') || details.includes('铁路') || details.includes('客票') || stOn || stOff) {
        const trainRoute = (stOn || stOff) ? ` [${stOn || '未知'} ➔ ${stOff || '未知'}]` : '';
        const trainInfo = train ? ` 车次:${train}` : '';
        const timeInfo = timeOn ? ` 出发:${timeOn}` : '';
        notes.push(`🚄 火车客票${trainRoute}${trainInfo}${timeInfo} (开票:${invDate})`);
    }
    // 3. 针对机票 / 航空客票
    else if (type.includes('飞机') || type.includes('航空') || details.includes('航空') || details.includes('机票')) {
        const flightRoute = (stOn || stOff) ? ` [${stOn || '未知'} ➔ ${stOff || '未知'}]` : '';
        const flightNo = train ? ` 航班:${train}` : '';
        const timeInfo = timeOn ? ` 起飞:${timeOn}` : '';
        notes.push(`✈️ 航空行程单${flightRoute}${flightNo}${timeInfo} (开票:${invDate})`);
    }
    // 4. 针对酒店 / 住宿发票
    else if (
        sales.includes('酒店') || sales.includes('客房') || sales.includes('宾馆') || sales.includes('饭店') ||
        sales.includes('商旅') || details.includes('住宿') || details.includes('客房') || fileName.includes('酒店') || fileName.includes('住宿')
    ) {
        notes.push(`🏨 住宿酒店发票 (开票:${invDate})，请人工核对实际入住/离店日期`);
    }
    // 5. 针对出租车发票
    else if (type.includes('出租车') || details.includes('出租车')) {
        const taxiTime = (timeOn || timeOff) ? ` [上车:${timeOn || '未知'} 下车:${timeOff || '未知'}]` : '';
        notes.push(`🚕 出租车行程${taxiTime} (开票:${invDate})`);
    }
    // 6. 针对过路费 / 通行费
    else if (type.includes('过路') || type.includes('通行') || details.includes('通行') || details.includes('通行费')) {
        notes.push(`🛣️ 高速通行费/过路费 (开票:${invDate})`);
    }
    // 7. 兜底普通/专用发票
    else {
        notes.push(`📄 发票开票日期: ${invDate || '未知'}`);
    }

    // 补充：比对费用业务日期与开票日期
    if (bizDate && invDate && bizDate !== invDate && !depDate) {
        notes.push(`ℹ️ 费用日期(${bizDate})与开票日期(${invDate})不同`);
    }

    return notes.join('； ');
}

/**
 * RFC 4180 CSV 单元格转义，防止长数字在 Excel 中变成科学计数法
 */
function escapeCsvCell(val: any, isLongCode = false): string {
    if (val === null || val === undefined) return '';
    let str = String(val).trim();
    if (!str) return '';
    // 如果是长数字（发票号码/代码/身份证等超过 10 位的连续数字），加制表符防止 Excel 科学计数法变形
    if (isLongCode && /^\d{10,}$/.test(str)) {
        return `"\t${str}"`;
    }
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * 将结构化费用记录和发票数据序列化为 Excel 友好的 CSV 格式
 */
export function convertExpenseRecordsToCsv(rows: ExpenseRecordExportRow[]): string {
    const headers = [
        '费用记录ID',
        '报销状态',
        '费用类型',
        '费用金额(元)',
        '费用业务日期',
        '费用说明',
        '发票张数',
        '发票序号',
        '发票类型',
        '发票代码',
        '发票号码',
        '开票日期',
        '价税合计(元)',
        '不含税金额(元)',
        '税额(元)',
        '行程出发日期',
        '行程出发/上车时间',
        '行程到达/下车时间',
        '始发地/出发站',
        '目的地/到达站',
        '车次/航班/车牌号',
        '销售方/酒店/服务商',
        '购买方名称',
        '货物或应税劳务名称',
        '附件文件名',
        '发票备注',
        '申请人',
        '创建时间',
        '行程与开票核对预警'
    ];

    const csvLines = [headers.map(h => escapeCsvCell(h)).join(',')];

    for (const r of rows) {
        const line = [
            escapeCsvCell(r.expenseRecordId, true),
            escapeCsvCell(r.status),
            escapeCsvCell(r.expenseTypeName),
            escapeCsvCell(r.expenseAmount),
            escapeCsvCell(r.businessDate),
            escapeCsvCell(r.description),
            escapeCsvCell(r.invoiceCount),
            escapeCsvCell(r.invoiceIndex > 0 ? `${r.invoiceIndex}/${r.invoiceCount || 1}` : '-'),
            escapeCsvCell(r.invoiceType),
            escapeCsvCell(r.invoiceCode, true),
            escapeCsvCell(r.invoiceNo, true),
            escapeCsvCell(r.invoiceDate),
            escapeCsvCell(r.amountTax),
            escapeCsvCell(r.totalAmount),
            escapeCsvCell(r.totalTax),
            escapeCsvCell(r.departureDate),
            escapeCsvCell(r.departureTime),
            escapeCsvCell(r.timeGetOff),
            escapeCsvCell(r.stationGetOn),
            escapeCsvCell(r.stationGetOff),
            escapeCsvCell(r.trainNo),
            escapeCsvCell(r.salesName),
            escapeCsvCell(r.purchaserName),
            escapeCsvCell(r.commodityNames),
            escapeCsvCell(r.fileName),
            escapeCsvCell(r.remarks),
            escapeCsvCell(r.applicantName),
            escapeCsvCell(r.createDate),
            escapeCsvCell(r.reconciliationNote)
        ];
        csvLines.push(line.join(','));
    }

    return csvLines.join('\r\n');
}

/**
 * 触发浏览器本地下载带 UTF-8 BOM 的 CSV 文件
 */
export function downloadCsvFile(csvContent: string, filename: string, targetWin?: Window | null): void {
    if (typeof window === 'undefined') return;

    const win: any = targetWin || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : (typeof window !== 'undefined' ? window : null));
    const BlobCtor = (typeof Blob !== 'undefined' ? Blob : null) || (win as any)?.Blob;
    const UrlCtor = (typeof URL !== 'undefined' ? URL : null) || (win as any)?.URL;

    // 方式 1: 优先使用 Tampermonkey 原生 GM_download（彻底免疫跨 iframe 与弹窗安全限制）
    // 注意：Chrome 中 GM_download 若传入 blob: URL 会丢失自定义文件名直接变为 UUID.csv；
    // 传入 Base64 Data URI 时，Chrome downloads API 会 100% 严格采用传入的 filename！
    if (typeof GM_download === 'function') {
        try {
            const utf8Bytes = new TextEncoder().encode('\uFEFF' + csvContent);
            let binary = '';
            const len = utf8Bytes.byteLength;
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(utf8Bytes[i]);
            }
            const btoaFn = (win && win.btoa) || (typeof btoa !== 'undefined' ? btoa : null);
            if (btoaFn) {
                const base64 = btoaFn(binary);
                const dataUrl = `data:text/csv;charset=utf-8;base64,${base64}`;

                GM_download({
                    url: dataUrl,
                    name: filename,
                    saveAs: false,
                    onerror: () => {
                        if (BlobCtor && UrlCtor) {
                            const blob = new BlobCtor(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
                            const blobUrl = UrlCtor.createObjectURL(blob);
                            triggerAnchorDownload(blobUrl, filename, win);
                        }
                    }
                });
                return;
            }
        } catch (e) { }
    }

    // 方式 2: 标准 a 标签模拟点击下载 (挂载到顶层 document.body 确保下载触发)
    if (BlobCtor && UrlCtor) {
        const blob = new BlobCtor(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const blobUrl = UrlCtor.createObjectURL(blob);
        triggerAnchorDownload(blobUrl, filename, win);
    }
}

function triggerAnchorDownload(url: string, filename: string, targetWin?: Window | null): void {
    const doc = (typeof window !== 'undefined' && window.top?.document) || (targetWin && targetWin.document) || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.body) return;

    const link = doc.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    link.download = filename;
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    setTimeout(() => {
        try {
            doc.body.removeChild(link);
        } catch (e) { }
        try { URL.revokeObjectURL(url); } catch (e) { }
    }, 2500);
}

/**
 * 批量抽取费用记录及其底层挂载发票的完整行程时间与开票字段
 */
export async function fetchExpenseRecordsWithInvoiceDetails(
    state: GlobalState,
    targetRecordIds?: string[],
    onProgress?: (current: number, total: number) => void,
    win?: Window | null,
    statusList?: string[]
): Promise<ExpenseRecordExportRow[]> {
    // 强制清除旧拦截缓存，保障穿透拉取最新全量数据
    state.lastInterceptedExpenseRecords = null;

    // 1. 获取费用记录列表 (Network-First，statusList 传 [] 时代表全量查询全部状态)
    const allRecords = await queryExpenseRecordListApi(state, win, true, statusList);
    let targetRecords = allRecords;
    if (targetRecordIds && targetRecordIds.length > 0) {
        const idSet = new Set(targetRecordIds);
        targetRecords = allRecords.filter(r => idSet.has(r.expenseRecordId));
    }

    if (!targetRecords || targetRecords.length === 0) {
        return [];
    }

    // 2. 并发读取每条费用的发票明细 (并发度 8)
    const exportRows: ExpenseRecordExportRow[] = [];
    let completedCount = 0;
    const totalCount = targetRecords.length;

    // 立即通知初始进度 0 / totalCount，消除界面死等假象
    if (onProgress) {
        onProgress(0, totalCount);
    }

    await mapConcurrent(targetRecords, 8, async (rec: any) => {
        try {
            // 单条明细 7 秒超时保护，防止单张发票卡死全局批处理
            const ruleData = await Promise.race([
                getExpenseTypeRuleAndRowDatasApi(rec.expenseRecordId, rec.expenseTypeId || 'UNIDENTIFIED', state, win),
                new Promise<any>((_, reject) => setTimeout(() => reject(new Error('发票明细穿透超时(7s)')), 7000))
            ]).catch((err) => {
                AutopilotLogger.warn(`[fetchExpenseRecordsWithInvoiceDetails] 费用 ${rec.expenseRecordId} 穿透超时或失败: ${err.message}`);
                return null;
            });
            const rowDatas = ruleData?.rowDatas || {};
            const invList: any[] = rowDatas?.expenseRecordInvoiceList?.value || [];
            const attachList: any[] = rowDatas?.expenseRecordAttachmentList?.value || [];
            const savedDynamicFields = extractSavedDynamicFields(rowDatas, rec, ruleData?.fullData);

            const baseRowInfo = {
                expenseRecordId: rec.expenseRecordId || '',
                expenseTypeId: rec.expenseTypeId || '',
                status: normalizeExpenseStatus(rec.status),
                expenseTypeName: rec.expenseType?.title?.zh_CN || rec.expenseTypeName || (rec.expenseTypeId === 'UNIDENTIFIED' ? '未知类型' : (rec.expenseTypeId || '')),
                expenseAmount: rec.amountObj?.amount !== undefined ? rec.amountObj.amount : (rec.amount || ''),
                businessDate: rec.businessDate ? rec.businessDate.split(' ')[0] : '',
                description: rec.description || '',
                invoiceCount: rec.invoiceCount || invList.length || 0,
                applicantName: rec.applicantObj?.title?.zh_CN || rec.applicantName || '',
                createDate: rec.createDate || '',
                savedDynamicFields,
                savedRowDatas: rowDatas
            };

            if (invList.length === 0) {
                const fallbackAttach = attachList[0]?.filePath || attachList[0]?.attachmentId || attachList[0]?.id || '';
                exportRows.push({
                    ...baseRowInfo,
                    attachmentId: fallbackAttach,
                    rawAttachmentId: fallbackAttach,
                    invoiceDataId: '',
                    invoiceIndex: 0,
                    invoiceType: '',
                    invoiceCode: '',
                    invoiceNo: '',
                    invoiceDate: '',
                    amountTax: '',
                    totalAmount: '',
                    totalTax: '',
                    departureDate: '',
                    departureTime: '',
                    timeGetOff: '',
                    stationGetOn: '',
                    stationGetOff: '',
                    trainNo: '',
                    salesName: '',
                    purchaserName: '',
                    commodityNames: '',
                    fileName: '',
                    remarks: '',
                    reconciliationNote: '无挂载发票'
                });
            } else {
                invList.forEach((invItem, idx) => {
                    const inv = invItem.invoiceVO || {};
                    const depDate = inv.departureDate ? normalizeDate(inv.departureDate) : '';
                    const invDate = inv.invoiceDate ? normalizeDate(inv.invoiceDate) : '';
                    const timeOn = inv.timeGetOn || inv.departureTime || '';
                    const timeOff = inv.timeGetOff || '';
                    const stOn = inv.stationGetOn || inv.from || '';
                    const stOff = inv.stationGetOff || inv.to || '';
                    const train = inv.trainNo || inv.trainNumber || inv.licensePlate || '';

                    // =========================================================================
                    // 提取 OCR 裁切特写单票 ID (inv.videoAddress) 与 原始全图上传 ID (inv.filePath)
                    // 核心逆向机制：
                    // 1. inv.videoAddress 代表宿主系统 OCR 自动识别并切片裁切后的单张发票特写图像
                    // 2. inv.filePath 代表用户原始上传的整页/整张大图 (如手机拍摄包含多张票据的桌面照片)
                    // =========================================================================
                    const candidateCropIds = [
                        inv.videoAddress,
                        invItem.videoAddress,
                        inv.scanVideoAddress,
                        inv.imagePath
                    ];
                    let attachmentId = '';
                    for (const cand of candidateCropIds) {
                        if (typeof cand === 'string' && cand.trim().length > 3) {
                            const trimmed = cand.trim();
                            if (/^\d{12,}$/.test(trimmed)) continue;
                            if (trimmed === '[object Object]' || trimmed === 'null' || trimmed === 'undefined') continue;
                            attachmentId = trimmed;
                            break;
                        }
                    }

                    const candidateRawIds = [
                        inv.filePath,
                        invItem.filePath,
                        inv.attachmentPath,
                        inv.attachmentUrl,
                        inv.attachmentId,
                        inv.attachId,
                        invItem.attachmentId,
                        invItem.attachmentVO?.attachmentId,
                        attachList[idx]?.filePath,
                        attachList[idx]?.attachmentId,
                        attachList[idx]?.id,
                        attachList[0]?.filePath,
                        attachList[0]?.attachmentId,
                        inv.invoiceAttachmentId,
                        inv.fileId,
                        inv.boTemplateAndData?.boData?.area?.rowDatas?.[0]?.datas?.IMAGE_PATH?.value,
                        inv.boTemplateAndData?.boData?.area?.rowDatas?.[0]?.datas?.FILE_PATH?.value
                    ];
                    let rawAttachmentId = '';
                    for (const cand of candidateRawIds) {
                        if (typeof cand === 'string' && cand.trim().length > 3) {
                            const trimmed = cand.trim();
                            if (/^\d{12,}$/.test(trimmed)) continue;
                            if (trimmed === '[object Object]' || trimmed === 'null' || trimmed === 'undefined') continue;
                            rawAttachmentId = trimmed;
                            break;
                        }
                    }

                    // 互为后备兜底 (如电子发票 PDF 仅有 filePath 无 videoAddress，则裁切特写自动回退为 filePath)
                    if (!attachmentId) {
                        attachmentId = rawAttachmentId;
                    }
                    if (!rawAttachmentId) {
                        rawAttachmentId = attachmentId;
                    }

                    const invoiceDataId = inv.invoiceDataId || inv.dataId || invItem.invoiceDataId || invItem.dataId || inv.id || '';

                    exportRows.push({
                        ...baseRowInfo,
                        attachmentId,
                        rawAttachmentId,
                        invoiceDataId,
                        invoiceIndex: idx + 1,
                        invoiceType: inv.invoiceTypeAbbreviation || inv.invoiceType || '',
                        invoiceCode: inv.invoiceCode || '',
                        invoiceNo: inv.invoiceNo || '',
                        invoiceDate: invDate,
                        amountTax: inv.amountTax !== undefined ? inv.amountTax : (inv.amountTaxObj?.amount || ''),
                        totalAmount: inv.totalAmount !== undefined ? inv.totalAmount : (inv.totalAmountObj?.amount || ''),
                        totalTax: inv.totalTax !== undefined ? inv.totalTax : (inv.totalTaxObj?.amount || ''),
                        departureDate: depDate,
                        departureTime: timeOn,
                        timeGetOn: timeOn,
                        timeGetOff: timeOff,
                        stationGetOn: stOn,
                        stationGetOff: stOff,
                        trainNo: train,
                        salesName: inv.salesName || '',
                        purchaserName: inv.purchaserName || '',
                        commodityNames: inv.invoiceDetails || inv.commodityNames || '',
                        fileName: inv.fileName || '',
                        remarks: inv.remarks || '',
                        reconciliationNote: generateReconciliationNote(rec, inv)
                    });
                });
            }
        } catch (err: any) {
            exportRows.push({
                expenseRecordId: rec.expenseRecordId || '',
                status: normalizeExpenseStatus(rec.status),
                expenseTypeName: rec.expenseType?.title?.zh_CN || '',
                expenseAmount: rec.amountObj?.amount || '',
                businessDate: rec.businessDate ? rec.businessDate.split(' ')[0] : '',
                description: rec.description || '',
                invoiceCount: rec.invoiceCount || 0,
                applicantName: rec.applicantObj?.title?.zh_CN || '',
                createDate: rec.createDate || '',
                savedDynamicFields: {},
                savedRowDatas: {},
                attachmentId: '',
                invoiceDataId: '',
                invoiceIndex: 0,
                invoiceType: '',
                invoiceCode: '',
                invoiceNo: '',
                invoiceDate: '',
                amountTax: '',
                totalAmount: '',
                totalTax: '',
                departureDate: '',
                departureTime: '',
                timeGetOff: '',
                stationGetOn: '',
                stationGetOff: '',
                trainNo: '',
                salesName: '',
                purchaserName: '',
                commodityNames: '',
                fileName: '',
                remarks: '',
                reconciliationNote: `❌ 提取发票异常: ${err.message}`
            });
        } finally {
            completedCount++;
            if (onProgress) {
                onProgress(completedCount, totalCount);
            }
        }
    });

    // 按照业务日期倒序排列
    exportRows.sort((a, b) => (b.businessDate || '').localeCompare(a.businessDate || ''));

    return exportRows;
}

// ==========================================
// 9. 费用类型分类树检索服务
// ==========================================

export interface ExpenseTypeTreeNode {
    id: string;
    code: string;
    name: string;
    icon?: string;
    iconColor?: string;
    isLeaf: boolean;
    depth?: number;
    children: ExpenseTypeTreeNode[];
    raw?: any;
}

/**
 * 实时拉取当前登录人权限内的费用类型分类树 (包含 4 大分类与 15 种明细类型)
 * 接口: POST /fssc/controlStandard/expenseTypeDim/getExpenseTypeTreeInAuth
 */
export async function fetchExpenseTypeTreeApi(
    state: GlobalState,
    win?: Window | null
): Promise<ExpenseTypeTreeNode[]> {
    const applicantId = state.currentUser?.userId ||
        state.applicantId ||
        (typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem('userId') || sessionStorage.getItem('loginUserId')) : '') ||
        '11eee047a80566bca18367ceb209b2e1';

    const payload = {
        applicantId,
        invoiceRequired: true
    };

    try {
        let res: any = await callNativeHttp('/controlStandard/expenseTypeDim/getExpenseTypeTreeInAuth', 'POST', payload, win);
        if (!res || !res.success) {
            res = await apiRequest('/fssc/controlStandard/expenseTypeDim/getExpenseTypeTreeInAuth', 'POST', payload, state);
        }

        if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
            const mapNodes = (nodes: any[]): ExpenseTypeTreeNode[] => {
                return nodes.map(n => {
                    const d = n.data || {};
                    const isLeaf = d.isLeaf !== undefined ? Boolean(d.isLeaf) : (!n.children || n.children.length === 0);
                    return {
                        id: d.expenseTypeId || n.key || n.id || '',
                        code: d.expenseTypeCode || n.code || '',
                        name: d.expenseTypeName || n.title || n.name || '',
                        icon: d.icon || n.icon || '',
                        iconColor: d.iconColor || n.iconColor || '',
                        isLeaf,
                        depth: d.depth || 0,
                        children: n.children && n.children.length > 0 ? mapNodes(n.children) : [],
                        raw: d
                    };
                });
            };
            const tree = mapNodes(res.data);
            AutopilotLogger.info(`[fetchExpenseTypeTreeApi] 成功拉取权限内费用类型分类树，共 ${tree.length} 个根分类`);
            return tree;
        }
    } catch (e: any) {
        AutopilotLogger.warn(`[fetchExpenseTypeTreeApi] 拉取费用类型树失败: ${e.message}`);
    }

    return [];
}

// ==========================================
// 10. 批量修改费用记录与说明持久化服务
// ==========================================


export interface ExpenseRecordUpdateItem {
    expenseRecordId: string;
    expenseTypeId?: string;           // 兼容旧字段
    originalExpenseTypeId?: string;   // 原费用类型
    targetExpenseTypeId?: string;     // 目标费用类型 (若变更)
    targetExpenseTypeName?: string;   // 目标费用类型名称
    newDescription?: string;
    newBusinessDate?: string;
    startAddress?: string;
    endAddress?: string;
    dynamicFields?: DynamicExpenseFieldValues;
}

export interface BatchUpdateExpenseResult {
    total: number;
    successCount: number;
    failCount: number;
    errors: { expenseRecordId: string; error: string }[];
    hasOverStandard?: boolean;
    overStandardCount?: number;
}


/**
 * 批量更新费用记录（类型切换、必填字段注入、说明、业务日期）并安全持久化保存为草稿
 */
export async function batchUpdateExpenseRecordsApi(
    updates: ExpenseRecordUpdateItem[],
    state: GlobalState,
    onProgress?: (completed: number, total: number) => void,
    win?: Window | null
): Promise<BatchUpdateExpenseResult> {
    const result: BatchUpdateExpenseResult = {
        total: updates.length,
        successCount: 0,
        failCount: 0,
        errors: []
    };

    if (!updates || updates.length === 0) return result;

    // 0. 批量持久化前动态嗅探最新 Token 并执行会话保活，彻底重置服务端空闲倒计时
    extractLatestTokens(state);
    await touchSessionKeepalive(state, win);

    let completed = 0;
    // 使用并发度 3 保证极速处理且避免高频限流与数据库行锁冲突
    await mapConcurrent(updates, 3, async (item) => {
        let retryCount = 0;
        const maxRetries = 1;
        try {
            while (true) {
                try {
                    const originalTypeId = item.originalExpenseTypeId || item.expenseTypeId || 'UNIDENTIFIED';
            const targetTypeId = item.targetExpenseTypeId;
            const isTypeChanged = Boolean(targetTypeId && targetTypeId !== originalTypeId);

            // 1. 获取现有完整 ruleData（包含发票列表、金额、乐观锁版本号与申请人）
            const ruleData = await getExpenseTypeRuleAndRowDatasApi(item.expenseRecordId, originalTypeId, state, win);
            const existingRowDatas = ruleData.rowDatas || {};
            let version = ruleData.version !== undefined ? ruleData.version : 1;
            let applicantId = ruleData.fullData?.applicantId || existingRowDatas?.APPLICANT_ID?.value?.value || state.applicantId || '';
            let rowDatas: any = {};

            if (isTypeChanged) {
                // 2. 类型变更：调用 initExpenseRecordData，将原有完整 existingRowDatas（含发票和金额）透传，重置槽位元数据
                AutopilotLogger.info(`[batchUpdate] 费用记录 ${item.expenseRecordId} 变更类型: ${originalTypeId} ➔ ${targetTypeId}`);
                const initRes = await initExpenseRecordWithTypeApi(item.expenseRecordId, targetTypeId!, existingRowDatas, state, win);
                rowDatas = initRes.rowDatas || {};
                
                // 防御性安全守卫：如果切换后缺失发票列表或金额，无条件从原 existingRowDatas 继承，杜绝任何发票丢失
                if ((!rowDatas.expenseRecordInvoiceList || !rowDatas.expenseRecordInvoiceList.value) && existingRowDatas.expenseRecordInvoiceList) {
                    rowDatas.expenseRecordInvoiceList = existingRowDatas.expenseRecordInvoiceList;
                }
                if ((!rowDatas.AMOUNT || !rowDatas.AMOUNT.value) && existingRowDatas.AMOUNT) {
                    rowDatas.AMOUNT = existingRowDatas.AMOUNT;
                }
                if ((!rowDatas.INVOICE_COUNT || !rowDatas.INVOICE_COUNT.value) && existingRowDatas.INVOICE_COUNT) {
                    rowDatas.INVOICE_COUNT = existingRowDatas.INVOICE_COUNT;
                }
                if (initRes.applicantId) applicantId = initRes.applicantId;
                else if (initRes.fullData?.applicantId) applicantId = initRes.fullData.applicantId;
                // 关键修复：initExpenseRecordData 为内存模板初始化，返回的 version 恒为 0，绝对不可覆盖真实的数据库版本号！
                if (initRes.version && initRes.version > version) version = initRes.version;
            } else {
                rowDatas = existingRowDatas;
            }

            let hasChanged = isTypeChanged;

/**
 * 安全设置费用记录行数据字段（若字段对象不存在则按元年元数据规范自适应创建，彻底杜绝 undefined 异常）
 */
function ensureExpenseRowField(
    rowDatas: any,
    fieldCode: string,
    val: any,
    dataType: 'STEXT' | 'DATE' | 'NUMBER' | 'DROPDOWN' | 'MTEXT' = 'STEXT'
): boolean {
    if (val === undefined || val === null || val === '') return false;

    if (!rowDatas[fieldCode]) {
        if (dataType === 'DROPDOWN') {
            const dropdownVal = (typeof val === 'object' && val !== null) ? val : {
                title: { zh_CN: String(val) },
                value: String(val)
            };
            rowDatas[fieldCode] = {
                dataType: 'DROPDOWN',
                dataAttribute: 'DEFAULT',
                required: true,
                value: dropdownVal
            };
        } else {
            rowDatas[fieldCode] = {
                dataType,
                dataAttribute: 'DEFAULT',
                required: true,
                value: val
            };
        }
        return true;
    }

    const field = rowDatas[fieldCode];
    if (dataType === 'DROPDOWN') {
        if (typeof field.value === 'object' && field.value !== null && !Array.isArray(field.value)) {
            if (typeof val === 'object' && val !== null) {
                field.value = val;
            } else {
                if (!field.value.title) field.value.title = {};
                field.value.title.zh_CN = String(val);
                field.value.value = field.value.value || String(val);
            }
        } else {
            field.value = (typeof val === 'object' && val !== null) ? val : {
                title: { zh_CN: String(val) },
                value: String(val)
            };
        }
    } else {
        field.value = val;
    }
    return true;
}

            // 3. 更新费用说明
            if (item.newDescription !== undefined) {
                if (ensureExpenseRowField(rowDatas, 'DESCRIPTION', item.newDescription.trim(), 'MTEXT')) {
                    hasChanged = true;
                }
            }

            // 4. 可选：更新业务日期
            if (item.newBusinessDate) {
                const normDate = normalizeDate(item.newBusinessDate);
                if (normDate) {
                    if (ensureExpenseRowField(rowDatas, 'BUSINESS_DATE', `${normDate} 00:00:00`, 'DATE')) {
                        hasChanged = true;
                    }
                }
            }

            // 5. 注入必填/动态字段
            const dyn = item.dynamicFields || {};

            // 5.1 始发地 / 目的地 (交通、出租车、火车)
            const startAddr = dyn.startAddress || item.startAddress || dyn.trainFromStation;
            if (startAddr) {
                if (ensureExpenseRowField(rowDatas, 'START_ADDRESS', startAddr, 'STEXT')) {
                    hasChanged = true;
                }
            }
            const endAddr = dyn.endAddress || item.endAddress || dyn.trainToStation;
            if (endAddr) {
                if (ensureExpenseRowField(rowDatas, 'END_ADDRESS', endAddr, 'STEXT')) {
                    hasChanged = true;
                }
            }

            // 5.2 住宿费专属必填字段
            if (dyn.checkInDate) {
                const d = normalizeDate(dyn.checkInDate);
                if (d && ensureExpenseRowField(rowDatas, 'CHECK_IN_DATE', `${d} 00:00:00`, 'DATE')) {
                    hasChanged = true;
                }
            }
            if (dyn.checkOutDate) {
                const d = normalizeDate(dyn.checkOutDate);
                if (d && ensureExpenseRowField(rowDatas, 'CHECK_OUT_DATE', `${d} 00:00:00`, 'DATE')) {
                    hasChanged = true;
                }
            }
            if (dyn.city) {
                const cityVO = await fetchCityVO(dyn.city, state, '6b8ff0649ebe11e88b72df10cd5db793');
                const cityFieldVal = cityVO && cityVO.value ? {
                    value: cityVO.value,
                    title: { zh_CN: (cityVO.title && cityVO.title.zh_CN) || dyn.city }
                } : {
                    value: dyn.city,
                    title: { zh_CN: dyn.city }
                };

                if (ensureExpenseRowField(rowDatas, 'CITY', cityFieldVal, 'DROPDOWN')) {
                    hasChanged = true;
                }

                // 尝试提取动态 fieldId (出差城市字段的 expenseTypeFieldId)
                let cityFieldId = '0356c803fdbde1653e55bb00bc610006';
                if (ruleData.fullData?.expenseTypeFieldRuleListVO?.expenseTypeFieldList) {
                    const cityDef = ruleData.fullData.expenseTypeFieldRuleListVO.expenseTypeFieldList.find(
                        (f: any) => f.columnCode === 'CITY'
                    );
                    if (cityDef && cityDef.expenseTypeFieldId) {
                        cityFieldId = cityDef.expenseTypeFieldId;
                    }
                }

                // 核心关键：调用元年云官方 fieldValueChange 规则引擎，自动联动生成 住宿城市类型 (F_ZSC_DEF_001) 与 标准金额 (STANDARD_VALUE)
                const ruleRowDatas = await executeExpenseRecordFieldValueChangeApi(
                    cityFieldId,
                    '出差城市',
                    'CITY',
                    cityFieldVal,
                    targetTypeId || originalTypeId || '0356c4e2b72de1653e55bb00bc610001',
                    rowDatas,
                    state,
                    win
                );

                if (ruleRowDatas && typeof ruleRowDatas === 'object') {
                    if (ruleRowDatas.F_ZSC_DEF_001) {
                        rowDatas.F_ZSC_DEF_001 = ruleRowDatas.F_ZSC_DEF_001;
                        hasChanged = true;
                    }
                    if (ruleRowDatas.STANDARD_VALUE) {
                        rowDatas.STANDARD_VALUE = ruleRowDatas.STANDARD_VALUE;
                        hasChanged = true;
                    }
                    if (ruleRowDatas.OVER_STANDARD) {
                        rowDatas.OVER_STANDARD = ruleRowDatas.OVER_STANDARD;
                    }
                }
            }

            // 5.2.1 针对住宿费：全面补齐必填项，彻底杜绝单价/房间数/城市类型必填拦截
            const isHotel = (targetTypeId || originalTypeId) === '0356c4e2b72de1653e55bb00bc610001' ||
                !!rowDatas.HOTEL_NAME || !!rowDatas.CHECK_IN_DATE || !!dyn.hotelName || !!dyn.checkInDate;
            if (isHotel) {
                if (dyn.hotelName) {
                    if (ensureExpenseRowField(rowDatas, 'HOTEL_NAME', dyn.hotelName, 'STEXT')) {
                        hasChanged = true;
                    }
                }
                const roomNum = Number(dyn.roomNum) || Number(rowDatas.ROOM_NUM?.value) || 1;
                if (ensureExpenseRowField(rowDatas, 'ROOM_NUM', roomNum, 'NUMBER')) {
                    hasChanged = true;
                }

                const checkIn = dyn.checkInDate || rowDatas.CHECK_IN_DATE?.value;
                const checkOut = dyn.checkOutDate || rowDatas.CHECK_OUT_DATE?.value;
                let stayDays = 1;
                if (checkIn && checkOut) {
                    const inD = new Date(checkIn);
                    const outD = new Date(checkOut);
                    const diff = Math.round((outD.getTime() - inD.getTime()) / (1000 * 3600 * 24));
                    stayDays = diff > 0 ? diff : 1;
                }
                ensureExpenseRowField(rowDatas, 'STAY_DAYS', stayDays, 'NUMBER');

                const totalAmount = Number(rowDatas.AMOUNT?.value?.amount) || 0;
                const totalRoomNights = Math.max(1, stayDays * roomNum);
                const unitPriceVal = Math.round((totalAmount / totalRoomNights) * 100) / 100;
                rowDatas.UNIT_PRICE = {
                    dataType: 'MONEY',
                    required: true,
                    value: {
                        accountAmount: {
                            amount: unitPriceVal,
                            capital: '',
                            currencyId: state.accountCurrencyId || '6e589eb2dd9f11e8b5a69590a14a4e34',
                            currencySymbol: '',
                            description: '',
                            exchangeRate: 1,
                            factor: 0
                        },
                        amount: unitPriceVal,
                        capital: '',
                        currencyId: state.accountCurrencyId || '6e589eb2dd9f11e8b5a69590a14a4e34',
                        currencySymbol: '¥',
                        description: '',
                        exchangeRate: 1,
                        factor: 0
                    }
                };
                hasChanged = true;

                if (!item.newBusinessDate && checkIn) {
                    const d = normalizeDate(checkIn);
                    if (d) {
                        ensureExpenseRowField(rowDatas, 'BUSINESS_DATE', `${d} 00:00:00`, 'DATE');
                    }
                }

                // 住宿城市类型 (F_ZSC_DEF_001) 与 标准金额 (STANDARD_VALUE) 确定性公式兜底
                const currentHotelCity = dyn.city || rowDatas.CITY?.value?.title?.zh_CN || rowDatas.CITY?.value?.value;
                const cityName = currentHotelCity ? String(currentHotelCity).replace(/市|区|县/g, '').trim() : '';
                const isTier1 = /北京|上海|广州|深圳/.test(cityName);
                const tier1Id = '035a402fee2345af7f1906ec05cc0000';
                const otherId = '035a403ff62345af7f1906ec05cc0000';
                const targetZscId = isTier1 ? tier1Id : otherId;
                const targetZscTitle = isTier1 ? '境内-北上广深' : '境内-其他';
                const stdAmt = isTier1 ? 800 : 700;

                if (!rowDatas.F_ZSC_DEF_001 || !rowDatas.F_ZSC_DEF_001.value || !rowDatas.F_ZSC_DEF_001.value.value) {
                    rowDatas.F_ZSC_DEF_001 = {
                        dataSourceScope: [{ title: { zh_CN: targetZscTitle }, value: targetZscId }],
                        dataType: 'DROPDOWN',
                        readOnly: true,
                        required: true,
                        value: {
                            icon: '',
                            iconColor: '',
                            title: { zh_CN: targetZscTitle },
                            value: targetZscId
                        }
                    };
                    hasChanged = true;
                }

                if (!rowDatas.STANDARD_VALUE || !rowDatas.STANDARD_VALUE.value || !rowDatas.STANDARD_VALUE.value.amount) {
                    rowDatas.STANDARD_VALUE = {
                        dataType: 'MONEY',
                        hidden: true,
                        readOnly: true,
                        required: true,
                        value: {
                            accountAmount: {
                                amount: stdAmt,
                                capital: '',
                                currencyId: state.accountCurrencyId || '6e589eb2dd9f11e8b5a69590a14a4e34',
                                currencySymbol: '',
                                description: '',
                                exchangeRate: 1,
                                factor: 0
                            },
                            amount: stdAmt,
                            capital: '',
                            currencyId: state.accountCurrencyId || '6e589eb2dd9f11e8b5a69590a14a4e34',
                            currencySymbol: '¥',
                            description: '',
                            exchangeRate: 1,
                            factor: 0
                        }
                    };
                    hasChanged = true;
                }

                // 5.2.1 住宿费超标说明自动自愈与必填守卫 (彻底解决“保存校验拦截: 超标说明必填”)
                const isOverStandard = rowDatas.OVER_STANDARD?.value?.title?.zh_CN === '是' ||
                    rowDatas.OVER_STANDARD?.value === true ||
                    rowDatas.OVER_STANDARD_DESCRIPTION?.required === true ||
                    (rowDatas.UNIT_PRICE?.value?.amount && rowDatas.STANDARD_VALUE?.value?.amount &&
                        rowDatas.UNIT_PRICE.value.amount > rowDatas.STANDARD_VALUE.value.amount);

                if (isOverStandard) {
                    result.hasOverStandard = true;
                    result.overStandardCount = (result.overStandardCount || 0) + 1;
                }

                if (isOverStandard || (rowDatas.OVER_STANDARD_DESCRIPTION && !rowDatas.OVER_STANDARD_DESCRIPTION.value)) {
                    const overReason = (dyn.overStandardDescription && dyn.overStandardDescription.trim()) ||
                        (rowDatas.OVER_STANDARD_DESCRIPTION?.value ? String(rowDatas.OVER_STANDARD_DESCRIPTION.value).trim() : '');
                    if (overReason) {
                        if (ensureExpenseRowField(rowDatas, 'OVER_STANDARD_DESCRIPTION', overReason, 'MTEXT')) {
                            hasChanged = true;
                        }
                    } else if (isOverStandard) {
                        const itemDate = dyn.checkInDate || (rowDatas.CHECK_IN_DATE?.value ? String(rowDatas.CHECK_IN_DATE.value).slice(0, 10) : '') || '';
                        const hotelOrCity = dyn.hotelName || dyn.city || (rowDatas.HOTEL_NAME?.value ? String(rowDatas.HOTEL_NAME.value) : '') || '';
                        const itemAmount = totalAmount ? `¥${totalAmount}` : '';
                        const itemLabel = [itemDate, hotelOrCity, itemAmount].filter(Boolean).join(' ');
                        throw new Error(`[${itemLabel || item.expenseRecordId}] 住宿费单价已超标，超标说明为必填项，请填写理由或点击 📋 拷贝“费用说明”后再保存！`);
                    }
                }
            }

            // 5.3 飞机票专属必填字段
            if (dyn.flightStartDate) {
                const d = normalizeDate(dyn.flightStartDate);
                if (d && ensureExpenseRowField(rowDatas, 'FLIGHT_START_DATE', `${d} 00:00:00`, 'DATE')) {
                    hasChanged = true;
                }
            }
            if (dyn.flightEndDate) {
                const d = normalizeDate(dyn.flightEndDate);
                if (d && ensureExpenseRowField(rowDatas, 'FLIGHT_END_DATE', `${d} 00:00:00`, 'DATE')) {
                    hasChanged = true;
                }
            }
            if (dyn.flightFromCity) {
                const cityVO = await fetchCityVO(dyn.flightFromCity, state, '6b8ff0649ebe11e88b72df10cd5db793');
                if (ensureExpenseRowField(rowDatas, 'FLIGHT_FROM_CITY', cityVO || dyn.flightFromCity, 'DROPDOWN')) {
                    hasChanged = true;
                }
            }
            if (dyn.flightToCity) {
                const cityVO = await fetchCityVO(dyn.flightToCity, state, '6b8ff0649ebe11e88b72df10cd5db793');
                if (ensureExpenseRowField(rowDatas, 'FLIGHT_TO_CITY', cityVO || dyn.flightToCity, 'DROPDOWN')) {
                    hasChanged = true;
                }
            }
            if (dyn.flightNum) {
                if (ensureExpenseRowField(rowDatas, 'FLIGHT_NUM', dyn.flightNum, 'STEXT')) {
                    hasChanged = true;
                }
            }

            // 5.4 火车票专属必填字段
            if (dyn.trainStartDate) {
                const d = normalizeDate(dyn.trainStartDate);
                if (d && ensureExpenseRowField(rowDatas, 'TRAIN_START_DATE', `${d} 00:00:00`, 'DATE')) {
                    hasChanged = true;
                }
            }
            if (dyn.trainEndDate) {
                const d = normalizeDate(dyn.trainEndDate);
                if (d && ensureExpenseRowField(rowDatas, 'TRAIN_END_DATE', `${d} 00:00:00`, 'DATE')) {
                    hasChanged = true;
                }
            }
            if (dyn.trainFromStation) {
                const cityVO = await fetchCityVO(dyn.trainFromStation, state, '6b8ff0649ebe11e88b72df10cd5db793');
                if (ensureExpenseRowField(rowDatas, 'TRAIN_FROM_CITY', cityVO || dyn.trainFromStation, 'DROPDOWN')) {
                    hasChanged = true;
                }
                ensureExpenseRowField(rowDatas, 'START_ADDRESS', dyn.trainFromStation, 'STEXT');
            }
            if (dyn.trainToStation) {
                const cityVO = await fetchCityVO(dyn.trainToStation, state, '6b8ff0649ebe11e88b72df10cd5db793');
                if (ensureExpenseRowField(rowDatas, 'TRAIN_TO_CITY', cityVO || dyn.trainToStation, 'DROPDOWN')) {
                    hasChanged = true;
                }
                ensureExpenseRowField(rowDatas, 'END_ADDRESS', dyn.trainToStation, 'STEXT');
            }

            // 5.5 通信费所属账期月份 (系统在部分模版中使用 FLIGHT_START_DATE 映射手机费年月)
            if (dyn.billMonth) {
                const m = dyn.billMonth.trim();
                const dateStr = m.length === 7 ? `${m}-01` : m;
                const norm = normalizeDate(dateStr);
                if (norm && ensureExpenseRowField(rowDatas, 'FLIGHT_START_DATE', `${norm} 00:00:00`, 'DATE')) {
                    hasChanged = true;
                }
            }

            if (!hasChanged) {
                result.successCount++;
                break;
            }

            // 6. 持久化保存草稿接口 (validateAndSaveExpenseRecord)
            const finalTypeId = targetTypeId || (originalTypeId && originalTypeId !== 'UNIDENTIFIED' ? originalTypeId : '') ||
                ruleData.fullData?.expenseTypeId ||
                ruleData.rowDatas?.EXPENSE_TYPE_ID?.value?.value || '';
            AutopilotLogger.info(`[batchUpdate] 保存费用记录 ${item.expenseRecordId}, 类型: ${finalTypeId}, 字段数: ${Object.keys(rowDatas).length}`);
            await saveFinalExpenseRecordApi(item.expenseRecordId, finalTypeId, rowDatas, version, state, applicantId, win);
            result.successCount++;
            break;
        } catch (err: any) {
            const isRetryable = retryCount < maxRetries && (
                err.message?.includes('版本') ||
                err.message?.includes('version') ||
                err.message?.includes('修改') ||
                err.message?.includes('已被其他人修改') ||
                err.message?.includes('超时')
            );
            if (isRetryable) {
                retryCount++;
                AutopilotLogger.warn(`[batchUpdate] 费用记录 ${item.expenseRecordId} 遇瞬态或版本冲突 (${err.message})，重新拉取最新版本重试第 ${retryCount} 次...`);
                await new Promise(r => setTimeout(r, 400));
                continue;
            }

            const isAuthError = err.message?.includes('登录失效') || err.message?.includes('Time-Out') || err.message?.includes('401');
            if (isAuthError) {
                AutopilotLogger.warn(`[batchUpdate] 检测到会话异常 (${err.message})，正在紧急重嗅探 Token 并保活...`);
                extractLatestTokens(state);
                touchSessionKeepalive(state, win);
            }
            result.failCount++;
            result.errors.push({
                expenseRecordId: item.expenseRecordId,
                error: err.message || '保存费用记录失败'
            });
            break;
        }
    }
} finally {
    completed++;
    if (onProgress) {
        onProgress(completed, updates.length);
    }
}
    });

    state.lastInterceptedExpenseRecords = null;
    return result;
}

export interface MealAllowanceParams {
    applicantId?: string;
    applicantName?: string;
    startDate: string;
    endDate: string;
    destinationCity: string;
    projectName?: string;
    description?: string;
}

/**
 * 为出差报销单 (BC) 中的正社员动态创建【误餐补助】费用明细记录
 * 
 * 严格逆向对齐元年官方真实流程 (HAR 校验)：
 * 1. initExpenseRecordData: 初始化 0356c51e601de1653e55bb00bc610000 (误餐补助)
 * 2. 动态检索城市维度对象 (fetchCityVO)
 * 3. 填入起止时间与出差城市，触发 fieldValueChange 联动测算合规标准金额
 * 4. 持久化保存 (validateAndSaveExpenseRecord) 并返回 expenseRecordId
 */
export async function createMealAllowanceExpenseRecordApi(
    params: MealAllowanceParams,
    state: GlobalState,
    win?: Window | null
): Promise<string> {
    if (!state.applicantId || !state.currentUser?.userId) {
        try {
            await fetchLoginUserInfo(state);
        } catch (e) { }
    }

    const userId = params.applicantId ||
        state.applicantId ||
        state.currentUser?.userId ||
        (typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem('userId') || sessionStorage.getItem('loginUserId')) : '') || '';
    
    const userName = params.applicantName ||
        state.applicantName ||
        state.currentUser?.userName ||
        '正社员';

    const startDateRaw = params.startDate || '';
    const endDateRaw = params.endDate || '';
    const baseStartDate = startDateRaw.split('T')[0].split(' ')[0];
    const baseEndDate = endDateRaw.split('T')[0].split(' ')[0];

    const startTime = (startDateRaw.includes('T') ? startDateRaw.split('T')[1] : startDateRaw.includes(' ') ? startDateRaw.split(' ')[1] : '').slice(0, 5) || '09:00';
    const endTime = (endDateRaw.includes('T') ? endDateRaw.split('T')[1] : endDateRaw.includes(' ') ? endDateRaw.split(' ')[1] : '').slice(0, 5) || '18:00';

    const trainStart = `${baseStartDate} ${startTime}:00`;
    const trainEnd = `${baseEndDate} ${endTime}:00`;
    const businessDate = `${baseStartDate} 00:00:00`;

    const winObj = win || (typeof window !== 'undefined' ? window : null);
    const mealTypeId = '0356c51e601de1653e55bb00bc610000';
    const currencyId = state.accountCurrencyId || '6e589eb2dd9f11e8b5a69590a14a4e34';

    // 1. 初始化费用记录模版 (initExpenseRecordData)
    const initPayload = {
        intersectionScope: [["03566dbf373de1653e55bb00bc610000"]],
        accountCurrencyId: currencyId,
        expenseTypeId: mealTypeId,
        executeType: "CHANGE_EXPENSE_TYPE",
        triggerTiming: "ADD_ROW",
        applicantId: userId,
        preview: false,
        dimensionMappingQueryVOList: [],
        billApplicantId: userId
    };

    let initRes: any = await callNativeHttp(
        '/fssc/expenseClaim/expenseRecord/initExpenseRecordData',
        'POST',
        initPayload,
        winObj
    ) || await apiRequest(
        '/fssc/expenseClaim/expenseRecord/initExpenseRecordData',
        'POST',
        initPayload,
        state
    );

    let expenseRecordId = initRes?.data?.expenseRecordId || generateUuid();
    let rowDatas: any = initRes?.data?.rowDatas || {};

    // 2. 动态检索城市维度对象
    const cityVO = await fetchCityVO(params.destinationCity, state, '6b8ff0649ebe11e88b72df10cd5db793');

    // 3. 严格遵循官方链路执行 4 步规则联动 (fieldValueChange)
    // 3.1 联动 BUSINESS_DATE
    try {
        const fvc1: any = await callNativeHttp(
            '/fssc/expenseClaim/expenseRecordRuleExecute/fieldValueChange',
            'POST',
            {
                fieldId: "0356c51e67ede1653e55bb00bc610016",
                fieldName: "费用日期",
                columnCode: "BUSINESS_DATE",
                fieldValue: businessDate,
                recordDataVO: {
                    accountCurrencyId: currencyId,
                    expenseTypeId: mealTypeId,
                    expenseRecordId,
                    rowDatas
                }
            },
            winObj
        );
        if (fvc1?.data?.rowDatas) rowDatas = Object.assign({}, rowDatas, fvc1.data.rowDatas);
    } catch (e) { }

    // 3.2 联动 出差开始时间 (TRAIN_START_DATE)
    try {
        const fvc2: any = await callNativeHttp(
            '/fssc/expenseClaim/expenseRecordRuleExecute/fieldValueChange',
            'POST',
            {
                fieldId: "0356c823023345af7f1906ec05cc0003",
                fieldName: "出差开始时间",
                columnCode: "TRAIN_START_DATE",
                fieldValue: trainStart,
                recordDataVO: {
                    accountCurrencyId: currencyId,
                    expenseTypeId: mealTypeId,
                    expenseRecordId,
                    rowDatas
                }
            },
            winObj
        );
        if (fvc2?.data?.rowDatas) rowDatas = Object.assign({}, rowDatas, fvc2.data.rowDatas);
    } catch (e) { }

    // 3.3 联动 出差城市 (CITY，关键 fieldId: 035a4985309345af7f1906ec05cc0001)
    if (cityVO) {
        try {
            const fvc3: any = await callNativeHttp(
                '/fssc/expenseClaim/expenseRecordRuleExecute/fieldValueChange',
                'POST',
                {
                    fieldId: "035a4985309345af7f1906ec05cc0001",
                    fieldName: "出差城市",
                    columnCode: "CITY",
                    fieldValue: {
                        value: cityVO.value,
                        title: cityVO.title || { zh_CN: params.destinationCity }
                    },
                    recordDataVO: {
                        accountCurrencyId: currencyId,
                        expenseTypeId: mealTypeId,
                        expenseRecordId,
                        rowDatas
                    }
                },
                winObj
            );
            if (fvc3?.data?.rowDatas) rowDatas = Object.assign({}, rowDatas, fvc3.data.rowDatas);
        } catch (e) { }
    }

    // 3.4 联动 出差结束时间 (TRAIN_END_DATE)
    try {
        const fvc4: any = await callNativeHttp(
            '/fssc/expenseClaim/expenseRecordRuleExecute/fieldValueChange',
            'POST',
            {
                fieldId: "0356c82de83345af7f1906ec05cc0004",
                fieldName: "出差结束时间",
                columnCode: "TRAIN_END_DATE",
                fieldValue: trainEnd,
                recordDataVO: {
                    accountCurrencyId: currencyId,
                    expenseTypeId: mealTypeId,
                    expenseRecordId,
                    rowDatas
                }
            },
            winObj
        );
        if (fvc4?.data?.rowDatas) rowDatas = Object.assign({}, rowDatas, fvc4.data.rowDatas);
    } catch (e) { }

    // 4. 回填业务事由与申请人
    const finalDesc = params.description || `[${userName}]-[${params.projectName || '差旅出差'}]`;
    rowDatas.DESCRIPTION = { dataType: 'MTEXT', value: finalDesc };
    rowDatas.APPLICANT_ID = { dataType: 'PERSON', required: true, value: { value: userId, title: { zh_CN: userName } } };
    rowDatas.COST_STANDARD_USER = { dataType: 'PERSON', readOnly: true, required: true, value: { value: userId, title: { zh_CN: userName } } };
    rowDatas.F_FYF_DEF_001 = { dataType: 'DROPDOWN', hidden: true, required: true, value: { value: '0355ce0b3c3de1653e55bb00bc610000', title: { zh_CN: '差旅费-误餐补贴' } } };
    rowDatas.EXPENSE_TYPE_ID = { hidden: true, required: true, value: { icon: 'e-group-meals', iconColor: '#3DBF76', title: { zh_CN: '误餐补助（誤餐補助）' }, value: mealTypeId } };
    rowDatas.expenseType = { hidden: true, required: true, value: { icon: 'e-group-meals', iconColor: '#3DBF76', title: { zh_CN: '误餐补助（誤餐補助）' }, value: mealTypeId } };
    rowDatas.needInvoice = { value: 'NOT_REQUIRED' };
    rowDatas.expenseRecordInvoiceList = { value: [] };
    rowDatas.expenseRecordAttachmentList = { value: [] };
    rowDatas.ATTACH_COUNT = { dataType: 'NUMBER', hidden: true, readOnly: true, value: 0 };
    rowDatas.INVOICE_COUNT = { dataType: 'NUMBER', hidden: true, readOnly: true, value: 0 };
    rowDatas.OVER_STANDARD = { dataType: 'DROPDOWN', hidden: true, readOnly: true, value: { title: { zh_CN: '否' }, value: '6b8ff0809ebe11e88b7219c3aed96e32' } };

    // 5. 持久化保存 (operationType: 'ADD')
    const savePayload = {
        rowDatas,
        expenseRecordMessageList: [],
        accountCurrencyId: currencyId,
        applicantId: userId,
        expenseTypeId: mealTypeId,
        intersectionScope: [['03566dbf373de1653e55bb00bc610000']],
        dimensionMappingQueryVOList: [],
        operationType: 'ADD',
        expenseRecordId,
        version: 0,
        billApplicantId: userId
    };

    let saveRes: any = await callNativeHttp(
        '/fssc/expenseClaim/expenseRecord/validateAndSaveExpenseRecord',
        'POST',
        savePayload,
        winObj
    ) || await apiRequest(
        '/fssc/expenseClaim/expenseRecord/validateAndSaveExpenseRecord',
        'POST',
        savePayload,
        state
    );

    let finalId = saveRes?.data?.expenseRecordId || expenseRecordId;

    // 6. 核心防御：若保存后系统仍残留“住宿城市类型必填”禁止消息，立即执行一次针对当前已保存记录的 UPDATE 补齐
    if (cityVO) {
        try {
            const checkRes: any = await callNativeHttp(
                '/fssc/expenseClaim/expenseRecord/getExpenseTypeFieldRuleListAndAllValueVO',
                'POST',
                { expenseRecordId: finalId, expenseTypeId: mealTypeId },
                winObj
            );
            const checkData = checkRes?.data;
            const hasCityTypeIssue = checkData?.expenseRecordMessageList?.some((m: any) =>
                m.columnCodes?.includes('F_ZSC_DEF_001') || m.message?.includes('住宿城市类型')
            );
            if (hasCityTypeIssue && checkData?.rowDatas) {
                const fvcUpdate: any = await callNativeHttp(
                    '/fssc/expenseClaim/expenseRecordRuleExecute/fieldValueChange',
                    'POST',
                    {
                        fieldId: '035a4985309345af7f1906ec05cc0001',
                        fieldName: '出差城市',
                        columnCode: 'CITY',
                        fieldValue: {
                            value: cityVO.value,
                            title: cityVO.title || { zh_CN: params.destinationCity }
                        },
                        recordDataVO: {
                            accountCurrencyId: currencyId,
                            expenseTypeId: mealTypeId,
                            expenseRecordId: finalId,
                            rowDatas: checkData.rowDatas
                        }
                    },
                    winObj
                );
                if (fvcUpdate?.data?.rowDatas?.F_ZSC_DEF_001?.value) {
                    const updateRowDatas = Object.assign({}, checkData.rowDatas, fvcUpdate.data.rowDatas);
                    await callNativeHttp(
                        '/fssc/expenseClaim/expenseRecord/validateAndSaveExpenseRecord',
                        'POST',
                        {
                            expenseRecordId: finalId,
                            expenseTypeId: mealTypeId,
                            version: checkData.version || 1,
                            operationType: 'UPDATE',
                            applicantId: userId,
                            accountCurrencyId: currencyId,
                            rowDatas: updateRowDatas,
                            dimensionMappingQueryVOList: [],
                            expenseRecordMessageList: []
                        },
                        winObj
                    );
                    AutopilotLogger.info(`[createMealAllowance] 已成功通过二次联动治愈 F_ZSC_DEF_001: ${finalId}`);
                }
            }
        } catch (healErr: any) {
            AutopilotLogger.warn(`[createMealAllowance] 二次联动治愈跳过: ${healErr.message}`);
        }
    }

    if (saveRes?.success && finalId) {
        AutopilotLogger.info(`[createMealAllowance] 成功为正社员 ${userName} 创建合规误餐补助记录: ${finalId}`);
        return finalId;
    }
    throw new Error(saveRes?.message || '保存误餐补助费用明细失败');
}
