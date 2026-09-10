import { ChatMessage } from './llmService';
import { TrajectoryEvent } from './trajectoryService';
import { AutopilotLogger } from '../utils/logger';

export interface WebMcpUiMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'notice';
    htmlContent: string;
    timestamp: number;
    rawText?: string;
    attachments?: Array<{
        name: string;
        size: number;
        type: string;
        dataUrl?: string;
    }>;
    payloadType?: 'expense_batch' | 'trip_plan' | 'notice';
    payloadData?: any;
}

export interface WebMcpSessionRecord {
    id: string; // matches runId, e.g. run-20260908-1520-xxxx
    title: string;
    createdAt: number;
    updatedAt: number;
    turnCount: number;
    messages: ChatMessage[];
    uiMessages: WebMcpUiMessage[];
    trajectoryEvents?: TrajectoryEvent[];
    pinned?: boolean;
}

const DB_NAME = 'AutopilotWebMcpDB';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const ACTIVE_SESSION_KEY = 'autopilot_webmcp_active_session_id';
const LOCAL_STORAGE_PREFIX = 'autopilot_webmcp_sess_';
const LOCAL_STORAGE_INDEX = 'autopilot_webmcp_session_list';
const MAX_STORED_SESSIONS = 100;

let dbInstance: IDBDatabase | null = null;
let useLocalStorageFallback = false;

/**
 * 初始化持久化存储引擎 (IndexedDB 优先，异常时平滑降级至 LocalStorage)
 */
export async function initSessionStorage(): Promise<boolean> {
    if (dbInstance) return true;

    if (typeof window === 'undefined' || !window.indexedDB) {
        AutopilotLogger.warn('[SessionStorage] 当前浏览器环境不支持 IndexedDB，降级为 LocalStorage 驱动');
        useLocalStorageFallback = true;
        return false;
    }

    return new Promise((resolve) => {
        try {
            const request = window.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e: any) => {
                const db = e.target.result as IDBDatabase;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                    store.createIndex('pinned', 'pinned', { unique: false });
                }
            };

            request.onsuccess = (e: any) => {
                dbInstance = e.target.result as IDBDatabase;
                AutopilotLogger.info('[SessionStorage] IndexedDB 初始化就绪');
                resolve(true);
            };

            request.onerror = (e: any) => {
                AutopilotLogger.warn(`[SessionStorage] 打开 IndexedDB 失败，降级为 LocalStorage 驱动: ${e}`);
                useLocalStorageFallback = true;
                resolve(false);
            };
        } catch (err) {
            AutopilotLogger.warn(`[SessionStorage] IndexedDB 启动抛出异常，降级为 LocalStorage 驱动: ${err}`);
            useLocalStorageFallback = true;
            resolve(false);
        }
    });
}

/**
 * 瘦身会话记录用于存储 (剔除大于 300KB 的超重 Base64，保留缩略图与文本，防止超出存储配额)
 */
function pruneSessionForStorage(session: WebMcpSessionRecord): WebMcpSessionRecord {
    const cloned: WebMcpSessionRecord = JSON.parse(JSON.stringify(session));

    if (cloned.uiMessages) {
        cloned.uiMessages.forEach(msg => {
            if (msg.attachments) {
                msg.attachments.forEach(att => {
                    // 若超过 250KB 则修剪 dataUrl
                    if (att.dataUrl && att.dataUrl.length > 250000) {
                        att.dataUrl = undefined;
                    }
                });
            }
        });
    }

    return cloned;
}

/**
 * 持久化保存或更新单条会话
 */
export async function saveSession(session: WebMcpSessionRecord): Promise<void> {
    await initSessionStorage();
    const cleanSession = pruneSessionForStorage(session);
    cleanSession.updatedAt = Date.now();

    if (dbInstance && !useLocalStorageFallback) {
        return new Promise((resolve) => {
            try {
                const tx = dbInstance!.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.put(cleanSession);

                req.onsuccess = () => {
                    resolve();
                    // 异步触发 LRU 淘汰治理
                    pruneOldSessionsIfExceeded().catch(() => {});
                };
                req.onerror = (err) => {
                    AutopilotLogger.error(`[SessionStorage] IndexedDB 保存失败: ${err}`);
                    saveToLocalStorage(cleanSession);
                    resolve();
                };
            } catch (e) {
                saveToLocalStorage(cleanSession);
                resolve();
            }
        });
    } else {
        saveToLocalStorage(cleanSession);
    }
}

/**
 * 根据 ID 加载特定会话
 */
