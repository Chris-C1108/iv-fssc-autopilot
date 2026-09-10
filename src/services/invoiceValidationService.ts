import { InvoiceValidationIssue, InvoiceValidationResult, InvoiceBatchValidationSummary, InvoiceItem } from '../types/state';
import { normalizeDate } from '../utils/date';

/**
 * 将不同来源的发票对象统一解构并扁平化为标准化字段结构
 */
export function normalizeInvoiceData(raw: any): {
    id: string;
    invoiceNo: string;
    invoiceCode: string;
    invoiceDate: string;
    amount: number;
    typeName: string;
    sellerName: string;
    goodsName: string;
    timeGetOn: string;
    timeGetOff: string;
    detailChecked?: boolean;
} {
    if (!raw) {
        return {
            id: '',
            invoiceNo: '',
            invoiceCode: '',
            invoiceDate: '',
            amount: 0,
            typeName: '',
            sellerName: '',
            goodsName: '',
            timeGetOn: '',
            timeGetOff: '',
            detailChecked: false
        };
    }

    // 1. 如果是原生发票池行结构 (包含 datas 字典)
    if (raw.datas && typeof raw.datas === 'object') {
        const d = raw.datas;
        const res: any = {
            id: raw.boSourceRowId || raw.rowId || (d.ID ? d.ID.value : '') || '',
            invoiceNo: '',
            invoiceCode: '',
            invoiceDate: '',
            amount: 0,
            typeName: '',
            sellerName: '',
            goodsName: '',
            timeGetOn: '',
            timeGetOff: '',
            detailChecked: Boolean(raw.detailChecked)
        };

        Object.values(d).forEach((field: any) => {
            if (!field || !field.columnCode) return;
            const code = field.columnCode;
            const val = field.value;

            if (code === 'INVOICE_NO') {
                res.invoiceNo = (typeof val === 'string' ? val : (val ? String(val) : '')).trim();
            } else if (code === 'INVOICE_CODE') {
                res.invoiceCode = (typeof val === 'string' ? val : (val ? String(val) : '')).trim();
            } else if (code === 'INVOICE_DATE') {
                res.invoiceDate = normalizeDate(typeof val === 'string' ? val : (val ? String(val) : ''));
            } else if (code === 'AMOUNT_TAX' || code === 'TOTAL_AMOUNT') {
                if (val && typeof val === 'object' && val.amount !== undefined) {
                    const parsed = parseFloat(val.amount);
                    if (!isNaN(parsed) && parsed > 0) res.amount = parsed;
                } else if (val !== undefined && val !== null && typeof val !== 'object') {
                    const parsed = parseFloat(String(val).replace(/[^0-9.]/g, ''));
                    if (!isNaN(parsed) && parsed > 0) res.amount = parsed;
                }
            } else if (code === 'BO_TYPE_DEFINE_ID') {
                if (val && typeof val === 'object') {
                    res.typeName = val.onlyTitle?.zh_CN || val.title?.zh_CN || val.name || '';
                } else if (typeof val === 'string') {
                    res.typeName = val;
                }
            } else if (code === 'SELLER_NAME' || code === 'SALES_NAME') {
                res.sellerName = (typeof val === 'string' ? val : '').trim();
            } else if (code === 'GOODS_NAME' || code === 'COMMODITY_NAME') {
                res.goodsName = (typeof val === 'string' ? val : '').trim();
            }
        });

        // 二次回填：如果 AMOUNT_TAX 没取到有效值，再看 raw.datas 里有没有其他金额字段
        if (res.amount <= 0 && d.AMOUNT_TAX && d.AMOUNT_TAX.value) {
            const parsed = parseFloat(d.AMOUNT_TAX.value.amount || d.AMOUNT_TAX.value);
            if (!isNaN(parsed) && parsed > 0) res.amount = parsed;
        }

        return res;
    }

    // 2. 如果是发票穿透详情 (invDetail / invoiceVO) 或标准 InvoiceItem
    const invVO = raw.invoiceVO || raw;
    const rawAmt = raw.amount !== undefined
        ? raw.amount
        : (invVO.amountTax !== undefined ? invVO.amountTax : (invVO.totalAmount !== undefined ? invVO.totalAmount : 0));
    const parsedAmt = typeof rawAmt === 'number' ? rawAmt : (parseFloat(String(rawAmt).replace(/[^0-9.]/g, '')) || 0);

    const rawDate = raw.invoiceDate || invVO.invoiceDate || raw.businessDate || '';
    const normDate = normalizeDate(typeof rawDate === 'string' ? rawDate : (rawDate ? String(rawDate) : ''));

    const no = (raw.invoiceNo || invVO.invoiceNo || invVO.invoiceNumber || '').trim();
    const code = (raw.invoiceCode || invVO.invoiceCode || '').trim();
    const typeName = raw.typeName || raw.expenseTypeName || invVO.invoiceTypeName || invVO.typeName || '';
    const seller = (raw.salesName || invVO.salesName || invVO.seller || invVO.sellerName || '').trim();
    const goods = (raw.invoiceDetails || invVO.goodsName || invVO.commodityNames || invVO.cargoInformation || '').trim();

    return {
        id: raw.id || raw.expenseRecordId || raw.boDataId || raw.boSourceRowId || invVO.invoiceDataId || '',
        invoiceNo: no,
        invoiceCode: code,
        invoiceDate: normDate,
        amount: parsedAmt,
        typeName,
        sellerName: seller,
        goodsName: goods,
        timeGetOn: raw.timeGetOn || invVO.timeGetOn || '',
        timeGetOff: raw.timeGetOff || invVO.timeGetOff || '',
        detailChecked: Boolean(raw.detailChecked || invVO.detailChecked)
    };
}

