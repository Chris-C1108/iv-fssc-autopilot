import { GlobalState, TripApplicationConfig, ExpenseBatchPlanResult, ExpensePlanOptions, InvoiceItem, A2UiRootAST, A2UiNodeAST, A2UiActionDef } from '../types/state';
import { searchProjectList } from '../services/applicationService';
import { inferSmartExpensePlan, normalizeTripSegment } from '../services/commuteService';
import { batchSaveExpenseItemsApi } from '../services/expenseService';
import { showToast } from '../utils/toast';

export interface A2UiDecisionResult {
    isProject: boolean;
    projectName?: string;
    projectVO?: any;
}

export interface RenderA2UiProjectOptions {
    configs: TripApplicationConfig[];
    container: HTMLElement;
    state: GlobalState;
    onDecisionChange?: (result: A2UiDecisionResult) => void;
}

/**
 * WebMCP A2UI 预算归属交互决策卡片
 * 
 * 遵循通用 A2UI (Agent-to-User Interface) 范式：
 * 1. 当用户未在对话中提及项目时，由副驾主动发起决策卡；
 * 2. 区分「部门日常出差」与「研发/实施项目出差」；
 * 3. 动态调用底层维表接口模糊检索项目，零硬编码；
 * 4. 内存级双向联动，实时同步至所有待入库单据配置中。
 */