export async function getSession(id: string): Promise<WebMcpSessionRecord | null> {
    await initSessionStorage();

    if (dbInstance && !useLocalStorageFallback) {
        return new Promise((resolve) => {
            try {
                const tx = dbInstance!.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(id);

                req.onsuccess = () => {
                    resolve(req.result || getFromLocalStorage(id));
                };
                req.onerror = () => {
                    resolve(getFromLocalStorage(id));
                };
            } catch {
                resolve(getFromLocalStorage(id));
            }
        });
    }

    return getFromLocalStorage(id);
}

/**
 * 获取全部历史会话列表 (置顶在前，更新时间倒序)
 */
export async function getAllSessions(): Promise<WebMcpSessionRecord[]> {
    await initSessionStorage();

    if (dbInstance && !useLocalStorageFallback) {
        return new Promise((resolve) => {
            try {
                const tx = dbInstance!.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();

                req.onsuccess = () => {
                    const list: WebMcpSessionRecord[] = req.result || [];
                    list.sort((a, b) => {
                        if (a.pinned && !b.pinned) return -1;
                        if (!a.pinned && b.pinned) return 1;
                        return (b.updatedAt || 0) - (a.updatedAt || 0);
                    });
                    resolve(list);
                };
                req.onerror = () => {
                    resolve(getAllFromLocalStorage());
                };
            } catch {
                resolve(getAllFromLocalStorage());
            }
        });
    }

    return getAllFromLocalStorage();
}

/**
 * 删除指定会话
 */
