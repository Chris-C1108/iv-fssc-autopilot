import { GlobalState, TripApplicationConfig, TripLeg } from '../types/state';
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
import {
    searchProjectList,
    fetchLoginUserInfo,
    createSingleTripApplicationApi,
    fetchHistoricalTripApplications,
    crossCheckWithHistoricalApplications,
    calculateDaysAndNights,
    computeMealAllowance,
    parseItineraryTable,
    DynamicTripInput
} from '../services/applicationService';
import { createBillDataAndTemplateByExpenseIdListApi, saveBillDataApi } from '../services/billService';
import { TRIP_CONSTANTS, BUDGET_CONSTANTS } from '../config/constants';
import { getInvoicePoolGlobalState } from '../services/invoicePoolDomService';

const BILL_DEFINE_IDS = {
    TRIP_APPLICATION_SC: '0355cf627fede1653e55bb00bc610001', // 出差申请单 (SC)
    TRIP_CLAIM_BC: '035a50ee6d3de1653e55bb00bc610001',        // 出差费用报销单 (BC)
    GENERAL_CLAIM_BJ: '035cd1b4d46de1653e55bb00bc610000'      // 经费报销单 (BJ)
};
import { isLlmConfigured, callDirectLlmJson } from '../services/llmService';
import {
    extractTripSkeleton,
    dispatchInferenceChannels,
    mergeInferenceResults,
    detectTypeCategory,
    getGroupCategory,
    isUnknownTypeGroup,
    getExpenseBillFlow,
    getGroupBillFlow,
    checkTaxiMisclassification,
    ExpenseBillFlow,
    parseItineraryWithAi,
    parseItineraryWithAiDetailed
} from '../services/inferenceService';
import {
    batchEditEventBus,
    inferSelectedFields,
    parseItinerary,
    createBillDraft,
    batchEditTools
} from '../services/batchEditTools';
import { MODAL_STYLES } from './styles';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
    AssistantChatPanel,
    ChatMessage,
    ChatSession,
    ChatAttachment,
    ThinkingData,
    ChatToolCall
} from './AssistantChatPanel';

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
    tripId?: string;       // 所属 Trip 唯一标识，如 'trip_1', 'trip_none'
    tripName?: string;     // 所属 Trip 名称，如 'Trip 1: 2026-07-20 ~ 07-24 · 天津市'
    tripNo?: number;       // 1, 2...
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
    { key: 'earliestInvoiceDate', label: '最早开票日', width: '76px', sticky: 'date', isDate: true },
    { key: 'businessDate', label: '费用业务日', width: '78px', isDate: true },
    { key: 'expenseTypeName', label: '费用类型', width: '100px' },
    { key: 'expenseAmount', label: '费用金额', width: '80px', align: 'right', isNumeric: true },
    { key: 'description', label: '费用说明', width: '120px' },
    { key: 'invoiceCount', label: '发票张数', width: '46px', align: 'center', isNumeric: true },

    // 专属必填字段 15 独立列 (费用主体聚合列，rowspan 合并)
    { key: 'dynFrom', label: '出发地/站', width: '68px', isDynamic: true, dynFieldKey: 'dynFrom', dynInputType: 'text' },
    { key: 'dynTo', label: '到达地/站', width: '68px', isDynamic: true, dynFieldKey: 'dynTo', dynInputType: 'text' },
    { key: 'dynTransitNo', label: '航班/车次', width: '64px', isDynamic: true, dynFieldKey: 'dynTransitNo', dynInputType: 'text' },
    { key: 'dynStartDate', label: '起程日期', width: '76px', isDate: true, isDynamic: true, dynFieldKey: 'dynStartDate', dynInputType: 'date' },
    { key: 'dynEndDate', label: '到达日期', width: '76px', isDate: true, isDynamic: true, dynFieldKey: 'dynEndDate', dynInputType: 'date' },
    { key: 'dynCheckIn', label: '入住日期', width: '76px', isDate: true, isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'checkInDate', dynInputType: 'date' },
    { key: 'dynCheckOut', label: '离店日期', width: '76px', isDate: true, isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'checkOutDate', dynInputType: 'date' },
    { key: 'dynCity', label: '出差城市', width: '64px', isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'city', dynInputType: 'text' },
    { key: 'dynCityType', label: '城市类型', width: '76px', isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'cityType', dynInputType: 'text' },
    { key: 'dynHotel', label: '酒店名称', width: '88px', isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'hotelName', dynInputType: 'text' },
    { key: 'dynRoomNum', label: '房间数', width: '46px', isNumeric: true, isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'roomNum', dynInputType: 'number' },
    { key: 'dynOverStandard', label: '超标说明', width: '84px', isDynamic: true, dynCategory: 'HOTEL', dynFieldKey: 'overStandardDescription', dynInputType: 'text' },

    { key: 'dynAddrFrom', label: '打车始发', width: '76px', isDynamic: true, dynCategory: 'TAXI', dynFieldKey: 'startAddress', dynInputType: 'text' },
    { key: 'dynAddrTo', label: '打车目的', width: '76px', isDynamic: true, dynCategory: 'TAXI', dynFieldKey: 'endAddress', dynInputType: 'text' },
    { key: 'dynBillMonth', label: '通信账期', width: '68px', isDynamic: true, dynCategory: 'MOBILE', dynFieldKey: 'billMonth', dynInputType: 'month' },

    // 发票子明细列 (14 列)
    { key: 'invoiceIndex', label: '序号', width: '40px', align: 'center', isNumeric: true },
    { key: 'invoiceType', label: '发票类型', width: '88px' },
    { key: 'invoiceCode', label: '发票代码', width: '95px' },
    { key: 'invoiceNo', label: '发票号码', width: '95px' },
    { key: 'totalAmount', label: '价税合计', width: '82px', align: 'right', isNumeric: true },
    { key: 'invoiceDate', label: '开票日期', width: '76px', isDate: true },
    { key: 'departureTime', label: '行程出发', width: '82px' },
    { key: 'timeGetOff', label: '行程到达', width: '82px' },
    { key: 'stationGetOn', label: '始发站', width: '76px' },
    { key: 'stationGetOff', label: '到达站', width: '76px' },
    { key: 'salesName', label: '销售方/商户', width: '120px' },
    { key: 'fileName', label: '附件名', width: '100px' },
    { key: 'remarks', label: '发票备注', width: '90px' },
    { key: 'reconciliationNote', label: '核对状态', width: '88px' }
];

export const DYNAMIC_COLUMNS: ColumnDef[] = COLUMN_DEFINITIONS.filter(c => c.isDynamic);

export type GroupingMode = 'NONE' | 'TRIP' | 'TYPE' | 'TRIP_AND_TYPE';

export {
    ChatAttachment,
    ChatMessage,
    ChatSession,
    ThinkingData,
    ChatToolCall
};

const CHAT_SESSIONS_STORAGE_KEY = 'fssc_autopilot_chat_sessions';

function loadChatSessionsFromStorage(): ChatSession[] {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        }
    } catch (e) {}
    return [
        {
            id: 'session_init',
            title: 'Trip 智能规划与对账分析',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: []
        }
    ];
}

function saveChatSessionsToStorage(sessions: ChatSession[]) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
        }
    } catch (e) {}
}

export interface AiSkillItem {
    id: string;
    command: string;
    name: string;
    icon: string;
    summary: string;
    hintTitle: string;
    hintText: string;
    actionText?: string;
    actionId?: string;
    promptTemplate: (count: number, projectName: string, employeeName: string) => string;
}

export const AI_SKILLS: AiSkillItem[] = [
    {
        id: 'infer',
        command: '/infer',
        name: '智能推断与行程辅助',
        icon: '✨',
        summary: '结合发票票据与行程链条补全交通/住宿/打车必填字段',
        hintTitle: '出差行程与辅助推断说明',
        hintText: '发票开票日期通常滞后于实际出差。您可在此直接粘贴出差排期日程（例如日期、省市、客户据点、酒店等，支持 Excel 复制或自然语言描述），亦可上传行程截图/文件。若无需补充行程，可直接发送启动推断。',
        actionText: '📋 复制排期整理 Prompt',
        actionId: 'yn-gemini-skill-btn-copy-template',
        promptTemplate: (count) => `请结合发票证据链（与如下出差行程）智能补全所选 ${count} 笔费用的专属必填字段：\n`
    },
    {
        id: 'itinerary',
        command: '/itinerary',
        name: '出差排期规划 Trip',
        icon: '📋',
        summary: '粘贴出差排期表格或备忘，由大模型进行往返常识推理并聚类各轮 Trip 区间',
        hintTitle: '出差排期表格粘贴与 Trip 规划',
        hintText: '请在下方粘贴包含出行日期、目标城市、拜访客户据点、住宿酒店的排期文本或表格。AI 将以此作为权威客观依据，自动切分出差轮次并按 Trip 进行费用归集。',
        actionText: '📋 复制排期整理 Prompt',
        actionId: 'yn-gemini-skill-btn-copy-template',
        promptTemplate: () => `请帮我解析以下出差日程，识别各轮往返 Trip 并将费用归集：\n`
    },
    {
        id: 'proxy',
        command: '/proxy',
        name: '代外驻报销批量格式化',
        icon: '👥',
        summary: '设置外驻社员、项目号并批量更新规范费用说明',
        hintTitle: '代外驻报销参数设置',
        hintText: '请输入外驻社员姓名与项目编号（如：成勇 外驻深圳 X2605-001），系统将自动更新规范费用说明：[外驻:社员] 项目号 事由。',
        promptTemplate: (count, prj, emp) => `请设置代外驻报销：\n项目号：${prj || 'X2605-001'}\n外驻社员：${emp || '外驻社员'}\n事由：现场技术支援\n请应用到所选 ${count} 笔费用`
    },
    {
        id: 'audit',
        command: '/audit',
        name: '费用合规体检与自愈',
        icon: '🔍',
        summary: '体检已选费用记录，排查超标说明缺失、必填字段残缺与跨期开票风险',
        hintTitle: '费用记录合规体检',
        hintText: '自动审计已选费用的必填项完整度、住宿费超标说明、开票日期异常度，并生成体检报告与自愈建议。',
        promptTemplate: (count) => `请对所选 ${count} 笔费用记录进行合规体检，排查缺失必填项与超标风险。`
    },
    {
        id: 'template',
        command: '/template',
        name: '复制排期整理 Prompt',
        icon: '📄',
        summary: '复制标准 Markdown 出差日程表格整理 Prompt 模板到剪贴板',
        hintTitle: '标准出差排期 Prompt 模板',
        hintText: '已准备好用于将复杂非结构化日程整理为标准表格的提示词。点击下方按钮可直接复制到剪贴板。',
        actionText: '📋 复制 Prompt 模板',
        actionId: 'yn-gemini-skill-btn-copy-template',
        promptTemplate: () => `请帮我将原始行程整理为标准 Markdown 排期表格。`
    }
];

export interface BatchEditExpenseModalState {
    groups: ExpenseRecordGroup[];
    selectedRecordIds: Set<string>; // 唯一费用记录ID
    sortKey: string; // 任意 ColumnDef 的 key
    sortAsc: boolean;
    searchQuery: string;
    filterMode: 'ALL' | 'WARN' | 'MISSING_REQUIRED' | 'OK' | 'SAVE_ERROR';
    saveErrors: Map<string, string>; // expenseRecordId -> 错误具体原因说明

    // 分组展示与折叠
    groupingMode: GroupingMode;
    collapsedGroupKeys: Set<string>;
    tripPlans: TripApplicationConfig[];
    tripBillCodes: Record<string, string>; // tripId -> 生成的草稿单号，如 'trip_1' -> 'SC26090025'
    autopilotCommandText: string;

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

    // 页面交互面板状态
    batchSettingsDialogOpen: boolean;
    batchSettingsPanelOpen: boolean;
    aiPanelOpen: boolean;
    aiFeedMessages: Array<{ type: 'success' | 'info' | 'warn'; text: string; time: string }>;

    // 连续多轮对话与 Gemini 复合输入卡片 (Screenshot 3 & 4)
    chatSessions: ChatSession[];
    currentSessionId: string;
    currentAttachments: ChatAttachment[];
    attachedExpenseContextEnabled: boolean;
    selectedModel: 'flash' | 'pro' | 'flash_lite';
    historyMenuOpen: boolean;
    previewImageUrl: string | null;
    aiPanelWidth: number;

    // AI 技能体系与 Slash Command 指令集
    activeSkillId: string | null;
    skillMenuOpen: boolean;
    slashMenuOpen: boolean;
    slashQuery: string;
    slashSelectedIndex: number;
    isAssistantExecuting: boolean;
}

const initialSessions = loadChatSessionsFromStorage();