/**
 * 对单张发票执行完整性与合规校验
 */
export function validateSingleInvoice(rawInvoice: any): InvoiceValidationResult {
    const data = normalizeInvoiceData(rawInvoice);
    const issues: InvoiceValidationIssue[] = [];

    // 1. 发票金额校验 (🔴 阻断性必要字段)
    if (!data.amount || isNaN(data.amount) || data.amount <= 0) {
        issues.push({
            field: 'amount',
            severity: 'error',
            message: '发票金额未识别或金额为 0 元，请核实发票实付金额',
            shortBadge: '缺金额'
        });
    }

    // 2. 开票日期校验 (🔴 阻断性必要字段)
    if (!data.invoiceDate || data.invoiceDate.trim().length === 0) {
        issues.push({
            field: 'date',
            severity: 'error',
            message: '未识别到有效开票日期，报销与记费用必须具备开票日期',
            shortBadge: '缺日期'
        });
    } else {
        // 校验日期格式与合理年份 (避免 OCR 错识出如 2002 年、1990 年或未来年份)
        const dateMatch = data.invoiceDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
        if (!dateMatch) {
            issues.push({
                field: 'date',
                severity: 'error',
                message: `开票日期格式非法 (${data.invoiceDate})，无法作为有效财务期间`,
                shortBadge: '日期非法'
            });
        } else {
            const year = parseInt(dateMatch[1], 10);
            const month = parseInt(dateMatch[2], 10);
            const day = parseInt(dateMatch[3], 10);
            const currentYear = new Date().getFullYear();

            // 基础日历真实性校验
            const d = new Date(year, month - 1, day);
            if (isNaN(d.getTime()) || d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
                issues.push({
                    field: 'date',
                    severity: 'error',
                    message: `开票日期(${data.invoiceDate})为无效日历日期`,
                    shortBadge: '无效日期'
                });
            } else if (year < currentYear - 2) {
                // 偏离 2 年以上（例如 2002 年），属于严重超期或 OCR 识别失真，阻断级错误
                issues.push({
                    field: 'date',
                    severity: 'error',
                    message: `开票年份严重偏离当前财务期间 (${year}年)，可能为 OCR 识别失真或超期失效发票，请核验修改`,
                    shortBadge: '年份存疑'
                });
            } else if (year < currentYear) {
                // 上一年度跨年发票
                issues.push({
                    field: 'date',
                    severity: 'warning',
                    message: `开票年份为往年 (${year}年)，请确认是否在跨年财务报销有效期内`,
                    shortBadge: '跨年发票'
                });
            } else if (year > currentYear) {
                issues.push({
                    field: 'date',
                    severity: 'error',
                    message: `开票年份为未来时间 (${year}年)，OCR 识别明显异常`,
                    shortBadge: '未来日期'
                });
            }
        }
    }

    // 3. 发票号码校验 (🔴 阻断性必要字段)
    if (!data.invoiceNo || data.invoiceNo.trim().length === 0) {
        issues.push({
            field: 'invoiceNo',
            severity: 'error',
            message: '未识别到发票号码，系统无法进行发票查验与防重报销',
            shortBadge: '缺发票号'
        });
    } else if (data.invoiceNo.length < 4) {
        issues.push({
            field: 'invoiceNo',
            severity: 'warning',
            message: `发票号码位数过短 (${data.invoiceNo})，可能存在识别残缺`,
            shortBadge: '票号残缺'
        });
    }

    // 4. 发票类型校验 (🟡 建议完备字段)
    if (!data.typeName || data.typeName.includes('未识别') || data.typeName === 'OTHER' || data.typeName === 'None') {
        issues.push({
            field: 'invoiceType',
            severity: 'warning',
            message: '发票类型未明确归类，可能影响税率及报销科目自动匹配',
            shortBadge: '类型待定'
        });
    }

    // 5. 销售方与品名校验 (🟡 辅助校验：交通通行类票据免除此校验)
    const transportKeywords = [
        '出租车', '网约车', '客运', '火车', '铁路', '高铁', '动车',
        '机票', '航空', '行程单', '过路费', '通行费', '高速', 'ETC',
        '轮渡', '船票', '公交', '地铁', '轨道交通', '停车', '泊车', '客票'
    ];
    const isTransport = transportKeywords.some(kw => data.typeName.includes(kw));

    if (!isTransport && !data.sellerName && !data.goodsName) {
        issues.push({
            field: 'seller',
            severity: 'warning',
            message: '销售方名称与货物品名均未识别，建议点击修改补充',
            shortBadge: '缺销方品名'
        });
    }

    // 6. 出租车打车票乘车时间提示 (🟡 警示级提示：缺失将无法自动对齐差旅/考勤行程)
    // 状态守卫：仅当发票详情接口核验完毕 (detailChecked === true) 且确认未提取到上下车时间时才提示，杜绝未请求前抢跑误报
    if (data.typeName.includes('出租车')) {
        if (data.detailChecked) {
            if (!data.timeGetOn && !data.timeGetOff) {
                issues.push({
                    field: 'time',
                    severity: 'warning',
                    message: '发票详情接口(/getBoDataAndTemplateWF)已核验：发票底层数据中未提取到上下车时间，无法自动对齐差旅与考勤行程，建议点击修改补充',
                    shortBadge: '缺乘车时间'
                });
            }
        }
    }

    const hasErrors = issues.some(i => i.severity === 'error');
    const hasWarnings = issues.some(i => i.severity === 'warning');

    const errorBadges = issues
        .filter(i => i.severity === 'error')
        .map(i => i.shortBadge);
    const warningBadges = issues
        .filter(i => i.severity === 'warning')
        .map(i => i.shortBadge);

    const descList = [...errorBadges, ...warningBadges];
    const missingFieldsDesc = descList.length > 0 ? descList.join(' · ') : '信息完备';

    return {
        id: data.id,
        invoiceNo: data.invoiceNo,
        invoiceCode: data.invoiceCode,
        invoiceDate: data.invoiceDate,
        amount: data.amount,
        typeName: data.typeName,
        isValid: !hasErrors,
        hasWarnings: hasWarnings,
        issues,
        missingFieldsDesc
    };
}

