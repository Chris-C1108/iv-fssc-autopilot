/**
 * 报销单管理高能工作台 — 纯表格模式 (Grid / Spreadsheet Mode)
 * 
 * 核心设计：
 * 1. 彻底废除表单卡片模式，以纯二维网格大表格呈现；
 * 2. 严格收敛至真实单据原生字段，彻底移除改签Buffer、入住酒店、走访据点等不必要字段；
 * 3. 主表行平铺单据核心字段，支持行内即时编辑；
 * 4. 展开区采用 3 张紧凑二维子表格：
 *    - 旅程 (ITINERARY) 子表格
 *    - 4 项预算估算 (BUDGET ESTIMATION) 表格
 *    - 费用信息与预算归属分摊 (BUDGET ALLOCATION & SPLIT) 表格 (支持一键拆分多预算归属)；
 * 5. 保留沉浸式 Markdown 出差报告抽屉与一键 AI 生成；
 * 6. 刚性锁定 commit: false 保存草稿入库。
 */
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
    BillPlan,
    SCPlan,
    BillType,
    TripType,
    BillManagementState,
    BudgetAllocationItem,
    BILL_TYPE_LABELS,
    formatCurrency,
    computeSCTotal,
    BillValidationResult,
    FieldValidationError,
} from '../types/billPlan';
import { TripLeg } from '../types/state';
import {
    updateBillPlanField,
    updateSCField,
    splitBudgetAllocation,
    removeBudgetAllocation,
    updateBudgetAllocationField,
    validateBillPlans,
    autoFillBillPlansWithAi,
    normalizeToDatetimeLocal,
    formatFlightTrainRemark,
} from '../services/billPlanService';
import { ExpenseRecordGroup } from './batchEditExpenseModal';
import {
    fetchApprovedTripApplicationsFromMachineAccountApi,
    fetchMyApplicationsStatusApi,
    fetchUserReimbursementBillsListApi,
    fetchApplicationDetailApi,
    ApprovedMachineAccountItem,
    UserReimbursementBillSummary
} from '../services/billService';
import { getInvoicePoolGlobalState } from '../services/invoicePoolDomService';

export interface AvailableSCItem {
    billCode: string;
    billMainId?: string;
    machineAccountId?: string;
    machineAccountDefineId?: string;
    destination: string;
    purpose?: string;
    startDate?: string;
    endDate?: string;
    approvalStatus: 'approved' | 'approving' | 'draft';
    approvalStatusText: string;
    currentApprover?: string;
    currentNode?: string;
    balanceAmount?: number;
    budgetSum?: number;
    projectId?: string;
    projectName?: string;
    applicantDate?: string;
    legs?: TripLeg[];
}

// ─── Props ───────────────────────────────────────────────────

export interface BillManagementDashboardProps {
    initialState: BillManagementState;
    onClose?: () => void;
    onSaveDrafts: (plans: BillPlan[], mode?: 'SC_ONLY' | 'BC_ONLY' | 'ALL') => Promise<void>;
    onSearchProject: (query: string) => Promise<Array<{ id: string; name: string; code: string }>>;
    rawGroups?: ExpenseRecordGroup[];
    defaultProjectName?: string;
    defaultApplicantName?: string;
}

// ─── Status Badge ────────────────────────────────────────────

const StatusBadge = React.memo(({ status, error }: { status: BillPlan['status']; error?: string }) => {
    const cls = `yn-bm-badge yn-bm-badge--${status}`;
    const labels: Record<string, string> = {
        draft: '草稿就绪',
        saving: '保存中...',
        saved: '已入库',
        error: '失败',
    };
    return (
        <span className={cls} title={error || ''}>
            {status === 'saving' && <span className="yn-bm-badge-pulse" />}
            {labels[status] || status}
        </span>
    );
});

// ─── Toggle Switch (iOS / Linear 微动效) ─────────────────────

const ToggleSwitch = React.memo(({
    checked,
    onChange,
    labelActive = '是',
    labelInactive = '否',
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    labelActive?: string;
    labelInactive?: string;
}) => (
    <label className="yn-bm-toggle-wrap" title={`点击切换：${checked ? labelActive : labelInactive}`}>
        <input
            type="checkbox"
            className="yn-bm-toggle-input"
            checked={checked}
            onChange={e => onChange(e.target.checked)}
        />
        <span className="yn-bm-toggle-track">
            <span className="yn-bm-toggle-thumb" />
        </span>
        <span className={`yn-bm-toggle-label ${checked ? 'is-active' : ''}`}>
            {checked ? labelActive : labelInactive}
        </span>
    </label>
));

// ─── Project Search Input (动态维表联想输入框) ───────────────

