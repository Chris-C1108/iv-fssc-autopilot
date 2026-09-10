import { GlobalState } from '../types/state';
import { AutopilotLogger } from '../utils/logger';
import { showToast } from '../utils/toast';
import { Decimal } from '../utils/decimal';
import {
    ExpenseRecordExportRow,
    fetchExpenseRecordsWithInvoiceDetails,
    convertExpenseRecordsToCsv,
    downloadCsvFile,
    batchUpdateExpenseRecordsApi,
    ExpenseRecordUpdateItem,
    fetchExpenseTypeTreeApi,
    ExpenseTypeTreeNode,
    DynamicExpenseFieldValues
} from '../services/expenseService';
import { searchProjectList, fetchLoginUserInfo } from '../services/applicationService';
import { getInvoicePoolGlobalState } from '../services/invoicePoolDomService';
import { isLlmConfigured, callDirectLlmJson } from '../services/llmService';
import {
    extractTripSkeleton,
    dispatchInferenceChannels,
    mergeInferenceResults,
    detectTypeCategory,
    getGroupCategory,
    isUnknownTypeGroup
} from '../services/inferenceService';

declare const unsafeWindow: any;

// 发票子条目接口
export interface ExpenseInvoiceSubItem {
    invoiceIndex: number;
    invoiceType: string;
    invoiceCode: string;
    invoiceNo: string;
    invoiceDate: string;
    amountTax: number | string;
    totalAmount: number | string;
    totalTax?: number | string;
    departureDate: string;
    departureTime: string;
    timeGetOn?: string;
    timeGetOff: string;
    stationGetOn: string;
    stationGetOff: string;
    trainNo?: string;
    salesName: string;
    fileName: string;
    remarks: string;
    reconciliationNote: string;
}

// 费用聚合分组接口 (一笔费用对应 1~N 张发票)
export interface ExpenseRecordGroup {
    expenseRecordId: string;
    expenseTypeId: string;
    expenseTypeName: string;
    newExpenseTypeId?: string;       // 变更后的目标类型 ID
    newExpenseTypeName?: string;     // 变更后的目标类型名称
    dynamicFields?: DynamicExpenseFieldValues; // 专属动态必填字段
    inferredFields?: Record<string, 'rule' | 'llm'>; // 记录由 AI 智能推断填入/修改的字段键及来源
    expenseAmount: number | string;
    businessDate: string;
    newBusinessDate?: string;
    description: string;
    newDescription?: string;
    newStartAddress?: string;
    newEndAddress?: string;
    invoiceCount: number;
    applicantName: string;
    createDate: string;
    earliestInvoiceDate: string; // 聚合发票中的最早开票日期 (排序主键)
    hasWarn: boolean;
    invoices: ExpenseInvoiceSubItem[];
}

export interface ColumnDef {
    key: string;
    label: string;
    width?: string;
    align?: 'left' | 'center' | 'right';
    sticky?: 'cb' | 'date';
    isNumeric?: boolean;
    isDate?: boolean;
    isDynamic?: boolean;
    dynFieldKey?: string;
    dynCategory?: 'FLIGHT' | 'TRAIN' | 'HOTEL' | 'TAXI' | 'MOBILE' | 'ALL';
    dynInputType?: 'text' | 'date' | 'month' | 'number';
}

export const COLUMN_DEFINITIONS: ColumnDef[] = [
    { key: 'earliestInvoiceDate', label: '最早开票日', sticky: 'date', isDate: true },
    { key: 'businessDate', label: '费用业务日期', isDate: true },
    { key: 'expenseTypeName', label: '费用类型' },
    { key: 'expenseAmount', label: '费用金额(元)', align: 'right', isNumeric: true },
    { key: 'description', label: '费用说明 (合并单列·直接编辑)', width: '280px' },
    { key: 'invoiceCount', label: '发票张数', align: 'center', isNumeric: true },

    // 专属必填字段 13 独立列 (费用主体聚合列，rowspan 合并)
    { key: 'dynFrom', label: '出发地/站', width: '90px', isDynamic: true, dynFieldKey: 'dynFrom', dynInputType: 'text' },
    { key: 'dynTo', label: '到达地/站', width: '90px', isDynamic: true, dynFieldKey: 'dynTo', dynInputType: 'text' },
    { key: 'dynTransitNo', label: '航班号', width: '80px', isDynamic: true, dynFieldKey: 'dynTransitNo', dynInputType: 'text' },
    { key: 'dynStartDate', label: '起程日期', width: '110px', isDate: true, isDynamic: true, dynFieldKey: 'dynStartDate', dynInputType: 'date' },
    { key: 'dynEndDate', label: '到达日期', width: '110px', isDate: true, isDynamic: true, dynFieldKey: 'dynEndDate', dynInputType: 'date' },
    { key: 'dynCheckIn', label: '入住日期', width: '110px', isDate: true, isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'checkInDate', dynInputType: 'date' },
    { key: 'dynCheckOut', label: '离店日期', width: '110px', isDate: true, isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'checkOutDate', dynInputType: 'date' },
    { key: 'dynCity', label: '出差城市', width: '80px', isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'city', dynInputType: 'text' },
    { key: 'dynCityType', label: '住宿城市类型', width: '95px', isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'cityType', dynInputType: 'text' },
    { key: 'dynHotel', label: '酒店名称', width: '130px', isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'hotelName', dynInputType: 'text' },
    { key: 'dynRoomNum', label: '房间数', width: '55px', isNumeric: true, isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'roomNum', dynInputType: 'number' },
    { key: 'dynOverStandard', label: '超标说明', width: '135px', isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'overStandardDescription', dynInputType: 'text' },

    { key: 'dynAddrFrom', label: '打车始发地', width: '100px', isDynamic: true, dynCategory: 'TAXI', dynFieldKey: 'startAddress', dynInputType: 'text' },
    { key: 'dynAddrTo', label: '打车目的地', width: '100px', isDynamic: true, dynCategory: 'TAXI', dynFieldKey: 'endAddress', dynInputType: 'text' },
    { key: 'dynBillMonth', label: '通信账期', width: '100px', isDynamic: true, dynCategory: 'MOBILE', dynFieldKey: 'billMonth', dynInputType: 'month' },

    // 发票子明细列 (14 列)
    { key: 'invoiceIndex', label: '序号', align: 'center', isNumeric: true },
    { key: 'invoiceType', label: '发票类型' },
    { key: 'invoiceCode', label: '发票代码' },
    { key: 'invoiceNo', label: '发票号码' },
    { key: 'totalAmount', label: '价税合计(元)', align: 'right', isNumeric: true },
    { key: 'invoiceDate', label: '本张开票日', isDate: true },
    { key: 'departureTime', label: '行程出发/上车' },
    { key: 'timeGetOff', label: '行程到达/下车' },
    { key: 'stationGetOn', label: '始发地/出发站' },
    { key: 'stationGetOff', label: '目的地/到达站' },
    { key: 'salesName', label: '销售方/酒店/服务商', width: '160px' },
    { key: 'fileName', label: '附件文件名', width: '140px' },
    { key: 'remarks', label: '发票备注', width: '120px' },
    { key: 'reconciliationNote', label: '行程与开票核对' }
];

export const DYNAMIC_COLUMNS: ColumnDef[] = COLUMN_DEFINITIONS.filter(c => c.isDynamic);

export interface BatchEditExpenseModalState {
    groups: ExpenseRecordGroup[];
    selectedRecordIds: Set<string>; // 唯一费用记录ID
    sortKey: string; // 任意 ColumnDef 的 key
    sortAsc: boolean;
    searchQuery: string;
    filterMode: 'ALL' | 'WARN' | 'MISSING_REQUIRED' | 'OK';

    // 列字段值筛选与浮层状态
    columnFilters: Record<string, string[]>;
    activePopoverCol: string | null;
    popoverKeyword: string;

    // 费用类型分类树与目标类型
    expenseTypeTree: ExpenseTypeTreeNode[];
    targetExpenseTypeId: string;
    targetExpenseTypeName: string;
    dynamicFields: DynamicExpenseFieldValues;

    // 批量参数配置
    isTrip: boolean;
    isProxy: boolean;
    proxyPersonName: string;
    currentEmployeeName: string;
    projectName: string;
    customRemark: string;
    formatTemplate: string;
    batchBusinessDate: string;
    syncBusinessDate: boolean;
    fillAddresses: boolean;

    // Shift 键连选锚点
    lastSelectedRecordId: string | null;
}

let modalState: BatchEditExpenseModalState = {
    groups: [],
    selectedRecordIds: new Set(),
    sortKey: 'earliestInvoiceDate',
    sortAsc: true,
    searchQuery: '',
    filterMode: 'ALL',

    columnFilters: {},
    activePopoverCol: null,
    popoverKeyword: '',

    expenseTypeTree: [],
    targetExpenseTypeId: '',
    targetExpenseTypeName: '',
    dynamicFields: {},

    isTrip: true,
    isProxy: true,
    proxyPersonName: '',
    currentEmployeeName: '',
    projectName: '',
    customRemark: '',
    formatTemplate: '[${employee}]-[${project}]-[${remark}]',
    batchBusinessDate: '',
    syncBusinessDate: true,
    fillAddresses: true,
    lastSelectedRecordId: null
};

/**
 * 将平铺的发票导出数据聚合为按 expenseRecordId 分组的层次结构
 */
function groupExpenseRows(rows: ExpenseRecordExportRow[]): ExpenseRecordGroup[] {
    const groupMap = new Map<string, ExpenseRecordGroup>();

    for (const r of rows) {
        let g = groupMap.get(r.expenseRecordId);
        if (!g) {
            g = {
                expenseRecordId: r.expenseRecordId,
                expenseTypeId: r.expenseTypeId,
                expenseTypeName: r.expenseTypeName,
                expenseAmount: r.expenseAmount,
                businessDate: r.businessDate ? r.businessDate.split(' ')[0] : '',
                newBusinessDate: r.businessDate ? r.businessDate.split(' ')[0] : '',
                description: r.description || '',
                newDescription: r.description || '',
                newStartAddress: r.savedDynamicFields?.startAddress || '',
                newEndAddress: r.savedDynamicFields?.endAddress || '',
                invoiceCount: r.invoiceCount || 0,
                applicantName: r.applicantName || '',
                createDate: r.createDate || '',
                earliestInvoiceDate: '',
                hasWarn: false,
                invoices: [],
                inferredFields: {},
                dynamicFields: r.savedDynamicFields ? { ...r.savedDynamicFields } : {}
            };
            groupMap.set(r.expenseRecordId, g);
        } else if (r.savedDynamicFields && Object.keys(r.savedDynamicFields).length > 0) {
            g.dynamicFields = { ...r.savedDynamicFields, ...(g.dynamicFields || {}) };
            if (!g.newStartAddress && r.savedDynamicFields.startAddress) {
                g.newStartAddress = r.savedDynamicFields.startAddress;
            }
            if (!g.newEndAddress && r.savedDynamicFields.endAddress) {
                g.newEndAddress = r.savedDynamicFields.endAddress;
            }
        }

        // 收集发票明细
        if (r.invoiceNo || r.invoiceDate || r.totalAmount || r.amountTax || r.departureDate) {
            const isWarn = Boolean(r.reconciliationNote && r.reconciliationNote.includes('⚠️'));
            if (isWarn) g.hasWarn = true;

            const invDate = r.invoiceDate || r.departureDate || '';
            if (invDate) {
                if (!g.earliestInvoiceDate || invDate < g.earliestInvoiceDate) {
                    g.earliestInvoiceDate = invDate;
                }
            }

            g.invoices.push({
                invoiceIndex: r.invoiceIndex,
                invoiceType: r.invoiceType,
                invoiceCode: r.invoiceCode,
                invoiceNo: r.invoiceNo,
                invoiceDate: r.invoiceDate,
                amountTax: r.amountTax,
                totalAmount: r.totalAmount,
                totalTax: r.totalTax,
                departureDate: r.departureDate,
                departureTime: r.departureTime,
                timeGetOn: r.timeGetOn || r.departureTime || '',
                timeGetOff: r.timeGetOff,
                stationGetOn: r.stationGetOn,
                stationGetOff: r.stationGetOff,
                trainNo: r.trainNo,
                salesName: r.salesName,
                fileName: r.fileName,
                remarks: r.remarks,
                reconciliationNote: r.reconciliationNote
            });
        }
    }

    // 兜底与规范化
    for (const g of groupMap.values()) {
        if (!g.earliestInvoiceDate && g.businessDate) {
            g.earliestInvoiceDate = g.businessDate;
        }
        if (g.invoices.length > g.invoiceCount) {
            g.invoiceCount = g.invoices.length;
        }

        // 针对未分类 (UNIDENTIFIED) 记录，优先从底层挂载发票票种与关键特征智能推导报销类型
        const isUnknown = !g.expenseTypeId || g.expenseTypeId === 'UNIDENTIFIED' || g.expenseTypeName === '未知类型';
        if (isUnknown && g.invoices.length > 0) {
            for (const inv of g.invoices) {
                const s = `${inv.invoiceType || ''} ${inv.salesName || ''} ${inv.fileName || ''} ${inv.remarks || ''}`.toLowerCase();
                if (s.includes('飞机') || s.includes('航空') || s.includes('机票') || s.includes('flight')) {
                    g.newExpenseTypeId = '035671613fdde1653e55bb00bc610000';
                    g.newExpenseTypeName = '飞机票（航空券）';
                    break;
                } else if (s.includes('火车') || s.includes('高铁') || s.includes('铁路') || inv.trainNo) {
                    g.newExpenseTypeId = '0356c4c2b14de1653e55bb00bc610000';
                    g.newExpenseTypeName = '火车公交车票 （電車Bus代）';
                    break;
                } else if (s.includes('酒店') || s.includes('客房') || s.includes('宾馆') || s.includes('住宿') || s.includes('hotel')) {
                    g.newExpenseTypeId = '0356c4e2b72de1653e55bb00bc610001';
                    g.newExpenseTypeName = '住宿费（宿泊代）';
                    break;
                } else if (s.includes('出租车') || s.includes('打车') || s.includes('滴滴') || s.includes('taxi')) {
                    g.newExpenseTypeId = '0356c4cef03345af7f1906ec05cc0000';
                    g.newExpenseTypeName = '出租车（taxi）';
                    break;
                } else if (s.includes('通信') || s.includes('话费') || s.includes('手机')) {
                    g.newExpenseTypeId = '0356c4f6701345af7f1906ec05cc0000';
                    g.newExpenseTypeName = '通信传真费（通信代）';
                    break;
                }
            }
        }

        // 初始化/补充从发票推断出的基础动态字段 (仅当对应字段在数据库中未保存或为空时兜底)
        g.dynamicFields = g.dynamicFields || {};
        const dyn = g.dynamicFields;
        const inv0 = g.invoices[0];
        const activeCat = detectTypeCategory(g.newExpenseTypeId || g.expenseTypeId, g.newExpenseTypeName || g.expenseTypeName);

        if (activeCat === 'FLIGHT') {
            if (!dyn.flightStartDate && inv0?.departureDate) dyn.flightStartDate = inv0.departureDate;
            if (!dyn.flightEndDate && inv0?.departureDate) dyn.flightEndDate = inv0.departureDate;
            if (!dyn.flightFromCity && inv0?.stationGetOn) dyn.flightFromCity = inv0.stationGetOn;
            if (!dyn.flightToCity && inv0?.stationGetOff) dyn.flightToCity = inv0.stationGetOff;
            if (!dyn.flightNum && inv0?.trainNo) dyn.flightNum = inv0.trainNo;
        } else if (activeCat === 'TRAIN') {
            if (!dyn.trainStartDate && inv0?.departureDate) dyn.trainStartDate = inv0.departureDate;
            if (!dyn.trainEndDate && inv0?.departureDate) dyn.trainEndDate = inv0.departureDate;
            if (!dyn.trainFromStation && inv0?.stationGetOn) dyn.trainFromStation = inv0.stationGetOn;
            if (!dyn.trainToStation && inv0?.stationGetOff) dyn.trainToStation = inv0.stationGetOff;
        } else if (activeCat === 'HOTEL') {
            if (!dyn.hotelName && inv0?.salesName) {
                dyn.hotelName = inv0.salesName.replace(/有限(?:责任)?公司/g, '').trim();
            }
            if (dyn.roomNum === undefined || dyn.roomNum === null) {
                dyn.roomNum = 1;
            }
            if (dyn.city && !dyn.cityType) {
                const c = dyn.city.replace(/市|区|县/g, '').trim();
                const isTier1 = /北京|上海|广州|深圳/.test(c);
                dyn.cityType = isTier1 ? '境内-北上广深' : '境内-其他';
            }
            // 若接口中未带回超标说明，尝试通过宿主 DOM/React Fiber 穿透探测
            if (!dyn.overStandardDescription) {
                const hostOverDesc = extractOverStandardFromHostDom(g.expenseRecordId);
                if (hostOverDesc) {
                    dyn.overStandardDescription = hostOverDesc;
                }
            }
        } else if (activeCat === 'TAXI') {
            if (!dyn.startAddress && inv0?.stationGetOn) dyn.startAddress = inv0.stationGetOn;
            if (!dyn.endAddress && inv0?.stationGetOff) dyn.endAddress = inv0.stationGetOff;
        } else if (activeCat === 'MOBILE') {
            if (!dyn.billMonth && inv0?.invoiceDate) dyn.billMonth = inv0.invoiceDate.slice(0, 7);
        }

        if (!g.newStartAddress && dyn.startAddress) g.newStartAddress = dyn.startAddress;
        if (!g.newEndAddress && dyn.endAddress) g.newEndAddress = dyn.endAddress;
    }

    return Array.from(groupMap.values());
}

/**
 * 从宿主页面的 DOM 或 React Fiber 实例中穿透探测已填写的超标说明
 */
function extractOverStandardFromHostDom(recordId: string, doc?: Document): string {
    if (typeof document === 'undefined') return '';
    const docs = [document];
    if (typeof window !== 'undefined' && window.top && window.top.document && !docs.includes(window.top.document)) {
        docs.push(window.top.document);
    }
    if (doc && !docs.includes(doc)) {
        docs.push(doc);
    }

    const isMeaningful = (s: any): boolean => {
        if (!s || typeof s !== 'string') return false;
        const clean = s.trim();
        return clean.length > 0 && clean !== 'true' && clean !== 'false' && clean !== '是' && clean !== '否' && clean !== '[object Object]';
    };

    for (const d of docs) {
        try {
            const rowEls = Array.from(d.querySelectorAll(`tr, [data-row-key*="${recordId}"], [class*="ant-table-row"]`));
            for (const row of rowEls) {
                const reactKey = Object.keys(row).find(k => k.startsWith('__react'));
                if (reactKey) {
                    let curr = (row as any)[reactKey];
                    while (curr) {
                        const props = curr.memoizedProps;
                        const data = props?.data || props?.item || props?.record || props?.expenseRecord;
                        if (data && (data.expenseRecordId === recordId || data.id === recordId)) {
                            const candidates = [
                                data.overStandardDescription,
                                data.overStandardReason,
                                data.overStandardDesc,
                                data.OVER_STANDARD_DESCRIPTION,
                                data.OVER_STANDARD_REASON,
                                data.exceedStandardDescription,
                                data.rowDatas?.OVER_STANDARD_DESCRIPTION?.value,
                                data.rowDatas?.OVER_STANDARD_DESCRIPTION
                            ];
                            for (const c of candidates) {
                                if (isMeaningful(c)) return String(c).trim();
                            }
                        }
                        curr = curr.return;
                    }
                }
            }
        } catch (e) {}
    }
    return '';
}

/**
 * 智能嗅探当前登录社员真实姓名
 */
export function detectCurrentEmployeeName(state?: GlobalState, doc?: Document): string {
    // 1. 检查 state.currentUser
    if (state?.currentUser?.userName) {
        const clean = state.currentUser.userName.replace(/（[^）]+）|\([^)]+\)/g, '').trim();
        if (clean) return clean;
    }
    // 2. 从 DOM (window.top.document) 嗅探头部用户名
    try {
        const topDoc = (typeof window !== 'undefined' && window.top?.document) ? window.top.document : (doc || (typeof document !== 'undefined' ? document : null));
        if (topDoc) {
            const candidates = topDoc.querySelectorAll('.ant-dropdown-trigger, .header-user, .user-name, .user-info, [class*="user"], [class*="avatar"]');
            for (const el of Array.from(candidates)) {
                const txt = (el.textContent || '').trim();
                const bracketMatch = txt.match(/^([\u4e00-\u9fa5]{2,6})(?:（|\()/);
                if (bracketMatch) return bracketMatch[1];
                const clean = txt.replace(/（[^）]+）|\([^)]+\)/g, '').trim();
                if (clean && clean.length >= 2 && clean.length <= 6 && /^[\u4e00-\u9fa5]+$/.test(clean) && !clean.includes('应用') && !clean.includes('登录') && !clean.includes('代办')) {
                    return clean;
                }
            }
        }
    } catch (e) {}
    // 3. 从 sessionStorage / localStorage 提取
    if (typeof sessionStorage !== 'undefined') {
        const cName = sessionStorage.getItem('console_userName');
        if (cName) return cName.replace(/（[^）]+）|\([^)]+\)/g, '').trim();
        const ecsUser = sessionStorage.getItem('ecs_currentUser');
        if (ecsUser) {
            try {
                const u = JSON.parse(ecsUser);
                if (u?.userName) return u.userName.replace(/（[^）]+）|\([^)]+\)/g, '').trim();
            } catch (e) {}
        }
        const sName = sessionStorage.getItem('userName') || sessionStorage.getItem('loginUserName');
        if (sName) return sName.replace(/（[^）]+）|\([^)]+\)/g, '').trim();
    }
    if (typeof localStorage !== 'undefined') {
        const cName = localStorage.getItem('console_userName');
        if (cName) return cName.replace(/（[^）]+）|\([^)]+\)/g, '').trim();
        const lName = localStorage.getItem('userName') || localStorage.getItem('loginUserName');
        if (lName) return lName.replace(/（[^）]+）|\([^)]+\)/g, '').trim();
    }
    return '';
}

/**
 * 根据批量配置与模板计算费用说明
 * 严格清洗：若自定义备注为空，绝不显示空中括号或多余连字符
 * 例如：[外驻:李建勇]-[X2607-001] 或 [陈浩]-[X2607-001]
 */
function computeFormattedDescription(
    state: BatchEditExpenseModalState,
    group?: ExpenseRecordGroup
): string {
    const name = (state.proxyPersonName || '').trim();
    const project = (state.projectName || '').trim();
    const remark = (state.customRemark || '').trim();
    const employee = (state.currentEmployeeName || detectCurrentEmployeeName()).trim();

    const tpl = state.formatTemplate || '[${employee}]-[${project}]-[${remark}]';

    if (tpl.includes('${') || tpl.includes('name') || tpl.includes('project') || tpl.includes('remark') || tpl.includes('employee')) {
        let res = tpl
            .replace(/\${employee}/g, employee)
            .replace(/\${当前社员名}/g, employee)
            .replace(/\${社员名}/g, employee)
            .replace(/\${社员}/g, employee)
            .replace(/\${name}/g, name || employee)
            .replace(/\${人名}/g, name || employee)
            .replace(/\${外驻人名}/g, name)
            .replace(/\${project}/g, project)
            .replace(/\${项目名}/g, project)
            .replace(/\${项目号}/g, project)
            .replace(/\${项目}/g, project)
            .replace(/\${remark}/g, remark)
            .replace(/\${自定义备注}/g, remark)
            .replace(/\${备注}/g, remark);

        // 清洗空括号：如 []、[ ]
        res = res.replace(/\[\s*\]/g, '');
        // 清洗多余连字符：如 --、- -
        res = res.replace(/-\s*-+/g, '-');
        // 清洗首尾连字符
        res = res.replace(/^-\s*/, '').replace(/\s*-$/, '').trim();
        return res;
    }

    const employeePart = employee ? `[${employee}]` : '';
    const projectPart = project ? `[${project}]` : '';
    const remarkPart = remark ? `[${remark}]` : '';
    const parts = [employeePart, projectPart, remarkPart].filter(Boolean);
    return parts.length > 0 ? parts.join('-') : (group?.description || '');
}

/**
 * 打开批量修改费用信息模态框
 */
