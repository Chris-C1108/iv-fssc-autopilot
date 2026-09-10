import { initializeWebMCPPolyfill } from '@mcp-b/webmcp-polyfill';
import { GlobalState, TripApplicationConfig, InvoiceItem, ExpensePlanOptions, A2UiRootAST } from '../types/state';
import {
    fetchPersonnelVO,
    fetchCityVO,
    fetchProjectVO,
    fetchLoginUserInfo,
    createDynamicTripConfig,
    combineTripsForMainApplicant,
    parseItineraryTable,
    DynamicTripInput,
    createSingleTripApplicationApi,
    fetchHistoricalTripApplications,
    crossCheckWithHistoricalApplications
} from './applicationService';
import {
    saveSingleExpenseItemApi,
    batchSaveExpenseItemsApi,
    queryInvoicePoolListApi,
    queryExpenseRecordListApi,
    loadAllInvoicesAndExpenses,
    deleteExpenseRecordListApi,
    deleteInvoiceBOListApi,
    auditExpenseRecordsApi,
    autoFixExpenseRecordsApi,
    fetchExpenseRecordsWithInvoiceDetails,
    convertExpenseRecordsToCsv,
    downloadCsvFile
} from './expenseService';
import {
    deleteBillByBillMainIdsApi,
    createBillDataAndTemplateByExpenseIdListApi,
    fetchBillDataAndTemplateApi,
    parseBillDataStructure
} from './billService';

import { inferSmartExpensePlan, detectInvoiceCategory } from './commuteService';
import { generateExpenseBatchA2UiAST, renderA2UiFromAST, renderA2UiExpenseBatchWidget } from '../ui/webmcpA2Ui';
import { TRIP_CONSTANTS } from '../config/constants';
import { recordTrajectoryEvent } from './trajectoryService';
import { validateInvoiceList } from './invoiceValidationService';
import { AutopilotLogger } from '../utils/logger';
import { showToast } from '../utils/toast';
import { normalizeDate } from '../utils/date';

export interface WebMcpToolLog {
    id: string;
    timestamp: string;
    toolName: string;
    parameters: any;
    result?: any;
    error?: string;
    durationMs: number;
}

export interface WebMcpToolDef {
    name: string;
    description: string;
    inputSchema: any;
    execute: (params: any) => Promise<any>;
}

export interface WebMcpServiceState {
    initialized: boolean;
    registeredTools: string[];
    toolDefs: WebMcpToolDef[];
    toolMap: Map<string, (params: any) => Promise<any>>;
    logs: WebMcpToolLog[];
    listeners: Array<(log: WebMcpToolLog) => void>;
}

export const WEBMCP_STATE: WebMcpServiceState = {
    initialized: false,
    registeredTools: [],
    toolDefs: [],
    toolMap: new Map(),
    logs: [],
    listeners: []
};

// 监听 WebMCP 调用日志
export function onWebMcpToolExecuted(cb: (log: WebMcpToolLog) => void) {
    WEBMCP_STATE.listeners.push(cb);
}

export async function callWebMcpTool(name: string, params: any = {}): Promise<any> {
    const fn = WEBMCP_STATE.toolMap.get(name);
    if (!fn) {
        throw new Error(`WebMCP 工具 [${name}] 未注册或未找到`);
    }
    return await fn(params);
}

function recordLog(log: WebMcpToolLog) {
    WEBMCP_STATE.logs.unshift(log);
    if (WEBMCP_STATE.logs.length > 50) WEBMCP_STATE.logs.pop();
    WEBMCP_STATE.listeners.forEach(cb => {
        try { cb(log); } catch (e) {}
    });

    // 同时录入 DeepSeek Harness 风格的全局 Trajectory 事件流
    recordTrajectoryEvent({
        source: log.error ? 'ERROR' : (log.toolName === 'fssc_get_applicant_context' ? 'CONTEXT' : 'TOOL_RESULT'),
        title: `WebMCP Tool: ${log.toolName}`,
        summary: log.error ? `Error: ${log.error}` : `Success (${log.durationMs}ms)`,
        durationMs: log.durationMs,
        data: {
            toolName: log.toolName,
            parameters: log.parameters,
            result: log.result,
            error: log.error
        }
    });
}

/**
 * 初始化 WebMCP Polyfill 并向 document.modelContext 注册出差申请全套工具集 (通用动态架构)
 */
