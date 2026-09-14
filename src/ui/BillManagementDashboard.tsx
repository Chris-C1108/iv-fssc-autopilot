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
} from '../services/billPlanService';
import { ExpenseRecordGroup } from './batchEditExpenseModal';

// ─── Props ───────────────────────────────────────────────────

export interface BillManagementDashboardProps {
    initialState: BillManagementState;
    onClose?: () => void;
    onSaveDrafts: (plans: BillPlan[]) => Promise<void>;
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
                    ✈️ 旅程 (ITINERARY) 子表格
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
                            DATE (日期时间) <span className="yn-bm-req-star">*</span>
                        </th>
                        <th style={{ width: '150px' }}>
                            FROM (出发地城市) <span className="yn-bm-req-star">*</span>
                        </th>
                        <th style={{ width: '150px' }}>
                            TO (出差目的地城市) <span className="yn-bm-req-star">*</span>
                        </th>
                        <th>
                            FLIGHT/TRAIN ETC. (航班/车次备注，如“去程飞机 / 二等座”) <span className="yn-bm-req-star">*</span>
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
                                        value={leg.date ? (leg.date.includes('T') ? leg.date.slice(0, 16) : `${leg.date}T09:00`) : ''}
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
                                        placeholder="如：CZ6534 | 外驻:李建勇 去程飞机"
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
                <span className="title">💰 予算 (BUDGET ESTIMATION) 核算表格</span>
                <span className={`diff-pill ${isCovered ? 'diff-ok' : 'diff-warn'}`}>
                    {isCovered ? `✅ 预算全额覆盖实际报销 (留存差额: ${formatCurrency(diff)})` : `⚠️ 预警: 预算合计低于报销实付 ${formatCurrency(-diff)} (需增加预算)`}
                </span>
            </div>
            <table className="yn-bm-detail-table">
                <thead>
                    <tr>
                        <th style={{ width: '20%' }}>航空運賃（交通費）(AIRFARE ETC)</th>
                        <th style={{ width: '20%' }}>ホテル代 (HOTEL FEE)</th>
                        <th style={{ width: '20%' }}>誤餐補助 (Dining-delay ALLOW.)</th>
                        <th style={{ width: '20%' }}>その他 (OTHERS / 市内交通等)</th>
                        <th style={{ width: '20%', background: isBudgetInsufficient ? '#fef2f2' : '#eff6ff' }}>
                            合計 (TOTAL - 需 ≥ 实际报销) <span className="yn-bm-req-star">*</span>
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
                <span className="title">📑 费用信息与预算归属分摊表格 (BUDGET ALLOCATION & SPLIT)</span>
                <span className="hint">※ 支持按费用类型分配项目，点击【+ 拆分】可将单项费用拆为多行预算归属（如部分向客户请款、部分自负）</span>
            </div>
            <table className="yn-bm-detail-table">
                <thead>
                    <tr>
                        <th style={{ width: '45px', textAlign: 'center' }}>行号</th>
                        <th style={{ width: '130px' }}>费用类型</th>
                        <th style={{ width: '110px', textAlign: 'right' }}>费用总额</th>
                        <th style={{ width: '320px' }}>
                            预算归属 (项目维表) <span className="yn-bm-req-star">*</span>
                        </th>
                        <th style={{ width: '110px', textAlign: 'right' }}>分摊金额</th>
                        <th style={{ width: '95px', textAlign: 'right' }}>
                            分摊比例 <span className="yn-bm-req-star">*</span>
                        </th>
                        <th style={{ width: '100px', textAlign: 'center' }}>是否向客户请款</th>
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
    const handleAutoFillWithAi = useCallback(() => {
        const { updatedPlans, filledCount } = autoFillBillPlansWithAi(
            billPlans,
            rawGroups || [],
            defaultProjectName,
            defaultApplicantName
        );
        setBillPlans(updatedPlans);
        setProgressText(`✨ AI 智能副驾已成功补全 ${filledCount} 处要素（出差地、日程、航段、充裕预算与项目归属）`);
        // 自动展开所有出差单，方便用户一目了然核对
        const bcIds = updatedPlans.filter(b => b.type === 'BC').map(b => b.id);
        setExpandedIds(new Set(bcIds));
    }, [billPlans, rawGroups, defaultProjectName, defaultApplicantName]);

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

    const handleSaveSelected = useCallback(async () => {
        const selected = billPlans.filter(b => selectedIds.has(b.id));
        if (selected.length === 0) return;

        // 检查所选单据中是否有漏填必填项
        const selectedErrors = validation.errors.filter(e => selectedIds.has(e.billId));
        if (selectedErrors.length > 0) {
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
        setProgressText(`正在极速持久化 ${selected.length} 张单据草稿 (commit: false)...`);

        try {
            setBillPlans(prev => prev.map(p =>
                selectedIds.has(p.id) ? { ...p, status: 'saving' as const } : p
            ));

            await onSaveDrafts(selected);

            setBillPlans(prev => prev.map(p =>
                selectedIds.has(p.id) ? { ...p, status: 'saved' as const, errorMessage: '' } : p
            ));
            setProgressText(`✅ 已成功持久化 ${selected.length} 张单据草稿入库`);
        } catch (err: any) {
            setBillPlans(prev => prev.map(p =>
                selectedIds.has(p.id) ? { ...p, status: 'error' as const, errorMessage: err?.message || '保存失败' } : p
            ));
            setProgressText(`❌ 保存失败: ${err?.message || '接口异常'}`);
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
                                <th style={{ width: '125px' }}>单据类型</th>
                                <th style={{ width: '90px' }}>出差类型</th>
                                <th style={{ width: '95px' }}>
                                    出差人员 <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '100px' }}>
                                    出張先 (城市) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '360px' }}>
                                    出張目的 (PURPOSE) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '215px' }}>
                                    期間 (From ~ To) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '290px' }}>
                                    预算归属 (项目维表) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '85px', textAlign: 'center' }}>向客户请款</th>
                                <th style={{ width: '120px', textAlign: 'right' }}>
                                    预算合计 (SC) <span className="yn-bm-req-star">*</span>
                                </th>
                                <th style={{ width: '110px', textAlign: 'right' }}>实报实销金额</th>
                                <th style={{ width: '95px', textAlign: 'center' }}>出差总结报告</th>
                                <th style={{ width: '95px', textAlign: 'center' }}>状态</th>
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
                                            </td>
                                        </tr>

                                        {/* ── 展开区：纯二维子表格 (无卡片，无多余输入框) ── */}
                                        {isExpanded && (
                                            <tr className="yn-bm-subtables-row">
                                                <td colSpan={14} className="yn-bm-subtables-cell">
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
                        className="yn-bm-btn yn-bm-btn--primary yn-bm-btn--lg"
                        onClick={handleSaveSelected}
                        disabled={isProcessing || stats.selectedCount === 0}
                    >
                        {isProcessing
                            ? '⏳ 正在保存入库...'
                            : `💾 批量持久化已选 ${stats.selectedCount} 张草稿入库 (commit: false)`
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
        </div>
    );
}

export default BillManagementDashboard;
