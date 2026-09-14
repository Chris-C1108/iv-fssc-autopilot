import { GlobalState } from '../types/state';

declare const GM_xmlhttpRequest: any;
declare const unsafeWindow: any;

import { AutopilotLogger } from './logger';

let cachedNativeHttp: any = null;
let cachedNativeAxios: any = null;

/**
 * 遍历收集宿主页面、当前窗口以及所有 iframe 上下文，彻底打通跨微前端候选窗口
 */
function collectWindowCandidates(win?: Window | null): any[] {
    const set = new Set<any>();
    const addWin = (w: any) => {
        if (w && !set.has(w)) {
            set.add(w);
            if (w.unsafeWindow) set.add(w.unsafeWindow);
        }
    };

    if (win) {
        addWin(win);
        if (win.top && win.top !== win) addWin(win.top);
    }
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
        addWin(unsafeWindow);
        if (unsafeWindow.top && unsafeWindow.top !== unsafeWindow) addWin(unsafeWindow.top);
    }
    if (typeof window !== 'undefined' && window) {
        addWin(window);
        if (window.top && window.top !== window) addWin(window.top);
    }

    const docsToScan: Document[] = [];
    if (typeof document !== 'undefined') docsToScan.push(document);
    if (win && win.document && !docsToScan.includes(win.document)) docsToScan.push(win.document);
    try {
        if (typeof window !== 'undefined' && window.top && window.top.document && !docsToScan.includes(window.top.document)) {
            docsToScan.push(window.top.document);
        }
    } catch (e) { }

    for (const d of docsToScan) {
        try {
            d.querySelectorAll('iframe').forEach(f => {
                if (f.contentWindow) addWin(f.contentWindow);
            });
        } catch (e) { }
    }

    return Array.from(set);
}

/**
 * 从宿主微前端容器中提取挂载了官方 request 拦截器 (自动计算 eicds/v 签名) 的 Axios 实例
 */
