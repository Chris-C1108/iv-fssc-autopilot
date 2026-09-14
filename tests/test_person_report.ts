import { extractRowAmount, generateComprehensivePersonExpenseReport } from '../src/services/billService';
import { GenericExpenseGroup } from '../src/types/state';

function assert(condition: boolean, msg: string) {
    if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${msg}`);
        process.exit(1);
    } else {
        console.log(`✅ PASSED: ${msg}`);
    }
}

console.log('--- 测试 1: extractRowAmount 金额多级穿透解析 ---');

// 用例 1.1: 传统 AMOUNT.value.amount 对象
assert(extractRowAmount({ AMOUNT: { value: { amount: 350.5 } } }) === 350.5, 'AMOUNT.value.amount');

// 用例 1.2: F_BCHSZJ (本次报销总计)
assert(extractRowAmount({ F_BCHSZJ: { value: { amount: 120.0 } } }) === 120.0, 'F_BCHSZJ.value.amount');

// 用例 1.3: AMOUNT 为 0，从 recArea 支出记录区穿透
const cRowRec = {
    subAreaDatas: {
        '7e1debbe739248c4a49ea98088997acf': {
            rowDatas: [
                { datas: { AMOUNT: { value: { amount: 480.0 } } } }
            ]
        }
    }
};
assert(extractRowAmount({ AMOUNT: { value: { amount: 0 } } }, cRowRec) === 480.0, 'recArea 穿透提取');

// 用例 1.4: 从 boArea 预算区穿透
const cRowBudget = {
    subAreaDatas: {
        '203d2e64f6bd4b32a8c83d030fb32676': {
            rowDatas: [
                { datas: { BUDGET_SUM: { value: { amount: 700.0 } } } }
            ]
        }
    }
};
assert(extractRowAmount({}, cRowBudget) === 700.0, 'boArea 预算区穿透提取');

console.log('\n--- 测试 2: generateComprehensivePersonExpenseReport 人员账目全景汇算 ---');

// 构造与用户真实手工账一致的 119 笔明细
const mockGroups: ExpenseRecordGroup[] = [];

// 1. 李建勇: 48 笔，其中 5 笔合并了 2 张发票 (43 笔 1 张 + 5 笔 2 张 = 48 笔 53 张发票)，合计 ¥16,403.00
let ljySum = 0;
for (let i = 0; i < 48; i++) {
    const invCount = i < 5 ? 2 : 1;
    let amt = 341.0;
    if (i === 47) {
        amt = Math.round((16403.00 - ljySum) * 100) / 100;
    }
    ljySum += amt;
    const invs: any[] = [];
    for (let k = 0; k < invCount; k++) invs.push({ invoiceNo: `inv-ljy-${i}-${k}`, amountTax: amt / invCount });
    mockGroups.push({
        expenseRecordId: `rec-ljy-${i}`,
        expenseAmount: amt,
        invoices: invs,
        expenseTypeName: i % 2 === 0 ? '出租车' : '住宿费',
        businessDate: '2026-07-15',
        description: `[外驻:李建勇]-[X2607-001] 出差交通住宿`
    } as any);
}

// 2. 成勇: 17 笔，17 张发票，合计 ¥13,409.00
let cySum = 0;
for (let i = 0; i < 17; i++) {
    let amt = 788.0;
    if (i === 16) {
        amt = Math.round((13409.00 - cySum) * 100) / 100;
    }
    cySum += amt;
    mockGroups.push({
        expenseRecordId: `rec-cy-${i}`,
        expenseAmount: amt,
        invoices: [{ invoiceNo: `inv-cy-${i}`, amountTax: amt }],
        expenseTypeName: '飞机/高铁',
        businessDate: '2026-07-20',
        description: `[外驻:成勇]-[X2607-001] 出差大交通`
    } as any);
}

// 3. 陈浩 (ITS): 54 笔，其中 10 笔合并了 2 张发票 (44 笔 1 张 + 10 笔 2 张 = 54 笔 64 张发票)，合计 ¥25,557.87
let chSum = 0;
for (let i = 0; i < 54; i++) {
    const invCount = i < 10 ? 2 : 1;
    let amt = 473.0;
    if (i === 53) {
        amt = Math.round((25557.87 - chSum) * 100) / 100;
    }
    chSum += amt;
    const invs: any[] = [];
    for (let k = 0; k < invCount; k++) invs.push({ invoiceNo: `inv-ch-${i}-${k}`, amountTax: amt / invCount });
    mockGroups.push({
        expenseRecordId: `rec-ch-${i}`,
        expenseAmount: amt,
        invoices: invs,
        expenseTypeName: '项目出差旅费',
        businessDate: '2026-07-10',
        description: `[陈浩]-[X2605-001] 本部差旅调研`
    } as any);
}

assert(mockGroups.length === 119, '总明细行数 119 笔');

const report = generateComprehensivePersonExpenseReport(mockGroups, '陈浩');

console.log('汇算结果：');
console.log(`- 总费用笔数: ${report.totalExpenses} 笔`);
console.log(`- 总发票张数: ${report.totalInvoices} 张`);
console.log(`- 总报销金额: ¥${report.totalAmount.toFixed(2)}`);

assert(report.totalExpenses === 119, '总费用必须为 119 笔');
assert(report.totalInvoices === 134, '总发票张数必须为 134 张');
assert(Math.abs(report.totalAmount - 55369.87) < 0.01, '总金额必须为 ¥55,369.87');

const ljyData = report.personMap.get('李建勇');
assert(!!ljyData && ljyData.count === 48 && ljyData.invoiceCount === 53 && Math.abs(ljyData.amount - 16403.00) < 0.01, '李建勇统计 48 笔 53 张 ¥16,403.00');

const cyData = report.personMap.get('成勇');
assert(!!cyData && cyData.count === 17 && cyData.invoiceCount === 17 && Math.abs(cyData.amount - 13409.00) < 0.01, '成勇统计 17 笔 17 张 ¥13,409.00');

const chData = report.personMap.get('陈浩');
assert(!!chData && chData.count === 54 && chData.invoiceCount === 64 && Math.abs(chData.amount - 25557.87) < 0.01, '陈浩统计 54 笔 64 张 ¥25,557.87');

console.log('\n生成的 Markdown 汇总表预览：\n');
console.log(report.summaryTableMarkdown);

console.log('🎉 全部单元测试通过！');