export async function deleteSession(id: string): Promise<void> {
    await initSessionStorage();

    if (dbInstance && !useLocalStorageFallback) {
        await new Promise<void>((resolve) => {
            try {
                const tx = dbInstance!.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.delete(id);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            } catch {
                resolve();
            }
        });
    }

    deleteFromLocalStorage(id);

    // 若删除的是当前活跃会话，则清空活跃游标
    if (getActiveSessionId() === id) {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
}

/**
 * 清空全部历史会话
 */
export async function clearAllSessions(): Promise<void> {
    await initSessionStorage();

    if (dbInstance && !useLocalStorageFallback) {
        await new Promise<void>((resolve) => {
            try {
                const tx = dbInstance!.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            } catch {
                resolve();
            }
        });
    }

    clearLocalStorageSessions();
    localStorage.removeItem(ACTIVE_SESSION_KEY);
}

/**
 * 重命名会话标题
 */
export async function renameSession(id: string, newTitle: string): Promise<void> {
    const s = await getSession(id);
    if (s) {
        s.title = newTitle.trim() || '未命名会话';
        await saveSession(s);
    }
}

/**
 * 切换置顶状态
 */
export async function togglePinSession(id: string): Promise<boolean> {
    const s = await getSession(id);
    if (s) {
        s.pinned = !s.pinned;
        await saveSession(s);
        return Boolean(s.pinned);
    }
    return false;
}

/**
 * 克隆/复制会话 (Fork Session) - 针对高频测试用例分支的 Agentic 杀手级功能
 */
export async function forkSession(id: string): Promise<WebMcpSessionRecord | null> {
    const original = await getSession(id);
    if (!original) return null;

    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rand = Math.random().toString(36).substring(2, 6);
    const newRunId = `run-${timeStr}-${rand}`;

    const forked: WebMcpSessionRecord = {
        ...JSON.parse(JSON.stringify(original)),
        id: newRunId,
        title: `${original.title} (副本)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false
    };

    // 重新对齐 trajectory 的 runId
    if (forked.trajectoryEvents) {
        forked.trajectoryEvents.forEach(evt => {
            evt.runId = newRunId;
        });
    }

    await saveSession(forked);
    return forked;
}

/**
 * 读取当前活跃会话 ID
 */
export function getActiveSessionId(): string | null {
    try {
        return localStorage.getItem(ACTIVE_SESSION_KEY) || null;
    } catch {
        return null;
    }
}

/**
 * 记录当前活跃会话 ID
 */
export function setActiveSessionId(id: string) {
    try {
        localStorage.setItem(ACTIVE_SESSION_KEY, id);
    } catch (e) {
        AutopilotLogger.warn(`[SessionStorage] 记录 activeSessionId 失败: ${e}`);
    }
}

/**
 * 导出单条会话为 JSON 字符串
 */
export async function exportSessionJson(id: string): Promise<string> {
    const s = await getSession(id);
    if (!s) throw new Error('未找到指定会话');
    return JSON.stringify({
        app: 'IVision FSSC Autopilot',
        spec: 'WebMCP Chat Session v1',
        exportedAt: new Date().toISOString(),
        session: s
    }, null, 2);
}

/**
 * 导出全部会话为 JSON 字符串
 */
export async function exportAllSessionsJson(): Promise<string> {
    const sessions = await getAllSessions();
    return JSON.stringify({
        app: 'IVision FSSC Autopilot',
        spec: 'WebMCP Chat Session Bundle v1',
        exportedAt: new Date().toISOString(),
        total: sessions.length,
        sessions
    }, null, 2);
}

/**
 * 从 JSON 导入一个或多个会话
 */
export async function importSessionsFromJson(jsonStr: string): Promise<number> {
    try {
        const parsed = JSON.parse(jsonStr);
        const incoming: WebMcpSessionRecord[] = [];

        if (Array.isArray(parsed.sessions)) {
            incoming.push(...parsed.sessions);
        } else if (parsed.session && parsed.session.id) {
            incoming.push(parsed.session);
        } else if (parsed.id && Array.isArray(parsed.messages)) {
            incoming.push(parsed as WebMcpSessionRecord);
        } else {
            throw new Error('无效的会话数据格式');
        }

        let importedCount = 0;
        for (const s of incoming) {
            if (s.id && s.title) {
                await saveSession(s);
                importedCount++;
            }
        }
        return importedCount;
    } catch (err: any) {
        throw new Error(`解析会话文件失败: ${err.message}`);
    }
}

/**
 * LRU 淘汰超额的历史会话 (保留前 MAX_STORED_SESSIONS 个，优先淘汰未置顶的最早会话)
 */
async function pruneOldSessionsIfExceeded(): Promise<void> {
    try {
        const list = await getAllSessions();
        if (list.length <= MAX_STORED_SESSIONS) return;

        // 仅在未置顶会话中做淘汰
        const unpinned = list.filter(s => !s.pinned);
        const toDeleteCount = list.length - MAX_STORED_SESSIONS;
        const candidates = unpinned.slice(-toDeleteCount);

        for (const cand of candidates) {
            await deleteSession(cand.id);
            AutopilotLogger.info(`[SessionStorage] LRU 淘汰老旧会话: ${cand.id} (${cand.title})`);
        }
    } catch (e) {
        AutopilotLogger.warn(`[SessionStorage] LRU 淘汰检查异常: ${e}`);
    }
}

// ----------------------------------------------------
// LocalStorage 降级驱动适配器
// ----------------------------------------------------

function saveToLocalStorage(session: WebMcpSessionRecord) {
    try {
        const key = LOCAL_STORAGE_PREFIX + session.id;
        localStorage.setItem(key, JSON.stringify(session));

        const indexRaw = localStorage.getItem(LOCAL_STORAGE_INDEX);
        let idList: string[] = indexRaw ? JSON.parse(indexRaw) : [];
        if (!idList.includes(session.id)) {
            idList.unshift(session.id);
            if (idList.length > MAX_STORED_SESSIONS) {
                const droppedId = idList.pop();
                if (droppedId) localStorage.removeItem(LOCAL_STORAGE_PREFIX + droppedId);
            }
            localStorage.setItem(LOCAL_STORAGE_INDEX, JSON.stringify(idList));
        }
    } catch (e) {
        AutopilotLogger.warn(`[SessionStorage] LocalStorage 写入异常: ${e}`);
    }
}

function getFromLocalStorage(id: string): WebMcpSessionRecord | null {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + id);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function getAllFromLocalStorage(): WebMcpSessionRecord[] {
    try {
        const indexRaw = localStorage.getItem(LOCAL_STORAGE_INDEX);
        if (!indexRaw) return [];
        const idList: string[] = JSON.parse(indexRaw);
        const result: WebMcpSessionRecord[] = [];

        for (const id of idList) {
            const s = getFromLocalStorage(id);
            if (s) result.push(s);
        }

        result.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });

        return result;
    } catch {
        return [];
    }
}

function deleteFromLocalStorage(id: string) {
    try {
        localStorage.removeItem(LOCAL_STORAGE_PREFIX + id);
        const indexRaw = localStorage.getItem(LOCAL_STORAGE_INDEX);
        if (indexRaw) {
            let idList: string[] = JSON.parse(indexRaw);
            idList = idList.filter(i => i !== id);
            localStorage.setItem(LOCAL_STORAGE_INDEX, JSON.stringify(idList));
        }
    } catch { }
}

function clearLocalStorageSessions() {
    try {
        const indexRaw = localStorage.getItem(LOCAL_STORAGE_INDEX);
        if (indexRaw) {
            const idList: string[] = JSON.parse(indexRaw);
            idList.forEach(id => localStorage.removeItem(LOCAL_STORAGE_PREFIX + id));
            localStorage.removeItem(LOCAL_STORAGE_INDEX);
        }
    } catch { }
}