/**
 * 批量校验发票列表并输出汇总结算体检报告
 */
export function validateInvoiceList(invoices: any[]): InvoiceBatchValidationSummary {
    const list = Array.isArray(invoices) ? invoices : [];
    const results: InvoiceValidationResult[] = [];
    const invalidList: InvoiceValidationResult[] = [];

    let missingAmountCount = 0;
    let missingDateCount = 0;
    let missingInvoiceNoCount = 0;
    let missingTypeCount = 0;
    let missingTimeCount = 0;
    let warningCount = 0;

    list.forEach(inv => {
        const res = validateSingleInvoice(inv);
        results.push(res);

        if (!res.isValid) {
            invalidList.push(res);
        }

        if (res.hasWarnings) {
            warningCount++;
        }

        res.issues.forEach(issue => {
            if (issue.severity === 'error') {
                if (issue.field === 'amount') missingAmountCount++;
                if (issue.field === 'date') missingDateCount++;
                if (issue.field === 'invoiceNo') missingInvoiceNoCount++;
            } else if (issue.field === 'invoiceType') {
                missingTypeCount++;
            } else if (issue.field === 'time') {
                missingTimeCount++;
            }
        });
    });

    return {
        totalCount: list.length,
        validCount: results.filter(r => r.isValid).length,
        invalidCount: invalidList.length,
        warningCount,
        missingAmountCount,
        missingDateCount,
        missingInvoiceNoCount,
        missingTypeCount,
        missingTimeCount,
        results,
        invalidList
    };
}

/**
 * 将校验结果回填并富化至 InvoiceItem 实体中
 */
export function enrichInvoiceWithValidation(item: InvoiceItem): InvoiceItem {
    const report = validateSingleInvoice(item);
    item.validationIssues = report.issues;
    item.isValidInvoice = report.isValid;
    item.missingFieldsDesc = report.missingFieldsDesc;
    if (!report.isValid) {
        item.status = '残缺';
    }
    return item;
}
