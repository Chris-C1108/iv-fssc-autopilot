import { GlobalState, TripApplicationConfig, ExpenseBatchPlanResult, ExpensePlanOptions } from '../types/state';
import {
    WEBMCP_STATE,
    callWebMcpTool,
    onWebMcpToolExecuted,
    initWebMcpSystem
} from '../services/webmcpService';
import {
    getLlmConfig,
    isLlmConfigured,
    callLlmAgent,
    resetChatSession,
    loadChatSession,
    generateSessionTitle,
    getActiveChatSession,
    compressImageFile,
    MessageAttachment,
    rollbackChatSessionToTurn
} from '../services/llmService';
import {
    recordTrajectoryEvent,
    loadTrajectoryRun,
    getTrajectoryEvents
} from '../services/trajectoryService';
import {
    WebMcpSessionRecord,
    WebMcpUiMessage,
    initSessionStorage,
    saveSession,
    getSession,
    getActiveSessionId,
    setActiveSessionId
} from '../services/sessionStorageService';
import { openWebMcpHistoryDrawer } from './webmcpHistoryDrawer';
import { renderTrajectoryView } from './webmcpTrajectoryView';
import { openWebMcpSettingsModal } from './webmcpSettingsModal';
import { injectWebMcpStyles } from './webmcpStyles';
import { showToast } from '../utils/toast';
import { openApplicationModal } from './applicationModal';
import { mountToDock } from './floatingDock';
import { openTripPlanArtifact } from './webmcpArtifactView';
import { renderA2UiProjectDecisionWidget, renderA2UiExpenseBatchWidget } from './webmcpA2Ui';
import { loadAllInvoicesAndExpenses } from '../services/expenseService';
import { inferSmartExpensePlan } from '../services/commuteService';
import {
    mountStreamingMarkdown,
    renderStaticMarkdown,
    StreamingMarkdownHandle
} from './markdownRenderer';
import { AutopilotLogger } from '../utils/logger';

type ChatLayoutMode = 'drawer' | 'popup' | 'minimized';
type ActiveTab = 'chat' | 'inspector';

let currentLayoutMode: ChatLayoutMode = (localStorage.getItem('webmcp_layout_mode') as ChatLayoutMode) || 'drawer';
let currentTab: ActiveTab = 'chat';
let isChatOpen = false;

// 拖拽与缩放状态
let isDraggingPopup = false;
let isResizingDrawer = false;
let isResizingPopup = false;
let startX = 0;
let startY = 0;
let initialLeft = 0;
let initialTop = 0;
let initialWidth = 0;
let initialHeight = 0;

// 当前待发送的附件列表
let currentAttachments: MessageAttachment[] = [];

// 会话状态与持久化消息树
let currentUiMessages: WebMcpUiMessage[] = [];
let currentSessionTitle: string = '新对话';
let saveDebounceTimer: any = null;

async function immediateSaveCurrentSession() {
    if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
    }
    const session = getActiveChatSession();
    if (!session) return;

    if (currentUiMessages.length === 0 && session.messages.length <= 1) {
        return;
    }

    const record: WebMcpSessionRecord = {
        id: session.sessionId,
        title: currentSessionTitle || '新对话',
        createdAt: session.createdAt,
        updatedAt: Date.now(),
        turnCount: session.turnCount,
        messages: session.messages,
        uiMessages: currentUiMessages,
        trajectoryEvents: getTrajectoryEvents()
    };

    await saveSession(record);
    setActiveSessionId(record.id);
}

function debounceSaveCurrentSession() {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
        immediateSaveCurrentSession().catch(() => {});
    }, 400);
}

function attachPayloadToLastMessage(payloadType: 'expense_batch' | 'trip_plan', payloadData: any) {
    if (currentUiMessages.length > 0) {
        const last = currentUiMessages[currentUiMessages.length - 1];
        last.payloadType = payloadType;
        last.payloadData = payloadData;
        debounceSaveCurrentSession();
    }
}

function renderDefaultGreeting(stream: HTMLElement) {
    const toolsCount = WEBMCP_STATE.toolDefs.length;
    appendMessage(
        stream,
        'assistant',
        `<strong>你好！我是元年云 FSSC WebMCP 极速自动驾驶副驾。</strong><br>
        我已深度整合 <strong>W3C WebMCP 标准工具链（${toolsCount} 项企业级工具）与智能费用/差旅双规则引擎</strong>，支持以下全场景业务自动化：<br>
        1. <strong>费用与发票智能批量填报</strong>：15 大费用类型自动识别、异地/市内出租车往返行程穿透推断、外驻同事代报规范注入；<br>
        2. <strong>出差申请全要素规划</strong>：多模态行程感知、全员动态代办穿透、动态差标与日程测算、弹性 Buffer 预留；<br>
        3. <strong>人在回路 (HITL) 审批门禁</strong>：所有规划方案由您在 A2UI 交互卡片中亲自核准，单次一键批量写入元年云数据库草稿。<br><br>
        您可以直接输入业务需求、上传行程表格或截图，或点击上方场景芯片快速开始。`,
        { recordUi: false }
    );
}

async function startFreshChat(container: HTMLElement, state: GlobalState) {
    if (isGenerating && activeAbortController) {
        activeAbortController.abort();
        setGeneratingState(false, container);
    }
    await immediateSaveCurrentSession();
    const newRunId = resetChatSession();
    state.expensePlan = undefined;
    currentUiMessages = [];
    currentSessionTitle = '新对话';
    setActiveSessionId(newRunId);

    const stream = container.querySelector('#webmcp-chat-stream') as HTMLElement | null;
    if (stream) {
        stream.innerHTML = '';
        renderDefaultGreeting(stream);
        appendSuggestions(stream, container, state);
    }
    renderTrajectoryView(container);
    showToast('success', '✨ 已开启新对话');
}

async function restoreSession(sessionId: string, container: HTMLElement, state: GlobalState) {
    if (isGenerating && activeAbortController) {
        activeAbortController.abort();
        setGeneratingState(false, container);
    }
    await immediateSaveCurrentSession();

    const record = await getSession(sessionId);
    if (!record) {
        showToast('error', '未找到历史会话记录');
        return;
    }

    currentSessionTitle = record.title || '未命名会话';
    currentUiMessages = record.uiMessages || [];
    setActiveSessionId(record.id);

    loadChatSession({
        sessionId: record.id,
        messages: record.messages || [],
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        turnCount: record.turnCount
    });

    if (record.trajectoryEvents && record.trajectoryEvents.length > 0) {
        loadTrajectoryRun(record.id, record.trajectoryEvents);
    }

    const stream = container.querySelector('#webmcp-chat-stream') as HTMLElement | null;
    if (stream) {
        stream.innerHTML = '';
        if (currentUiMessages.length === 0) {
            renderDefaultGreeting(stream);
        } else {
            currentUiMessages.forEach(msg => {
                const isAssistant = msg.role === 'assistant';
                appendMessage(stream, msg.role as any, msg.htmlContent, {
                    recordUi: false,
                    isMarkdown: isAssistant,
                    rawText: msg.rawText || msg.htmlContent,
                    msgId: msg.id,
                    attachments: msg.attachments,
                    payloadType: msg.payloadType,
                    payloadData: msg.payloadData
                });
                if (msg.payloadType === 'expense_batch' && msg.payloadData) {
                    const a2uiWrapper = document.createElement('div');
                    a2uiWrapper.className = 'webmcp-a2ui-wrapper';
                    stream.appendChild(a2uiWrapper);
                    renderA2UiExpenseBatchWidget({
                        container: a2uiWrapper,
                        state,
                        initialPlan: msg.payloadData
                    });
                } else if (msg.payloadType === 'trip_plan' && Array.isArray(msg.payloadData)) {
                    renderGenerativeTripPlan(msg.payloadData, stream, container, state);
                }
            });
        }
        appendSuggestions(stream, container, state);
    }

    renderTrajectoryView(container);
    showToast('info', `已切换至会话: ${currentSessionTitle}`);
}

export function createWebMcpLauncherBtn(state: GlobalState): HTMLElement {
    const btnId = 'autopilot-webmcp-launcher';
    injectWebMcpStyles();

    const btn = mountToDock(btnId, () => {
        const b = document.createElement('div');
        b.id = btnId;
        b.className = 'webmcp-copilot-pill';
        b.innerHTML = `
            <div class="webmcp-pill-indicator"></div>
            <span style="font-size: 15px;">🤖</span>
            <span>WebMCP 智能副驾</span>
        `;

        b.addEventListener('click', () => {
            if (!isChatOpen) {
                openWebMcpCopilot(state);
            } else {
                setCopilotLayout('minimized');
            }
        });
        return b;
    });

    return btn;
}

export async function openWebMcpCopilot(state: GlobalState) {
    currentGlobalState = state;
    injectWebMcpStyles();
    initWebMcpSystem(state);
    await initSessionStorage();

    const containerId = 'autopilot-webmcp-container';
    let container = document.getElementById(containerId);

    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.className = `webmcp-container mode-${currentLayoutMode}`;
        document.body.appendChild(container);
        renderCopilotSkeleton(container, state);
        setupGlobalInteractions(container, state);

        const activeId = getActiveSessionId();
        let restored = false;
        if (activeId) {
            const existing = await getSession(activeId);
            if (existing && existing.uiMessages && existing.uiMessages.length > 0) {
                await restoreSession(activeId, container, state);
                restored = true;
            }
        }
        if (!restored) {
            const stream = container.querySelector('#webmcp-chat-stream') as HTMLElement | null;
            if (stream) {
                renderDefaultGreeting(stream);
                appendSuggestions(stream, container, state);
            }
        }
    }

    isChatOpen = true;
    if (currentLayoutMode === 'minimized') {
        setCopilotLayout('drawer');
    } else {
        setCopilotLayout(currentLayoutMode);
    }
}

export const openWebMcpModal = openWebMcpCopilot;

if (typeof window !== 'undefined') {
    (window as any).openWebMcpCopilot = openWebMcpCopilot;
    (window as any).openWebMcpModal = openWebMcpCopilot;
}

