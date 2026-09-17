import { apiRequest, callNativeHttp, LEGAL_MENU_IDS } from '../utils/http';
import { TRIP_CONSTANTS, BUDGET_CONSTANTS } from '../config/constants';
import { GlobalState, TripApplicationConfig, TripLeg, HistoricalApplicationSummary, TripFeeFormulas } from '../types/state';
import { prepareBillSceneVO, changeBillFieldValueApi, fetchBillDataAndTemplateApi } from './billService';
import { AutopilotLogger } from '../utils/logger';

// 生成 32 位唯一十六进制 ID
export function generateUuid(): string {
    const s: string[] = [];
    const hexDigits = '0123456789abcdef';
    for (let i = 0; i < 32; i++) {
        s[i] = hexDigits.substr(Math.floor(Math.random() * 16), 1);
    }
    return s.join('');
}

/**
 * 确定性大交通标签推断
 * 优先规则：
 * 1. 若排期表/传入参数已有具体交通/车次文本（如 MU5227 / G1234 / 飞机 / 高铁），直接使用并清洗
 * 2. 若无显式文本，但关联发票中识别出大交通票种类型：
 *    - 仅有飞机票 => '飞机'
 *    - 仅有高铁/火车票 => '高铁'
 *    - 两者皆有 => '飞机/高铁'
 * 3. 若均无法确定，返回空字符串 ''，交由上层在 A2UI / 弹窗中提示用户确认，并在持久化写库前硬阻断
 */
export function resolveTransportLabel(
    rawFromSchedule?: string,
    invoiceCommuteTypes?: Array<'FLIGHT' | 'TRAIN' | string>
): string {
    if (rawFromSchedule) {
        const clean = rawFromSchedule.trim();
        // 如果不是无意义占位符，直接使用
        if (clean && clean !== '未提供' && clean !== '未知' && clean !== '待定') {
            return clean;
        }
    }

    if (invoiceCommuteTypes && invoiceCommuteTypes.length > 0) {
        const hasFlight = invoiceCommuteTypes.some(t => {
            const s = (t || '').toUpperCase();
            return s.includes('FLIGHT') || s.includes('飞机') || s.includes('航空') || s.includes('机票');
        });
        const hasTrain = invoiceCommuteTypes.some(t => {
            const s = (t || '').toUpperCase();
            return s.includes('TRAIN') || s.includes('高铁') || s.includes('火车') || s.includes('动车');
        });

        if (hasFlight && hasTrain) return '飞机/高铁';
        if (hasFlight) return '飞机';
        if (hasTrain) return '高铁';
    }

    return '';
}

/**
 * 动态拉取当前登录人信息（从会话与用户卡片 API 解析真实姓名、工号、邮箱）
 */
export async function fetchLoginUserInfo(state: GlobalState): Promise<{
    userId: string;
    userName: string;
    userCode?: string;
    email?: string;
}> {
    if (state.currentUser && state.currentUser.userName && state.currentUser.userId) {
        return state.currentUser;
    }

    // 1. 多级环境与存储嗅探真实用户ID
    let detectedUserId = state.currentUser?.userId || state.applicantId || '';

    // 优先检查宿主系统的 ecs_currentUser (最权威的登录用户主数据)
    if (!detectedUserId && typeof window !== 'undefined') {
        try {
            const ecsUserStr = sessionStorage.getItem('ecs_currentUser') || localStorage.getItem('ecs_currentUser');
            if (ecsUserStr) {
                const u = JSON.parse(ecsUserStr);
                if (u && u.id) {
                    detectedUserId = u.id;
                    if (!state.currentUser) state.currentUser = {} as any;
                    state.currentUser.userId = u.id;
                    state.currentUser.userName = u.userName || u.name || '';
                    state.currentUser.userCode = u.loginName || u.userCode || '';
                    state.currentUser.email = u.email || '';
                    state.applicantId = u.id;
                    state.applicantName = u.userName || u.name || '';
                }
            }
        } catch (e) { }
    }

    // 检查 sessionStorage / localStorage
    const storageKeys = ['userId', 'loginUserId', 'applicantId', 'accountId', 'userCode'];
    for (const key of storageKeys) {
        const val = sessionStorage.getItem(key) || localStorage.getItem(key);
        if (val && typeof val === 'string' && val.length >= 10) {
            detectedUserId = val;
            break;
        }
    }

    // 检查 userInfo JSON
    if (!detectedUserId) {
        const infoStr = sessionStorage.getItem('userInfo') || localStorage.getItem('userInfo') || sessionStorage.getItem('user');
        if (infoStr) {
            try {
                const parsed = JSON.parse(infoStr);
                const uid = parsed.userId || parsed.id || parsed.accountId;
                if (uid) detectedUserId = uid;
            } catch (e) { }
        }
    }

    // 检查 cookies
    if (!detectedUserId && typeof document !== 'undefined' && document.cookie) {
        const m = document.cookie.match(/(?:userId|loginUserId|accountId)=([^;]+)/);
        if (m) detectedUserId = decodeURIComponent(m[1].trim());
    }

    // 检查全局变量
    if (!detectedUserId && typeof window !== 'undefined') {
        const win = window as any;
        const glob = win._USER_INFO_ || win.userInfo || win.currentUser || win.GLOBAL_USER;
        if (glob) {
            const uid = glob.userId || glob.id || glob.accountId;
            if (uid) detectedUserId = uid;
        }
    }

    if (!detectedUserId) {
        detectedUserId = state.applicantId || '';
    }

    if (detectedUserId) {
        state.applicantId = detectedUserId;
        try {
            const res = await apiRequest(`/fssc/bill/queryUserCardAndIconByUserId?userId=${detectedUserId}&62e98577516511eb94c585ac18565c25=userId`, 'GET', null, state);
            if (res.success && res.data) {
                const u = res.data;
                state.currentUser = {
                    userId: u.userId || detectedUserId,
                    userName: u.userName || '当前用户',
                    userCode: u.userCode || u.loginName || '',
                    email: u.email || ''
                };
                state.applicantId = state.currentUser.userId;
                AutopilotLogger.info(`[DynamicUser] 成功拉取当前登录人主数据: ${state.currentUser.userName} (${state.currentUser.userCode})`);
                return state.currentUser;
            }
        } catch (e: any) {
            AutopilotLogger.warn(`[DynamicUser] 拉取当前登录人信息失败: ${e.message}`);
        }
    }

    // 会话缓存与降级读取
    const fallbackUser = {
        userId: detectedUserId || state.applicantId || '',
        userName: state.currentUser?.userName || '当前填报人'
    };
    state.currentUser = fallbackUser;
    return fallbackUser;
}

/**
 * 查询用户当前历史出差申请单据（对齐 ync37.yuanian.com-002-经费报销单页-历史.har，用于交叉对比与去重）
 */
export async function fetchHistoricalTripApplications(state: GlobalState): Promise<HistoricalApplicationSummary[]> {
    try {
        const payload = {
            conditionMap: {
                "e2bedc68a4f211e88f5e0154a3e7bffc": "",
                "e2bedc66a4f211e88f5ef99ecdff44af": "",
                "e2bedc6ba4f211e88f5e7bcfe24f5802": [],
                "e2bf037da4f211e88f5e11f085684a5f": "",
                "e2bf037ea4f211e88f5ea3bf74bed029": "",
                "e2bf0381a4f211e88f5e7bf5be093eaf": "",
                "c38bb130bd9511ec99e696d1bc9d5c7e": ""
            },
            pageOrderParam: {
                pageNum: 1,
                pageSize: 50,
                enableCountLimit: true,
                countLimit: 1000,
                count: false
            },
            sheetId: "df023624bfba11ec99e696d1bc9d5c7e",
            appId: state.appId || "e3d5e4787ff911e88b1997bee3518b4d"
        };

        const res = await apiRequest('/fssc/billViewConfig/getBillViewQueryDataList', 'POST', payload, state);
        const list = res?.data?.list || [];
        if (Array.isArray(list)) {
            return list.map((item: any) => {
                const getVal = (v: any) => (v && typeof v === 'object' ? (v.value ?? v.id ?? '') : (v ?? ''));
                const getShowVal = (v: any) => (v && typeof v === 'object' ? (v.showValue ?? v.value ?? '') : (v ?? ''));

                const billCode = getVal(item.e2bedc68a4f211e88f5e0154a3e7bffc);
                const billName = getShowVal(item.e2bedc66a4f211e88f5ef99ecdff44af);
                const billDate = getVal(item.e2bedc6ba4f211e88f5e7bcfe24f5802);
                const amount = getShowVal(item.e2bf51aea4f211e88f5e77f2e04472c7);
                const statusName = getShowVal(item.e2bf9fe2a4f211e88f5e9d87398070eb);
                const applicantName = getShowVal(item.e2bf037da4f211e88f5e11f085684a5f);
                const departmentName = getShowVal(item.e2bf037ea4f211e88f5ea3bf74bed029);
                const billMainId = getVal(item.BILL_MAIN_ID);

                return {
                    billCode: String(billCode),
                    billName: String(billName),
                    billDate: String(billDate),
                    amount: String(amount),
                    statusName: String(statusName),
                    applicantName: String(applicantName),
                    departmentName: String(departmentName),
                    billMainId: String(billMainId)
                };
            });
        }
    } catch (err: any) {
        AutopilotLogger.warn(`[HistoricalApp] 获取历史单据失败: ${err.message}`);
    }
    return [];
}

/**
 * 将规划的行程与历史单据进行交叉比对与去重识别
 */
