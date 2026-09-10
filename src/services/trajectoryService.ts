import { AutopilotLogger } from '../utils/logger';

export type TrajectoryEventSource =
    | 'SYSTEM'          // 系统提示词、基线规范、Schema 注入
    | 'USER'            // 用户输入提示词与多模态附件清单
    | 'CONTEXT'         // 上下文注入 (登录人主数据、差旅制度标准、维表树等)
    | 'REASONING'       // 模型思维链 / 推理过程 (CoT / Thinking)
    | 'MODEL_OUTPUT'    // 大模型最终生成的文本响应或决策
    | 'TOOL_CALL'       // WebMCP 工具发起调用 (入参 Payload)
    | 'TOOL_RESULT'     // WebMCP 工具执行结果 (出参 Payload、耗时)
    | 'SUBAGENT'        // 子代理或分发引擎调度 (LLM Agent vs 5D 启发式保底)
    | 'ERROR';          // 异常事件、HTTP 503/429 报错及重试记录

export interface TrajectoryEvent {
    id: string;
    runId: string;
    sequenceNo: number;
    timestamp: string;      // HH:mm:ss.SSS
    epochMs: number;
    source: TrajectoryEventSource;
    title: string;
    summary?: string;
    durationMs?: number;
    data: any;              // 详细数据对象
    meta?: Record<string, any>;
}

export interface TrajectoryState {
    currentRunId: string;
    events: TrajectoryEvent[];
    listeners: Array<(event: TrajectoryEvent) => void>;
    sequenceCounter: number;
}

const TRAJECTORY_STATE: TrajectoryState = {
    currentRunId: generateRunId(),
    events: [],
    listeners: [],
    sequenceCounter: 0
};

function generateRunId(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rand = Math.random().toString(36).substring(2, 6);
    return `run-${timeStr}-${rand}`;
}

