import {
    WebMcpSessionRecord,
    getAllSessions,
    deleteSession,
    clearAllSessions,
    renameSession,
    togglePinSession,
    forkSession,
    getActiveSessionId,
    exportSessionJson,
    exportAllSessionsJson,
    importSessionsFromJson
} from '../services/sessionStorageService';
import { showToast } from '../utils/toast';

export interface HistoryDrawerCallbacks {
    onSelectSession: (session: WebMcpSessionRecord) => void;
    onNewChat: () => void;
    onSessionUpdated?: () => void;
}

let activeDrawerEl: HTMLElement | null = null;
let activeBackdropEl: HTMLElement | null = null;
let currentSearchKw: string = '';
let currentFilterPinnedOnly: boolean = false;

/**
 * 打开会话历史抽屉 (Session History Drawer)
 */
export async function openWebMcpHistoryDrawer(
    container: HTMLElement,
    callbacks: HistoryDrawerCallbacks
) {
    closeWebMcpHistoryDrawer();

    const backdrop = document.createElement('div');
    backdrop.className = 'webmcp-history-backdrop';
    backdrop.addEventListener('click', () => closeWebMcpHistoryDrawer());
    container.appendChild(backdrop);
    activeBackdropEl = backdrop;

    const drawer = document.createElement('div');
    drawer.className = 'webmcp-history-drawer';
    drawer.id = 'webmcp-history-drawer';
    container.appendChild(drawer);
    activeDrawerEl = drawer;

    // 触发滑入动画
    requestAnimationFrame(() => {
        backdrop.classList.add('is-open');
        drawer.classList.add('is-open');
    });

    await renderHistoryDrawerContent(drawer, callbacks);
}

/**
 * 关闭会话历史抽屉
 */
export function closeWebMcpHistoryDrawer() {
    if (activeDrawerEl) {
        activeDrawerEl.classList.remove('is-open');
        const el = activeDrawerEl;
        setTimeout(() => el.remove(), 220);
        activeDrawerEl = null;
    }
    if (activeBackdropEl) {
        activeBackdropEl.classList.remove('is-open');
        const el = activeBackdropEl;
        setTimeout(() => el.remove(), 220);
        activeBackdropEl = null;
    }
}

/**
 * 渲染抽屉主结构与会话清单
 */