export function crossCheckWithHistoricalApplications(
    configs: TripApplicationConfig[],
    historyBills: HistoricalApplicationSummary[]
): void {
    if (!configs || !historyBills || historyBills.length === 0) return;

    configs.forEach(cfg => {
        const dest = cfg.destination.replace(/省|市|地区/g, '').trim().toLowerCase();
        // 查找历史单据中相同目的地、或单据名称/金额相近的单据
        const matched = historyBills.find(h => {
            const hName = (h.billName || '').toLowerCase();
            const hCode = (h.billCode || '').toLowerCase();
            const hAmtNum = parseFloat(String(h.amount).replace(/[^\d.]/g, '')) || 0;
            const isAmountClose = Math.abs(hAmtNum - cfg.totalAmount) < 5;
            const isDestMatch = dest && (hName.includes(dest) || hCode.includes(dest));
            return isDestMatch || isAmountClose;
        });

        if (matched) {
            cfg.matchedHistoryBill = matched;
            AutopilotLogger.info(`[HistoricalCrossCheck] 行程 [${cfg.destination} - ${cfg.startDate}] 交叉比对命中历史单据: ${matched.billCode} (${matched.statusName}, ${matched.amount})`);
        }
    });
}
export async function fetchPersonnelVO(name: string, state: GlobalState): Promise<any> {
    if (!state.tripApp) {
        state.tripApp = {
            configs: [],
            selectedTripIds: new Set(),
            isProcessing: false,
            progressText: '',
            cityBufferPerDay: 100,
            trafficBufferPercent: 0.15,
            cityCache: {},
            personCache: {},
            projectCache: {}
        };
    }

    const cleanName = (name || '').trim();
    if (!cleanName || cleanName === '当前用户' || cleanName === '当前社员' || cleanName === '当前员工' || cleanName === '出差人' || cleanName === '社员') {
        const loginUser = await fetchLoginUserInfo(state);
        return { value: state.applicantId, title: { zh_CN: loginUser.userName || '当前用户' } };
    }

    if (state.tripApp.personCache[cleanName]) {
        return state.tripApp.personCache[cleanName];
    }

    // 结构化解析姓名与限定/部门后缀 (例如: "陈浩-ITS" -> baseName: "陈浩", qualifier: "ITS")
    const matchHyphen = cleanName.match(/^([^\-\(\（\[【]+)[\-]([^\)\）\]】]+)$/);
    const matchBracket = cleanName.match(/^([^\-\(\（\[【]+)[\(\（\[【]([^\)\）\]】]+)[\)\）\]】]?$/);
    const baseName = (matchHyphen ? matchHyphen[1] : (matchBracket ? matchBracket[1] : cleanName))
        .replace(/本人|代办|当前用户|当前社员|当前员工|出差人|社员/g, '')
        .trim();
    const qualifier = (matchHyphen ? matchHyphen[2] : (matchBracket ? matchBracket[2] : ''))
        .replace(/本人|代办/g, '')
        .trim();

    // 若缓存命中纯姓名且当前无特定限定符
    if (!qualifier && baseName && state.tripApp.personCache[baseName]) {
        return state.tripApp.personCache[baseName];
    }

    // 检查是否为当前登录人：
    // 规则：
    // 1. 若用户输入代词 ("本人"、"我"、"当前社员"、"当前员工"、工号、或直接传入 state.applicantId)，直接绑定为当前登录用户
    // 2. 若用户输入姓名与登录人姓名一致，且【未携带冲突的限定符】(如纯输入 "陈浩")，绑定为当前登录用户
    // 3. 若用户输入明确携带了限定符 (如 "陈浩-ITS")，而登录人未携带该限定符，则绝对不可将其直接劫持为登录用户，必须进入维表消歧检索！
    // 检查是否为当前登录人：
    // 规则：
    // 1. 若用户输入代词 ("本人"、"我"、"当前社员"、"当前员工"、工号、或直接传入 state.applicantId)，直接绑定为当前登录用户
    // 2. 若用户输入姓名与登录人姓名一致，或与登录人基础名一致且未携带冲突限定符 (如纯输入 "陈浩")，直接判定为当前登录社员
    // 3. 若用户输入明确携带了限定符 (如 "陈浩-ITS")，且登录人全名也包含该限定符，绑定为当前登录用户
    const loginUser = await fetchLoginUserInfo(state);
    const loginUserName = (loginUser.userName || '').trim();
    const loginBaseName = loginUserName
        .replace(/（[^）]+）|\([^)]+\)/g, '')
        .replace(/本人|代办|当前用户|当前社员|当前员工|出差人|社员/g, '')
        .trim();

    const isExplicitSelf = cleanName === '本人' || cleanName === '我' || cleanName === '当前用户' || cleanName === '当前社员' || cleanName === '当前员工' || cleanName === '出差人' || cleanName === '社员' || cleanName === state.applicantId;
    const isLoginCode = Boolean(loginUser.userCode && cleanName === loginUser.userCode);
    const isLoginNameExact = Boolean(
        loginUserName &&
        (
            cleanName === loginUserName ||
            baseName === loginUserName ||
            (loginBaseName && (cleanName === loginBaseName || baseName === loginBaseName))
        ) &&
        (!qualifier || (loginUserName.includes(qualifier) || (loginUser.userCode && loginUser.userCode.includes(qualifier))))
    );

    if (isExplicitSelf || isLoginCode || isLoginNameExact) {
        const vo = {
            value: state.applicantId,
            title: { zh_CN: loginUserName || '本人' }
        };
        state.tripApp.personCache[cleanName] = vo;
        if (baseName && !qualifier) state.tripApp.personCache[baseName] = vo;
        if (loginBaseName) state.tripApp.personCache[loginBaseName] = vo;
        AutopilotLogger.info(`[DynamicPerson] 人员 [${cleanName}] 确认为当前登录人 (ID: ${vo.value}, 姓名: ${vo.title.zh_CN})`);
        return vo;
    }

    // 走元年云员工维表检索（同名用户智能消歧机制）
    const searchTarget = baseName || cleanName;
    try {
        const res = await apiRequest('/fssc/dim/dimObject/getDimObjectAccessTree', 'POST', {
            dimObjectId: TRIP_CONSTANTS.personDimObjectId,
            searchInfo: searchTarget,
            isParentId: false,
            isShowDisable: false,
            isFastShow: true,
            isShowCode: true,
            isShowRootNode: false,
            isSynchronize: false,
            permDataScope: 'BILL_ENTRY',
            loginUserId: state.applicantId,
            isUseSecurityFormal: false
        }, state);

        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
            // 同名候选人评分排序机制 (Homonymous Disambiguation Scoring)
            const cleanLower = cleanName.toLowerCase();
            const baseLower = baseName.toLowerCase();
            const qualLower = qualifier.toLowerCase();

            const scoredCandidates = res.data.map((item: any) => {
                const name = (item.data?.name || item.name || '').trim();
                const desc = (item.data?.description || '').trim();
                const code = (item.data?.code || item.code || '').trim();
                const text = `${name} ${desc} ${code}`.toLowerCase();
                // 元年维表树节点的 ID 存在于 item.data.objectId 或 item.key 中
                const candId = item.data?.objectId || item.key || item.data?.accountId || item.id;
                const isCandLoginUser = Boolean(candId && state.applicantId && candId === state.applicantId);

                let score = 0;

                // 1. 完全字符串精确匹配
                if (name.toLowerCase() === cleanLower || desc.toLowerCase() === cleanLower) {
                    score += 100;
                }

                // 2. 当前登录社员保底与绝对优先加分
                if (isCandLoginUser) {
                    if (qualifier) {
                        if (text.includes(qualLower)) {
                            score += 500; // 命中限定符且为登录用户
                        }
                    } else {
                        score += 500; // 无冲突限定符时，优先判定为当前登录社员
                    }
                }

                if (qualifier) {
                    // 查询包含限定符 (例如 "陈浩-ITS")：
                    if (text.includes(qualLower)) {
                        score += 60; // 命中限定符 (如 ITS) 强加分
                    } else {
                        score -= 40; // 不含限定符大幅扣分，严防误选无后缀的同名正社员
                    }
                    if (text.includes(baseLower)) {
                        score += 20;
                    }
                } else {
                    // 查询未包含限定符 (例如只输入 "陈浩")：
                    // 精确等于 baseName 的得分最高
                    if (name.toLowerCase() === baseLower || desc.toLowerCase() === baseLower) {
                        score += 80;
                    }
                    // 扣除带有额外后缀的同名候选 (如 "陈浩-外驻")，严防将正社员误匹配为外驻/子公司同名人员 (若是当前登录人则绝不扣分)
                    if (!isCandLoginUser && (name.includes('-') || desc.includes('-') || name.includes('(') || desc.includes('(') || name.includes('（') || desc.includes('（'))) {
                        score -= 30;
                    }
                }

                return {
                    item,
                    score,
                    id: candId,
                    name: (isCandLoginUser && loginUserName) ? loginUserName : (desc || name || cleanName),
                    code,
                    isCandLoginUser
                };
            });

            scoredCandidates.sort((a, b) => b.score - a.score);

            // 存入候选人跟踪池，便于后续 A2UI 或日志排查同名争议
            if (!state.tripApp.personCandidates) state.tripApp.personCandidates = {};
            state.tripApp.personCandidates[cleanName] = scoredCandidates;

            const best = scoredCandidates[0];
            const vo = {
                value: best.id,
                title: { zh_CN: best.name }
            };

            state.tripApp.personCache[cleanName] = vo;
            if (!qualifier && baseName) state.tripApp.personCache[baseName] = vo;
            if (best.isCandLoginUser && loginBaseName) state.tripApp.personCache[loginBaseName] = vo;
            AutopilotLogger.info(
                `[DynamicPerson] 人员消歧匹配 [${cleanName}] (基础名: ${baseName}, 限定符: ${qualifier || '无'}) ` +
                `-> 候选总数: ${scoredCandidates.length}, 优胜匹配: [${best.name}] (得分: ${best.score}, ID: ${best.id})`
            );
            return vo;
        }
    } catch (e: any) {
        AutopilotLogger.warn(`[DynamicPerson] 查询人员 [${cleanName}] 失败: ${e.message}`);
    }

    // 安全保底：若无法在维表中匹配，优先采纳合法的 UUID state.applicantId，杜绝非 UUID 中文字符串写库崩溃
    const isNonUuid = /[\u4e00-\u9fa5]/.test(cleanName) || cleanName.length < 15;
    const fallbackVO = {
        value: (isNonUuid && state.applicantId) ? state.applicantId : (state.applicantId || cleanName),
        title: { zh_CN: cleanName || loginUser.userName || '当前用户' }
    };
    state.tripApp.personCache[cleanName] = fallbackVO;
    return fallbackVO;
}

/**
 * 维表检索城市对象（通用动态检索，用于旅程明细 F_FROM / F_TO）
 */