function renderCopilotSkeleton(container: HTMLElement, state: GlobalState) {
    const toolsCount = WEBMCP_STATE.toolDefs.length;

    container.innerHTML = `
        <!-- 侧边抽屉左边缘拖拽把手 (Drawer Resizer) -->
        <div class="webmcp-drawer-resizer" id="webmcp-drawer-resizer" title="向左拖动调节抽屉宽度"></div>

        <!-- 悬浮窗右下角缩放把手 (Popup Resizer) -->
        <div class="webmcp-popup-resizer" id="webmcp-popup-resizer" title="拖动调节窗口大小">
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M9 1L1 9M9 5L5 9M9 9L9 9"/>
            </svg>
        </div>

        <!-- 头部 (Header) -->
        <div class="webmcp-header" id="webmcp-header">
            <div class="webmcp-header-left">
                <div class="webmcp-logo-icon">🤖</div>
                <div class="webmcp-header-title">WebMCP Copilot</div>
                <div class="webmcp-badge-status">
                    <span style="display:inline-block;width:6px;height:6px;background:#10b981;border-radius:50%;"></span>
                    <span>W3C (${toolsCount})</span>
                </div>
                <div class="webmcp-model-badge" id="webmcp-badge-model" title="点击配置 LLM 接入 API">
                    <span>🤖</span>
                    <span id="webmcp-model-name">模型未配置</span>
                </div>
            </div>

            <!-- 分段器 Tabs (对话 vs 监视器) -->
            <div class="webmcp-tabs">
                <button class="webmcp-tab-btn active" id="tab-btn-chat" data-tab="chat">
                    <span>💬</span>
                    <span>智能对话</span>
                </button>
                <button class="webmcp-tab-btn" id="tab-btn-inspector" data-tab="inspector">
                    <span>⚡</span>
                    <span>Trajectory 运行日志</span>
                </button>
            </div>

            <!-- 右侧控制区 -->
            <div class="webmcp-header-right">
                <!-- 会话历史清单按钮 (Session History) -->
                <button class="webmcp-icon-btn" id="webmcp-btn-history" title="会话历史清单 (查看、检索、切换与分支测试)">
                    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </button>

                <!-- 新对话按钮 (New Chat Session) -->
                <button class="webmcp-icon-btn" id="webmcp-btn-new-chat" title="新对话 (开启全新会话)">
                    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <path d="M12 5v14M5 12h14"/>
                    </svg>
                </button>

                <!-- 模型设置按钮 -->
                <button class="webmcp-icon-btn" id="webmcp-btn-settings" title="LLM 模型接入 API 设置">
                    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                    </svg>
                </button>

                <!-- 布局切换按钮 -->
                <button class="webmcp-icon-btn" id="webmcp-btn-layout" title="切换布局 (侧边抽屉 / 悬浮视窗)">
                    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <path d="M15 3v18"/>
                    </svg>
                </button>

                <!-- 最小化按钮 -->
                <button class="webmcp-icon-btn" id="webmcp-btn-minimize" title="最小化到右下角胶囊">
                    <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                        <path d="M5 12h14"/>
                    </svg>
                </button>

                <!-- 关闭按钮 -->
                <button class="webmcp-icon-btn" id="webmcp-btn-close" title="关闭">
                    <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                        <path d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>

                <!-- 布局切换下拉菜单 (CRM Agent Pop 风格) -->
                <div class="webmcp-layout-dropdown" id="webmcp-layout-dropdown" style="display: none;">
                    <div style="font-size: 11px; font-weight: 600; color: #94a3b8; padding: 4px 8px;">切换布局形式</div>
                    <div class="webmcp-dropdown-item ${currentLayoutMode === 'drawer' ? 'active' : ''}" data-mode="drawer">
                        <span>📐 侧边抽屉 (Side Drawer)</span>
                        <span style="font-size: 11px;">✓</span>
                    </div>
                    <div class="webmcp-dropdown-item ${currentLayoutMode === 'popup' ? 'active' : ''}" data-mode="popup">
                        <span>🪟 悬浮视窗 (Pop-up Window)</span>
                        <span style="font-size: 11px;">✓</span>
                    </div>
                    <div class="webmcp-dropdown-item" data-mode="minimized">
                        <span>➖ 最小化 (Minimize)</span>
                        <span style="font-size: 11px;">✓</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 主视图 1: 智能对话视图 -->
        <div class="webmcp-content-view" id="webmcp-view-chat">
            <!-- 快捷场景 Chips (HeroUI Pro Style) -->
            <div class="webmcp-quick-prompts">
                <div class="webmcp-prompt-chip" data-prompt="智能分析发票夹与费用记录，批量推断往返行程与外驻代报说明">⚡ 发票与费用智能批量规划</div>
                <div class="webmcp-prompt-chip" data-prompt="智能规划出差申请单，自动测算住宿差标、误餐补助与弹性Buffer">✈️ 智能差旅规划 (自动测算差标与Buffer)</div>
                <div class="webmcp-prompt-chip" data-prompt="请分析当前页面的出差发票，按外驻同事代报销规范进行行程推断与合规填写">👥 外驻代报出差发票</div>
                <div class="webmcp-prompt-chip" data-prompt="在维表中检索员工账号与所属部门">🔍 维表检索员工</div>
                <div class="webmcp-prompt-chip" data-prompt="查询项目维表编号与预算关联">📁 维表检索项目</div>
                <div class="webmcp-prompt-chip" data-prompt="获取当前登录人信息以及出差报销规程限额标准">📜 差旅规程与限额标准</div>
            </div>

            <!-- 消息流容器 (动态恢复历史会话气泡) -->
            <div class="webmcp-chat-stream" id="webmcp-chat-stream">
            </div>

            <!-- 底部输入框 (Elevated Composer Box) -->
            <div class="webmcp-composer-box">
                <div class="webmcp-input-container">
                    <!-- 附件预览栏 -->
                    <div class="webmcp-attachments-bar" id="webmcp-attachments-bar" style="display: none;"></div>

                    <textarea class="webmcp-textarea" id="webmcp-user-input" placeholder="输入费用规划/出差规划需求，或拖拽/Ctrl+V截图上传行程单、发票、表格..." rows="1"></textarea>
                    
                    <div class="webmcp-composer-footer">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="file" id="webmcp-file-input" multiple accept="image/*,.pdf,.csv,.txt,.xlsx,.xls" style="display: none;" />
                            <button type="button" class="webmcp-btn-attach" id="webmcp-btn-attach" title="上传出差行程图、发票截图、PDF/CSV日程表">
                                <span>📎</span>
                                <span>附件</span>
                            </button>
                            <span style="color: #cbd5e1;">|</span>
                            <span style="font-size: 11px; color: #64748b;">⚡ WebMCP: <strong>${toolsCount} 就绪</strong></span>
                            <span style="color: #cbd5e1;">|</span>
                            <span style="font-size: 11px; color: #94a3b8;">Enter 发送</span>
                        </div>
                        <button class="webmcp-btn-send" id="webmcp-btn-send">
                            <span>发送</span>
                            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                <path d="M5 12h14M12 5l7 7-7 7"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 主视图 2: DeepSeek Harness 风格 Trajectory 运行日志全量追踪面板 -->
        <div class="webmcp-inspector-view" id="webmcp-view-inspector" style="display: none; height: calc(100% - 49px); overflow: hidden;">
        </div>
    `;

    renderTrajectoryView(container);
}

function setupGlobalInteractions(container: HTMLElement, state: GlobalState) {
    // 1. 顶部 Tab 切换
    const tabChat = container.querySelector('#tab-btn-chat');
    const tabInspector = container.querySelector('#tab-btn-inspector');
    const viewChat = container.querySelector('#webmcp-view-chat') as HTMLElement;
    const viewInspector = container.querySelector('#webmcp-view-inspector') as HTMLElement;

    tabChat?.addEventListener('click', () => {
        currentTab = 'chat';
        tabChat.classList.add('active');
        tabInspector?.classList.remove('active');
        if (viewChat) viewChat.style.display = 'flex';
        if (viewInspector) viewInspector.style.display = 'none';
    });

    tabInspector?.addEventListener('click', () => {
        currentTab = 'inspector';
        tabInspector.classList.add('active');
        tabChat?.classList.remove('active');
        if (viewChat) viewChat.style.display = 'none';
        if (viewInspector) {
            viewInspector.style.display = 'flex';
            renderTrajectoryView(container);
        }
    });

    // 2. 模型状态与 API 设置模态弹窗
    const btnSettings = container.querySelector('#webmcp-btn-settings');
    const badgeModel = container.querySelector('#webmcp-badge-model');

    const updateModelBadge = () => {
        const modelTag = container.querySelector('#webmcp-model-name');
        const badge = container.querySelector('#webmcp-badge-model');
        if (!badge || !modelTag) return;
        const cfg = getLlmConfig();
        if (isLlmConfigured()) {
            badge.classList.add('configured');
            modelTag.textContent = cfg.model;
            badge.setAttribute('title', `已接入大模型 [${cfg.model}]，点击修改设置`);
        } else {
            badge.classList.remove('configured');
            modelTag.textContent = '5D 规则引擎 (点此配API)';
            badge.setAttribute('title', '当前运行于内置 5D 启发式引擎，点击配置大模型 API');
        }
    };
    updateModelBadge();

    btnSettings?.addEventListener('click', () => {
        openWebMcpSettingsModal(() => updateModelBadge());
    });
    badgeModel?.addEventListener('click', () => {
        openWebMcpSettingsModal(() => updateModelBadge());
    });

    // 2.0 会话历史抽屉 (Session History Drawer)
    const btnHistory = container.querySelector('#webmcp-btn-history');
    btnHistory?.addEventListener('click', () => {
        openWebMcpHistoryDrawer(container, {
            onSelectSession: (targetSession) => {
                restoreSession(targetSession.id, container, state);
            },
            onNewChat: () => {
                startFreshChat(container, state);
            }
        });
    });

    // 2.1 新对话 (New Chat) 按钮
    const btnNewChat = container.querySelector('#webmcp-btn-new-chat');
    btnNewChat?.addEventListener('click', () => {
        startFreshChat(container, state);
    });

    // 3. 布局切换下拉菜单
    const btnLayout = container.querySelector('#webmcp-btn-layout');
    const dropdownLayout = container.querySelector('#webmcp-layout-dropdown') as HTMLElement;

    btnLayout?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dropdownLayout) {
            dropdownLayout.style.display = dropdownLayout.style.display === 'none' ? 'flex' : 'none';
        }
    });

    document.addEventListener('click', (e) => {
        if (dropdownLayout && !dropdownLayout.contains(e.target as Node) && e.target !== btnLayout) {
            dropdownLayout.style.display = 'none';
        }
    });

    dropdownLayout?.querySelectorAll('.webmcp-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            const mode = item.getAttribute('data-mode') as ChatLayoutMode;
            if (mode) {
                setCopilotLayout(mode);
                dropdownLayout.style.display = 'none';
            }
        });
    });

    // 4. 最小化与关闭
    const btnMinimize = container.querySelector('#webmcp-btn-minimize');
    btnMinimize?.addEventListener('click', () => setCopilotLayout('minimized'));

    const btnClose = container.querySelector('#webmcp-btn-close');
    btnClose?.addEventListener('click', () => setCopilotLayout('minimized'));

    // 全屏拖拽捕获遮罩辅助
    const createDragOverlay = (cursor: string) => {
        let overlay = document.getElementById('webmcp-drag-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'webmcp-drag-overlay';
            overlay.className = 'webmcp-drag-overlay';
            document.body.appendChild(overlay);
        }
        overlay.style.cursor = cursor;
    };
    const removeDragOverlay = () => {
        const overlay = document.getElementById('webmcp-drag-overlay');
        if (overlay) overlay.remove();
    };

    // 5. 侧边抽屉宽度拖拽 (Drawer Left Resizer)
    const drawerResizer = container.querySelector('#webmcp-drawer-resizer');
    drawerResizer?.addEventListener('mousedown', (e: any) => {
        if (currentLayoutMode !== 'drawer') return;
        e.preventDefault();
        e.stopPropagation();
        isResizingDrawer = true;
        container.classList.add('is-resizing');
        createDragOverlay('ew-resize');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    });

    // 6. 悬浮窗顶部拖拽移动 (Popup Header Dragger)
    const header = container.querySelector('#webmcp-header');
    header?.addEventListener('mousedown', (e: any) => {
        if (currentLayoutMode !== 'popup') return;
        if (e.target.closest('button') || e.target.closest('.webmcp-tabs') || e.target.closest('.webmcp-layout-dropdown') || e.target.closest('.webmcp-model-badge')) return;

        e.preventDefault();
        isDraggingPopup = true;
        container.classList.add('is-resizing');
        startX = e.clientX;
        startY = e.clientY;
        const rect = container.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        createDragOverlay('grabbing');
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    });

    // 7. 悬浮窗右下角缩放 (Popup Corner Resizer)
    const popupResizer = container.querySelector('#webmcp-popup-resizer');
    popupResizer?.addEventListener('mousedown', (e: any) => {
        if (currentLayoutMode !== 'popup') return;
        e.preventDefault();
        e.stopPropagation();
        isResizingPopup = true;
        container.classList.add('is-resizing');
        startX = e.clientX;
        startY = e.clientY;
        const rect = container.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        initialWidth = rect.width;
        initialHeight = rect.height;
        createDragOverlay('nwse-resize');
        document.body.style.cursor = 'nwse-resize';
        document.body.style.userSelect = 'none';
    });

    // 全局 mousemove 与 mouseup 处理 (彻底解决卡顿与范围漂移)
    window.addEventListener('mousemove', (e) => {
        if (isResizingDrawer) {
            let newWidth = window.innerWidth - e.clientX;
            if (newWidth < 380) newWidth = 380;
            if (newWidth > window.innerWidth * 0.95) newWidth = window.innerWidth * 0.95;
            container.style.width = `${newWidth}px`;
        }
        if (isDraggingPopup) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const newL = Math.max(10, Math.min(window.innerWidth - 100, initialLeft + dx));
            const newT = Math.max(10, Math.min(window.innerHeight - 80, initialTop + dy));
            container.style.left = `${newL}px`;
            container.style.top = `${newT}px`;
        }
        if (isResizingPopup) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let newW = Math.max(460, Math.min(window.innerWidth - initialLeft - 10, initialWidth + dx));
            let newH = Math.max(400, Math.min(window.innerHeight - initialTop - 10, initialHeight + dy));
            container.style.width = `${newW}px`;
            container.style.height = `${newH}px`;
        }
    });

    window.addEventListener('mouseup', () => {
        if (isResizingDrawer || isDraggingPopup || isResizingPopup) {
            isResizingDrawer = false;
            isDraggingPopup = false;
            isResizingPopup = false;
            container.classList.remove('is-resizing');
            removeDragOverlay();
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            drawerResizer?.classList.remove('is-resizing');
            popupResizer?.classList.remove('is-resizing');
        }
    });

    // 8. 附件上传与拖拽/剪贴板支持
    const fileInput = container.querySelector('#webmcp-file-input') as HTMLInputElement;
    const btnAttach = container.querySelector('#webmcp-btn-attach');
    const input = container.querySelector('#webmcp-user-input') as HTMLTextAreaElement;

    const renderAttachmentsBar = () => {
        const bar = container.querySelector('#webmcp-attachments-bar') as HTMLElement;
        if (!bar) return;
        if (currentAttachments.length === 0) {
            bar.style.display = 'none';
            bar.innerHTML = '';
            return;
        }

        bar.style.display = 'flex';
        bar.innerHTML = currentAttachments.map(a => `
            <div class="webmcp-attachment-chip" title="${a.name} (${formatFileSize(a.size)})">
                ${a.dataUrl ? `<img src="${a.dataUrl}" class="webmcp-attachment-thumb" />` : `<span>📄</span>`}
                <span class="webmcp-attachment-name">${a.name}</span>
                <span class="webmcp-attachment-remove" data-id="${a.id}">✕</span>
            </div>
        `).join('');

        bar.querySelectorAll('.webmcp-attachment-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                currentAttachments = currentAttachments.filter(a => a.id !== id);
                renderAttachmentsBar();
            });
        });
    };

    const processFiles = async (files: FileList | File[]) => {
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const att: MessageAttachment = {
                id: Math.random().toString(36).slice(2, 9),
                name: f.name,
                size: f.size,
                type: f.type || 'application/octet-stream'
            };

            if (f.type.startsWith('image/')) {
                // 前端等比智能下采样与高质量压缩，将多兆大图缩小至150KB以内，根除 Gemini 503 超大 Payload 网关超时
                const comp = await compressImageFile(f, 1600, 0.82);
                att.dataUrl = comp.dataUrl;
                att.size = comp.size;
            } else if (f.type.includes('text') || f.name.endsWith('.csv') || f.name.endsWith('.txt')) {
                att.textContent = await readFileAsText(f);
            }
            currentAttachments.push(att);
        }
        renderAttachmentsBar();
        showToast('info', `📎 已添加 ${files.length} 个附件`);
    };

    btnAttach?.addEventListener('click', () => {
        fileInput?.click();
    });

    fileInput?.addEventListener('change', async () => {
        if (fileInput.files && fileInput.files.length > 0) {
            await processFiles(fileInput.files);
            fileInput.value = '';
        }
    });

    // 拖拽文件进入
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        container.classList.add('is-dragover');
    });
    container.addEventListener('dragleave', (e) => {
        if (!container.contains(e.relatedTarget as Node)) {
            container.classList.remove('is-dragover');
        }
    });
    container.addEventListener('drop', async (e) => {
        e.preventDefault();
        container.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
            await processFiles(e.dataTransfer.files);
        }
    });

    // 剪贴板截图粘贴
    input?.addEventListener('paste', async (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const images: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const f = items[i].getAsFile();
                if (f) images.push(f);
            }
        }
        if (images.length > 0) {
            e.preventDefault();
            await processFiles(images);
            showToast('info', `📋 已自动截取并附加剪贴板中的 ${images.length} 张图片`);
        }
    });

    // 9. 快捷 Prompt 芯片点击
    const promptChips = container.querySelectorAll('.webmcp-prompt-chip');
    promptChips.forEach(chip => {
        chip.addEventListener('click', () => {
            if (isGenerating) {
                showToast('warning', '当前正在生成回复，请先停止或等待完成');
                return;
            }
            const prompt = chip.getAttribute('data-prompt');
            if (prompt) {
                const filesToSend = [...currentAttachments];
                currentAttachments = [];
                renderAttachmentsBar();
                handleUserPrompt(prompt, container, state, filesToSend);
            }
        });
    });

    // 10. 输入框发送事件与自适应高度
    const sendBtn = container.querySelector('#webmcp-btn-send') as HTMLButtonElement;

    const autoResizeTextarea = (el: HTMLTextAreaElement) => {
        el.style.height = 'auto';
        const nextHeight = Math.min(160, Math.max(38, el.scrollHeight));
        el.style.height = `${nextHeight}px`;
    };

    input?.addEventListener('input', () => {
        autoResizeTextarea(input);
    });

    const doSend = () => {
        if (isGenerating) {
            // 处于生成中，点击按钮执行停止
            if (activeAbortController) {
                activeAbortController.abort();
                showToast('info', '⏹️ 已发送终止生成信号');
            }
            setGeneratingState(false, container);
            return;
        }

        const txt = input?.value.trim();
        if (txt || currentAttachments.length > 0) {
            const prompt = txt || (currentAttachments.length > 0 ? '请分析我上传的行程附件并整合规划出差申请' : '');
            input.value = '';
            input.style.height = 'auto';
            const filesToSend = [...currentAttachments];
            currentAttachments = [];
            renderAttachmentsBar();
            handleUserPrompt(prompt, container, state, filesToSend);
        }
    };

    sendBtn?.addEventListener('click', doSend);
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isGenerating) {
            e.preventDefault();
            if (activeAbortController) {
                activeAbortController.abort();
                showToast('info', '⏹️ 已发送终止生成信号');
            }
            setGeneratingState(false, container);
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSend();
        }
    });

}

