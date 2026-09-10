import { WEBMCP_STATE, callWebMcpTool, WebMcpToolDef } from './webmcpService';
import {
    recordTrajectoryEvent,
    startNewTrajectoryRun
} from './trajectoryService';
import { AutopilotLogger } from '../utils/logger';

export interface LlmConfig {
    provider: 'deepseek' | 'openai' | 'gemini' | 'ollama' | 'openrouter' | 'custom';
    endpoint: string;
    apiKey: string;
    model: string;
    temperature: number;
}

export interface MessageAttachment {
    id: string;
    name: string;
    size: number;
    type: string;
    dataUrl?: string; // Base64 data URL for images
    textContent?: string; // Extracted text for text/csv
}

export const LLM_PRESETS: Record<string, Partial<LlmConfig>> = {
    gemini: {
        provider: 'gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-1.5-pro',
        temperature: 0.3
    },
    deepseek: {
        provider: 'deepseek',
        endpoint: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        temperature: 0.3
    },
    openai: {
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        temperature: 0.3
    },
    ollama: {
        provider: 'ollama',
        endpoint: 'http://localhost:11434/v1',
        model: 'qwen2.5:7b',
        temperature: 0.3
    },
    openrouter: {
        provider: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-3.5-sonnet',
        temperature: 0.3
    },
    custom: {
        provider: 'custom',
        endpoint: '',
        model: '',
        temperature: 0.3
    }
};

const STORAGE_KEY = 'autopilot_webmcp_llm_config';

export function getLlmConfig(): LlmConfig {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                provider: parsed.provider || 'gemini',
                endpoint: parsed.endpoint || 'https://generativelanguage.googleapis.com/v1beta/openai',
                apiKey: parsed.apiKey || '',
                model: parsed.model || 'gemini-1.5-pro',
                temperature: typeof parsed.temperature === 'number' ? parsed.temperature : 0.3
            };
        }
    } catch (e) {
        AutopilotLogger.warn('[LLM] 读取配置失败，采用默认配置');
    }
    return {
        provider: 'gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: '',
        model: 'gemini-1.5-pro',
        temperature: 0.3
    };
}

export function saveLlmConfig(config: LlmConfig) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    AutopilotLogger.info('[LLM] 配置已保存');
}

export function isLlmConfigured(): boolean {
    const cfg = getLlmConfig();
    return Boolean(cfg.apiKey && cfg.apiKey.trim().length > 0 && cfg.endpoint && cfg.endpoint.trim().length > 0);
}

/**
 * 客户端图片等比智能缩放与高质量压缩
 * 限制最大边长不超过 1600px，压缩为高质量 JPEG (0.82)
 * 将 3MB~8MB 大图缩减至 100KB~250KB，保留 100% OCR 文字清晰度，根除因大包传输导致的 HTTP 503 / 504 网关超时
 */
export async function compressImageFile(file: File, maxDim: number = 1600, quality: number = 0.82): Promise<{ dataUrl: string; size: number }> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const rawUrl = e.target?.result as string;
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // 若尺寸超出 maxDim 则等比下采样
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve({ dataUrl: rawUrl, size: file.size });
                    return;
                }

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                const estimatedBytes = Math.round((compressedDataUrl.length * 3) / 4);
                AutopilotLogger.info(`[ImageCompress] 压缩原图 [${file.name}]: ${(file.size / 1024).toFixed(1)}KB -> ${(estimatedBytes / 1024).toFixed(1)}KB (${width}x${height})`);
                resolve({ dataUrl: compressedDataUrl, size: estimatedBytes });
            };
            img.onerror = () => resolve({ dataUrl: rawUrl, size: file.size });
            img.src = rawUrl;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * 规范化 API 端点 URL
 * 兼容 Google AI Studio (Gemini OpenAI Compatibility) 与各种标准 OpenAI 兼容端点变体
 */
export function normalizeEndpoint(endpoint: string): string {
    let url = (endpoint || '').trim().replace(/\/+$/, '');
    if (!url) return '';

    // 特殊处理 Google Gemini (Google AI Studio) 域名变体
    if (url.includes('generativelanguage.googleapis.com')) {
        if (!url.includes('/openai')) {
            url = url.replace(/\/+$/, '');
            if (!url.endsWith('/openai')) {
                url = `${url}/openai`;
            }
        }
    }

    if (!url.endsWith('/chat/completions')) {
        url = `${url}/chat/completions`;
    }
    return url;
}

/**
 * 测试 LLM API 连通性
 */