export async function fetchCityVO(cityName: string, state: GlobalState, targetDimObjectId?: string): Promise<any> {
    if (!state.tripApp) {
        state.tripApp = {
            configs: [],
            selectedTripIds: new Set(),
            isProcessing: false,
            progressText: '',
            cityBufferPerDay: 100,
            trafficBufferPercent: 0.15,
            cityCache: {},
            personCache: {},
            projectCache: {}
        };
    }

    let cleanCity = (cityName || '').replace(/省|市|（.*）|\(.*\)/g, '').trim();
    if (!cleanCity || cleanCity === '出发地' || cleanCity === '返回地') {
        cleanCity = '上海';
    }

    // 默认优先使用费用记录标准城市维表 DIM_CITY
    const dimId = targetDimObjectId || '6b8ff0649ebe11e88b72df10cd5db793';
    const cacheKey = `${cleanCity}_${dimId}`;

    if (state.tripApp.cityCache[cacheKey]) {
        return state.tripApp.cityCache[cacheKey];
    }

    // 元年云 DIM_CITY 系统已知常用城市合法 objectId (叶子节点)，防止网络异常或维表查询未命中导致非 UUID 中文字符串写库崩溃
    const KNOWN_CITY_OBJECT_IDS: Record<string, string> = {
        '上海': '8da94c13de9011e9a156c7132c4fb0bc',
        '天津': '8da861bade9011e9a156e137188c4c0a',
        '北京': '8da861b7de9011e9a1560946114d59f3',
        '广州': '8da94d30de9011e9a156338b8120fa26',
        '深圳': '8da94d40de9011e9a156f7efb2c01999',
        '杭州': '8da94c1cde9011e9a156e1858a74cb45',
        '南京': '8da94c16de9011e9a15663737b8d0092',
        '苏州': '8da94c17de9011e9a156037e293883a4',
        '武汉': '8da94cc3de9011e9a156372545d9e525',
        '成都': '8da94d76de9011e9a156fb18d451e041',
        '重庆': '8da861bbde9011e9a1562b3c79a4dafa',
        '大连': '8da94c03de9011e9a156b509d318e8ce'
    };

    const tryFetch = async (queryDimId: string) => {
        const res = await apiRequest('/fssc/dim/dimObject/getDimObjectAccessTree', 'POST', {
            dimObjectId: queryDimId,
            searchInfo: cleanCity,
            isParentId: false,
            isShowDisable: false,
            isFastShow: true,
            isShowCode: false,
            isShowRootNode: false,
            isSynchronize: false,
            permDataScope: 'BILL_ENTRY',
            loginUserId: state.applicantId,
            isUseSecurityFormal: false
        }, state);

        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
            // 递归扁平化层级树节点（包含嵌套的 children）
            const allNodes: any[] = [];
            const flatten = (list: any[]) => {
                for (const n of list) {
                    allNodes.push(n);
                    if (Array.isArray(n.children) && n.children.length > 0) {
                        flatten(n.children);
                    }
                }
            };
            flatten(res.data);

            const matched = allNodes.filter((item: any) => {
                const desc = item.title || item.data?.name || item.data?.description || item.name || '';
                return desc === cleanCity || desc.includes(cleanCity) || cleanCity.includes(desc);
            });

            // 核心修复：多个匹配时，深度优先选择叶子节点 (例如上海父级 S00002 depth=4，叶子 L00509 depth=5)
            if (matched.length > 1) {
                matched.sort((a, b) => {
                    const depthA = a.data?.depth || (a.children?.length ? 0 : 1);
                    const depthB = b.data?.depth || (b.children?.length ? 0 : 1);
                    return depthB - depthA;
                });
            }

            const best = matched[0] || allNodes[0];
            const val = best.key || best.data?.objectId || best.id || best.data?.accountId;
            if (val) {
                return {
                    value: val,
                    title: { zh_CN: best.title || best.data?.name || best.data?.description || cleanCity }
                };
            }
        }
        return null;
    };

    try {
        let vo = await tryFetch(dimId);
        if (!vo && dimId !== TRIP_CONSTANTS.cityDimObjectId) {
            // 容灾降级：若 DIM_CITY 未命中，尝试出差申请单标准城市维表
            vo = await tryFetch(TRIP_CONSTANTS.cityDimObjectId);
        }

        if (vo) {
            state.tripApp.cityCache[cacheKey] = vo;
            return vo;
        }
    } catch (e: any) {
        AutopilotLogger.warn(`[DynamicCity] 查询城市 [${cleanCity}] 异常: ${e.message}`);
    }

    // 安全保底：绝不返回原始中文字符串作为 value (防止外键约束报错)
    const fallbackValue = KNOWN_CITY_OBJECT_IDS[cleanCity] || KNOWN_CITY_OBJECT_IDS['上海'];
    const fallback = {
        value: fallbackValue,
        title: { zh_CN: cleanCity }
    };
    state.tripApp.cityCache[cacheKey] = fallback;
    return fallback;
}

/**
 * 维表检索项目对象（通用动态检索，支持企业任意项目代码或名称）
 */
export async function fetchProjectVO(projectNameOrCode: string, state: GlobalState): Promise<any> {
    if (!state.tripApp) {
        state.tripApp = {
            configs: [],
            selectedTripIds: new Set(),
            isProcessing: false,
            progressText: '',
            cityBufferPerDay: 100,
            trafficBufferPercent: 0.15,
            cityCache: {},
            personCache: {},
            projectCache: {}
        };
    }

    const cleanProject = (projectNameOrCode || '').trim();
    if (!cleanProject) return null;

    if (state.tripApp.projectCache[cleanProject]) {
        return state.tripApp.projectCache[cleanProject];
    }

    try {
        const res = await apiRequest('/fssc/dim/dimObject/getDimObjectAccessTree', 'POST', {
            dimObjectId: TRIP_CONSTANTS.projectDimObjectId,
            searchInfo: cleanProject,
            isParentId: false,
            isShowDisable: false,
            isFastShow: true,
            isShowCode: false,
            isShowRootNode: false,
            isSynchronize: false,
            permDataScope: 'BILL_ENTRY',
            loginUserId: state.applicantId,
            isUseSecurityFormal: false
        }, state);

        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
            const match = res.data.find((item: any) => {
                const desc = item.data?.description || item.data?.name || item.name || '';
                return desc.includes(cleanProject);
            }) || res.data[0];

            const vo = {
                value: match.data?.objectId || match.id,
                title: { zh_CN: match.data?.description || match.name || cleanProject }
            };
            state.tripApp.projectCache[cleanProject] = vo;
            AutopilotLogger.info(`[DynamicProject] 成功检索项目维表 [${cleanProject}] -> ID: ${vo.value} (${vo.title.zh_CN})`);
            return vo;
        }
    } catch (e: any) {
        AutopilotLogger.warn(`[DynamicProject] 查询项目 [${cleanProject}] 异常: ${e.message}`);
    }

    return null;
}

/**
 * 实时动态检索项目维表列表（供 A2UI 交互下拉菜单与实时模糊搜索使用，0 硬编码）
 */
export async function searchProjectList(
    searchQuery: string,
    state: GlobalState,
    win?: Window | null
): Promise<Array<{ id: string; code: string; name: string; vo: any }>> {
    const clean = (searchQuery || '').trim();
    try {
        if (!state.applicantId) {
            try {
                await fetchLoginUserInfo(state);
            } catch (e) { }
        }

        const payload = {
            dimObjectId: TRIP_CONSTANTS.projectDimObjectId,
            searchInfo: clean,
            isParentId: false,
            isShowDisable: false,
            isFastShow: true,
            isShowCode: true,
            isShowRootNode: false,
            isSynchronize: false,
            permDataScope: 'BILL_ENTRY',
            loginUserId: state.applicantId || '11eee047a80566bca18367ceb209b2e1',
            isUseSecurityFormal: false
        };

        // 优先尝试原生 HTTP 客户端 (100% 鉴权与 Cookie)
        let res: any = await callNativeHttp('/dim/dimObject/getDimObjectAccessTree', 'POST', payload, win);
        if (!res || !res.success) {
            res = await apiRequest('/fssc/dim/dimObject/getDimObjectAccessTree', 'POST', payload, state);
        }

        const list: Array<{ id: string; code: string; name: string; vo: any }> = [];
        if (res && res.success && res.data && Array.isArray(res.data)) {
            const traverse = (nodes: any[]) => {
                nodes.forEach(node => {
                    const d = node.objectAllInfo || node.data || node;
                    const id = d.objectId || d.id || node.memberId || node.id || node.key || '';
                    let name = node.memberName || d.name || d.description || node.name || (d.externalSysAttr?.NAME) || '';
                    const code = d.code || node.code || (d.externalSysAttr?.CODE) || '';
                    if (code && name && !name.includes(code)) {
                        name = `${code} ${name}`;
                    }
                    if (id && (name || code)) {
                        list.push({
                            id,
                            code,
                            name: name || code,
                            vo: {
                                value: id,
                                title: { zh_CN: name || code }
                            }
                        });
                    }
                    if (node.children && Array.isArray(node.children) && node.children.length > 0) {
                        traverse(node.children);
                    }
                });
            };
            traverse(res.data);
            return list;
        }
    } catch (e: any) {
        AutopilotLogger.warn(`[searchProjectList] 检索项目列表失败: ${e.message}`);
    }
    return [];
}


// 通用差旅输入接口 (由自然语言意图、表格文档或大模型动态注入)
export interface DynamicTripInput {
    id?: string;
    tripNo?: number;
    applicantName: string;
    isProxy?: boolean;
    destination: string;
    startDate: string;
    endDate: string;
    purpose?: string;
    targetFactories?: string;
    hotelName?: string;
    baseTrafficFee?: number;
    hotelPricePerNight?: number;
    cityBufferPerDay?: number;
    trafficBufferPercent?: number;
    flightOrTrain?: string; // 班次/车次/航班/交通工具
    legs?: TripLeg[];
    travelers?: string[];
    isCombined?: boolean;
    projectVO?: any;
    projectName?: string;
}

/**
 * 通用日期数学计算：根据起止日期计算出差天数与间夜数
 */