function setCopilotLayout(mode: ChatLayoutMode) {
    currentLayoutMode = mode;
    localStorage.setItem('webmcp_layout_mode', mode);

    const container = document.getElementById('autopilot-webmcp-container');
    const drawerResizer = document.getElementById('webmcp-drawer-resizer');
    const popupResizer = document.getElementById('webmcp-popup-resizer');
    const launcherBtn = document.getElementById('autopilot-webmcp-launcher');

    if (!container) return;

    container.classList.remove('mode-drawer', 'mode-popup', 'is-hidden');

    if (mode === 'drawer') {
        container.classList.add('mode-drawer');
        container.style.top = '0';
        container.style.right = '0';
        container.style.left = '';
        container.style.bottom = '';
        container.style.height = '100vh';
        if (!container.style.width || parseInt(container.style.width) < 380) {
            container.style.width = '640px';
        }
        if (drawerResizer) drawerResizer.style.display = 'block';
        if (popupResizer) popupResizer.style.display = 'none';
        if (launcherBtn) launcherBtn.style.display = 'none';
    } else if (mode === 'popup') {
        container.classList.add('mode-popup');
        container.style.right = '';
        container.style.bottom = '';
        if (!container.style.left || !container.style.top) {
            const w = Math.min(880, window.innerWidth * 0.9);
            const h = Math.min(780, window.innerHeight * 0.88);
            const left = (window.innerWidth - w) / 2;
            const top = (window.innerHeight - h) / 2;
            container.style.left = `${Math.max(15, left)}px`;
            container.style.top = `${Math.max(15, top)}px`;
            container.style.width = `${w}px`;
            container.style.height = `${h}px`;
        }
        if (drawerResizer) drawerResizer.style.display = 'none';
        if (popupResizer) popupResizer.style.display = 'flex';
        if (launcherBtn) launcherBtn.style.display = 'none';
    } else if (mode === 'minimized') {
        container.classList.add('mode-drawer', 'is-hidden');
        if (launcherBtn) launcherBtn.style.display = 'flex';
        isChatOpen = false;
    }

    // 更新下拉单勾选
    const dropdown = document.getElementById('webmcp-layout-dropdown');
    dropdown?.querySelectorAll('.webmcp-dropdown-item').forEach(item => {
        const m = item.getAttribute('data-mode');
        if (m === mode) item.classList.add('active');
        else item.classList.remove('active');
    });
}

// 工具与运行日志由 TrajectoryView 全量可溯源系统统一驱动呈现

let activeAbortController: AbortController | null = null;
let isGenerating = false;
let currentGlobalState: GlobalState | null = null;

function escapeHtml(str: string): string {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setGeneratingState(generating: boolean, container?: HTMLElement | null) {
    isGenerating = generating;
    const targetContainer = container || document.getElementById('autopilot-webmcp-container');
    const sendBtn = targetContainer?.querySelector('#webmcp-btn-send') as HTMLButtonElement | null;
    if (!sendBtn) return;

    if (generating) {
        sendBtn.classList.add('is-stopping');
        sendBtn.innerHTML = `
            <span>⏹️ 停止</span>
        `;
        sendBtn.setAttribute('title', '点击立即终止当前大模型输出 (Esc)');
    } else {
        sendBtn.classList.remove('is-stopping');
        sendBtn.innerHTML = `
            <span>发送</span>
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
        `;
        sendBtn.setAttribute('title', '发送 (Enter)');
        activeAbortController = null;
    }
}

interface AgenticStatusCardHandle {
    updateStatus: (text: string, icon?: string) => void;
    finish: (options?: { toolCount?: number }) => { durationMs: number; badgeHtml: string };
    destroy: () => void;
    card: HTMLElement;
}

function createAgenticStatusCard(stream: HTMLElement, modelName: string): AgenticStatusCardHandle {
    const card = document.createElement('div');
    card.className = 'webmcp-status-card';
    card.innerHTML = `
        <div class="webmcp-status-card-left">
            <span class="webmcp-status-icon">🧠</span>
            <span class="webmcp-status-text"><strong>[${escapeHtml(modelName)}]</strong> 正在思考与分析需求...</span>
        </div>
        <div class="webmcp-status-timer">0.0s</div>
    `;
    stream.appendChild(card);
    stream.scrollTop = stream.scrollHeight;

    const t0 = Date.now();
    const timerEl = card.querySelector('.webmcp-status-timer') as HTMLElement | null;
    const iconEl = card.querySelector('.webmcp-status-icon') as HTMLElement | null;
    const textEl = card.querySelector('.webmcp-status-text') as HTMLElement | null;

    const timerInterval = setInterval(() => {
        const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
        if (timerEl) timerEl.textContent = `${elapsedSec}s`;
    }, 100);

    return {
        card,
        updateStatus: (text: string, icon: string = '⚡') => {
            if (textEl) textEl.innerHTML = text;
            if (iconEl) iconEl.textContent = icon;
        },
        finish: (options?: { toolCount?: number }) => {
            clearInterval(timerInterval);
            const durationMs = Date.now() - t0;
            const durationSec = (durationMs / 1000).toFixed(1);
            const toolCount = options?.toolCount || 0;
            const badgeHtml = `
                <div class="webmcp-metrics-badge" title="大模型生成耗时与工具调用统计">
                    <span>⚡ 耗时 ${durationSec}s</span>
                    <span>·</span>
                    <span>🤖 ${escapeHtml(modelName)}</span>
                    ${toolCount > 0 ? `<span>·</span><span>🛠️ ${toolCount} 项工具</span>` : ''}
                </div>
            `;
            try { card.remove(); } catch (e) { }
            return { durationMs, badgeHtml };
        },
        destroy: () => {
            clearInterval(timerInterval);
            try { card.remove(); } catch (e) { }
        }
    };
}

function renderMessageActions(
    msgEl: HTMLElement,
    role: string,
    rawText: string,
    stream: HTMLElement,
    container?: HTMLElement | null,
    state?: GlobalState | null,
    msgId?: string
) {
    if (role !== 'user' && role !== 'assistant') return;
    if (msgEl.querySelector('.webmcp-msg-actions')) return;

    const actualContainer = container || document.getElementById('autopilot-webmcp-container');
    const actualState = state || currentGlobalState;

    const actionsBar = document.createElement('div');
    actionsBar.className = 'webmcp-msg-actions';

    // 1. 复制按钮
    const btnCopy = document.createElement('button');
    btnCopy.className = 'webmcp-msg-action-btn';
    btnCopy.type = 'button';
    btnCopy.innerHTML = `<span>📋</span><span>复制</span>`;
    btnCopy.setAttribute('title', '复制内容到剪贴板');
    btnCopy.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(rawText);
            btnCopy.innerHTML = `<span>✓</span><span>已复制</span>`;
            setTimeout(() => {
                btnCopy.innerHTML = `<span>📋</span><span>复制</span>`;
            }, 1800);
        } catch {
            showToast('error', '复制失败');
        }
    });
    actionsBar.appendChild(btnCopy);

    // 2. 用户消息专属: 编辑重发
    if (role === 'user' && actualContainer && actualState) {
        const btnEdit = document.createElement('button');
        btnEdit.className = 'webmcp-msg-action-btn';
        btnEdit.type = 'button';
        btnEdit.innerHTML = `<span>✏️</span><span>编辑</span>`;
        btnEdit.setAttribute('title', '就地编辑并重新生成');
        btnEdit.addEventListener('click', (e) => {
            e.stopPropagation();
            openInlineEditor(msgEl, rawText, stream, actualContainer, actualState);
        });
        actionsBar.appendChild(btnEdit);
    }

    // 3. 助手消息专属: 重试/重新生成
    if (role === 'assistant' && actualContainer && actualState) {
        const btnRetry = document.createElement('button');
        btnRetry.className = 'webmcp-msg-action-btn';
        btnRetry.type = 'button';
        btnRetry.innerHTML = `<span>🔄</span><span>重试</span>`;
        btnRetry.setAttribute('title', '回滚至上一轮并重新生成');
        btnRetry.addEventListener('click', (e) => {
            e.stopPropagation();
            regenerateAssistantMessage(msgEl, stream, actualContainer, actualState);
        });
        actionsBar.appendChild(btnRetry);
    }

    msgEl.appendChild(actionsBar);
}

