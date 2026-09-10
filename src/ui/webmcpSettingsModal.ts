import { getLlmConfig, saveLlmConfig, testLlmConnection, LLM_PRESETS, LlmConfig } from '../services/llmService';
import { showToast } from '../utils/toast';

export function openWebMcpSettingsModal(onSaved?: (cfg: LlmConfig) => void) {
    const modalId = 'autopilot-webmcp-settings-modal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    const currentCfg = getLlmConfig();

    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'webmcp-settings-backdrop';
    modal.innerHTML = `
        <div class="webmcp-settings-card">
            <div class="webmcp-settings-header">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:18px;">⚙️</span>
                    <span style="font-size:15px; font-weight:700; color:var(--wm-text-primary);">LLM 模型接入与 API 设置</span>
                </div>
                <button class="webmcp-icon-btn" id="settings-btn-close">✕</button>
            </div>

            <div class="webmcp-settings-body">
                <div class="webmcp-settings-field">
                    <label class="webmcp-settings-label">选择推荐服务商预设 (Quick Presets)</label>
                    <div class="webmcp-presets-bar">
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'gemini' ? 'active' : ''}" data-provider="gemini">Google Gemini (AI Studio)</button>
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'deepseek' ? 'active' : ''}" data-provider="deepseek">DeepSeek (推荐)</button>
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'openai' ? 'active' : ''}" data-provider="openai">OpenAI (GPT-4o)</button>
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'ollama' ? 'active' : ''}" data-provider="ollama">Ollama (本地私有)</button>
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'openrouter' ? 'active' : ''}" data-provider="openrouter">OpenRouter / Claude</button>
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'custom' ? 'active' : ''}" data-provider="custom">自定义 (Custom)</button>
                    </div>
                </div>

                <div class="webmcp-settings-field">
                    <label class="webmcp-settings-label">API 基础地址 (Base URL)</label>
                    <input type="text" class="webmcp-settings-input" id="cfg-endpoint" placeholder="例如: https://generativelanguage.googleapis.com/v1beta/openai" value="${currentCfg.endpoint}" />
                    <span class="webmcp-settings-hint">Google AI Studio 端点已自动原生兼容 OpenAI 协议。</span>
                </div>

                <div class="webmcp-settings-field">
                    <label class="webmcp-settings-label">API 密钥 (API Key)</label>
                    <div style="position:relative; display:flex; align-items:center;">
                        <input type="password" class="webmcp-settings-input" id="cfg-apikey" placeholder="AIzaSy... 或 sk-..." value="${currentCfg.apiKey}" style="padding-right:40px;" />
                        <button type="button" id="cfg-toggle-key" style="position:absolute; right:8px; background:none; border:none; cursor:pointer; font-size:13px; color:#64748b;">👁️</button>
                    </div>
                    <span class="webmcp-settings-hint">Google AI Pro / Studio Key 请从 <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#0ea5e9; text-decoration: underline;">aistudio.google.com</a> 获取。</span>
                </div>

                <div class="webmcp-settings-row">
                    <div class="webmcp-settings-field" style="flex:2;">
                        <label class="webmcp-settings-label">模型名称 (Model ID)</label>
                        <input type="text" class="webmcp-settings-input" id="cfg-model" placeholder="例如: deepseek-chat 或 gpt-4o" value="${currentCfg.model}" />
                    </div>
                    <div class="webmcp-settings-field" style="flex:1;">
                        <label class="webmcp-settings-label">发散度 (Temp): <span id="temp-val">${currentCfg.temperature}</span></label>
                        <input type="range" min="0" max="1" step="0.05" value="${currentCfg.temperature}" id="cfg-temp" style="margin-top:8px; width:100%;" />
                    </div>
                </div>

                <!-- 连通性测试区域 -->
                <div class="webmcp-test-box" id="webmcp-test-box">
                    <button class="webmcp-btn-test" id="cfg-btn-test">
                        <span>🧪 测试连通性 (Ping Test)</span>
                    </button>
                    <div class="webmcp-test-status" id="cfg-test-status">
                        <span style="color:#94a3b8;">尚未测试</span>
                    </div>
                </div>
            </div>

            <div class="webmcp-settings-footer">
                <button class="webmcp-btn-secondary" id="settings-btn-cancel">取消</button>
                <button class="webmcp-btn-primary" id="settings-btn-save">💾 保存并生效</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // DOM 元素引用
    const closeBtn = modal.querySelector('#settings-btn-close');
    const cancelBtn = modal.querySelector('#settings-btn-cancel');
    const saveBtn = modal.querySelector('#settings-btn-save');
    const testBtn = modal.querySelector('#cfg-btn-test') as HTMLButtonElement;
    const testStatus = modal.querySelector('#cfg-test-status') as HTMLElement;
    const endpointInput = modal.querySelector('#cfg-endpoint') as HTMLInputElement;
    const apiKeyInput = modal.querySelector('#cfg-apikey') as HTMLInputElement;
    const modelInput = modal.querySelector('#cfg-model') as HTMLInputElement;
    const tempInput = modal.querySelector('#cfg-temp') as HTMLInputElement;
    const tempVal = modal.querySelector('#temp-val') as HTMLElement;
    const toggleKeyBtn = modal.querySelector('#cfg-toggle-key');

    let currentSelectedProvider = currentCfg.provider;

    // 预设切换
    modal.querySelectorAll('.webmcp-preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            modal.querySelectorAll('.webmcp-preset-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const p = chip.getAttribute('data-provider') as any;
            currentSelectedProvider = p;
            const preset = LLM_PRESETS[p];
            if (preset) {
                if (preset.endpoint !== undefined) endpointInput.value = preset.endpoint;
                if (preset.model !== undefined) modelInput.value = preset.model;
                if (preset.temperature !== undefined) {
                    tempInput.value = String(preset.temperature);
                    tempVal.textContent = String(preset.temperature);
                }
            }
        });
    });

    // 切换密码可见性
    toggleKeyBtn?.addEventListener('click', () => {
        if (apiKeyInput.type === 'password') {
            apiKeyInput.type = 'text';
        } else {
            apiKeyInput.type = 'password';
        }
    });

    // 滑块联动
    tempInput?.addEventListener('input', () => {
        if (tempVal) tempVal.textContent = tempInput.value;
    });

    // 连通性测试
    testBtn?.addEventListener('click', async () => {
        testBtn.disabled = true;
        testStatus.innerHTML = '<span style="color:#f59e0b;">⏳ 正在发起 Ping 测试...</span>';

        const configToTest: LlmConfig = {
            provider: currentSelectedProvider,
            endpoint: endpointInput.value.trim(),
            apiKey: apiKeyInput.value.trim(),
            model: modelInput.value.trim(),
            temperature: parseFloat(tempInput.value) || 0.3
        };

        const result = await testLlmConnection(configToTest);
        testBtn.disabled = false;

        if (result.success) {
            testStatus.innerHTML = `<span style="color:#10b981; font-weight:600;">✓ ${result.message}</span>`;
        } else {
            testStatus.innerHTML = `<span style="color:#ef4444; font-weight:600;">✕ ${result.message}</span>`;
        }
    });

    // 关闭逻辑
    const closeModal = () => modal?.remove();
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    // 保存逻辑
    saveBtn?.addEventListener('click', () => {
        const newCfg: LlmConfig = {
            provider: currentSelectedProvider,
            endpoint: endpointInput.value.trim(),
            apiKey: apiKeyInput.value.trim(),
            model: modelInput.value.trim(),
            temperature: parseFloat(tempInput.value) || 0.3
        };

        saveLlmConfig(newCfg);
        showToast('success', '🎉 LLM 模型配置已保存！');
        onSaved?.(newCfg);
        closeModal();
    });
}