export function calculateDaysAndNights(startDate: string, endDate: string): { days: number; nights: number } {
    try {
        const start = new Date(startDate.replace(/-/g, '/'));
        const end = new Date(endDate.replace(/-/g, '/'));
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return { days: 1, nights: 0 };
        }
        const diffMs = end.getTime() - start.getTime();
        const days = Math.max(1, Math.round(diffMs / (1000 * 3600 * 24)) + 1);
        const nights = Math.max(0, days - 1);
        return { days, nights };
    } catch {
        return { days: 1, nights: 0 };
    }
}

/**
 * 计算误餐补助金（依据通用企业差旅规程：首末往返半天各按半额计算，整日按全额计算）
 */
export function computeMealAllowance(days: number, standardDaily: number = 300, travelHalfDay: number = 150): number {
    if (days <= 0) return 0;
    if (days === 1) return travelHalfDay;
    if (days === 2) return travelHalfDay * 2;
    return travelHalfDay * 2 + (days - 2) * standardDaily;
}

/**
 * 动态单据装配引擎：基于动态行程输入组装完整的单据配置
 */
export function createDynamicTripConfig(
    input: DynamicTripInput,
    defaultCityBuffer: number = 100,
    defaultTrafficBuffer: number = 0.15,
    index: number = 1
): TripApplicationConfig {
    const { days, nights } = calculateDaysAndNights(input.startDate, input.endDate);

    // 住宿差标智能推断：一线城市（北上广深）按 ¥800，其他按 ¥700
    const tier1Cities = ['北京', '上海', '广州', '深圳'];
    const isTier1 = tier1Cities.some(c => (input.destination || '').includes(c));
    const hotelRate = input.hotelPricePerNight ?? (isTier1 ? 800 : 700);
    const hotelFee = nights * hotelRate;

    // 误餐补助
    const mealFee = computeMealAllowance(days);

    // 市内交通与不可预见 Buffer
    const cityBufRate = input.cityBufferPerDay ?? defaultCityBuffer;
    const otherFee = days * cityBufRate;

    // 交通票价与改签 Buffer
    const baseTraffic = input.baseTrafficFee ?? 0;
    const trafficBufPercent = input.trafficBufferPercent ?? defaultTrafficBuffer;
    const trafficBuffer = Math.round(baseTraffic * trafficBufPercent);
    const trafficFee = baseTraffic + trafficBuffer;

    const totalAmount = trafficFee + hotelFee + mealFee + otherFee;

    // 往返程航线/车次生成（若未提供，自动生成默认始发与往返程）
    let legs = input.legs;
    if (!legs || legs.length === 0) {
        const traveler = input.applicantName || '当前用户';
        const flight = resolveTransportLabel(input.flightOrTrain);
        legs = [
            { date: input.startDate, fromCity: '上海', toCity: input.destination, transport: flight, flightOrTrain: flight, travelerName: traveler },
            { date: input.endDate, fromCity: input.destination, toCity: '上海', transport: flight, flightOrTrain: flight, travelerName: traveler }
        ];
    } else {
        // 确保每条 leg 均记录 travelerName
        legs = legs.map(l => ({
            ...l,
            travelerName: l.travelerName || input.applicantName || '当前用户'
        }));
    }

    const tripNo = input.tripNo || index;
    const proxyTag = input.isProxy ? `(代办)` : `(本人)`;
    const defaultPurpose = input.purpose || `${input.destination}业务差旅与实地调研 ${proxyTag}`;

    const feeFormulas: TripFeeFormulas = {
        trafficFormula: `往返大交通基准 (¥${baseTraffic.toLocaleString()}) + 改签弹性${Math.round(trafficBufPercent * 100)}% (¥${trafficBuffer.toLocaleString()}) = ¥${trafficFee.toLocaleString()}`,
        hotelFormula: `${nights}晚 × ¥${hotelRate}/晚 (${isTier1 ? '一线城市限额¥800' : '二三线城市限额¥700'}) = ¥${hotelFee.toLocaleString()}`,
        mealFormula: `${days}天差旅误餐生活补助 (往返乘车日各半额¥150，整天调研¥300) = ¥${mealFee.toLocaleString()}`,
        otherFormula: `${days}天市内出租车/网约车预留 (¥${cityBufRate}/天) = ¥${otherFee.toLocaleString()}`,
        totalFormula: `大交通 ¥${trafficFee.toLocaleString()} + 酒店住宿 ¥${hotelFee.toLocaleString()} + 误餐补助 ¥${mealFee.toLocaleString()} + 市内Buffer ¥${otherFee.toLocaleString()} = ¥${totalAmount.toLocaleString()}`
    };

    return {
        id: input.id || `TRIP-${tripNo}-${input.applicantName}-${Math.random().toString(36).slice(2, 6)}`,
        tripNo,
        applicantName: input.applicantName,
        isProxy: Boolean(input.isProxy),
        travelers: input.travelers || [input.applicantName],
        isCombined: Boolean(input.isCombined),
        startDate: input.startDate,
        endDate: input.endDate,
        days,
        nights,
        destination: input.destination,
        targetFactories: input.targetFactories || '',
        hotelName: input.hotelName || '',
        purpose: defaultPurpose,
        trafficFee,
        hotelFee,
        mealFee,
        otherFee,
        trafficBuffer,
        totalAmount,
        legs,
        feeFormulas,
        projectVO: input.projectVO,
        projectName: input.projectName,
        status: '就绪'
    };
}

/**
 * 解析活动日程时间线表格 (Timeline Activity Table)
 * 严格遵循核心规约：
 * - 【有住宿 即为出差】：只要活动包含酒店住宿安排，即确认为独立出差（含上海金山园区等近郊有住宿出差）；
 * - 【同一目的城市 往返多次 则视为多轮出差，不应该合并】：按往返闭环（从上海出发，返回上海）切分独立出差轮次。
 */
