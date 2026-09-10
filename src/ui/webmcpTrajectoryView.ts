import {
    TrajectoryEvent,
    TrajectoryEventSource,
    getTrajectoryEvents,
    clearTrajectoryEvents,
    subscribeTrajectory,
    exportTrajectoryJson,
    filterTrajectoryEvents,
    getCurrentRunId
} from '../services/trajectoryService';
import { showToast } from '../utils/toast';

let currentSourceFilter: string = 'ALL';
let currentSearchKeyword: string = '';
let isReplaying = false;

const SOURCE_COLORS: Record<TrajectoryEventSource, { bg: string; text: string; border: string; icon: string }> = {
    SYSTEM: { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.4)', icon: '⚙️' },
    USER: { bg: 'rgba(56, 189, 248, 0.15)', text: '#38bdf8', border: 'rgba(56, 189, 248, 0.4)', icon: '👤' },
    CONTEXT: { bg: 'rgba(6, 182, 212, 0.15)', text: '#22d3ee', border: 'rgba(6, 182, 212, 0.4)', icon: '🗂️' },
    REASONING: { bg: 'rgba(129, 140, 248, 0.15)', text: '#818cf8', border: 'rgba(129, 140, 248, 0.4)', icon: '🧠' },
    MODEL_OUTPUT: { bg: 'rgba(34, 197, 94, 0.15)', text: '#4ade80', border: 'rgba(34, 197, 94, 0.4)', icon: '🤖' },
    TOOL_CALL: { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.4)', icon: '⚡' },
    TOOL_RESULT: { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: 'rgba(16, 185, 129, 0.4)', icon: '✓' },
    SUBAGENT: { bg: 'rgba(236, 72, 153, 0.15)', text: '#f472b6', border: 'rgba(236, 72, 153, 0.4)', icon: '🧭' },
    ERROR: { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', border: 'rgba(239, 68, 68, 0.4)', icon: '⚠️' }
};

export function renderTrajectoryView(container: HTMLElement) {
    const view = container.querySelector('#webmcp-view-inspector');
    if (!view) return;

    view.innerHTML = `
        <div class="trajectory-container" style="display: flex; flex-direction: column; height: 100%; background: #0b1329; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; overflow: hidden;">
            <!-- 头部控制与元数据指示栏 (DeepSeek Harness Trajectory Header) -->
            <div style="padding: 12px 16px; background: #0f172a; border-bottom: 1px solid #1e293b; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0;">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 15px;">⚡</span>
                        <span style="font-size: 13.5px; font-weight: 700; color: #ffffff; letter-spacing: 0.3px;">DeepSeek Harness 运行轨迹查看器</span>
                        <span id="trajectory-run-badge" style="background: #1e293b; color: #38bdf8; font-family: monospace; font-size: 10.5px; padding: 2px 8px; border-radius: 4px; border: 1px solid #334155;">#${getCurrentRunId()}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span id="trajectory-stats-badge" style="font-size: 11px; color: #94a3b8;">0 Events</span>
                        <button class="trajectory-action-btn" id="traj-btn-copy" title="复制全量事件流 JSON">📋 复制 JSON</button>
                        <button class="trajectory-action-btn" id="traj-btn-export" title="导出轨迹 JSON 文件">📥 导出</button>
                        <button class="trajectory-action-btn" id="traj-btn-replay" title="按时序单步回放执行事件">▶️ 时序回放</button>
                        <button class="trajectory-action-btn" id="traj-btn-clear" style="color: #f87171;" title="清空轨迹记录">🗑️ 清空</button>
                    </div>
                </div>

                <!-- 搜索与来源过滤条 -->
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                    <div style="position: relative; flex: 1; min-width: 220px;">
                        <input type="text" id="traj-search-input" placeholder="🔍 全文搜索：检索事件、工具参数、输出或异常..." value="${currentSearchKeyword}"
                            style="width: 100%; box-sizing: border-box; background: #111d38; border: 1px solid #1e293b; border-radius: 6px; padding: 6px 10px 6px 28px; color: #ffffff; font-size: 11.5px; outline: none;" />
                        <span style="position: absolute; left: 8px; top: 6px; font-size: 11px; color: #64748b;">🔍</span>
                    </div>

                    <!-- Source 过滤芯片 -->
                    <div id="traj-source-chips" style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                    </div>
                </div>
            </div>

            <!-- 时间轴事件流面板 (Append-Only Event Stream) -->
            <div id="trajectory-events-scroll" style="flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; position: relative;">
                <div style="color: #64748b; text-align: center; padding: 40px 0; font-size: 12px;">
                    等待大模型或 WebMCP 工具调用执行...<br>
                    <span style="font-size: 11px; color: #475569;">系统提示词、多模态附件、维表穿透、工具入参及出参将在此按不可变时序全景呈现</span>
                </div>
            </div>
        </div>
    `;

    setupTrajectoryEvents(container);
    renderSourceChips(container);
    updateTrajectoryList(container);

    // 订阅后续实时增量事件
    subscribeTrajectory(() => {
        if (!isReplaying) {
            renderSourceChips(container);
            updateTrajectoryList(container);
        }
    });
}

function renderSourceChips(container: HTMLElement) {
    const chipsContainer = container.querySelector('#traj-source-chips');
    if (!chipsContainer) return;

    const allEvents = getTrajectoryEvents();
    const sources: (TrajectoryEventSource | 'ALL')[] = [
        'ALL',
        'SYSTEM',
        'USER',
        'CONTEXT',
        'TOOL_CALL',
        'TOOL_RESULT',
        'REASONING',
        'MODEL_OUTPUT',
        'ERROR'
    ];

    chipsContainer.innerHTML = sources.map(src => {
        const count = src === 'ALL' ? allEvents.length : allEvents.filter(e => e.source === src).length;
        if (count === 0 && src !== 'ALL') return '';
        const isActive = currentSourceFilter === src ? 'active' : '';

        return `
            <button class="traj-chip ${isActive}" data-src="${src}" style="
                background: ${currentSourceFilter === src ? '#38bdf8' : '#111d38'};
                color: ${currentSourceFilter === src ? '#0f172a' : '#94a3b8'};
                border: 1px solid ${currentSourceFilter === src ? '#38bdf8' : '#1e293b'};
                font-size: 10.5px;
                font-weight: 600;
                padding: 3px 8px;
                border-radius: 4px;
                cursor: pointer;
                user-select: none;
                transition: all 0.15s ease;
            ">
                ${src} (${count})
            </button>
        `;
    }).join('');

    chipsContainer.querySelectorAll('.traj-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            currentSourceFilter = btn.getAttribute('data-src') || 'ALL';
            renderSourceChips(container);
            updateTrajectoryList(container);
        });
    });
}

