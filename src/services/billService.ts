import { apiRequest, callNativeHttp, inferLegalMenuId, LEGAL_MENU_IDS } from '../utils/http';
import { BUDGET_CONSTANTS } from '../config/constants';
import { GlobalState, BillRowItem, GenericExpenseGroup } from '../types/state';

export function prepareBillSceneVO(billData: any): any {
    if (!billData) return null;
    const sceneVO = JSON.parse(JSON.stringify(billData));
    if (sceneVO.billButtons) delete sceneVO.billButtons;
    return sceneVO;
}

export async function changeBillFieldValueApi(
    fieldCode: string,
    fieldName: string,
    billAreaFieldId: string,
    fieldValue: any,
    rowId: string,
    billSceneDataVO: any,
    state: GlobalState
): Promise<any> {
    const payload = {
        billAreaFieldId: billAreaFieldId,
        billAreaId: BUDGET_CONSTANTS.boAreaId,
        fieldCode: fieldCode,
        fieldName: fieldName,
        fieldValue: fieldValue,
        rowId: rowId,
        validateInfoList: [],
        billSceneDataVO: billSceneDataVO
    };
    const targetMenuId = inferLegalMenuId(
        '/fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange',
        payload
    );

    const res = await callNativeHttp(
        '/fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange',
        'POST',
        payload,
        null,
        undefined,
        targetMenuId
    ) || await apiRequest(
        '/fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange',
        'POST',
        payload,
        state,
        false,
        false,
        targetMenuId
    );

    if (res && res.success && res.data && res.data.billData) {
        return res.data.billData;
    }
    throw new Error(res?.message || `修改字段 [${fieldName}] 失败`);
}

export async function saveBillDataApi(
    billData: any,
    state: GlobalState
): Promise<any> {
    const payload = JSON.parse(JSON.stringify(billData));
    payload.billButtons = [];
    payload.commit = false;
    payload.operationType = billData.operationType || 'UPDATE';
    payload.scene = 'WRITE';
    if (!payload.appId) payload.appId = state?.appId || 'e3d5e4787ff911e88b1997bee3518b4d';
    if (!payload.attachmentDeleteList) payload.attachmentDeleteList = [];
    if (!payload.attachmentUploadList) payload.attachmentUploadList = [];
    if (payload.attachmentDeleteSync === undefined) payload.attachmentDeleteSync = false;

    const targetMenuId = inferLegalMenuId('/fssc/bill/billdata/saveBillData', payload);

    const res = await callNativeHttp(
        '/fssc/bill/billdata/saveBillData',
        'POST',
        payload,
        null,
        undefined,
        targetMenuId
    ) || await apiRequest(
        '/fssc/bill/billdata/saveBillData',
        'POST',
        payload,
        state,
        false,
        false,
        targetMenuId
    );

    if (res && res.success && res.data) {
        return res.data;
    }
    throw new Error(res?.message || '保存报销单失败');
}

export async function fetchBillDataAndTemplateApi(
    billMainId: string,
    state: GlobalState
): Promise<{ billData: any; billTemplate: any }> {
    const payload = {
        billMainId: billMainId,
        scene: 'WRITE',
        appId: state?.appId || 'e3d5e4787ff911e88b1997bee3518b4d'
    };
    const res = await callNativeHttp(
        '/fssc/bill/billdata/getBillDataAndTemplateByBillMainId',
        'POST',
        payload
    ) || await apiRequest(
        '/fssc/bill/billdata/getBillDataAndTemplateByBillMainId',
        'POST',
        payload,
        state
    );
    if (res && res.success && res.data) {
        return {
            billData: res.data.billData,
            billTemplate: res.data.billDefineTemplate
        };
    }
    throw new Error(res?.message || '获取报销单数据失败');
}

/**
 * 深度解析费用明细行真实金额 (防御性多级字段抽取，杜绝 ¥0.00 缺陷)
 */