function formatTimestamp(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const padMs = (n: number) => String(n).padStart(3, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${padMs(d.getMilliseconds())}`;
}

/**
 * 启动新的运行会话 (New Run)
 */
export function startNewTrajectoryRun(customRunId?: string): string {
    TRAJECTORY_STATE.currentRunId = customRunId || generateRunId();
    TRAJECTORY_STATE.sequenceCounter = 0;
    AutopilotLogger.info(`[Trajectory] 开启新运行追踪会话: ${TRAJECTORY_STATE.currentRunId}`);
    return TRAJECTORY_STATE.currentRunId;
}

export function getCurrentRunId(): string {
    return TRAJECTORY_STATE.currentRunId;
}

/**
 * 追加单条运行事件 (Append-Only Event Stream)
 * 符合 DeepSeek Harness 规范：模型看到的以及做出的每一个动作均记录在此
 */
export function recordTrajectoryEvent(params: {
    source: TrajectoryEventSource;
    title: string;
    summary?: string;
    data?: any;
    durationMs?: number;
    meta?: Record<string, any>;
    runId?: string;
}): TrajectoryEvent {
    const now = new Date();
    TRAJECTORY_STATE.sequenceCounter++;

    const event: TrajectoryEvent = {
        id: `evt-${now.getTime()}-${Math.random().toString(36).substring(2, 7)}`,
        runId: params.runId || TRAJECTORY_STATE.currentRunId,
        sequenceNo: TRAJECTORY_STATE.sequenceCounter,
        timestamp: formatTimestamp(now),
        epochMs: now.getTime(),
        source: params.source,
        title: params.title,
        summary: params.summary,
        durationMs: params.durationMs,
        data: params.data ?? null,
        meta: params.meta
    };

    // 内存不可变追加
    TRAJECTORY_STATE.events.push(event);

    // 限制最大缓存事件数，防止超长会话内存泄漏 (保留最近 2000 个事件)
    if (TRAJECTORY_STATE.events.length > 2000) {
        TRAJECTORY_STATE.events.shift();
    }

    // 触发订阅者更新
    TRAJECTORY_STATE.listeners.forEach(cb => {
        try {
            cb(event);
        } catch (e) {
            console.error('[Trajectory] 触发监听回调异常', e);
        }
    });

    return event;
}

/**
 * 获取当前所有 Trajectory 事件
 */
export function getTrajectoryEvents(): TrajectoryEvent[] {
    return [...TRAJECTORY_STATE.events];
}

/**
 * 订阅实时事件流
 */
export function subscribeTrajectory(cb: (event: TrajectoryEvent) => void): () => void {
    TRAJECTORY_STATE.listeners.push(cb);
    return () => {
        TRAJECTORY_STATE.listeners = TRAJECTORY_STATE.listeners.filter(fn => fn !== cb);
    };
}

/**
 * 清空当前 Trajectory 事件流
 */
export function clearTrajectoryEvents() {
    TRAJECTORY_STATE.events = [];
    TRAJECTORY_STATE.sequenceCounter = 0;
    startNewTrajectoryRun();
    TRAJECTORY_STATE.listeners.forEach(cb => {
        try {
            cb({
                id: 'evt-reset',
                runId: TRAJECTORY_STATE.currentRunId,
                sequenceNo: 0,
                timestamp: formatTimestamp(new Date()),
                epochMs: Date.now(),
                source: 'SYSTEM',
                title: 'Trajectory Log Reset',
                summary: '用户重置了运行日志',
                data: null
            });
        } catch { }
    });
}

/**
 * 载入历史会话的运行轨迹 (用于会话切换时无缝恢复日志流)
 */
export function loadTrajectoryRun(runId: string, events: TrajectoryEvent[]) {
    TRAJECTORY_STATE.currentRunId = runId;
    TRAJECTORY_STATE.events = [...events];
    TRAJECTORY_STATE.sequenceCounter = events.length;
    AutopilotLogger.info(`[Trajectory] 已载入历史轨迹: ${runId} (${events.length} 个事件)`);

    if (events.length > 0) {
        const lastEvt = events[events.length - 1];
        TRAJECTORY_STATE.listeners.forEach(cb => {
            try { cb(lastEvt); } catch { }
        });
    } else {
        TRAJECTORY_STATE.listeners.forEach(cb => {
            try {
                cb({
                    id: `evt-switch-${Date.now()}`,
                    runId,
                    sequenceNo: 0,
                    timestamp: formatTimestamp(new Date()),
                    epochMs: Date.now(),
                    source: 'SYSTEM',
                    title: 'Switched Session',
                    summary: '已切换至该历史会话',
                    data: null
                });
            } catch { }
        });
    }
}

/**
 * 导出全量 Trajectory JSON 字符串
 */
export function exportTrajectoryJson(): string {
    const payload = {
        app: 'IVision FSSC Autopilot',
        spec: 'DeepSeek Harness Trajectory v1',
        runId: TRAJECTORY_STATE.currentRunId,
        exportedAt: new Date().toISOString(),
        totalEvents: TRAJECTORY_STATE.events.length,
        events: TRAJECTORY_STATE.events
    };
    return JSON.stringify(payload, null, 2);
}

/**
 * 多维全文搜索与来源过滤
 */
export function filterTrajectoryEvents(
    events: TrajectoryEvent[],
    sourceFilter: string = 'ALL',
    searchKeyword: string = ''
): TrajectoryEvent[] {
    const kw = (searchKeyword || '').trim().toLowerCase();

    return events.filter(evt => {
        // 1. Source 过滤
        if (sourceFilter !== 'ALL' && evt.source !== sourceFilter) {
            return false;
        }

        // 2. 关键词搜索
        if (!kw) return true;

        if (evt.title.toLowerCase().includes(kw)) return true;
        if (evt.summary && evt.summary.toLowerCase().includes(kw)) return true;
        if (evt.source.toLowerCase().includes(kw)) return true;
        if (evt.runId.toLowerCase().includes(kw)) return true;

        // 深度搜索数据内容
        try {
            const dataStr = typeof evt.data === 'string' ? evt.data : JSON.stringify(evt.data);
            if (dataStr && dataStr.toLowerCase().includes(kw)) return true;
        } catch { }

        return false;
    });
}
