/**
 * 报销单管理纯表格模式 (Grid Mode) — 核心类型定义
 * 
 * 严格对齐元年云宿主系统真实单据原生字段：
 * 1. 出差申请单 (SC, 出張伺書): 出差类型、出張先、出張目的、期間From~To、旅程子表(ITINERARY)、4项预算+合计、预算归属、是否向客户请款
 * 2. 出差费用报销清单 (BC): 出差主字段、出差报告(F_BGNR)、预算归属多项分摊子表 (支持拆分多行)
 * 3. 经费报销单 (BJ): 费用明细与预算归属
 */
import { TripLeg } from './state';

export type BillType = 'BC' | 'BJ';

export const BILL_TYPE_LABELS: Record<BillType, string> = {
    BC: '出差费用报销单',
    BJ: '经费报销单'
};

export const BILL_DEFINE_IDS: Record<BillType, string> = {
    BC: '035a50ee6d3de1653e55bb00bc610001',
    BJ: '035cd1b4d46de1653e55bb00bc610000'
};

export const SC_DEFINE_ID = '0355cf627fede1653e55bb00bc610001';

export type TripType = '境内出張' | '境外出張';

// ─── 预算归属与分摊明细 (按费用类型分摊，支持多预算归属拆分) ───────

export interface BudgetAllocationItem {
    id: string;                      // 分摊项唯一 ID
    expenseTypeName: string;         // 费用类型 (如 '住宿费', '出租车', '飞机票')
    expenseAmount: number;           // 费用金额
    projectId: string;               // 预算项目 ID
    projectName: string;             // 预算归属名称 (例如 '项目预算 - X2607-001 ...')
    allocatedAmount: number;         // 分摊金额
    ratioPercent: number;            // 分摊百分比 (如 100%, 50%)
    customerCharge: boolean;         // 是否向客户请款 (默认否)
    accountTitle?: string;           // 记账科目
}

// ─── 出差申请单 (SC) 原生要素与 4 项预算 ───────────────────────

export interface SCPlan {
    applicantName: string;           // 申请人
    tripType: TripType;              // 出差类型: 境内出張 / 境外出張
    destination: string;             // 出張先 (CITIES FOR VISIT)
    purpose: string;                 // 出張目的 (PURPOSE OF TRIP)
    startDate: string;               // 期間 From (YYYY-MM-DD)
    endDate: string;                 // 期間 To (YYYY-MM-DD)
    days: number;                    // 出差天数
    nights: number;                  // 住宿晚数

    // 旅程 (ITINERARY) 子表格
    legs: TripLeg[];
    flightOrTrain?: string;          // 大交通工具/车次/航班（汇总或单据级别）

    // 予算 (BUDGET ESTIMATION) 4 项费用 + 1 项合计
    airfareBudget: number;           // 航空運賃（交通費）(AIRFARE ETC)
    hotelBudget: number;             // ホテル代 (HOTEL FEE)
    mealAllowance: number;           // 誤餐補助 (Dining-delay ALLOW.)
    otherBudget: number;             // その他 (OTHERS - 市内交通等)
    totalBudget: number;             // 合計 (TOTAL - 各项预算之和，需 >= 报销实付金额)

    // 预算归属与请款
    projectId: string;
    projectName: string;
    customerCharge: boolean;         // 是否向客户请款 (默认否)

    // 系统关联单号与实体主键 (用于幂等就地更新与关联)
    billCode?: string;
    billMainId?: string;
}

// ─── 报销单计划主行 (BillPlan) ────────────────────────────────

export type BillPlanStatus = 'draft' | 'saving' | 'saved' | 'error';

export interface BillPlan {
    id: string;                      // 内部唯一 ID
    type: BillType;                  // BC 或 BJ
    title: string;                   // 单据标题/事由 (如 'Trip 1: 天津出差 (07-20~07-25)')
    tripType: TripType;              // 出差类型 (境内出張 / 境外出張)
    destination: string;             // 出張先
    purpose: string;                 // 出差目的
    startDate: string;               // 期间 From
    endDate: string;                 // 期间 To
    applicantName: string;           // 出差人员

    // 关联费用统计
    expenseRecordIds: string[];
    expenseCount: number;
    invoiceCount: number;
    totalAmount: number;             // 实报实销金额合计

    // 预算归属分摊明细 (支持拆分多行)
    budgetAllocations: BudgetAllocationItem[];

    // 主项目与请款 (默认回退)
    projectId: string;
    projectName: string;
    customerCharge: boolean;
    departmentName: string;

    // 出差总结报告 (仅BC)
    travelReport: string;

    // 关联出差申请单 (仅BC)
    scPlan: SCPlan | null;

    // 状态
    status: BillPlanStatus;
    errorMessage: string;
    sourceTripId: string;

    // 系统关联单号与实体主键 (用于幂等就地更新与防重)
    billCode?: string;
    billMainId?: string;

    // AI 辅助填充标记 (记录被 AI 填充或调整过的字段名，用于视觉微光反馈)
    aiFilledFields?: string[];
}

// ─── 必填字段与数据合规校验结果 ────────────────────────────────

export interface FieldValidationError {
    billId: string;
    field: string;
    label: string;
    message: string;
    subTable?: 'ITINERARY' | 'BUDGET' | 'ALLOCATION';
    rowIndex?: number;
}

export interface BillValidationResult {
    isValid: boolean;
    missingCount: number;
    errors: FieldValidationError[];
    errorMapByBillId: Record<string, Record<string, string>>;
}

// ─── 看板全局状态 ──────────────────────────────────────────────

export interface BillManagementState {
    billPlans: BillPlan[];
    selectedBillIds: Set<string>;
    expandedBillIds: Set<string>;    // 展开的单据 ID 集
    isProcessing: boolean;
    progressText: string;
    searchQuery: string;
}

// ─── 工具函数 ────────────────────────────────────────────────

export function computeSCTotal(sc: Partial<SCPlan>): number {
    const air = Number(sc.airfareBudget) || 0;
    const hotel = Number(sc.hotelBudget) || 0;
    const meal = Number(sc.mealAllowance) || 0;
    const other = Number(sc.otherBudget) || 0;
    return Math.round((air + hotel + meal + other) * 100) / 100;
}

export function formatCurrency(amount: number): string {
    return '¥' + (amount || 0).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export function createEmptySCPlan(applicantName: string = '', destination: string = ''): SCPlan {
    return {
        applicantName,
        tripType: '境内出張',
        destination,
        purpose: '',
        startDate: '',
        endDate: '',
        days: 0,
        nights: 0,
        legs: [],
        airfareBudget: 0,
        hotelBudget: 0,
        mealAllowance: 0,
        otherBudget: 0,
        totalBudget: 0,
        projectId: '',
        projectName: '',
        customerCharge: false,
    };
}