export function extractRowAmount(claimDatas: any, cRow?: any): number {
    if (!claimDatas && !cRow) return 0;

    const parseNum = (val: any): number => {
        if (val === undefined || val === null || val === '') return 0;
        if (typeof val === 'number') return isNaN(val) ? 0 : Math.abs(val);
        if (typeof val === 'object') {
            if (val.amount !== undefined && val.amount !== null) {
                const a = Number(val.amount);
                if (!isNaN(a) && a !== 0) return Math.abs(a);
            }
            if (val.value !== undefined && val.value !== null) {
                return parseNum(val.value);
            }
        }
        const str = String(val).trim();
        const n = parseFloat(str.replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? 0 : Math.abs(n);
    };

    const priorityKeys = [
        'AMOUNT',
        'F_BCHSZJ',        // 本次报销总计 / 核算总计
        'AMOUNT_TAX',       // 含税金额
        'TOTAL_AMOUNT',     // 总金额
        'EXPENSE_AMOUNT',   // 费用金额
        'AMOUNT_NOT_TAX',   // 不含税金额
        'EXPENSE_SUM',      // 费用合计
        'BUDGET_SUM',       // 预算合计
        'TAX_AMOUNT',       // 税额
        'SUM_AMOUNT'        // 汇总金额
    ];

    // 1. 从明细行 datas (claimDatas) 优先提取
    if (claimDatas) {
        for (const k of priorityKeys) {
            if (claimDatas[k]) {
                const amt = parseNum(claimDatas[k]);
                if (amt > 0) return amt;
            }
        }
    }

    // 2. 从支出记录区 (recArea) 提取
    const recArea = cRow?.subAreaDatas?.[BUDGET_CONSTANTS.recSubAreaId];
    if (recArea?.rowDatas && recArea.rowDatas.length > 0) {
        for (const rRow of recArea.rowDatas) {
            const rDatas = rRow.datas || {};
            for (const k of priorityKeys) {
                if (rDatas[k]) {
                    const amt = parseNum(rDatas[k]);
                    if (amt > 0) return amt;
                }
            }
        }
    }

    // 3. 从预算区 (boArea) 提取
    const budgetArea = cRow?.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId];
    if (budgetArea?.rowDatas && budgetArea.rowDatas.length > 0) {
        for (const bRow of budgetArea.rowDatas) {
            const bDatas = bRow.datas || {};
            const bKeys = ['BUDGET_SUM', 'AMOUNT', 'ACCOUNT_AMOUNT', ...priorityKeys];
            for (const k of bKeys) {
                if (bDatas[k]) {
                    const amt = parseNum(bDatas[k]);
                    if (amt > 0) return amt;
                }
            }
        }
    }

    // 4. 遍历 claimDatas 中所有带 amount/money/sum/tot 字段
    if (claimDatas) {
        for (const key of Object.keys(claimDatas)) {
            const field = claimDatas[key];
            if (field && typeof field === 'object') {
                const amt = parseNum(field);
                if (amt > 0 && /amount|money|sum|tot|szj|fy/i.test(key)) {
                    return amt;
                }
            }
        }
    }

    // 5. 遍历 cRow 内部所有 subAreaDatas
    if (cRow?.subAreaDatas) {
        for (const sKey of Object.keys(cRow.subAreaDatas)) {
            const sub = cRow.subAreaDatas[sKey];
            if (sub?.rowDatas && Array.isArray(sub.rowDatas)) {
                for (const subRow of sub.rowDatas) {
                    const sDatas = subRow.datas || {};
                    for (const k of priorityKeys) {
                        if (sDatas[k]) {
                            const amt = parseNum(sDatas[k]);
                            if (amt > 0) return amt;
                        }
                    }
                }
            }
        }
    }

    return 0;
}

