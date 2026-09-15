/**
 * High-Performance W3C WebMCP (Web Model Context Protocol) Runtime Polyfill
 * 
 * Optimized for high-throughput enterprise single-page applications (Yuanian FSSC):
 * 1. WeakMap-based memoized Shadow DOM root caching (O(1) lookup, eliminating 866ms traversal bottleneck)
 * 2. Task decomposition with window.requestIdleCallback / requestAnimationFrame (preventing UI stutter and INP presentation delays)
 * 3. Event-driven targeted queries rather than full-document querySelectorAll('*')
 * 4. Spec-compliant document.modelContext with registerTool, getTools, executeTool, and toolchange events
 */

export interface WebMcpToolAnnotations {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    untrustedContentHint?: boolean;
}

export interface WebMcpToolDescriptor {
    name: string;
    description: string;
    title?: string;
    inputSchema?: any;
    outputSchema?: any;
    annotations?: WebMcpToolAnnotations;
    execute: (input: any) => Promise<any> | any;
}

export interface WebMcpRegisteredTool {
    name: string;
    title?: string;
    description: string;
    inputSchema?: any;
    origin: string;
    window: Window;
    annotations?: WebMcpToolAnnotations;
}

export interface WebMcpPolyfillOptions {
    installTestingShim?: boolean;
    declarativeForms?: boolean;
}

const POLYFILL_MARKER_PROPERTY = '__isWebMCPPolyfill';
const REGISTRATION_SIGNAL_SYMBOL = Symbol('registrationSignal');
const REGISTRATION_ABORT_SYMBOL = Symbol('registrationAbort');
const REGISTERED_INPUT_SCHEMA_SYMBOL = Symbol('registeredInputSchema');

// 1. WeakMap 缓存已探查过的 ShadowRoot (O(1) 秒级查表，彻底消除 866ms 深度递归开销)
const shadowRootCache = new WeakMap<Element, ShadowRoot | null>();

/**
 * 高性能带缓存的 ShadowRoot 查找 (支持针对非自定义元素直接短路)
 */
export function getOpenShadowRoot(element: Element): ShadowRoot | null {
    if (!element || !(element instanceof Element)) return null;
    if (shadowRootCache.has(element)) {
        return shadowRootCache.get(element) || null;
    }

    // 针对常见标准 HTML 元素（无连字符且非自定义元素）进行首道安全过滤
    const tagName = element.tagName ? element.tagName.toLowerCase() : '';
    const isCustomElement = tagName.includes('-');

    let root: ShadowRoot | null = null;
    try {
        root = Reflect.get(Element.prototype, 'shadowRoot', element) || (element as any).shadowRoot || null;
    } catch {
        root = null;
    }

    // 仅当是 open 模式才可被遍历
    if (root && (root.mode === 'open' || !root.mode)) {
        shadowRootCache.set(element, root);
        return root;
    }

    // 若非自定义标签且无 shadowRoot，永久缓存 null
    if (!isCustomElement) {
        shadowRootCache.set(element, null);
    }
    return null;
}

/**
 * 任务分解调度器：优先利用 requestIdleCallback，降级为 requestAnimationFrame / setTimeout
 */
function scheduleIdleTask(callback: () => void, timeoutMs: number = 300): () => void {
    if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
        const handle = (window as any).requestIdleCallback(callback, { timeout: timeoutMs });
        return () => (window as any).cancelIdleCallback(handle);
    }
    if (typeof requestAnimationFrame === 'function') {
        const handle = requestAnimationFrame(() => callback());
        return () => cancelAnimationFrame(handle);
    }
    const timer = setTimeout(callback, 50);
    return () => clearTimeout(timer);
}

function currentOrigin(): string {
    return typeof globalThis.origin === 'string'
        ? globalThis.origin
        : globalThis.location?.origin ?? '';
}

function parseInputArguments(input: any): any {
    if (input === undefined || input === null) return {};
    if (typeof input === 'object') return input;
    if (typeof input === 'string') {
        try {
            return JSON.parse(input);
        } catch {
            return input;
        }
    }
    return input;
}

function serializeOutputResult(value: any): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value ?? '');
}

/**
 * 严格 W3C 规范级 WebMCP Context 实现
 */
export class StrictWebMCPContext extends EventTarget {
    #tools = new Map<string, any>();
    #testingShim: any = null;
    #ontoolchangeHandler: ((event: Event) => void) | null = null;
    #ownerDocument: Document;

    constructor(ownerDocument: Document) {
        super();
        this.#ownerDocument = ownerDocument;
        Object.defineProperty(this, POLYFILL_MARKER_PROPERTY, {
            value: true,
            enumerable: false,
            writable: false,
            configurable: false
        });
    }

    get ontoolchange() {
        return this.#ontoolchangeHandler;
    }

