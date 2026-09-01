// ==UserScript==
// @name         IVision FSSC Autopilot (元年云费控极速自动驾驶副驾)
// @namespace    https://github.com/Chris-C1108/iv-fssc-autopilot
// @version      4.4.6
// @description  元年云报销全流程超级副驾：①【发票夹 & 费用记录】全量OCR数据穿透补全(乘车时间/里程100%恢复)、自动识别通信费、自由切换分类、早晚行程智能推断、拖拽多附件；②【经费报销单页】丰富多维菜单Item(科目/项目/成本中心/向客户请款)、自动聚合备注TAG(如X2605-001)、智能检索匹配项目、蝴蝶效应引擎链式联动、一键自动持久化保存(saveBillData)并自动刷新单据视图；③【极速模式】首行蝴蝶+内存克隆+单次入库(30倍提速)。
// @author       Chris-C1108
// @match        https://ync37.yuanian.com/fssc/*
// @match        https://time-mg.huge-vision.com/*
// @noframes
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

    /**
     * 考勤工数管理系统 (time-mg.huge-vision.com) 核心常量定义
     */
    const TIME_MG_CONSTANTS = {
        ORIGIN: 'https://time-mg.huge-vision.com',
        API_PREFIX: '/ivggs/api',
        ENDPOINTS: {
            // 项目工时预实对比表
            EXP_WH_INFO: '/ivggs/api/wh10101/selectExpWHInfo/',
            // 考勤一览明细表
            DETAIL_WH_INFO: '/ivggs/api/wh10101/selectDetailWHInfo',
            // 考勤提交/保存前置校验
            SUBMIT_OR_SAVE_CHECK: '/ivggs/api/wh10101/submitOrSaveCheck',
            // 考勤明细保存/提交
            COMMIT_DETAIL: '/ivggs/api/wh10101/commitDetail',
            // 项目列表弹窗字典
            PROJECT_LIST: '/ivggs/api/pop/pjg/list',
            // 工时试算接口
            ACTUAL_WH: '/ivggs/api/wh10101/getActualWH'
        },
        // 考勤基准工时配置
        DEFAULTS: {
            START_TIME_API: '0900', // API 入参格式 0900
            END_TIME_API: '1730', // API 入参格式 1730
            START_TIME_DISPLAY: '09:00', // 页面展示/回填格式
            END_TIME_DISPLAY: '17:30', // 页面展示/回填格式
            STANDARD_HOURS: 7.5, // 每日标准出勤工时 7.5h
            LUNCH_START: '12:00',
            LUNCH_END: '13:00',
            LOCATION_OUT: '外出', // 办公地点：外出
            LOCATION_OFFICE: '社内', // 办公地点：社内
            FLG_OUT_VALUE: '1' // 外出标志位
        }
    };

    /**
     * 获取当前页面的 CSRF Token
     */
    function getCsrfToken(state) {
        if (state && state.csrfToken)
            return state.csrfToken;
        // 1. 从 meta 标签查找
        const metaCsrf = document.querySelector('meta[name="_csrf"]')?.getAttribute('content') ||
            document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        if (metaCsrf)
            return metaCsrf;
        // 2. 从 Cookie 查找
        const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/i) || document.cookie.match(/_csrf=([^;]+)/i);
        if (match)
            return decodeURIComponent(match[1]);
        // 3. 从页面全局变量或 hidden input 查找
        const inputCsrf = document.querySelector('input[name="_csrf"]')?.value;
        if (inputCsrf)
            return inputCsrf;
        return '';
    }
    /**
     * 封装带 CSRF Token 和凭据的通用 POST 请求
     */
    async function timeMgPost(endpoint, body, state) {
        const csrfToken = getCsrfToken(state);
        const headers = {
            'Content-Type': 'application/json;charset=UTF-8',
            'Accept': 'application/json, text/plain, */*'
        };
        if (csrfToken) {
            headers['X-CSRF-TOKEN'] = csrfToken;
        }
        const url = endpoint.startsWith('http') ? endpoint : `${TIME_MG_CONSTANTS.ORIGIN}${endpoint}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            credentials: 'include'
        });
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} - ${resp.statusText}`);
        }
        const data = await resp.json();
        if (data && data.success === false) {
            const errorMsg = (data.messages && data.messages.length > 0) ? data.messages.join('; ') : (data.message || '请求失败');
            throw new Error(errorMsg);
        }
        return data;
    }
    /**
     * 智能嗅探宿主页面当前正在查看/填报的考勤年月 (优先从 Vue 实例或 DOM 日期选择器读取)
     */
    function detectActiveYearAndMonth() {
        try {
            const allEls = Array.from(document.querySelectorAll('*'));
            for (const el of allEls) {
                const v = el.__vue__;
                // 1. 优先从 AttendanceEdit 组件中的 attendance.ym 读取 (如 "2026/08" 或 "2026-08")
                if (v && v.attendance && typeof v.attendance.ym === 'string' && v.attendance.ym.trim()) {
                    const parts = v.attendance.ym.split(/[-/]/);
                    if (parts.length >= 2) {
                        return {
                            year: parts[0],
                            month: parts[1].padStart(2, '0')
                        };
                    }
                }
                // 2. 从 Handsontable 第一行数据的 ymd 读取 (如 "20260801")
                if (v && v.hotSettings && Array.isArray(v.hotSettings.data) && v.hotSettings.data.length > 0) {
                    const firstYmd = String(v.hotSettings.data[0].ymd || '');
                    if (firstYmd.length >= 6) {
                        return {
                            year: firstYmd.substring(0, 4),
                            month: firstYmd.substring(4, 6)
                        };
                    }
                }
            }
            // 3. 从 DOM 中月份选择器的 input.value 读取 (如 "2026-08")
            const dateInputs = Array.from(document.querySelectorAll('input.el-input__inner, input'));
            for (const input of dateInputs) {
                const val = (input.value || '').trim();
                const m = val.match(/^(\d{4})[-/](\d{1,2})$/);
                if (m) {
                    return {
                        year: m[1],
                        month: m[2].padStart(2, '0')
                    };
                }
            }
        }
        catch (e) { }
        // 4. 兜底回退为当前系统时间
        const now = new Date();
        return {
            year: now.getFullYear().toString(),
            month: String(now.getMonth() + 1).padStart(2, '0')
        };
    }
    /**
     * 1. 查询项目工时预实对比表数据 (优先从 Vue 内存实时获取，网络 API 兜底，严格校验目标年月)
     */
    async function fetchExpWHInfoApi(objY, objM, state) {
        const targetYm = `${String(objY)}${String(objM).padStart(2, '0')}`;
        try {
            const allEls = Array.from(document.querySelectorAll('*'));
            for (const el of allEls) {
                const v = el.__vue__;
                // 严格校验宿主内存中的当前激活月份是否与请求的目标月份完全一致
                const isMatch = (v && v.attendance && v.attendance.ym && v.attendance.ym.replace(/[-/]/g, '') === targetYm) ||
                    (v && v.hotSettings && Array.isArray(v.hotSettings.data) && v.hotSettings.data.length > 0 && String(v.hotSettings.data[0].ymd || '').startsWith(targetYm));
                if (isMatch && Array.isArray(v.expWhs) && v.expWhs.length > 0) {
                    return v.expWhs.map((item) => {
                        const exp = parseFloat(item.expWH || '0');
                        const act = parseFloat(item.workingHours || '0');
                        const remain = Math.max(0, parseFloat((exp - act).toFixed(2)));
                        return {
                            pjNo: item.pjNo || '',
                            name: item.name || '',
                            expWH: item.expWH || '0.00',
                            workingHours: item.workingHours || '0.00',
                            remainWH: remain,
                            pjInfoID: item.pjInfoID || '',
                            pjgID: item.pjgID || null,
                            flgPJG: item.flgPJG || '2',
                            department: item.department || ''
                        };
                    });
                }
            }
        }
        catch (e) { }
        const payload = {
            objY: String(objY),
            objM: String(objM).padStart(2, '0')
        };
        const res = await timeMgPost(TIME_MG_CONSTANTS.ENDPOINTS.EXP_WH_INFO, payload, state);
        const rawList = res?.datas?.searchResult || [];
        return rawList.map(item => {
            const exp = parseFloat(item.expWH || '0');
            const act = parseFloat(item.workingHours || '0');
            const remain = Math.max(0, parseFloat((exp - act).toFixed(2)));
            return {
                pjNo: item.pjNo || '',
                name: item.name || '',
                expWH: item.expWH || '0.00',
                workingHours: item.workingHours || '0.00',
                remainWH: remain,
                pjInfoID: item.pjInfoID || '',
                pjgID: item.pjgID || null,
                flgPJG: item.flgPJG || '2',
                department: item.department || ''
            };
        });
    }
    /**
     * 2. 查询考勤一览明细表数据 (优先从 Vue 内存实时获取，网络 API 兜底，严格校验目标年月)
     */
    async function fetchDetailWHInfoApi(objY, objM, state) {
        const targetYm = `${String(objY)}${String(objM).padStart(2, '0')}`;
        try {
            const allEls = Array.from(document.querySelectorAll('*'));
            for (const el of allEls) {
                const v = el.__vue__;
                // 严格校验宿主内存中的第一行日期是否属于 targetYm
                if (v && v.hotSettings && Array.isArray(v.hotSettings.data) && v.hotSettings.data.length > 0) {
                    const firstYmd = String(v.hotSettings.data[0].ymd || '');
                    if (firstYmd.startsWith(targetYm)) {
                        return v.hotSettings.data.map((item) => ({
                            ymd: item.ymd || '',
                            objYMD: item.objYMD || null,
                            showDate: item.showDate || '',
                            month: item.month || '',
                            date: item.date || '',
                            weekDate: Number(item.weekDate || 0),
                            dtDayType: Number(item.dtDayType || 1),
                            onDutyStatus: String(item.onDutyStatus || '1'),
                            inTime: item.inTime || null,
                            outTime: item.outTime || null,
                            fromDt: item.fromDt || null,
                            toDt: item.toDt || null,
                            timeWH: item.timeWH || null,
                            pjNo: item.pjNo || null,
                            name: item.name || null,
                            flgOut: item.flgOut || null,
                            flgOutShow: item.flgOutShow || null,
                            whFormID: item.whFormID || null,
                            whFormDetailID: item.whFormDetailID || null,
                            dtAppStatus: item.dtAppStatus || null,
                            applyFlowStatus: item.applyFlowStatus || null,
                            department: item.department || null,
                            memo: item.memo || null
                        }));
                    }
                }
            }
        }
        catch (e) { }
        const payload = {
            objY: String(objY),
            objM: String(objM).padStart(2, '0')
        };
        const res = await timeMgPost(TIME_MG_CONSTANTS.ENDPOINTS.DETAIL_WH_INFO, payload, state);
        const rawList = res?.datas?.searchResult || [];
        return rawList.map(item => ({
            ymd: item.ymd || '',
            objYMD: item.objYMD || null,
            showDate: item.showDate || '',
            month: item.month || '',
            date: item.date || '',
            weekDate: Number(item.weekDate || 0),
            dtDayType: Number(item.dtDayType || 1),
            onDutyStatus: String(item.onDutyStatus || '1'),
            inTime: item.inTime || null,
            outTime: item.outTime || null,
            fromDt: item.fromDt || null,
            toDt: item.toDt || null,
            timeWH: item.timeWH || null,
            pjNo: item.pjNo || null,
            name: item.name || null,
            flgOut: item.flgOut || null,
            flgOutShow: item.flgOutShow || null,
            whFormID: item.whFormID || null,
            whFormDetailID: item.whFormDetailID || null,
            dtAppStatus: item.dtAppStatus || null,
            applyFlowStatus: item.applyFlowStatus || null,
            department: item.department || null,
            memo: item.memo || null
        }));
    }

    /**
     * 格式化提取时间字符串 HH:mm:ss 或 HH:mm
     */
    function extractTime(timeStr) {
        if (!timeStr)
            return '';
        const clean = timeStr.trim();
        if (clean.includes(' ')) {
            return clean.split(' ')[1];
        }
        return clean;
    }
    /**
     * 判定工作时间 [09:00, 17:30] 是否完全在进出记录内
     */
    function checkIsOutOfOffice(inTime, outTime) {
        const tIn = extractTime(inTime);
        const tOut = extractTime(outTime);
        if (!tIn && !tOut) {
            return {
                isOut: true,
                locationName: TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT,
                reason: '无门禁进出记录'
            };
        }
        if (!tIn || !tOut) {
            return {
                isOut: true,
                locationName: TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT,
                reason: `门禁打卡单边缺失 (进:${tIn || '-'} 出:${tOut || '-'})`
            };
        }
        const time1 = tIn.length === 5 ? `${tIn}:00` : tIn;
        const time2 = tOut.length === 5 ? `${tOut}:00` : tOut;
        const earliest = time1 < time2 ? time1 : time2;
        const latest = time1 > time2 ? time1 : time2;
        const stdStart = '09:00:00';
        const stdEnd = '17:30:00';
        const isCovered = (earliest <= stdStart) && (latest >= stdEnd);
        if (isCovered) {
            return {
                isOut: false,
                locationName: '公司',
                reason: `门禁全覆盖 (最早 ${earliest.substring(0, 5)} ~ 最晚 ${latest.substring(0, 5)})`
            };
        }
        else {
            const missReasons = [];
            if (earliest > stdStart)
                missReasons.push(`到岗晚于09:00(${earliest.substring(0, 5)})`);
            if (latest < stdEnd)
                missReasons.push(`离岗早于17:30(${latest.substring(0, 5)})`);
            return {
                isOut: true,
                locationName: TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT,
                reason: `打卡未覆盖 (${missReasons.join(', ')})`
            };
        }
    }
    /**
     * 将小时数向下取整到 0.25h (15分钟刻度)，严禁超出预算
     */
    function floorToQuarterHour(hours) {
        return Math.floor((hours + 1e-6) * 4) / 4;
    }
    /**
     * 严格基于 15 分钟刻度 (0.25h) 累加工作时间并跳过 12:00 ~ 13:00 午休
     * 返回格式为 HH:mm，分钟严格保证为 00, 15, 30, 45
     */
    function addWorkingHoursQuantized(startTimeStr, workHours) {
        const quantizedHours = floorToQuarterHour(workHours);
        const [h, m] = startTimeStr.split(':').map(Number);
        let curMin = h * 60 + m;
        let remainingWorkMin = Math.round(quantizedHours * 60);
        const lunchStart = 12 * 60; // 720 分钟 (12:00)
        const lunchEnd = 13 * 60; // 780 分钟 (13:00)
        while (remainingWorkMin > 0) {
            if (curMin >= lunchStart && curMin < lunchEnd) {
                curMin = lunchEnd;
            }
            if (curMin < lunchStart) {
                const availBeforeLunch = lunchStart - curMin;
                if (remainingWorkMin <= availBeforeLunch) {
                    curMin += remainingWorkMin;
                    remainingWorkMin = 0;
                }
                else {
                    remainingWorkMin -= availBeforeLunch;
                    curMin = lunchEnd;
                }
            }
            else {
                curMin += remainingWorkMin;
                remainingWorkMin = 0;
            }
        }
        const endH = String(Math.floor(curMin / 60)).padStart(2, '0');
        const endM = String(curMin % 60).padStart(2, '0');
        return `${endH}:${endM}`;
    }
    /**
     * 考勤工数智能分配引擎 (支持部分工时自动补全7.5h、已有记录保留、严禁超预算0.25h刻度向下量化与零碎集中拼凑)
     */
    function computeProjectAllocationPlan(expProjects, detailDays, allowedOverflowPjNos = []) {
        const stdHours = TIME_MG_CONSTANTS.DEFAULTS.STANDARD_HOURS; // 7.5h
        // 1. 检查各日期是否已有填写记录，并提取已有分段
        const daysByYmd = new Map();
        detailDays.forEach(d => {
            if (!daysByYmd.has(d.ymd))
                daysByYmd.set(d.ymd, []);
            daysByYmd.get(d.ymd).push(d);
        });
        const formatTimeStr = (tStr, defaultVal = '') => {
            if (!tStr)
                return defaultVal;
            const digits = tStr.replace(/[^0-9]/g, '');
            if (digits.length >= 4) {
                return `${digits.substring(0, 2)}:${digits.substring(2, 4)}`;
            }
            if (tStr.includes(':'))
                return tStr.substring(0, 5);
            return defaultVal;
        };
        const existingPlansByYmd = new Map();
        daysByYmd.forEach((items, ymd) => {
            // 筛选出当天已经填写了项目的行 (pjNo 不为空且工时 > 0)
            const filledItems = items.filter(it => Boolean(it.pjNo && it.pjNo.trim().length > 0 && parseFloat(it.timeWH || '0') > 0));
            if (filledItems.length > 0) {
                const plans = filledItems.map((it, idx) => {
                    const sTime = formatTimeStr(it.fromDt || it.startTime, '09:00');
                    const eTime = formatTimeStr(it.toDt || it.endTime, '17:30');
                    const locationCheck = checkIsOutOfOffice(it.inTime, it.outTime);
                    const isOut = it.flgOut === '1' || locationCheck.isOut;
                    return {
                        ymd: it.ymd,
                        showDate: it.showDate,
                        isWorkDay: true,
                        segmentIndex: idx,
                        totalSegmentsInDay: filledItems.length,
                        inTime: it.inTime,
                        outTime: it.outTime,
                        startTime: sTime,
                        endTime: eTime,
                        timeWH: parseFloat(it.timeWH || '7.5'),
                        isOut: isOut,
                        locationName: isOut ? TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT : '公司',
                        locationReason: locationCheck.reason,
                        pjNo: it.pjNo || '',
                        pjName: it.name || '',
                        pjInfoID: it.pjInfoID || '',
                        status: '已填写'
                    };
                });
                existingPlansByYmd.set(ymd, plans);
            }
        });
        // 2. 初始化项目队列并计算剩余所需工时
        const projectQueue = expProjects
            .filter(p => parseFloat(p.expWH) > 0)
            .map(p => {
            const exp = parseFloat(p.expWH);
            const act = parseFloat(p.workingHours || '0');
            const remain = Math.max(0, exp - act);
            const qNeed = floorToQuarterHour(remain);
            return {
                pjNo: p.pjNo,
                name: p.name,
                pjInfoID: p.pjInfoID,
                expWH: exp,
                remainingHours: qNeed
            };
        });
        // 3. 提取所有唯一日期
        const uniqueDays = [];
        const seenYmd = new Set();
        detailDays.forEach(d => {
            if (!seenYmd.has(d.ymd)) {
                seenYmd.add(d.ymd);
                uniqueDays.push(d);
            }
        });
        const unfilledSlots = [];
        uniqueDays.forEach(d => {
            const isWorkDay = (d.dtDayType === 1) && (d.onDutyStatus === '1');
            if (!isWorkDay)
                return;
            const existing = existingPlansByYmd.get(d.ymd) || [];
            const filledHours = existing.reduce((sum, p) => sum + p.timeWH, 0);
            const dayCapacity = Math.max(0, parseFloat((stdHours - filledHours).toFixed(2)));
            if (dayCapacity >= 0.25) {
                // 计算起始时间 (若已有分段，接在最后一个分段的结束时间后；否则 09:00)
                let startT = TIME_MG_CONSTANTS.DEFAULTS.START_TIME_DISPLAY;
                if (existing.length > 0) {
                    // 取最大结束时间
                    const lastEnd = existing[existing.length - 1].endTime;
                    if (lastEnd)
                        startT = lastEnd;
                }
                unfilledSlots.push({
                    ymd: d.ymd,
                    day: d,
                    capacity: dayCapacity,
                    curStartTime: startT,
                    allocatedSegments: []
                });
            }
        });
        // 阶段 1: 完整工作日优先分配 (待分配工时 >= 7.5h 且 槽位容量 >= 7.5h)
        for (const proj of projectQueue) {
            if (proj.remainingHours < stdHours)
                continue;
            for (const slot of unfilledSlots) {
                if (slot.capacity >= stdHours && proj.remainingHours >= stdHours) {
                    const endTime = addWorkingHoursQuantized(slot.curStartTime, stdHours);
                    slot.allocatedSegments.push({
                        pjNo: proj.pjNo,
                        pjName: proj.name,
                        pjInfoID: proj.pjInfoID,
                        startTime: slot.curStartTime,
                        endTime: endTime,
                        timeWH: stdHours
                    });
                    proj.remainingHours = parseFloat((proj.remainingHours - stdHours).toFixed(2));
                    slot.capacity = 0;
                    slot.curStartTime = endTime;
                }
            }
        }
        // 阶段 2: 零碎项目集中拼凑 (不足 7.5h，严格按剩余预算分配并填补部分工作日或剩余槽位)
        const remainingFragments = projectQueue.filter(p => p.remainingHours > 0);
        for (const frag of remainingFragments) {
            if (frag.remainingHours <= 0)
                continue;
            for (const slot of unfilledSlots) {
                while (frag.remainingHours > 0 && slot.capacity > 0) {
                    const hoursToAllocate = floorToQuarterHour(Math.min(frag.remainingHours, slot.capacity));
                    if (hoursToAllocate <= 0)
                        break;
                    const endTime = addWorkingHoursQuantized(slot.curStartTime, hoursToAllocate);
                    slot.allocatedSegments.push({
                        pjNo: frag.pjNo,
                        pjName: frag.name,
                        pjInfoID: frag.pjInfoID,
                        startTime: slot.curStartTime,
                        endTime: endTime,
                        timeWH: hoursToAllocate
                    });
                    frag.remainingHours = parseFloat((frag.remainingHours - hoursToAllocate).toFixed(2));
                    slot.capacity = parseFloat((slot.capacity - hoursToAllocate).toFixed(2));
                    slot.curStartTime = endTime;
                }
            }
        }
        // 阶段 3: 剩余未填满 7.5h 的工作日槽位 (预算缺口处理)
        // 若用户勾选了允许超预算的项目，则循环分摊给勾选项目；否则项目留空
        const overflowProjs = expProjects.filter(p => allowedOverflowPjNos.includes(p.pjNo));
        let overflowIdx = 0;
        for (const slot of unfilledSlots) {
            while (slot.capacity > 0) {
                const gap = slot.capacity;
                const assignedProj = overflowProjs.length > 0 ? overflowProjs[overflowIdx % overflowProjs.length] : null;
                const endTime = addWorkingHoursQuantized(slot.curStartTime, gap);
                slot.allocatedSegments.push({
                    pjNo: assignedProj ? assignedProj.pjNo : '',
                    pjName: assignedProj ? assignedProj.name : '',
                    pjInfoID: assignedProj ? assignedProj.pjInfoID : '',
                    startTime: slot.curStartTime,
                    endTime: endTime,
                    timeWH: gap
                });
                slot.capacity = 0;
                slot.curStartTime = endTime;
                if (assignedProj)
                    overflowIdx++;
            }
        }
        // 5. 构造完整方案列表 (按自然日历顺序组装，并将同一天所有分段合并重索引)
        const resultPlans = [];
        uniqueDays.forEach(day => {
            const isWorkDay = (day.dtDayType === 1) && (day.onDutyStatus === '1');
            if (!isWorkDay) {
                resultPlans.push({
                    ymd: day.ymd,
                    showDate: day.showDate,
                    isWorkDay: false,
                    segmentIndex: 0,
                    totalSegmentsInDay: 1,
                    inTime: day.inTime,
                    outTime: day.outTime,
                    startTime: '',
                    endTime: '',
                    timeWH: 0,
                    isOut: false,
                    locationName: '-',
                    locationReason: '休假日/非工作日',
                    pjNo: '',
                    pjName: '',
                    pjInfoID: '',
                    status: '跳过'
                });
                return;
            }
            const existing = existingPlansByYmd.get(day.ymd) || [];
            const slot = unfilledSlots.find(s => s.ymd === day.ymd);
            const newSegs = slot ? slot.allocatedSegments : [];
            const locationCheck = checkIsOutOfOffice(day.inTime, day.outTime);
            const allDaySegments = [];
            // 放入已有分段
            existing.forEach(p => allDaySegments.push(p));
            // 放入新分配分段
            newSegs.forEach(seg => {
                allDaySegments.push({
                    ymd: day.ymd,
                    showDate: day.showDate,
                    isWorkDay: true,
                    segmentIndex: 0,
                    totalSegmentsInDay: 1,
                    inTime: day.inTime,
                    outTime: day.outTime,
                    startTime: seg.startTime,
                    endTime: seg.endTime,
                    timeWH: seg.timeWH,
                    isOut: locationCheck.isOut,
                    locationName: locationCheck.locationName,
                    locationReason: locationCheck.reason,
                    pjNo: seg.pjNo,
                    pjName: seg.pjName || (seg.pjNo ? '' : '(未分配)'),
                    pjInfoID: seg.pjInfoID,
                    status: '就绪'
                });
            });
            // 重新编号分段与总数
            const totalSegs = allDaySegments.length;
            allDaySegments.forEach((plan, sIdx) => {
                plan.segmentIndex = sIdx;
                plan.totalSegmentsInDay = totalSegs;
                resultPlans.push(plan);
            });
        });
        return resultPlans;
    }
    /**
     * 试算当月项目总预算工时缺口与超出推荐
     */
    function calculateBudgetShortfall(expProjects, detailDays, plans) {
        const stdHours = TIME_MG_CONSTANTS.DEFAULTS.STANDARD_HOURS; // 7.5h
        // 1. 统计全月出勤工作日与全月总预算
        const uniqueDaysMap = new Map();
        detailDays.forEach(d => {
            if (!uniqueDaysMap.has(d.ymd))
                uniqueDaysMap.set(d.ymd, d);
        });
        const allWorkDays = Array.from(uniqueDaysMap.values()).filter(d => d.dtDayType === 1 && d.onDutyStatus === '1');
        const totalMonthHours = parseFloat((allWorkDays.length * stdHours).toFixed(2)); // 如 157.50h (21天)
        const totalMonthBudget = parseFloat(expProjects.reduce((sum, p) => sum + parseFloat(p.expWH || '0'), 0).toFixed(2)); // 如 114.99h
        const monthShortfallHours = parseFloat(Math.max(0, totalMonthHours - totalMonthBudget).toFixed(2)); // 如 42.51h
        // 2. 统计本次待填出勤工作日需求总工时 (如 20天*7.5h + 8/3缺口3.0h = 153.00h)
        const totalRequiredHours = parseFloat(plans.filter(p => p.isWorkDay && p.status !== '已填写')
            .reduce((sum, p) => sum + (p.timeWH || 0), 0)
            .toFixed(2));
        // 3. 统计各项目实际可用剩余预算 (向下取整至0.25h)
        let totalAvailableBudget = 0;
        const activeProjects = expProjects
            .filter(p => parseFloat(p.expWH) > 0)
            .map(p => {
            const exp = parseFloat(p.expWH);
            const act = parseFloat(p.workingHours || '0');
            const remain = Math.max(0, exp - act);
            const qRemain = floorToQuarterHour(remain);
            totalAvailableBudget += qRemain;
            return {
                pjNo: p.pjNo,
                name: p.name,
                expWH: exp,
                remainWH: qRemain
            };
        });
        totalAvailableBudget = parseFloat(totalAvailableBudget.toFixed(2));
        const shortfallHours = parseFloat(Math.max(0, totalRequiredHours - totalAvailableBudget).toFixed(2));
        // 按预算大小降序排序，推荐优先追加/超出的项目
        const suggestedProjects = activeProjects.sort((a, b) => b.expWH - a.expWH);
        return {
            totalMonthHours,
            totalMonthBudget,
            monthShortfallHours,
            totalRequiredHours,
            totalAvailableBudget,
            shortfallHours,
            suggestedProjects
        };
    }

    /**
     * 查找页面中包含 Handsontable (hotSettings) 的 AttendanceEdit Vue 组件实例
     */
    function findAttendanceEditComponent() {
        const allEls = Array.from(document.querySelectorAll('*'));
        for (const el of allEls) {
            const v = el.__vue__;
            if (v && v.hotSettings && Array.isArray(v.hotSettings.data)) {
                return v;
            }
        }
        return null;
    }
    /**
     * 同步切换宿主页面 Handsontable 实例的当前考勤年月并重新拉取数据
     */
    async function syncHostMonth(year, month) {
        const editComp = findAttendanceEditComponent();
        if (!editComp)
            return false;
        const formattedYm = `${year}/${month.padStart(2, '0')}`;
        const targetYmDigits = `${year}${month.padStart(2, '0')}`;
        // 检查宿主当前 Handsontable 数据是否已是该月份
        if (editComp.hotSettings && Array.isArray(editComp.hotSettings.data) && editComp.hotSettings.data.length > 0) {
            const firstYmd = String(editComp.hotSettings.data[0].ymd || '');
            if (firstYmd.startsWith(targetYmDigits)) {
                return true;
            }
        }
        // 切换宿主月份并触发拉取
        if (editComp.attendance) {
            editComp.attendance.ym = formattedYm;
        }
        editComp.oldYm = formattedYm;
        const dp = document.querySelector('.el-date-editor--month input, .el-date-editor input');
        if (dp) {
            dp.value = `${year}-${month.padStart(2, '0')}`;
        }
        if (typeof editComp.fetchData === 'function') {
            await editComp.fetchData();
            await new Promise(r => setTimeout(r, 600));
            return true;
        }
        return false;
    }
    /**
     * 孪生客户端核心引擎：
     * 将工数分配方案直接注入宿主 Handsontable 实例 (`hotSettings.data`)，
     * 触发 Handsontable `loadData` 动态重绘，调用 `computeActKosu("pro")` 自动更新工时预实对比表，
     * 并触发宿主页面原生的【保存】按钮提交入库！
     */
    async function saveAttendanceTwinClient(plans, state, onProgress) {
        let successCount = 0;
        let failCount = 0;
        const errors = [];
        if (onProgress)
            onProgress(1, 4, '正在连接宿主页面 Handsontable 考勤核心...');
        // 1. 查找 AttendanceEdit 组件
        const editComp = findAttendanceEditComponent();
        if (!editComp) {
            return {
                successCount: 0,
                failCount: plans.length,
                errors: ['未找到宿主页面考勤数据组件 (Handsontable)，请确认当前处于【考勤申请】编辑页面']
            };
        }
        // 1.1 确保宿主表格已加载目标年月的考勤数据
        const targetYear = state?.selectedYear || (plans[0] ? plans[0].ymd.substring(0, 4) : '');
        const targetMonth = state?.selectedMonth || (plans[0] ? plans[0].ymd.substring(4, 6) : '');
        if (targetYear && targetMonth) {
            await syncHostMonth(targetYear, targetMonth);
        }
        const hotData = editComp.hotSettings.data;
        const toFillPlans = plans.filter(p => p.isWorkDay);
        if (onProgress)
            onProgress(2, 4, `正在向内存装载 ${toFillPlans.length} 个工作日出勤明细...`);
        // 2. 按日期将 plans 分组
        const plansByYmd = new Map();
        toFillPlans.forEach(p => {
            if (!plansByYmd.has(p.ymd))
                plansByYmd.set(p.ymd, []);
            plansByYmd.get(p.ymd).push(p);
        });
        // 2.1 清理因多次试算追加的多余行 (若某日现有行数大于新分配的段数，移除多余的追加行)
        plansByYmd.forEach((dayPlans, ymd) => {
            const matchingIndices = [];
            hotData.forEach((r, idx) => {
                if (r.ymd === ymd)
                    matchingIndices.push(idx);
            });
            if (matchingIndices.length > dayPlans.length) {
                for (let i = matchingIndices.length - 1; i >= dayPlans.length; i--) {
                    const targetIdx = matchingIndices[i];
                    hotData.splice(targetIdx, 1);
                }
            }
        });
        // 2.2 逐日逐段精准回填
        plansByYmd.forEach((dayPlans, ymd) => {
            try {
                // 查找 hotData 中该日期的第一行位置
                const firstIdx = hotData.findIndex((r) => r.ymd === ymd);
                if (firstIdx < 0)
                    return;
                // 查找该日期当前已有的所有行
                const currentDayRows = hotData.filter((r) => r.ymd === ymd);
                // 将分配方案的各字段写入对应行 (按分段序号对齐行，无对应行时自动克隆追加新行)
                dayPlans.forEach((plan, planIdx) => {
                    let targetRow = currentDayRows[planIdx];
                    if (!targetRow) {
                        const baseRow = hotData[firstIdx];
                        const cloneRow = Object.assign({}, baseRow);
                        cloneRow.checkable = null;
                        cloneRow.isAdd = true;
                        cloneRow.detailDisabled = 'abled';
                        cloneRow.whFormDetailID = '';
                        cloneRow.status = '--';
                        cloneRow.dtAppStatus = '--';
                        const insertPos = firstIdx + currentDayRows.length;
                        hotData.splice(insertPos, 0, cloneRow);
                        currentDayRows.push(cloneRow);
                        targetRow = cloneRow;
                    }
                    targetRow._autopilotFilled = true;
                    targetRow.fromDt = plan.startTime;
                    targetRow.toDt = plan.endTime;
                    targetRow.timeWH = String(plan.timeWH);
                    targetRow.attandence = '是';
                    targetRow.onDutyStatus = '1';
                    targetRow.out = plan.isOut ? TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT : (plan.locationName || '公司');
                    targetRow.flgOut = plan.isOut ? '1' : '2';
                    targetRow.workType = '项目';
                    targetRow.flg = '1';
                    targetRow.pjNo = plan.pjNo || '';
                    targetRow.name = plan.pjName || '';
                    targetRow.pjgID = plan.pjInfoID || null;
                    targetRow.pjInfoID = plan.pjInfoID || null;
                    targetRow.changeFlg = '1';
                    targetRow.detailDisabled = 'abled';
                    targetRow.display = true;
                    // 补全部门信息
                    if (plan.pjNo) {
                        const projectInfo = (editComp.projectList || []).find((p) => p.pjNo === plan.pjNo);
                        if (projectInfo && projectInfo.branch) {
                            targetRow.department = projectInfo.branch;
                        }
                    }
                    plan.status = '成功';
                    successCount++;
                });
            }
            catch (err) {
                failCount++;
                errors.push(`${ymd}: ${err.message}`);
            }
        });
        // 3. 全量校准所有工作日行的办公地点 (若打卡未全覆盖09:00~17:30，100%设为外出)
        hotData.forEach((row) => {
            if (row.dtDayType === 1 && (row.pjNo || row.fromDt || row.toDt || row.attandence === '是')) {
                const loc = checkIsOutOfOffice(row.inTime, row.outTime);
                if (loc.isOut) {
                    row.out = TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT;
                    row.flgOut = '1';
                    row.changeFlg = '1';
                }
            }
        });
        // 4. 驱动 Handsontable 实例重载与工时重新试算
        if (onProgress)
            onProgress(3, 4, '正在重新渲染 Handsontable 与预实工数试算...');
        if (editComp.$refs && editComp.$refs.editTable && editComp.$refs.editTable.hotInstance) {
            editComp.$refs.editTable.hotInstance.loadData(hotData);
        }
        if (typeof editComp.computeActKosu === 'function') {
            editComp.computeActKosu('pro');
        }
        // 5. 触发宿主原生保存按钮
        if (onProgress)
            onProgress(4, 4, '正在触发宿主页面原生【保存】提交入库...');
        const saveBtn = Array.from(document.querySelectorAll('.operation-item, .dialog-btn-box li, button'))
            .find(b => (b.textContent || '').trim() === '保存');
        if (saveBtn) {
            console.log('[Time-MG Twin] 触发宿主原生保存按钮:', saveBtn);
            saveBtn.click();
        }
        else if (typeof editComp.handleSubmit === 'function') {
            console.log('[Time-MG Twin] 调用 editComp.handleSubmit("save")');
            editComp.handleSubmit('save');
        }
        // 5. 自动聚焦并置顶宿主确认对话框
        setTimeout(() => {
            const msgBoxes = document.querySelectorAll('.el-message-box__wrapper, .el-dialog__wrapper');
            msgBoxes.forEach((mb) => {
                mb.style.zIndex = '10000001';
                const confirmBtn = mb.querySelector('.el-message-box__btns button.el-button--primary, .el-dialog__footer button.el-button--primary');
                if (confirmBtn) {
                    confirmBtn.focus();
                }
            });
        }, 100);
        return { successCount, failCount, errors };
    }

    /**
     * 考勤工数副驾专属样式
     */
    function injectTimeMgStyles() {
        if (document.getElementById('yn-timemg-styles'))
            return;
        const style = document.createElement('style');
        style.id = 'yn-timemg-styles';
        style.textContent = `
        /* 考勤副驾悬浮入口按钮 */
        #yn-timemg-helper-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 999999;
            background: linear-gradient(135deg, #13c2c2 0%, #08979c 100%);
            color: #fff;
            padding: 12px 20px;
            border-radius: 50px;
            box-shadow: 0 4px 16px rgba(19, 194, 194, 0.4);
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            user-select: none;
            border: 2px solid rgba(255, 255, 255, 0.2);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
        }
        #yn-timemg-helper-btn:hover {
            transform: translateY(-2px) scale(1.03);
            box-shadow: 0 8px 24px rgba(19, 194, 194, 0.55);
            background: linear-gradient(135deg, #36cfc9 0%, #13c2c2 100%);
        }
        #yn-timemg-helper-btn .yn-timemg-badge {
            width: 9px;
            height: 9px;
            background-color: #52c41a;
            border-radius: 50%;
            display: inline-block;
            box-shadow: 0 0 6px #52c41a;
        }
        #yn-timemg-helper-btn .yn-timemg-badge.offline {
            background-color: #faad14;
            box-shadow: 0 0 6px #faad14;
        }

        /* 模态弹窗遮罩 */
        #yn-timemg-modal-mask {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(4px);
            z-index: 999998;
            display: none;
        }

        /* 考勤副驾模态弹窗主容器 (全屏最大化利用 1920*1080 空间) */
        #yn-timemg-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: calc(100vw - 40px);
            height: calc(100vh - 40px);
            background: #ffffff;
            border-radius: 10px;
            box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
            z-index: 999999;
            display: none;
            flex-direction: column;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
            font-size: 13px;
            color: #262626;
        }

        /* 弹窗 Header */
        .yn-timemg-header {
            padding: 12px 24px;
            background: linear-gradient(90deg, #f6ffed 0%, #e6fffb 100%);
            border-bottom: 1px solid #b5f5ec;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .yn-timemg-header-title {
            font-size: 16px;
            font-weight: 700;
            color: #00474f;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .yn-timemg-header-subtitle {
            font-size: 12px;
            font-weight: normal;
            color: #595959;
            margin-left: 8px;
        }
        .yn-timemg-close-btn {
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: #8c8c8c;
            line-height: 1;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s;
        }
        .yn-timemg-close-btn:hover {
            color: #ff4d4f;
            background: rgba(0,0,0,0.05);
        }

        /* 顶部操作工具栏 */
        .yn-timemg-toolbar {
            padding: 10px 24px;
            background: #fafafa;
            border-bottom: 1px solid #f0f0f0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;
        }
        .yn-timemg-toolbar-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .yn-timemg-toolbar-right {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .yn-timemg-btn {
            padding: 7px 16px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            border: 1px solid transparent;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .yn-timemg-btn-primary {
            background: #13c2c2;
            color: #fff;
        }
        .yn-timemg-btn-primary:hover {
            background: #08979c;
        }
        .yn-timemg-btn-success {
            background: #52c41a;
            color: #fff;
            box-shadow: 0 2px 8px rgba(82, 196, 26, 0.35);
        }
        .yn-timemg-btn-success:hover {
            background: #389e0d;
        }
        .yn-timemg-btn-default {
            background: #fff;
            color: #595959;
            border-color: #d9d9d9;
        }
        .yn-timemg-btn-default:hover {
            color: #13c2c2;
            border-color: #13c2c2;
        }

        /* 主体内容双栏布局 (左栏 650px 项目对比表, 右栏自适应出勤分配表) */
        .yn-timemg-body {
            flex: 1;
            display: grid;
            grid-template-columns: 650px 1fr;
            overflow: hidden;
            background: #f5f5f5;
            gap: 1px;
        }

        .yn-timemg-panel {
            background: #fff;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .yn-timemg-panel-header {
            padding: 10px 16px;
            background: #fafafa;
            border-bottom: 1px solid #f0f0f0;
            font-weight: 700;
            color: #262626;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .yn-timemg-panel-content {
            flex: 1;
            overflow-y: auto;
            padding: 0;
        }

        /* 紧凑项目对比卡片与表格 */
        .yn-timemg-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        .yn-timemg-table th {
            background: #fafafa;
            color: #595959;
            font-weight: 600;
            padding: 8px 6px;
            border-bottom: 1px solid #e8e8e8;
            text-align: left;
            position: sticky;
            top: 0;
            z-index: 2;
            white-space: nowrap;
        }
        .yn-timemg-table td {
            padding: 7px 6px;
            border-bottom: 1px solid #f0f0f0;
            color: #262626;
            vertical-align: middle;
            white-space: nowrap;
        }
        .yn-timemg-table tr:hover td {
            background: #e6fffb;
        }
        .yn-timemg-table tr.holiday td {
            background: #fafafa;
            color: #bfbfbf;
        }
        .yn-timemg-table tr.is-overflow-row td {
            background: #fffbe6 !important;
        }

        /* 标签与徽章 */
        .yn-timemg-tag {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11.5px;
            font-weight: 600;
            white-space: nowrap;
        }
        .yn-timemg-tag-out {
            background: #fff7e6;
            color: #d46b08;
            border: 1px solid #ffd591;
        }
        .yn-timemg-tag-office {
            background: #f6ffed;
            color: #389e0d;
            border: 1px solid #b7eb8f;
        }
        .yn-timemg-tag-work {
            background: #e6f7ff;
            color: #096dd9;
            border: 1px solid #91d5ff;
        }
        .yn-timemg-tag-holiday {
            background: #f5f5f5;
            color: #8c8c8c;
            border: 1px solid #d9d9d9;
        }
        .yn-timemg-badge-overflow {
            color: #cf1322;
            font-weight: 700;
            background: #fff1f0;
            padding: 1px 6px;
            border-radius: 3px;
            border: 1px solid #ffa39e;
            white-space: nowrap;
            display: inline-block;
        }

        /* 进度条与日志 */
        .yn-timemg-progress-wrap {
            padding: 10px 24px;
            background: #fafafa;
            border-top: 1px solid #f0f0f0;
            display: none;
        }
        .yn-timemg-progress-bar {
            width: 100%;
            height: 6px;
            background: #f0f0f0;
            border-radius: 3px;
            overflow: hidden;
            margin-bottom: 6px;
        }
        .yn-timemg-progress-inner {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #13c2c2 0%, #52c41a 100%);
            transition: width 0.3s ease;
        }
        .yn-timemg-log-text {
            font-size: 12px;
            color: #595959;
        }

        /* 预算不足预警横幅与推荐项目标签 */
        .yn-timemg-shortfall-alert {
            margin: 12px 24px 0 24px;
            padding: 10px 16px;
            background: #fffbe6;
            border: 1px solid #ffe58f;
            border-radius: 8px;
            color: #d46b08;
            font-size: 12.5px;
            line-height: 1.6;
        }
        .yn-timemg-shortfall-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 6px;
        }
        .yn-timemg-tag-proj {
            background: #ffffff;
            border: 1px solid #ffd591;
            padding: 2px 10px;
            border-radius: 4px;
            font-weight: 600;
            color: #d4380d;
            cursor: pointer;
            transition: all 0.2s;
        }
        /* 底部日志控制台 (默认收起，点击展开) */
        .yn-timemg-footer-console {
            padding: 6px 20px;
            background: #fafafa;
            border-top: 1px solid #f0f0f0;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        #yn-timemg-log-stream {
            display: none;
            max-height: 90px;
            overflow-y: auto;
            background: #1e1e1e;
            color: #d4d4d4;
            font-family: Consolas, Monaco, monospace;
            font-size: 11px;
            padding: 6px 10px;
            border-radius: 4px;
            line-height: 1.5;
        }

        /* 确保宿主系统 (Element UI) 弹窗、确认框与提示浮层始终浮现在副驾界面之上 */
        .el-message-box__wrapper,
        .el-dialog__wrapper,
        .el-message,
        .el-notification,
        .el-loading-mask,
        .el-popover,
        .el-tooltip__popper,
        .el-select-dropdown,
        .el-autocomplete-suggestion {
            z-index: 10000001 !important;
        }
        .v-modal {
            z-index: 10000000 !important;
        }
    `;
        document.head.appendChild(style);
    }

    /**
     * 考勤副驾运行日志管理工具 (支持实时输出与一键拷贝)
     */
    class AutopilotLogger {
        static log(level, message) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');
            const entry = { time: timeStr, level, message };
            this.logHistory.push(entry);
            console.log(`[IV-Autopilot] [${entry.time}] [${level}] ${message}`);
            // 通知所有订阅者
            this.listeners.forEach(cb => {
                try {
                    cb(entry);
                }
                catch (e) { }
            });
        }
        static info(msg) { this.log('INFO', msg); }
        static warn(msg) { this.log('WARN', msg); }
        static error(msg) { this.log('ERROR', msg); }
        static success(msg) { this.log('SUCCESS', msg); }
        static subscribe(cb) {
            this.listeners.push(cb);
        }
        static getFullLogsText() {
            const header = `=== IVision FSSC Autopilot v4.4.0 执行日志 ===\n生成时间: ${new Date().toLocaleString()}\nURL: ${window.location.href}\n----------------------------------------\n`;
            const body = this.logHistory.map(l => `[${l.time}] [${l.level}] ${l.message}`).join('\n');
            return header + body;
        }
        static async copyLogsToClipboard() {
            const fullText = this.getFullLogsText();
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(fullText);
                    return true;
                }
            }
            catch (e) { }
            // 备用方案
            try {
                const ta = document.createElement('textarea');
                ta.value = fullText;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                return true;
            }
            catch (e) {
                return false;
            }
        }
    }
    AutopilotLogger.logHistory = [];
    AutopilotLogger.listeners = [];

    /**
     * 构造考勤工数副驾的主模态框与悬浮入口
     */
    function createTimeMgModalDOM(state) {
        if (document.getElementById('yn-timemg-helper-btn'))
            return;
        // 1. 悬浮按钮
        const btn = document.createElement('div');
        btn.id = 'yn-timemg-helper-btn';
        btn.innerHTML = `
        <span class="yn-timemg-badge"></span>
        <span>⏱️ 考勤工数副驾</span>
    `;
        document.body.appendChild(btn);
        // 2. 模态框遮罩
        const mask = document.createElement('div');
        mask.id = 'yn-timemg-modal-mask';
        document.body.appendChild(mask);
        // 3. 模态框主体
        const modal = document.createElement('div');
        modal.id = 'yn-timemg-modal';
        const activeYM = detectActiveYearAndMonth();
        const currentYear = state.selectedYear || activeYM.year;
        const currentMonth = state.selectedMonth || activeYM.month;
        state.selectedYear = currentYear;
        state.selectedMonth = currentMonth;
        modal.innerHTML = `
        <!-- 头部 Header -->
        <div class="yn-timemg-header">
            <div class="yn-timemg-header-title">
                <span>⏱️ 爱模考勤工数极速分配副驾</span>
                <span class="yn-timemg-header-subtitle">time-mg.huge-vision.com | 09:00~17:30 标准基准 & 门禁智能推断</span>
            </div>
            <button class="yn-timemg-close-btn" id="yn-timemg-modal-close" title="关闭">✕</button>
        </div>

        <!-- 顶部工具栏 -->
        <div class="yn-timemg-toolbar">
            <div class="yn-timemg-toolbar-left">
                <label style="font-weight:600; color:#595959;">考勤年月：</label>
                <input type="number" id="yn-timemg-input-year" value="${currentYear}" style="width:72px; padding:4px 8px; border:1px solid #d9d9d9; border-radius:4px; font-size:13px;" />
                <span style="color:#8c8c8c;">年</span>
                <input type="number" id="yn-timemg-input-month" min="1" max="12" value="${parseInt(currentMonth, 10)}" style="width:52px; padding:4px 8px; border:1px solid #d9d9d9; border-radius:4px; font-size:13px;" />
                <span style="color:#8c8c8c;">月</span>
                <button class="yn-timemg-btn yn-timemg-btn-primary" id="yn-timemg-btn-sync">🔄 同步考勤与项目数据</button>
                <button class="yn-timemg-btn yn-timemg-btn-default" id="yn-timemg-btn-recalc">⚡ 智能重算分配</button>
            </div>
            <div class="yn-timemg-toolbar-right">
                <button class="yn-timemg-btn yn-timemg-btn-success" id="yn-timemg-btn-autofill">💾 一键填报并保存考勤 (Twin Client)</button>
            </div>
        </div>

        <!-- 主体双栏区域 -->
        <div class="yn-timemg-body">
            <!-- 左栏: 项目工时预实对比表 -->
            <div class="yn-timemg-panel">
                <div class="yn-timemg-panel-header">
                    <span>📊 项目工时预实对比表</span>
                    <span id="yn-timemg-proj-summary" style="font-size:11.5px; font-weight:normal; color:#8c8c8c;">0 个项目</span>
                </div>
                <div class="yn-timemg-panel-content">
                    <table class="yn-timemg-table">
                        <thead>
                            <tr>
                                <th style="width:68px; text-align:center;">允许超额</th>
                                <th style="width:85px;">项目编号</th>
                                <th style="width:48px; text-align:right;">预计</th>
                                <th style="width:46px; text-align:right;">已填</th>
                                <th style="width:52px; text-align:right;">拟分</th>
                                <th style="width:92px; text-align:right;">超额/剩余</th>
                                <th>项目名称</th>
                            </tr>
                        </thead>
                        <tbody id="yn-timemg-proj-tbody">
                            <tr>
                                <td colspan="7" style="text-align:center; padding:30px; color:#8c8c8c;">
                                    点击上方【🔄 同步考勤与项目数据】开始
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 右栏: 考勤一览明细与分配预览 -->
            <div class="yn-timemg-panel">
                <div class="yn-timemg-panel-header">
                    <span>📅 出勤日工时分配预览 (09:00 ~ 17:30)</span>
                    <span id="yn-timemg-plan-summary" style="font-size:11.5px; font-weight:normal; color:#8c8c8c;">0 天工作日</span>
                </div>
                <div class="yn-timemg-panel-content">
                    <table class="yn-timemg-table">
                        <thead>
                            <tr>
                                <th style="width:34px; text-align:center;">#</th>
                                <th style="width:62px;">日期</th>
                                <th style="width:108px; text-align:center;">类型</th>
                                <th style="width:105px; text-align:center;">打卡记录</th>
                                <th style="width:155px; text-align:center;">出勤时间</th>
                                <th style="width:58px; text-align:center;">地点</th>
                                <th style="width:88px;">项目编号</th>
                                <th style="max-width:240px;">项目名称</th>
                                <th style="width:75px; text-align:center;">状态</th>
                            </tr>
                        </thead>
                        <tbody id="yn-timemg-plan-tbody">
                            <tr>
                                <td colspan="9" style="text-align:center; padding:40px; color:#8c8c8c;">
                                    暂无分配数据。请点击上方【🔄 同步考勤与项目数据】！
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- 底部进度条 -->
        <div class="yn-timemg-progress-wrap" id="yn-timemg-progress-wrap">
            <div class="yn-timemg-progress-bar">
                <div class="yn-timemg-progress-inner" id="yn-timemg-progress-inner"></div>
            </div>
            <div class="yn-timemg-log-text" id="yn-timemg-log-text">准备就绪</div>
        </div>

        <!-- 底部实时运行日志控制台与一键复制 -->
        <div class="yn-timemg-footer-console">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <button id="yn-timemg-btn-togglelog" style="background:none; border:none; color:#595959; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:6px; padding:2px 0; user-select:none;">
                    <span>📝 运行与调试日志</span>
                    <span id="yn-timemg-log-count" style="font-weight:normal; color:#8c8c8c; font-size:11px;">(0 条记录)</span>
                    <span id="yn-timemg-log-arrow" style="font-size:11px; color:#096dd9;">▾ 点击展开</span>
                </button>
                <button class="yn-timemg-btn yn-timemg-btn-default" id="yn-timemg-btn-copylog" style="padding:2px 10px; font-size:11.5px; height:24px; display:flex; align-items:center; gap:4px;">
                    📋 复制完整执行日志
                </button>
            </div>
            <div id="yn-timemg-log-stream">
                <div style="color:#6a9955;">// ⏱️ 爱模考勤工数副驾日志就绪...</div>
            </div>
        </div>
    `;
        document.body.appendChild(modal);
        // 绑定日志展开/收起切换
        const toggleLogBtn = document.getElementById('yn-timemg-btn-togglelog');
        const streamEl = document.getElementById('yn-timemg-log-stream');
        const arrowEl = document.getElementById('yn-timemg-log-arrow');
        if (toggleLogBtn && streamEl && arrowEl) {
            toggleLogBtn.addEventListener('click', () => {
                const isHidden = streamEl.style.display === 'none' || !streamEl.style.display;
                if (isHidden) {
                    streamEl.style.display = 'block';
                    arrowEl.innerText = '▴ 点击收起';
                }
                else {
                    streamEl.style.display = 'none';
                    arrowEl.innerText = '▾ 点击展开';
                }
            });
        }
        // 订阅全局日志流
        let logCount = 0;
        AutopilotLogger.subscribe(entry => {
            const stream = document.getElementById('yn-timemg-log-stream');
            const countEl = document.getElementById('yn-timemg-log-count');
            if (!stream)
                return;
            logCount++;
            if (countEl)
                countEl.innerText = `(${logCount} 条记录)`;
            const line = document.createElement('div');
            const color = entry.level === 'ERROR' ? '#f14c4c' : (entry.level === 'WARN' ? '#cca700' : (entry.level === 'SUCCESS' ? '#73c991' : '#9cdcfe'));
            line.innerHTML = `<span style="color:#6e7681;">[${entry.time}]</span> <span style="color:${color}; font-weight:600;">[${entry.level}]</span> ${entry.message}`;
            stream.appendChild(line);
            stream.scrollTop = stream.scrollHeight;
        });
    }
    /**
     * 渲染左侧项目预实对比表 (显示拟分工时与超额/剩余量)
     */
    function renderTimeMgExpProjects(projects, state, onToggleOverflow) {
        const tbody = document.getElementById('yn-timemg-proj-tbody');
        const summaryEl = document.getElementById('yn-timemg-proj-summary');
        if (!tbody)
            return;
        if (projects.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#8c8c8c;">未获取到项目预实对比数据</td></tr>`;
            if (summaryEl)
                summaryEl.innerText = '0 个项目';
            return;
        }
        if (summaryEl) {
            const totalExp = projects.reduce((sum, p) => sum + parseFloat(p.expWH || '0'), 0).toFixed(2);
            summaryEl.innerText = `共 ${projects.length} 个项目 (总预计 ${totalExp}h)`;
        }
        tbody.innerHTML = '';
        projects.forEach(p => {
            const exp = parseFloat(p.expWH || '0');
            const act = parseFloat(p.workingHours || '0');
            // 计算该项目在当月分配计划中的总拟分工时 (不含历史已填写行)
            const allocatedWh = (state?.allocatedPlans || [])
                .filter(plan => plan.isWorkDay && plan.pjNo === p.pjNo && plan.status !== '已填写')
                .reduce((sum, plan) => sum + (plan.timeWH || 0), 0);
            const totalPostFill = parseFloat((act + allocatedWh).toFixed(2));
            const isAllowed = state && state.allowedOverflowPjNos ? state.allowedOverflowPjNos.includes(p.pjNo) : false;
            let diffHtml = '';
            if (totalPostFill > exp) {
                const overHours = (totalPostFill - exp).toFixed(2);
                diffHtml = `<span class="yn-timemg-badge-overflow" title="超出预计预算 ${overHours}h">超 +${overHours}h</span>`;
            }
            else if (totalPostFill === exp) {
                diffHtml = `<span style="color:#52c41a; font-weight:600; white-space:nowrap;">余 0.00h</span>`;
            }
            else {
                const remainHours = (exp - totalPostFill).toFixed(2);
                diffHtml = `<span style="color:#fa8c16; font-weight:600; white-space:nowrap;">余 ${remainHours}h</span>`;
            }
            const tr = document.createElement('tr');
            if (isAllowed)
                tr.className = 'is-overflow-row';
            tr.innerHTML = `
            <td style="text-align:center; padding:6px 2px;">
                <input type="checkbox" class="yn-timemg-cb-overflow" data-pjno="${p.pjNo}" ${isAllowed ? 'checked' : ''} style="cursor:pointer; width:15px; height:15px; accent-color:#096dd9; vertical-align:middle;" title="勾选后允许【${p.pjNo}】超出预算分摊缺口工时" />
            </td>
            <td style="font-weight:700; color:#096dd9; font-family:monospace; font-size:12px;">${p.pjNo}</td>
            <td style="text-align:right; font-weight:600; color:#262626;">${p.expWH}h</td>
            <td style="text-align:right; color:#52c41a; font-weight:600;">${p.workingHours}h</td>
            <td style="text-align:right;">
                <strong style="color:${allocatedWh > 0 ? '#096dd9' : '#8c8c8c'};">${allocatedWh > 0 ? `${allocatedWh.toFixed(2)}h` : '-'}</strong>
            </td>
            <td style="text-align:right;">
                ${diffHtml}
            </td>
            <td style="color:#595959; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;" title="${p.name}">
                ${p.name}
            </td>
        `;
            tbody.appendChild(tr);
        });
        // 绑定复选框变更事件
        tbody.querySelectorAll('.yn-timemg-cb-overflow').forEach((cb) => {
            cb.addEventListener('change', () => {
                const pjNo = cb.getAttribute('data-pjno');
                const checked = cb.checked;
                if (onToggleOverflow)
                    onToggleOverflow(pjNo, checked);
            });
        });
    }
    /**
     * 宿主页面数据加载后即时自动计算并渲染工时缺口 Badge，并实时监听宿主月份切换
     */
    function autoInitHostCollapseBadge() {
        let isWatching = false;
        const calcAndApply = () => {
            const allEls = Array.from(document.querySelectorAll('*'));
            let editComp = null;
            for (const el of allEls) {
                const v = el.__vue__;
                if (v && v.hotSettings && Array.isArray(v.hotSettings.data) && Array.isArray(v.expWhs)) {
                    editComp = v;
                    break;
                }
            }
            if (editComp && editComp.expWhs.length > 0 && editComp.hotSettings.data.length > 0) {
                // 绑定 Vue 响应式监听 (仅需绑定一次)
                if (!isWatching && typeof editComp.$watch === 'function') {
                    isWatching = true;
                    editComp.$watch('attendance.ym', () => {
                        setTimeout(() => calcAndApply(), 300);
                    });
                    editComp.$watch(() => editComp.hotSettings && editComp.hotSettings.data, () => {
                        setTimeout(() => calcAndApply(), 300);
                    });
                    editComp.$watch(() => editComp.expWhs, () => {
                        setTimeout(() => calcAndApply(), 300);
                    });
                }
                const expProjects = editComp.expWhs.map((item) => {
                    const exp = parseFloat(item.expWH || '0');
                    const act = parseFloat(item.workingHours || '0');
                    return {
                        pjNo: item.pjNo || '',
                        name: item.name || '',
                        expWH: item.expWH || '0.00',
                        workingHours: item.workingHours || '0.00',
                        remainWH: Math.max(0, parseFloat((exp - act).toFixed(2))),
                        pjInfoID: item.pjInfoID || '',
                        pjgID: item.pjgID || null,
                        flgPJG: item.flgPJG || '2',
                        department: item.department || ''
                    };
                });
                const detailDays = editComp.hotSettings.data.map((item) => ({
                    ymd: item.ymd || '',
                    objYMD: item.objYMD || null,
                    showDate: item.showDate || '',
                    month: item.month || '',
                    date: item.date || '',
                    weekDate: Number(item.weekDate || 0),
                    dtDayType: Number(item.dtDayType || 1),
                    onDutyStatus: String(item.onDutyStatus || '1'),
                    inTime: item.inTime || null,
                    outTime: item.outTime || null,
                    fromDt: item.fromDt || null,
                    toDt: item.toDt || null,
                    timeWH: item.timeWH || null,
                    pjNo: item.pjNo || null,
                    name: item.name || null,
                    flgOut: item.flgOut || null,
                    flgOutShow: item.flgOutShow || null,
                    whFormID: item.whFormID || null,
                    whFormDetailID: item.whFormDetailID || null,
                    dtAppStatus: item.dtAppStatus || null,
                    applyFlowStatus: item.applyFlowStatus || null,
                    department: item.department || null,
                    memo: item.memo || null
                }));
                const plans = computeProjectAllocationPlan(expProjects, detailDays);
                const shortfall = calculateBudgetShortfall(expProjects, detailDays, plans);
                updateCollapseHeaderShortfallBadge(shortfall);
                return true;
            }
            return false;
        };
        // 初始快速轮询检测挂载
        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            if (calcAndApply() || attempts > 20) {
                clearInterval(timer);
            }
        }, 800);
        // 建立 DOM 日期选择器变化监听，确保即使未触发 Vue watch 也能即时响应月份切换
        const dpInput = document.querySelector('.el-date-editor--month input, .el-date-editor input');
        if (dpInput) {
            dpInput.addEventListener('change', () => {
                setTimeout(() => calcAndApply(), 500);
            });
        }
        // 监听全局前一月/后一月按钮点击
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (target && (target.closest('.el-date-picker') || target.closest('.el-picker-panel') || target.closest('.el-month-table') || target.closest('.el-date-editor') || target.classList.contains('el-icon-d-arrow-left') || target.classList.contains('el-icon-d-arrow-right'))) {
                setTimeout(() => calcAndApply(), 600);
            }
        });
    }
    /**
     * 向宿主页面折叠面板表头注入/更新预算工时缺口红字提示
     */
    function updateCollapseHeaderShortfallBadge(shortfall) {
        try {
            const titleEl = document.querySelector('#projectCompare .collapse-title') ||
                Array.from(document.querySelectorAll('.collapse-title'))
                    .find(el => (el.textContent || '').includes('项目工时预实对比'));
            if (!titleEl)
                return;
            let badge = document.getElementById('yn-timemg-collapse-shortfall-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.id = 'yn-timemg-collapse-shortfall-badge';
                titleEl.appendChild(badge);
            }
            const deficit = shortfall ? (shortfall.monthShortfallHours || shortfall.shortfallHours) : 0;
            if (shortfall && deficit > 0) {
                badge.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                color: #cf1322;
                background: #fff1f0;
                border: 1px solid #ffa39e;
                font-size: 12px;
                font-weight: 700;
                padding: 2px 8px;
                border-radius: 10px;
                margin-left: 12px;
                line-height: 1.2;
                vertical-align: middle;
                box-shadow: 0 1px 3px rgba(207, 19, 34, 0.12);
            `;
                badge.innerHTML = `⚠️ 当月项目工时缺口: ${deficit.toFixed(2)}h (总预算 ${shortfall.totalMonthBudget.toFixed(2)}h / 出勤需求 ${shortfall.totalMonthHours.toFixed(2)}h)`;
            }
            else if (shortfall) {
                const surplus = parseFloat(Math.max(0, shortfall.totalMonthBudget - shortfall.totalMonthHours).toFixed(2));
                badge.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                color: #389e0d;
                background: #f6ffed;
                border: 1px solid #b7eb8f;
                font-size: 12px;
                font-weight: 600;
                padding: 2px 8px;
                border-radius: 10px;
                margin-left: 12px;
                line-height: 1.2;
                vertical-align: middle;
                box-shadow: 0 1px 3px rgba(56, 158, 13, 0.12);
            `;
                badge.innerHTML = `✓ 当月项目工时预算充足 (富余 ${surplus.toFixed(2)}h | 总预算 ${shortfall.totalMonthBudget.toFixed(2)}h / 出勤需求 ${shortfall.totalMonthHours.toFixed(2)}h)`;
            }
        }
        catch (e) { }
    }
    /**
     * 渲染右侧考勤一览与分配方案预览表
     */
    function renderTimeMgPlans(plans) {
        const tbody = document.getElementById('yn-timemg-plan-tbody');
        const summaryEl = document.getElementById('yn-timemg-plan-summary');
        if (!tbody)
            return;
        if (plans.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:40px; color:#8c8c8c;">暂无分配计划</td></tr>`;
            if (summaryEl)
                summaryEl.innerText = '0 天工作日';
            return;
        }
        const workPlans = plans.filter(p => p.isWorkDay);
        const uniqueWorkDays = new Set(workPlans.map(p => p.ymd)).size;
        const totalAllocatedHours = workPlans.filter(p => Boolean(p.pjNo)).reduce((sum, p) => sum + (p.timeWH || 0), 0).toFixed(2);
        const shortfallHours = workPlans.filter(p => !p.pjNo).reduce((sum, p) => sum + (p.timeWH || 0), 0).toFixed(2);
        if (summaryEl) {
            if (parseFloat(shortfallHours) > 0) {
                summaryEl.innerHTML = `共 ${uniqueWorkDays} 个出勤日 (已分配项目: <strong style="color:#096dd9;">${totalAllocatedHours}h</strong>, 预算不足缺口: <strong style="color:#fa8c16;">${shortfallHours}h</strong>)`;
            }
            else {
                summaryEl.innerText = `共 ${uniqueWorkDays} 个出勤日 (${workPlans.length} 条记录, 已分配 ${totalAllocatedHours}h)`;
            }
        }
        tbody.innerHTML = '';
        plans.forEach((plan, idx) => {
            const tr = document.createElement('tr');
            if (!plan.isWorkDay) {
                tr.className = 'holiday';
            }
            else if (plan.totalSegmentsInDay && plan.totalSegmentsInDay > 1) {
                tr.style.backgroundColor = '#fafafa';
            }
            const inOutDisplay = (plan.inTime || plan.outTime) ? `
            <div style="font-size:11px; font-family:monospace; color:#595959;">
                ${plan.outTime ? plan.outTime.substring(11, 16) : '--:--'} ~ ${plan.inTime ? plan.inTime.substring(11, 16) : '--:--'}
            </div>
        ` : `<span style="color:#bfbfbf; font-size:11px;">(无门禁记录)</span>`;
            const locationTag = plan.isWorkDay ? `
            <span class="yn-timemg-tag ${plan.isOut ? 'yn-timemg-tag-out' : 'yn-timemg-tag-office'}" title="${plan.locationReason}">
                ${plan.locationName}
            </span>
        ` : `<span style="color:#bfbfbf;">-</span>`;
            let typeTag = `<span class="yn-timemg-tag yn-timemg-tag-holiday">休假</span>`;
            if (plan.isWorkDay) {
                if (plan.totalSegmentsInDay && plan.totalSegmentsInDay > 1) {
                    typeTag = `<span class="yn-timemg-tag" style="background:#fff0f6; color:#c41d7f; border:1px solid #ffadd2;" title="该出勤日由多项目拼凑">🧩 拼凑 ${(plan.segmentIndex ?? 0) + 1}/${plan.totalSegmentsInDay}</span>`;
                }
                else {
                    typeTag = `<span class="yn-timemg-tag yn-timemg-tag-work">出勤日</span>`;
                }
            }
            const timeDisplay = plan.isWorkDay ? `
            <div>
                <span style="font-weight:600; color:#262626;">${plan.startTime}~${plan.endTime}</span>
                <span style="font-size:11px; color:#fa8c16; font-weight:600; margin-left:4px;">(${plan.timeWH}h)</span>
            </div>
        ` : `<span style="color:#bfbfbf;">-</span>`;
            let statusHtml = `<span style="color:#8c8c8c;">${plan.status}</span>`;
            if (plan.status === '成功') {
                statusHtml = `<span style="color:#52c41a; font-weight:600;">✓ 成功</span>`;
            }
            else if (plan.status === '失败') {
                statusHtml = `<span style="color:#ff4d4f; font-weight:600;">✗ 失败</span>`;
            }
            else if (plan.status === '已填写') {
                statusHtml = `<span style="color:#096dd9; font-weight:600; background:#e6f7ff; border:1px solid #91d5ff; border-radius:3px; padding:1px 5px; font-size:11px;">已存在</span>`;
            }
            else if (plan.status === '就绪') {
                if (!plan.pjNo) {
                    statusHtml = `<span style="color:#d46b08; font-weight:600; background:#fffbe6; border:1px solid #ffe58f; border-radius:3px; padding:1px 5px; font-size:11px;">预算缺口</span>`;
                }
                else {
                    statusHtml = `<span style="color:#fa8c16; font-weight:600;">待回填</span>`;
                }
            }
            const pjNoHtml = plan.pjNo ? `
            <strong style="color:#096dd9;">${plan.pjNo}</strong>
        ` : (plan.isWorkDay ? `<span style="color:#fa8c16; font-weight:600; font-size:12px;">⚠️ 待补项目</span>` : `<span style="color:#bfbfbf;">-</span>`);
            const pjNameHtml = plan.pjName ? `
            <div style="color:#595959; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px;" title="${plan.pjName}">${plan.pjName}</div>
        ` : (plan.isWorkDay ? `<span style="color:#d46b08; font-size:11.5px; font-style:italic;">(工时缺口，可在左表勾选或手动填报)</span>` : `<span style="color:#bfbfbf;">-</span>`);
            tr.innerHTML = `
            <td style="text-align:center; color:#8c8c8c;">${idx + 1}</td>
            <td style="font-weight:600; white-space:nowrap;">${plan.showDate}</td>
            <td style="text-align:center;">${typeTag}</td>
            <td style="text-align:center;">${inOutDisplay}</td>
            <td style="text-align:center;">${timeDisplay}</td>
            <td style="text-align:center;">${locationTag}</td>
            <td>${pjNoHtml}</td>
            <td>${pjNameHtml}</td>
            <td style="text-align:center;">${statusHtml}</td>
        `;
            tbody.appendChild(tr);
        });
    }

    /**
     * 现代浮动 Toast 消息通知组件 (替代阻塞式 alert 弹窗)
     */
    function showToast(type, message, duration = 3500) {
        // 1. 先尝试利用宿主 Vue Element-UI $message (如果存在)
        try {
            const appVue = document.querySelector('#app')?.__vue__;
            if (appVue && typeof appVue.$message === 'function') {
                appVue.$message({
                    type: type,
                    message: message,
                    duration: duration,
                    showClose: true
                });
                return;
            }
        }
        catch (e) { }
        // 2. 独立高优先级 Floating Toast 容器
        let container = document.getElementById('yn-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'yn-toast-container';
            container.style.cssText = `
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 99999999;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
        `;
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        const colorMap = {
            success: { bg: '#f6ffed', border: '#b7eb8f', text: '#389e0d', icon: '✅', shadow: 'rgba(82, 196, 26, 0.2)' },
            warning: { bg: '#fffbe6', border: '#ffe58f', text: '#d46b08', icon: '⚠️', shadow: 'rgba(250, 140, 22, 0.2)' },
            error: { bg: '#fff1f0', border: '#ffa39e', text: '#cf1322', icon: '❌', shadow: 'rgba(245, 34, 45, 0.2)' },
            info: { bg: '#e6f7ff', border: '#91d5ff', text: '#096dd9', icon: 'ℹ️', shadow: 'rgba(24, 144, 255, 0.2)' }
        };
        const cfg = colorMap[type] || colorMap.info;
        toast.style.cssText = `
        background: ${cfg.bg};
        border: 1px solid ${cfg.border};
        color: ${cfg.text};
        box-shadow: 0 4px 16px ${cfg.shadow};
        padding: 10px 18px;
        border-radius: 8px;
        font-size: 13.5px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: 600px;
        word-break: break-word;
        pointer-events: auto;
        opacity: 0;
        transform: translateY(-12px);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
        toast.innerHTML = `
        <span style="font-size: 16px;">${cfg.icon}</span>
        <span style="white-space: pre-wrap; line-height: 1.4;">${message}</span>
    `;
        container.appendChild(toast);
        // 触发动画
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        // 自动消失
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-12px)';
            setTimeout(() => {
                if (toast.parentElement)
                    toast.parentElement.removeChild(toast);
            }, 300);
        }, duration);
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
        // 0. 【考勤工数系统】页面特征检测 (与元年完全独立)
        if (window.location.hostname.includes('time-mg.huge-vision.com') || url.includes('time-mg.huge-vision.com')) {
            return 'TIME_MG';
        }
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
            if (getH('X-CSRF-TOKEN') || getH('x-csrf-token')) {
                if (!STATE.timeMg) {
                    const now = new Date();
                    STATE.timeMg = {
                        selectedYear: String(now.getFullYear()),
                        selectedMonth: String(now.getMonth() + 1).padStart(2, '0'),
                        csrfToken: '',
                        expProjects: [],
                        detailDays: [],
                        allocatedPlans: [],
                        isProcessing: false,
                        lastSyncTime: ''
                    };
                }
                STATE.timeMg.csrfToken = getH('X-CSRF-TOKEN') || getH('x-csrf-token');
                updateTimeMgTokenStatus();
            }
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
    // ==========================================
    // 9. 模式 C: 考勤工数系统 (time-mg.huge-vision.com) 核心逻辑与事件
    // ==========================================
    function updateTimeMgTokenStatus() {
        const badge = document.querySelector('#yn-timemg-helper-btn .yn-timemg-badge');
        const csrf = getCsrfToken(STATE.timeMg);
        if (badge) {
            badge.className = `yn-timemg-badge ${csrf ? '' : 'offline'}`;
        }
    }
    function initTimeMgSystem() {
        const activeYM = detectActiveYearAndMonth();
        if (!STATE.timeMg) {
            STATE.timeMg = {
                selectedYear: activeYM.year,
                selectedMonth: activeYM.month,
                csrfToken: getCsrfToken(),
                expProjects: [],
                detailDays: [],
                allocatedPlans: [],
                isProcessing: false,
                lastSyncTime: ''
            };
        }
        else {
            STATE.timeMg.selectedYear = activeYM.year;
            STATE.timeMg.selectedMonth = activeYM.month;
        }
        injectTimeMgStyles();
        createTimeMgModalDOM(STATE.timeMg);
        bindTimeMgEvents();
        updateTimeMgTokenStatus();
        autoInitHostCollapseBadge();
    }
    let timeMgEventsBound = false;
    function bindTimeMgEvents() {
        if (timeMgEventsBound)
            return;
        timeMgEventsBound = true;
        const btn = document.getElementById('yn-timemg-helper-btn');
        const modal = document.getElementById('yn-timemg-modal');
        const mask = document.getElementById('yn-timemg-modal-mask');
        const closeBtn = document.getElementById('yn-timemg-modal-close');
        const btnSync = document.getElementById('yn-timemg-btn-sync');
        const btnRecalc = document.getElementById('yn-timemg-btn-recalc');
        const btnAutofill = document.getElementById('yn-timemg-btn-autofill');
        const btnCopyLog = document.getElementById('yn-timemg-btn-copylog');
        const yearInput = document.getElementById('yn-timemg-input-year');
        const monthInput = document.getElementById('yn-timemg-input-month');
        if (!btn || !modal)
            return;
        const openModal = async () => {
            // 打开模态框时，优先嗅探宿主页面当前正在展示的最新年月
            const activeYM = detectActiveYearAndMonth();
            if (yearInput)
                yearInput.value = activeYM.year;
            if (monthInput)
                monthInput.value = String(parseInt(activeYM.month, 10));
            let monthChanged = false;
            if (STATE.timeMg) {
                monthChanged = (STATE.timeMg.selectedYear !== activeYM.year) || (STATE.timeMg.selectedMonth !== activeYM.month);
                STATE.timeMg.selectedYear = activeYM.year;
                STATE.timeMg.selectedMonth = activeYM.month;
                if (monthChanged) {
                    STATE.timeMg.expProjects = [];
                    STATE.timeMg.detailDays = [];
                    STATE.timeMg.allocatedPlans = [];
                }
            }
            modal.style.display = 'flex';
            if (mask)
                mask.style.display = 'block';
            updateTimeMgTokenStatus();
            if (STATE.timeMg && (STATE.timeMg.expProjects.length === 0 || monthChanged)) {
                await syncTimeMgData();
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
        if (btnSync)
            btnSync.addEventListener('click', () => syncTimeMgData());
        if (btnRecalc)
            btnRecalc.addEventListener('click', () => recalcTimeMgAllocation());
        if (btnAutofill)
            btnAutofill.addEventListener('click', () => executeTimeMgAutofill());
        if (btnCopyLog) {
            btnCopyLog.addEventListener('click', async () => {
                const ok = await AutopilotLogger.copyLogsToClipboard();
                if (ok) {
                    showToast('success', '📋 完整运行日志已成功复制到剪贴板！');
                }
                else {
                    showToast('error', '❌ 复制失败，请手动选择日志文本复制。');
                }
            });
        }
        if (yearInput) {
            yearInput.addEventListener('change', () => {
                if (STATE.timeMg)
                    STATE.timeMg.selectedYear = yearInput.value;
            });
        }
        if (monthInput) {
            monthInput.addEventListener('change', () => {
                if (STATE.timeMg)
                    STATE.timeMg.selectedMonth = String(monthInput.value).padStart(2, '0');
            });
        }
    }
    function handleToggleOverflow(pjNo, checked) {
        if (!STATE.timeMg)
            return;
        const set = new Set(STATE.timeMg.allowedOverflowPjNos || []);
        if (checked)
            set.add(pjNo);
        else
            set.delete(pjNo);
        STATE.timeMg.allowedOverflowPjNos = Array.from(set);
        const plans = computeProjectAllocationPlan(STATE.timeMg.expProjects, STATE.timeMg.detailDays, STATE.timeMg.allowedOverflowPjNos);
        STATE.timeMg.allocatedPlans = plans;
        renderTimeMgExpProjects(STATE.timeMg.expProjects, STATE.timeMg, handleToggleOverflow);
        renderTimeMgPlans(plans);
        const assignedDays = plans.filter(p => p.isWorkDay && p.pjNo).length;
        AutopilotLogger.info(`已更新项目超额配置：${pjNo} (${checked ? '允许超预算' : '不超预算'})，当前已分摊出勤日: ${assignedDays} 天`);
        showToast('info', checked ? `已允许【${pjNo}】超出预算吸收缺口工时` : `已取消【${pjNo}】超预算分摊`, 2500);
    }
    async function syncTimeMgData() {
        if (!STATE.timeMg)
            return;
        const yearInput = document.getElementById('yn-timemg-input-year');
        const monthInput = document.getElementById('yn-timemg-input-month');
        const btnSync = document.getElementById('yn-timemg-btn-sync');
        const y = yearInput ? yearInput.value : STATE.timeMg.selectedYear;
        const m = monthInput ? String(monthInput.value).padStart(2, '0') : STATE.timeMg.selectedMonth;
        STATE.timeMg.selectedYear = y;
        STATE.timeMg.selectedMonth = m;
        if (btnSync) {
            btnSync.disabled = true;
            btnSync.innerText = '⏳ 正在同步...';
        }
        AutopilotLogger.info(`开始同步 ${y}年${m}月 考勤与项目预实工时数据...`);
        try {
            await syncHostMonth(y, m);
            const [expProjects, detailDays] = await Promise.all([
                fetchExpWHInfoApi(y, m, STATE.timeMg),
                fetchDetailWHInfoApi(y, m, STATE.timeMg)
            ]);
            STATE.timeMg.expProjects = expProjects;
            STATE.timeMg.detailDays = detailDays;
            AutopilotLogger.success(`数据拉取完成：获取到 ${expProjects.length} 个项目预实对比项，${detailDays.length} 天考勤明细`);
            // 执行智能分配 (支持勾选超预算项目)
            const plans = computeProjectAllocationPlan(expProjects, detailDays, STATE.timeMg.allowedOverflowPjNos || []);
            STATE.timeMg.allocatedPlans = plans;
            // 计算预算工时缺口
            const shortfall = calculateBudgetShortfall(expProjects, detailDays, plans);
            STATE.timeMg.budgetShortfall = shortfall;
            updateCollapseHeaderShortfallBadge(shortfall);
            renderTimeMgExpProjects(expProjects, STATE.timeMg, handleToggleOverflow);
            renderTimeMgPlans(plans);
            const workDays = plans.filter(p => p.isWorkDay);
            const assignedHours = workDays.filter(p => Boolean(p.pjNo)).reduce((s, p) => s + (p.timeWH || 0), 0);
            AutopilotLogger.success(`智能工数分配完成：${workDays.length} 个出勤日，已分配工时 ${assignedHours.toFixed(2)}h`);
            if (shortfall.shortfallHours > 0) {
                showToast('info', `✅ 成功同步！当月出勤需求 ${shortfall.totalRequiredHours}h，预算缺口 ${shortfall.shortfallHours}h。可在左侧勾选允许超出的项目，或保持缺口留空。`, 5000);
            }
            else {
                showToast('success', `✅ 成功同步 ${y}年${m}月 数据！共 ${expProjects.length} 个项目，已自动完成分配。`, 4000);
            }
        }
        catch (err) {
            AutopilotLogger.error(`同步失败: ${err.message}`);
            showToast('error', `❌ 同步失败: ${err.message}，请检查登录状态或网络`, 5000);
        }
        finally {
            if (btnSync) {
                btnSync.disabled = false;
                btnSync.innerText = '🔄 同步考勤与项目数据';
            }
        }
    }
    function recalcTimeMgAllocation() {
        if (!STATE.timeMg)
            return;
        if (STATE.timeMg.expProjects.length === 0 || STATE.timeMg.detailDays.length === 0) {
            showToast('warning', '请先点击【🔄 同步考勤与项目数据】获取当月考勤！');
            return;
        }
        AutopilotLogger.info('正在重新试算工数分配方案...');
        const plans = computeProjectAllocationPlan(STATE.timeMg.expProjects, STATE.timeMg.detailDays, STATE.timeMg.allowedOverflowPjNos || []);
        STATE.timeMg.allocatedPlans = plans;
        const shortfall = calculateBudgetShortfall(STATE.timeMg.expProjects, STATE.timeMg.detailDays, plans);
        STATE.timeMg.budgetShortfall = shortfall;
        updateCollapseHeaderShortfallBadge(shortfall);
        renderTimeMgExpProjects(STATE.timeMg.expProjects, STATE.timeMg, handleToggleOverflow);
        renderTimeMgPlans(plans);
        AutopilotLogger.success('智能工数分配已重新刷新！');
        showToast('info', '⚡ 智能工数分配已刷新！');
    }
    async function executeTimeMgAutofill() {
        if (!STATE.timeMg || STATE.timeMg.allocatedPlans.length === 0) {
            showToast('warning', '请先同步数据并生成分配方案！');
            return;
        }
        STATE.timeMg.allocatedPlans.filter(p => p.isWorkDay);
        const existingDays = STATE.timeMg.allocatedPlans.filter(p => p.status === '已填写');
        const toFillDays = STATE.timeMg.allocatedPlans.filter(p => p.status === '就绪');
        const outCount = toFillDays.filter(p => p.isOut).length;
        const officeCount = toFillDays.length - outCount;
        const shortfall = STATE.timeMg.budgetShortfall;
        AutopilotLogger.info(`准备执行孪生客户端填报：保留已有 ${existingDays.length} 条，装载待填 ${toFillDays.length} 条 (外出 ${outCount} 天, 公司 ${officeCount} 天)...`);
        const progressWrap = document.getElementById('yn-timemg-progress-wrap');
        const progressInner = document.getElementById('yn-timemg-progress-inner');
        const logText = document.getElementById('yn-timemg-log-text');
        const btnAutofill = document.getElementById('yn-timemg-btn-autofill');
        progressWrap.style.display = 'block';
        btnAutofill.disabled = true;
        btnAutofill.innerText = '⏳ 正在填报并保存...';
        const res = await saveAttendanceTwinClient(STATE.timeMg.allocatedPlans, STATE.timeMg, (idx, total, msg) => {
            const percent = Math.round((idx / total) * 100);
            progressInner.style.width = `${percent}%`;
            logText.innerText = `[${idx}/${total}] ${msg}`;
            AutopilotLogger.info(`[进度 ${idx}/${total}] ${msg}`);
        });
        progressInner.style.width = '100%';
        btnAutofill.disabled = false;
        btnAutofill.innerText = '💾 一键填报并保存考勤 (Twin Client)';
        renderTimeMgPlans(STATE.timeMg.allocatedPlans);
        if (res.failCount === 0) {
            logText.innerText = `✅ 全部 ${res.successCount} 条记录填报并生效保存！`;
            AutopilotLogger.success(`🎉 填报成功完成：全部 ${res.successCount} 条记录已装载并触发生效保存！`);
            let toastMsg = `🎉 全部 ${res.successCount} 条出勤记录已成功装载并触发生效保存！`;
            if (shortfall && shortfall.shortfallHours > 0) {
                toastMsg += `\n（注：缺口 ${shortfall.shortfallHours}h 的行项目编号已留空，请按需手动选择项目）`;
            }
            showToast('success', toastMsg, 6000);
        }
        else {
            logText.innerText = `⚠️ 填报完成：成功 ${res.successCount} 条，失败 ${res.failCount} 条`;
            AutopilotLogger.warn(`填报部分异常：成功 ${res.successCount} 条，失败 ${res.failCount} 条。详情: ${res.errors.join('; ')}`);
            showToast('warning', `⚠️ 填报完成：成功 ${res.successCount} 条，失败 ${res.failCount} 条`, 5000);
        }
    }
    function checkAndMount() {
        if (typeof window !== 'undefined' && window.top !== window.self)
            return;
        const mode = detectPageMode();
        if (mode === 'TIME_MG') {
            STATE.pageMode = mode;
            initTimeMgSystem();
            console.log(`[IVision FSSC Autopilot v4.4.0] Mounted successfully in [TIME_MG] mode.`);
            return;
        }
        if (mode && mode !== 'UNKNOWN') {
            STATE.pageMode = mode;
            extractUrlParams();
            injectStyles();
            createModalDOM(STATE);
            bindEvents();
            updateTokenStatus();
            console.log(`[IVision FSSC Autopilot v4.4.0] Mounted successfully in [${mode}] mode.`);
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
        if (!document.getElementById('yn-batch-helper-btn') && !document.getElementById('yn-timemg-helper-btn')) {
            checkAndMount();
        }
    }, 1500);

})();
//# sourceMappingURL=iv-fssc-autopilot.dev.user.js.map