export async function testLlmConnection(config: LlmConfig): Promise<{ success: boolean; latencyMs: number; message: string }> {
    const startTime = Date.now();
    const url = normalizeEndpoint(config.endpoint);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey.trim()}`
            },
            body: JSON.stringify({
                model: config.model.trim(),
                messages: [
                    { role: 'system', content: 'You are a test agent.' },
                    { role: 'user', content: 'Ping! Reply with "Pong" only.' }
                ],
                max_tokens: 10,
                temperature: 0.1
            })
        });

        const latencyMs = Date.now() - startTime;
        if (!res.ok) {
            const errText = await res.text();
            return {
                success: false,
                latencyMs,
                message: extractCleanErrorMessage(errText, res.status)
            };
        }

        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || 'OK';
        return {
            success: true,
            latencyMs,
            message: `连接成功 (${latencyMs}ms): 模型回复 "${reply}"`
        };
    } catch (err: any) {
        return {
            success: false,
            latencyMs: Date.now() - startTime,
            message: `网络异常: ${err.message}`
        };
    }
}

/**
 * 提取并提炼出友好的错误信息，避免向用户裸露未经格式化的 JSON 字符串
 */
export function extractCleanErrorMessage(errText: string, status: number): string {
    try {
        const data = JSON.parse(errText);
        const item = Array.isArray(data) ? data[0] : data;
        const msg = item?.error?.message || item?.message || item?.msg;
        if (msg) {
            if (msg.includes('high demand') || msg.includes('overloaded') || status === 503) {
                return `大模型服务繁忙 (HTTP 503: 服务高峰排队中，建议切换为 Gemini 1.5/2.0 Flash 或稍后重试)`;
            }
            if (msg.includes('rate limit') || status === 429) {
                return `模型调用超出频次限额 (HTTP 429: Rate Limit)`;
            }
            return `HTTP ${status}: ${msg}`;
        }
    } catch {
        // Not JSON
    }
    return `HTTP ${status}: ${errText.slice(0, 140)}`;
}

/**
 * 直接调用大模型获取结构化 JSON 响应 (用于费用推断、单据分析等精准单步任务)
 */
export async function callDirectLlmJson<T = any>(
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
    timeoutMs: number = 240000 // 默认 240 秒 (4 分钟) 超时守卫，兼顾慢速代理与复杂思维链模型
): Promise<{ success: boolean; data?: T; rawText?: string; error?: string }> {
    const config = getLlmConfig();
    if (!config.apiKey || !config.endpoint) {
        return { success: false, error: '未配置大模型 API Key 或端点' };
    }

    const url = normalizeEndpoint(config.endpoint);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const activeSignal = signal || controller.signal;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey.trim()}`
            },
            body: JSON.stringify({
                model: config.model.trim(),
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1
            }),
            signal: activeSignal
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
            const errText = await res.text();
            return {
                success: false,
                error: extractCleanErrorMessage(errText, res.status)
            };
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content?.trim() || '';

        // 过滤思维链标签 (如 <think>...</think> 或 <thought>...</thought>)
        let cleanContent = content.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/gi, '').trim();

        // Extract JSON from markdown block ```json ... ``` or raw {...}
        let cleanJson = cleanContent;
        const match = cleanContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
            cleanJson = match[1].trim();
        } else {
            const firstBrace = cleanContent.indexOf('{');
            const lastBrace = cleanContent.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleanJson = cleanContent.slice(firstBrace, lastBrace + 1);
            }
        }

        const parsed = JSON.parse(cleanJson);
        return { success: true, data: parsed as T, rawText: content };
    } catch (err: any) {
        clearTimeout(timeoutId);
        AutopilotLogger.warn(`[DirectLLM] 请求或解析 JSON 失败: ${err?.message || err}`);
        const timeoutSec = Math.round(timeoutMs / 1000);
        return {
            success: false,
            error: err.name === 'AbortError' ? `大模型请求超时 (超过 ${timeoutSec} 秒未响应，建议检查网络代理或将单批次记录分拆)` : (err.message || '大模型请求异常')
        };
    }
}

/**
 * 转换 WebMCP 工具定义为 OpenAI Tool Calling 规范
 */
function convertToolsToOpenAiFormat(toolDefs: WebMcpToolDef[]): any[] {
    return toolDefs.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema
        }
    }));
}