export function initWebMcpSystem(state: GlobalState) {
    if (WEBMCP_STATE.initialized) return;

    try {
        // 1. 激活 W3C WebMCP 标准 Polyfill (在 document.modelContext 挂载标准环境)
        initializeWebMCPPolyfill();
        AutopilotLogger.info('[WebMCP] document.modelContext polyfill 已就绪');
    } catch (e: any) {
        AutopilotLogger.warn(`[WebMCP] 初始化 Polyfill 异常: ${e.message}`);
    }

    const doc = document as any;
    const hasModelContext = Boolean(doc.modelContext && typeof doc.modelContext.registerTool === 'function');
    if (!hasModelContext) {
        AutopilotLogger.warn('[WebMCP] 当前环境未检测到 document.modelContext.registerTool，使用内部注册模式');
    }

    // 2. 注册通用 WebMCP 工具集
    const tools = [
        {
            name: 'fssc_get_applicant_context',
            description: '动态获取当前登录用户主数据（姓名/工号/邮箱）、出差单据模板定义与公司差旅报销规程标准',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            execute: async () => {
                const startTime = Date.now();
                const userInfo = await fetchLoginUserInfo(state);
                const res = {
                    currentUser: {
                        userId: userInfo.userId || state.applicantId,
                        name: userInfo.userName,
                        userCode: userInfo.userCode || '',
                        email: userInfo.email || ''
                    },
                    billDefine: {
                        billDefineId: TRIP_CONSTANTS.billDefineId,
                        billDefineName: '出張伺書',
                        billTypeCode: TRIP_CONSTANTS.billTypeCode
                    },
                    regulations: {
                        hotelAllowance: {
                            tier1Cities: ['上海', '广州', '北京', '深圳'],
                            tier1Limit: 800,
                            tier2Limit: 700
                        },
                        mealAllowance: {
                            standardDaily: 300,
                            travelHalfDay: 150
                        }
                    }
                };
                recordLog({
                    id: Math.random().toString(36).substring(2, 9),
                    timestamp: new Date().toLocaleTimeString(),
                    toolName: 'fssc_get_applicant_context',
                    parameters: {},
                    result: res,
                    durationMs: Date.now() - startTime
                });
                return res;
            }
        },
        {
            name: 'fssc_query_employee',
            description: '在元年云人员维表中检索任意员工账号（用于驻场同事、项目组成员的出差代办申请）',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '员工姓名，例如：张三、李四等' }
                },
                required: ['name']
            },
            execute: async (params: { name: string }) => {
                const startTime = Date.now();
                try {
                    const vo = await fetchPersonnelVO(params.name, state);
                    const res = { success: true, person: vo };
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_query_employee',
                        parameters: params,
                        result: res,
                        durationMs: Date.now() - startTime
                    });
                    return res;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_query_employee',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_query_city',
            description: '在城市维表中检索城市代码与维表对象（用于旅程明细 F_FROM / F_TO）',
            inputSchema: {
                type: 'object',
                properties: {
                    cityName: { type: 'string', description: '城市名称，如 北京、上海、广州、深圳、天津、合肥等' }
                },
                required: ['cityName']
            },
            execute: async (params: { cityName: string }) => {
                const startTime = Date.now();
                const vo = await fetchCityVO(params.cityName, state);
                const res = { success: true, city: vo };
                recordLog({
                    id: Math.random().toString(36).substring(2, 9),
                    timestamp: new Date().toLocaleTimeString(),
                    toolName: 'fssc_query_city',
                    parameters: params,
                    result: res,
                    durationMs: Date.now() - startTime
                });
                return res;
            }
        },
        {
            name: 'fssc_query_project',
            description: '在项目维表中检索任意项目对象（用于预算区 DIM_PROJECT 联动归属）',
            inputSchema: {
                type: 'object',
                properties: {
                    projectNameOrCode: { type: 'string', description: '项目名称或项目编号（如 P2026-001 等）' }
                },
                required: ['projectNameOrCode']
            },
            execute: async (params: { projectNameOrCode: string }) => {
                const startTime = Date.now();
                const vo = await fetchProjectVO(params.projectNameOrCode, state);
                if (vo) {
                    state.selectedProject = {
                        value: vo.value,
                        title: vo.title?.zh_CN || vo.title
                    };
                }
                const res = { success: Boolean(vo), project: vo };
                recordLog({
                    id: Math.random().toString(36).substring(2, 9),
                    timestamp: new Date().toLocaleTimeString(),
                    toolName: 'fssc_query_project',
                    parameters: params,
                    result: res,
                    durationMs: Date.now() - startTime
                });
                return res;
            }
        },
        {
            name: 'fssc_query_historical_applications',
            description: '查询元年云系统中当前用户已保存（未提交草稿）或已提交的历史出差申请单据，用于规划时交叉对比排重',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            execute: async () => {
                const startTime = Date.now();
                const bills = await fetchHistoricalTripApplications(state);
                const res = { total: bills.length, list: bills };
                recordLog({
                    id: Math.random().toString(36).substring(2, 9),
                    timestamp: new Date().toLocaleTimeString(),
                    toolName: 'fssc_query_historical_applications',
                    parameters: {},
                    result: { total: bills.length, sample: bills.slice(0, 3) },
                    durationMs: Date.now() - startTime
                });
                return res;
            }
        },
        {
            name: 'fssc_plan_trip_applications',
            description: '通用智能差旅规划算力：基于动态行程列表（或表格文本解析），测算住宿、误餐、交通票价及市内弹性Buffer，生成可入库的出差申请单清单。注意：同一目的城市多次往返视为多轮独立出差，必须作为独立项传入，严禁合并！',
            inputSchema: {
                type: 'object',
                properties: {
                    trips: {
                        type: 'array',
                        description: '动态差旅行程列表。每一项代表一轮独立的往返出差（完整闭环）。同一目的地城市在不同时间段多次往返必须作为多项分别传入，绝不能合并！',
                        items: {
                            type: 'object',
                            properties: {
                                tripNo: { type: 'number', description: '出差轮次编号 (如第1轮为1，第2轮为2... 同一目的城市多次往返必须赋予不同的tripNo，绝不能合并)' },
                                applicantName: { type: 'string', description: '出行人姓名或主申请人' },
                                isProxy: { type: 'boolean', description: '是否为代办' },
                                destination: { type: 'string', description: '目的地城市' },
                                startDate: { type: 'string', description: '出差开始日期 (YYYY-MM-DD)' },
                                endDate: { type: 'string', description: '出差结束日期 (YYYY-MM-DD)' },
                                purpose: { type: 'string', description: '出差事由' },
                                targetFactories: { type: 'string', description: '调研公司/工厂/据点名称 (例如 某某据点、客户工厂、科技园区)' },
                                hotelName: { type: 'string', description: '入住酒店名称 (例如 亚朵酒店、美悦酒店)' },
                                travelers: { type: 'array', items: { type: 'string' }, description: '本轮同行出差人员名单(含正社员与外驻)' },
                                legs: {
                                    type: 'array',
                                    description: '往返大交通明细(飞机/高铁)',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            date: { type: 'string' },
                                            fromCity: { type: 'string' },
                                            toCity: { type: 'string' },
                                            transport: { type: 'string' },
                                            flightOrTrain: { type: 'string' },
                                            travelerName: { type: 'string' }
                                        }
                                    }
                                },
                                baseTrafficFee: { type: 'number', description: '预估往返交通费' },
                                hotelPricePerNight: { type: 'number', description: '每晚住宿限额标准(可选)' },
                                projectName: { type: 'string', description: '归属项目名称或代码(可选)' }
                            },
                            required: ['applicantName', 'destination', 'startDate', 'endDate']
                        }
                    },
                    itineraryText: {
                        type: 'string',
                        description: '如果用户上传或粘贴了表格文本或 CSV，可传入直接解析'
                    },
                    combineApplications: {
                        type: 'boolean',
                        description: '是否由正社员统一提单，合并同行外驻人员预算与多行旅程为单张申请单 (依据用户最新规约，默认 true)'
                    },
                    mainApplicantName: {
                        type: 'string',
                        description: '正社员(主申请人)姓名，若未提供则自动匹配当前登录用户'
                    },
                    cityBufferPerDay: { type: 'number', description: '市内交通Buffer(元/天)，默认100' },
                    trafficBufferPercent: { type: 'number', description: '交通改签弹性Buffer比例(0~0.5)，默认0.15' },
                    defaultProject: { type: 'string', description: '默认归属项目' }
                }
            },
            execute: async (params: {
                trips?: DynamicTripInput[];
                itineraryText?: string;
                combineApplications?: boolean;
                mainApplicantName?: string;
                cityBufferPerDay?: number;
                trafficBufferPercent?: number;
                defaultProject?: string;
            }) => {
                const startTime = Date.now();
                const cityBuf = params.cityBufferPerDay ?? 100;
                const trafBuf = params.trafficBufferPercent ?? 0.15;
                const shouldCombine = params.combineApplications !== false; // 默认按新规约合并
                const userInfo = await fetchLoginUserInfo(state);
                const mainApplicant = params.mainApplicantName || userInfo.userName || state.currentUser?.userName || '';

                let inputs: DynamicTripInput[] = [];

                if (params.itineraryText) {
                    inputs.push(...parseItineraryTable(params.itineraryText));
                }

                if (params.trips && Array.isArray(params.trips)) {
                    inputs.push(...params.trips);
                }

                // 如果未传入 trips，但之前已解析过状态，则对现有行程重新应用 Buffer
                if (inputs.length === 0 && state.tripApp && state.tripApp.rawInputs && state.tripApp.rawInputs.length > 0) {
                    inputs = state.tripApp.rawInputs;
                } else if (inputs.length === 0 && state.tripApp && state.tripApp.configs.length > 0) {
                    inputs = state.tripApp.configs.map(c => ({
                        tripNo: c.tripNo,
                        applicantName: c.applicantName,
                        isProxy: c.isProxy,
                        destination: c.destination,
                        startDate: c.startDate,
                        endDate: c.endDate,
                        purpose: c.purpose,
                        targetFactories: c.targetFactories,
                        hotelName: c.hotelName,
                        travelers: c.travelers,
                        baseTrafficFee: c.trafficFee - c.trafficBuffer,
                        projectName: c.projectName,
                        legs: c.legs
                    }));
                }

                // 如果传入了默认项目，赋给未指定项目的行
                if (params.defaultProject) {
                    inputs.forEach(inp => {
                        if (!inp.projectName) inp.projectName = params.defaultProject;
                    });
                }

                let configs: TripApplicationConfig[] = [];
                if (shouldCombine) {
                    configs = combineTripsForMainApplicant(inputs, mainApplicant, cityBuf, trafBuf);
                } else {
                    configs = inputs.map((inp, idx) =>
                        createDynamicTripConfig(inp, cityBuf, trafBuf, idx + 1)
                    );
                }

                // 核心特性：自动拉取元年历史出差申请单并与本次规划进行交叉对比排重
                let historyBills: any[] = [];
                try {
                    historyBills = await fetchHistoricalTripApplications(state);
                    crossCheckWithHistoricalApplications(configs, historyBills);
                } catch (e: any) {
                    AutopilotLogger.warn(`[WebMCP] 历史单据交叉比对失败: ${e.message}`);
                }

                if (!state.tripApp) {
                    state.tripApp = {
                        configs: [],
                        rawInputs: inputs,
                        mode: shouldCombine ? 'COMBINED' : 'SEPARATE',
                        selectedTripIds: new Set(),
                        isProcessing: false,
                        progressText: '',
                        cityBufferPerDay: cityBuf,
                        trafficBufferPercent: trafBuf,
                        cityCache: {},
                        personCache: {},
                        projectCache: {}
                    };
                }

                state.tripApp.rawInputs = inputs;
                state.tripApp.mode = shouldCombine ? 'COMBINED' : 'SEPARATE';
                state.tripApp.configs = configs;
                state.tripApp.selectedTripIds = new Set(configs.map(c => c.id));
                state.tripApp.cityBufferPerDay = cityBuf;
                state.tripApp.trafficBufferPercent = trafBuf;

                const totalAmount = configs.reduce((s, c) => s + c.totalAmount, 0);
                const res = {
                    totalBills: configs.length,
                    mode: state.tripApp.mode,
                    combined: shouldCombine,
                    totalBudgetWithBuffer: totalAmount,
                    bufferSettings: { cityBufferPerDay: cityBuf, trafficBufferPercent: trafBuf },
                    historicalBillsCount: historyBills.length,
                    configs: configs
                };

                recordLog({
                    id: Math.random().toString(36).substring(2, 9),
                    timestamp: new Date().toLocaleTimeString(),
                    toolName: 'fssc_plan_trip_applications',
                    parameters: { count: configs.length, combined: shouldCombine, cityBuf, trafBuf },
                    result: { totalBills: configs.length, mode: state.tripApp.mode, totalBudgetWithBuffer: totalAmount },
                    durationMs: Date.now() - startTime
                });

                return res;
            }
        },
        {
            name: 'fssc_create_trip_draft',
            description: '向元年云系统保存创建单张出差申请单草稿（commit: false，仅保存草稿入库，绝不提交审批）',
            inputSchema: {
                type: 'object',
                properties: {
                    tripConfig: { type: 'object', description: '单张出差申请的配置对象' }
                },
                required: ['tripConfig']
            },
            execute: async (params: { tripConfig: TripApplicationConfig }) => {
                const startTime = Date.now();
                try {
                    const res = await createSingleTripApplicationApi(params.tripConfig, state);
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_create_trip_draft',
                        parameters: { applicant: params.tripConfig.applicantName, destination: params.tripConfig.destination },
                        result: res,
                        durationMs: Date.now() - startTime
                    });
                    return res;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_create_trip_draft',
                        parameters: { applicant: params.tripConfig.applicantName, destination: params.tripConfig.destination },
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_batch_create_trip_drafts',
            description: '批量向元年云写入出差申请单草稿（需审批门禁，执行批量入库）',
            inputSchema: {
                type: 'object',
                properties: {
                    tripConfigs: { type: 'array', description: '已规划的出差申请单列表' }
                },
                required: ['tripConfigs']
            },
            execute: async (params: { tripConfigs: TripApplicationConfig[] }) => {
                const startTime = Date.now();
                const results: any[] = [];
                const errors: Array<{ tripNo?: number; applicant: string; destination: string; error: string }> = [];
                let successCount = 0;
                let failCount = 0;

                for (const config of params.tripConfigs) {
                    const r = await createSingleTripApplicationApi(config, state);
                    if (r.success) {
                        successCount++;
                        results.push({ billCode: r.billCode, applicant: config.applicantName, destination: config.destination });
                    } else {
                        failCount++;
                        errors.push({
                            tripNo: config.tripNo,
                            applicant: config.applicantName,
                            destination: config.destination,
                            error: r.message || '保存单据时出错'
                        });
                    }
                    await new Promise(res => setTimeout(res, 400));
                }

                const res = {
                    total: params.tripConfigs.length,
                    successCount,
                    failCount,
                    createdBills: results,
                    errors: errors
                };

                if (errors.length > 0) {
                    recordTrajectoryEvent({
                        source: 'ERROR',
                        title: `Batch Draft Creation (${errors.length}/${params.tripConfigs.length} failed)`,
                        summary: `批量创建出差申请草稿异常: ${errors.map(e => `Trip ${e.tripNo || '?'}[${e.destination}]: ${e.error}`).join('; ')}`,
                        data: { errors, total: params.tripConfigs.length, successCount, failCount }
                    });
                }

                recordLog({
                    id: Math.random().toString(36).substring(2, 9),
                    timestamp: new Date().toLocaleTimeString(),
                    toolName: 'fssc_batch_create_trip_drafts',
                    parameters: { count: params.tripConfigs.length },
                    result: res,
                    durationMs: Date.now() - startTime
                });

                return res;
            }
        },
        {
            name: 'fssc_query_pending_expenses',
            description: '查询发票夹待处理发票及未报销费用记录列表（包含金额、日期、OCR上下车时间、里程、出发到达地及当前费用类型）',
            inputSchema: {
                type: 'object',
                properties: {
                    forceRefresh: { type: 'boolean', description: '是否强制从后端API重新拉取' }
                }
            },
            execute: async (params: { forceRefresh?: boolean }) => {
                const startTime = Date.now();
                try {
                    // 若当前内存中无发票数据或要求强制刷新，自动穿透后端 API 拉取发票夹池与费用记录
                    if (!state.invoices || state.invoices.length === 0 || params.forceRefresh) {
                        await loadAllInvoicesAndExpenses(state);
                    }

                    // 容灾与场景适配：若发票夹与费用记录列表返回0条，检测是否在报销单编辑页 (#billWrite)
                    if (!state.invoices || state.invoices.length === 0) {
                        let billMainId = state.currentBillMainId;
                        if (!billMainId) {
                            const hash = window.location.hash || '';
                            const match = hash.match(/billMainId=([a-zA-Z0-9_\-]+)/) || hash.match(/id=([a-zA-Z0-9_\-]+)/);
                            if (match) billMainId = match[1];
                        }
                        if (!billMainId) {
                            const search = window.location.search || '';
                            const match = search.match(/billMainId=([a-zA-Z0-9_\-]+)/) || search.match(/id=([a-zA-Z0-9_\-]+)/);
                            if (match) billMainId = match[1];
                        }
                        if (billMainId && (!state.billRows || state.billRows.length === 0)) {
                            try {
                                const { billData } = await fetchBillDataAndTemplateApi(billMainId, state);
                                state.currentBillData = billData;
                                const parsed = parseBillDataStructure(billData);
                                state.billRows = parsed.billRows;
                                state.billTags = parsed.billTags;
                            } catch (e: any) {
                                AutopilotLogger.warn(`[WebMCP] 自动拉取报销单明细行失败: ${e.message}`);
                            }
                        }

                        if (state.billRows && state.billRows.length > 0) {
                            state.invoices = state.billRows.map((row, idx) => ({
                                id: row.claimRowId || `bill-row-${idx}`,
                                expenseRecordId: row.claimRowId,
                                invoiceDate: '',
                                amount: row.amount,
                                type: detectInvoiceCategory({}, {}, row.expTypeName),
                                expenseTypeName: row.expTypeName || '市内交通费',
                                startAddress: '',
                                endAddress: '',
                                description: row.recDesc || '',
                                status: '就绪',
                                isModified: false
                            }));
                        }
                    }

                    const errorItems = (state.invoices || []).filter(inv => inv.errorMessages && inv.errorMessages.length > 0);
                    const list = (state.invoices || []).map((inv, idx) => ({
                        index: idx,
                        recordId: inv.expenseRecordId || '',
                        date: inv.invoiceDate,
                        amount: inv.amount,
                        type: inv.type,
                        typeName: inv.expenseTypeName || inv.type,
                        startAddress: inv.startAddress || '',
                        endAddress: inv.endAddress || '',
                        description: inv.description || '',
                        timeGetOn: inv.timeGetOn || '',
                        timeGetOff: inv.timeGetOff || '',
                        mileage: inv.mileage || '',
                        status: inv.status,
                        errorMessages: inv.errorMessages || []
                    }));

                    const res = {
                        total: list.length,
                        hasErrors: errorItems.length > 0,
                        errorCount: errorItems.length,
                        errorSummary: errorItems.map(e => ({ recordId: e.expenseRecordId, type: e.type, errors: e.errorMessages })),
                        invoices: list
                    };

                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_query_pending_expenses',
                        parameters: params,
                        result: { total: list.length, errorCount: errorItems.length, sample: list.slice(0, 3) },
                        durationMs: Date.now() - startTime
                    });

                    return res;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_query_pending_expenses',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_validate_invoice_pool',
            description: '全量体检发票夹未使用发票列表，严格校验发票金额、开票日期、发票号码及销方品名等必要字段，识别OCR识别残缺发票并输出诊断结果与修改建议',
            inputSchema: {
                type: 'object',
                properties: {
                    forceRefresh: { type: 'boolean', description: '是否强制穿透后端API重新拉取发票夹全量数据' },
                    onlyInvalid: { type: 'boolean', description: '是否仅返回缺少必要字段的残缺发票' }
                }
            },
            execute: async (params: { forceRefresh?: boolean; onlyInvalid?: boolean }) => {
                const startTime = Date.now();
                try {
                    if (!state.invoices || state.invoices.length === 0 || params.forceRefresh) {
                        await loadAllInvoicesAndExpenses(state);
                    }

                    const summary = validateInvoiceList(state.invoices || []);
                    const targetList = params.onlyInvalid ? summary.invalidList : summary.results;

                    const res = {
                        totalCount: summary.totalCount,
                        validCount: summary.validCount,
                        invalidCount: summary.invalidCount,
                        warningCount: summary.warningCount,
                        missingAmountCount: summary.missingAmountCount,
                        missingDateCount: summary.missingDateCount,
                        missingInvoiceNoCount: summary.missingInvoiceNoCount,
                        missingTypeCount: summary.missingTypeCount,
                        isAllValid: summary.invalidCount === 0,
                        diagnostics: summary.invalidCount === 0
                            ? `✅ 恭喜！当前发票夹中全部 ${summary.totalCount} 张发票关键信息（金额、日期、发票号）100% 完备。`
                            : `⚠️ 警告：共发现 ${summary.invalidCount} 张发票缺少必要字段！其中：缺少金额 ${summary.missingAmountCount} 张，缺少开票日期 ${summary.missingDateCount} 张，缺少发票号码 ${summary.missingInvoiceNoCount} 张。已在发票夹宿主表格标红并强化【修改】链接，请及时修改补齐！`,
                        invoices: targetList
                    };

                    recordTrajectoryEvent({
                        source: 'TOOL_RESULT',
                        title: `Invoice Pool Validation (${summary.invalidCount}/${summary.totalCount} issues)`,
                        summary: res.diagnostics,
                        data: {
                            total: summary.totalCount,
                            valid: summary.validCount,
                            invalid: summary.invalidCount,
                            missingAmount: summary.missingAmountCount,
                            missingDate: summary.missingDateCount,
                            missingInvoiceNo: summary.missingInvoiceNoCount
                        }
                    });

                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_validate_invoice_pool',
                        parameters: params,
                        result: { invalidCount: summary.invalidCount, total: summary.totalCount },
                        durationMs: Date.now() - startTime
                    });

                    return res;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_validate_invoice_pool',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_generate_expense_from_invoices',
            description: '从发票夹中将未报销发票智能批量生成费用记录草稿。核心业务特性：智能识别过路费/通行费发票，并自动与同日同行程的出租车发票合并在同一笔费用中（即1笔费用挂载2张发票，金额累加，发票张数标为2，并在费用说明中注明含过路费明细）。支持按日期筛选（例如 2026-07-31）、指定发票ID或全量生成，并在副驾界面提供交互式 A2UI 确认卡片。',
            inputSchema: {
                type: 'object',
                properties: {
                    filterDate: {
                        type: 'string',
                        description: '按日期筛选发票（如 2026-07-31），仅将该日期的发票生成费用'
                    },
                    invoiceIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '指定要生成费用的发票 ID/boDataId 列表'
                    },
                    mergeTollsWithTaxi: {
                        type: 'boolean',
                        description: '是否将过路费/通行费发票与出租车发票合并在同一笔费用中（默认 true，1笔费用挂载2张发票）'
                    },
                    saveImmediately: {
                        type: 'boolean',
                        description: '是否立即持久化写入系统草稿（若为 false 则仅生成规划与 A2UI 预览，由用户确认后保存；若为 true 则直接写入草稿库）'
                    },
                    projectName: { type: 'string', description: '归属项目名称或编号（可选）' },
                    customerName: { type: 'string', description: '拜访客户或工厂名称（可选）' },
                    proxyPersonName: { type: 'string', description: '代外驻报销姓名（可选）' },
                    customDescription: { type: 'string', description: '自定义统一费用说明（可选）' }
                }
            },
            execute: async (params: {
                filterDate?: string;
                invoiceIds?: string[];
                mergeTollsWithTaxi?: boolean;
                saveImmediately?: boolean;
                projectName?: string;
                customerName?: string;
                proxyPersonName?: string;
                customDescription?: string;
            }) => {
                const startTime = Date.now();
                try {
                    // 1. 确保发票已加载
                    if (!state.invoices || state.invoices.length === 0) {
                        await loadAllInvoicesAndExpenses(state);
                    }
                    let candidateInvoices = [...(state.invoices || [])];

                    // 2. 按日期过滤
                    if (params.filterDate) {
                        const targetNorm = normalizeDate(params.filterDate);
                        candidateInvoices = candidateInvoices.filter(inv => normalizeDate(inv.invoiceDate || '') === targetNorm);
                    }

                    // 3. 按发票 ID 过滤
                    if (params.invoiceIds && params.invoiceIds.length > 0) {
                        const idSet = new Set(params.invoiceIds);
                        candidateInvoices = candidateInvoices.filter(inv => idSet.has(inv.id) || idSet.has(inv.boDataId || '') || idSet.has(inv.expenseRecordId || ''));
                    }

                    if (candidateInvoices.length === 0) {
                        return {
                            success: false,
                            message: `未找到符合条件的发票（日期: ${params.filterDate || '全部'}），发票夹中可能暂无该日期发票或已全部生成费用。`,
                            totalFound: 0
                        };
                    }

                    // 4. 执行智能规划与过路费合并
                    const planOpts: ExpensePlanOptions = {
                        tripType: 'AUTO',
                        projectName: params.projectName,
                        customerName: params.customerName,
                        proxyPersonName: params.proxyPersonName,
                        customDescription: params.customDescription,
                        mergeTollsWithTaxi: params.mergeTollsWithTaxi
                    };

                    // 使用 inferSmartExpensePlan 对候选发票进行全套业务规划（内部已集成 bindTollsToTaxiExpenses）
                    const planResult = inferSmartExpensePlan(candidateInvoices, planOpts);
                    state.expensePlan = planResult;
                    state.invoices = planResult.records;

                    // 5. 生成并渲染 A2UI 交互确认卡片（支持合并/独立生成双分支切换与一键批量保存）
                    const container = document.getElementById('webmcp-messages') || document.querySelector('.webmcp-chat-body');
                    if (container) {
                        const widget = renderA2UiExpenseBatchWidget({
                            container,
                            state,
                            initialPlan: planResult
                        });
                        widget.scrollIntoView({ behavior: 'smooth' });
                    }

                    // 6. 若要求立即保存，调用批量入库
                    let saveResult = null;
                    if (params.saveImmediately) {
                        saveResult = await batchSaveExpenseItemsApi(planResult.records, state);
                    }

                    const res = {
                        success: true,
                        totalInvoices: candidateInvoices.length,
                        resultingExpenseCount: planResult.records.length,
                        boundTollsCount: planResult.boundTollsCount || 0,
                        bindingLog: planResult.bindingLog || [],
                        hasConcurrentTolls: planResult.hasConcurrentTolls,
                        concurrentTollsCount: planResult.concurrentTollsCount,
                        tollInquiryPrompt: planResult.tollInquiryPrompt,
                        summaryText: planResult.summaryText,
                        savedImmediately: Boolean(params.saveImmediately),
                        saveResult: saveResult,
                        expenseItems: planResult.records.map((r, i) => ({
                            index: i,
                            date: r.invoiceDate,
                            expenseTypeName: r.expenseTypeName,
                            totalAmount: r.amount,
                            invoiceCount: r.invoiceCount || 1,
                            subInvoicesCount: r.subInvoices?.length || 0,
                            tollAmount: r.tollAmount || 0,
                            description: r.description,
                            startAddress: r.startAddress,
                            endAddress: r.endAddress,
                            isMergedWithToll: Boolean(r.subInvoices && r.subInvoices.length > 0)
                        }))
                    };

                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_generate_expense_from_invoices',
                        parameters: params,
                        result: {
                            totalInvoices: candidateInvoices.length,
                            resultingExpenseCount: planResult.records.length,
                            boundTollsCount: planResult.boundTollsCount || 0
                        },
                        durationMs: Date.now() - startTime
                    });

                    return res;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_generate_expense_from_invoices',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_plan_expense_batch_update',
            description: '智能批量规划费用记录类型与行程信息（支持全部15类费用、多波次异地出差行程与市内日常拜访推断、外驻代报销备注规约）。根据传入的出行参数测算，更新内存状态并返回规划预览，不会直接持久化写库。注意：LLM 应基于用户上下文、对话历史、附件图片或地理世界常识，直接推断并传入结构化出差波次 trips（含目的地、机场/火车站、酒店、客户与起止日期），系统全面遵循 Anti-Hardcoding 铁律！',
            inputSchema: {
                type: 'object',
                properties: {
                    tripType: {
                        type: 'string',
                        enum: ['AUTO', 'BUSINESS_TRIP', 'LOCAL_COMMUTE', 'COMMUNICATION_ONLY'],
                        description: '规划模式：AUTO自动识别、BUSINESS_TRIP异地出差模式、LOCAL_COMMUTE市内日常拜访、COMMUNICATION_ONLY纯话费'
                    },
                    itineraryText: {
                        type: 'string',
                        description: '出差行程计划表文本/表格/CSV内容（包含波次、起止日期、目的地、酒店、客户工厂据点），若提供将自动多波次分段对齐，精准推断每个波次的酒店与客户工厂，无需用户手动补充'
                    },
                    trips: {
                        type: 'array',
                        description: '结构化的多波次出差行程列表。LLM 应充分运用世界常识与用户上下文直接推理出每一波的城市、机场/高铁站、酒店与客户（每项包含 tripNo, startDate, endDate, destination, hotelName, customerName, stationOrAirport, departureStation, arrivalStation, purpose 等），彻底消除任何写死预设',
                        items: {
                            type: 'object',
                            properties: {
                                tripNo: { type: 'number', description: '波次编号 (1, 2, ...)' },
                                startDate: { type: 'string', description: '波次开始日期 (YYYY-MM-DD)' },
                                endDate: { type: 'string', description: '波次结束日期 (YYYY-MM-DD)' },
                                destination: { type: 'string', description: '目的城市或地区 (如 天津、广州、合肥、大连)' },
                                hotelName: { type: 'string', description: '入住酒店名称 (如 美悦酒店、广州黄埔瑾程酒店)' },
                                customerName: { type: 'string', description: '拜访客户或工厂名称' },
                                stationOrAirport: { type: 'string', description: '往返交通枢纽 (如 天津滨海国际机场、合肥南站)' },
                                purpose: { type: 'string', description: '出差事由或工作目标' }
                            }
                        }
                    },
                    companyName: { type: 'string', description: '公司基准据点（默认 IVISION）' },
                    customerName: { type: 'string', description: '拜访客户名称（从用户输入或行程中提取，若用户未提及且无法推断则留空由用户在界面动态确认，严禁随意捏造客户）' },
                    hotelName: { type: 'string', description: '异地出差入住酒店名称（例如 美悦酒店、亚朵酒店，若已有行程表或由LLM推断则无需单独传）' },
                    stationOrAirport: { type: 'string', description: '机场或高铁站名称（例如 天津滨海国际机场、合肥南站，LLM可运用常识提供）' },
                    homeName: { type: 'string', description: '出发地/返程地家庭据点（默认 家）' },
                    departureDate: { type: 'string', description: '出差出发日期 (YYYY-MM-DD)' },
                    returnDate: { type: 'string', description: '出差返程日期 (YYYY-MM-DD)' },
                    projectName: { type: 'string', description: '归属项目名称或项目号（例如 PRJ-2026-001）' },
                    proxyPersonName: { type: 'string', description: '代外驻人员报销时的外驻同事姓名（例如 张三、李四），将自动在费用说明前生成 [外驻:姓名]' },
                    customDescription: { type: 'string', description: '统一自定义费用说明（若填写将优先覆盖自动生成的说明）' },
                    recordIndices: {
                        type: 'array',
                        items: { type: 'number' },
                        description: '要规划的特定记录索引列表（若不提供则默认规划全部待处理项）'
                    }
                }
            },
            execute: async (params: ExpensePlanOptions) => {
                const startTime = Date.now();
                try {
                    // 若尚未加载发票列表，先自动穿透后端 API 拉取
                    if (!state.invoices || state.invoices.length === 0) {
                        await loadAllInvoicesAndExpenses(state);
                    }

                    // 若未显式传入行程表，但之前已在 state.tripApp 中解析过，自动继承有效复用
                    if (!params.trips && !params.itineraryText) {
                        let candidateTrips: any[] = [];
                        if (state.expensePlan?.matchedTrips && state.expensePlan.matchedTrips.length > 0) {
                            candidateTrips = state.expensePlan.matchedTrips;
                        } else if (state.tripApp?.rawInputs && state.tripApp.rawInputs.length > 0) {
                            candidateTrips = state.tripApp.rawInputs.map(r => ({
                                tripNo: r.tripNo,
                                startDate: r.startDate,
                                endDate: r.endDate,
                                destination: r.destination,
                                hotelName: r.hotelName,
                                customerName: r.targetFactories || r.purpose || '',
                                targetFactories: r.targetFactories,
                                purpose: r.purpose
                            }));
                        } else if (state.tripApp?.configs && state.tripApp.configs.length > 0) {
                            candidateTrips = state.tripApp.configs.map(c => ({
                                tripNo: c.tripNo,
                                startDate: c.startDate,
                                endDate: c.endDate,
                                destination: c.destination,
                                hotelName: c.hotelName,
                                customerName: c.targetFactories || c.purpose || '',
                                targetFactories: c.targetFactories,
                                purpose: c.purpose
                            }));
                        }
                        // 过滤掉无效/无目的地/无日期的空占位波次，避免污染自动聚类
                        const validTrips = candidateTrips.filter(t => Boolean((t.destination && !t.destination.includes('待定')) || t.startDate || t.endDate));
                        if (validTrips.length > 0) {
                            params.trips = validTrips;
                        }
                    }

                    const planResult = inferSmartExpensePlan(state.invoices || [], params);
                    const ast = generateExpenseBatchA2UiAST(planResult, state);
                    state.expensePlan = planResult;
                    if (planResult.records && planResult.records.length > 0) {
                        state.invoices = planResult.records;
                    }

                    const res = {
                        totalRecords: planResult.totalRecords,
                        modifiedCount: planResult.modifiedCount,
                        boundTollsCount: planResult.boundTollsCount || 0,
                        bindingLog: planResult.bindingLog || [],
                        tripType: planResult.tripType,
                        companyName: planResult.companyName,
                        customerName: planResult.customerName,
                        hotelName: planResult.hotelName,
                        stationOrAirport: planResult.stationOrAirport,
                        projectName: planResult.projectName,
                        proxyPersonName: planResult.proxyPersonName,
                        missingFields: planResult.missingFields,
                        uncertainDates: planResult.uncertainDates,
                        summaryText: planResult.summaryText,
                        matchedTrips: planResult.matchedTrips,
                        a2uiAST: planResult.a2uiAST,
                        previewRecords: (planResult.records || []).slice(0, 10).map((r, i) => ({
                            index: i,
                            date: r.invoiceDate,
                            type: r.type,
                            typeName: r.expenseTypeName,
                            amount: r.amount,
                            startAddress: r.startAddress,
                            endAddress: r.endAddress,
                            description: r.description,
                            subInvoicesCount: r.subInvoices?.length || 0,
                            tollAmount: r.tollAmount || 0,
                            invoiceCount: r.invoiceCount || 1
                        }))
                    };

                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_plan_expense_batch_update',
                        parameters: params,
                        result: {
                            total: planResult.totalRecords,
                            modified: planResult.modifiedCount,
                            tripType: planResult.tripType,
                            matchedTripsCount: planResult.matchedTrips?.length || 0
                        },
                        durationMs: Date.now() - startTime
                    });

                    return res;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_plan_expense_batch_update',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_render_interactive_form',
            description: '在副驾对话流或工作区中动态渲染声明式 A2UI 表单 AST（支持时间轴、网格表单、选择器、预览表格与一键操作按钮），用于智能副驾与用户的深度图文交互与决策确认',
            inputSchema: {
                type: 'object',
                properties: {
                    ast: {
                        type: 'object',
                        description: '符合 A2UiRootAST 规约的声明式表单定义，包含 id, title, model, layout, actions 等字段'
                    }
                },
                required: ['ast']
            },
            execute: async (params: { ast: A2UiRootAST }) => {
                const startTime = Date.now();
                try {
                    const container = document.getElementById('webmcp-messages') || document.querySelector('.webmcp-chat-body');
                    if (container) {
                        let currentAst = params.ast;
                        const cardWrapper = document.createElement('div');
                        cardWrapper.className = 'webmcp-a2ui-standalone-container';

                        const renderCard = () => {
                            cardWrapper.innerHTML = '';
                            const cardEl = renderA2UiFromAST(currentAst, {
                                state,
                                onAction: async (actionKey, model) => {
                                    if (actionKey === 'reinfer') {
                                        const newOpts: ExpensePlanOptions = {
                                            tripType: model.tripType,
                                            companyName: model.companyName,
                                            customerName: model.customerName,
                                            hotelName: model.hotelName,
                                            stationOrAirport: model.stationOrAirport,
                                            projectName: model.projectName,
                                            proxyPersonName: model.proxyPersonName,
                                            customDescription: model.customDescription,
                                            trips: state.expensePlan?.matchedTrips
                                        };
                                        const planResult = inferSmartExpensePlan(state.invoices || [], newOpts);
                                        state.expensePlan = planResult;
                                        if (planResult.records && planResult.records.length > 0) {
                                            state.invoices = planResult.records;
                                        }
                                        currentAst = generateExpenseBatchA2UiAST(planResult, state);
                                        renderCard();
                                        showToast('success', `已根据最新输入重新推断 (规划 ${planResult.modifiedCount} 笔)`);
                                    } else if (actionKey === 'openModal') {
                                        const helperBtn = document.getElementById('yn-batch-helper-btn');
                                        if (helperBtn) helperBtn.click();
                                    } else if (actionKey === 'batchSave') {
                                        try {
                                            const sourceInvoices = state.expensePlan?.records || state.invoices || [];
                                            const targets = sourceInvoices.filter(i => i.isModified || i.status === '就绪' || i.status === '待流转');
                                            const fallbackTargets = targets.length > 0 ? targets : sourceInvoices;
                                            if (fallbackTargets.length === 0) {
                                                showToast('error', '批量保存失败: 没有找到可保存的费用记录，请先加载发票数据');
                                                return;
                                            }
                                            showToast('info', `正在批量保存 ${fallbackTargets.length} 笔费用记录...`);
                                            const res = await batchSaveExpenseItemsApi(fallbackTargets, state);
                                            showToast('success', `批量保存完成！成功 ${res.successCount} 笔，失败 ${res.failCount} 笔`);
                                        } catch (err: any) {
                                            showToast('error', `批量保存异常: ${err.message}`);
                                        }
                                    }
                                }
                            });
                            cardWrapper.appendChild(cardEl);
                        };

                        renderCard();
                        container.appendChild(cardWrapper);
                        cardWrapper.scrollIntoView({ behavior: 'smooth' });
                    }
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_render_interactive_form',
                        parameters: { formId: params.ast.id, title: params.ast.title },
                        result: { success: true },
                        durationMs: Date.now() - startTime
                    });
                    return { success: true, message: `A2UI 交互表单【${params.ast.title}】已成功呈现在副驾界面` };
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_render_interactive_form',
                        parameters: { formId: params.ast?.id },
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    return { success: false, error: err.message };
                }
            }
        },
        {
            name: 'fssc_batch_save_expense_records',
            description: '批量将已规划的费用记录持久化保存至元年云系统（写入数据库并实例化草稿）。需审批门禁，用户确认后执行。',
            inputSchema: {
                type: 'object',
                properties: {
                    recordIndices: {
                        type: 'array',
                        items: { type: 'number' },
                        description: '要保存的记录索引列表（可选，若不填则保存所有已规划修改的项）'
                    }
                }
            },
            execute: async (params: { recordIndices?: number[] }) => {
                const startTime = Date.now();
                try {
                    let targets: InvoiceItem[] = [];
                    const sourceInvoices = state.expensePlan?.records || state.invoices || [];
                    if (params.recordIndices && params.recordIndices.length > 0) {
                        const targetSet = new Set(params.recordIndices);
                        targets = sourceInvoices.filter((_, idx) => targetSet.has(idx));
                    } else {
                        targets = sourceInvoices.filter(inv => inv.isModified || inv.status === '就绪' || inv.status === '待流转');
                    }

                    if (targets.length === 0) {
                        targets = sourceInvoices;
                    }

                    const saveResult = await batchSaveExpenseItemsApi(targets, state);

                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_batch_save_expense_records',
                        parameters: { targetCount: targets.length },
                        result: { successCount: saveResult.successCount, failCount: saveResult.failCount },
                        durationMs: Date.now() - startTime
                    });

                    return saveResult;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_batch_save_expense_records',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_delete_expense_records',
            description: '批量删除指定的费用记录（软删除至回收站）。传入费用记录 ID 数组 recordIds。',
            inputSchema: {
                type: 'object',
                properties: {
                    recordIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '待删除的费用记录主键 ID 数组'
                    }
                },
                required: ['recordIds']
            },
            execute: async (params: { recordIds: string[] }) => {
                const startTime = Date.now();
                try {
                    await deleteExpenseRecordListApi(params.recordIds, state);
                    if (state.invoices) {
                        const idSet = new Set(params.recordIds);
                        state.invoices = state.invoices.filter(inv => !idSet.has(inv.expenseRecordId || ''));
                    }
                    const result = { success: true, deletedCount: params.recordIds.length, message: `已成功删除 ${params.recordIds.length} 笔费用记录至回收站` };
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_delete_expense_records',
                        parameters: params,
                        result,
                        durationMs: Date.now() - startTime
                    });
                    return result;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_delete_expense_records',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_audit_expense_record_errors',
            description: 'Agentic 主动体检当前用户的费用记录列表，检测系统后端接口 (getExpenseRecordListBySearchVO) 校验返回的任何错误信息 (如“出差城市必填”、“费用金额必填”、“发票必须”等)，输出结构化诊断报告。',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            execute: async () => {
                const startTime = Date.now();
                try {
                    const report = await auditExpenseRecordsApi(state);
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_audit_expense_record_errors',
                        parameters: {},
                        result: report,
                        durationMs: Date.now() - startTime
                    });
                    return report;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_audit_expense_record_errors',
                        parameters: {},
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_auto_fix_expense_record_errors',
            description: 'Agentic 针对体检出的费用记录错误（如住宿费出差城市必填）执行智能自愈修复：自动对齐行程与系统城市维表 (DIM_CITY) 补齐城市与住宿区分，并持久化保存写库，确保错误完全清零。',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            execute: async () => {
                const startTime = Date.now();
                try {
                    const fixResult = await autoFixExpenseRecordsApi(state);
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_auto_fix_expense_record_errors',
                        parameters: {},
                        result: fixResult,
                        durationMs: Date.now() - startTime
                    });
                    return fixResult;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_auto_fix_expense_record_errors',
                        parameters: {},
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_delete_bill_drafts',
            description: '批量删除出差申请单或报销单草稿（仅允许删除未提交的单据草稿）。传入单据主键 ID 数组 billMainIds。',
            inputSchema: {
                type: 'object',
                properties: {
                    billMainIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '待删除的单据主键 ID (billMainId) 数组'
                    }
                },
                required: ['billMainIds']
            },
            execute: async (params: { billMainIds: string[] }) => {
                const startTime = Date.now();
                try {
                    await deleteBillByBillMainIdsApi(params.billMainIds, state);
                    const result = { success: true, deletedCount: params.billMainIds.length, message: `已成功删除 ${params.billMainIds.length} 张单据草稿` };
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_delete_bill_drafts',
                        parameters: params,
                        result,
                        durationMs: Date.now() - startTime
                    });
                    return result;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_delete_bill_drafts',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_delete_invoices',
            description: '从发票池中彻底删除指定的发票记录。传入发票主键 ID (boSourceRowId) 数组 invoiceIds。',
            inputSchema: {
                type: 'object',
                properties: {
                    invoiceIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '待删除的发票主键 ID (boSourceRowId) 数组'
                    }
                },
                required: ['invoiceIds']
            },
            execute: async (params: { invoiceIds: string[] }) => {
                const startTime = Date.now();
                try {
                    await deleteInvoiceBOListApi(params.invoiceIds, state);
                    if (state.invoices) {
                        const idSet = new Set(params.invoiceIds);
                        state.invoices = state.invoices.filter(inv => !idSet.has(inv.boSourceRowId || inv.boDataId || inv.id || ''));
                    }
                    const result = { success: true, deletedCount: params.invoiceIds.length, message: `已成功从发票池彻底删除 ${params.invoiceIds.length} 张发票` };
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_delete_invoices',
                        parameters: params,
                        result,
                        durationMs: Date.now() - startTime
                    });
                    return result;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_delete_invoices',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_create_reimbursement_draft',
            description: '从未报销费用记录批量生成一张报销单草稿（commit: false，仅保存草稿入库，绝不提交审批）。需传入报销单模板 ID 与费用记录 ID 数组。',
            inputSchema: {
                type: 'object',
                properties: {
                    billDefineId: {
                        type: 'string',
                        description: '报销单模板 ID（如出差费用报销单 035a50ee6d3de1653e55bb00bc610001，经费报销单 035cd1b4d46de1653e55bb00bc610000）'
                    },
                    expenseRecordIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '关联的未报销费用记录 ID 数组'
                    }
                },
                required: ['billDefineId', 'expenseRecordIds']
            },
            execute: async (params: { billDefineId: string; expenseRecordIds: string[] }) => {
                const startTime = Date.now();
                try {
                    const data = await createBillDataAndTemplateByExpenseIdListApi(params.billDefineId, params.expenseRecordIds, state);
                    const billMainId = data?.billData?.area?.rowDatas?.[0]?.datas?.BILL_MAIN_ID?.value || data?.billData?.billMainId || '';
                    const billCode = data?.billData?.area?.rowDatas?.[0]?.datas?.BILL_CODE?.value || '';
                    const result = {
                        success: true,
                        billMainId,
                        billCode,
                        expenseCount: params.expenseRecordIds.length,
                        message: `已成功从未报销费用生成报销单草稿 ${billCode ? '(' + billCode + ')' : ''}，已保存入库，未提交审批`
                    };
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_create_reimbursement_draft',
                        parameters: params,
                        result,
                        durationMs: Date.now() - startTime
                    });
                    return result;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_create_reimbursement_draft',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        },
        {
            name: 'fssc_export_expense_records_csv',
            description: '导出当前用户的费用记录及底层挂载发票清单（Excel CSV 格式）。核心业务特性：穿透每笔费用提取发票代码、发票号码、开票日期、实际行程日期/时间、始发站、目的站、车次/航班、销方名称、附件文件名等；自动进行行程与开票日期的差异对比核验，并在最后一列提供核验预警（如开票日期晚于/早于行程天数、酒店发票核对提示等）。支持按费用记录 ID 筛选，或默认全量导出所有未报销费用。',
            inputSchema: {
                type: 'object',
                properties: {
                    expenseRecordIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '指定导出的费用记录 ID 列表（可选，若未指定则导出全部未报销费用）'
                    },
                    triggerDownload: {
                        type: 'boolean',
                        description: '是否在浏览器端直接触发 CSV 文件下载（默认 true）'
                    }
                }
            },
            execute: async (params: { expenseRecordIds?: string[]; triggerDownload?: boolean }) => {
                const startTime = Date.now();
                try {
                    const rows = await fetchExpenseRecordsWithInvoiceDetails(state, params.expenseRecordIds);
                    const csvContent = convertExpenseRecordsToCsv(rows);
                    if (params.triggerDownload !== false && typeof window !== 'undefined') {
                        const now = new Date();
                        const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
                        downloadCsvFile(csvContent, `费用记录与发票行程核对清单_${ts}.csv`);
                    }
                    const warnCount = rows.filter(r => r.reconciliationNote && r.reconciliationNote.includes('⚠️')).length;
                    const result = {
                        success: true,
                        totalExpenseRecords: new Set(rows.map(r => r.expenseRecordId)).size,
                        totalInvoiceRows: rows.length,
                        warningCount: warnCount,
                        csvLength: csvContent.length,
                        sampleRows: rows.slice(0, 5),
                        message: `成功导出 ${rows.length} 条发票核对记录 (涉及 ${new Set(rows.map(r => r.expenseRecordId)).size} 笔费用，发现 ${warnCount} 处行程与开票日期差异)`
                    };
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_export_expense_records_csv',
                        parameters: params,
                        result,
                        durationMs: Date.now() - startTime
                    });
                    return result;
                } catch (err: any) {
                    recordLog({
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: new Date().toLocaleTimeString(),
                        toolName: 'fssc_export_expense_records_csv',
                        parameters: params,
                        error: err.message,
                        durationMs: Date.now() - startTime
                    });
                    throw err;
                }
            }
        }
    ];

    WEBMCP_STATE.toolDefs = tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        execute: t.execute
    }));

    for (const tool of tools) {
        WEBMCP_STATE.toolMap.set(tool.name, tool.execute);
        WEBMCP_STATE.registeredTools.push(tool.name);
        if (hasModelContext) {
            try {
                doc.modelContext.registerTool(tool);
            } catch (err: any) {
                AutopilotLogger.warn(`[WebMCP] 注册工具 [${tool.name}] 到 document.modelContext 出现警告: ${err.message}`);
            }
        }
    }

    WEBMCP_STATE.initialized = true;
    AutopilotLogger.success(`[WebMCP] 通用出差申请原生工具集已就绪 (共 ${tools.length} 个工具，W3C Polyfill: ${hasModelContext ? '激活' : '内部模式'})！`);
}