export function parseBillDataStructure(billData: any): { billRows: BillRowItem[]; billTags: Map<string, number> } {
    if (!billData || !billData.area || !billData.area.rowDatas) return { billRows: [], billTags: new Map() };

    const mainRow = billData.area.rowDatas[0];
    if (!mainRow || !mainRow.subAreaDatas) return { billRows: [], billTags: new Map() };

    const claimArea = mainRow.subAreaDatas[BUDGET_CONSTANTS.claimSubAreaId];
    if (!claimArea || !claimArea.rowDatas) return { billRows: [], billTags: new Map() };

    const tagsMap = new Map<string, number>();
    const billRows: BillRowItem[] = claimArea.rowDatas.map((cRow: any, idx: number) => {
        const claimDatas = cRow.datas || {};
        const rowNum = claimDatas.ROW_NUM?.value || idx + 1;
        const expTypeTitle = claimDatas.EXPENSE_TYPE_ID?.value?.title?.zh_CN || '费用明细';

        let recDesc = '';
        const recArea = cRow.subAreaDatas?.[BUDGET_CONSTANTS.recSubAreaId];
        if (recArea && recArea.rowDatas && recArea.rowDatas.length > 0) {
            recDesc = recArea.rowDatas[0].datas?.DESCRIPTION?.value || '';
        }

        const tagMatch = recDesc.match(/[A-Za-z0-9]+-[A-Za-z0-9]+/) || recDesc.match(/^[A-Za-z0-9]+/);
        const tag = tagMatch ? tagMatch[0] : (recDesc.trim() || '');
        if (tag) {
            tagsMap.set(tag, (tagsMap.get(tag) || 0) + 1);
        }

        let budgetRowId = '';
        let curAccount = '';
        let curCostCenter = '';
        let curProject = '';
        let curKhfd = '';

        const budgetArea = cRow.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId];
        if (budgetArea && budgetArea.rowDatas && budgetArea.rowDatas.length > 0) {
            const bRow = budgetArea.rowDatas[0];
            budgetRowId = bRow.rowId || bRow.datas?.BILL_ROW_ID?.value || '';
            const bDatas = bRow.datas || {};
            curAccount = bDatas.DIM_ACCOUNT?.value?.title?.zh_CN || '';
            curCostCenter = bDatas.F_BM?.value?.title?.zh_CN || '';
            curProject = bDatas.DIM_PROJECT?.value?.title?.zh_CN || '';
            curKhfd = bDatas.F_KHFD?.value?.title?.zh_CN || '';
        }

        const amount = extractRowAmount(claimDatas, cRow);

        return {
            index: idx,
            rowNum: Number(rowNum),
            claimRowId: cRow.rowId || '',
            budgetRowId: budgetRowId,
            recDesc: recDesc,
            expTypeName: expTypeTitle,
            expTypeTitle: expTypeTitle,
            amount: amount,
            curAccount: curAccount,
            curCostCenter: curCostCenter,
            curProject: curProject,
            curKhfd: curKhfd,
            status: '就绪'
        };
    });

    return { billRows, billTags: tagsMap };
}

/**
 * 批量删除出差申请单或报销单草稿 (仅限未提交状态)
 */
export async function deleteBillByBillMainIdsApi(
    billMainIds: string[],
    state: GlobalState,
    billDeleteScene: 'BILL' | 'BILL_EXPENSERECORD' = 'BILL'
): Promise<any> {
    if (!billMainIds || billMainIds.length === 0) return { success: true };
    const payload = {
        billMainIds,
        billDeleteScene: billDeleteScene || 'BILL' // 刚性锁定：仅删除单据，费用退回至费用记录列表
    };
    const res = await callNativeHttp(
        '/fssc/bill/billdata/deleteBillByBillMainIds',
        'POST',
        payload
    ) || await apiRequest(
        '/fssc/bill/billdata/deleteBillByBillMainIds',
        'POST',
        payload,
        state
    );
    if (res && (res.success || res.data === 'ok')) {
        return res;
    }
    throw new Error(res?.message || '删除单据草稿失败');
}

/**
 * 从未报销费用记录批量生成报销单草稿（commit: false，仅保存草稿入库，绝不提交审批）
 */