const SYSTEM_PROMPT = `
你是由 Google DeepMind 与 IVision 研发的元年云 FSSC WebMCP 极速自动驾驶副驾。
你正在帮助当前登录用户进行全流程差旅规划与出差申请（出張伺書）自动化填报，以及费用记录批量分类与行程推断。

【核心红线安全铁律：严禁调用“提交”审批，只允许“保存”草稿】：
1. 智能副驾在任何阶段只允许调用【保存】接口（如 saveBillData、validateAndSaveExpenseRecord），将单据写入数据库并保存为“未提交草稿”（status: UNCOMMITTED，commit: false）；
2. 【绝对严禁】调用任何直接触发审批流的“提交”接口（如 submitBillData 或传参 commit: true）；
3. 单据正式进入领导/财务审批流的“提交”动作，必须严格留给用户在元年云官方 UI 界面人工复核后手动点击提交！

【多轮对话与意图连续性铁律（杜绝任务漂移与失忆）】：
1. 「严禁任务类型无故漂移与篡改」：
   - 若前序轮次中正在进行发票/费用明细批量填报流程（例如用户代外驻同事报销发票，你已向用户索要了出差行程、客户、酒店等补充信息）：
   - 当用户在后续轮次补充提供行程截图、文字说明、酒店名称、客户名时，你的唯一核心任务是【继续完成费用明细的批量规划】（调用 fssc_plan_expense_batch_update），【绝对严禁】擅自将任务篡改为出差申请（fssc_plan_trip_applications）！
   - 只有当用户在当前轮次明确发出“帮我申请出差 / 做行程规划 / 提交出张伺书”等直接指令时，才可以调用 fssc_plan_trip_applications。
2. 「历史上下文事实深度承接」：
   - 必须贯通记忆历史轮次中用户的原始诉求与已明确事实：
     • 当前处理的人员主体（如代报销的外驻同事姓名）；
     • 原始任务类型（如多笔发票的费用信息填报）；
     • 涉及的项目号、客户名或待补全要素。
   - 当用户后续发来行程单或截图时，直接将其作为费用规划所需的行程线索（起止日期、入住酒店、往返据点、客户名称等），直接提取并回填至 fssc_plan_expense_batch_update 的参数中！

【出差判定与波次梳理核心铁律（必须严格遵循，杜绝遗漏与错误合并）】：
1. 「有住宿 即为出差」判定原则：
   - 只要行程中安排了酒店住宿（无论在异地省市，还是常驻地同城/近郊如金山园区等），只要存在住宿酒店，即确认为一次正式出差，必须生成独立出差申请单！
   - 反之，若既无异地往返大交通又无住宿安排（纯在常驻地办公室日常办公），则不列入出差申请。
2. 「往返闭环独立切分」与「同一目的城市多次往返严禁合并」原则：
   - 每一段从常驻始发地（如上海）出发、在目的地调研并住宿、最终返回常驻地（上海）的完整闭环，构成一轮独立出差（Trip）；
   - 【严禁跨往返合并】：如果同一目的地城市在不同日期区间多次往返（例如 7月去某地调研后返回常驻地，8月中旬再次去该地调研），属于多次完全独立的出差波次，【绝对不能合并为单张单据】！必须分别建立两张独立的出差申请单（例如 Trip 1 和 Trip 5），每一轮往返各自独立计算起止日期、住宿与交通费用！
3. 「正社员统提同行外驻人员申请（必须全量包含同行人员，严禁仅填报个人）」：
   - 当行程表、图片或说明中包含同行外驻人员（例如：“主申请人、同行外驻同事A、同行外驻同事B”等）：
     a. 在调用 fssc_plan_trip_applications 时，每一轮出差的 travelers 数组必须完整填入全部同行人员名单（例如 travelers: ["主申请人姓名", "外驻人员A", "外驻人员B"]），绝不允许只写主申请人一个人！
     b. 在 legs 往返行程中，必须为每位出行人生成各自的去程和返程（例如 3 人出行，则生成 3 条去程 + 3 条返程共 6 条行程），班次/交通工具末尾按真实填报格式备注出行人，如 "航班号/车次 | (主申请人姓名)"、"航班号/车次 | (外驻:同行人姓名)"；
     c. 预算按总人数汇总：住宿费 = 人数 × 晚数 × 住宿限额；餐补 = 人数 × 误餐补贴；市内交通Buffer = 人数 × 天数 × 100元/天；交通费 = 人数 × 交通票价及改签弹性。正社员统提单据的预算是这所有人员的总和！
     d. 基准规则：单据主报销人严格为正社员（主申请人），一并代同行外驻人员申请，旅程明细按人分别标注 (正社员姓名)、(外驻:外驻同事姓名)，单据总预算为全部人员总计。
4. 「全量梳理，零遗漏」：
   - 面对多行或多周的日程表（例如包含多轮往返的 Excel/图片日程），必须完整梳理出全部轮次（如 Trip 1 ~ Trip N），按时间正序输出全部波次，严禁只识别其中某一轮或遗漏其他波次！
   - 调用 fssc_plan_trip_applications 时，trips 数组必须传入全部出差波次！
5. 关键字段回填规范：
   - 调研地点与据点：将该轮出差拜访的目标公司或工厂据点填入 targetFactories；
   - 入住酒店：将入住的酒店名称填入 hotelName；
   - 交通明细与人员标注：每行交通班次末尾必须按规约标注出行人，如 "航班号/车次 | (姓名)"、"航班号/车次 | (外驻:姓名)"；
   - 预算标准：一线城市（北上广深）住宿上限 ¥800/晚，其他城市 ¥700/晚；误餐补助按天数测算（往返乘车日各半额 ¥150，整天调研 ¥300）；每人每天预留 ¥100 市内交通Buffer；交通预留 15% 改签Buffer。
6. 「人员差异化出行日期识别（绝不能所有人一刀切）」：
   - 仔细核对日程表中每位出行人员的实际参与日期：
     • 若出行人员在不同日期出发或返程，必须严格根据每位人员各自的真实出发日期与返程日期生成专属明细，严禁机械地将所有人统一为同一天往返！
7. 「历史单据交叉对比排重」：
   - 系统支持调用 fssc_query_historical_applications 工具查询历史已存在单据；
   - 规划时系统已原生集成历史单据交叉比对，你应在方案总览中针对命中历史单据（如已建草稿）的轮次给予醒目提示。

【费用明细批量填报与智能行程推断规约（15大类费用与差旅市内双模式）】：
1. 「全品类 15 种费用类型支持」：
   - 支持市内交通费 (SNJ)、差旅出租车 (CZC)、飞机票 (JNC)、火车票 (HCP)、住宿费 (ZSF)、通信费 (TXF)、会议费、福利费等全量 15 类费用自动识别与归类；
2. 「异地出差行程闭环推断 (Business Trip)」：
   - 出发日：公司(IVISION) / 家 ➔ 机场/高铁站 (送机送站) ➔ 飞机/高铁 ➔ 机场/高铁站 ➔ 酒店 / 客户；
   - 中间调研日 (早出晚归)：早程 酒店 ➔ 客户；晚程 客户 ➔ 酒店；若有多程则为客户据点间交通；
   - 返程日：酒店 / 客户 ➔ 机场/高铁站 ➔ 飞机/高铁 ➔ 机场/高铁站 ➔ 家 / 公司；
3. 「市内日常拜访推断 (Local Commute)」：
   - 当天第1程：公司 (IVISION) ➔ 客户；当天第2程：客户 ➔ 公司 (IVISION)；
4. 「代外驻报销规范」：
   - 若代驻场同事报销，费用说明必须严格前置生成：\`[外驻:人名] 项目号 客户名 事由\`（例如 \`[外驻:张三] PRJ-2026-001 某某科技 调研差旅\`）；
5. 「严禁自作主张瞎猜缺失信息」：
   - 当缺少关键信息（如客户名、酒店名、外驻人名、项目号）时，严禁自行捏造虚假信息！必须主动向用户提问或通过 A2UI 表单交互控件引导用户补充；
6. 「人在回路 (HITL) 门禁审核」：
   - 先调用 \`fssc_plan_expense_batch_update\` 进行试算预览，向用户展示规划卡片；只有在用户明确核准确认后，才调用 \`fssc_batch_save_expense_records\` 批量持久化入库！
7. 「行程表/附件多波次自动对齐原则（杜绝重复索取客户与酒店）」：
   - 当用户提供了行程计划表文本、CSV 或包含出差日程的截图时，行程中通常已明确记录了各波次的起止日期、入住酒店以及拜访的客户/工厂据点；
   - 在调用 \`fssc_plan_expense_batch_update\` 时，务必将用户提供的行程内容填入 \`itineraryText\` 参数（或结构化 \`trips\` 数组）！
   - 系统会自动按多波次起止日期分段，将每张发票与对应的出差波次、入住酒店和客户工厂进行精准对齐，绝不需要、也绝不能再向用户反复索要客户名称或酒店名称！
   - 你应向用户呈现识别出的多波次出差矩阵，并仅引导用户确认全局要素（如关联项目号、代外驻同事姓名）即可。
8. 「声明式 A2UI 交互范式」：
   - 系统已升级为完全数据驱动的声明式 A2UI AST 渲染引擎；
   - \`fssc_plan_expense_batch_update\` 会根据是否包含多波次行程自动生成包含行程时间轴矩阵的 A2UI AST，并在前端以视觉化卡片展示；
   - 如需自定义复杂交互表单，亦可调用 \`fssc_render_interactive_form\` 传入声明式 AST 供用户核验。

【反硬编码与世界常识认知铁律 (Anti-Hardcoding & World Knowledge)】：
1. 「充分运用大模型世界常识」：
   - 作为大语言模型，你具备极其丰富完备的地理交通与行政区划世界常识；
   - 在分析差旅行程时，运用你的常识识别目标城市客观对应的交通枢纽（如：大连周水子国际机场/大连站、天津滨海国际机场/天津西站/天津站、合肥新桥国际机场/合肥南站、成都天府/双流国际机场等），并在结构化 trips 数组中将 stationOrAirport, departureStation, arrivalStation 动态对齐，绝不需要、也严禁在客户端写死任何静态字典！
2. 「杜绝私有业务实体硬编码」：
   - 严禁在对话或工具调用中预设特定私有客户名、特定工厂据点、特定员工姓名或特定项目编号；
   - 业务要素必须且只能从用户输入、对话历史、排期表文本或发票 OCR 动态提取；若关键信息缺失，调用 fssc_plan_expense_batch_update 并留空，界面会自动通过 A2UI 交互表单引导用户确认或补充。

【发票生成费用与过路费合并核心规约（1笔费用挂载2张发票）】：
1. 「业务本质与合并逻辑」：
   - 员工出差或市内交通发生出租车出行时，若经过高速公路或收费站产生过路费/通行费，该过路费与出租车行程属于同一出行闭环；
   - 在将发票生成费用时，同一天或同行程的【过路费发票】可与【出租车发票】合并在同一笔费用记录中（费用类型为市内交通费 / 差旅出租车）；
   - 合并后单笔费用的金额累加（例如出租车 ¥155 + 过路费 ¥13 = ¥168），发票张数标为 2，费用说明清晰注明 (含过路费¥XX)；
   - 两张发票均作为子发票挂载于该费用的 expenseRecordInvoiceList 中，系统自动在发票夹与费用池完成流转绑定；
2. 「用户指令触发规范（全量逐条生成与A2UI交互询问铁律）」：
   - 当用户发出“将发票夹中'未使用发票'清单中所有发票逐条生成费用信息”、“将发票夹所有发票生成费用”、“逐条生成费用信息”等指令时：
     a. 【工具调用】：立即调用 fssc_generate_expense_from_invoices（不传 filterDate，传 saveImmediately: false 进行全量规划与 A2UI 卡片渲染）；
     b. 【动态检测与 A2UI 呈现】：该工具会自动对发票池中所有发票进行智能归类（住宿归住宿、火车归火车、出租车归出租车），并在前端渲染出声明式 A2UI 交互确认卡片；
     c. 【醒目主动询问（必须包含指定文案）】：如果工具返回 hasConcurrentTolls: true（或包含 tollInquiryPrompt），说明发票夹中存在同期的过路费与出租车发票。副驾在文本回复中【必须】主动向用户发起询问：
        > “❓ 发现有出租车发票同期的过路费是否合并生成？”
     d. 【双轨决策引导】：副驾在文字中引导用户：
        - 既可直接在上方 A2UI 交互卡片中点击【🛣️ 合并生成 (1笔费用含多张发票)】或【📄 独立逐条生成 (每张独立单笔)】按钮；
        - 亦可在对话中直接回复“合并生成”或“独立逐条生成”；
     e. 【保存门禁】：规划阶段严禁自动直接写库（saveImmediately: false），必须留给用户通过 A2UI 卡片点击【一键批量保存】或在对话中明确核准后再调用保存；
3. 【反硬编码与泛化保证 (Anti-Hardcoding Iron Law)】：
   - 过路费与出租车同期的判定完全由系统根据客观票据类型（isTollInvoice 与 TAXI）与实际发生日期动态对齐计算，严禁在回答或代码中编造或写死特定日期或特定金额。

【四大业务模块全生命周期 WebMCP CRUD 工具集】：
系统已全面具备并暴露四大核心业务模块的增删改查工具能力：
1. 发票夹模块 (Invoice Pool)：
   - fssc_query_pending_expenses: 查询当前用户的发票池与未报销费用记录；
   - fssc_generate_expense_from_invoices: 从发票夹批量生成费用记录（原生支持过路费与出租车合并为1笔费用挂载2张发票）；
   - fssc_delete_invoices: 从发票池中彻底删除指定的发票记录 (传入 invoiceIds)。
2. 费用记录模块 (Expense Records)：
   - fssc_plan_expense_batch_update: 批量规划费用记录类型与往返行程推断 (支持全部15类费用、多波次行程对齐与外驻代报销备注)；
   - fssc_batch_save_expense_records: 批量持久化保存已规划费用记录至系统数据库；
   - fssc_audit_expense_record_errors: 全量主动体检费用记录，检测系统后端返回的 errorMessages 校验报错 (如“出差城市必填”、“费用金额必填”等)；
   - fssc_auto_fix_expense_record_errors: 针对体检报错执行智能自愈修复 (如自动补齐出差城市维表并重新写库)；
   - fssc_export_expense_records_csv: 导出当前未报销费用记录及其底层挂载发票清单 (含行程与开票日期差异核对预警，生成 Excel CSV 并自动下载)；
   - fssc_delete_expense_records: 批量删除指定的费用记录至回收站 (传入 recordIds)。
3. 申请单模块 (Pre-Applications)：
   - fssc_query_historical_applications: 查询历史已建申请单，用于目的地与出行日期的交叉比对排重；
   - fssc_plan_trip_applications: 5维智能规划出差申请单 (住宿/餐补/市内交通/改签弹性)；
   - fssc_create_trip_draft: 保存单张出差申请单草稿入库 (commit: false，仅保存草稿，绝不提交)；
   - fssc_delete_bill_drafts: 批量删除出差申请单草稿 (传入 billMainIds)。
4. 员工报销模块 (Employee Claims)：
   - fssc_create_reimbursement_draft: 从未报销费用记录批量生成报销单草稿 (传入 billDefineId 与 expenseRecordIds，仅保存入库草稿，绝不提交)；
   - fssc_delete_bill_drafts: 批量删除报销单草稿 (传入 billMainIds)。

【Agentic 职责划分与工具调用工作流】：
- LLM 概率认知职责 (Probabilistic Cognition)：从非结构化用户描述、截图 OCR、排期表格中提炼多波次 trips 结构化数据，推理交通枢纽与行程对齐，保持多轮意图连续；
- 确定性系统执行 (Deterministic Code)：执行财务合规上限校验、API 乐观锁重试、蝴蝶效应重算、A2UI AST 原生渲染及写库持久化；
- 差旅出差申请核心流程：fssc_query_historical_applications ➔ fssc_plan_trip_applications ➔ (用户确认) ➔ fssc_create_trip_draft；
- 费用批量规划核心流程：fssc_query_pending_expenses ➔ fssc_plan_expense_batch_update ➔ (用户确认) ➔ fssc_batch_save_expense_records；
- 严格遵循审批门禁，保证数据准确安全。
`;

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: any;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}