async function renderHistoryDrawerContent(
    drawer: HTMLElement,
    callbacks: HistoryDrawerCallbacks
) {
    const sessions = await getAllSessions();
    const activeId = getActiveSessionId();

    drawer.innerHTML = `
        <!-- 头部导航与操作区 -->
        <div class="webmcp-history-header">
            <div class="webmcp-history-header-left">
                <span style="font-size: 16px;">📚</span>
                <span class="webmcp-history-title">会话历史清单</span>
                <span class="webmcp-history-badge" id="history-total-badge">${sessions.length} 个会话</span>
            </div>
            <div class="webmcp-history-header-right">
                <button class="webmcp-history-btn-new" id="drawer-btn-new-chat" title="开启全新会话">
                    <span>➕</span>
                    <span>新建对话</span>
                </button>
                <button class="webmcp-history-btn-close" id="drawer-btn-close" title="关闭历史面板">✕</button>
            </div>
        </div>

        <!-- 搜索与筛选栏 -->
        <div class="webmcp-history-search-bar">
            <div class="webmcp-history-search-wrapper">
                <span class="webmcp-history-search-icon">🔍</span>
                <input type="text" id="history-search-input" placeholder="搜索历史会话标题或内容..." value="${escapeHtml(currentSearchKw)}" />
                ${currentSearchKw ? `<span class="webmcp-history-search-clear" id="history-search-clear">✕</span>` : ''}
            </div>
            <button class="webmcp-history-filter-chip ${currentFilterPinnedOnly ? 'active' : ''}" id="history-filter-pinned" title="仅查看已置顶会话">
                <span>📌</span>
                <span>置顶</span>
            </button>
        </div>

        <!-- 会话列表容器 (按时序智能分段) -->
        <div class="webmcp-history-list" id="webmcp-history-list">
        </div>

        <!-- 底部高频工具条 (针对测试的导入/导出/清空) -->
        <div class="webmcp-history-footer">
            <input type="file" id="history-file-input" accept=".json" style="display: none;" />
            <button class="webmcp-history-footer-btn" id="history-btn-import" title="导入测试用例或备份会话 JSON">
                <span>📥</span>
                <span>导入会话</span>
            </button>
            <button class="webmcp-history-footer-btn" id="history-btn-export-all" title="导出全量会话与运行轨迹 JSON">
                <span>📤</span>
                <span>导出全量</span>
            </button>
            <button class="webmcp-history-footer-btn danger" id="history-btn-clear-all" title="清空全部历史会话">
                <span>🗑️</span>
                <span>清空</span>
            </button>
        </div>
    `;

    // 绑定顶部与全局事件
    drawer.querySelector('#drawer-btn-close')?.addEventListener('click', () => closeWebMcpHistoryDrawer());

    drawer.querySelector('#drawer-btn-new-chat')?.addEventListener('click', () => {
        closeWebMcpHistoryDrawer();
        callbacks.onNewChat();
    });

    const searchInput = drawer.querySelector('#history-search-input') as HTMLInputElement;
    const searchClear = drawer.querySelector('#history-search-clear');
    searchInput?.addEventListener('input', () => {
        currentSearchKw = searchInput.value;
        renderHistoryListItems(drawer, callbacks);
    });
    searchClear?.addEventListener('click', () => {
        currentSearchKw = '';
        if (searchInput) searchInput.value = '';
        renderHistoryListItems(drawer, callbacks);
    });

    const filterPinnedBtn = drawer.querySelector('#history-filter-pinned');
    filterPinnedBtn?.addEventListener('click', () => {
        currentFilterPinnedOnly = !currentFilterPinnedOnly;
        filterPinnedBtn.classList.toggle('active', currentFilterPinnedOnly);
        renderHistoryListItems(drawer, callbacks);
    });

    // 底部工具事件
    const fileInput = drawer.querySelector('#history-file-input') as HTMLInputElement;
    const btnImport = drawer.querySelector('#history-btn-import');
    const btnExportAll = drawer.querySelector('#history-btn-export-all');
    const btnClearAll = drawer.querySelector('#history-btn-clear-all');

    btnImport?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
        if (fileInput.files && fileInput.files[0]) {
            try {
                const text = await fileInput.files[0].text();
                const count = await importSessionsFromJson(text);
                showToast('success', `✨ 成功导入 ${count} 个测试会话`);
                fileInput.value = '';
                await renderHistoryDrawerContent(drawer, callbacks);
            } catch (err: any) {
                showToast('error', `导入失败: ${err.message}`);
            }
        }
    });

    btnExportAll?.addEventListener('click', async () => {
        try {
            const jsonStr = await exportAllSessionsJson();
            downloadFile(jsonStr, `fssc-webmcp-sessions-${formatDateForFilename(new Date())}.json`, 'application/json');
            showToast('success', '📥 全量会话已导出');
        } catch (err: any) {
            showToast('error', `导出异常: ${err.message}`);
        }
    });

    btnClearAll?.addEventListener('click', async () => {
        if (confirm('⚠️ 确定要清空所有历史会话吗？此操作不可恢复。')) {
            await clearAllSessions();
            showToast('info', '已清空所有历史会话');
            callbacks.onNewChat();
            await renderHistoryDrawerContent(drawer, callbacks);
        }
    });

    await renderHistoryListItems(drawer, callbacks);
}

/**
 * 过滤并按时序分组渲染会话卡片列表
 */