let modalState: BatchEditExpenseModalState = {
    groups: [],
    selectedRecordIds: new Set(),
    sortKey: 'earliestInvoiceDate',
    sortAsc: true,
    searchQuery: '',
    filterMode: 'ALL',
    saveErrors: new Map(),

    groupingMode: 'TRIP',
    collapsedGroupKeys: new Set(),
    tripPlans: [],
    tripBillCodes: {},
    autopilotCommandText: '',

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
    formatTemplate: '[${project}]-[${remark}]',
    batchBusinessDate: '',
    syncBusinessDate: true,
    fillAddresses: true,
    lastSelectedRecordId: null,

    batchSettingsDialogOpen: false,
    batchSettingsPanelOpen: false,
    aiPanelOpen: false,
    aiFeedMessages: [],

    chatSessions: initialSessions,
    currentSessionId: initialSessions[0]?.id || 'session_init',
    currentAttachments: [],
    attachedExpenseContextEnabled: true,
    selectedModel: 'flash',
    historyMenuOpen: false,
    previewImageUrl: null,
    aiPanelWidth: (typeof localStorage !== 'undefined' && Number(localStorage.getItem('yn_fssc_ai_panel_width'))) || 440,

    activeSkillId: null,
    skillMenuOpen: false,
    slashMenuOpen: false,
    slashQuery: '',
    slashSelectedIndex: 0,
    isAssistantExecuting: false
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

    const tpl = state.formatTemplate;
    if (tpl && tpl.includes('${')) {
        let res = tpl
            .replace(/\${employee}/g, employee)
            .replace(/\${当前社员名}/g, employee)
            .replace(/\${社员名}/g, employee)
            .replace(/\${社员}/g, employee)
            .replace(/\${name}/g, name || '姓名')
            .replace(/\${人名}/g, name || '姓名')
            .replace(/\${外驻人名}/g, name || '姓名')
            .replace(/\${project}/g, project || '项目号')
            .replace(/\${项目名}/g, project || '项目号')
            .replace(/\${项目号}/g, project || '项目号')
            .replace(/\${项目}/g, project || '项目号')
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

    let base = '';
    if (state.isProxy) {
        const proxyName = name || '姓名';
        const proj = project || '项目号';
        base = `[外驻:${proxyName}]-[${proj}]`;
    } else {
        const proj = project || '项目号';
        base = `[${proj}]`;
    }

    if (remark) {
        base += `-[${remark}]`;
    }
    return base;
}

/**
 * 打开批量修改费用信息模态框
 */
export async function openBatchEditExpenseModal(doc: Document, preselectedIds?: string[]) {
    const globalState = getInvoicePoolGlobalState();
    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    const targetDoc = (typeof window !== 'undefined' && window.top && window.top.document) ? window.top.document : doc;

    if (!targetDoc.getElementById('yn-injected-styles')) {
        const styleEl = targetDoc.createElement('style');
        styleEl.id = 'yn-injected-styles';
        styleEl.innerHTML = MODAL_STYLES;
        (targetDoc.head || targetDoc.body).appendChild(styleEl);
    }

    // 恢复本地暂存的 Trip 规划信息
    if (modalState.tripPlans.length === 0) {
        const cachedTrips = loadTripPlansFromStorage();
        if (cachedTrips && cachedTrips.length > 0) {
            modalState.tripPlans = cachedTrips;
            AutopilotLogger.info(`[BatchEditModal] 成功恢复本地暂存的 ${cachedTrips.length} 轮 Trip 规划`);
        }
    }

    // Google Pattern 1: 将当前上下文下的 Trip 聚类注册至全局 Tool Layer
    batchEditTools.clusterTrips = async (params) => {
        clusterExpensesIntoTrips(
            params.groups || modalState.groups,
            modalState.proxyPersonName || modalState.currentEmployeeName,
            modalState.projectName
        );
        return { success: true, data: { trips: modalState.tripPlans } };
    };

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
        modalState.saveErrors = new Map();
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

        // 7. 初始自动执行时空锚点智能聚类 (将费用按出差 Trip 轮次与日常经费分类)
        try {
            clusterExpensesIntoTrips(
                modalState.groups,
                modalState.proxyPersonName || modalState.currentEmployeeName,
                modalState.projectName
            );
        } catch (e: any) {
            AutopilotLogger.warn(`[BatchEditModal] 初始 Trip 聚类跳过: ${e?.message || e}`);
        }

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
    if (aiPanelRoot) {
        try {
            aiPanelRoot.unmount();
        } catch (e) { }
        aiPanelRoot = null;
        aiPanelMountedEl = null;
    }
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
        // 1. 预警、待补必填项与保存失败项过滤
        if (state.filterMode === 'SAVE_ERROR' && (!state.saveErrors || !state.saveErrors.has(g.expenseRecordId))) return false;
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
 * 渲染分组展示结构元数据
 */
export interface GroupRenderSection {
    key: string;
    title: string;
    flow: 'BC' | 'BJ' | 'MIXED';
    flowTag: string;
    items: ExpenseRecordGroup[];
    totalAmount: number;
    totalInvoices: number;
    tripConfig?: TripApplicationConfig;
    draftBillCode?: string;
}

/**
 * 提取发票/费用记录的时空锚点日期
 */
function extractGroupDates(g: ExpenseRecordGroup): string[] {
    const dates: string[] = [];
    const addDate = (d?: string) => {
        if (!d) return;
        const clean = d.split(' ')[0].split('T')[0].trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
            dates.push(clean);
        }
    };

    addDate(g.newBusinessDate);
    addDate(g.businessDate);
    addDate(g.earliestInvoiceDate);
    if (g.dynamicFields) {
        addDate(g.dynamicFields.checkInDate);
        addDate(g.dynamicFields.checkOutDate);
        addDate(g.dynamicFields.dynStartDate);
        addDate(g.dynamicFields.dynEndDate);
    }
    for (const inv of g.invoices) {
        addDate(inv.departureDate);
        addDate(inv.invoiceDate);
        if (inv.departureTime) addDate(inv.departureTime.split(' ')[0]);
        if (inv.timeGetOn) addDate(inv.timeGetOn.split(' ')[0]);
    }
    return Array.from(new Set(dates)).sort();
}

/**
 * 时空锚点聚类算法：将费用记录按出差行程 (Trip 1..N) 与日常经费 (BJ) 智能切分
 * 严格遵循 AGENTS.md 反硬编码铁律，完全基于动态时空连续性与原生发票字段推断
 */
export function clusterExpensesIntoTrips(
    groups: ExpenseRecordGroup[],
    applicantName: string = '',
    projectName: string = '',
    customTrips?: DynamicTripInput[]
): TripApplicationConfig[] {
    if (!groups || groups.length === 0) {
        modalState.tripPlans = [];
        return [];
    }

    // 1. 将费用区分为差旅候选 (BC) 与日常经费 (BJ)
    const bcGroups: ExpenseRecordGroup[] = [];
    const bjGroups: ExpenseRecordGroup[] = [];

    for (const g of groups) {
        const flow = getGroupBillFlow(g);
        if (flow === 'BC') {
            bcGroups.push(g);
        } else {
            bjGroups.push(g);
        }
    }

    // 2. 为日常经费打标
    for (const g of bjGroups) {
        g.tripId = 'NON_TRIP';
        g.tripNo = 0;
        g.tripName = '日常办公与市内经费 (走经费报销单·BJ)';
    }

    if (bcGroups.length === 0) {
        modalState.tripPlans = [];
        return [];
    }

    // 2.1 若传入了用户权威排期出差波次 (customTrips)，直接以此为客观基准进行精准时空归集与预算推演
    if (customTrips && customTrips.length > 0) {
        const sortedTrips = [...customTrips].sort((a, b) => a.startDate.localeCompare(b.startDate));
        sortedTrips.forEach((t, idx) => {
            t.tripNo = idx + 1;
        });

        interface CustomTripStats {
            config: TripApplicationConfig;
            trafficFee: number;
            hotelFee: number;
            taxiInTrip: number;
        }

        const statsList: CustomTripStats[] = sortedTrips.map(ct => {
            const tripNo = ct.tripNo || 1;
            const tripId = `trip_${tripNo}`;
            const { days, nights } = calculateDaysAndNights(ct.startDate, ct.endDate);
            const destination = (ct.destination || '出差地').replace(/省|市/g, '');
            const legs: TripLeg[] = ct.legs && ct.legs.length > 0 ? ct.legs : [
                { date: ct.startDate, fromCity: '出发地', toCity: destination, transport: ct.flightOrTrain || '飞机/高铁' },
                { date: ct.endDate, fromCity: destination, toCity: '返回地', transport: ct.flightOrTrain || '飞机/高铁' }
            ];

            return {
                config: {
                    id: tripId,
                    tripNo,
                    applicantName: ct.applicantName || applicantName || modalState.currentEmployeeName || '当前社员',
                    isProxy: Boolean(modalState.isProxy),
                    startDate: ct.startDate,
                    endDate: ct.endDate,
                    days,
                    nights,
                    destination,
                    hotelName: ct.hotelName || '',
                    purpose: ct.purpose || `出差${destination}业务交流及现场技术支持`,
                    trafficFee: 0,
                    hotelFee: 0,
                    mealFee: 0,
                    otherFee: 0,
                    trafficBuffer: 0,
                    totalAmount: 0,
                    legs,
                    projectName: projectName || modalState.projectName,
                    status: '就绪'
                },
                trafficFee: 0,
                hotelFee: 0,
                taxiInTrip: 0
            };
        });

        // 遍历差旅记录匹配最优 Trip
        for (const g of bcGroups) {
            const dates = extractGroupDates(g);
            const gDate = dates.length > 0 ? dates[0] : (g.businessDate || g.earliestInvoiceDate || '');

            let bestIdx = -1;
            let highestScore = -1;

            for (let i = 0; i < statsList.length; i++) {
                const { config } = statsList[i];
                let score = 0;

                // 日期匹配 (容差前后 1 天)
                if (gDate) {
                    const sTime = new Date(config.startDate.replace(/-/g, '/')).getTime() - 24 * 3600 * 1000;
                    const eTime = new Date(config.endDate.replace(/-/g, '/')).getTime() + 24 * 3600 * 1000;
                    const gTime = new Date(gDate.replace(/-/g, '/')).getTime();
                    if (gTime >= sTime && gTime <= eTime) {
                        score += 10;
                        const strictS = new Date(config.startDate.replace(/-/g, '/')).getTime();
                        const strictE = new Date(config.endDate.replace(/-/g, '/')).getTime();
                        if (gTime >= strictS && gTime <= strictE) {
                            score += 5;
                        }
                    }
                }

                // 地点与酒店匹配加分
                const gDest = (g.dynamicFields?.city || g.dynamicFields?.dynTo || '').replace(/省|市/g, '').trim();
                if (gDest && (config.destination.includes(gDest) || gDest.includes(config.destination))) {
                    score += 20;
                }
                const gHotel = (g.dynamicFields?.hotelName || '').trim();
                if (gHotel && config.hotelName && (config.hotelName.includes(gHotel) || gHotel.includes(config.hotelName))) {
                    score += 15;
                }

                if (score > highestScore && score > 0) {
                    highestScore = score;
                    bestIdx = i;
                }
            }

            if (bestIdx !== -1) {
                const targetStat = statsList[bestIdx];
                const amt = Number(g.expenseAmount || 0);
                const cat = detectTypeCategory(g.newExpenseTypeId || g.expenseTypeId, g.newExpenseTypeName || g.expenseTypeName);
                if (cat === 'FLIGHT' || cat === 'TRAIN') {
                    targetStat.trafficFee += amt;
                } else if (cat === 'HOTEL') {
                    targetStat.hotelFee += amt;
                } else if (cat === 'TAXI') {
                    targetStat.taxiInTrip += amt;
                } else {
                    targetStat.trafficFee += amt;
                }

                g.tripId = targetStat.config.id;
                g.tripNo = targetStat.config.tripNo;
                g.tripName = `【Trip ${targetStat.config.tripNo}】${targetStat.config.destination}出差 (${targetStat.config.startDate} ~ ${targetStat.config.endDate})`;
            } else {
                g.tripId = 'NON_TRIP';
                g.tripNo = 0;
                g.tripName = '日常办公与市内经费 (走经费报销单·BJ)';
            }
        }

        const tripConfigs: TripApplicationConfig[] = statsList.map(st => {
            const { config, trafficFee, hotelFee, taxiInTrip } = st;
            config.trafficFee = Math.round(trafficFee * 100) / 100;
            config.hotelFee = Math.round(hotelFee * 100) / 100;
            config.mealFee = computeMealAllowance(config.days, 300, 150);
            config.otherFee = config.days * 100 + Math.round(taxiInTrip);
            config.trafficBuffer = Math.round(config.trafficFee * 0.15);
            config.totalAmount = Math.round((config.trafficFee + config.hotelFee + config.mealFee + config.otherFee + config.trafficBuffer) * 100) / 100;
            return config;
        });

        const tripIntervals = tripConfigs.map(t => ({ tripNo: t.tripNo, destination: t.destination, start: t.startDate, end: t.endDate }));
        for (const g of groups) {
            checkTaxiMisclassification(g, tripIntervals);
        }

        modalState.tripPlans = tripConfigs;
        saveTripPlansToStorage(tripConfigs);
        return tripConfigs;
    }

    // 3. 收集每个差旅记录的日期与位置特征并按起始日期排序
    interface BcGroupMeta {
        group: ExpenseRecordGroup;
        minDate: string;
        maxDate: string;
        locations: string[];
    }

    const metaList: BcGroupMeta[] = bcGroups.map(g => {
        const dates = extractGroupDates(g);
        const minDate = dates.length > 0 ? dates[0] : (g.businessDate || g.earliestInvoiceDate || '2026-01-01');
        const maxDate = dates.length > 0 ? dates[dates.length - 1] : minDate;

        const locs: string[] = [];
        if (g.dynamicFields?.city) locs.push(g.dynamicFields.city);
        if (g.dynamicFields?.dynTo) locs.push(g.dynamicFields.dynTo);
        if (g.dynamicFields?.hotelName) locs.push(g.dynamicFields.hotelName);
        for (const inv of g.invoices) {
            if (inv.stationGetOff) locs.push(inv.stationGetOff);
            if (inv.salesName) locs.push(inv.salesName);
        }

        return {
            group: g,
            minDate,
            maxDate,
            locations: locs
        };
    });

    metaList.sort((a, b) => a.minDate.localeCompare(b.minDate));

    // 4. 按时间连续性聚类（时间间隙阈值 3 天，若超过则切分为下一轮 Trip）
    const clusters: BcGroupMeta[][] = [];
    let curCluster: BcGroupMeta[] = [metaList[0]];
    let curClusterMaxDate = metaList[0].maxDate;

    for (let i = 1; i < metaList.length; i++) {
        const item = metaList[i];
        const gapDays = (new Date(item.minDate).getTime() - new Date(curClusterMaxDate).getTime()) / (1000 * 60 * 60 * 24);

        if (gapDays <= 3) {
            curCluster.push(item);
            if (item.maxDate > curClusterMaxDate) {
                curClusterMaxDate = item.maxDate;
            }
        } else {
            clusters.push(curCluster);
            curCluster = [item];
            curClusterMaxDate = item.maxDate;
        }
    }
    if (curCluster.length > 0) {
        clusters.push(curCluster);
    }

    // 5. 将每个聚类构造为 TripApplicationConfig
    const tripConfigs: TripApplicationConfig[] = clusters.map((cluster, idx) => {
        const tripNo = idx + 1;
        const tripId = `trip_${tripNo}`;

        // 计算起止日期
        let sDate = cluster[0].minDate;
        let eDate = cluster[0].maxDate;
        for (const item of cluster) {
            if (item.minDate < sDate) sDate = item.minDate;
            if (item.maxDate > eDate) eDate = item.maxDate;
        }
        if (eDate < sDate) eDate = sDate;

        const { days, nights } = calculateDaysAndNights(sDate, eDate);

        // 提取目的地（从到达站、城市、酒店等动态提取，剔除通用停用词）
        const destCandidates: string[] = [];
        for (const item of cluster) {
            for (const loc of item.locations) {
                const clean = loc.replace(/(?:火车站|高铁站|东站|西站|南站|北站|站|国际机场|机场|市|宾馆|大酒店|酒店|分公司|办事处)/g, '').trim();
                if (clean && clean.length >= 2 && clean.length <= 8 && !destCandidates.includes(clean)) {
                    destCandidates.push(clean);
                }
            }
        }
        const destination = destCandidates.slice(0, 2).join('/') || '出差地';

        // 提取酒店名称
        let hotelSummary = '';
        for (const item of cluster) {
            const h = item.group.dynamicFields?.hotelName;
            if (h && !hotelSummary) hotelSummary = h;
            for (const inv of item.group.invoices) {
                if (inv.salesName && (inv.salesName.includes('酒店') || inv.salesName.includes('宾馆')) && !hotelSummary) {
                    hotelSummary = inv.salesName;
                }
            }
        }

        // 计算各项预算金额
        let trafficFee = 0;
        let hotelFee = 0;
        let taxiInTrip = 0;
        for (const item of cluster) {
            const amt = Number(item.group.expenseAmount || 0);
            const cat = detectTypeCategory(item.group.newExpenseTypeId || item.group.expenseTypeId, item.group.newExpenseTypeName || item.group.expenseTypeName);
            if (cat === 'FLIGHT' || cat === 'TRAIN') {
                trafficFee += amt;
            } else if (cat === 'HOTEL') {
                hotelFee += amt;
            } else if (cat === 'TAXI') {
                taxiInTrip += amt;
            } else {
                trafficFee += amt;
            }
        }

        trafficFee = Math.round(trafficFee * 100) / 100;
        hotelFee = Math.round(hotelFee * 100) / 100;
        const mealFee = computeMealAllowance(days, 300, 150);
        const otherFee = days * 100 + Math.round(taxiInTrip); // 包含每日市内交通 Buffer 与打车
        const trafficBuffer = Math.round(trafficFee * 0.15); // 15% 交通改签 Buffer
        const totalAmount = Math.round((trafficFee + hotelFee + mealFee + otherFee + trafficBuffer) * 100) / 100;

        // 构造行程区 Legs
        const legs: TripLeg[] = [];
        for (const item of cluster) {
            for (const inv of item.group.invoices) {
                if (inv.stationGetOn || inv.stationGetOff) {
                    const isFlight = (inv.invoiceType || '').includes('飞机') || (inv.salesName || '').includes('航空');
                    legs.push({
                        date: (inv.departureDate || item.minDate || sDate).split(' ')[0],
                        fromCity: inv.stationGetOn || '出发地',
                        toCity: inv.stationGetOff || destination,
                        transport: isFlight ? '飞机' : '火车',
                        flightOrTrain: inv.trainNo || item.group.dynamicFields?.dynTransitNo || ''
                    });
                }
            }
        }
        if (legs.length === 0) {
            legs.push({
                date: sDate,
                fromCity: '出发地',
                toCity: destination,
                transport: '火车/飞机'
            });
            legs.push({
                date: eDate,
                fromCity: destination,
                toCity: '返回地',
                transport: '火车/飞机'
            });
        }

        const appConfig: TripApplicationConfig = {
            id: tripId,
            tripNo,
            applicantName: applicantName || modalState.currentEmployeeName || '当前社员',
            isProxy: Boolean(modalState.isProxy),
            startDate: sDate,
            endDate: eDate,
            days,
            nights,
            destination,
            hotelName: hotelSummary,
            purpose: `出差${destination}业务交流及现场技术支持`,
            trafficFee,
            hotelFee,
            mealFee,
            otherFee,
            trafficBuffer,
            totalAmount,
            legs,
            projectName: projectName || modalState.projectName,
            status: '就绪'
        };

        // 绑定给该聚类的每一笔费用
        const tripTitle = `${destination}出差 (${sDate} ~ ${eDate})`;
        for (const item of cluster) {
            item.group.tripId = tripId;
            item.group.tripNo = tripNo;
            item.group.tripName = tripTitle;
        }

        return appConfig;
    });

    // 6. 出租车出差/市内错配智能检测
    const tripIntervals = tripConfigs.map(t => ({ tripNo: t.tripNo, destination: t.destination, start: t.startDate, end: t.endDate }));
    for (const g of groups) {
        checkTaxiMisclassification(g, tripIntervals);
    }

    modalState.tripPlans = tripConfigs;
    saveTripPlansToStorage(tripConfigs);
    return tripConfigs;
}

/**
 * 依据当前分组模式 (GroupingMode) 将筛选后的费用记录组织为可渲染的多级组结构
 */
export function groupFilteredExpenses(
    filteredGroups: ExpenseRecordGroup[],
    mode: GroupingMode,
    tripPlans: TripApplicationConfig[] = []
): GroupRenderSection[] {
    if (mode === 'NONE') {
        const sum = filteredGroups.reduce((acc, g) => acc + Number(g.expenseAmount || 0), 0);
        const invSum = filteredGroups.reduce((acc, g) => acc + g.invoices.length, 0);
        return [{
            key: 'ALL',
            title: '全部费用明细 (平铺展示)',
            flow: 'MIXED',
            flowTag: '[全量]',
            items: filteredGroups,
            totalAmount: sum,
            totalInvoices: invSum
        }];
    }

    if (mode === 'TRIP') {
        const sections: GroupRenderSection[] = [];
        // 1. 各 Trip 轮次
        for (const trip of tripPlans) {
            const items = filteredGroups.filter(g => g.tripId === trip.id);
            if (items.length > 0) {
                const sum = items.reduce((acc, g) => acc + Number(g.expenseAmount || 0), 0);
                const invCount = items.reduce((acc, g) => acc + g.invoices.length, 0);
                sections.push({
                    key: trip.id,
                    title: `Trip ${trip.tripNo}: 出差申请单 (SC) - ${trip.destination || '出差'} (${trip.startDate} ~ ${trip.endDate})`,
                    flow: 'BC',
                    flowTag: '[差旅·BC]',
                    items,
                    totalAmount: sum,
                    totalInvoices: invCount,
                    tripConfig: trip,
                    draftBillCode: modalState.tripBillCodes[trip.id]
                });
            }
        }
        // 2. 非出差 / 日常费用 (NON_TRIP)
        const nonTripItems = filteredGroups.filter(g => !g.tripId || g.tripId === 'NON_TRIP');
        if (nonTripItems.length > 0) {
            const sum = nonTripItems.reduce((acc, g) => acc + Number(g.expenseAmount || 0), 0);
            const invCount = nonTripItems.reduce((acc, g) => acc + g.invoices.length, 0);
            sections.push({
                key: 'NON_TRIP',
                title: '日常办公与市内交通 (走经费报销单·BJ)',
                flow: 'BJ',
                flowTag: '[经费·BJ]',
                items: nonTripItems,
                totalAmount: sum,
                totalInvoices: invCount,
                draftBillCode: modalState.tripBillCodes['NON_TRIP']
            });
        }
        return sections;
    }

    if (mode === 'TYPE') {
        const typeMap = new Map<string, ExpenseRecordGroup[]>();
        for (const g of filteredGroups) {
            const typeName = g.newExpenseTypeName || g.expenseTypeName || '未分类';
            if (!typeMap.has(typeName)) {
                typeMap.set(typeName, []);
            }
            typeMap.get(typeName)!.push(g);
        }
        const sections: GroupRenderSection[] = [];
        for (const [typeName, items] of typeMap.entries()) {
            const sum = items.reduce((acc, g) => acc + Number(g.expenseAmount || 0), 0);
            const invCount = items.reduce((acc, g) => acc + g.invoices.length, 0);
            const typeId = items[0].newExpenseTypeId || items[0].expenseTypeId;
            const flow = getExpenseBillFlow(typeId, typeName);
            sections.push({
                key: `type_${typeId || typeName}`,
                title: `${typeName}`,
                flow,
                flowTag: flow === 'BC' ? '[差旅·BC]' : '[经费·BJ]',
                items,
                totalAmount: sum,
                totalInvoices: invCount
            });
        }
        return sections;
    }

    if (mode === 'TRIP_AND_TYPE') {
        const sections: GroupRenderSection[] = [];
        const tripBuckets = new Map<string, ExpenseRecordGroup[]>();
        for (const g of filteredGroups) {
            const tId = g.tripId || 'NON_TRIP';
            if (!tripBuckets.has(tId)) tripBuckets.set(tId, []);
            tripBuckets.get(tId)!.push(g);
        }

        for (const [tId, tItems] of tripBuckets.entries()) {
            const trip = tripPlans.find(t => t.id === tId);
            const tripTitle = trip
                ? `Trip ${trip.tripNo}: ${trip.destination || '出差'} (${trip.startDate} ~ ${trip.endDate})`
                : '日常办公与市内经费 (BJ)';

            const typeBuckets = new Map<string, ExpenseRecordGroup[]>();
            for (const g of tItems) {
                const typeName = g.newExpenseTypeName || g.expenseTypeName || '未分类';
                if (!typeBuckets.has(typeName)) typeBuckets.set(typeName, []);
                typeBuckets.get(typeName)!.push(g);
            }

            for (const [typeName, items] of typeBuckets.entries()) {
                const sum = items.reduce((acc, g) => acc + Number(g.expenseAmount || 0), 0);
                const invCount = items.reduce((acc, g) => acc + g.invoices.length, 0);
                const typeId = items[0].newExpenseTypeId || items[0].expenseTypeId;
                const flow = getExpenseBillFlow(typeId, typeName);
                sections.push({
                    key: `${tId}__${typeId || typeName}`,
                    title: `【${tripTitle}】➔ ${typeName}`,
                    flow,
                    flowTag: flow === 'BC' ? '[差旅·BC]' : '[经费·BJ]',
                    items,
                    totalAmount: sum,
                    totalInvoices: invCount,
                    tripConfig: trip,
                    draftBillCode: trip ? modalState.tripBillCodes[trip.id] : modalState.tripBillCodes['NON_TRIP']
                });
            }
        }
        return sections;
    }

    return [];
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

    const saveError = modalState.saveErrors ? modalState.saveErrors.get(group.expenseRecordId) : undefined;
    const isSaveError = Boolean(saveError);
    const hasSaveErrorReason = isSaveError && Boolean(saveError?.includes('超标'));

    if (isOverStandardCol) {
        const detail = getHotelPricingDetail(group);
        if (isHotelOver || hasSaveErrorReason) {
            placeholderText = '超标必填 (自主填写或点击📋拷贝)';
            cellTitle = isSaveError
                ? `❌ 保存失败：${saveError}！超标说明为必填项，请自主输入理由，或点击右侧 📋 拷贝“费用说明”`
                : `⚠️ 住宿费已超标：${detail ? detail.formulaText : ''}！超标说明为必填项，请自主输入理由，或点击右侧 📋 拷贝“费用说明”`;
        } else {
            placeholderText = '未超标(选填)';
            cellTitle = detail
                ? `超标说明 · 系统测算未超标: ${detail.formulaText}`
                : '超标说明 · 系统测算未超标，无需填写';
        }
    }

    const saveErrorCellClass = (isSaveError && isOverStandardCol && (isHotelOver || hasSaveErrorReason || isEmpty)) ? 'has-save-error yn-bem-dyn-cell-empty' : '';
    const saveErrorInputClass = (isSaveError && isOverStandardCol && (isHotelOver || hasSaveErrorReason || isEmpty)) ? 'has-save-error' : '';

    return `
        <td class="yn-bem-group-cell yn-bem-cell-interactive ${catClass} ${warnClass} ${aiClass} ${saveErrorCellClass}"
            rowspan="${span}"
            title="${cellTitle}">
            <div class="yn-bem-dyn-cell-inner">
                <input type="${inputType}"
                       class="yn-bem-dyn-input ${isMono ? 'mono' : ''} ${isAiInferred ? 'is-ai-inferred' : ''} ${saveErrorInputClass}"
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
 * 渲染行程与明细微胶囊 (Linear/Vercel Capsule)
 * 智能聚合展示各类型关键行程要素：
 * - ✈️ 航班：起飞城市 ➔ 降落城市 (航班号)
 * - 🚆 火车：出发站 ➔ 到达站 (车次)
 * - 🚕 出租车：始发地 ➔ 目的地
 * - 🏨 酒店：酒店名 (城市 · 住离日)
 * - 📱 通信：通信账期
 * - 其他：销售方/服务商
 */
function getGroupRouteDetailsHtml(group: ExpenseRecordGroup): string {
    const dyn = group.dynamicFields || {};
    const inv0 = group.invoices[0];
    const cat = detectTypeCategory(group.newExpenseTypeId || group.expenseTypeId, group.newExpenseTypeName || group.expenseTypeName);

    if (cat === 'FLIGHT') {
        const from = dyn.flightFromCity || inv0?.stationGetOn || '';
        const to = dyn.flightToCity || inv0?.stationGetOff || '';
        const flightNo = dyn.flightNum || inv0?.trainNo || '';
        if (from || to) {
            return `
                <div class="yn-bem-route-capsule" title="${escapeHtml(from)} ➔ ${escapeHtml(to)}${flightNo ? ` (${flightNo})` : ''}">
                    <span class="route-icon">✈️</span>
                    <span class="route-point">${escapeHtml(from || '待补')}</span>
                    <span class="route-arrow">➔</span>
                    <span class="route-point">${escapeHtml(to || '待补')}</span>
                    ${flightNo ? `<span class="route-extra">${escapeHtml(flightNo)}</span>` : ''}
                </div>
            `;
        }
        return `<span class="yn-bem-route-capsule is-empty" data-recordid="${group.expenseRecordId}" style="cursor:pointer;" title="点击补充航线与起降城市">+ 补充航线</span>`;
    }

    if (cat === 'TRAIN') {
        const from = dyn.trainFromStation || inv0?.stationGetOn || '';
        const to = dyn.trainToStation || inv0?.stationGetOff || '';
        const trainNo = inv0?.trainNo || dyn.trainNum || '';
        if (from || to) {
            return `
                <div class="yn-bem-route-capsule" title="${escapeHtml(from)} ➔ ${escapeHtml(to)}${trainNo ? ` (${trainNo})` : ''}">
                    <span class="route-icon">🚆</span>
                    <span class="route-point">${escapeHtml(from || '待补')}</span>
                    <span class="route-arrow">➔</span>
                    <span class="route-point">${escapeHtml(to || '待补')}</span>
                    ${trainNo ? `<span class="route-extra">${escapeHtml(trainNo)}</span>` : ''}
                </div>
            `;
        }
        return `<span class="yn-bem-route-capsule is-empty" data-recordid="${group.expenseRecordId}" style="cursor:pointer;" title="点击补充车次与起止站">+ 补充车次</span>`;
    }

    if (cat === 'TAXI') {
        const from = group.newStartAddress || dyn.startAddress || inv0?.stationGetOn || '';
        const to = group.newEndAddress || dyn.endAddress || inv0?.stationGetOff || '';
        if (from || to) {
            return `
                <div class="yn-bem-route-capsule" title="${escapeHtml(from)} ➔ ${escapeHtml(to)}">
                    <span class="route-icon">🚕</span>
                    <span class="route-point" style="max-width:85px;">${escapeHtml(from || '待补')}</span>
                    <span class="route-arrow">➔</span>
                    <span class="route-point" style="max-width:85px;">${escapeHtml(to || '待补')}</span>
                </div>
            `;
        }
        return `<span class="yn-bem-route-capsule is-empty" data-recordid="${group.expenseRecordId}" style="cursor:pointer;" title="点击补充始发地/目的地">+ 补充始发/到达</span>`;
    }

    if (cat === 'HOTEL') {
        const hotel = dyn.hotelName || (inv0?.salesName ? inv0.salesName.replace(/有限(?:责任)?公司/g, '') : '');
        const city = dyn.city || '';
        const dates = dyn.checkInDate ? `${dyn.checkInDate.slice(5)}~${(dyn.checkOutDate || '').slice(5)}` : '';
        if (hotel || city) {
            return `
                <div class="yn-bem-route-capsule" title="${escapeHtml(hotel)} ${city ? `(${city})` : ''} ${dates}">
                    <span class="route-icon">🏨</span>
                    <span class="route-point" style="max-width:115px;">${escapeHtml(hotel || city)}</span>
                    ${city && hotel ? `<span class="route-extra">${escapeHtml(city)}</span>` : ''}
                    ${dates ? `<span class="route-extra" style="font-family:ui-monospace, monospace;">${escapeHtml(dates)}</span>` : ''}
                </div>
            `;
        }
        return `<span class="yn-bem-route-capsule is-empty" data-recordid="${group.expenseRecordId}" style="cursor:pointer;" title="点击补充酒店名与入住城市">+ 补充酒店/城市</span>`;
    }

    if (cat === 'MOBILE') {
        const billMonth = dyn.billMonth || (inv0?.invoiceDate ? inv0.invoiceDate.slice(0, 7) : '');
        return `
            <div class="yn-bem-route-capsule">
                <span class="route-icon">📱</span>
                <span class="route-extra">账期: ${escapeHtml(billMonth || '待补')}</span>
            </div>
        `;
    }

    const sales = inv0?.salesName || '';
    if (sales) {
        return `
            <div class="yn-bem-route-capsule" title="${escapeHtml(sales)}">
                <span class="route-icon">🧾</span>
                <span class="route-point" style="max-width:160px;">${escapeHtml(sales)}</span>
            </div>
        `;
    }

    return `<span style="color:#a3a3a3; font-size:11px;">-</span>`;
}

/**
 * 渲染现代悬浮操作岛 (Floating Action Island - Linear/Stripe Grade)
 * 选中行时在底部居中弹性展开，提供批量设置、AI推断、导出、保存与清选
 */
function renderFloatingIslandHtml(): string {
    const selectedCount = modalState.selectedRecordIds.size;
    const isHidden = selectedCount === 0;
    const selectedGroups = modalState.groups.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));
    const totalAmount = Decimal.sum(selectedGroups, g => g.expenseAmount).toFixed(2);

    return `
        <div class="yn-bem-floating-island ${isHidden ? 'is-hidden' : ''}" id="yn-bem-floating-island">
            <div class="yn-bem-island-stat">
                <span>已选 <strong>${selectedCount}</strong> 项</span>
                <span class="island-amount">¥${totalAmount}</span>
            </div>
            <div class="yn-bem-island-divider"></div>
            <button type="button" class="yn-bem-island-btn" id="yn-bem-island-btn-batch-settings" title="弹出批量修改属性窗口">
                ⚙️ 批量修改属性
            </button>
            <button type="button" class="yn-bem-island-btn yn-bem-island-btn-ai" id="yn-bem-island-btn-ai" title="基于证据链智能补全必填字段">
                ✨ AI智能推断
            </button>
            <button type="button" class="yn-bem-island-btn" id="yn-bem-island-btn-export" title="导出所选为 CSV">
                📥 导出
            </button>
            <button type="button" class="yn-bem-island-btn yn-bem-island-btn-primary" id="yn-bem-island-btn-save" title="批量保存已修改记录">
                💾 批量保存
            </button>
            <button type="button" class="yn-bem-island-btn" id="yn-bem-island-btn-clear" title="清空选中">
                ✕ 清选
            </button>
        </div>
    `;
}

/**
 * 渲染居中专注批量设置弹窗 (Dedicated Batch Settings Modal Dialog)
 * 彻底移出主 DOM 流，消除表格高度挤压；3 个逻辑卡片分区组织
 */
function renderBatchSettingsDialogHtml(): string {
    const selectedCount = modalState.selectedRecordIds.size;

    return `
        <div class="yn-bem-batch-dialog-mask" id="yn-bem-batch-dialog-mask">
            <div class="yn-bem-batch-dialog" id="yn-bem-batch-dialog">
                <div class="yn-bem-dialog-header">
                    <div class="yn-bem-dialog-title">
                        <span>⚙️ 批量修改属性 (${selectedCount > 0 ? `作用于已选 ${selectedCount} 笔费用` : '请先在表格勾选要修改的费用'})</span>
                    </div>
                    <button type="button" class="yn-bem-close-x" id="yn-bem-dialog-close" title="关闭">✕</button>
                </div>

                <div class="yn-bem-dialog-body">
                    <!-- 分区 1: 批量修改费用说明 (模块化独立可选) -->
                    <div class="yn-bem-dialog-section">
                        <div class="yn-bem-dialog-section-title" style="display:flex; align-items:center; justify-content:space-between;">
                            <label style="display:inline-flex; align-items:center; gap:6px; font-weight:600; font-size:13px; color:#18181b; cursor:pointer;">
                                <input type="checkbox" id="yn-bem-chk-apply-desc" checked style="cursor:pointer;" />
                                <span>📝 批量修改费用说明 (备注信息)</span>
                            </label>
                            <div class="yn-bem-preview-pill" id="yn-bem-preview-pill" style="max-width:320px;">
                                ${computeFormattedDescription(modalState, modalState.groups[0])}
                            </div>
                        </div>

                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:8px;">
                            <div class="yn-bem-field-group">
                                <label>报销类型:</label>
                                <select id="yn-bem-opt-proxy" class="yn-bem-select">
                                    <option value="false" ${!modalState.isProxy ? 'selected' : ''}>本人报销</option>
                                    <option value="true" ${modalState.isProxy ? 'selected' : ''}>外驻代报销</option>
                                </select>
                            </div>
                            <div class="yn-bem-field-group" id="yn-bem-group-proxy-name" style="${modalState.isProxy ? '' : 'display:none;'}">
                                <label>外驻人名:</label>
                                <input type="text" id="yn-bem-input-proxy-name" class="yn-bem-input"
                                       value="${escapeHtml(modalState.proxyPersonName)}" placeholder="如: 社员姓名" style="font-weight:600;" />
                            </div>
                        </div>

                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:8px;">
                            <div class="yn-bem-field-group">
                                <label>费用归属项目 (标记项目号):</label>
                                <div class="yn-bem-project-wrapper" id="yn-bem-project-wrapper">
                                    <input type="text" id="yn-bem-input-project" class="yn-bem-input"
                                           value="${escapeHtml(modalState.projectName)}" placeholder="搜索项目代码/名称..." style="width:100%; font-weight:600;" autocomplete="off" />
                                    <div id="yn-bem-project-dropdown" class="yn-bem-project-dropdown"></div>
                                </div>
                            </div>
                            <div class="yn-bem-field-group">
                                <label>更多备注 (可选后缀，为空不显):</label>
                                <input type="text" id="yn-bem-input-remark" class="yn-bem-input"
                                       value="${escapeHtml(modalState.customRemark)}" placeholder="如: 业务调研 (为空不显)" style="width:100%;" />
                            </div>
                        </div>

                        <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
                            <span style="font-size:11px; color:#737373;">快捷预设:</span>
                            <div class="yn-bem-segmented-wrap">
                                <button type="button" class="yn-bem-preset-btn ${modalState.formatTemplate === '[${project}]-[${remark}]' || modalState.formatTemplate === '[${project}]' ? 'active' : ''}" data-tpl="[\${project}]" title="本人报销: 仅项目">[仅项目]</button>
                                <button type="button" class="yn-bem-preset-btn ${modalState.formatTemplate === '[外驻:${name}]-[${project}]' ? 'active' : ''}" data-tpl="[外驻:\${name}]-[\${project}]" title="外驻代报销: [外驻:人名]-[项目]">[外驻:人名]-[项目]</button>
                                <button type="button" class="yn-bem-preset-btn ${modalState.formatTemplate === '[${employee}]-[${project}]' ? 'active' : ''}" data-tpl="[\${employee}]-[\${project}]" title="[社员名]-[项目]">[当前社员名]-[项目]</button>
                            </div>
                        </div>
                    </div>

                    <!-- 分区 2: 变更报销类型 (模块化独立可选) -->
                    <div class="yn-bem-dialog-section">
                        <div class="yn-bem-dialog-section-title">
                            <label style="display:inline-flex; align-items:center; gap:6px; font-weight:600; font-size:13px; color:#18181b; cursor:pointer;">
                                <input type="checkbox" id="yn-bem-chk-apply-type" style="cursor:pointer;" />
                                <span>🏷️ 变更报销类型与专属参数</span>
                            </label>
                        </div>
                        <div style="margin-top:8px;">
                            <div class="yn-bem-field-group">
                                <label>目标报销类型:</label>
                                <select id="yn-bem-opt-target-type" class="yn-bem-select" style="font-weight:600; color:#171717; width:100%;">
                                    <option value="">-- 保持原类型 (不变更) --</option>
                                    ${renderTypeTreeOptionsHtml(modalState.expenseTypeTree, modalState.targetExpenseTypeId)}
                                </select>
                            </div>
                        </div>

                        <!-- 专属必填字段批量输入卡片 (若有) -->
                        <div style="margin-top:8px;">
                            ${renderDynamicFieldsCardHtml()}
                        </div>
                    </div>

                    <!-- 分区 3: 业务日期与交通地址 (模块化独立可选) -->
                    <div class="yn-bem-dialog-section">
                        <div class="yn-bem-dialog-section-title">
                            <label style="display:inline-flex; align-items:center; gap:6px; font-weight:600; font-size:13px; color:#18181b; cursor:pointer;">
                                <input type="checkbox" id="yn-bem-chk-apply-date" style="cursor:pointer;" />
                                <span>📅 统一业务日期与交通地址</span>
                            </label>
                        </div>
                        <div style="display:flex; align-items:center; gap:16px; margin-top:8px;">
                            <div class="yn-bem-field-group">
                                <label>统一业务日期:</label>
                                <div style="display:flex; align-items:center; gap:6px;">
                                    <input type="date" id="yn-bem-input-biz-date" class="yn-bem-input"
                                           value="${modalState.batchBusinessDate}" style="width:130px; font-family:ui-monospace, monospace;" />
                                    <span class="yn-bem-quick-link" id="yn-bem-qa-sync-earliest-date" title="将已选费用的业务日期同步为其最早开票日">按最早开票日</span>
                                </div>
                            </div>
                            <label style="font-size:11px; color:#525252; cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin-top:14px;">
                                <input type="checkbox" id="yn-bem-chk-fill-addr" ${modalState.fillAddresses ? 'checked' : ''} />
                                补交通始发/到达地址
                            </label>
                        </div>
                    </div>
                </div>

                <div class="yn-bem-dialog-footer">
                    <button type="button" class="yn-bem-btn yn-bem-btn-secondary" id="yn-bem-dialog-cancel">取消</button>
                    <button type="button" class="yn-bem-btn yn-bem-btn-primary" id="yn-bem-dialog-apply">应用到已选 (${selectedCount} 笔)</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * 渲染精简双行顶部融合操作条 (Linear / Vercel 风格 44px + 34px)
 */
function renderTopBarHtml(filteredGroups: ExpenseRecordGroup[]): string {
    const totalGroups = modalState.groups.length;
    const warnCount = modalState.groups.filter(g => g.hasWarn).length;
    const missingRequiredCount = modalState.groups.filter(g => isGroupMissingRequired(g)).length;
    const saveErrorCount = modalState.saveErrors ? modalState.saveErrors.size : 0;
    const isAllCollapsed = modalState.collapsedGroupKeys.size > 0;

    return `
        <div class="yn-bem-top-bar" id="yn-bem-top-bar">
            <!-- 左侧：标题 + 分组 + 展开/折叠单按钮 + 选区快速操作 + 状态过滤 -->
            <div class="yn-bem-header-left">
                <span class="yn-bem-brand">
                    批量修改费用信息
                </span>
                ${warnCount > 0 ? `<span class="yn-bem-warn-indicator">⚠️ 检出 ${warnCount} 处差异</span>` : ''}

                <div class="yn-bem-field-group" style="align-items:center; gap:4px; margin-left:4px;">
                    <label style="font-size:11px; color:#525252; font-weight:600;">分组:</label>
                    <select id="yn-bem-opt-grouping" class="yn-bem-select" style="font-size:11px; padding:2px 6px; font-weight:600; color:#171717;">
                        <option value="TRIP" ${modalState.groupingMode === 'TRIP' ? 'selected' : ''}>按 Trip 轮次</option>
                        <option value="TYPE" ${modalState.groupingMode === 'TYPE' ? 'selected' : ''}>按费用类型</option>
                        <option value="TRIP_AND_TYPE" ${modalState.groupingMode === 'TRIP_AND_TYPE' ? 'selected' : ''}>Trip+类型两级</option>
                        <option value="NONE" ${modalState.groupingMode === 'NONE' ? 'selected' : ''}>平铺 (不分组)</option>
                    </select>
                    <button type="button" class="yn-bem-btn-mini" id="yn-bem-btn-toggle-all-groups"
                            title="点击展开或折叠所有分组" ${modalState.groupingMode === 'NONE' ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
                        ${isAllCollapsed ? '展开' : '折叠'}
                    </button>
                </div>

                <div class="yn-bem-quick-select-wrap" style="display:inline-flex; align-items:center; gap:6px; margin-left:6px; padding-left:8px; border-left:1px solid var(--coss-border);">
                    <span class="yn-bem-quick-link" id="yn-bem-qa-select-all">全选</span>
                    <span class="yn-bem-quick-link" id="yn-bem-qa-deselect">全不选</span>
                    <span class="yn-bem-quick-link" id="yn-bem-qa-invert">反选</span>
                    ${saveErrorCount > 0 ? `<span class="yn-bem-quick-link" id="yn-bem-qa-select-failed" style="color:#b91c1c; border-color:#fca5a5; background:#fef2f2; font-weight:700;">❌ 仅看失败 (${saveErrorCount})</span>` : ''}
                    ${missingRequiredCount > 0 ? `<span class="yn-bem-quick-link" id="yn-bem-qa-select-missing" style="color:#dc2626; border-color:#fee2e2; background:#fef2f2;">仅选待补 (${missingRequiredCount})</span>` : ''}
                    ${warnCount > 0 ? `<span class="yn-bem-quick-link" id="yn-bem-qa-select-warn" style="color:#b45309; border-color:#fef3c7; background:#fffbeb;">仅选预警 (${warnCount})</span>` : ''}

                    <select id="yn-bem-filter-mode" class="yn-bem-select" style="font-size:11px; padding:2px 6px; margin-left:2px;">
                        ${saveErrorCount > 0 ? `<option value="SAVE_ERROR" ${modalState.filterMode === 'SAVE_ERROR' ? 'selected' : ''}>❌ 保存失败 (${saveErrorCount})</option>` : ''}
                        <option value="ALL" ${modalState.filterMode === 'ALL' ? 'selected' : ''}>全部 (${totalGroups})</option>
                        <option value="MISSING_REQUIRED" ${modalState.filterMode === 'MISSING_REQUIRED' ? 'selected' : ''}>待补必填 (${missingRequiredCount})</option>
                        <option value="WARN" ${modalState.filterMode === 'WARN' ? 'selected' : ''}>预警 (${warnCount})</option>
                        <option value="OK" ${modalState.filterMode === 'OK' ? 'selected' : ''}>正常 (${totalGroups - warnCount - missingRequiredCount})</option>
                    </select>
                </div>

                <div id="yn-bem-active-filters-wrap" style="display:inline-flex; align-items:center; gap:4px; margin-left:4px;">
                    ${renderActiveFilterTagsHtml()}
                </div>
            </div>

            <!-- 中间：顶部居中搜索框 -->
            <div class="yn-bem-header-center">
                <input type="text" id="yn-bem-search" class="yn-bem-input yn-bem-search-center"
                       placeholder="搜索开票日/发票号/销方/说明..." value="${escapeHtml(modalState.searchQuery)}" />
            </div>

            <!-- 右侧：AI 助手切换 + 关闭 (全宽固定在顶栏最右侧) -->
            <div class="yn-bem-header-right">
                <button type="button" class="yn-bem-btn-toggle-ai ${modalState.aiPanelOpen ? 'is-active' : ''}" id="yn-bem-btn-toggle-ai" title="点击展开/收起 AI 智能助手">
                    <span class="yn-gemini-sparkle-icon">✦</span> AI 助手 ${modalState.aiPanelOpen ? '✕' : '✨'}
                </button>
                <button class="yn-bem-close-x" id="yn-bem-close-btn" title="关闭 (Esc)">✕</button>
            </div>
        </div>
    `;
}


/**
 * 渲染弹出式/抽屉式批量属性配置面板 (Batch Settings Dropdown Panel)
 */
function renderBatchSettingsPanelHtml(): string {
    return `
        <div class="yn-bem-batch-settings-panel" id="yn-bem-batch-settings-panel">
            <div class="yn-bem-settings-header">
                <span>⚙️ 批量属性快速配置 (修改后请点击右侧「应用到已选」生效)</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:11px; color:#737373;">费用说明实时预览:</span>
                    <div class="yn-bem-preview-pill" id="yn-bem-preview-pill">
                        ${computeFormattedDescription(modalState, modalState.groups[0])}
                    </div>
                </div>
            </div>

            <!-- 参数设置行 1: 出差 / 报销 / 外驻人名 / 项目 / 变更类型 / 备注 / 业务日期 -->
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
                               value="${modalState.projectName}" placeholder="搜索项目代码/名称..." style="width:140px; font-weight:600;" autocomplete="off" />
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
                           value="${modalState.customRemark}" placeholder="为空不显" style="width:100px;" />
                </div>

                <div class="yn-bem-field-group">
                    <label>批量业务日期:</label>
                    <input type="date" id="yn-bem-input-biz-date" class="yn-bem-input"
                           value="${modalState.batchBusinessDate}" style="width:125px; font-family:ui-monospace, monospace;" />
                    <span class="yn-bem-quick-link" id="yn-bem-qa-sync-earliest-date" title="将已选费用的业务日期同步为其最早开票日">按最早开票日</span>
                </div>
            </div>

            <!-- 参数设置行 2: 格式预设 (含外驻代报销格式) + 补交通地址 + 应用按钮 -->
            <div class="yn-bem-bar-row" style="border-top:1px solid #f0f0f0; padding-top:8px;">
                <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:320px;">
                    <span style="font-size:11px; color:#737373; font-weight:500;">格式预设:</span>
                    <div class="yn-bem-segmented-wrap">
                        <button type="button" class="yn-bem-preset-btn ${modalState.formatTemplate === '[\${employee}]-[\${project}]-[\${remark}]' ? 'active' : ''}" data-tpl="[\${employee}]-[\${project}]-[\${remark}]" title="使用 [当前社员名]-[项目号]-[备注]">[当前社员名]-[项目号]</button>
                        <button type="button" class="yn-bem-preset-btn ${modalState.formatTemplate === '[${project}]-[${remark}]' ? 'active' : ''}" data-tpl="[\${project}]-[\${remark}]" title="使用 [项目]-[备注]">[仅项目]</button>
                        <button type="button" class="yn-bem-preset-btn ${modalState.formatTemplate === '[外驻:\${name}] \${project} \${remark}' ? 'active' : ''}" data-tpl="[外驻:\${name}] \${project} \${remark}" title="使用 [外驻:人名] 项目 备注 (代外驻报销专用)">[外驻:人名] 项目 备注</button>
                    </div>

                    <input type="text" id="yn-bem-input-template" class="yn-bem-input"
                           value="${modalState.formatTemplate}" style="width:230px; font-family:ui-monospace, monospace; font-size:11px;"
                           title="支持模板变量: \${employee}当前社员名, \${name}外驻人名, \${project}项目, \${remark}自定义备注" />

                    <label style="font-size:11px; color:#525252; cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin-left:8px;">
                        <input type="checkbox" id="yn-bem-chk-fill-addr" ${modalState.fillAddresses ? 'checked' : ''} />
                        补交通始发/到达
                    </label>
                </div>

                <div style="display:flex; gap:8px; align-items:center; margin-left:auto;">
                    <button class="yn-bem-btn-ai" id="yn-bem-btn-ai-infer" title="基于发票证据链智能补全必填字段">
                        ✨ AI 智能推断
                    </button>
                    <button class="yn-bem-btn yn-bem-btn-apply" id="yn-bem-btn-apply">
                        应用到已选 (预览更新)
                    </button>
                </div>
            </div>

            <!-- 专属动态必填字段批量输入卡片 -->
            ${renderDynamicFieldsCardHtml()}
        </div>
    `;
}

let aiPanelRoot: Root | null = null;
let aiPanelMountedEl: HTMLElement | null = null;

/**
 * 挂载并渲染 assistant-ui 智能副驾 React 面板
 */
function renderAssistantChat(container: HTMLElement) {
    const rootEl = container.querySelector<HTMLElement>('#yn-bem-ai-panel-react-root');
    if (!rootEl) return;

    if (!aiPanelRoot || aiPanelMountedEl !== rootEl) {
        if (aiPanelRoot) {
            try {
                aiPanelRoot.unmount();
            } catch (e) { }
        }
        aiPanelRoot = createRoot(rootEl);
        aiPanelMountedEl = rootEl;
    }

    const selectedCount = modalState.selectedRecordIds.size;
    const selectedGroups = modalState.groups.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));
    const totalAmountDecimal = Decimal.sum(selectedGroups, g => g.expenseAmount);

    aiPanelRoot.render(
        React.createElement(AssistantChatPanel, {
            sessions: modalState.chatSessions,
            currentSessionId: modalState.currentSessionId,
            onSelectSession: (id: string) => {
                modalState.currentSessionId = id;
                renderAssistantChat(container);
            },
            onNewSession: () => {
                const newSession: ChatSession = {
                    id: `session_${Date.now()}`,
                    title: '新对话',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    messages: []
                };
                modalState.chatSessions.unshift(newSession);
                modalState.currentSessionId = newSession.id;
                modalState.activeSkillId = null;
                saveChatSessionsToStorage(modalState.chatSessions);
                renderAssistantChat(container);
                showToast('success', '已开启全新对话');
            },
            onDeleteSession: (delId: string) => {
                modalState.chatSessions = modalState.chatSessions.filter(s => s.id !== delId);
                if (modalState.chatSessions.length === 0) {
                    const fresh: ChatSession = {
                        id: `session_${Date.now()}`,
                        title: 'Trip 智能规划与对账分析',
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        messages: []
                    };
                    modalState.chatSessions.push(fresh);
                    modalState.currentSessionId = fresh.id;
                } else if (modalState.currentSessionId === delId) {
                    modalState.currentSessionId = modalState.chatSessions[0].id;
                }
                saveChatSessionsToStorage(modalState.chatSessions);
                renderAssistantChat(container);
            },
            onSendMessage: (text: string, attachments: ChatAttachment[]) => {
                handleAssistantSendMessage(container, text, attachments);
            },
            onApplySkill: (skillId: string) => {
                const skill = AI_SKILLS.find(s => s.id === skillId);
                if (!skill) return;
                if (skill.id === 'template') {
                    copyFallback(ITINERARY_PROMPT_TEMPLATE);
                    return;
                }
                modalState.activeSkillId = skill.id;
                renderAssistantChat(container);
            },
            onSuggestionClick: (key) => {
                if (key === 'infer') {
                    openAiAssistantWithSkill(container, 'infer');
                } else if (key === 'itinerary') {
                    openAiAssistantWithSkill(container, 'itinerary');
                } else if (key === 'autopilot-plan') {
                    runAutopilotPlan(container);
                } else if (key === 'dashboard') {
                    if (modalState.tripPlans.length === 0) {
                        clusterExpensesIntoTrips(
                            modalState.groups,
                            modalState.proxyPersonName || modalState.currentEmployeeName,
                            modalState.projectName
                        );
                    }
                    openAutopilotDecisionDashboard(container);
                }
            },
            selectedExpenseCount: selectedCount,
            selectedExpenseAmount: totalAmountDecimal.toNumber(),
            attachedExpenseContextEnabled: modalState.attachedExpenseContextEnabled,
            onToggleExpenseContext: (enabled: boolean) => {
                modalState.attachedExpenseContextEnabled = enabled;
                renderAssistantChat(container);
            },
            employeeName: modalState.currentEmployeeName || detectCurrentEmployeeName(),
            isExecuting: modalState.isAssistantExecuting,
            onClose: () => {
                closeAiPanel(container);
            },
            skills: AI_SKILLS,
            activeSkillId: modalState.activeSkillId,
            onDismissSkill: () => {
                modalState.activeSkillId = null;
                renderAssistantChat(container);
            },
            onCopyPromptTemplate: () => {
                copyFallback(ITINERARY_PROMPT_TEMPLATE);
            },
            selectedModel: modalState.selectedModel,
            onSelectModel: (model: string) => {
                modalState.selectedModel = model as any;
                renderAssistantChat(container);
            }
        })
    );
}

