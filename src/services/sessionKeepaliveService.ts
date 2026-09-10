import { GlobalState } from '../types/state';
import { callNativeHttp, apiRequest, extractLatestTokens } from '../utils/http';
import { AutopilotLogger } from '../utils/logger';

let keepaliveTimer: any = null;
let isPinging = false;
let lastPingTime = 0;

/**
 * 执行轻量级心跳请求，向系统服务端报活以刷新 Session 会话空闲倒计时 (30分钟超时防跌落)
 * 接口选用 YuanNian 极为轻量的只读接口：/expenseClaim/expenseRecord/countAlreadyRecoverExpenseRecord
 */
export async function touchSessionKeepalive(state: GlobalState, win?: Window | null): Promise<boolean> {
    if (isPinging) return true;
    isPinging = true;

    try {
        // 1. 每次心跳前动态嗅探提取最新 Token
        extractLatestTokens(state);

        // 2. 优先通过宿主原生 HTTP/Axios 客户端触发保活（与官方 UI 行为完全一致，该端点为 GET）
        let res: any = await callNativeHttp(
            '/expenseClaim/expenseRecord/countAlreadyRecoverExpenseRecord',
            'GET',
            null,
            win
        );

        // 3. 仅当原生客户端完全未连接时，降级使用备用 apiRequest 保活
        if (res === null) {
            res = await apiRequest(
                '/fssc/expenseClaim/expenseRecord/countAlreadyRecoverExpenseRecord',
                'GET',
                null,
                state
            );
        }

        const isSuccess = Boolean(res && res.success !== false && res.code !== '401');
        if (isSuccess) {
            lastPingTime = Date.now();
            AutopilotLogger.info(`[SessionKeepalive] 会话心跳保活成功，Session 空闲倒计时已刷新 (${new Date().toLocaleTimeString()})`);
        } else {
            AutopilotLogger.warn(`[SessionKeepalive] 会话心跳响应异常: ${res?.message || '未知状态'}`);
        }
        return isSuccess;
    } catch (err: any) {
        AutopilotLogger.warn(`[SessionKeepalive] 会话心跳保活失败: ${err.message}`);
        return false;
    } finally {
        isPinging = false;
    }
}

/**
 * 启动定时会话保活循环 (默认每 2.5 分钟保活一次，彻底杜绝长时间编辑导致的“登录失效”)
 */
export function startSessionKeepalive(state: GlobalState, intervalMs: number = 150000, win?: Window | null) {
    if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
    }

    AutopilotLogger.info(`[SessionKeepalive] 启动后台会话保活守护进程 (心跳间隔: ${Math.round(intervalMs / 1000)}s)`);

    // 立即执行一次初次保活与 Token 刷新
    touchSessionKeepalive(state, win);

    keepaliveTimer = setInterval(() => {
        touchSessionKeepalive(state, win);
    }, intervalMs);
}

/**
 * 停止会话保活循环
 */
export function stopSessionKeepalive() {
    if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
        AutopilotLogger.info('[SessionKeepalive] 后台会话保活守护进程已停止');
    }
}

/**
 * 获取最近一次心跳成功时间
 */
export function getLastKeepaliveTime(): number {
    return lastPingTime;
}