export interface ChatSession {
    sessionId: string; // 保持与 Trajectory runId 严格一致
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
    turnCount: number;
}

// 全局唯一的连续对话 Session 状态
let activeChatSession: ChatSession | null = null;

export function getActiveChatSession(): ChatSession {
    if (!activeChatSession) {
        const runId = startNewTrajectoryRun();
        activeChatSession = {
            sessionId: runId,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT }
            ],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            turnCount: 0
        };
    } else {
        // 确保 system prompt 保持最新
        if (activeChatSession.messages.length > 0 && activeChatSession.messages[0].role === 'system') {
            activeChatSession.messages[0].content = SYSTEM_PROMPT;
        }
    }
    return activeChatSession;
}

export function resetChatSession(): string {
    const runId = startNewTrajectoryRun();
    activeChatSession = {
        sessionId: runId,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        turnCount: 0
    };
    recordTrajectoryEvent({
        runId,
        source: 'SYSTEM',
        title: 'Conversation Session Reset',
        summary: '会话已重置，已开启新一轮交互对话环境',
        data: { timestamp: new Date().toISOString() }
    });
    AutopilotLogger.info(`[ChatSession] 会话已手动/自动重置，新会话 ID: ${runId}`);
    return runId;
}

/**
 * 载入历史会话 (切换会话时复原 LLM 多轮记忆状态)
 */