/**
 * 局部刷新 AI 侧边栏
 */
function refreshAiPanel(container: HTMLElement) {
    if (modalState.aiPanelOpen) {
        renderAssistantChat(container);
    }
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
 * 渲染单笔费用记录（含发票明细行）的 HTML 结构
 */
function renderGroupRowsHtml(group: ExpenseRecordGroup): string {
    const isSelected = modalState.selectedRecordIds.has(group.expenseRecordId);
    const isDescChanged = group.newDescription !== undefined && group.newDescription !== group.description;
    const isDateChanged = group.newBusinessDate !== undefined && group.newBusinessDate !== group.businessDate;
    const isTypeChanged = Boolean(group.newExpenseTypeId && group.newExpenseTypeId !== group.expenseTypeId);
    const isAiDateInferred = Boolean(group.inferredFields?.['businessDate']);
    const flow = getGroupBillFlow(group);

    const saveError = modalState.saveErrors ? modalState.saveErrors.get(group.expenseRecordId) : undefined;
    const isSaveError = Boolean(saveError);

    // 智能错配检测
    const tripIntervals = modalState.tripPlans.map(t => ({ tripNo: t.tripNo, destination: t.destination, start: t.startDate, end: t.endDate }));
    const misclass = checkTaxiMisclassification(group, tripIntervals);
    let misclassHtml = '';
    if (misclass.hasMisclass) {
        const isToTripTaxi = misclass.suggestedTypeId === '0356c4cef03345af7f1906ec05cc0000';
        misclassHtml = `<button type="button" class="yn-bem-type-misclass-bulb" data-recordid="${group.expenseRecordId}" data-target-type="${isToTripTaxi ? 'TRIP_TAXI' : 'CITY_TAXI'}" title="${misclass.reason || ''}">💡转${misclass.suggestedTypeName || '相应类型'}</button>`;
    }

    // FULL 模式：35列多行结构 (永久固定)
    const invList = group.invoices;
    const span = Math.max(1, invList.length);
    const inv0 = invList[0];

    let rowsHtml = `
        <tr class="${isSelected ? 'is-selected' : ''} ${isSaveError ? 'is-save-error' : ''} yn-bem-group-first yn-bem-data-row" data-recordid="${group.expenseRecordId}">
            <!-- 费用主体聚合列 1: 复选框 -->
            <td class="yn-bem-col-sticky-cb yn-bem-group-cell" rowspan="${span}">
                <input type="checkbox" class="yn-bem-record-cb" data-recordid="${group.expenseRecordId}" ${isSelected ? 'checked' : ''} />
                ${isSaveError ? `<span class="yn-bem-save-error-badge" title="${escapeHtml(saveError || '')}">❌ 失败</span>` : ''}
            </td>

            <!-- 费用主体聚合列 2: 最早开票日 -->
            <td class="yn-bem-col-sticky-date yn-bem-group-cell" rowspan="${span}">
                <span>${group.earliestInvoiceDate || '<span style="color:#a3a3a3;">-</span>'}</span>
            </td>

            <!-- 费用主体聚合列 3: 业务日期 (就地直接修改，100% 满高贴合) -->
            <td class="yn-bem-group-cell yn-bem-cell-interactive ${isAiDateInferred ? 'yn-bem-cell-ai-date' : ''}" rowspan="${span}">
                <div class="yn-bem-dyn-cell-inner">
                    <input type="date" class="yn-bem-cell-date-input ${isAiDateInferred ? 'is-ai-inferred' : (isDateChanged ? 'has-changed' : '')}"
                           data-recordid="${group.expenseRecordId}"
                           value="${group.newBusinessDate || group.businessDate || ''}"
                           title="${isAiDateInferred ? `✨ AI已自动同步为实际入住日期 (原开票日: ${group.businessDate})` : (isDateChanged ? `业务日期已修改 (原业务日期: ${group.businessDate})` : '点击直接修改业务日期')}" />
                    ${isAiDateInferred ? `<span class="yn-bem-ai-sparkle-dot" title="✨ AI已自动同步为实际入住日 (原开票日: ${group.businessDate})">✨</span>` : ''}
                </div>
            </td>

            <!-- 费用主体聚合列 4: 费用类型 (就地直接修改下拉 + 专属字段微按钮 + 流向 Tag + 错配纠错) -->
            <td class="yn-bem-group-cell yn-bem-cell-interactive" rowspan="${span}">
                <div class="yn-bem-cell-type-wrapper">
                    <div style="display:flex; align-items:center; gap:4px;">
                        <select class="yn-bem-cell-type-select ${isTypeChanged ? 'has-type-changed' : ''}"
                                data-recordid="${group.expenseRecordId}"
                                title="点击直接修改此笔费用的报销类型">
                            ${renderTypeTreeOptionsHtml(modalState.expenseTypeTree, group.newExpenseTypeId || group.expenseTypeId)}
                        </select>
                        <span class="yn-bem-tag-${flow.toLowerCase()}" style="font-size:10px; padding:1px 4px; border-radius:3px; white-space:nowrap;">
                            ${flow === 'BC' ? '差旅·BC' : '经费·BJ'}
                        </span>
                        <button type="button" class="yn-bem-btn-mini yn-bem-cell-dyn-trigger" data-recordid="${group.expenseRecordId}" title="弹窗精细调整该行专属字段" style="padding:1px 4px; font-size:10px;">
                            ⚙
                        </button>
                    </div>
                    ${misclassHtml}
                </div>
            </td>

            <!-- 费用主体聚合列 5: 费用金额 (等宽靠右) -->
            <td class="yn-bem-group-cell" rowspan="${span}" style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-variant-numeric:tabular-nums; font-weight:600; color:#171717; text-align:right;">
                ¥${Number(group.expenseAmount || 0).toFixed(2)}
            </td>

            <!-- 费用主体聚合列 6: 合并费用说明文本框 (100% 满高贴合) -->
            <td class="yn-bem-group-cell yn-bem-cell-interactive ${isSaveError ? 'has-save-error' : ''}" rowspan="${span}">
                <input type="text" class="yn-bem-desc-input ${isDescChanged ? 'has-changed' : ''} ${isSaveError ? 'has-save-error' : ''}"
                       data-recordid="${group.expenseRecordId}"
                       value="${escapeHtml(group.newDescription !== undefined ? group.newDescription : group.description)}"
                       placeholder="输入或修改费用说明..." title="直接就地编辑费用说明" />
                ${isSaveError ? `<div class="yn-bem-row-error-hint" title="${escapeHtml(saveError || '')}">❌ ${escapeHtml(saveError || '')}</div>` : ''}
            </td>

            <!-- 费用主体聚合列 7: 发票张数 -->
            <td class="yn-bem-group-cell" rowspan="${span}" style="text-align:center;">
                <span style="font-family:ui-monospace, monospace; font-weight:600;">${group.invoiceCount}</span>
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
                <tr class="${isSelected ? 'is-selected' : ''} ${isSaveError ? 'is-save-error' : ''} yn-bem-data-row" data-recordid="${group.expenseRecordId}">
                    ${renderInvoiceDetailCells(invK, group.invoiceCount, group)}
                </tr>
            `;
        }
    }

    return rowsHtml;
}

