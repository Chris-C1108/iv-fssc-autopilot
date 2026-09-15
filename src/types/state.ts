import { TimeMgState } from './timeMgTypes';

export type PageMode = 'POOL' | 'EXPENSE' | 'BILL' | 'APPLICATION' | 'TIME_MG' | 'UNKNOWN';

export type ExpenseCategory =
    | 'ALL'
    | 'TAXI'
    | 'TRIP_TAXI'
    | 'FLIGHT'
    | 'TRAIN'
    | 'HOTEL'
    | 'COMMUNICATION'
    | 'MEETING'
    | 'ENTERTAINMENT_EXTERNAL'
    | 'ENTERTAINMENT_INTERNAL'
    | 'TEAM_BUILDING'
    | 'TRAINING'
    | 'OTHER';

export interface InvoiceItem {
    id?: string;
    expenseRecordId?: string;
    version?: number;
    boDataId?: string;
    boSourceRowId?: string;
    invoiceVO?: any;
    invoiceNo?: string;
    invoiceCode?: string;
    invoiceDate?: string;
    invoiceDetails?: string;
    timeGetOn?: string;
    timeGetOff?: string;
    mileage?: string;
    amount?: number;
    type: ExpenseCategory;
    expenseTypeId?: string;
    expenseTypeName?: string;
    expenseTypeCode?: string;
    salesName?: string;
    typeName?: string;
    startAddress?: string;
    endAddress?: string;
    description?: string;
    period?: string;
    attachments?: any[];
    status?: string;
    hasRideInfo?: boolean;
    rideDetail?: string;
    isWorkday?: '0' | '1';
    isModified?: boolean;
    hotelName?: string;
    stationOrAirport?: string;
    proxyPersonName?: string;
    projectName?: string;
    isBusinessTrip?: boolean;
    fileName?: string;
    // 多发票绑定支持 (一个费用多张发票：出租车 + 过路费)
    subInvoices?: InvoiceItem[];
    tollAmount?: number;
    invoiceCount?: number;
    isMergedIntoOther?: boolean;
    parentExpenseRecordId?: string;

    // 住宿相关字段
    checkInDate?: string;
    checkOutDate?: string;
    stayDays?: number;
    roomNum?: number;
    city?: string;

    // 系统后端错误提示 (来自 getExpenseRecordListBySearchVO 的 expenseRecordTypeMessageVO.errorMessages)
    errorMessages?: string[];

    // 发票完整性校验与残缺字段诊断 (Invoice Validation)
    validationIssues?: InvoiceValidationIssue[];
    isValidInvoice?: boolean;
    missingFieldsDesc?: string;
}

export interface InvoiceValidationIssue {
    field: 'amount' | 'date' | 'invoiceNo' | 'invoiceType' | 'seller' | 'time' | 'general';
    severity: 'error' | 'warning' | 'info';
    message: string;
    shortBadge: string;
}

export interface InvoiceValidationResult {
    id: string;
    invoiceNo?: string;
    invoiceCode?: string;
    invoiceDate?: string;
    amount?: number;
    typeName?: string;
    isValid: boolean;
    hasWarnings: boolean;
    issues: InvoiceValidationIssue[];
    missingFieldsDesc: string;
}

export interface InvoiceBatchValidationSummary {
    totalCount: number;
    validCount: number;
    invalidCount: number;
    warningCount: number;
    missingAmountCount: number;
    missingDateCount: number;
    missingInvoiceNoCount: number;
    missingTypeCount: number;
    missingTimeCount: number;
    results: InvoiceValidationResult[];
    invalidList: InvoiceValidationResult[];
}

export interface ExpenseTripSegment {
    tripNo?: number;
    startDate: string;
    endDate: string;
    destination: string;
    destCity?: string;
    hotelName?: string;
    customerName?: string;
    targetFactories?: string;
    stationOrAirport?: string;
    departureStation?: string;
    arrivalStation?: string;
    purpose?: string;
}

export interface ExpensePlanOptions {
    tripType?: 'BUSINESS_TRIP' | 'LOCAL_COMMUTE' | 'COMMUNICATION_ONLY' | 'AUTO';
    companyName?: string;
    customerName?: string;
    hotelName?: string;
    stationOrAirport?: string;
    homeName?: string;
    projectName?: string;
    proxyPersonName?: string;
    departureDate?: string;
    returnDate?: string;
    customDescription?: string;
    targetExpenseTypeId?: string;
    recordIndices?: number[];
    itineraryText?: string;
    trips?: ExpenseTripSegment[];
    mergeTollsWithTaxi?: boolean;
}

export interface ExpenseBatchPlanResult {
    totalRecords: number;
    modifiedCount: number;
    tripType: 'BUSINESS_TRIP' | 'LOCAL_COMMUTE' | 'COMMUNICATION_ONLY';
    companyName: string;
    customerName: string;
    hotelName: string;
    stationOrAirport: string;
    projectName: string;
    proxyPersonName: string;
    missingFields: string[];
    records: InvoiceItem[];
    uncertainDates: string[];
    summaryText: string;
    boundTollsCount?: number;
    bindingLog?: string[];
    hasConcurrentTolls?: boolean;
    concurrentTollsCount?: number;
    tollInquiryPrompt?: string;
    mergeTollsWithTaxi?: boolean;
    matchedTrips?: ExpenseTripSegment[];
    a2uiAST?: A2UiRootAST;
}

// ==========================================
// 通用声明式 A2UI (Agent-to-User Interface) AST 规范
// ==========================================
export type A2UiComponentType =
    | 'card'
    | 'header'
    | 'alert'
    | 'grid'
    | 'group'
    | 'input'
    | 'select'
    | 'toggle'
    | 'chips'
    | 'trip-timeline'
    | 'table'
    | 'button-group'
    | 'button'
    | 'divider';

