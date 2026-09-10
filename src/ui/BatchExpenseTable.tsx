import React, { useState, useMemo, ChangeEvent } from 'react';
import {
    useTableSelection,
    useDebounce,
    RowItem,
    FilterParams,
    SelectionState
} from '../hooks/useTableSelection';

/**
 * 费用表格行数据模型
 */
export interface ExpenseTableRowItem extends RowItem {
    id: string;
    expenseRecordId: string;
    expenseTypeId: string;
    expenseTypeName: string;
    amount: number | string;
    invoiceCount: number;
    businessDate: string;
    earliestInvoiceDate: string;
    description: string;
    hasWarn?: boolean;
    missingRequired?: boolean;
}

/**
 * BatchExpenseTable 组件入参
 */
export interface BatchExpenseTableProps {
    data: ExpenseTableRowItem[];
    onExportSelected?: (selectedIds: string[], selectionState: SelectionState) => void;
    onBatchSave?: (selectedIds: string[], selectionState: SelectionState) => void;
    loading?: boolean;
    className?: string;
}

/**
 * 批量修改费用信息 - 严谨选择状态同步与筛选联动裁剪表格组件 (React 19)
 */
export const BatchExpenseTable: React.FC<BatchExpenseTableProps> = ({
    data,
    onExportSelected,
    onBatchSave,
    loading = false,
    className = ''
}) => {
    // 1. 筛选状态
    const [rawSearchQuery, setRawSearchQuery] = useState('');
    const [filterMode, setFilterMode] = useState<'ALL' | 'WARN' | 'MISSING_REQUIRED' | 'OK'>('ALL');

    // 2. 针对高频搜索输入增加 300ms 防抖
    const debouncedSearch = useDebounce(rawSearchQuery, 300);

    // 3. 筛选过滤计算
    const filteredData = useMemo(() => {
        return data.filter(item => {
            // 分类筛选
            if (filterMode === 'WARN' && !item.hasWarn) return false;
            if (filterMode === 'MISSING_REQUIRED' && !item.missingRequired) return false;
            if (filterMode === 'OK' && (item.hasWarn || item.missingRequired)) return false;

            // 搜索词模糊过滤
            if (debouncedSearch.trim()) {
                const q = debouncedSearch.trim().toLowerCase();
                const hit = (item.expenseTypeName && item.expenseTypeName.toLowerCase().includes(q)) ||
                            (item.description && item.description.toLowerCase().includes(q)) ||
                            (item.businessDate && item.businessDate.toLowerCase().includes(q)) ||
                            (item.earliestInvoiceDate && item.earliestInvoiceDate.toLowerCase().includes(q)) ||
                            (item.expenseRecordId && item.expenseRecordId.toLowerCase().includes(q));
                if (!hit) return false;
            }

            return true;
        });
    }, [data, filterMode, debouncedSearch]);

    // 4. 组装筛选参数供 Hook 联动监听
    const filterParams: FilterParams = useMemo(() => ({
        searchQuery: debouncedSearch,
        filterMode
    }), [debouncedSearch, filterMode]);

    // 5. 核心状态 Hook：选择状态同步与筛选联动裁剪
    const {
        selectedRowKeys,
        selectedCount,
        selectedTotalAmount,
        selectedInvoiceCount,
        isAllSelected,
        isIndeterminate,
        toggleSelectAll,
        clearSelection,
        getHeaderCheckboxProps,
        getRowCheckboxProps
    } = useTableSelection(filteredData, filterParams, {
        rowKey: 'id',
        amountExtractor: row => row.amount,
        invoiceCountExtractor: row => row.invoiceCount || 1
    });

    // 6. 搜索输入处理
    const handleSearchInput = (e: ChangeEvent<HTMLInputElement>) => {
        setRawSearchQuery(e.target.value);
    };

    const headerCheckboxProps = getHeaderCheckboxProps();

    return (
        <div className={`yn-batch-expense-table-container ${className}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* 顶部工具栏与高频防抖搜索 */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid #eaeaea',
                background: '#fafafa',
                gap: '12px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#171717' }}>🔍 列表筛选:</span>
                    <input
                        type="text"
                        placeholder="搜索费用类型/说明/日期 (300ms防抖)..."
                        value={rawSearchQuery}
                        onChange={handleSearchInput}
                        style={{
                            width: '260px',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px solid #d4d4d4',
                            fontSize: '12px'
                        }}
                    />
                    <select
                        value={filterMode}
                        onChange={e => setFilterMode(e.target.value as any)}
                        style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #d4d4d4',
                            fontSize: '12px',
                            background: '#ffffff'
                        }}
                    >
                        <option value="ALL">全部状态 ({data.length})</option>
                        <option value="MISSING_REQUIRED">待补必填项</option>
                        <option value="WARN">预警异常</option>
                        <option value="OK">正常无警报</option>
                    </select>
                </div>

                <div style={{ fontSize: '12px', color: '#737373' }}>
                    当前展示: <strong>{filteredData.length}</strong> / {data.length} 笔费用
                </div>
            </div>

            {/* 明细表格 */}
            <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead style={{ position: 'sticky', top: 0, background: '#f5f5f5', zIndex: 2 }}>
                        <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                            <th style={{ width: '40px', textAlign: 'center', padding: '8px' }}>
                                <input
                                    type="checkbox"
                                    checked={headerCheckboxProps.checked}
                                    ref={headerCheckboxProps.ref}
                                    onChange={headerCheckboxProps.onChange}
                                    title={isAllSelected ? '取消当前全选' : '全选当前结果集'}
                                />
                            </th>
                            <th style={{ width: '40px', textAlign: 'center', padding: '8px' }}>#</th>
                            <th style={{ width: '100px', textAlign: 'left', padding: '8px' }}>最早开票日</th>
                            <th style={{ width: '100px', textAlign: 'left', padding: '8px' }}>费用日期</th>
                            <th style={{ width: '120px', textAlign: 'left', padding: '8px' }}>费用类型</th>
                            <th style={{ width: '90px', textAlign: 'right', padding: '8px' }}>金额 (元)</th>
                            <th style={{ width: '70px', textAlign: 'center', padding: '8px' }}>发票张数</th>
                            <th style={{ textAlign: 'left', padding: '8px' }}>费用说明</th>
                            <th style={{ width: '80px', textAlign: 'center', padding: '8px' }}>状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#737373' }}>
                                    数据加载中...
                                </td>
                            </tr>
                        ) : filteredData.length === 0 ? (
                            <tr>
                                <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#a3a3a3' }}>
                                    没有匹配的费用记录
                                </td>
                            </tr>
                        ) : (
                            filteredData.map((row, idx) => {
                                const rowCheckProps = getRowCheckboxProps(row);
                                const isSelected = rowCheckProps.checked;
                                return (
                                    <tr
                                        key={row.id}
                                        style={{
                                            borderBottom: '1px solid #f0f0f0',
                                            background: isSelected ? '#f0f7ff' : '#ffffff',
                                            transition: 'background 0.15s ease'
                                        }}
                                    >
                                        <td style={{ textAlign: 'center', padding: '8px' }}>
                                            <input
                                                type="checkbox"
                                                checked={rowCheckProps.checked}
                                                onChange={rowCheckProps.onChange}
                                            />
                                        </td>
                                        <td style={{ textAlign: 'center', color: '#8c8c8c', padding: '8px' }}>{idx + 1}</td>
                                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>{row.earliestInvoiceDate || '-'}</td>
                                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>{row.businessDate || '-'}</td>
                                        <td style={{ padding: '8px', fontWeight: 500 }}>{row.expenseTypeName}</td>
                                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: '#fa8c16', fontFamily: 'monospace' }}>
                                            ¥{parseFloat(String(row.amount || 0)).toFixed(2)}
                                        </td>
                                        <td style={{ padding: '8px', textAlign: 'center', fontFamily: 'monospace' }}>{row.invoiceCount}</td>
                                        <td style={{ padding: '8px', color: '#525252' }}>{row.description || '-'}</td>
                                        <td style={{ padding: '8px', textAlign: 'center' }}>
                                            {row.missingRequired ? (
                                                <span style={{ fontSize: '11px', color: '#dc2626', background: '#fef2f2', padding: '2px 6px', borderRadius: '4px' }}>待补必填</span>
                                            ) : row.hasWarn ? (
                                                <span style={{ fontSize: '11px', color: '#d97706', background: '#fffbeb', padding: '2px 6px', borderRadius: '4px' }}>预警</span>
                                            ) : (
                                                <span style={{ fontSize: '11px', color: '#16a34a', background: '#f0fdf4', padding: '2px 6px', borderRadius: '4px' }}>正常</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* 底部操作浮条 (Batch Action Bar) */}
            <div style={{
                padding: '12px 20px',
                borderTop: '1px solid #eaeaea',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 -2px 10px rgba(0,0,0,0.03)'
            }}>
                {/* 响应式精准统计 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', color: '#525252' }}>
                    <span>
                        已选中: <strong style={{ color: '#171717', fontFamily: 'monospace' }}>{selectedCount}</strong> 笔记录
                    </span>
                    <span>
                        发票总数: <strong style={{ color: '#171717', fontFamily: 'monospace' }}>{selectedInvoiceCount}</strong> 张
                    </span>
                    <span>
                        金额合计: <strong style={{ color: '#096dd9', fontSize: '13px', fontFamily: 'monospace' }}>¥{selectedTotalAmount}</strong>
                    </span>
                </div>

                {/* 批量操作按钮组：selectedCount === 0 时禁用 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                        type="button"
                        disabled={selectedCount === 0}
                        onClick={clearSelection}
                        style={{
                            padding: '6px 14px',
                            fontSize: '12px',
                            borderRadius: '6px',
                            border: '1px solid #d4d4d4',
                            background: selectedCount === 0 ? '#f5f5f5' : '#ffffff',
                            color: selectedCount === 0 ? '#a3a3a3' : '#171717',
                            cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                            opacity: selectedCount === 0 ? 0.6 : 1,
                            transition: 'all 0.15s ease'
                        }}
                    >
                        取消选择 (清空)
                    </button>

                    <button
                        type="button"
                        disabled={selectedCount === 0}
                        onClick={() => onExportSelected?.(selectedRowKeys, {
                            selectedRowKeys,
                            selectedCount,
                            selectedTotalAmount,
                            selectedTotalAmountDecimal: null as any,
                            selectedInvoiceCount,
                            isAllSelected,
                            isIndeterminate
                        })}
                        style={{
                            padding: '6px 14px',
                            fontSize: '12px',
                            borderRadius: '6px',
                            border: '1px solid #d4d4d4',
                            background: selectedCount === 0 ? '#f5f5f5' : '#ffffff',
                            color: selectedCount === 0 ? '#a3a3a3' : '#171717',
                            cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                            opacity: selectedCount === 0 ? 0.6 : 1,
                            transition: 'all 0.15s ease'
                        }}
                    >
                        📥 导出所选 ({selectedCount})
                    </button>

                    <button
                        type="button"
                        disabled={selectedCount === 0}
                        onClick={() => onBatchSave?.(selectedRowKeys, {
                            selectedRowKeys,
                            selectedCount,
                            selectedTotalAmount,
                            selectedTotalAmountDecimal: null as any,
                            selectedInvoiceCount,
                            isAllSelected,
                            isIndeterminate
                        })}
                        style={{
                            padding: '6px 18px',
                            fontSize: '12px',
                            fontWeight: 600,
                            borderRadius: '6px',
                            border: 'none',
                            background: selectedCount === 0 ? '#d4d4d4' : '#000000',
                            color: '#ffffff',
                            cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                            opacity: selectedCount === 0 ? 0.6 : 1,
                            boxShadow: selectedCount > 0 ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
                            transition: 'all 0.15s ease'
                        }}
                    >
                        确认批量修改并保存 ({selectedCount})
                    </button>
                </div>
            </div>
        </div>
    );
};