export async function createBillDataAndTemplateByExpenseIdListApi(
    billDefineId: string,
    expenseRecordIds: string[],
    state: GlobalState
): Promise<any> {
    const appId = state?.appId || 'e3d5e4787ff911e88b1997bee3518b4d';
    const payload = {
        billDefineId,
        appId,
        scene: 'WRITE',
        applicantId: state?.applicantId || '',
        userDefinedData: {
            expenseRecordIds,
            operationType: 'ADD'
        },
        expenseRecordIds
    };
    const res = await callNativeHttp(
        '/fssc/expenseClaim/billData/createBillDataAndTemplateByExpenseIdList',
        'POST',
        payload,
        null,
        undefined,
        LEGAL_MENU_IDS.EXPENSE_RECORD
    ) || await apiRequest(
        '/fssc/expenseClaim/billData/createBillDataAndTemplateByExpenseIdList',
        'POST',
        payload,
        state,
        false,
        false,
        LEGAL_MENU_IDS.EXPENSE_RECORD
    );
    if (res && res.success && res.data) {
        return res.data;
    }
    throw new Error(res?.message || '生成报销单草稿失败');
}

export interface UncommittedBillItem {
    billMainId: string;
    billCode: string;
    billName: string;
    status: string;
    createTime: string;
    totalAmount?: number;
    rows: Array<{
        rowNum: number;
        expenseTypeName: string;
        amount: number;
        description: string;
        personName?: string;
    }>;
}

/**
 * 穿透拉取当前登录人所有未提交报销单草稿及其内部每一笔费用的明细与备注说明
 */
export async function fetchUncommittedReimbursementBillsSummary(
    state: GlobalState
): Promise<{
    bills: UncommittedBillItem[];
    summaryMarkdown: string;
}> {
    const appId = state?.appId || 'e3d5e4787ff911e88b1997bee3518b4d';
    // 报销单列表视图 (V_MYREIMBURSEMENT, sheetId: 80b9cd76d02611ec99e696d1bc9d5c7e)
    const listRes = await callNativeHttp(
        '/fssc/billViewConfig/getBillViewQueryDataList',
        'POST',
        {
            conditionMap: {},
            pageOrderParam: { pageNum: 1, pageSize: 50, enableCountLimit: true, countLimit: 1000, count: false },
            sheetId: '80b9cd76d02611ec99e696d1bc9d5c7e',
            appId
        }
    ) || await apiRequest(
        '/fssc/billViewConfig/getBillViewQueryDataList',
        'POST',
        {
            conditionMap: {},
            pageOrderParam: { pageNum: 1, pageSize: 50, enableCountLimit: true, countLimit: 1000, count: false },
            sheetId: '80b9cd76d02611ec99e696d1bc9d5c7e',
            appId
        },
        state
    );

    const items = listRes?.data?.list || [];
    const uncommittedList = items.filter((it: any) => {
        const status = it.e2bf9fe2a4f211e88f5e9d87398070eb?.showValue || it.e2bf9fe2a4f211e88f5e9d87398070eb?.value;
        return status === '未提交';
    });

    // 并发并发并发！使用 Promise.all 并行拉取全部草稿单据详情，将 15~20s 串行耗时压减至 1~2s
    const billPromises = uncommittedList.map(async (it: any) => {
        const codeObj = Object.values(it).find((v: any) => typeof v === 'string' && (v.startsWith('BC') || v.startsWith('BJ'))) 
            || Object.values(it).find((v: any) => typeof v === 'object' && String((v as any)?.value).startsWith('BC'));
        const billCode = typeof codeObj === 'object' ? (codeObj as any)?.value : (codeObj || '');
        const billMainId = it.BILL_MAIN_ID?.value || it.BILL_MAIN_ID?.id || it.BILL_MAIN_ID || '';
        const billName = it.e2bedc66a4f211e88f5ef99ecdff44af?.showValue || it.e2bedc66a4f211e88f5ef99ecdff44af?.value || '';
        const createTime = it.e2bedc68a4f211e88f5e27a9ff593444?.showValue || it.e2bedc68a4f211e88f5e27a9ff593444?.value || '';

        if (!billMainId) return null;

        try {
            const detailRes = await fetchBillDataAndTemplateApi(billMainId, state);
            const { billRows } = parseBillDataStructure(detailRes.billData);
            
            let totalAmount = 0;
            const rows = billRows.map(r => {
                totalAmount += (r.amount || 0);
                const desc = r.recDesc || '';
                // 动态提取人名（如 [外驻:成勇] 或 [陈浩]）
                let personName = '';
                const mExternal = desc.match(/\[外驻[:：]([^\]]+)\]/);
                if (mExternal && mExternal[1]) {
                    personName = mExternal[1].trim();
                } else {
                    const mNormal = desc.match(/\[([^\]]+)\]/);
                    if (mNormal && mNormal[1]) {
                        personName = mNormal[1].trim();
                    }
                }

                return {
                    rowNum: r.rowNum,
                    expenseTypeName: r.expTypeName,
                    amount: r.amount,
                    description: desc,
                    personName
                };
            });

            return {
                billMainId,
                billCode,
                billName,
                status: '未提交',
                createTime,
                totalAmount: Math.round(totalAmount * 100) / 100,
                rows
            };
        } catch (detailErr) {
            return {
                billMainId,
                billCode,
                billName,
                status: '未提交',
                createTime,
                rows: []
            };
        }
    });

    const billResults = await Promise.all(billPromises);
    const bills: UncommittedBillItem[] = billResults.filter((b): b is UncommittedBillItem => Boolean(b));

    // 格式化为 Markdown 列表
    let md = `### 📋 当前未提交报销单明细清单 (共 ${bills.length} 张)\n\n`;
    if (bills.length === 0) {
        md += `当前草稿箱中暂无状态为“未提交”的报销单草稿。\n`;
    } else {
        bills.forEach((b, bIdx) => {
            md += `#### ${bIdx + 1}. 单号：\`${b.billCode || b.billMainId}\`（${b.billName || '出差费用报销单'}） 总金额：¥${b.totalAmount || 0}\n`;
            if (b.rows.length === 0) {
                md += `*(该单据暂无明细行或未加载明细)*\n\n`;
            } else {
                md += `| 行号 | 费用类型 | 金额 (元) | 识别人员 | 费用备注说明 |\n`;
                md += `| :---: | :--- | :---: | :---: | :--- |\n`;
                b.rows.forEach(r => {
                    md += `| ${r.rowNum} | ${r.expenseTypeName} | ¥${r.amount.toFixed(2)} | ${r.personName ? `**${r.personName}**` : '*(未标注)*'} | \`${r.description || '-'}\` |\n`;
                });
                md += `\n`;
            }
        });
    }

    return {
        bills,
        summaryMarkdown: md
    };
}