export interface A2UiNodeAST {
    id: string;
    type: A2UiComponentType;
    props?: Record<string, any>;
    bind?: string; // model property path for 2-way binding
    children?: A2UiNodeAST[];
}

export interface A2UiActionDef {
    label: string;
    style?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
    icon?: string;
    toolName?: string;
    payloadTemplate?: Record<string, any>;
    handlerId?: string;
}

export interface A2UiRootAST {
    version: '1.0';
    id: string;
    title: string;
    badge?: string;
    description?: string;
    model: Record<string, any>;
    layout: A2UiNodeAST[];
    actions?: Record<string, A2UiActionDef>;
}

export interface BillRowItem {
    index: number;
    rowNum: number;
    claimRowId: string;
    budgetRowId: string;
    recDesc: string;
    expTypeName: string;
    expTypeTitle: string;
    amount: number;
    curAccount: string;
    curCostCenter: string;
    curProject: string;
    curKhfd: string;
    status: string;
}

export interface OptionItem {
    value: string;
    title: string;
    code?: string;
    id?: string;
    name?: string;
}

export interface TripLeg {
    date: string;
    fromCity: string;
    toCity: string;
    transport: string;
    flightOrTrain?: string; // 班次/航班号
    travelerName?: string; // 出差人员姓名（备注于班次/交通工具后）
}

export interface TripApplicationConfig {
    id: string;
    tripNo: number;
    applicantName: string; // 主申请人（通常为正社员）
    isProxy: boolean;
    travelers?: string[]; // 涵盖的全部出差人员名单（含正社员与合报外驻人员）
    isCombined?: boolean; // 是否为正社员合并提单
    startDate: string;
    endDate: string;
    days: number;
    nights: number;
    destination: string;
    targetFactories?: string;
    hotelName?: string;
    purpose?: string;
    trafficFee: number;
    hotelFee: number;
    mealFee: number;
    otherFee: number; // Buffer 预留 (出租车/网约车/市内交通)
    trafficBuffer: number; // 交通改签缓冲
    totalAmount: number;
    legs: TripLeg[];
    feeFormulas?: TripFeeFormulas; // 详细计算逻辑与公式展开
    matchedHistoryBill?: HistoricalApplicationSummary; // 历史单据交叉对比命中结果
    projectVO?: any;
    projectName?: string;
    status: '就绪' | '创建中' | '已生成草稿' | '失败';
    billCode?: string;
    billMainId?: string;
    travelReport?: string;
    error?: string;
}

export interface TripFeeFormulas {
    trafficFormula: string;
    hotelFormula: string;
    mealFormula: string;
    otherFormula: string;
    totalFormula?: string;
}

export interface HistoricalApplicationSummary {
    billCode: string;
    billName: string;
    billDate: string;
    amount: string;
    statusName: string;
    applicantName: string;
    departmentName: string;
    billMainId: string;
    destination?: string;
    startDate?: string;
    endDate?: string;
}

export interface ApplicationState {
    configs: TripApplicationConfig[];
    rawInputs?: any[]; // 保留原始动态行程输入，支持在合并模式与独立模式间任意切换
    mode?: 'COMBINED' | 'SEPARATE'; // 提单模式：正社员统提合并模式 vs 每人独立提单模式
    selectedTripIds: Set<string>;
    isProcessing: boolean;
    progressText: string;
    cityBufferPerDay: number; // 默认每天预留市内交通Buffer (如 100元)
    trafficBufferPercent: number; // 默认交通改签Buffer百分比 (如 15%)
    cityCache: Record<string, any>;
    personCache: Record<string, any>;
    personCandidates?: Record<string, any[]>;
    projectCache: Record<string, any>;
}

export interface GlobalState {
    pageMode: PageMode;
    loginToken: string;
    ecsToken: string;
    userOrigin: string;
    appId: string;
    menuId: string;
    eicds: string;
    v: string;
    applicantId: string;
    applicantName?: string;
    accountCurrencyId?: string;
    currentUser?: {
        userId: string;
        userName: string;
        userCode?: string;
        loginName?: string;
        departmentName?: string;
        companyName?: string;
        email?: string;
    };
    invoices: InvoiceItem[];
    activeGroup: 'TAXI' | 'COMMUNICATION' | 'ALL';
    selectedIndices: Set<number>;
    currentBillMainId: string;
    currentBillData: any;
    currentBillDefineTemplate: any;
    billRows: BillRowItem[];
    billTags: Map<string, number>;
    activeBillTag: string;
    billSelectedIndices: Set<number>;
    projectSearchResults: OptionItem[];
    selectedAccount: OptionItem | null;
    selectedCostCenter: OptionItem | null;
    selectedProject: OptionItem | null;
    selectedKhfd: OptionItem | null;
    isProcessing: boolean;

    // 模式 C: 爱模智能考勤工数系统数据
    timeMg?: TimeMgState;

    // 模式 D: 出差申请单批量填报数据
    tripApp?: ApplicationState;

    // 模式 E: 费用批量规划状态
    expensePlan?: ExpenseBatchPlanResult;

    // 网络拦截缓存：宿主页面最近拉取到的费用记录与发票池数据
    lastInterceptedExpenseRecords?: any[];
    lastInterceptedInvoicePool?: any[];
}

export interface GenericExpenseGroup {
    expenseAmount: number | string;
    description?: string;
    newDescription?: string;
    expenseTypeName?: string;
    newExpenseTypeName?: string;
    businessDate?: string;
    newBusinessDate?: string;
    invoices?: Array<{
        salesName?: string;
        remarks?: string;
        [key: string]: any;
    }>;
    [key: string]: any;
}

