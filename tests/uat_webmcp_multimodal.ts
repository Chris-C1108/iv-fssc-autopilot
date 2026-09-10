import { inferSmartExpensePlan, detectInvoiceCategory } from '../src/services/commuteService';
import { InvoiceItem, ExpensePlanOptions, DynamicTripInput } from '../src/types/state';
import * as fs from 'fs';
import * as path from 'path';

/**
 * UAT TDD Test Suite:
 * 验证 54 笔来自外驻李建勇的发票与《出差行程计划》图片提炼的 7 轮多波次行程智能匹配与规划
 */
console.log('=== UAT TDD: 54 笔外驻李建勇出差发票 + 行程计划图片匹配测试 ===\n');

// 1. 结构化从《出差行程计划.png》提取的 7 轮出差波次 (由多模态大模型或行程表直接解析提供)
const UAT_TRIPS: DynamicTripInput[] = [
    {
        tripNo: 1,
        startDate: '2026-07-20',
        endDate: '2026-07-25',
        destination: '天津',
        departureStation: '上海',
        arrivalStation: '天津滨海国际机场',
        hotelName: '美悦酒店(国家会展中心店)',
        targetFactories: '住理工津荣模具(天津)有限公司、环宇住理工汽车部品(天津)有限公司、东海化成(天津)汽车部品有限公司',
        purpose: '客户调研交流',
        applicantName: '李建勇',
        travelers: ['陈浩', '成勇', '李建勇']
    },
    {
        tripNo: 2,
        startDate: '2026-07-27',
        endDate: '2026-07-31',
        destination: '广州',
        departureStation: '上海',
        arrivalStation: '广州白云国际机场',
        hotelName: '广州黄埔瑾程酒店',
        targetFactories: '住理工汽车部件(广州)有限公司',
        purpose: '客户调研交流',
        applicantName: '李建勇',
        travelers: ['陈浩', '成勇', '李建勇']
    },
    {
        tripNo: 3,
        startDate: '2026-08-04',
        endDate: '2026-08-05',
        destination: '金山',
        hotelName: '上引国际酒店(金山工业园区)',
        targetFactories: '住理工天普汽车部件(上海)有限公司',
        purpose: '客户调研交流',
        applicantName: '李建勇',
        travelers: ['陈浩', '成勇', '李建勇']
    },
    {
        tripNo: 4,
        startDate: '2026-08-10',
        endDate: '2026-08-13',
        destination: '合肥',
        departureStation: '上海',
        arrivalStation: '合肥南站',
        hotelName: '亚朵酒店(合肥滨湖云谷金融城店)',
        targetFactories: '住理工胶管(合肥)有限公司',
        purpose: '客户调研交流',
        applicantName: '李建勇',
        travelers: ['陈浩', '成勇', '李建勇']
    },
    {
        tripNo: 5,
        startDate: '2026-08-17',
        endDate: '2026-08-21',
        destination: '天津',
        departureStation: '上海',
        arrivalStation: '天津滨海国际机场',
        hotelName: '全季酒店(国家会展中心店)',
        targetFactories: '住理工汽车部件(天津)有限公司',
        purpose: '客户调研交流',
        applicantName: '李建勇',
        travelers: ['陈浩', '成勇', '李建勇']
    },
    {
        tripNo: 6,
        startDate: '2026-08-24',
        endDate: '2026-08-27',
        destination: '大连',
        departureStation: '上海',
        arrivalStation: '大连周水子国际机场',
        hotelName: '全季酒店(普兰店台山公园店)',
        targetFactories: '住理工汽车部件(大连)有限公司',
        purpose: '客户调研交流',
        applicantName: '李建勇',
        travelers: ['陈浩', '成勇', '李建勇']
    },
    {
        tripNo: 7,
        startDate: '2026-08-31',
        endDate: '2026-09-04',
        destination: '嘉兴',
        departureStation: '上海',
        arrivalStation: '嘉兴南站',
        hotelName: '亚朵酒店(中山路店)',
        targetFactories: '住友理工企业管理(中国)有限公司、住理工汽车部件(嘉兴)有限公司',
        purpose: '客户调研交流',
        applicantName: '李建勇',
        travelers: ['陈浩', '成勇', '李建勇']
    }
];

