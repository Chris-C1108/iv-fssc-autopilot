// ==UserScript==
// @name         元年云报销全能批量助手 (YuanNian FSSC Super Batch Helper)
// @namespace    https://github.com/chenahao/yuannian-batch-helper
// @version      4.3.0
// @description  元年云报销全流程超级助手：①【发票夹 & 费用记录】全量OCR数据补全(乘车时间/里程100%恢复)、自动识别通信费、自由切换分类、早晚行程智能推断、拖拽多附件；②【经费报销单页】丰富多维菜单Item(科目/项目/成本中心/向客户请款)、自动聚合备注TAG(如X2605-001)、智能检索匹配项目、蝴蝶效应引擎链式联动、一键自动持久化保存(saveBillData)并自动刷新单据视图。
// @author       Antigravity
// @match        https://ync37.yuanian.com/fssc/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 0. 页面模式识别与白名单检测 (丰富 MenuId 与特征)
    // ==========================================
    function detectPageMode() {
        const url = window.location.href;
        const decodedUrl = decodeURIComponent(url);

        // 1. 【经费报销单页】特征检测
        const isBillPage = (
            decodedUrl.includes('menuName=经费报销单') ||
            decodedUrl.includes('menuName=报销单') ||
            url.includes('menuId=11eedb8f8a31cd8f8a25f721e03d0caa') ||
            url.includes('menuId=68c5b963240677b2a836195d3b50e84e') ||
            url.includes('#billWrite') ||
            url.includes('billMainId=') ||
            url.includes('boDefineCode=FYBX') ||
            url.includes('billTypeCode=FYBX') ||
            !!STATE.currentBillData
        );
        if (isBillPage) return 'BILL';

        // 2. 【发票夹】 iframe 页面特征
        const isInvoicePool = (
            url.includes('#businessapplication') ||
            url.includes('5f0971df7a4411e9b0edd9fcadd69462') ||
            decodedUrl.includes('menuName=发票夹') ||
            url.includes('11ec6dd3fd5cb161bff83bb033997150')
        );
        if (isInvoicePool) return 'POOL';

        // 3. 【费用记录】 iframe 页面特征
        const isExpenseRecord = (
            url.includes('#expenserecord') ||
            decodedUrl.includes('menuName=费用记录') ||
            url.includes('56dd4bb8a5bf11e8a1a1d174f439477e')
        );
        if (isExpenseRecord) return 'EXPENSE';

        return null;
    }

    // ==========================================
    // 1. 全局状态与常量配置 (丰富菜单字典)
    // ==========================================
    const STATE = {
        pageMode: 'POOL',           // 'POOL' | 'EXPENSE' | 'BILL'
        loginToken: '',
        ecsToken: '',
        userOrigin: 'https://ync37.yuanian.com',
        appId: 'e3d5e4787ff911e88b1997bee3518b4d',
        menuId: '11eedb8f8a31cd8f8a25f721e03d0caa',
        eicds: '',
        v: '',
        applicantId: '11eee047a80566bca18367ceb209b2e1',

        // 模式 A: 发票夹与费用记录数据
        invoices: [],               // 全量发票/明细列表
        activeGroup: 'TAXI',        // 'TAXI' | 'COMMUNICATION' | 'ALL'
        selectedIndices: new Set(), // 选中的行索引

        // 模式 B: 经费报销单数据
        currentBillMainId: '',
        currentBillData: null,
        currentBillDefineTemplate: null,
        billRows: [],               // 报销单费用明细行列表
        billSelectedIndices: new Set(),
        billTags: new Map(),        // 提取的备注 TAG 统计
        activeBillTag: '',          // 当前选中的 TAG
        projectSearchResults: [],   // 项目搜索候选列表
        selectedPreset: 'PROJECT',  // 'PROJECT' | 'DEPARTMENT' | 'CUSTOM'
        selectedAccount: { value: '03561d1db6a345af7f1906ec05cc0000', title: '项目预算' },
        selectedCostCenter: { value: '0356194b8b3de1653e55bb00bc610000', title: 'IT服务G-安全咨询BU(制造)' },
        selectedProject: null,      // 选中的目标项目 { value: '', title: '' }
        selectedKhfd: { value: '6b8ff07f9ebe11e88b7247d35c1e5077', title: '是(YES)' },

        isProcessing: false
    };

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

    // 丰富的菜单 Items 字典 (科目 / 成本中心 / 请款 / 费用类型)
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

    // 预算区固定常量
    const BUDGET_CONSTANTS = {
        boAreaId: '203d2e64f6bd4b32a8c83d030fb32676',       // 预算区 ID
        claimSubAreaId: '3bfd939291eb42439b692181c5477a96', // 费用明细区 ID
        recSubAreaId: '7e1debbe739248c4a49ea98088997acf',   // 支出记录区 ID

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
        }
    };

    function extractUrlParams() {
        const full = window.location.href;
        const qIndex = full.indexOf('?');
        if (qIndex !== -1) {
            const query = full.substring(qIndex + 1);
            const params = new URLSearchParams(query);
            if (params.get('TOKEN') && !STATE.loginToken) {
                STATE.loginToken = params.get('TOKEN');
            }
            if (params.get('appId')) STATE.appId = params.get('appId');
            if (params.get('menuId')) STATE.menuId = params.get('menuId');
            if (params.get('billMainId')) STATE.currentBillMainId = params.get('billMainId');
        }
    }

    function normalizeTime(t) {
        if (!t) return '';
        const clean = t.toString().trim();
        const parts = clean.split(':');
        if (parts.length >= 2) {
            return `${parts[0].trim().padStart(2, '0')}:${parts[1].trim().padStart(2, '0')}`;
        }
        return clean;
    }

    function normalizeDate(d) {
        if (!d) return '';
        return d.toString().trim().replace(/\//g, '-').split(' ')[0];
    }

    function sortInvoices(list) {
        return list.sort((a, b) => {
            const dateA = normalizeDate(a.invoiceDate);
            const dateB = normalizeDate(b.invoiceDate);
            if (dateA !== dateB) return dateA.localeCompare(dateB);
            return normalizeTime(a.timeGetOn).localeCompare(normalizeTime(b.timeGetOn));
        });
    }

    function computePeriod(dateStr, isCommunication = false) {
        if (!dateStr) return '';
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

    async function mapConcurrent(items, limit, asyncFn) {
        const results = [];
        for (let i = 0; i < items.length; i += limit) {
            const chunk = items.slice(i, i + limit);
            const chunkResults = await Promise.all(chunk.map((item, idx) => asyncFn(item, i + idx)));
            results.push(...chunkResults);
        }
        return results;
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

    // ==========================================
    // 2. 自动拦截与捕获网络请求 / 报销单数据
    // ==========================================
    function initInterceptor() {
        extractUrlParams();
        STATE.loginToken = STATE.loginToken || sessionStorage.getItem('LoginToken') || localStorage.getItem('LoginToken') || '';
        STATE.ecsToken = sessionStorage.getItem('EcsToken') || localStorage.getItem('EcsToken') || '';

        const captureHeaders = (headers) => {
            if (!headers) return;
            const getH = (k) => headers[k] || headers[k.toLowerCase()] || '';
            if (getH('LoginToken')) STATE.loginToken = getH('LoginToken');
            if (getH('EcsToken')) STATE.ecsToken = getH('EcsToken');
            if (getH('UserOrigin')) STATE.userOrigin = getH('UserOrigin');
            if (getH('appid')) STATE.appId = getH('appid');
            if (getH('menuid')) STATE.menuId = getH('menuid');
            if (getH('eicds')) STATE.eicds = getH('eicds');
            if (getH('v')) STATE.v = getH('v');
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
                        parseBillData(STATE.currentBillData);
                        renderBillTable();
                    }
                }
            } catch (e) { }
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
            } catch (e) { }
            const resp = await rawFetch.apply(this, args);
            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                if (url && (url.includes('getBillDataAndTemplateByBillMainId') || url.includes('fieldValueChange'))) {
                    const cloned = resp.clone();
                    cloned.text().then(txt => handleInterceptedResponse(url, txt));
                }
            } catch (e) { }
            return resp;
        };
    }

    initInterceptor();

    // ==========================================
    // 3. API 请求封装与报销单/发票接口
    // ==========================================
    function getHeaders(isFormUrlEncoded = false, isMultipart = false) {
        const headers = {
            'LoginToken': STATE.loginToken,
            'EcsToken': STATE.ecsToken,
            'UserOrigin': STATE.userOrigin,
            'appid': STATE.appId,
            'menuid': STATE.menuId,
            'Accept': '*/*'
        };
        if (STATE.eicds) headers['eicds'] = STATE.eicds;
        if (STATE.v) headers['v'] = STATE.v;

        if (isFormUrlEncoded) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        } else if (!isMultipart) {
            headers['Content-Type'] = 'application/json;charset=UTF-8';
        }
        return headers;
    }

    async function apiRequest(url, method = 'POST', data = null, isFormUrlEncoded = false, isMultipart = false) {
        if (!STATE.loginToken || !STATE.ecsToken) {
            throw new Error('未检测到登录 Token，请先在页面上刷新或操作以捕获 Token');
        }
        const fullUrl = url.startsWith('http') ? url : `${STATE.userOrigin}${url}`;
        const headers = getHeaders(isFormUrlEncoded, isMultipart);

        const options = { method, headers };
        if (data) {
            if (isFormUrlEncoded || isMultipart) {
                options.body = data;
            } else {
                options.body = JSON.stringify(data);
            }
        }

        const resp = await fetch(fullUrl, options);
        if (!resp.ok) {
            throw new Error(`HTTP Error ${resp.status}: ${resp.statusText}`);
        }
        return await resp.json();
    }

    // --- 报销单相关 API ---
    async function fetchBillDataAndTemplateApi(billMainId) {
        const payload = { billMainId: billMainId, scene: 'WRITE' };
        const res = await apiRequest('/fssc/bill/billdata/getBillDataAndTemplateByBillMainId', 'POST', payload);
        if (res.success && res.data) {
            STATE.currentBillData = res.data.billData;
            STATE.currentBillDefineTemplate = res.data.billDefineTemplate;
            parseBillData(res.data.billData);
            return res.data;
        }
        throw new Error(res.message || '获取报销单数据失败');
    }

    async function searchDimProjectApi(keyword = '') {
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
            loginUserId: STATE.applicantId,
            isUseSecurityFormal: false
        };
        const res = await apiRequest('/fssc/dim/dimObject/getDimObjectAccessTree', 'POST', payload);
        const results = [];
        if (res.success && res.data && Array.isArray(res.data)) {
            const traverse = (nodes) => {
                nodes.forEach(node => {
                    if (node.data) {
                        const d = node.data;
                        if (d.objectId && d.name) {
                            results.push({
                                id: d.objectId,
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

    async function changeBillFieldValueApi(fieldCode, fieldName, billAreaFieldId, fieldValue, rowId, billSceneDataVO) {
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
        const res = await apiRequest('/fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange', 'POST', payload);
        if (res.success && res.data && res.data.billData) {
            STATE.currentBillData = res.data.billData;
            return res.data.billData;
        }
        throw new Error(res.message || `修改字段 [${fieldName}] 失败`);
    }

    async function saveBillDataApi(billData) {
        const payload = JSON.parse(JSON.stringify(billData));
        payload.billButtons = [];
        payload.commit = false;
        payload.operationType = "UPDATE";
        payload.scene = "WRITE";
        if (!payload.attachmentDeleteList) payload.attachmentDeleteList = [];
        if (!payload.attachmentUploadList) payload.attachmentUploadList = [];
        if (payload.attachmentDeleteSync === undefined) payload.attachmentDeleteSync = false;

        const res = await apiRequest('/fssc/bill/billdata/saveBillData', 'POST', payload);
        if (res.success && res.data) {
            STATE.currentBillData = res.data;
            return res.data;
        }
        throw new Error(res.message || '保存报销单失败');
    }

    // --- 发票夹 / 费用记录相关 API ---
    async function queryExpenseRecordListApi() {
        const allList = [];
        let pageNum = 1;
        let hasNext = true;
        while (hasNext && pageNum <= 5) {
            const payload = {
                pageOrderParam: { pageNum: pageNum, pageSize: 100 },
                status: ["NO_REIMBURSE"],
                sortOrder: "DESC",
                sortColumnCode: "CREATE_DATE"
            };
            const res = await apiRequest('/fssc/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO', 'POST', payload);
            if (res.success && res.data) {
                const list = res.data.list || [];
                allList.push(...list);
                hasNext = res.data.hasNextPage === true;
                pageNum++;
            } else {
                break;
            }
        }
        return allList;
    }

    async function queryInvoicePoolListApi() {
        const payload = {
            boDefineId: "5f0971df7a4411e9b0edd9fcadd69462",
            appId: STATE.appId || "e3d5e4787ff911e88b1997bee3518b4d",
            relationBO: { boType: "OBJECT_TYPE", boDefineId: "5f0971df7a4411e9b0edd9fcadd69462" },
            conditions: "",
            conditionMap: {},
            pageOrderParam: { pageNum: 1, pageSize: 200, count: false, orderList: { desc: false } },
            boQuerySheetId: "026ef6e4a8a56756ace70c2002000001",
            authority: 0
        };
        const res = await apiRequest('/fssc/bo/boQuery/getBOQueryDataList', 'POST', payload);
        if (res.success && res.data && res.data.pageInfoBOQueryRowDataList) {
            return res.data.pageInfoBOQueryRowDataList.list || [];
        }
        return [];
    }

    async function getInvoiceDetailByDataIdApi(invoiceDataId) {
        const body = `invoiceDataId=${encodeURIComponent(invoiceDataId)}`;
        const res = await apiRequest('/fssc/expenseClaim/expenseRecordInvoice/getInvoiceByDataId', 'POST', body, true);
        return (res.success && res.data) ? res.data : {};
    }

    async function createDraftExpenseRecordFromInvoiceApi(invoiceVO, invoiceDataId) {
        const payload = {
            accountCurrencyId: "6e589eb2dd9f11e8b5a69590a14a4e34",
            applicantId: STATE.applicantId,
            executeType: "OPERATING_INVOICE",
            expenseRecordInvoiceVOList: [{ invoiceVO: invoiceVO }],
            expenseTypeId: "UNIDENTIFIED",
            invoiceGeneration: true,
            triggerTiming: "ADD_ROW"
        };
        const res = await apiRequest('/fssc/expenseClaim/expenseRecord/initAndSaveExpenseRecordData', 'POST', payload);
        if (res.success && res.data && res.data.expenseRecordId) return res.data.expenseRecordId;
        throw new Error(res.message || '生成支出记录草稿失败');
    }

    async function getExpenseTypeRuleAndRowDatasApi(expenseRecordId, expenseTypeId = 'UNIDENTIFIED') {
        const payload = {
            expenseTypeId: expenseTypeId,
            expenseRecordId: expenseRecordId,
            intersectionScope: null,
            dimensionMappingQueryVOList: [],
            accountCurrencyId: "6e589eb2dd9f11e8b5a69590a14a4e34"
        };
        const res = await apiRequest('/fssc/expenseClaim/expenseRecord/getExpenseTypeFieldRuleListAndAllValueVO', 'POST', payload);
        if (res.success && res.data) return res.data;
        throw new Error(res.message || '获取费用记录规则失败');
    }

    async function initExpenseRecordWithTypeApi(expenseRecordId, expenseTypeId, rowDatas) {
        const payload = {
            intersectionScope: null,
            accountCurrencyId: "6e589eb2dd9f11e8b5a69590a14a4e34",
            expenseTypeId: expenseTypeId,
            executeType: "CHANGE_EXPENSE_TYPE",
            triggerTiming: "ADD_ROW",
            expenseRecordId: expenseRecordId,
            rowDatas: rowDatas,
            applicantId: STATE.applicantId
        };
        const res = await apiRequest('/fssc/expenseClaim/expenseRecord/initExpenseRecordData', 'POST', payload);
        if (res.success && res.data) return res.data;
        throw new Error(res.message || '初始化费用类型失败');
    }

    async function uploadAttachmentApi(file) {
        const formData = new FormData();
        formData.append('multipartFiles', file, file.name);
        formData.append('module', 'MANUAL_EXPENSERECORD_MODULE');
        const res = await apiRequest('/fssc/billAttachment/attachmentUpload', 'POST', formData, false, true);
        if (res.success && res.data && res.data.length > 0) return res.data[0];
        throw new Error(res.message || '附件上传失败');
    }

    async function saveFinalExpenseRecordApi(expenseRecordId, expenseTypeId, rowDatas, version) {
        const payload = {
            rowDatas: rowDatas,
            expenseRecordMessageList: [],
            accountCurrencyId: "6e589eb2dd9f11e8b5a69590a14a4e34",
            applicantId: STATE.applicantId,
            expenseTypeId: expenseTypeId,
            intersectionScope: null,
            dimensionMappingQueryVOList: [],
            version: version,
            expenseRecordId: expenseRecordId,
            operationType: "UPDATE"
        };
        const res = await apiRequest('/fssc/expenseClaim/expenseRecord/validateAndSaveExpenseRecord', 'POST', payload);
        if (!res.success) throw new Error(res.message || '保存失败');
        return res;
    }

    // ==========================================
    // 4. 解析报销单数据与 TAG 提取
    // ==========================================
    function parseBillData(billData) {
        if (!billData || !billData.area || !billData.area.rowDatas || billData.area.rowDatas.length === 0) {
            return;
        }

        const mainRow = billData.area.rowDatas[0];
        const claimArea = mainRow.subAreaDatas ? mainRow.subAreaDatas[BUDGET_CONSTANTS.claimSubAreaId] : null;
        if (!claimArea || !claimArea.rowDatas) {
            return;
        }

        const rows = [];
        const tagMap = new Map();

        claimArea.rowDatas.forEach((r, idx) => {
            const datas = r.datas || {};
            const rowNum = datas.ROW_NUM ? datas.ROW_NUM.value : (idx + 1);
            const expTypeName = datas.EXPENSE_TYPE_ID && datas.EXPENSE_TYPE_ID.value && datas.EXPENSE_TYPE_ID.value.title ? datas.EXPENSE_TYPE_ID.value.title.zh_CN : '费用';
            const amt = datas.ACCOUNT_AMOUNT && datas.ACCOUNT_AMOUNT.value ? datas.ACCOUNT_AMOUNT.value.amount : 0;
            const desc = datas.DESCRIPTION ? datas.DESCRIPTION.value || '' : '';

            let recDesc = '';
            const recArea = r.subAreaDatas ? r.subAreaDatas[BUDGET_CONSTANTS.recSubAreaId] : null;
            if (recArea && recArea.rowDatas && recArea.rowDatas.length > 0) {
                const recDatas = recArea.rowDatas[0].datas || {};
                recDesc = recDatas.DESCRIPTION ? recDatas.DESCRIPTION.value || '' : '';
            }
            const effectiveTag = (recDesc || desc || '').trim();

            const budgetArea = r.subAreaDatas ? r.subAreaDatas[BUDGET_CONSTANTS.boAreaId] : null;
            let budgetRowId = '';
            let curAccount = '';
            let curProject = '';
            let curCostCenter = '';
            let curKhfd = '';
            let budgetDatas = {};

            if (budgetArea && budgetArea.rowDatas && budgetArea.rowDatas.length > 0) {
                const bRow = budgetArea.rowDatas[0];
                budgetRowId = bRow.datas && bRow.datas.BILL_ROW_ID ? bRow.datas.BILL_ROW_ID.value : '';
                budgetDatas = bRow.datas || {};

                curAccount = budgetDatas.DIM_ACCOUNT && budgetDatas.DIM_ACCOUNT.value && budgetDatas.DIM_ACCOUNT.value.title ? budgetDatas.DIM_ACCOUNT.value.title.zh_CN : '';
                curProject = budgetDatas.DIM_PROJECT && budgetDatas.DIM_PROJECT.value && budgetDatas.DIM_PROJECT.value.title ? budgetDatas.DIM_PROJECT.value.title.zh_CN : '';
                curCostCenter = budgetDatas.F_BM && budgetDatas.F_BM.value && budgetDatas.F_BM.value.title ? budgetDatas.F_BM.value.title.zh_CN : '';
                curKhfd = budgetDatas.F_KHFD && budgetDatas.F_KHFD.value && budgetDatas.F_KHFD.value.title ? budgetDatas.F_KHFD.value.title.zh_CN : '否';
            }

            if (effectiveTag) {
                tagMap.set(effectiveTag, (tagMap.get(effectiveTag) || 0) + 1);
            }

            rows.push({
                index: idx,
                rowNum: rowNum,
                claimRow: r,
                expTypeName: expTypeName,
                amount: amt,
                desc: desc,
                recDesc: effectiveTag,
                budgetRowId: budgetRowId,
                budgetDatas: budgetDatas,
                curAccount: curAccount,
                curProject: curProject,
                curCostCenter: curCostCenter,
                curKhfd: curKhfd,
                status: '就绪'
            });
        });

        STATE.billRows = rows;
        STATE.billTags = tagMap;

        if (!STATE.activeBillTag && tagMap.size > 0) {
            let maxTag = '';
            let maxCount = 0;
            tagMap.forEach((cnt, tg) => {
                if (cnt > maxCount) {
                    maxCount = cnt;
                    maxTag = tg;
                }
            });
            STATE.activeBillTag = maxTag;
        }

        autoSelectBillRowsByTag(STATE.activeBillTag);
    }

    function autoSelectBillRowsByTag(tag) {
        STATE.billSelectedIndices.clear();
        STATE.billRows.forEach((r, idx) => {
            if (!tag || r.recDesc.includes(tag)) {
                STATE.billSelectedIndices.add(idx);
            }
        });
    }

    // ==========================================
    // 5. UI 注入与样式 (双模式智能适配)
    // ==========================================
    function injectStyles() {
        if (document.getElementById('yn-batch-helper-styles')) return;

        const css = `
            #yn-batch-helper-btn {
                position: fixed;
                bottom: 25px;
                right: 25px;
                z-index: 999999;
                background: linear-gradient(135deg, #1890ff, #096dd9);
                color: #fff;
                border: none;
                border-radius: 50px;
                padding: 12px 22px;
                font-size: 14px;
                font-weight: 600;
                box-shadow: 0 4px 16px rgba(24, 144, 255, 0.4);
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #yn-batch-helper-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(24, 144, 255, 0.5);
            }
            .yn-badge {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #52c41a;
                display: inline-block;
            }
            .yn-badge.offline { background: #ff4d4f; }

            #yn-batch-modal {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 96vw;
                max-width: 1520px;
                height: 92vh;
                max-height: 940px;
                background: #ffffff;
                border-radius: 12px;
                box-shadow: 0 12px 48px rgba(0, 0, 0, 0.2);
                z-index: 1000000;
                display: none;
                flex-direction: column;
                overflow: hidden;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
                color: #262626;
            }
            #yn-modal-mask {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.45);
                backdrop-filter: blur(2px);
                z-index: 999999;
                display: none;
            }

            .yn-header {
                padding: 12px 24px;
                border-bottom: 1px solid #f0f0f0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #fafafa;
            }
            .yn-header h3 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .yn-close-btn {
                background: transparent;
                border: none;
                font-size: 22px;
                cursor: pointer;
                color: #8c8c8c;
            }
            .yn-close-btn:hover { color: #262626; }

            .yn-body {
                flex: 1;
                display: flex;
                flex-direction: column;
                padding: 12px 20px;
                overflow: hidden;
                background: #fdfdfd;
            }

            /* TAG 标签云样式 */
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
                background: #fff;
                border: 1px solid #d9d9d9;
                border-radius: 20px;
                padding: 3px 12px;
                font-size: 12px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                transition: all 0.2s;
                color: #595959;
            }
            .yn-tag-chip:hover {
                border-color: #52c41a;
                color: #52c41a;
            }
            .yn-tag-chip.active {
                background: #52c41a;
                border-color: #52c41a;
                color: #fff;
                font-weight: 600;
            }
            .yn-tag-count {
                background: rgba(0,0,0,0.06);
                border-radius: 10px;
                padding: 0 6px;
                font-size: 11px;
            }
            .yn-tag-chip.active .yn-tag-count {
                background: rgba(255,255,255,0.3);
                color: #fff;
            }

            /* 快捷配置面板 */
            .yn-quick-bar {
                background: #f0f7ff;
                border: 1px solid #adc6ff;
                border-radius: 6px;
                padding: 10px 14px;
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 12.5px;
                flex-wrap: wrap;
            }
            .yn-quick-bar input, .yn-quick-bar select {
                padding: 4px 8px;
                border: 1px solid #d9d9d9;
                border-radius: 4px;
                font-size: 12.5px;
            }
            .yn-quick-bar input:focus, .yn-quick-bar select:focus {
                border-color: #1890ff;
                outline: none;
            }

            .yn-group-tabs {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 10px;
            }
            .yn-tab-btn {
                padding: 6px 16px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
                border: 1px solid #d9d9d9;
                background: #fff;
                color: #595959;
                cursor: pointer;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .yn-tab-btn.active {
                background: #e6f7ff;
                border-color: #1890ff;
                color: #1890ff;
                font-weight: 600;
            }

            .yn-table-container {
                flex: 1;
                overflow-y: auto;
                border: 1px solid #f0f0f0;
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
                padding: 8px 6px;
                font-weight: 600;
                color: #595959;
                border-bottom: 1px solid #f0f0f0;
                position: sticky;
                top: 0;
                z-index: 10;
                white-space: nowrap;
            }
            .yn-table td {
                padding: 6px 6px;
                border-bottom: 1px solid #f5f5f5;
                vertical-align: middle;
            }
            .yn-table tr.selected { background: #f0f7ff; }
            .yn-table tr:hover { background: #fafafa; }
            .yn-table tr.selected:hover { background: #e6f1ff; }

            .yn-btn {
                padding: 5px 12px;
                border-radius: 6px;
                font-size: 13px;
                cursor: pointer;
                border: 1px solid #d9d9d9;
                background: #fff;
                color: #595959;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                transition: all 0.2s;
            }
            .yn-btn:hover { color: #1890ff; border-color: #1890ff; }
            .yn-btn-primary { background: #1890ff; color: #fff; border-color: #1890ff; }
            .yn-btn-primary:hover { background: #40a9ff; border-color: #40a9ff; color: #fff; }
            .yn-btn-success { background: #52c41a; color: #fff; border-color: #52c41a; }
            .yn-btn-success:hover { background: #73d13d; border-color: #73d13d; color: #fff; }
            .yn-btn-smart { background: #722ed1; color: #fff; border-color: #722ed1; }
            .yn-btn-smart:hover { background: #9254de; border-color: #9254de; color: #fff; }

            .yn-status-tag {
                display: inline-block;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 11px;
                white-space: nowrap;
            }
            .yn-status-pending { background: #fafafa; color: #8c8c8c; border: 1px solid #d9d9d9; }
            .yn-status-success { background: #f6ffed; color: #52c41a; border: 1px solid #b7eb8f; }
            .yn-status-error { background: #fff2f0; color: #ff4d4f; border: 1px solid #ffccc7; }

            .yn-footer {
                padding: 10px 20px;
                border-top: 1px solid #f0f0f0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #fafafa;
            }
            .yn-progress-bar-wrap { flex: 1; margin-right: 20px; display: none; }
            .yn-progress-bar { height: 8px; background: #e8e8e8; border-radius: 4px; overflow: hidden; }
            .yn-progress-inner { height: 100%; background: #1890ff; width: 0%; transition: width 0.2s; }
            .yn-log-box { font-size: 12px; color: #8c8c8c; margin-top: 4px; }
        `;
        const style = document.createElement('style');
        style.id = 'yn-batch-helper-styles';
        style.type = 'text/css';
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }

    function createUI() {
        const mode = detectPageMode();
        if (!mode) return;
        STATE.pageMode = mode;

        if (document.getElementById('yn-batch-helper-btn')) return;
        injectStyles();

        // 悬浮球
        const btn = document.createElement('button');
        btn.id = 'yn-batch-helper-btn';
        btn.innerHTML = `
            <span class="yn-badge ${STATE.loginToken ? '' : 'offline'}"></span>
            <span>${mode === 'BILL' ? '⚡ 报销单预算批量修改' : '⚡ 报销批量助手'}</span>
        `;
        document.body.appendChild(btn);

        // 遮罩
        const mask = document.createElement('div');
        mask.id = 'yn-modal-mask';
        document.body.appendChild(mask);

        // 模态弹窗
        const modal = document.createElement('div');
        modal.id = 'yn-batch-modal';

        if (mode === 'BILL') {
            // === 模式 B: 经费报销单专属批量修改预算归属 UI (丰富菜单项) ===
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
                        <span>⚡ 经费报销单 - 批量修改预算归属</span>
                        <span id="yn-token-indicator" style="font-size:12px; font-weight:normal; color:${STATE.loginToken ? '#52c41a' : '#ff4d4f'};">
                            ${STATE.loginToken ? '● Token 已就绪' : '○ 正在等待 Token'}
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

                    <!-- 3. 批量修改配置面板 (丰富多维菜单Item) -->
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

                    <!-- 4. 明细行预览表格 -->
                    <div class="yn-table-container">
                        <table class="yn-table" id="yn-bill-records-table">
                            <thead>
                                <tr>
                                    <th style="width:36px; text-align:center;"><input type="checkbox" id="yn-bill-th-select-all" /></th>
                                    <th style="width:36px;">#</th>
                                    <th style="width:50px; text-align:center;">行号</th>
                                    <th style="width:110px;">费用类型</th>
                                    <th style="width:75px;">报销金额</th>
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
                                <tr>
                                    <td colspan="12" style="text-align:center; padding:50px; color:#8c8c8c;">
                                        正在读取报销单数据...
                                    </td>
                                </tr>
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
                            🚀 批量修改预算归属并向客户请款
                        </button>
                    </div>
                </div>
            `;
        } else {
            // === 模式 A: 发票夹与费用记录 UI ===
            modal.innerHTML = `
                <div class="yn-header">
                    <h3>
                        <span>元年报销批量流转与录入助手</span>
                        <span id="yn-token-indicator" style="font-size:12px; font-weight:normal; color:${STATE.loginToken ? '#52c41a' : '#ff4d4f'};">
                            ${STATE.loginToken ? '● Token 已就绪' : '○ 正在等待 Token'}
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
                            <span style="color:#bfbfbf">|</span>
                            <button class="yn-btn" id="yn-btn-add-row">➕ 添加一行</button>
                            <button class="yn-btn" id="yn-btn-clear-table">🗑️ 清空列表</button>
                            <span style="color:#bfbfbf">|</span>
                            <button class="yn-btn" id="yn-btn-export-csv">📥 导出 CSV</button>
                            <button class="yn-btn" id="yn-btn-import-csv">📤 导入 CSV</button>
                            <input type="file" id="yn-csv-file-input" accept=".csv" style="display:none;" />
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

        document.body.appendChild(modal);
        bindEvents();
    }

    function updateTokenStatus() {
        const btnBadge = document.querySelector('#yn-batch-helper-btn .yn-badge');
        if (btnBadge) btnBadge.className = `yn-badge ${STATE.loginToken ? '' : 'offline'}`;
        const indicator = document.getElementById('yn-token-indicator');
        if (indicator) {
            indicator.style.color = STATE.loginToken ? '#52c41a' : '#ff4d4f';
            indicator.innerHTML = STATE.loginToken ? '● Token 已就绪' : '○ 正在等待 Token';
        }
    }

    // ==========================================
    // 6. 经费报销单专属事件与表格渲染
    // ==========================================
    function renderBillTable() {
        if (STATE.pageMode !== 'BILL') return;

        const tbody = document.getElementById('yn-bill-table-tbody');
        const tagContainer = document.getElementById('yn-bill-tags-container');
        const filterInput = document.getElementById('yn-bill-filter-input');
        const thSelectAll = document.getElementById('yn-bill-th-select-all');
        const btnExecute = document.getElementById('yn-bill-btn-batch-execute');

        if (!tbody) return;

        // 1. 渲染 TAG 标签云
        if (tagContainer) {
            tagContainer.innerHTML = '';
            const allChip = document.createElement('span');
            allChip.className = `yn-tag-chip ${STATE.activeBillTag === '' ? 'active' : ''}`;
            allChip.innerHTML = `🏷️ 全部 <span class="yn-tag-count">${STATE.billRows.length}</span>`;
            allChip.addEventListener('click', () => {
                STATE.activeBillTag = '';
                if (filterInput) filterInput.value = '';
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
                    if (filterInput) filterInput.value = tag;
                    autoSelectBillRowsByTag(tag);

                    // 自动触发项目联想搜索
                    const pSearch = document.getElementById('yn-bill-project-search');
                    if (pSearch) pSearch.value = tag;
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
            if (isSelected) selectedCount++;

            const tr = document.createElement('tr');
            if (isSelected) tr.className = 'selected';

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
                <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(row.amount || 0).toFixed(2)}</span></td>
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

        // 绑定行复选框事件
        tbody.querySelectorAll('.yn-bill-row-check').forEach(ck => {
            ck.addEventListener('change', (e) => {
                const idx = parseInt(e.target.getAttribute('data-idx'));
                if (e.target.checked) STATE.billSelectedIndices.add(idx);
                else STATE.billSelectedIndices.delete(idx);
                renderBillTable();
            });
        });
    }

    async function triggerProjectSearch(keyword) {
        const select = document.getElementById('yn-bill-project-select');
        if (!select) return;

        select.innerHTML = `<option value="">⏳ 正在检索项目 [${keyword}]...</option>`;
        try {
            const projects = await searchDimProjectApi(keyword);
            STATE.projectSearchResults = projects;
            select.innerHTML = '';

            if (projects.length === 0) {
                select.innerHTML = `<option value="">未找到匹配项目</option>`;
                STATE.selectedProject = null;
                return;
            }

            projects.forEach((p, pIdx) => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.innerText = `[${p.code}] ${p.title}`;
                if (pIdx === 0) opt.selected = true;
                select.appendChild(opt);
            });

            // 默认选中第一个匹配项
            STATE.selectedProject = {
                value: projects[0].id,
                title: projects[0].title
            };
        } catch (e) {
            select.innerHTML = `<option value="">检索失败: ${e.message}</option>`;
        }
    }

    function prepareBillSceneVO(billData) {
        if (!billData) return null;
        const sceneVO = JSON.parse(JSON.stringify(billData));
        if (sceneVO.billButtons) delete sceneVO.billButtons;
        return sceneVO;
    }

    // ==========================================
    // 7. 报销单批量修改核心执行引擎 (v4.3.0 极速模式)
    //    策略: 首行蝴蝶计算 → 内存批量克隆 → 一次性入库保存
    //    原理: 同批行目标值相同 → BUDGET_DIM 计算结果确定性相同
    //    提速: 114次串行HTTP → 4次HTTP (约30倍加速)
    // ==========================================
    async function executeBatchBillBudgetUpdate() {
        const targetIndices = Array.from(STATE.billSelectedIndices);
        if (targetIndices.length === 0) {
            alert('请先勾选需要修改预算归属的费用明细行！');
            return;
        }

        // 确保报销单数据完整
        if (!STATE.currentBillData && STATE.currentBillMainId) {
            try {
                await fetchBillDataAndTemplateApi(STATE.currentBillMainId);
            } catch (e) {
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
        if (!confirm(confirmMsg)) return;

        const progressWrap = document.getElementById('yn-bill-progress-wrap');
        const progressInner = document.getElementById('yn-bill-progress-inner');
        const logText = document.getElementById('yn-bill-log-text');
        const btnExec = document.getElementById('yn-bill-btn-batch-execute');

        progressWrap.style.display = 'block';
        btnExec.disabled = true;
        btnExec.innerText = `⏳ 极速批量更新中...`;

        const total = targetIndices.length;
        let currentBillData = JSON.parse(JSON.stringify(STATE.currentBillData));

        // ============================================================
        // 阶段1: 对第1行执行完整蝴蝶效应计算 (3次API调用)
        //         获取服务端计算的 BUDGET_DIM, F_BM, F_FYKM 等派生值
        // ============================================================
        const firstRowIdx = targetIndices[0];
        const firstRow = STATE.billRows[firstRowIdx];
        progressInner.style.width = '10%';
        logText.innerText = `[阶段1/3] 首行蝴蝶效应计算: 行 ${firstRow.rowNum} (${firstRow.recDesc || firstRow.expTypeName})...`;

        let refBudgetDatas = null; // 首行计算后的参考预算区数据

        try {
            const claimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];
            const firstClaimRow = claimRows[firstRowIdx];
            if (!firstClaimRow) throw new Error(`未找到第 ${firstRowIdx + 1} 行费用明细数据`);

            const bArea = firstClaimRow.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId];
            const bRow = bArea?.rowDatas?.[0];
            const budgetRowId = bRow?.rowId || bRow?.datas?.BILL_ROW_ID?.value || firstRow.budgetRowId;
            if (!budgetRowId) throw new Error('首行未找到预算区 RowId');

            // 1a. 修改科目 (DIM_ACCOUNT)
            logText.innerText = `[阶段1/3] 首行蝴蝶效应 ① 修改科目...`;
            let sceneVO = prepareBillSceneVO(currentBillData);
            currentBillData = await changeBillFieldValueApi(
                BUDGET_CONSTANTS.fields.account.fieldCode,
                BUDGET_CONSTANTS.fields.account.fieldName,
                BUDGET_CONSTANTS.fields.account.fieldId,
                { value: STATE.selectedAccount.value, title: { zh_CN: accountTitle } },
                budgetRowId,
                sceneVO
            );

            // 1b. 修改项目 (DIM_PROJECT) 或 部门/成本中心 (F_BM)
            if (isProjBudget && STATE.selectedProject && STATE.selectedProject.value) {
                logText.innerText = `[阶段1/3] 首行蝴蝶效应 ② 修改项目...`;
                sceneVO = prepareBillSceneVO(currentBillData);
                currentBillData = await changeBillFieldValueApi(
                    BUDGET_CONSTANTS.fields.project.fieldCode,
                    BUDGET_CONSTANTS.fields.project.fieldName,
                    BUDGET_CONSTANTS.fields.project.fieldId,
                    { value: STATE.selectedProject.value, title: { zh_CN: STATE.selectedProject.title } },
                    budgetRowId,
                    sceneVO
                );
            } else if (!isProjBudget && STATE.selectedCostCenter && STATE.selectedCostCenter.value) {
                logText.innerText = `[阶段1/3] 首行蝴蝶效应 ② 修改成本中心...`;
                sceneVO = prepareBillSceneVO(currentBillData);
                currentBillData = await changeBillFieldValueApi(
                    BUDGET_CONSTANTS.fields.costCenter.fieldCode,
                    BUDGET_CONSTANTS.fields.costCenter.fieldName,
                    BUDGET_CONSTANTS.fields.costCenter.fieldId,
                    { value: STATE.selectedCostCenter.value, title: { zh_CN: costCenterTitle } },
                    budgetRowId,
                    sceneVO
                );
            }

            // 1c. 修改是否向客户请款 (F_KHFD)
            logText.innerText = `[阶段1/3] 首行蝴蝶效应 ③ 修改向客户请款...`;
            sceneVO = prepareBillSceneVO(currentBillData);
            currentBillData = await changeBillFieldValueApi(
                BUDGET_CONSTANTS.fields.khfd.fieldCode,
                BUDGET_CONSTANTS.fields.khfd.fieldName,
                BUDGET_CONSTANTS.fields.khfd.fieldId,
                { value: STATE.selectedKhfd.value, title: { zh_CN: khfdTitle } },
                budgetRowId,
                sceneVO
            );

            // 提取首行计算后的完整预算区参考数据
            const refClaimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];
            const refBudgetRow = refClaimRows[firstRowIdx]?.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId]?.rowDatas?.[0];
            if (!refBudgetRow) throw new Error('蝴蝶效应计算后未获取到首行预算区数据');
            refBudgetDatas = refBudgetRow.datas;

            firstRow.curAccount = accountTitle;
            firstRow.curProject = isProjBudget ? (STATE.selectedProject ? STATE.selectedProject.title : '') : '';
            firstRow.curCostCenter = !isProjBudget ? costCenterTitle : (firstRow.curCostCenter || '');
            firstRow.curKhfd = khfdTitle;
            firstRow.status = '成功';
            renderBillTable();

        } catch (err) {
            console.error('First row butterfly failed:', err);
            btnExec.disabled = false;
            btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
            alert(`❌ 首行蝴蝶效应计算失败: ${err.message}\n\n请检查网络连接和 Token 状态！`);
            return;
        }

        // ============================================================
        // 阶段2: 内存批量克隆 (纯JS操作, 0ms级)
        //         将首行的 BUDGET_DIM, DIM_ACCOUNT, DIM_PROJECT,
        //         F_BM, F_FYKM, F_KHFD, DIM_COST_CENTER 复制到剩余行
        // ============================================================
        progressInner.style.width = '50%';
        logText.innerText = `[阶段2/3] 内存批量克隆: 将首行计算结果写入剩余 ${total - 1} 行...`;

        // 需要从首行克隆到其他行的字段列表 (蝴蝶效应派生的关键字段)
        const CLONE_FIELDS = [
            'DIM_ACCOUNT', 'DIM_PROJECT', 'DIM_COST_CENTER',
            'F_BM', 'F_KHFD', 'F_FYKM',
            'BUDGET_DIM'
        ];

        let cloneSuccessCount = 0;
        let cloneFailCount = 0;
        const allClaimRows = currentBillData.area?.rowDatas?.[0]?.subAreaDatas?.[BUDGET_CONSTANTS.claimSubAreaId]?.rowDatas || [];

        for (let i = 1; i < total; i++) {
            const rowIdx = targetIndices[i];
            const row = STATE.billRows[rowIdx];

            try {
                const claimRow = allClaimRows[rowIdx];
                if (!claimRow) throw new Error(`未找到第 ${rowIdx + 1} 行明细数据`);

                const budgetRow = claimRow.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId]?.rowDatas?.[0];
                if (!budgetRow || !budgetRow.datas) throw new Error('预算区数据结构异常');

                // 克隆蝴蝶效应派生字段
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
            } catch (err) {
                console.error(`Clone failed on row ${row.rowNum}:`, err);
                row.status = '失败';
                cloneFailCount++;
            }
        }

        renderBillTable();
        const successCount = 1 + cloneSuccessCount; // 首行 + 克隆成功行
        const failCount = cloneFailCount;

        // ============================================================
        // 阶段3: 一次性持久化入库保存 (saveBillData, 1次API调用)
        // ============================================================
        progressInner.style.width = '80%';
        logText.innerText = `[阶段3/3] 正在执行整单持久化入库保存 (saveBillData)...`;

        try {
            const savedData = await saveBillDataApi(currentBillData);
            STATE.currentBillData = savedData;
            parseBillData(savedData);
        } catch (saveErr) {
            console.error('saveBillData failed:', saveErr);
            btnExec.disabled = false;
            btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
            renderBillTable();
            alert(`⚠️ 内存计算已完成，但持久化保存失败: ${saveErr.message}\n\n将自动降级为逐行串行模式重试...`);

            // ============ 降级回退: 逐行串行模式 ============
            await executeBatchBillBudgetUpdateFallback(targetIndices);
            return;
        }

        progressInner.style.width = '100%';
        btnExec.disabled = false;
        btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
        renderBillTable();
        logText.innerText = `⚡ 极速模式完成！成功: ${successCount} 条，失败: ${failCount} 条。`;

        const doReload = confirm(
            `✅ 极速批量修改并保存成功！\n` +
            `• 成功更新并入库: ${successCount} 条\n` +
            `• 失败: ${failCount} 条\n` +
            `• 模式: 极速 (首行蝴蝶 + 内存克隆 + 一次性入库)\n\n` +
            `数据已成功写入元年数据库！点击【确定】立即刷新页面！`
        );
        if (doReload) {
            window.location.reload();
        }
    }

    // 降级回退: 逐行串行蝴蝶效应模式 (当极速模式 saveBillData 失败时启用)
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

        // 重新获取最新 billData
        try {
            await fetchBillDataAndTemplateApi(STATE.currentBillMainId);
        } catch (e) {
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
                if (!curClaimRow) throw new Error(`未找到第 ${rowIdx + 1} 行数据`);

                const bRow = curClaimRow.subAreaDatas?.[BUDGET_CONSTANTS.boAreaId]?.rowDatas?.[0];
                const budgetRowId = bRow?.rowId || bRow?.datas?.BILL_ROW_ID?.value || row.budgetRowId;
                if (!budgetRowId) throw new Error('未找到预算区 RowId');

                let sceneVO = prepareBillSceneVO(currentBillData);
                currentBillData = await changeBillFieldValueApi(
                    BUDGET_CONSTANTS.fields.account.fieldCode,
                    BUDGET_CONSTANTS.fields.account.fieldName,
                    BUDGET_CONSTANTS.fields.account.fieldId,
                    { value: STATE.selectedAccount.value, title: { zh_CN: accountTitle } },
                    budgetRowId, sceneVO
                );

                if (isProjBudget && STATE.selectedProject?.value) {
                    sceneVO = prepareBillSceneVO(currentBillData);
                    currentBillData = await changeBillFieldValueApi(
                        BUDGET_CONSTANTS.fields.project.fieldCode,
                        BUDGET_CONSTANTS.fields.project.fieldName,
                        BUDGET_CONSTANTS.fields.project.fieldId,
                        { value: STATE.selectedProject.value, title: { zh_CN: STATE.selectedProject.title } },
                        budgetRowId, sceneVO
                    );
                } else if (!isProjBudget && STATE.selectedCostCenter?.value) {
                    sceneVO = prepareBillSceneVO(currentBillData);
                    currentBillData = await changeBillFieldValueApi(
                        BUDGET_CONSTANTS.fields.costCenter.fieldCode,
                        BUDGET_CONSTANTS.fields.costCenter.fieldName,
                        BUDGET_CONSTANTS.fields.costCenter.fieldId,
                        { value: STATE.selectedCostCenter.value, title: { zh_CN: costCenterTitle } },
                        budgetRowId, sceneVO
                    );
                }

                sceneVO = prepareBillSceneVO(currentBillData);
                currentBillData = await changeBillFieldValueApi(
                    BUDGET_CONSTANTS.fields.khfd.fieldCode,
                    BUDGET_CONSTANTS.fields.khfd.fieldName,
                    BUDGET_CONSTANTS.fields.khfd.fieldId,
                    { value: STATE.selectedKhfd.value, title: { zh_CN: khfdTitle } },
                    budgetRowId, sceneVO
                );

                row.status = '成功';
                successCount++;
            } catch (err) {
                console.error(`Fallback update failed on row ${row.rowNum}:`, err);
                row.status = '失败';
                failCount++;
            }
            renderBillTable();
        }

        STATE.currentBillData = currentBillData;

        logText.innerText = `降级串行模式: 正在保存...`;
        try {
            const savedData = await saveBillDataApi(currentBillData);
            STATE.currentBillData = savedData;
            parseBillData(savedData);
        } catch (saveErr) {
            alert(`⚠️ 降级模式保存也失败: ${saveErr.message}`);
            btnExec.disabled = false;
            btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
            return;
        }

        btnExec.disabled = false;
        btnExec.innerText = `🚀 批量修改预算归属并向客户请款`;
        renderBillTable();
        logText.innerText = `降级串行模式完成！成功: ${successCount} 条，失败: ${failCount} 条。`;

        const doReload = confirm(
            `✅ 降级串行模式完成！\n成功: ${successCount} 条，失败: ${failCount} 条\n\n点击【确定】刷新页面！`
        );
        if (doReload) window.location.reload();
    }

    // ==========================================
    // 8. 模式 A: 智能往返行程推断 (发票夹/费用记录)
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
        if (targetIndices.length === 0) targetIndices = visibleIndices;

        const taxiIndices = targetIndices.filter(idx => STATE.invoices[idx] && STATE.invoices[idx].type === 'TAXI');
        if (taxiIndices.length === 0) {
            if (showNotice) alert('当前分组下未找到出租车发票！');
            return;
        }

        const dateGroups = {};
        taxiIndices.forEach(idx => {
            const row = STATE.invoices[idx];
            const dt = normalizeDate(row.invoiceDate) || '未知日期';
            if (!dateGroups[dt]) dateGroups[dt] = [];
            dateGroups[dt].push(idx);
        });

        let filledCount = 0;
        let uncertainDates = [];

        Object.keys(dateGroups).forEach(dt => {
            const dayIndices = dateGroups[dt];
            dayIndices.sort((i1, i2) => normalizeTime(STATE.invoices[i1].timeGetOn).localeCompare(normalizeTime(STATE.invoices[i2].timeGetOn)));

            if (dayIndices.length === 2) {
                const idx1 = dayIndices[0];
                const idx2 = dayIndices[1];
                STATE.invoices[idx1].startAddress = company;
                STATE.invoices[idx1].endAddress = customer;
                if (customDesc) STATE.invoices[idx1].description = customDesc;
                STATE.invoices[idx2].startAddress = customer;
                STATE.invoices[idx2].endAddress = company;
                if (customDesc) STATE.invoices[idx2].description = customDesc;
                filledCount += 2;
            } else if (dayIndices.length === 1) {
                const idx1 = dayIndices[0];
                const hour = parseInt(normalizeTime(STATE.invoices[idx1].timeGetOn).split(':')[0]) || 0;
                if (hour < 14) {
                    STATE.invoices[idx1].startAddress = company;
                    STATE.invoices[idx1].endAddress = customer;
                } else {
                    STATE.invoices[idx1].startAddress = customer;
                    STATE.invoices[idx1].endAddress = company;
                }
                if (customDesc) STATE.invoices[idx1].description = customDesc;
                filledCount += 1;
            } else {
                const firstIdx = dayIndices[0];
                const lastIdx = dayIndices[dayIndices.length - 1];
                STATE.invoices[firstIdx].startAddress = company;
                STATE.invoices[firstIdx].endAddress = customer;
                if (customDesc) STATE.invoices[firstIdx].description = customDesc;
                STATE.invoices[lastIdx].startAddress = customer;
                STATE.invoices[lastIdx].endAddress = company;
                if (customDesc) STATE.invoices[lastIdx].description = customDesc;
                for (let k = 1; k < dayIndices.length - 1; k++) {
                    const midIdx = dayIndices[k];
                    STATE.invoices[midIdx].startAddress = '';
                    STATE.invoices[midIdx].endAddress = '';
                    if (customDesc) STATE.invoices[midIdx].description = customDesc;
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

    // ==========================================
    // 9. 事件绑定与初始化
    // ==========================================
    function bindEvents() {
        const btn = document.getElementById('yn-batch-helper-btn');
        const modal = document.getElementById('yn-batch-modal');
        const mask = document.getElementById('yn-modal-mask');
        const closeBtn = document.getElementById('yn-modal-close');
        const cancelBtn = document.getElementById('yn-btn-cancel-modal');

        if (!btn || !modal) return;

        const openModal = () => {
            modal.style.display = 'flex';
            mask.style.display = 'block';
            updateTokenStatus();

            if (STATE.pageMode === 'BILL') {
                if (STATE.currentBillData) {
                    parseBillData(STATE.currentBillData);
                } else if (STATE.currentBillMainId) {
                    fetchBillDataAndTemplateApi(STATE.currentBillMainId);
                }
                renderBillTable();
                if (STATE.activeBillTag) {
                    triggerProjectSearch(STATE.activeBillTag);
                }
            } else {
                renderInvoiceTable();
            }
        };

        const closeModal = () => {
            modal.style.display = 'none';
            mask.style.display = 'none';
        };

        btn.addEventListener('click', openModal);
        mask.addEventListener('click', closeModal);
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        // 报销单模式专用事件 (预设切换 / 下拉联动)
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
                    if (tag) await triggerProjectSearch(tag);
                    renderBillTable();
                });
            }

            if (thSelectAll) {
                thSelectAll.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        STATE.billRows.forEach((_, idx) => STATE.billSelectedIndices.add(idx));
                    } else {
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
                    const match = STATE.projectSearchResults.find(p => p.id === val);
                    if (match) {
                        STATE.selectedProject = { value: match.id, title: match.title };
                    }
                    renderBillTable();
                });
            }

            if (btnReload) {
                btnReload.addEventListener('click', async () => {
                    if (STATE.currentBillMainId) {
                        await fetchBillDataAndTemplateApi(STATE.currentBillMainId);
                        alert('已重新读取报销单最新数据！');
                    } else {
                        alert('未检测到报销单 ID，请在报销单页面操作后重试。');
                    }
                });
            }

            if (btnExec) {
                btnExec.addEventListener('click', executeBatchBillBudgetUpdate);
            }
        } else {
            // 发票夹/费用记录模式事件
            document.querySelectorAll('.yn-tab-btn').forEach(tab => {
                tab.addEventListener('click', () => {
                    const grp = tab.getAttribute('data-group');
                    STATE.activeGroup = grp;
                    document.querySelectorAll('.yn-tab-btn').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    document.getElementById('yn-quick-bar-taxi').style.display = (grp === 'TAXI' || grp === 'ALL') ? 'flex' : 'none';
                    document.getElementById('yn-quick-bar-comm').style.display = grp === 'COMMUNICATION' ? 'flex' : 'none';
                    renderInvoiceTable();
                });
            });

            const btnFetch = document.getElementById('yn-btn-fetch-all');
            if (btnFetch) btnFetch.addEventListener('click', fetchAllPendingData);
            const btnCommute = document.getElementById('yn-btn-smart-commute');
            if (btnCommute) btnCommute.addEventListener('click', () => executeSmartCommuteInference(true));
            const btnSave = document.getElementById('yn-btn-batch-save');
            if (btnSave) btnSave.addEventListener('click', executeBatchSave);
        }
    }

    // ==========================================
    // 10. 模式 A 表格渲染与数据加载
    // ==========================================
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

            const poolList = await queryInvoicePoolListApi();
            const poolInvoices = await mapConcurrent(poolList, 8, async (pItem) => {
                const dataId = pItem.boSourceRowId || (pItem.datas && pItem.datas.ID ? pItem.datas.ID.value : '');
                if (!dataId) return null;
                try {
                    const invDetail = await getInvoiceDetailByDataIdApi(dataId);
                    return { dataId, invDetail, pItem };
                } catch (e) { return null; }
            });

            const invoiceOcrMap = new Map();
            poolInvoices.forEach(item => {
                if (!item || !item.invDetail) return;
                const inv = item.invDetail;
                if (inv.invoiceNo) invoiceOcrMap.set(inv.invoiceNo, inv);
                if (item.dataId) invoiceOcrMap.set(item.dataId, inv);
                if (inv.invoiceDate && inv.amountTax !== undefined) {
                    invoiceOcrMap.set(`${normalizeDate(inv.invoiceDate)}_${inv.amountTax}`, inv);
                }
            });

            const recordList = await queryExpenseRecordListApi();
            const parsedRecords = await mapConcurrent(recordList, 8, async (item) => {
                const recId = item.expenseRecordId;
                if (!recId) return null;
                try {
                    const ruleData = await getExpenseTypeRuleAndRowDatasApi(recId, item.expenseTypeId || 'UNIDENTIFIED');
                    const rowDatas = ruleData.rowDatas || {};
                    const v = ruleData.version || 1;

                    let invVO = {};
                    const invListField = rowDatas.expenseRecordInvoiceList;
                    if (invListField && invListField.value && invListField.value.length > 0) {
                        invVO = invListField.value[0].invoiceVO || {};
                    }

                    let matchedInv = null;
                    if (invVO.invoiceNo && invoiceOcrMap.has(invVO.invoiceNo)) matchedInv = invoiceOcrMap.get(invVO.invoiceNo);
                    else if (invVO.invoiceDataId && invoiceOcrMap.has(invVO.invoiceDataId)) matchedInv = invoiceOcrMap.get(invVO.invoiceDataId);
                    else if (item.businessDate && item.amountObj) {
                        const key = `${normalizeDate(item.businessDate)}_${item.amountObj.amount}`;
                        if (invoiceOcrMap.has(key)) matchedInv = invoiceOcrMap.get(key);
                    }

                    if (matchedInv) {
                        if (!invVO.timeGetOn && matchedInv.timeGetOn) invVO.timeGetOn = matchedInv.timeGetOn;
                        if (!invVO.timeGetOff && matchedInv.timeGetOff) invVO.timeGetOff = matchedInv.timeGetOff;
                        if (!invVO.mileage && matchedInv.mileage) invVO.mileage = matchedInv.mileage;
                        if (!invVO.salesName && (matchedInv.salesName || matchedInv.seller)) invVO.salesName = matchedInv.salesName || matchedInv.seller;
                        if (!invVO.seller && (matchedInv.seller || matchedInv.salesName)) invVO.seller = matchedInv.seller || matchedInv.salesName;
                        if (!invVO.invoiceNo && matchedInv.invoiceNo) invVO.invoiceNo = matchedInv.invoiceNo;
                        if (!invVO.invoiceCode && matchedInv.invoiceCode) invVO.invoiceCode = matchedInv.invoiceCode;
                        if (matchedInv.invoiceDataId) invVO.invoiceDataId = matchedInv.invoiceDataId;
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
                } catch (e) {
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
                    processedRecordIds.add(r.expenseRecordId);
                    if (r.invoiceVO && r.invoiceVO.invoiceDataId) processedInvoiceDataIds.add(r.invoiceVO.invoiceDataId);
                    if (r.invoiceNo) processedInvoiceNos.add(r.invoiceNo);
                }
            });

            poolInvoices.forEach(item => {
                if (!item || !item.invDetail) return;
                const invDetail = item.invDetail;
                const dataId = item.dataId;
                const invNo = invDetail.invoiceNo || '';

                if (processedInvoiceDataIds.has(dataId) || (invNo && processedInvoiceNos.has(invNo))) return;

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
        } catch (err) {
            alert(`同步失败: ${err.message}`);
        } finally {
            if (btnFetch) {
                btnFetch.disabled = false;
                btnFetch.innerText = originalText;
            }
        }
    }

    function renderInvoiceTable() {
        if (STATE.pageMode === 'BILL') return;

        const thead = document.getElementById('yn-table-thead');
        const tbody = document.getElementById('yn-table-tbody');
        const countInfo = document.getElementById('yn-select-count-info');
        const btnSave = document.getElementById('yn-btn-batch-save');
        const grp = STATE.activeGroup;

        if (!thead || !tbody) return;

        const taxiCount = STATE.invoices.filter(r => r.type === 'TAXI').length;
        const commCount = STATE.invoices.filter(r => r.type === 'COMMUNICATION').length;
        const countTaxiEl = document.getElementById('yn-count-taxi');
        const countCommEl = document.getElementById('yn-count-comm');
        const countAllEl = document.getElementById('yn-count-all');
        if (countTaxiEl) countTaxiEl.innerText = taxiCount;
        if (countCommEl) countCommEl.innerText = commCount;
        if (countAllEl) countAllEl.innerText = STATE.invoices.length;

        const visibleIndices = [];
        STATE.invoices.forEach((row, idx) => {
            if (grp === 'ALL' || row.type === grp) visibleIndices.push(idx);
        });

        let selectedInView = 0;
        visibleIndices.forEach(idx => {
            if (STATE.selectedIndices.has(idx)) selectedInView++;
        });

        const grpName = grp === 'TAXI' ? '出租车' : (grp === 'COMMUNICATION' ? '通信费' : '全部');
        if (countInfo) countInfo.innerText = `当前【${grpName}】已勾选 ${selectedInView} / ${visibleIndices.length} 行 (总计 ${STATE.invoices.length} 笔)`;
        if (btnSave) btnSave.innerText = `🚀 批量保存当前【${grpName}】已勾选记录 (${selectedInView} 条)`;

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
        } else if (grp === 'COMMUNICATION') {
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
        } else {
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
                    if (e.target.checked) STATE.selectedIndices.add(idx);
                    else STATE.selectedIndices.delete(idx);
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
            if (isSelected) tr.className = 'selected';

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
                    <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(row.amount || 0).toFixed(2)}</span></td>
                    <td><input type="text" data-idx="${realIdx}" data-field="startAddress" value="${row.startAddress || ''}" placeholder="如: IVISION" /></td>
                    <td style="text-align:center;"><button class="yn-swap-btn" data-idx="${realIdx}">⇄</button></td>
                    <td><input type="text" data-idx="${realIdx}" data-field="endAddress" value="${row.endAddress || ''}" placeholder="如: CMP" /></td>
                    <td><input type="text" data-idx="${realIdx}" data-field="description" value="${row.description || ''}" placeholder="选填" /></td>
                    <td><span style="font-family:monospace; color:#595959; font-size:11px;">${row.invoiceNo || '-'}</span></td>
                    <td style="text-align:center;"><span class="yn-status-tag ${row.status === '成功' ? 'yn-status-success' : (row.status === '失败' ? 'yn-status-error' : 'yn-status-pending')}">${row.status || '就绪'}</span></td>
                `;
            } else if (grp === 'COMMUNICATION') {
                tr.innerHTML = `
                    <td style="text-align:center;"><input type="checkbox" class="yn-row-check" data-idx="${realIdx}" ${isSelected ? 'checked' : ''} /></td>
                    <td style="text-align:center; color:#8c8c8c;">${rowNum + 1}</td>
                    <td>${typeSelectorHtml}</td>
                    <td><input type="date" data-idx="${realIdx}" data-field="invoiceDate" value="${row.invoiceDate || ''}" style="font-size:11.5px;" /></td>
                    <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(row.amount || 0).toFixed(2)}</span></td>
                    <td><input type="text" data-idx="${realIdx}" data-field="period" value="${row.period || ''}" placeholder="如: 2026-05" /></td>
                    <td><input type="text" data-idx="${realIdx}" data-field="description" value="${row.description || ''}" placeholder="选填" /></td>
                    <td><div class="yn-dropzone" data-idx="${realIdx}"><span class="yn-dropzone-prompt">📎 拖入/选择账单PDF</span><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style="display:none;" /></div></td>
                    <td><span style="font-family:monospace; color:#595959; font-size:11px;">${row.invoiceNo || '-'}</span></td>
                    <td style="text-align:center;"><span class="yn-status-tag ${row.status === '成功' ? 'yn-status-success' : (row.status === '失败' ? 'yn-status-error' : 'yn-status-pending')}">${row.status || '就绪'}</span></td>
                `;
            } else {
                tr.innerHTML = `
                    <td style="text-align:center;"><input type="checkbox" class="yn-row-check" data-idx="${realIdx}" ${isSelected ? 'checked' : ''} /></td>
                    <td style="text-align:center; color:#8c8c8c;">${rowNum + 1}</td>
                    <td>${typeSelectorHtml}</td>
                    <td><input type="date" data-idx="${realIdx}" data-field="invoiceDate" value="${row.invoiceDate || ''}" style="font-size:11px;" /></td>
                    <td><div class="yn-time-badge">${row.timeGetOn || '-'} ~ ${row.timeGetOff || '-'}</div></td>
                    <td><span style="font-weight:600; color:#fa8c16;">¥${parseFloat(row.amount || 0).toFixed(2)}</span></td>
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
                if (e.target.checked) STATE.selectedIndices.add(idx);
                else STATE.selectedIndices.delete(idx);
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
                        STATE.invoices[idx].period = computePeriod(STATE.invoices[idx].invoiceDate, isComm);
                        if (!isComm && !STATE.invoices[idx].startAddress) STATE.invoices[idx].startAddress = 'IVISION';
                        if (!isComm && !STATE.invoices[idx].endAddress) STATE.invoices[idx].endAddress = 'CMP';
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
                    recordId = await createDraftExpenseRecordFromInvoiceApi(row.invoiceVO, row.boDataId || row.invoiceVO.invoiceDataId);
                    row.expenseRecordId = recordId;
                }

                const ruleData = await getExpenseTypeRuleAndRowDatasApi(recordId, 'UNIDENTIFIED');
                const version = ruleData.version !== undefined ? ruleData.version : 1;
                const baseRowDatas = ruleData.rowDatas || {};

                const initData = await initExpenseRecordWithTypeApi(recordId, targetExpenseTypeConfig.id, baseRowDatas);
                const rowDatas = initData.rowDatas || {};

                const cleanPeriod = (row.period || computePeriod(row.invoiceDate, row.type === 'COMMUNICATION')).replace(/^期间[：:]\s*/, '').trim();

                if (row.type === 'TAXI') {
                    if (rowDatas.START_ADDRESS) rowDatas.START_ADDRESS.value = row.startAddress || 'IVISION';
                    if (rowDatas.END_ADDRESS) rowDatas.END_ADDRESS.value = row.endAddress || 'CMP';
                    if (rowDatas.DESCRIPTION) rowDatas.DESCRIPTION.value = row.description ? row.description.trim() : '';
                    if (rowDatas.F_ZY_DEF_001) rowDatas.F_ZY_DEF_001.value = cleanPeriod;
                } else if (row.type === 'COMMUNICATION') {
                    const yyyy_mm = cleanPeriod.length >= 7 ? cleanPeriod.substring(0, 7) : computePeriod(row.invoiceDate, true);
                    if (rowDatas.FLIGHT_START_DATE) rowDatas.FLIGHT_START_DATE.value = `${yyyy_mm}-01 00:00:00`;
                    if (rowDatas.F_ZY_DEF_001) rowDatas.F_ZY_DEF_001.value = yyyy_mm;
                    if (rowDatas.DESCRIPTION) rowDatas.DESCRIPTION.value = row.description ? row.description.trim() : '';
                    if (row.attachments && row.attachments.length > 0) {
                        rowDatas.expenseRecordAttachmentList = { value: row.attachments };
                        const firstAtt = row.attachments[0];
                        if (rowDatas.ATTACH_NAME) rowDatas.ATTACH_NAME.value = (firstAtt.fileName || '账单').replace(/\.[^/.]+$/, "");
                        if (rowDatas.ATTACH_COUNT) rowDatas.ATTACH_COUNT.value = row.attachments.length;
                    }
                }

                await saveFinalExpenseRecordApi(recordId, targetExpenseTypeConfig.id, rowDatas, version);
                row.status = '成功';
                successCount++;
            } catch (err) {
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
    // 11. 初始化挂载
    // ==========================================
    function checkAndMount() {
        const mode = detectPageMode();
        if (mode) {
            extractUrlParams();
            createUI();
        }
    }

    window.addEventListener('DOMContentLoaded', checkAndMount);
    window.addEventListener('hashchange', checkAndMount);
    window.addEventListener('popstate', checkAndMount);

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        checkAndMount();
    }
})();