export function getNativeAxios(win?: Window | null): any {
    if (cachedNativeAxios) return cachedNativeAxios;

    const candidates = collectWindowCandidates(win);

    for (const targetWin of candidates) {
        if (!targetWin) continue;
        if (targetWin.__nativeAxios) {
            cachedNativeAxios = targetWin.__nativeAxios;
            return cachedNativeAxios;
        }
        try {
            const wp = targetWin.webpackJsonp;
            if (wp && Array.isArray(wp)) {
                wp.push([
                    ['__native_axios_extractor__'],
                    {
                        '__native_axios_extractor__': function (module: any, exports: any, __webpack_require__: any) {
                            if (__webpack_require__ && __webpack_require__.c) {
                                for (const id in __webpack_require__.c) {
                                    const m = __webpack_require__.c[id]?.exports;
                                    if (m && (m.default?.post && m.default?.getHt)) {
                                        // 寻找底层原生 Axios 实例 (带 request/response 拦截器)
                                        for (const subId in __webpack_require__.c) {
                                            const subMod = __webpack_require__.c[subId]?.exports;
                                            if (subMod && subMod.default && typeof subMod.default.request === 'function' && subMod.default.interceptors) {
                                                cachedNativeAxios = subMod.default;
                                                targetWin.__nativeAxios = cachedNativeAxios;
                                                break;
                                            }
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    },
                    [['__native_axios_extractor__']]
                ]);
                if (cachedNativeAxios) return cachedNativeAxios;
            }
        } catch (e) { }
    }

    return cachedNativeAxios;
}

/**
 * 从宿主页面或 iframe 提取 YuanNian 原生 HTTP 客户端（基于 webpackJsonp 封装的 request 实例）
 */
export function getNativeHttp(win?: Window | null): any {
    if (cachedNativeHttp) return cachedNativeHttp;

    const candidates = collectWindowCandidates(win);

    for (const targetWin of candidates) {
        if (!targetWin) continue;
        if (targetWin.__nativeHttp) {
            cachedNativeHttp = targetWin.__nativeHttp;
            return cachedNativeHttp;
        }
        try {
            const wp = targetWin.webpackJsonp;
            if (wp && Array.isArray(wp)) {
                wp.push([
                    ['__native_http_extractor__'],
                    {
                        '__native_http_extractor__': function (module: any, exports: any, __webpack_require__: any) {
                            if (__webpack_require__ && __webpack_require__.c) {
                                for (const id in __webpack_require__.c) {
                                    const m = __webpack_require__.c[id]?.exports;
                                    if (m && (m.default?.post && m.default?.getHt)) {
                                        cachedNativeHttp = m.default;
                                        targetWin.__nativeHttp = cachedNativeHttp;
                                        break;
                                    }
                                }
                            }
                        }
                    },
                    [['__native_http_extractor__']]
                ]);
                if (cachedNativeHttp) return cachedNativeHttp;
            }
        } catch (e) { }
    }

    return cachedNativeHttp;
}

export const LEGAL_MENU_IDS = {
    TRIP_APPLICATION: '56dcfd90a5bf11e8a1a103bb1accbe1b', // 出差申请单 (CCSQ, 0355cf627fede1653e55bb00bc610001)
    EXPENSE_RECORD: '56dd4bb8a5bf11e8a1a1d174f439477e',   // 费用记录 (expenseRecord, expenseClaim)
    INVOICE_POOL: '11ec6dd3fd5cb161bff83bb033997150',     // 发票夹 (standbyInvoice, businessapplication)
    REIMBURSEMENT_CLAIM: '11ece08b4737d4eda79a6b404608a354' // 员工报销单 (BC: 035a50ee..., BJ: 035cd1b4...)
};

/**
 * 依据请求 URL、请求载荷及单据定义 ID 动态推断其法定 MenuId
 */
export function inferLegalMenuId(url?: string, data?: any, explicitMenuId?: string): string {
    if (explicitMenuId) return explicitMenuId;

    // 1. 检查载荷中的单据定义 ID / Code (精确识别出差申请单与报销单)
    const bId = data?.billDefineId || data?.billDefineCode || data?.billSceneDataVO?.billDefineId || '';
    if (bId === '0355cf627fede1653e55bb00bc610001' || bId === 'CCSQ' || (url && /CCSQ/i.test(url))) {
        return LEGAL_MENU_IDS.TRIP_APPLICATION;
    }
    if (bId === '035a50ee6d3de1653e55bb00bc610001' || bId === '035cd1b4d46de1653e55bb00bc610000' || bId === 'BC' || bId === 'BJ') {
        return LEGAL_MENU_IDS.REIMBURSEMENT_CLAIM;
    }

    // 2. 检查 URL 路径特征
    if (url) {
        if (/expenseClaim|expenseRecord/i.test(url)) {
            return LEGAL_MENU_IDS.EXPENSE_RECORD;
        }
        if (/boQuery|standbyInvoice|businessapplication/i.test(url)) {
            return LEGAL_MENU_IDS.INVOICE_POOL;
        }
    }

    // 3. 检查当前页面宿主 URL
    if (typeof window !== 'undefined') {
        if (/11ec6dd3fd5cb161bff83bb033997150|businessapplication/i.test(window.location.href)) {
            return LEGAL_MENU_IDS.INVOICE_POOL;
        }
    }

    return '';
}

/**
 * 包装通过 YuanNian 宿主原生 HTTP / Axios 客户端发送请求 (自动具备 100% 鉴权与 eicds 动态防逆向加密签名)
 */
export async function callNativeHttp(
    url: string,
    method: string = 'POST',
    data: any = null,
    win?: Window | null,
    customHeaders?: Record<string, string>,
    targetMenuId?: string
): Promise<any> {
    const isGet = method.toUpperCase() === 'GET';
    const effectiveMenuId = targetMenuId || customHeaders?.['MenuId'] || customHeaders?.['menuid'] || inferLegalMenuId(url, data);

    // 1. 最高优先级：直接使用官方原生 Axios 实例 (支持 Promise、30s 充裕超时、100% 自动注入 eicds 签名)
    const nativeAxios = getNativeAxios(win);
    if (nativeAxios) {
        let fullUrl = url;
        if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
            if (!fullUrl.startsWith('/fssc/')) {
                fullUrl = '/fssc' + (fullUrl.startsWith('/') ? fullUrl : '/' + fullUrl);
            }
        }

        // 收集所有候选窗口，用于在请求生命周期内临时安全切换 ecs_MenuId 作用域，确保官方拦截器生成包含合法 MenuId 的 eicds 签名
        const candidateWins = collectWindowCandidates(win);
        const originalMenuIds = new Map<Storage, string | null>();

        if (effectiveMenuId) {
            for (const cw of candidateWins) {
                try {
                    const stor = cw.sessionStorage;
                    if (stor) {
                        originalMenuIds.set(stor, stor.getItem('ecs_MenuId'));
                        stor.setItem('ecs_MenuId', effectiveMenuId);
                    }
                } catch (e) { }
            }
        }

        try {
            const reqHeaders: Record<string, string> = { ...(customHeaders || {}) };
            if (effectiveMenuId) {
                reqHeaders['MenuId'] = effectiveMenuId;
                reqHeaders['menuid'] = effectiveMenuId;
            }

            // 嗅探并注入 appId：原生拦截器不会注入 appId，它仅在宿主初始化时写入 defaults.headers.common
            // 当 callNativeHttp 传入自定义 headers 时，部分 Axios 版本可能导致 common defaults 被忽略
            // 因此必须显式确保 appId 始终存在于请求 Headers 中
            if (!reqHeaders['appId'] && !reqHeaders['appid']) {
                const APP_ID = 'e3d5e4787ff911e88b1997bee3518b4d';
                // 优先从原生 Axios defaults 嗅探真实 appId
                let sniffedAppId = '';
                try {
                    sniffedAppId = nativeAxios?.defaults?.headers?.common?.appId
                        || nativeAxios?.defaults?.headers?.common?.appid
                        || '';
                } catch (e) { }
                // 次级：从 sessionStorage 嗅探
                if (!sniffedAppId) {
                    for (const cw of candidateWins) {
                        try {
                            const val = cw.sessionStorage?.getItem('ecs_appId')
                                || cw.sessionStorage?.getItem('appId');
                            if (val && val.length > 10) { sniffedAppId = val; break; }
                        } catch (e) { }
                    }
                }
                reqHeaders['appId'] = sniffedAppId || APP_ID;
                reqHeaders['appid'] = sniffedAppId || APP_ID;
            }

            // 嗅探并注入鉴权 Token (LoginToken / EcsToken / UserOrigin)
            // 原生 Axios defaults 中通常包含这些 headers
            if (!reqHeaders['LoginToken']) {
                try {
                    const lt = nativeAxios?.defaults?.headers?.common?.LoginToken || '';
                    if (lt) reqHeaders['LoginToken'] = lt;
                } catch (e) { }
            }
            if (!reqHeaders['EcsToken']) {
                try {
                    const et = nativeAxios?.defaults?.headers?.common?.EcsToken || '';
                    if (et) reqHeaders['EcsToken'] = et;
                } catch (e) { }
            }
            if (!reqHeaders['UserOrigin']) {
                reqHeaders['UserOrigin'] = (typeof window !== 'undefined' ? window.location.origin : '') || 'https://ync37.yuanian.com';
            }

            const resp = await nativeAxios.request({
                url: fullUrl,
                method: method.toUpperCase(),
                data: isGet ? undefined : data,
                params: isGet ? data : undefined,
                timeout: 30000, // 放宽至 30 秒，彻底杜绝并发保存时的假死与早逝超时
                ignoreLoading: true,
                headers: reqHeaders
            });
            return resp.data;
        } catch (err: any) {
            AutopilotLogger.warn(`[callNativeHttp/Axios] 原生 Axios 响应异常: ${err?.message || ''}`);
            if (err && err.data) {
                return err.data;
            }
            if (err && err.response && err.response.data) {
                return err.response.data;
            }
            if (err?.code === 'ECONNABORTED' || err?.message?.includes('timeout')) {
                return { success: false, message: '原生网络请求超时 (30s)，请稍后重试' };
            }
            return { success: false, message: err?.message || '原生网络请求异常' };
        } finally {
            // 【核心安全守卫】：请求结束无论成功失败，必须 100% 立即还原原始 ecs_MenuId
            if (effectiveMenuId && originalMenuIds.size > 0) {
                for (const [stor, origVal] of originalMenuIds.entries()) {
                    try {
                        if (origVal !== null) {
                            stor.setItem('ecs_MenuId', origVal);
                        } else {
                            stor.removeItem('ecs_MenuId');
                        }
                    } catch (e) { }
                }
            }
        }
    }

    // 2. 次级优先级：宿主封装客户端 nativeHttp
    const native = getNativeHttp(win);
    if (!native) return null;

    let cleanUrl = url;
    if (cleanUrl.startsWith('/fssc/')) {
        cleanUrl = cleanUrl.substring(5);
    } else if (cleanUrl.startsWith('https://') || cleanUrl.startsWith('http://')) {
        const m = cleanUrl.match(/https?:\/\/[^/]+(\/fssc)?(\/.*)/);
        if (m) cleanUrl = m[2];
    }
    if (!cleanUrl.startsWith('/')) {
        cleanUrl = '/' + cleanUrl;
    }

    const fn = (isGet ? native.get : native.post) || native.post;
    if (typeof fn !== 'function') return null;

    return new Promise((resolve) => {
        let isSettled = false;
        const timer = setTimeout(() => {
            if (!isSettled) {
                isSettled = true;
                AutopilotLogger.warn(`[callNativeHttp] 请求超时 (30s) 自动释放: ${cleanUrl}`);
                resolve({ success: false, message: '原生请求超时 (30s)' });
            }
        }, 30000);

        const safeResolve = (val: any) => {
            if (!isSettled) {
                isSettled = true;
                clearTimeout(timer);
                resolve(val);
            }
        };

        try {
            fn.call(
                native,
                cleanUrl,
                data,
                (res: any) => {
                    safeResolve(res);
                },
                true,
                (err: any) => {
                    safeResolve({ success: false, message: err?.message || '原生请求异常' });
                }
            );
        } catch (e: any) {
            safeResolve({ success: false, message: e.message || '原生请求异常' });
        }
    });
}

/**
 * 全方位、实时动态嗅探宿主页面与所有 iframe 中的最新 Token
 * 覆盖：top window 与所有同源 iframe 的 sessionStorage / localStorage / URL 查询参数 / Cookies
 */
export function extractLatestTokens(state: GlobalState): { loginToken: string; ecsToken: string } {
    let bestLoginToken = '';
    let bestEcsToken = '';

    // 1. 扫描 URL 参数 (最高权威性，宿主打开各微前端应用时直接在 URL 下发最新 TOKEN)
    const scanUrlForToken = (href: string) => {
        if (!href) return;
        try {
            const m = href.match(/[?&]TOKEN=([a-zA-Z0-9_\-]+)/i);
            if (m && m[1] && m[1].length > 10) {
                bestLoginToken = m[1];
            }
        } catch (e) { }
    };

    if (typeof window !== 'undefined') {
        scanUrlForToken(window.location.href);
        if (typeof document !== 'undefined') {
            document.querySelectorAll('iframe').forEach(f => {
                scanUrlForToken(f.src);
                try {
                    if (f.contentWindow?.location?.href) {
                        scanUrlForToken(f.contentWindow.location.href);
                    }
                } catch (e) { }
            });
        }
    }

    // 2. 扫描 Storage (优先检查 iframe 的 sessionStorage，因为微前端子应用往往持有最新状态)
    const storages: (Storage | undefined)[] = [];
    if (typeof document !== 'undefined') {
        document.querySelectorAll('iframe').forEach(f => {
            try {
                if (f.contentWindow?.sessionStorage) storages.push(f.contentWindow.sessionStorage);
                if (f.contentWindow?.localStorage) storages.push(f.contentWindow.localStorage);
            } catch (e) { }
        });
    }
    if (typeof sessionStorage !== 'undefined') storages.push(sessionStorage);
    if (typeof localStorage !== 'undefined') storages.push(localStorage);

    for (const s of storages) {
        if (!s) continue;
        if (!bestLoginToken) {
            for (const k of ['ecs_TOKEN', 'console_TOKEN', 'LoginToken', 'token']) {
                const val = s.getItem(k);
                if (val && typeof val === 'string' && val.length > 10) {
                    bestLoginToken = val;
                    break;
                }
            }
        }
        if (!bestEcsToken) {
            for (const k of ['ecs_token', 'EcsToken']) {
                const val = s.getItem(k);
                if (val && typeof val === 'string' && val.length > 10) {
                    bestEcsToken = val;
                    break;
                }
            }
        }
        // 3. 扫描并自动同步宿主当前登录用户信息 (包含真实 userId, userName, loginName)
        if (!state.currentUser?.userId || !state.applicantId) {
            try {
                const uStr = s.getItem('ecs_currentUser');
                if (uStr) {
                    const u = JSON.parse(uStr);
                    if (u && u.id) {
                        if (!state.currentUser) state.currentUser = {} as any;
                        state.currentUser.userId = u.id;
                        state.currentUser.userName = u.userName || '';
                        state.currentUser.loginName = u.loginName || '';
                        state.applicantId = u.id;
                        state.applicantName = u.userName || '';
                    }
                }
            } catch (e) { }
        }

        if (bestLoginToken && bestEcsToken && state.applicantId) break;
    }

    if (bestLoginToken) state.loginToken = bestLoginToken;
    if (bestEcsToken) state.ecsToken = bestEcsToken;

    return { loginToken: state.loginToken || bestLoginToken || '', ecsToken: state.ecsToken || bestEcsToken || '' };
}

export function getHeaders(
    state: GlobalState,
    isFormUrlEncoded = false,
    isMultipart = false,
    url?: string,
    customMenuId?: string,
    data?: any
): Record<string, string> {
    const { loginToken, ecsToken } = extractLatestTokens(state);
    
    // 动态精准识别菜单 ID：根据请求接口路径与单据数据强优先匹配对应模块的法定 MenuId，杜绝跨模块 ACL 拒绝
    let menuId = customMenuId || inferLegalMenuId(url, data);
    if (!menuId) {
        menuId = state.menuId || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('ecs_MenuId') : '') || LEGAL_MENU_IDS.EXPENSE_RECORD;
    }

    const headers: Record<string, string> = {
        'LoginToken': loginToken,
        'logintoken': loginToken,
        'EcsToken': ecsToken,
        'ecstoken': ecsToken,
        'UserOrigin': state.userOrigin || 'https://ync37.yuanian.com',
        'appid': state.appId || 'e3d5e4787ff911e88b1997bee3518b4d',
        'appId': state.appId || 'e3d5e4787ff911e88b1997bee3518b4d',
        'menuid': menuId,
        'MenuId': menuId,
        'Accept': 'application/json, text/plain, */*'
    };
    if (state.eicds) headers['eicds'] = typeof state.eicds === 'string' ? state.eicds : JSON.stringify(state.eicds);
    if (state.v) headers['v'] = state.v;

    if (isFormUrlEncoded) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    } else if (!isMultipart) {
        headers['Content-Type'] = 'application/json;charset=UTF-8';
    }
    return headers;
}

export async function apiRequest(
    url: string,
    method: string = 'POST',
    data: any = null,
    state: GlobalState,
    isFormUrlEncoded = false,
    isMultipart = false,
    customMenuId?: string
): Promise<any> {
    extractLatestTokens(state);

    if (!state.loginToken && !state.ecsToken) {
        throw new Error('未检测到登录 Token，请先在页面上刷新或操作以捕获 Token');
    }

    // =========================================================================
    // 【核心红线铁律守卫】：禁止调用“提交”按钮接口，只允许调用“保存”按钮接口！
    // 任何单据提交进入审批流的操作必须严格留给用户在页面上人工复核后手动点击提交。
    // =========================================================================
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('/submitbilldata') || lowerUrl.includes('/flow/runtime/commit') || lowerUrl.includes('/submitbill')) {
        throw new Error('[Security Guard] 核心铁律拦截：智能副驾绝对禁止调用“提交”按钮审批流接口！所有单据仅允许保存为未提交草稿（saveBillData），单据提交审批流必须由用户人工复核后手动点击。');
    }

    // 刚性重写：凡保存单据请求，若包含 commit 字段一律强制为 false
    if (data && typeof data === 'object' && !isFormUrlEncoded && !isMultipart) {
        if ('commit' in data && data.commit === true) {
            console.warn('[Security Guard] 检测到 commit: true，已刚性强制重写为 commit: false，确保只保存草稿不触发审批提交！');
            data.commit = false;
        }
    }

    const targetMenuId = customMenuId || inferLegalMenuId(url, data);

    // 若宿主环境中提取到了官方原生客户端，优先通过 callNativeHttp 发起请求以获取原生 eicds 与鉴权保护
    const nativeAxios = getNativeAxios();
    if (nativeAxios && !isFormUrlEncoded && !isMultipart) {
        try {
            const nativeRes = await callNativeHttp(url, method, data, null, undefined, targetMenuId);
            if (nativeRes && typeof nativeRes === 'object' && ('success' in nativeRes || 'data' in nativeRes)) {
                return nativeRes;
            }
        } catch (e: any) {
            AutopilotLogger.warn(`[apiRequest] 原生通道调用异常，自动回退到底层通道: ${e?.message}`);
        }
    }

    const fullUrl = url.startsWith('http') ? url : `${state.userOrigin || 'https://ync37.yuanian.com'}${url}`;
    const headers = getHeaders(state, isFormUrlEncoded, isMultipart, url, targetMenuId, data);

    let bodyStr: any = undefined;
    if (data) {
        if (isFormUrlEncoded || isMultipart) {
            bodyStr = data;
        } else {
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
                onload: (response: any) => {
                    try {
                        const json = JSON.parse(response.responseText);
                        resolve(json);
                    } catch (e) {
                        resolve({ success: false, message: response.responseText || '解析响应失败' });
                    }
                },
                onerror: (err: any) => reject(err)
            });
        } else {
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