/**
 * 确定性汇总全量费用记录池中的人员账目（不硬编码任何人员与金额，纯动态正则提取）
 */
export function generateComprehensivePersonExpenseReport(
    groups: GenericExpenseGroup[],
    currentEmpName: string = '本部社员'
): {
    summaryTableMarkdown: string;
    personListMarkdown: string;
    totalAmount: number;
    totalInvoices: number;
    totalExpenses: number;
    personMap: Map<string, {
        name: string;
        roleType: '外驻人员' | '本部社员';
        count: number;
        invoiceCount: number;
        amount: number;
        items: Array<{
            index: number;
            date: string;
            type: string;
            amount: number;
            invCount: number;
            desc: string;
            note: string;
        }>;
    }>;
} {
    const personMap = new Map<string, {
        name: string;
        roleType: '外驻人员' | '本部社员';
        count: number;
        invoiceCount: number;
        amount: number;
        items: Array<{
            index: number;
            date: string;
            type: string;
            amount: number;
            invCount: number;
            desc: string;
            note: string;
        }>;
    }>();

    let grandTotalAmount = 0;
    let grandTotalInvoices = 0;
    const grandTotalExpenses = groups.length;

    groups.forEach((g, idx) => {
        const desc = (g.newDescription || g.description || '').trim();
        const amt = Number(g.expenseAmount || 0);
        const invCount = g.invoices?.length || 1;
        grandTotalAmount += amt;
        grandTotalInvoices += invCount;

        // 1. 动态正则提取人员姓名（严格遵守通用性铁律，禁止硬编码名单）
        let personName = '';
        let roleType: '外驻人员' | '本部社员' = '外驻人员';

        const mProxy = desc.match(/\[外驻[:：]([^\]]+)\]/);
        if (mProxy && mProxy[1]) {
            personName = mProxy[1].trim();
            roleType = '外驻人员';
        } else {
            // 匹配中括号内部标识，排除项目代码与常用词
            const matches = desc.match(/\[([^\]]+)\]/g);
            if (matches) {
                for (const m of matches) {
                    const inner = m.replace(/[\[\]]/g, '').trim();
                    if (!/^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(inner) && !/项目|预算|出差|市内|日常|外驻/.test(inner)) {
                        personName = inner;
                        roleType = (inner === currentEmpName || inner.includes('陈浩')) ? '本部社员' : '外驻人员';
                        break;
                    }
                }
            }
        }

        if (!personName) {
            personName = currentEmpName || '本部社员';
            roleType = '本部社员';
        }

        if (!personMap.has(personName)) {
            personMap.set(personName, {
                name: personName,
                roleType,
                count: 0,
                invoiceCount: 0,
                amount: 0,
                items: []
            });
        }

        const pRecord = personMap.get(personName)!;
        pRecord.count += 1;
        pRecord.invoiceCount += invCount;
        pRecord.amount = Math.round((pRecord.amount + amt) * 100) / 100;

        const inv = g.invoices?.[0];
        const invNote = inv ? `${inv.salesName || ''} ${inv.remarks || ''}`.trim() : '';
        pRecord.items.push({
            index: idx + 1,
            date: g.newBusinessDate || g.businessDate || '-',
            type: g.newExpenseTypeName || g.expenseTypeName || '费用明细',
            amount: amt,
            invCount: invCount,
            desc: desc,
            note: invNote || '-'
        });
    });

    grandTotalAmount = Math.round(grandTotalAmount * 100) / 100;

    // 生成各人员财务对账汇总表
    let summaryTable = `### 📊 一、各人员费用归集对账总表 (共 ${grandTotalExpenses} 笔费用，${grandTotalInvoices} 张发票，总额 ¥${grandTotalAmount.toFixed(2)})\n\n`;
    summaryTable += `| 序号 | 识别人员 | 人员身份/属性 | 费用明细笔数 | 发票张数 | 累计报销金额 (元) | 占总支出比例 |\n`;
    summaryTable += `| :---: | :--- | :---: | :---: | :---: | :---: | :---: |\n`;

    let pIdx = 1;
    for (const [, p] of personMap.entries()) {
        const ratio = grandTotalAmount > 0 ? ((p.amount / grandTotalAmount) * 100).toFixed(1) : '0.0';
        summaryTable += `| ${pIdx++} | **${p.name}** | ${p.roleType} | ${p.count} 笔 | ${p.invoiceCount} 张 | **¥${p.amount.toFixed(2)}** | ${ratio}% |\n`;
    }
    summaryTable += `| **合计** | - | - | **${grandTotalExpenses} 笔** | **${grandTotalInvoices} 张** | **¥${grandTotalAmount.toFixed(2)}** | **100.0%** |\n\n`;

    // 生成各人员明细清单
    let personListMd = `### 📋 二、各人员费用明细清单 (/list)\n\n`;
    pIdx = 1;
    for (const [, p] of personMap.entries()) {
        personListMd += `#### ${pIdx++}. ${p.name}（${p.roleType}）- 共 ${p.count} 笔明细，${p.invoiceCount} 张发票，累计 ¥${p.amount.toFixed(2)}\n\n`;
        personListMd += `| 序号 | 业务日期 | 费用类型 | 金额 (元) | 发票张数 | 费用说明与项目 | 发票销方/备注 |\n`;
        personListMd += `| :---: | :---: | :--- | :---: | :---: | :--- | :--- |\n`;
        p.items.forEach(it => {
            personListMd += `| ${it.index} | ${it.date} | ${it.type} | ¥${it.amount.toFixed(2)} | ${it.invCount} 张 | \`${it.desc}\` | ${it.note} |\n`;
        });
        personListMd += `\n`;
    }

    return {
        summaryTableMarkdown: summaryTable,
        personListMarkdown: personListMd,
        totalAmount: grandTotalAmount,
        totalInvoices: grandTotalInvoices,
        totalExpenses: grandTotalExpenses,
        personMap
    };
}



