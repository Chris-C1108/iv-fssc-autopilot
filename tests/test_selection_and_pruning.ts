import { Decimal } from '../src/utils/decimal';

/**
 * 自动化测试套件：数据表格「选择状态同步与筛选联动裁剪」机制
 */
console.log('===============================================================');
console.log('   测试套件: 表格选择状态同步、筛选联动裁剪与高精度计算验证   ');
console.log('===============================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
        console.log(`✅ PASS: ${testName}`);
        passCount++;
    } else {
        console.error(`❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
        failCount++;
    }
}

// =========================================================================
// 1. 测试 Decimal 财务级高精度计算 (消除浮点误差)
// =========================================================================
console.log('\n--- 1. Decimal 财务高精度计算测试 ---');

// 经典 0.1 + 0.2 误差测试
const d1 = new Decimal('0.1');
const d2 = new Decimal('0.2');
const sumD = d1.add(d2);
assert(sumD.toFixed(2) === '0.30', '0.1 + 0.2 精准等于 0.30，无 0.30000000000000004 精度丢失');

// 带有货币符号与千分位逗号解析
const d3 = new Decimal('¥1,234.56');
const d4 = new Decimal('2,000.44');
assert(d3.add(d4).toFixed(2) === '3235.00', '带货币符号与逗号的金额安全解析与累加');

// 批量累加求和测试
const invoiceAmounts = ['99.99', '100.01', '0.05', '0.00', '19.95'];
const totalSum = Decimal.sum(invoiceAmounts);
assert(totalSum.toFixed(2) === '220.00', '批量发票金额累加求和精准计算');
assert(totalSum.formatCurrency() === '¥220.00', '格式化为标准货币字符串 ¥220.00');

// =========================================================================
// 2. 测试 筛选联动裁剪 (Selection Pruning) 算法
// =========================================================================
console.log('\n--- 2. 筛选联动裁剪 (Selection Pruning) 测试 ---');

interface MockRow {
    id: string;
    amount: string;
    invoiceCount: number;
    type: string;
    hasWarn?: boolean;
}

const mockData: MockRow[] = [
    { id: 'REC-001', amount: '120.00', invoiceCount: 1, type: 'TAXI' },
    { id: 'REC-002', amount: '350.00', invoiceCount: 1, type: 'HOTEL', hasWarn: true },
    { id: 'REC-003', amount: '80.00', invoiceCount: 2, type: 'TAXI' },
    { id: 'REC-004', amount: '600.00', invoiceCount: 1, type: 'FLIGHT' },
    { id: 'REC-005', amount: '50.00', invoiceCount: 1, type: 'MOBILE' }
];

// 模拟初始全选
let selectedIds = new Set(mockData.map(r => r.id));
assert(selectedIds.size === 5, '初始全选 5 笔费用记录');

// 模拟触发筛选: 用户在搜索框输入或选择分类为 "TAXI"
const currentQueryResultIds = new Set(mockData.filter(r => r.type === 'TAXI').map(r => r.id));
assert(currentQueryResultIds.size === 2, '筛选 TAXI 产生 2 条当前视口数据: REC-001, REC-003');

// 执行联动裁剪
selectedIds = new Set(Array.from(selectedIds).filter(id => currentQueryResultIds.has(id)));
assert(selectedIds.size === 2, '筛选联动裁剪后，已选集合立即由 5 缩减为 2');
assert(selectedIds.has('REC-001') && selectedIds.has('REC-003'), '选中的行必须严格位于当前筛选结果集');
assert(!selectedIds.has('REC-002') && !selectedIds.has('REC-004') && !selectedIds.has('REC-005'), '严禁保留不可见行，彻底规避幽灵提交 (Ghost Mutation)');

// =========================================================================
// 3. 测试 表头全选三态判定 (Tri-state Header Checkbox)
// =========================================================================
console.log('\n--- 3. 表头全选三态判定 (Tri-state Header Checkbox) 测试 ---');

function computeTriState(currentIds: string[], selectedSet: Set<string>) {
    const selectedInCurrent = currentIds.filter(id => selectedSet.has(id));
    const isAllSelected = currentIds.length > 0 && selectedInCurrent.length === currentIds.length;
    const isIndeterminate = selectedInCurrent.length > 0 && selectedInCurrent.length < currentIds.length;
    return { isAllSelected, isIndeterminate, selectedCount: selectedInCurrent.length };
}

const currentTaxiIds = ['REC-001', 'REC-003'];

// 状态 1: 全部勾选
let testSel = new Set(['REC-001', 'REC-003']);
let state1 = computeTriState(currentTaxiIds, testSel);
assert(state1.isAllSelected === true && state1.isIndeterminate === false, '所有可见行均被勾选时，表头为 checked (全选)');

// 状态 2: 部分勾选
testSel = new Set(['REC-001']);
let state2 = computeTriState(currentTaxiIds, testSel);
assert(state2.isAllSelected === false && state2.isIndeterminate === true, '部分可见行被勾选时，表头为 indeterminate (半选)');

// 状态 3: 无任何勾选
testSel = new Set([]);
let state3 = computeTriState(currentTaxiIds, testSel);
assert(state3.isAllSelected === false && state3.isIndeterminate === false, '无任何可见行勾选时，表头为 unchecked (未选)');

// =========================================================================
// 4. 测试 底部操作浮条 (Batch Action Bar) 响应式统计与零选中禁用
// =========================================================================
console.log('\n--- 4. 底部操作浮条 (Batch Action Bar) 响应式统计与禁用逻辑测试 ---');

function computeActionBarStats(rows: MockRow[], selectedSet: Set<string>) {
    const selectedRows = rows.filter(r => selectedSet.has(r.id));
    const count = selectedRows.length;
    const invoiceCount = selectedRows.reduce((sum, r) => sum + r.invoiceCount, 0);
    const totalAmount = Decimal.sum(selectedRows, r => r.amount);
    const isBatchActionsDisabled = count === 0;

    return {
        selectedCount: count,
        selectedInvoiceCount: invoiceCount,
        selectedTotalAmount: totalAmount.toFixed(2),
        isBatchActionsDisabled
    };
}

// 情况 A: 勾选 REC-001(120.00, 1张) 与 REC-003(80.00, 2张)
const statsA = computeActionBarStats(mockData, new Set(['REC-001', 'REC-003']));
assert(statsA.selectedCount === 2, '选中记录数精准统计为 2');
assert(statsA.selectedInvoiceCount === 3, '选中发票总张数精准统计为 3');
assert(statsA.selectedTotalAmount === '200.00', '选中金额精准合计为 ¥200.00');
assert(statsA.isBatchActionsDisabled === false, '有选中项时，批量操作按钮为可用状态');

// 情况 B: 用户点击“取消选择”导致选中数变为 0
const statsB = computeActionBarStats(mockData, new Set([]));
assert(statsB.selectedCount === 0, '清空后选中记录数为 0');
assert(statsB.selectedInvoiceCount === 0, '清空后发票张数为 0');
assert(statsB.selectedTotalAmount === '0.00', '清空后金额合计为 ¥0.00');
assert(statsB.isBatchActionsDisabled === true, 'selectedCount === 0 时，批量操作按钮必须禁用');

// =========================================================================
// 测试结果汇总
// =========================================================================
console.log('\n===============================================================');
console.log(`测试完成: 共通过 ${passCount} 项断言，失败 ${failCount} 项。`);
console.log('===============================================================\n');

if (failCount > 0) {
    process.exit(1);
}
