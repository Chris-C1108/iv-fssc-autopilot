import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Decimal, NumericValue } from '../utils/decimal';

/**
 * 通用表格行数据契约接口
 */
export interface RowItem {
    id?: string | number;
    key?: string | number;
    expenseRecordId?: string | number;
    amount?: NumericValue;
    expenseAmount?: NumericValue;
    totalAmount?: NumericValue;
    invoiceCount?: number;
    invoices?: any[];
    [key: string]: any;
}

/**
 * 筛选条件参数接口
 */
export interface FilterParams {
    searchQuery?: string;
    filterMode?: string;
    columnFilters?: Record<string, any>;
    page?: number;
    pageSize?: number;
    [key: string]: any;
}

/**
 * 选中状态统计与三态全选数据模型
 */
export interface SelectionState {
    /** 当前已勾选的行 Key 集合 (已自动执行筛选裁剪) */
    selectedRowKeys: string[];
    /** 选中的有效记录数 */
    selectedCount: number;
    /** 选中的精准金额合计 (已消除浮点误差，格式为两位小数字符串，如 "128.50") */
    selectedTotalAmount: string;
    /** 选中的精准金额数字对象 */
    selectedTotalAmountDecimal: Decimal;
    /** 选中的发票总张数 */
    selectedInvoiceCount: number;
    /** 表头复选框状态: 是否全选 */
    isAllSelected: boolean;
    /** 表头复选框状态: 是否半选 (部分选中) */
    isIndeterminate: boolean;
}

/**
 * useTableSelection 配置项
 */
export interface UseTableSelectionOptions<T extends RowItem> {
    /** 指定提取唯一主键的字段名，默认智能按 'id' | 'expenseRecordId' | 'key' 提取 */
    rowKey?: keyof T | ((row: T) => string);
    /** 自定义金额提取器，默认自动读取 'expenseAmount' | 'amount' | 'totalAmount' */
    amountExtractor?: (row: T) => NumericValue;
    /** 自定义发票张数提取器，默认自动读取 'invoiceCount' 或 'invoices.length' */
    invoiceCountExtractor?: (row: T) => number;
    /** 初始选中的 Key 列表 */
    defaultSelectedKeys?: string[];
    /** 选中项变更时的回调 */
    onSelectionChange?: (selectedKeys: string[], selectionState: SelectionState) => void;
    /** 防抖毫秒数，默认 300ms (用于高频筛选输入联动) */
    debounceMs?: number;
}

/**
 * useTableSelection Hook 返回对象
 */
export interface UseTableSelectionReturn<T extends RowItem> extends SelectionState {
    /** 切换指定单行的选中状态 */
    toggleRow: (key: string, checked?: boolean) => void;
    /** 切换当前筛选结果集的全选/全不选状态 */
    toggleSelectAll: (checked?: boolean) => void;
    /** 一键清空所有选中 (取消选择) */
    clearSelection: () => void;
    /** 反选当前结果集 */
    invertSelection: () => void;
    /** 手动设置选中的 Keys (会自动进行有效范围校验) */
    setSelectedRowKeys: (keys: string[]) => void;
    /** 判断指定行 Key 是否被选中 */
    isSelected: (key: string) => boolean;
    /** 获取表头全选 Checkbox 的直接绑定属性 (包含 ref 回调处理 indeterminate) */
    getHeaderCheckboxProps: () => {
        checked: boolean;
        indeterminate: boolean;
        ref: (el: HTMLInputElement | null) => void;
        onChange: (e: { target: { checked: boolean } }) => void;
    };
    /** 获取行 Checkbox 的直接绑定属性 */
    getRowCheckboxProps: (row: T) => {
        checked: boolean;
        onChange: (e: { target: { checked: boolean } }) => void;
    };
}

/**
 * 高频值防抖 Hook (针对高频搜索输入框，默认 300ms)
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(timer);
        };
    }, [value, delay]);

    return debouncedValue;
}

/**
 * 通用表格「选择状态同步与筛选联动裁剪」自定义 Hook
 * 
 * 核心机制：
 * 1. 筛选联动裁剪 (Selection Pruning): 过滤条件或数据列表变动时，严格裁剪掉不在当前结果集内的所有选中项；
 * 2. 表头全选三态联动: checked / indeterminate / unchecked 严格响应当前视图；
 * 3. 响应式底部统计浮条: 配合 Decimal 实现精准金额合计与发票总张数计算；
 * 4. 彻底规避不可见行的幽灵提交 (Ghost Mutation)。
 */