/**
 * 渲染聚合多行明细表格 (Vercel Clean Table & Tabular Figures，多级分组与折叠架构)
 */
function renderTableHtml(): string {
    const filteredGroups = getFilteredGroups(modalState);
    const selectedInFiltered = filteredGroups.filter(g =>
        modalState.selectedRecordIds.has(g.expenseRecordId)
    );
    const isAllChecked = filteredGroups.length > 0 && selectedInFiltered.length === filteredGroups.length;
    const activeCols = COLUMN_DEFINITIONS;
    const totalColSpan = activeCols.length + 1;

    const getColumnCategoryPill = (key: string): string => {
        if (['dynFrom', 'dynTo', 'dynTransitNo', 'dynStartDate', 'dynEndDate'].includes(key)) {
            return `<span class="yn-bem-th-cat-pill yn-th-cat-transit" title="差旅交通专属必填">交通</span>`;
        }
        if (['dynCheckIn', 'dynCheckOut', 'dynCity', 'dynCityType', 'dynHotel', 'dynRoomNum', 'dynOverStandard'].includes(key)) {
            return `<span class="yn-bem-th-cat-pill yn-th-cat-hotel" title="住宿费专属必填">住宿</span>`;
        }
        if (['dynAddrFrom', 'dynAddrTo'].includes(key)) {
            return `<span class="yn-bem-th-cat-pill yn-th-cat-taxi" title="出租车专属必填">打车</span>`;
        }
        if (key === 'dynBillMonth') {
            return `<span class="yn-bem-th-cat-pill yn-th-cat-mobile" title="通信费专属必填">通信</span>`;
        }
        if (key.startsWith('invoice') || ['totalAmount', 'departureTime', 'timeGetOff', 'stationGetOn', 'stationGetOff', 'salesName', 'fileName', 'remarks', 'reconciliationNote'].includes(key)) {
            return `<span class="yn-bem-th-cat-pill yn-th-cat-invoice" title="原始发票票面明细">发票</span>`;
        }
        if (['earliestInvoiceDate', 'businessDate', 'expenseTypeName', 'expenseAmount', 'description', 'invoiceCount'].includes(key)) {
            return `<span class="yn-bem-th-cat-pill yn-th-cat-base" title="费用记录基础属性">基础</span>`;
        }
        return '';
    };

    const colGroupHtml = `
        <colgroup>
            <col style="width: 34px; min-width: 34px;" />
            ${activeCols.map(col => `<col style="width: ${col.width || '80px'}; min-width: ${col.width || '80px'};" />`).join('')}
        </colgroup>
    `;

    const renderThCellHtml = (col: ColumnDef): string => {
        const isSorted = modalState.sortKey === col.key;
        const arrow = isSorted ? (modalState.sortAsc ? ' ↑' : ' ↓') : '';
        const isFiltered = Boolean(modalState.columnFilters[col.key] && modalState.columnFilters[col.key].length > 0);
        const isPopoverOpen = modalState.activePopoverCol === col.key;
        const stickyClass = col.sticky === 'date' ? 'yn-bem-col-sticky-date' : '';
        const alignStyle = col.align === 'right' ? 'text-align:right;' : (col.align === 'center' ? 'text-align:center;' : '');
        const justifyStyle = col.align === 'right' ? 'justify-content:flex-end;' : (col.align === 'center' ? 'justify-content:center;' : '');
        const catPill = getColumnCategoryPill(col.key);

        return `
            <th class="${stickyClass} ${isSorted ? 'sorted-active' : ''}" style="${alignStyle} ${col.width ? `min-width:${col.width}; width:${col.width};` : ''}">
                <div class="yn-bem-th-cell-stack">
                    <div class="yn-bem-th-top-row">
                        ${catPill || '<span class="yn-bem-th-pill-spacer"></span>'}
                        ${col.key !== 'actions' && col.key !== 'routeDetails' ? `
                            <button type="button" class="yn-bem-th-filter-trigger ${isFiltered ? 'is-active' : ''}" data-filter-col="${col.key}" title="按 ${col.label} 筛选">▾</button>
                            ${isPopoverOpen ? renderColumnFilterPopoverHtml(col.key) : ''}
                        ` : ''}
                    </div>
                    <div class="yn-bem-th-bottom-row" style="${justifyStyle}">
                        <span class="yn-bem-th-title" data-sort="${col.key}" title="${col.label}">
                            <span class="yn-bem-th-label-text">${col.label}</span>
                            ${arrow ? `<span class="yn-bem-th-sort-arrow">${arrow}</span>` : ''}
                        </span>
                    </div>
                </div>
            </th>
        `;
    };

    if (filteredGroups.length === 0) {
        return `
        <table class="yn-bem-table">
            ${colGroupHtml}
            <thead>
                <tr>
                    <th class="yn-bem-col-sticky-cb">
                        <input type="checkbox" id="yn-bem-th-select-all" disabled />
                    </th>
                    ${activeCols.map(col => renderThCellHtml(col)).join('')}
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td colspan="${totalColSpan}" style="text-align:center; padding:60px 16px; color:#64748b; background:#fff;">
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
            ${colGroupHtml}
            <thead>
                <tr>
                    <th class="yn-bem-col-sticky-cb">
                        <input type="checkbox" id="yn-bem-th-select-all" ${isAllChecked ? 'checked' : ''} />
                    </th>
                    ${activeCols.map(col => renderThCellHtml(col)).join('')}
                </tr>
            </thead>
            ${(() => {
                if (modalState.groupingMode === 'NONE') {
                    return `
                        <tbody>
                            ${filteredGroups.map(group => renderGroupRowsHtml(group)).join('')}
                        </tbody>
                    `;
                }

                const sections = groupFilteredExpenses(filteredGroups, modalState.groupingMode, modalState.tripPlans);
                return sections.map(sec => {
                    const isCollapsed = modalState.collapsedGroupKeys.has(sec.key);
                    const selectedCount = sec.items.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId)).length;
                    const totalCount = sec.items.length;
                    const isChecked = totalCount > 0 && selectedCount === totalCount;
                    const isIndeterminate = selectedCount > 0 && selectedCount < totalCount;

                    return `
                        <tbody class="yn-bem-group-tbody ${isCollapsed ? 'is-collapsed' : ''}" data-group-key="${sec.key}">
                            <tr class="yn-bem-group-header-row" data-group-key="${sec.key}">
                                <td colspan="${totalColSpan}" class="yn-bem-group-header-cell">
                                    <div class="yn-bem-group-header-inner">
                                        <button type="button" class="yn-bem-group-toggle-btn" data-group-key="${sec.key}" title="${isCollapsed ? '点击展开' : '点击折叠'}">
                                            ${isCollapsed ? '▶' : '▼'}
                                        </button>
                                        <input type="checkbox" class="yn-bem-group-cb" data-group-key="${sec.key}" ${isChecked ? 'checked' : ''} ${isIndeterminate ? 'data-indeterminate="true"' : ''} title="全选/反选本分组" />
                                        <span class="yn-bem-group-title">${sec.title}</span>
                                        <span class="yn-bem-group-flow-tag yn-bem-tag-${sec.flow.toLowerCase()}">${sec.flowTag}</span>
                                        <span class="yn-bem-group-summary-badge">${sec.items.length} 笔费用 (${sec.totalInvoices} 张发票) · 小计 ¥${sec.totalAmount.toFixed(2)}</span>
                                        ${sec.tripConfig ? `
                                            <div style="margin-left:auto; display:flex; align-items:center; gap:6px;">
                                                <button type="button" class="yn-bem-btn-trip-edit" data-trip-edit-id="${sec.tripConfig.id}" title="查看并修改本轮 Trip 行程、酒店、拜访客户据点及预算">
                                                    ✏️ 编辑/打磨 Trip
                                                </button>
                                                <button type="button" class="yn-bem-btn-trip-edit" data-trip-report-id="${sec.tripConfig.id}" title="生成并复制本轮出差报告 (Markdown) 总结草稿">
                                                    📄 出差报告草稿
                                                </button>
                                                <button type="button" class="yn-bem-btn-mini yn-bem-btn-trip-create-sc" data-trip-id="${sec.tripConfig.id}">
                                                    ⚡ 生成该轮申请单 (SC)
                                                </button>
                                            </div>
                                        ` : ''}
                                    </div>
                                </td>
                            </tr>
                            ${sec.items.map(group => renderGroupRowsHtml(group)).join('')}
                        </tbody>
                    `;
                }).join('');
            })()}
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
 * 响应式更新底部操作浮条 (兼容空桩)
 */
function updateFooterActionButtons(_container: HTMLElement): void {
    // 底部冗余操作按钮组已剔除，统一收敛至 Floating Action Island 悬浮操作岛
}

/**
 * 渲染模态框主体内容
 */
function renderModalContent(container: HTMLElement, doc: Document) {
    const filteredGroups = getFilteredGroups(modalState);
    const aiWidth = modalState.aiPanelWidth || 440;

    container.innerHTML = `
        <!-- 1. 顶部融合操作栏 (单行 46px 全宽置顶，左右端固定，搜索居中) -->
        ${renderTopBarHtml(filteredGroups)}

        <!-- 2. 主工作区：明细表格 (100% 满宽，零布局偏移 CLS=0) -->
        <div class="yn-bem-modal-main-wrapper" id="yn-bem-modal-main-wrapper">
            <div class="yn-bem-main-layout" id="yn-bem-main-layout">
                <div class="yn-bem-table-wrap" id="yn-bem-table-wrap">
                    ${renderTableHtml()}
                </div>
            </div>

            <!-- 3. 底部极简状态指示条 (Clean Status Strip) -->
            <div class="yn-bem-footer">
                <div class="yn-bem-footer-stats" id="yn-bem-footer-stats">
                    ${renderFooterStatsHtml()}
                </div>
            </div>
        </div>

        <!-- 4. 底部悬浮操作岛 (Floating Action Island - 选中时弹性浮现) -->
        ${renderFloatingIslandHtml()}

        <!-- 5. 居中批量修改弹窗容器 (按需挂载) -->
        <div id="yn-bem-batch-dialog-wrap">
            ${modalState.batchSettingsDialogOpen ? renderBatchSettingsDialogHtml() : ''}
        </div>

        <!-- 6. AI 智能副驾悬浮抽屉面板：右侧滑入滑出 + 可任意调整宽度 (assistant-ui React Root) -->
        <div id="yn-bem-ai-panel-wrap" class="${modalState.aiPanelOpen ? 'is-open' : ''}" style="width:${aiWidth}px;">
            <div class="yn-bem-ai-resizer" id="yn-bem-ai-resizer" title="左右拖动调整 AI 助手面板宽度"></div>
            <div class="yn-bem-ai-panel" id="yn-bem-ai-panel-react-root"></div>
        </div>
    `;

    bindEvents(container, doc);
    updateFloatingIsland(container);
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

// ============================================================
// Trip 信息本地暂存与打磨系统 (Local Storage & Polish System)
// ============================================================
const STORAGE_KEY_TRIP_PLANS = 'yn_fssc_cached_trip_plans';

/**
 * 将 Trip 规划临时持久化到 LocalStorage，方便用户跨操作打磨与恢复
 */
export function saveTripPlansToStorage(plans: TripApplicationConfig[]): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY_TRIP_PLANS, JSON.stringify(plans));
        }
    } catch (e: any) {
        AutopilotLogger.warn(`[TripStorage] 暂存 Trip 失败: ${e?.message || e}`);
    }
}

/**
 * 从 LocalStorage 读取用户暂存的 Trip 规划
 */
export function loadTripPlansFromStorage(): TripApplicationConfig[] {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(STORAGE_KEY_TRIP_PLANS);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        }
    } catch (e: any) {
        AutopilotLogger.warn(`[TripStorage] 读取暂存 Trip 失败: ${e?.message || e}`);
    }
    return [];
}

/**
 * 清空暂存的 Trip 规划
 */
export function clearTripPlansFromStorage(): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(STORAGE_KEY_TRIP_PLANS);
        }
    } catch (e) {
        // ignore
    }
}

/**
 * 生成出差报告与总结草稿 (Markdown 格式)
 * 允许用户一键导出打磨后的出差信息，直接粘贴到周报或业务总结汇报
 */
export function generateTripReportMarkdown(trip: TripApplicationConfig, items: ExpenseRecordGroup[] = []): string {
    const tripSum = items.reduce((acc, g) => acc + Number(g.expenseAmount || 0), 0);
    const invoiceCount = items.reduce((acc, g) => acc + g.invoices.length, 0);
    const categories = Array.from(new Set(items.map(g => g.newExpenseTypeName || g.expenseTypeName))).filter(Boolean);

    return `# 业务出差报告与总结草稿 (Trip ${trip.tripNo})

## 1. 出差基本信息
- **出差轮次**：Trip ${trip.tripNo}
- **出差目的地**：${trip.destination}
- **出差区间**：${trip.startDate} ~ ${trip.endDate}（共 ${trip.days} 天 ${trip.nights} 晚）
- **出差人员**：${trip.applicantName} ${trip.travelers && trip.travelers.length > 0 ? `(同行: ${trip.travelers.join('、')})` : ''}
- **归属项目**：${trip.projectName || modalState.projectName || '未指定'}
- **出差事由**：${trip.purpose || '业务交流及现场技术支持'}
- **拜访客户/据点**：${trip.targetFactories || '未填写'}
- **入住酒店**：${trip.hotelName || '未填写'}

## 2. 差旅费用报销核算
- **关联实际报销费用**：${items.length} 笔 (${invoiceCount} 张发票)
- **实际报销总额**：¥${tripSum.toFixed(2)}
- **涉及费用类别**：${categories.join('、') || '差旅费用'}
- **出差申请单 (SC) 额度核定**：¥${trip.totalAmount.toFixed(2)}
  - 交通费预算：¥${trip.trafficFee.toFixed(2)}
  - 住宿费预算：¥${trip.hotelFee.toFixed(2)}
  - 误餐补贴：¥${trip.mealFee.toFixed(2)}
  - 市内交通/机动 Buffer：¥${trip.otherFee.toFixed(2)}
  - 交通改签 Buffer：¥${trip.trafficBuffer.toFixed(2)}
${trip.billCode ? `- **关联系统申请单号 (SC)**：${trip.billCode}` : ''}

## 3. 主要工作与业务成果总结 (可就地补充修改)
1. 现场调研与业务沟通：走访 ${trip.targetFactories || '客户据点'}，针对实际业务与技术需求进行深度现场对接与交流；
2. 问题排查与方案落地：针对现场技术疑难与工艺流程开展实地排查，制定并推动解决方案；
3. 后续工作计划与跟进事项：跟进现场遗留问题，保持与客户/据点业务负责人的密切对接。
`;
}

/**
 * 就地编辑/打磨 Trip 详情模态框
 * 允许用户细致微调 Trip 的目的地、起止日、酒店、走访客户、同行人及预算
 */
export function openEditTripModal(tripId: string, container: HTMLElement) {
    const trip = modalState.tripPlans.find(t => t.id === tripId);
    if (!trip) {
        showToast('warning', '未找到对应的 Trip 规划信息');
        return;
    }

    const existing = document.getElementById('yn-bem-edit-trip-mask');
    if (existing) existing.remove();

    const tripItems = modalState.groups.filter(g => g.tripId === trip.id);
    const tripSum = tripItems.reduce((acc, g) => acc + Number(g.expenseAmount || 0), 0);

    const mask = document.createElement('div');
    mask.id = 'yn-bem-edit-trip-mask';
    mask.innerHTML = `
        <div class="yn-bem-edit-trip-card">
            <div class="yn-bem-edit-trip-header">
                <div class="yn-bem-edit-trip-title">
                    <span>✏️ 编辑/打磨 Trip ${trip.tripNo} 行程与申请规划</span>
                    <span class="yn-bem-badge-trip">Trip ${trip.tripNo}</span>
                </div>
                <button type="button" class="yn-bem-close-x" id="yn-bem-btn-close-edit-trip">✕</button>
            </div>
            <div class="yn-bem-edit-trip-body">
                <div class="yn-bem-form-row">
                    <div class="yn-bem-form-group">
                        <label class="yn-bem-form-label">目的地城市 *</label>
                        <input type="text" id="yn-trip-edit-dest" class="yn-bem-form-input" value="${escapeHtml(trip.destination)}" placeholder="如: 天津、广州、深圳" />
                    </div>
                    <div class="yn-bem-form-group">
                        <label class="yn-bem-form-label">起始日期 (出差首日) *</label>
                        <input type="date" id="yn-trip-edit-start" class="yn-bem-form-input" value="${trip.startDate}" />
                    </div>
                    <div class="yn-bem-form-group">
                        <label class="yn-bem-form-label">结束日期 (返回日) *</label>
                        <input type="date" id="yn-trip-edit-end" class="yn-bem-form-input" value="${trip.endDate}" />
                    </div>
                </div>

                <div class="yn-bem-form-row">
                    <div class="yn-bem-form-group">
                        <label class="yn-bem-form-label">主申请人 / 外驻代报人</label>
                        <input type="text" id="yn-trip-edit-applicant" class="yn-bem-form-input" value="${escapeHtml(trip.applicantName)}" />
                    </div>
                    <div class="yn-bem-form-group">
                        <label class="yn-bem-form-label">同行人员 (用顿号、分隔)</label>
                        <input type="text" id="yn-trip-edit-travelers" class="yn-bem-form-input" value="${escapeHtml((trip.travelers || []).join('、'))}" placeholder="如: 陈浩、成勇、李建勇" />
                    </div>
                    <div class="yn-bem-form-group">
                        <label class="yn-bem-form-label">归属项目</label>
                        <input type="text" id="yn-trip-edit-project" class="yn-bem-form-input" value="${escapeHtml(trip.projectName || modalState.projectName || '')}" placeholder="如: X2605-001" />
                    </div>
                </div>

                <div class="yn-bem-form-row">
                    <div class="yn-bem-form-group">
                        <label class="yn-bem-form-label">走访据点 / 客户公司列表</label>
                        <input type="text" id="yn-trip-edit-factories" class="yn-bem-form-input" value="${escapeHtml(trip.targetFactories || '')}" placeholder="如: 住理工津荣模具、環宇住理工、東海化成" />
                    </div>
                    <div class="yn-bem-form-group">
                        <label class="yn-bem-form-label">入住酒店 (排期权威酒店)</label>
                        <input type="text" id="yn-trip-edit-hotel" class="yn-bem-form-input" value="${escapeHtml(trip.hotelName || '')}" placeholder="如: 亚朵酒店（天津117大厦华科大街） / 美悦酒店" />
                    </div>
                </div>

                <div class="yn-bem-form-group">
                    <label class="yn-bem-form-label">出差具体事由与目的</label>
                    <textarea id="yn-trip-edit-purpose" class="yn-bem-form-textarea" rows="2" placeholder="如: 天津客户业务交流及现场技术支持">${escapeHtml(trip.purpose || '')}</textarea>
                </div>

                <!-- 申请单预算明细 (可自由微调) -->
                <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:12px;">
                    <div style="font-size:12px; font-weight:700; color:#0f172a; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                        <span>💰 出差申请单 (SC) 额度与预算微调</span>
                        <span style="font-size:11px; color:#64748b; font-weight:normal;">(当前天数: <span id="yn-trip-edit-days-badge" style="font-weight:700; color:#0f172a;">${trip.days}天${trip.nights}晚</span> · 关联报销: ${tripItems.length}笔 ¥${tripSum.toFixed(2)})</span>
                    </div>
                    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;">
                        <div class="yn-bem-form-group">
                            <label class="yn-bem-form-label">交通费预算 (机票/高铁)</label>
                            <input type="number" id="yn-trip-edit-fee-traffic" class="yn-bem-form-input" step="0.01" value="${trip.trafficFee.toFixed(2)}" />
                        </div>
                        <div class="yn-bem-form-group">
                            <label class="yn-bem-form-label">住宿费预算</label>
                            <input type="number" id="yn-trip-edit-fee-hotel" class="yn-bem-form-input" step="0.01" value="${trip.hotelFee.toFixed(2)}" />
                        </div>
                        <div class="yn-bem-form-group">
                            <label class="yn-bem-form-label">误餐补贴</label>
                            <input type="number" id="yn-trip-edit-fee-meal" class="yn-bem-form-input" step="0.01" value="${trip.mealFee.toFixed(2)}" />
                        </div>
                        <div class="yn-bem-form-group">
                            <label class="yn-bem-form-label">市内交通及Buffer</label>
                            <input type="number" id="yn-trip-edit-fee-other" class="yn-bem-form-input" step="0.01" value="${trip.otherFee.toFixed(2)}" />
                        </div>
                        <div class="yn-bem-form-group">
                            <label class="yn-bem-form-label">交通改签Buffer (15%)</label>
                            <input type="number" id="yn-trip-edit-fee-buffer" class="yn-bem-form-input" step="0.01" value="${trip.trafficBuffer.toFixed(2)}" />
                        </div>
                        <div class="yn-bem-form-group" style="justify-content: flex-end;">
                            <label class="yn-bem-form-label" style="color:#15803d;">申请总额 (SC)</label>
                            <div id="yn-trip-edit-total-val" style="font-size:15px; font-weight:700; color:#15803d; font-family:ui-monospace, monospace; padding-top:4px;">¥${trip.totalAmount.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="yn-bem-edit-trip-footer">
                <button type="button" class="yn-bem-btn yn-bem-btn-secondary" id="yn-trip-edit-copy-report" style="margin-right:auto;">
                    📋 复制出差总结报告 (Markdown)
                </button>
                <button type="button" class="yn-bem-btn yn-bem-btn-secondary" id="yn-trip-edit-cancel">取消</button>
                <button type="button" class="yn-bem-btn yn-bem-btn-primary" id="yn-trip-edit-save">💾 保存修改并同步暂存</button>
            </div>
        </div>
    `;

    const targetDoc = container.ownerDocument || document;
    targetDoc.body.appendChild(mask);

    const closeTripModal = () => mask.remove();
    mask.querySelector('#yn-bem-btn-close-edit-trip')?.addEventListener('click', closeTripModal);
    mask.querySelector('#yn-trip-edit-cancel')?.addEventListener('click', closeTripModal);

    // 动态联动总金额计算
    const recalcTotal = () => {
        const tf = parseFloat((mask.querySelector('#yn-trip-edit-fee-traffic') as HTMLInputElement)?.value || '0') || 0;
        const hf = parseFloat((mask.querySelector('#yn-trip-edit-fee-hotel') as HTMLInputElement)?.value || '0') || 0;
        const mf = parseFloat((mask.querySelector('#yn-trip-edit-fee-meal') as HTMLInputElement)?.value || '0') || 0;
        const of = parseFloat((mask.querySelector('#yn-trip-edit-fee-other') as HTMLInputElement)?.value || '0') || 0;
        const bf = parseFloat((mask.querySelector('#yn-trip-edit-fee-buffer') as HTMLInputElement)?.value || '0') || 0;
        const total = Math.round((tf + hf + mf + of + bf) * 100) / 100;
        const totalEl = mask.querySelector('#yn-trip-edit-total-val');
        if (totalEl) totalEl.textContent = `¥${total.toFixed(2)}`;
        return total;
    };

    ['yn-trip-edit-fee-traffic', 'yn-trip-edit-fee-hotel', 'yn-trip-edit-fee-meal', 'yn-trip-edit-fee-other', 'yn-trip-edit-fee-buffer'].forEach(id => {
        mask.querySelector(`#${id}`)?.addEventListener('input', recalcTotal);
    });

    // 起止日期变动联动天数与误餐补贴
    const onDateChange = () => {
        const s = (mask.querySelector('#yn-trip-edit-start') as HTMLInputElement)?.value;
        const e = (mask.querySelector('#yn-trip-edit-end') as HTMLInputElement)?.value;
        if (s && e && s <= e) {
            const { days, nights } = calculateDaysAndNights(s, e);
            const badge = mask.querySelector('#yn-trip-edit-days-badge');
            if (badge) badge.textContent = `${days}天${nights}晚`;
            const mealInp = mask.querySelector<HTMLInputElement>('#yn-trip-edit-fee-meal');
            if (mealInp) {
                mealInp.value = computeMealAllowance(days, 300, 150).toFixed(2);
                recalcTotal();
            }
        }
    };
    mask.querySelector('#yn-trip-edit-start')?.addEventListener('change', onDateChange);
    mask.querySelector('#yn-trip-edit-end')?.addEventListener('change', onDateChange);

    // 复制出差报告
    mask.querySelector('#yn-trip-edit-copy-report')?.addEventListener('click', () => {
        const reportMd = generateTripReportMarkdown(trip, tripItems);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(reportMd).then(() => {
                showToast('success', `✨ 已复制 Trip ${trip.tripNo} 的出差总结报告草稿到剪贴板！`);
            }).catch(() => {
                copyFallback(reportMd);
                showToast('success', `✨ 已复制 Trip ${trip.tripNo} 的出差总结报告草稿到剪贴板！`);
            });
        } else {
            copyFallback(reportMd);
            showToast('success', `✨ 已复制 Trip ${trip.tripNo} 的出差总结报告草稿到剪贴板！`);
        }
    });

    // 保存并持久化
    mask.querySelector('#yn-trip-edit-save')?.addEventListener('click', () => {
        const destInp = mask.querySelector<HTMLInputElement>('#yn-trip-edit-dest')?.value.trim() || trip.destination;
        const sDate = mask.querySelector<HTMLInputElement>('#yn-trip-edit-start')?.value || trip.startDate;
        const eDate = mask.querySelector<HTMLInputElement>('#yn-trip-edit-end')?.value || trip.endDate;
        const applicant = mask.querySelector<HTMLInputElement>('#yn-trip-edit-applicant')?.value.trim() || trip.applicantName;
        const travelersRaw = mask.querySelector<HTMLInputElement>('#yn-trip-edit-travelers')?.value.trim() || '';
        const proj = mask.querySelector<HTMLInputElement>('#yn-trip-edit-project')?.value.trim() || trip.projectName;
        const factories = mask.querySelector<HTMLInputElement>('#yn-trip-edit-factories')?.value.trim() || '';
        const hotel = mask.querySelector<HTMLInputElement>('#yn-trip-edit-hotel')?.value.trim() || '';
        const purpose = mask.querySelector<HTMLTextAreaElement>('#yn-trip-edit-purpose')?.value.trim() || trip.purpose;

        const tf = parseFloat((mask.querySelector('#yn-trip-edit-fee-traffic') as HTMLInputElement)?.value || '0') || 0;
        const hf = parseFloat((mask.querySelector('#yn-trip-edit-fee-hotel') as HTMLInputElement)?.value || '0') || 0;
        const mf = parseFloat((mask.querySelector('#yn-trip-edit-fee-meal') as HTMLInputElement)?.value || '0') || 0;
        const of = parseFloat((mask.querySelector('#yn-trip-edit-fee-other') as HTMLInputElement)?.value || '0') || 0;
        const bf = parseFloat((mask.querySelector('#yn-trip-edit-fee-buffer') as HTMLInputElement)?.value || '0') || 0;
        const total = Math.round((tf + hf + mf + of + bf) * 100) / 100;

        const { days, nights } = calculateDaysAndNights(sDate, eDate);

        trip.destination = destInp;
        trip.startDate = sDate;
        trip.endDate = eDate;
        trip.days = days;
        trip.nights = nights;
        trip.applicantName = applicant;
        trip.travelers = travelersRaw ? travelersRaw.split(/[、,，\s]+/).filter(Boolean) : [];
        trip.projectName = proj;
        trip.targetFactories = factories;
        trip.hotelName = hotel;
        trip.purpose = purpose;
        trip.trafficFee = tf;
        trip.hotelFee = hf;
        trip.mealFee = mf;
        trip.otherFee = of;
        trip.trafficBuffer = bf;
        trip.totalAmount = total;

        // 同步修改属于本 Trip 的费用行名称
        for (const g of modalState.groups) {
            if (g.tripId === trip.id) {
                g.tripName = `【Trip ${trip.tripNo}】${trip.destination}出差 (${trip.startDate} ~ ${trip.endDate})`;
            }
        }

        // 写入 LocalStorage 暂存
        saveTripPlansToStorage(modalState.tripPlans);

        closeTripModal();
        refreshTableView(container);
        showToast('success', `✨ 已成功更新并暂存 Trip ${trip.tripNo} 的打磨信息！`);
    });
}

