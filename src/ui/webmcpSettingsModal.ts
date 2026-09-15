import {
    getLlmConfig,
    saveLlmConfig,
    testLlmConnection,
    fetchAvailableModels,
    getDefaultModelsForProvider,
    LLM_PRESETS,
    LlmConfig,
    ModelOption
} from '../services/llmService';
import { injectWebMcpStyles } from './webmcpStyles';
import { showToast } from '../utils/toast';

export function openWebMcpSettingsModal(onSaved?: (cfg: LlmConfig) => void) {
    // 1. 确保全局样式已注入（修复副驾点击设置弹窗因缺样式而无法显示的隐蔽 BUG）
    injectWebMcpStyles();

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
                    <div>
                        <div style="font-size:14.5px; font-weight:700; color:var(--wm-text-primary);">LLM 模型接入与智能选用配置</div>
                        <div style="font-size:11px; color:#64748b;">支持自动探测模型列表、自定义勾选并在对话框底部快捷选用</div>
                    </div>
                </div>
                <button class="webmcp-icon-btn" id="settings-btn-close" style="background:none; border:none; font-size:16px; cursor:pointer; color:#64748b; padding:4px 8px; border-radius:4px;">✕</button>
            </div>

            <div class="webmcp-settings-body">
                <!-- 1. 服务商预设 -->
                <div class="webmcp-settings-field">
                    <label class="webmcp-settings-label">选择推荐服务商预设 (Quick Presets)</label>
                    <div class="webmcp-presets-bar">
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'gemini' ? 'active' : ''}" data-provider="gemini">✦ Google Gemini (推荐首选)</button>
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'deepseek' ? 'active' : ''}" data-provider="deepseek">🐳 DeepSeek (V3/R1)</button>
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'openai' ? 'active' : ''}" data-provider="openai">🟢 OpenAI (GPT-4o/o3)</button>
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'claude' || currentCfg.provider === 'openrouter' ? 'active' : ''}" data-provider="claude">⚡ Claude 3.7 / OpenRouter</button>
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'ollama' ? 'active' : ''}" data-provider="ollama">🦙 Ollama (本地私有)</button>
                        <button class="webmcp-preset-chip ${currentCfg.provider === 'custom' ? 'active' : ''}" data-provider="custom">⚙️ 自定义 (Custom)</button>
                    </div>
                </div>

                <!-- 2. API 端点与 Key -->
                <div class="webmcp-settings-row">
                    <div class="webmcp-settings-field" style="flex:2;">
                        <label class="webmcp-settings-label">API 基础地址 (Base URL)</label>
                        <input type="text" class="webmcp-settings-input" id="cfg-endpoint" placeholder="例如: https://generativelanguage.googleapis.com/v1beta/openai" value="${currentCfg.endpoint}" />
                        <span class="webmcp-settings-hint" id="cfg-endpoint-hint">Google AI Studio 端点原生兼容 OpenAI 协议。</span>
                    </div>
                    <div class="webmcp-settings-field" style="flex:1;">
                        <label class="webmcp-settings-label">发散度 (Temp): <span id="temp-val">${currentCfg.temperature}</span></label>
                        <input type="range" min="0" max="1" step="0.05" value="${currentCfg.temperature}" id="cfg-temp" style="margin-top:10px; width:100%; cursor:pointer;" />
                    </div>
                </div>

                <div class="webmcp-settings-field">
                    <label class="webmcp-settings-label">API 密钥 (API Key)</label>
                    <div style="position:relative; display:flex; align-items:center;">
                        <input type="password" class="webmcp-settings-input" id="cfg-apikey" placeholder="AIzaSy... 或 sk-..." value="${currentCfg.apiKey}" style="padding-right:40px; font-family:ui-monospace,monospace;" />
                        <button type="button" id="cfg-toggle-key" style="position:absolute; right:8px; background:none; border:none; cursor:pointer; font-size:13px; color:#64748b;" title="显示/隐藏密钥">👁️</button>
                    </div>
                    <span class="webmcp-settings-hint" id="cfg-apikey-hint">Google AI Studio Key 请从 <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#2563eb; text-decoration: underline;">aistudio.google.com</a> 免费获取。</span>
                </div>

                <!-- 3. 模型自动识别与勾选管理区 -->
                <div class="webmcp-models-section">
                    <div class="webmcp-models-header">
                        <div class="webmcp-models-title-wrap">
                            <span class="webmcp-models-title">可用模型清单与对话框展示配置</span>
                            <span class="webmcp-models-badge" id="models-count-badge">已选用 0 个</span>
                        </div>
                        <div class="webmcp-models-actions">
                            <button type="button" class="webmcp-btn-detect" id="btn-detect-models" title="向当前 API 发起 /models 探测，自动拉取最新支持的模型列表">
                                <span class="btn-detect-icon">🔍</span>
                                <span>自动识别模型</span>
                            </button>
                            <button type="button" class="webmcp-btn-add-custom" id="btn-show-add-custom">
                                <span>＋ 添加自定义</span>
                            </button>
                        </div>
                    </div>

                    <!-- 自定义模型新增框 -->
                    <div class="webmcp-custom-model-box" id="custom-model-box">
                        <input type="text" id="custom-model-input" class="webmcp-models-filter" placeholder="输入模型 ID (如 gpt-4o-2024-11-20、qwen-max 或私有模型)" />
                        <button type="button" class="webmcp-btn-detect" id="btn-confirm-add-custom" style="white-space:nowrap;">确认添加</button>
                    </div>

                    <!-- 搜索与快捷操作 -->
                    <div class="webmcp-models-search-row">
                        <input type="text" id="models-search-filter" class="webmcp-models-filter" placeholder="快速过滤模型 ID 或名称..." />
                        <button type="button" class="webmcp-btn-quick-toggle" id="btn-toggle-all">全选</button>
                        <button type="button" class="webmcp-btn-quick-toggle" id="btn-toggle-none">清空</button>
                    </div>

                    <!-- 模型条目滚动列表 -->
                    <div class="webmcp-models-list" id="models-checklist-container">
                        <!-- 动态渲染 -->
                    </div>
                    <div style="font-size:10.5px; color:#64748b; display:flex; align-items:center; justify-content:space-between;">
                        <span>提示：勾选 <input type="checkbox" checked disabled style="vertical-align:middle;" /> 的模型将呈现在副驾底部快捷下拉框中供即时切换。点击“设为当前”锁定为当前生效模型。</span>
                    </div>
                </div>

                <!-- 4. 连通性测试区域 -->
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

    // DOM 引用
    const closeBtn = modal.querySelector('#settings-btn-close');
    const cancelBtn = modal.querySelector('#settings-btn-cancel');
    const saveBtn = modal.querySelector('#settings-btn-save');
    const testBtn = modal.querySelector('#cfg-btn-test') as HTMLButtonElement;
    const testStatus = modal.querySelector('#cfg-test-status') as HTMLElement;
    const endpointInput = modal.querySelector('#cfg-endpoint') as HTMLInputElement;
    const apiKeyInput = modal.querySelector('#cfg-apikey') as HTMLInputElement;
    const tempInput = modal.querySelector('#cfg-temp') as HTMLInputElement;
    const tempVal = modal.querySelector('#temp-val') as HTMLElement;
    const toggleKeyBtn = modal.querySelector('#cfg-toggle-key');
    const endpointHint = modal.querySelector('#cfg-endpoint-hint') as HTMLElement;
    const apikeyHint = modal.querySelector('#cfg-apikey-hint') as HTMLElement;

    const btnDetectModels = modal.querySelector('#btn-detect-models') as HTMLButtonElement;
    const btnShowAddCustom = modal.querySelector('#btn-show-add-custom') as HTMLButtonElement;
    const customModelBox = modal.querySelector('#custom-model-box') as HTMLElement;
    const customModelInput = modal.querySelector('#custom-model-input') as HTMLInputElement;
    const btnConfirmAddCustom = modal.querySelector('#btn-confirm-add-custom') as HTMLButtonElement;
    const searchFilterInput = modal.querySelector('#models-search-filter') as HTMLInputElement;
    const btnToggleAll = modal.querySelector('#btn-toggle-all') as HTMLButtonElement;
    const btnToggleNone = modal.querySelector('#btn-toggle-none') as HTMLButtonElement;
    const modelsContainer = modal.querySelector('#models-checklist-container') as HTMLElement;
    const modelsCountBadge = modal.querySelector('#models-count-badge') as HTMLElement;

    let currentSelectedProvider = currentCfg.provider || 'gemini';
    let modelsList: ModelOption[] = Array.isArray(currentCfg.models) && currentCfg.models.length > 0
        ? [...currentCfg.models]
        : getDefaultModelsForProvider(currentSelectedProvider);

    let currentActiveModel = currentCfg.model || modelsList.find(m => m.enabled)?.id || modelsList[0]?.id || 'gemini-2.0-flash';

    // 渲染模型勾选列表
    const renderModelsList = (keyword: string = '') => {
        const filterKey = keyword.trim().toLowerCase();
        const displayList = modelsList.filter(m => {
            if (!filterKey) return true;
            return m.id.toLowerCase().includes(filterKey) || (m.name && m.name.toLowerCase().includes(filterKey));
        });

        const enabledCount = modelsList.filter(m => m.enabled).length;
        modelsCountBadge.textContent = `已选用 ${enabledCount} 个`;

        if (displayList.length === 0) {
            modelsContainer.innerHTML = `
                <div style="padding:16px; text-align:center; color:#94a3b8; font-size:11.5px;">
                    未匹配到相关模型。可点击上方“自动识别”拉取或“添加自定义”补充。
                </div>
            `;
            return;
        }

        modelsContainer.innerHTML = displayList.map(m => {
            const isActive = m.id === currentActiveModel;
            return `
                <div class="webmcp-model-item ${isActive ? 'is-active-model' : ''}" data-model-id="${m.id}">
                    <div class="webmcp-model-left">
                        <input type="checkbox" class="webmcp-model-checkbox" data-model-id="${m.id}" ${m.enabled ? 'checked' : ''} title="勾选以在对话框底部选用" />
                        <div class="webmcp-model-info">
                            <div class="webmcp-model-title">${m.name || m.id}</div>
                            <div class="webmcp-model-id">${m.id}</div>
                        </div>
                    </div>
                    <div class="webmcp-model-right">
                        ${m.isReasoning ? '<span class="webmcp-model-badge reasoning">🧠 深度思考</span>' : ''}
                        ${m.isVision ? '<span class="webmcp-model-badge vision">👁️ 视觉多模态</span>' : ''}
                        ${isActive
                            ? '<span class="webmcp-model-badge active">★ 当前生效</span>'
                            : `<button type="button" class="webmcp-model-btn-set-default" data-set-default="${m.id}">设为当前</button>`
                        }
                        ${m.custom ? `<button type="button" class="webmcp-model-btn-del" data-del-model="${m.id}" title="删除自定义模型">✕</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // 绑定勾选与切换事件
        modelsContainer.querySelectorAll('.webmcp-model-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                const targetId = target.getAttribute('data-model-id');
                const found = modelsList.find(m => m.id === targetId);
                if (found) {
                    found.enabled = target.checked;
                    // 如果取消了当前生效模型，自动迁移到下一个启用的模型
                    if (!found.enabled && currentActiveModel === found.id) {
                        const nextActive = modelsList.find(m => m.enabled);
                        if (nextActive) currentActiveModel = nextActive.id;
                    }
                    renderModelsList(searchFilterInput.value);
                }
            });
        });

        // 绑定设为当前事件
        modelsContainer.querySelectorAll('[data-set-default]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetId = (btn as HTMLElement).getAttribute('data-set-default');
                if (targetId) {
                    currentActiveModel = targetId;
                    const found = modelsList.find(m => m.id === targetId);
                    if (found) found.enabled = true; // 设为当前自动激活勾选
                    renderModelsList(searchFilterInput.value);
                }
            });
        });

        // 绑定删除自定义模型
        modelsContainer.querySelectorAll('[data-del-model]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetId = (btn as HTMLElement).getAttribute('data-del-model');
                modelsList = modelsList.filter(m => m.id !== targetId);
                if (currentActiveModel === targetId) {
                    currentActiveModel = modelsList.find(m => m.enabled)?.id || modelsList[0]?.id || 'gemini-2.0-flash';
                }
                renderModelsList(searchFilterInput.value);
            });
        });
    };

    renderModelsList();

    // 搜索过滤
    searchFilterInput?.addEventListener('input', () => {
        renderModelsList(searchFilterInput.value);
    });

    // 全选与清空
    btnToggleAll?.addEventListener('click', () => {
        modelsList.forEach(m => m.enabled = true);
        renderModelsList(searchFilterInput.value);
    });
    btnToggleNone?.addEventListener('click', () => {
        modelsList.forEach(m => m.enabled = false);
        // 至少保留当前生效模型勾选
        const active = modelsList.find(m => m.id === currentActiveModel);
        if (active) active.enabled = true;
        renderModelsList(searchFilterInput.value);
    });

    // 自动识别模型
    btnDetectModels?.addEventListener('click', async () => {
        btnDetectModels.disabled = true;
        const origText = btnDetectModels.innerHTML;
        btnDetectModels.innerHTML = '<span class="aui-tool-spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle;"></span> 正在识别...';

        const configToDetect: LlmConfig = {
            provider: currentSelectedProvider,
            endpoint: endpointInput.value.trim(),
            apiKey: apiKeyInput.value.trim(),
            model: currentActiveModel,
            temperature: parseFloat(tempInput.value) || 0.3
        };

        try {
            const res = await fetchAvailableModels(configToDetect);
            if (res.success && res.models.length > 0) {
                // 合并新拉取的模型与现存自定义模型，保留已勾选状态
                const currentEnabledMap = new Map(modelsList.map(m => [m.id, m.enabled]));
                const merged: ModelOption[] = res.models.map(m => ({
                    ...m,
                    enabled: currentEnabledMap.has(m.id) ? (currentEnabledMap.get(m.id) ?? true) : m.enabled
                }));

                // 保留用户此前手动添加的 custom 模型
                const customModels = modelsList.filter(m => m.custom);
                for (const cm of customModels) {
                    if (!merged.some(m => m.id === cm.id)) {
                        merged.push(cm);
                    }
                }

                modelsList = merged;
                if (!modelsList.some(m => m.id === currentActiveModel)) {
                    currentActiveModel = modelsList.find(m => m.enabled)?.id || modelsList[0].id;
                }

                renderModelsList();
                showToast('success', res.message);
            } else {
                showToast('warning', res.message || '未获取到模型列表，已保留当前预设');
            }
        } catch (err: any) {
            showToast('error', `识别异常: ${err.message}`);
        } finally {
            btnDetectModels.disabled = false;
            btnDetectModels.innerHTML = origText;
        }
    });

    // 显示添加自定义输入框
    btnShowAddCustom?.addEventListener('click', () => {
        customModelBox.classList.toggle('is-open');
        if (customModelBox.classList.contains('is-open')) {
            customModelInput.focus();
        }
    });

    // 确认添加自定义模型
    const handleAddCustomModel = () => {
        const val = customModelInput.value.trim();
        if (!val) return;
        if (modelsList.some(m => m.id === val)) {
            showToast('warning', '该模型 ID 已存在列表中');
            return;
        }
        const newModel: ModelOption = {
            id: val,
            name: `${val} (自定义)`,
            provider: currentSelectedProvider,
            enabled: true,
            custom: true
        };
        modelsList.unshift(newModel);
        currentActiveModel = val;
        customModelInput.value = '';
        customModelBox.classList.remove('is-open');
        renderModelsList();
        showToast('success', `已添加自定义模型 ${val}`);
    };
    btnConfirmAddCustom?.addEventListener('click', handleAddCustomModel);
    customModelInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddCustomModel();
        }
    });

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
                if (preset.temperature !== undefined) {
                    tempInput.value = String(preset.temperature);
                    tempVal.textContent = String(preset.temperature);
                }
            }

            // 更新提示文案
            if (p === 'gemini') {
                endpointHint.textContent = 'Google AI Studio 端点原生兼容 OpenAI 协议。';
                apikeyHint.innerHTML = 'Google AI Studio Key 请从 <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#2563eb; text-decoration: underline;">aistudio.google.com</a> 免费获取。';
            } else if (p === 'deepseek') {
                endpointHint.textContent = 'DeepSeek 官方开放平台端点 (标准 OpenAI 协议兼容)。';
                apikeyHint.innerHTML = 'DeepSeek API Key 请从 <a href="https://platform.deepseek.com/api_keys" target="_blank" style="color:#2563eb; text-decoration: underline;">platform.deepseek.com</a> 获取。';
            } else if (p === 'openai') {
                endpointHint.textContent = 'OpenAI 官方 API 端点。';
                apikeyHint.innerHTML = 'OpenAI API Key 请从 <a href="https://platform.openai.com/api-keys" target="_blank" style="color:#2563eb; text-decoration: underline;">platform.openai.com</a> 获取。';
            } else if (p === 'claude' || p === 'openrouter') {
                endpointHint.textContent = 'OpenRouter 聚合平台端点，一键访问全系 Claude 与全球顶级开源模型。';
                apikeyHint.innerHTML = 'API Key 请从 <a href="https://openrouter.ai/keys" target="_blank" style="color:#2563eb; text-decoration: underline;">openrouter.ai</a> 获取。';
            } else if (p === 'ollama') {
                endpointHint.textContent = '本地私有化 Ollama 运行地址，默认 http://localhost:11434/v1。';
                apikeyHint.textContent = '本地部署通常无需填写 API Key。';
            } else {
                endpointHint.textContent = '支持任何标准 OpenAI 格式的兼容端点 (如 SiliconFlow、Kimi、GLM、vLLM 等)。';
                apikeyHint.textContent = '请填写对应服务商下发的 API 密钥。';
            }

            // 切换服务商后加载对应预设模型库
            modelsList = getDefaultModelsForProvider(p);
            currentActiveModel = preset?.model || modelsList.find(m => m.enabled)?.id || modelsList[0].id;
            renderModelsList();
        });
    });

    // 切换密码可见性
    toggleKeyBtn?.addEventListener('click', () => {
        apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    });

    // 滑块联动
    tempInput?.addEventListener('input', () => {
        if (tempVal) tempVal.textContent = tempInput.value;
    });

    // 连通性测试
    testBtn?.addEventListener('click', async () => {
        testBtn.disabled = true;
        testStatus.innerHTML = '<span style="color:#f59e0b;"><span class="aui-tool-spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle;"></span> 正在发起 Ping 测试...</span>';

        const configToTest: LlmConfig = {
            provider: currentSelectedProvider,
            endpoint: endpointInput.value.trim(),
            apiKey: apiKeyInput.value.trim(),
            model: currentActiveModel,
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
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            closeModal();
            window.removeEventListener('keydown', handleEsc);
        }
    };
    window.addEventListener('keydown', handleEsc);

    // 保存逻辑
    saveBtn?.addEventListener('click', () => {
        // 保证至少有 1 个模型被选中且激活
        if (!modelsList.some(m => m.enabled)) {
            const target = modelsList.find(m => m.id === currentActiveModel) || modelsList[0];
            if (target) target.enabled = true;
        }

        const newCfg: LlmConfig = {
            provider: currentSelectedProvider,
            endpoint: endpointInput.value.trim(),
            apiKey: apiKeyInput.value.trim(),
            model: currentActiveModel,
            temperature: parseFloat(tempInput.value) || 0.3,
            models: modelsList
        };

        saveLlmConfig(newCfg);
        showToast('success', `🎉 LLM 配置已保存！当前默认模型: ${currentActiveModel}`);
        onSaved?.(newCfg);
        closeModal();
    });
}