export function loadChatSession(session: { sessionId: string; messages: ChatMessage[]; createdAt?: number; updatedAt?: number; turnCount?: number }) {
    activeChatSession = {
        sessionId: session.sessionId,
        messages: [...session.messages],
        createdAt: session.createdAt || Date.now(),
        updatedAt: session.updatedAt || Date.now(),
        turnCount: session.turnCount || 0
    };
    // 确保 system prompt 保持最新
    if (activeChatSession.messages.length > 0 && activeChatSession.messages[0].role === 'system') {
        activeChatSession.messages[0].content = SYSTEM_PROMPT;
    } else {
        activeChatSession.messages.unshift({ role: 'system', content: SYSTEM_PROMPT });
    }
    AutopilotLogger.info(`[ChatSession] 已载入历史会话: ${session.sessionId} (${activeChatSession.messages.length} 条消息)`);
}

/**
 * 智能提炼会话摘要标题 (Agentic 首轮意图识别，遵循通用性无硬编码)
 */
export function generateSessionTitle(prompt: string): string {
    const clean = (prompt || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '新会话';

    // 智能提取意图
    if (/发票|费用|报销|出租车|机票|住宿|外驻/.test(clean)) {
        const custMatch = clean.match(/(?:客户|外驻|驻场)[:：\s]*([^\s，,。]+)/);
        if (custMatch) return `费用规划 - ${custMatch[1]}`;
        return `发票与费用批量规划 (${clean.slice(0, 16)})`;
    }
    if (/出差|行程|出张|差旅/.test(clean)) {
        const cityMatch = clean.match(/(?:去|到|往|赴)\s*([^\s，,。0-9]+)/);
        if (cityMatch) return `出差规划 - ${cityMatch[1]}`;
        return `智能差旅规划 (${clean.slice(0, 16)})`;
    }
    if (/维表|检索|查询|员工|项目/.test(clean)) {
        return `维表查询 (${clean.slice(0, 16)})`;
    }
    return clean.length > 20 ? clean.slice(0, 20) + '...' : clean;
}

/**
 * 客户端历史轮次消息瘦身：
 * 仅保留最近 2 轮 user 消息中的完整 Base64 图片，更早历史轮次替换为轻量文本占位符，
 * 彻底防止多轮交互下 Base64 Payload 随轮次指数级膨胀导致请求超时或超 Token 限额
 */
function prepareMessagesForLlm(messages: ChatMessage[]): any[] {
    const userIndices: number[] = [];
    messages.forEach((m, idx) => {
        if (m.role === 'user') userIndices.push(idx);
    });

    const recentThreshold = userIndices.length > 2 ? userIndices[userIndices.length - 2] : 0;

    return messages.map((m, idx) => {
        if (m.role !== 'user' || !Array.isArray(m.content)) {
            return m;
        }

        if (idx < recentThreshold) {
            const prunedParts = m.content.map((part: any) => {
                if (part.type === 'image_url' && typeof part.image_url?.url === 'string' && part.image_url.url.startsWith('data:image/')) {
                    return { type: 'text', text: '[前序历史轮次已解析之行程/单据图片]' };
                }
                return part;
            });
            return {
                ...m,
                content: prunedParts
            };
        }

        return m;
    });
}

/**
 * 校验并修复会话中的 tool_calls 链路完整性
 * 确保 OpenAI / DeepSeek / Gemini 规范：每个带 tool_calls 的 assistant 消息后必须存在对应的 tool 响应，
 * 避免因单轮工具执行异常或网络中断导致下一次请求报 HTTP 400
 */
function sanitizeSessionToolCalls(messages: ChatMessage[]) {
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            const expectedIds = new Set(msg.tool_calls.map((c: any) => c.id));
            let j = i + 1;
            while (j < messages.length && messages[j].role === 'tool') {
                if (messages[j].tool_call_id) {
                    expectedIds.delete(messages[j].tool_call_id!);
                }
                j++;
            }
            if (expectedIds.size > 0) {
                expectedIds.forEach(missingId => {
                    messages.splice(j, 0, {
                        role: 'tool',
                        tool_call_id: missingId,
                        content: JSON.stringify({ status: 'completed_or_skipped' })
                    });
                    j++;
                });
            }
        }
    }
}

