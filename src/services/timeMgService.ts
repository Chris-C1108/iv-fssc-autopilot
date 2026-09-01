import { TIME_MG_CONSTANTS } from '../config/timeMgConstants';
import { ProjectExpItem, AttendanceDetailItem, PopProjectItem, TimeMgState } from '../types/timeMgTypes';

/**
 * 获取当前页面的 CSRF Token
 */
export function getCsrfToken(state?: TimeMgState): string {
    if (state && state.csrfToken) return state.csrfToken;

    // 1. 从 meta 标签查找
    const metaCsrf = document.querySelector('meta[name="_csrf"]')?.getAttribute('content') ||
                     document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (metaCsrf) return metaCsrf;

    // 2. 从 Cookie 查找
    const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/i) || document.cookie.match(/_csrf=([^;]+)/i);
    if (match) return decodeURIComponent(match[1]);

    // 3. 从页面全局变量或 hidden input 查找
    const inputCsrf = (document.querySelector('input[name="_csrf"]') as HTMLInputElement)?.value;
    if (inputCsrf) return inputCsrf;

    return '';
}

/**
 * 封装带 CSRF Token 和凭据的通用 POST 请求
 */
async function timeMgPost<T>(endpoint: string, body: any, state?: TimeMgState): Promise<T> {
    const csrfToken = getCsrfToken(state);
    const headers: Record<string, string> = {
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
export function detectActiveYearAndMonth(): { year: string; month: string } {
    try {
        const allEls = Array.from(document.querySelectorAll('*'));
        for (const el of allEls) {
            const v = (el as any).__vue__;
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
            const val = ((input as HTMLInputElement).value || '').trim();
            const m = val.match(/^(\d{4})[-/](\d{1,2})$/);
            if (m) {
                return {
                    year: m[1],
                    month: m[2].padStart(2, '0')
                };
            }
        }
    } catch (e) {}

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
export async function fetchExpWHInfoApi(objY: string, objM: string, state?: TimeMgState): Promise<ProjectExpItem[]> {
    const targetYm = `${String(objY)}${String(objM).padStart(2, '0')}`;
    try {
        const allEls = Array.from(document.querySelectorAll('*'));
        for (const el of allEls) {
            const v = (el as any).__vue__;
            // 严格校验宿主内存中的当前激活月份是否与请求的目标月份完全一致
            const isMatch = (v && v.attendance && v.attendance.ym && v.attendance.ym.replace(/[-/]/g, '') === targetYm) ||
                            (v && v.hotSettings && Array.isArray(v.hotSettings.data) && v.hotSettings.data.length > 0 && String(v.hotSettings.data[0].ymd || '').startsWith(targetYm));
            if (isMatch && Array.isArray(v.expWhs) && v.expWhs.length > 0) {
                return v.expWhs.map((item: any) => {
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
    } catch (e) {}

    const payload = {
        objY: String(objY),
        objM: String(objM).padStart(2, '0')
    };

    const res: any = await timeMgPost(TIME_MG_CONSTANTS.ENDPOINTS.EXP_WH_INFO, payload, state);
    const rawList: any[] = res?.datas?.searchResult || [];

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
export async function fetchDetailWHInfoApi(objY: string, objM: string, state?: TimeMgState): Promise<AttendanceDetailItem[]> {
    const targetYm = `${String(objY)}${String(objM).padStart(2, '0')}`;
    try {
        const allEls = Array.from(document.querySelectorAll('*'));
        for (const el of allEls) {
            const v = (el as any).__vue__;
            // 严格校验宿主内存中的第一行日期是否属于 targetYm
            if (v && v.hotSettings && Array.isArray(v.hotSettings.data) && v.hotSettings.data.length > 0) {
                const firstYmd = String(v.hotSettings.data[0].ymd || '');
                if (firstYmd.startsWith(targetYm)) {
                    return v.hotSettings.data.map((item: any) => ({
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
    } catch (e) {}

    const payload = {
        objY: String(objY),
        objM: String(objM).padStart(2, '0')
    };

    const res: any = await timeMgPost(TIME_MG_CONSTANTS.ENDPOINTS.DETAIL_WH_INFO, payload, state);
    const rawList: any[] = res?.datas?.searchResult || [];

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
 * 3. 查询项目字典列表
 */
export async function fetchPopProjectListApi(currentDate: string, state?: TimeMgState): Promise<PopProjectItem[]> {
    const payload = {
        paging: false,
        params: {
            method: '0',
            currentDate: currentDate.replace('-', '')
        }
    };

    const res: any = await timeMgPost(TIME_MG_CONSTANTS.ENDPOINTS.PROJECT_LIST, payload, state);
    const rawList: any[] = res?.datas?.searchResult?.results || [];

    return rawList.map(item => ({
        pjNo: item.pjNo || '',
        name: item.name || '',
        expFromDt: item.expFromDt || '',
        expToDt: item.expToDt || '',
        pm: item.pm || '',
        branch: item.branch || '',
        flgPJG: item.flgPJG || '2',
        pjInfoID: item.pjInfoID || '',
        pjgID: item.pjgID || null
    }));
}

/**
 * 4. 工时试算接口
 */
export async function getActualWHApi(ymd: string, startTime: string, endTime: string, state?: TimeMgState): Promise<number> {
    const payload = {
        ymd: ymd.replace(/-/g, ''),
        startTime: startTime.replace(':', ''),
        endTime: endTime.replace(':', '')
    };

    const res: any = await timeMgPost(TIME_MG_CONSTANTS.ENDPOINTS.ACTUAL_WH, payload, state);
    return Number(res?.datas?.searchResult ?? 7.5);
}

/**
 * 5. 考勤提交/保存前置校验接口
 */
export async function submitOrSaveCheckApi(payload: any, state?: TimeMgState): Promise<any> {
    return await timeMgPost(TIME_MG_CONSTANTS.ENDPOINTS.SUBMIT_OR_SAVE_CHECK, payload, state);
}

/**
 * 6. 考勤明细持久化保存/提交接口 (Twin Client 直连后端)
 */
export async function commitDetailApi(payload: any, state?: TimeMgState): Promise<any> {
    return await timeMgPost(TIME_MG_CONSTANTS.ENDPOINTS.COMMIT_DETAIL, payload, state);
}

