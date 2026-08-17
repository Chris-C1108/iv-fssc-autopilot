import { apiRequest } from '../utils/http';
import { GlobalState } from '../types/state';

export async function queryInvoicePoolListApi(state: GlobalState) {
    const payload = {
        boDefineId: '5f0971df7a4411e9b0edd9fcadd69462',
        isDefaultFilter: true,
        isOnlyTotal: false,
        isPaging: false,
        isUseSecformal: false,
        loginUserId: state.applicantId,
        otherCondition: { otherFilter: [] },
        pageCondition: { pageNo: 1, pageSize: 200 },
        sortConditions: []
    };
    const res = await apiRequest('/fssc/bo/boQuery/getBOQueryDataList', 'POST', payload, state);
    return res.data && res.data.rowDatas ? res.data.rowDatas : [];
}

export async function getInvoiceDetailByDataIdApi(dataId: string, state: GlobalState) {
    const res = await apiRequest('/fssc/expenseClaim/expenseRecordInvoice/getInvoiceByDataId', 'POST', { invoiceDataId: dataId }, state);
    return res.data;
}

export async function queryExpenseRecordListApi(state: GlobalState) {
    const payload = {
        applicantId: state.applicantId,
        costCenterId: '',
        dateInterval: { dateType: 'ALL' },
        departmentId: '',
        expenseTypeId: '',
        hasBill: '',
        isAsc: true,
        orderField: 'CREATE_DATE',
        pageNo: 1,
        pageSize: 200,
        queryType: 'MY_CREATE',
        status: 'NO_REIMBURSE',
        subCompanyId: ''
    };
    const res = await apiRequest('/fssc/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO', 'POST', payload, state);
    return res.data && res.data.expenseRecordList ? res.data.expenseRecordList : [];
}

export async function getExpenseTypeRuleAndRowDatasApi(expenseRecordId: string, expenseTypeId: string, state: GlobalState) {
    const payload = {
        expenseRecordId,
        expenseTypeId,
        isDraft: false,
        source: 'RECORD_EDIT'
    };
    const res = await apiRequest('/fssc/expenseClaim/expenseRecord/getExpenseTypeFieldRuleListAndAllValueVO', 'POST', payload, state);
    if (res.data) {
        return {
            rowDatas: res.data.rowDatas || {},
            version: res.data.version !== undefined ? res.data.version : 1
        };
    }
    return { rowDatas: {}, version: 1 };
}

export async function initExpenseRecordWithTypeApi(expenseRecordId: string, targetExpenseTypeId: string, baseRowDatas: any, state: GlobalState) {
    const payload = {
        expenseRecordId,
        expenseTypeId: targetExpenseTypeId,
        rowDatas: baseRowDatas,
        source: 'CHANGE_EXPENSE_TYPE'
    };
    const res = await apiRequest('/fssc/expenseClaim/expenseRecord/initExpenseRecordData', 'POST', payload, state);
    return res.data || {};
}

export async function createDraftExpenseRecordFromInvoiceApi(invoiceVO: any, boDataId: string, state: GlobalState) {
    const payload = {
        expenseRecordInvoiceList: [{
            invoiceVO: invoiceVO || {},
            invoiceDataId: boDataId || (invoiceVO ? invoiceVO.invoiceDataId : '')
        }]
    };
    const res = await apiRequest('/fssc/expenseClaim/expenseRecord/initAndSaveExpenseRecordData', 'POST', payload, state);
    if (res.data && res.data.expenseRecordId) {
        return res.data.expenseRecordId;
    }
    throw new Error(res.message || '初始化发票草稿失败');
}

export async function saveFinalExpenseRecordApi(expenseRecordId: string, expenseTypeId: string, rowDatas: any, version: number, state: GlobalState) {
    const payload = {
        expenseRecordId,
        expenseTypeId,
        rowDatas,
        version: version || 1
    };
    const res = await apiRequest('/fssc/expenseClaim/expenseRecord/validateAndSaveExpenseRecord', 'POST', payload, state);
    if (!res.success) {
        throw new Error(res.message || '保存费用明细失败');
    }
    return res.data;
}