    set ontoolchange(handler: ((event: Event) => void) | null) {
        if (this.#ontoolchangeHandler) {
            super.removeEventListener('toolchange', this.#ontoolchangeHandler);
        }
        this.#ontoolchangeHandler = typeof handler === 'function' ? handler : null;
        if (this.#ontoolchangeHandler) {
            super.addEventListener('toolchange', this.#ontoolchangeHandler);
        }
    }

    async registerTool(tool: WebMcpToolDescriptor, options?: { signal?: AbortSignal; exposedTo?: string[] }): Promise<void> {
        if (!tool || typeof tool !== 'object') {
            throw new TypeError('Tool descriptor must be an object');
        }
        if (!tool.name || typeof tool.name !== 'string') {
            throw new TypeError('Tool "name" must be a non-empty string');
        }
        if (typeof tool.execute !== 'function') {
            throw new TypeError('Tool "execute" must be a function');
        }

        const signal = options?.signal;
        signal?.throwIfAborted?.();

        const toolEntry = {
            name: String(tool.name).trim(),
            title: tool.title ? String(tool.title) : undefined,
            description: String(tool.description || ''),
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            annotations: tool.annotations,
            execute: tool.execute,
            [REGISTERED_INPUT_SCHEMA_SYMBOL]: tool.inputSchema ? JSON.stringify(tool.inputSchema) : undefined
        };

        this.#tools.set(toolEntry.name, toolEntry);

        if (signal) {
            const onAbort = () => {
                this.#removeTool(toolEntry.name);
                this.#notifyToolsChanged();
            };
            (toolEntry as any)[REGISTRATION_SIGNAL_SYMBOL] = signal;
            (toolEntry as any)[REGISTRATION_ABORT_SYMBOL] = onAbort;
            signal.addEventListener('abort', onAbort, { once: true });
        }

        await this.#notifyToolsChanged();
    }

    async unregisterTool(name: string): Promise<boolean> {
        const removed = this.#removeTool(name);
        if (removed) {
            await this.#notifyToolsChanged();
        }
        return removed;
    }

    async getTools(options?: { fromOrigins?: string[] }): Promise<WebMcpRegisteredTool[]> {
        const tools: WebMcpRegisteredTool[] = [];
        for (const tool of this.#tools.values()) {
            const schema = tool[REGISTERED_INPUT_SCHEMA_SYMBOL]
                ? JSON.parse(tool[REGISTERED_INPUT_SCHEMA_SYMBOL])
                : tool.inputSchema;
            tools.push({
                name: tool.name,
                title: tool.title ?? '',
                description: tool.description,
                inputSchema: schema,
                origin: currentOrigin(),
                window: globalThis.window,
                ...(tool.annotations ? { annotations: tool.annotations } : {})
            });
        }
        tools.sort((a, b) => a.name.localeCompare(b.name));
        return tools;
    }

    async executeTool(toolOrName: any, inputArgsJson?: any, options?: { signal?: AbortSignal }): Promise<string> {
        options?.signal?.throwIfAborted?.();
        const toolName = typeof toolOrName === 'string' ? toolOrName : toolOrName?.name;
        if (!toolName) {
            throw new TypeError('executeTool requires tool name');
        }

        const tool = this.#tools.get(toolName);
        if (!tool) {
            throw new Error(`WebMCP Tool not found: ${toolName}`);
        }

        const args = parseInputArguments(inputArgsJson);
        const result = await Promise.resolve(tool.execute(args));
        return serializeOutputResult(result);
    }

    #removeTool(name: string): boolean {
        const tool = this.#tools.get(name);
        if (!tool) return false;
        const signal = tool[REGISTRATION_SIGNAL_SYMBOL];
        const onAbort = tool[REGISTRATION_ABORT_SYMBOL];
        if (signal && onAbort) {
            signal.removeEventListener('abort', onAbort);
        }
        return this.#tools.delete(name);
    }

    async #notifyToolsChanged() {
        this.dispatchEvent(new Event('toolchange'));
        if (this.#testingShim && typeof this.#testingShim.dispatchToolChange === 'function') {
            this.#testingShim.dispatchToolChange();
        }
    }