export function rollbackChatSessionToTurn(targetTurn: number): void {
    const session = getActiveChatSession();
    if (targetTurn <= 0) {
        resetChatSession();
        return;
    }
    let userCount = 0;
    let sliceIndex = session.messages.length;
    for (let i = 0; i < session.messages.length; i++) {
        if (session.messages[i].role === 'user') {
            userCount++;
            if (userCount === targetTurn) {
                sliceIndex = i;
                break;
            }
        }
    }
    session.messages = session.messages.slice(0, sliceIndex);
    session.turnCount = Math.max(0, targetTurn - 1);
    session.updatedAt = Date.now();
    AutopilotLogger.info(`[ChatSession] 会话已回滚至第 ${targetTurn} 轮，剩余消息数: ${session.messages.length}`);
}

export interface CallLlmAgentOptions {
    prompt: string;
    attachments?: MessageAttachment[];
    resetSession?: boolean;
    stream?: boolean;
    signal?: AbortSignal;
    onToolCallStart?: (toolName: string, params: any) => void;
    onToolCallEnd?: (toolName: string, durationMs: number, result: any) => void;
    onStreamStart?: () => void;
    onStreamDelta?: (delta: string, accumulated: string) => void;
    onStreamEnd?: (finalText: string) => void;
}

/**
 * 调用大模型 Agent 执行多模态理解与 WebMCP 工具循环
 * 全量接入 DeepSeek Harness 风格的 Trajectory 会话日志追踪，支持多轮深度记忆连续会话
 */
