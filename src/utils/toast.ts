/**
 * 现代浮动 Toast 消息通知组件 (替代阻塞式 alert 弹窗)
 */

type ToastType = 'info' | 'success' | 'warning' | 'error';

export function showToast(type: ToastType, message: string, duration = 3500) {
    // 1. 先尝试利用宿主 Vue Element-UI $message (如果存在)
    try {
        const appVue = (document.querySelector('#app') as any)?.__vue__;
        if (appVue && typeof appVue.$message === 'function') {
            appVue.$message({
                type: type,
                message: message,
                duration: duration,
                showClose: true
            });
            return;
        }
    } catch (e) {}

    // 2. 独立高优先级 Floating Toast 容器
    let container = document.getElementById('yn-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'yn-toast-container';
        container.style.cssText = `
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 99999999;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const colorMap: Record<ToastType, { bg: string; border: string; text: string; icon: string; shadow: string }> = {
        success: { bg: '#f6ffed', border: '#b7eb8f', text: '#389e0d', icon: '✅', shadow: 'rgba(82, 196, 26, 0.2)' },
        warning: { bg: '#fffbe6', border: '#ffe58f', text: '#d46b08', icon: '⚠️', shadow: 'rgba(250, 140, 22, 0.2)' },
        error: { bg: '#fff1f0', border: '#ffa39e', text: '#cf1322', icon: '❌', shadow: 'rgba(245, 34, 45, 0.2)' },
        info: { bg: '#e6f7ff', border: '#91d5ff', text: '#096dd9', icon: 'ℹ️', shadow: 'rgba(24, 144, 255, 0.2)' }
    };

    const cfg = colorMap[type] || colorMap.info;

    toast.style.cssText = `
        background: ${cfg.bg};
        border: 1px solid ${cfg.border};
        color: ${cfg.text};
        box-shadow: 0 4px 16px ${cfg.shadow};
        padding: 10px 18px;
        border-radius: 8px;
        font-size: 13.5px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: 600px;
        word-break: break-word;
        pointer-events: auto;
        opacity: 0;
        transform: translateY(-12px);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    toast.innerHTML = `
        <span style="font-size: 16px;">${cfg.icon}</span>
        <span style="white-space: pre-wrap; line-height: 1.4;">${message}</span>
    `;

    container.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    // 自动消失
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        setTimeout(() => {
            if (toast.parentElement) toast.parentElement.removeChild(toast);
        }, 300);
    }, duration);
}