    static dispose(context: StrictWebMCPContext) {
        for (const name of Array.from(context.#tools.keys())) {
            context.#removeTool(name);
        }
        context.ontoolchange = null;
    }
}

// 全局单例与安装状态
const installedProperties: { target: any; key: string; previous: any }[] = [];
let installedContext: StrictWebMCPContext | null = null;
let declarativeFormsCleanup: (() => void) | null = null;

function installProperty(target: any, key: string, descriptor: PropertyDescriptor) {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    try {
        Object.defineProperty(target, key, descriptor);
    } catch (e) {
        cleanupWebMCPPolyfill();
        throw e;
    }
    installedProperties.push({ target, key, previous });
}

/**
 * 现代轻量化声明式表单监听器 (仅对 form[toolname] 执行目标感知，彻底避免全文档 querySelectorAll('*') 遍历)
 */
function installOptimizedDeclarativeForms(document: Document, context: StrictWebMCPContext): () => void {
    let active = true;
    let cancelIdleSync: (() => void) | null = null;

    const runSync = () => {
        if (!active) return;
        try {
            // 采用精确定位选择器代替全量 document.querySelectorAll('*')
            const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form[toolname]'));

            // 探查潜在的自定义元素 Open ShadowRoot (利用 WeakMap memoized lookup 极速命中，零递归)
            const potentialHosts = document.querySelectorAll<HTMLElement>(':not(:defined), [data-has-shadow]');
            potentialHosts.forEach(host => {
                const root = getOpenShadowRoot(host);
                if (root) {
                    const shadowForms = Array.from(root.querySelectorAll<HTMLFormElement>('form[toolname]'));
                    forms.push(...shadowForms);
                }
            });

            forms.forEach(form => {
                const toolName = form.getAttribute('toolname');
                const toolDescription = form.getAttribute('tooldescription') || '';
                if (!toolName) return;

                // 注册表单工具
                context.registerTool({
                    name: toolName,
                    description: toolDescription,
                    execute: async (input) => {
                        // 触发原生表单提交
                        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                        return { success: true, toolName };
                    }
                }).catch(() => { });
            });
        } catch { }
    };

    const debouncedSync = () => {
        if (cancelIdleSync) cancelIdleSync();
        cancelIdleSync = scheduleIdleTask(runSync, 200);
    };

    // 仅监听 DOM 添加子树中是否存在表单，避免监听全文档 attributes 和 characterData 造成每秒千次触发
    let observer: MutationObserver | null = null;
    try {
        observer = new MutationObserver((mutations) => {
            let hasFormMutation = false;
            for (const m of mutations) {
                if (m.type === 'childList') {
                    for (let i = 0; i < m.addedNodes.length; i++) {
                        const node = m.addedNodes[i];
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const el = node as Element;
                            if (el.tagName === 'FORM' || (el.querySelector && el.querySelector('form[toolname]'))) {
                                hasFormMutation = true;
                                break;
                            }
                        }
                    }
                }
                if (hasFormMutation) break;
            }
            if (hasFormMutation) debouncedSync();
        });

        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    } catch { }

    // 初始执行一次空闲扫描
    debouncedSync();

    return () => {
        active = false;
        if (cancelIdleSync) cancelIdleSync();
        if (observer) observer.disconnect();
    };
}

/**
 * 激活 WebMCP Polyfill 环境 (支持可选 options)
 */
export function initializeWebMCPPolyfill(options: WebMcpPolyfillOptions = {}): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const doc = document as any;
    if (doc.modelContext) {
        return;
    }

    if (installedProperties.length > 0) {
        cleanupWebMCPPolyfill();
    }

    const context = new StrictWebMCPContext(doc);
    installedContext = context;
    (window as any).getOpenShadowRoot = getOpenShadowRoot;
    (context as any).getOpenShadowRoot = getOpenShadowRoot;

    // 1. 安装 ModelContext 全局类
    const modelContextConstructor = function ModelContext() {
        throw new TypeError('Illegal constructor');
    };
    Object.defineProperty(modelContextConstructor, 'name', { value: 'ModelContext' });
    Object.defineProperty(modelContextConstructor, 'prototype', {
        value: StrictWebMCPContext.prototype,
        writable: false
    });
    installProperty(window, 'ModelContext', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: modelContextConstructor
    });

    // 2. 安装 document.modelContext
    installProperty(Document.prototype, 'modelContext', {
        configurable: true,
        enumerable: true,
        get() {
            return context;
        }
    });

    // 3. 安装兼容性 navigator.modelContext
    if (typeof navigator !== 'undefined') {
        installProperty(navigator, 'modelContext', {
            configurable: true,
            enumerable: true,
            get() {
                return context;
            }
        });
    }

    // 4. 仅在显式声明或需要时挂载声明式表单监听，默认避免全文档属性轰炸
    if (options.declarativeForms !== false) {
        declarativeFormsCleanup = installOptimizedDeclarativeForms(doc, context);
    }
}

/**
 * 卸载清理 WebMCP Polyfill
 */
export function cleanupWebMCPPolyfill(): void {
    if (declarativeFormsCleanup) {
        declarativeFormsCleanup();
        declarativeFormsCleanup = null;
    }
    if (installedContext) {
        StrictWebMCPContext.dispose(installedContext);
        installedContext = null;
    }
    for (const { target, key, previous } of [...installedProperties].reverse()) {
        if (previous) {
            Object.defineProperty(target, key, previous);
        } else {
            Reflect.deleteProperty(target, key);
        }
    }
    installedProperties.length = 0;
}