const ProjectSearchInput = React.memo(({
    value,
    onChange,
    onSearch,
    isMissing,
    missingMessage,
    isAiFilled,
    dataBillId,
    dataField = 'projectName',
}: {
    value: string;
    onChange: (val: string, vo?: any) => void;
    onSearch: (q: string) => Promise<Array<{ id: string; name: string; code: string }>>;
    isMissing?: boolean;
    missingMessage?: string;
    isAiFilled?: boolean;
    dataBillId?: string;
    dataField?: string;
}) => {
    const [open, setOpen] = useState(false);
    const [keyword, setKeyword] = useState(value || '');
    const [results, setResults] = useState<Array<{ id: string; name: string; code: string }>>([]);
    const [loading, setLoading] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setKeyword(value || '');
    }, [value]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleFocus = useCallback(async () => {
        setOpen(true);
        if (results.length === 0) {
            setLoading(true);
            try {
                const list = await onSearch(keyword);
                setResults(list.slice(0, 15));
            } finally {
                setLoading(false);
            }
        }
    }, [keyword, results.length, onSearch]);

    const handleInputChange = useCallback(async (text: string) => {
        setKeyword(text);
        onChange(text);
        setOpen(true);
        setLoading(true);
        try {
            const list = await onSearch(text);
            setResults(list.slice(0, 15));
        } finally {
            setLoading(false);
        }
    }, [onChange, onSearch]);

    const handleSelect = useCallback((p: { id: string; name: string; code: string }) => {
        setKeyword(p.name);
        onChange(p.name, p);
        setOpen(false);
    }, [onChange]);

    return (
        <div className="yn-bm-project-search-wrap" ref={wrapRef}>
            <input
                type="text"
                className={`yn-bm-cell-input yn-bm-project-input ${isMissing ? 'is-missing' : ''} ${isAiFilled ? 'is-ai-filled' : ''}`}
                placeholder={isMissing ? "⚠️ 必填项目归属(维表)..." : "搜索项目维表..."}
                value={keyword}
                title={isMissing ? missingMessage : (isAiFilled ? '✦ AI 智能对齐项目' : '')}
                data-bill-id={dataBillId}
                data-field={dataField}
                onFocus={handleFocus}
                onChange={e => handleInputChange(e.target.value)}
            />
            {open && (
                <div className="yn-bm-project-dropdown">
                    {loading ? (
                        <div className="yn-bm-dropdown-loading">正在检索维表...</div>
                    ) : results.length === 0 ? (
                        <div className="yn-bm-dropdown-empty">未匹配到项目 (支持直接手填)</div>
                    ) : (
                        results.map(p => (
                            <div
                                key={p.id}
                                className="yn-bm-dropdown-item"
                                onClick={() => handleSelect(p)}
                            >
                                <span className="yn-bm-project-code">{p.code}</span>
                                <span className="yn-bm-project-name">{p.name}</span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
});

// ─── 子表格 1：✈️ 旅程明细表 (ITINERARY) ──────────────────────

const ItinerarySubTable = React.memo(({
    billId,
    legs,
    onAddLeg,
    onRemoveLeg,
    onUpdateLeg,
    missingMap,
    aiFilled,
}: {
    billId: string;
    legs: TripLeg[];
    onAddLeg: (billId: string) => void;
    onRemoveLeg: (billId: string, idx: number) => void;
    onUpdateLeg: (billId: string, idx: number, field: keyof TripLeg, val: any) => void;
    missingMap?: Record<string, string>;
    aiFilled?: boolean;
}) => {
    const isLegsEmpty = Boolean(missingMap?.legs_empty);

    return (
        <div className="yn-bm-subgrid-box">
            <div className="yn-bm-subgrid-header">
                <span className="title">
                    ✈️ <span className="yn-bm-badge-apply" style={{ marginRight: '6px' }}>[申请]</span> 旅程 (ITINERARY) 子表格
                    {aiFilled && <span className="yn-bm-ai-sparkle-tag">✦ AI 生成</span>}
                </span>
                <span className="hint">
                    {isLegsEmpty ? (
                        <strong style={{ color: '#dc2626' }}>⚠️ 旅程至少需包含 1 趟航段明细（可点击右侧 +增加航段 或点击顶栏 AI 一键补全）</strong>
                    ) : (
                        '※ 出差申请时请务必写明交通明细（如航班、高铁二等座）及费用概算'
                    )}
                </span>
                <button
                    type="button"
                    className="yn-bm-btn-table-action"
                    onClick={() => onAddLeg(billId)}
                >
                    + 增加航段
                </button>
            </div>
            <table className="yn-bm-detail-table">
                <thead>
                    <tr>
                        <th style={{ width: '45px', textAlign: 'center' }}>行号</th>
                        <th style={{ width: '190px' }}>
                            <span className="yn-bm-badge-apply">[申请]</span> DATE (日期时间) <span className="yn-bm-req-star">*</span>
                        </th>
                        <th style={{ width: '150px' }}>
                            <span className="yn-bm-badge-apply">[申请]</span> FROM (出发地城市) <span className="yn-bm-req-star">*</span>
                        </th>
                        <th style={{ width: '150px' }}>
                            <span className="yn-bm-badge-apply">[申请]</span> TO (出差目的地城市) <span className="yn-bm-req-star">*</span>
                        </th>
                        <th>
                            <span className="yn-bm-badge-apply">[申请]</span> FLIGHT/TRAIN ETC. (航班/车次备注，如“[人名|外驻:人名]-[飞机|高铁|出租车]-[项目号]”) <span className="yn-bm-req-star">*</span>
                        </th>
                        <th style={{ width: '50px', textAlign: 'center' }}>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {legs.map((leg, idx) => {
                        const isDateMissing = Boolean(missingMap?.[`leg_${idx}_date`]);
                        const isFromMissing = Boolean(missingMap?.[`leg_${idx}_fromCity`]);
                        const isToMissing = Boolean(missingMap?.[`leg_${idx}_toCity`]);

                        return (
                            <tr key={idx}>
                                <td style={{ textAlign: 'center', fontWeight: 600 }}>{idx + 1}</td>
                                <td>
                                    <input
                                        type="datetime-local"
                                        className={`yn-bm-cell-input ${isDateMissing ? 'is-missing' : ''}`}
                                        value={normalizeToDatetimeLocal(leg.date)}
                                        data-bill-id={billId}
                                        data-field={`leg_${idx}_date`}
                                        title={isDateMissing ? missingMap?.[`leg_${idx}_date`] : ''}
                                        onChange={e => onUpdateLeg(billId, idx, 'date', e.target.value)}
                                    />
                                </td>
                                <td>
                                    <input
                                        type="text"
                                        className={`yn-bm-cell-input ${isFromMissing ? 'is-missing' : ''}`}
                                        value={leg.fromCity}
                                        placeholder={isFromMissing ? "⚠️ 必填出发城市" : "如：上海"}
                                        data-bill-id={billId}
                                        data-field={`leg_${idx}_fromCity`}
                                        title={isFromMissing ? missingMap?.[`leg_${idx}_fromCity`] : ''}
                                        onChange={e => onUpdateLeg(billId, idx, 'fromCity', e.target.value)}
                                    />
                                </td>
                                <td>
                                    <input
                                        type="text"
                                        className={`yn-bm-cell-input ${isToMissing ? 'is-missing' : ''}`}
                                        value={leg.toCity}
                                        placeholder={isToMissing ? "⚠️ 必填目的城市" : "如：天津"}
                                        data-bill-id={billId}
                                        data-field={`leg_${idx}_toCity`}
                                        title={isToMissing ? missingMap?.[`leg_${idx}_toCity`] : ''}
                                        onChange={e => onUpdateLeg(billId, idx, 'toCity', e.target.value)}
                                    />
                                </td>
                                <td>
                                    <input
                                        type="text"
                                        className="yn-bm-cell-input"
                                        value={leg.flightOrTrain || leg.transport || ''}
                                        onChange={e => onUpdateLeg(billId, idx, 'flightOrTrain', e.target.value)}
                                        placeholder="如：[外驻:成勇]-[飞机]-[X2607-001]"
                                    />
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    <button
                                        type="button"
                                        className="yn-bm-btn-delete-row"
                                        onClick={() => onRemoveLeg(billId, idx)}
                                        title="删除该航段"
                                    >
                                        ✕
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
});

// ─── 子表格 2：💰 4 项预算核算表 (BUDGET ESTIMATION) ──────────

const BudgetEstimationSubTable = React.memo(({
    billId,
    sc,
    claimAmount,
    onSCFieldChange,
    isBudgetInsufficient,
    missingMessage,
}: {
    billId: string;
    sc: SCPlan;
    claimAmount: number;
    onSCFieldChange: (billId: string, field: keyof SCPlan, val: any) => void;
    isBudgetInsufficient?: boolean;
    missingMessage?: string;
}) => {
    const total = computeSCTotal(sc);
    const isCovered = total >= claimAmount;
    const diff = total - claimAmount;

    return (
        <div className="yn-bm-subgrid-box">
            <div className="yn-bm-subgrid-header">
                <span className="title">💰 <span className="yn-bm-badge-apply" style={{ marginRight: '6px' }}>[申请]</span> 予算 (BUDGET ESTIMATION) 核算表格</span>
                <span className={`diff-pill ${isCovered ? 'diff-ok' : 'diff-warn'}`}>
                    {isCovered ? `✅ 预算全额覆盖实际报销 (留存差额: ${formatCurrency(diff)})` : `⚠️ 预警: 预算合计低于报销实付 ${formatCurrency(-diff)} (需增加预算)`}
                </span>
            </div>
            <table className="yn-bm-detail-table">
                <thead>
                    <tr>
                        <th style={{ width: '20%' }}>
                            <span className="yn-bm-badge-apply">[申请]</span> 航空運賃（交通費）(AIRFARE ETC)
                        </th>
                        <th style={{ width: '20%' }}>
                            <span className="yn-bm-badge-apply">[申请]</span> ホテル代 (HOTEL FEE)
                        </th>
                        <th style={{ width: '20%' }}>
                            <span className="yn-bm-badge-apply">[申请]</span> 誤餐補助 (Dining-delay ALLOW.)
                        </th>
                        <th style={{ width: '20%' }}>
                            <span className="yn-bm-badge-apply">[申请]</span> その他 (OTHERS / 市内交通等)
                        </th>
                        <th style={{ width: '20%', background: isBudgetInsufficient ? '#fef2f2' : '#eff6ff' }}>
                            <span className="yn-bm-badge-apply">[申请]</span> 合計 (TOTAL - 需 ≥ 实际报销) <span className="yn-bm-req-star">*</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>
                            <div className="yn-bm-currency-cell">
                                <span className="prefix">¥</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="yn-bm-cell-input yn-bm-number-input"
                                    value={sc.airfareBudget}
                                    onChange={e => onSCFieldChange(billId, 'airfareBudget', Number(e.target.value) || 0)}
                                />
                            </div>
                        </td>
                        <td>
                            <div className="yn-bm-currency-cell">
                                <span className="prefix">¥</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="yn-bm-cell-input yn-bm-number-input"
                                    value={sc.hotelBudget}
                                    onChange={e => onSCFieldChange(billId, 'hotelBudget', Number(e.target.value) || 0)}
                                />
                            </div>
                        </td>
                        <td>
                            <div className="yn-bm-currency-cell">
                                <span className="prefix">¥</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="yn-bm-cell-input yn-bm-number-input"
                                    value={sc.mealAllowance}
                                    onChange={e => onSCFieldChange(billId, 'mealAllowance', Number(e.target.value) || 0)}
                                />
                            </div>
                        </td>
                        <td>
                            <div className="yn-bm-currency-cell">
                                <span className="prefix">¥</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="yn-bm-cell-input yn-bm-number-input"
                                    value={sc.otherBudget}
                                    onChange={e => onSCFieldChange(billId, 'otherBudget', Number(e.target.value) || 0)}
                                />
                            </div>
                        </td>
                        <td style={{ background: isBudgetInsufficient ? '#fef2f2' : '#f8fafc', fontWeight: 800 }}>
                            <span
                                className={`yn-bm-budget-total-val ${isBudgetInsufficient ? 'is-budget-insufficient' : ''}`}
                                title={isBudgetInsufficient ? missingMessage : ''}
                            >
                                {formatCurrency(total)}
                            </span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
});

// ─── 子表格 3：📑 费用信息与预算归属分摊表 (BUDGET ALLOCATION & SPLIT) ───

const BudgetAllocationSubTable = React.memo(({
    billId,
    allocations,
    onSplit,
    onRemove,
    onUpdateField,
    onSearchProject,
    missingMap,
}: {
    billId: string;
    allocations: BudgetAllocationItem[];
    onSplit: (billId: string, allocId: string) => void;
    onRemove: (billId: string, allocId: string) => void;
    onUpdateField: (billId: string, allocId: string, field: keyof BudgetAllocationItem, val: any) => void;
    onSearchProject: (q: string) => Promise<Array<{ id: string; name: string; code: string }>>;
    missingMap?: Record<string, string>;
}) => {
    return (
        <div className="yn-bm-subgrid-box">
            <div className="yn-bm-subgrid-header">
                <span className="title">📑 <span className="yn-bm-badge-claim" style={{ marginRight: '6px' }}>[报销]</span> 费用信息与预算归属分摊表格 (BUDGET ALLOCATION & SPLIT)</span>
                <span className="hint">※ 支持按费用类型分配项目，点击【+ 拆分】可将单项费用拆为多行预算归属（如部分向客户请款、部分自负）</span>
            </div>
            <table className="yn-bm-detail-table">
                <thead>
                    <tr>
                        <th style={{ width: '45px', textAlign: 'center' }}>行号</th>
                        <th style={{ width: '130px' }}>
                            <span className="yn-bm-badge-claim">[报销]</span> 费用类型
                        </th>
                        <th style={{ width: '110px', textAlign: 'right' }}>
                            <span className="yn-bm-badge-claim">[报销]</span> 费用总额
                        </th>
                        <th style={{ width: '320px' }}>
                            <span className="yn-bm-badge-common">[共通]</span> 预算归属 (项目维表) <span className="yn-bm-req-star">*</span>
                        </th>
                        <th style={{ width: '110px', textAlign: 'right' }}>
                            <span className="yn-bm-badge-claim">[报销]</span> 分摊金额
                        </th>
                        <th style={{ width: '95px', textAlign: 'right' }}>
                            <span className="yn-bm-badge-claim">[报销]</span> 分摊比例 <span className="yn-bm-req-star">*</span>
                        </th>
                        <th style={{ width: '100px', textAlign: 'center' }}>
                            <span className="yn-bm-badge-common">[共通]</span> 是否向客户请款
                        </th>
                        <th style={{ width: '90px', textAlign: 'center' }}>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {allocations.map((alloc, idx) => {
                        const isProjectMissing = Boolean(missingMap?.[`alloc_${alloc.id}_projectName`]);
                        const isRatioSumError = Boolean(missingMap?.[`alloc_ratio_sum_${alloc.expenseTypeName}`]);

                        return (
                            <tr key={alloc.id}>
                                <td style={{ textAlign: 'center', fontWeight: 600 }}>{idx + 1}</td>
                                <td>
                                    <span className="yn-bm-exp-type-badge">{alloc.expenseTypeName}</span>
                                </td>
                                <td style={{ textAlign: 'right', fontFamily: 'var(--bm-mono)' }}>
                                    {formatCurrency(alloc.expenseAmount)}
                                </td>
                                <td>
                                    <ProjectSearchInput
                                        value={alloc.projectName}
                                        isMissing={isProjectMissing}
                                        missingMessage={missingMap?.[`alloc_${alloc.id}_projectName`]}
                                        dataBillId={billId}
                                        dataField={`alloc_${alloc.id}_projectName`}
                                        onChange={(name, vo) => {
                                            onUpdateField(billId, alloc.id, 'projectName', name);
                                            if (vo?.id) onUpdateField(billId, alloc.id, 'projectId', vo.id);
                                        }}
                                        onSearch={onSearchProject}
                                    />
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="yn-bm-cell-input yn-bm-number-input"
                                        value={alloc.allocatedAmount}
                                        onChange={e => onUpdateField(billId, alloc.id, 'allocatedAmount', Number(e.target.value) || 0)}
                                    />
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3px' }}>
                                        <input
                                            type="number"
                                            step="1"
                                            style={{ width: '52px', textAlign: 'right', padding: '1px 4px' }}
                                            className={`yn-bm-cell-input yn-bm-number-input ${isRatioSumError ? 'is-missing' : ''}`}
                                            value={alloc.ratioPercent}
                                            title={isRatioSumError ? missingMap?.[`alloc_ratio_sum_${alloc.expenseTypeName}`] : ''}
                                            onChange={e => onUpdateField(billId, alloc.id, 'ratioPercent', Number(e.target.value) || 0)}
                                        />
                                        <span style={{ fontSize: '11px', color: '#64748b' }}>%</span>
                                    </div>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    <ToggleSwitch
                                        checked={alloc.customerCharge}
                                        onChange={v => onUpdateField(billId, alloc.id, 'customerCharge', v)}
                                    />
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                        <button
                                            type="button"
                                            className="yn-bm-btn-split-row"
                                            onClick={() => onSplit(billId, alloc.id)}
                                            title="拆分为多行预算归属 (如部分请款)"
                                        >
                                            + 拆分
                                        </button>
                                        {allocations.length > 1 && (
                                            <button
                                                type="button"
                                                className="yn-bm-btn-delete-row"
                                                onClick={() => onRemove(billId, alloc.id)}
                                                title="删除此拆分行"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
});

// ─── 出差工作总结报告抽屉 (Markdown) ───────────────────────────

const TravelReportDrawer = React.memo(({
    isOpen,
    title,
    content,
    onClose,
    onSave,
}: {
    isOpen: boolean;
    title: string;
    content: string;
    onClose: () => void;
    onSave: (text: string) => void;
}) => {
    const [text, setText] = useState(content || '');

    useEffect(() => {
        setText(content || '');
    }, [content]);

    if (!isOpen) return null;

    return (
        <div className="yn-bm-drawer-mask" onClick={onClose}>
            <div className="yn-bm-drawer-content" onClick={e => e.stopPropagation()}>
                <div className="yn-bm-drawer-header">
                    <div>
                        <span className="title">📝 出差工作总结报告 (Markdown)</span>
                        <span className="subtitle">{title} · 对应单据 F_BGNR 富文本区</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button type="button" className="yn-bm-close-x" onClick={onClose}>✕</button>
                    </div>
                </div>

                <div className="yn-bm-drawer-body">
                    <textarea
                        className="yn-bm-report-textarea"
                        placeholder="在此输入出差总结报告 (支持 Markdown 格式，包含技术交流成果、业务推进与后续跟进等)..."
                        value={text}
                        onChange={e => setText(e.target.value)}
                    />
                </div>

                <div className="yn-bm-drawer-footer">
                    <span className="count">字数统计: {text.length} 字符</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" className="yn-bm-btn yn-bm-btn--secondary" onClick={onClose}>取消</button>
                        <button
                            type="button"
                            className="yn-bm-btn yn-bm-btn--primary"
                            onClick={() => {
                                onSave(text);
                                onClose();
                            }}
                        >
                            保存出差报告
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

// ─── 主看板工作台组件 (Pure Table Grid Mode) ──────────────────

export function BillManagementDashboard({
    initialState,
    onSaveDrafts,
    onSearchProject,
    rawGroups,
    defaultProjectName,
    defaultApplicantName,
}: BillManagementDashboardProps) {
    const [billPlans, setBillPlans] = useState<BillPlan[]>(initialState.billPlans);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(initialState.selectedBillIds);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(initialState.billPlans.filter(b => b.type === 'BC').map(b => b.id)));
    const [isProcessing, setIsProcessing] = useState(false);
    const [progressText, setProgressText] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    const [activeReportBillId, setActiveReportBillId] = useState<string | null>(null);
    const [availableSCs, setAvailableSCs] = useState<AvailableSCItem[]>([]);
    const [userReimbursementBills, setUserReimbursementBills] = useState<UserReimbursementBillSummary[]>([]);
    const [scModalPlanId, setScModalPlanId] = useState<string | null>(null);
    const [scFilterKeyword, setScFilterKeyword] = useState<string>('');

    // ── 必填与数据完整性校验 (实时) ──
    const validation = useMemo(() => validateBillPlans(billPlans), [billPlans]);

    // ── 统计计算 ──
    const stats = useMemo(() => {
        const selected = billPlans.filter(b => selectedIds.has(b.id));
        return {
            totalBills: billPlans.length,
            bcCount: billPlans.filter(b => b.type === 'BC').length,
            bjCount: billPlans.filter(b => b.type === 'BJ').length,
            selectedCount: selected.length,
            totalExpenses: selected.reduce((s, b) => s + b.expenseCount, 0),
            totalInvoices: selected.reduce((s, b) => s + b.invoiceCount, 0),
            totalAmount: selected.reduce((s, b) => s + b.totalAmount, 0),
            scTotalBudget: selected
                .filter(b => b.scPlan)
                .reduce((s, b) => s + (b.scPlan?.totalBudget || 0), 0),
        };
    }, [billPlans, selectedIds]);

    // ── 过滤搜索 ──
    const filteredPlans = useMemo(() => {
        if (!searchQuery.trim()) return billPlans;
        const q = searchQuery.toLowerCase();
        return billPlans.filter(b =>
            b.title.toLowerCase().includes(q) ||
            b.destination.toLowerCase().includes(q) ||
            b.purpose.toLowerCase().includes(q) ||
            b.projectName.toLowerCase().includes(q) ||
            BILL_TYPE_LABELS[b.type].includes(q)
        );
    }, [billPlans, searchQuery]);

    const targetPlanForScModal = useMemo(() =>
        scModalPlanId ? billPlans.find(b => b.id === scModalPlanId) || null : null,
        [billPlans, scModalPlanId]
    );

    const filteredAvailableSCs = useMemo(() => {
        if (!scFilterKeyword.trim()) return availableSCs;
        const kw = scFilterKeyword.trim().toLowerCase();
        return availableSCs.filter(sc =>
            (sc.billCode || '').toLowerCase().includes(kw) ||
            (sc.destination || '').toLowerCase().includes(kw) ||
            (sc.purpose || '').toLowerCase().includes(kw) ||
            (sc.projectName || '').toLowerCase().includes(kw) ||
            (sc.approvalStatusText || '').toLowerCase().includes(kw) ||
            (sc.startDate || '').includes(kw) ||
            (sc.endDate || '').includes(kw)
        );
    }, [availableSCs, scFilterKeyword]);

    // ── Handlers ──
    const handleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        if (selectedIds.size === filteredPlans.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredPlans.map(b => b.id)));
        }
    }, [selectedIds, filteredPlans]);

    const handleToggleExpand = useCallback((id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const handleExpandAll = useCallback(() => {
        const bcIds = billPlans.filter(b => b.type === 'BC').map(b => b.id);
        if (expandedIds.size === bcIds.length) {
            setExpandedIds(new Set());
        } else {
            setExpandedIds(new Set(bcIds));
        }
    }, [billPlans, expandedIds]);

    const handleFieldChange = useCallback((billId: string, field: keyof BillPlan, val: any) => {
        setBillPlans(prev => updateBillPlanField(prev, billId, field, val));
    }, []);

    const handleSCFieldChange = useCallback((billId: string, field: keyof SCPlan, val: any) => {
        setBillPlans(prev => updateSCField(prev, billId, field, val));
    }, []);

    const handleAddLeg = useCallback((billId: string) => {
        setBillPlans(prev => prev.map(p => {
            if (p.id !== billId || !p.scPlan) return p;
            const newLegs: TripLeg[] = [
                ...(p.scPlan.legs || []),
                {
                    date: p.scPlan.endDate ? `${p.scPlan.endDate}T18:00` : '2026-07-25T18:00',
                    fromCity: p.scPlan.destination || '出差地',
                    toCity: '上海',
                    transport: '飞机/高铁',
                    travelerName: p.scPlan.applicantName,
                }
            ];
            return {
                ...p,
                scPlan: { ...p.scPlan, legs: newLegs }
            };
        }));
    }, []);

    const handleRemoveLeg = useCallback((billId: string, idx: number) => {
        setBillPlans(prev => prev.map(p => {
            if (p.id !== billId || !p.scPlan) return p;
            const newLegs = (p.scPlan.legs || []).filter((_, i) => i !== idx);
            return {
                ...p,
                scPlan: { ...p.scPlan, legs: newLegs }
            };
        }));
    }, []);

    const handleUpdateLeg = useCallback((billId: string, idx: number, field: keyof TripLeg, val: any) => {
        setBillPlans(prev => prev.map(p => {
            if (p.id !== billId || !p.scPlan) return p;
            const newLegs = (p.scPlan.legs || []).map((leg, i) =>
                i === idx ? { ...leg, [field]: val } : leg
            );
            return {
                ...p,
                scPlan: { ...p.scPlan, legs: newLegs }
            };
        }));
    }, []);

    // 预算归属分摊操作
    const handleSplitAllocation = useCallback((billId: string, allocId: string) => {
        setBillPlans(prev => splitBudgetAllocation(prev, billId, allocId));
    }, []);

    const handleRemoveAllocation = useCallback((billId: string, allocId: string) => {
        setBillPlans(prev => removeBudgetAllocation(prev, billId, allocId));
    }, []);

    const handleUpdateAllocationField = useCallback((billId: string, allocId: string, field: keyof BudgetAllocationItem, val: any) => {
        setBillPlans(prev => updateBudgetAllocationField(prev, billId, allocId, field, val));
    }, []);

    const handleSaveReport = useCallback((text: string) => {
        if (!activeReportBillId) return;
        setBillPlans(prev => updateBillPlanField(prev, activeReportBillId, 'travelReport', text));
    }, [activeReportBillId]);

    // ── AI 智能副驾一键补全漏填字段 ──
    const handleAutoFillWithAi = useCallback(async () => {
        const { updatedPlans, filledCount } = autoFillBillPlansWithAi(
            billPlans,
            rawGroups || [],
            defaultProjectName,
            defaultApplicantName
        );

        let finalPlans = updatedPlans;

        // 异步通过系统维表搜索接口解析并补全项目全称 (格式如 "X2607-001 住友理工集团网络整合调研")
        if (onSearchProject) {
            finalPlans = await Promise.all(updatedPlans.map(async plan => {
                const curProj = (plan.projectName || '').trim();
                if (!curProj) return plan;

                const codeMatch = curProj.match(/([A-Z0-9]{3,}-[0-9]+)/);
                const query = codeMatch ? codeMatch[1] : curProj;
                if (!query) return plan;

                try {
                    const results = await onSearchProject(query);
                    if (results && results.length > 0) {
                        const exact = (codeMatch ? results.find(r => (r.code || '').toUpperCase() === query.toUpperCase()) : null) ||
                            results.find(r => (r.name || '').includes(query) || (r.code || '').includes(query)) ||
                            results[0];
                        if (exact && (exact.name || exact.code)) {
                            const fullName = exact.code && !exact.name.includes(exact.code)
                                ? `${exact.code} ${exact.name}`.trim()
                                : (exact.name || exact.code);
                            const projId = exact.id || plan.projectId || '';

                            const updatedLegs = ((plan.scPlan?.legs || [])).map(leg => {
                                const isExt = leg.travelerName ? (leg.travelerName !== plan.applicantName && !leg.travelerName.includes(plan.applicantName)) : false;
                                return {
                                    ...leg,
                                    date: normalizeToDatetimeLocal(leg.date, '09:00'),
                                    flightOrTrain: formatFlightTrainRemark(leg.flightOrTrain || leg.transport || '', leg.travelerName || '', isExt, fullName)
                                };
                            });

                            const updatedSc = plan.scPlan ? {
                                ...plan.scPlan,
                                projectName: fullName,
                                projectId: projId,
                                legs: updatedLegs,
                            } : undefined;

                            const updatedAllocations = (plan.budgetAllocations || []).map(alloc => ({
                                ...alloc,
                                projectName: fullName,
                                projectId: projId || alloc.projectId,
                            }));

                            return {
                                ...plan,
                                projectName: fullName,
                                projectId: projId,
                                scPlan: updatedSc,
                                budgetAllocations: updatedAllocations,
                            };
                        }
                    }
                } catch (e) {
                    console.warn(`[handleAutoFillWithAi] 维表搜索项目 ${query} 失败:`, e);
                }
                return plan;
            }));
        }

        setBillPlans(finalPlans);
        setProgressText(`✨ AI 智能副驾已成功补全 ${filledCount} 处要素（出差地、日程、航段、充裕预算与维表项目归属）`);
        // 自动展开所有出差单，方便用户一目了然核对
        const bcIds = finalPlans.filter(b => b.type === 'BC').map(b => b.id);
        setExpandedIds(new Set(bcIds));
    }, [billPlans, rawGroups, defaultProjectName, defaultApplicantName, onSearchProject]);

    // ── 一键聚焦跳转首处漏填项 ──
    const handleFocusFirstMissing = useCallback(() => {
        if (validation.errors.length === 0) return;
        const firstErr = validation.errors[0];
        // 如果属于某个单据的子表格，先自动展开该单据
        if (firstErr.subTable) {
            setExpandedIds(prev => new Set(prev).add(firstErr.billId));
        }
        setTimeout(() => {
            const el = document.querySelector<HTMLElement>(`[data-bill-id="${firstErr.billId}"][data-field="${firstErr.field}"]`) ||
                document.querySelector<HTMLElement>('.yn-bm-cell-input.is-missing');
            if (el) {
                el.focus();
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 60);
    }, [validation]);

    // ── 注册全局 AI Copilot 通信桥 (支持右侧 AssistantChatPanel 对话驱动) ──
    useEffect(() => {
        const bridge = {
            getState: () => ({
                plans: billPlans,
                validation,
            }),
            updateField: (billId: string, field: keyof BillPlan, val: any) => {
                setBillPlans(prev => updateBillPlanField(prev, billId, field, val));
            },
            updateSCField: (billId: string, field: keyof SCPlan, val: any) => {
                setBillPlans(prev => updateSCField(prev, billId, field, val));
            },
            autoFillAll: handleAutoFillWithAi,
            setPlans: (newPlans: BillPlan[]) => {
                setBillPlans(newPlans);
            },
        };
        (window as any).__YN_BILL_COPILOT__ = bridge;

        const handleCustomEvent = (e: any) => {
            const detail = e.detail;
            if (!detail) return;
            if (detail.action === 'AUTO_FILL') {
                handleAutoFillWithAi();
            } else if (detail.action === 'UPDATE_FIELD' && detail.billId && detail.field) {
                setBillPlans(prev => updateBillPlanField(prev, detail.billId, detail.field, detail.val));
            } else if (detail.action === 'UPDATE_SC_FIELD' && detail.billId && detail.field) {
                setBillPlans(prev => updateSCField(prev, detail.billId, detail.field, detail.val));
            }
        };
        window.addEventListener('YN_COPILOT_BILL_COMMAND' as any, handleCustomEvent as any);

        return () => {
            delete (window as any).__YN_BILL_COPILOT__;
            window.removeEventListener('YN_COPILOT_BILL_COMMAND' as any, handleCustomEvent as any);
        };
    }, [billPlans, validation, handleAutoFillWithAi]);

    // ── 异步刷新出差申请单台账、审批流与已建报销单状态 ──
    const refreshSCStatuses = useCallback(async () => {
        const globalState = getInvoicePoolGlobalState();
        try {
            const [approvedAccounts, myAppStatusMap, userBcList] = await Promise.all([
                fetchApprovedTripApplicationsFromMachineAccountApi(globalState).catch(() => [] as ApprovedMachineAccountItem[]),
                fetchMyApplicationsStatusApi(globalState).catch(() => new Map<string, any>()),
                fetchUserReimbursementBillsListApi(globalState).catch(() => [] as UserReimbursementBillSummary[])
            ]);

            setUserReimbursementBills(userBcList);

            // 汇总全量出差申请单（台账已审批 + 审批流中 + 草稿）
            const scItems: AvailableSCItem[] = [];
            const seenCodes = new Set<string>();

            // 1. 台账已入账 (最高权威与可用额度)
            for (const acc of approvedAccounts) {
                const code = (acc.billCode || '').trim();
                if (!code) continue;
                seenCodes.add(code.toUpperCase());
                scItems.push({
                    billCode: acc.billCode,
                    machineAccountId: acc.machineAccountId,
                    machineAccountDefineId: acc.machineAccountDefineId,
                    destination: acc.destination,
                    purpose: acc.purpose,
                    startDate: acc.startDate,
                    endDate: acc.endDate,
                    approvalStatus: 'approved',
                    approvalStatusText: '已审批 (台账就绪)',
                    balanceAmount: acc.balanceAmount,
                    budgetSum: acc.balanceAmount,
                    projectId: acc.projectId || '',
                    projectName: acc.projectName || '',
                    applicantDate: acc.applicantDate,
                });
            }

            // 2. 我的申请单列表中处于审批中或草稿状态的 SC 单据
            const pendingDetails: AvailableSCItem[] = [];
            myAppStatusMap.forEach((statusInfo, code) => {
                const normCode = (code || '').trim().toUpperCase();
                if (!seenCodes.has(normCode)) {
                    seenCodes.add(normCode);
                    const st = statusInfo.status || '';
                    const isApproved =
                        st === '审批结束' ||
                        st === '已审批' ||
                        st === '审批通过' ||
                        st.includes('结束') ||
                        st.includes('通过') ||
                        statusInfo.currentNode === '结束' ||
                        statusInfo.statusEnum === 'APPROVED';
                    const isApproving = !isApproved && (
                        st === '审批中' ||
                        st === 'APPROVING' ||
                        statusInfo.statusEnum === 'APPROVING' ||
                        (st.includes('审批') && !st.includes('未') && !st.includes('结束') && !st.includes('驳回'))
                    );
                    const isDraft = st === '未提交' || st === 'UNCOMMITTED' || statusInfo.statusEnum === 'UNCOMMITTED';

                    let approvalStatusText = st;
                    let approvalStatus: 'approved' | 'approving' | 'draft' = 'draft';
                    if (isApproved) {
                        approvalStatus = 'approved';
                        approvalStatusText = '已审批 (审批结束)';
                    } else if (isApproving) {
                        approvalStatus = 'approving';
                        approvalStatusText = statusInfo.currentApprover ? `审批中 (${statusInfo.currentApprover})` : '审批中';
                    } else if (isDraft) {
                        approvalStatus = 'draft';
                        approvalStatusText = '草稿未提交';
                    }

                    const scItem: AvailableSCItem = {
                        billCode: statusInfo.billCode || code,
                        billMainId: statusInfo.billMainId,
                        destination: '',
                        purpose: statusInfo.billName || '',
                        approvalStatus,
                        approvalStatusText,
                        currentApprover: statusInfo.currentApprover,
                        currentNode: statusInfo.currentNode,
                        budgetSum: statusInfo.budgetSum,
                        applicantDate: statusInfo.applicantDate,
                    };
                    scItems.push(scItem);
                    if (scItem.billMainId) {
                        pendingDetails.push(scItem);
                    }
                }
            });

            // 并发异步补全申请单的真实目的地、事由与预算项目 (解决出差地检索与预算项目显示)
            if (pendingDetails.length > 0) {
                const topPending = pendingDetails.slice(0, 30);
                await Promise.all(topPending.map(async item => {
                    try {
                        const detail = await fetchApplicationDetailApi(item.billMainId!, globalState);
                        if (detail) {
                            item.destination = detail.destination || item.destination;
                            item.purpose = detail.purpose || item.purpose;
                            item.projectName = detail.projectName || item.projectName;
                            item.projectId = detail.projectId || item.projectId;
                            item.startDate = detail.startDate || item.startDate;
                            item.endDate = detail.endDate || item.endDate;
                            if (detail.legs && detail.legs.length > 0) item.legs = detail.legs;
                            if (detail.purpose) item.purpose = detail.purpose;
                            if (detail.projectName) item.projectName = detail.projectName;
                            if (detail.projectId) item.projectId = detail.projectId;
                            if (detail.startDate) item.startDate = detail.startDate;
                            if (detail.endDate) item.endDate = detail.endDate;
                            if (detail.legs && detail.legs.length > 0) item.legs = detail.legs;
                            if (detail.status === 'APPROVED' || detail.status === '审批通过' || detail.status === '已审批' || detail.status === '审批结束' || detail.status?.includes('结束')) {
                                item.approvalStatus = 'approved';
                                item.approvalStatusText = '已审批 (审批结束)';
                            }
                        }
                    } catch (e) {
                        // ignore single detail error
                    }
                }));
            }

            const completedSCs = [...scItems];
            setAvailableSCs(completedSCs);

            setBillPlans(prev => prev.map(plan => {
                let updated = { ...plan };
                if (plan.scPlan) {
                    const sc = { ...plan.scPlan };
                    const scCode = (sc.billCode || '').trim().toUpperCase();

                    // 核心自动对齐策略升级：优先按照【起止时间区间 100% 一致 (From ~ To)】或单号精确关联
                    const pStart = (plan.startDate || '').split('T')[0].split(' ')[0];
                    const pEnd = (plan.endDate || '').split('T')[0].split(' ')[0];
                    const matchedAccount = scItems.find(a => {
                        const aStart = (a.startDate || '').split('T')[0].split(' ')[0];
                        const aEnd = (a.endDate || '').split('T')[0].split(' ')[0];
                        // 1. 单号已存在且精确对齐
                        if (scCode && a.billCode.trim().toUpperCase() === scCode) return true;
                        // 2. 时间区间 From ~ To 100% 一致且已审批通过
                        if (a.approvalStatus === 'approved' && pStart && pEnd && aStart && aEnd && pStart === aStart && pEnd === aEnd) return true;
                        // 3. 目的地一致且审批通过
                        if (!scCode && a.approvalStatus === 'approved' && a.destination && plan.destination &&
                            (a.destination.includes(plan.destination) || plan.destination.includes(a.destination))) {
                            if (pStart && aStart && pStart === aStart) return true;
                            if (!pStart || !aStart) return true;
                        }
                        return false;
                    });

                    if (matchedAccount) {
                        sc.billCode = matchedAccount.billCode;
                        sc.billMainId = matchedAccount.billMainId || sc.billMainId;
                        sc.approvalStatus = matchedAccount.approvalStatus;
                        sc.approvalStatusText = matchedAccount.approvalStatusText;
                        sc.machineAccountId = matchedAccount.machineAccountId;
                        sc.machineAccountBalance = matchedAccount.balanceAmount;
                        sc.currentApprover = matchedAccount.currentApprover;
                        sc.currentNode = matchedAccount.currentNode;
                        if (matchedAccount.legs && matchedAccount.legs.length > 0) {
                            sc.legs = matchedAccount.legs;
                        }

                        // 权威继承出差申请单中的预算归属项目 (核心修复 BUG 2)
                        if (matchedAccount.projectName) {
                            sc.projectName = matchedAccount.projectName;
                            sc.projectId = matchedAccount.projectId || sc.projectId || '';
                            updated.projectName = matchedAccount.projectName;
                            updated.projectId = matchedAccount.projectId || updated.projectId || '';
                            updated.budgetAllocations = (updated.budgetAllocations || []).map(alloc => ({
                                ...alloc,
                                projectName: matchedAccount.projectName!,
                                projectId: matchedAccount.projectId || alloc.projectId || ''
                            }));
                        }

                        // 统一同步航段备注格式与标准日期
                        if (sc.legs && sc.legs.length > 0) {
                            const pName = sc.projectName || updated.projectName || '';
                            sc.legs = sc.legs.map(leg => {
                                const isExt = leg.travelerName ? (leg.travelerName !== plan.applicantName && !leg.travelerName.includes(plan.applicantName)) : false;
                                return {
                                    ...leg,
                                    date: normalizeToDatetimeLocal(leg.date, '09:00'),
                                    flightOrTrain: formatFlightTrainRemark(leg.flightOrTrain || leg.transport || '', leg.travelerName || '', isExt, pName)
                                };
                            });
                        }
                    } else if (scCode) {
                        const statusInfo = myAppStatusMap.get(scCode);
                        if (statusInfo) {
                            const st = statusInfo.status || '';
                            const isApproved =
                                st === '审批结束' ||
                                st === '已审批' ||
                                st === '审批通过' ||
                                st.includes('结束') ||
                                st.includes('通过') ||
                                statusInfo.currentNode === '结束' ||
                                statusInfo.statusEnum === 'APPROVED';
                            const isApproving = !isApproved && (
                                st === '审批中' ||
                                st === 'APPROVING' ||
                                statusInfo.statusEnum === 'APPROVING' ||
                                (st.includes('审批') && !st.includes('未') && !st.includes('结束') && !st.includes('驳回'))
                            );
                            const isDraft = st === '未提交' || st === 'UNCOMMITTED' || statusInfo.statusEnum === 'UNCOMMITTED';
                            if (isApproved) {
                                sc.approvalStatus = 'approved';
                                sc.approvalStatusText = '已审批 (审批结束)';
                            } else if (isApproving) {
                                sc.approvalStatus = 'approving';
                                sc.approvalStatusText = statusInfo.currentApprover ? `审批中 (${statusInfo.currentApprover})` : '审批中';
                                sc.currentApprover = statusInfo.currentApprover;
                                sc.currentNode = statusInfo.currentNode;
                            } else {
                                sc.approvalStatus = 'draft';
                                sc.approvalStatusText = isDraft ? '草稿未提交' : st;
                            }
                        }
                    }
                    updated.scPlan = sc;
                }

                // 关联与检测已建报销单 (核心修复 BUG 1)
                const planDest = (plan.destination || '').trim();
                const matchedBc = userBcList.find(bc =>
                    (updated.scPlan?.billCode && bc.billName.includes(updated.scPlan.billCode)) ||
                    (planDest && bc.billName.includes(planDest))
                );
                if (matchedBc) {
                    updated.existingBcBillCode = matchedBc.billCode;
                    updated.existingBcBillMainId = matchedBc.billMainId;
                    updated.existingBcStatus = matchedBc.status;
                }

                return updated;
            }));
        } catch (e: any) {
            console.warn('[BillManagementDashboard] 刷新申请单状态失败:', e);
        }
    }, []);

    useEffect(() => {
        refreshSCStatuses();
    }, [refreshSCStatuses]);

    // ── 交互选择并关联出差申请单 (SC) ──
    const handleLinkSC = useCallback(async (targetPlanId: string, item: AvailableSCItem) => {
        let effectiveProjectName = item.projectName || '';
        let effectiveProjectId = item.projectId || '';
        let effectiveLegs: TripLeg[] = item.legs || [];

        // 若当前选中的申请单尚未拉取到预算项目或行程（例如在审批中），实时抓取完整单据详情
        if ((!effectiveProjectName || effectiveLegs.length === 0) && item.billMainId) {
            try {
                const globalState = getInvoicePoolGlobalState();
                const detail = await fetchApplicationDetailApi(item.billMainId, globalState);
                if (detail?.projectName) {
                    effectiveProjectName = detail.projectName;
                    effectiveProjectId = detail.projectId || '';
                }
                if (detail?.legs && detail.legs.length > 0) {
                    effectiveLegs = detail.legs;
                }
            } catch (e) {
                console.warn('[handleLinkSC] 提取申请单详情失败:', e);
            }
        }

        setBillPlans(prev => prev.map(p => {
            if (p.id !== targetPlanId) return p;
            const currentSc = p.scPlan || {
                applicantName: p.applicantName,
                tripType: '境内出張',
                destination: p.destination,
                purpose: p.purpose,
                startDate: p.startDate,
                endDate: p.endDate,
                days: 1,
                nights: 0,
                legs: [],
                airfareBudget: 0,
                hotelBudget: 0,
                mealAllowance: 0,
                otherBudget: 0,
                totalBudget: p.totalAmount,
                projectId: '',
                projectName: '',
                customerCharge: false,
            };

            const newSc: SCPlan = {
                ...currentSc,
                billCode: item.billCode,
                billMainId: item.billMainId || currentSc.billMainId,
                machineAccountId: item.machineAccountId,
                machineAccountBalance: item.balanceAmount,
                approvalStatus: item.approvalStatus,
                approvalStatusText: item.approvalStatusText,
                currentApprover: item.currentApprover,
                currentNode: item.currentNode,
                legs: (effectiveLegs.length > 0 ? effectiveLegs : currentSc.legs).map(leg => {
                    const isExt = leg.travelerName ? (leg.travelerName !== p.applicantName && !leg.travelerName.includes(p.applicantName)) : false;
                    const pName = effectiveProjectName || currentSc.projectName || p.projectName || '';
                    return {
                        ...leg,
                        date: normalizeToDatetimeLocal(leg.date, '09:00'),
                        flightOrTrain: formatFlightTrainRemark(leg.flightOrTrain || leg.transport || '', leg.travelerName || '', isExt, pName)
                    };
                }),
                projectName: effectiveProjectName || currentSc.projectName,
                projectId: effectiveProjectId || currentSc.projectId,
            };

            const updatedAllocations = (p.budgetAllocations || []).map(alloc => ({
                ...alloc,
                projectName: effectiveProjectName || alloc.projectName,
                projectId: effectiveProjectId || alloc.projectId,
            }));

            return {
                ...p,
                scPlan: newSc,
                projectName: effectiveProjectName || p.projectName,
                projectId: effectiveProjectId || p.projectId,
                budgetAllocations: updatedAllocations,
            };
        }));

        setScModalPlanId(null);
        setProgressText(`✅ 已成功关联出差申请单 ${item.billCode}${effectiveProjectName ? `，预算归属已同步更新为: ${effectiveProjectName}` : ''}`);
    }, []);

    // ── 解除出差申请单关联 ──
    const handleUnlinkSC = useCallback((targetPlanId: string) => {
        setBillPlans(prev => prev.map(p => {
            if (p.id !== targetPlanId || !p.scPlan) return p;
            return {
                ...p,
                scPlan: {
                    ...p.scPlan,
                    billCode: undefined,
                    billMainId: undefined,
                    machineAccountId: undefined,
                    machineAccountBalance: undefined,
                    approvalStatus: undefined,
                    approvalStatusText: undefined,
                }
            };
        }));
        setProgressText('已解除该出差行程与申请单的关联');
    }, []);

    const handleSaveSelected = useCallback(async (mode: 'SC_ONLY' | 'BC_ONLY' | 'ALL' = 'ALL') => {
        const selected = billPlans.filter(b => selectedIds.has(b.id));
        if (selected.length === 0) return;

        if (mode === 'SC_ONLY') {
            const scTargets = selected.filter(b => Boolean(b.scPlan));
            if (scTargets.length === 0) {
                alert('⚠️ 所选单据中没有需要立项申请的出差单(SC)。');
                return;
            }
        }

        // 检查所选单据中是否有漏填必填项 (生成 SC 时只检查出差地与日程，生成 BC 时严格检查)
        const selectedErrors = validation.errors.filter(e => selectedIds.has(e.billId));
        if (selectedErrors.length > 0 && mode !== 'SC_ONLY') {
            const confirmMsg = `⚠️ 检出所选单据仍有 ${selectedErrors.length} 处必填项未填写/不合规（已用红框高亮）：\n` +
                selectedErrors.slice(0, 3).map(e => `• ${e.message}`).join('\n') +
                (selectedErrors.length > 3 ? `\n...等共 ${selectedErrors.length} 处` : '') +
                `\n\n建议点击右上角【✨ AI 智能副驾一键补全漏填】自动补齐后再入库。\n是否仍然强制保存草稿？`;
            if (!window.confirm(confirmMsg)) {
                handleFocusFirstMissing();
                return;
            }
        }

        setIsProcessing(true);
        const actionDesc = mode === 'SC_ONLY'
            ? `正在生成选中的出差申请单草稿 (SC)...`
            : `正在检测申请单台账状态并持久化报销单草稿 (BC)...`;
        setProgressText(actionDesc);

        try {
            setBillPlans(prev => prev.map(p =>
                selectedIds.has(p.id) ? { ...p, status: 'saving' as const } : p
            ));

            await onSaveDrafts(selected, mode);

            setBillPlans(prev => prev.map(p =>
                selectedIds.has(p.id) ? { ...p, status: 'saved' as const, errorMessage: '' } : p
            ));
            setProgressText(mode === 'SC_ONLY'
                ? `✅ 已成功生成出差申请单草稿，请前往【我的申请】核对并提交审批`
                : `✅ 已成功持久化 ${selected.length} 张单据草稿入库`);
        } catch (err: any) {
            setBillPlans(prev => prev.map(p =>
                selectedIds.has(p.id) ? { ...p, status: 'error' as const, errorMessage: err?.message || '保存失败' } : p
            ));
            setProgressText(`❌ 操作拦截/失败: ${err?.message || '接口异常'}`);
        } finally {
            setIsProcessing(false);
        }
    }, [billPlans, selectedIds, validation, onSaveDrafts, handleFocusFirstMissing]);

    const activeReportPlan = useMemo(() => {
        return billPlans.find(b => b.id === activeReportBillId);
    }, [billPlans, activeReportBillId]);

    const isAllSelected = selectedIds.size === filteredPlans.length && filteredPlans.length > 0;

    return (
        <div className="yn-bm-fullscreen-workspace">
            {/* ── 顶部操作与筛选栏 ── */}
            <div className="yn-bm-workspace-topbar">
                <div className="yn-bm-topbar-left">
                    <span className="yn-bm-workspace-title">📋 报销单与申请单管理工作台 (纯表格模式)</span>
                    <span className="yn-bm-top-stat">
                        共 {stats.totalBills} 张单据 (
                        <span className="yn-bm-tag yn-bm-tag--bc">{stats.bcCount} 张出差单</span>
                        {' + '}
                        <span className="yn-bm-tag yn-bm-tag--bj">{stats.bjCount} 张经费单</span>
                        )
                    </span>
                    <div className="yn-bm-header-legend" title="字段属性归属说明：共通字段同时作用于申请与报销；申请专属对应 SC 出差申请；报销专属对应 BC/BJ 报销单">
                        <span><span className="yn-bm-badge-common">[共通]</span>共通</span>
                        <span><span className="yn-bm-badge-apply">[申请]</span>申请专属</span>
                        <span><span className="yn-bm-badge-claim">[报销]</span>报销专属</span>
                    </div>
                    {/* 必填健康度指示徽章 */}
                    {validation.missingCount > 0 ? (
                        <button
                            type="button"
                            className="yn-bm-health-badge is-warning"
                            onClick={handleFocusFirstMissing}
                            title="点击自动聚焦定位首处漏填项"
                        >
                            ⚠️ 检出 {validation.missingCount} 处待补必填 (点击定位)
                        </button>
                    ) : (
                        <span className="yn-bm-health-badge is-ok" title="所有单据必填要素均已齐备，可安全保存草稿">
                            ✅ 必填项已齐备 · 可随时入库
                        </span>
                    )}
                </div>

                <div className="yn-bm-topbar-center">
                    <input
                        type="text"
                        className="yn-bm-cell-input yn-bm-search-input"
                        placeholder="搜索目的地 / 出差目的 / 项目名称..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="yn-bm-topbar-right">
                    <button
                        type="button"
                        className="yn-bm-btn yn-bm-btn--secondary yn-bm-btn--sm"
                        onClick={refreshSCStatuses}
                        title="查询最新出差申请单审批流状态与出差台账入库情况"
                    >
                        🔄 刷新审批状态
                    </button>
                    <button
                        type="button"
                        className="yn-bm-btn yn-bm-btn--ai-hero yn-bm-btn--sm"
                        onClick={handleAutoFillWithAi}
                        title="根据发票凭证与排期自动推导出差目的地、航段、合规预算及项目归属"
                    >
                        ✨ AI 智能副驾一键补全漏填
                    </button>
                    <button
                        type="button"
                        className="yn-bm-btn yn-bm-btn--secondary yn-bm-btn--sm"
                        onClick={handleExpandAll}
                        title="展开或折叠全部明细子表格"
                    >
                        {expandedIds.size > 0 ? '⊟ 折叠全部子表格' : '⊞ 平铺全部子表格'}
                    </button>
                </div>
            </div>

            {/* ── 主二维大表格 (Grid Mode · 1920*1080 适配高密度平铺) ── */}
            <div className="yn-bm-table-scroll-wrap">
                {filteredPlans.length === 0 ? (
                    <div className="yn-bm-empty">
                        <span className="icon">📂</span>
                        <span className="text">暂无待建单据</span>
                        <span className="sub">请先在【💳 费用信息明细】Tab 中整理费用并聚类 Trip</span>
                    </div>
                ) : (
                    <table className="yn-bm-spread-table">
                        <thead>
                            <tr>
                                <th style={{ width: '38px', textAlign: 'center' }}>
                                    <input
                                        type="checkbox"
                                        checked={isAllSelected}
                                        onChange={handleSelectAll}
                                        className="yn-bm-checkbox"
                                    />
                                </th>
                                <th style={{ width: '30px' }} />
                                <th style={{ width: '135px' }}>
                                    <span className="yn-bm-badge-claim">[报销]</span> 单据类型
                                </th>
                                <th style={{ width: '95px' }}>
                                    <span className="yn-bm-badge-common">[共通]</span> 出差类型
                                </th>
                                <th style={{ width: '105px' }}>
                                    <span className="yn-bm-badge-common">[共通]</span> 出差人员 <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '115px' }}>
                                    <span className="yn-bm-badge-common">[共通]</span> 出張先 (城市) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '360px' }}>
                                    <span className="yn-bm-badge-common">[共通]</span> 出張目的 (PURPOSE) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '225px' }}>
                                    <span className="yn-bm-badge-common">[共通]</span> 期間 (From ~ To) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '155px' }}>
                                    <span className="yn-bm-badge-apply">[申请]</span> 出差申请单 (SC) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '290px' }}>
                                    <span className="yn-bm-badge-common">[共通]</span> 预算归属 (项目维表) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '95px', textAlign: 'center' }}>
                                    <span className="yn-bm-badge-common">[共通]</span> 向客户请款
                                </th>
                                <th style={{ width: '130px', textAlign: 'right' }}>
                                    <span className="yn-bm-badge-apply">[申请]</span> 预算合计 (SC) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '115px', textAlign: 'right' }}>
                                    <span className="yn-bm-badge-claim">[报销]</span> 实报实销金额
                                </th>
                                <th style={{ width: '105px', textAlign: 'center' }}>
                                    <span className="yn-bm-badge-claim">[报销]</span> 出差总结报告
                                </th>
                                <th style={{ width: '95px', textAlign: 'center' }}>
                                    <span className="yn-bm-badge-claim">[报销]</span> 状态
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPlans.map(plan => {
                                const isSelected = selectedIds.has(plan.id);
                                const isExpanded = expandedIds.has(plan.id);
                                const isBC = plan.type === 'BC';
                                const sc = plan.scPlan;

                                const missingMap = validation.errorMapByBillId[plan.id] || {};
                                const isApplicantMissing = Boolean(missingMap.applicantName);
                                const isApplicantAi = plan.aiFilledFields?.includes('applicantName');
                                const isDestMissing = isBC && Boolean(missingMap.destination);
                                const isDestAi = plan.aiFilledFields?.includes('destination');
                                const isPurposeMissing = Boolean(missingMap.purpose);
                                const isPurposeAi = plan.aiFilledFields?.includes('purpose');
                                const isStartMissing = isBC && Boolean(missingMap.startDate);
                                const isStartAi = plan.aiFilledFields?.includes('startDate');
                                const isEndMissing = isBC && Boolean(missingMap.endDate);
                                const isEndAi = plan.aiFilledFields?.includes('endDate');
                                const isProjectMissing = Boolean(missingMap.projectName);
                                const isProjectAi = plan.aiFilledFields?.includes('projectName');
                                const isBudgetInsufficient = isBC && sc && Boolean(missingMap.scTotalBudget);
                                const hasAiTag = Boolean(plan.aiFilledFields && plan.aiFilledFields.length > 0);

                                return (
                                    <React.Fragment key={plan.id}>
                                        <tr className={`yn-bm-master-row ${isSelected ? 'is-selected' : ''}`}>
                                            {/* 勾选框 */}
                                            <td style={{ textAlign: 'center' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => handleSelect(plan.id)}
                                                    className="yn-bm-checkbox"
                                                />
                                            </td>

                                            {/* 展开/收起按钮 */}
                                            <td style={{ textAlign: 'center' }}>
                                                <button
                                                    type="button"
                                                    className={`yn-bm-expand-btn ${isExpanded ? 'is-open' : ''}`}
                                                    onClick={() => handleToggleExpand(plan.id)}
                                                    title="展开/收起子表格"
                                                >
                                                    ▶
                                                </button>
                                            </td>

                                            {/* 单据类型 */}
                                            <td>
                                                <select
                                                    className="yn-bm-cell-input yn-bm-select"
                                                    value={plan.type}
                                                    onChange={e => handleFieldChange(plan.id, 'type', e.target.value as BillType)}
                                                >
                                                    <option value="BC">{BILL_TYPE_LABELS.BC}</option>
                                                    <option value="BJ">{BILL_TYPE_LABELS.BJ}</option>
                                                </select>
                                            </td>

                                            {/* 出差类型 */}
                                            <td>
                                                {isBC ? (
                                                    <select
                                                        className="yn-bm-cell-input yn-bm-select"
                                                        value={plan.tripType}
                                                        onChange={e => {
                                                            const val = e.target.value as TripType;
                                                            handleFieldChange(plan.id, 'tripType', val);
                                                            if (sc) handleSCFieldChange(plan.id, 'tripType', val);
                                                        }}
                                                    >
                                                        <option value="境内出張">境内出張</option>
                                                        <option value="境外出張">境外出張</option>
                                                    </select>
                                                ) : (
                                                    <span className="yn-bm-muted">—</span>
                                                )}
                                            </td>

                                            {/* 出差人员 */}
                                            <td>
                                                <input
                                                    type="text"
                                                    className={`yn-bm-cell-input ${isApplicantMissing ? 'is-missing' : ''} ${isApplicantAi ? 'is-ai-filled' : ''}`}
                                                    value={plan.applicantName}
                                                    placeholder={isApplicantMissing ? "⚠️ 必填申请人" : "申请人"}
                                                    data-bill-id={plan.id}
                                                    data-field="applicantName"
                                                    title={isApplicantMissing ? missingMap.applicantName : (isApplicantAi ? '✦ AI 已自动对齐出差人' : '')}
                                                    onChange={e => {
                                                        handleFieldChange(plan.id, 'applicantName', e.target.value);
                                                        if (sc) handleSCFieldChange(plan.id, 'applicantName', e.target.value);
                                                    }}
                                                />
                                            </td>

                                            {/* 出張先 (城市) */}
                                            <td>
                                                {isBC ? (
                                                    <input
                                                        type="text"
                                                        className={`yn-bm-cell-input ${isDestMissing ? 'is-missing' : ''} ${isDestAi ? 'is-ai-filled' : ''}`}
                                                        value={plan.destination}
                                                        placeholder={isDestMissing ? "⚠️ 必填出差城市" : "目的地城市"}
                                                        data-bill-id={plan.id}
                                                        data-field="destination"
                                                        title={isDestMissing ? missingMap.destination : (isDestAi ? '✦ AI 已智能提取城市' : '')}
                                                        onChange={e => {
                                                            handleFieldChange(plan.id, 'destination', e.target.value);
                                                            if (sc) handleSCFieldChange(plan.id, 'destination', e.target.value);
                                                        }}
                                                    />
                                                ) : (
                                                    <span className="yn-bm-muted">—</span>
                                                )}
                                            </td>

                                            {/* 出張目的 (360px 宽度保障，彻底消除截断) */}
                                            <td>
                                                <input
                                                    type="text"
                                                    className={`yn-bm-cell-input ${isPurposeMissing ? 'is-missing' : ''} ${isPurposeAi ? 'is-ai-filled' : ''}`}
                                                    value={plan.purpose}
                                                    placeholder={isPurposeMissing ? "⚠️ 必填出差目的/业务事由..." : "输入出差目的..."}
                                                    data-bill-id={plan.id}
                                                    data-field="purpose"
                                                    title={isPurposeMissing ? missingMap.purpose : (isPurposeAi ? '✦ AI 已自动规范化事由' : '')}
                                                    onChange={e => {
                                                        handleFieldChange(plan.id, 'purpose', e.target.value);
                                                        if (sc) handleSCFieldChange(plan.id, 'purpose', e.target.value);
                                                    }}
                                                />
                                            </td>

                                            {/* 期間 From ~ To (215px 宽舒展展示) */}
                                            <td>
                                                {isBC ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                        <input
                                                            type="date"
                                                            style={{ width: '92px', fontSize: '11px', padding: '1px 3px' }}
                                                            className={`yn-bm-cell-input ${isStartMissing ? 'is-missing' : ''} ${isStartAi ? 'is-ai-filled' : ''}`}
                                                            value={plan.startDate}
                                                            data-bill-id={plan.id}
                                                            data-field="startDate"
                                                            title={isStartMissing ? missingMap.startDate : (isStartAi ? '✦ AI 提取行程起日' : '')}
                                                            onChange={e => {
                                                                handleFieldChange(plan.id, 'startDate', e.target.value);
                                                                if (sc) handleSCFieldChange(plan.id, 'startDate', e.target.value);
                                                            }}
                                                        />
                                                        <span style={{ color: '#94a3b8' }}>~</span>
                                                        <input
                                                            type="date"
                                                            style={{ width: '92px', fontSize: '11px', padding: '1px 3px' }}
                                                            className={`yn-bm-cell-input ${isEndMissing ? 'is-missing' : ''} ${isEndAi ? 'is-ai-filled' : ''}`}
                                                            value={plan.endDate}
                                                            data-bill-id={plan.id}
                                                            data-field="endDate"
                                                            title={isEndMissing ? missingMap.endDate : (isEndAi ? '✦ AI 提取行程止日' : '')}
                                                            onChange={e => {
                                                                handleFieldChange(plan.id, 'endDate', e.target.value);
                                                                if (sc) handleSCFieldChange(plan.id, 'endDate', e.target.value);
                                                            }}
                                                        />
                                                    </div>
                                                ) : (
                                                    <span className="yn-bm-muted">—</span>
                                                )}
                                            </td>

                                            {/* 出差申请单 (SC) 与审批状态 */}
                                            <td>
                                                {sc ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                                        {sc.billCode ? (
                                                            <a
                                                                href={sc.billMainId ? `#/billWrite?billMainId=${sc.billMainId}` : `#/billWrite?billCode=${sc.billCode}`}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '12px', color: '#2563eb', textDecoration: 'underline' }}
                                                                title="在新标签页中打开出差申请单"
                                                            >
                                                                {sc.billCode} ↗
                                                            </a>
                                                        ) : (
                                                            <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '11px', color: '#94a3b8' }}>
                                                                待第1步生成
                                                            </span>
                                                        )}

                                                        {sc.approvalStatus === 'approved' ? (
                                                            <span className="yn-bm-badge yn-bm-badge--saved" style={{ fontSize: '10px', padding: '1px 5px', width: 'fit-content' }} title={`✅ 已审批通过并入库出差申请台账${sc.machineAccountBalance ? ` (可用额度: ¥${sc.machineAccountBalance})` : ''}，可安全生成报销单`}>
                                                                ✅ 已审批 (台账就绪)
                                                            </span>
                                                        ) : sc.approvalStatus === 'approving' ? (
                                                            <span className="yn-bm-badge yn-bm-badge--saving yn-bm-badge-pulse" style={{ fontSize: '10px', padding: '1px 5px', width: 'fit-content', background: '#fef3c7', color: '#b45309' }} title={`⏳ 正在审批流中，尚未入库台账，无法关联报销单${sc.currentApprover ? ` (当前审批人: ${sc.currentApprover})` : ''}`}>
                                                                ⏳ 审批中 {sc.currentApprover ? `(${sc.currentApprover})` : '(未入账)'}
                                                            </span>
                                                        ) : sc.approvalStatus === 'draft' || sc.billCode ? (
                                                            <span className="yn-bm-badge" style={{ fontSize: '10px', padding: '1px 5px', width: 'fit-content', background: '#f1f5f9', color: '#475569' }} title="📝 申请单草稿已保存，请在【我的申请】中复核并提交审批">
                                                                📝 草稿未提交
                                                            </span>
                                                        ) : (
                                                            <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                                                                未创建申请单
                                                            </span>
                                                        )}

                                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                                                            <button
                                                                type="button"
                                                                className="yn-bm-btn-link"
                                                                onClick={() => {
                                                                    setScModalPlanId(plan.id);
                                                                    setScFilterKeyword('');
                                                                }}
                                                                style={{ fontSize: '11px', color: '#2563eb', padding: 0, textDecoration: 'underline', cursor: 'pointer', background: 'none', border: 'none' }}
                                                                title="从出差台账与我的申请中选择或切换关联申请单"
                                                            >
                                                                {sc.billCode ? '🔄 切换' : '🔍 关联已有'}
                                                            </button>
                                                            {sc.billCode && (
                                                                <button
                                                                    type="button"
                                                                    className="yn-bm-btn-link"
                                                                    onClick={() => handleUnlinkSC(plan.id)}
                                                                    style={{ fontSize: '11px', color: '#ef4444', padding: 0, cursor: 'pointer', background: 'none', border: 'none' }}
                                                                    title="解除与此申请单的关联"
                                                                >
                                                                    ✕ 解绑
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="yn-bm-muted">—</span>
                                                )}
                                            </td>

                                            {/* 预算归属 (项目维表 · 290px 宽) */}
                                            <td>
                                                <ProjectSearchInput
                                                    value={plan.projectName}
                                                    isMissing={isProjectMissing}
                                                    missingMessage={missingMap.projectName}
                                                    isAiFilled={isProjectAi}
                                                    dataBillId={plan.id}
                                                    dataField="projectName"
                                                    onChange={(name, vo) => {
                                                        handleFieldChange(plan.id, 'projectName', name);
                                                        if (vo?.id) handleFieldChange(plan.id, 'projectId', vo.id);
                                                    }}
                                                    onSearch={onSearchProject}
                                                />
                                            </td>

                                            {/* 是否向客户请款 */}
                                            <td style={{ textAlign: 'center' }}>
                                                <ToggleSwitch
                                                    checked={plan.customerCharge}
                                                    onChange={v => handleFieldChange(plan.id, 'customerCharge', v)}
                                                />
                                            </td>

                                            {/* 预算合计 (SC) */}
                                            <td style={{ textAlign: 'right' }}>
                                                {sc ? (
                                                    <span
                                                        className={`yn-bm-budget-total-col ${isBudgetInsufficient ? 'is-budget-insufficient' : ''}`}
                                                        data-bill-id={plan.id}
                                                        data-field="scTotalBudget"
                                                        title={isBudgetInsufficient ? missingMap.scTotalBudget : '预算合计 (需 ≥ 实际报销)'}
                                                    >
                                                        {formatCurrency(sc.totalBudget)}
                                                    </span>
                                                ) : (
                                                    <span className="yn-bm-muted">—</span>
                                                )}
                                            </td>

                                            {/* 实报实销金额 */}
                                            <td style={{ textAlign: 'right' }}>
                                                <span className="yn-bm-currency-val">
                                                    {formatCurrency(plan.totalAmount)}
                                                </span>
                                            </td>

                                            {/* 出差总结报告 */}
                                            <td style={{ textAlign: 'center' }}>
                                                {isBC ? (
                                                    <button
                                                        type="button"
                                                        className={`yn-bm-report-pill ${plan.travelReport ? 'has-content' : ''}`}
                                                        onClick={() => setActiveReportBillId(plan.id)}
                                                    >
                                                        {plan.travelReport ? `✅ 已填 (${plan.travelReport.length}字)` : '📝 撰写'}
                                                    </button>
                                                ) : (
                                                    <span className="yn-bm-muted">—</span>
                                                )}
                                            </td>

                                            {/* 状态 */}
                                            <td style={{ textAlign: 'center' }}>
                                                <StatusBadge status={plan.status} error={plan.errorMessage} />
                                                {plan.existingBcBillCode && (
                                                    <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
                                                        <a
                                                            href={`#/billWrite?billMainId=${plan.existingBcBillMainId}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '11px', color: '#2563eb', textDecoration: 'underline' }}
                                                            title="在新标签页查看已创建的报销单详情"
                                                        >
                                                            BC: {plan.existingBcBillCode} ↗
                                                        </a>
                                                        <span className="yn-bm-badge" style={{ fontSize: '9px', padding: '1px 5px', background: '#e0f2fe', color: '#0369a1', width: 'fit-content' }}>
                                                            {plan.existingBcStatus || '已建报销单'}
                                                        </span>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>

                                        {/* ── 展开区：纯二维子表格 (无卡片，无多余输入框) ── */}
                                        {isExpanded && (
                                            <tr className="yn-bm-subtables-row">
                                                <td colSpan={15} className="yn-bm-subtables-cell">
                                                    <div className="yn-bm-subtables-container">
                                                        {/* 子表格 1: 旅程明细 (ITINERARY) */}
                                                        {isBC && sc && (
                                                            <ItinerarySubTable
                                                                billId={plan.id}
                                                                legs={sc.legs || []}
                                                                onAddLeg={handleAddLeg}
                                                                onRemoveLeg={handleRemoveLeg}
                                                                onUpdateLeg={handleUpdateLeg}
                                                                missingMap={missingMap}
                                                                aiFilled={plan.aiFilledFields?.includes('legs')}
                                                            />
                                                        )}

                                                        {/* 子表格 2: 4 项预算核算 (BUDGET ESTIMATION) */}
                                                        {isBC && sc && (
                                                            <BudgetEstimationSubTable
                                                                billId={plan.id}
                                                                sc={sc}
                                                                claimAmount={plan.totalAmount}
                                                                onSCFieldChange={handleSCFieldChange}
                                                                isBudgetInsufficient={isBudgetInsufficient}
                                                                missingMessage={missingMap.scTotalBudget}
                                                            />
                                                        )}

                                                        {/* 子表格 3: 费用与预算归属分摊 (BUDGET ALLOCATION & SPLIT) */}
                                                        <BudgetAllocationSubTable
                                                            billId={plan.id}
                                                            allocations={plan.budgetAllocations || []}
                                                            onSplit={handleSplitAllocation}
                                                            onRemove={handleRemoveAllocation}
                                                            onUpdateField={handleUpdateAllocationField}
                                                            onSearchProject={onSearchProject}
                                                            missingMap={missingMap}
                                                        />
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── 底部操作条 ── */}
            <div className="yn-bm-workspace-footer">
                <div className="yn-bm-footer-summary">
                    <span className="pill">已选 <strong>{stats.selectedCount}</strong> 张单据</span>
                    <span className="pill">关联 <strong>{stats.totalExpenses}</strong> 笔费用</span>
                    <span className="pill">票据 <strong>{stats.totalInvoices}</strong> 张发票</span>
                    <span className="pill pill-primary">
                        实报实销合计: <strong>{formatCurrency(stats.totalAmount)}</strong>
                    </span>
                    {stats.scTotalBudget > 0 && (
                        <span className="pill pill-sc">
                            SC 预算总计: <strong>{formatCurrency(stats.scTotalBudget)}</strong>
                        </span>
                    )}
                </div>

                <div className="yn-bm-footer-actions">
                    {progressText && (
                        <span className="yn-bm-progress-msg">{progressText}</span>
                    )}
                    <button
                        type="button"
                        className="yn-bm-btn yn-bm-btn--secondary yn-bm-btn--lg"
                        onClick={() => handleSaveSelected('SC_ONLY')}
                        disabled={isProcessing || stats.selectedCount === 0}
                        title="第 1 步：为所选行程生成出差申请单(SC)草稿。生成后请前往【我的申请】核对并提交审批。审批通过后方可生成报销单。"
                        style={{ borderColor: '#f59e0b', color: '#b45309', fontWeight: 600, background: '#fffbeb' }}
                    >
                        📝 ① 仅生成出差申请单 (SC)
                    </button>
                    <button
                        type="button"
                        className="yn-bm-btn yn-bm-btn--primary yn-bm-btn--lg"
                        onClick={() => handleSaveSelected('BC_ONLY')}
                        disabled={isProcessing || stats.selectedCount === 0}
                        title="第 2 步：检测申请单审批状态，关联已入库台账生成出差费用报销单(BC)，自动完成预算归属关联。"
                    >
                        {isProcessing
                            ? '⏳ 正在处理中...'
                            : `💾 ② 生成费用报销单 (BC，需申请单已审批)`
                        }
                    </button>
                </div>
            </div>

            {/* ── 出差报告抽屉 ── */}
            <TravelReportDrawer
                isOpen={Boolean(activeReportBillId)}
                title={activeReportPlan?.title || '出差工作报告'}
                content={activeReportPlan?.travelReport || ''}
                onClose={() => setActiveReportBillId(null)}
                onSave={handleSaveReport}
            />

            {/* ── 出差申请单 (SC) 关联与选择弹窗 ── */}
            {scModalPlanId && (
                <div
                    className="yn-bm-modal-overlay"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(15, 23, 42, 0.65)',
                        backdropFilter: 'blur(4px)',
                        zIndex: 999999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '24px'
                    }}
                    onClick={() => setScModalPlanId(null)}
                >
                    <div
                        className="yn-bm-modal-card"
                        style={{
                            background: '#ffffff',
                            borderRadius: '12px',
                            width: '920px',
                            maxWidth: '96vw',
                            maxHeight: '85vh',
                            display: 'flex',
                            flexDirection: 'column',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                            border: '1px solid #e2e8f0',
                            overflow: 'hidden'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div style={{
                            padding: '16px 20px',
                            borderBottom: '1px solid #e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: '#f8fafc'
                        }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                                    🔍 选择并关联出差申请单 (SC)
                                </h3>
                                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                                    当前行程：<strong>{targetPlanForScModal?.title || targetPlanForScModal?.destination || '出差'}</strong> · 关联后将自动将申请单核准的预算归属（项目代码/名称）同步继承至所有费用分摊项。
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setScModalPlanId(null)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    fontSize: '20px',
                                    cursor: 'pointer',
                                    color: '#94a3b8',
                                    padding: '4px 8px'
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Filter Toolbar */}
                        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '12px', alignItems: 'center', background: '#ffffff' }}>
                            <input
                                type="text"
                                className="yn-bm-cell-input"
                                placeholder="🔍 输入单号 / 出差地 / 目的 / 预算项目代码快速过滤..."
                                value={scFilterKeyword}
                                onChange={e => setScFilterKeyword(e.target.value)}
                                style={{ flex: 1, padding: '7px 12px', fontSize: '13px' }}
                                autoFocus
                            />
                            <button
                                type="button"
                                className="yn-bm-btn yn-bm-btn--secondary yn-bm-btn--sm"
                                onClick={refreshSCStatuses}
                                title="从元年云重新查询我的申请与出差台账"
                            >
                                🔄 刷新申请单
                            </button>
                        </div>

                        {/* Table */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
                            {filteredAvailableSCs.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                                    <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
                                    <div style={{ fontSize: '14px', fontWeight: 600 }}>未检索到符合条件的出差申请单</div>
                                    <div style={{ fontSize: '12px', marginTop: '4px' }}>请确认申请单是否已在【我的申请】中保存或提交</div>
                                </div>
                            ) : (
                                <table className="yn-bm-spread-table" style={{ width: '100%', marginTop: '12px' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc' }}>
                                            <th style={{ width: '140px' }}>申请单号</th>
                                            <th style={{ width: '150px' }}>出差地 / 事由</th>
                                            <th style={{ width: '120px' }}>审批状态</th>
                                            <th style={{ width: '240px' }}>预算归属项目</th>
                                            <th style={{ width: '110px', textAlign: 'right' }}>可用额度/预算</th>
                                            <th style={{ width: '90px', textAlign: 'center' }}>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredAvailableSCs.map(item => {
                                            const isLinked = targetPlanForScModal?.scPlan?.billCode?.trim().toUpperCase() === item.billCode.trim().toUpperCase();
                                            return (
                                                <tr key={item.billCode} style={{ background: isLinked ? '#f0fdf4' : undefined }}>
                                                    <td>
                                                        <a
                                                            href={item.billMainId ? `#/billWrite?billMainId=${item.billMainId}` : `#/billWrite?billCode=${item.billCode}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            style={{ fontFamily: 'monospace', fontWeight: 700, color: '#2563eb', textDecoration: 'underline' }}
                                                            title="查看申请单原始数据"
                                                        >
                                                            {item.billCode} ↗
                                                        </a>
                                                    </td>
                                                    <td>
                                                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{item.destination || '出差'}</div>
                                                        {item.purpose && (
                                                            <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }} title={item.purpose}>
                                                                {item.purpose}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {item.approvalStatus === 'approved' ? (
                                                            <span className="yn-bm-badge yn-bm-badge--saved" style={{ fontSize: '10px' }}>
                                                                ✅ 已审批 (台账就绪)
                                                            </span>
                                                        ) : item.approvalStatus === 'approving' ? (
                                                            <span className="yn-bm-badge" style={{ fontSize: '10px', background: '#fef3c7', color: '#b45309' }}>
                                                                ⏳ {item.approvalStatusText}
                                                            </span>
                                                        ) : (
                                                            <span className="yn-bm-badge" style={{ fontSize: '10px', background: '#f1f5f9', color: '#475569' }}>
                                                                📝 {item.approvalStatusText}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span style={{ fontWeight: item.projectName ? 600 : 400, color: item.projectName ? '#1e293b' : '#94a3b8', fontSize: '12px' }}>
                                                            {item.projectName || '— (保存后由系统带出)'}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontFamily: 'var(--bm-mono)', fontWeight: 600 }}>
                                                        ¥{formatCurrency(item.balanceAmount ?? item.budgetSum ?? 0)}
                                                    </td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        {isLinked ? (
                                                            <span style={{ color: '#059669', fontWeight: 600, fontSize: '12px' }}>
                                                                ✓ 当前关联
                                                            </span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                className="yn-bm-btn yn-bm-btn--primary yn-bm-btn--xs"
                                                                onClick={() => handleLinkSC(scModalPlanId, item)}
                                                                style={{ padding: '3px 8px', fontSize: '11px' }}
                                                            >
                                                                选择并关联
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Footer */}
                        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                className="yn-bm-btn yn-bm-btn--secondary"
                                onClick={() => setScModalPlanId(null)}
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default BillManagementDashboard;