async function renderHistoryListItems(
    drawer: HTMLElement,
    callbacks: HistoryDrawerCallbacks
) {
    const listContainer = drawer.querySelector('#webmcp-history-list');
    if (!listContainer) return;

    let sessions = await getAllSessions();
    const activeId = getActiveSessionId();

    // 过滤逻辑
    if (currentFilterPinnedOnly) {
        sessions = sessions.filter(s => s.pinned);
    }
    if (currentSearchKw.trim()) {
        const kw = currentSearchKw.trim().toLowerCase();
        sessions = sessions.filter(s => {
            if (s.title.toLowerCase().includes(kw)) return true;
            if (s.uiMessages && s.uiMessages.some(m => (m.rawText || m.htmlContent).toLowerCase().includes(kw))) return true;
            if (s.messages && s.messages.some(m => typeof m.content === 'string' && m.content.toLowerCase().includes(kw))) return true;
            return false;
        });
    }

    if (sessions.length === 0) {
        listContainer.innerHTML = `
            <div class="webmcp-history-empty">
                <span style="font-size: 28px;">📭</span>
                <span style="font-weight: 600; color: #475569;">暂无匹配的会话记录</span>
                <span style="font-size: 11.5px; color: #94a3b8;">${currentSearchKw ? '可尝试更换检索关键词' : '开始对话后将自动持久化保存在此处'}</span>
            </div>
        `;
        return;
    }

    // 按时间分组: 置顶 (Pinned)、今天 (Today)、昨天 (Yesterday)、前7天 (Previous 7 Days)、更早 (Older)
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 3600 * 1000;
    const startOf7DaysAgo = startOfToday - 7 * 24 * 3600 * 1000;

    const groups: { title: string; icon: string; items: WebMcpSessionRecord[] }[] = [
        { title: '置顶会话 (Pinned)', icon: '📌', items: [] },
        { title: '今天 (Today)', icon: '📅', items: [] },
        { title: '昨天 (Yesterday)', icon: '🕒', items: [] },
        { title: '前 7 天 (Previous 7 Days)', icon: '📆', items: [] },
        { title: '更早 (Older)', icon: '📦', items: [] }
    ];

    sessions.forEach(s => {
        if (s.pinned) {
            groups[0].items.push(s);
            return;
        }
        const t = s.updatedAt || s.createdAt || 0;
        if (t >= startOfToday) {
            groups[1].items.push(s);
        } else if (t >= startOfYesterday) {
            groups[2].items.push(s);
        } else if (t >= startOf7DaysAgo) {
            groups[3].items.push(s);
        } else {
            groups[4].items.push(s);
        }
    });

    let html = '';

    groups.forEach(g => {
        if (g.items.length === 0) return;

        html += `
            <div class="webmcp-history-group-title">
                <span>${g.icon}</span>
                <span>${g.title}</span>
                <span style="color: #94a3b8; font-weight: normal; font-size: 11px;">(${g.items.length})</span>
            </div>
        `;

        g.items.forEach(s => {
            const isActive = s.id === activeId;
            const previewText = extractSessionPreview(s);
            const relativeTimeStr = formatRelativeTime(s.updatedAt || s.createdAt);

            html += `
                <div class="webmcp-history-item ${isActive ? 'active' : ''}" data-id="${s.id}">
                    <div class="webmcp-history-item-main">
                        <div class="webmcp-history-item-top">
                            <span class="webmcp-history-item-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
                            ${s.pinned ? `<span class="webmcp-history-pin-badge" title="已置顶">📌</span>` : ''}
                            ${isActive ? `<span class="webmcp-history-active-tag">当前</span>` : ''}
                        </div>
                        <div class="webmcp-history-item-preview" title="${escapeHtml(previewText)}">${escapeHtml(previewText)}</div>
                        <div class="webmcp-history-item-meta">
                            <span>🕒 ${relativeTimeStr}</span>
                            <span>•</span>
                            <span>💬 ${s.turnCount || 1} 轮交互</span>
                        </div>
                    </div>

                    <!-- 悬浮操作按钮组 -->
                    <div class="webmcp-history-item-actions">
                        <button class="webmcp-history-action-btn btn-pin" data-id="${s.id}" title="${s.pinned ? '取消置顶' : '置顶此会话'}">
                            ${s.pinned ? '📌' : '📍'}
                        </button>
                        <button class="webmcp-history-action-btn btn-fork" data-id="${s.id}" title="复制用例 (Fork 分支测试)">
                            📋
                        </button>
                        <button class="webmcp-history-action-btn btn-rename" data-id="${s.id}" title="重命名会话">
                            ✏️
                        </button>
                        <button class="webmcp-history-action-btn btn-export" data-id="${s.id}" title="导出此会话 JSON">
                            📤
                        </button>
                        <button class="webmcp-history-action-btn btn-delete danger" data-id="${s.id}" title="删除此会话">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        });
    });

    listContainer.innerHTML = html;

    // 绑定各会话项的交互事件
    listContainer.querySelectorAll('.webmcp-history-item').forEach(itemEl => {
        const id = itemEl.getAttribute('data-id');
        if (!id) return;

        // 点击切换会话 (避免点击内部操作按钮时触发)
        itemEl.addEventListener('click', async (e: any) => {
            if (e.target.closest('.webmcp-history-item-actions') || e.target.closest('input')) return;
            const targetSession = sessions.find(s => s.id === id);
            if (targetSession) {
                closeWebMcpHistoryDrawer();
                callbacks.onSelectSession(targetSession);
            }
        });

        // 1. 置顶按钮
        const pinBtn = itemEl.querySelector('.btn-pin');
        pinBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const nowPinned = await togglePinSession(id);
            showToast('info', nowPinned ? '📌 已置顶该会话' : '已取消置顶');
            await renderHistoryListItems(drawer, callbacks);
        });

        // 2. 克隆 (Fork) 按钮
        const forkBtn = itemEl.querySelector('.btn-fork');
        forkBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const forked = await forkSession(id);
            if (forked) {
                showToast('success', `📋 已复制会话测试分支: ${forked.title}`);
                await renderHistoryDrawerContent(drawer, callbacks);
            }
        });

        // 3. 重命名按钮
        const renameBtn = itemEl.querySelector('.btn-rename');
        renameBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            enableInlineRename(itemEl as HTMLElement, id, drawer, callbacks);
        });

        // 4. 单条导出按钮
        const exportBtn = itemEl.querySelector('.btn-export');
        exportBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const s = sessions.find(item => item.id === id);
                const jsonStr = await exportSessionJson(id);
                downloadFile(jsonStr, `fssc-session-${s?.title || id}.json`, 'application/json');
                showToast('success', '📤 会话 JSON 已导出');
            } catch (err: any) {
                showToast('error', `导出失败: ${err.message}`);
            }
        });

        // 5. 删除按钮
        const delBtn = itemEl.querySelector('.btn-delete');
        delBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm('确定删除此会话记录吗？')) {
                await deleteSession(id);
                showToast('info', '🗑️ 已删除该会话');
                if (id === activeId) {
                    callbacks.onNewChat();
                }
                await renderHistoryDrawerContent(drawer, callbacks);
            }
        });
    });
}

/**
 * 启用会话标题内联编辑
 */
function enableInlineRename(
    itemEl: HTMLElement,
    id: string,
    drawer: HTMLElement,
    callbacks: HistoryDrawerCallbacks
) {
    const titleEl = itemEl.querySelector('.webmcp-history-item-title') as HTMLElement;
    if (!titleEl) return;

    const oldTitle = titleEl.textContent || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'webmcp-history-rename-input';
    input.value = oldTitle;

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const doSave = async () => {
        const val = input.value.trim();
        if (val && val !== oldTitle) {
            await renameSession(id, val);
            showToast('success', '✏️ 会话已重命名');
        }
        await renderHistoryListItems(drawer, callbacks);
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            doSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            renderHistoryListItems(drawer, callbacks);
        }
    });

    input.addEventListener('blur', () => {
        doSave();
    });
}

/**
 * 提取最后一条消息作为预览摘要
 */
function extractSessionPreview(session: WebMcpSessionRecord): string {
    if (session.uiMessages && session.uiMessages.length > 0) {
        const last = session.uiMessages[session.uiMessages.length - 1];
        const raw = last.rawText || stripHtml(last.htmlContent);
        if (raw) return raw.slice(0, 50);
    }
    if (session.messages && session.messages.length > 1) {
        const last = session.messages[session.messages.length - 1];
        if (typeof last.content === 'string') {
            return last.content.slice(0, 50);
        }
    }
    return '无对话内容摘要';
}

function stripHtml(html: string): string {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(str: string): string {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatRelativeTime(epochMs?: number): string {
    if (!epochMs) return '刚刚';
    const diffSec = Math.floor((Date.now() - epochMs) / 1000);
    if (diffSec < 60) return '刚刚';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}小时前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return '昨天';
    if (diffDay < 7) return `${diffDay}天前`;
    const d = new Date(epochMs);
    return `${d.getMonth() + 1}-${d.getDate()}`;
}

function formatDateForFilename(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadFile(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 150);
}