export async function openBatchEditExpenseModal(doc: Document, preselectedIds?: string[]) {
    const globalState = getInvoicePoolGlobalState();
    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    const targetDoc = (typeof window !== 'undefined' && window.top && window.top.document) ? window.top.document : doc;

    let mask = targetDoc.getElementById('yn-batch-edit-mask');
    if (!mask) {
        mask = targetDoc.createElement('div');
        mask.id = 'yn-batch-edit-mask';
        targetDoc.body.appendChild(mask);
    }

    let modal = targetDoc.getElementById('yn-batch-edit-modal');
    if (!modal) {
        modal = targetDoc.createElement('div');
        modal.id = 'yn-batch-edit-modal';
        targetDoc.body.appendChild(modal);
    }

    let isCancelled = false;
    const handleCancel = () => {
        isCancelled = true;
        closeBatchEditModal();
    };

    // 渲染骨架屏 / 加载状态 (全屏沉浸式无独立暗黑标题栏)
    mask.style.display = 'block';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="yn-bem-top-bar">
            <div class="yn-bem-bar-row" style="justify-content: space-between;">
                <span class="yn-bem-brand">
                    ✏️ 批量修改费用信息
                    <span class="yn-bem-count-badge" id="yn-bem-loading-badge">正在准备加载费用与发票明细...</span>
                </span>
                <button class="yn-bem-close-x" id="yn-bem-close-top">×</button>
            </div>
        </div>
        <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; color:#64748b; padding: 40px 20px;">
            <div style="font-size:36px; animation: spin 1s linear infinite;">⏳</div>
            <div style="font-size:15px; font-weight:600; color:#0f172a;" id="yn-bem-loading-text">正在并行提取费用记录与发票底层字段...</div>
            <div style="width: 320px; height: 6px; background: #e2e8f0; border-radius: 9999px; overflow: hidden; margin-top: 4px;">
                <div id="yn-bem-loading-progress" style="width: 5%; height: 100%; background: #000; transition: width 0.2s ease;"></div>
            </div>
            <button class="yn-bem-btn yn-bem-btn-secondary" id="yn-bem-loading-cancel" style="margin-top: 12px; font-size: 13px; padding: 6px 18px; border-radius: 6px;">
                取消加载
            </button>
        </div>
    `;

    targetDoc.getElementById('yn-bem-close-top')?.addEventListener('click', handleCancel);
    mask.onclick = handleCancel;
    modal.querySelector('#yn-bem-loading-cancel')?.addEventListener('click', handleCancel);

    try {
        const loadingText = modal.querySelector('#yn-bem-loading-text') as HTMLElement;
        const loadingProgress = modal.querySelector('#yn-bem-loading-progress') as HTMLElement;
        const loadingBadge = modal.querySelector('#yn-bem-loading-badge') as HTMLElement;

        const updateProgress = (curr: number, total: number) => {
            if (isCancelled) return;
            const safeTotal = Math.max(total, 1);
            const pct = Math.min(100, Math.round((curr / safeTotal) * 100));
            if (loadingProgress) loadingProgress.style.width = `${Math.max(5, pct)}%`;
            if (loadingText) {
                if (curr === 0) {
                    loadingText.innerText = `已发现 ${total} 笔费用记录，正在并行穿透发票明细...`;
                } else {
                    loadingText.innerText = `正在并行提取发票明细 (${curr}/${total}) · ${pct}%`;
                }
            }
            if (loadingBadge) {
                loadingBadge.innerText = `穿透进度 ${curr}/${total}`;
            }
        };

        const [rows, typeTree] = await Promise.all([
            fetchExpenseRecordsWithInvoiceDetails(
                globalState,
                undefined, // 弹窗全量展示所有费用记录，呈现完整数据全貌，杜绝漏项
                updateProgress,
                win
            ),
            fetchExpenseTypeTreeApi(globalState, win).catch(() => [])
        ]);

        if (isCancelled) return;

        if (!rows || rows.length === 0) {
            showToast('warning', '未找到可修改的费用记录');
            closeBatchEditModal();
            return;
        }

        // 1. 初始化费用类型树与选区与筛选状态
        modalState.expenseTypeTree = typeTree || [];
        modalState.targetExpenseTypeId = '';
        modalState.targetExpenseTypeName = '';
        modalState.dynamicFields = {};
        modalState.columnFilters = {};
        modalState.activePopoverCol = null;
        modalState.popoverKeyword = '';
        modalState.searchQuery = '';
        modalState.filterMode = 'ALL';
        modalState.lastSelectedRecordId = null;

        // 2. 聚合为 ExpenseRecordGroup
        modalState.groups = groupExpenseRows(rows);

        // 3. 默认按最早开票日期升序排序
        modalState.sortKey = 'earliestInvoiceDate';
        modalState.sortAsc = true;
        sortGroups(modalState.groups, modalState.sortKey, modalState.sortAsc);

        // 4. 初始化勾选状态：若外部传入了预选记录（如用户在宿主页面手动勾选了部分行），则精准勾选预选行；否则默认全选
        if (preselectedIds && preselectedIds.length > 0) {
            const preSet = new Set(preselectedIds);
            const matchedIds = modalState.groups
                .filter(g => preSet.has(g.expenseRecordId))
                .map(g => g.expenseRecordId);
            if (matchedIds.length > 0) {
                modalState.selectedRecordIds = new Set(matchedIds);
            } else {
                modalState.selectedRecordIds = new Set(modalState.groups.map(g => g.expenseRecordId));
            }
        } else {
            modalState.selectedRecordIds = new Set(modalState.groups.map(g => g.expenseRecordId));
        }

        // 5. 从已有费用说明中智能预填人名与项目号
        for (const g of modalState.groups) {
            if (g.description) {
                const proxyMatch = g.description.match(/\[(?:外驻[:\+]?|外驻)([^\^\]]+)\]/);
                if (proxyMatch && !modalState.proxyPersonName) {
                    modalState.proxyPersonName = proxyMatch[1].trim();
                }
                const prjMatch = g.description.match(/(X\d{4}-\d{3}|[A-Z0-9]{2,8}-\d{3,4}|PRJ-[A-Z0-9\-]+)/);
                if (prjMatch && !modalState.projectName) {
                    modalState.projectName = prjMatch[1].trim();
                }
            }
        }

        // 6. 嗅探当前登录社员真实姓名
        let empName = detectCurrentEmployeeName(globalState, targetDoc);
        if (!empName) {
            try {
                const u = await fetchLoginUserInfo(globalState);
                if (u?.userName) {
                    empName = u.userName.replace(/（[^）]+）|\([^)]+\)/g, '').trim();
                }
            } catch (e) {}
        }
        modalState.currentEmployeeName = empName || '';

        renderModalContent(modal, targetDoc);

    } catch (err: any) {
        AutopilotLogger.error(`[BatchEditModal] 加载失败: ${err.message}`);
        showToast('error', `加载费用记录失败: ${err.message}`);
        closeBatchEditModal();
    }
}

/**
 * 关闭模态框
 */
export function closeBatchEditModal() {
    const docs = [document];
    if (typeof window !== 'undefined' && window.top && window.top.document && !docs.includes(window.top.document)) {
        docs.push(window.top.document);
    }
    docs.forEach(d => {
        try {
            const mask = d.getElementById('yn-batch-edit-mask');
            const modal = d.getElementById('yn-batch-edit-modal');
            if (mask) mask.style.display = 'none';
            if (modal) modal.style.display = 'none';
        } catch (e) { }
    });
    modalState.columnFilters = {};
    modalState.activePopoverCol = null;
    modalState.popoverKeyword = '';
    modalState.lastSelectedRecordId = null;
}

/**
 * 获取费用分组在指定列上的所有取值 (用于列筛选)
 */
function getGroupColumnValues(group: ExpenseRecordGroup, key: string): string[] {
    if (key === 'earliestInvoiceDate') return [group.earliestInvoiceDate || '-'];
    if (key === 'businessDate') return [group.newBusinessDate || group.businessDate || '-'];
    if (key === 'expenseTypeName') return [group.newExpenseTypeName || group.expenseTypeName || '-'];
    if (key === 'expenseAmount') return [`¥${Number(group.expenseAmount || 0).toFixed(2)}`];
    if (key === 'description') return [group.newDescription !== undefined ? group.newDescription : (group.description || '-')];
    if (key === 'invoiceCount') return [String(group.invoiceCount || 0)];

    const colDef = COLUMN_DEFINITIONS.find(c => c.key === key);
    if (colDef?.isDynamic) {
        const val = getGroupDynamicFieldValue(group, key);
        return [val || '-'];
    }

    if (!group.invoices || group.invoices.length === 0) return ['-'];

    const vals = new Set<string>();
    for (const inv of group.invoices) {
        let v = '';
        if (key === 'invoiceIndex') v = String(inv.invoiceIndex || 0);
        else if (key === 'invoiceType') v = inv.invoiceType || '-';
        else if (key === 'invoiceCode') v = inv.invoiceCode || '-';
        else if (key === 'invoiceNo') v = inv.invoiceNo || '-';
        else if (key === 'totalAmount') v = `¥${Number(inv.totalAmount || inv.amountTax || 0).toFixed(2)}`;
        else if (key === 'invoiceDate') v = inv.invoiceDate || '-';
        else if (key === 'departureTime') v = inv.departureTime || '-';
        else if (key === 'timeGetOff') v = inv.timeGetOff || '-';
        else if (key === 'stationGetOn') v = inv.stationGetOn || '-';
        else if (key === 'stationGetOff') v = inv.stationGetOff || '-';
        else if (key === 'salesName') v = inv.salesName || '-';
        else if (key === 'fileName') v = inv.fileName || '-';
        else if (key === 'remarks') v = inv.remarks || '-';
        else if (key === 'reconciliationNote') {
            v = inv.reconciliationNote ? inv.reconciliationNote.replace(/[⚠️✅]/g, '').trim() : '-';
        }
        if (v) vals.add(v);
    }
    return vals.size > 0 ? Array.from(vals) : ['-'];
}

/**
 * 提取费用分组在指定列上的主排序标量值
 */
function getGroupPrimarySortValue(group: ExpenseRecordGroup, key: string): any {
    if (key === 'earliestInvoiceDate') return group.earliestInvoiceDate || '';
    if (key === 'businessDate') return group.newBusinessDate || group.businessDate || '';
    if (key === 'expenseTypeName') return group.newExpenseTypeName || group.expenseTypeName || '';
    if (key === 'expenseAmount') return parseFloat(String(group.expenseAmount)) || 0;
    if (key === 'description') return group.newDescription !== undefined ? group.newDescription : (group.description || '');
    if (key === 'invoiceCount') return group.invoiceCount || 0;

    const colDef = COLUMN_DEFINITIONS.find(c => c.key === key);
    if (colDef?.isDynamic) {
        const val = getGroupDynamicFieldValue(group, key);
        if (colDef.isNumeric) return parseFloat(val) || 0;
        return val || '';
    }

    const inv0 = group.invoices[0];
    if (!inv0) return '';
    if (key === 'invoiceIndex') return inv0.invoiceIndex || 0;
    if (key === 'invoiceType') return inv0.invoiceType || '';
    if (key === 'invoiceCode') return inv0.invoiceCode || '';
    if (key === 'invoiceNo') return inv0.invoiceNo || '';
    if (key === 'totalAmount') return parseFloat(String(inv0.totalAmount || inv0.amountTax || 0)) || 0;
    if (key === 'invoiceDate') return inv0.invoiceDate || '';
    if (key === 'departureTime') return inv0.departureTime || '';
    if (key === 'timeGetOff') return inv0.timeGetOff || '';
    if (key === 'stationGetOn') return inv0.stationGetOn || '';
    if (key === 'stationGetOff') return inv0.stationGetOff || '';
    if (key === 'salesName') return inv0.salesName || '';
    if (key === 'fileName') return inv0.fileName || '';
    if (key === 'remarks') return inv0.remarks || '';
    if (key === 'reconciliationNote') return inv0.reconciliationNote ? inv0.reconciliationNote.replace(/[⚠️✅]/g, '').trim() : '';
    return '';
}

/**
 * 全字段头排序算法 (支持数值、日期时间与中文拼音)
 */
function sortGroups(groups: ExpenseRecordGroup[], key: string, asc: boolean) {
    const colDef = COLUMN_DEFINITIONS.find(c => c.key === key);
    const isNumeric = colDef?.isNumeric;

    groups.sort((a, b) => {
        const valA = getGroupPrimarySortValue(a, key);
        const valB = getGroupPrimarySortValue(b, key);

        if (isNumeric) {
            const numA = typeof valA === 'number' ? valA : (parseFloat(String(valA)) || 0);
            const numB = typeof valB === 'number' ? valB : (parseFloat(String(valB)) || 0);
            return asc ? numA - numB : numB - numA;
        }

        if (!valA && valB) return 1;
        if (valA && !valB) return -1;
        const res = String(valA).localeCompare(String(valB), 'zh-CN');
        return asc ? res : -res;
    });
}

/**
 * 获取指定列当前的所有离散唯一值分布及其出现频次 (降序排序)
 */
function getDistinctValuesForColumn(groups: ExpenseRecordGroup[], colKey: string): { value: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const g of groups) {
        const vals = getGroupColumnValues(g, colKey);
        for (const v of vals) {
            counts.set(v, (counts.get(v) || 0) + 1);
        }
    }
    const list = Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
    list.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh-CN'));
    return list;
}

/**
 * 筛选符合当前列字段值、全局搜索词与预警模式的费用分组
 */
function getFilteredGroups(state: BatchEditExpenseModalState): ExpenseRecordGroup[] {
    return state.groups.filter(g => {
        // 1. 预警与待补必填项过滤
        if (state.filterMode === 'WARN' && !g.hasWarn) return false;
        if (state.filterMode === 'MISSING_REQUIRED' && !isGroupMissingRequired(g)) return false;
        if (state.filterMode === 'OK' && (g.hasWarn || isGroupMissingRequired(g))) return false;

        // 2. 列字段值精准筛选 (Column-Level Distinct Value Filters)
        for (const [colKey, selectedVals] of Object.entries(state.columnFilters)) {
            if (selectedVals && selectedVals.length > 0) {
                const gVals = getGroupColumnValues(g, colKey);
                const hasMatch = selectedVals.some(sv => gVals.includes(sv));
                if (!hasMatch) return false;
            }
        }

        // 3. 全局搜索词模糊匹配
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            const groupHit = (g.earliestInvoiceDate && g.earliestInvoiceDate.toLowerCase().includes(q)) ||
                             (g.businessDate && g.businessDate.toLowerCase().includes(q)) ||
                             (g.newBusinessDate && g.newBusinessDate.toLowerCase().includes(q)) ||
                             (g.expenseTypeName && g.expenseTypeName.toLowerCase().includes(q)) ||
                             (g.newExpenseTypeName && g.newExpenseTypeName.toLowerCase().includes(q)) ||
                             (g.description && g.description.toLowerCase().includes(q)) ||
                             (g.newDescription && g.newDescription.toLowerCase().includes(q));
            const dynHit = g.dynamicFields && Object.values(g.dynamicFields).some(v =>
                v !== undefined && v !== null && String(v).toLowerCase().includes(q)
            );
            if (groupHit || dynHit) return true;

            const invHit = g.invoices.some(inv =>
                (inv.invoiceNo && inv.invoiceNo.toLowerCase().includes(q)) ||
                (inv.salesName && inv.salesName.toLowerCase().includes(q)) ||
                (inv.fileName && inv.fileName.toLowerCase().includes(q)) ||
                (inv.stationGetOn && inv.stationGetOn.toLowerCase().includes(q)) ||
                (inv.stationGetOff && inv.stationGetOff.toLowerCase().includes(q)) ||
                (inv.reconciliationNote && inv.reconciliationNote.toLowerCase().includes(q))
            );
            if (!invHit) return false;
        }

        return true;
    });
}

/**
 * 渲染列头筛选 Popover 浮层 HTML
 */
function renderColumnFilterPopoverHtml(colKey: string): string {
    const distinctVals = getDistinctValuesForColumn(modalState.groups, colKey);
    const selected = new Set(modalState.columnFilters[colKey] || []);
    const kw = (modalState.popoverKeyword || '').toLowerCase().trim();
    const filteredVals = kw ? distinctVals.filter(d => d.value.toLowerCase().includes(kw)) : distinctVals;

    return `
        <div class="yn-bem-filter-popover" id="yn-bem-filter-popover" data-col="${colKey}">
            <input type="text" class="yn-bem-filter-popover-search" id="yn-bem-popover-search"
                   placeholder="搜索字段值..." value="${modalState.popoverKeyword || ''}" autocomplete="off" />
            <div class="yn-bem-filter-popover-actions">
                <span class="yn-bem-filter-popover-link" id="yn-bem-popover-select-all">全选 (${distinctVals.length})</span>
                <span class="yn-bem-filter-popover-link" id="yn-bem-popover-clear">清空筛选</span>
            </div>
            <div class="yn-bem-filter-val-list">
                ${filteredVals.length === 0 ? `<div style="color:#a3a3a3; font-size:11px; padding:6px;">未匹配到值</div>` : ''}
                ${filteredVals.map(item => {
                    const isChecked = selected.has(item.value);
                    const safeVal = item.value.replace(/"/g, '&quot;');
                    return `
                        <label class="yn-bem-filter-val-item">
                            <input type="checkbox" class="yn-bem-col-val-cb" data-col="${colKey}" data-val="${safeVal}" ${isChecked ? 'checked' : ''} />
                            <span class="yn-bem-filter-val-text" title="${safeVal}">${item.value}</span>
                            <span class="yn-bem-filter-val-count">${item.count}</span>
                        </label>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

/**
 * 渲染顶部生效中的列筛选条件标签栏
 */
function renderActiveFilterTagsHtml(): string {
    const tags: { colKey: string; label: string; count: number; sampleVals: string }[] = [];
    for (const [colKey, vals] of Object.entries(modalState.columnFilters)) {
        if (vals && vals.length > 0) {
            const colDef = COLUMN_DEFINITIONS.find(c => c.key === colKey);
            const label = colDef ? colDef.label.split(' ')[0] : colKey;
            const sampleVals = vals.slice(0, 2).join(', ') + (vals.length > 2 ? `...等${vals.length}项` : '');
            tags.push({ colKey, label, count: vals.length, sampleVals });
        }
    }

    if (tags.length === 0) return '';

    return `
        <div class="yn-bem-active-filter-tags">
            <span style="color:#737373; font-weight:500;">筛选生效中:</span>
            ${tags.map(t => `
                <span class="yn-bem-active-filter-tag" data-col="${t.colKey}">
                    <span class="tag-field">${t.label}:</span>
                    <span class="tag-val" title="${(modalState.columnFilters[t.colKey] || []).join(', ')}">${t.sampleVals}</span>
                    <span class="tag-close yn-bem-remove-filter" data-col="${t.colKey}" title="移除此列筛选">✕</span>
                </span>
            `).join('')}
            <span class="yn-bem-clear-all-filters" id="yn-bem-clear-all-filters">清除全部筛选</span>
        </div>
    `;
}

export function getExpenseTypeEmoji(name: string, code?: string): string {
    return ''; // Vercel 设计规范：避免花哨卡通 Emoji 堆砌，采用纯净排版
}

function escapeHtml(str: any): string {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 解析各种格式的日期为时间戳（支持 YYYY-MM-DD, MM/DD/YYYY, YYYY/MM/DD 等）
 */
function parseDateToTimestamp(dateStr?: string): number {
    if (!dateStr) return NaN;
    const clean = String(dateStr).trim();
    // 1. 标准 YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
    const m1 = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m1) {
        return new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3])).getTime();
    }
    // 2. 美式 MM/DD/YYYY
    const m2 = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m2) {
        return new Date(Number(m2[3]), Number(m2[1]) - 1, Number(m2[2])).getTime();
    }
    return new Date(clean).getTime();
}

export interface HotelPricingDetail {
    nights: number;
    rooms: number;
    totalRoomNights: number;
    unitPrice: number;
    standardLimit: number;
    isOverStandard: boolean;
    formulaText: string;
}

/**
 * 测算住宿费详细单价指标 (严格根据 入住天数 × 房间数 = 总间夜数 测算单价)
 */
export function getHotelPricingDetail(group: ExpenseRecordGroup): HotelPricingDetail | null {
    const cat = getGroupCategory(group);
    if (cat !== 'HOTEL') return null;
    const dyn = group.dynamicFields || {};
    const checkIn = dyn.checkInDate;
    const checkOut = dyn.checkOutDate;
    const amount = Number(group.expenseAmount || 0);
    if (!checkIn || !checkOut || amount <= 0) return null;

    const d1 = parseDateToTimestamp(checkIn);
    const d2 = parseDateToTimestamp(checkOut);
    if (isNaN(d1) || isNaN(d2) || d2 <= d1) return null;

    const nights = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
    const rooms = Math.max(1, Number(dyn.roomNum) || 1);
    const totalRoomNights = Math.max(1, nights * rooms);

    const city = (dyn.city || '').replace(/市|区|县/g, '').trim();
    const isTier1 = /北京|上海|广州|深圳/.test(city);
    const standardLimit = isTier1 ? 800 : 700;
    const unitPrice = Math.round((amount / totalRoomNights) * 100) / 100;
    const isOverStandard = unitPrice > standardLimit;

    const formulaText = `${nights}晚 × ${rooms}间 = ${totalRoomNights}间夜，单价 ¥${unitPrice.toFixed(2)}/间夜 (总额 ¥${amount} ÷ ${totalRoomNights}间夜)，标准限额 ¥${standardLimit}/间夜 (${isTier1 ? '一线城市' : '其他城市'})`;

    return {
        nights,
        rooms,
        totalRoomNights,
        unitPrice,
        standardLimit,
        isOverStandard,
        formulaText
    };
}

/**
 * 判断住宿费记录是否超出标准 (按 天数 × 房间数 = 间夜数 测算单价：一线城市 ¥800/间夜, 其他城市 ¥700/间夜)
 */
export function isHotelGroupOverStandard(group: ExpenseRecordGroup): boolean {
    const detail = getHotelPricingDetail(group);
    return detail ? detail.isOverStandard : false;
}

/**
 * 判断费用分组是否缺失专属必填字段 (未完成/空)
 */
export function isGroupMissingRequired(group: ExpenseRecordGroup): boolean {
    const typeName = (group.newExpenseTypeName || group.expenseTypeName || '').trim();
    if (!typeName || typeName === 'None' || typeName === '未识别' || !group.expenseTypeId) {
        return true;
    }
    const cat = getGroupCategory(group);
    const dyn = group.dynamicFields || {};

    if (cat === 'HOTEL') {
        if (!dyn.checkInDate || !dyn.checkOutDate || !dyn.city) return true;
        if (isHotelGroupOverStandard(group) && !(dyn.overStandardDescription || '').trim()) {
            return true;
        }
    } else if (cat === 'FLIGHT') {
        if (!dyn.flightFromCity || !dyn.flightToCity || !dyn.flightNum || !dyn.flightStartDate || !dyn.flightEndDate) {
            return true;
        }
    } else if (cat === 'TRAIN') {
        if (!dyn.trainFromStation || !dyn.trainToStation || !dyn.trainStartDate || !dyn.trainEndDate) {
            return true;
        }
    } else if (cat === 'TAXI') {
        if (!dyn.startAddress || !dyn.endAddress) {
            return true;
        }
    } else if (cat === 'MOBILE') {
        if (!dyn.billMonth) {
            return true;
        }
    }
    return false;
}

/**
 * 核心约束 1: 筛选联动裁剪 (Selection Pruning)
 * 当用户触发任何筛选（过滤条件改变、搜索关键词变化等）导致数据列表刷新时，
 * 必须执行选中状态裁剪：selectedRowKeys = selectedRowKeys.filter(id => currentQueryResultIds.includes(id))
 * 严禁在当前筛选视图外保留不可见的隐藏选中项，彻底规避幽灵提交（Ghost Mutation）。
 */
export function pruneSelectedRecordIds(): void {
    const filtered = getFilteredGroups(modalState);
    const validIdSet = new Set(filtered.map(g => g.expenseRecordId));
    modalState.selectedRecordIds = new Set(
        Array.from(modalState.selectedRecordIds).filter(id => validIdSet.has(id))
    );
}

function isDynamicColumnApplicable(colKey: string, category: string): boolean {
    if (category === 'FLIGHT') {
        return ['dynFrom', 'dynTo', 'dynTransitNo', 'dynStartDate', 'dynEndDate'].includes(colKey);
    }
    if (category === 'TRAIN') {
        return ['dynFrom', 'dynTo', 'dynStartDate', 'dynEndDate'].includes(colKey);
    }
    if (category === 'HOTEL') {
        return ['dynCheckIn', 'dynCheckOut', 'dynCity', 'dynCityType', 'dynHotel', 'dynRoomNum', 'dynOverStandard'].includes(colKey);
    }
    if (category === 'TAXI') {
        return ['dynAddrFrom', 'dynAddrTo'].includes(colKey);
    }
    if (category === 'MOBILE') {
        return ['dynBillMonth'].includes(colKey);
    }
    if (category === 'OTHER') {
        return ['dynAddrFrom', 'dynAddrTo'].includes(colKey);
    }
    return false;
}

function getGroupDynamicFieldValue(group: ExpenseRecordGroup, colKey: string): string {
    const dyn = group.dynamicFields || {};
    const cat = getGroupCategory(group);
    switch (colKey) {
        case 'dynFrom':
            return cat === 'FLIGHT' ? (dyn.flightFromCity || '') : (cat === 'TRAIN' ? (dyn.trainFromStation || '') : '');
        case 'dynTo':
            return cat === 'FLIGHT' ? (dyn.flightToCity || '') : (cat === 'TRAIN' ? (dyn.trainToStation || '') : '');
        case 'dynTransitNo':
            return cat === 'FLIGHT' ? (dyn.flightNum || '') : '';
        case 'dynStartDate':
            return cat === 'FLIGHT' ? (dyn.flightStartDate || '') : (cat === 'TRAIN' ? (dyn.trainStartDate || '') : '');
        case 'dynEndDate':
            return cat === 'FLIGHT' ? (dyn.flightEndDate || '') : (cat === 'TRAIN' ? (dyn.trainEndDate || '') : '');
        case 'dynCheckIn':
            return dyn.checkInDate || '';
        case 'dynCheckOut':
            return dyn.checkOutDate || '';
        case 'dynCity':
            return dyn.city || '';
        case 'dynCityType': {
            const c = (dyn.city || '').replace(/市|区|县/g, '').trim();
            if (!c) return dyn.cityType || '';
            const isTier1 = /北京|上海|广州|深圳/.test(c);
            return isTier1 ? '境内-北上广深' : '境内-其他';
        }
        case 'dynHotel':
            return dyn.hotelName || '';
        case 'dynRoomNum':
            return dyn.roomNum !== undefined && dyn.roomNum !== null ? String(dyn.roomNum) : '';
        case 'dynOverStandard':
            return dyn.overStandardDescription || '';
        case 'dynAddrFrom':
            return dyn.startAddress || '';
        case 'dynAddrTo':
            return dyn.endAddress || '';
        case 'dynBillMonth':
            return dyn.billMonth || '';
        default:
            return '';
    }
}

function setGroupDynamicFieldValue(group: ExpenseRecordGroup, colKey: string, value: string) {
    group.dynamicFields = group.dynamicFields || {};
    const cat = getGroupCategory(group);
    const v = value.trim();
    switch (colKey) {
        case 'dynFrom':
            if (cat === 'FLIGHT') group.dynamicFields.flightFromCity = v;
            else if (cat === 'TRAIN') group.dynamicFields.trainFromStation = v;
            break;
        case 'dynTo':
            if (cat === 'FLIGHT') group.dynamicFields.flightToCity = v;
            else if (cat === 'TRAIN') group.dynamicFields.trainToStation = v;
            break;
        case 'dynTransitNo':
            if (cat === 'FLIGHT') group.dynamicFields.flightNum = v;
            break;
        case 'dynStartDate':
            if (cat === 'FLIGHT') group.dynamicFields.flightStartDate = v;
            else if (cat === 'TRAIN') group.dynamicFields.trainStartDate = v;
            break;
        case 'dynEndDate':
            if (cat === 'FLIGHT') group.dynamicFields.flightEndDate = v;
            else if (cat === 'TRAIN') group.dynamicFields.trainEndDate = v;
            break;
        case 'dynCheckIn':
            group.dynamicFields.checkInDate = v;
            if (v && cat === 'HOTEL') {
                group.newBusinessDate = v;
            }
            break;
        case 'dynCheckOut':
            group.dynamicFields.checkOutDate = v;
            break;
        case 'dynCity':
            group.dynamicFields.city = v;
            if (v) {
                const c = v.replace(/市|区|县/g, '').trim();
                const isTier1 = /北京|上海|广州|深圳/.test(c);
                group.dynamicFields.cityType = isTier1 ? '境内-北上广深' : '境内-其他';
            }
            break;
        case 'dynCityType':
            group.dynamicFields.cityType = v;
            break;
        case 'dynHotel':
            group.dynamicFields.hotelName = v;
            break;
        case 'dynRoomNum':
            group.dynamicFields.roomNum = v ? Number(v) : undefined;
            break;
        case 'dynOverStandard':
            group.dynamicFields.overStandardDescription = v;
            break;
        case 'dynAddrFrom':
            group.dynamicFields.startAddress = v;
            break;
        case 'dynAddrTo':
            group.dynamicFields.endAddress = v;
            break;
        case 'dynBillMonth':
            group.dynamicFields.billMonth = v;
            break;
    }
}

function renderDynamicFieldCellHtml(group: ExpenseRecordGroup, col: ColumnDef, span: number): string {
    const cat = getGroupCategory(group);
    const isApp = isDynamicColumnApplicable(col.key, cat);

    if (!isApp) {
        return `
            <td class="yn-bem-group-cell yn-bem-dyn-cell-na" rowspan="${span}">
                <span>-</span>
            </td>
        `;
    }

    const isOverStandardCol = col.key === 'dynOverStandard';
    const isHotelOver = isOverStandardCol && isHotelGroupOverStandard(group);

    const val = getGroupDynamicFieldValue(group, col.key);
    const isEmpty = isOverStandardCol ? (isHotelOver && (!val || String(val).trim() === '')) : (!val || String(val).trim() === '');
    const aiType = !isEmpty ? (group.inferredFields?.[col.key] || (col.dynFieldKey ? group.inferredFields?.[col.dynFieldKey] : undefined)) : undefined;
    const isAiInferred = Boolean(aiType);

    let catClass = '';
    if (cat === 'FLIGHT') catClass = 'yn-bem-dyn-cell-flight';
    else if (cat === 'TRAIN') catClass = 'yn-bem-dyn-cell-train';
    else if (cat === 'HOTEL') catClass = isHotelOver ? 'yn-bem-dyn-cell-hotel yn-bem-dyn-cell-over-standard' : 'yn-bem-dyn-cell-hotel';
    else if (cat === 'TAXI') catClass = 'yn-bem-dyn-cell-taxi';
    else if (cat === 'MOBILE') catClass = 'yn-bem-dyn-cell-mobile';

    const warnClass = isEmpty ? 'yn-bem-dyn-cell-empty' : '';
    const aiClass = isAiInferred ? 'yn-bem-dyn-cell-ai' : '';
    const inputType = col.dynInputType || 'text';
    const isMono = col.isNumeric || col.isDate || col.key === 'dynTransitNo' || col.key === 'dynBillMonth';

    let titleText = isAiInferred
        ? `${col.label} · ${aiType === 'llm' ? '✨ AI结合排期/大模型深度推理' : '✨ AI发票证据链提取'}: ${val}`
        : `${col.label}${isEmpty ? ' (专属必填·未填写)' : ''}`;

    const isCityTypeCol = col.key === 'dynCityType';
    let placeholderText = isEmpty ? (isCityTypeCol ? '自动推导' : '必填') : '';
    const readOnlyAttr = isCityTypeCol ? 'readonly style="background:#f9fafb; color:#374151; cursor:not-allowed;"' : '';
    let cellTitle = isCityTypeCol ? `住宿城市类型 · 依据出差城市自动联动 (北上广深: 境内-北上广深 ¥800/晚, 其他: 境内-其他 ¥700/晚): ${val || '待录入出差城市'}` : titleText;

    if (isOverStandardCol) {
        const detail = getHotelPricingDetail(group);
        if (isHotelOver) {
            placeholderText = '超标必填 (自主填写或点击📋拷贝)';
            cellTitle = `⚠️ 住宿费已超标：${detail ? detail.formulaText : ''}！超标说明为必填项，请自主输入理由，或点击右侧 📋 拷贝“费用说明”`;
        } else {
            placeholderText = '未超标(选填)';
            cellTitle = detail
                ? `超标说明 · 系统测算未超标: ${detail.formulaText}`
                : '超标说明 · 系统测算未超标，无需填写';
        }
    }

    return `
        <td class="yn-bem-group-cell yn-bem-cell-interactive ${catClass} ${warnClass} ${aiClass}"
            rowspan="${span}"
            title="${cellTitle}">
            <div class="yn-bem-dyn-cell-inner">
                <input type="${inputType}"
                       class="yn-bem-dyn-input ${isMono ? 'mono' : ''} ${isAiInferred ? 'is-ai-inferred' : ''}"
                       data-recordid="${group.expenseRecordId}"
                       data-dynkey="${col.key}"
                       value="${escapeHtml(val)}"
                       placeholder="${placeholderText}"
                       ${readOnlyAttr}
                       ${col.key === 'dynRoomNum' ? 'min="1" max="99"' : ''} />
                ${isOverStandardCol ? `
                    <button type="button"
                            class="yn-bem-cell-copy-desc-btn"
                            data-recordid="${group.expenseRecordId}"
                            title="点击一键拷贝该行“费用说明”作为超标理由">
                        📋
                    </button>
                ` : ''}
                ${isAiInferred ? `<span class="yn-bem-ai-sparkle-dot" title="${cellTitle}">✨</span>` : ''}
            </div>
        </td>
    `;
}

function renderTypeTreeOptionsHtml(tree: ExpenseTypeTreeNode[], selectedId: string): string {
    const isUnselected = !selectedId || selectedId === 'UNIDENTIFIED';
    const unselectedHtml = isUnselected ? `<option value="" disabled selected>-- 请选择费用类型 --</option>` : '';

    if (!tree || tree.length === 0) {
        // 基于系统元数据兜底 (零延迟秒级响应)
        return unselectedHtml + `
            <optgroup label="差旅费">
                <option value="0356c4cef03345af7f1906ec05cc0000" data-name="出租车（taxi）" ${selectedId === '0356c4cef03345af7f1906ec05cc0000' ? 'selected' : ''}>出租车（taxi）</option>
                <option value="0356c4e2b72de1653e55bb00bc610001" data-name="住宿费（宿泊代）" ${selectedId === '0356c4e2b72de1653e55bb00bc610001' ? 'selected' : ''}>住宿费（宿泊代）</option>
                <option value="035671613fdde1653e55bb00bc610000" data-name="飞机票（航空券）" ${selectedId === '035671613fdde1653e55bb00bc610000' ? 'selected' : ''}>飞机票（航空券）</option>
                <option value="0356c4c2b14de1653e55bb00bc610000" data-name="火车公交车票 （電車Bus代）" ${selectedId === '0356c4c2b14de1653e55bb00bc610000' ? 'selected' : ''}>火车公交车票 （電車Bus代）</option>
                <option value="0356c4f6701345af7f1906ec05cc0000" data-name="通信传真费（通信代）" ${selectedId === '0356c4f6701345af7f1906ec05cc0000' ? 'selected' : ''}>通信传真费（通信代）</option>
                <option value="0356c50fb32345af7f1906ec05cc0000" data-name="差旅费-其他(その他）" ${selectedId === '0356c50fb32345af7f1906ec05cc0000' ? 'selected' : ''}>差旅费-其他(その他）</option>
            </optgroup>
            <optgroup label="交通费">
                <option value="0356c529e72de1653e55bb00bc610001" data-name="市内交通费" ${selectedId === '0356c529e72de1653e55bb00bc610001' ? 'selected' : ''}>市内交通费</option>
                <option value="0356c4d862b345af7f1906ec05cc0000" data-name="交通费-其他(その他）" ${selectedId === '0356c4d862b345af7f1906ec05cc0001' ? 'selected' : ''}>交通费-其他(その他）</option>
            </optgroup>
            <optgroup label="交际费">
                <option value="0356c536aa6345af7f1906ec05cc0001" data-name="社外交际费" ${selectedId === '0356c536aa6345af7f1906ec05cc0001' ? 'selected' : ''}>社外交际费</option>
                <option value="0356c541ccf345af7f1906ec05cc0001" data-name="社内交际费" ${selectedId === '0356c541ccf345af7f1906ec05cc0001' ? 'selected' : ''}>社内交际费</option>
            </optgroup>
            <optgroup label="其他费用">
                <option value="0356c577f8ede1653e55bb00bc610001" data-name="通信费-员工手机费" ${selectedId === '0356c577f8ede1653e55bb00bc610001' ? 'selected' : ''}>通信费-员工手机费</option>
                <option value="0356c563094345af7f1906ec05cc0001" data-name="会议费" ${selectedId === '0356c563094345af7f1906ec05cc0001' ? 'selected' : ''}>会议费</option>
                <option value="0356c56b795de1653e55bb00bc610001" data-name="一般福利费-部门团建" ${selectedId === '0356c56b795de1653e55bb00bc610001' ? 'selected' : ''}>一般福利费-部门团建</option>
                <option value="0356d83a77c2de1653e55bb00bc610000" data-name="培训费" ${selectedId === '0356d83a77c2de1653e55bb00bc610000' ? 'selected' : ''}>培训费</option>
                <option value="0356c583e17de1653e55bb00bc610000" data-name="其他费用" ${selectedId === '0356c583e17de1653e55bb00bc610000' ? 'selected' : ''}>其他费用</option>
            </optgroup>
        `;
    }

    const treeOptions = tree.map(cat => {
        if (!cat.children || cat.children.length === 0) {
            const isSel = cat.id === selectedId;
            return `<option value="${cat.id}" data-name="${cat.name}" ${isSel ? 'selected' : ''}>${cat.name}</option>`;
        }
        const options = cat.children.map(leaf => {
            const isSel = leaf.id === selectedId;
            return `<option value="${leaf.id}" data-name="${leaf.name}" ${isSel ? 'selected' : ''}>${leaf.name}</option>`;
        }).join('');
        return `<optgroup label="${cat.name}">${options}</optgroup>`;
    }).join('');

    return unselectedHtml + treeOptions;
}

function renderDynamicFieldsCardHtml(): string {
    const targetId = modalState.targetExpenseTypeId;
    const targetName = modalState.targetExpenseTypeName;
    const dyn = modalState.dynamicFields || {};

    let activeCategory: 'HOTEL' | 'FLIGHT' | 'TRAIN' | 'TAXI' | 'MOBILE' | 'OTHER' = 'OTHER';
    let title = '';
    let isHighlight = false;

    if (targetId) {
        activeCategory = detectTypeCategory(targetId, targetName);
        title = `待变更类型【${targetName}】专属必填参数设定:`;
        isHighlight = true;
    } else {
        // 保持原类型：检查当前选中的记录是否为同一种类型
        const selectedGroups = modalState.groups.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));
        const uniqueTypes = Array.from(new Set(selectedGroups.map(g => g.expenseTypeId)));
        if (uniqueTypes.length === 1 && selectedGroups[0]) {
            const firstGroup = selectedGroups[0];
            activeCategory = detectTypeCategory(firstGroup.expenseTypeId, firstGroup.expenseTypeName);
            title = `【${firstGroup.expenseTypeName}】专属参数批量设定:`;
        } else if (uniqueTypes.length > 1) {
            return `
                <div class="yn-bem-dynamic-fields-card type-neutral" id="yn-bem-dynamic-fields-card">
                    <span class="yn-bem-dyn-title" style="color:#737373;">提示</span>
                    <span style="color:#737373;">
                        当前选中的 ${selectedGroups.length} 笔记录包含 ${uniqueTypes.length} 种费用类型。如需指定专属字段，请先在上方「变更报销类型」选择目标类型，或按同类单据勾选。
                    </span>
                </div>
            `;
        } else {
            return `
                <div class="yn-bem-dynamic-fields-card type-neutral" id="yn-bem-dynamic-fields-card">
                    <span class="yn-bem-dyn-title" style="color:#737373;">提示</span>
                    <span style="color:#737373;">
                        请勾选待处理的费用记录；如需变更报销类型并填写专属必填字段，请在上方下拉框选择目标类型。
                    </span>
                </div>
            `;
        }
    }

    let fieldsHtml = '';
    if (activeCategory === 'HOTEL') {
        fieldsHtml = `
            <div class="yn-bem-field-group">
                <label>酒店名称:</label>
                <input type="text" id="yn-bem-dyn-hotel" class="yn-bem-input" value="${dyn.hotelName || ''}" placeholder="如: 锦江之星" style="width:130px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>出差城市:</label>
                <input type="text" id="yn-bem-dyn-city" class="yn-bem-input" value="${dyn.city || ''}" placeholder="如: 上海" style="width:75px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>入住日期:</label>
                <input type="date" id="yn-bem-dyn-check-in" class="yn-bem-input" value="${dyn.checkInDate || ''}" style="width:125px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>离店日期:</label>
                <input type="date" id="yn-bem-dyn-check-out" class="yn-bem-input" value="${dyn.checkOutDate || ''}" style="width:125px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>房间数:</label>
                <input type="number" id="yn-bem-dyn-rooms" class="yn-bem-input" value="${dyn.roomNum !== undefined ? dyn.roomNum : 1}" min="1" max="99" style="width:48px;" />
            </div>
            <span class="yn-bem-quick-link" id="yn-bem-dyn-qa-hotel-extract" title="从发票销方名称提取酒店名">从销方提取</span>
            <span class="yn-bem-quick-link" id="yn-bem-dyn-qa-hotel-date" title="开票日设为入住日，次日设为离店日">推导住离日</span>
        `;
    } else if (activeCategory === 'FLIGHT') {
        fieldsHtml = `
            <div class="yn-bem-field-group">
                <label>出发城市:</label>
                <input type="text" id="yn-bem-dyn-flight-from" class="yn-bem-input" value="${dyn.flightFromCity || ''}" placeholder="如: 上海" style="width:75px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>到达城市:</label>
                <input type="text" id="yn-bem-dyn-flight-to" class="yn-bem-input" value="${dyn.flightToCity || ''}" placeholder="如: 大连" style="width:75px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>起飞日期:</label>
                <input type="date" id="yn-bem-dyn-flight-start" class="yn-bem-input" value="${dyn.flightStartDate || ''}" style="width:125px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>到达日期:</label>
                <input type="date" id="yn-bem-dyn-flight-end" class="yn-bem-input" value="${dyn.flightEndDate || ''}" style="width:125px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>航班号:</label>
                <input type="text" id="yn-bem-dyn-flight-num" class="yn-bem-input" value="${dyn.flightNum || ''}" placeholder="如: MU5183" style="width:85px; font-family:ui-monospace, monospace;" />
            </div>
            <span class="yn-bem-quick-link" id="yn-bem-dyn-qa-flight-sync" title="将起降日期同步为最早开票日">对齐开票日</span>
        `;
    } else if (activeCategory === 'TRAIN') {
        fieldsHtml = `
            <div class="yn-bem-field-group">
                <label>出发站:</label>
                <input type="text" id="yn-bem-dyn-train-from" class="yn-bem-input" value="${dyn.trainFromStation || ''}" placeholder="如: 合肥南" style="width:85px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>到达站:</label>
                <input type="text" id="yn-bem-dyn-train-to" class="yn-bem-input" value="${dyn.trainToStation || ''}" placeholder="如: 上海虹桥" style="width:85px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>发车日期:</label>
                <input type="date" id="yn-bem-dyn-train-start" class="yn-bem-input" value="${dyn.trainStartDate || ''}" style="width:125px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>到达日期:</label>
                <input type="date" id="yn-bem-dyn-train-end" class="yn-bem-input" value="${dyn.trainEndDate || ''}" style="width:125px;" />
            </div>
            <span class="yn-bem-quick-link" id="yn-bem-dyn-qa-train-extract" title="从车票发票提取站名与日期">从车票提取</span>
        `;
    } else if (activeCategory === 'TAXI') {
        fieldsHtml = `
            <div class="yn-bem-field-group">
                <label>始发地:</label>
                <input type="text" id="yn-bem-dyn-traffic-from" class="yn-bem-input" value="${dyn.startAddress || ''}" placeholder="出发地址" style="width:130px;" />
            </div>
            <div class="yn-bem-field-group">
                <label>目的地:</label>
                <input type="text" id="yn-bem-dyn-traffic-to" class="yn-bem-input" value="${dyn.endAddress || ''}" placeholder="到达地址" style="width:130px;" />
            </div>
            <span class="yn-bem-quick-link" id="yn-bem-dyn-qa-traffic-extract" title="从行程单发票中提取始发与目的地">从行程单提取</span>
        `;
    } else if (activeCategory === 'MOBILE') {
        fieldsHtml = `
            <div class="yn-bem-field-group">
                <label>账期月份:</label>
                <input type="month" id="yn-bem-dyn-mobile-month" class="yn-bem-input" value="${dyn.billMonth || ''}" style="width:125px;" />
            </div>
            <span class="yn-bem-quick-link" id="yn-bem-dyn-qa-mobile-sync" title="根据最早开票日自动推导月份">按开票日推导</span>
        `;
    } else {
        fieldsHtml = `
            <div class="yn-bem-field-group">
                <label>附加事由 / 说明:</label>
                <input type="text" id="yn-bem-dyn-extra-desc" class="yn-bem-input" value="${dyn.extraDesc || ''}" placeholder="输入附加业务说明" style="width:260px;" />
            </div>
        `;
    }

    return `
        <div class="yn-bem-dynamic-fields-card ${isHighlight ? 'type-highlight' : ''}" id="yn-bem-dynamic-fields-card">
            <span class="yn-bem-dyn-title">${title}</span>
            <div class="yn-bem-dyn-fields">
                ${fieldsHtml}
            </div>
        </div>
    `;
}

function renderDynamicSubTags(dyn?: DynamicExpenseFieldValues): string {
    if (!dyn) return '';
    const parts: string[] = [];
    if (dyn.hotelName) parts.push(dyn.hotelName);
    if (dyn.city) parts.push(dyn.city);
    if (dyn.checkInDate || dyn.checkOutDate) {
        parts.push(`${dyn.checkInDate || ''} ~ ${dyn.checkOutDate || ''}`);
    }
    if (dyn.roomNum && dyn.roomNum > 1) parts.push(`${dyn.roomNum}间`);

    if (dyn.flightFromCity || dyn.flightToCity) {
        parts.push(`${dyn.flightFromCity || ''} → ${dyn.flightToCity || ''}`);
    }
    if (dyn.flightNum) parts.push(dyn.flightNum);
    if (dyn.flightStartDate) parts.push(dyn.flightStartDate);

    if (dyn.trainFromStation || dyn.trainToStation) {
        parts.push(`${dyn.trainFromStation || ''} → ${dyn.trainToStation || ''}`);
    }
    if (dyn.trainNum) parts.push(dyn.trainNum);

    if (dyn.startAddress || dyn.endAddress) {
        parts.push(`${dyn.startAddress || ''} → ${dyn.endAddress || ''}`);
    }
    if (dyn.billMonth) {
        parts.push(`账期: ${dyn.billMonth}`);
    }
    if (dyn.extraDesc) {
        parts.push(dyn.extraDesc);
    }

    if (parts.length === 0) return '';
    return `<div class="yn-bem-sub-field-tag" title="${parts.join(' | ')}">${parts.join(' · ')}</div>`;
}

/**
 * 渲染顶部融合操作条 (Vercel Shell & Toolbar 风格)
 */
function renderTopBarHtml(filteredGroups: ExpenseRecordGroup[]): string {
    const totalGroups = modalState.groups.length;
    const totalInvoices = modalState.groups.reduce((sum, g) => sum + g.invoices.length, 0);
    const warnCount = modalState.groups.filter(g => g.hasWarn).length;
    const missingRequiredCount = modalState.groups.filter(g => isGroupMissingRequired(g)).length;

    return `
        <div class="yn-bem-top-bar">
            <!-- 第 1 行：品牌标题 + 统计徽章 + 预警指示 + 关闭按钮 -->
            <div class="yn-bem-bar-row" style="justify-content: space-between;">
                <div class="yn-bem-header-left">
                    <span class="yn-bem-brand">
                        批量修改费用信息
                        <span class="yn-bem-brand-badge">最早开票日聚合 · ${totalGroups} 笔费用 (${totalInvoices} 张发票)</span>
                    </span>
                    ${warnCount > 0 ? `<span class="yn-bem-warn-indicator">检出 ${warnCount} 处开票与行程日期差异</span>` : ''}
                </div>
                <button class="yn-bem-close-x" id="yn-bem-close-btn" title="关闭 (Esc)">✕</button>
            </div>

            <!-- 第 2 行：批量参数配置流 (出差 / 报销 / 项目实时搜索 / 变更类型 / 备注 / 业务日期 / 格式) -->
            <div class="yn-bem-bar-row">
                <div class="yn-bem-field-group">
                    <label>出差区分:</label>
                    <select id="yn-bem-opt-trip" class="yn-bem-select">
                        <option value="true" ${modalState.isTrip ? 'selected' : ''}>异地出差</option>
                        <option value="false" ${!modalState.isTrip ? 'selected' : ''}>市内 / 日常</option>
                    </select>
                </div>

                <div class="yn-bem-field-group">
                    <label>报销类型:</label>
                    <select id="yn-bem-opt-proxy" class="yn-bem-select">
                        <option value="true" ${modalState.isProxy ? 'selected' : ''}>外驻代报销</option>
                        <option value="false" ${!modalState.isProxy ? 'selected' : ''}>本人报销</option>
                    </select>
                </div>

                <div class="yn-bem-field-group" id="yn-bem-group-proxy-name" style="${modalState.isProxy ? '' : 'display:none;'}">
                    <label>外驻人名:</label>
                    <input type="text" id="yn-bem-input-proxy-name" class="yn-bem-input"
                           value="${modalState.proxyPersonName}" placeholder="如: 李建勇" style="width:80px; font-weight:600;" />
                </div>

                <div class="yn-bem-field-group">
                    <label>归属项目:</label>
                    <div class="yn-bem-project-wrapper" id="yn-bem-project-wrapper">
                        <input type="text" id="yn-bem-input-project" class="yn-bem-input"
                               value="${modalState.projectName}" placeholder="搜索项目代码/名称..." style="width:150px; font-weight:600;" autocomplete="off" />
                        <div id="yn-bem-project-dropdown" class="yn-bem-project-dropdown"></div>
                    </div>
                </div>

                <div class="yn-bem-field-group">
                    <label>变更报销类型:</label>
                    <select id="yn-bem-opt-target-type" class="yn-bem-select" style="font-weight:600; color:#171717; max-width:180px;">
                        <option value="">-- 保持原类型 (不变更) --</option>
                        ${renderTypeTreeOptionsHtml(modalState.expenseTypeTree, modalState.targetExpenseTypeId)}
                    </select>
                </div>

                <div class="yn-bem-field-group">
                    <label>自定义备注:</label>
                    <input type="text" id="yn-bem-input-remark" class="yn-bem-input"
                           value="${modalState.customRemark}" placeholder="为空不显" style="width:110px;" />
                </div>

                <div class="yn-bem-field-group">
                    <label>批量业务日期:</label>
                    <input type="date" id="yn-bem-input-biz-date" class="yn-bem-input"
                           value="${modalState.batchBusinessDate}" style="width:125px; font-family:ui-monospace, monospace;" />
                    <span class="yn-bem-quick-link" id="yn-bem-qa-sync-earliest-date" title="将已选费用的业务日期同步为其最早开票日">按最早开票日</span>
                </div>

                <div class="yn-bem-field-group" style="margin-left:auto; display:flex; gap:8px; align-items:center;">
                    <button class="yn-bem-btn-ai" id="yn-bem-btn-ai-infer" title="基于发票证据链与大模型智能补全各类型专属必填字段">
                        ✨ AI 智能推断
                    </button>
                    <button class="yn-bem-btn yn-bem-btn-apply" id="yn-bem-btn-apply">
                        应用到已选 (预览更新)
                    </button>
                </div>
            </div>

            <!-- 专属动态必填字段批量输入卡片 -->
            ${renderDynamicFieldsCardHtml()}

            <!-- 第 3 行：格式预设 (Segmented Control) + 实时预览 + 补交通地址 + 快速筛选与检索 -->
            <div class="yn-bem-bar-row" style="border-top:1px solid #f0f0f0; padding-top:8px;">
                <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:320px;">
                    <span style="font-size:11px; color:#737373; font-weight:500;">格式预设:</span>
                    <div class="yn-bem-segmented-wrap">
                        <button type="button" class="yn-bem-preset-btn ${modalState.formatTemplate === '[\${employee}]-[\${project}]-[\${remark}]' ? 'active' : ''}" data-tpl="[\${employee}]-[\${project}]-[\${remark}]" title="使用 [当前社员名]-[项目号]-[备注]">[当前社员名]-[项目号]</button>
                        <button type="button" class="yn-bem-preset-btn ${modalState.formatTemplate === '[${project}]-[${remark}]' ? 'active' : ''}" data-tpl="[\${project}]-[\${remark}]" title="使用 [项目]-[备注]">[仅项目]</button>
                    </div>

                    <input type="text" id="yn-bem-input-template" class="yn-bem-input"
                           value="${modalState.formatTemplate}" style="width:250px; font-family:ui-monospace, monospace; font-size:11px;"
                           title="支持模板变量: \${employee}当前社员名, \${name}外驻人名, \${project}项目, \${remark}自定义备注" />

                    <span style="font-size:11px; color:#737373; font-weight:500; margin-left:4px;">预览:</span>
                    <div class="yn-bem-preview-pill" id="yn-bem-preview-pill">
                        ${computeFormattedDescription(modalState, modalState.groups[0])}
                    </div>
                </div>

                <div style="display:flex; align-items:center; gap:8px;">
                    <label style="font-size:11px; color:#525252; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="yn-bem-chk-fill-addr" ${modalState.fillAddresses ? 'checked' : ''} />
                        补交通始发/到达
                    </label>

                    <input type="text" id="yn-bem-search" class="yn-bem-input"
                           placeholder="搜索开票日/发票号/销方/说明..." style="width:190px;" value="${modalState.searchQuery}" />

                    <div style="display:inline-flex; align-items:center; gap:4px;">
                        <span class="yn-bem-quick-link" id="yn-bem-qa-select-all">全选</span>
                        <span class="yn-bem-quick-link" id="yn-bem-qa-deselect">全不选</span>
                        <span class="yn-bem-quick-link" id="yn-bem-qa-invert">反选</span>
                        ${missingRequiredCount > 0 ? `<span class="yn-bem-quick-link" id="yn-bem-qa-select-missing" style="color:#dc2626; border-color:#fee2e2; background:#fef2f2;">仅选待补 (${missingRequiredCount})</span>` : ''}
                        ${warnCount > 0 ? `<span class="yn-bem-quick-link" id="yn-bem-qa-select-warn" style="color:#b45309; border-color:#fef3c7; background:#fffbeb;">仅选预警 (${warnCount})</span>` : ''}
                    </div>

                    <select id="yn-bem-filter-mode" class="yn-bem-select" style="font-size:11px; padding:2px 6px;">
                        <option value="ALL" ${modalState.filterMode === 'ALL' ? 'selected' : ''}>全部 (${totalGroups})</option>
                        <option value="MISSING_REQUIRED" ${modalState.filterMode === 'MISSING_REQUIRED' ? 'selected' : ''}>待补必填 (${missingRequiredCount})</option>
                        <option value="WARN" ${modalState.filterMode === 'WARN' ? 'selected' : ''}>预警 (${warnCount})</option>
                        <option value="OK" ${modalState.filterMode === 'OK' ? 'selected' : ''}>正常 (${totalGroups - warnCount - missingRequiredCount})</option>
                    </select>
                </div>
            </div>

            <!-- 活跃列筛选条件标签栏 -->
            <div id="yn-bem-active-filters-wrap">
                ${renderActiveFilterTagsHtml()}
            </div>
        </div>
    `;
}

/**
 * 按 ID 递归查找费用类型名称
 */
function findExpenseTypeNameById(nodes: ExpenseTypeTreeNode[], id: string): string {
    for (const n of nodes) {
        if (n.id === id) return n.name;
        if (n.children && n.children.length > 0) {
            const found = findExpenseTypeNameById(n.children, id);
            if (found) return found;
        }
    }
    return '';
}

/**
 * 渲染行级专属必填字段模态浮层 HTML
 */
function renderRowDynamicModalHtml(group: ExpenseRecordGroup): string {
    const activeTypeId = group.newExpenseTypeId || group.expenseTypeId;
    const activeTypeName = group.newExpenseTypeName || group.expenseTypeName || '未分类';
    const cat = detectTypeCategory(activeTypeId, activeTypeName);
    const dyn = group.dynamicFields || {};

    let fieldsHtml = `
        <div class="yn-bem-row-dyn-field">
            <label>报销类型:</label>
            <select id="yn-row-dyn-type-select" style="width:100%; height:28px; font-size:12px; border:1px solid #d4d4d4; border-radius:4px; padding:2px 6px;">
                ${renderTypeTreeOptionsHtml(modalState.expenseTypeTree, activeTypeId)}
            </select>
        </div>
    `;

    if (cat === 'FLIGHT') {
        fieldsHtml += `
            <div class="yn-bem-row-dyn-field">
                <label>起飞日期 (含时间):</label>
                <input type="date" id="yn-row-dyn-flight-start" value="${dyn.flightStartDate || ''}" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>到达日期 (含时间):</label>
                <input type="date" id="yn-row-dyn-flight-end" value="${dyn.flightEndDate || ''}" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>出发城市:</label>
                <input type="text" id="yn-row-dyn-flight-from" value="${dyn.flightFromCity || ''}" placeholder="如: 上海" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>到达城市:</label>
                <input type="text" id="yn-row-dyn-flight-to" value="${dyn.flightToCity || ''}" placeholder="如: 大连" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>航班号:</label>
                <input type="text" id="yn-row-dyn-flight-num" value="${dyn.flightNum || ''}" placeholder="如: MU5678" />
            </div>
        `;
    } else if (cat === 'TRAIN') {
        fieldsHtml += `
            <div class="yn-bem-row-dyn-field">
                <label>发车日期:</label>
                <input type="date" id="yn-row-dyn-train-start" value="${dyn.trainStartDate || ''}" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>到达日期:</label>
                <input type="date" id="yn-row-dyn-train-end" value="${dyn.trainEndDate || ''}" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>出发站:</label>
                <input type="text" id="yn-row-dyn-train-from" value="${dyn.trainFromStation || ''}" placeholder="如: 上海虹桥" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>到达站:</label>
                <input type="text" id="yn-row-dyn-train-to" value="${dyn.trainToStation || ''}" placeholder="如: 合肥南" />
            </div>
        `;
    } else if (cat === 'HOTEL') {
        fieldsHtml += `
            <div class="yn-bem-row-dyn-field">
                <label>入住日期:</label>
                <input type="date" id="yn-row-dyn-check-in" value="${dyn.checkInDate || ''}" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>离店日期:</label>
                <input type="date" id="yn-row-dyn-check-out" value="${dyn.checkOutDate || ''}" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>出差城市:</label>
                <input type="text" id="yn-row-dyn-city" value="${dyn.city || ''}" placeholder="如: 天津市" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>住宿城市类型:</label>
                <input type="text" id="yn-row-dyn-city-type" value="${dyn.cityType || (dyn.city ? (/北京|上海|广州|深圳/.test(dyn.city.replace(/市|区|县/g, '').trim()) ? '境内-北上广深' : '境内-其他') : '')}" readonly style="background:#f5f5f5; color:#525252; cursor:not-allowed;" title="依据出差城市自动联动推导 (北上广深: ¥800/晚, 其他: ¥700/晚)" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>酒店名称:</label>
                <input type="text" id="yn-row-dyn-hotel" value="${dyn.hotelName || ''}" placeholder="如: 锦江之星酒店" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>房间数:</label>
                <input type="number" id="yn-row-dyn-room-num" value="${dyn.roomNum !== undefined ? dyn.roomNum : 1}" min="1" max="99" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <label style="margin:0;">超标说明 ${isHotelGroupOverStandard(group) ? '<span style="color:#dc2626; font-weight:600;">(⚠️ 已超标·必填)</span>' : '<span style="color:#6b7280;">(未超标时选填)</span>'}:</label>
                    <button type="button" id="yn-row-dyn-copy-desc" class="yn-bem-btn-copy-desc" style="font-size:11px; padding:2px 8px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:4px; cursor:pointer; color:#2563eb; display:flex; align-items:center; gap:3px;">
                        📋 拷贝费用说明
                    </button>
                </div>
                <input type="text" id="yn-row-dyn-over-standard" value="${dyn.overStandardDescription || ''}" placeholder="${isHotelGroupOverStandard(group) ? '超标必填 (自主填写或点击上方按钮拷贝费用说明)' : '如超标需填写说明'}" />
                ${isHotelGroupOverStandard(group) ? `<div style="font-size:11px; color:#d97706; margin-top:3px;">⚠️ 该笔住宿费单价已超标，超标说明为必填项。请自主输入理由，或点击上方【📋 拷贝费用说明】填入。</div>` : ''}
            </div>
        `;
    } else if (cat === 'TAXI') {
        fieldsHtml += `
            <div class="yn-bem-row-dyn-field">
                <label>始发地 (出发地址):</label>
                <input type="text" id="yn-row-dyn-addr-from" value="${dyn.startAddress || ''}" placeholder="如: 虹桥火车站" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>目的地 (到达地址):</label>
                <input type="text" id="yn-row-dyn-addr-to" value="${dyn.endAddress || ''}" placeholder="如: 浦东研发中心" />
            </div>
        `;
    } else if (cat === 'MOBILE') {
        fieldsHtml += `
            <div class="yn-bem-row-dyn-field">
                <label>账期月份 (YYYY-MM):</label>
                <input type="month" id="yn-row-dyn-bill-month" value="${dyn.billMonth || (group.earliestInvoiceDate ? group.earliestInvoiceDate.substring(0, 7) : '')}" />
            </div>
        `;
    } else {
        fieldsHtml += `
            <div class="yn-bem-row-dyn-field">
                <label>始发地 (选填):</label>
                <input type="text" id="yn-row-dyn-addr-from" value="${dyn.startAddress || ''}" placeholder="出发地址" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>目的地 (选填):</label>
                <input type="text" id="yn-row-dyn-addr-to" value="${dyn.endAddress || ''}" placeholder="到达地址" />
            </div>
            <div class="yn-bem-row-dyn-field">
                <label>附加说明 (选填):</label>
                <input type="text" id="yn-row-dyn-extra-desc" value="${dyn.extraDesc || ''}" placeholder="附加业务说明" />
            </div>
        `;
    }

    return `
        <div class="yn-bem-row-dyn-mask" id="yn-bem-row-dyn-mask">
            <div class="yn-bem-row-dyn-card" data-recordid="${group.expenseRecordId}" data-category="${cat}">
                <div class="yn-bem-row-dyn-title">
                    <span>⚙ 编辑专属必填字段 · ${activeTypeName}</span>
                    <button class="yn-bem-close-x" id="yn-row-dyn-close">✕</button>
                </div>
                <div class="yn-bem-row-dyn-body">
                    ${fieldsHtml}
                </div>
                <div class="yn-bem-row-dyn-actions">
                    <button class="yn-bem-btn yn-bem-btn-secondary" id="yn-row-dyn-cancel">取消</button>
                    <button class="yn-bem-btn yn-bem-btn-primary" id="yn-row-dyn-save">保存变动</button>
                </div>
            </div>
        </div>
    `;
}

function openRowDynamicModal(recordId: string, container: HTMLElement) {
    const group = modalState.groups.find(g => g.expenseRecordId === recordId);
    if (!group) return;

    document.getElementById('yn-bem-row-dyn-mask')?.remove();

    const catInit = detectTypeCategory(group.newExpenseTypeId || group.expenseTypeId, group.newExpenseTypeName || group.expenseTypeName);
    if (catInit === 'HOTEL' && isHotelGroupOverStandard(group)) {
        showToast('warning', '⚠️ 检测到该笔住宿费单价已超标，超标说明为必填项！请自主输入理由或点击【📋 拷贝费用说明】。', 5000);
    }

    const div = document.createElement('div');
    div.innerHTML = renderRowDynamicModalHtml(group);
    const mask = div.firstElementChild as HTMLElement;
    document.body.appendChild(mask);

    const bindCardEvents = (currentMask: HTMLElement) => {
        const close = () => currentMask.remove();
        currentMask.querySelector('#yn-row-dyn-close')?.addEventListener('click', close);
        currentMask.querySelector('#yn-row-dyn-cancel')?.addEventListener('click', close);

        // 浮层内即时切换报销类型
        const typeSelect = currentMask.querySelector<HTMLSelectElement>('#yn-row-dyn-type-select');
        typeSelect?.addEventListener('change', () => {
            const newId = typeSelect.value;
            const newName = findExpenseTypeNameById(modalState.expenseTypeTree, newId);
            group.newExpenseTypeId = newId;
            group.newExpenseTypeName = newName;

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = renderRowDynamicModalHtml(group);
            const newCard = tempDiv.querySelector('.yn-bem-row-dyn-card');
            const oldCard = currentMask.querySelector('.yn-bem-row-dyn-card');
            if (newCard && oldCard) {
                oldCard.replaceWith(newCard);
                bindCardEvents(currentMask);
            }
        });

        // 城市输入实时联动推导住宿城市类型
        const cityInp = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-city');
        cityInp?.addEventListener('input', () => {
            const typeInp = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-city-type');
            if (typeInp) {
                const c = (cityInp.value || '').replace(/市|区|县/g, '').trim();
                typeInp.value = c ? (/北京|上海|广州|深圳/.test(c) ? '境内-北上广深' : '境内-其他') : '';
            }
        });

        // 一键拷贝费用说明至超标说明
        currentMask.querySelector('#yn-row-dyn-copy-desc')?.addEventListener('click', () => {
            const desc = group.newDescription !== undefined ? group.newDescription : group.description;
            const inp = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-over-standard');
            if (inp) {
                if (desc && desc.trim()) {
                    inp.value = desc.trim();
                    showToast('info', '已拷贝本行“费用说明”至超标说明输入框');
                } else {
                    showToast('warning', '当前行费用说明为空，请直接手动输入超标理由');
                }
            }
        });

        currentMask.querySelector('#yn-row-dyn-save')?.addEventListener('click', () => {
            const cat = detectTypeCategory(group.newExpenseTypeId || group.expenseTypeId, group.newExpenseTypeName || group.expenseTypeName);
            group.dynamicFields = group.dynamicFields || {};

            if (cat === 'FLIGHT') {
                const start = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-flight-start')?.value;
                const end = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-flight-end')?.value;
                const from = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-flight-from')?.value;
                const to = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-flight-to')?.value;
                const num = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-flight-num')?.value;
                if (start !== undefined) group.dynamicFields.flightStartDate = start;
                if (end !== undefined) group.dynamicFields.flightEndDate = end;
                if (from !== undefined) group.dynamicFields.flightFromCity = from;
                if (to !== undefined) group.dynamicFields.flightToCity = to;
                if (num !== undefined) group.dynamicFields.flightNum = num;
            } else if (cat === 'TRAIN') {
                const start = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-train-start')?.value;
                const end = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-train-end')?.value;
                const from = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-train-from')?.value;
                const to = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-train-to')?.value;
                if (start !== undefined) group.dynamicFields.trainStartDate = start;
                if (end !== undefined) group.dynamicFields.trainEndDate = end;
                if (from !== undefined) group.dynamicFields.trainFromStation = from;
                if (to !== undefined) group.dynamicFields.trainToStation = to;
            } else if (cat === 'HOTEL') {
                const checkIn = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-check-in')?.value;
                const checkOut = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-check-out')?.value;
                const city = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-city')?.value;
                const hotel = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-hotel')?.value;
                const roomNum = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-room-num')?.value;
                const overStd = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-over-standard')?.value;
                if (checkIn !== undefined) {
                    group.dynamicFields.checkInDate = checkIn;
                    if (checkIn) group.newBusinessDate = checkIn;
                }
                if (checkOut !== undefined) group.dynamicFields.checkOutDate = checkOut;
                if (city !== undefined) {
                    group.dynamicFields.city = city;
                    const c = city.replace(/市|区|县/g, '').trim();
                    group.dynamicFields.cityType = c ? (/北京|上海|广州|深圳/.test(c) ? '境内-北上广深' : '境内-其他') : '';
                }
                if (hotel !== undefined) group.dynamicFields.hotelName = hotel;
                if (roomNum !== undefined) group.dynamicFields.roomNum = Number(roomNum) || 1;
                if (overStd !== undefined) group.dynamicFields.overStandardDescription = overStd.trim();
            } else if (cat === 'TAXI') {
                const from = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-addr-from')?.value;
                const to = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-addr-to')?.value;
                if (from !== undefined) group.dynamicFields.startAddress = from;
                if (to !== undefined) group.dynamicFields.endAddress = to;
            } else if (cat === 'MOBILE') {
                const month = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-bill-month')?.value;
                if (month !== undefined) group.dynamicFields.billMonth = month;
            } else {
                const from = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-addr-from')?.value;
                const to = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-addr-to')?.value;
                const desc = currentMask.querySelector<HTMLInputElement>('#yn-row-dyn-extra-desc')?.value;
                if (from !== undefined) group.dynamicFields.startAddress = from;
                if (to !== undefined) group.dynamicFields.endAddress = to;
                if (desc !== undefined) group.dynamicFields.extraDesc = desc;
            }

            currentMask.remove();
            modalState.selectedRecordIds.add(group.expenseRecordId);
            refreshTableView(container);
            showToast('success', '已更新本行专属必填字段！');
        });
    };

    bindCardEvents(mask);
}

/**
 * 渲染聚合多行明细表格 (Vercel Clean Table & Tabular Figures)
 */
function renderTableHtml(): string {
    const filteredGroups = getFilteredGroups(modalState);
    const selectedInFiltered = filteredGroups.filter(g =>
        modalState.selectedRecordIds.has(g.expenseRecordId)
    );
    const isAllChecked = filteredGroups.length > 0 && selectedInFiltered.length === filteredGroups.length;

    if (filteredGroups.length === 0) {
        return `
        <table class="yn-bem-table">
            <thead>
                <tr>
                    <th class="yn-bem-col-sticky-cb">
                        <input type="checkbox" id="yn-bem-th-select-all" disabled />
                    </th>
                    ${COLUMN_DEFINITIONS.map(col => {
                        const isSorted = modalState.sortKey === col.key;
                        const arrow = isSorted ? (modalState.sortAsc ? ' ↑' : ' ↓') : '';
                        const isFiltered = Boolean(modalState.columnFilters[col.key] && modalState.columnFilters[col.key].length > 0);
                        const isPopoverOpen = modalState.activePopoverCol === col.key;
                        const stickyClass = col.sticky === 'date' ? 'yn-bem-col-sticky-date' : '';
                        const alignStyle = col.align === 'right' ? 'text-align:right;' : (col.align === 'center' ? 'text-align:center;' : '');

                        return `
                            <th class="${stickyClass} ${isSorted ? 'sorted-active' : ''}" style="${alignStyle} ${col.width ? `min-width:${col.width};` : ''}">
                                <div class="yn-bem-th-content">
                                    <span class="yn-bem-th-title" data-sort="${col.key}">
                                        ${col.label}
                                        ${arrow ? `<span class="yn-bem-th-sort-arrow">${arrow}</span>` : ''}
                                    </span>
                                    <button type="button" class="yn-bem-th-filter-trigger ${isFiltered ? 'is-active' : ''}" data-filter-col="${col.key}" title="按 ${col.label} 筛选">▾</button>
                                    ${isPopoverOpen ? renderColumnFilterPopoverHtml(col.key) : ''}
                                </div>
                            </th>
                        `;
                    }).join('')}
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td colspan="${COLUMN_DEFINITIONS.length + 1}" style="text-align:center; padding:60px 16px; color:#64748b; background:#fff;">
                        <div style="font-size:20px; margin-bottom:8px;">🔍 未找到符合筛选条件的费用记录</div>
                        <div style="font-size:13px; color:#94a3b8; margin-bottom:14px;">当前检索词或列筛选条件未匹配到任何结果</div>
                        <button type="button" class="yn-bem-btn yn-bem-btn-secondary" id="yn-bem-empty-clear-filters" style="font-size:12px; padding:5px 16px; cursor:pointer;">
                            清空全部筛选条件
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
        `;
    }

    return `
        <table class="yn-bem-table">
            <thead>
                <tr>
                    <th class="yn-bem-col-sticky-cb">
                        <input type="checkbox" id="yn-bem-th-select-all" ${isAllChecked ? 'checked' : ''} />
                    </th>
                    ${COLUMN_DEFINITIONS.map(col => {
                        const isSorted = modalState.sortKey === col.key;
                        const arrow = isSorted ? (modalState.sortAsc ? ' ↑' : ' ↓') : '';
                        const isFiltered = Boolean(modalState.columnFilters[col.key] && modalState.columnFilters[col.key].length > 0);
                        const isPopoverOpen = modalState.activePopoverCol === col.key;
                        const stickyClass = col.sticky === 'date' ? 'yn-bem-col-sticky-date' : '';
                        const alignStyle = col.align === 'right' ? 'text-align:right;' : (col.align === 'center' ? 'text-align:center;' : '');

                        return `
                            <th class="${stickyClass} ${isSorted ? 'sorted-active' : ''}" style="${alignStyle} ${col.width ? `min-width:${col.width};` : ''}">
                                <div class="yn-bem-th-content">
                                    <span class="yn-bem-th-title" data-sort="${col.key}">
                                        ${col.label}
                                        ${arrow ? `<span class="yn-bem-th-sort-arrow">${arrow}</span>` : ''}
                                    </span>
                                    <button type="button" class="yn-bem-th-filter-trigger ${isFiltered ? 'is-active' : ''}" data-filter-col="${col.key}" title="按 ${col.label} 筛选">▾</button>
                                    ${isPopoverOpen ? renderColumnFilterPopoverHtml(col.key) : ''}
                                </div>
                            </th>
                        `;
                    }).join('')}
                </tr>
            </thead>
            <tbody>
                ${filteredGroups.map(group => {
                    const isSelected = modalState.selectedRecordIds.has(group.expenseRecordId);
                    const invList = group.invoices;
                    const span = Math.max(1, invList.length);
                    const isDescChanged = group.newDescription !== undefined && group.newDescription !== group.description;
                    const isDateChanged = group.newBusinessDate !== undefined && group.newBusinessDate !== group.businessDate;
                    const isTypeChanged = Boolean(group.newExpenseTypeId && group.newExpenseTypeId !== group.expenseTypeId);

                    const isAiDateInferred = Boolean(group.inferredFields?.['businessDate']);

                    // 行 0：渲染费用主体列 (rowspan) 以及发票 0 的明细列
                    const inv0 = invList[0];
                    let rowsHtml = `
                        <tr class="${isSelected ? 'is-selected' : ''} yn-bem-group-first" data-recordid="${group.expenseRecordId}">
                            <!-- 费用主体聚合列 1: 复选框 -->
                            <td class="yn-bem-col-sticky-cb yn-bem-group-cell" rowspan="${span}">
                                <input type="checkbox" class="yn-bem-record-cb" data-recordid="${group.expenseRecordId}" ${isSelected ? 'checked' : ''} />
                            </td>

                            <!-- 费用主体聚合列 2: 最早开票日 -->
                            <td class="yn-bem-col-sticky-date yn-bem-group-cell" rowspan="${span}">
                                <span>${group.earliestInvoiceDate || '<span style="color:#a3a3a3;">-</span>'}</span>
                            </td>

                            <!-- 费用主体聚合列 3: 业务日期 (就地直接修改) -->
                            <td class="yn-bem-group-cell yn-bem-cell-interactive ${isAiDateInferred ? 'yn-bem-cell-ai-date' : ''}" rowspan="${span}">
                                <div class="yn-bem-dyn-cell-inner">
                                    <input type="date" class="yn-bem-cell-date-input ${isAiDateInferred ? 'is-ai-inferred' : (isDateChanged ? 'has-changed' : '')}"
                                           data-recordid="${group.expenseRecordId}"
                                           value="${group.newBusinessDate || group.businessDate || ''}"
                                           title="${isAiDateInferred ? '✨ AI已自动同步为实际入住日期' : '点击直接修改业务日期'}" />
                                    ${isAiDateInferred ? `<span class="yn-bem-ai-sparkle-dot" title="✨ AI自动同步为实际入住日">✨</span>` : ''}
                                </div>
                                ${isAiDateInferred
                                    ? `<span class="yn-bem-ai-date-badge" title="原开票日: ${group.businessDate} ➔ AI已同步为实际入住日">✨ AI同步入住日</span>`
                                    : (isDateChanged ? `<span style="font-size:10px; color:#15803d; display:block; font-family:ui-monospace; margin-top:2px;">(原: ${group.businessDate})</span>` : '')
                                }
                            </td>

                            <!-- 费用主体聚合列 4: 费用类型 (就地直接修改下拉 + 专属字段微按钮) -->
                            <td class="yn-bem-group-cell yn-bem-cell-interactive" rowspan="${span}">
                                <div class="yn-bem-cell-type-wrapper">
                                    <select class="yn-bem-cell-type-select ${isTypeChanged ? 'has-type-changed' : ''}"
                                            data-recordid="${group.expenseRecordId}"
                                            title="点击直接修改此笔费用的报销类型">
                                        ${renderTypeTreeOptionsHtml(modalState.expenseTypeTree, group.newExpenseTypeId || group.expenseTypeId)}
                                    </select>
                                    ${renderDynamicSubTags(group.dynamicFields)}
                                    <button type="button" class="yn-bem-cell-dyn-trigger" data-recordid="${group.expenseRecordId}" title="点击修改本行专属必填字段">
                                        ⚙ 专属字段
                                    </button>
                                </div>
                            </td>

                            <!-- 费用主体聚合列 5: 费用金额 (等宽靠右) -->
                            <td class="yn-bem-group-cell" rowspan="${span}" style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-variant-numeric:tabular-nums; font-weight:600; color:#171717; text-align:right;">
                                ¥${Number(group.expenseAmount || 0).toFixed(2)}
                            </td>

                            <!-- 费用主体聚合列 6: 合并费用说明文本框 -->
                            <td class="yn-bem-group-cell" rowspan="${span}">
                                <textarea class="yn-bem-desc-box ${isDescChanged ? 'has-changed' : ''}"
                                          data-recordid="${group.expenseRecordId}"
                                          placeholder="输入或修改费用说明...">${group.newDescription !== undefined ? group.newDescription : group.description}</textarea>
                            </td>

                            <!-- 费用主体聚合列 7: 发票张数 -->
                            <td class="yn-bem-group-cell" rowspan="${span}" style="text-align:center;">
                                <span style="font-family:ui-monospace, monospace; font-weight:600;">${group.invoiceCount}</span>
                                ${group.invoiceCount > 1 ? `<div class="yn-bem-multi-inv-badge">${group.invoiceCount}张发票合并</div>` : ''}
                            </td>

                            <!-- 专属必填字段独立列 8-20 (rowspan) -->
                            ${DYNAMIC_COLUMNS.map(col => renderDynamicFieldCellHtml(group, col, span)).join('')}

                            <!-- 发票 0 明细列 (若无发票则渲染空单元格) -->
                            ${inv0 ? renderInvoiceDetailCells(inv0, group.invoiceCount, group) : `<td colspan="14" style="color:#a3a3a3; text-align:center;">(无挂载发票明细)</td>`}
                        </tr>
                    `;

                    // 后续发票明细行：仅渲染发票明细列
                    if (invList.length > 1) {
                        for (let k = 1; k < invList.length; k++) {
                            const invK = invList[k];
                            rowsHtml += `
                                <tr class="${isSelected ? 'is-selected' : ''}" data-recordid="${group.expenseRecordId}">
                                    ${renderInvoiceDetailCells(invK, group.invoiceCount, group)}
                                </tr>
                            `;
                        }
                    }

                    return rowsHtml;
                }).join('')}
            </tbody>
        </table>
    `;
}

/**
 * 渲染单张发票的 14 个明细单元格 (Vercel 等宽数字与精确对齐，支持始发地/目的地/销售方就地直接编辑)
 */
function renderInvoiceDetailCells(inv: ExpenseInvoiceSubItem, totalCount: number, group: ExpenseRecordGroup): string {
    const isWarn = inv.reconciliationNote && inv.reconciliationNote.includes('⚠️');

    return `
        <td style="text-align:center; font-family:ui-monospace, monospace; font-size:11px; color:#737373;">${inv.invoiceIndex}/${totalCount}</td>
        <td><span style="background:#f5f5f5; border:1px solid #eaeaea; padding:1px 5px; border-radius:3px; font-size:11px; color:#525252;">${inv.invoiceType || '-'}</span></td>
        <td style="font-family:ui-monospace, monospace; font-size:11px; color:#737373;">${inv.invoiceCode || '-'}</td>
        <td style="font-family:ui-monospace, monospace; font-size:11px; font-weight:500; color:#171717;">${inv.invoiceNo || '-'}</td>
        <td style="font-family:ui-monospace, monospace; font-variant-numeric:tabular-nums; font-weight:600; text-align:right; color:#171717;">¥${Number(inv.totalAmount || inv.amountTax || 0).toFixed(2)}</td>
        <td style="font-family:ui-monospace, monospace; font-variant-numeric:tabular-nums; font-size:11px;">${inv.invoiceDate || '-'}</td>
        <td style="font-family:ui-monospace, monospace; font-variant-numeric:tabular-nums; font-size:11px;">${inv.departureTime || '-'}</td>
        <td style="font-family:ui-monospace, monospace; font-variant-numeric:tabular-nums; font-size:11px;">${inv.timeGetOff || '-'}</td>
        <td class="yn-bem-cell-interactive" title="点击直接修改始发地">
            <input type="text" class="yn-bem-cell-text-input yn-bem-cell-station-on"
                   data-recordid="${group.expenseRecordId}"
                   data-invindex="${inv.invoiceIndex}"
                   value="${inv.stationGetOn || group.dynamicFields?.startAddress || group.dynamicFields?.trainFromStation || group.dynamicFields?.flightFromCity || ''}"
                   placeholder="始发地" />
        </td>
        <td class="yn-bem-cell-interactive" title="点击直接修改目的地">
            <input type="text" class="yn-bem-cell-text-input yn-bem-cell-station-off"
                   data-recordid="${group.expenseRecordId}"
                   data-invindex="${inv.invoiceIndex}"
                   value="${inv.stationGetOff || group.dynamicFields?.endAddress || group.dynamicFields?.trainToStation || group.dynamicFields?.flightToCity || ''}"
                   placeholder="目的地" />
        </td>
        <td class="yn-bem-cell-interactive" style="max-width:200px;" title="点击直接修改销售方/酒店名称">
            <input type="text" class="yn-bem-cell-text-input yn-bem-cell-sales-name"
                   data-recordid="${group.expenseRecordId}"
                   data-invindex="${inv.invoiceIndex}"
                   value="${inv.salesName || group.dynamicFields?.hotelName || ''}"
                   placeholder="销售方/酒店" />
        </td>
        <td style="max-width:160px; overflow:hidden; text-overflow:ellipsis;" title="${inv.fileName || ''}">${inv.fileName || '-'}</td>
        <td style="max-width:140px; overflow:hidden; text-overflow:ellipsis;" title="${inv.remarks || ''}">${inv.remarks || '-'}</td>
        <td>
            ${isWarn
                ? `<span class="yn-bem-badge-warn" title="${inv.reconciliationNote}">${inv.reconciliationNote.replace('⚠️', '').trim()}</span>`
                : (inv.reconciliationNote ? `<span class="yn-bem-badge-ok">${inv.reconciliationNote.replace('✅', '').trim()}</span>` : '<span style="color:#d4d4d4;">-</span>')
            }
        </td>
    `;
}

/**
 * 渲染底部统计信息 (Vercel Tabular Figures & Decimal 精准金额)
 */
function renderFooterStatsHtml(): string {
    const totalGroups = modalState.groups.length;
    const filteredGroups = getFilteredGroups(modalState);
    const isFiltering = filteredGroups.length < totalGroups;

    // 筛选联动裁剪后，当前选中的有效分组
    const effectiveSelectedGroups = filteredGroups.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));

    const selectedCount = effectiveSelectedGroups.length;
    const selectedInvoicesCount = effectiveSelectedGroups.reduce((sum, g) => sum + g.invoices.length, 0);
    // 高精度财务级 Decimal 金额累加，杜绝 IEEE-754 浮点累加误差
    const totalAmountDecimal = Decimal.sum(effectiveSelectedGroups, g => g.expenseAmount);

    return `
        <span>总计: <strong>${totalGroups}</strong> 笔费用 ${isFiltering ? `(当前筛选: <strong>${filteredGroups.length}</strong> 笔)` : ''}</span>
        <span>已选中: <strong class="yn-bem-stat-highlight">${selectedCount}</strong> 笔记录 (共 <strong>${selectedInvoicesCount}</strong> 张发票)</span>
        <span>选中金额: <strong class="yn-bem-stat-amount">¥${totalAmountDecimal.toFixed(2)}</strong></span>
    `;
}

/**
 * 响应式更新底部操作浮条 (Batch Action Bar) 按钮状态与文案
 * 当 selectedCount === 0 时，禁用批量操作按钮
 */
function updateFooterActionButtons(container: HTMLElement): void {
    const filteredGroups = getFilteredGroups(modalState);
    const effectiveSelectedGroups = filteredGroups.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));
    const selectedCount = effectiveSelectedGroups.length;
    const isZeroSelected = selectedCount === 0;

    const btnClear = container.querySelector<HTMLButtonElement>('#yn-bem-btn-clear-selection');
    if (btnClear) {
        btnClear.disabled = isZeroSelected;
        btnClear.title = isZeroSelected ? '当前无任何选中条目' : '一键清空当前选中项';
    }

    const btnExport = container.querySelector<HTMLButtonElement>('#yn-bem-btn-export');
    if (btnExport) {
        btnExport.disabled = isZeroSelected;
        btnExport.innerHTML = isZeroSelected
            ? `<span>📥 导出所选 (0)</span>`
            : `<span>📥 导出所选 (<strong>${selectedCount}</strong> 笔)</span>`;
        btnExport.title = isZeroSelected ? '请先勾选需要导出的费用记录' : `导出选中的 ${selectedCount} 笔费用及对应发票明细 (CSV)`;
    }

    const btnSaveAll = container.querySelector<HTMLButtonElement>('#yn-bem-btn-save-all');
    if (btnSaveAll) {
        btnSaveAll.disabled = isZeroSelected;
        btnSaveAll.innerHTML = isZeroSelected
            ? `<span>确认批量修改并保存</span>`
            : `<span>确认批量修改并保存 (<strong>${selectedCount}</strong> 笔)</span>`;
        btnSaveAll.title = isZeroSelected ? '请先勾选需要保存的费用记录' : `保存已选的 ${selectedCount} 笔费用修改到系统`;
    }
}

/**
 * 渲染模态框主体内容
 */
function renderModalContent(container: HTMLElement, doc: Document) {
    const filteredGroups = getFilteredGroups(modalState);

    container.innerHTML = `
        <!-- 1. 顶部融合操作栏 (全屏无独立暗黑标题栏) -->
        ${renderTopBarHtml(filteredGroups)}

        <!-- 2. 聚合明细表格 -->
        <div class="yn-bem-table-wrap" id="yn-bem-table-wrap">
            ${renderTableHtml()}
        </div>

        <!-- 3. 底部操作浮条 (Batch Action Bar - Vercel Clean Footer) -->
        <div class="yn-bem-footer">
            <div class="yn-bem-footer-stats" id="yn-bem-footer-stats">
                ${renderFooterStatsHtml()}
            </div>
            <div class="yn-bem-footer-actions">
                <button class="yn-bem-btn yn-bem-btn-secondary" id="yn-bem-btn-clear-selection" title="取消选择（一键清空选中）">
                    取消选择 (清空)
                </button>
                <button class="yn-bem-btn yn-bem-btn-secondary" id="yn-bem-btn-export" title="导出当前选中的费用记录清单 (CSV)">
                    📥 导出所选 (CSV)
                </button>
                <button class="yn-bem-btn yn-bem-btn-secondary" id="yn-bem-btn-cancel">
                    关闭
                </button>
                <button class="yn-bem-btn yn-bem-btn-primary" id="yn-bem-btn-save-all">
                    确认批量修改并保存
                </button>
            </div>
        </div>
    `;

    bindEvents(container, doc);
    updateFooterActionButtons(container);
}

const ITINERARY_PROMPT_TEMPLATE = `请帮我将以下原始出差/行程信息整理为标准的精简 Markdown 表格，仅保留以下必要列（无需多余解释）：
| 类型 | 目标省市 | 客户据点/公司名 | 起始日 | 结束日 | 出发地 | 目的地 | 交通工具 | 住宿酒店 |

【排期格式要求】：
1. 每一行对应一段出行移动或在某客户据点的业务排期；
2. 日期格式必须统一为 YYYY-MM-DD；
3. 类型填写：移动 / 调查 / 业务 等；
4. 住宿酒店请注明具体酒店名称及分店名（如：美悦酒店(国家会展中心店)）；
5. 移动行请写明出发地与目的地城市。

【原始行程信息如下】：
`;

function copyFallback(text: string) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        showToast('success', '已复制排期整理 Prompt 到剪贴板！');
    } catch {
        showToast('error', '复制失败，请手动复制');
    }
    document.body.removeChild(ta);
}

/**
 * 弹出出差行程排期辅助推断模态框 (Itinerary Helper Modal)
 * 帮助用户在其他 AI 工具中一键整理出差排期，并粘贴排期结果以供本系统进行 100% 高可信精准对齐
 */
function openItineraryModal(container: HTMLElement) {
    let mask = document.getElementById('yn-bem-itinerary-mask');
    if (!mask) {
        const div = document.createElement('div');
        div.innerHTML = `
            <div id="yn-bem-itinerary-mask">
                <div class="yn-bem-itinerary-card">
                    <div class="yn-bem-itinerary-header">
                        <div class="yn-bem-itinerary-title">
                            <span>✈ 出差行程排期辅助推断 (提高 AI 准确性)</span>
                        </div>
                        <button type="button" class="yn-bem-close-x" id="yn-bem-itin-close" title="关闭">✕</button>
                    </div>

                    <div class="yn-bem-itinerary-tip">
                        <strong>💡 为什么需要排期信息？</strong><br>
                        飞机票、住宿发票的<strong>开票日期通常滞后于实际出差行程</strong>，直接按发票开票日期推断容易产生偏差。
                        提供您的出差日程排期表（如 Excel 表格复制的文本、Markdown 或日程简述），AI 将以此作为权威客观依据，精准推断实际入住/离店日期与市内出租车动线。
                    </div>

                    <div class="yn-bem-prompt-bar">
                        <div class="yn-bem-prompt-bar-text">
                            <span>📋 需要在第三方 AI 工具 (ChatGPT / DeepSeek / Claude) 中整理日程？</span>
                        </div>
                        <button type="button" class="yn-bem-btn-copy-prompt" id="yn-bem-btn-copy-itin-prompt">
                            📋 复制排期整理 Prompt
                        </button>
                    </div>

                    <textarea id="yn-bem-itinerary-text" class="yn-bem-itinerary-textarea"
                        placeholder="请在此粘贴整理好的出差排期表格或文本（例如 Excel 复制的日程：含日期、目标省市、客户公司、交通方式、入住酒店等）...&#10;&#10;如无需排期，可直接点击下方「跳过排期，仅按现有发票推断」"></textarea>

                    <div class="yn-bem-itinerary-actions">
                        <button type="button" class="yn-bem-btn yn-bem-btn-secondary" id="yn-bem-btn-itin-skip">
                            跳过排期，仅按现有发票推断
                        </button>
                        <button type="button" class="yn-bem-btn yn-bem-btn-primary" id="yn-bem-btn-itin-submit">
                            ✨ 结合排期一键智能推断
                        </button>
                    </div>
                </div>
            </div>
        `;
        mask = div.firstElementChild as HTMLElement;
        document.body.appendChild(mask);

        const closeItin = () => {
            if (mask) mask.style.display = 'none';
        };

        mask.querySelector('#yn-bem-itin-close')?.addEventListener('click', closeItin);

        mask.querySelector('#yn-bem-btn-copy-itin-prompt')?.addEventListener('click', () => {
            const textToCopy = ITINERARY_PROMPT_TEMPLATE;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textToCopy).then(() => {
                    showToast('success', '已复制排期整理 Prompt 到剪贴板！可直接粘贴至 AI 工具生成标准排期表格。');
                }).catch(() => {
                    copyFallback(textToCopy);
                });
            } else {
                copyFallback(textToCopy);
            }
        });

        mask.querySelector('#yn-bem-btn-itin-skip')?.addEventListener('click', () => {
            closeItin();
            handleAiInference(container);
        });

        mask.querySelector('#yn-bem-btn-itin-submit')?.addEventListener('click', () => {
            const textarea = mask?.querySelector<HTMLTextAreaElement>('#yn-bem-itinerary-text');
            const itineraryText = textarea ? textarea.value.trim() : '';
            closeItin();
            handleAiInference(container, itineraryText || undefined);
        });
    }

    mask.style.display = 'flex';
    const textarea = mask.querySelector<HTMLTextAreaElement>('#yn-bem-itinerary-text');
    if (textarea) {
        setTimeout(() => textarea.focus(), 50);
    }
}

/**
 * 从文本中智能抽取航班号 (支持往返双航班号如 CZ6534/CZ6523, MU5123/MU5124, CZ6534-CZ6523, CZ6534/6523, 以及单航班号 CZ6534)
 */
function extractFlightNumFromText(text: string): string | null {
    if (!text) return null;
    const clean = text.trim();

    // 1. 优先匹配双航班号
    // a. 双方均带完整航司二字码，如 CZ6534/CZ6523, MU5123-MU5124, CZ6534 CZ6523
    const fullPair = clean.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\d{3,4}\s*[\/\-、\s]\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])\d{3,4}\b/i);
    if (fullPair) {
        const matches = fullPair[0].match(/([A-Z]{2}|[A-Z]\d|\d[A-Z])\d{3,4}/gi);
        if (matches && matches.length >= 2) {
            const m1 = matches[0].toUpperCase();
            const m2 = matches[1].toUpperCase();
            // 排除命中 X2607-001 这类项目编号
            if (!m1.startsWith('X2') && !m1.startsWith('PRJ') && !m2.startsWith('X2') && !m2.startsWith('PRJ')) {
                return `${m1}/${m2}`;
            }
        }
    }

    // b. 后者省略航司代码，必须用 / 或 、 连接，且均为 3~4 位数字 (如 CZ6534/6523，严禁破折号如 X2607-001)
    const slashPair = clean.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])(\d{3,4})\s*[\/、]\s*(\d{3,4})\b/i);
    if (slashPair) {
        const airline = slashPair[1].toUpperCase();
        if (!airline.startsWith('X2') && !airline.startsWith('PRJ')) {
            return `${airline}${slashPair[2]}/${airline}${slashPair[3]}`;
        }
    }

    // 2. 单航班号 (例如 CZ6534, MU5123, 3U8888，严禁误命中项目编号如 X2607-001)
    const singleMatches = clean.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\d{3,4}\b/gi);
    if (singleMatches) {
        for (const sm of singleMatches) {
            const up = sm.toUpperCase();
            if (up.startsWith('X2') || up.startsWith('PRJ')) continue;
            if (new RegExp(`${sm}-\\d{3,4}`).test(clean)) continue;
            return up;
        }
    }
    return null;
}

/**
 * 一键 AI 智能推断专属必填字段 (二层推断：规则优先 + 大模型跨单据深度推断)
 */
async function handleAiInference(container: HTMLElement, itineraryText?: string) {
    // 1. 获取推断目标行：有筛选时严格限定在筛选范围内；优先已勾选，若未勾选则以当前筛选视图全部行作为目标
    const filtered = getFilteredGroups(modalState);
    const isFiltering = filtered.length < modalState.groups.length;
    let targetGroups = modalState.groups.filter(g => {
        if (!modalState.selectedRecordIds.has(g.expenseRecordId)) return false;
        if (isFiltering && !filtered.some(f => f.expenseRecordId === g.expenseRecordId)) return false;
        return true;
    });

    if (targetGroups.length === 0) {
        targetGroups = filtered;
        if (targetGroups.length === 0) {
            showToast('warning', isFiltering ? '当前筛选视图中无任何费用记录可供推断' : '当前列表无任何费用记录可供推断');
            return;
        }
        targetGroups.forEach(g => modalState.selectedRecordIds.add(g.expenseRecordId));
    }

    const aiBtn = container.querySelector<HTMLButtonElement>('#yn-bem-btn-ai-infer');
    const origBtnHtml = aiBtn ? aiBtn.innerHTML : '';
    if (aiBtn) {
        aiBtn.disabled = true;
        aiBtn.innerHTML = `<span class="spinner"></span> 正在智能推断...`;
    }

    let ruleInferredCount = 0;
    let llmInferredCount = 0;

    try {
        // 第一层：基于发票原生证据链的 100% 确定性规则提取 (Zero-LLM, 0ms)
        for (const group of targetGroups) {
            group.dynamicFields = group.dynamicFields || {};
            group.inferredFields = group.inferredFields || {};
            const dyn = group.dynamicFields;
            const infFields = group.inferredFields;
            const inv0 = group.invoices[0];

            let rowUpdated = false;

            // 0. 若当前为未识别/未分类类型，先尝试通过发票信息识别类型 (Zero-LLM)
            if (isUnknownTypeGroup(group)) {
                for (const inv of group.invoices) {
                    const s = `${inv.invoiceType || ''} ${inv.salesName || ''} ${inv.fileName || ''} ${inv.remarks || ''}`.toLowerCase();
                    if (s.includes('飞机') || s.includes('航空') || s.includes('机票') || s.includes('flight')) {
                        group.newExpenseTypeId = '035671613fdde1653e55bb00bc610000';
                        group.newExpenseTypeName = '飞机票（航空券）';
                        infFields['expenseType'] = 'rule';
                        rowUpdated = true;
                        ruleInferredCount++;
                        break;
                    } else if (s.includes('火车') || s.includes('高铁') || s.includes('铁路') || inv.trainNo) {
                        group.newExpenseTypeId = '0356c4c2b14de1653e55bb00bc610000';
                        group.newExpenseTypeName = '火车公交车票 （電車Bus代）';
                        infFields['expenseType'] = 'rule';
                        rowUpdated = true;
                        ruleInferredCount++;
                        break;
                    } else if (s.includes('酒店') || s.includes('客房') || s.includes('宾馆') || s.includes('住宿') || s.includes('hotel')) {
                        group.newExpenseTypeId = '0356c4e2b72de1653e55bb00bc610001';
                        group.newExpenseTypeName = '住宿费（宿泊代）';
                        infFields['expenseType'] = 'rule';
                        rowUpdated = true;
                        ruleInferredCount++;
                        break;
                    } else if (s.includes('出租车') || s.includes('打车') || s.includes('滴滴') || s.includes('taxi')) {
                        group.newExpenseTypeId = '0356c4cef03345af7f1906ec05cc0000';
                        group.newExpenseTypeName = '出租车（taxi）';
                        infFields['expenseType'] = 'rule';
                        rowUpdated = true;
                        ruleInferredCount++;
                        break;
                    } else if (s.includes('通信') || s.includes('话费') || s.includes('手机')) {
                        group.newExpenseTypeId = '0356c4f6701345af7f1906ec05cc0000';
                        group.newExpenseTypeName = '通信传真费（通信代）';
                        infFields['expenseType'] = 'rule';
                        rowUpdated = true;
                        ruleInferredCount++;
                        break;
                    }
                }
            }

            const cat = getGroupCategory(group);

            if (cat === 'FLIGHT') {
                if (!dyn.flightFromCity && inv0?.stationGetOn) {
                    dyn.flightFromCity = inv0.stationGetOn;
                    infFields['dynFrom'] = 'rule';
                    infFields['flightFromCity'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
                if (!dyn.flightToCity && inv0?.stationGetOff) {
                    dyn.flightToCity = inv0.stationGetOff;
                    infFields['dynTo'] = 'rule';
                    infFields['flightToCity'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
                // 从文件名/备注提取航线起止地 (如 "上海-大连_往返机票")
                if (!dyn.flightFromCity || !dyn.flightToCity) {
                    const text = `${inv0?.fileName || ''} ${inv0?.remarks || ''}`;
                    const routeMatch = text.match(/([^\s\-_/]{2,6})\s*[-至到—]\s*([^\s\-_/]{2,6})(?:往返)?机票/);
                    if (routeMatch) {
                        if (!dyn.flightFromCity) {
                            dyn.flightFromCity = routeMatch[1].replace(/市$/, '');
                            infFields['dynFrom'] = 'rule';
                            infFields['flightFromCity'] = 'rule';
                            rowUpdated = true;
                            ruleInferredCount++;
                        }
                        if (!dyn.flightToCity) {
                            dyn.flightToCity = routeMatch[2].replace(/市$/, '');
                            infFields['dynTo'] = 'rule';
                            infFields['flightToCity'] = 'rule';
                            rowUpdated = true;
                            ruleInferredCount++;
                        }
                    }
                }
                // 航班号推断 (优先提取往返双航班号，如 CZ6534/CZ6523)
                if (!dyn.flightNum) {
                    let extractedFlightNum: string | null = null;
                    // 1. 发票原生 trainNo 字段 (如有)
                    if (inv0?.trainNo) extractedFlightNum = extractFlightNumFromText(inv0.trainNo);
                    // 2. 用户提供的权威出差排期文本 (Ground Truth 优先检索航线/金额对应行)
                    if (!extractedFlightNum && itineraryText) {
                        const lines = itineraryText.split('\n');
                        const amtStr = String(Math.round(Number(group.expenseAmount) || 0));
                        const dateStr = group.businessDate || group.earliestInvoiceDate || '';
                        const m = dateStr.match(/\d{4}-(\d{2})-(\d{2})/);
                        const shortDate = m ? `${parseInt(m[1])}月${parseInt(m[2])}日` : '';

                        for (const line of lines) {
                            const hasAmt = amtStr && line.includes(amtStr);
                            const hasDate = shortDate && line.includes(shortDate);
                            const hasFlightKey = line.includes('机票') || line.includes('飞机') || line.includes('往返');
                            const hasCity = (dyn.flightToCity && line.includes(dyn.flightToCity)) || (dyn.flightFromCity && line.includes(dyn.flightFromCity));

                            if ((hasAmt && (hasDate || hasFlightKey || hasCity)) || (hasDate && hasFlightKey)) {
                                extractedFlightNum = extractFlightNumFromText(line);
                                if (extractedFlightNum) break;
                            }
                        }
                    }
                    // 3. 发票备注与附件文件名
                    if (!extractedFlightNum && inv0?.remarks) extractedFlightNum = extractFlightNumFromText(inv0.remarks);
                    if (!extractedFlightNum && inv0?.fileName) extractedFlightNum = extractFlightNumFromText(inv0.fileName);

                    if (extractedFlightNum) {
                        dyn.flightNum = extractedFlightNum;
                        infFields['dynTransitNo'] = 'rule';
                        infFields['flightNum'] = 'rule';
                        rowUpdated = true;
                        ruleInferredCount++;
                    }
                }
                // 行程出发日期 (departureDate)
                if (!dyn.flightStartDate && inv0?.departureDate) {
                    dyn.flightStartDate = inv0.departureDate;
                    infFields['dynStartDate'] = 'rule';
                    infFields['flightStartDate'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
                if (!dyn.flightEndDate && inv0?.departureDate) {
                    dyn.flightEndDate = inv0.departureDate;
                    infFields['dynEndDate'] = 'rule';
                    infFields['flightEndDate'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
            } else if (cat === 'TRAIN') {
                if (!dyn.trainFromStation && inv0?.stationGetOn) {
                    dyn.trainFromStation = inv0.stationGetOn;
                    infFields['dynFrom'] = 'rule';
                    infFields['trainFromStation'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
                if (!dyn.trainToStation && inv0?.stationGetOff) {
                    dyn.trainToStation = inv0.stationGetOff;
                    infFields['dynTo'] = 'rule';
                    infFields['trainToStation'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
                if (!dyn.trainStartDate && inv0?.departureDate) {
                    dyn.trainStartDate = inv0.departureDate;
                    infFields['dynStartDate'] = 'rule';
                    infFields['trainStartDate'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
                if (!dyn.trainEndDate && inv0?.departureDate) {
                    dyn.trainEndDate = inv0.departureDate;
                    infFields['dynEndDate'] = 'rule';
                    infFields['trainEndDate'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
            } else if (cat === 'HOTEL') {
                if (!dyn.hotelName && inv0?.salesName) {
                    const cleanName = inv0.salesName.replace(/有限(?:责任)?公司/g, '').trim();
                    dyn.hotelName = cleanName;
                    infFields['dynHotel'] = 'rule';
                    infFields['hotelName'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
                if (dyn.roomNum === undefined || dyn.roomNum === null) {
                    dyn.roomNum = 1;
                    infFields['dynRoomNum'] = 'rule';
                    infFields['roomNum'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
                // 从酒店销售方中提取出差城市
                if (!dyn.city && (dyn.hotelName || inv0?.salesName)) {
                    const hName = dyn.hotelName || inv0?.salesName || '';
                    const cityMatch = hName.match(/\(([^)（）]+?)(?:市|分店|店|分公司|枢纽店)?\)/) ||
                                     hName.match(/(北京|上海|天津|重庆|广州|深圳|杭州|南京|武汉|成都|合肥|苏州|大连|青岛|厦门|西安|沈阳|济南|长沙|郑州|福州|昆明|贵阳|南宁|石家庄|哈尔滨|长春|南昌|太原|呼和浩特|海口|银川|西宁|乌鲁木齐|兰州|拉萨|宁波|无锡|常州|温州|绍兴|嘉兴|金华|台州|南通|徐州|保定|唐山|洛阳|烟台|潍坊|临沂|芜湖|蚌埠|马鞍山|安庆|阜阳|滁州|六安|铜陵|池州|宣城|亳州|黄山|淮南|淮北|宿州)/);
                    if (cityMatch) {
                        dyn.city = cityMatch[1].replace(/市$/, '');
                        infFields['dynCity'] = 'rule';
                        infFields['city'] = 'rule';
                        rowUpdated = true;
                        ruleInferredCount++;
                    }
                }
                // 检查发票备注或文件名中是否含有明确的入离店日期 (如 2026-08-27~2026-08-29)
                if ((!dyn.checkInDate || !dyn.checkOutDate) && (inv0?.remarks || inv0?.fileName)) {
                    const text = `${inv0?.remarks || ''} ${inv0?.fileName || ''}`;
                    const dateMatch = text.match(/(202\d[-/.年]\d{1,2}[-/.月]\d{1,2})[日号]?\s*[-~至到与/]\s*(202\d[-/.年]\d{1,2}[-/.月]\d{1,2})[日号]?/);
                    if (dateMatch) {
                        const d1 = dateMatch[1].replace(/[年月日/.]/g, '-');
                        const d2 = dateMatch[2].replace(/[年月日/.]/g, '-');
                        if (!dyn.checkInDate) {
                            dyn.checkInDate = d1;
                            group.newBusinessDate = d1;
                            infFields['dynCheckIn'] = 'rule';
                            infFields['checkInDate'] = 'rule';
                            infFields['businessDate'] = 'rule';
                            rowUpdated = true;
                            ruleInferredCount++;
                        }
                        if (!dyn.checkOutDate) {
                            dyn.checkOutDate = d2;
                            infFields['dynCheckOut'] = 'rule';
                            infFields['checkOutDate'] = 'rule';
                            rowUpdated = true;
                            ruleInferredCount++;
                        }
                    }
                }
            } else if (cat === 'TAXI') {
                if (!dyn.startAddress && inv0?.stationGetOn) {
                    dyn.startAddress = inv0.stationGetOn;
                    infFields['dynAddrFrom'] = 'rule';
                    infFields['startAddress'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
                if (!dyn.endAddress && inv0?.stationGetOff) {
                    dyn.endAddress = inv0.stationGetOff;
                    infFields['dynAddrTo'] = 'rule';
                    infFields['endAddress'] = 'rule';
                    rowUpdated = true;
                    ruleInferredCount++;
                }
            } else if (cat === 'MOBILE') {
                if (!dyn.billMonth) {
                    const text = `${inv0?.remarks || ''} ${inv0?.fileName || ''}`;
                    const mMatch = text.match(/(202\d)[年.-](\d{1,2})月?/);
                    if (mMatch) {
                        dyn.billMonth = `${mMatch[1]}-${String(mMatch[2]).padStart(2, '0')}`;
                        infFields['dynBillMonth'] = 'rule';
                        infFields['billMonth'] = 'rule';
                        rowUpdated = true;
                        ruleInferredCount++;
                    } else if (inv0?.invoiceDate && inv0.invoiceDate.length >= 7) {
                        dyn.billMonth = inv0.invoiceDate.slice(0, 7);
                        infFields['dynBillMonth'] = 'rule';
                        infFields['billMonth'] = 'rule';
                        rowUpdated = true;
                        ruleInferredCount++;
                    }
                }
            }

            if (rowUpdated) {
                modalState.selectedRecordIds.add(group.expenseRecordId);
            }
        }

        const isPlaceholderAddr = (addr?: string) => {
            if (!addr) return true;
            const clean = addr.trim();
            return !clean || ['酒店', '客户现场', '客户', '现场', 'Home', 'home', '机场', '车站', '饭店', '餐厅', '待定'].includes(clean);
        };

        // 第二层：若存在未识别类型或空缺专属必填字段，且配置了大模型 API，则启动深度推断
        const hasTransitOrHotel = modalState.groups.some(other => ['FLIGHT', 'TRAIN', 'HOTEL'].includes(getGroupCategory(other)));
        const groupsWithMissingFields = targetGroups.filter(g => {
            if (isUnknownTypeGroup(g)) return true; // 未识别类型记录必须启动推断
            const cat = getGroupCategory(g);
            const dyn = g.dynamicFields || {};
            if (cat === 'HOTEL') {
                return !dyn.checkInDate || !dyn.checkOutDate || !dyn.city || (Boolean(itineraryText) && (!dyn.hotelName || g.inferredFields?.['dynHotel'] === 'rule'));
            }
            if (cat === 'FLIGHT') {
                return !dyn.flightStartDate || !dyn.flightFromCity || !dyn.flightToCity || !dyn.flightNum;
            }
            if (cat === 'TRAIN') {
                return !dyn.trainStartDate || !dyn.trainFromStation || !dyn.trainToStation;
            }
            if (cat === 'TAXI') {
                return (Boolean(itineraryText) || hasTransitOrHotel) &&
                    (isPlaceholderAddr(dyn.startAddress) || isPlaceholderAddr(dyn.endAddress));
            }
            if (cat === 'MOBILE') {
                return !dyn.billMonth;
            }
            return false;
        });

        if (groupsWithMissingFields.length > 0 && isLlmConfigured()) {
            // ====================================================================
            // 第二层：分通道 LLM 深度推断 (v4.38.0 时空骨架 + 瀑布式分流架构)
            // 
            // 架构设计：
            //   1. extractTripSkeleton: 将全量票据 JSON (~8,000 Token) 压缩为纯文本时间线 (~500 Token)
            //   2. dispatchInferenceChannels: 两阶段瀑布式分通道执行
            //      阶段 1: Channel B (住宿+大交通) + Channel C (未知类型) 并行 → 增强骨架
            //      阶段 2: Channel A (出租车) 使用增强骨架执行（确保酒店名/枢纽站信息完整）
            //   3. mergeInferenceResults: 统一回填 dynamicFields + 联动重算
            // ====================================================================
            if (aiBtn) {
                aiBtn.innerHTML = `<span class="spinner"></span> 正在分析 ${groupsWithMissingFields.length} 笔费用记录...`;
            }

            const tripSkeleton = extractTripSkeleton(modalState.groups, itineraryText);
            AutopilotLogger.info(`[AiInference] 时空骨架已提取 (${tripSkeleton.length} 字符), 待推断 ${groupsWithMissingFields.length} 笔`);

            const inferenceResults = await dispatchInferenceChannels(
                groupsWithMissingFields,
                modalState.groups,
                tripSkeleton,
                itineraryText,
                (status) => {
                    if (aiBtn) aiBtn.innerHTML = `<span class="spinner"></span> ${status}`;
                }
            );

            llmInferredCount = mergeInferenceResults(
                modalState.groups,
                inferenceResults,
                modalState.selectedRecordIds
            );

            // 对被 LLM 推断更新的记录重新计算格式化描述
            for (const g of modalState.groups) {
                if (modalState.selectedRecordIds.has(g.expenseRecordId) && g.inferredFields && Object.values(g.inferredFields).includes('llm')) {
                    g.newDescription = computeFormattedDescription(modalState, g);
                }
            }
        }

        refreshTableView(container);

        if (llmInferredCount > 0) {
            showToast('success', `✨ AI 智能推断完成：规则提取 ${ruleInferredCount} 项，大模型精准推理 ${llmInferredCount} 项！`);
        } else if (ruleInferredCount > 0) {
            if (!isLlmConfigured()) {
                showToast('success', `✨ 已提取 ${ruleInferredCount} 项！(在设置中配置大模型 API Key 可启用跨行程与排期深度推断)`);
            } else {
                showToast('success', `✨ 已基于发票证据链提取 ${ruleInferredCount} 项字段！`);
            }
        } else {
            showToast('info', '所选记录的专属字段已全部完整，无需额外推断');
        }
    } catch (err: any) {
        AutopilotLogger.error(`[AiInference] 智能推断异常: ${err?.message || err}`);
        showToast('error', `推断失败: ${err.message || '未知异常'}`);
    } finally {
        if (aiBtn) {
            aiBtn.disabled = false;
            aiBtn.innerHTML = origBtnHtml || `✨ AI 智能推断`;
        }
    }
}

/**
 * 局部刷新表格视图与统计信息
 */
function refreshTableView(container: HTMLElement) {
    // 强制执行筛选联动裁剪，确保当前选择集合 100% 同步当前视图，彻底杜绝幽灵提交
    pruneSelectedRecordIds();

    const wrap = container.querySelector('#yn-bem-table-wrap');
    if (wrap) {
        wrap.innerHTML = renderTableHtml();
        const thAll = wrap.querySelector<HTMLInputElement>('#yn-bem-th-select-all');
        if (thAll) {
            const filtered = getFilteredGroups(modalState);
            const selectedInFiltered = filtered.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));
            thAll.checked = filtered.length > 0 && selectedInFiltered.length === filtered.length;
            thAll.indeterminate = selectedInFiltered.length > 0 && selectedInFiltered.length < filtered.length;
        }
    }
    const stats = container.querySelector('#yn-bem-footer-stats');
    if (stats) {
        stats.innerHTML = renderFooterStatsHtml();
    }
    updateFooterActionButtons(container);
    const pill = container.querySelector('#yn-bem-preview-pill');
    if (pill) {
        pill.textContent = computeFormattedDescription(modalState, modalState.groups[0]);
    }
    const cardWrap = container.querySelector('#yn-bem-dynamic-fields-card');
    if (cardWrap && !modalState.targetExpenseTypeId) {
        cardWrap.outerHTML = renderDynamicFieldsCardHtml();
        bindDynamicCardEvents(container);
    }
    const activeFiltersWrap = container.querySelector('#yn-bem-active-filters-wrap');
    if (activeFiltersWrap) {
        activeFiltersWrap.innerHTML = renderActiveFilterTagsHtml();
    }
}

/**
 * 绑定专属必填字段卡片内部的交互输入与快捷操作事件
 */
function bindDynamicCardEvents(container: HTMLElement) {
    // 住宿字段
    const hotelInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-hotel');
    hotelInp?.addEventListener('input', () => { modalState.dynamicFields.hotelName = hotelInp.value; });

    const cityInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-city');
    cityInp?.addEventListener('input', () => { modalState.dynamicFields.city = cityInp.value; });

    const checkInInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-check-in');
    checkInInp?.addEventListener('change', () => { modalState.dynamicFields.checkInDate = checkInInp.value; });

    const checkOutInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-check-out');
    checkOutInp?.addEventListener('change', () => { modalState.dynamicFields.checkOutDate = checkOutInp.value; });

    const roomsInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-rooms');
    roomsInp?.addEventListener('input', () => { modalState.dynamicFields.roomNum = Number(roomsInp.value) || 1; });

    // 酒店快捷操作 1: 从销方提取酒店名
    container.querySelector('#yn-bem-dyn-qa-hotel-extract')?.addEventListener('click', () => {
        let extracted = '';
        for (const g of modalState.groups) {
            if (modalState.selectedRecordIds.has(g.expenseRecordId)) {
                for (const inv of g.invoices) {
                    if (inv.salesName && (inv.salesName.includes('酒店') || inv.salesName.includes('宾馆') || inv.salesName.includes('客栈') || inv.salesName.includes('民宿') || inv.salesName.includes('饭店'))) {
                        extracted = inv.salesName.trim();
                        break;
                    }
                }
                if (extracted) break;
            }
        }
        if (!extracted) {
            for (const g of modalState.groups) {
                if (modalState.selectedRecordIds.has(g.expenseRecordId) && g.invoices[0]?.salesName) {
                    extracted = g.invoices[0].salesName.trim();
                    break;
                }
            }
        }
        if (extracted) {
            modalState.dynamicFields.hotelName = extracted;
            if (hotelInp) hotelInp.value = extracted;
            showToast('success', `🏨 已从发票销方提取酒店名: ${extracted}`);
        } else {
            showToast('warning', '所选发票中未识别出酒店类销售方');
        }
    });

    // 酒店快捷操作 2: 自动推导住离日
    container.querySelector('#yn-bem-dyn-qa-hotel-date')?.addEventListener('click', () => {
        let earliest = '';
        for (const g of modalState.groups) {
            if (modalState.selectedRecordIds.has(g.expenseRecordId) && g.earliestInvoiceDate) {
                if (!earliest || g.earliestInvoiceDate < earliest) earliest = g.earliestInvoiceDate;
            }
        }
        if (earliest) {
            modalState.dynamicFields.checkInDate = earliest;
            const d = new Date(earliest);
            d.setDate(d.getDate() + 1);
            const nextDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            modalState.dynamicFields.checkOutDate = nextDay;
            if (checkInInp) checkInInp.value = earliest;
            if (checkOutInp) checkOutInp.value = nextDay;
            showToast('success', `📅 已推导住离日: 入住 ${earliest}，离店 ${nextDay}`);
        } else {
            showToast('warning', '所选记录未提取到最早开票日期');
        }
    });

    // 飞机字段
    const flFromInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-flight-from');
    flFromInp?.addEventListener('input', () => { modalState.dynamicFields.flightFromCity = flFromInp.value; });
    const flToInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-flight-to');
    flToInp?.addEventListener('input', () => { modalState.dynamicFields.flightToCity = flToInp.value; });
    const flStartInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-flight-start');
    flStartInp?.addEventListener('change', () => { modalState.dynamicFields.flightStartDate = flStartInp.value; });
    const flEndInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-flight-end');
    flEndInp?.addEventListener('change', () => { modalState.dynamicFields.flightEndDate = flEndInp.value; });
    const flNumInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-flight-num');
    flNumInp?.addEventListener('input', () => { modalState.dynamicFields.flightNum = flNumInp.value; });

    container.querySelector('#yn-bem-dyn-qa-flight-sync')?.addEventListener('click', () => {
        let earliest = '';
        for (const g of modalState.groups) {
            if (modalState.selectedRecordIds.has(g.expenseRecordId) && g.earliestInvoiceDate) {
                if (!earliest || g.earliestInvoiceDate < earliest) earliest = g.earliestInvoiceDate;
            }
        }
        if (earliest) {
            modalState.dynamicFields.flightStartDate = earliest;
            modalState.dynamicFields.flightEndDate = earliest;
            if (flStartInp) flStartInp.value = earliest;
            if (flEndInp) flEndInp.value = earliest;
            showToast('success', `📅 已将起飞与到达日期同步为: ${earliest}`);
        }
    });

    // 火车字段
    const trFromInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-train-from');
    trFromInp?.addEventListener('input', () => { modalState.dynamicFields.trainFromStation = trFromInp.value; });
    const trToInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-train-to');
    trToInp?.addEventListener('input', () => { modalState.dynamicFields.trainToStation = trToInp.value; });
    const trStartInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-train-start');
    trStartInp?.addEventListener('change', () => { modalState.dynamicFields.trainStartDate = trStartInp.value; });
    const trEndInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-train-end');
    trEndInp?.addEventListener('change', () => { modalState.dynamicFields.trainEndDate = trEndInp.value; });

    container.querySelector('#yn-bem-dyn-qa-train-extract')?.addEventListener('click', () => {
        let from = '', to = '';
        for (const g of modalState.groups) {
            if (modalState.selectedRecordIds.has(g.expenseRecordId)) {
                for (const inv of g.invoices) {
                    if (inv.stationGetOn && !from) from = inv.stationGetOn;
                    if (inv.stationGetOff && !to) to = inv.stationGetOff;
                }
            }
        }
        if (from) { modalState.dynamicFields.trainFromStation = from; if (trFromInp) trFromInp.value = from; }
        if (to) { modalState.dynamicFields.trainToStation = to; if (trToInp) trToInp.value = to; }
        showToast('success', `🚄 已从车票提取站名: ${from || '-'} ➔ ${to || '-'}`);
    });

    // 出租车/交通字段
    const tfFromInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-traffic-from');
    tfFromInp?.addEventListener('input', () => { modalState.dynamicFields.startAddress = tfFromInp.value; });
    const tfToInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-traffic-to');
    tfToInp?.addEventListener('input', () => { modalState.dynamicFields.endAddress = tfToInp.value; });

    container.querySelector('#yn-bem-dyn-qa-traffic-extract')?.addEventListener('click', () => {
        let from = '', to = '';
        for (const g of modalState.groups) {
            if (modalState.selectedRecordIds.has(g.expenseRecordId)) {
                for (const inv of g.invoices) {
                    if (inv.stationGetOn && !from) from = inv.stationGetOn;
                    if (inv.stationGetOff && !to) to = inv.stationGetOff;
                }
            }
        }
        if (from) { modalState.dynamicFields.startAddress = from; if (tfFromInp) tfFromInp.value = from; }
        if (to) { modalState.dynamicFields.endAddress = to; if (tfToInp) tfToInp.value = to; }
        showToast('success', `🚕 已从行程单提取始发终点: ${from || '-'} ➔ ${to || '-'}`);
    });

    // 通信费月份
    const mobMonthInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-mobile-month');
    mobMonthInp?.addEventListener('change', () => { modalState.dynamicFields.billMonth = mobMonthInp.value; });

    container.querySelector('#yn-bem-dyn-qa-mobile-sync')?.addEventListener('click', () => {
        let earliest = '';
        for (const g of modalState.groups) {
            if (modalState.selectedRecordIds.has(g.expenseRecordId) && g.earliestInvoiceDate) {
                if (!earliest || g.earliestInvoiceDate < earliest) earliest = g.earliestInvoiceDate;
            }
        }
        if (earliest) {
            const ym = earliest.substring(0, 7);
            modalState.dynamicFields.billMonth = ym;
            if (mobMonthInp) mobMonthInp.value = ym;
            showToast('success', `📅 已推导账期月份: ${ym}`);
        }
    });

    // 其他附加说明
    const extraInp = container.querySelector<HTMLInputElement>('#yn-bem-dyn-extra-desc');
    extraInp?.addEventListener('input', () => { modalState.dynamicFields.extraDesc = extraInp.value; });
}

/**
 * 绑定所有交互事件
 */
function bindEvents(container: HTMLElement, doc: Document) {
    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    const globalState = getInvoicePoolGlobalState();

    // 1. 关闭按钮
    container.querySelector('#yn-bem-close-btn')?.addEventListener('click', closeBatchEditModal);
    container.querySelector('#yn-bem-btn-cancel')?.addEventListener('click', closeBatchEditModal);

    // 2. 出差模式与报销类型
    const optTrip = container.querySelector<HTMLSelectElement>('#yn-bem-opt-trip');
    optTrip?.addEventListener('change', () => {
        modalState.isTrip = optTrip.value === 'true';
        refreshTableView(container);
    });

    const optProxy = container.querySelector<HTMLSelectElement>('#yn-bem-opt-proxy');
    const groupProxyName = container.querySelector<HTMLElement>('#yn-bem-group-proxy-name');
    optProxy?.addEventListener('change', () => {
        modalState.isProxy = optProxy.value === 'true';
        if (groupProxyName) {
            groupProxyName.style.display = modalState.isProxy ? 'inline-flex' : 'none';
        }
        refreshTableView(container);
    });

    // 2.1 变更报销类型下拉监听
    const optTargetType = container.querySelector<HTMLSelectElement>('#yn-bem-opt-target-type');
    optTargetType?.addEventListener('change', () => {
        const val = optTargetType.value;
        modalState.targetExpenseTypeId = val;
        if (val) {
            const findName = (nodes: ExpenseTypeTreeNode[]): string => {
                for (const n of nodes) {
                    if (n.id === val) return n.name;
                    if (n.children && n.children.length > 0) {
                        const child = findName(n.children);
                        if (child) return child;
                    }
                }
                return '';
            };
            modalState.targetExpenseTypeName = findName(modalState.expenseTypeTree);
        } else {
            modalState.targetExpenseTypeName = '';
        }

        const cardWrap = container.querySelector('#yn-bem-dynamic-fields-card');
        if (cardWrap) {
            cardWrap.outerHTML = renderDynamicFieldsCardHtml();
            bindDynamicCardEvents(container);
        }
    });

    // 2.2 初始绑定专属动态必填字段卡片事件
    bindDynamicCardEvents(container);

    // 3. 代报销外驻人名
    const inputName = container.querySelector<HTMLInputElement>('#yn-bem-input-proxy-name');
    inputName?.addEventListener('input', () => {
        modalState.proxyPersonName = inputName.value;
        refreshTableView(container);
    });

    // 4. 归属项目号/名 实时接口检索与智能下拉
    const inputProject = container.querySelector<HTMLInputElement>('#yn-bem-input-project');
    const dropdownProject = container.querySelector<HTMLElement>('#yn-bem-project-dropdown');
    let projectDebounceTimer: any = null;

    const performProjectSearch = async (query: string) => {
        if (!dropdownProject) return;
        const clean = query.trim();
        if (!clean) {
            dropdownProject.style.display = 'none';
            return;
        }

        dropdownProject.style.display = 'block';
        dropdownProject.innerHTML = `<div style="padding:8px 10px; color:#737373; font-size:12px;">正在查询项目列表...</div>`;

        try {
            const results = await searchProjectList(clean, globalState, win);
            if (!results || results.length === 0) {
                dropdownProject.innerHTML = `<div style="padding:8px 10px; color:#a3a3a3; font-size:12px;">未检索到相关项目</div>`;
                return;
            }

            dropdownProject.innerHTML = results.slice(0, 20).map(p => `
                <div class="yn-bem-project-item" data-code="${p.code}" data-name="${p.name}">
                    <span class="yn-bem-project-code">[${p.code}]</span>
                    <span class="yn-bem-project-name">${p.name}</span>
                </div>
            `).join('');

            dropdownProject.querySelectorAll('.yn-bem-project-item').forEach(item => {
                item.addEventListener('click', () => {
                    const code = (item as HTMLElement).dataset.code || '';
                    if (code) {
                        modalState.projectName = code;
                        if (inputProject) inputProject.value = code;
                        dropdownProject.style.display = 'none';
                        refreshTableView(container);
                    }
                });
            });
        } catch (e: any) {
            dropdownProject.innerHTML = `<div style="padding:8px 10px; color:#ef4444; font-size:12px;">检索失败: ${e.message}</div>`;
        }
    };

    inputProject?.addEventListener('input', () => {
        modalState.projectName = inputProject.value;
        clearTimeout(projectDebounceTimer);
        projectDebounceTimer = setTimeout(() => {
            performProjectSearch(inputProject.value);
        }, 250);
        refreshTableView(container);
    });

    inputProject?.addEventListener('focus', () => {
        if (inputProject.value.trim()) {
            performProjectSearch(inputProject.value);
        }
    });

    // 点击外部时自动收起项目下拉与列筛选浮层
    doc.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (dropdownProject && !target.closest('#yn-bem-project-wrapper')) {
            dropdownProject.style.display = 'none';
        }
        if (modalState.activePopoverCol && !target.closest('#yn-bem-filter-popover') && !target.closest('.yn-bem-th-filter-trigger')) {
            modalState.activePopoverCol = null;
            modalState.popoverKeyword = '';
            refreshTableView(container);
        }
    });

    // 活跃筛选条件微标签移除与全部清除
    container.querySelector('.yn-bem-top-bar')?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target && target.classList.contains('yn-bem-remove-filter')) {
            const col = target.dataset.col;
            if (col) {
                delete modalState.columnFilters[col];
                refreshTableView(container);
            }
            return;
        }
        if (target && target.id === 'yn-bem-clear-all-filters') {
            modalState.columnFilters = {};
            refreshTableView(container);
            return;
        }
    });

    // 5. 自定义备注
    const inputRemark = container.querySelector<HTMLInputElement>('#yn-bem-input-remark');
    inputRemark?.addEventListener('input', () => {
        modalState.customRemark = inputRemark.value;
        refreshTableView(container);
    });

    // 6. 批量业务日期输入
    const inputBizDate = container.querySelector<HTMLInputElement>('#yn-bem-input-biz-date');
    inputBizDate?.addEventListener('change', () => {
        modalState.batchBusinessDate = inputBizDate.value;
    });

    // 7. 快捷同步最早开票日为业务日期
    container.querySelector('#yn-bem-qa-sync-earliest-date')?.addEventListener('click', () => {
        const filtered = getFilteredGroups(modalState);
        const isFiltering = filtered.length < modalState.groups.length;
        const targetGroups = modalState.groups.filter(g => {
            if (!modalState.selectedRecordIds.has(g.expenseRecordId)) return false;
            if (isFiltering && !filtered.some(f => f.expenseRecordId === g.expenseRecordId)) return false;
            return true;
        });

        if (targetGroups.length === 0) {
            showToast('warning', isFiltering ? '当前筛选结果中无已勾选的费用记录' : '请先勾选需要修改业务日期的费用记录');
            return;
        }

        let updated = 0;
        targetGroups.forEach(g => {
            if (g.earliestInvoiceDate) {
                g.newBusinessDate = g.earliestInvoiceDate;
                updated++;
            }
        });

        refreshTableView(container);
        showToast('success', `已将 ${isFiltering ? '当前筛选内已选 ' : ''}${updated} 笔费用的业务日期同步为其最早开票日期`);
    });

    // 8. 格式预设按钮与模板微调 (Segmented Control)
    const inputTemplate = container.querySelector<HTMLInputElement>('#yn-bem-input-template');
    inputTemplate?.addEventListener('input', () => {
        modalState.formatTemplate = inputTemplate.value;
        container.querySelectorAll('.yn-bem-preset-btn').forEach(b => {
            b.classList.toggle('active', (b as HTMLElement).dataset.tpl === inputTemplate.value);
        });
        refreshTableView(container);
    });

    container.querySelectorAll('.yn-bem-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tpl = (btn as HTMLElement).dataset.tpl;
            if (tpl) {
                modalState.formatTemplate = tpl;
                if (inputTemplate) inputTemplate.value = tpl;
                container.querySelectorAll('.yn-bem-preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                refreshTableView(container);
            }
        });
    });

    // 9. 补齐交通费始发/目的地选项
    const chkFillAddr = container.querySelector<HTMLInputElement>('#yn-bem-chk-fill-addr');
    chkFillAddr?.addEventListener('change', () => {
        modalState.fillAddresses = chkFillAddr.checked;
    });

    // 10. 批量应用按钮
    container.querySelector('#yn-bem-btn-apply')?.addEventListener('click', () => {
        const filtered = getFilteredGroups(modalState);
        const isFiltering = filtered.length < modalState.groups.length;
        const targetGroups = modalState.groups.filter(g => {
            if (!modalState.selectedRecordIds.has(g.expenseRecordId)) return false;
            if (isFiltering && !filtered.some(f => f.expenseRecordId === g.expenseRecordId)) return false;
            return true;
        });

        if (targetGroups.length === 0) {
            showToast('warning', isFiltering ? '当前筛选结果中无已勾选的费用记录' : '请先勾选需要批量修改的费用记录');
            return;
        }

        let updatedCount = 0;
        targetGroups.forEach(group => {
            // 计算新说明
            group.newDescription = computeFormattedDescription(modalState, group);

            // 批量修改业务日期
            if (modalState.batchBusinessDate) {
                group.newBusinessDate = modalState.batchBusinessDate;
            }

            // 变更报销类型
            if (modalState.targetExpenseTypeId) {
                group.newExpenseTypeId = modalState.targetExpenseTypeId;
                group.newExpenseTypeName = modalState.targetExpenseTypeName;
            }

            // 注入专属必填字段
            const dynValues = { ...modalState.dynamicFields };
            const hasAnyDyn = Object.values(dynValues).some(v => v !== undefined && v !== '' && v !== 0);
            if (hasAnyDyn) {
                group.dynamicFields = { ...(group.dynamicFields || {}), ...dynValues };
            }

            // 自动补齐始发/目的地
            if (modalState.fillAddresses) {
                for (const inv of group.invoices) {
                    if (inv.stationGetOn) group.newStartAddress = inv.stationGetOn;
                    if (inv.stationGetOff) group.newEndAddress = inv.stationGetOff;
                    if (group.newStartAddress || group.newEndAddress) break;
                }
                if (group.newStartAddress || group.newEndAddress) {
                    group.dynamicFields = {
                        ...(group.dynamicFields || {}),
                        startAddress: group.newStartAddress || group.dynamicFields?.startAddress,
                        endAddress: group.newEndAddress || group.dynamicFields?.endAddress
                    };
                }
            }
            updatedCount++;
        });

        refreshTableView(container);
        showToast('success', `成功应用到 ${isFiltering ? '当前筛选内已选 ' : '已选 '}${updatedCount} 笔费用！请在下方表格核验，确认无误后点击“确认保存”`);
    });

    // 11. 模糊搜索 (带 300ms 防抖与筛选联动裁剪)
    const searchInput = container.querySelector<HTMLInputElement>('#yn-bem-search');
    let searchDebounceTimer: any = null;
    searchInput?.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            modalState.searchQuery = searchInput.value;
            pruneSelectedRecordIds();
            refreshTableView(container);
        }, 300);
    });

    // 12. 预警与待补必填项筛选过滤
    const filterSelect = container.querySelector<HTMLSelectElement>('#yn-bem-filter-mode');
    filterSelect?.addEventListener('change', () => {
        modalState.filterMode = filterSelect.value as any;
        pruneSelectedRecordIds();
        refreshTableView(container);
    });

    // 13. 快捷全选 / 全不选 / 反选 / 仅选待补 / 仅选预警
    container.querySelector('#yn-bem-qa-select-all')?.addEventListener('click', () => {
        const filtered = getFilteredGroups(modalState);
        // 全选严格仅针对当前筛选结果集
        modalState.selectedRecordIds = new Set(filtered.map(g => g.expenseRecordId));
        refreshTableView(container);
    });

    container.querySelector('#yn-bem-qa-deselect')?.addEventListener('click', () => {
        modalState.selectedRecordIds.clear();
        refreshTableView(container);
    });

    container.querySelector('#yn-bem-qa-invert')?.addEventListener('click', () => {
        const filtered = getFilteredGroups(modalState);
        filtered.forEach(g => {
            if (modalState.selectedRecordIds.has(g.expenseRecordId)) {
                modalState.selectedRecordIds.delete(g.expenseRecordId);
            } else {
                modalState.selectedRecordIds.add(g.expenseRecordId);
            }
        });
        pruneSelectedRecordIds();
        refreshTableView(container);
    });

    container.querySelector('#yn-bem-qa-select-missing')?.addEventListener('click', () => {
        modalState.selectedRecordIds.clear();
        const filtered = getFilteredGroups(modalState);
        filtered.forEach(g => {
            if (isGroupMissingRequired(g)) {
                modalState.selectedRecordIds.add(g.expenseRecordId);
            }
        });
        refreshTableView(container);
    });

    container.querySelector('#yn-bem-qa-select-warn')?.addEventListener('click', () => {
        modalState.selectedRecordIds.clear();
        const filtered = getFilteredGroups(modalState);
        filtered.forEach(g => {
            if (g.hasWarn) {
                modalState.selectedRecordIds.add(g.expenseRecordId);
            }
        });
        refreshTableView(container);
    });

    // 13.1 底部操作浮条取消选择按钮
    container.querySelector('#yn-bem-btn-clear-selection')?.addEventListener('click', () => {
        modalState.selectedRecordIds.clear();
        refreshTableView(container);
        showToast('info', '已取消选择全部条目');
    });

    // 14. 表格委托事件：表头全选、行选择、就地修改说明、表头排序与列筛选
    container.querySelector('#yn-bem-table-wrap')?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        // 点击清空筛选按钮 (空状态)
        if (target && target.id === 'yn-bem-empty-clear-filters') {
            modalState.searchQuery = '';
            modalState.filterMode = 'ALL';
            modalState.columnFilters = {};
            const searchInp = container.querySelector<HTMLInputElement>('#yn-bem-search');
            if (searchInp) searchInp.value = '';
            const filterSel = container.querySelector<HTMLSelectElement>('#yn-bem-filter-mode');
            if (filterSel) filterSel.value = 'ALL';
            refreshTableView(container);
            showToast('info', '已清空全部筛选条件');
            return;
        }

        // 点击拷贝费用说明至超标说明微按钮 (📋)
        if (target && target.classList.contains('yn-bem-cell-copy-desc-btn')) {
            const recordId = target.dataset.recordid;
            if (recordId) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    const desc = group.newDescription !== undefined ? group.newDescription : group.description;
                    if (desc && desc.trim()) {
                        const copyVal = desc.trim();
                        setGroupDynamicFieldValue(group, 'dynOverStandard', copyVal);
                        modalState.selectedRecordIds.add(recordId);

                        const inp = container.querySelector<HTMLInputElement>(`input[data-recordid="${recordId}"][data-dynkey="dynOverStandard"]`);
                        if (inp) {
                            inp.value = copyVal;
                            inp.classList.add('has-changed');
                            inp.closest('td')?.classList.remove('yn-bem-dyn-cell-empty');
                        }
                        showToast('info', '已拷贝本行“费用说明”到超标理由！');
                    } else {
                        showToast('warning', '当前行费用说明为空，请直接在输入框输入超标理由');
                    }
                }
            }
            return;
        }

        // 点击任意行/单元格时高亮当前所在行 (全宽33列水平对照)
        const clickedTr = target.closest('tr');
        if (clickedTr && clickedTr.dataset.recordid) {
            const recId = clickedTr.dataset.recordid;
            container.querySelectorAll('#yn-bem-table-wrap tbody tr.is-active-row').forEach(r => r.classList.remove('is-active-row'));
            container.querySelectorAll(`#yn-bem-table-wrap tbody tr[data-recordid="${recId}"]`).forEach(r => r.classList.add('is-active-row'));
        }

        // 表头全选
        if (target && target.id === 'yn-bem-th-select-all') {
            const cb = target as HTMLInputElement;
            const filtered = getFilteredGroups(modalState);
            if (cb.checked) {
                // 有筛选的情况下，全选严格仅针对当前筛选结果
                filtered.forEach(g => modalState.selectedRecordIds.add(g.expenseRecordId));
            } else {
                filtered.forEach(g => modalState.selectedRecordIds.delete(g.expenseRecordId));
            }
            pruneSelectedRecordIds();
            refreshTableView(container);
            return;
        }

        // 费用行聚合复选框 (支持 Shift 键区间连选)
        if (target && target.classList.contains('yn-bem-record-cb')) {
            const cb = target as HTMLInputElement;
            const recordId = cb.dataset.recordid;
            if (recordId) {
                const filtered = getFilteredGroups(modalState);
                const mouseEvent = e as MouseEvent;

                if (mouseEvent.shiftKey && modalState.lastSelectedRecordId && modalState.lastSelectedRecordId !== recordId) {
                    const idxA = filtered.findIndex(g => g.expenseRecordId === modalState.lastSelectedRecordId);
                    const idxB = filtered.findIndex(g => g.expenseRecordId === recordId);
                    if (idxA !== -1 && idxB !== -1) {
                        const start = Math.min(idxA, idxB);
                        const end = Math.max(idxA, idxB);
                        const targetChecked = cb.checked;
                        for (let i = start; i <= end; i++) {
                            const gid = filtered[i].expenseRecordId;
                            if (targetChecked) {
                                modalState.selectedRecordIds.add(gid);
                            } else {
                                modalState.selectedRecordIds.delete(gid);
                            }
                            container.querySelectorAll<HTMLInputElement>(`input.yn-bem-record-cb[data-recordid="${gid}"]`).forEach(c => c.checked = targetChecked);
                            container.querySelectorAll(`tr[data-recordid="${gid}"]`).forEach(r => r.classList.toggle('is-selected', targetChecked));
                        }
                    }
                } else {
                    if (cb.checked) {
                        modalState.selectedRecordIds.add(recordId);
                    } else {
                        modalState.selectedRecordIds.delete(recordId);
                    }
                    const rows = container.querySelectorAll(`tr[data-recordid="${recordId}"]`);
                    rows.forEach(r => r.classList.toggle('is-selected', cb.checked));
                }

                modalState.lastSelectedRecordId = recordId;

                const thAll = container.querySelector<HTMLInputElement>('#yn-bem-th-select-all');
                if (thAll) {
                    const selectedInFiltered = filtered.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));
                    thAll.checked = filtered.length > 0 && selectedInFiltered.length === filtered.length;
                    thAll.indeterminate = selectedInFiltered.length > 0 && selectedInFiltered.length < filtered.length;
                }

                const stats = container.querySelector('#yn-bem-footer-stats');
                if (stats) stats.innerHTML = renderFooterStatsHtml();
                updateFooterActionButtons(container);
            }
            return;
        }

        // 行级专属字段触发按钮
        const dynTrigger = target.closest<HTMLElement>('.yn-bem-cell-dyn-trigger');
        if (dynTrigger && dynTrigger.dataset.recordid) {
            e.stopPropagation();
            openRowDynamicModal(dynTrigger.dataset.recordid, container);
            return;
        }

        // 列筛选触发按钮 (▾)
        const filterBtn = target.closest<HTMLElement>('.yn-bem-th-filter-trigger');
        if (filterBtn && filterBtn.dataset.filterCol) {
            e.stopPropagation();
            const col = filterBtn.dataset.filterCol;
            if (modalState.activePopoverCol === col) {
                modalState.activePopoverCol = null;
            } else {
                modalState.activePopoverCol = col;
                modalState.popoverKeyword = '';
            }
            refreshTableView(container);
            if (modalState.activePopoverCol) {
                setTimeout(() => {
                    container.querySelector<HTMLInputElement>('#yn-bem-popover-search')?.focus();
                }, 50);
            }
            return;
        }

        // Popover 内部全选本列值
        if (target && target.id === 'yn-bem-popover-select-all') {
            e.stopPropagation();
            const pop = target.closest<HTMLElement>('#yn-bem-filter-popover');
            const col = pop?.dataset.col;
            if (col) {
                const distinct = getDistinctValuesForColumn(modalState.groups, col);
                modalState.columnFilters[col] = distinct.map(d => d.value);
                refreshTableView(container);
            }
            return;
        }

        // Popover 内部清空本列筛选
        if (target && target.id === 'yn-bem-popover-clear') {
            e.stopPropagation();
            const pop = target.closest<HTMLElement>('#yn-bem-filter-popover');
            const col = pop?.dataset.col;
            if (col) {
                delete modalState.columnFilters[col];
                refreshTableView(container);
            }
            return;
        }

        // Popover 内部其它点击拦截冒泡 (防止触发排序或关闭)
        if (target && target.closest('#yn-bem-filter-popover')) {
            e.stopPropagation();
            return;
        }

        // 表头标题点击排序 (全字段支持)
        const titleEl = target.closest<HTMLElement>('.yn-bem-th-title');
        if (titleEl && titleEl.dataset.sort) {
            const key = titleEl.dataset.sort;
            if (modalState.sortKey === key) {
                modalState.sortAsc = !modalState.sortAsc;
            } else {
                modalState.sortKey = key;
                modalState.sortAsc = true;
            }
            sortGroups(modalState.groups, modalState.sortKey, modalState.sortAsc);
            refreshTableView(container);
            return;
        }
    });

    // 14.1 列头筛选复选框值勾选变更监听 & 单元格就地直接修改监听
    container.querySelector('#yn-bem-table-wrap')?.addEventListener('change', (e) => {
        const target = e.target as HTMLElement;

        // 列筛选值复选框
        if (target && target.classList.contains('yn-bem-col-val-cb')) {
            const cb = target as HTMLInputElement;
            const col = cb.dataset.col;
            const val = cb.dataset.val;
            if (col && val !== undefined) {
                const currList = modalState.columnFilters[col] || [];
                const set = new Set(currList);
                if (cb.checked) {
                    set.add(val);
                } else {
                    set.delete(val);
                }
                if (set.size === 0) {
                    delete modalState.columnFilters[col];
                } else {
                    modalState.columnFilters[col] = Array.from(set);
                }
                refreshTableView(container);
            }
            return;
        }

        // 费用业务日期就地编辑
        if (target && target.classList.contains('yn-bem-cell-date-input')) {
            const dateInput = target as HTMLInputElement;
            const recordId = dateInput.dataset.recordid;
            if (recordId) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    group.newBusinessDate = dateInput.value;
                    dateInput.classList.toggle('has-changed', Boolean(dateInput.value && dateInput.value !== group.businessDate));
                    modalState.selectedRecordIds.add(recordId);
                    container.querySelectorAll<HTMLInputElement>(`input.yn-bem-record-cb[data-recordid="${recordId}"]`).forEach(c => c.checked = true);
                    container.querySelectorAll(`tr[data-recordid="${recordId}"]`).forEach(r => r.classList.add('is-selected'));
                    const stats = container.querySelector('#yn-bem-footer-stats');
                    if (stats) stats.innerHTML = renderFooterStatsHtml();
                }
            }
            return;
        }

        // 费用类型就地编辑下拉选单
        if (target && target.classList.contains('yn-bem-cell-type-select')) {
            const selectEl = target as HTMLSelectElement;
            const recordId = selectEl.dataset.recordid;
            if (recordId) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    const newTypeId = selectEl.value;
                    const newTypeName = findExpenseTypeNameById(modalState.expenseTypeTree, newTypeId);
                    group.newExpenseTypeId = newTypeId;
                    group.newExpenseTypeName = newTypeName;
                    selectEl.classList.toggle('has-type-changed', newTypeId !== group.expenseTypeId);
                    modalState.selectedRecordIds.add(recordId);
                    refreshTableView(container);
                    showToast('info', `已更新该行报销类型为 [${newTypeName}]`);
                }
            }
            return;
        }

        // 专属必填字段就地编辑 (日期/月份选择等 change 事件)
        if (target && target.classList.contains('yn-bem-dyn-input')) {
            const input = target as HTMLInputElement;
            const recordId = input.dataset.recordid;
            const dynKey = input.dataset.dynkey;
            if (recordId && dynKey) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    setGroupDynamicFieldValue(group, dynKey, input.value);
                    input.classList.add('has-changed');
                    const td = input.closest('td');
                    if (td) {
                        td.classList.toggle('yn-bem-dyn-cell-empty', !input.value || input.value.trim() === '');
                    }
                    if (dynKey === 'dynCity') {
                        const tr = input.closest('tr');
                        const typeInput = tr?.querySelector<HTMLInputElement>('input[data-dynkey="dynCityType"]');
                        if (typeInput) {
                            const c = input.value.replace(/市|区|县/g, '').trim();
                            const derivedType = c ? (/北京|上海|广州|深圳/.test(c) ? '境内-北上广深' : '境内-其他') : '';
                            typeInput.value = derivedType;
                            const typeTd = typeInput.closest('td');
                            if (typeTd) typeTd.classList.toggle('yn-bem-dyn-cell-empty', !derivedType);
                        }
                    }
                    if (['dynCity', 'dynCheckIn', 'dynCheckOut', 'dynRoomNum'].includes(dynKey) && getGroupCategory(group) === 'HOTEL') {
                        const isOver = isHotelGroupOverStandard(group);
                        const detail = getHotelPricingDetail(group);
                        const tr = input.closest('tr');
                        const overInp = tr?.querySelector<HTMLInputElement>('input[data-dynkey="dynOverStandard"]');
                        const overTd = overInp?.closest('td');
                        const currentOverVal = (group.dynamicFields?.overStandardDescription || '').trim();

                        if (isOver) {
                            overTd?.classList.add('yn-bem-dyn-cell-over-standard');
                            if (!currentOverVal) {
                                overTd?.classList.add('yn-bem-dyn-cell-empty');
                                if (overInp) overInp.placeholder = '超标必填 (自主填写或点击📋拷贝)';
                            }
                            if (overTd && detail) overTd.title = `⚠️ 住宿费已超标：${detail.formulaText}！超标说明为必填项`;
                            showToast('warning', `⚠️ 检测到住宿费单价超出城市限额 (${detail?.formulaText || ''})，超标说明为必填项！`, 6000);
                        } else {
                            // 由超标变为未超标：立即清除警示红框并恢复正常状态
                            overTd?.classList.remove('yn-bem-dyn-cell-empty');
                            overTd?.classList.remove('yn-bem-dyn-cell-over-standard');
                            if (overInp) overInp.placeholder = '未超标(选填)';
                            if (overTd && detail) overTd.title = `超标说明 · 系统测算未超标: ${detail.formulaText}`;
                        }
                    }
                    modalState.selectedRecordIds.add(recordId);
                    container.querySelectorAll<HTMLInputElement>(`input.yn-bem-record-cb[data-recordid="${recordId}"]`).forEach(c => c.checked = true);
                    container.querySelectorAll(`tr[data-recordid="${recordId}"]`).forEach(r => r.classList.add('is-selected'));
                    const stats = container.querySelector('#yn-bem-footer-stats');
                    if (stats) stats.innerHTML = renderFooterStatsHtml();
                }
            }
            return;
        }
    });

    // 15. 说明文本框就地编辑、始发地/目的地/服务商就地编辑与列筛选搜索输入监听
    container.querySelector('#yn-bem-table-wrap')?.addEventListener('input', (e) => {
        const target = e.target as HTMLElement;

        // 列筛选搜索框动态高亮匹配
        if (target && target.id === 'yn-bem-popover-search') {
            modalState.popoverKeyword = (target as HTMLInputElement).value;
            const popoverEl = container.querySelector('#yn-bem-filter-popover');
            if (popoverEl && modalState.activePopoverCol) {
                const col = modalState.activePopoverCol;
                const distinctVals = getDistinctValuesForColumn(modalState.groups, col);
                const selected = new Set(modalState.columnFilters[col] || []);
                const kw = modalState.popoverKeyword.toLowerCase().trim();
                const filteredVals = kw ? distinctVals.filter(d => d.value.toLowerCase().includes(kw)) : distinctVals;
                const listEl = popoverEl.querySelector('.yn-bem-filter-val-list');
                if (listEl) {
                    listEl.innerHTML = filteredVals.length === 0
                        ? `<div style="color:#a3a3a3; font-size:11px; padding:6px;">未匹配到值</div>`
                        : filteredVals.map(item => {
                            const isChecked = selected.has(item.value);
                            const safeVal = item.value.replace(/"/g, '&quot;');
                            return `
                                <label class="yn-bem-filter-val-item">
                                    <input type="checkbox" class="yn-bem-col-val-cb" data-col="${col}" data-val="${safeVal}" ${isChecked ? 'checked' : ''} />
                                    <span class="yn-bem-filter-val-text" title="${safeVal}">${item.value}</span>
                                    <span class="yn-bem-filter-val-count">${item.count}</span>
                                </label>
                            `;
                        }).join('');
                }
            }
            return;
        }

        // 说明文本框就地编辑
        if (target && target.classList.contains('yn-bem-desc-box')) {
            const textarea = target as HTMLTextAreaElement;
            const recordId = textarea.dataset.recordid;
            if (recordId) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    group.newDescription = textarea.value;
                    textarea.classList.toggle('has-changed', textarea.value !== group.description);
                    modalState.selectedRecordIds.add(recordId);
                    container.querySelectorAll<HTMLInputElement>(`input.yn-bem-record-cb[data-recordid="${recordId}"]`).forEach(c => c.checked = true);
                    container.querySelectorAll(`tr[data-recordid="${recordId}"]`).forEach(r => r.classList.add('is-selected'));
                    const stats = container.querySelector('#yn-bem-footer-stats');
                    if (stats) stats.innerHTML = renderFooterStatsHtml();
                }
            }
            return;
        }

        // 业务日期就地编辑实时触发 (兼容 date picker 即时 input)
        if (target && target.classList.contains('yn-bem-cell-date-input')) {
            const dateInput = target as HTMLInputElement;
            const recordId = dateInput.dataset.recordid;
            if (recordId) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    group.newBusinessDate = dateInput.value;
                    dateInput.classList.toggle('has-changed', Boolean(dateInput.value && dateInput.value !== group.businessDate));
                    if (group.inferredFields) {
                        delete group.inferredFields['businessDate'];
                        const td = dateInput.closest('td');
                        td?.classList.remove('yn-bem-cell-ai-date');
                        dateInput.classList.remove('is-ai-inferred');
                        const sparkle = td?.querySelector('.yn-bem-ai-sparkle-dot');
                        if (sparkle) sparkle.remove();
                        const badge = td?.querySelector('.yn-bem-ai-date-badge');
                        if (badge) badge.remove();
                    }
                    modalState.selectedRecordIds.add(recordId);
                    container.querySelectorAll<HTMLInputElement>(`input.yn-bem-record-cb[data-recordid="${recordId}"]`).forEach(c => c.checked = true);
                    container.querySelectorAll(`tr[data-recordid="${recordId}"]`).forEach(r => r.classList.add('is-selected'));
                    const stats = container.querySelector('#yn-bem-footer-stats');
                    if (stats) stats.innerHTML = renderFooterStatsHtml();
                }
            }
            return;
        }

        // 始发地 / 出发站就地编辑
        if (target && target.classList.contains('yn-bem-cell-station-on')) {
            const input = target as HTMLInputElement;
            const recordId = input.dataset.recordid;
            const invIndex = Number(input.dataset.invindex);
            if (recordId) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    const inv = group.invoices.find(i => i.invoiceIndex === invIndex) || group.invoices[0];
                    if (inv) inv.stationGetOn = input.value;
                    group.newStartAddress = input.value;
                    group.dynamicFields = group.dynamicFields || {};
                    group.dynamicFields.startAddress = input.value;
                    group.dynamicFields.trainFromStation = input.value;
                    group.dynamicFields.flightFromCity = input.value;
                    input.classList.toggle('has-changed', true);
                    modalState.selectedRecordIds.add(recordId);
                    container.querySelectorAll<HTMLInputElement>(`input.yn-bem-record-cb[data-recordid="${recordId}"]`).forEach(c => c.checked = true);
                    container.querySelectorAll(`tr[data-recordid="${recordId}"]`).forEach(r => r.classList.add('is-selected'));
                    const stats = container.querySelector('#yn-bem-footer-stats');
                    if (stats) stats.innerHTML = renderFooterStatsHtml();
                }
            }
            return;
        }

        // 目的地 / 到达站就地编辑
        if (target && target.classList.contains('yn-bem-cell-station-off')) {
            const input = target as HTMLInputElement;
            const recordId = input.dataset.recordid;
            const invIndex = Number(input.dataset.invindex);
            if (recordId) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    const inv = group.invoices.find(i => i.invoiceIndex === invIndex) || group.invoices[0];
                    if (inv) inv.stationGetOff = input.value;
                    group.newEndAddress = input.value;
                    group.dynamicFields = group.dynamicFields || {};
                    group.dynamicFields.endAddress = input.value;
                    group.dynamicFields.trainToStation = input.value;
                    group.dynamicFields.flightToCity = input.value;
                    input.classList.toggle('has-changed', true);
                    modalState.selectedRecordIds.add(recordId);
                    container.querySelectorAll<HTMLInputElement>(`input.yn-bem-record-cb[data-recordid="${recordId}"]`).forEach(c => c.checked = true);
                    container.querySelectorAll(`tr[data-recordid="${recordId}"]`).forEach(r => r.classList.add('is-selected'));
                    const stats = container.querySelector('#yn-bem-footer-stats');
                    if (stats) stats.innerHTML = renderFooterStatsHtml();
                }
            }
            return;
        }

        // 销售方 / 酒店就地编辑
        if (target && target.classList.contains('yn-bem-cell-sales-name')) {
            const input = target as HTMLInputElement;
            const recordId = input.dataset.recordid;
            const invIndex = Number(input.dataset.invindex);
            if (recordId) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    const inv = group.invoices.find(i => i.invoiceIndex === invIndex) || group.invoices[0];
                    if (inv) inv.salesName = input.value;
                    group.dynamicFields = group.dynamicFields || {};
                    group.dynamicFields.hotelName = input.value;
                    input.classList.toggle('has-changed', true);
                    modalState.selectedRecordIds.add(recordId);
                    container.querySelectorAll<HTMLInputElement>(`input.yn-bem-record-cb[data-recordid="${recordId}"]`).forEach(c => c.checked = true);
                    container.querySelectorAll(`tr[data-recordid="${recordId}"]`).forEach(r => r.classList.add('is-selected'));
                    const stats = container.querySelector('#yn-bem-footer-stats');
                    if (stats) stats.innerHTML = renderFooterStatsHtml();
                }
            }
            return;
        }

        // 专属必填字段就地编辑实时输入 (文本、数字等 input 事件)
        if (target && target.classList.contains('yn-bem-dyn-input')) {
            const input = target as HTMLInputElement;
            const recordId = input.dataset.recordid;
            const dynKey = input.dataset.dynkey;
            if (recordId && dynKey) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    setGroupDynamicFieldValue(group, dynKey, input.value);
                    input.classList.add('has-changed');
                    const td = input.closest('td');
                    if (td) {
                        td.classList.toggle('yn-bem-dyn-cell-empty', !input.value || input.value.trim() === '');
                    }
                    if (dynKey === 'dynCity') {
                        const tr = input.closest('tr');
                        const typeInput = tr?.querySelector<HTMLInputElement>('input[data-dynkey="dynCityType"]');
                        if (typeInput) {
                            const c = input.value.replace(/市|区|县/g, '').trim();
                            const derivedType = c ? (/北京|上海|广州|深圳/.test(c) ? '境内-北上广深' : '境内-其他') : '';
                            typeInput.value = derivedType;
                            const typeTd = typeInput.closest('td');
                            if (typeTd) typeTd.classList.toggle('yn-bem-dyn-cell-empty', !derivedType);
                        }
                    }
                    if (group.inferredFields) {
                        delete group.inferredFields[dynKey];
                        const sparkle = td?.querySelector('.yn-bem-ai-sparkle-dot');
                        if (sparkle) sparkle.remove();
                        td?.classList.remove('yn-bem-dyn-cell-ai');
                        input.classList.remove('is-ai-inferred');
                    }
                    modalState.selectedRecordIds.add(recordId);
                    container.querySelectorAll<HTMLInputElement>(`input.yn-bem-record-cb[data-recordid="${recordId}"]`).forEach(c => c.checked = true);
                    container.querySelectorAll(`tr[data-recordid="${recordId}"]`).forEach(r => r.classList.add('is-selected'));
                    const stats = container.querySelector('#yn-bem-footer-stats');
                    if (stats) stats.innerHTML = renderFooterStatsHtml();
                }
            }
            return;
        }
    });

    // 15.1 AI 智能推断专属字段按钮 (弹出出差排期辅助模态框)
    container.querySelector('#yn-bem-btn-ai-infer')?.addEventListener('click', () => {
        openItineraryModal(container);
    });

    // 16. 导出所选费用清单 CSV 按钮
    container.querySelector('#yn-bem-btn-export')?.addEventListener('click', () => {
        const filteredGroups = getFilteredGroups(modalState);
        const selectedGroups = filteredGroups.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));
        if (selectedGroups.length === 0) {
            showToast('warning', '请先勾选需要导出的费用记录');
            return;
        }

        // 展平为发票清单，带上修改后的说明与业务日期
        const exportRows: ExpenseRecordExportRow[] = [];
        selectedGroups.forEach(group => {
            const effectiveDesc = group.newDescription !== undefined ? group.newDescription : group.description;
            const effectiveBizDate = group.newBusinessDate || group.businessDate;
            const effectiveTypeId = group.newExpenseTypeId || group.expenseTypeId;
            const effectiveTypeName = group.newExpenseTypeName
                ? `${group.newExpenseTypeName} (原: ${group.expenseTypeName})`
                : group.expenseTypeName;
            const dynSummary = group.dynamicFields
                ? Object.entries(group.dynamicFields).filter(([_, v]) => Boolean(v)).map(([k, v]) => `${k}:${v}`).join('; ')
                : '';

            if (group.invoices.length === 0) {
                exportRows.push({
                    expenseRecordId: group.expenseRecordId,
                    status: '未报销',
                    expenseTypeId: effectiveTypeId,
                    expenseTypeName: effectiveTypeName,
                    expenseAmount: group.expenseAmount,
                    businessDate: effectiveBizDate,
                    description: effectiveDesc,
                    invoiceCount: group.invoiceCount,
                    applicantName: group.applicantName,
                    createDate: group.createDate,
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
                    stationGetOn: group.dynamicFields?.startAddress || '',
                    stationGetOff: group.dynamicFields?.endAddress || '',
                    trainNo: group.dynamicFields?.trainNum || group.dynamicFields?.flightNum || '',
                    salesName: group.dynamicFields?.hotelName || '',
                    purchaserName: '',
                    commodityNames: '',
                    fileName: '',
                    remarks: dynSummary,
                    reconciliationNote: '无挂载发票'
                });
            } else {
                group.invoices.forEach(inv => {
                    exportRows.push({
                        expenseRecordId: group.expenseRecordId,
                        status: '未报销',
                        expenseTypeId: effectiveTypeId,
                        expenseTypeName: effectiveTypeName,
                        expenseAmount: group.expenseAmount,
                        businessDate: effectiveBizDate,
                        description: effectiveDesc,
                        invoiceCount: group.invoiceCount,
                        applicantName: group.applicantName,
                        createDate: group.createDate,
                        invoiceIndex: inv.invoiceIndex,
                        invoiceType: inv.invoiceType,
                        invoiceCode: inv.invoiceCode,
                        invoiceNo: inv.invoiceNo,
                        invoiceDate: inv.invoiceDate,
                        amountTax: inv.amountTax,
                        totalAmount: inv.totalAmount,
                        totalTax: inv.totalTax || '',
                        departureDate: inv.departureDate,
                        departureTime: inv.departureTime,
                        timeGetOff: inv.timeGetOff,
                        stationGetOn: inv.stationGetOn || group.dynamicFields?.startAddress || '',
                        stationGetOff: inv.stationGetOff || group.dynamicFields?.endAddress || '',
                        trainNo: inv.trainNo || group.dynamicFields?.trainNum || group.dynamicFields?.flightNum || '',
                        salesName: inv.salesName,
                        purchaserName: '',
                        commodityNames: '',
                        fileName: inv.fileName,
                        remarks: [inv.remarks, dynSummary].filter(Boolean).join(' | '),
                        reconciliationNote: inv.reconciliationNote
                    });
                });
            }
        });

        const csv = convertExpenseRecordsToCsv(exportRows);
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        downloadCsvFile(csv, `费用记录聚合核对清单_${ts}.csv`, win);
        showToast('success', `成功导出已选 ${selectedGroups.length} 笔费用 (共 ${exportRows.length} 条发票明细)！已开始下载`);
    });

    // 17. 确认保存到系统
    const btnSaveAll = container.querySelector<HTMLButtonElement>('#yn-bem-btn-save-all');
    btnSaveAll?.addEventListener('click', async () => {
        const updates: ExpenseRecordUpdateItem[] = [];

        modalState.groups.forEach(group => {
            if (modalState.selectedRecordIds.has(group.expenseRecordId)) {
                const hasDescChange = group.newDescription !== undefined && group.newDescription !== group.description;
                const hasDateChange = group.newBusinessDate !== undefined && group.newBusinessDate !== group.businessDate;
                const hasTypeChange = Boolean(group.newExpenseTypeId && group.newExpenseTypeId !== group.expenseTypeId);
                const hasDynChange = Boolean(group.dynamicFields && Object.values(group.dynamicFields).some(v => v !== undefined && v !== '' && v !== 0));
                const hasAddrChange = Boolean(group.newStartAddress || group.newEndAddress);

                if (hasDescChange || hasDateChange || hasTypeChange || hasDynChange || hasAddrChange) {
                    updates.push({
                        expenseRecordId: group.expenseRecordId,
                        expenseTypeId: group.expenseTypeId,
                        originalExpenseTypeId: group.expenseTypeId,
                        targetExpenseTypeId: group.newExpenseTypeId,
                        targetExpenseTypeName: group.newExpenseTypeName,
                        newDescription: group.newDescription,
                        newBusinessDate: group.newBusinessDate,
                        startAddress: group.newStartAddress || group.dynamicFields?.startAddress,
                        endAddress: group.newEndAddress || group.dynamicFields?.endAddress,
                        dynamicFields: group.dynamicFields
                    });
                }
            }
        });

        if (updates.length === 0) {
            showToast('warning', '未检测到任何内容变动。请先点击“应用到已选”或就地修改说明后再保存');
            return;
        }

        const typeChangeCount = updates.filter(u => Boolean(u.targetExpenseTypeId && u.targetExpenseTypeId !== u.originalExpenseTypeId)).length;

        // 保存前超标说明必填校验守卫：超标说明绝不伪造硬编码理由，必须由用户自主填写或拷贝费用说明
        const overStandardMissing = updates.filter(u => {
            const group = modalState.groups.find(g => g.expenseRecordId === u.expenseRecordId);
            if (!group) return false;
            if (getGroupCategory(group) === 'HOTEL' && isHotelGroupOverStandard(group)) {
                const val = (u.dynamicFields?.overStandardDescription || '').trim();
                return !val;
            }
            return false;
        });

        if (overStandardMissing.length > 0) {
            showToast('error', `⚠️ 保存拦截：有 ${overStandardMissing.length} 笔住宿费单价已超标，超标说明为必填项！请在表格中输入理由或点击 📋 拷贝“费用说明”后再保存。`, 7000);
            const firstMissing = overStandardMissing[0];
            const firstInp = container.querySelector<HTMLInputElement>(`input[data-recordid="${firstMissing.expenseRecordId}"][data-dynkey="dynOverStandard"]`);
            if (firstInp) {
                firstInp.scrollIntoView({ behavior: 'smooth', block: 'center' });
                firstInp.focus();
                firstInp.closest('td')?.classList.add('yn-bem-dyn-cell-empty');
            }
            return;
        }

        const confirmed = confirm(
            `确定要将批量修改的内容持久化保存到系统吗？\n\n` +
            `• 待更新费用记录数: ${updates.length} 笔\n` +
            (typeChangeCount > 0 ? `• 其中包含报销类型变更: ${typeChangeCount} 笔 (将重置对应类型槽位并注入必填字段)\n` : '') +
            `• 状态: 仅保存为草稿 (符合禁止自动提交铁律)`
        );
        if (!confirmed) return;

        btnSaveAll.disabled = true;
        btnSaveAll.innerText = `正在保存 (0/${updates.length})...`;

        try {
            const res = await batchUpdateExpenseRecordsApi(
                updates,
                globalState,
                (curr, total) => {
                    btnSaveAll.innerText = `正在保存 (${curr}/${total})...`;
                },
                win
            );

            if (res.failCount === 0) {
                if (res.hasOverStandard) {
                    showToast('info', `💡 提示：本次保存包含 ${res.overStandardCount} 笔超标住宿费，已成功按您填写的超标说明合规入库。`, 6000);
                }
                showToast('success', `成功批量保存 ${res.successCount} 笔费用记录！页面即将刷新`, 4000);
                btnSaveAll.innerText = `保存成功 (${res.successCount} 笔)`;
                setTimeout(() => {
                    closeBatchEditModal();
                    if (win) {
                        win.location.reload();
                    } else if (typeof window !== 'undefined') {
                        window.location.reload();
                    }
                }, 1500);
            } else {
                const errDetail = res.errors && res.errors.length > 0
                    ? res.errors.slice(0, 3).map(e => e.error).join('；')
                    : '部分记录存在未满足的必填校验';
                AutopilotLogger.error(`[BatchEditModal] 批量保存部分失败: ${JSON.stringify(res.errors)}`);
                showToast('warning', `保存完成: 成功 ${res.successCount} 笔，失败 ${res.failCount} 笔: ${errDetail}`, 8000);
                btnSaveAll.disabled = false;
                btnSaveAll.innerText = `确认批量修改并保存`;
            }
        } catch (err: any) {
            AutopilotLogger.error(`[BatchEditModal] 保存异常: ${err.message}`);
            showToast('error', `保存失败: ${err.message || '网络或系统异常'}`);
            btnSaveAll.disabled = false;
            btnSaveAll.innerText = `确认批量修改并保存`;
        }
    });
}

if (typeof window !== 'undefined') {
    (window as any).openBatchEditExpenseModal = openBatchEditExpenseModal;
}
if (typeof unsafeWindow !== 'undefined') {
    (unsafeWindow as any).openBatchEditExpenseModal = openBatchEditExpenseModal;
}
