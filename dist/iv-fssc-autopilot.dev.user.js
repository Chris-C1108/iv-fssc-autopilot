// ==UserScript==
// @name         IVision FSSC Autopilot (元年云费控极速自动驾驶副驾)
// @namespace    https://github.com/Chris-C1108/iv-fssc-autopilot
// @version      4.3.0
// @description  元年云报销全流程超级副驾：①【发票夹 & 费用记录】全量OCR数据穿透补全(乘车时间/里程100%恢复)、自动识别通信费、自由切换分类、早晚行程智能推断、拖拽多附件；②【经费报销单页】丰富多维菜单Item(科目/项目/成本中心/向客户请款)、自动聚合备注TAG(如X2605-001)、智能检索匹配项目、蝴蝶效应引擎链式联动、一键自动持久化保存(saveBillData)并自动刷新单据视图；③【极速模式】首行蝴蝶+内存克隆+单次入库(30倍提速)。
// @author       Chris-C1108
// @match        https://ync37.yuanian.com/fssc/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const EXPENSE_TYPES = {
        TAXI: {
            id: '0356c529e72de1653e55bb00bc610001',
            name: '市内交通费',
            label: '🚕 出租车 (交通费)',
            icon: 'e-private-car-utility-s',
            iconColor: '#9C61FF'
        },
        COMMUNICATION: {
            id: '0356c577f8ede1653e55bb00bc610001',
            name: '通信费-员工手机费',
            label: '📱 通信费 (手机费)',
            icon: 'e-phone-fee',
            iconColor: '#2B85FF'
        }
    };
    const MENU_DICTIONARY = {
        accounts: [
            { value: '03561d1db6a345af7f1906ec05cc0000', code: 'Account_P', name: '项目预算 (Account_P)' },
            { value: '03561781c2fde1653e55bb00bc610000', code: 'PL0240', name: '市内交通費 (PL0240)' },
            { value: '03561781c31de1653e55bb00bc610001', code: 'PL0250', name: '通信費（個人立替、月次精算） (PL0250)' },
            { value: '03561781c02de1653e55bb00bc610000', code: 'PL0210', name: '国内出張旅費 (PL0210)' },
            { value: '03561781c05de1653e55bb00bc610001', code: 'PL0260', name: '会議費 (PL0260)' },
            { value: '03561781c07de1653e55bb00bc610000', code: 'PL0270', name: '交際費 (PL0270)' },
            { value: '03561781c09de1653e55bb00bc610001', code: 'PL0310', name: '消耗品費 (PL0310)' },
            { value: '03561781c0cde1653e55bb00bc610000', code: 'PL0340', name: '図書研修費 (PL0340)' },
            { value: '03561781c0ede1653e55bb00bc610001', code: 'PL0130', name: '福利厚生費 (PL0130)' }
        ],
        costCenters: [
            { value: '0356194b8b3de1653e55bb00bc610000', code: '102IT40X', name: 'IT服务G-安全咨询BU(制造)' },
            { value: '03c1e3468e32ddc6286802cb9b840000', code: '102IT402', name: 'IT服务G-安全咨询BU(销售)' },
            { value: '0437bf15a8d5879532bc7df544d40001', code: '101RC20', name: '资源中心-第2Unit(制造)' },
            { value: '0356194b88cde1653e55bb00bc610000', code: '102IT20I', name: 'IT服务G-Infra BU(制造)' },
            { value: '03c1e33844853b6091e6a17737d50001', code: '102IT202', name: 'IT服务G-Infra BU(销售)' },
            { value: '0356194b8aede1653e55bb00bc610000', code: '102BS50S', name: 'IT服务G-产业BU(制造)' },
            { value: '03c1e31b62e2ddc6286802cb9b840000', code: '102BS502', name: 'IT服务G-产业BU(销售)' },
            { value: '0361f25f747627179afeae28a0c20000', code: '101AD10C', name: '职能-部门付(职能总监Account)' }
        ],
        khfd: [
            { value: '6b8ff07f9ebe11e88b7247d35c1e5077', code: 'YES', name: '是 (YES)' },
            { value: '6b8ff0809ebe11e88b7219c3aed96e32', code: 'NO', name: '否 (NO)' }
        ]
    };
    const BUDGET_CONSTANTS = {
        boAreaId: '203d2e64f6bd4b32a8c83d030fb32676', // 预算区 ID
        claimSubAreaId: '3bfd939291eb42439b692181c5477a96', // 费用明细区 ID
        recSubAreaId: '7e1debbe739248c4a49ea98088997acf', // 支出记录区 ID
        fields: {
            account: {
                fieldId: 'c76bdd68560911e9940b1516ceebe56d',
                fieldCode: 'DIM_ACCOUNT',
                fieldName: '科目'
            },
            project: {
                fieldId: 'e11f202f465111ea98d4876bf4180a90',
                fieldCode: 'DIM_PROJECT',
                fieldName: '项目'
            },
            costCenter: {
                fieldId: '035b8400635345af7f1906ec05cc0000',
                fieldCode: 'F_BM',
                fieldName: '部门/成本中心'
            },
            khfd: {
                fieldId: '03633db0f918c8097fa3ad5bc8170000',
                fieldCode: 'F_KHFD',
                fieldName: '是否向客户请款'
            }
        },
        defaultAccount: {
            value: '03561d1db6a345af7f1906ec05cc0000',
            title: '项目预算'
        },
        defaultCostCenter: {
            value: '0356194b8b3de1653e55bb00bc610000',
            title: 'IT服务G-安全咨询BU(制造)'
        },
        defaultKhfd: {
            value: '6b8ff07f9ebe11e88b7247d35c1e5077',
            title: '是(YES)'
        }
    };

    function normalizeDate(str) {
        if (!str)
            return '';
        const m = String(str).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (m) {
            const y = m[1];
            const month = m[2].padStart(2, '0');
            const d = m[3].padStart(2, '0');
            return `${y}-${month}-${d}`;
        }
        return String(str).trim();
    }

    async function mapConcurrent(items, concurrency, asyncFn) {
        const results = new Array(items.length);
        let currentIndex = 0;
        const worker = async () => {
            while (currentIndex < items.length) {
                const idx = currentIndex++;
                try {
                    results[idx] = await asyncFn(items[idx], idx);
                }
                catch (err) {
                    console.error(`Error in mapConcurrent at index ${idx}:`, err);
                    results[idx] = null;
                }
            }
        };
        const workers = [];
        const actualConcurrency = Math.min(concurrency, items.length);
        for (let i = 0; i < actualConcurrency; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);
        return results;
    }

    function getHeaders(state, isFormUrlEncoded = false, isMultipart = false) {
        const headers = {
            'LoginToken': state.loginToken,
            'EcsToken': state.ecsToken,
            'UserOrigin': state.userOrigin || 'https://ync37.yuanian.com',
            'appid': state.appId || 'e3d5e4787ff911e88b1997bee3518b4d',
            'menuid': state.menuId || '11eedb8f8a31cd8f8a25f721e03d0caa',
            'Accept': '*/*'
        };
        if (state.eicds)
            headers['eicds'] = state.eicds;
        if (state.v)
            headers['v'] = state.v;
        if (isFormUrlEncoded) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        }
        else if (!isMultipart) {
            headers['Content-Type'] = 'application/json;charset=UTF-8';
        }
        return headers;
    }
    async function apiRequest(url, method = 'POST', data = null, state, isFormUrlEncoded = false, isMultipart = false) {
        if (!state.loginToken && !state.ecsToken) {
            const localTok = sessionStorage.getItem('LoginToken') || localStorage.getItem('LoginToken') || sessionStorage.getItem('token') || '';
            if (localTok) {
                state.loginToken = localTok;
                state.ecsToken = localTok;
            }
            else {
                throw new Error('未检测到登录 Token，请先在页面上刷新或操作以捕获 Token');
            }
        }
        const fullUrl = url.startsWith('http') ? url : `${state.userOrigin || 'https://ync37.yuanian.com'}${url}`;
        const headers = getHeaders(state, isFormUrlEncoded, isMultipart);
        let bodyStr = undefined;
        if (data) {
            if (isFormUrlEncoded || isMultipart) {
                bodyStr = data;
            }
            else {
                bodyStr = JSON.stringify(data);
            }
        }
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: method,
                    url: fullUrl,
                    headers: headers,
                    data: bodyStr,
                    onload: (response) => {
                        try {
                            const json = JSON.parse(response.responseText);
                            resolve(json);
                        }
                        catch (e) {
                            resolve({ success: false, message: response.responseText || '解析响应失败' });
                        }
                    },
                    onerror: (err) => reject(err)
                });
            }
            else {
                fetch(fullUrl, {
                    method: method,
                    headers: headers,
                    body: bodyStr
                })
                    .then(r => r.json())
                    .then(resolve)
                    .catch(reject);
            }
        });
    }

    async function searchDimProjectApi(keyword, state) {
        const payload = {
            dimObjectId: '6b8ce3199ebe11e88b72a97a1dba5a21',
            isParentId: false,
            isShowDisable: false,
            searchInfo: keyword.trim(),
            isFastShow: true,
            isShowCode: false,
            isShowRootNode: false,
            isSynchronize: false,
            permDataScope: 'BILL_ENTRY',
            loginUserId: state.applicantId,
            isUseSecurityFormal: false
        };
        const res = await apiRequest('/fssc/dim/dimObject/getDimObjectAccessTree', 'POST', payload, state);
        const results = [];
        if (res.success && res.data && Array.isArray(res.data)) {
            const traverse = (nodes) => {
                nodes.forEach(node => {
                    if (node.data) {
                        const d = node.data;
                        if (d.objectId && d.name) {
                            results.push({
                                id: d.objectId,
                                value: d.objectId,
                                code: d.code || '',
                                name: d.name,
                                title: d.externalSysAttr && d.externalSysAttr.NAME ? d.externalSysAttr.NAME : d.name
                            });
                        }
                    }
                    if (node.children && node.children.length > 0) {
                        traverse(node.children);
                    }
                });
            };
            traverse(res.data);
        }
        return results;
    }

    function prepareBillSceneVO(billData) {
        if (!billData)
            return null;
        const sceneVO = JSON.parse(JSON.stringify(billData));
        if (sceneVO.billButtons)
            delete sceneVO.billButtons;
        return sceneVO;
    }
    async function changeBillFieldValueApi(fieldCode, fieldName, billAreaFieldId, fieldValue, rowId, billSceneDataVO, state) {
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
        const res = await apiRequest('/fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange', 'POST', payload, state);
        if (res.success && res.data && res.data.billData) {
            return res.data.billData;
        }
        throw new Error(res.message || `修改字段 [${fieldName}] 失败`);
    }
    async function saveBillDataApi(billData, state) {
        const payload = JSON.parse(JSON.stringify(billData));
        payload.billButtons = [];
        payload.commit = false;
        payload.operationType = 'UPDATE';
        payload.scene = 'WRITE';
        if (!payload.attachmentDeleteList)
            payload.attachmentDeleteList = [];
        if (!payload.attachmentUploadList)
            payload.attachmentUploadList = [];
        if (payload.attachmentDeleteSync === undefined)
            payload.attachmentDeleteSync = false;
        const res = await apiRequest('/fssc/bill/billdata/saveBillData', 'POST', payload, state);
        if (res.success && res.data) {
            return res.data;
        }
        throw new Error(res.message || '保存报销单失败');
    }
    async function fetchBillDataAndTemplateApi(billMainId, state) {
        const payload = {
            billMainId: billMainId,
            scene: 'WRITE'
        };
        const res = await apiRequest('/fssc/bill/billdata/getBillDataAndTemplateByBillMainId', 'POST', payload, state);
        if (res.success && res.data) {
            return {
                billData: res.data.billData,
                billTemplate: res.data.billDefineTemplate
            };
        }
        throw new Error(res.message || '获取报销单数据失败');
    }
    function parseBillDataStructure(billData) {
        if (!billData || !billData.area || !billData.area.rowDatas)
            return { billRows: [], billTags: new Map() };
        const mainRow = billData.area.rowDatas[0];
        if (!mainRow || !mainRow.subAreaDatas)
            return { billRows: [], billTags: new Map() };
        const claimArea = mainRow.subAreaDatas[BUDGET_CONSTANTS.claimSubAreaId];
        if (!claimArea || !claimArea.rowDatas)
            return { billRows: [], billTags: new Map() };
        const tagsMap = new Map();
        const billRows = claimArea.rowDatas.map((cRow, idx) => {
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

    async function queryInvoicePoolListApi(state) {
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
    async function getInvoiceDetailByDataIdApi(dataId, state) {
        const res = await apiRequest('/fssc/expenseClaim/expenseRecordInvoice/getInvoiceByDataId', 'POST', { invoiceDataId: dataId }, state);
        return res.data;
    }
    async function queryExpenseRecordListApi(state) {
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
    async function getExpenseTypeRuleAndRowDatasApi(expenseRecordId, expenseTypeId, state) {
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
    async function initExpenseRecordWithTypeApi(expenseRecordId, targetExpenseTypeId, baseRowDatas, state) {
        const payload = {
            expenseRecordId,
            expenseTypeId: targetExpenseTypeId,
            rowDatas: baseRowDatas,
            source: 'CHANGE_EXPENSE_TYPE'
        };
        const res = await apiRequest('/fssc/expenseClaim/expenseRecord/initExpenseRecordData', 'POST', payload, state);
        return res.data || {};
    }
    async function createDraftExpenseRecordFromInvoiceApi(invoiceVO, boDataId, state) {
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
    async function saveFinalExpenseRecordApi(expenseRecordId, expenseTypeId, rowDatas, version, state) {
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

    const MODAL_STYLES = `
    /* 主悬浮按钮 */
    #yn-batch-helper-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        background: linear-gradient(135deg, #1890ff, #096dd9);
        color: #fff;
        border: none;
        border-radius: 24px;
        padding: 10px 20px;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(24, 144, 255, 0.4);
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        gap: 8px;
    }
    #yn-batch-helper-btn:hover {
        transform: translateY(-2px) scale(1.02);
        box-shadow: 0 6px 16px rgba(24, 144, 255, 0.5);
    }
    .yn-badge {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: #52c41a;
        display: inline-block;
    }
    .yn-badge.offline { background: #ff4d4f; }

    /* 模态框遮罩 */
    #yn-modal-mask {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 999998;
        display: none;
        backdrop-filter: blur(2px);
    }

    /* 模态框主体 */
    #yn-batch-modal {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 92vw;
        max-width: 1440px;
        height: 88vh;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
        z-index: 999999;
        display: none;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    /* 头部 */
    .yn-header {
        padding: 14px 20px;
        border-bottom: 1px solid #f0f0f0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #fafafa;
    }
    .yn-header h3 {
        margin: 0;
        font-size: 16px;
        color: #262626;
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .yn-close-btn {
        background: transparent;
        border: none;
        font-size: 20px;
        color: #8c8c8c;
        cursor: pointer;
    }
    .yn-close-btn:hover { color: #262626; }

    /* 内容区 */
    .yn-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 12px 20px;
        overflow: hidden;
        background: #fdfdfd;
    }

    /* 工具栏 */
    .yn-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
    }
    .yn-toolbar-left {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    /* 分类标签页 */
    .yn-group-tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
        border-bottom: 1px solid #e8e8e8;
        padding-bottom: 8px;
    }
    .yn-tab-btn {
        background: #f5f5f5;
        border: 1px solid #d9d9d9;
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .yn-tab-btn.active {
        background: #1890ff;
        color: #fff;
        border-color: #1890ff;
        font-weight: bold;
    }
    .yn-tab-count {
        background: rgba(0, 0, 0, 0.08);
        padding: 1px 6px;
        border-radius: 10px;
        font-size: 11px;
    }
    .yn-tab-btn.active .yn-tab-count {
        background: rgba(255, 255, 255, 0.25);
        color: #fff;
    }

    /* TAG 标签云 */
    .yn-tag-cloud {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 10px;
        padding: 8px 12px;
        background: #f6ffed;
        border: 1px solid #b7eb8f;
        border-radius: 6px;
    }
    .yn-tag-chip {
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: bold;
        background: #fff;
        border: 1px solid #d9d9d9;
        color: #595959;
        cursor: pointer;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .yn-tag-chip:hover, .yn-tag-chip.active {
        background: #52c41a;
        color: #fff;
        border-color: #52c41a;
    }
    .yn-tag-count {
        background: rgba(0, 0, 0, 0.08);
        padding: 1px 5px;
        border-radius: 8px;
        font-size: 10.5px;
    }
    .yn-tag-chip.active .yn-tag-count {
        background: rgba(255, 255, 255, 0.3);
        color: #fff;
    }

    /* 快捷配置栏 */
    .yn-quick-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #e6f7ff;
        border: 1px solid #91d5ff;
        border-radius: 6px;
        margin-bottom: 10px;
        flex-wrap: wrap;
        font-size: 13px;
    }
    .yn-quick-bar input, .yn-quick-bar select {
        padding: 4px 8px;
        border: 1px solid #d9d9d9;
        border-radius: 4px;
        font-size: 12.5px;
        outline: none;
    }

    /* 表格区域 */
    .yn-table-container {
        flex: 1;
        overflow: auto;
        border: 1px solid #e8e8e8;
        border-radius: 6px;
        background: #fff;
    }
    .yn-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
        text-align: left;
    }
    .yn-table th {
        background: #fafafa;
        color: #595959;
        font-weight: 600;
        padding: 10px 8px;
        border-bottom: 1px solid #e8e8e8;
        position: sticky;
        top: 0;
        z-index: 10;
    }
    .yn-table td {
        padding: 8px;
        border-bottom: 1px solid #f0f0f0;
        color: #262626;
    }
    .yn-table tr:hover { background: #fafafa; }
    .yn-table tr.selected { background: #f6ffed; }

    .yn-type-select {
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
    }
    .type-taxi { border: 1px solid #9C61FF; color: #9C61FF; }
    .type-comm { border: 1px solid #2B85FF; color: #2B85FF; }

    .yn-time-badge {
        font-family: monospace;
        font-size: 11.5px;
        color: #595959;
    }
    .yn-time-highlight { font-weight: bold; color: #1890ff; }
    .yn-swap-btn {
        background: #f0f0f0;
        border: 1px solid #d9d9d9;
        border-radius: 3px;
        cursor: pointer;
        padding: 1px 5px;
        font-size: 12px;
    }
    .yn-dropzone {
        border: 1px dashed #1890ff;
        background: #f0f5ff;
        padding: 3px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11.5px;
        color: #1890ff;
        text-align: center;
    }

    /* 状态标签 */
    .yn-status-tag {
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 10px;
        display: inline-block;
    }
    .yn-status-success { background: #f6ffed; color: #52c41a; }
    .yn-status-error { background: #fff2f0; color: #ff4d4f; }
    .yn-status-pending { background: #fafafa; color: #8c8c8c; }

    /* 底部操作区 */
    .yn-footer {
        padding: 12px 20px;
        border-top: 1px solid #f0f0f0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #fafafa;
    }
    .yn-progress-bar-wrap {
        flex: 1;
        margin-right: 20px;
        display: none;
    }
    .yn-progress-bar {
        height: 6px;
        width: 100%;
        background: #f5f5f5;
        border-radius: 3px;
        overflow: hidden;
    }
    .yn-progress-inner {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #52c41a, #1890ff);
        transition: width 0.2s;
    }
    .yn-log-box {
        font-size: 12px;
        color: #8c8c8c;
        margin-top: 4px;
    }

    .yn-btn {
        background: #fff;
        color: #595959;
        border: 1px solid #d9d9d9;
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
    }
    .yn-btn:hover { border-color: #1890ff; color: #1890ff; }
    .yn-btn-primary {
        background: #1890ff;
        color: #fff;
        border-color: #1890ff;
    }
    .yn-btn-primary:hover { background: #40a9ff; }
    .yn-btn-success {
        background: #52c41a;
        color: #fff;
        border-color: #52c41a;
    }
    .yn-btn-success:hover { background: #73d13d; }
    .yn-btn-smart {
        background: #722ed1;
        color: #fff;
        border-color: #722ed1;
    }
    .yn-btn-smart:hover { background: #9254de; }
    .yn-btn:disabled {
        background: #d9d9d9 !important;
        border-color: #d9d9d9 !important;
        color: #8c8c8c !important;
        cursor: not-allowed !important;
    }
`;
    function injectStyles() {
        if (document.getElementById('yn-injected-styles'))
            return;
        const styleEl = document.createElement('style');
        styleEl.id = 'yn-injected-styles';
        styleEl.innerHTML = MODAL_STYLES;
        document.head.appendChild(styleEl);
    }

    function createModalDOM(state) {
        let btn = document.getElementById('yn-batch-helper-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'yn-batch-helper-btn';
            document.body.appendChild(btn);
        }
        btn.innerHTML = `
        <span class="yn-badge ${state.loginToken ? '' : 'offline'}"></span>
        <span>${state.pageMode === 'BILL' ? '⚡ 报销单预算批量修改' : '⚡ 报销批量助手'}</span>
    `;
        let mask = document.getElementById('yn-modal-mask');
        if (!mask) {
            mask = document.createElement('div');
            mask.id = 'yn-modal-mask';
            document.body.appendChild(mask);
        }
        let modal = document.getElementById('yn-batch-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'yn-batch-modal';
            document.body.appendChild(modal);
        }
        if (state.pageMode === 'BILL') {
            const accountOptionsHtml = MENU_DICTIONARY.accounts.map(a => `
            <option value="${a.value}" ${a.code === 'Account_P' ? 'selected' : ''}>${a.name}</option>
        `).join('');
            const costCenterOptionsHtml = MENU_DICTIONARY.costCenters.map(c => `
            <option value="${c.value}" ${c.code === '102IT40X' ? 'selected' : ''}>${c.name}</option>
        `).join('');
            const khfdOptionsHtml = MENU_DICTIONARY.khfd.map(k => `
            <option value="${k.value}" ${k.code === 'YES' ? 'selected' : ''}>${k.name}</option>
        `).join('');
            modal.innerHTML = `
            <div class="yn-header">
                <h3>
                    <span>⚡ 经费报销单 - 批量修改预算归属 (v4.3.0 极速模式)</span>
                    <span id="yn-token-indicator" style="font-size:12px; font-weight:normal; color:${state.loginToken ? '#52c41a' : '#ff4d4f'};">
                        ${state.loginToken ? '● Token 已就绪' : '○ 正在等待 Token'}
                    </span>
                </h3>
                <button class="yn-close-btn" id="yn-modal-close">×</button>
            </div>

            <div class="yn-body">
                <!-- 1. 智能 TAG 标签云 -->
                <div class="yn-tag-cloud" id="yn-bill-tag-cloud">
                    <strong style="color:#389e0d; font-size:12px;">🏷️ 备注 TAG 速选:</strong>
                    <span id="yn-bill-tags-container">正在提取当前报销单 TAG...</span>
                </div>

                <!-- 2. 批量修改配置面板 -->
                <div class="yn-quick-bar">
                    <strong>🎯 目标预算设定：</strong>
                    <span>匹配TAG: </span>
                    <input type="text" id="yn-bill-filter-input" placeholder="如: X2605-001" style="width:105px; font-weight:bold;" />

                    <span>预算科目: </span>
                    <select id="yn-bill-account-select" style="max-width:210px; font-weight:600; color:#1890ff;">
                        ${accountOptionsHtml}
                    </select>

                    <span>部门/成本中心: </span>
                    <select id="yn-bill-cost-center-select" style="max-width:210px; font-weight:600; color:#595959;">
                        ${costCenterOptionsHtml}
                    </select>

                    <span>目标项目: </span>
                    <div style="position:relative; display:inline-flex; align-items:center; gap:4px;">
                        <input type="text" id="yn-bill-project-search" placeholder="输入代码或名称检索..." style="width:130px;" />
                        <select id="yn-bill-project-select" style="max-width:260px; font-weight:bold; color:#722ed1;">
                            <option value="">-- 请选择或检索项目 --</option>
                        </select>
                    </div>

                    <span>向客户请款: </span>
                    <select id="yn-bill-khfd-select" style="font-weight:600; color:#52c41a;">
                        ${khfdOptionsHtml}
                    </select>

                    <button class="yn-btn yn-btn-primary" id="yn-bill-btn-apply-filter" style="font-weight:600;">
                        🔍 筛选并勾选
                    </button>
                </div>

                <!-- 3. 明细表格 -->
                <div class="yn-table-container">
                    <table class="yn-table" id="yn-bill-records-table">
                        <thead>
                            <tr>
                                <th style="width:36px; text-align:center;"><input type="checkbox" id="yn-bill-th-select-all" /></th>
                                <th style="width:36px; text-align:center;">#</th>
                                <th style="width:50px; text-align:center;">行号</th>
                                <th style="width:100px;">费用类型</th>
                                <th style="width:75px; text-align:right;">报销金额</th>
                                <th style="width:140px;">支出记录备注 / TAG</th>
                                <th style="width:120px;">当前科目</th>
                                <th style="width:150px;">当前部门/成本中心</th>
                                <th style="width:170px;">当前项目</th>
                                <th style="width:65px; text-align:center;">当前请款</th>
                                <th style="width:200px; color:#1890ff;">修改后预算预览</th>
                                <th style="width:55px; text-align:center;">状态</th>
                            </tr>
                        </thead>
                        <tbody id="yn-bill-table-tbody">
                            <tr><td colspan="12" style="text-align:center; padding:50px; color:#8c8c8c;">正在解析当前报销单费用明细...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="yn-footer">
                <div class="yn-progress-bar-wrap" id="yn-bill-progress-wrap">
                    <div class="yn-progress-bar">
                        <div class="yn-progress-inner" id="yn-bill-progress-inner"></div>
                    </div>
                    <div class="yn-log-box" id="yn-bill-log-text">准备就绪</div>
                </div>
                <div style="margin-left:auto; display:flex; gap:10px;">
                    <button class="yn-btn" id="yn-bill-btn-reload">🔄 刷新报销单</button>
                    <button class="yn-btn yn-btn-success" id="yn-bill-btn-batch-execute" style="font-weight:600; padding:6px 24px;">
                        🚀 批量修改预算归属并向客户请款 (30倍极速)
                    </button>
                </div>
            </div>
        `;
        }
        else {
            // === 模式 A: 发票夹 / 费用记录 ===
            modal.innerHTML = `
            <div class="yn-header">
                <h3>
                    <span>元年报销批量流转与录入助手</span>
                    <span id="yn-token-indicator" style="font-size:12px; font-weight:normal; color:${state.loginToken ? '#52c41a' : '#ff4d4f'};">
                        ${state.loginToken ? '● Token 已就绪' : '○ 正在等待 Token'}
                    </span>
                </h3>
                <button class="yn-close-btn" id="yn-modal-close">×</button>
            </div>

            <div class="yn-body">
                <div class="yn-toolbar">
                    <div class="yn-toolbar-left">
                        <button class="yn-btn yn-btn-primary" id="yn-btn-fetch-all" style="font-weight:600; padding:6px 16px;">
                            🔄 一键同步待报销数据
                        </button>
                    </div>
                    <div class="yn-toolbar-right">
                        <span id="yn-select-count-info" style="font-size:12px; color:#595959; font-weight:600;">已勾选 0 行</span>
                    </div>
                </div>

                <div class="yn-group-tabs">
                    <button class="yn-tab-btn active" data-group="TAXI" id="yn-tab-taxi">
                        🚕 出租车 (市内交通) <span class="yn-tab-count" id="yn-count-taxi">0</span>
                    </button>
                    <button class="yn-tab-btn" data-group="COMMUNICATION" id="yn-tab-comm">
                        📱 通信费 (员工手机费) <span class="yn-tab-count" id="yn-count-comm">0</span>
                    </button>
                    <button class="yn-tab-btn" data-group="ALL" id="yn-tab-all">
                        📋 全部记录 <span class="yn-tab-count" id="yn-count-all">0</span>
                    </button>
                </div>

                <div class="yn-quick-bar" id="yn-quick-bar-taxi">
                    <strong>🚕 出租车设定：</strong>
                    <span>本公司: </span>
                    <input type="text" id="yn-quick-company" value="IVISION" style="width:85px; font-weight:bold; background:#fafafa;" />
                    <span>拜访客户名: </span>
                    <input type="text" id="yn-quick-customer" value="CMP" placeholder="如: CMP" style="width:95px; font-weight:bold;" />
                    <span>目的说明/项目号: </span>
                    <input type="text" id="yn-quick-taxi-desc" value="" placeholder="选填：如无需填写可留空" style="width:160px;" />
                    <button class="yn-btn yn-btn-smart" id="yn-btn-smart-commute">✨ 智能推断早晚往返行程</button>
                </div>

                <div class="yn-quick-bar" id="yn-quick-bar-comm" style="display:none;">
                    <strong>📱 通信费设定：</strong>
                    <span>发生年月/期间: </span>
                    <input type="text" id="yn-quick-comm-period" placeholder="自动计算或输入如: 2026-05" style="width:160px;" />
                    <span>目的说明/项目号: </span>
                    <input type="text" id="yn-quick-comm-desc" value="" placeholder="选填：可留空" style="width:160px;" />
                    <button class="yn-btn yn-btn-primary" id="yn-btn-apply-comm">⚡ 应用至勾选行</button>
                </div>

                <div class="yn-table-container">
                    <table class="yn-table" id="yn-records-table">
                        <thead id="yn-table-thead"></thead>
                        <tbody id="yn-table-tbody">
                            <tr>
                                <td colspan="14" style="text-align:center; padding:50px; color:#8c8c8c;">
                                    点击上方【🔄 一键同步待报销数据】自动读取！
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="yn-footer">
                <div class="yn-progress-bar-wrap" id="yn-progress-wrap">
                    <div class="yn-progress-bar">
                        <div class="yn-progress-inner" id="yn-progress-inner"></div>
                    </div>
                    <div class="yn-log-box" id="yn-log-text">准备就绪</div>
                </div>
                <div style="margin-left:auto; display:flex; gap:10px;">
                    <button class="yn-btn" id="yn-btn-cancel-modal">关闭</button>
                    <button class="yn-btn yn-btn-success" id="yn-btn-batch-save" style="font-weight:600; padding:6px 22px;">
                        🚀 批量校验并保存为有效明细
                    </button>
                </div>
            </div>
        `;
        }
        return { btn, modal, mask };
    }

    // ==========================================
    // 1. 全局状态单例
    // ==========================================
    const STATE = {
        pageMode: 'UNKNOWN',
        loginToken: '',
        ecsToken: '',
        userOrigin: 'https://ync37.yuanian.com',
        appId: 'e3d5e4787ff911e88b1997bee3518b4d',
        menuId: '11eedb8f8a31cd8f8a25f721e03d0caa',
        eicds: '',
        v: '',
        applicantId: '11eee047a80566bca18367ceb209b2e1',
        // 模式 A: 发票夹与费用记录数据
        invoices: [],
        activeGroup: 'TAXI',
        selectedIndices: new Set(),
        // 模式 B: 经费报销单数据
        currentBillMainId: '',
        currentBillData: null,
        currentBillDefineTemplate: null,
        billRows: [],
        billTags: new Map(),
        activeBillTag: '',
        billSelectedIndices: new Set(),
        projectSearchResults: [],
        selectedAccount: { value: '03561d1db6a345af7f1906ec05cc0000', title: '项目预算' },
        selectedCostCenter: { value: '0356194b8b3de1653e55bb00bc610000', title: 'IT服务G-安全咨询BU(制造)' },
        selectedProject: null,
        selectedKhfd: { value: '6b8ff07f9ebe11e88b7247d35c1e5077', title: '是(YES)' },
        isProcessing: false
    };
    // ==========================================
    // 2. 页面模式识别与白名单检测
    // ==========================================
    function detectPageMode() {
        const url = window.location.href;
        const decodedUrl = decodeURIComponent(url);
        // 1. 【经费报销单页】特征检测
        const isBillPage = (decodedUrl.includes('menuName=经费报销单') ||
            decodedUrl.includes('menuName=报销单') ||
            url.includes('menuId=11eedb8f8a31cd8f8a25f721e03d0caa') ||
            url.includes('menuId=68c5b963240677b2a836195d3b50e84e') ||
            url.includes('#billWrite') ||
            url.includes('billMainId=') ||
            url.includes('boDefineCode=FYBX') ||
            url.includes('billTypeCode=FYBX') ||
            Boolean(STATE.currentBillData));
        if (isBillPage)
            return 'BILL';
        // 2. 【发票夹】 iframe 页面特征
        const isInvoicePool = (url.includes('#businessapplication') ||
            url.includes('5f0971df7a4411e9b0edd9fcadd69462') ||
            decodedUrl.includes('menuName=发票夹') ||
            url.includes('11ec6dd3fd5cb161bff83bb033997150'));
        if (isInvoicePool)
            return 'POOL';
        // 3. 【费用记录】 iframe 页面特征
        const isExpenseRecord = (url.includes('#expenserecord') ||
            decodedUrl.includes('menuName=费用记录') ||
            url.includes('56dd4bb8a5bf11e8a1a1d174f439477e'));
        if (isExpenseRecord)
            return 'EXPENSE';
        return 'UNKNOWN';
    }
    function extractUrlParams() {
        const full = window.location.href;
        const qIndex = full.indexOf('?');
        if (qIndex !== -1) {
            const query = full.substring(qIndex + 1);
            const params = new URLSearchParams(query);
            if (params.get('TOKEN') && !STATE.loginToken) {
                STATE.loginToken = params.get('TOKEN') || '';
            }
            if (params.get('appId'))
                STATE.appId = params.get('appId') || STATE.appId;
            if (params.get('menuId'))
                STATE.menuId = params.get('menuId') || STATE.menuId;
            if (params.get('billMainId'))
                STATE.currentBillMainId = params.get('billMainId') || STATE.currentBillMainId;
        }
    }
    function updateTokenStatus() {
        const btnBadge = document.querySelector('#yn-batch-helper-btn .yn-badge');
        if (btnBadge)
            btnBadge.className = `yn-badge ${STATE.loginToken ? '' : 'offline'}`;
        const indicator = document.getElementById('yn-token-indicator');
        if (indicator) {
            indicator.style.color = STATE.loginToken ? '#52c41a' : '#ff4d4f';
            indicator.innerHTML = STATE.loginToken ? '● Token 已就绪' : '○ 正在等待 Token';
        }
    }
    // ==========================================
    // 3. 自动拦截与捕获网络请求 / 报销单数据
    // ==========================================
    function initInterceptor() {
        extractUrlParams();
        STATE.loginToken = STATE.loginToken || sessionStorage.getItem('LoginToken') || localStorage.getItem('LoginToken') || sessionStorage.getItem('token') || '';
        STATE.ecsToken = sessionStorage.getItem('EcsToken') || localStorage.getItem('EcsToken') || '';
        const captureHeaders = (headers) => {
            if (!headers)
                return;
            const getH = (k) => headers[k] || headers[k.toLowerCase()] || '';
            if (getH('LoginToken'))
                STATE.loginToken = getH('LoginToken');
            if (getH('EcsToken'))
                STATE.ecsToken = getH('EcsToken');
            if (getH('UserOrigin'))
                STATE.userOrigin = getH('UserOrigin');
            if (getH('appid'))
                STATE.appId = getH('appid');
            if (getH('menuid'))
                STATE.menuId = getH('menuid');
            if (getH('eicds'))
                STATE.eicds = getH('eicds');
            if (getH('v'))
                STATE.v = getH('v');
            updateTokenStatus();
        };
        const handleInterceptedResponse = (url, jsonText) => {
            try {
                if (url.includes('/fssc/bill/billdata/getBillDataAndTemplateByBillMainId') ||
                    url.includes('/fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange')) {
                    const parsed = JSON.parse(jsonText);
                    if (parsed && parsed.data) {
                        if (parsed.data.billData) {
                            STATE.currentBillData = parsed.data.billData;
                            STATE.currentBillMainId = parsed.data.billData.billMainId || STATE.currentBillMainId;
                        }
                        if (parsed.data.billDefineTemplate) {
                            STATE.currentBillDefineTemplate = parsed.data.billDefineTemplate;
                        }
                        const parsedStructure = parseBillDataStructure(STATE.currentBillData);
                        STATE.billRows = parsedStructure.billRows;
                        STATE.billTags = parsedStructure.billTags;
                        renderBillTable();
                    }
                }
            }
            catch (e) { }
        };
        const rawOpen = XMLHttpRequest.prototype.open;
        const rawSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
        const rawSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._url = url;
            this._headers = {};
            return rawOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
            this._headers[header] = value;
            captureHeaders(this._headers);
            return rawSetRequestHeader.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
            this.addEventListener('load', () => {
                if (this.responseText && this._url) {
                    handleInterceptedResponse(this._url, this.responseText);
                }
            });
            return rawSend.apply(this, arguments);
        };
        const rawFetch = window.fetch;
        window.fetch = async function (...args) {
            try {
                if (args[1] && args[1].headers) {
                    captureHeaders(args[1].headers);
                }
            }
            catch (e) { }
            const resp = await rawFetch.apply(this, args);
            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                if (url && (url.includes('getBillDataAndTemplateByBillMainId') || url.includes('fieldValueChange'))) {
                    const cloned = resp.clone();
                    cloned.text().then(txt => handleInterceptedResponse(url, txt));
                }
            }
            catch (e) { }
            return resp;
        };
    }
    initInterceptor();
    // ==========================================
    // 4. 辅助函数
    // ==========================================
    function normalizeTime(t) {
        if (!t)
            return '';
        const clean = t.toString().trim();
        const parts = clean.split(':');
        if (parts.length >= 2) {
            return `${parts[0].trim().padStart(2, '0')}:${parts[1].trim().padStart(2, '0')}`;
        }
        return clean;
    }
    function computePeriod(dateStr, isCommunication = false) {
        if (!dateStr)
            return '';
        const cleanDate = normalizeDate(dateStr);
        if (cleanDate.length >= 7) {
            const parts = cleanDate.split('-');
            let year = parseInt(parts[0], 10);
            let month = parseInt(parts[1], 10);
            if (isCommunication) {
                month -= 1;
                if (month < 1) {
                    month = 12;
                    year -= 1;
                }
            }
            return `${year}-${String(month).padStart(2, '0')}`;
        }
        return '';
    }
    function detectInvoiceType(invVO = {}, expenseItem = {}, rowDatas = {}) {
        const seller = (invVO.salesName || invVO.seller || '').toLowerCase();
        const details = (invVO.invoiceDetails || '').toLowerCase();
        const expName = (expenseItem.expenseTypeName || '').toLowerCase();
        const text = `${seller} ${details} ${expName}`;
        const isComm = (expenseItem.expenseTypeId === EXPENSE_TYPES.COMMUNICATION.id) ||
            ['移动', '联通', '电信', '通信', '手机'].some(kw => text.includes(kw));
        return isComm ? 'COMMUNICATION' : 'TAXI';
    }
    function sortInvoices(list) {
        return list.sort((a, b) => {
            const dateA = normalizeDate(a.invoiceDate || '');
            const dateB = normalizeDate(b.invoiceDate || '');
            if (dateA !== dateB)
                return dateA.localeCompare(dateB);
            return normalizeTime(a.timeGetOn).localeCompare(normalizeTime(b.timeGetOn));
        });
    }
    // ==========================================
    // 5. 模式 B: 报销单表格渲染与交互
    // ==========================================
    function autoSelectBillRowsByTag(tag) {
        STATE.billSelectedIndices.clear();
        STATE.billRows.forEach((row, idx) => {
            if (!tag || (row.recDesc && row.recDesc.includes(tag))) {
                STATE.billSelectedIndices.add(idx);
            }
        });
    }
    async function triggerProjectSearch(keyword) {
        const select = document.getElementById('yn-bill-project-select');
        if (!select)
            return;
        select.innerHTML = `<option value="">⏳ 正在检索项目 [${keyword}]...</option>`;
        try {
            const projects = await searchDimProjectApi(keyword, STATE);
            STATE.projectSearchResults = projects;
            select.innerHTML = '';
            if (projects.length === 0) {
                select.innerHTML = `<option value="">未找到匹配项目</option>`;
                STATE.selectedProject = null;
                return;
            }
            projects.forEach((p, pIdx) => {
                const opt = document.createElement('option');
                opt.value = p.id || p.value;
                opt.innerText = `[${p.code}] ${p.title}`;
                if (pIdx === 0)
                    opt.selected = true;
                select.appendChild(opt);
            });
            STATE.selectedProject = {
                value: projects[0].id || projects[0].value,
                title: projects[0].title
            };
        }
        catch (e) {
            select.innerHTML = `<option value="">检索失败: ${e.message}</option>`;
        }
    }
    function renderBillTable() {
        if (STATE.pageMode !== 'BILL')
            return;
        const tbody = document.getElementById('yn-bill-table-tbody');
        const tagContainer = document.getElementById('yn-bill-tags-container');
        const filterInput = document.getElementById('yn-bill-filter-input');
        const thSelectAll = document.getElementById('yn-bill-th-select-all');
        const btnExecute = document.getElementById('yn-bill-btn-batch-execute');
        if (!tbody)
            return;
        // 1. 渲染 TAG 标签云
        if (tagContainer) {
            tagContainer.innerHTML = '';
            const allChip = document.createElement('span');
            allChip.className = `yn-tag-chip ${STATE.activeBillTag === '' ? 'active' : ''}`;
            allChip.innerHTML = `🏷️ 全部 <span class="yn-tag-count">${STATE.billRows.length}</span>`;
            allChip.addEventListener('click', () => {
                STATE.activeBillTag = '';
                if (filterInput)
                    filterInput.value = '';
                autoSelectBillRowsByTag('');
                renderBillTable();
            });
            tagContainer.appendChild(allChip);
            STATE.billTags.forEach((cnt, tag) => {
                const chip = document.createElement('span');
                chip.className = `yn-tag-chip ${STATE.activeBillTag === tag ? 'active' : ''}`;
                chip.innerHTML = `🏷️ ${tag} <span class="yn-tag-count">${cnt}</span>`;
                chip.addEventListener('click', async () => {
                    STATE.activeBillTag = tag;
                    if (filterInput)
                        filterInput.value = tag;
                    autoSelectBillRowsByTag(tag);
                    const pSearch = document.getElementById('yn-bill-project-search');
                    if (pSearch)
                        pSearch.value = tag;
                    await triggerProjectSearch(tag);
                    renderBillTable();
                });
                tagContainer.appendChild(chip);
            });
        }
        // 2. 渲染明细表格行
        if (STATE.billRows.length === 0) {
            tbody.innerHTML = `
            <tr>
                <td colspan="12" style="text-align:center; padding:50px; color:#8c8c8c;">
                    未读取到当前报销单中的费用明细。请点击右下方【🔄 刷新报销单】！
                </td>
            </tr>
        `;
            return;
        }
        tbody.innerHTML = '';
        let selectedCount = 0;
        const targetAccountTitle = STATE.selectedAccount ? STATE.selectedAccount.title : '项目预算';
        const targetProjTitle = STATE.selectedProject ? STATE.selectedProject.title : '';
        const targetKhfdTitle = STATE.selectedKhfd ? STATE.selectedKhfd.title : '是(YES)';
        STATE.billRows.forEach((row, idx) => {
            const isSelected = STATE.billSelectedIndices.has(idx);
            if (isSelected)
                selectedCount++;
            const tr = document.createElement('tr');
            if (isSelected)
                tr.className = 'selected';
            const previewTarget = isSelected ? `
            <div style="font-size:11.5px;">
                <span style="color:#1890ff; font-weight:600;">[${targetAccountTitle}]</span>
                <span style="color:#722ed1; font-weight:600;">${targetProjTitle || (row.curProject || '--')}</span>
                <span style="color:#52c41a; font-weight:600;">[请款: ${targetKhfdTitle}]</span>
            </div>
        ` : `<span style="color:#bfbfbf;">(未勾选修改)</span>`;
            tr.innerHTML = `
            <td style="text-align:center;">
                <input type="checkbox" class="yn-bill-row-check" data-idx="${idx}" ${isSelected ? 'checked' : ''} />
            </td>
            <td style="color:#8c8c8c; text-align:center;">${idx + 1}</td>
            <td style="text-align:center; font-weight:600;">${row.rowNum}</td>
            <td><span style="color:#595959;">${row.expTypeName}</span></td>
            <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(String(row.amount || 0)).toFixed(2)}</span></td>
            <td><strong style="color:${row.recDesc ? '#096dd9' : '#8c8c8c'};">${row.recDesc || '-'}</strong></td>
            <td><span style="color:#595959;">${row.curAccount || '-'}</span></td>
            <td><span style="color:#595959; font-size:11.5px;">${row.curCostCenter || '-'}</span></td>
            <td><span style="color:#595959; font-size:11.5px;">${row.curProject || '-'}</span></td>
            <td style="text-align:center;"><span style="font-weight:600; color:${row.curKhfd === '是' || row.curKhfd.includes('YES') ? '#52c41a' : '#8c8c8c'};">${row.curKhfd || '否'}</span></td>
            <td>${previewTarget}</td>
            <td style="text-align:center;"><span class="yn-status-tag ${row.status === '成功' ? 'yn-status-success' : (row.status === '失败' ? 'yn-status-error' : 'yn-status-pending')}">${row.status || '就绪'}</span></td>
        `;
            tbody.appendChild(tr);
        });
        if (thSelectAll) {
            thSelectAll.checked = STATE.billRows.length > 0 && selectedCount === STATE.billRows.length;
        }
        if (btnExecute) {
            btnExecute.innerText = `🚀 批量修改预算归属并向客户请款 (${selectedCount} 条)`;
        }
        tbody.querySelectorAll('.yn-bill-row-check').forEach(ck => {
            ck.addEventListener('change', (e) => {
                const idx = parseInt(e.target.getAttribute('data-idx'));
                if (e.target.checked)
                    STATE.billSelectedIndices.add(idx);
                else
                    STATE.billSelectedIndices.delete(idx);
                renderBillTable();
            });
        });
    }
    // ==========================================
    // 6. 报销单批量修改执行引擎 (v4.3.0 极速模式)
    // ==========================================
    async function executeBatchBillBudgetUpdate() {
        const targetIndices = Array.from(STATE.billSelectedIndices);
        if (targetIndices.length === 0) {
            alert('请先勾选需要修改预算归属的费用明细行！');
            return;
        }
        if (!STATE.currentBillData && STATE.currentBillMainId) {
            try {
                await fetchBillDataAndTemplateApi(STATE.currentBillMainId, STATE);
            }
            catch (e) {
                alert(`读取报销单数据失败: ${e.message}`);
                return;
            }
        }
        if (!STATE.currentBillData) {
            alert('未获取到报销单完整数据，请在页面刷新或点击右下方【🔄 刷新报销单】！');
            return;
        }
        const isProjBudget = STATE.selectedAccount && STATE.selectedAccount.value === '03561d1db6a345af7f1906ec05cc0000';
        if (isProjBudget && (!STATE.selectedProject || !STATE.selectedProject.value)) {
            alert('当前预算科目为【项目预算】，请先在上方检索并选择目标【项目】！');
            return;
        }
        const accountTitle = STATE.selectedAccount ? STATE.selectedAccount.title : '项目预算';
        const projTitle = STATE.selectedProject ? STATE.selectedProject.title : '(无项目)';
        const costCenterTitle = STATE.selectedCostCenter ? STATE.selectedCostCenter.title : '(未指定成本中心)';
        const khfdTitle = STATE.selectedKhfd ? STATE.selectedKhfd.title : '是(YES)';
        const confirmMsg = `确定要将已勾选的 ${targetIndices.length} 条费用明细批量修改为：\n` +
            `• 预算科目: ${accountTitle}\n` +
            (isProjBudget ? `• 关联项目: ${projTitle}\n` : `• 部门/成本中心: ${costCenterTitle}\n`) +
            `• 向客户请款: ${khfdTitle}\n\n` +
            `⚡ 极速模式: 首行蝴蝶计算 + 内存批量克隆 + 一次性入库\n` +
            `点击【确定】开始执行！`;
        if (!confirm(confirmMsg))
            return;
        const progressWrap = document.getElementById('yn-bill-progress-wrap');
        const progressInner = document.getElementById('yn-bill-progress-inner');
        const logText = document.getElementById('yn-bill-log-text');
        const btnExec = document.getElementById('yn-bill-btn-batch-execute');
        progressWrap.style.display = 'block';
        btnExec.disabled = true;
        btnExec.innerText = `⏳ 极速批量更新中...`;
        const total = targetIndices.length;
        let currentBillData = JSON.parse(JSON.stringify(STATE.currentBillData));
        // 阶段1: 对第1行执行完整蝴蝶效应计算
        const firstRowIdx = targetIndices[0];
        const firstRow = STATE.billRows[firstRowIdx];
        progressInner.style.width = '10%';
        logText.innerText = `[阶段1/3] 首行蝴蝶效应计算: 行 ${firstRow.rowNum} (${firstRow.recDesc || firstRow.expTypeName})...`;
        let refBudgetDatas = null;
        try {
            const claimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];
            const firstClaimRow = claimRows[firstRowIdx];
            if (!firstClaimRow)
                throw new Error(`未找到第 ${firstRowIdx + 1} 行费用明细数据`);
            const bArea = firstClaimRow.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId];
            const bRow = bArea?.rowDatas?.[0];
            const budgetRowId = bRow?.rowId || bRow?.datas?.BILL_ROW_ID?.value || firstRow.budgetRowId;
            if (!budgetRowId)
                throw new Error('首行未找到预算区 RowId');
            // 1a. 修改科目 (DIM_ACCOUNT)
            logText.innerText = `[阶段1/3] 首行蝴蝶效应 ① 修改科目...`;
            let sceneVO = prepareBillSceneVO(currentBillData);
            currentBillData = await changeBillFieldValueApi(BUDGET_CONSTANTS.fields.account.fieldCode, BUDGET_CONSTANTS.fields.account.fieldName, BUDGET_CONSTANTS.fields.account.fieldId, { value: STATE.selectedAccount.value, title: { zh_CN: accountTitle } }, budgetRowId, sceneVO, STATE);
            // 1b. 修改项目 (DIM_PROJECT) 或 部门/成本中心 (F_BM)
            if (isProjBudget && STATE.selectedProject && STATE.selectedProject.value) {
                logText.innerText = `[阶段1/3] 首行蝴蝶效应 ② 修改项目...`;
                sceneVO = prepareBillSceneVO(currentBillData);
                currentBillData = await changeBillFieldValueApi(BUDGET_CONSTANTS.fields.project.fieldCode, BUDGET_CONSTANTS.fields.project.fieldName, BUDGET_CONSTANTS.fields.project.fieldId, { value: STATE.selectedProject.value, title: { zh_CN: STATE.selectedProject.title } }, budgetRowId, sceneVO, STATE);
            }
            else if (!isProjBudget && STATE.selectedCostCenter && STATE.selectedCostCenter.value) {
                logText.innerText = `[阶段1/3] 首行蝴蝶效应 ② 修改成本中心...`;
                sceneVO = prepareBillSceneVO(currentBillData);
                currentBillData = await changeBillFieldValueApi(BUDGET_CONSTANTS.fields.costCenter.fieldCode, BUDGET_CONSTANTS.fields.costCenter.fieldName, BUDGET_CONSTANTS.fields.costCenter.fieldId, { value: STATE.selectedCostCenter.value, title: { zh_CN: costCenterTitle } }, budgetRowId, sceneVO, STATE);
            }
            // 1c. 修改是否向客户请款 (F_KHFD)
            logText.innerText = `[阶段1/3] 首行蝴蝶效应 ③ 修改向客户请款...`;
            sceneVO = prepareBillSceneVO(currentBillData);
            currentBillData = await changeBillFieldValueApi(BUDGET_CONSTANTS.fields.khfd.fieldCode, BUDGET_CONSTANTS.fields.khfd.fieldName, BUDGET_CONSTANTS.fields.khfd.fieldId, { value: STATE.selectedKhfd.value, title: { zh_CN: khfdTitle } }, budgetRowId, sceneVO, STATE);
            const refClaimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];
            const refBudgetRow = refClaimRows[firstRowIdx]?.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId]?.rowDatas?.[0];
            if (!refBudgetRow)
                throw new Error('蝴蝶效应计算后未获取到首行预算区数据');
            refBudgetDatas = refBudgetRow.datas;
            firstRow.curAccount = accountTitle;
            firstRow.curProject = isProjBudget ? (STATE.selectedProject ? STATE.selectedProject.title : '') : '';
            firstRow.curCostCenter = !isProjBudget ? costCenterTitle : (firstRow.curCostCenter || '');
            firstRow.curKhfd = khfdTitle;
            firstRow.status = '成功';
            renderBillTable();
        }
        catch (err) {
            console.error('First row butterfly failed:', err);
            btnExec.disabled = false;
            btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
            alert(`❌ 首行蝴蝶效应计算失败: ${err.message}\n\n请检查网络连接和 Token 状态！`);
            return;
        }
        // 阶段2: 内存批量克隆 (0ms 级)
        progressInner.style.width = '50%';
        logText.innerText = `[阶段2/3] 内存批量克隆: 将首行计算结果写入剩余 ${total - 1} 行...`;
        const CLONE_FIELDS = ['DIM_ACCOUNT', 'DIM_PROJECT', 'DIM_COST_CENTER', 'F_BM', 'F_KHFD', 'F_FYKM', 'BUDGET_DIM'];
        let cloneSuccessCount = 0;
        let cloneFailCount = 0;
        const allClaimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];
        for (let i = 1; i < total; i++) {
            const rowIdx = targetIndices[i];
            const row = STATE.billRows[rowIdx];
            try {
                const claimRow = allClaimRows[rowIdx];
                if (!claimRow)
                    throw new Error(`未找到第 ${rowIdx + 1} 行明细数据`);
                const budgetRow = claimRow.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId]?.rowDatas?.[0];
                if (!budgetRow || !budgetRow.datas)
                    throw new Error('预算区数据结构异常');
                for (const fieldKey of CLONE_FIELDS) {
                    if (refBudgetDatas[fieldKey] !== undefined) {
                        budgetRow.datas[fieldKey] = JSON.parse(JSON.stringify(refBudgetDatas[fieldKey]));
                    }
                }
                row.curAccount = accountTitle;
                row.curProject = isProjBudget ? (STATE.selectedProject ? STATE.selectedProject.title : '') : '';
                row.curCostCenter = !isProjBudget ? costCenterTitle : (row.curCostCenter || '');
                row.curKhfd = khfdTitle;
                row.status = '成功';
                cloneSuccessCount++;
            }
            catch (err) {
                console.error(`Clone failed on row ${row.rowNum}:`, err);
                row.status = '失败';
                cloneFailCount++;
            }
        }
        renderBillTable();
        const successCount = 1 + cloneSuccessCount;
        const failCount = cloneFailCount;
        // 阶段3: 一次性持久化入库保存 (saveBillData)
        progressInner.style.width = '80%';
        logText.innerText = `[阶段3/3] 正在执行整单持久化入库保存 (saveBillData)...`;
        try {
            const savedData = await saveBillDataApi(currentBillData, STATE);
            STATE.currentBillData = savedData;
            const parsed = parseBillDataStructure(savedData);
            STATE.billRows = parsed.billRows;
        }
        catch (saveErr) {
            console.error('saveBillData failed:', saveErr);
            btnExec.disabled = false;
            btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
            renderBillTable();
            alert(`⚠️ 内存计算已完成，但持久化保存失败: ${saveErr.message}\n\n将自动降级为逐行串行模式重试...`);
            await executeBatchBillBudgetUpdateFallback(targetIndices);
            return;
        }
        progressInner.style.width = '100%';
        btnExec.disabled = false;
        btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
        renderBillTable();
        logText.innerText = `⚡ 极速模式完成！成功: ${successCount} 条，失败: ${failCount} 条。`;
        const doReload = confirm(`✅ 极速批量修改并保存成功！\n` +
            `• 成功更新并入库: ${successCount} 条\n` +
            `• 失败: ${failCount} 条\n` +
            `• 模式: 极速 (首行蝴蝶 + 内存克隆 + 一次性入库)\n\n` +
            `数据已成功写入元年数据库！点击【确定】立即刷新页面！`);
        if (doReload) {
            window.location.reload();
        }
    }
    async function executeBatchBillBudgetUpdateFallback(targetIndices) {
        const progressInner = document.getElementById('yn-bill-progress-inner');
        const logText = document.getElementById('yn-bill-log-text');
        const btnExec = document.getElementById('yn-bill-btn-batch-execute');
        btnExec.disabled = true;
        btnExec.innerText = `⏳ 降级串行模式...`;
        const isProjBudget = STATE.selectedAccount && STATE.selectedAccount.value === '03561d1db6a345af7f1906ec05cc0000';
        const accountTitle = STATE.selectedAccount ? STATE.selectedAccount.title : '项目预算';
        const khfdTitle = STATE.selectedKhfd ? STATE.selectedKhfd.title : '是(YES)';
        const costCenterTitle = STATE.selectedCostCenter ? STATE.selectedCostCenter.title : '(未指定成本中心)';
        try {
            await fetchBillDataAndTemplateApi(STATE.currentBillMainId, STATE);
        }
        catch (e) {
            alert(`降级模式: 重新读取报销单失败: ${e.message}`);
            btnExec.disabled = false;
            btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
            return;
        }
        let currentBillData = STATE.currentBillData;
        let successCount = 0;
        let failCount = 0;
        const total = targetIndices.length;
        for (let i = 0; i < total; i++) {
            const rowIdx = targetIndices[i];
            const row = STATE.billRows[rowIdx];
            const percent = Math.round(((i + 1) / total) * 100);
            progressInner.style.width = `${percent}%`;
            logText.innerText = `[降级串行 ${i + 1}/${total}] 正在更新行 ${row.rowNum}...`;
            try {
                const claimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];
                const curClaimRow = claimRows[rowIdx];
                if (!curClaimRow)
                    throw new Error(`未找到第 ${rowIdx + 1} 行数据`);
                const bRow = curClaimRow.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId]?.rowDatas?.[0];
                const budgetRowId = bRow?.rowId || bRow?.datas?.BILL_ROW_ID?.value || row.budgetRowId;
                if (!budgetRowId)
                    throw new Error('未找到预算区 RowId');
                let sceneVO = prepareBillSceneVO(currentBillData);
                currentBillData = await changeBillFieldValueApi(BUDGET_CONSTANTS.fields.account.fieldCode, BUDGET_CONSTANTS.fields.account.fieldName, BUDGET_CONSTANTS.fields.account.fieldId, { value: STATE.selectedAccount.value, title: { zh_CN: accountTitle } }, budgetRowId, sceneVO, STATE);
                if (isProjBudget && STATE.selectedProject?.value) {
                    sceneVO = prepareBillSceneVO(currentBillData);
                    currentBillData = await changeBillFieldValueApi(BUDGET_CONSTANTS.fields.project.fieldCode, BUDGET_CONSTANTS.fields.project.fieldName, BUDGET_CONSTANTS.fields.project.fieldId, { value: STATE.selectedProject.value, title: { zh_CN: STATE.selectedProject.title } }, budgetRowId, sceneVO, STATE);
                }
                else if (!isProjBudget && STATE.selectedCostCenter?.value) {
                    sceneVO = prepareBillSceneVO(currentBillData);
                    currentBillData = await changeBillFieldValueApi(BUDGET_CONSTANTS.fields.costCenter.fieldCode, BUDGET_CONSTANTS.fields.costCenter.fieldName, BUDGET_CONSTANTS.fields.costCenter.fieldId, { value: STATE.selectedCostCenter.value, title: { zh_CN: costCenterTitle } }, budgetRowId, sceneVO, STATE);
                }
                sceneVO = prepareBillSceneVO(currentBillData);
                currentBillData = await changeBillFieldValueApi(BUDGET_CONSTANTS.fields.khfd.fieldCode, BUDGET_CONSTANTS.fields.khfd.fieldName, BUDGET_CONSTANTS.fields.khfd.fieldId, { value: STATE.selectedKhfd.value, title: { zh_CN: khfdTitle } }, budgetRowId, sceneVO, STATE);
                row.status = '成功';
                successCount++;
            }
            catch (err) {
                console.error(`Fallback update failed on row ${row.rowNum}:`, err);
                row.status = '失败';
                failCount++;
            }
            renderBillTable();
        }
        STATE.currentBillData = currentBillData;
        logText.innerText = `降级串行模式: 正在保存...`;
        try {
            const savedData = await saveBillDataApi(currentBillData, STATE);
            STATE.currentBillData = savedData;
            const parsed = parseBillDataStructure(savedData);
            STATE.billRows = parsed.billRows;
        }
        catch (saveErr) {
            alert(`⚠️ 降级模式保存也失败: ${saveErr.message}`);
            btnExec.disabled = false;
            btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
            return;
        }
        btnExec.disabled = false;
        btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
        renderBillTable();
        logText.innerText = `降级串行模式完成！成功: ${successCount} 条，失败: ${failCount} 条。`;
        const doReload = confirm(`✅ 降级串行模式完成！\n成功: ${successCount} 条，失败: ${failCount} 条\n\n点击【确定】刷新页面！`);
        if (doReload)
            window.location.reload();
    }
    // ==========================================
    // 7. 模式 A: 发票夹与费用记录表格渲染与数据流
    // ==========================================
    function executeSmartCommuteInference(showNotice = true) {
        const company = (document.getElementById('yn-quick-company')?.value || 'IVISION').trim();
        const customer = (document.getElementById('yn-quick-customer')?.value || 'CMP').trim();
        const customDesc = (document.getElementById('yn-quick-taxi-desc')?.value || '').trim();
        const visibleIndices = STATE.invoices
            .map((row, idx) => ({ row, idx }))
            .filter(({ row }) => STATE.activeGroup === 'ALL' || row.type === STATE.activeGroup)
            .map(({ idx }) => idx);
        let targetIndices = visibleIndices.filter(idx => STATE.selectedIndices.has(idx));
        if (targetIndices.length === 0)
            targetIndices = visibleIndices;
        const taxiIndices = targetIndices.filter(idx => STATE.invoices[idx] && STATE.invoices[idx].type === 'TAXI');
        if (taxiIndices.length === 0) {
            if (showNotice)
                alert('当前分组下未找到出租车发票！');
            return;
        }
        const dateGroups = {};
        taxiIndices.forEach(idx => {
            const row = STATE.invoices[idx];
            const dt = normalizeDate(row.invoiceDate || '') || '未知日期';
            if (!dateGroups[dt])
                dateGroups[dt] = [];
            dateGroups[dt].push(idx);
        });
        let filledCount = 0;
        const uncertainDates = [];
        Object.keys(dateGroups).forEach(dt => {
            const dayIndices = dateGroups[dt];
            dayIndices.sort((i1, i2) => normalizeTime(STATE.invoices[i1].timeGetOn).localeCompare(normalizeTime(STATE.invoices[i2].timeGetOn)));
            if (dayIndices.length === 2) {
                const idx1 = dayIndices[0];
                const idx2 = dayIndices[1];
                STATE.invoices[idx1].startAddress = company;
                STATE.invoices[idx1].endAddress = customer;
                if (customDesc)
                    STATE.invoices[idx1].description = customDesc;
                STATE.invoices[idx2].startAddress = customer;
                STATE.invoices[idx2].endAddress = company;
                if (customDesc)
                    STATE.invoices[idx2].description = customDesc;
                filledCount += 2;
            }
            else if (dayIndices.length === 1) {
                const idx1 = dayIndices[0];
                const hour = parseInt(normalizeTime(STATE.invoices[idx1].timeGetOn).split(':')[0]) || 0;
                if (hour < 14) {
                    STATE.invoices[idx1].startAddress = company;
                    STATE.invoices[idx1].endAddress = customer;
                }
                else {
                    STATE.invoices[idx1].startAddress = customer;
                    STATE.invoices[idx1].endAddress = company;
                }
                if (customDesc)
                    STATE.invoices[idx1].description = customDesc;
                filledCount += 1;
            }
            else {
                const firstIdx = dayIndices[0];
                const lastIdx = dayIndices[dayIndices.length - 1];
                STATE.invoices[firstIdx].startAddress = company;
                STATE.invoices[firstIdx].endAddress = customer;
                if (customDesc)
                    STATE.invoices[firstIdx].description = customDesc;
                STATE.invoices[lastIdx].startAddress = customer;
                STATE.invoices[lastIdx].endAddress = company;
                if (customDesc)
                    STATE.invoices[lastIdx].description = customDesc;
                for (let k = 1; k < dayIndices.length - 1; k++) {
                    const midIdx = dayIndices[k];
                    STATE.invoices[midIdx].startAddress = '';
                    STATE.invoices[midIdx].endAddress = '';
                    if (customDesc)
                        STATE.invoices[midIdx].description = customDesc;
                }
                filledCount += 2;
                uncertainDates.push(dt);
            }
        });
        renderInvoiceTable();
        if (showNotice) {
            let msg = `✅ 智能推断完成！已自动为 ${filledCount} 条出租车行程填入往返地点：\n` +
                `• 公司基准: ${company}\n• 拜访客户: ${customer}\n` +
                `• 行程规则: 当天第1程【${company} ➔ ${customer}】，第2程【${customer} ➔ ${company}】`;
            if (uncertainDates.length > 0) {
                msg += `\n\n⚠️ 注意：以下日期包含 3 笔以上打车记录，中间行程已留空：\n${uncertainDates.join(', ')}`;
            }
            alert(msg);
        }
    }
    async function fetchAllPendingData() {
        const btnFetch = document.getElementById('yn-btn-fetch-all');
        const originalText = btnFetch ? btnFetch.innerText : '';
        if (btnFetch) {
            btnFetch.disabled = true;
            btnFetch.innerText = '⏳ 正在全量同步发票夹与费用记录...';
        }
        try {
            const loaded = [];
            const processedRecordIds = new Set();
            const processedInvoiceDataIds = new Set();
            const processedInvoiceNos = new Set();
            const poolList = await queryInvoicePoolListApi(STATE);
            const poolInvoices = await mapConcurrent(poolList, 8, async (pItem) => {
                const dataId = pItem.boSourceRowId || (pItem.datas && pItem.datas.ID ? pItem.datas.ID.value : '');
                if (!dataId)
                    return null;
                try {
                    const invDetail = await getInvoiceDetailByDataIdApi(dataId, STATE);
                    return { dataId, invDetail, pItem };
                }
                catch (e) {
                    return null;
                }
            });
            const invoiceOcrMap = new Map();
            poolInvoices.forEach(item => {
                if (!item || !item.invDetail)
                    return;
                const inv = item.invDetail;
                if (inv.invoiceNo)
                    invoiceOcrMap.set(inv.invoiceNo, inv);
                if (item.dataId)
                    invoiceOcrMap.set(item.dataId, inv);
                if (inv.invoiceDate && inv.amountTax !== undefined) {
                    invoiceOcrMap.set(`${normalizeDate(inv.invoiceDate)}_${inv.amountTax}`, inv);
                }
            });
            const recordList = await queryExpenseRecordListApi(STATE);
            const parsedRecords = await mapConcurrent(recordList, 8, async (item) => {
                const recId = item.expenseRecordId;
                if (!recId)
                    return null;
                try {
                    const ruleData = await getExpenseTypeRuleAndRowDatasApi(recId, item.expenseTypeId || 'UNIDENTIFIED', STATE);
                    const rowDatas = ruleData.rowDatas || {};
                    const v = ruleData.version || 1;
                    let invVO = {};
                    const invListField = rowDatas.expenseRecordInvoiceList;
                    if (invListField && invListField.value && invListField.value.length > 0) {
                        invVO = invListField.value[0].invoiceVO || {};
                    }
                    let matchedInv = null;
                    if (invVO.invoiceNo && invoiceOcrMap.has(invVO.invoiceNo))
                        matchedInv = invoiceOcrMap.get(invVO.invoiceNo);
                    else if (invVO.invoiceDataId && invoiceOcrMap.has(invVO.invoiceDataId))
                        matchedInv = invoiceOcrMap.get(invVO.invoiceDataId);
                    else if (item.businessDate && item.amountObj) {
                        const key = `${normalizeDate(item.businessDate)}_${item.amountObj.amount}`;
                        if (invoiceOcrMap.has(key))
                            matchedInv = invoiceOcrMap.get(key);
                    }
                    if (matchedInv) {
                        if (!invVO.timeGetOn && matchedInv.timeGetOn)
                            invVO.timeGetOn = matchedInv.timeGetOn;
                        if (!invVO.timeGetOff && matchedInv.timeGetOff)
                            invVO.timeGetOff = matchedInv.timeGetOff;
                        if (!invVO.mileage && matchedInv.mileage)
                            invVO.mileage = matchedInv.mileage;
                        if (!invVO.salesName && (matchedInv.salesName || matchedInv.seller))
                            invVO.salesName = matchedInv.salesName || matchedInv.seller;
                        if (!invVO.seller && (matchedInv.seller || matchedInv.salesName))
                            invVO.seller = matchedInv.seller || matchedInv.salesName;
                        if (!invVO.invoiceNo && matchedInv.invoiceNo)
                            invVO.invoiceNo = matchedInv.invoiceNo;
                        if (!invVO.invoiceCode && matchedInv.invoiceCode)
                            invVO.invoiceCode = matchedInv.invoiceCode;
                        if (matchedInv.invoiceDataId)
                            invVO.invoiceDataId = matchedInv.invoiceDataId;
                    }
                    let attachList = [];
                    if (rowDatas.expenseRecordAttachmentList && rowDatas.expenseRecordAttachmentList.value) {
                        attachList = rowDatas.expenseRecordAttachmentList.value;
                    }
                    const type = detectInvoiceType(invVO, item, rowDatas);
                    const isComm = type === 'COMMUNICATION';
                    const rawDate = invVO.invoiceDate || (item.businessDate ? item.businessDate.split(' ')[0] : '');
                    const invDate = normalizeDate(rawDate);
                    const amt = item.amountObj ? item.amountObj.amount : (invVO.amountTax || 0);
                    let cleanPeriod = '';
                    const existingPeriod = (rowDatas.F_ZY_DEF_001 ? rowDatas.F_ZY_DEF_001.value : '').replace(/^期间[：:]\s*/, '').trim();
                    cleanPeriod = (existingPeriod && existingPeriod.length === 7) ? existingPeriod : computePeriod(invDate, isComm);
                    return {
                        expenseRecordId: recId,
                        version: v,
                        invoiceVO: invVO,
                        invoiceNo: invVO.invoiceNo || '',
                        invoiceCode: invVO.invoiceCode || '',
                        invoiceDate: invDate,
                        timeGetOn: normalizeTime(invVO.timeGetOn),
                        timeGetOff: normalizeTime(invVO.timeGetOff),
                        mileage: invVO.mileage ? `${invVO.mileage}km` : '',
                        amount: amt,
                        type: type,
                        startAddress: rowDatas.START_ADDRESS ? (rowDatas.START_ADDRESS.value || '') : '',
                        endAddress: rowDatas.END_ADDRESS ? (rowDatas.END_ADDRESS.value || '') : '',
                        description: item.description || (rowDatas.DESCRIPTION ? rowDatas.DESCRIPTION.value || '' : ''),
                        period: cleanPeriod,
                        attachments: attachList,
                        status: (item.expenseTypeName && item.expenseTypeName !== 'None') ? '成功' : '就绪'
                    };
                }
                catch (e) {
                    const invDate = normalizeDate(item.businessDate ? item.businessDate.split(' ')[0] : '');
                    return {
                        expenseRecordId: recId,
                        version: item.version || 1,
                        invoiceVO: {},
                        invoiceNo: '',
                        invoiceCode: '',
                        invoiceDate: invDate,
                        timeGetOn: '',
                        timeGetOff: '',
                        mileage: '',
                        amount: item.amountObj ? item.amountObj.amount : 0,
                        type: 'TAXI',
                        startAddress: '',
                        endAddress: '',
                        description: item.description || '',
                        period: computePeriod(invDate, false),
                        attachments: [],
                        status: '就绪'
                    };
                }
            });
            parsedRecords.forEach(r => {
                if (r) {
                    loaded.push(r);
                    if (r.expenseRecordId)
                        processedRecordIds.add(r.expenseRecordId);
                    if (r.invoiceVO && r.invoiceVO.invoiceDataId)
                        processedInvoiceDataIds.add(r.invoiceVO.invoiceDataId);
                    if (r.invoiceNo)
                        processedInvoiceNos.add(r.invoiceNo);
                }
            });
            poolInvoices.forEach(item => {
                if (!item || !item.invDetail)
                    return;
                const invDetail = item.invDetail;
                const dataId = item.dataId;
                const invNo = invDetail.invoiceNo || '';
                if (processedInvoiceDataIds.has(dataId) || (invNo && processedInvoiceNos.has(invNo)))
                    return;
                const invDate = normalizeDate(invDetail.invoiceDate || '');
                const amt = invDetail.amountTax !== undefined ? invDetail.amountTax : 0;
                const type = detectInvoiceType(invDetail, {}, {});
                const isComm = type === 'COMMUNICATION';
                loaded.push({
                    expenseRecordId: '',
                    version: 1,
                    boDataId: dataId,
                    invoiceVO: invDetail,
                    invoiceNo: invNo,
                    invoiceCode: invDetail.invoiceCode || '',
                    invoiceDate: invDate,
                    timeGetOn: normalizeTime(invDetail.timeGetOn),
                    timeGetOff: normalizeTime(invDetail.timeGetOff),
                    mileage: invDetail.mileage ? `${invDetail.mileage}km` : '',
                    amount: amt,
                    type: type,
                    startAddress: '',
                    endAddress: '',
                    description: '',
                    period: computePeriod(invDate, isComm),
                    attachments: [],
                    status: '待流转'
                });
            });
            STATE.invoices = sortInvoices(loaded);
            STATE.selectedIndices.clear();
            STATE.invoices.forEach((_, idx) => STATE.selectedIndices.add(idx));
            executeSmartCommuteInference(false);
            renderInvoiceTable();
            alert(`✅ 成功同步全部 ${STATE.invoices.length} 笔待报销记录！已全量补全乘车时间与里程。`);
        }
        catch (err) {
            alert(`同步失败: ${err.message}`);
        }
        finally {
            if (btnFetch) {
                btnFetch.disabled = false;
                btnFetch.innerText = originalText;
            }
        }
    }
    function renderInvoiceTable() {
        if (STATE.pageMode === 'BILL')
            return;
        const thead = document.getElementById('yn-table-thead');
        const tbody = document.getElementById('yn-table-tbody');
        const countInfo = document.getElementById('yn-select-count-info');
        const btnSave = document.getElementById('yn-btn-batch-save');
        const grp = STATE.activeGroup;
        if (!thead || !tbody)
            return;
        const taxiCount = STATE.invoices.filter(r => r.type === 'TAXI').length;
        const commCount = STATE.invoices.filter(r => r.type === 'COMMUNICATION').length;
        const countTaxiEl = document.getElementById('yn-count-taxi');
        const countCommEl = document.getElementById('yn-count-comm');
        const countAllEl = document.getElementById('yn-count-all');
        if (countTaxiEl)
            countTaxiEl.innerText = String(taxiCount);
        if (countCommEl)
            countCommEl.innerText = String(commCount);
        if (countAllEl)
            countAllEl.innerText = String(STATE.invoices.length);
        const visibleIndices = [];
        STATE.invoices.forEach((row, idx) => {
            if (grp === 'ALL' || row.type === grp)
                visibleIndices.push(idx);
        });
        let selectedInView = 0;
        visibleIndices.forEach(idx => {
            if (STATE.selectedIndices.has(idx))
                selectedInView++;
        });
        const grpName = grp === 'TAXI' ? '出租车' : (grp === 'COMMUNICATION' ? '通信费' : '全部');
        if (countInfo)
            countInfo.innerText = `当前【${grpName}】已勾选 ${selectedInView} / ${visibleIndices.length} 行 (总计 ${STATE.invoices.length} 笔)`;
        if (btnSave)
            btnSave.innerText = `🚀 批量保存当前【${grpName}】已勾选记录 (${selectedInView} 条)`;
        if (grp === 'TAXI') {
            thead.innerHTML = `
            <tr>
                <th style="width:36px; text-align:center;"><input type="checkbox" id="yn-th-select-all" /></th>
                <th style="width:36px;">#</th>
                <th style="width:105px;">报销分类</th>
                <th style="width:90px;">发票日期</th>
                <th style="width:145px;">乘车时间 (上车 ~ 下车)</th>
                <th style="width:65px;">里程</th>
                <th style="width:70px;">金额</th>
                <th style="width:115px;">出发地</th>
                <th style="width:32px; text-align:center;"></th>
                <th style="width:115px;">到达地</th>
                <th style="width:125px;">目的说明(选填)</th>
                <th style="width:90px;">发票号码</th>
                <th style="width:55px; text-align:center;">状态</th>
            </tr>
        `;
        }
        else if (grp === 'COMMUNICATION') {
            thead.innerHTML = `
            <tr>
                <th style="width:36px; text-align:center;"><input type="checkbox" id="yn-th-select-all" /></th>
                <th style="width:36px;">#</th>
                <th style="width:105px;">报销分类</th>
                <th style="width:90px;">发票日期</th>
                <th style="width:75px;">金额</th>
                <th style="width:120px;">发生年月 / 期间</th>
                <th style="width:130px;">目的说明(选填)</th>
                <th style="width:180px;">账单 PDF 附件</th>
                <th style="width:90px;">发票号码</th>
                <th style="width:55px; text-align:center;">状态</th>
            </tr>
        `;
        }
        else {
            thead.innerHTML = `
            <tr>
                <th style="width:36px; text-align:center;"><input type="checkbox" id="yn-th-select-all" /></th>
                <th style="width:36px;">#</th>
                <th style="width:105px;">报销分类</th>
                <th style="width:90px;">发票日期</th>
                <th style="width:130px;">乘车时间</th>
                <th style="width:70px;">金额</th>
                <th style="width:95px;">出发地</th>
                <th style="width:95px;">到达地</th>
                <th style="width:105px;">目的说明</th>
                <th style="width:100px;">期间年月</th>
                <th style="width:55px; text-align:center;">状态</th>
            </tr>
        `;
        }
        const thSelectAll = document.getElementById('yn-th-select-all');
        if (thSelectAll) {
            thSelectAll.checked = visibleIndices.length > 0 && selectedInView === visibleIndices.length;
            thSelectAll.addEventListener('change', (e) => {
                visibleIndices.forEach(idx => {
                    if (e.target.checked)
                        STATE.selectedIndices.add(idx);
                    else
                        STATE.selectedIndices.delete(idx);
                });
                renderInvoiceTable();
            });
        }
        if (visibleIndices.length === 0) {
            tbody.innerHTML = `<tr><td colspan="14" style="text-align:center; padding:50px; color:#8c8c8c;">当前分类下暂无记录。</td></tr>`;
            return;
        }
        tbody.innerHTML = '';
        visibleIndices.forEach((realIdx, rowNum) => {
            const row = STATE.invoices[realIdx];
            const isSelected = STATE.selectedIndices.has(realIdx);
            const tr = document.createElement('tr');
            if (isSelected)
                tr.className = 'selected';
            const typeSelectorHtml = `
            <select class="yn-type-select ${row.type === 'COMMUNICATION' ? 'type-comm' : 'type-taxi'}" data-idx="${realIdx}" data-field="type">
                <option value="TAXI" ${row.type === 'TAXI' ? 'selected' : ''}>🚕 出租车</option>
                <option value="COMMUNICATION" ${row.type === 'COMMUNICATION' ? 'selected' : ''}>📱 通信费</option>
            </select>
        `;
            if (grp === 'TAXI') {
                tr.innerHTML = `
                <td style="text-align:center;"><input type="checkbox" class="yn-row-check" data-idx="${realIdx}" ${isSelected ? 'checked' : ''} /></td>
                <td style="color:#8c8c8c; text-align:center;">${rowNum + 1}</td>
                <td>${typeSelectorHtml}</td>
                <td><input type="date" data-idx="${realIdx}" data-field="invoiceDate" value="${row.invoiceDate || ''}" style="font-size:11.5px;" /></td>
                <td><div class="yn-time-badge"><span class="yn-time-highlight">${row.timeGetOn || '--:--'}</span> ~ <span class="yn-time-highlight">${row.timeGetOff || '--:--'}</span></div></td>
                <td style="color:#595959; font-size:11.5px; text-align:center;">${row.mileage || '-'}</td>
                <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(String(row.amount || 0)).toFixed(2)}</span></td>
                <td><input type="text" data-idx="${realIdx}" data-field="startAddress" value="${row.startAddress || ''}" placeholder="如: IVISION" /></td>
                <td style="text-align:center;"><button class="yn-swap-btn" data-idx="${realIdx}">⇄</button></td>
                <td><input type="text" data-idx="${realIdx}" data-field="endAddress" value="${row.endAddress || ''}" placeholder="如: CMP" /></td>
                <td><input type="text" data-idx="${realIdx}" data-field="description" value="${row.description || ''}" placeholder="选填" /></td>
                <td><span style="font-family:monospace; color:#595959; font-size:11px;">${row.invoiceNo || '-'}</span></td>
                <td style="text-align:center;"><span class="yn-status-tag ${row.status === '成功' ? 'yn-status-success' : (row.status === '失败' ? 'yn-status-error' : 'yn-status-pending')}">${row.status || '就绪'}</span></td>
            `;
            }
            else if (grp === 'COMMUNICATION') {
                tr.innerHTML = `
                <td style="text-align:center;"><input type="checkbox" class="yn-row-check" data-idx="${realIdx}" ${isSelected ? 'checked' : ''} /></td>
                <td style="text-align:center; color:#8c8c8c;">${rowNum + 1}</td>
                <td>${typeSelectorHtml}</td>
                <td><input type="date" data-idx="${realIdx}" data-field="invoiceDate" value="${row.invoiceDate || ''}" style="font-size:11.5px;" /></td>
                <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(String(row.amount || 0)).toFixed(2)}</span></td>
                <td><input type="text" data-idx="${realIdx}" data-field="period" value="${row.period || ''}" placeholder="如: 2026-05" /></td>
                <td><input type="text" data-idx="${realIdx}" data-field="description" value="${row.description || ''}" placeholder="选填" /></td>
                <td><div class="yn-dropzone" data-idx="${realIdx}"><span class="yn-dropzone-prompt">📎 拖入/选择账单PDF</span><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style="display:none;" /></div></td>
                <td><span style="font-family:monospace; color:#595959; font-size:11px;">${row.invoiceNo || '-'}</span></td>
                <td style="text-align:center;"><span class="yn-status-tag ${row.status === '成功' ? 'yn-status-success' : (row.status === '失败' ? 'yn-status-error' : 'yn-status-pending')}">${row.status || '就绪'}</span></td>
            `;
            }
            else {
                tr.innerHTML = `
                <td style="text-align:center;"><input type="checkbox" class="yn-row-check" data-idx="${realIdx}" ${isSelected ? 'checked' : ''} /></td>
                <td style="text-align:center; color:#8c8c8c;">${rowNum + 1}</td>
                <td>${typeSelectorHtml}</td>
                <td><input type="date" data-idx="${realIdx}" data-field="invoiceDate" value="${row.invoiceDate || ''}" style="font-size:11px;" /></td>
                <td><div class="yn-time-badge">${row.timeGetOn || '-'} ~ ${row.timeGetOff || '-'}</div></td>
                <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(String(row.amount || 0)).toFixed(2)}</span></td>
                <td><input type="text" data-idx="${realIdx}" data-field="startAddress" value="${row.startAddress || ''}" ${row.type !== 'TAXI' ? 'disabled' : ''} /></td>
                <td><input type="text" data-idx="${realIdx}" data-field="endAddress" value="${row.endAddress || ''}" ${row.type !== 'TAXI' ? 'disabled' : ''} /></td>
                <td><input type="text" data-idx="${realIdx}" data-field="description" value="${row.description || ''}" /></td>
                <td><input type="text" data-idx="${realIdx}" data-field="period" value="${row.period || ''}" /></td>
                <td style="text-align:center;"><span class="yn-status-tag ${row.status === '成功' ? 'yn-status-success' : (row.status === '失败' ? 'yn-status-error' : 'yn-status-pending')}">${row.status || '就绪'}</span></td>
            `;
            }
            tbody.appendChild(tr);
        });
        tbody.querySelectorAll('.yn-row-check').forEach(ck => {
            ck.addEventListener('change', (e) => {
                const idx = parseInt(e.target.getAttribute('data-idx'));
                if (e.target.checked)
                    STATE.selectedIndices.add(idx);
                else
                    STATE.selectedIndices.delete(idx);
                renderInvoiceTable();
            });
        });
        tbody.querySelectorAll('.yn-swap-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.getAttribute('data-idx'));
                if (!isNaN(idx) && STATE.invoices[idx]) {
                    const temp = STATE.invoices[idx].startAddress;
                    STATE.invoices[idx].startAddress = STATE.invoices[idx].endAddress;
                    STATE.invoices[idx].endAddress = temp;
                    renderInvoiceTable();
                }
            });
        });
        tbody.querySelectorAll('input[data-field], select[data-field]').forEach(el => {
            el.addEventListener('change', (e) => {
                const idx = parseInt(e.target.getAttribute('data-idx'));
                const field = e.target.getAttribute('data-field');
                if (field && !isNaN(idx) && STATE.invoices[idx]) {
                    STATE.invoices[idx][field] = e.target.value;
                    if (field === 'type') {
                        const isComm = e.target.value === 'COMMUNICATION';
                        STATE.invoices[idx].period = computePeriod(STATE.invoices[idx].invoiceDate || '', isComm);
                        if (!isComm && !STATE.invoices[idx].startAddress)
                            STATE.invoices[idx].startAddress = 'IVISION';
                        if (!isComm && !STATE.invoices[idx].endAddress)
                            STATE.invoices[idx].endAddress = 'CMP';
                        renderInvoiceTable();
                    }
                }
            });
        });
    }
    async function executeBatchSave() {
        const grp = STATE.activeGroup;
        const visibleIndices = STATE.invoices
            .map((row, idx) => ({ row, idx }))
            .filter(({ row }) => grp === 'ALL' || row.type === grp)
            .map(({ idx }) => idx);
        const targetIndices = visibleIndices.filter(idx => STATE.selectedIndices.has(idx));
        if (targetIndices.length === 0) {
            alert('请先在表格左侧勾选需要保存的发票行。');
            return;
        }
        const progressWrap = document.getElementById('yn-progress-wrap');
        const progressInner = document.getElementById('yn-progress-inner');
        const logText = document.getElementById('yn-log-text');
        const btnSave = document.getElementById('yn-btn-batch-save');
        progressWrap.style.display = 'block';
        btnSave.disabled = true;
        btnSave.innerText = '⏳ 正在保存中...';
        let successCount = 0;
        let failCount = 0;
        const total = targetIndices.length;
        for (let i = 0; i < total; i++) {
            const rowIdx = targetIndices[i];
            const row = STATE.invoices[rowIdx];
            const percent = Math.round(((i + 1) / total) * 100);
            progressInner.style.width = `${percent}%`;
            logText.innerText = `[${i + 1}/${total}] 正在保存: ${row.invoiceNo || '第' + (rowIdx + 1) + '行'}...`;
            try {
                const targetExpenseTypeConfig = row.type === 'COMMUNICATION' ? EXPENSE_TYPES.COMMUNICATION : EXPENSE_TYPES.TAXI;
                let recordId = row.expenseRecordId;
                if (!recordId) {
                    recordId = await createDraftExpenseRecordFromInvoiceApi(row.invoiceVO, row.boDataId || row.invoiceVO?.invoiceDataId, STATE);
                    row.expenseRecordId = recordId;
                }
                const ruleData = await getExpenseTypeRuleAndRowDatasApi(recordId, 'UNIDENTIFIED', STATE);
                const version = ruleData.version !== undefined ? ruleData.version : 1;
                const baseRowDatas = ruleData.rowDatas || {};
                const initData = await initExpenseRecordWithTypeApi(recordId, targetExpenseTypeConfig.id, baseRowDatas, STATE);
                const rowDatas = initData.rowDatas || {};
                const cleanPeriod = (row.period || computePeriod(row.invoiceDate || '', row.type === 'COMMUNICATION')).replace(/^期间[：:]\s*/, '').trim();
                if (row.type === 'TAXI') {
                    if (rowDatas.START_ADDRESS)
                        rowDatas.START_ADDRESS.value = row.startAddress || 'IVISION';
                    if (rowDatas.END_ADDRESS)
                        rowDatas.END_ADDRESS.value = row.endAddress || 'CMP';
                    if (rowDatas.DESCRIPTION)
                        rowDatas.DESCRIPTION.value = row.description ? row.description.trim() : '';
                    if (rowDatas.F_ZY_DEF_001)
                        rowDatas.F_ZY_DEF_001.value = cleanPeriod;
                }
                else if (row.type === 'COMMUNICATION') {
                    const yyyy_mm = cleanPeriod.length >= 7 ? cleanPeriod.substring(0, 7) : computePeriod(row.invoiceDate || '', true);
                    if (rowDatas.FLIGHT_START_DATE)
                        rowDatas.FLIGHT_START_DATE.value = `${yyyy_mm}-01 00:00:00`;
                    if (rowDatas.F_ZY_DEF_001)
                        rowDatas.F_ZY_DEF_001.value = yyyy_mm;
                    if (rowDatas.DESCRIPTION)
                        rowDatas.DESCRIPTION.value = row.description ? row.description.trim() : '';
                    if (row.attachments && row.attachments.length > 0) {
                        rowDatas.expenseRecordAttachmentList = { value: row.attachments };
                        const firstAtt = row.attachments[0];
                        if (rowDatas.ATTACH_NAME)
                            rowDatas.ATTACH_NAME.value = (firstAtt.fileName || '账单').replace(/\.[^/.]+$/, "");
                        if (rowDatas.ATTACH_COUNT)
                            rowDatas.ATTACH_COUNT.value = row.attachments.length;
                    }
                }
                await saveFinalExpenseRecordApi(recordId, targetExpenseTypeConfig.id, rowDatas, version, STATE);
                row.status = '成功';
                successCount++;
            }
            catch (err) {
                console.error('Save error on row', rowIdx, err);
                row.status = '失败';
                failCount++;
            }
            renderInvoiceTable();
        }
        btnSave.disabled = false;
        renderInvoiceTable();
        logText.innerText = `处理完成！成功: ${successCount} 条，失败: ${failCount} 条。`;
        alert(`批量处理完成！\n成功: ${successCount} 条\n失败: ${failCount} 条\n已成功保存为有效费用明细！`);
    }
    // ==========================================
    // 8. 事件绑定与初始化挂载
    // ==========================================
    function bindEvents() {
        const btn = document.getElementById('yn-batch-helper-btn');
        const modal = document.getElementById('yn-batch-modal');
        const mask = document.getElementById('yn-modal-mask');
        const closeBtn = document.getElementById('yn-modal-close');
        const cancelBtn = document.getElementById('yn-btn-cancel-modal');
        if (!btn || !modal)
            return;
        const openModal = async () => {
            modal.style.display = 'flex';
            if (mask)
                mask.style.display = 'block';
            updateTokenStatus();
            if (STATE.pageMode === 'BILL') {
                if (STATE.currentBillData) {
                    const parsed = parseBillDataStructure(STATE.currentBillData);
                    STATE.billRows = parsed.billRows;
                    STATE.billTags = parsed.billTags;
                }
                else if (STATE.currentBillMainId) {
                    try {
                        await fetchBillDataAndTemplateApi(STATE.currentBillMainId, STATE);
                    }
                    catch (e) { }
                }
                renderBillTable();
                if (STATE.activeBillTag) {
                    triggerProjectSearch(STATE.activeBillTag);
                }
            }
            else {
                renderInvoiceTable();
            }
        };
        const closeModal = () => {
            modal.style.display = 'none';
            if (mask)
                mask.style.display = 'none';
        };
        btn.addEventListener('click', openModal);
        if (mask)
            mask.addEventListener('click', closeModal);
        if (closeBtn)
            closeBtn.addEventListener('click', closeModal);
        if (cancelBtn)
            cancelBtn.addEventListener('click', closeModal);
        // 报销单模式专用事件
        if (STATE.pageMode === 'BILL') {
            const filterInput = document.getElementById('yn-bill-filter-input');
            const btnApplyFilter = document.getElementById('yn-bill-btn-apply-filter');
            const thSelectAll = document.getElementById('yn-bill-th-select-all');
            const projSearch = document.getElementById('yn-bill-project-search');
            const projSelect = document.getElementById('yn-bill-project-select');
            const accountSelect = document.getElementById('yn-bill-account-select');
            const costCenterSelect = document.getElementById('yn-bill-cost-center-select');
            const khfdSelect = document.getElementById('yn-bill-khfd-select');
            const btnReload = document.getElementById('yn-bill-btn-reload');
            const btnExec = document.getElementById('yn-bill-btn-batch-execute');
            if (accountSelect) {
                accountSelect.addEventListener('change', (e) => {
                    const opt = e.target.selectedOptions[0];
                    STATE.selectedAccount = { value: e.target.value, title: opt ? opt.innerText : '' };
                    renderBillTable();
                });
            }
            if (costCenterSelect) {
                costCenterSelect.addEventListener('change', (e) => {
                    const opt = e.target.selectedOptions[0];
                    STATE.selectedCostCenter = { value: e.target.value, title: opt ? opt.innerText : '' };
                    renderBillTable();
                });
            }
            if (khfdSelect) {
                khfdSelect.addEventListener('change', (e) => {
                    const opt = e.target.selectedOptions[0];
                    STATE.selectedKhfd = { value: e.target.value, title: opt ? opt.innerText : '' };
                    renderBillTable();
                });
            }
            if (btnApplyFilter) {
                btnApplyFilter.addEventListener('click', async () => {
                    const tag = filterInput ? filterInput.value.trim() : '';
                    STATE.activeBillTag = tag;
                    autoSelectBillRowsByTag(tag);
                    if (tag)
                        await triggerProjectSearch(tag);
                    renderBillTable();
                });
            }
            if (thSelectAll) {
                thSelectAll.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        STATE.billRows.forEach((_, idx) => STATE.billSelectedIndices.add(idx));
                    }
                    else {
                        STATE.billSelectedIndices.clear();
                    }
                    renderBillTable();
                });
            }
            let searchTimeout = null;
            if (projSearch) {
                projSearch.addEventListener('input', (e) => {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        triggerProjectSearch(e.target.value);
                    }, 350);
                });
            }
            if (projSelect) {
                projSelect.addEventListener('change', (e) => {
                    const val = e.target.value;
                    const match = STATE.projectSearchResults.find(p => p.id === val || p.value === val);
                    if (match) {
                        STATE.selectedProject = { value: match.id || match.value, title: match.title };
                    }
                    renderBillTable();
                });
            }
            if (btnReload) {
                btnReload.addEventListener('click', async () => {
                    if (STATE.currentBillMainId) {
                        await fetchBillDataAndTemplateApi(STATE.currentBillMainId, STATE);
                        alert('已重新读取报销单最新数据！');
                    }
                    else {
                        alert('未检测到报销单 ID，请在报销单页面操作后重试。');
                    }
                });
            }
            if (btnExec) {
                btnExec.addEventListener('click', executeBatchBillBudgetUpdate);
            }
        }
        else {
            // 发票夹/费用记录模式事件
            document.querySelectorAll('.yn-tab-btn').forEach(tab => {
                tab.addEventListener('click', () => {
                    const grp = tab.getAttribute('data-group');
                    STATE.activeGroup = grp;
                    document.querySelectorAll('.yn-tab-btn').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    const barTaxi = document.getElementById('yn-quick-bar-taxi');
                    const barComm = document.getElementById('yn-quick-bar-comm');
                    if (barTaxi)
                        barTaxi.style.display = (grp === 'TAXI' || grp === 'ALL') ? 'flex' : 'none';
                    if (barComm)
                        barComm.style.display = grp === 'COMMUNICATION' ? 'flex' : 'none';
                    renderInvoiceTable();
                });
            });
            const btnFetch = document.getElementById('yn-btn-fetch-all');
            if (btnFetch)
                btnFetch.addEventListener('click', fetchAllPendingData);
            const btnCommute = document.getElementById('yn-btn-smart-commute');
            if (btnCommute)
                btnCommute.addEventListener('click', () => executeSmartCommuteInference(true));
            const btnSave = document.getElementById('yn-btn-batch-save');
            if (btnSave)
                btnSave.addEventListener('click', executeBatchSave);
        }
    }
    function checkAndMount() {
        const mode = detectPageMode();
        if (mode && mode !== 'UNKNOWN') {
            STATE.pageMode = mode;
            extractUrlParams();
            injectStyles();
            createModalDOM(STATE);
            bindEvents();
            updateTokenStatus();
            console.log(`[IVision FSSC Autopilot v4.3.0] Mounted successfully in [${mode}] mode.`);
        }
    }
    window.addEventListener('DOMContentLoaded', checkAndMount);
    window.addEventListener('hashchange', checkAndMount);
    window.addEventListener('popstate', checkAndMount);
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        checkAndMount();
    }
    // 轮询检查避免 Vue 异步路由渲染遗漏
    setInterval(() => {
        if (!document.getElementById('yn-batch-helper-btn')) {
            checkAndMount();
        }
    }, 1500);

})();
//# sourceMappingURL=iv-fssc-autopilot.dev.user.js.map