/**
 * 唤出 100vh AI 智能副驾侧边栏并激活对应技能 (Skill)
 * 携带已选条目胶囊、注入技能提示词并自动获得焦点
 */
export function openAiAssistantWithSkill(container: HTMLElement, skillId: string): void {
    // 1. 若当前未勾选任何条目，自动全选当前筛选视图下的全部条目
    if (modalState.selectedRecordIds.size === 0) {
        const filtered = getFilteredGroups(modalState);
        filtered.forEach(g => modalState.selectedRecordIds.add(g.expenseRecordId));
        updateAllCheckboxStates(container);
        updateStatsAndFooter(container);
    }

    // 2. 打开 AI 智能侧边栏 (100vh)
    modalState.aiPanelOpen = true;
    modalState.attachedExpenseContextEnabled = true;
    modalState.activeSkillId = skillId;
    modalState.skillMenuOpen = false;
    modalState.slashMenuOpen = false;

    const aiWrap = container.querySelector<HTMLElement>('#yn-bem-ai-panel-wrap');
    const w = modalState.aiPanelWidth || 440;
    if (aiWrap) {
        aiWrap.style.width = `${w}px`;
        aiWrap.classList.add('is-open');
    }

    const btnToggleAi = container.querySelector<HTMLButtonElement>('#yn-bem-btn-toggle-ai');
    if (btnToggleAi) {
        btnToggleAi.classList.add('is-active');
        btnToggleAi.innerHTML = `<span class="yn-gemini-sparkle-icon">✦</span> AI 助手 ✕`;
    }

    renderAssistantChat(container);
}

/**
 * 全景报销决策复核与极速建单看板 (HITL)
 * 允许用户在单一看板中一览所有出差申请单 (SC)、出差报销单 (BC) 与日常经费报销单 (BJ) 的规划构成、
 * 预算展开及历史防重比对，确认无误后一键调用 API 管道极速持久化草稿入库 (commit: false)
 */