export function renderA2UiProjectDecisionWidget(options: RenderA2UiProjectOptions): HTMLElement {
    const { configs, container, state, onDecisionChange } = options;

    // 初始状态检测：是否有任何单据已包含项目
    const initialProjectName = configs.find(c => c.projectName)?.projectName || '';
    const initialProjectVO = configs.find(c => c.projectVO)?.projectVO || null;
    let isProjectMode = Boolean(initialProjectName);

    const widgetId = `a2ui-project-${Math.random().toString(36).slice(2, 8)}`;
    const card = document.createElement('div');
    card.className = 'webmcp-a2ui-card';
    card.id = widgetId;

    card.innerHTML = `
        <div class="webmcp-a2ui-header">
            <div class="webmcp-a2ui-badge">A2UI 交互决策</div>
            <div class="webmcp-a2ui-title">
                <span>🎯</span>
                <span>请决策本次出差的预算与核算归属</span>
            </div>
            <div class="webmcp-a2ui-desc">
                副驾检测到您尚未明确指定预算来源。请选择本次出差是列入<strong>部门日常差旅</strong>，还是归属于特定<strong>研发/实施项目</strong>：
            </div>
        </div>

        <div class="webmcp-a2ui-mode-toggle">
            <button class="webmcp-a2ui-mode-btn ${!isProjectMode ? 'active' : ''}" id="${widgetId}-btn-dept">
                <span style="font-size: 14px;">🏢</span>
                <div style="text-align: left;">
                    <div style="font-weight: 600; font-size: 12.5px;">部门日常出差</div>
                    <div style="font-size: 11px; opacity: 0.85;">科目为「国内出張旅費」，不占项目预算</div>
                </div>
            </button>
            <button class="webmcp-a2ui-mode-btn ${isProjectMode ? 'active' : ''}" id="${widgetId}-btn-proj">
                <span style="font-size: 14px;">🚀</span>
                <div style="text-align: left;">
                    <div style="font-weight: 600; font-size: 12.5px;">研发/实施项目出差</div>
                    <div style="font-size: 11px; opacity: 0.85;">关联指定项目，自动核销项目预算包</div>
                </div>
            </button>
        </div>

        <!-- 项目检索与选择区域 (动态切换展开) -->
        <div class="webmcp-a2ui-proj-section" id="${widgetId}-proj-section" style="${isProjectMode ? 'display: block;' : 'display: none;'}">
            <div class="webmcp-a2ui-search-box">
                <span class="webmcp-a2ui-search-icon">🔍</span>
                <input
                    type="text"
                    class="webmcp-a2ui-search-input"
                    id="${widgetId}-search-input"
                    placeholder="输入项目编号或项目关键字进行实时检索 (例如: AI、测试、研发)..."
                    value="${initialProjectName || ''}"
                />
                <button class="webmcp-a2ui-search-clear" id="${widgetId}-search-clear" title="清空" style="${initialProjectName ? 'display: block;' : 'display: none;'}">✕</button>
            </div>

            <!-- 当前已选中的项目徽章 -->
            <div class="webmcp-a2ui-selected-chip" id="${widgetId}-selected-chip" style="${initialProjectName ? 'display: flex;' : 'display: none;'}">
                <span style="font-size: 13px;">📌</span>
                <span>已关联项目: <strong id="${widgetId}-selected-name">${initialProjectName}</strong></span>
                <button class="webmcp-a2ui-chip-remove" id="${widgetId}-chip-remove" title="取消关联">✕ 取消关联</button>
            </div>

            <!-- 下拉候选菜单 -->
            <div class="webmcp-a2ui-dropdown" id="${widgetId}-dropdown" style="display: none;"></div>
        </div>

        <!-- 决策生效确认条 -->
        <div class="webmcp-a2ui-status-bar" id="${widgetId}-status-bar">
            ${!isProjectMode
                ? '✓ 当前已设为【部门日常出差】：费用计入部门差旅科目，无项目约束。'
                : (initialProjectName
                    ? `✓ 当前已关联项目【${initialProjectName}】：费用将扣减项目预算。`
                    : '⚠️ 请在上方搜索框输入并选定本次出差归属的项目。')}
        </div>
    `;

    container.appendChild(card);

    // DOM 元素获取
    const btnDept = card.querySelector(`#${widgetId}-btn-dept`) as HTMLButtonElement;
    const btnProj = card.querySelector(`#${widgetId}-btn-proj`) as HTMLButtonElement;
    const projSection = card.querySelector(`#${widgetId}-proj-section`) as HTMLElement;
    const searchInput = card.querySelector(`#${widgetId}-search-input`) as HTMLInputElement;
    const searchClear = card.querySelector(`#${widgetId}-search-clear`) as HTMLElement;
    const dropdown = card.querySelector(`#${widgetId}-dropdown`) as HTMLElement;
    const selectedChip = card.querySelector(`#${widgetId}-selected-chip`) as HTMLElement;
    const selectedNameEl = card.querySelector(`#${widgetId}-selected-name`) as HTMLElement;
    const chipRemove = card.querySelector(`#${widgetId}-chip-remove`) as HTMLElement;
    const statusBar = card.querySelector(`#${widgetId}-status-bar`) as HTMLElement;

    // 更新配置状态并通知外界
    const applyDecision = (result: A2UiDecisionResult) => {
        configs.forEach(c => {
            if (result.isProject) {
                c.projectName = result.projectName;
                c.projectVO = result.projectVO;
            } else {
                c.projectName = undefined;
                c.projectVO = undefined;
            }
        });

        if (onDecisionChange) {
            onDecisionChange(result);
        }
    };

    // 切换到部门日常出差
    btnDept.addEventListener('click', () => {
        isProjectMode = false;
        btnDept.classList.add('active');
        btnProj.classList.remove('active');
        projSection.style.display = 'none';
        dropdown.style.display = 'none';

        applyDecision({ isProject: false });

        statusBar.innerHTML = '✓ 当前已设为【部门日常出差】：费用计入部门差旅科目，无项目约束。';
        statusBar.className = 'webmcp-a2ui-status-bar success';
        showToast('info', '已选定【部门日常出差】，不占用项目预算');
    });

    // 切换到研发/实施项目出差
    btnProj.addEventListener('click', () => {
        isProjectMode = true;
        btnProj.classList.add('active');
        btnDept.classList.remove('active');
        projSection.style.display = 'block';

        const currentVal = searchInput.value.trim();
        if (currentVal && configs[0]?.projectVO) {
            statusBar.innerHTML = `✓ 当前已关联项目【${currentVal}】：费用将扣减项目预算。`;
            statusBar.className = 'webmcp-a2ui-status-bar success';
        } else {
            statusBar.innerHTML = '⚠️ 请在上方搜索框输入并选定本次出差归属的项目。';
            statusBar.className = 'webmcp-a2ui-status-bar warn';
            searchInput.focus();
            triggerSearch(searchInput.value.trim());
        }
    });

    // 防抖动态搜索
    let debounceTimer: any = null;
    const triggerSearch = (query: string) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            dropdown.style.display = 'block';
            dropdown.innerHTML = `
                <div class="webmcp-a2ui-dropdown-loading">
                    <span class="webmcp-spinner" style="width: 14px; height: 14px;"></span>
                    <span>正在维表中动态检索项目...</span>
                </div>
            `;

            try {
                const results = await searchProjectList(query, state);

                if (!results || results.length === 0) {
                    dropdown.innerHTML = `
                        <div class="webmcp-a2ui-dropdown-empty">
                            未匹配到包含「${query || '全部'}」的项目维表数据，请核对项目名称或编号。
                        </div>
                    `;
                    return;
                }

                dropdown.innerHTML = results.map(item => `
                    <div class="webmcp-a2ui-dropdown-item" data-code="${item.code}" data-name="${item.name}">
                        <span class="webmcp-a2ui-item-code">${item.code || 'PRJ'}</span>
                        <span class="webmcp-a2ui-item-name">${item.name}</span>
                    </div>
                `).join('');

                // 绑定点击选中
                dropdown.querySelectorAll('.webmcp-a2ui-dropdown-item').forEach(itemEl => {
                    itemEl.addEventListener('click', () => {
                        const code = itemEl.getAttribute('data-code') || '';
                        const name = itemEl.getAttribute('data-name') || '';
                        const matched = results.find(r => r.name === name);

                        if (matched) {
                            searchInput.value = matched.name;
                            searchClear.style.display = 'block';
                            dropdown.style.display = 'none';

                            selectedNameEl.textContent = `${matched.code ? `[${matched.code}] ` : ''}${matched.name}`;
                            selectedChip.style.display = 'flex';

                            applyDecision({
                                isProject: true,
                                projectName: matched.name,
                                projectVO: matched.vo
                            });

                            statusBar.innerHTML = `✓ 当前已关联项目【${matched.name}】：已同步至全部单据。`;
                            statusBar.className = 'webmcp-a2ui-status-bar success';
                            showToast('success', `已绑定项目: ${matched.name}`);
                        }
                    });
                });
            } catch (err: any) {
                dropdown.innerHTML = `
                    <div class="webmcp-a2ui-dropdown-empty" style="color: #dc2626;">
                        检索失败: ${err.message}
                    </div>
                `;
            }
        }, 300);
    };

    searchInput.addEventListener('input', () => {
        const val = searchInput.value.trim();
        searchClear.style.display = val ? 'block' : 'none';
        triggerSearch(val);
    });

    searchInput.addEventListener('focus', () => {
        if (isProjectMode) {
            triggerSearch(searchInput.value.trim());
        }
    });

    // 清空按钮
    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        triggerSearch('');
    });

    // 取消关联按钮
    chipRemove.addEventListener('click', () => {
        selectedChip.style.display = 'none';
        searchInput.value = '';
        searchClear.style.display = 'none';
        applyDecision({ isProject: false });

        statusBar.innerHTML = '⚠️ 项目关联已解除，您可重新检索或切换为【部门日常出差】。';
        statusBar.className = 'webmcp-a2ui-status-bar warn';
    });

    // 点击外部折叠下拉框
    document.addEventListener('click', (e) => {
        if (!card.contains(e.target as Node)) {
            dropdown.style.display = 'none';
        }
    });

    return card;
}