function parseTimelineActivityTable(
    lines: string[],
    delimiter: string | RegExp,
    indices: Record<string, number>
): DynamicTripInput[] {
    interface RawRow {
        type: string;
        city: string;
        factory: string;
        company: string;
        startDate: string;
        endDate: string;
        travelers: string[];
        origin: string;
        dest: string;
        transport: string;
        hotel: string;
    }

    const normalizeDate = (d: string) => {
        const clean = (d || '').trim().replace(/\//g, '-');
        const match = clean.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
        if (match) {
            const m = match[2].padStart(2, '0');
            const day = match[3].padStart(2, '0');
            return `${match[1]}-${m}-${day}`;
        }
        return clean;
    };

    const rawRows: RawRow[] = [];
    for (const line of lines) {
        const cells = line.split(delimiter).map(c => c.trim().replace(/^\||\|$/g, ''));
        if (cells.length < 2) continue;

        const getVal = (idx: number) => (idx !== -1 && idx < cells.length ? cells[idx].trim() : '');
        const type = getVal(indices.typeIdx);
        const city = getVal(indices.cityIdx);
        const factory = getVal(indices.factoryIdx);
        const company = getVal(indices.companyIdx);
        const startDate = normalizeDate(getVal(indices.startIdx));
        const endDate = normalizeDate(getVal(indices.endIdx)) || startDate;
        const nameRaw = getVal(indices.nameIdx);
        const origin = getVal(indices.originIdx);
        const dest = getVal(indices.destIdx);
        const transport = getVal(indices.transportIdx);
        const hotel = getVal(indices.hotelIdx);

        const travelers = nameRaw
            ? nameRaw.split(/[,，、\s]+/).map(n => n.trim()).filter(Boolean)
            : [];

        if (startDate) {
            rawRows.push({
                type,
                city: city.replace(/[-—]/g, ''),
                factory: factory.replace(/[-—]/g, ''),
                company: company.replace(/[-—]/g, ''),
                startDate,
                endDate,
                travelers,
                origin: origin.replace(/[-—]/g, ''),
                dest: dest.replace(/[-—]/g, ''),
                transport: transport.replace(/[-—]/g, ''),
                hotel: hotel.replace(/[-—]/g, '')
            });
        }
    }

    if (rawRows.length === 0) return [];

    // 按往返闭环与有住宿条件切分出差轮次 (Trip Blocks)
    const blocks: RawRow[][] = [];
    let currentBlock: RawRow[] = [];

    // 动态推导常驻出发基准地（遵照 AGENTS.md 0.1 核心铁律，严禁硬编码特定城市，保障 Agent 通用性）
    const firstMoveRow = rawRows.find(r => r.origin && r.dest);
    const detectedBaseCity = firstMoveRow ? firstMoveRow.origin.replace(/(?:市|省)$/, '') : '';
    const isBaseCity = (c: string) => {
        if (!c) return false;
        if (detectedBaseCity) {
            return c.includes(detectedBaseCity) || detectedBaseCity.includes(c);
        }
        return false;
    };

    for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const isOutbound = isBaseCity(row.origin) && Boolean(row.dest) && !isBaseCity(row.dest);
        const isInbound = Boolean(row.origin) && !isBaseCity(row.origin) && isBaseCity(row.dest);
        const hasHotel = Boolean(row.hotel && row.hotel !== '-');

        // 当遇到从始发城市出发的移动，且当前 block 已有内容时，关闭前一个 block，开启新 block
        if (isOutbound && currentBlock.length > 0) {
            blocks.push(currentBlock);
            currentBlock = [row];
            continue;
        }

        // 如果当前没有正在构建的 block，若该行有出差特征（从始发地出发、或有酒店住宿、或有异地活动），开启新 block
        if (currentBlock.length === 0) {
            if (isOutbound || hasHotel || (row.city && !isBaseCity(row.city))) {
                currentBlock.push(row);
            }
            continue;
        }

        // 将当前行加入 block
        currentBlock.push(row);

        // 如果该行是返回常驻地的移动，说明本轮往返闭环完成，立即封口当前 block！
        if (isInbound) {
            blocks.push(currentBlock);
            currentBlock = [];
        }
    }

    if (currentBlock.length > 0) {
        blocks.push(currentBlock);
    }

    // 将各 block 转化为标准的 DynamicTripInput
    const trips: DynamicTripInput[] = [];
    let tripCounter = 1;

    for (const blk of blocks) {
        // 核心规约 1: 【有住宿 即为出差】
        const hotels = Array.from(new Set(blk.map(r => r.hotel).filter(Boolean)));
        const hasHotel = hotels.length > 0;
        const hasOutbound = blk.some(r => isBaseCity(r.origin) && r.dest && !isBaseCity(r.dest));

        // 既无住宿又无往返异地交通的本地日常无意义行过滤
        if (!hasHotel && !hasOutbound) {
            continue;
        }

        // 提炼目的地城市
        let destination = '';
        const cities = blk.map(r => r.city).filter(Boolean);
        const destCities = blk.map(r => r.dest).filter(d => d && !isBaseCity(d));
        if (destCities.length > 0) {
            destination = destCities[0];
        } else if (cities.length > 0) {
            destination = cities[0];
        } else {
            destination = '外地调研';
        }

        // 同城/周边有住宿特殊出差处理（例如金山区、经开区等据点园区）
        if (isBaseCity(destination)) {
            const locDetails = blk.flatMap(r => [r.factory, r.company, r.hotel]).join(' ');
            const districtMatch = locDetails.match(/([^\s\-_()（）]{2,6}(?:区|园区|高新区|经开区|新城))/);
            if (districtMatch) {
                destination = `${destination}${districtMatch[1]}`;
            }
        }
        destination = destination.replace(/省|市/g, '');

        // 统计起止日期
        const allStarts = blk.map(r => r.startDate).sort();
        const allEnds = blk.map(r => r.endDate).sort();
        const startDate = allStarts[0];
        const endDate = allEnds[allEnds.length - 1];

        // 汇总出行人
        const allTravelers = Array.from(new Set(blk.flatMap(r => r.travelers).filter(Boolean)));

        // 收集工厂与据点
        const factories = Array.from(new Set(blk.flatMap(r => [r.factory, r.company]).filter(Boolean)));

        // 核心规约：每位出行人员各自的实际起止周期识别（如李建勇 7/21 出发、陈浩 8/20 返程、成勇/李建勇 8/21 返程）
        const travelerPeriods = new Map<string, { start: string; end: string }>();
        allTravelers.forEach(t => {
            const tRows = blk.filter(r => r.travelers.includes(t));
            if (tRows.length > 0) {
                const starts = tRows.map(r => r.startDate).sort();
                const ends = tRows.map(r => r.endDate).sort();
                travelerPeriods.set(t, { start: starts[0], end: ends[ends.length - 1] });
            }
        });

        // 收集往返航线/车次
        const legs: TripLeg[] = [];
        blk.forEach(r => {
            if (r.origin && r.dest) {
                const transport = resolveTransportLabel(r.transport);
                const travelers = r.travelers.length > 0 ? r.travelers : (allTravelers.length > 0 ? allTravelers : ['当前用户']);
                travelers.forEach(t => {
                    legs.push({
                        date: r.startDate,
                        fromCity: r.origin,
                        toCity: r.dest,
                        transport,
                        flightOrTrain: transport,
                        travelerName: t
                    });
                });
            }
        });

        // 针对未在显式移动行中的人员，按其在该波次中的实际最早出现日期与最后结束日期补齐往返
        const inferredBlockTransport = resolveTransportLabel(blk.map(r => r.transport).filter(Boolean).join(' '));
        allTravelers.forEach(t => {
            const period = travelerPeriods.get(t) || { start: startDate, end: endDate };
            const hasOutbound = legs.some(l => l.travelerName === t && (isBaseCity(l.fromCity) || !isBaseCity(l.toCity)));
            const hasInbound = legs.some(l => l.travelerName === t && (isBaseCity(l.toCity) || !isBaseCity(l.fromCity)));

            if (!hasOutbound) {
                legs.push({
                    date: period.start,
                    fromCity: detectedBaseCity || '出发地',
                    toCity: destination,
                    transport: inferredBlockTransport,
                    flightOrTrain: inferredBlockTransport,
                    travelerName: t
                });
            }
            if (!hasInbound) {
                legs.push({
                    date: period.end,
                    fromCity: destination,
                    toCity: detectedBaseCity || '返回地',
                    transport: inferredBlockTransport,
                    flightOrTrain: inferredBlockTransport,
                    travelerName: t
                });
            }
        });

        legs.sort((a, b) => new Date(a.date.replace(/-/g, '/')).getTime() - new Date(b.date.replace(/-/g, '/')).getTime());

        const hotelDisplay = hotels.join(' / ');
        const factoryDisplay = factories.join('、');
        const purpose = `${destination}业务差旅与实地调研` + (factoryDisplay ? ` (${factoryDisplay})` : '');

        trips.push({
            tripNo: tripCounter++,
            applicantName: allTravelers[0] || '当前用户',
            travelers: allTravelers,
            isProxy: false,
            destination,
            startDate,
            endDate,
            purpose,
            targetFactories: factoryDisplay,
            hotelName: hotelDisplay,
            legs: legs.length > 0 ? legs : undefined
        });
    }

    return trips;
}

/**
 * 通用表格文本解析器：支持用户上传 CSV / TSV / 粘贴文本智能解析为动态行程列表
 */
export function parseItineraryTable(tableText: string): DynamicTripInput[] {
    const lines = tableText.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    // 分隔符识别 (逗号、制表符、竖线、连续空格)
    const firstLine = lines[0];
    let delimiter: string | RegExp = ',';
    if (firstLine.includes('\t')) {
        delimiter = '\t';
    } else if (firstLine.includes('|')) {
        delimiter = '|';
    } else if (firstLine.includes(',')) {
        delimiter = ',';
    } else if (/\s{2,}/.test(firstLine)) {
        delimiter = /\s{2,}/;
    } else if (firstLine.includes(' ')) {
        delimiter = /\s+/;
    }

    const headers = firstLine.split(delimiter).map(h => h.trim().replace(/^\||\|$/g, ''));

    const findCol = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)));
    const typeIdx = findCol(['类型', '类别', '活动类型', 'type']);
    const cityIdx = findCol(['省市', '省份', '城市', '地区', '据点省市']);
    const originIdx = findCol(['移动-起点', '起点', '始发', '出发地', 'from']);
    const destIdx = findCol(['移动-目的地', '目的地', '城市', '地点', '到达地', 'destination', 'city', 'to']);
    const startIdx = findCol(['起始日', '开始日', '出发', '开始', '起期', 'start', '日期', 'date']);
    const endIdx = findCol(['结束日', '截止日', '返程', '结束', '止期', 'end']);
    const nameIdx = findCol(['IV人员', '出行人', '姓名', '员工', '申请人', '人选', 'traveler', 'name']);
    const factoryIdx = findCol(['据点名', '据点', '工厂', '厂区']);
    const companyIdx = findCol(['公司名', '公司', '单位', '企业']);
    const transportIdx = findCol(['交通工具', '班次', '车次', '航班', '交通', '机票', 'FLIGHT', 'TRAIN', 'flight', 'train', 'tool']);
    const hotelIdx = findCol(['住宿酒店', '酒店', '住宿', '宾馆', 'hotel']);
    const tripNoIdx = findCol(['批次', '行程', '序号', '波次', 'trip', 'no', '#']);
    const feeIdx = findCol(['票价', '车费', '机票费', '费用', 'fee', 'price']);
    const purposeIdx = findCol(['事由', '目的', '项目', '调研', 'purpose']);

    // 判断是否为时间线流水表 (Timeline Activity Table: 包含移动/调查类型，或包含单独的起点/目的地/住宿酒店列)
    const isTimelineTable = typeIdx !== -1 || (originIdx !== -1 && destIdx !== -1) || (hotelIdx !== -1 && factoryIdx !== -1);

    if (isTimelineTable) {
        return parseTimelineActivityTable(lines.slice(1), delimiter, {
            typeIdx, cityIdx, originIdx, destIdx, startIdx, endIdx, nameIdx,
            factoryIdx, companyIdx, transportIdx, hotelIdx, tripNoIdx, feeIdx, purposeIdx
        });
    }

    const results: DynamicTripInput[] = [];

    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(delimiter).map(c => c.trim().replace(/^\||\|$/g, ''));
        if (row.length < 2) continue;

        const applicantName = nameIdx !== -1 ? row[nameIdx] : '当前用户';
        const destination = destIdx !== -1 ? row[destIdx] : '';
        const startDate = startIdx !== -1 ? row[startIdx] : '';
        const endDate = endIdx !== -1 ? row[endIdx] : '';
        const baseTrafficFee = feeIdx !== -1 ? parseFloat(row[feeIdx].replace(/[^\d.]/g, '')) || 0 : 0;
        const flightOrTrain = transportIdx !== -1 ? row[transportIdx] : '';
        const purpose = purposeIdx !== -1 ? row[purposeIdx] : '';
        const hotelName = hotelIdx !== -1 ? row[hotelIdx] : '';
        const parsedTripNo = tripNoIdx !== -1 ? parseInt(row[tripNoIdx].replace(/[^\d]/g, ''), 10) || (results.length + 1) : (results.length + 1);

        if (destination && startDate && endDate) {
            results.push({
                tripNo: parsedTripNo,
                applicantName,
                isProxy: false,
                destination,
                startDate,
                endDate,
                hotelName,
                baseTrafficFee,
                flightOrTrain,
                purpose
            });
        }
    }

    return results;
}

/**
 * 将同批次/同目的地的行程按正社员合并为单张出差申请单
 * 遵循用户核心规约：
 * 1. 出差申请不必每人每个目的地提交，可以由正社员提交出差申请，含1个或多个外驻人员的出差预算一并申请；
 * 2. 旅程 (ITINERARY) 可以是多行，FLIGHT/TRAIN ETC. 字段中不仅填写班次，最后要备注出差人员名。
 * 3. 同一目的城市往返多次视为多轮出差，绝不能跨越往返周期合并！
 */