function openInlineEditor(
    msgEl: HTMLElement,
    currentText: string,
    stream: HTMLElement,
    container: HTMLElement,
    state: GlobalState
) {
    if (isGenerating) {
        showToast('warning', '当前正在生成回复，请先停止后再编辑');
        return;
    }

    const bubble = msgEl.querySelector('.webmcp-msg-bubble') as HTMLElement | null;
    if (!bubble) return;

    if (msgEl.querySelector('.webmcp-inline-editor')) return;

    bubble.style.display = 'none';

    const editor = document.createElement('div');
    editor.className = 'webmcp-inline-editor';
    editor.innerHTML = `
        <textarea class="webmcp-inline-textarea" placeholder="修改提示词内容...">${escapeHtml(currentText)}</textarea>
        <div class="webmcp-inline-editor-actions">
            <button class="webmcp-inline-btn cancel" type="button">取消</button>
            <button class="webmcp-inline-btn submit" type="button">保存并重新发送</button>
        </div>
    `;

    msgEl.appendChild(editor);

    const textarea = editor.querySelector('.webmcp-inline-textarea') as HTMLTextAreaElement;
    const btnCancel = editor.querySelector('.webmcp-inline-btn.cancel');
    const btnSubmit = editor.querySelector('.webmcp-inline-btn.submit');

    const resize = () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(200, Math.max(54, textarea.scrollHeight))}px`;
    };
    textarea.addEventListener('input', resize);
    setTimeout(() => {
        textarea.focus();
        resize();
    }, 50);

    btnCancel?.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.remove();
        bubble.style.display = '';
    });

    btnSubmit?.addEventListener('click', (e) => {
        e.stopPropagation();
        const newText = textarea.value.trim();
        if (!newText) {
            showToast('warning', '提示词不能为空');
            return;
        }

        const msgId = msgEl.getAttribute('data-msg-id');
        let targetIndex = -1;
        if (msgId) {
            targetIndex = currentUiMessages.findIndex(m => m.id === msgId);
        }
        if (targetIndex === -1) {
            targetIndex = currentUiMessages.findIndex(m => m.role === 'user' && m.rawText === currentText);
        }

        let attachmentsToKeep: MessageAttachment[] = [];
        let userTurn = 1;
        if (targetIndex !== -1) {
            attachmentsToKeep = (currentUiMessages[targetIndex].attachments || []).map((a: any) => ({
                id: a.id || Math.random().toString(36).slice(2, 9),
                name: a.name,
                size: a.size,
                type: a.type,
                dataUrl: a.dataUrl,
                textContent: a.textContent
            }));
            userTurn = currentUiMessages.slice(0, targetIndex + 1).filter(m => m.role === 'user').length;
            currentUiMessages.splice(targetIndex);
        } else {
            userTurn = 1;
            currentUiMessages = [];
        }

        // 1. 回滚大模型会话
        rollbackChatSessionToTurn(userTurn);

        // 2. 移除该节点及其之后的所有 DOM 节点
        let next = msgEl.nextElementSibling;
        while (next) {
            const toRemove = next;
            next = next.nextElementSibling;
            toRemove.remove();
        }
        msgEl.remove();

        // 3. 立即触发持久化保存截断后的状态
        debounceSaveCurrentSession();

        // 4. 重新发起
        handleUserPrompt(newText, container, state, attachmentsToKeep);
    });
}

function regenerateAssistantMessage(
    assistantMsgEl: HTMLElement,
    stream: HTMLElement,
    container: HTMLElement,
    state: GlobalState
) {
    if (isGenerating) {
        showToast('warning', '当前正在生成回复，请先停止后再重试');
        return;
    }

    const msgId = assistantMsgEl.getAttribute('data-msg-id');
    let targetIdx = -1;
    if (msgId) {
        targetIdx = currentUiMessages.findIndex(m => m.id === msgId);
    }
    if (targetIdx === -1) {
        for (let i = currentUiMessages.length - 1; i >= 0; i--) {
            if (currentUiMessages[i].role === 'assistant') {
                targetIdx = i;
                break;
            }
        }
    }

    // 找到紧挨着的前一条 user 消息
    let precedingUserIdx = -1;
    for (let i = (targetIdx !== -1 ? targetIdx - 1 : currentUiMessages.length - 1); i >= 0; i--) {
        if (currentUiMessages[i].role === 'user') {
            precedingUserIdx = i;
            break;
        }
    }

    if (precedingUserIdx === -1) {
        showToast('warning', '未能找到对应的前序提问');
        return;
    }

    const lastUserMsg = currentUiMessages[precedingUserIdx];
    const userPrompt = lastUserMsg.rawText || lastUserMsg.htmlContent;
    const attached: MessageAttachment[] = (lastUserMsg.attachments || []).map((a: any) => ({
        id: a.id || Math.random().toString(36).slice(2, 9),
        name: a.name,
        size: a.size,
        type: a.type,
        dataUrl: a.dataUrl,
        textContent: a.textContent
    }));

    const userTurn = currentUiMessages.slice(0, precedingUserIdx + 1).filter(m => m.role === 'user').length;

    // 回滚大模型底层的多轮会话至该轮之前
    rollbackChatSessionToTurn(userTurn);

    // 截断 currentUiMessages
    currentUiMessages.splice(precedingUserIdx);

    // 找到该 user 消息的 DOM 节点并移除其及后续所有兄弟节点
    const userDomEl = stream.querySelector(`[data-msg-id="${lastUserMsg.id}"]`);
    if (userDomEl) {
        let next = userDomEl.nextElementSibling;
        while (next) {
            const toRemove = next;
            next = next.nextElementSibling;
            toRemove.remove();
        }
        userDomEl.remove();
    } else {
        let next = assistantMsgEl.nextElementSibling;
        while (next) {
            const toRemove = next;
            next = next.nextElementSibling;
            toRemove.remove();
        }
        assistantMsgEl.remove();
    }

    // 立即触发持久化保存截断后的状态
    debounceSaveCurrentSession();

    // 重新发起
    handleUserPrompt(userPrompt, container, state, attached);
}

/**
 * 核心 Agentic 流程调度器 (WebMCP Assistant)
 * 具备多模态附件解析、LLM 智能驱动与 5 维差旅/费用双规则引擎自动对齐
 */
async function handleUserPrompt(
    prompt: string,
    container: HTMLElement,
    state: GlobalState,
    attachedFiles: MessageAttachment[] = []
) {
    if (isGenerating) {
        showToast('warning', '当前正在生成回复，请先停止或等待完成');
        return;
    }

    const stream = container.querySelector('#webmcp-chat-stream') as HTMLElement | null;
    if (!stream) return;

    // 1. 自动根据首轮 prompt 智能提炼会话标题
    if (!currentSessionTitle || currentSessionTitle === '新对话' || currentSessionTitle === '新会话') {
        currentSessionTitle = generateSessionTitle(prompt);
    }

    // 1.1 快捷重置会话指令
    if (/^(新对话|开启新对话|重置会话|清空会话|清空上下文|new chat)$/i.test(prompt.trim())) {
        await startFreshChat(container, state);
        return;
    }

    // 1.2 追加用户气泡 (包含附件预览并记录至持久化树)
    let userMsgHtml = prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (attachedFiles.length > 0) {
        userMsgHtml += `<div class="webmcp-attachments-bar" style="margin-top: 8px; border: none; padding-bottom: 0;">`;
        for (const f of attachedFiles) {
            userMsgHtml += `
                <div class="webmcp-attachment-chip" style="background: rgba(255,255,255,0.22); color: #ffffff; border-color: rgba(255,255,255,0.45);">
                    ${f.dataUrl ? `<img src="${f.dataUrl}" class="webmcp-attachment-thumb" />` : `<span>📄</span>`}
                    <span class="webmcp-attachment-name">${escapeHtml(f.name)}</span>
                </div>
            `;
        }
        userMsgHtml += `</div>`;
    }
    appendMessage(stream, 'user', userMsgHtml, {
        rawText: prompt,
        attachments: attachedFiles.map(f => ({ name: f.name, size: f.size, type: f.type, dataUrl: f.dataUrl }))
    });

    // 2. 优先使用已配置的大模型 Agent 执行多模态与 Tool Calling
    if (isLlmConfigured()) {
        await handleLlmAgentFlow(prompt, attachedFiles, stream, container, state);
        return;
    }

    // 3. 启发式意图路由判断（未配置 LLM 时的本地兜底）：区分【发票/费用批量填报】与【出差申请单规划】
    setGeneratingState(true, container);
    try {
        const isExpenseIntent = /发票|费用|报销|填报|出租车|机票|住宿|话费|外驻/.test(prompt);
        if (isExpenseIntent) {
            await handleExpenseBatchPlanningFlow(stream, container, state, prompt, attachedFiles);
            return;
        }

        // 4. 否则运行 5 维启发式全流程差旅融合引擎 (5D Heuristic Engine)
        await handleHeuristic5DFlow(prompt, attachedFiles, stream, container, state);
    } finally {
        setGeneratingState(false, container);
    }
}

/**
 * 大模型驱动的多模态 + WebMCP 工具调用流水线
 */
async function handleLlmAgentFlow(
    prompt: string,
    attachments: MessageAttachment[],
    stream: HTMLElement,
    container: HTMLElement,
    state: GlobalState
) {
    const cfg = getLlmConfig();
    recordTrajectoryEvent({
        source: 'SUBAGENT',
        title: `Dispatch: LLM Autonomous Agent (${cfg.model})`,
        summary: `发起大模型自主 Agent 流程，包含多模态分析与 W3C WebMCP 工具调用`,
        data: {
            model: cfg.model,
            provider: cfg.provider,
            prompt,
            attachmentCount: attachments.length
        }
    });

    const consolidatedPocket = createConsolidatedToolPocket(stream);
    const activeToolFinishers: Map<string, (durationMs: number, resultStr?: string) => void> = new Map();

    activeAbortController = new AbortController();
    setGeneratingState(true, container);

    const statusCard = createAgenticStatusCard(stream, cfg.model);

    let plannedConfigs: TripApplicationConfig[] | null = null;
    let plannedExpenseResult: any = null;
    let streamingHandle: StreamingMarkdownHandle | null = null;
    let assistantBubble: HTMLElement | null = null;
    let toolCallCount = 0;

    try {
        const finalContent = await callLlmAgent({
            prompt,
            attachments,
            signal: activeAbortController.signal,
            onToolCallStart: (toolName, params) => {
                toolCallCount++;
                statusCard.updateStatus(`⚡ 正在调度工具: <strong>${escapeHtml(toolName)}</strong>...`, '⚡');
                const finishFn = consolidatedPocket.addToolStart(toolName, JSON.stringify(params).slice(0, 60));
                activeToolFinishers.set(toolName, finishFn);
            },
            onToolCallEnd: (toolName, durationMs, result) => {
                statusCard.updateStatus(`🧠 正在深度思考与规划下一步...`, '🧠');
                const finishFn = activeToolFinishers.get(toolName);
                if (finishFn) {
                    finishFn(durationMs, typeof result === 'object' ? JSON.stringify(result).slice(0, 60) : String(result));
                    activeToolFinishers.delete(toolName);
                }
                // 重要规约：仅缓存配置，绝不在流中过早渲染审批门禁，等待 Agent 轮次圆满结束
                if (toolName === 'fssc_plan_trip_applications' && result?.configs) {
                    plannedConfigs = result.configs;
                }
                if (toolName === 'fssc_plan_expense_batch_update' && result) {
                    plannedExpenseResult = result;
                }
            },
            onStreamStart: () => {
                statusCard.updateStatus(`✍️ 正在流式生成与渲染回复...`, '✍️');
            },
            onStreamDelta: (_delta, accumulated) => {
                if (!streamingHandle) {
                    statusCard.updateStatus(`✍️ 正在流式生成与渲染回复...`, '✍️');
                    assistantBubble = document.createElement('div');
                    assistantBubble.className = 'webmcp-msg assistant';
                    const bubbleInner = document.createElement('div');
                    bubbleInner.className = 'webmcp-msg-bubble markstream-bubble';
                    assistantBubble.appendChild(bubbleInner);
                    stream.appendChild(assistantBubble);
                    streamingHandle = mountStreamingMarkdown(bubbleInner, accumulated, false);
                } else {
                    streamingHandle.update(accumulated, false);
                }
                stream.scrollTop = stream.scrollHeight;
            },
            onStreamEnd: (finalText) => {
                if (streamingHandle) {
                    streamingHandle.update(finalText, true);
                }
            }
        });

        consolidatedPocket.finish();
        const { durationMs, badgeHtml } = statusCard.finish({ toolCount: toolCallCount });

        if (streamingHandle) {
            streamingHandle.update(finalContent, true);
            const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            currentUiMessages.push({
                id: msgId,
                role: 'assistant',
                htmlContent: finalContent,
                rawText: finalContent,
                timestamp: Date.now()
            });
            if (assistantBubble) {
                assistantBubble.setAttribute('data-msg-id', msgId);
                assistantBubble.setAttribute('data-role', 'assistant');
                const badgeDiv = document.createElement('div');
                badgeDiv.innerHTML = badgeHtml;
                const badgeNode = badgeDiv.firstElementChild;
                if (badgeNode) assistantBubble.appendChild(badgeNode);
                renderMessageActions(assistantBubble, 'assistant', finalContent, stream, container, state, msgId);
            }
            debounceSaveCurrentSession();
        } else {
            const msgEl = appendMessage(stream, 'assistant', finalContent, {
                isMarkdown: true,
                rawText: finalContent
            });
            const badgeDiv = document.createElement('div');
            badgeDiv.innerHTML = badgeHtml;
            const badgeNode = badgeDiv.firstElementChild;
            if (badgeNode) msgEl.appendChild(badgeNode);
        }

        // 呈现 Generative UI / A2UI 决策卡片
        if (plannedExpenseResult || state.expensePlan) {
            attachPayloadToLastMessage('expense_batch', plannedExpenseResult || state.expensePlan);
            const a2uiWrapper = document.createElement('div');
            a2uiWrapper.className = 'webmcp-a2ui-wrapper';
            stream.appendChild(a2uiWrapper);
            renderA2UiExpenseBatchWidget({
                container: a2uiWrapper,
                state,
                initialPlan: plannedExpenseResult || state.expensePlan
            });
        } else if (plannedConfigs && plannedConfigs.length > 0) {
            attachPayloadToLastMessage('trip_plan', plannedConfigs);
            renderGenerativeTripPlan(plannedConfigs, stream, container, state);
        } else {
            // LLM 自主生成了对话回复或引导说明，严禁用确定性代码/正则篡改或接管其决策
            appendSuggestions(stream, container, state);
        }
    } catch (err: any) {
        statusCard.destroy();
        consolidatedPocket.finish();

        if (err.name === 'AbortError' || activeAbortController?.signal.aborted) {
            AutopilotLogger.info('用户已终止生成流程');
            return;
        }

        recordTrajectoryEvent({
            source: 'ERROR',
            title: 'LLM Agent Communication Error',
            summary: `LLM 调用异常: ${err.message}`,
            data: { error: err.message }
        });

        // 渲染优雅降级卡片 (避免裸露 JSON 报错)
        const noticeDiv = document.createElement('div');
        noticeDiv.className = 'webmcp-notice-card';
        noticeDiv.innerHTML = `
            <span style="font-size: 16px;">⚠️</span>
            <div style="font-size: 12.5px; color: #9a3412; line-height: 1.5;">
                <strong>大模型调用异常或网络超时</strong><br>
                <span style="color: #c2410c; font-size: 11.5px;">（${escapeHtml(err.message || '网络通信超时')}）。您可检查设置或重试，也可点击下方快捷指令使用内置规则引擎进行操作。</span>
            </div>
        `;
        stream.appendChild(noticeDiv);
        stream.scrollTop = stream.scrollHeight;

        appendSuggestions(stream, container, state);
    } finally {
        setGeneratingState(false, container);
    }
}

/**
 * 智能费用批量规划与行程推断流 (Smart Expense Batch Planning Flow)
 */
async function handleExpenseBatchPlanningFlow(
    stream: HTMLElement,
    container: HTMLElement,
    state: GlobalState,
    prompt: string = '',
    attachments: MessageAttachment[] = []
) {
    const consolidatedPocket = createConsolidatedToolPocket(stream);

    // 1. 自动拉取发票池与未报销费用记录 (若内存中为空)
    const finishQuery = consolidatedPocket.addToolStart(
        'fssc_query_pending_expenses',
        '{}',
        '拉取待处理费用明细与发票数据'
    );
    const t0 = Date.now();
    try {
        if (!state.invoices || state.invoices.length === 0) {
            await loadAllInvoicesAndExpenses(state);
        }
        finishQuery(Date.now() - t0, `共获取 ${state.invoices?.length || 0} 笔待处理费用`);
    } catch (e: any) {
        finishQuery(Date.now() - t0, `拉取失败: ${e.message}`);
    }

    const invoices = state.invoices || [];
    if (invoices.length === 0) {
        consolidatedPocket.finish();
        appendMessage(
            stream,
            'assistant',
            `ℹ️ <strong>当前发票夹与未报销费用列表中暂无待处理记录</strong><br>
            您可在元年云系统中进入【发票夹】上传发票，或进入【未报销费用明细】创建费用记录后，再次呼叫副驾进行批量规划！`
        );
        appendSuggestions(stream, container, state);
        return;
    }

    // 2. 从 prompt 中动态提炼关键参数（遵循通用性，严禁写死任何企业私有名称或人员字典）
    let proxyName = '';
    const proxyMatch = prompt.match(/(?:外驻|代办|同事|代外驻|来自外驻|外派|驻场)[:：\s]*([^\s，,。]+)/);
    if (proxyMatch) {
        proxyName = proxyMatch[1].replace(/[:：]/g, '').trim();
    }

    let customerName = '';
    const custMatch = prompt.match(/(?:客户|拜访)[:：\s]*([^\s，,。]+)/);
    if (custMatch) {
        customerName = custMatch[1].replace(/[:：]/g, '').trim();
    }

    let hotelName = '';
    const hotelMatch = prompt.match(/(?:酒店|入住)[:：\s]*([^\s，,。]+)/);
    if (hotelMatch) {
        hotelName = hotelMatch[1].replace(/[:：]/g, '').trim();
    }

    let projectName = '';
    const prjMatch = prompt.match(/(?:项目)[:：\s]*([^\s，,。]+)/) ||
                     prompt.match(/([A-Z]\d{4}-\d{3})/i);
    if (prjMatch) {
        projectName = prjMatch[1].replace(/[:：]/g, '').trim();
    }

    const tripType = (/市内|日常|通勤/.test(prompt) && !/出差|机票|酒店/.test(prompt))
        ? 'LOCAL_COMMUTE'
        : (/出差|异地|机票|酒店/.test(prompt) ? 'BUSINESS_TRIP' : 'AUTO');

    const planOpts: ExpensePlanOptions = {
        tripType,
        companyName: 'IVISION',
        customerName,
        hotelName,
        stationOrAirport: '机场/高铁站',
        projectName,
        proxyPersonName: proxyName
    };

    // 3. 执行智能费用批量规划
    const finishPlan = consolidatedPocket.addToolStart(
        'fssc_plan_expense_batch_update',
        JSON.stringify(planOpts).slice(0, 60),
        '智能费用分类、往返行程推断与外驻说明生成'
    );
    const t1 = Date.now();
    try {
        const planRes = await callWebMcpTool('fssc_plan_expense_batch_update', planOpts);
        finishPlan(Date.now() - t1, `规划完成 ${planRes.modifiedCount} 笔`);
        consolidatedPocket.finish();

        const summaryHtml = `
            <strong>已为您完成 ${planRes.totalRecords} 笔费用记录的智能分类与行程推断：</strong><br>
            • <strong>处理模式</strong>: ${planRes.tripType === 'BUSINESS_TRIP' ? '✈️ 异地出差行程模式 (机场/高铁 ⇄ 酒店 ⇄ 客户)' : (planRes.tripType === 'LOCAL_COMMUTE' ? '🏢 市内日常通勤模式 (公司 ⇄ 客户)' : '⚡ 混合自适应模式')}<br>
            • <strong>已自动匹配规划</strong>: <span style="color: #10b981; font-weight: 700;">${planRes.modifiedCount} 笔</span> (含交通起止地、费用类型及费用说明)<br>
            ${proxyName ? `• <strong>外驻代报标注</strong>: <code>[外驻:${proxyName}]</code> 已自动前置规范化注入<br>` : ''}
            ${customerName ? `• <strong>拜访客户</strong>: ${customerName}<br>` : ''}
            • <strong>人在回路 (HITL) 门禁</strong>: 您可在下方直接核验、微调参数、点击【重新推断】或【🚀 一键批量保存】。
        `;
        appendMessage(stream, 'assistant', summaryHtml);
        attachPayloadToLastMessage('expense_batch', planRes);

        const a2uiWrapper = document.createElement('div');
        a2uiWrapper.className = 'webmcp-a2ui-wrapper';
        stream.appendChild(a2uiWrapper);
        renderA2UiExpenseBatchWidget({
            container: a2uiWrapper,
            state,
            initialPlan: planRes
        });
    } catch (err: any) {
        consolidatedPocket.finish();
        appendMessage(stream, 'assistant', `❌ 智能费用规划失败: ${err.message}`);
    }
}

/**
 * 内置 5 维启发式信息融合引擎 (5D Heuristic Engine)
 * 维度 1: 用户自然语言意图与日程图片/文档
 * 维度 2: 公司出差制度与标准限额
 * 维度 3: 维表主数据穿透 (同行同事/驻场代办关联解析)
 * 维度 4: 考勤与行程例外 (打卡/门禁/改签等特殊出差日程自适应)
 * 维度 5: 弹性预留测算 (市内交通 Buffer + 改签票价 Buffer)
 */
async function handleHeuristic5DFlow(
    prompt: string,
    attachments: MessageAttachment[],
    stream: HTMLElement,
    container: HTMLElement,
    state: GlobalState
) {
    recordTrajectoryEvent({
        source: 'SUBAGENT',
        title: 'Dispatch: 5D Heuristic Information Fusion Engine',
        summary: '调用内置 5 维启发式规则引擎执行差旅要素解析与差标测算',
        data: { prompt, attachmentCount: attachments.length }
    });
    const p = prompt.toLowerCase();

    if (p.includes('规程') || p.includes('限额') || p.includes('登录人') || p.includes('标准') || p.includes('差标')) {
        await handleContextQuery(stream);
        return;
    }

    if (p.includes('员工') || p.includes('同事') || p.includes('人员')) {
        const match = prompt.match(/(?:员工|同事|人员|检索|查询)[:：\s]*([^\s，,。]+)/);
        const name = match ? match[1].replace(/[:：]/g, '').trim() : '';
        if (name) {
            await handleEmployeeQuery(stream, name);
            return;
        }
    }

    if (p.includes('城市')) {
        const match = prompt.match(/(?:城市|代码|检索|查询)[:：\s]*([^\s，,。]+)/);
        const city = match ? match[1].replace(/[:：]/g, '').trim() : '';
        if (city) {
            await handleCityQuery(stream, city);
            return;
        }
    }

    if (p.includes('项目')) {
        const match = prompt.match(/(?:项目|编号|检索|查询)[:：\s]*([^\s，,。]+)/);
        const project = match ? match[1].replace(/[:：]/g, '').trim() : '';
        if (project) {
            await handleProjectQuery(stream, project);
            return;
        }
    }

    // 通用出差综合规划流程
    await handle5DTripPlanningFlow(stream, container, state, prompt, attachments);
}

function appendMessage(
    stream: HTMLElement,
    role: 'user' | 'assistant' | 'system' | 'notice',
    htmlContent: string,
    options?: {
        recordUi?: boolean;
        rawText?: string;
        attachments?: any[];
        payloadType?: 'expense_batch' | 'trip_plan' | 'notice';
        payloadData?: any;
        isMarkdown?: boolean;
        msgId?: string;
    }
): HTMLElement {
    const msg = document.createElement('div');
    msg.className = `webmcp-msg ${role}`;
    const msgId = options?.msgId || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    msg.setAttribute('data-msg-id', msgId);
    msg.setAttribute('data-role', role);

    const bubble = document.createElement('div');
    bubble.className = 'webmcp-msg-bubble';

    if (options?.isMarkdown && (options.rawText || htmlContent)) {
        bubble.classList.add('markstream-bubble');
        renderStaticMarkdown(bubble, options.rawText || htmlContent);
    } else {
        bubble.innerHTML = htmlContent;
    }
    msg.appendChild(bubble);

    const textForActions = options?.rawText || htmlContent;
    renderMessageActions(msg, role, textForActions, stream, null, null, msgId);

    stream.appendChild(msg);
    stream.scrollTop = stream.scrollHeight;

    if (options?.recordUi !== false) {
        currentUiMessages.push({
            id: msgId,
            role,
            htmlContent,
            timestamp: Date.now(),
            rawText: options?.rawText,
            attachments: options?.attachments,
            payloadType: options?.payloadType,
            payloadData: options?.payloadData
        });
        debounceSaveCurrentSession();
    }

    return msg;
}

/**
 * CRM Agent Pop 风格: 折叠式 Tool Pocket (单个工具)
 */
function appendToolPocket(
    stream: HTMLElement,
    toolName: string,
    paramsStr: string
): { pocket: HTMLElement; markDone: (durationMs: number, resultStr?: string) => void } {
    const pocket = document.createElement('div');
    pocket.className = 'webmcp-tool-pocket';
    pocket.style.cssText = 'margin: 6px 0; border: 1px solid #e0e7ff; border-radius: 10px; background: #f8faff; overflow: hidden; width: 100%; box-sizing: border-box;';
    pocket.innerHTML = `
        <div class="webmcp-pocket-header" style="padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 12px; font-weight: 600; color: #4338ca; min-height: 30px; line-height: 1.4; user-select: none; box-sizing: border-box;">
            <div class="webmcp-pocket-title" style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 13px;">⚡</span>
                <span class="webmcp-pocket-text" style="color: #4338ca; font-size: 12px;">正在调用工具: <strong>${toolName}</strong>...</span>
            </div>
            <span class="webmcp-pocket-chevron" style="font-size: 11px; color: #6366f1; transition: transform 0.2s ease;">▼</span>
        </div>
        <div class="webmcp-pocket-body" style="display: none; padding: 8px 12px; border-top: 1px solid #e0e7ff; background: #ffffff; flex-direction: column; gap: 6px; font-size: 11.5px; box-sizing: border-box;">
            <div class="webmcp-pocket-item" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 0; color: #334155; border-bottom: 1px dashed #f1f5f9;">
                <span>参数 (Input):</span>
                <span><code>${paramsStr}</code></span>
            </div>
            <div class="webmcp-pocket-item webmcp-pocket-status" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 0; color: #334155;">
                <span>状态:</span>
                <span style="color:#f59e0b;">⏳ 执行中</span>
            </div>
        </div>
    `;

    const header = pocket.querySelector('.webmcp-pocket-header');
    const body = pocket.querySelector('.webmcp-pocket-body') as HTMLElement;
    const chevron = pocket.querySelector('.webmcp-pocket-chevron') as HTMLElement;

    header?.addEventListener('click', () => {
        if (body.style.display === 'none' || !body.style.display) {
            body.style.display = 'flex';
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        } else {
            body.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        }
    });

    stream.appendChild(pocket);
    stream.scrollTop = stream.scrollHeight;

    return {
        pocket,
        markDone: (durationMs: number, resultStr: string = 'Success') => {
            const text = pocket.querySelector('.webmcp-pocket-text');
            const status = pocket.querySelector('.webmcp-pocket-status');
            if (text) {
                text.innerHTML = `1 tool used (<strong>${toolName}</strong> · ${durationMs}ms)`;
            }
            if (status) {
                status.innerHTML = `
                    <span>状态:</span>
                    <span style="color:#10b981; font-weight: 600;">✓ 已完成 (${durationMs}ms)</span>
                `;
            }
        }
    };
}

interface ConsolidatedPocket {
    pocket: HTMLElement;
    addToolStart: (toolName: string, paramsStr: string, description?: string) => (durationMs: number, resultStr?: string) => void;
    finish: () => void;
    destroy: () => void;
}

/**
 * CRM Agent Pop 风格: 聚合型 Tool Pocket (Consolidated Tool Pocket)
 * 将多次连续工具调用收敛为一个可折叠的工具箱，杜绝多个扁平薄线
 */
function createConsolidatedToolPocket(stream: HTMLElement): ConsolidatedPocket {
    const pocket = document.createElement('div');
    pocket.className = 'webmcp-tool-pocket';
    pocket.style.cssText = 'margin: 6px 0; border: 1px solid #e0e7ff; border-radius: 10px; background: #f8faff; overflow: hidden; width: 100%; box-sizing: border-box;';

    pocket.innerHTML = `
        <div class="webmcp-pocket-header" style="padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 12px; font-weight: 600; color: #4338ca; min-height: 30px; line-height: 1.4; user-select: none; box-sizing: border-box;">
            <div class="webmcp-pocket-title" style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 13px;">⚡</span>
                <span class="webmcp-pocket-text" style="color: #4338ca; font-size: 12px;">正在准备调用工具...</span>
            </div>
            <span class="webmcp-pocket-chevron" style="font-size: 11px; color: #6366f1; transition: transform 0.2s ease;">▼</span>
        </div>
        <div class="webmcp-pocket-body" style="display: none; padding: 8px 12px; border-top: 1px solid #e0e7ff; background: #ffffff; flex-direction: column; gap: 6px; font-size: 11.5px; box-sizing: border-box;">
        </div>
    `;

    const header = pocket.querySelector('.webmcp-pocket-header');
    const body = pocket.querySelector('.webmcp-pocket-body') as HTMLElement;
    const chevron = pocket.querySelector('.webmcp-pocket-chevron') as HTMLElement;
    const pocketText = pocket.querySelector('.webmcp-pocket-text') as HTMLElement;

    header?.addEventListener('click', () => {
        if (body.style.display === 'none' || !body.style.display) {
            body.style.display = 'flex';
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        } else {
            body.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        }
    });

    stream.appendChild(pocket);
    stream.scrollTop = stream.scrollHeight;

    const toolRecords: { name: string; durationMs: number; desc: string }[] = [];

    return {
        pocket,
        addToolStart: (toolName: string, paramsStr: string, description?: string) => {
            if (pocketText) {
                pocketText.innerHTML = `正在调用工具: <strong>${toolName}</strong>...`;
            }

            const itemDiv = document.createElement('div');
            itemDiv.className = 'webmcp-pocket-item';
            itemDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 5px 0; color: #334155; border-bottom: 1px dashed #f1f5f9; font-size: 11.5px;';
            itemDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="color: #f59e0b;">⏳</span>
                    <strong style="font-family: monospace; color: #1e293b;">${toolName}</strong>
                    ${description ? `<span style="color: #64748b; font-size: 11px;">(${description})</span>` : ''}
                </div>
                <span style="color: #94a3b8; font-size: 10.5px;">执行中...</span>
            `;
            body.appendChild(itemDiv);

            return (durationMs: number, resultStr: string = 'Success') => {
                toolRecords.push({ name: toolName, durationMs, desc: description || '' });
                itemDiv.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="color: #10b981;">✓</span>
                        <strong style="font-family: monospace; color: #1e293b;">${toolName}</strong>
                        ${description ? `<span style="color: #64748b; font-size: 11px;">(${description})</span>` : ''}
                    </div>
                    <span style="color: #10b981; font-family: monospace; font-size: 11px; font-weight: 600;">✓ ${durationMs}ms</span>
                `;
            };
        },
        finish: () => {
            const count = toolRecords.length;
            if (count === 0) {
                pocket.remove();
                return;
            }
            const totalDuration = toolRecords.reduce((s, r) => s + r.durationMs, 0);
            const distinctNames = Array.from(new Set(toolRecords.map(r => r.name))).join(', ');
            if (pocketText) {
                pocketText.innerHTML = `<strong>${count} tools used</strong> <span style="font-weight: normal; color: #6366f1;">(${distinctNames} · ${totalDuration}ms)</span>`;
            }
        },
        destroy: () => {
            pocket.remove();
        }
    };
}

async function handleContextQuery(stream: HTMLElement) {
    const { markDone } = appendToolPocket(stream, 'fssc_get_applicant_context', '{}');
    const start = Date.now();
    try {
        const res = await callWebMcpTool('fssc_get_applicant_context');
        markDone(Date.now() - start);

        const html = `
            <strong>差旅上下文与制度标准已检索就绪：</strong><br>
            • <strong>当前填报人</strong>: ${res.currentUser.name} (${res.currentUser.department})<br>
            • <strong>单据类型</strong>: ${res.billDefine.billDefineName} (代码: ${res.billDefine.billTypeCode})<br>
            • <strong>住宿标准上限</strong>: 一线城市(北上广深) ¥${res.regulations.hotelAllowance.tier1Limit}/天，二线及其他 ¥${res.regulations.hotelAllowance.tier2Limit}/天<br>
            • <strong>误餐补助</strong>: 标准 ¥${res.regulations.mealAllowance.standardDaily}/天，往返乘车半天 ¥${res.regulations.mealAllowance.travelHalfDay}/天
        `;
        appendMessage(stream, 'assistant', html);
    } catch (err: any) {
        appendMessage(stream, 'assistant', `❌ 获取上下文失败: ${err.message}`);
    }
}

async function handleEmployeeQuery(stream: HTMLElement, name: string) {
    const { markDone } = appendToolPocket(stream, 'fssc_query_employee', `name="${name}"`);
    const start = Date.now();
    try {
        const res = await callWebMcpTool('fssc_query_employee', { name });
        markDone(Date.now() - start);

        const p = res.person;
        const html = `
            <strong>成功在元年云维表中检索到员工：</strong><br>
            • <strong>姓名</strong>: ${p.title || name}<br>
            • <strong>工号 / Code</strong>: <code>${p.code || '未知'}</code><br>
            • <strong>人员维表 ID</strong>: <code>${p.id || p.value}</code><br>
            可在代办出差申请时作为 <code>APPLICANT_ID</code> 自动关联触发所属部门与岗位。
        `;
        appendMessage(stream, 'assistant', html);
    } catch (err: any) {
        appendMessage(stream, 'assistant', `❌ 员工检索失败: ${err.message}`);
    }
}

async function handleCityQuery(stream: HTMLElement, cityName: string) {
    const { markDone } = appendToolPocket(stream, 'fssc_query_city', `cityName="${cityName}"`);
    const start = Date.now();
    try {
        const res = await callWebMcpTool('fssc_query_city', { cityName });
        markDone(Date.now() - start);

        const c = res.city;
        const html = `
            <strong>城市维表数据已定位：</strong><br>
            • <strong>城市</strong>: ${c.title || cityName}<br>
            • <strong>城市代码</strong>: <code>${c.code || '-'}</code><br>
            • <strong>城市维表 ID</strong>: <code>${c.id || c.value}</code><br>
            可直接回填出差日程明细 <code>F_TO</code> 字段。
        `;
        appendMessage(stream, 'assistant', html);
    } catch (err: any) {
        appendMessage(stream, 'assistant', `❌ 城市检索失败: ${err.message}`);
    }
}

async function handleProjectQuery(stream: HTMLElement, projectStr: string) {
    const { markDone } = appendToolPocket(stream, 'fssc_query_project', `projectNameOrCode="${projectStr}"`);
    const start = Date.now();
    try {
        const res = await callWebMcpTool('fssc_query_project', { projectNameOrCode: projectStr });
        markDone(Date.now() - start);

        if (res.success && res.project) {
            const prj = res.project;
            const html = `
                <strong>项目维表数据已定位：</strong><br>
                • <strong>项目名称/标题</strong>: ${prj.title?.zh_CN || prj.title || projectStr}<br>
                • <strong>项目维表 ID</strong>: <code>${prj.value || prj.id}</code><br>
                可在出差申请保存时作为 <code>DIM_PROJECT</code> 自动联动归属。
            `;
            appendMessage(stream, 'assistant', html);
        } else {
            appendMessage(stream, 'assistant', `⚠️ 未能在项目维表中精确匹配到 [${projectStr}]，请核对项目编号或在报销单中选择。`);
        }
    } catch (err: any) {
        appendMessage(stream, 'assistant', `❌ 项目检索失败: ${err.message}`);
    }
}

/**
 * 差旅规划与人在回路审批门禁 (通用动态规划引擎)
 */
async function handle5DTripPlanningFlow(
    stream: HTMLElement,
    container: HTMLElement,
    state: GlobalState,
    prompt: string = '',
    attachments: MessageAttachment[] = []
) {
    const consolidatedPocket = createConsolidatedToolPocket(stream);

    // 1. 穿透规程与上下文
    const finishContext = consolidatedPocket.addToolStart(
        'fssc_get_applicant_context',
        '{}',
        '获取当前登录用户与差旅制度'
    );
    const t0 = Date.now();
    await callWebMcpTool('fssc_get_applicant_context');
    finishContext(Date.now() - t0);

    // 2. 检查是否有上传的文件（CSV或文本表格）
    const textDoc = attachments.find(a => a.textContent);
    let planParams: any = {
        cityBufferPerDay: 100,
        trafficBufferPercent: 0.15
    };

    if (textDoc && textDoc.textContent) {
        planParams.itineraryText = textDoc.textContent;
    }

    // 3. 执行智能规划与算力测算
    const finishPlan = consolidatedPocket.addToolStart(
        'fssc_plan_trip_applications',
        JSON.stringify(planParams).slice(0, 60),
        '差旅要素通用测算与单据规划'
    );
    const t3 = Date.now();

    try {
        const planRes = await callWebMcpTool('fssc_plan_trip_applications', planParams);
        finishPlan(Date.now() - t3);
        consolidatedPocket.finish();

        let configs: TripApplicationConfig[] = planRes.configs || [];

        if (configs.length === 0) {
            appendMessage(
                stream,
                'assistant',
                `ℹ️ <strong>尚未检测到结构化行程信息</strong><br>
                您可直接在下方输入您的差旅计划（如：<em>“帮我规划 9/10~9/12 前往北京拜访客户，预估往返机票 1200 元”</em>），或直接<strong>拖拽/上传 CSV、Excel 日程表或行程截图</strong>，副驾将自动解析并测算！`
            );
            appendSuggestions(stream, container, state);
            return;
        }

        const totalBills = configs.length;
        const totalBudget = configs.reduce((s, c) => s + c.totalAmount, 0);
        const distinctPersons = Array.from(new Set(configs.map(c => c.applicantName))).join('、');
        const distinctDests = Array.from(new Set(configs.map(c => c.destination))).join('、');

        let attHint = '';
        if (attachments.length > 0) {
            attHint = `<br>• <strong>多模态附件感知</strong>: 已关联您上传的 ${attachments.length} 个行程附件（${attachments.map(a => a.name).join('、')}）。`;
        }

        const summaryHtml = `
            <strong>已为您完成差旅信息智能整合测算：</strong><br>
            • <strong>单据规划清单</strong>: <strong>${totalBills} 张出差申请草稿</strong> (总预算: ¥${totalBudget.toLocaleString()})<br>
            • <strong>出行人员</strong>: ${distinctPersons} (${configs.filter(c => c.isProxy).length} 单代办，${configs.filter(c => !c.isProxy).length} 单本人)<br>
            • <strong>出差目的地</strong>: ${distinctDests}<br>
            • <strong>弹性 Buffer 策略</strong>: 市内出租车/网约车预留 + 交通改签弹性缓冲 15% 已核准${attHint}
        `;
        appendMessage(stream, 'assistant', summaryHtml);
        attachPayloadToLastMessage('trip_plan', configs);

        // 渲染 Generative UI 卡片与审批门禁
        renderGenerativeTripPlan(configs, stream, container, state);

    } catch (err: any) {
        consolidatedPocket.finish();
        appendMessage(stream, 'assistant', `❌ 测算规划失败: ${err.message}`);
    }
}

/**
 * 呈现 HeroUI Pro Generative UI 卡片与审批门禁 (Approval Gate)
 */
function renderGenerativeTripPlan(
    configs: TripApplicationConfig[],
    stream: HTMLElement,
    container: HTMLElement,
    state: GlobalState
) {
    const totalBills = configs.length;
    const totalBudget = configs.reduce((s, c) => s + c.totalAmount, 0);
    const runId = Math.random().toString(36).substring(2, 8);

    // 默认初始展示卡片数量（前 3 张，其余折叠）
    const initialVisibleCount = Math.min(3, totalBills);
    const visibleConfigs = configs.slice(0, initialVisibleCount);
    const hiddenConfigs = configs.slice(initialVisibleCount);

    const renderCard = (c: TripApplicationConfig, idx: number) => {
        const cardId = `trip-card-${runId}-${idx}`;
        const detailId = `trip-detail-${runId}-${idx}`;
        const hasLegs = c.legs && c.legs.length > 0;
        const legCount = hasLegs ? c.legs!.length : 2;
        const hasTravelers = c.travelers && c.travelers.length > 1;

        return `
            <div class="webmcp-trip-card" id="${cardId}">
                <div class="webmcp-trip-header">
                    <div class="webmcp-trip-route">
                        <span>✈️ Trip ${c.tripNo || (idx + 1)}:</span>
                        <span>上海 ➔ ${c.destination}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="webmcp-trip-person-badge ${c.isProxy ? 'webmcp-person-proxy' : 'webmcp-person-self'}">
                            ${c.applicantName} ${c.isProxy ? '(代办)' : '(本人)'}
                        </span>
                        ${c.isCombined ? `<span class="webmcp-trip-person-badge" style="background:#dcfce7; color:#15803d;">正社员统提</span>` : ''}
                        <span class="webmcp-card-details-toggle" data-target="${detailId}">明细 ▼</span>
                    </div>
                </div>
                ${hasTravelers ? `<div style="font-size: 11px; color: #64748b; margin: 2px 0 4px 0;">含合报出差人员: <strong>${c.travelers!.join('、')}</strong></div>` : ''}
                ${c.matchedHistoryBill ? `
                    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 4px 8px; margin-bottom: 6px; font-size: 11.5px; color: #92400e; display: flex; align-items: center; justify-content: space-between;">
                        <span>⚠️ <strong>已存在历史单据</strong>: <strong>${c.matchedHistoryBill.billCode}</strong> (${c.matchedHistoryBill.statusName} · ${c.matchedHistoryBill.amount})</span>
                        <span style="font-size: 10.5px; color: #b45309;">${c.matchedHistoryBill.billDate}</span>
                    </div>
                ` : ''}
                <div class="webmcp-trip-chips">
                    <span class="webmcp-trip-chip">📅 ${c.startDate.slice(5)}~${c.endDate.slice(5)} (${c.days}天${c.nights}晚)</span>
                    ${c.hotelName ? `<span class="webmcp-trip-chip" style="background:#eff6ff; color:#1d4ed8; font-weight:500;">🏨 ${c.hotelName}</span>` : ''}
                    <span class="webmcp-trip-chip" title="${c.feeFormulas?.otherFormula || ''}">🚗 市内: ¥${c.otherFee}</span>
                    <span class="webmcp-trip-chip" title="${c.feeFormulas?.trafficFormula || ''}">🎫 交通+改签: ¥${c.trafficFee}</span>
                    <span class="webmcp-trip-chip" title="${c.feeFormulas?.hotelFormula || ''}">🏨 住宿: ¥${c.hotelFee}</span>
                    <span class="webmcp-trip-chip" title="${c.feeFormulas?.mealFormula || ''}">🍱 餐补: ¥${c.mealFee}</span>
                    <span class="webmcp-trip-chip webmcp-trip-budget-tag ${c.projectName ? 'webmcp-trip-project-badge' : 'webmcp-trip-dept-badge'}">
                        ${c.projectName ? `🚀 项目: ${c.projectName}` : `🏢 部门日常 (国内出張旅費)`}
                    </span>
                    <span class="webmcp-trip-chip amount">¥${c.totalAmount.toLocaleString()}</span>
                </div>
                <div class="webmcp-card-details-box" id="${detailId}" style="display: none;">
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; font-size: 11.5px; line-height: 1.6; color: #334155;">
                        <div style="font-weight: 700; color: #0f172a; margin-bottom: 3px; display: flex; justify-content: space-between;">
                            <span>📐 费用测算依据与明细公式:</span>
                            <span style="color: #059669; font-weight: 600;">合计: ¥${c.totalAmount.toLocaleString()}</span>
                        </div>
                        <div>• <strong>大交通</strong>: ${c.feeFormulas?.trafficFormula || `机票/高铁: ¥${c.trafficFee - c.trafficBuffer} + 改签弹性: ¥${c.trafficBuffer}`}</div>
                        <div>• <strong>住宿费</strong>: ${c.feeFormulas?.hotelFormula || `¥${c.hotelFee}`}</div>
                        <div>• <strong>误餐补贴</strong>: ${c.feeFormulas?.mealFormula || `¥${c.mealFee}`}</div>
                        <div>• <strong>市内交通</strong>: ${c.feeFormulas?.otherFormula || `¥${c.otherFee}`}</div>
                    </div>
                    ${c.hotelName ? `<div style="color: #0284c7; font-size: 11.5px; margin-top: 4px;">🏨 住宿酒店: <strong>${c.hotelName}</strong></div>` : ''}
                    ${c.targetFactories ? `<div style="color: #4338ca; font-size: 11.5px; margin-top: 2px;">🏭 调研工厂/据点: <strong>${c.targetFactories}</strong></div>` : ''}
                    <div style="color: #475569; font-weight: 600; margin-top: 4px;">往返行程明细 (${legCount}段):</div>
                    ${(c.legs || []).map(l => {
                        const trav = l.travelerName || c.applicantName;
                        const cleanT = trav.replace(/（.*）|\(.*\)/g, '').trim();
                        let flightDisplay = l.flightOrTrain || l.transport || '飞机/高铁';
                        if (!flightDisplay.includes(cleanT)) {
                            flightDisplay = `${flightDisplay} | (${trav})`;
                        }
                        return `
                            <div class="webmcp-card-leg-row">
                                <span>📅 ${l.date} ${l.fromCity} ➔ ${l.toCity}</span>
                                <span class="webmcp-card-leg-tag">${flightDisplay}</span>
                            </div>
                        `;
                    }).join('')}
                    ${c.purpose ? `<div style="color: #64748b; font-size: 11px; margin-top: 3px;">事由: ${c.purpose}</div>` : ''}
                </div>
            </div>
        `;
    };

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'webmcp-cards-wrapper';
    cardsContainer.innerHTML = `
        <div class="webmcp-visible-cards" style="display: flex; flex-direction: column; gap: 8px;">
            ${visibleConfigs.map((c, i) => renderCard(c, i)).join('')}
        </div>
        ${hiddenConfigs.length > 0 ? `
            <div class="webmcp-hidden-cards" id="webmcp-hidden-cards-${runId}" style="display: none; flex-direction: column; gap: 8px; margin-top: 8px;">
                ${hiddenConfigs.map((c, i) => renderCard(c, i + initialVisibleCount)).join('')}
            </div>
        ` : ''}
        <div class="webmcp-expand-bar">
            ${hiddenConfigs.length > 0 ? `
                <button class="webmcp-expand-toggle-btn" id="btn-toggle-expand-${runId}">
                    <span>▼ 展开其余 ${hiddenConfigs.length} 张单据明细 (共 ${totalBills} 张)</span>
                </button>
            ` : ''}
            <button class="webmcp-open-artifact-btn" id="btn-open-artifact-${runId}">
                <span>📑 打开出差规划全景透视 (Artifact)</span>
            </button>
        </div>
    `;
    stream.appendChild(cardsContainer);

    // 绑定单张卡片内明细展开/折叠
    cardsContainer.querySelectorAll('.webmcp-card-details-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const targetId = toggle.getAttribute('data-target');
            if (!targetId) return;
            const box = cardsContainer.querySelector(`#${targetId}`) as HTMLElement;
            if (box) {
                const isHidden = box.style.display === 'none';
                box.style.display = isHidden ? 'flex' : 'none';
                toggle.textContent = isHidden ? '收起 ▲' : '明细 ▼';
            }
        });
    });

    // 绑定展开/收起其余卡片
    const toggleCardsBtn = cardsContainer.querySelector(`#btn-toggle-expand-${runId}`) as HTMLButtonElement;
    const hiddenCardsBox = cardsContainer.querySelector(`#webmcp-hidden-cards-${runId}`) as HTMLElement;
    if (toggleCardsBtn && hiddenCardsBox) {
        toggleCardsBtn.addEventListener('click', () => {
            const isHidden = hiddenCardsBox.style.display === 'none';
            if (isHidden) {
                hiddenCardsBox.style.display = 'flex';
                toggleCardsBtn.innerHTML = `<span>▲ 收起部分卡片 (保留前 ${initialVisibleCount} 张)</span>`;
            } else {
                hiddenCardsBox.style.display = 'none';
                toggleCardsBtn.innerHTML = `<span>▼ 展开其余 ${hiddenConfigs.length} 张单据明细 (共 ${totalBills} 张)</span>`;
            }
        });
    }

    // 注入 A2UI 预算归属交互决策卡片 (Agent-to-User Interface)
    const a2uiWrapper = document.createElement('div');
    a2uiWrapper.className = 'webmcp-a2ui-wrapper';
    stream.appendChild(a2uiWrapper);

    renderA2UiProjectDecisionWidget({
        configs,
        container: a2uiWrapper,
        state,
        onDecisionChange: (res) => {
            // 动态同步卡片上的预算与项目标签
            cardsContainer.querySelectorAll('.webmcp-trip-budget-tag').forEach(tagEl => {
                if (res.isProject && res.projectName) {
                    tagEl.innerHTML = `🚀 项目: ${res.projectName}`;
                    tagEl.className = 'webmcp-trip-chip webmcp-trip-budget-tag webmcp-trip-project-badge';
                } else {
                    tagEl.innerHTML = `🏢 部门日常 (国内出張旅費)`;
                    tagEl.className = 'webmcp-trip-chip webmcp-trip-budget-tag webmcp-trip-dept-badge';
                }
            });

            // 动态同步审批门禁中的说明
            const gateDescEl = gateCard.querySelector('.webmcp-approval-budget-summary');
            if (gateDescEl) {
                gateDescEl.innerHTML = res.isProject && res.projectName
                    ? `• 预算与核算归属: <strong style="color: #7c3aed;">研发/实施项目 [${res.projectName}]</strong>`
                    : `• 预算与核算归属: <strong style="color: #4338ca;">部门日常出差 (国内出張旅費)</strong>`;
            }
        }
    });

    // 注入 HeroUI Pro 审批门禁卡片 (Human-in-the-Loop Approval Gate)
    const gateCard = document.createElement('div');
    gateCard.className = 'webmcp-approval-card';
    const initProject = configs.find(c => c.projectName)?.projectName;
    gateCard.innerHTML = `
        <div class="webmcp-approval-title">
            <span>🛡️</span>
            <span>WebMCP 审批门禁 (Human-in-the-Loop Approval Gate)</span>
        </div>
        <div class="webmcp-approval-body">
            副驾已基于 5 维要素装配完成 <strong>${totalBills} 张出差申请单</strong>。<br>
            即将调用底层 WebMCP 工具 <code>fssc_batch_create_trip_drafts</code> 向元年云写入数据库草稿。<br>
            <div class="webmcp-approval-amount">
                总预算预留: ¥${totalBudget.toLocaleString()}
                <span class="webmcp-card-details-toggle" id="gate-btn-artifact-${runId}" style="font-size: 12px; margin-left: 12px; text-decoration: underline;">📑 全景方案对比透视</span>
            </div>
            <div class="webmcp-approval-budget-summary" style="font-size: 12px; margin: 4px 0 6px 0;">
                • 预算与核算归属: <strong>${initProject ? `研发/实施项目 [${initProject}]` : '部门日常出差 (国内出張旅費)'}</strong>
            </div>
            <span style="font-size: 11px; color: #92400e;">⚠️ 单据将直接保存为「待办草稿」，不会直接发起审批流，您后续可在申请单视图中核对。</span>
        </div>
        <div class="webmcp-approval-actions">
            <button class="webmcp-btn-approve" id="gate-btn-approve-${runId}">✅ 批准并保存入库草稿 (Save Draft)</button>
            <button class="webmcp-btn-reject" id="gate-btn-reject-${runId}">❌ 取消执行 (Reject)</button>
        </div>
    `;
    stream.appendChild(gateCard);
    stream.scrollTop = stream.scrollHeight;

    // 绑定审批事件与 Artifact 联动
    const approveBtn = gateCard.querySelector(`#gate-btn-approve-${runId}`) as HTMLButtonElement;
    const rejectBtn = gateCard.querySelector(`#gate-btn-reject-${runId}`) as HTMLButtonElement;
    const gateArtifactBtn = gateCard.querySelector(`#gate-btn-artifact-${runId}`) as HTMLElement;
    const openArtifactBtn = cardsContainer.querySelector(`#btn-open-artifact-${runId}`) as HTMLButtonElement;

    // 统一执行入库
    const executeBatchApproval = async () => {
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        approveBtn.textContent = '⏳ 正在入库执行中...';

        const { markDone: markBatchDone } = appendToolPocket(
            stream,
            'fssc_batch_create_trip_drafts',
            `count=${configs.length}`
        );
        const execStart = Date.now();

        try {
            const batchRes = await callWebMcpTool('fssc_batch_create_trip_drafts', {
                tripConfigs: configs
            });

            markBatchDone(Date.now() - execStart);

            if (batchRes.failCount === 0) {
                // 全部成功
                gateCard.innerHTML = `
                    <div style="color: #15803d; font-weight: 700; font-size: 13.5px;">
                        ✓ 用户已批准，全量 ${batchRes.successCount} 张单据已成功入库保存！
                    </div>
                `;

                const finishHtml = `
                    🎉 <strong>恭喜！批量创建草稿圆满完成！</strong><br>
                    • <strong>成功创建</strong>: <span style="color: #10b981; font-weight: 700;">${batchRes.successCount} 张单据</span><br>
                    • <strong>失败单据</strong>: 0 张<br>
                    • <strong>已生成单号样例</strong>: ${batchRes.createdBills.slice(0, 3).map((b: any) => `<code>${b.billCode}</code> (${b.applicant})`).join('、')}<br><br>
                    所有草稿已完整保存在元年云系统中，您可在【我的申请单】列表刷新直接查阅！
                `;
                appendMessage(stream, 'assistant', finishHtml);
                showToast('success', `🎉 WebMCP 智能副驾已成功创建 ${batchRes.successCount} 张出差申请草稿！`);
            } else if (batchRes.successCount === 0) {
                // 全部失败
                gateCard.innerHTML = `
                    <div style="color: #dc2626; font-weight: 700; font-size: 13.5px;">
                        ❌ 入库执行异常，未能成功创建出差申请草稿 (0/${batchRes.failCount} 成功)。
                    </div>
                `;
                const errListHtml = (batchRes.errors || []).map((e: any) =>
                    `• <strong>Trip ${e.tripNo || '?'}[${e.destination || ''}] (${e.applicant || ''})</strong>: <span style="color: #dc2626;">${e.error}</span>`
                ).join('<br>');

                const finishHtml = `
                    ⚠️ <strong>批量入库执行遇到异常 (失败 ${batchRes.failCount} 张)：</strong><br>
                    ${errListHtml || '• 系统接口返回异常，未能成功生成单据草稿。'}<br><br>
                    <span style="color: #64748b; font-size: 11.5px;">建议检查单据填报人/代办人员或网络连接，您亦可在【批量出差驾驶舱】中逐单调整后重试。</span>
                `;
                appendMessage(stream, 'assistant', finishHtml);
                showToast('error', `批量入库失败: 全量 ${batchRes.failCount} 张未能保存`);
            } else {
                // 部分成功
                gateCard.innerHTML = `
                    <div style="color: #d97706; font-weight: 700; font-size: 13.5px;">
                        ⚠️ 批量入库部分完成：${batchRes.successCount} 张成功，${batchRes.failCount} 张失败。
                    </div>
                `;
                const errListHtml = (batchRes.errors || []).map((e: any) =>
                    `• <strong>Trip ${e.tripNo || '?'}[${e.destination || ''}]</strong>: <span style="color: #dc2626;">${e.error}</span>`
                ).join('<br>');

                const finishHtml = `
                    ⚠️ <strong>批量入库部分完成：</strong><br>
                    • <strong>成功创建</strong>: <span style="color: #10b981; font-weight: 700;">${batchRes.successCount} 张单据</span> (${batchRes.createdBills.map((b: any) => `<code>${b.billCode}</code>`).join('、')})<br>
                    • <strong>失败单据</strong>: <span style="color: #dc2626; font-weight: 700;">${batchRes.failCount} 张</span><br>
                    ${errListHtml}
                `;
                appendMessage(stream, 'assistant', finishHtml);
                showToast('warning', `部分单据创建成功 (${batchRes.successCount}/${configs.length})`);
            }

            appendSuggestions(stream, container, state);
        } catch (execErr: any) {
            gateCard.innerHTML = `
                <div style="color: #dc2626; font-weight: 700; font-size: 13.5px;">
                    ❌ 入库执行发生致命异常: ${execErr.message}
                </div>
            `;
            appendMessage(stream, 'assistant', `❌ 批量入库保存时出错: ${execErr.message}`);
            showToast('error', `入库执行失败: ${execErr.message}`);
        }
    };

    approveBtn?.addEventListener('click', executeBatchApproval);

    // 绑定 Artifact 弹窗
    const handleOpenArtifact = () => {
        openTripPlanArtifact(configs, executeBatchApproval);
    };
    openArtifactBtn?.addEventListener('click', handleOpenArtifact);
    gateArtifactBtn?.addEventListener('click', handleOpenArtifact);

    rejectBtn?.addEventListener('click', () => {
        gateCard.innerHTML = `
            <div style="color: #64748b; font-size: 12px;">
                ✕ 用户已取消本次入库操作，未向元年云系统提交任何修改。
            </div>
        `;
        appendMessage(stream, 'assistant', '已取消入库。您可以随时调整 Buffer 或重新规划。');
        appendSuggestions(stream, container, state);
    });
}