export interface A2UiRenderOptions {
    state?: GlobalState;
    onAction?: (actionKey: string, model: any, ast: A2UiRootAST) => void | Promise<void>;
    onChange?: (bindKey: string, value: any, model: any) => void;
}

/**
 * 通用声明式 A2UI (Agent-to-User Interface) AST 渲染引擎
 * 
 * 核心设计范式：
 * 1. 彻底解耦业务逻辑与 UI 渲染，所有表单与交互均由 AST 抽象语法树驱动；
 * 2. 响应式双向数据绑定 (Model 2-Way Binding)，字段修改自动同步至 ast.model；
 * 3. 动态适配多种业务场景：多波次出差矩阵、常规通勤、项目归属决策等，零硬编码！
 */
export function renderA2UiFromAST(ast: A2UiRootAST, options: A2UiRenderOptions = {}): HTMLElement {
    const card = document.createElement('div');
    card.className = 'webmcp-a2ui-card';
    card.id = ast.id || `a2ui-${Math.random().toString(36).slice(2, 8)}`;

    const renderNode = (node: A2UiNodeAST): HTMLElement => {
        switch (node.type) {
            case 'header': {
                const header = document.createElement('div');
                header.className = 'webmcp-a2ui-header';
                const badge = node.props?.badge || ast.badge;
                const title = node.props?.title || ast.title;
                const desc = node.props?.desc || node.props?.description || ast.description;
                header.innerHTML = `
                    ${badge ? `<div class="webmcp-a2ui-badge">${badge}</div>` : ''}
                    <div class="webmcp-a2ui-title">
                        <span>⚡</span>
                        <span>${title}</span>
                    </div>
                    ${desc ? `<div class="webmcp-a2ui-desc">${desc}</div>` : ''}
                `;
                return header;
            }

            case 'alert': {
                const alert = document.createElement('div');
                const variant = node.props?.variant || 'info';
                alert.className = `webmcp-a2ui-alert ${variant}`;
                const icon = variant === 'success' ? '✅' : variant === 'warn' ? '⚠️' : variant === 'error' ? '❌' : 'ℹ️';
                alert.innerHTML = `
                    <span style="font-size: 14px; flex-shrink: 0;">${icon}</span>
                    <div style="flex: 1;">
                        ${node.props?.title ? `<div style="font-weight: 600; margin-bottom: 2px;">${node.props.title}</div>` : ''}
                        <div style="line-height: 1.4;">${node.props?.message || ''}</div>
                    </div>
                `;
                return alert;
            }

            case 'trip-timeline': {
                const timeline = document.createElement('div');
                timeline.className = 'webmcp-a2ui-timeline';
                const rawTrips: any[] = node.props?.trips || [];
                const trips = rawTrips.map((t, i) => normalizeTripSegment(t, i + 1));
                timeline.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                        <span style="font-weight: 700; font-size: 12px; color: #334155;">✈️ 识别到的独立出差波次 (${trips.length} 轮):</span>
                        <span style="font-size: 11px; color: #059669; font-weight: 600;">✓ 酒店与客户工厂已精准绑定</span>
                    </div>
                    ${trips.map((t, idx) => {
                        let dateDisplay = '日期待定';
                        if (t.startDate && t.endDate) {
                            dateDisplay = (t.startDate === t.endDate) ? t.startDate : `${t.startDate} ~ ${t.endDate}`;
                        } else if (t.startDate) {
                            dateDisplay = t.startDate;
                        } else if (t.endDate) {
                            dateDisplay = t.endDate;
                        }
                        const destDisplay = t.destination ? `📍 ${t.destination}` : '📍 目的地待定';
                        const hubDisplay = (t.arrivalStation || t.stationOrAirport) ? `🚆/✈️ ${t.arrivalStation || t.stationOrAirport}` : '';
                        const hotelDisplay = t.hotelName ? `🏨 ${t.hotelName}` : '🏨 自理/未定';
                        const custDisplay = (t.targetFactories || t.customerName) ? `🏭 ${t.targetFactories || t.customerName}` : '🏭 客户据点待定';

                        return `
                        <div class="webmcp-a2ui-timeline-item">
                            <span class="webmcp-a2ui-wave-badge">第 ${t.tripNo || idx + 1} 波</span>
                            <span class="webmcp-a2ui-wave-date">${dateDisplay}</span>
                            <span class="webmcp-a2ui-wave-dest">${destDisplay}</span>
                            ${hubDisplay ? `<span class="webmcp-a2ui-wave-hub" style="font-size: 11px; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-weight: 500;">${hubDisplay}</span>` : ''}
                            <span class="webmcp-a2ui-wave-hotel">${hotelDisplay}</span>
                            <span class="webmcp-a2ui-wave-customer" title="${t.targetFactories || t.customerName || ''}">${custDisplay}</span>
                        </div>
                        `;
                    }).join('')}
                `;
                return timeline;
            }

            case 'grid': {
                const grid = document.createElement('div');
                grid.className = 'webmcp-a2ui-grid';
                const cols = node.props?.columns || 2;
                grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
                if (node.props?.gap) grid.style.gap = node.props.gap;
                if (node.children) {
                    node.children.forEach(c => grid.appendChild(renderNode(c)));
                }
                return grid;
            }

            case 'group': {
                const grp = document.createElement('div');
                grp.className = 'webmcp-a2ui-group';
                if (node.props?.title) {
                    const t = document.createElement('div');
                    t.style.fontWeight = '600';
                    t.style.fontSize = '12px';
                    t.style.marginBottom = '6px';
                    t.textContent = node.props.title;
                    grp.appendChild(t);
                }
                if (node.children) {
                    node.children.forEach(c => grp.appendChild(renderNode(c)));
                }
                return grp;
            }

            case 'input': {
                const wrap = document.createElement('div');
                wrap.className = 'webmcp-a2ui-field';
                wrap.style.position = 'relative';
                const bindKey = node.bind || '';
                const curVal = (bindKey && ast.model[bindKey] !== undefined) ? ast.model[bindKey] : (node.props?.defaultValue || '');

                if (node.props?.label) {
                    const lbl = document.createElement('label');
                    lbl.className = 'webmcp-a2ui-label';
                    lbl.textContent = node.props.label;
                    wrap.appendChild(lbl);
                }

                const inp = document.createElement('input');
                inp.type = node.props?.inputType || 'text';
                inp.className = 'webmcp-a2ui-input';
                inp.value = curVal;
                if (node.props?.placeholder) inp.placeholder = node.props.placeholder;
                if (node.props?.disabled) inp.disabled = true;

                inp.addEventListener('input', () => {
                    if (bindKey) {
                        ast.model[bindKey] = inp.value;
                        options.onChange?.(bindKey, inp.value, ast.model);
                    }
                });

                wrap.appendChild(inp);

                // ==========================================
                // 宿主系统项目维表实时检索与下拉候选 (0 硬编码，动态模糊匹配)
                // ==========================================
                if (bindKey === 'projectName' || node.props?.isProjectSearch) {
                    const dropdown = document.createElement('div');
                    dropdown.className = 'webmcp-a2ui-dropdown';
                    dropdown.style.display = 'none';
                    dropdown.style.position = 'absolute';
                    dropdown.style.zIndex = '1050';
                    dropdown.style.left = '0';
                    dropdown.style.right = '0';
                    dropdown.style.top = '100%';
                    dropdown.style.maxHeight = '200px';
                    dropdown.style.overflowY = 'auto';
                    dropdown.style.background = '#ffffff';
                    dropdown.style.border = '1px solid #cbd5e1';
                    dropdown.style.borderRadius = '6px';
                    dropdown.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)';
                    dropdown.style.marginTop = '2px';
                    wrap.appendChild(dropdown);

                    let debounceTimer: any = null;
                    const doSearch = (query: string) => {
                        if (debounceTimer) clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(async () => {
                            const effectiveState = options.state || (window as any).__fssc_state;
                            if (!effectiveState) return;

                            dropdown.style.display = 'block';
                            dropdown.innerHTML = `
                                <div style="padding: 8px 12px; color: #64748b; font-size: 11px; display: flex; align-items: center; gap: 6px;">
                                    <span class="webmcp-spinner" style="width: 12px; height: 12px;"></span>
                                    <span>正在检索系统项目维表...</span>
                                </div>
                            `;

                            try {
                                const results = await searchProjectList(query, effectiveState);
                                if (!results || results.length === 0) {
                                    dropdown.innerHTML = `
                                        <div style="padding: 8px 12px; color: #94a3b8; font-size: 11px;">
                                            未匹配到项目，请核对项目名称或编号
                                        </div>
                                    `;
                                    return;
                                }

                                dropdown.innerHTML = results.map(item => `
                                    <div class="webmcp-a2ui-proj-option" data-name="${item.name}" data-code="${item.code}" style="padding: 7px 10px; cursor: pointer; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; font-size: 12px;">
                                        <span style="font-weight: 500; color: #1e293b;">${item.name}</span>
                                        <span style="font-size: 10.5px; color: #3b82f6; background: #eff6ff; padding: 2px 6px; border-radius: 4px;">${item.code || 'PRJ'}</span>
                                    </div>
                                `).join('');

                                dropdown.querySelectorAll('.webmcp-a2ui-proj-option').forEach(optEl => {
                                    optEl.addEventListener('mouseenter', () => {
                                        (optEl as HTMLElement).style.background = '#f8fafc';
                                    });
                                    optEl.addEventListener('mouseleave', () => {
                                        (optEl as HTMLElement).style.background = '';
                                    });
                                    optEl.addEventListener('mousedown', (e) => {
                                        e.preventDefault();
                                        const name = optEl.getAttribute('data-name') || '';
                                        inp.value = name;
                                        ast.model[bindKey] = name;
                                        const matched = results.find(r => r.name === name);
                                        if (matched) {
                                            effectiveState.selectedProject = {
                                                value: matched.id,
                                                title: matched.name,
                                                code: matched.code,
                                                vo: matched.vo
                                            } as any;
                                        }
                                        options.onChange?.(bindKey, name, ast.model);
                                        dropdown.style.display = 'none';
                                    });
                                });
                            } catch (e: any) {
                                dropdown.innerHTML = `<div style="padding: 8px 12px; color: #ef4444; font-size: 11px;">项目查询失败: ${e.message}</div>`;
                            }
                        }, 250);
                    };

                    inp.addEventListener('focus', () => {
                        if (inp.value.trim().length > 0) {
                            doSearch(inp.value.trim());
                        }
                    });

                    inp.addEventListener('input', () => {
                        doSearch(inp.value.trim());
                    });

                    inp.addEventListener('blur', () => {
                        setTimeout(() => {
                            dropdown.style.display = 'none';
                        }, 250);
                    });
                }

                return wrap;
            }

            case 'select': {
                const wrap = document.createElement('div');
                wrap.className = 'webmcp-a2ui-field';
                const bindKey = node.bind || '';
                const curVal = (bindKey && ast.model[bindKey] !== undefined) ? ast.model[bindKey] : (node.props?.defaultValue || '');

                if (node.props?.label) {
                    const lbl = document.createElement('label');
                    lbl.className = 'webmcp-a2ui-label';
                    lbl.textContent = node.props.label;
                    wrap.appendChild(lbl);
                }

                const sel = document.createElement('select');
                sel.className = 'webmcp-a2ui-input';
                (node.props?.options || []).forEach((opt: any) => {
                    const o = document.createElement('option');
                    o.value = opt.value;
                    o.textContent = opt.label;
                    if (opt.value === curVal) o.selected = true;
                    sel.appendChild(o);
                });

                sel.addEventListener('change', () => {
                    if (bindKey) {
                        ast.model[bindKey] = sel.value;
                        options.onChange?.(bindKey, sel.value, ast.model);
                    }
                });

                wrap.appendChild(sel);
                return wrap;
            }

            case 'toggle': {
                const wrap = document.createElement('div');
                wrap.className = 'webmcp-a2ui-mode-toggle';
                const bindKey = node.bind || '';
                const curVal = bindKey ? ast.model[bindKey] : '';
                const opts = node.props?.options || [];

                opts.forEach((opt: any) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = `webmcp-a2ui-mode-btn ${curVal === opt.value ? 'active' : ''}`;
                    btn.innerHTML = `
                        ${opt.icon ? `<span style="font-size: 14px;">${opt.icon}</span>` : ''}
                        <div style="text-align: left;">
                            <div style="font-weight: 600; font-size: 12px;">${opt.label}</div>
                            ${opt.subLabel ? `<div style="font-size: 10.5px; opacity: 0.85;">${opt.subLabel}</div>` : ''}
                        </div>
                    `;
                    btn.addEventListener('click', () => {
                        if (bindKey) {
                            ast.model[bindKey] = opt.value;
                            wrap.querySelectorAll('.webmcp-a2ui-mode-btn').forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                            options.onChange?.(bindKey, opt.value, ast.model);
                        }
                    });
                    wrap.appendChild(btn);
                });
                return wrap;
            }

            case 'button-group': {
                const btnGroup = document.createElement('div');
                btnGroup.style.display = 'flex';
                btnGroup.style.gap = '8px';
                btnGroup.style.margin = '4px 0';
                if (node.children) {
                    node.children.forEach(c => btnGroup.appendChild(renderNode(c)));
                }
                return btnGroup;
            }

            case 'button': {
                const btn = document.createElement('button');
                btn.type = 'button';
                if (node.id) btn.id = node.id;
                const styleType = node.props?.style || 'secondary';
                btn.className = `webmcp-btn ${styleType === 'primary' ? 'webmcp-btn-primary' : 'webmcp-btn-secondary'}`;
                if (styleType === 'success') {
                    btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
                    btn.style.color = '#ffffff';
                    btn.style.border = 'none';
                    btn.style.flex = '1.3';
                } else {
                    btn.style.flex = '1';
                }
                btn.style.fontSize = '12px';
                btn.style.padding = '7px 12px';

                btn.innerHTML = `${node.props?.icon ? `<span>${node.props.icon}</span> ` : ''}${node.props?.label || '确定'}`;
                btn.addEventListener('click', () => {
                    const actionKey = node.props?.actionKey || node.id;
                    options.onAction?.(actionKey, ast.model, ast);
                });
                return btn;
            }

            case 'table': {
                const wrap = document.createElement('div');
                wrap.style.maxHeight = '220px';
                wrap.style.overflowY = 'auto';
                wrap.style.border = '1px solid #e2e8f0';
                wrap.style.borderRadius = '8px';
                wrap.style.fontSize = '11.5px';
                wrap.style.marginTop = '4px';

                const records: any[] = node.props?.records || [];
                const totalCount: number = node.props?.totalCount || records.length;

                wrap.innerHTML = `
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #64748b;">
                                <th style="padding: 6px 8px;">#</th>
                                <th style="padding: 6px 8px;">日期</th>
                                <th style="padding: 6px 8px;">类别</th>
                                <th style="padding: 6px 8px;">金额</th>
                                <th style="padding: 6px 8px;">行程 (起 ➔ 止)</th>
                                <th style="padding: 6px 8px;">费用说明</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${records.map((r, i) => `
                                <tr style="border-bottom: 1px solid #f1f5f9; ${r.isModified ? 'background: #f0fdf4;' : ''}">
                                    <td style="padding: 5px 8px; color: #94a3b8;">${i + 1}</td>
                                    <td style="padding: 5px 8px; white-space: nowrap;">${r.invoiceDate || '-'}</td>
                                    <td style="padding: 5px 8px;">
                                        <span class="webmcp-tag" style="font-size: 10.5px;">${r.expenseTypeName || r.type || '出租车'}</span>
                                        ${r.subInvoices && r.subInvoices.length > 0 ? `<span style="display:inline-block; font-size:10px; background:#e0e7ff; color:#4338ca; border-radius:3px; padding:1px 4px; margin-left:4px;" title="已绑定 ${r.subInvoices.length} 张过路费发票(¥${r.tollAmount || 0})">+${r.subInvoices.length}过路费</span>` : ''}
                                        ${r.errorMessages && r.errorMessages.length > 0 ? `<span style="display:inline-block; font-size:9.5px; background:#fef2f2; color:#ef4444; border:1px solid #fecaca; border-radius:3px; padding:1px 4px; margin-left:4px;" title="${r.errorMessages.join(', ')}">⚠️ ${r.errorMessages[0]}</span>` : ''}
                                    </td>
                                    <td style="padding: 5px 8px; font-weight: 600;">¥${r.amount || 0}</td>
                                    <td style="padding: 5px 8px; color: #334155;">${r.startAddress || '-'} ➔ ${r.endAddress || '-'}</td>
                                    <td style="padding: 5px 8px; color: #64748b; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.description || ''}">${r.description || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ${totalCount > records.length ? `<div style="text-align: center; padding: 6px; color: #94a3b8; font-size: 11px;">还有 ${totalCount - records.length} 笔记录，可在报销批量助手中查看完整明细</div>` : ''}
                `;
                return wrap;
            }

            case 'divider': {
                const hr = document.createElement('hr');
                hr.style.border = '0';
                hr.style.borderTop = '1px solid #e2e8f0';
                hr.style.margin = '8px 0';
                return hr;
            }

            default: {
                const div = document.createElement('div');
                div.id = node.id;
                if (node.children) {
                    node.children.forEach(c => div.appendChild(renderNode(c)));
                }
                return div;
            }
        }
    };

    if (ast.layout) {
        ast.layout.forEach(node => {
            card.appendChild(renderNode(node));
        });
    }

    return card;
}

/**
 * 依据费用推断结果动态生成对应的声明式 A2UI AST
 */
export function generateExpenseBatchA2UiAST(
    planResult: ExpenseBatchPlanResult,
    state: GlobalState
): A2UiRootAST {
    const hasMatchedTrips = Boolean(planResult.matchedTrips && planResult.matchedTrips.length > 0);
    const trips = planResult.matchedTrips || [];
    const records = planResult.records || state.invoices || [];

    const model: Record<string, any> = {
        tripType: planResult.tripType,
        companyName: planResult.companyName || 'IVISION',
        customerName: planResult.customerName || '',
        hotelName: planResult.hotelName || '',
        stationOrAirport: planResult.stationOrAirport || '机场/高铁站',
        projectName: planResult.projectName || '',
        proxyPersonName: planResult.proxyPersonName || '',
        customDescription: ''
    };

    const layout: A2UiNodeAST[] = [];

    if (hasMatchedTrips) {
        // ==========================================
        // 场景 A: 已提供出差行程表或发票池自动聚类波次 (多波次精准对齐)
        // ==========================================
        layout.push({
            id: 'header-wave',
            type: 'header',
            props: {
                title: '多波次出差行程与费用智能匹配',
                badge: 'A2UI 智能规划 (多波次对齐)',
                desc: `副驾已识别 <strong>${trips.length}</strong> 个独立出差波次，自动对齐 <strong>${records.length}</strong> 笔费用记录的酒店、交通枢纽及往返行程。`
            }
        });

        if (planResult.missingFields && planResult.missingFields.length > 0) {
            layout.push({
                id: 'alert-wave-missing',
                type: 'alert',
                props: {
                    variant: 'warn',
                    title: '建议确认或补充信息',
                    message: `多波次已自动匹配。请在下方表单确认: ${planResult.missingFields.join('、')}`
                }
            });
        } else {
            layout.push({
                id: 'alert-wave-success',
                type: 'alert',
                props: {
                    variant: 'success',
                    title: '✅ 多波次行程自动匹配成功',
                    message: '各波次的目的地、酒店与往返交通枢纽已精准匹配！请确认关联项目及代外驻同事姓名即可。'
                }
            });
        }

        // 渲染独立卡片矩阵
        layout.push({
            id: 'timeline-trips',
            type: 'trip-timeline',
            props: {
                trips: trips
            }
        });

        // 呈现需要用户决策的字段 (客户名称、项目号、外驻同事姓名、公司基准据点)
        layout.push({
            id: 'grid-wave-inputs',
            type: 'grid',
            props: { columns: 2 },
            children: [
                {
                    id: 'input-customer',
                    type: 'input',
                    bind: 'customerName',
                    props: { label: '拜访客户名称 (可选)', placeholder: '例如: 某某科技、客户公司简称' }
                },
                {
                    id: 'input-proj',
                    type: 'input',
                    bind: 'projectName',
                    props: { label: '关联项目 (可选)', placeholder: '例如: PRJ-2026-001' }
                },
                {
                    id: 'input-proxy',
                    type: 'input',
                    bind: 'proxyPersonName',
                    props: { label: '代外驻同事报销 (可选)', placeholder: '外驻同事姓名，如: 张三' }
                },
                {
                    id: 'input-company',
                    type: 'input',
                    bind: 'companyName',
                    props: { label: '公司基准据点', placeholder: '默认 IVISION' }
                },
                {
                    id: 'input-desc',
                    type: 'input',
                    bind: 'customDescription',
                    props: { label: '统一费用说明 (可选)', placeholder: '留空则按 [外驻:姓名] 项目号 客户 自动组装' }
                }
            ]
        });
    } else {
        // ==========================================
        // 场景 B: 未提供行程表 (常规单程或市内拜访)
        // ==========================================
        layout.push({
            id: 'header-normal',
            type: 'header',
            props: {
                title: '智能费用分类与行程推断',
                badge: 'A2UI 费用批量规划',
                desc: `已检测到 <strong>${records.length}</strong> 笔费用记录，已智能规划 <strong>${planResult.modifiedCount}</strong> 笔行程/类别。`
            }
        });

        if (planResult.missingFields && planResult.missingFields.length > 0) {
            layout.push({
                id: 'alert-missing',
                type: 'alert',
                props: {
                    variant: 'warn',
                    title: '建议补充关键出行信息',
                    message: planResult.missingFields.join('、')
                }
            });
        }

        layout.push({
            id: 'toggle-mode',
            type: 'toggle',
            bind: 'tripType',
            props: {
                options: [
                    { value: 'BUSINESS_TRIP', label: '异地出差模式', subLabel: '机场/高铁 + 酒店早出晚归', icon: '✈️' },
                    { value: 'LOCAL_COMMUTE', label: '市内日常拜访', subLabel: '公司 ⇄ 客户 日常往返', icon: '🏢' }
                ]
            }
        });

        layout.push({
            id: 'grid-normal-inputs',
            type: 'grid',
            props: { columns: 2 },
            children: [
                {
                    id: 'input-company',
                    type: 'input',
                    bind: 'companyName',
                    props: { label: '公司基准地', placeholder: '默认 IVISION' }
                },
                {
                    id: 'input-customer',
                    type: 'input',
                    bind: 'customerName',
                    props: { label: '拜访客户名称', placeholder: '例如: 客户公司全称或简称' }
                },
                {
                    id: 'input-hotel',
                    type: 'input',
                    bind: 'hotelName',
                    props: { label: '入住酒店', placeholder: '例如: 某某酒店' }
                },
                {
                    id: 'input-station',
                    type: 'input',
                    bind: 'stationOrAirport',
                    props: { label: '机场/车站', placeholder: '例如: 机场 / 高铁站' }
                },
                {
                    id: 'input-project',
                    type: 'input',
                    bind: 'projectName',
                    props: { label: '关联项目 (可选)', placeholder: '例如: PRJ-2026-001' }
                },
                {
                    id: 'input-proxy',
                    type: 'input',
                    bind: 'proxyPersonName',
                    props: { label: '代外驻同事报销 (可选)', placeholder: '外驻同事姓名，如: 张三' }
                }
            ]
        });
    }

    if (planResult.hasConcurrentTolls && planResult.mergeTollsWithTaxi === undefined) {
        layout.push({
            id: 'alert-toll-inquiry',
            type: 'alert',
            props: {
                variant: 'warn',
                title: '❓ 发现有出租车发票同期的过路费是否合并生成？',
                message: `检测到发票清单中包含 <strong>${planResult.concurrentTollsCount || 1}</strong> 笔与出租车行程同期的过路费/通行费发票。您可以选择将过路费与出租车合并（1笔费用挂载2张发票），或独立逐条生成单笔费用。`
            }
        });
        layout.push({
            id: 'btn-group-toll-decision',
            type: 'button-group',
            children: [
                {
                    id: 'btn-merge-tolls',
                    type: 'button',
                    props: { label: '🛣️ 合并生成 (1笔费用含多张发票)', style: 'primary', actionKey: 'applyMergeTolls' }
                },
                {
                    id: 'btn-separate-tolls',
                    type: 'button',
                    props: { label: '📄 独立逐条生成 (每张独立单笔)', style: 'secondary', actionKey: 'applySeparateTolls' }
                }
            ]
        });
    } else if (planResult.boundTollsCount && planResult.boundTollsCount > 0) {
        layout.push({
            id: 'alert-toll-binding',
            type: 'alert',
            props: {
                variant: 'info',
                title: '🛣️ 过路费已智能合并绑定',
                message: `已自动将 <strong>${planResult.boundTollsCount}</strong> 张过路费/通行费发票按时间窗口合并至对应的出租车记录中（一笔费用合并多张发票）。如需改为独立生成，可随时切换。`
            }
        });
        layout.push({
            id: 'btn-group-toll-switch-sep',
            type: 'button-group',
            children: [
                {
                    id: 'btn-switch-to-separate',
                    type: 'button',
                    props: { label: '📄 切换为独立逐条生成', style: 'secondary', actionKey: 'applySeparateTolls' }
                }
            ]
        });
    } else if (planResult.mergeTollsWithTaxi === false && (planResult.concurrentTollsCount || 0) > 0) {
        layout.push({
            id: 'alert-toll-separate',
            type: 'alert',
            props: {
                variant: 'info',
                title: '📄 过路费已独立逐条生成',
                message: `已将 <strong>${planResult.concurrentTollsCount}</strong> 张过路费/通行费发票保持为独立单笔费用记录（每张发票独立单笔）。如需改为与出租车合并，可随时切换。`
            }
        });
        layout.push({
            id: 'btn-group-toll-switch-merge',
            type: 'button-group',
            children: [
                {
                    id: 'btn-switch-to-merge',
                    type: 'button',
                    props: { label: '🛣️ 切换为合并生成 (1笔多张发票)', style: 'secondary', actionKey: 'applyMergeTolls' }
                }
            ]
        });
    }

    // 底部操作按钮组
    layout.push({
        id: 'btn-group-actions',
        type: 'button-group',
        children: [
            {
                id: 'btn-reinfer',
                type: 'button',
                props: { label: '重新推断', icon: '✨', style: 'secondary', actionKey: 'reinfer' }
            },
            {
                id: 'btn-open-modal',
                type: 'button',
                props: { label: '打开批量助手', icon: '📋', style: 'secondary', actionKey: 'openModal' }
            },
            {
                id: 'btn-batch-save',
                type: 'button',
                props: { label: '一键批量保存', icon: '🚀', style: 'success', actionKey: 'batchSave' }
            }
        ]
    });

    // 表格预览
    layout.push({
        id: 'table-preview',
        type: 'table',
        props: {
            records: records.slice(0, 15),
            totalCount: records.length
        }
    });

    return {
        version: '1.0',
        id: `a2ui-exp-${Math.random().toString(36).slice(2, 8)}`,
        title: hasMatchedTrips ? '多波次出差行程与费用智能匹配' : '智能费用分类与行程推断',
        badge: hasMatchedTrips ? 'A2UI 智能规划 (多波次)' : 'A2UI 费用批量规划',
        description: hasMatchedTrips ? `共匹配 ${trips.length} 轮独立行程` : `共检测 ${records.length} 笔费用`,
        model,
        layout
    };
}

export interface RenderA2UiExpenseBatchOptions {
    container: HTMLElement;
    state: GlobalState;
    initialPlan?: ExpenseBatchPlanResult;
    onReinfer?: (newOptions: ExpensePlanOptions) => void;
    onOpenModal?: () => void;
    onBatchSave?: (targetIndices?: number[]) => Promise<void>;
}

/**
 * WebMCP A2UI 费用批量规划与行程推断交互组件 (由声明式 AST 驱动)
 */
export function renderA2UiExpenseBatchWidget(options: RenderA2UiExpenseBatchOptions): HTMLElement {
    const { container, state, initialPlan, onReinfer, onOpenModal, onBatchSave } = options;

    let currentPlan = initialPlan || state.expensePlan;
    if (!currentPlan && state.invoices && state.invoices.length > 0) {
        currentPlan = inferSmartExpensePlan(state.invoices, { tripType: 'AUTO' });
        state.expensePlan = currentPlan;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'webmcp-a2ui-widget-wrapper';

    const render = () => {
        wrapper.innerHTML = '';
        if (!currentPlan) return;
        const ast = generateExpenseBatchA2UiAST(currentPlan, state);
        currentPlan.a2uiAST = ast;

        const cardEl = renderA2UiFromAST(ast, {
            state,
            onAction: async (actionKey, model) => {
                if (actionKey === 'reinfer') {
                    const newOpts: ExpensePlanOptions = {
                        tripType: model.tripType,
                        companyName: model.companyName,
                        customerName: model.customerName,
                        hotelName: model.hotelName,
                        stationOrAirport: model.stationOrAirport,
                        projectName: model.projectName,
                        proxyPersonName: model.proxyPersonName,
                        customDescription: model.customDescription,
                        trips: currentPlan?.matchedTrips
                    };
                    currentPlan = inferSmartExpensePlan(state.invoices || [], newOpts);
                    state.expensePlan = currentPlan;
                    if (onReinfer) onReinfer(newOpts);
                    render();
                    showToast('success', `已根据最新输入重新推断 (规划 ${currentPlan.modifiedCount} 笔)`);
                } else if (actionKey === 'applyMergeTolls') {
                    const newOpts: ExpensePlanOptions = {
                        ...model,
                        mergeTollsWithTaxi: true,
                        trips: currentPlan?.matchedTrips
                    };
                    currentPlan = inferSmartExpensePlan(state.invoices || [], newOpts);
                    state.expensePlan = currentPlan;
                    render();
                    showToast('success', '已合并同期过路费与出租车发票（1笔费用挂载多张发票）');
                } else if (actionKey === 'applySeparateTolls') {
                    const newOpts: ExpensePlanOptions = {
                        ...model,
                        mergeTollsWithTaxi: false,
                        trips: currentPlan?.matchedTrips
                    };
                    currentPlan = inferSmartExpensePlan(state.invoices || [], newOpts);
                    state.expensePlan = currentPlan;
                    render();
                    showToast('info', '已按独立单笔费用生成过路费发票（每张发票独立单笔）');
                } else if (actionKey === 'openModal') {
                    if (onOpenModal) onOpenModal();
                    else {
                        const topDoc = (typeof window !== 'undefined' && window.top?.document) ? window.top.document : document;
                        import('./batchEditExpenseModal').then(m => m.openBatchEditExpenseModal(topDoc));
                    }
                } else if (actionKey === 'batchSave') {
                    try {
                        if (onBatchSave) {
                            await onBatchSave();
                        } else {
                            const sourceInvoices = state.expensePlan?.records || state.invoices || [];
                            const targets = sourceInvoices.filter(i => i.isModified || i.status === '就绪' || i.status === '待流转');
                            const fallbackTargets = targets.length > 0 ? targets : sourceInvoices;
                            if (fallbackTargets.length === 0) {
                                showToast('error', '批量保存失败: 没有找到可保存的费用记录，请先加载发票数据');
                                render();
                                return;
                            }
                            const res = await batchSaveExpenseItemsApi(fallbackTargets, state);
                            showToast('success', `批量保存完成！成功 ${res.successCount} 笔，失败 ${res.failCount} 笔`);
                        }
                        render();
                    } catch (err: any) {
                        showToast('error', `批量保存异常: ${err.message}`);
                    }
                }
            },
            onChange: (bindKey, value, model) => {
                // 如果用户切换了 tripType 模式，自动触发重新推断
                if (bindKey === 'tripType') {
                    const newOpts: ExpensePlanOptions = {
                        ...model,
                        tripType: value,
                        trips: currentPlan?.matchedTrips
                    };
                    currentPlan = inferSmartExpensePlan(state.invoices || [], newOpts);
                    state.expensePlan = currentPlan;
                    if (onReinfer) onReinfer(newOpts);
                    render();
                }
            }
        });

        wrapper.appendChild(cardEl);
    };

    render();
    container.appendChild(wrapper);
    return wrapper;
}