export function combineTripsForMainApplicant(
    inputs: DynamicTripInput[],
    mainApplicantName?: string,
    cityBufferPerDay: number = 100,
    trafficBufferPercent: number = 0.15
): TripApplicationConfig[] {
    if (!inputs || inputs.length === 0) return [];

    // 1. 确定主申请人 (正社员)
    let defaultMain = (mainApplicantName || '').trim();
    if (!defaultMain) {
        // 优先寻找显式标记为本人 (isProxy === false) 的记录
        const selfInp = inputs.find(i => i.isProxy === false);
        defaultMain = selfInp ? selfInp.applicantName : inputs[0].applicantName;
    }

    // 2. 按批次/波次聚类
    // 如果输入明确带有 tripNo，且有相同 tripNo 的多条记录，按 tripNo 聚类
    // 否则按目的地及时间相近性 (出发日期相差 <= 2 天，且属于同一往返) 聚类
    const groups: DynamicTripInput[][] = [];
    const hasExplicitTripNo = inputs.some(i => typeof i.tripNo === 'number' && i.tripNo > 0);

    if (hasExplicitTripNo) {
        const map = new Map<string, DynamicTripInput[]>();
        inputs.forEach((inp, idx) => {
            const key = inp.tripNo ? `TRIP_${inp.tripNo}_${inp.destination || ''}` : `ITEM_${idx}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(inp);
        });
        map.forEach(grp => groups.push(grp));
    } else {
        const used = new Set<number>();
        for (let i = 0; i < inputs.length; i++) {
            if (used.has(i)) continue;
            const grp = [inputs[i]];
            used.add(i);

            const destA = (inputs[i].destination || '').trim();
            const startA = new Date(inputs[i].startDate.replace(/-/g, '/')).getTime();

            for (let j = i + 1; j < inputs.length; j++) {
                if (used.has(j)) continue;
                const destB = (inputs[j].destination || '').trim();
                const startB = new Date(inputs[j].startDate.replace(/-/g, '/')).getTime();

                const isSameDest = destA === destB || destA.includes(destB) || destB.includes(destA);
                // 同一目的城市往返多次视为多轮独立出差，严禁跨往返周期合并！只有出发时间相差 <= 2 天的同行人记录才合并
                const isCloseDate = !isNaN(startA) && !isNaN(startB) && Math.abs(startA - startB) <= 2 * 24 * 3600 * 1000;

                if (isSameDest && isCloseDate) {
                    grp.push(inputs[j]);
                    used.add(j);
                }
            }
            groups.push(grp);
        }
    }


    // 3. 构建单据配置清单
    return groups.map((grp, idx) => {
        const tripNo = idx + 1;
        const allTravelers = Array.from(new Set(
            grp.flatMap(g => (g.travelers && g.travelers.length > 0) ? g.travelers : [g.applicantName]).filter(Boolean)
        ));
        const destination = grp[0].destination || '';

        // 统一起止时间（取所有成员的最早出发和最晚返程）
        const sortedStarts = grp.map(g => g.startDate).filter(Boolean).sort();
        const sortedEnds = grp.map(g => g.endDate).filter(Boolean).sort();
        const minStartDate = sortedStarts[0] || grp[0].startDate;
        const maxEndDate = sortedEnds[sortedEnds.length - 1] || grp[0].endDate;

        const { days: totalDays, nights: totalNights } = calculateDaysAndNights(minStartDate, maxEndDate);

        // 住宿差标智能推断：一线城市（北上广深）按 ¥800，其他按 ¥700
        const tier1Cities = ['北京', '上海', '广州', '深圳'];
        const isTier1 = tier1Cities.some(c => destination.includes(c));

        let sumTrafficFee = 0;
        let sumTrafficBuffer = 0;
        let sumHotelFee = 0;
        let sumMealFee = 0;
        let sumOtherFee = 0;
        const allLegs: TripLeg[] = [];

        // 逐人精准测算各自在该行程中的费用并收集多行旅程明细
        grp.forEach(member => {
            const mTravelers = (member.travelers && member.travelers.length > 0)
                ? member.travelers
                : [member.applicantName];
            const { days: mDays, nights: mNights } = calculateDaysAndNights(member.startDate, member.endDate);
            const mHotelRate = member.hotelPricePerNight ?? (isTier1 ? 800 : 700);
            const mCityRate = member.cityBufferPerDay ?? cityBufferPerDay;
            const mSingleMeal = computeMealAllowance(mDays);

            const mBaseTraffic = member.baseTrafficFee ?? 0;
            const mTrafPercent = member.trafficBufferPercent ?? trafficBufferPercent;
            const mTrafBuf = Math.round(mBaseTraffic * mTrafPercent);
            const mTraffic = mBaseTraffic + mTrafBuf;

            // 核心规约：按实际出差的所有同行人员 (正社员 + 外驻) 独立测算个人出差周期与预算
            mTravelers.forEach(t => {
                let tStart = member.startDate;
                let tEnd = member.endDate;
                if (member.legs && member.legs.length > 0) {
                    const cleanT = t.replace(/（.*）|\(.*\)/g, '').trim();
                    const tLegs = member.legs.filter(l => {
                        const lTrav = (l.travelerName || '').replace(/（.*）|\(.*\)/g, '').trim();
                        return lTrav === cleanT || (l.flightOrTrain && l.flightOrTrain.includes(cleanT));
                    });
                    if (tLegs.length > 0) {
                        const dates = tLegs.map(l => l.date).sort();
                        tStart = dates[0];
                        tEnd = dates[dates.length - 1];
                    }
                }
                const { days: tDays, nights: tNights } = calculateDaysAndNights(tStart, tEnd);
                const tSingleMeal = computeMealAllowance(tDays);

                sumHotelFee += tNights * mHotelRate;
                sumMealFee += tSingleMeal;
                sumOtherFee += tDays * mCityRate;
                sumTrafficFee += mTraffic;
                sumTrafficBuffer += mTrafBuf;
            });

            if (member.legs && member.legs.length > 0) {
                const legsTravelers = new Set(member.legs.map(l => (l.travelerName || '').trim()).filter(Boolean));
                const missingTravelers = mTravelers.filter(t => !legsTravelers.has(t.trim()));

                member.legs.forEach(l => {
                    allLegs.push({
                        date: l.date,
                        fromCity: l.fromCity,
                        toCity: l.toCity,
                        transport: l.transport,
                        flightOrTrain: l.flightOrTrain,
                        travelerName: l.travelerName || member.applicantName
                    });
                });

                // 为尚未在 legs 中的同行外驻人员自动补全对称往返行程
                missingTravelers.forEach(t => {
                    const sampleOut = member.legs!.find(l => l.fromCity.includes('上海') || !l.toCity.includes('上海'));
                    const sampleIn = member.legs!.find(l => l.toCity.includes('上海') || !l.fromCity.includes('上海'));
                    const outTransport = resolveTransportLabel(sampleOut?.flightOrTrain || sampleOut?.transport);
                    const inTransport = resolveTransportLabel(sampleIn?.flightOrTrain || sampleIn?.transport);
                    allLegs.push({
                        date: sampleOut ? sampleOut.date : member.startDate,
                        fromCity: sampleOut ? sampleOut.fromCity : '上海',
                        toCity: sampleOut ? sampleOut.toCity : destination,
                        transport: outTransport,
                        flightOrTrain: sampleOut?.flightOrTrain || outTransport,
                        travelerName: t
                    });
                    allLegs.push({
                        date: sampleIn ? sampleIn.date : member.endDate,
                        fromCity: sampleIn ? sampleIn.fromCity : destination,
                        toCity: sampleIn ? sampleIn.toCity : '上海',
                        transport: inTransport,
                        flightOrTrain: sampleIn?.flightOrTrain || inTransport,
                        travelerName: t
                    });
                });
            } else {
                const flight = resolveTransportLabel(member.flightOrTrain);
                mTravelers.forEach(t => {
                    allLegs.push({
                        date: member.startDate,
                        fromCity: '上海',
                        toCity: destination,
                        transport: flight,
                        flightOrTrain: flight,
                        travelerName: t
                    });
                    allLegs.push({
                        date: member.endDate,
                        fromCity: destination,
                        toCity: '上海',
                        transport: flight,
                        flightOrTrain: flight,
                        travelerName: t
                    });
                });
            }
        });

        // 旅程按日期正序排列
        allLegs.sort((a, b) => new Date(a.date.replace(/-/g, '/')).getTime() - new Date(b.date.replace(/-/g, '/')).getTime());

        const totalAmount = sumTrafficFee + sumHotelFee + sumMealFee + sumOtherFee;

        // 计算逻辑展开
        const mHotelRate = isTier1 ? 800 : 700;
        const avgTrafficPerPerson = allTravelers.length > 0 ? Math.round((sumTrafficFee - sumTrafficBuffer) / allTravelers.length) : 0;
        const feeFormulas: TripFeeFormulas = {
            trafficFormula: `${allTravelers.length}人往返大交通基准 (¥${avgTrafficPerPerson.toLocaleString()}/人) + 改签弹性${Math.round(trafficBufferPercent * 100)}% (¥${sumTrafficBuffer.toLocaleString()}) = ¥${sumTrafficFee.toLocaleString()}`,
            hotelFormula: `${allTravelers.length}人住用合计 (${isTier1 ? '一线限额¥800/晚' : '二三线限额¥700/晚'}) = ¥${sumHotelFee.toLocaleString()}`,
            mealFormula: `${allTravelers.length}人差旅生活补贴 (往返乘车日各半额¥150，整天调研¥300) = ¥${sumMealFee.toLocaleString()}`,
            otherFormula: `${allTravelers.length}人市内出租/网约车预留Buffer (¥${cityBufferPerDay}/人/天) = ¥${sumOtherFee.toLocaleString()}`,
            totalFormula: `大交通 ¥${sumTrafficFee.toLocaleString()} + 酒店住宿 ¥${sumHotelFee.toLocaleString()} + 误餐补助 ¥${sumMealFee.toLocaleString()} + 市内Buffer ¥${sumOtherFee.toLocaleString()} = ¥${totalAmount.toLocaleString()}`
        };

        // 收集目的、调研地点与入住酒店
        const factories = Array.from(new Set(grp.map(g => g.targetFactories).filter(Boolean))).join('; ');
        const hotels = Array.from(new Set(grp.map(g => g.hotelName).filter(Boolean))).join('; ');
        const isMulti = allTravelers.length > 1;
        const purposeTag = isMulti ? `(含外驻人员合报)` : `(本人)`;
        const purpose = grp[0].purpose || `${destination}业务差旅与实地调研 ${purposeTag}`;

        // 主申请人（正社员）：规约明确要求报销人必须是当前登录的正社员，即便合报全为外驻人员出差，单据主报销人依然是该正社员
        const applicant = defaultMain || (allTravelers[0] || '当前用户');
        const isSelfTraveling = allTravelers.includes(applicant);
        const isProxy = !isSelfTraveling;
        const isCombined = allTravelers.length > 1 || isProxy;

        return {
            id: `TRIP-COMBINED-${tripNo}-${applicant}-${Math.random().toString(36).slice(2, 6)}`,
            tripNo,
            applicantName: applicant,
            isProxy,
            travelers: allTravelers,
            isCombined,
            startDate: minStartDate,
            endDate: maxEndDate,
            days: totalDays,
            nights: totalNights,
            destination,
            targetFactories: factories,
            hotelName: hotels,
            purpose,
            trafficFee: sumTrafficFee,
            hotelFee: sumHotelFee,
            mealFee: sumMealFee,
            otherFee: sumOtherFee,
            trafficBuffer: sumTrafficBuffer,
            totalAmount,
            legs: allLegs,
            feeFormulas,
            projectVO: grp[0].projectVO,
            projectName: grp[0].projectName,
            status: '就绪'
        };
    });
}

/**
 * 构造全量出差申请配置清单 (完全基于输入或现有状态动态计算，零硬编码)
 */
export function buildAllTripConfigurations(
    cityBufferPerDay: number = 100,
    trafficBufferPercent: number = 0.15,
    customInputs?: DynamicTripInput[]
): TripApplicationConfig[] {
    if (customInputs && customInputs.length > 0) {
        return customInputs.map((input, idx) =>
            createDynamicTripConfig(input, cityBufferPerDay, trafficBufferPercent, idx + 1)
        );
    }

    return [];
}

/**
 * 安全设置行级普通字段（若字段对象不存在则按元年元数据结构自适应创建，彻底杜绝 undefined.value 异常）
 */
export function ensureRowField(row: any, fieldName: string, value: any, dataType: string = 'STEXT', dataAttribute: string = 'DEFAULT') {
    if (!row.datas) row.datas = {};
    if (!row.datas[fieldName]) {
        row.datas[fieldName] = {
            dataAttribute,
            dataType,
            initValueType: '',
            style: '',
            value: value,
            valueCipher: ''
        };
    } else {
        row.datas[fieldName].value = value;
        if (dataType) row.datas[fieldName].dataType = dataType;
        if (dataAttribute) row.datas[fieldName].dataAttribute = dataAttribute;
    }
}

/**
 * 安全设置行级金额字段（兼容 MONEY 结构，彻底杜绝 undefined.value.amount 异常）
 */
export function ensureRowMoneyField(row: any, fieldName: string, amount: number) {
    if (!row.datas) row.datas = {};
    if (!row.datas[fieldName]) {
        row.datas[fieldName] = {
            dataType: 'MONEY',
            initValueType: '',
            style: '',
            value: {
                amount: amount,
                capital: '',
                exchangeRate: 1,
                currencySymbol: '',
                description: '',
                currencyId: '6e589eb2dd9f11e8b5a69590a14a4e34',
                factor: 0
            },
            valueCipher: ''
        };
    } else {
        if (!row.datas[fieldName].value || typeof row.datas[fieldName].value !== 'object') {
            row.datas[fieldName].value = {
                amount: amount,
                capital: '',
                exchangeRate: 1,
                currencySymbol: '',
                description: '',
                currencyId: '6e589eb2dd9f11e8b5a69590a14a4e34',
                factor: 0
            };
        } else {
            row.datas[fieldName].value.amount = amount;
        }
    }
}

/**
 * 创建并持久化单张出差申请单草稿（通用生产入库）
 */
export async function createSingleTripApplicationApi(
    config: TripApplicationConfig,
    state: GlobalState
): Promise<{ success: boolean; billCode?: string; billMainId?: string; message?: string }> {
    try {
        // 0. 优先确保系统当前登录用户信息与 state.applicantId 100% 就绪
        const loginUser = await fetchLoginUserInfo(state);

        // 1. 获取出行人人员对象 (非代办/本人单据刚性锁定当前登录社员)
        let applicantVO: any;
        const loginBaseName = (loginUser?.userName || '').replace(/（[^）]+）|\([^)]+\)/g, '').trim();
        const isSelf = !config.isProxy && (
            !config.applicantName ||
            config.applicantName === '当前社员' ||
            config.applicantName === '当前用户' ||
            config.applicantName === '本人' ||
            config.applicantName === loginUser?.userName ||
            (loginBaseName && config.applicantName === loginBaseName)
        );

        if (isSelf && state.applicantId) {
            applicantVO = {
                value: state.applicantId,
                title: { zh_CN: loginUser.userName || config.applicantName || '本人' }
            };
        } else {
            applicantVO = await fetchPersonnelVO(config.applicantName, state);
        }

        let billData: any;
        let isUpdate = false;
        let billMainId = config.billMainId || '';
        let billCode = config.billCode || '';

        if (billMainId) {
            // 幂等就地更新：拉取已有草稿单据骨架
            const res = await fetchBillDataAndTemplateApi(billMainId, state);
            billData = res.billData;
            isUpdate = true;
            billCode = billData?.area?.rowDatas?.[0]?.datas?.BILL_CODE?.value || billData?.billCode || billCode;
        } else {
            // 2. 初始化分配新单草稿与单号 (SC2609xxxx)
            const initPayload = {
                billDefineId: TRIP_CONSTANTS.billDefineId,
                appId: state.appId,
                scene: 'WRITE',
                applicantId: config.isProxy ? applicantVO.value : '',
                billMainId: ' ',
                source: 'PC'
            };
            const initRes = await callNativeHttp(
                '/fssc/bill/billdata/getBillDataAndTemplateWrite',
                'POST',
                initPayload,
                null,
                undefined,
                LEGAL_MENU_IDS.TRIP_APPLICATION
            ) || await apiRequest(
                '/fssc/bill/billdata/getBillDataAndTemplateWrite',
                'POST',
                initPayload,
                state,
                false,
                false,
                LEGAL_MENU_IDS.TRIP_APPLICATION
            );

            if (!initRes || !initRes.success || !initRes.data || !initRes.data.billData) {
                throw new Error(initRes?.message || '初始化出差申请草稿模板失败');
            }

            billData = initRes.data.billData;
            billMainId = billData.billMainId;
            billCode = billData?.area?.rowDatas?.[0]?.datas?.BILL_CODE?.value || billData?.billCode || '';
        }

        const mainRow = billData.area.rowDatas[0];

        // 3. 代办/本人申请人绑定 (单据主申请人为正社员)
        if (mainRow.datas.APPLICANT_ID) {
            mainRow.datas.APPLICANT_ID.value = applicantVO;
        } else {
            ensureRowField(mainRow, 'APPLICANT_ID', applicantVO, 'PERSON');
        }
        if (mainRow.datas.USERS_ID) {
            mainRow.datas.USERS_ID.value = [applicantVO];
        }
        if (mainRow.datas.CREATOR_ID) {
            mainRow.datas.CREATOR_ID.value = applicantVO;
        }

        // 4. 回填主表基本信息与费用计算值 (精确至 hh:mm，无则 default 出发 09:00，归宅 23:59)
        const sTime = config.startDate.includes('T') ? config.startDate.split('T')[1] : '';
        const eTime = config.endDate.includes('T') ? config.endDate.split('T')[1] : '';
        const sDate = (sTime && sTime !== '00:00') ? config.startDate : `${config.startDate.split('T')[0]}T09:00`;
        const eDate = (eTime && eTime !== '00:00') ? config.endDate : `${config.endDate.split('T')[0]}T23:59`;
        ensureRowField(mainRow, 'START_TRIP_DATE', sDate, 'DATE');
        ensureRowField(mainRow, 'END_TRIP_DATE', eDate, 'DATE');
        ensureRowField(mainRow, 'F_CCLX', TRIP_CONSTANTS.cclx, 'RADIO');
        ensureRowField(mainRow, 'F_SQDJQF', TRIP_CONSTANTS.sqdjqf, 'RADIO');
        ensureRowField(mainRow, 'F_XMXG', TRIP_CONSTANTS.xmxg, 'RADIO');
        ensureRowField(mainRow, 'F_CZMDPU', config.purpose || '', 'MTEXT');

        const cleanCity = (config.destination || '').replace(/省|市|（.*）|\(.*\)/g, '').trim();
        ensureRowField(mainRow, 'F_CZXCIT', cleanCity, 'STEXT');

        let remaText = `预留市内交通Buffer: ¥${config.otherFee}; 改签Buffer: ¥${config.trafficBuffer}`;
        if (config.travelers && config.travelers.length > 1) {
            remaText = `合报出差人员: ${config.travelers.join('、')}; ` + remaText;
        }
        if (config.targetFactories) {
            remaText += `; 调研地点: ${config.targetFactories}`;
        }
        if (config.hotelName) {
            remaText += `; 入住酒店: ${config.hotelName}`;
        }
        ensureRowField(mainRow, 'F_BKREMA', remaText, 'STEXT');

        // 费用明细 (安全赋值，绝不抛 undefined.value 异常)
        ensureRowMoneyField(mainRow, 'F_HKYLJT', config.trafficFee);
        ensureRowMoneyField(mainRow, 'F_DHO', config.hotelFee);
        ensureRowMoneyField(mainRow, 'F_WCBZDI', config.mealFee);
        ensureRowMoneyField(mainRow, 'F_TOTH', config.otherFee);
        ensureRowMoneyField(mainRow, 'F_HJTOTA', config.totalAmount);
        ensureRowMoneyField(mainRow, 'BUDGET_SUM', config.totalAmount);
        ensureRowMoneyField(mainRow, 'SUM_AMOUNT', config.totalAmount);

        // 5. 组装旅程明细区 (T_BILL_AREA_CCS_DEF_001)
        const tripAreaId = TRIP_CONSTANTS.tripDetailAreaId;
        const tripRowTpl = billData.areaTemplateRow?.[tripAreaId]
            || mainRow.subAreaDatas?.[tripAreaId]?.rowDatas?.[0]
            || {};
        let generatedLegRows: any[] = [];

        if (tripRowTpl && config.legs && config.legs.length > 0) {
            const cleanMain = (config.applicantName || '').replace(/（.*）|\(.*\)/g, '').trim();

            for (let i = 0; i < config.legs.length; i++) {
                const leg = config.legs[i];
                const fromCityVO = await fetchCityVO(leg.fromCity, state);
                const toCityVO = await fetchCityVO(leg.toCity, state);

                const row = JSON.parse(JSON.stringify(tripRowTpl));
                const rowId = generateUuid();
                row.rowId = rowId;

                ensureRowField(row, 'ROW_NUM', i + 1, 'NUMBER');
                ensureRowField(row, 'BILL_ROW_ID', rowId, 'STEXT');
                ensureRowField(row, 'BILL_MAIN_ID', billMainId, 'STEXT');
                ensureRowField(row, 'BILL_PARENT_ID', billMainId, 'STEXT');
                ensureRowField(row, 'VERSION', 1, 'NUMBER');
                ensureRowField(row, 'BILL_DEFINE_ID', TRIP_CONSTANTS.billDefineId, 'STEXT');
                
                // 元年标准日期格式：2026-07-20T09:00 (长度 16，严禁带秒数，否则日期选择器无法识别导致显示为空)
                let legDateStr = (leg.date || '').trim();
                if (!legDateStr.includes('T')) {
                    legDateStr = `${legDateStr}T09:00`;
                } else if (legDateStr.length > 16) {
                    legDateStr = legDateStr.substring(0, 16);
                }
                ensureRowField(row, 'F_DATE', legDateStr, 'DATE');
                ensureRowField(row, 'F_FROM', fromCityVO, 'DROPDOWN');
                ensureRowField(row, 'F_TO', toCityVO, 'DROPDOWN');

                // 核心规约与真实 HAR 规范：FLIGHT/TRAIN ETC. 字段中不仅填写班次，最后按规范标注出行人
                // 真实填报格式：MU5227 | (陈浩) 或 MU5227 | (外驻:成勇)
                let transportBase = (leg.flightOrTrain || leg.transport || '').trim();
                // 过滤掉历史可能的模糊占位符
                if (transportBase === '飞机/高铁' || transportBase === '未知' || transportBase === '待定') {
                    transportBase = resolveTransportLabel(transportBase);
                }
                if (!transportBase) {
                    throw new Error(`第 ${i + 1} 航段 (${leg.date} ${leg.fromCity} -> ${leg.toCity}) 缺少明确交通工具/车次信息，已触发安全 Gate 阻断！请在行程中明确大交通（飞机/高铁/车次）。`);
                }

                let flightText = transportBase;
                const rawTraveler = (leg.travelerName || config.applicantName || '').trim();
                const cleanTraveler = rawTraveler.replace(/（.*）|\(.*\)/g, '').trim();

                const isExternal = cleanTraveler !== cleanMain && !cleanTraveler.includes(cleanMain);
                const travelerLabel = isExternal ? `(外驻:${cleanTraveler})` : `(${cleanTraveler})`;

                if (!flightText.includes(cleanTraveler)) {
                    flightText = `${flightText} | ${travelerLabel}`;
                }
                ensureRowField(row, 'F_FLIGHT', flightText, 'STEXT');

                generatedLegRows.push(row);
            }
            if (mainRow.subAreaDatas) {
                if (!mainRow.subAreaDatas[tripAreaId]) {
                    mainRow.subAreaDatas[tripAreaId] = {
                        boAreaCode: 'T_BILL_AREA_CCS_DEF_001',
                        boAreaId: tripAreaId,
                        rowDatas: []
                    };
                }
                mainRow.subAreaDatas[tripAreaId].rowDatas = generatedLegRows;
            }
        }

        // 6. 预算区蝴蝶效应联动 (DIM_ACCOUNT ➔ DIM_PROJECT)
        const budgetAreaId = TRIP_CONSTANTS.budgetAreaId;
        const budgetArea = mainRow.subAreaDatas?.[budgetAreaId];
        if (budgetArea && budgetArea.rowDatas && budgetArea.rowDatas.length > 0) {
            const bRow = budgetArea.rowDatas[0];
            const budgetRowId = bRow.rowId || bRow.datas?.BILL_ROW_ID?.value || '';

            // 项目联动 (动态项目维表绑定)
            let projectVO = config.projectVO;
            if (!projectVO && config.projectName) {
                projectVO = await fetchProjectVO(config.projectName, state);
            }
            if (!projectVO && state.selectedProject) {
                projectVO = {
                    value: state.selectedProject.value,
                    title: { zh_CN: state.selectedProject.title }
                };
            }

            // 核心避坑：只有定位到合法 projectVO 且为新增单据时才联动为【项目预算】
            // 若为更新已有单据，原预算行已绑定项目，避免重复联动
            if (projectVO && !isUpdate) {
                billData = await changeBillFieldValueApi(
                    'DIM_ACCOUNT',
                    '科目',
                    BUDGET_CONSTANTS.fields.account.fieldId,
                    TRIP_CONSTANTS.account,
                    budgetRowId,
                    prepareBillSceneVO(billData),
                    state
                );

                billData = await changeBillFieldValueApi(
                    'DIM_PROJECT',
                    '项目',
                    BUDGET_CONSTANTS.fields.project.fieldId,
                    projectVO,
                    budgetRowId,
                    prepareBillSceneVO(billData),
                    state
                );
            }

            // 回填预算行客户负担与金额
            const updatedMainRow = billData.area.rowDatas[0];
            const updatedBRow = updatedMainRow.subAreaDatas?.[budgetAreaId]?.rowDatas?.[0];
            if (updatedBRow && updatedBRow.datas) {
                if (updatedBRow.datas.F_KHFD) updatedBRow.datas.F_KHFD.value = TRIP_CONSTANTS.khfd;
                if (updatedBRow.datas.AMOUNT) {
                    if (!updatedBRow.datas.AMOUNT.value || typeof updatedBRow.datas.AMOUNT.value !== 'object') {
                        updatedBRow.datas.AMOUNT.value = { amount: config.totalAmount, exchangeRate: 1, currencyId: '6e589eb2dd9f11e8b5a69590a14a4e34', factor: 0 };
                    } else {
                        updatedBRow.datas.AMOUNT.value.amount = config.totalAmount;
                    }
                    if (updatedBRow.datas.AMOUNT.value.accountAmount) {
                        updatedBRow.datas.AMOUNT.value.accountAmount.amount = config.totalAmount;
                    }
                }
                if (updatedBRow.datas.ACCOUNT_AMOUNT) {
                    if (!updatedBRow.datas.ACCOUNT_AMOUNT.value || typeof updatedBRow.datas.ACCOUNT_AMOUNT.value !== 'object') {
                        updatedBRow.datas.ACCOUNT_AMOUNT.value = { amount: config.totalAmount, exchangeRate: 1, currencyId: '6e589eb2dd9f11e8b5a69590a14a4e34', factor: 0 };
                    } else {
                        updatedBRow.datas.ACCOUNT_AMOUNT.value.amount = config.totalAmount;
                    }
                }
            }
            if (updatedMainRow.datas.BUDGET_SUM) {
                ensureRowMoneyField(updatedMainRow, 'BUDGET_SUM', config.totalAmount);
            }
            if (updatedMainRow.datas.F_HJTOTA) {
                ensureRowMoneyField(updatedMainRow, 'F_HJTOTA', config.totalAmount);
            }
            ensureRowMoneyField(updatedMainRow, 'SUM_AMOUNT', config.totalAmount);
        }

        // 确保旅程明细行完整持久化（防止被蝴蝶效应接口返回重置）
        if (generatedLegRows.length > 0) {
            const targetMainRow = billData.area.rowDatas[0];
            if (!targetMainRow.subAreaDatas) targetMainRow.subAreaDatas = {};
            if (!targetMainRow.subAreaDatas[tripAreaId]) {
                targetMainRow.subAreaDatas[tripAreaId] = {
                    boAreaCode: 'T_BILL_AREA_CCS_DEF_001',
                    boAreaId: tripAreaId,
                    rowDatas: []
                };
            }
            targetMainRow.subAreaDatas[tripAreaId].rowDatas = generatedLegRows;
        }

        // 7. 持久化保存单据为草稿 (operationType: ADD, commit: false)
        const savePayload = JSON.parse(JSON.stringify(billData));
        savePayload.billButtons = [];
        savePayload.commit = false;
        savePayload.operationType = isUpdate ? 'UPDATE' : 'ADD';
        savePayload.scene = 'WRITE';
        savePayload.createNew = !isUpdate;
        savePayload.dataModify = true;
        savePayload.allowSave = true;
        savePayload.statusEnum = 'UNCOMMITTED';
        if (!savePayload.appId) {
            savePayload.appId = state?.appId || 'e3d5e4787ff911e88b1997bee3518b4d';
        }
        if (!savePayload.currentUserId && state.applicantId) {
            savePayload.currentUserId = state.applicantId;
        }
        if (!savePayload.attachmentDeleteList) savePayload.attachmentDeleteList = [];
        if (!savePayload.attachmentUploadList) savePayload.attachmentUploadList = [];
        if (savePayload.attachmentDeleteSync === undefined) savePayload.attachmentDeleteSync = false;

        const saveRes = await callNativeHttp(
            '/fssc/bill/billdata/saveBillData',
            'POST',
            savePayload,
            null,
            undefined,
            LEGAL_MENU_IDS.TRIP_APPLICATION
        ) || await apiRequest(
            '/fssc/bill/billdata/saveBillData',
            'POST',
            savePayload,
            state,
            false,
            false,
            LEGAL_MENU_IDS.TRIP_APPLICATION
        );

        if (saveRes && saveRes.success) {
            AutopilotLogger.info(`[DynamicTripApp] 成功创建出差申请草稿: ${billCode} (${config.applicantName} - ${config.destination})`);
            return {
                success: true,
                billCode: billCode,
                billMainId: billMainId
            };
        } else {
            throw new Error(saveRes.message || '保存单据失败');
        }
    } catch (err: any) {
        AutopilotLogger.error(`[DynamicTripApp] 创建单据失败 [${config.applicantName} - ${config.destination}]: ${err.message}`);
        return {
            success: false,
            message: err.message || '未知错误'
        };
    }
}