/**
 * CRM Agent Pop 风格: Conversation Suggestions (对话建议芯片)
 */
function appendSuggestions(stream: HTMLElement, container: HTMLElement, state: GlobalState) {
    const existing = stream.querySelector('.webmcp-suggestions-box');
    if (existing) existing.remove();

    const totalCount = state.tripApp?.configs.length || 0;
    const box = document.createElement('div');
    box.className = 'webmcp-suggestions-box';
    box.innerHTML = `
        <div class="webmcp-suggestions-title">💡 建议下一步操作 (Suggestions):</div>
        <div class="webmcp-suggestions-list">
            <div class="webmcp-suggestion-row" data-prompt="智能分析发票夹与费用记录，批量推断往返行程与外驻代报说明">
                <span>⚡ 智能批量规划发票与费用记录 (${(state.invoices?.length || 0) > 0 ? `当前 ${state.invoices?.length} 笔` : '自动拉取与推断'})</span>
            </div>
            <div class="webmcp-suggestion-row" data-action="open-cockpit">
                <span>✈️ 打开出差申请批量驾驶舱 (${totalCount > 0 ? `查看已规划的 ${totalCount} 张单据与调节Buffer` : '导入与批量管理'})</span>
            </div>
            <div class="webmcp-suggestion-row" data-prompt="导入行程表或直接输入出差日程计划进行智能规划">
                <span>📋 输入或上传更多出差行程计划</span>
            </div>
            <div class="webmcp-suggestion-row" data-prompt="获取当前登录人信息以及出差报销规程限额标准">
                <span>📜 查看公司差旅报销限额标准 (北上广深 vs 二线城市)</span>
            </div>
        </div>
    `;

    box.querySelectorAll('.webmcp-suggestion-row').forEach(row => {
        row.addEventListener('click', () => {
            const action = row.getAttribute('data-action');
            const prompt = row.getAttribute('data-prompt');
            if (action === 'open-cockpit') {
                openApplicationModal(state);
            } else if (prompt) {
                handleUserPrompt(prompt, container, state);
            }
        });
    });

    stream.appendChild(box);
    stream.scrollTop = stream.scrollHeight;
}

// 辅助工具：文件读取与大小格式化
function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
    });
}

function readFileAsText(file: File): Promise<string> {
    return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsText(file);
    });
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
