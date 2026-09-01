/**
 * 考勤工数管理系统 (time-mg.huge-vision.com) 类型定义
 */

// 1. 项目工时预实对比项
export interface ProjectExpItem {
    pjNo: string;              // 项目编号，如 "X2510-004"
    name: string;              // 项目名称，如 "BSCN SOC MSS服务2025~2026"
    expWH: string;             // 预计工时，如 "25.88"
    workingHours: string;      // 实际填写工时，如 "25.00"
    remainWH: number;          // 剩余待分配工时 = expWH - workingHours
    pjInfoID: string;          // 项目信息主键 ID
    pjgID?: string | null;
    flgPJG?: string | null;    // 如 "2"
    department?: string;       // 部门名称
}

// 2. 考勤一览明细项 (单日记录)
export interface AttendanceDetailItem {
    ymd: string;               // 日期 YYYYMMDD，如 "20260803"
    objYMD?: string | null;
    showDate: string;          // 显示日期，如 "8/3 月"
    month: string;             // 月份，如 "8"
    date: string;              // 日期号，如 "3"
    weekDate: number;          // 星期几，1~7 (1=月曜日, 7=日曜日)
    dtDayType: number;         // 日期类型：1=出勤工作日, 2=法定休假日/周末
    onDutyStatus: string;      // 出勤状态："1"=出勤, "2"=休假
    inTime: string | null;     // 进门/门禁记录 (如 "2026-08-03 17:30:00")
    outTime: string | null;    // 出门/门禁记录 (如 "2026-08-03 10:00:00")
    fromDt: string | null;     // 开始时间，如 "0900"
    toDt: string | null;       // 结束时间，如 "1730"
    timeWH: string | null;     // 当日工时，如 "7.5"
    pjNo: string | null;       // 项目编号
    name: string | null;       // 项目名称
    flgOut: string | null;     // 办公地点标志："1"=外出, null/0=社内
    flgOutShow?: string | null;
    whFormID?: string | null;
    whFormDetailID?: string | null;
    dtAppStatus?: string | null;
    applyFlowStatus?: string | null;
    department?: string | null;
    memo?: string | null;
}

// 3. 项目字典列表项
export interface PopProjectItem {
    pjNo: string;              // 项目编号
    name: string;              // 项目名称
    expFromDt?: string;        // 有效开始年月，如 "2025-09"
    expToDt?: string;          // 有效结束年月，如 "2026-08"
    pm?: string;               // 项目经理
    branch?: string;           // 所属事业部
    flgPJG?: string;
    pjInfoID: string;
    pjgID?: string | null;
}

// 4. 单日工数智能分配方案 (支持单日单项目或多项目拼凑分段)
export interface AllocatedDayPlan {
    ymd: string;               // "20260803"
    showDate: string;          // "8/3 月"
    isWorkDay: boolean;        // 是否为有效工作日 (dtDayType === 1)
    segmentIndex?: number;     // 单日分段序号 (如 0, 1, 2...)
    totalSegmentsInDay?: number; // 当天总分段数
    inTime: string | null;     // 进出记录
    outTime: string | null;    // 进出记录
    startTime: string;         // 开始时间 "09:00" / "0900"
    endTime: string;           // 结束时间 "17:30" / "1730"
    timeWH: number;            // 该段工时，如 7.5, 2.25, 2.0 等
    isOut: boolean;            // 是否为外出
    locationName: string;      // "外出" 或 "社内"
    locationReason: string;    // 外出/社内判定原因
    pjNo: string;              // 拟分配的项目编号
    pjName: string;            // 拟分配的项目名称
    pjInfoID: string;          // 关联项目 ID
    status: '就绪' | '成功' | '失败' | '跳过' | '已填写';
    errorMsg?: string;
}

// 5. 预算工时不足缺口信息
export interface BudgetShortfallInfo {
    totalMonthHours: number;         // 全月总出勤需求工时 (如 157.50h, 21天)
    totalMonthBudget: number;        // 全月项目预计总预算 (如 114.99h)
    monthShortfallHours: number;     // 全月总预算缺口 (如 42.50h)
    totalRequiredHours: number;      // 本次待填出勤需求工时 (如 150.00h, 20天)
    totalAvailableBudget: number;    // 各项目剩余可用预算 (如 110.00h)
    shortfallHours: number;          // 本次待填工时缺口 (如 40.00h)
    suggestedProjects: Array<{
        pjNo: string;
        name: string;
        expWH: number;
        remainWH: number;
    }>;
}

// 6. 考勤系统全局运行时状态
export interface TimeMgState {
    selectedYear: string;      // 当前选中的年份，如 "2026"
    selectedMonth: string;     // 当前选中的月份，如 "08"
    csrfToken: string;         // X-CSRF-TOKEN
    expProjects: ProjectExpItem[];
    detailDays: AttendanceDetailItem[];
    allocatedPlans: AllocatedDayPlan[];
    budgetShortfall?: BudgetShortfallInfo;
    allowedOverflowPjNos?: string[]; // 用户勾选允许超出预算分摊的项目编号列表
    isProcessing: boolean;
    lastSyncTime: string;
}