export function useTableSelection<T extends RowItem>(
    dataList: T[],
    filterParams?: FilterParams,
    options?: UseTableSelectionOptions<T>
): UseTableSelectionReturn<T> {
    const {
        rowKey = (row: T) => String(row.id ?? row.expenseRecordId ?? row.key ?? ''),
        amountExtractor,
        invoiceCountExtractor,
        defaultSelectedKeys = [],
        onSelectionChange,
        debounceMs = 300
    } = options || {};

    // 辅助函数: 提取行 Key
    const getRowId = useCallback((row: T): string => {
        if (typeof rowKey === 'function') {
            return rowKey(row);
        }
        return String(row[rowKey] ?? row.id ?? row.expenseRecordId ?? row.key ?? '');
    }, [rowKey]);

    // 辅助函数: 提取行金额
    const getRowAmount = useCallback((row: T): NumericValue => {
        if (amountExtractor) return amountExtractor(row);
        return row.expenseAmount ?? row.amount ?? row.totalAmount ?? 0;
    }, [amountExtractor]);

    // 辅助函数: 提取发票张数
    const getRowInvoiceCount = useCallback((row: T): number => {
        if (invoiceCountExtractor) return invoiceCountExtractor(row);
        if (typeof row.invoiceCount === 'number') return row.invoiceCount;
        if (Array.isArray(row.invoices)) return row.invoices.length;
        return 1;
    }, [invoiceCountExtractor]);

    // 内部维护的已选 Key 集合
    const [selectedRowKeys, setRawSelectedRowKeys] = useState<string[]>(() => {
        const initialValidKeys = new Set(dataList.map(getRowId));
        return defaultSelectedKeys.filter(k => initialValidKeys.has(k));
    });

    // 当前结果集的所有 ID Set
    const currentQueryIdSet = useMemo(() => {
        return new Set(dataList.map(getRowId));
    }, [dataList, getRowId]);

    // 对 filterParams 进行防抖监听，确保高频输入与筛选时统一裁剪
    const debouncedFilterParams = useDebounce(filterParams, debounceMs);

    // =========================================================================
    // 核心约束 1: 筛选联动裁剪 (Selection Pruning)
    // 任何筛选导致数据刷新或参数变更时，必须执行 selectedRowKeys.filter(...)
    // 严禁保留当前筛选视图外的不可见项，彻底消除幽灵提交！
    // =========================================================================
    useEffect(() => {
        setRawSelectedRowKeys(prevKeys => {
            const pruned = prevKeys.filter(k => currentQueryIdSet.has(k));
            if (pruned.length === prevKeys.length) {
                return prevKeys; // 引用不变，避免二次渲染
            }
            return pruned;
        });
    }, [currentQueryIdSet, debouncedFilterParams]);

    // 构建快速判断 Map
    const selectedKeySet = useMemo(() => {
        return new Set(selectedRowKeys);
    }, [selectedRowKeys]);

    // 筛选集内被选中的实体对象列表
    const selectedRows = useMemo(() => {
        return dataList.filter(row => selectedKeySet.has(getRowId(row)));
    }, [dataList, selectedKeySet, getRowId]);

    // =========================================================================
    // 核心约束 2: 表头全选三态判定
    // =========================================================================
    const isAllSelected = useMemo(() => {
        return dataList.length > 0 && selectedRows.length === dataList.length;
    }, [dataList.length, selectedRows.length]);

    const isIndeterminate = useMemo(() => {
        return selectedRows.length > 0 && selectedRows.length < dataList.length;
    }, [selectedRows.length, dataList.length]);

    // =========================================================================
    // 核心约束 3: 底部操作浮条响应式统计 (高精度 Decimal 计算)
    // =========================================================================
    const selectedCount = selectedRows.length;

    const selectedTotalAmountDecimal = useMemo(() => {
        return Decimal.sum(selectedRows, getRowAmount);
    }, [selectedRows, getRowAmount]);

    const selectedTotalAmount = useMemo(() => {
        return selectedTotalAmountDecimal.toFixed(2);
    }, [selectedTotalAmountDecimal]);

    const selectedInvoiceCount = useMemo(() => {
        return selectedRows.reduce((sum, row) => sum + getRowInvoiceCount(row), 0);
    }, [selectedRows, getRowInvoiceCount]);

    // 状态回调触发
    const latestStateRef = useRef<SelectionState>({
        selectedRowKeys,
        selectedCount,
        selectedTotalAmount,
        selectedTotalAmountDecimal,
        selectedInvoiceCount,
        isAllSelected,
        isIndeterminate
    });

    useEffect(() => {
        const newState: SelectionState = {
            selectedRowKeys,
            selectedCount,
            selectedTotalAmount,
            selectedTotalAmountDecimal,
            selectedInvoiceCount,
            isAllSelected,
            isIndeterminate
        };
        latestStateRef.current = newState;
        onSelectionChange?.(selectedRowKeys, newState);
    }, [
        selectedRowKeys,
        selectedCount,
        selectedTotalAmount,
        selectedTotalAmountDecimal,
        selectedInvoiceCount,
        isAllSelected,
        isIndeterminate,
        onSelectionChange
    ]);

    // =========================================================================
    // 交互操作函数
    // =========================================================================

    /** 单行切换 */
    const toggleRow = useCallback((key: string, checked?: boolean) => {
        setRawSelectedRowKeys(prev => {
            const nextSet = new Set(prev);
            const shouldCheck = checked !== undefined ? checked : !nextSet.has(key);
            if (shouldCheck) {
                if (currentQueryIdSet.has(key)) {
                    nextSet.add(key);
                }
            } else {
                nextSet.delete(key);
            }
            return Array.from(nextSet);
        });
    }, [currentQueryIdSet]);

    /** 当前筛选集全选 / 全不选 */
    const toggleSelectAll = useCallback((checked?: boolean) => {
        setRawSelectedRowKeys(prev => {
            const shouldSelect = checked !== undefined ? checked : !isAllSelected;
            if (shouldSelect) {
                // 仅选中当前筛选结果集内的全部条目
                return Array.from(currentQueryIdSet);
            } else {
                // 清空选中
                return [];
            }
        });
    }, [isAllSelected, currentQueryIdSet]);

    /** 一键清空所有选中 (取消选择) */
    const clearSelection = useCallback(() => {
        setRawSelectedRowKeys([]);
    }, []);

    /** 反选当前筛选集 */
    const invertSelection = useCallback(() => {
        setRawSelectedRowKeys(prev => {
            const prevSet = new Set(prev);
            const inverted: string[] = [];
            currentQueryIdSet.forEach(id => {
                if (!prevSet.has(id)) {
                    inverted.push(id);
                }
            });
            return inverted;
        });
    }, [currentQueryIdSet]);

    /** 手动指定选中的 Keys */
    const setSelectedRowKeys = useCallback((keys: string[]) => {
        const valid = keys.filter(k => currentQueryIdSet.has(k));
        setRawSelectedRowKeys(valid);
    }, [currentQueryIdSet]);

    /** 判断单行是否被选中 */
    const isSelected = useCallback((key: string) => {
        return selectedKeySet.has(key);
    }, [selectedKeySet]);

    /** 表头 Checkbox 绑定属性生成器 */
    const getHeaderCheckboxProps = useCallback(() => {
        return {
            checked: isAllSelected,
            indeterminate: isIndeterminate,
            ref: (el: HTMLInputElement | null) => {
                if (el) {
                    el.indeterminate = isIndeterminate;
                }
            },
            onChange: (e: { target: { checked: boolean } }) => {
                toggleSelectAll(e.target.checked);
            }
        };
    }, [isAllSelected, isIndeterminate, toggleSelectAll]);

    /** 行 Checkbox 绑定属性生成器 */
    const getRowCheckboxProps = useCallback((row: T) => {
        const id = getRowId(row);
        return {
            checked: selectedKeySet.has(id),
            onChange: (e: { target: { checked: boolean } }) => {
                toggleRow(id, e.target.checked);
            }
        };
    }, [getRowId, selectedKeySet, toggleRow]);

    return {
        selectedRowKeys,
        selectedCount,
        selectedTotalAmount,
        selectedTotalAmountDecimal,
        selectedInvoiceCount,
        isAllSelected,
        isIndeterminate,
        toggleRow,
        toggleSelectAll,
        clearSelection,
        invertSelection,
        setSelectedRowKeys,
        isSelected,
        getHeaderCheckboxProps,
        getRowCheckboxProps
    };
}
