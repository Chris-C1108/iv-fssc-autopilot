import { apiRequest } from '../utils/http';
import { BUDGET_CONSTANTS } from '../config/constants';
import { GlobalState, BillRowItem } from '../types/state';

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
    const res = await apiRequest(
        '/fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange',
        'POST',
        payload,
        state
    );
    if (res.success && res.data && res.data.billData) {
        return res.data.billData;
    }
    throw new Error(res.message || `修改字段 [${fieldName}] 失败`);
}

export async function saveBillDataApi(
    billData: any,
    state: GlobalState
): Promise<any> {
    const payload = JSON.parse(JSON.stringify(billData));
    payload.billButtons = [];
    payload.commit = false;
    payload.operationType = 'UPDATE';
    payload.scene = 'WRITE';
    if (!payload.attachmentDeleteList) payload.attachmentDeleteList = [];
    if (!payload.attachmentUploadList) payload.attachmentUploadList = [];
    if (payload.attachmentDeleteSync === undefined) payload.attachmentDeleteSync = false;

    const res = await apiRequest(
        '/fssc/bill/billdata/saveBillData',
        'POST',
        payload,
        state
    );
    if (res.success && res.data) {
        return res.data;
    }
    throw new Error(res.message || '保存报销单失败');
}

export async function fetchBillDataAndTemplateApi(
    billMainId: string,
    state: GlobalState
): Promise<{ billData: any; billTemplate: any }> {
    const payload = {
        billMainId: billMainId,
        scene: 'WRITE'
    };
    const res = await apiRequest(
        '/fssc/bill/billdata/getBillDataAndTemplateByBillMainId',
        'POST',
        payload,
        state
    );
    if (res.success && res.data) {
        return {
            billData: res.data.billData,
            billTemplate: res.data.billDefineTemplate
        };
    }
    throw new Error(res.message || '获取报销单数据失败');
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

        const amount = Number(claimDatas.AMOUNT?.value?.amount || claimDatas.AMOUNT?.value || 0);

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
    state: GlobalState
): Promise<any> {
    if (!billMainIds || billMainIds.length === 0) return { success: true };
    const payload = { billMainIds };
    const res = await apiRequest(
        '/fssc/bill/billdata/deleteBillByBillMainIds',
        'POST',
        payload,
        state
    );
    if (res.success) {
        return res;
    }
    throw new Error(res.message || '删除单据草稿失败');
}

/**
 * 从未报销费用记录批量生成报销单草稿（commit: false，仅保存草稿入库，绝不提交审批）
 */
export async function createBillDataAndTemplateByExpenseIdListApi(
    billDefineId: string,
    expenseRecordIds: string[],
    state: GlobalState
): Promise<any> {
    if (!expenseRecordIds || expenseRecordIds.length === 0) {
        throw new Error('未选择任何待报销费用记录');
    }
    const payload = {
        billDefineId,
        expenseRecordIds
    };
    const res = await apiRequest(
        '/fssc/expenseClaim/billData/createBillDataAndTemplateByExpenseIdList',
        'POST',
        payload,
        state
    );
    if (res.success && res.data) {
        return res.data;
    }
    throw new Error(res.message || '生成报销单草稿失败');
}