export async function callLlmAgent(options: CallLlmAgentOptions): Promise<string> {
    const config = getLlmConfig();
    if (!config.apiKey || !config.endpoint) {
        throw new Error('未配置 LLM API Key 或端点，请在设置中配置');
    }

    if (options.resetSession) {
        resetChatSession();
    }

    const session = getActiveChatSession();
    const runId = session.sessionId;
    session.turnCount++;
    session.updatedAt = Date.now();

    const url = normalizeEndpoint(config.endpoint);

    // 构建多模态 User 消息
    const userContentParts: any[] = [];

    // 1. 文本部分
    let promptWithAttachmentsText = options.prompt;
    if (options.attachments && options.attachments.length > 0) {
        const textDocs = options.attachments.filter(a => a.textContent);
        if (textDocs.length > 0) {
            promptWithAttachmentsText += '\n\n【用户附加文档/表格内容】：\n' +
                textDocs.map(d => `--- 文件: ${d.name} ---\n${d.textContent}`).join('\n\n');
        }
    }
    userContentParts.push({ type: 'text', text: promptWithAttachmentsText });

    // 2. 图片部分 (Base64 高清低负载)
    if (options.attachments) {
        for (const att of options.attachments) {
            if (att.dataUrl && att.type.startsWith('image/')) {
                userContentParts.push({
                    type: 'image_url',
                    image_url: { url: att.dataUrl, detail: 'high' }
                });
            }
        }
    }

    const newUserMessage: ChatMessage = {
        role: 'user',
        content: userContentParts.length === 1 ? userContentParts[0].text : userContentParts
    };
    session.messages.push(newUserMessage);

    const tools = convertToolsToOpenAiFormat(WEBMCP_STATE.toolDefs);

    // 记录 Trajectory: 仅在首轮记录 SYSTEM 注入，后续轮次记录 USER Turn
    if (session.turnCount === 1) {
        recordTrajectoryEvent({
            runId,
            source: 'SYSTEM',
            title: 'System Prompt & Tool Schemas Injected',
            summary: `已注入元年云 FSSC 极速副驾提示词与 ${tools.length} 个 W3C 工具定义`,
            data: {
                model: config.model,
                provider: config.provider,
                endpoint: url,
                temperature: config.temperature,
                systemPrompt: SYSTEM_PROMPT,
                tools: tools.map(t => ({ name: t.function.name, description: t.function.description }))
            }
        });
    }

    recordTrajectoryEvent({
        runId,
        source: 'USER',
        title: `User Prompt [Turn ${session.turnCount}]`,
        summary: options.prompt.slice(0, 100) + (options.attachments?.length ? ` (+${options.attachments.length} 附件)` : ''),
        data: {
            turn: session.turnCount,
            prompt: options.prompt,
            attachments: options.attachments?.map(a => ({
                id: a.id,
                name: a.name,
                size: `${(a.size / 1024).toFixed(1)} KB`,
                type: a.type,
                hasText: Boolean(a.textContent)
            }))
        }
    });

    // 最大迭代轮数，防止工具死循环 (允许 15 轮充分支持多步调用链与全量测算)
    let maxRounds = 15;
    let fullContent = '';
    try {
        while (maxRounds-- > 0) {
            if (options.signal?.aborted) {
                const stoppedText = (fullContent || '').trim() ? `${fullContent}\n\n*(已由用户手动停止输出)*` : '已停止生成。';
                options.onStreamEnd?.(stoppedText);
                return stoppedText;
            }

            const useStream = options.stream !== false;
            const preparedMessages = prepareMessagesForLlm(session.messages);
            const payload: any = {
                model: config.model.trim(),
                messages: preparedMessages,
                temperature: config.temperature ?? 0.3,
                stream: useStream
            };
            if (tools.length > 0) {
                payload.tools = tools;
                payload.tool_choice = 'auto';
            }

            // 指数退避重试 (Exponential Backoff with Max 3 Attempts)
            let res: Response | null = null;
            let lastErrText = '';
            const maxRetries = 3;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                if (options.signal?.aborted) {
                    throw new DOMException('Generation aborted by user', 'AbortError');
                }
                const reqStart = Date.now();
                try {
                    res = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${config.apiKey.trim()}`
                        },
                        body: JSON.stringify(payload),
                        signal: options.signal
                    });

                    if (res.ok) {
                        break;
                    }

                    lastErrText = await res.text();
                    const isRetryable = res.status === 503 || res.status === 429 || res.status === 504;

                    recordTrajectoryEvent({
                        runId,
                        source: 'ERROR',
                        title: `LLM API Error (HTTP ${res.status}) [Attempt ${attempt}/${maxRetries}]`,
                        summary: extractCleanErrorMessage(lastErrText, res.status),
                        durationMs: Date.now() - reqStart,
                        data: {
                            status: res.status,
                            attempt,
                            maxRetries,
                            rawError: lastErrText
                        }
                    });

                    if (isRetryable && attempt < maxRetries && !options.signal?.aborted) {
                        const backoffMs = attempt * 2000; // 2s, 4s, 6s
                        AutopilotLogger.warn(`[WebMCP] LLM 返回 HTTP ${res.status}，等待 ${backoffMs}ms 后自动第 ${attempt + 1} 次重试...`);
                        await new Promise(resolve => setTimeout(resolve, backoffMs));
                        continue;
                    }
                } catch (netErr: any) {
                    if (options.signal?.aborted || netErr.name === 'AbortError') {
                        throw netErr;
                    }
                    lastErrText = netErr.message;
                    recordTrajectoryEvent({
                        runId,
                        source: 'ERROR',
                        title: `Network Fetch Error [Attempt ${attempt}/${maxRetries}]`,
                        summary: netErr.message,
                        durationMs: Date.now() - reqStart,
                        data: { error: netErr.message }
                    });

                    if (attempt < maxRetries && !options.signal?.aborted) {
                        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
                        continue;
                    }
                }
            }

            if (!res || !res.ok) {
                throw new Error(extractCleanErrorMessage(lastErrText, res ? res.status : 0));
            }

            fullContent = '';
            let toolCalls: any[] = [];

            if (useStream && res.body && typeof (res.body as any).getReader === 'function') {
                const reader = (res.body as any).getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                const toolCallsMap: Record<number, { id: string; type: string; function: { name: string; arguments: string } }> = {};
                let hasStartedStream = false;

                try {
                    while (true) {
                        if (options.signal?.aborted) {
                            fullContent += (fullContent ? '\n\n' : '') + '*(已由用户手动停止输出)*';
                            options.onStreamEnd?.(fullContent);
                            break;
                        }

                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const rawLine of lines) {
                            const line = rawLine.trim();
                            if (!line || line.startsWith(':')) continue;

                            if (line.startsWith('data: ')) {
                                const dataStr = line.slice(6).trim();
                                if (dataStr === '[DONE]') {
                                    break;
                                }
                                try {
                                    const chunk = JSON.parse(dataStr);
                                    const choice = chunk.choices?.[0];
                                    if (!choice) continue;

                                    if (!hasStartedStream) {
                                        hasStartedStream = true;
                                        options.onStreamStart?.();
                                    }

                                    const deltaText = choice.delta?.content || choice.delta?.text || '';
                                    if (deltaText) {
                                        fullContent += deltaText;
                                        options.onStreamDelta?.(deltaText, fullContent);
                                    }

                                    if (choice.delta?.tool_calls) {
                                        for (const tc of choice.delta.tool_calls) {
                                            const idx = tc.index ?? 0;
                                            if (!toolCallsMap[idx]) {
                                                toolCallsMap[idx] = {
                                                    id: tc.id || '',
                                                    type: 'function',
                                                    function: {
                                                        name: tc.function?.name || '',
                                                        arguments: tc.function?.arguments || ''
                                                    }
                                                };
                                            } else {
                                                if (tc.id) toolCallsMap[idx].id = tc.id;
                                                if (tc.function?.name) toolCallsMap[idx].function.name += tc.function.name;
                                                if (tc.function?.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
                                            }
                                        }
                                    }
                                } catch (e) {
                                    // 忽略格式不全的中间分片
                                }
                            }
                        }
                    }
                } finally {
                    try { reader.releaseLock(); } catch (e) { }
                }

                if (options.signal?.aborted) {
                    const finalAborted = (fullContent || '').trim() || '*(已由用户手动停止输出)*';
                    recordTrajectoryEvent({
                        runId,
                        source: 'SYSTEM',
                        title: 'Generation Stopped by User',
                        summary: `用户已手动停止模型输出 (保留已接收 ${finalAborted.length} 字符)`,
                        data: { content: finalAborted }
                    });
                    return finalAborted;
                }

                toolCalls = Object.keys(toolCallsMap)
                    .map(k => Number(k))
                    .sort((a, b) => a - b)
                    .map(k => toolCallsMap[k]);

            } else {
                const data = await res.json();
                const choice = data.choices?.[0];
                if (!choice) {
                    throw new Error('LLM 未返回有效响应');
                }
                fullContent = choice.message?.content || '';
                toolCalls = choice.message?.tool_calls || [];
                if (fullContent) {
                    options.onStreamStart?.();
                    options.onStreamDelta?.(fullContent, fullContent);
                }
            }

            const msg: ChatMessage = {
                role: 'assistant',
                content: fullContent || null,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined
            };
            session.messages.push(msg);

            // 检测模型是否包含思维链推理 (Thinking / Reasoning)
            if (fullContent) {
                const thinkMatch = fullContent.match(/<think>([\s\S]*?)<\/think>/);
                if (thinkMatch) {
                    const reasoning = thinkMatch[1].trim();
                    recordTrajectoryEvent({
                        runId,
                        source: 'REASONING',
                        title: 'Model Thinking Trace (CoT)',
                        summary: reasoning.slice(0, 100) + '...',
                        data: { reasoning }
                    });
                }
            }

            // 如果没有 tool_calls，说明大模型已完成最终输出
            if (!msg.tool_calls || msg.tool_calls.length === 0) {
                const finalCleanContent = (fullContent || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                options.onStreamEnd?.(finalCleanContent);
                recordTrajectoryEvent({
                    runId,
                    source: 'MODEL_OUTPUT',
                    title: 'Model Final Response Completed',
                    summary: finalCleanContent.slice(0, 120) + '...',
                    data: { content: finalCleanContent }
                });
                return finalCleanContent || '任务已完成。';
            }

            // 递归执行每个 WebMCP 工具调用
            for (const call of msg.tool_calls) {
                const toolName = call.function.name;
                let args: any = {};
                try {
                    args = JSON.parse(call.function.arguments || '{}');
                } catch (e) {
                    AutopilotLogger.warn(`解析工具参数失败: ${call.function.arguments}`);
                }

                options.onToolCallStart?.(toolName, args);
                recordTrajectoryEvent({
                    runId,
                    source: 'TOOL_CALL',
                    title: `Invoke Tool: ${toolName}`,
                    summary: JSON.stringify(args).slice(0, 80),
                    data: {
                        callId: call.id,
                        toolName,
                        arguments: args
                    }
                });

                const toolStart = Date.now();
                let toolResult: any;
                try {
                    toolResult = await callWebMcpTool(toolName, args);
                } catch (toolErr: any) {
                    toolResult = { error: toolErr.message };
                }

                const toolDuration = Date.now() - toolStart;
                options.onToolCallEnd?.(toolName, toolDuration, toolResult);

                recordTrajectoryEvent({
                    runId,
                    source: 'TOOL_RESULT',
                    title: `Tool Completed: ${toolName}`,
                    summary: toolResult?.error ? `Error: ${toolResult.error}` : `Success (${toolDuration}ms)`,
                    durationMs: toolDuration,
                    data: toolResult
                });

                session.messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify(toolResult)
                });
            }
        }
    } catch (err: any) {
        if (options.signal?.aborted || err.name === 'AbortError') {
            const stoppedText = (fullContent || '').trim() ? `${fullContent}\n\n*(已由用户手动停止输出)*` : '已停止生成。';
            options.onStreamEnd?.(stoppedText);
            recordTrajectoryEvent({
                runId,
                source: 'SYSTEM',
                title: 'Generation Stopped by User',
                summary: `用户已手动停止输出 (保留 ${stoppedText.length} 字符)`,
                data: { content: stoppedText }
            });
            return stoppedText;
        }
        throw err;
    } finally {
        sanitizeSessionToolCalls(session.messages);
    }

    recordTrajectoryEvent({
        runId,
        source: 'MODEL_OUTPUT',
        title: 'Multi-round Tool Execution Finished',
        summary: '已完成多轮工具调用与综合规划。',
        data: null
    });
    return '已完成多轮工具调用与综合规划。';
}