function updateTrajectoryList(container: HTMLElement) {
    const scrollBox = container.querySelector('#trajectory-events-scroll');
    const runBadge = container.querySelector('#trajectory-run-badge');
    const statsBadge = container.querySelector('#trajectory-stats-badge');
    if (!scrollBox) return;

    const allEvents = getTrajectoryEvents();
    const filtered = filterTrajectoryEvents(allEvents, currentSourceFilter, currentSearchKeyword);

    if (runBadge) runBadge.textContent = `#${getCurrentRunId()}`;
    if (statsBadge) {
        const totalDuration = allEvents.length > 1
            ? allEvents[allEvents.length - 1].epochMs - allEvents[0].epochMs
            : 0;
        statsBadge.textContent = `${allEvents.length} Events${totalDuration > 0 ? ` · ${(totalDuration / 1000).toFixed(1)}s` : ''}`;
    }

    if (filtered.length === 0) {
        scrollBox.innerHTML = `
            <div style="color: #64748b; text-align: center; padding: 40px 0; font-size: 12px;">
                ${allEvents.length === 0 ? '暂无运行日志事件' : '当前检索条件无匹配事件'}
            </div>
        `;
        return;
    }

    scrollBox.innerHTML = filtered.map(evt => {
        const style = SOURCE_COLORS[evt.source] || SOURCE_COLORS.SYSTEM;
        const seqStr = String(evt.sequenceNo).padStart(2, '0');
        const durationTag = evt.durationMs !== undefined
            ? `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-size: 10.5px; padding: 1px 6px; border-radius: 4px; font-family: monospace;">${evt.durationMs}ms</span>`
            : '';

        let dataBody = '';
        if (evt.data !== null && evt.data !== undefined) {
            const jsonStr = typeof evt.data === 'string'
                ? evt.data
                : JSON.stringify(evt.data, null, 2);

            dataBody = `
                <div class="traj-data-toggle" style="margin-top: 6px; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 6px;">
                    <details>
                        <summary style="font-size: 11px; color: #64748b; cursor: pointer; user-select: none; outline: none;">
                            <span>查看详细 Payload (JSON)</span>
                            <span class="traj-copy-btn" data-json="${encodeURIComponent(jsonStr)}" style="margin-left: 10px; color: #38bdf8; font-size: 10.5px; cursor: pointer;">📋 复制数据</span>
                        </summary>
                        <pre style="margin: 6px 0 0 0; padding: 8px 10px; background: #060b18; border-radius: 6px; font-family: 'JetBrains Mono', Consolas, monospace; font-size: 11px; color: #93c5fd; overflow-x: auto; white-space: pre-wrap; line-height: 1.45; border: 1px solid #172554;">${escapeHtml(jsonStr)}</pre>
                    </details>
                </div>
            `;
        }

        return `
            <div class="trajectory-event-card" data-id="${evt.id}" style="
                background: #0f172a;
                border: 1px solid #1e293b;
                border-left: 4px solid ${style.text};
                border-radius: 8px;
                padding: 10px 12px;
                display: flex;
                flex-direction: column;
                gap: 4px;
                transition: background 0.2s ease;
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-family: monospace; font-size: 11px; color: #64748b;">#${seqStr}</span>
                        <span style="font-family: monospace; font-size: 11px; color: #94a3b8;">[${evt.timestamp}]</span>
                        <span style="
                            background: ${style.bg};
                            color: ${style.text};
                            border: 1px solid ${style.border};
                            padding: 1px 6px;
                            border-radius: 4px;
                            font-size: 10.5px;
                            font-weight: 700;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                        ">
                            <span>${style.icon}</span>
                            <span>${evt.source}</span>
                        </span>
                        <strong style="font-size: 12px; color: #f8fafc; letter-spacing: 0.2px;">${escapeHtml(evt.title)}</strong>
                    </div>
                    <div>
                        ${durationTag}
                    </div>
                </div>

                ${evt.summary ? `<div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.4; margin-top: 2px;">${escapeHtml(evt.summary)}</div>` : ''}

                ${dataBody}
            </div>
        `;
    }).join('');

    // 绑定单事件复制按钮
    scrollBox.querySelectorAll('.traj-copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const jsonStr = decodeURIComponent(btn.getAttribute('data-json') || '');
            if (navigator.clipboard) {
                navigator.clipboard.writeText(jsonStr);
                showToast('success', '已复制事件 Payload 到剪贴板');
            }
        });
    });
}

function setupTrajectoryEvents(container: HTMLElement) {
    const searchInput = container.querySelector('#traj-search-input') as HTMLInputElement;
    const copyBtn = container.querySelector('#traj-btn-copy');
    const exportBtn = container.querySelector('#traj-btn-export');
    const replayBtn = container.querySelector('#traj-btn-replay');
    const clearBtn = container.querySelector('#traj-btn-clear');

    // 搜索输入
    searchInput?.addEventListener('input', () => {
        currentSearchKeyword = searchInput.value;
        updateTrajectoryList(container);
    });

    // 复制全量 JSON
    copyBtn?.addEventListener('click', () => {
        const json = exportTrajectoryJson();
        if (navigator.clipboard) {
            navigator.clipboard.writeText(json);
            showToast('success', '已复制全量 Trajectory 运行轨迹 JSON 到剪贴板');
        }
    });

    // 导出文件
    exportBtn?.addEventListener('click', () => {
        const json = exportTrajectoryJson();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trajectory-${getCurrentRunId()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('success', '已导出 Trajectory 轨迹文件');
    });

    // 清空重置
    clearBtn?.addEventListener('click', () => {
        if (confirm('确定清空当前运行轨迹事件流吗？')) {
            clearTrajectoryEvents();
            showToast('info', '已重置 Trajectory 事件流');
        }
    });

    // 时序回放 (Replay)
    replayBtn?.addEventListener('click', async () => {
        const allEvents = getTrajectoryEvents();
        if (allEvents.length === 0) {
            showToast('warning', '当前暂无事件可供回放');
            return;
        }

        isReplaying = true;
        const scrollBox = container.querySelector('#trajectory-events-scroll') as HTMLElement;
        if (!scrollBox) return;

        scrollBox.innerHTML = `<div style="color: #38bdf8; text-align: center; padding: 20px 0;">▶️ 正在按时序回放执行事件 (${allEvents.length} Events)...</div>`;

        for (let i = 0; i < allEvents.length; i++) {
            const slice = allEvents.slice(0, i + 1);
            updateTrajectoryListWithEvents(container, slice);
            scrollBox.scrollTop = scrollBox.scrollHeight;
            await new Promise(r => setTimeout(r, 260));
        }

        isReplaying = false;
        showToast('success', '🎉 轨迹回放完成！');
    });
}

function updateTrajectoryListWithEvents(container: HTMLElement, events: TrajectoryEvent[]) {
    const scrollBox = container.querySelector('#trajectory-events-scroll');
    if (!scrollBox) return;
    const filtered = filterTrajectoryEvents(events, currentSourceFilter, currentSearchKeyword);
    // 重用列表渲染
    scrollBox.innerHTML = filtered.map(evt => {
        const style = SOURCE_COLORS[evt.source] || SOURCE_COLORS.SYSTEM;
        const seqStr = String(evt.sequenceNo).padStart(2, '0');
        const durationTag = evt.durationMs !== undefined
            ? `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-size: 10.5px; padding: 1px 6px; border-radius: 4px; font-family: monospace;">${evt.durationMs}ms</span>`
            : '';

        return `
            <div class="trajectory-event-card" style="
                background: #0f172a;
                border: 1px solid #1e293b;
                border-left: 4px solid ${style.text};
                border-radius: 8px;
                padding: 10px 12px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-family: monospace; font-size: 11px; color: #64748b;">#${seqStr}</span>
                        <span style="font-family: monospace; font-size: 11px; color: #94a3b8;">[${evt.timestamp}]</span>
                        <span style="background: ${style.bg}; color: ${style.text}; padding: 1px 6px; border-radius: 4px; font-size: 10.5px; font-weight: 700;">${style.icon} ${evt.source}</span>
                        <strong style="font-size: 12px; color: #f8fafc;">${escapeHtml(evt.title)}</strong>
                    </div>
                    <div>${durationTag}</div>
                </div>
                ${evt.summary ? `<div style="font-size: 11.5px; color: #cbd5e1; margin-top: 2px;">${escapeHtml(evt.summary)}</div>` : ''}
            </div>
        `;
    }).join('');
}

function escapeHtml(str: string): string {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