export function openAutopilotDecisionDashboard(container: HTMLElement, focusTripId?: string) {
    const existing = container.querySelector('#yn-bem-decision-dashboard-modal');
    if (existing) existing.remove();

    if (modalState.tripPlans.length === 0) {
        clusterExpensesIntoTrips(
            modalState.groups,
            modalState.proxyPersonName || modalState.currentEmployeeName,
            modalState.projectName
        );
    }

    const tripPlans = modalState.tripPlans;
    const groups = modalState.groups;
    const globalState = getInvoicePoolGlobalState();

    const nonTripItems = groups.filter(g => !g.tripId || g.tripId === 'NON_TRIP');
    const nonTripTotal = nonTripItems.reduce((acc, g) => acc + Number(g.expenseAmount || 0), 0);
    const nonTripInvoices = nonTripItems.reduce((acc, g) => acc + g.invoices.length, 0);

    const targetDoc = container.ownerDocument || (typeof window !== 'undefined' && window.top && window.top.document ? window.top.document : document);
    if (!targetDoc.getElementById('yn-injected-styles')) {
        const styleEl = targetDoc.createElement('style');
        styleEl.id = 'yn-injected-styles';
        styleEl.innerHTML = MODAL_STYLES;
        (targetDoc.head || targetDoc.body).appendChild(styleEl);
    }

    const overlay = targetDoc.createElement('div');
    overlay.id = 'yn-bem-decision-dashboard-modal';
    overlay.className = 'yn-bem-decision-modal-overlay';

    let tripsHtml = '';
    if (tripPlans.length === 0) {
        tripsHtml = `
            <div style="padding:24px; text-align:center; color:#737373; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px;">
                未检测到差旅类费用（飞机票/火车票/住宿费/出差打车）。如全部为本地日常支出，请直接查看下方【日常经费报销 (BJ)】。
            </div>
        `;
    } else {
        tripsHtml = tripPlans.map(trip => {
            const tripItems = groups.filter(g => g.tripId === trip.id);
            const tripSum = tripItems.reduce((acc, g) => acc + Number(g.expenseAmount || 0), 0);
            const isGenerated = Boolean(modalState.tripBillCodes[trip.id]);
            const billCode = modalState.tripBillCodes[trip.id] || '';

            return `
                <div class="yn-bem-dashboard-card ${focusTripId === trip.id ? 'is-focused' : ''}">
                    <div class="yn-bem-dashboard-card-header">
                        <div class="yn-bem-dashboard-card-title">
                            <span class="yn-bem-badge-trip">Trip ${trip.tripNo}</span>
                            出差申请单 (SC) ➔ 出差费用报销单 (BC)
                            <span class="yn-bem-tag-bc" style="margin-left:6px;">[差旅·BC]</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            ${isGenerated
                                ? `<span class="yn-bem-group-draft-badge">✅ 已生成草稿: ${billCode}</span>`
                                : `<span style="font-size:12px; color:#f59e0b; font-weight:600;">⏳ 待创建草稿</span>`
                            }
                            <button type="button" class="yn-bem-btn-trip-edit" data-dashboard-edit-trip="${trip.id}" title="查看并修改本轮出差行程与申请单预算">
                                ✏️ 打磨
                            </button>
                            <button type="button" class="yn-bem-btn-trip-edit" data-dashboard-report-trip="${trip.id}" title="复制本轮出差总结报告草稿">
                                📄 报告
                            </button>
                        </div>
                    </div>
                    <div class="yn-bem-dashboard-grid">
                        <div class="yn-bem-dashboard-field">
                            <span class="label">出差区间:</span>
                            <span class="val">${trip.startDate} ~ ${trip.endDate} (${trip.days}天${trip.nights}晚)</span>
                        </div>
                        <div class="yn-bem-dashboard-field">
                            <span class="label">目的地城市:</span>
                            <span class="val">${trip.destination || '未指定'}</span>
                        </div>
                        <div class="yn-bem-dashboard-field">
                            <span class="label">出差人/申请人:</span>
                            <span class="val">${trip.applicantName} ${trip.isProxy ? '(外驻代报)' : '(本人)'}</span>
                        </div>
                        <div class="yn-bem-dashboard-field">
                            <span class="label">归属项目:</span>
                            <span class="val" style="color:#0284c7; font-weight:600;">${trip.projectName || modalState.projectName || '未指定'}</span>
                        </div>
                        <div class="yn-bem-dashboard-field" style="grid-column: span 2;">
                            <span class="label">出差事由:</span>
                            <span class="val">${trip.purpose || '业务交流及现场技术支持'}</span>
                        </div>
                    </div>

                    <div class="yn-bem-dashboard-budget-row">
                        <div class="yn-bem-budget-item">
                            <span class="b-label">交通费预算</span>
                            <span class="b-val">¥${trip.trafficFee.toFixed(2)}</span>
                        </div>
                        <div class="yn-bem-budget-item">
                            <span class="b-label">住宿费预算</span>
                            <span class="b-val">¥${trip.hotelFee.toFixed(2)}</span>
                        </div>
                        <div class="yn-bem-budget-item">
                            <span class="b-label">误餐补贴</span>
                            <span class="b-val">¥${trip.mealFee.toFixed(2)}</span>
                        </div>
                        <div class="yn-bem-budget-item">
                            <span class="b-label">市内交通Buffer</span>
                            <span class="b-val">¥${trip.otherFee.toFixed(2)}</span>
                        </div>
                        <div class="yn-bem-budget-item">
                            <span class="b-label">交通改签Buffer</span>
                            <span class="b-val">¥${trip.trafficBuffer.toFixed(2)}</span>
                        </div>
                        <div class="yn-bem-budget-item is-total">
                            <span class="b-label">申请总额 (SC)</span>
                            <span class="b-val" style="color:#15803d; font-weight:700;">¥${trip.totalAmount.toFixed(2)}</span>
                        </div>
                    </div>

                    <div style="margin-top:10px; font-size:12px; color:#525252; display:flex; justify-content:space-between; align-items:center; background:#f9fafb; padding:8px 12px; border-radius:6px;">
                        <span>关联本轮实际发票报销: <strong>${tripItems.length}</strong> 笔费用，报销金额 <strong>¥${tripSum.toFixed(2)}</strong></span>
                        <span style="color:#737373;">(申请单总额已自动包含充裕 Buffer，确保报销金额绝不超标)</span>
                    </div>

                    ${trip.matchedHistoryBill ? `
                        <div style="margin-top:8px; padding:6px 10px; background:#fffbeb; border:1px solid #fef3c7; border-radius:4px; font-size:11px; color:#b45309;">
                            ⚠️ 系统交叉对比命中历史相近出差申请单: <strong>${trip.matchedHistoryBill.billCode}</strong> (申报金额 ¥${trip.matchedHistoryBill.amount}，申请日 ${trip.matchedHistoryBill.billDate})
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    let nonTripHtml = '';
    if (nonTripItems.length > 0) {
        const isGenerated = Boolean(modalState.tripBillCodes['NON_TRIP']);
        const billCode = modalState.tripBillCodes['NON_TRIP'] || '';
        nonTripHtml = `
            <div class="yn-bem-dashboard-card">
                <div class="yn-bem-dashboard-card-header">
                    <div class="yn-bem-dashboard-card-title">
                        <span class="yn-bem-tag-bj" style="margin-right:6px;">[经费·BJ]</span>
                        日常办公与市内交通经费报销单 (BJ)
                    </div>
                    <div>
                        ${isGenerated
                            ? `<span class="yn-bem-group-draft-badge">✅ 已生成草稿: ${billCode}</span>`
                            : `<span style="font-size:12px; color:#f59e0b; font-weight:600;">⏳ 待创建草稿</span>`
                        }
                    </div>
                </div>
                <div class="yn-bem-dashboard-grid">
                    <div class="yn-bem-dashboard-field">
                        <span class="label">费用笔数:</span>
                        <span class="val">${nonTripItems.length} 笔 (${nonTripInvoices} 张发票)</span>
                    </div>
                    <div class="yn-bem-dashboard-field">
                        <span class="label">报销总额:</span>
                        <span class="val" style="color:#15803d; font-weight:700;">¥${nonTripTotal.toFixed(2)}</span>
                    </div>
                    <div class="yn-bem-dashboard-field">
                        <span class="label">主申请人:</span>
                        <span class="val">${modalState.proxyPersonName || modalState.currentEmployeeName || '当前社员'}</span>
                    </div>
                    <div class="yn-bem-dashboard-field">
                        <span class="label">归属项目:</span>
                        <span class="val" style="color:#0284c7; font-weight:600;">${modalState.projectName || '未指定'}</span>
                    </div>
                    <div class="yn-bem-dashboard-field" style="grid-column: span 2;">
                        <span class="label">包含类型:</span>
                        <span class="val">${Array.from(new Set(nonTripItems.map(g => g.newExpenseTypeName || g.expenseTypeName))).join('、')}</span>
                    </div>
                </div>
            </div>
        `;
    }

    overlay.innerHTML = `
        <div class="yn-bem-decision-modal">
            <div class="yn-bem-decision-modal-header">
                <div>
                    <h2 class="title">🚀 全景报销决策复核与极速建单看板 (HITL)</h2>
                    <p class="subtitle">人类在回路复核确认：核验出差申请单 (SC) 预算与各报销单 (BC/BJ) 分流。点击下方一键极速创建草稿入库（刚性锁定 commit: false 保存草稿，绝不提交审批）。</p>
                </div>
                <button type="button" class="yn-bem-decision-modal-close" id="yn-bem-btn-close-dashboard">✕</button>
            </div>

            <div class="yn-bem-decision-modal-body">
                <div style="margin-bottom:16px;">
                    <h3 style="font-size:14px; font-weight:700; color:#171717; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                        <span>🛫 异地出差轮次与申请单 (SC / BC) 规划</span>
                        <span style="font-size:12px; color:#737373; font-weight:normal;">(共 ${tripPlans.length} 轮出差)</span>
                    </h3>
                    ${tripsHtml}
                </div>

                ${nonTripItems.length > 0 ? `
                    <div style="margin-bottom:16px;">
                        <h3 style="font-size:14px; font-weight:700; color:#171717; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                            <span>🏢 日常办公与市内经费 (BJ) 规划</span>
                            <span style="font-size:12px; color:#737373; font-weight:normal;">(共 ${nonTripItems.length} 笔)</span>
                        </h3>
                        ${nonTripHtml}
                    </div>
                ` : ''}
            </div>

            <div class="yn-bem-decision-modal-footer">
                <div class="yn-bem-dashboard-status" id="yn-bem-dashboard-status">
                    就绪：请复核上述出差单与报销单方案，确认无误后点击右侧按钮极速入库。
                </div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <button type="button" class="yn-bem-btn yn-bem-btn-secondary" id="yn-bem-btn-cancel-dashboard">
                        返回表格复核
                    </button>
                    <button type="button" class="yn-bem-btn yn-bem-btn-autopilot-execute" id="yn-bem-btn-execute-autopilot">
                        ⚡ 一键极速创建草稿入库 (commit: false)
                    </button>
                </div>
            </div>
        </div>
    `;

    targetDoc.body.appendChild(overlay);

    // Bind Close
    const closeDashboard = () => overlay.remove();
    overlay.querySelector('#yn-bem-btn-close-dashboard')?.addEventListener('click', closeDashboard);
    overlay.querySelector('#yn-bem-btn-cancel-dashboard')?.addEventListener('click', closeDashboard);

    // Bind Dashboard In-place Edit and Report Clicks
    overlay.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const editBtn = target.closest<HTMLElement>('[data-dashboard-edit-trip]');
        if (editBtn && editBtn.dataset.dashboardEditTrip) {
            const tId = editBtn.dataset.dashboardEditTrip;
            openEditTripModal(tId, container);
            return;
        }
        const repBtn = target.closest<HTMLElement>('[data-dashboard-report-trip]');
        if (repBtn && repBtn.dataset.dashboardReportTrip) {
            const tId = repBtn.dataset.dashboardReportTrip;
            const t = tripPlans.find(p => p.id === tId);
            if (t) {
                const items = groups.filter(g => g.tripId === t.id);
                const md = generateTripReportMarkdown(t, items);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(md).then(() => {
                        showToast('success', `✨ 已复制 Trip ${t.tripNo} 出差报告草稿到剪贴板！`);
                    }).catch(() => {
                        copyFallback(md);
                        showToast('success', `✨ 已复制 Trip ${t.tripNo} 出差报告草稿到剪贴板！`);
                    });
                } else {
                    copyFallback(md);
                    showToast('success', `✨ 已复制 Trip ${t.tripNo} 出差报告草稿到剪贴板！`);
                }
            }
            return;
        }
    });

    // Bind Execute Pipeline
    const btnExec = overlay.querySelector<HTMLButtonElement>('#yn-bem-btn-execute-autopilot');
    const statusDiv = overlay.querySelector<HTMLElement>('#yn-bem-dashboard-status');

    btnExec?.addEventListener('click', async () => {
        if (!confirm('确认按照复核看板中的规划，一键自动创建出差申请单 (SC) 与报销单 (BC/BJ) 草稿吗？\\n\\n【安全承诺】：所有单据均以草稿形式保存在系统（commit: false），绝不自动提交审批。')) {
            return;
        }

        btnExec.disabled = true;
        btnExec.innerText = '正在极速入库...';

        try {
            // Step 1: 如果表格中有修改的费用记录，先批量保存费用记录更新
            const updates: ExpenseRecordUpdateItem[] = [];
            for (const g of modalState.groups) {
                const isDescChanged = g.newDescription !== undefined && g.newDescription !== g.description;
                const isDateChanged = g.newBusinessDate !== undefined && g.newBusinessDate !== g.businessDate;
                const isTypeChanged = Boolean(g.newExpenseTypeId && g.newExpenseTypeId !== g.expenseTypeId);
                const hasDynChanged = Boolean(g.dynamicFields && Object.keys(g.dynamicFields).length > 0);

                if (isDescChanged || isDateChanged || isTypeChanged || hasDynChanged) {
                    updates.push({
                        expenseRecordId: g.expenseRecordId,
                        targetExpenseTypeId: g.newExpenseTypeId || g.expenseTypeId,
                        targetExpenseTypeName: g.newExpenseTypeName || g.expenseTypeName,
                        newBusinessDate: g.newBusinessDate || g.businessDate,
                        newDescription: g.newDescription !== undefined ? g.newDescription : g.description,
                        dynamicFields: g.dynamicFields
                    });
                }
            }

            if (updates.length > 0) {
                if (statusDiv) statusDiv.innerHTML = `<span class="spinner"></span> 正在保存 ${updates.length} 笔修改后的费用记录...`;
                await batchUpdateExpenseRecordsApi(updates, globalState);
            }

            const resultsSummary: string[] = [];

            // Step 2: 为每个 Trip 生成 SC 申请单草稿，随后生成 BC 出差报销单草稿
            for (const trip of tripPlans) {
                if (statusDiv) statusDiv.innerHTML = `<span class="spinner"></span> 正在生成 Trip ${trip.tripNo} 出差申请单 (SC)...`;
                const scRes = await createSingleTripApplicationApi(trip, globalState);
                if (scRes.success && scRes.billCode) {
                    modalState.tripBillCodes[trip.id] = scRes.billCode;
                    resultsSummary.push(`Trip ${trip.tripNo} 出差申请单: ${scRes.billCode}`);
                } else {
                    throw new Error(`创建 Trip ${trip.tripNo} 出差申请单失败: ${scRes.message || '未知异常'}`);
                }

                // 收集该 Trip 下所有费用 ID
                const tripExpenseIds = groups.filter(g => g.tripId === trip.id).map(g => g.expenseRecordId);
                if (tripExpenseIds.length > 0) {
                    if (statusDiv) statusDiv.innerHTML = `<span class="spinner"></span> 正在生成 Trip ${trip.tripNo} 出差费用报销单 (BC) 关联 ${tripExpenseIds.length} 笔费用...`;
                    const bcRes = await createBillDataAndTemplateByExpenseIdListApi(
                        BILL_DEFINE_IDS.TRIP_CLAIM_BC,
                        tripExpenseIds,
                        globalState
                    );
                    if (bcRes?.billData) {
                        const savedBc = await saveBillDataApi(bcRes.billData, globalState);
                        const bcCode = savedBc?.billCode || bcRes.billData.billCode || 'BC草稿';
                        resultsSummary.push(`Trip ${trip.tripNo} 出差报销单: ${bcCode}`);
                    }
                }
            }

            // Step 3: 为日常费用生成 BJ 经费报销单草稿
            if (nonTripItems.length > 0) {
                const bjExpenseIds = nonTripItems.map(g => g.expenseRecordId);
                if (statusDiv) statusDiv.innerHTML = `<span class="spinner"></span> 正在生成日常经费报销单 (BJ) 关联 ${bjExpenseIds.length} 笔费用...`;
                const bjRes = await createBillDataAndTemplateByExpenseIdListApi(
                    BILL_DEFINE_IDS.GENERAL_CLAIM_BJ,
                    bjExpenseIds,
                    globalState
                );
                if (bjRes?.billData) {
                    const savedBj = await saveBillDataApi(bjRes.billData, globalState);
                    const bjCode = savedBj?.billCode || bjRes.billData.billCode || 'BJ草稿';
                    modalState.tripBillCodes['NON_TRIP'] = bjCode;
                    resultsSummary.push(`日常经费报销单: ${bjCode}`);
                }
            }

            if (statusDiv) {
                statusDiv.innerHTML = `<span style="color:#15803d; font-weight:700;">🎉 全部单据草稿极速创建入库成功！(已保存为未提交草稿)</span>`;
            }
            btnExec.innerText = '✅ 入库成功';

            showToast('success', `🎉 全流程草稿已全部生成入库！共生成 ${resultsSummary.length} 张单据。\n请在系统【我的申请】/【我的报销】中复核`, 8000);

            refreshTableView(container);
            setTimeout(() => {
                closeDashboard();
            }, 2500);

        } catch (err: any) {
            AutopilotLogger.error(`[Autopilot Pipeline] 入库异常: ${err.message}`);
            if (statusDiv) {
                statusDiv.innerHTML = `<span style="color:#dc2626; font-weight:700;">❌ 入库失败: ${err.message || '网络或接口异常'}</span>`;
            }
            btnExec.disabled = false;
            btnExec.innerText = '重试极速建单';
            showToast('error', `极速建单失败: ${err.message || '网络或接口异常'}`);
        }
    });
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
async function handleAiInference(
    container: HTMLElement,
    itineraryText?: string,
    onProgress?: (status: string) => void
): Promise<string> {
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
            return '当前筛选视图中无任何费用记录可供推断';
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
                    onProgress?.(status);
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

        let resultSummary = '';
        if (llmInferredCount > 0) {
            resultSummary = `规则提取 ${ruleInferredCount} 项，大模型精准推理 ${llmInferredCount} 项`;
            showToast('success', `✨ AI 智能推断完成：规则提取 ${ruleInferredCount} 项，大模型精准推理 ${llmInferredCount} 项！`);
        } else if (ruleInferredCount > 0) {
            resultSummary = `基于证据链提取 ${ruleInferredCount} 项`;
            if (!isLlmConfigured()) {
                showToast('success', `✨ 已提取 ${ruleInferredCount} 项！(在设置中配置大模型 API Key 可启用跨行程与排期深度推断)`);
            } else {
                showToast('success', `✨ 已基于发票证据链提取 ${ruleInferredCount} 项字段！`);
            }
        } else {
            resultSummary = '所选记录的专属字段已全部完整，无需额外推断';
            showToast('info', resultSummary);
        }
        return resultSummary;
    } catch (err: any) {
        AutopilotLogger.error(`[AiInference] 智能推断异常: ${err?.message || err}`);
        showToast('error', `推断失败: ${err.message || '未知异常'}`);
        return `推断失败: ${err?.message || '未知异常'}`;
    } finally {
        if (aiBtn) {
            aiBtn.disabled = false;
            aiBtn.innerHTML = origBtnHtml || `✨ AI 智能推断`;
        }
    }
}

export type RefreshMode = 'FULL' | 'ROWS' | 'STATS' | 'CHECKBOXES';

let pendingRafId: number | null = null;

/**
 * requestAnimationFrame 防抖节流刷新
 */
function debouncedRefresh(container: HTMLElement, mode: RefreshMode = 'STATS') {
    if (pendingRafId) cancelAnimationFrame(pendingRafId);
    pendingRafId = requestAnimationFrame(() => {
        refreshTableView(container, mode);
        pendingRafId = null;
    });
}

/**
 * 局部增量同步所有 Checkbox 勾选与半选状态 (纯 DOM 操作，耗时 < 5ms)
 */
function updateAllCheckboxStates(container: HTMLElement): void {
    const filtered = getFilteredGroups(modalState);
    const selectedInFiltered = filtered.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));

    // 1. 同步行 Checkbox & tr 行高亮状态 (解决 BUG 1: 取消选择后行依然残留高亮与勾选)
    container.querySelectorAll<HTMLInputElement>('.yn-bem-record-cb').forEach(cb => {
        const rid = cb.dataset.recordid;
        if (rid) {
            cb.checked = modalState.selectedRecordIds.has(rid);
        }
    });

    // 确保所有数据行 (包含多发票明细行) 同步 is-selected class
    container.querySelectorAll<HTMLElement>('tr.yn-bem-data-row').forEach(tr => {
        const rid = tr.dataset.recordid;
        if (rid) {
            tr.classList.toggle('is-selected', modalState.selectedRecordIds.has(rid));
        }
    });

    // 2. 同步分组 Checkbox
    container.querySelectorAll<HTMLInputElement>('.yn-bem-group-cb').forEach(cb => {
        const groupKey = cb.dataset.groupKey;
        if (!groupKey) return;
        const tbody = container.querySelector<HTMLElement>(`tbody[data-group-key="${groupKey}"]`);
        if (!tbody) return;
        const rowCbs = Array.from(tbody.querySelectorAll<HTMLInputElement>('.yn-bem-record-cb'));
        const total = rowCbs.length;
        const checkedCount = rowCbs.filter(c => c.checked).length;
        cb.checked = total > 0 && checkedCount === total;
        cb.indeterminate = checkedCount > 0 && checkedCount < total;
    });

    // 3. 同步表头全选 Checkbox
    const thAll = container.querySelector<HTMLInputElement>('#yn-bem-th-select-all');
    if (thAll) {
        thAll.checked = filtered.length > 0 && selectedInFiltered.length === filtered.length;
        thAll.indeterminate = selectedInFiltered.length > 0 && selectedInFiltered.length < filtered.length;
    }
}

/**
 * 增量刷新底部悬浮操作岛 (Floating Action Island - Linear/Stripe Grade)
 */
function updateFloatingIsland(container: HTMLElement): void {
    const island = container.querySelector<HTMLElement>('#yn-bem-floating-island');
    if (!island) return;
    const selectedCount = modalState.selectedRecordIds.size;
    if (selectedCount === 0) {
        island.classList.add('is-hidden');
    } else {
        island.classList.remove('is-hidden');
        const selectedGroups = modalState.groups.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));
        const totalAmount = Decimal.sum(selectedGroups, g => g.expenseAmount).toFixed(2);
        const statEl = island.querySelector('.yn-bem-island-stat');
        if (statEl) {
            statEl.innerHTML = `<span>已选 <strong>${selectedCount}</strong> 项</span><span class="island-amount">¥${totalAmount}</span>`;
        }
    }
}

/**
 * 打开居中专注批量设置弹窗
 */
function openBatchSettingsDialog(container: HTMLElement): void {
    modalState.batchSettingsDialogOpen = true;
    let wrap = container.querySelector<HTMLElement>('#yn-bem-batch-dialog-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'yn-bem-batch-dialog-wrap';
        container.appendChild(wrap);
    }
    wrap.innerHTML = renderBatchSettingsDialogHtml();
    bindBatchSettingsEvents(container);

    // 弹窗右上角关闭与遮罩点击事件
    wrap.querySelector('#yn-bem-dialog-close')?.addEventListener('click', () => closeBatchSettingsDialog(container));
    wrap.querySelector('#yn-bem-dialog-cancel')?.addEventListener('click', () => closeBatchSettingsDialog(container));
    wrap.querySelector('#yn-bem-batch-dialog-mask')?.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).id === 'yn-bem-batch-dialog-mask') {
            closeBatchSettingsDialog(container);
        }
    });
}

/**
 * 关闭居中批量设置弹窗
 */
function closeBatchSettingsDialog(container: HTMLElement): void {
    modalState.batchSettingsDialogOpen = false;
    const wrap = container.querySelector<HTMLElement>('#yn-bem-batch-dialog-wrap');
    if (wrap) {
        wrap.innerHTML = '';
    }
}

/**
 * 增量刷新底部统计栏与说明实时预览
 */
function updateStatsAndFooter(container: HTMLElement): void {
    const stats = container.querySelector('#yn-bem-footer-stats');
    if (stats) {
        stats.innerHTML = renderFooterStatsHtml();
    }
    updateFooterActionButtons(container);
    updateFloatingIsland(container);
    const pill = container.querySelector('#yn-bem-preview-pill');
    if (pill) {
        pill.textContent = computeFormattedDescription(modalState, modalState.groups[0]);
    }
}

/**
 * 增量同步 AI 助手面板与 Composer 中的费用上下文药丸徽章
 */
function updateAiContextPill(container: HTMLElement): void {
    const selectedCount = modalState.selectedRecordIds.size;
    const selectedGroups = modalState.groups.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));
    const totalAmount = Decimal.sum(selectedGroups, g => g.expenseAmount);

    // 1. 同步旧版欢迎区 context-pill (若存在)
    const pill = container.querySelector<HTMLElement>('#yn-gemini-context-pill');
    if (pill) {
        if (selectedCount === 0) {
            pill.className = 'yn-gemini-context-pill has-no-selection';
            pill.innerHTML = `<span>📎 当前未勾选费用 (支持快捷全选)</span>`;
        } else {
            pill.className = 'yn-gemini-context-pill';
            pill.innerHTML = `
                <span>📎 已携带 <strong>${selectedCount}</strong> 笔已选费用数据</span>
                <span style="font-size:10px; color:#15803d; font-family:ui-monospace, monospace;">¥${totalAmount.toFixed(2)}</span>
            `;
        }
    }

    // 2. 同步 Gemini Composer 卡片顶部的上下文芯片 (Screenshot 3)
    const composerHeader = container.querySelector<HTMLElement>('.yn-gemini-composer-header');
    if (composerHeader) {
        if (modalState.attachedExpenseContextEnabled && selectedCount > 0) {
            composerHeader.style.display = 'flex';
            composerHeader.innerHTML = `
                <div class="yn-gemini-composer-context-chip" id="yn-gemini-composer-context-chip">
                    <span>📎 已选中费用条目 <strong>${selectedCount}</strong> 笔，金额 ¥${totalAmount.toFixed(2)}</span>
                    <span class="yn-gemini-chip-dismiss" id="yn-gemini-chip-dismiss" title="从本次输入中移除费用上下文">✕</span>
                </div>
            `;
            composerHeader.querySelector('#yn-gemini-chip-dismiss')?.addEventListener('click', (e) => {
                e.stopPropagation();
                modalState.attachedExpenseContextEnabled = false;
                composerHeader.style.display = 'none';
                composerHeader.innerHTML = '';
            });
        } else {
            composerHeader.style.display = 'none';
            composerHeader.innerHTML = '';
        }
    }
}

/**
 * 精细度分级视图刷新函数 (4级模式：FULL / ROWS / STATS / CHECKBOXES)
 */