// 2. 加载真实发票/费用数据
const harPath = path.resolve(__dirname, '../assets/报销批量助手/ync37.yuanian.com-002-报销批量助手.har');
let invoices: InvoiceItem[] = [];

if (fs.existsSync(harPath)) {
    const raw = JSON.parse(fs.readFileSync(harPath, 'utf8'));
    for (const entry of raw.log.entries) {
        const text = entry.response.content?.text;
        if (text && (text.includes('/getExpenseRecordListBySearchVO') || text.includes('expenseRecordId'))) {
            try {
                const parsed = JSON.parse(text);
                const list = parsed.data?.list || parsed.data?.datas || (Array.isArray(parsed.data) ? parsed.data : null);
                if (list && Array.isArray(list) && list.length > 0 && list[0].expenseRecordId) {
                    invoices = list.map((d: any, idx: number) => {
                        const desc = d.DESCRIPTION?.value || d.description || '';
                        const amt = Number(d.AMOUNT?.value?.amount || d.amount || 0);
                        const dt = d.BUSINESS_DATE?.value || d.invoiceDate || d.normDate || '';
                        const seller = d.INVOICE_SALES_NAME?.value || d.salesName || '';
                        const fn = d.fileName || d.INVOICE_FILE_NAME?.value || '';
                        const details = d.invoiceDetails || '';
                        return {
                            id: d.expenseRecordId || `inv-${idx}`,
                            expenseRecordId: d.expenseRecordId,
                            amount: amt,
                            invoiceDate: dt ? dt.slice(0, 10) : '2026-08-20',
                            salesName: seller,
                            fileName: fn,
                            invoiceDetails: details,
                            description: desc,
                            type: detectInvoiceCategory({
                                amount: amt,
                                invoiceDate: dt,
                                salesName: seller,
                                fileName: fn,
                                invoiceDetails: details,
                                type: 'OTHER'
                            })
                        };
                    });
                    break;
                }
            } catch (e) {}
        }
    }
}

console.log(`[TDD Seam 1] 成功从数据源装载待处理记录: ${invoices.length} 笔`);

// 3. 执行端到端规划测试
const planOpts: ExpensePlanOptions = {
    tripType: 'BUSINESS_TRIP',
    proxyPersonName: '李建勇',
    trips: UAT_TRIPS
};

const plan = inferSmartExpensePlan(invoices, planOpts);

console.log('\n[TDD Seam 2] 规划结果断言:');
console.log(`- 总记录数: ${plan.totalRecords}`);
console.log(`- 规划修改数: ${plan.modifiedCount}`);
console.log(`- 匹配到的出差波次: ${plan.matchedTrips?.length || 0} 轮`);
console.log(`- 成功绑定过路费笔数: ${plan.boundTollsCount || 0}`);

// 4. 关键指标严格断言
if (plan.modifiedCount === 0) {
    throw new Error('断言失败: modifiedCount 不能为 0！');
}

// 检查是否所有记录的说明均正确添加了 [外驻:李建勇] 前缀
const validRecords = (plan.records || []).filter(r => r.description);
const hasProxyPrefix = validRecords.every(r => r.description?.includes('[外驻:李建勇]'));
console.log(`- [外驻:李建勇] 说明前缀覆盖率: ${hasProxyPrefix ? '100% (PASS)' : 'FAIL'}`);
if (!hasProxyPrefix) {
    throw new Error('断言失败: 存在未包含 [外驻:李建勇] 前缀的规划记录！');
}

// 检查是否正确识别出行程波次
if (!plan.matchedTrips || plan.matchedTrips.length === 0) {
    throw new Error('断言失败: 必须正确匹配到行程表中的出差波次！');
}

console.log('\n🎉 [TDD PASS] 本地 Seam 核心业务逻辑测试全部通过！准备执行浏览器端实机自动化验证。');
