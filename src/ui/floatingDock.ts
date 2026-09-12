import { AutopilotLogger } from '../utils/logger';

const DOCK_ID = 'autopilot-floating-dock';
const STORAGE_POS_KEY = 'autopilot_dock_pos';
const STORAGE_MIN_KEY = 'autopilot_dock_minimized';

export function injectDockStyles() {
    const styleId = 'autopilot-dock-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* 全局悬浮副驾坞容器 (Unified Floating Dock) */
        .autopilot-floating-dock {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 99999;
            display: flex;
            flex-direction: column-reverse;
            align-items: flex-end;
            gap: 10px;
            user-select: none;
            transition: opacity 0.25s ease;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
            pointer-events: auto;
        }

        /* 顶部/底部拖拽控制小把手 */
        .autopilot-dock-handle-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 20px;
            padding: 3px 10px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            cursor: grab;
            transition: all 0.2s ease;
            color: #94a3b8;
            font-size: 11px;
            margin-bottom: 2px;
        }
        .autopilot-dock-handle-bar:hover {
            background: rgba(15, 23, 42, 0.95);
            color: #f8fafc;
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
            border-color: rgba(56, 189, 248, 0.4);
        }
        .autopilot-dock-handle-bar:active {
            cursor: grabbing;
        }
        .autopilot-dock-drag-grip {
            font-size: 13px;
            letter-spacing: -1px;
            color: #64748b;
        }
        .autopilot-dock-title {
            font-size: 11px;
            font-weight: 600;
            color: #e2e8f0;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .autopilot-dock-btn-min {
            background: rgba(255, 255, 255, 0.12);
            border: none;
            color: #94a3b8;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s ease;
            padding: 0;
            line-height: 1;
        }
        .autopilot-dock-btn-min:hover {
            background: #ef4444;
            color: #ffffff;
        }

        /* 弹性流式按钮栈 (Zero Overlap Flex Stack) */
        .autopilot-dock-stack {
            display: flex;
            flex-direction: column-reverse;
            align-items: flex-end;
            gap: 10px;
            transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
        }

        /* 折叠迷你状态胶囊 */
        .autopilot-dock-collapsed-pill {
            display: none;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #ffffff;
            padding: 8px 14px;
            border-radius: 30px;
            font-size: 12px;
            font-weight: 600;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.4);
            border: 1px solid rgba(56, 189, 248, 0.4);
            cursor: pointer;
            align-items: center;
            gap: 8px;
            backdrop-filter: blur(8px);
            transition: all 0.25s ease;
        }
        .autopilot-dock-collapsed-pill:hover {
            transform: translateY(-2px) scale(1.03);
            box-shadow: 0 10px 28px rgba(56, 189, 248, 0.35);
            border-color: #38bdf8;
        }

        /* 处于折叠状态时的显示切换 */
        .autopilot-floating-dock.is-minimized .autopilot-dock-stack,
        .autopilot-floating-dock.is-minimized .autopilot-dock-handle-bar {
            display: none !important;
        }
        .autopilot-floating-dock.is-minimized .autopilot-dock-collapsed-pill {
            display: flex !important;
        }

        /* 覆盖子按钮原有的 fixed 定位，统一转为 Dock 内相对弹性排列，物理级消灭重叠 */
        .autopilot-floating-dock #yn-batch-helper-btn,
        .autopilot-floating-dock .trip-app-launcher-btn,
        .autopilot-floating-dock .webmcp-copilot-pill {
            position: relative !important;
            bottom: auto !important;
            right: auto !important;
            top: auto !important;
            left: auto !important;
            margin: 0 !important;
            box-sizing: border-box !important;
            flex-shrink: 0 !important;
        }
    `;
    document.head.appendChild(style);
}

/**
 * 获取或创建全局单例悬浮副驾坞 (Unified Floating Dock)
 */
export function getOrCreateFloatingDock(): HTMLElement {
    injectDockStyles();

    let dock = document.getElementById(DOCK_ID);
    if (!dock) {
        dock = document.createElement('div');
        dock.id = DOCK_ID;
        dock.className = 'autopilot-floating-dock';

        dock.innerHTML = `
            <!-- 弹性按钮垂直栈 (自底向上生长) -->
            <div class="autopilot-dock-stack" id="autopilot-dock-stack"></div>

            <!-- 控制把手与拖拽条 -->
            <div class="autopilot-dock-handle-bar" id="autopilot-dock-handle" title="按住拖拽移动位置，点击右侧按钮折叠">
                <span class="autopilot-dock-drag-grip">⋮⋮</span>
                <span class="autopilot-dock-title">
                    <span>⚡</span>
                    <span>IVision 副驾</span>
                </span>
                <button class="autopilot-dock-btn-min" id="autopilot-dock-min-btn" title="收起为迷你胶囊">−</button>
            </div>

            <!-- 折叠后展示的迷你胶囊 -->
            <div class="autopilot-dock-collapsed-pill" id="autopilot-dock-collapsed-pill" title="点击展开自动驾驶副驾">
                <span>⚡</span>
                <span>IVision 副驾</span>
                <span id="autopilot-dock-badge" style="background: #38bdf8; color: #0f172a; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 700;">3</span>
            </div>
        `;

        document.body.appendChild(dock);

        // 恢复持久化记忆位置与折叠状态
        restoreDockState(dock);

        // 绑定拖拽与折叠交互
        setupDockInteractions(dock);
    }

    // 确保 dock 一定附着在 body 上（防止 Vue SPA 页面切换时重绘清空）
    if (!document.body.contains(dock)) {
        document.body.appendChild(dock);
    }

    return dock;
}

/**
 * 将指定按钮安全挂载至统一副驾坞中
 * 如果已存在则更新，如果不存在则调用创建函数并推入弹性栈
 */
export function mountToDock(btnId: string, createFn: () => HTMLElement): HTMLElement {
    const dock = getOrCreateFloatingDock();
    const stack = dock.querySelector('#autopilot-dock-stack');
    if (!stack) return createFn();

    let btn = document.getElementById(btnId);
    if (!btn) {
        btn = createFn();
    }

    // 确保按钮归集在 stack 中
    if (btn && btn.parentElement !== stack) {
        stack.appendChild(btn);
    }

    updateDockBadge(dock);
    return btn;
}

/**
 * 更新折叠徽标数量
 */
export function updateDockBadge(dock?: HTMLElement) {
    const d = dock || document.getElementById(DOCK_ID);
    if (!d) return;
    const stack = d.querySelector('#autopilot-dock-stack');
    const badge = d.querySelector('#autopilot-dock-badge');
    if (stack && badge) {
        const visibleCount = Array.from(stack.children).filter(c => {
            const el = c as HTMLElement;
            return el.style.display !== 'none';
        }).length;
        badge.textContent = String(visibleCount);
        if (visibleCount === 0) {
            d.style.display = 'none';
        } else {
            d.style.display = 'flex';
        }
    }
}

/**
 * 设置拖拽交互与吸附逻辑
 */
function setupDockInteractions(dock: HTMLElement) {
    const handle = dock.querySelector('#autopilot-dock-handle') as HTMLElement;
    const minBtn = dock.querySelector('#autopilot-dock-min-btn') as HTMLElement;
    const collapsedPill = dock.querySelector('#autopilot-dock-collapsed-pill') as HTMLElement;

    // 折叠与展开
    minBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        dock.classList.add('is-minimized');
        localStorage.setItem(STORAGE_MIN_KEY, 'true');
        AutopilotLogger.info('[Dock] 用户折叠了悬浮副驾坞');
    });

    collapsedPill?.addEventListener('click', (e) => {
        e.stopPropagation();
        dock.classList.remove('is-minimized');
        localStorage.setItem(STORAGE_MIN_KEY, 'false');
        AutopilotLogger.info('[Dock] 用户展开了悬浮副驾坞');
    });

    // 自由拖拽
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialRight = 24;
    let initialBottom = 24;

    const onMouseDown = (e: MouseEvent) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = dock.getBoundingClientRect();
        initialRight = window.innerWidth - rect.right;
        initialBottom = window.innerHeight - rect.bottom;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const deltaX = startX - e.clientX; // 向左拖，right 变大
        const deltaY = startY - e.clientY; // 向上拖，bottom 变大

        let newRight = initialRight + deltaX;
        let newBottom = initialBottom + deltaY;

        // 视口边界防御
        const minMargin = 10;
        const maxRight = window.innerWidth - dock.offsetWidth - minMargin;
        const maxBottom = window.innerHeight - dock.offsetHeight - minMargin;

        newRight = Math.max(minMargin, Math.min(maxRight, newRight));
        newBottom = Math.max(minMargin, Math.min(maxBottom, newBottom));

        dock.style.right = `${newRight}px`;
        dock.style.bottom = `${newBottom}px`;
        dock.style.left = 'auto';
        dock.style.top = 'auto';
    };

    const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // 记忆保存
        const pos = {
            right: parseInt(dock.style.right, 10) || 24,
            bottom: parseInt(dock.style.bottom, 10) || 24
        };
        localStorage.setItem(STORAGE_POS_KEY, JSON.stringify(pos));
    };

    handle?.addEventListener('mousedown', onMouseDown);
    collapsedPill?.addEventListener('mousedown', (e) => {
        // 允许拖动收缩胶囊，但若只是轻击则展开
        let moved = false;
        const moveCheck = () => { moved = true; };
        window.addEventListener('mousemove', moveCheck, { once: true });
        onMouseDown(e);
        window.addEventListener('mouseup', () => {
            window.removeEventListener('mousemove', moveCheck);
            if (!moved) {
                dock.classList.remove('is-minimized');
                localStorage.setItem(STORAGE_MIN_KEY, 'false');
            }
        }, { once: true });
    });
}

function restoreDockState(dock: HTMLElement) {
    try {
        const savedMin = localStorage.getItem(STORAGE_MIN_KEY);
        if (savedMin === 'true') {
            dock.classList.add('is-minimized');
        }

        const savedPos = localStorage.getItem(STORAGE_POS_KEY);
        if (savedPos) {
            const pos = JSON.parse(savedPos);
            if (typeof pos.right === 'number' && typeof pos.bottom === 'number') {
                const maxRight = window.innerWidth - 100;
                const maxBottom = window.innerHeight - 80;
                const safeRight = Math.max(10, Math.min(maxRight, pos.right));
                const safeBottom = Math.max(10, Math.min(maxBottom, pos.bottom));
                dock.style.right = `${safeRight}px`;
                dock.style.bottom = `${safeBottom}px`;
            }
        }
    } catch { }
}