function refreshTableView(container: HTMLElement, mode: RefreshMode = 'ROWS') {
    // 强制执行筛选联动裁剪，确保当前选择集合 100% 同步当前视图，彻底杜绝幽灵提交
    pruneSelectedRecordIds();

    if (mode === 'CHECKBOXES') {
        updateAllCheckboxStates(container);
        updateStatsAndFooter(container);
        updateAiContextPill(container);
        batchEditEventBus.publish({
            type: 'SELECTION_CHANGED',
            payload: {
                selectedIds: modalState.selectedRecordIds,
                count: modalState.selectedRecordIds.size,
                totalAmount: Decimal.sum(
                    modalState.groups.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId)),
                    g => g.expenseAmount
                ).toNumber()
            }
        });
        return;
    }

    if (mode === 'STATS') {
        updateStatsAndFooter(container);
        updateAiContextPill(container);
        return;
    }

    if (mode === 'FULL') {
        renderModalContent(container, container.ownerDocument);
        return;
    }

    // Default 'ROWS' mode:
    const wrap = container.querySelector('#yn-bem-table-wrap');
    if (wrap) {
        wrap.innerHTML = renderTableHtml();
        updateAllCheckboxStates(container);
    }
    updateStatsAndFooter(container);
    updateAiContextPill(container);

    const cardWrap = container.querySelector('#yn-bem-dynamic-fields-card');
    if (cardWrap && !modalState.targetExpenseTypeId) {
        cardWrap.outerHTML = renderDynamicFieldsCardHtml();
        bindDynamicCardEvents(container);
    }
    const activeFiltersWrap = container.querySelector('#yn-bem-active-filters-wrap');
    if (activeFiltersWrap) {
        activeFiltersWrap.innerHTML = renderActiveFilterTagsHtml();
    }

    const quickWrap = container.querySelector<HTMLElement>('.yn-bem-quick-select-wrap');
    if (quickWrap) {
        const totalGroups = modalState.groups.length;
        const warnCount = modalState.groups.filter(g => g.hasWarn).length;
        const missingRequiredCount = modalState.groups.filter(g => isGroupMissingRequired(g)).length;
        const saveErrorCount = modalState.saveErrors ? modalState.saveErrors.size : 0;

        quickWrap.innerHTML = `
            <span class="yn-bem-quick-link" id="yn-bem-qa-select-all">全选</span>
            <span class="yn-bem-quick-link" id="yn-bem-qa-deselect">全不选</span>
            <span class="yn-bem-quick-link" id="yn-bem-qa-invert">反选</span>
            ${saveErrorCount > 0 ? `<span class="yn-bem-quick-link" id="yn-bem-qa-select-failed" style="color:#b91c1c; border-color:#fca5a5; background:#fef2f2; font-weight:700;">❌ 仅看失败 (${saveErrorCount})</span>` : ''}
            ${missingRequiredCount > 0 ? `<span class="yn-bem-quick-link" id="yn-bem-qa-select-missing" style="color:#dc2626; border-color:#fee2e2; background:#fef2f2;">仅选待补 (${missingRequiredCount})</span>` : ''}
            ${warnCount > 0 ? `<span class="yn-bem-quick-link" id="yn-bem-qa-select-warn" style="color:#b45309; border-color:#fef3c7; background:#fffbeb;">仅选预警 (${warnCount})</span>` : ''}

            <select id="yn-bem-filter-mode" class="yn-bem-select" style="font-size:11px; padding:2px 6px; margin-left:2px;">
                ${saveErrorCount > 0 ? `<option value="SAVE_ERROR" ${modalState.filterMode === 'SAVE_ERROR' ? 'selected' : ''}>❌ 保存失败 (${saveErrorCount})</option>` : ''}
                <option value="ALL" ${modalState.filterMode === 'ALL' ? 'selected' : ''}>全部 (${totalGroups})</option>
                <option value="MISSING_REQUIRED" ${modalState.filterMode === 'MISSING_REQUIRED' ? 'selected' : ''}>待补必填 (${missingRequiredCount})</option>
                <option value="WARN" ${modalState.filterMode === 'WARN' ? 'selected' : ''}>预警 (${warnCount})</option>
                <option value="OK" ${modalState.filterMode === 'OK' ? 'selected' : ''}>正常 (${totalGroups - warnCount - missingRequiredCount})</option>
            </select>
        `;
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
/**
 * 绑定批量设置弹出面板内部事件
 */
function bindBatchSettingsEvents(container: HTMLElement) {
    const win = container.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const globalState = getInvoicePoolGlobalState();

    // 1. 出差模式与报销类型
    const optTrip = container.querySelector<HTMLSelectElement>('#yn-bem-opt-trip');
    optTrip?.addEventListener('change', () => {
        modalState.isTrip = optTrip.value === 'true';
        refreshTableView(container, 'STATS');
    });

    const optProxy = container.querySelector<HTMLSelectElement>('#yn-bem-opt-proxy');
    const groupProxyName = container.querySelector<HTMLElement>('#yn-bem-group-proxy-name');
    optProxy?.addEventListener('change', () => {
        modalState.isProxy = optProxy.value === 'true';
        if (groupProxyName) {
            groupProxyName.style.display = modalState.isProxy ? 'inline-flex' : 'none';
        }
        refreshTableView(container, 'STATS');
    });

    // 2. 变更报销类型下拉监听
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

    // 3. 代报销外驻人名
    const inputName = container.querySelector<HTMLInputElement>('#yn-bem-input-proxy-name');
    inputName?.addEventListener('input', () => {
        modalState.proxyPersonName = inputName.value;
        debouncedRefresh(container, 'STATS');
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
                        refreshTableView(container, 'STATS');
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
        debouncedRefresh(container, 'STATS');
    });

    inputProject?.addEventListener('focus', () => {
        if (inputProject.value.trim()) {
            performProjectSearch(inputProject.value);
        }
    });

    // 5. 自定义备注
    const inputRemark = container.querySelector<HTMLInputElement>('#yn-bem-input-remark');
    inputRemark?.addEventListener('input', () => {
        modalState.customRemark = inputRemark.value;
        debouncedRefresh(container, 'STATS');
    });

    // 6. 批量业务日期
    const inputBizDate = container.querySelector<HTMLInputElement>('#yn-bem-input-biz-date');
    inputBizDate?.addEventListener('change', () => {
        modalState.batchBusinessDate = inputBizDate.value;
    });

    // 7. 快捷同步最早开票日
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

        refreshTableView(container, 'ROWS');
        showToast('success', `已将 ${isFiltering ? '当前筛选内已选 ' : ''}${updated} 笔费用的业务日期同步为其最早开票日期`);
    });

    // 8. 格式预设按钮与模板微调 (Segmented Control)
    const inputTemplate = container.querySelector<HTMLInputElement>('#yn-bem-input-template');
    inputTemplate?.addEventListener('input', () => {
        modalState.formatTemplate = inputTemplate.value;
        container.querySelectorAll('.yn-bem-preset-btn').forEach(b => {
            b.classList.toggle('active', (b as HTMLElement).dataset.tpl === inputTemplate.value);
        });
        debouncedRefresh(container, 'STATS');
    });

    container.querySelectorAll('.yn-bem-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tpl = (btn as HTMLElement).dataset.tpl;
            if (tpl) {
                modalState.formatTemplate = tpl;
                if (inputTemplate) inputTemplate.value = tpl;
                container.querySelectorAll('.yn-bem-preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                refreshTableView(container, 'STATS');
            }
        });
    });

    // 9. 补齐交通始发/目的地
    const chkFillAddr = container.querySelector<HTMLInputElement>('#yn-bem-chk-fill-addr');
    chkFillAddr?.addEventListener('change', () => {
        modalState.fillAddresses = chkFillAddr.checked;
    });

    // 10. AI 智能推断按钮 (面板内)
    container.querySelector('#yn-bem-btn-ai-infer')?.addEventListener('click', () => {
        handleAiInference(container);
    });

    // 11. 批量应用按钮 (支持面板与独立居中弹窗)
    const handleApply = () => {
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

        const applyDesc = container.querySelector<HTMLInputElement>('#yn-bem-chk-apply-desc')?.checked ?? true;
        const applyType = container.querySelector<HTMLInputElement>('#yn-bem-chk-apply-type')?.checked ?? false;
        const applyDate = container.querySelector<HTMLInputElement>('#yn-bem-chk-apply-date')?.checked ?? false;

        if (!applyDesc && !applyType && !applyDate) {
            showToast('warning', '请至少勾选一个需要批量设置的模块（说明 / 类型 / 日期）');
            return;
        }

        let updatedCount = 0;
        targetGroups.forEach(group => {
            if (applyDesc) {
                group.newDescription = computeFormattedDescription(modalState, group);
            }
            if (applyDate) {
                if (modalState.batchBusinessDate) {
                    group.newBusinessDate = modalState.batchBusinessDate;
                }
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
            }
            if (applyType) {
                if (modalState.targetExpenseTypeId) {
                    group.newExpenseTypeId = modalState.targetExpenseTypeId;
                    group.newExpenseTypeName = modalState.targetExpenseTypeName;
                }
                const dynValues = { ...modalState.dynamicFields };
                const hasAnyDyn = Object.values(dynValues).some(v => v !== undefined && v !== '' && v !== 0);
                if (hasAnyDyn) {
                    group.dynamicFields = { ...(group.dynamicFields || {}), ...dynValues };
                }
            }
            updatedCount++;
        });

        refreshTableView(container, 'ROWS');
        closeBatchSettingsDialog(container);
        showToast('success', `成功应用到 ${isFiltering ? '当前筛选内已选 ' : '已选 '}${updatedCount} 笔费用！请核验后保存`);
    };

    container.querySelector('#yn-bem-btn-apply')?.addEventListener('click', handleApply);
    container.querySelector('#yn-bem-dialog-apply')?.addEventListener('click', handleApply);

    // 绑定专属字段卡片内部事件
    bindDynamicCardEvents(container);
}

/**
 * 绑定 AI 侧边栏拖拽调整宽度把手
 */
function bindAiPanelResizer(container: HTMLElement) {
    const aiWrap = container.querySelector<HTMLElement>('#yn-bem-ai-panel-wrap');
    const resizer = container.querySelector<HTMLElement>('#yn-bem-ai-resizer');
    if (resizer && aiWrap) {
        let isResizing = false;

        const onMouseDown = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            isResizing = true;
            resizer.classList.add('is-resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            const onMouseMove = (moveEv: MouseEvent) => {
                if (!isResizing) return;
                const winWidth = window.innerWidth;
                let newWidth = winWidth - moveEv.clientX;
                const minWidth = 320;
                const maxWidth = Math.round(winWidth * 0.85);
                if (newWidth < minWidth) newWidth = minWidth;
                if (newWidth > maxWidth) newWidth = maxWidth;

                modalState.aiPanelWidth = newWidth;
                aiWrap.style.width = `${newWidth}px`;
            };

            const onMouseUp = () => {
                if (isResizing) {
                    isResizing = false;
                    resizer.classList.remove('is-resizing');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    try {
                        localStorage.setItem('yn_fssc_ai_panel_width', String(modalState.aiPanelWidth));
                    } catch (err) {}
                }
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        resizer.addEventListener('mousedown', onMouseDown);
    }
}

/**
 * 收起 AI 侧边栏
 */
function closeAiPanel(container: HTMLElement) {
    modalState.aiPanelOpen = false;
    const aiWrap = container.querySelector<HTMLElement>('#yn-bem-ai-panel-wrap');
    if (aiWrap) {
        aiWrap.classList.remove('is-open');
    }
    const btnToggle = container.querySelector<HTMLButtonElement>('#yn-bem-btn-toggle-ai');
    if (btnToggle) {
        btnToggle.classList.remove('is-active');
        btnToggle.innerHTML = `<span class="yn-gemini-sparkle-icon">✦</span> AI 助手 ✨`;
    }
}

/**
 * 全流程智能规划 (行程与日常)
 */
async function runAutopilotPlan(container: HTMLElement) {
    const cmdText = (modalState.autopilotCommandText || '').trim();
    let detectedTrips: DynamicTripInput[] = [];
    if (cmdText) {
        const prjMatch = cmdText.match(/(X\d{4}-\d{3}|[A-Z0-9]{2,8}-\d{3,4}|PRJ-[A-Z0-9\-]+)/i);
        if (prjMatch) modalState.projectName = prjMatch[1].trim().toUpperCase();
        const proxyMatch = cmdText.match(/(?:代|外驻)[:\s]*([^\s,，。]+)/);
        if (proxyMatch) {
            modalState.isProxy = true;
            modalState.proxyPersonName = proxyMatch[1].trim();
        }
        try {
            if (cmdText.length >= 20 && (cmdText.includes('\n') || cmdText.includes('\t') || cmdText.includes('据点') || cmdText.includes('出差'))) {
                detectedTrips = await parseItineraryWithAi(cmdText);
            }
            if (!detectedTrips || detectedTrips.length === 0) {
                detectedTrips = parseItineraryTable(cmdText);
            }
        } catch (e) {
            detectedTrips = [];
        }
    }

    clusterExpensesIntoTrips(
        modalState.groups,
        modalState.proxyPersonName || modalState.currentEmployeeName,
        modalState.projectName,
        detectedTrips.length > 0 ? detectedTrips : undefined
    );

    modalState.groupingMode = 'TRIP';
    const optGrouping = container.querySelector<HTMLSelectElement>('#yn-bem-opt-grouping');
    if (optGrouping) optGrouping.value = 'TRIP';
    modalState.collapsedGroupKeys.clear();
    refreshTableView(container, 'ROWS');

    const planMsg = detectedTrips.length > 0
        ? `已精准识别出差排期 ${detectedTrips.length} 轮 Trip 并划分区间，正在打开决策复核看板...`
        : `已自动识别 ${modalState.tripPlans.length} 轮出差 Trip 及日常费用，正在打开决策复核看板...`;

    showToast('success', `✨ ${planMsg}`, 3000);
    setTimeout(() => {
        openAutopilotDecisionDashboard(container);
    }, 500);
}

/**
 * 处理 Assistant 对话发送与 Agentic 执行
 */
async function handleAssistantSendMessage(
    container: HTMLElement,
    text: string,
    attachments: ChatAttachment[]
) {
    const curSession = modalState.chatSessions.find(s => s.id === modalState.currentSessionId) || modalState.chatSessions[0];
    if (!curSession) return;

    // 首条消息自动重命名会话标题
    if (curSession.title === '新对话' || curSession.title === '未命名会话' || curSession.messages.length === 0) {
        curSession.title = text.slice(0, 18) || (attachments[0] ? `附件: ${attachments[0].name.slice(0, 12)}` : '对话');
    }

    const selectedCount = modalState.selectedRecordIds.size;
    const selectedGroups = modalState.groups.filter(g => modalState.selectedRecordIds.has(g.expenseRecordId));
    const totalAmountDecimal = Decimal.sum(selectedGroups, g => g.expenseAmount);

    // 1. 添加用户消息
    const userMsg: ChatMessage = {
        id: `msg_${Date.now()}_u`,
        role: 'user',
        text: text || (attachments.length > 0 ? `[上传了 ${attachments.length} 个附件/图片]` : ''),
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        attachments: attachments.length > 0 ? attachments : undefined,
        expenseContext: (modalState.attachedExpenseContextEnabled && selectedCount > 0)
            ? { count: selectedCount, totalAmount: totalAmountDecimal.toNumber() }
            : undefined
    };
    curSession.messages.push(userMsg);
    curSession.updatedAt = Date.now();
    saveChatSessionsToStorage(modalState.chatSessions);
    renderAssistantChat(container);

    // 2. 意图分流与助理回复
    const lowerText = text.toLowerCase();
    const isInfer = modalState.activeSkillId === 'infer' || lowerText.includes('推断') || lowerText.includes('infer') || lowerText.includes('必填');
    const isItin = modalState.activeSkillId === 'itinerary' || lowerText.includes('排期') || lowerText.includes('行程');
    const hasSchedule = text.length >= 20 && (text.includes('\n') || text.includes('\t') || text.includes('|') || /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text));

    modalState.activeSkillId = null;
    modalState.isAssistantExecuting = true;
    renderAssistantChat(container);

    if (isItin || hasSchedule) {
        const usingLlm = isLlmConfigured();
        const startTime = Date.now();
        const assistMsg: ChatMessage = {
            id: `msg_${Date.now()}_a`,
            role: 'assistant',
            text: '',
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            thinking: {
                content: usingLlm
                    ? `正在运用大语言模型解析您的出差排期，对齐往返闭环并聚类行程轮次 (Trips)...`
                    : `正在运用本地轻量规则引擎分析排期并聚类行程轮次 (Trips)...`,
                status: 'thinking',
                durationMs: 0,
                isExpanded: true
            },
            toolCalls: [
                {
                    id: 'tool_parse_itin',
                    name: 'parseItineraryWithAiDetailed',
                    title: '出差排期深度认知解析与闭环规划',
                    icon: '📋',
                    status: 'running',
                    progress: usingLlm ? '正在通过大模型进行多轮常识与行程推理...' : '正在通过本地规则提取出行要素...'
                }
            ]
        };
        curSession.messages.push(assistMsg);
        curSession.updatedAt = Date.now();
        saveChatSessionsToStorage(modalState.chatSessions);
        renderAssistantChat(container);

        try {
            const parseResult = await parseItineraryWithAiDetailed(text);
            const detectedTrips = parseResult.trips;
            const duration = Date.now() - startTime;

            assistMsg.thinking = {
                content: `排期解析完成：共识别 ${detectedTrips.length} 轮往返 Trip，完成客观据点与闭环常识对齐。`,
                status: 'done',
                durationMs: duration,
                isExpanded: false
            };

            const itinTool = assistMsg.toolCalls?.find(t => t.id === 'tool_parse_itin');
            if (itinTool) {
                itinTool.status = 'done';
                itinTool.progress = undefined;
                itinTool.output = { tripCount: detectedTrips.length, trips: detectedTrips.map(t => ({ tripNo: t.tripNo, dest: t.destination, start: t.startDate, end: t.endDate })) };
            }

            assistMsg.text = parseResult.summaryMarkdown;
            curSession.updatedAt = Date.now();
            saveChatSessionsToStorage(modalState.chatSessions);
            renderAssistantChat(container);

            if (detectedTrips.length > 0) {
                clusterExpensesIntoTrips(
                    modalState.groups,
                    modalState.proxyPersonName || modalState.currentEmployeeName,
                    modalState.projectName,
                    detectedTrips
                );
                modalState.groupingMode = 'TRIP';
                const groupSelect = container.querySelector<HTMLSelectElement>('#yn-bem-grouping-select');
                if (groupSelect) groupSelect.value = 'TRIP';
                refreshTableView(container);

                // 随后异步启动专属必填字段推断，提供实时进度流式反馈
                const inferTool: ChatToolCall = {
                    id: 'tool_infer_fields',
                    name: 'inferRequiredFields',
                    title: '发票专属必填字段智能推断',
                    icon: '🔮',
                    status: 'running',
                    progress: '正在初始化发票 OCR 票据链与行程对齐...'
                };
                assistMsg.toolCalls = assistMsg.toolCalls || [];
                assistMsg.toolCalls.push(inferTool);
                renderAssistantChat(container);

                setTimeout(() => {
                    handleAiInference(container, text, (progress) => {
                        inferTool.progress = progress;
                        renderAssistantChat(container);
                    }).then((inferSummary) => {
                        inferTool.status = 'done';
                        inferTool.progress = undefined;
                        inferTool.output = inferSummary;
                        assistMsg.text = `${parseResult.summaryMarkdown}\n\n---\n✅ **专属字段推断就绪**：${inferSummary}。\n您可直接在大表格中复核每笔明细，或点击保存。`;
                        modalState.isAssistantExecuting = false;
                        curSession.updatedAt = Date.now();
                        saveChatSessionsToStorage(modalState.chatSessions);
                        renderAssistantChat(container);
                    }).catch((err) => {
                        inferTool.status = 'error';
                        inferTool.progress = undefined;
                        inferTool.output = err?.message || String(err);
                        assistMsg.text = `${parseResult.summaryMarkdown}\n\n---\n⚠️ **专属字段推断提示**：${err?.message || err}`;
                        modalState.isAssistantExecuting = false;
                        curSession.updatedAt = Date.now();
                        saveChatSessionsToStorage(modalState.chatSessions);
                        renderAssistantChat(container);
                    });
                }, 300);
            } else {
                modalState.isAssistantExecuting = false;
                renderAssistantChat(container);
            }
        } catch (err: any) {
            if (assistMsg.thinking) {
                assistMsg.thinking.status = 'done';
                assistMsg.thinking.durationMs = Date.now() - startTime;
            }
            const itinTool = assistMsg.toolCalls?.find(t => t.id === 'tool_parse_itin');
            if (itinTool) {
                itinTool.status = 'error';
                itinTool.output = err?.message || String(err);
            }
            assistMsg.text = `排期解析异常: ${err?.message || '未知错误'}`;
            modalState.isAssistantExecuting = false;
            curSession.updatedAt = Date.now();
            saveChatSessionsToStorage(modalState.chatSessions);
            renderAssistantChat(container);
        }
    } else if (isInfer) {
        const inferTool: ChatToolCall = {
            id: 'tool_infer_fields',
            name: 'inferRequiredFields',
            title: `推断所选 ${selectedCount} 笔费用的专属必填项`,
            icon: '🔮',
            status: 'running',
            progress: '正在穿透票据 OCR 链条并推导往返行程与住宿明细...'
        };
        const assistMsg: ChatMessage = {
            id: `msg_${Date.now()}_a`,
            role: 'assistant',
            text: `已为您启动对已选 **${selectedCount}** 笔费用的专属必填字段智能推断！正在穿透票据 OCR 链条并推导往返行程与住宿明细...`,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            toolCalls: [inferTool]
        };
        curSession.messages.push(assistMsg);
        curSession.updatedAt = Date.now();
        saveChatSessionsToStorage(modalState.chatSessions);
        renderAssistantChat(container);

        setTimeout(() => {
            handleAiInference(container, undefined, (progress) => {
                inferTool.progress = progress;
                renderAssistantChat(container);
            }).then((inferSummary) => {
                inferTool.status = 'done';
                inferTool.progress = undefined;
                inferTool.output = inferSummary;
                assistMsg.text = `✨ **专属必填字段智能推断完成**！\n• ${inferSummary}\n• 您可在大表格中复核推断结果并点击保存。`;
                modalState.isAssistantExecuting = false;
                curSession.updatedAt = Date.now();
                saveChatSessionsToStorage(modalState.chatSessions);
                renderAssistantChat(container);
            }).catch((err) => {
                inferTool.status = 'error';
                inferTool.progress = undefined;
                inferTool.output = err?.message || String(err);
                assistMsg.text = `⚠️ **推断异常**：${err?.message || err}`;
                modalState.isAssistantExecuting = false;
                curSession.updatedAt = Date.now();
                saveChatSessionsToStorage(modalState.chatSessions);
                renderAssistantChat(container);
            });
        }, 300);
    } else if (lowerText.includes('外驻') || lowerText.includes('代报销') || /x\d{4}-\d{3}/i.test(text)) {
        const prjMatch = text.match(/(X\d{4}-\d{3}|[A-Z0-9]{2,8}-\d{3,4}|PRJ-[A-Z0-9\-]+)/i);
        if (prjMatch) modalState.projectName = prjMatch[1].trim().toUpperCase();
        const proxyMatch = text.match(/(?:代|外驻)[:\s]*([^\s,，。]+)/);
        if (proxyMatch) {
            modalState.isProxy = true;
            modalState.proxyPersonName = proxyMatch[1].trim();
        }
        const assistMsg: ChatMessage = {
            id: `msg_${Date.now()}_a`,
            role: 'assistant',
            text: `已解析批量参数：\n• **项目代码**：\`${modalState.projectName || '未指定'}\`\n• **外驻社员**：\`${modalState.proxyPersonName || '无'}\`\n• 费用说明模板已同步更新为：\`${computeFormattedDescription(modalState, modalState.groups[0])}\`。\n您可以点击底部悬浮岛的【批量设置】将其应用到已勾选记录。`,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };
        curSession.messages.push(assistMsg);
        curSession.updatedAt = Date.now();
        modalState.isAssistantExecuting = false;
        saveChatSessionsToStorage(modalState.chatSessions);
        renderAssistantChat(container);
        refreshTableView(container, 'STATS');
    } else {
        const warnCount = modalState.groups.filter(g => g.hasWarn).length;
        const missingCount = modalState.groups.filter(g => isGroupMissingRequired(g)).length;
        const assistMsg: ChatMessage = {
            id: `msg_${Date.now()}_a`,
            role: 'assistant',
            text: `已收到您的指令：\n\n**当前费控账目快照**：\n• 费用总笔数：**${modalState.groups.length}** 笔 (已选 **${selectedCount}** 笔，总额 ¥**${totalAmountDecimal.toFixed(2)}**)\n• 必填待补项目：**${missingCount}** 笔\n• 日期预警项目：**${warnCount}** 处\n\n您可以随时告诉我：\n1. *"智能推断必填项"* 或键入 \`/infer\` — 自动提取交通与住宿专属字段\n2. *"规划出差行程"* 或键入 \`/itinerary\` — 按排期自动切分聚类 Trip\n3. *"外驻社员名 项目号"* 或键入 \`/proxy\` — 批量规范化生成企业费控说明`,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };
        curSession.messages.push(assistMsg);
        curSession.updatedAt = Date.now();
        modalState.isAssistantExecuting = false;
        saveChatSessionsToStorage(modalState.chatSessions);
        renderAssistantChat(container);
    }
}

function bindEvents(container: HTMLElement, doc: Document) {
    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    const globalState = getInvoicePoolGlobalState();

    // 1. 关闭按钮
    container.querySelector('#yn-bem-close-btn')?.addEventListener('click', closeBatchEditModal);
    container.querySelector('#yn-bem-btn-cancel')?.addEventListener('click', closeBatchEditModal);

    // 2. 独立批量修改属性居中弹窗触发
    container.querySelector('#yn-bem-btn-batch-dialog-trigger')?.addEventListener('click', () => {
        openBatchSettingsDialog(container);
    });

    // 2.1 兼容旧版折叠按钮 (若仍存在)
    const btnToggleSettings = container.querySelector<HTMLButtonElement>('#yn-bem-btn-toggle-settings');
    btnToggleSettings?.addEventListener('click', () => {
        openBatchSettingsDialog(container);
    });

    // 导出所选费用清单 CSV
    const executeExportSelected = () => {
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
    };

    // 确认保存到系统
    const executeSaveSelected = async () => {
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
            showToast('warning', '未检测到任何内容变动。请先批量修改属性或就地修改说明后再保存');
            return;
        }

        const typeChangeCount = updates.filter(u => Boolean(u.targetExpenseTypeId && u.targetExpenseTypeId !== u.originalExpenseTypeId)).length;

        // 保存前超标说明必填校验守卫
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

        const islandSaveBtn = container.querySelector<HTMLButtonElement>('#yn-bem-island-btn-save');
        if (islandSaveBtn) {
            islandSaveBtn.disabled = true;
            islandSaveBtn.innerText = `正在保存 (0/${updates.length})...`;
        }

        try {
            const res = await batchUpdateExpenseRecordsApi(
                updates,
                globalState,
                (curr, total) => {
                    if (islandSaveBtn) islandSaveBtn.innerText = `正在保存 (${curr}/${total})...`;
                },
                win
            );

            if (res.failCount === 0) {
                modalState.saveErrors.clear();
                if (res.hasOverStandard) {
                    showToast('info', `💡 提示：本次保存包含 ${res.overStandardCount} 笔超标住宿费，已成功按您填写的超标说明合规入库。`, 6000);
                }
                showToast('success', `成功批量保存 ${res.successCount} 笔费用记录！页面即将刷新`, 4000);
                if (islandSaveBtn) islandSaveBtn.innerText = `保存成功 (${res.successCount} 笔)`;
                setTimeout(() => {
                    closeBatchEditModal();
                    if (win) {
                        win.location.reload();
                    } else if (typeof window !== 'undefined') {
                        window.location.reload();
                    }
                }, 1500);
            } else {
                modalState.saveErrors.clear();
                res.errors.forEach(e => {
                    modalState.saveErrors.set(e.expenseRecordId, e.error);
                });

                // 同步高亮标记宿主页面中的错误费用记录行 (通过全局事件彻底解耦，消除循环依赖)
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('yn_expense_records_save_error', {
                        detail: { failedMap: modalState.saveErrors }
                    }));
                }

                // 自动切换为“仅看失败”筛选模式，隔离排查
                modalState.filterMode = 'SAVE_ERROR';

                // 重新渲染表格视图并裁剪非失败行的勾选
                pruneSelectedRecordIds();
                refreshTableView(container, 'ROWS');

                // 自动平滑滚动并聚焦到首个失败条目
                const firstError = res.errors[0];
                if (firstError) {
                    setTimeout(() => {
                        const rowEl = container.querySelector<HTMLElement>(`tr[data-recordid="${firstError.expenseRecordId}"]`);
                        if (rowEl) {
                            rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                        const targetInp = container.querySelector<HTMLInputElement>(`input[data-recordid="${firstError.expenseRecordId}"][data-dynkey="dynOverStandard"]`) ||
                            container.querySelector<HTMLInputElement>(`input[data-recordid="${firstError.expenseRecordId}"]`);
                        if (targetInp) {
                            targetInp.focus();
                        }
                    }, 100);
                }

                // 构建友好的条目级报错明细清单
                const itemizedErrorMsg = res.errors.slice(0, 5).map((e, idx) => {
                    const g = modalState.groups.find(item => item.expenseRecordId === e.expenseRecordId);
                    const dateDesc = g ? `${g.earliestInvoiceDate || g.businessDate || ''} ¥${g.expenseAmount}` : '';
                    return `• [条目 ${idx + 1}] ${dateDesc} ${e.error}`;
                }).join('\n');

                AutopilotLogger.error(`[BatchEditModal] 批量保存部分失败: ${JSON.stringify(res.errors)}`);
                showToast(
                    'warning',
                    `⚠️ 保存完成: 成功 ${res.successCount} 笔，失败 ${res.failCount} 笔！\n已为您自动筛选定位至失败条目：\n${itemizedErrorMsg}${res.errors.length > 5 ? `\n...等共 ${res.errors.length} 笔` : ''}`,
                    10000
                );

                if (islandSaveBtn) {
                    islandSaveBtn.disabled = false;
                    islandSaveBtn.innerText = `💾 重新保存 (${res.failCount} 笔失败)`;
                }
            }
        } catch (err: any) {
            AutopilotLogger.error(`[BatchEditModal] 保存异常: ${err.message}`);
            showToast('error', `保存失败: ${err.message || '网络或系统异常'}`);
            if (islandSaveBtn) {
                islandSaveBtn.disabled = false;
                islandSaveBtn.innerText = `💾 批量保存`;
            }
        }
    };

    // 2.2 底部悬浮操作岛 (Floating Action Island) 按钮
    container.querySelector('#yn-bem-island-btn-batch-settings')?.addEventListener('click', () => {
        openBatchSettingsDialog(container);
    });
    container.querySelector('#yn-bem-island-btn-ai')?.addEventListener('click', () => {
        openAiAssistantWithSkill(container, 'infer');
    });
    container.querySelector('#yn-bem-island-btn-export')?.addEventListener('click', () => {
        executeExportSelected();
    });
    container.querySelector('#yn-bem-island-btn-save')?.addEventListener('click', () => {
        executeSaveSelected();
    });
    container.querySelector('#yn-bem-island-btn-clear')?.addEventListener('click', () => {
        modalState.selectedRecordIds.clear();
        refreshTableView(container, 'CHECKBOXES');
        showToast('info', '已取消选择全部条目');
    });

    // 3. 面板展开切换：【✨ AI 助手】(右侧悬浮抽屉面板，零布局抖动)
    bindAiPanelResizer(container);

    const btnToggleAi = container.querySelector<HTMLButtonElement>('#yn-bem-btn-toggle-ai');
    btnToggleAi?.addEventListener('click', () => {
        modalState.aiPanelOpen = !modalState.aiPanelOpen;
        const aiWrap = container.querySelector<HTMLElement>('#yn-bem-ai-panel-wrap');
        const w = modalState.aiPanelWidth || 440;
        if (aiWrap) {
            aiWrap.style.width = `${w}px`;
            if (modalState.aiPanelOpen) {
                renderAssistantChat(container);
                aiWrap.classList.add('is-open');
            } else {
                aiWrap.classList.remove('is-open');
            }
        }
        btnToggleAi.classList.toggle('is-active', modalState.aiPanelOpen);
        btnToggleAi.innerHTML = `<span class="yn-gemini-sparkle-icon">✦</span> AI 助手 ${modalState.aiPanelOpen ? '✕' : '✨'}`;
    });

    // 初始状态若展开，立即渲染并挂载 React 智能副驾
    if (modalState.aiPanelOpen) {
        renderAssistantChat(container);
    }

    // 4. 点击外部时自动收起项目下拉与列筛选浮层
    doc.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const dropdownProject = container.querySelector<HTMLElement>('#yn-bem-project-dropdown');
        if (dropdownProject && !target.closest('#yn-bem-project-wrapper')) {
            dropdownProject.style.display = 'none';
        }
        if (modalState.activePopoverCol && !target.closest('#yn-bem-filter-popover') && !target.closest('.yn-bem-th-filter-trigger')) {
            modalState.activePopoverCol = null;
            modalState.popoverKeyword = '';
            refreshTableView(container, 'ROWS');
        }
    });

    // 5. 活跃筛选条件微标签移除与全部清除
    container.querySelector('.yn-bem-top-bar')?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target && target.classList.contains('yn-bem-remove-filter')) {
            const col = target.dataset.col;
            if (col) {
                delete modalState.columnFilters[col];
                refreshTableView(container, 'ROWS');
            }
            return;
        }
        if (target && target.id === 'yn-bem-clear-all-filters') {
            modalState.columnFilters = {};
            refreshTableView(container, 'ROWS');
            return;
        }
    });

    // 6. 模糊搜索 (带 250ms 防抖与筛选联动裁剪)
    const searchInput = container.querySelector<HTMLInputElement>('#yn-bem-search');
    let searchDebounceTimer: any = null;
    searchInput?.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            modalState.searchQuery = searchInput.value;
            pruneSelectedRecordIds();
            refreshTableView(container, 'ROWS');
        }, 250);
    });

    // 7. 预警、待补必填与保存失败项筛选过滤 (事件委托，无畏 DOM 局部更新)
    container.addEventListener('change', (e) => {
        const target = e.target as HTMLElement;
        if (target && target.id === 'yn-bem-filter-mode') {
            modalState.filterMode = (target as HTMLSelectElement).value as any;
            pruneSelectedRecordIds();
            refreshTableView(container, 'ROWS');
        }
    });

    // 8. 快捷全选 / 全不选 / 反选 / 仅看失败 / 仅选待补 / 仅选预警 (事件委托)
    container.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (!target) return;

        if (target.closest('#yn-bem-qa-select-all')) {
            const filtered = getFilteredGroups(modalState);
            modalState.selectedRecordIds = new Set(filtered.map(g => g.expenseRecordId));
            refreshTableView(container, 'CHECKBOXES');
            return;
        }

        if (target.closest('#yn-bem-qa-deselect')) {
            modalState.selectedRecordIds.clear();
            refreshTableView(container, 'CHECKBOXES');
            return;
        }

        if (target.closest('#yn-bem-qa-invert')) {
            const filtered = getFilteredGroups(modalState);
            filtered.forEach(g => {
                if (modalState.selectedRecordIds.has(g.expenseRecordId)) {
                    modalState.selectedRecordIds.delete(g.expenseRecordId);
                } else {
                    modalState.selectedRecordIds.add(g.expenseRecordId);
                }
            });
            pruneSelectedRecordIds();
            refreshTableView(container, 'CHECKBOXES');
            return;
        }

        if (target.closest('#yn-bem-qa-select-failed')) {
            modalState.filterMode = 'SAVE_ERROR';
            const filterSel = container.querySelector<HTMLSelectElement>('#yn-bem-filter-mode');
            if (filterSel) filterSel.value = 'SAVE_ERROR';
            pruneSelectedRecordIds();
            refreshTableView(container, 'ROWS');
            return;
        }

        if (target.closest('#yn-bem-qa-select-missing')) {
            modalState.selectedRecordIds.clear();
            const filtered = getFilteredGroups(modalState);
            filtered.forEach(g => {
                if (isGroupMissingRequired(g)) {
                    modalState.selectedRecordIds.add(g.expenseRecordId);
                }
            });
            refreshTableView(container, 'CHECKBOXES');
            return;
        }

        if (target.closest('#yn-bem-qa-select-warn')) {
            modalState.selectedRecordIds.clear();
            const filtered = getFilteredGroups(modalState);
            filtered.forEach(g => {
                if (g.hasWarn) {
                    modalState.selectedRecordIds.add(g.expenseRecordId);
                }
            });
            refreshTableView(container, 'CHECKBOXES');
            return;
        }
    });

    // 9. 底部操作浮条取消选择按钮
    container.querySelector('#yn-bem-btn-clear-selection')?.addEventListener('click', () => {
        modalState.selectedRecordIds.clear();
        refreshTableView(container, 'CHECKBOXES');
        showToast('info', '已取消选择全部条目');
    });

    // 10. 分组视图切换与单按钮全部展开 / 全部折叠
    const optGrouping = container.querySelector<HTMLSelectElement>('#yn-bem-opt-grouping');
    const toggleAllBtn = container.querySelector<HTMLButtonElement>('#yn-bem-btn-toggle-all-groups');

    optGrouping?.addEventListener('change', () => {
        modalState.groupingMode = optGrouping.value as GroupingMode;
        modalState.collapsedGroupKeys.clear();
        refreshTableView(container, 'ROWS');
        if (toggleAllBtn) {
            if (modalState.groupingMode === 'NONE') {
                toggleAllBtn.disabled = true;
                toggleAllBtn.style.opacity = '0.4';
                toggleAllBtn.style.cursor = 'not-allowed';
            } else {
                toggleAllBtn.disabled = false;
                toggleAllBtn.style.opacity = '1';
                toggleAllBtn.style.cursor = 'pointer';
                toggleAllBtn.innerText = '折叠';
            }
        }
    });

    toggleAllBtn?.addEventListener('click', () => {
        if (modalState.groupingMode === 'NONE') return;
        const tbodies = container.querySelectorAll<HTMLElement>('.yn-bem-group-tbody');
        const shouldExpand = modalState.collapsedGroupKeys.size > 0;
        if (shouldExpand) {
            modalState.collapsedGroupKeys.clear();
            tbodies.forEach(tb => {
                tb.classList.remove('is-collapsed');
                const btn = tb.querySelector<HTMLElement>('.yn-bem-group-toggle-btn');
                if (btn) { btn.innerText = '▼'; btn.title = '点击折叠'; }
            });
            toggleAllBtn.innerText = '折叠';
            toggleAllBtn.title = '折叠所有分组';
        } else {
            tbodies.forEach(tb => {
                tb.classList.add('is-collapsed');
                const key = tb.dataset.groupKey;
                if (key) modalState.collapsedGroupKeys.add(key);
                const btn = tb.querySelector<HTMLElement>('.yn-bem-group-toggle-btn');
                if (btn) { btn.innerText = '▶'; btn.title = '点击展开'; }
            });
            toggleAllBtn.innerText = '展开';
            toggleAllBtn.title = '展开所有分组';
        }
    });

    // 11. 绑定 EventBus 监听：当异步推断完成时追加 feed card
    batchEditEventBus.subscribe('INFERENCE_COMPLETE', (e) => {
        if (e.type === 'INFERENCE_COMPLETE') {
            const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            modalState.aiFeedMessages.unshift({
                type: 'success',
                text: `智能推断完成，已成功补全 ${e.payload.updatedCount} 笔费用的专属字段`,
                time: now
            });
            const feedStream = container.querySelector('#yn-gemini-feed-stream');
            if (feedStream) {
                feedStream.innerHTML = modalState.aiFeedMessages.map(msg => `
                    <div class="yn-gemini-feed-card ${msg.type}">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:10px; color:#94a3b8;">
                            <span>${msg.type === 'success' ? '✅ 执行成功' : 'ℹ️ 系统'}</span>
                            <span>${msg.time}</span>
                        </div>
                        <div>${msg.text}</div>
                    </div>
                `).join('');
            }
        }
    });

    // 14. 表格委托事件：表头全选、行选择、就地修改说明、表头排序与列筛选
    container.querySelector('#yn-bem-table-wrap')?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        // 折叠 / 展开分组 (纯 CSS 切换 is-collapsed，0ms 零 DOM 重建，保留所有输入态)
        const toggleBtn = target.closest<HTMLElement>('.yn-bem-group-toggle-btn');
        if (toggleBtn && toggleBtn.dataset.groupKey) {
            e.stopPropagation();
            const groupKey = toggleBtn.dataset.groupKey;
            const tbody = container.querySelector<HTMLElement>(`tbody.yn-bem-group-tbody[data-group-key="${groupKey}"]`);
            if (tbody) {
                const willCollapse = !tbody.classList.contains('is-collapsed');
                tbody.classList.toggle('is-collapsed', willCollapse);
                toggleBtn.innerText = willCollapse ? '▶' : '▼';
                toggleBtn.title = willCollapse ? '点击展开' : '点击折叠';
                if (willCollapse) {
                    modalState.collapsedGroupKeys.add(groupKey);
                } else {
                    modalState.collapsedGroupKeys.delete(groupKey);
                }
                if (toggleAllBtn) {
                    toggleAllBtn.innerText = modalState.collapsedGroupKeys.size > 0 ? '展开' : '折叠';
                }
            }
            return;
        }

        // 分组三态复选框 (点击全选/反选该分组内记录)
        if (target && target.classList.contains('yn-bem-group-cb')) {
            const gcb = target as HTMLInputElement;
            const groupKey = gcb.dataset.groupKey;
            if (groupKey) {
                const tbody = container.querySelector<HTMLElement>(`tbody.yn-bem-group-tbody[data-group-key="${groupKey}"]`);
                if (tbody) {
                    const rowCbs = tbody.querySelectorAll<HTMLInputElement>('.yn-bem-record-cb');
                    const isChecked = gcb.checked;
                    rowCbs.forEach(rcb => {
                        const rid = rcb.dataset.recordid;
                        if (rid) {
                            if (isChecked) modalState.selectedRecordIds.add(rid);
                            else modalState.selectedRecordIds.delete(rid);
                        }
                    });
                    refreshTableView(container, 'CHECKBOXES');
                }
            }
            return;
        }

        // 智能错配纠错灯泡点击 (一键切换 差旅出租车 vs 市内交通)
        const bulbBtn = target.closest<HTMLElement>('.yn-bem-type-misclass-bulb');
        if (bulbBtn && bulbBtn.dataset.recordid) {
            e.stopPropagation();
            const rid = bulbBtn.dataset.recordid;
            const targetType = bulbBtn.dataset.targetType;
            const group = modalState.groups.find(g => g.expenseRecordId === rid);
            if (group) {
                if (targetType === 'TRIP_TAXI') {
                    group.newExpenseTypeId = '0356c4cef03345af7f1906ec05cc0000';
                    group.newExpenseTypeName = '出租车（taxi）';
                    showToast('success', '已将此笔费用类型修正为【差旅·出租车(taxi)】，归入出差费用报销单(BC)');
                } else if (targetType === 'CITY_TAXI') {
                    group.newExpenseTypeId = '0356c529e72de1653e55bb00bc610001';
                    group.newExpenseTypeName = '市内交通费';
                    showToast('success', '已将此笔费用类型修正为【交通费·市内交通费】，归入日常经费报销单(BJ)');
                }
                modalState.selectedRecordIds.add(rid);
                refreshTableView(container, 'ROWS');
            }
            return;
        }

        // 组表头编辑/打磨 Trip 按钮
        const editTripBtn = target.closest<HTMLElement>('[data-trip-edit-id]');
        if (editTripBtn && editTripBtn.dataset.tripEditId) {
            e.stopPropagation();
            const tripId = editTripBtn.dataset.tripEditId;
            openEditTripModal(tripId, container);
            return;
        }

        // 组表头导出出差报告草稿按钮
        const reportTripBtn = target.closest<HTMLElement>('[data-trip-report-id]');
        if (reportTripBtn && reportTripBtn.dataset.tripReportId) {
            e.stopPropagation();
            const tripId = reportTripBtn.dataset.tripReportId;
            const trip = modalState.tripPlans.find(t => t.id === tripId);
            if (trip) {
                const tripItems = modalState.groups.filter(g => g.tripId === trip.id);
                const reportMd = generateTripReportMarkdown(trip, tripItems);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(reportMd).then(() => {
                        showToast('success', `✨ 已复制 Trip ${trip.tripNo} 的出差总结报告草稿到剪贴板！`);
                    }).catch(() => {
                        copyFallback(reportMd);
                        showToast('success', `✨ 已复制 Trip ${trip.tripNo} 的出差总结报告草稿到剪贴板！`);
                    });
                } else {
                    copyFallback(reportMd);
                    showToast('success', `✨ 已复制 Trip ${trip.tripNo} 的出差总结报告草稿到剪贴板！`);
                }
            }
            return;
        }

        // 组表头一键快捷生成出差申请单按钮
        const createScBtn = target.closest<HTMLElement>('.yn-bem-btn-trip-create-sc');
        if (createScBtn && createScBtn.dataset.tripId) {
            e.stopPropagation();
            const tripId = createScBtn.dataset.tripId;
            openAutopilotDecisionDashboard(container, tripId);
            return;
        }

        // 点击清空筛选按钮 (空状态)
        if (target && target.id === 'yn-bem-empty-clear-filters') {
            modalState.searchQuery = '';
            modalState.filterMode = 'ALL';
            modalState.columnFilters = {};
            const searchInp = container.querySelector<HTMLInputElement>('#yn-bem-search');
            if (searchInp) searchInp.value = '';
            const filterSel = container.querySelector<HTMLSelectElement>('#yn-bem-filter-mode');
            if (filterSel) filterSel.value = 'ALL';
            refreshTableView(container, 'ROWS');
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
                filtered.forEach(g => modalState.selectedRecordIds.add(g.expenseRecordId));
            } else {
                filtered.forEach(g => modalState.selectedRecordIds.delete(g.expenseRecordId));
            }
            pruneSelectedRecordIds();
            refreshTableView(container, 'CHECKBOXES');
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
                        }
                    }
                } else {
                    if (cb.checked) {
                        modalState.selectedRecordIds.add(recordId);
                    } else {
                        modalState.selectedRecordIds.delete(recordId);
                    }
                }

                modalState.lastSelectedRecordId = recordId;
                refreshTableView(container, 'CHECKBOXES');
            }
            return;
        }

        // 行级专属字段触发按钮与空白胶囊快捷触发
        const dynTrigger = target.closest<HTMLElement>('.yn-bem-cell-dyn-trigger, .yn-bem-route-capsule.is-empty');
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

        // 说明文本框就地编辑 (兼容多行 .yn-bem-desc-box 与单行 .yn-bem-desc-input)
        if (target && (target.classList.contains('yn-bem-desc-box') || target.classList.contains('yn-bem-desc-input'))) {
            const inputEl = target as HTMLInputElement | HTMLTextAreaElement;
            const recordId = inputEl.dataset.recordid;
            if (recordId) {
                const group = modalState.groups.find(g => g.expenseRecordId === recordId);
                if (group) {
                    group.newDescription = inputEl.value;
                    inputEl.classList.toggle('has-changed', inputEl.value !== group.description);
                    modalState.selectedRecordIds.add(recordId);
                    container.querySelectorAll<HTMLInputElement>(`input.yn-bem-record-cb[data-recordid="${recordId}"]`).forEach(c => c.checked = true);
                    container.querySelectorAll(`tr[data-recordid="${recordId}"]`).forEach(r => r.classList.add('is-selected'));
                    updateStatsAndFooter(container);
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

    // 15.1 AI 智能推断专属字段按钮
    container.querySelector('#yn-bem-btn-ai-infer')?.addEventListener('click', () => {
        openAiAssistantWithSkill(container, 'infer');
    });

}

if (typeof window !== 'undefined') {
    (window as any).openBatchEditExpenseModal = openBatchEditExpenseModal;
}
if (typeof unsafeWindow !== 'undefined') {
    (unsafeWindow as any).openBatchEditExpenseModal = openBatchEditExpenseModal;
}
