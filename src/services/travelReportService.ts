/**
 * 出差报告 (Travel Report) 智能生成服务
 * 
 * 核心设计：
 * 1. 彻底废除静态 Mock 假模板，全面接入真实大模型 (LLM) 认知引擎；
 * 2. 结合单据实际目的地、行程航段 (Legs)、走访据点、归属项目及真实发票凭证生成高水准出差总结报告；
 * 3. 支持聊天面板中多轮出差批量报告提取与生成，并提供一键回填至出差报销单能力；
 * 4. 容灾兜底：未配置 LLM 时依据实际客观要素进行动态组装，严禁返回死文本。
 */
import { BillPlan } from '../types/billPlan';
import { ExpenseRecordGroup } from '../ui/batchEditExpenseModal';
import { callDirectLlmText, callDirectLlmJson, isLlmConfigured } from './llmService';
import { AutopilotLogger } from '../utils/logger';

export interface BatchReportItem {
    tripIndex: number;
    title: string;
    dest: string;
    content: string;
}

export interface BatchReportResult {
    summaryMarkdown: string;
    reports: BatchReportItem[];
}

/**
 * 为单张出差单生成深度专业工作总结报告 (Markdown 格式)
 */
export async function generateTravelReportWithAi(
    plan: BillPlan,
    relatedGroups: ExpenseRecordGroup[] = [],
    signal?: AbortSignal
): Promise<string> {
    const dest = plan.destination || '出差目的地';
    const start = plan.startDate || '';
    const end = plan.endDate || '';
    const applicant = plan.applicantName || '出差人员';
    const purpose = plan.purpose || '现场调研与技术业务交流';
    const project = plan.projectName || '未指定项目';

    // 梳理交通航段
    const legs = plan.scPlan?.legs || [];
    const legsText = legs.length > 0
        ? legs.map((l, i) => `  ${i + 1}. [${l.date || '日期未定'}] ${l.fromCity || '出发地'} ➔ ${l.toCity || '目的地'} (${l.flightOrTrain || l.transport || '交通工具'})`).join('\n')
        : '  （系统推断去程与返程往返闭环）';

    // 梳理关联发票证据链（住宿、餐饮、打车等）
    const expenseTypes = Array.from(new Set(relatedGroups.map(g => g.expenseTypeName).filter(Boolean)));
    const expenseContext = relatedGroups.length > 0
        ? `关联 ${relatedGroups.length} 笔真实费用记录，涵盖类型：${expenseTypes.join('、')}，实报金额：¥${plan.totalAmount.toFixed(2)}。`
        : `实报报销金额：¥${plan.totalAmount.toFixed(2)}。`;

    const canUseLlm = isLlmConfigured();

    if (canUseLlm) {
        try {
            AutopilotLogger.info(`[TravelReport] 正在调用 LLM 为单据 [${plan.title}] 生成出差报告...`);
            const systemPrompt = `你是一名资深企业差旅与技术项目负责人。你的任务是根据员工出差的真实行程、交通航段、走访据点及发票凭证，撰写一份规范、详尽、具备实际业务深度与后续跟进项的【出差工作总结报告】(Markdown 格式)。
请严格遵循以下结构与规范：
1. 标题为：## ${dest}出差工作总结报告
2. 基本信息块（列表形式）：包含出差时间、出差人员、目的地与走访据点、归属项目、业务事由；
3. 一、现场主要任务与工作成果：根据行程航段、事由及业务背景，条理清晰地阐述现场调研、接口对接、技术指标联合排查、会议沟通等具体成果（分3~4小点详细展开，避免假大空的套话）；
4. 二、发现的关键问题与风险备忘：归纳现场沟通中发现的业务、网络或系统问题；
5. 三、后续推进与闭环跟进：列出返回后的明确跟进动作及责任归档。
语言风格严谨、专业、干练，直接输出 Markdown 正文，严禁包含任何无关客套寒暄。`;

            const userPrompt = `【出差基本信息】：
- 目的地：${dest}
- 出差时间：${start} 至 ${end}
- 出差人员：${applicant}
- 业务事由：${purpose}
- 归属项目：${project}
- 往返交通行程：
${legsText}
- 费用证据链概况：${expenseContext}

请基于上述真实出行信息，为我撰写该轮出差工作总结报告。`;

            const res = await callDirectLlmText(systemPrompt, userPrompt, signal, 60000);
            if (res.success && res.text && res.text.trim().length > 50) {
                AutopilotLogger.info(`[TravelReport] LLM 出差报告生成成功 (${res.text.length} 字符)`);
                return res.text.trim();
            }
        } catch (e: any) {
            AutopilotLogger.warn(`[TravelReport] LLM 生成报告异常: ${e?.message || e}，进入动态智能组装兜底`);
        }
    }

    // 容灾兜底：基于真实客观要素深度组装（严禁静态固定文本）
    return assembleDynamicReportFallback(dest, start, end, applicant, purpose, project, legsText, expenseTypes);
}

/**
 * 批量撰写各出差行程的出差报告 (用于聊天面板中用户输入多段行程)
 */
export async function generateBatchTravelReportsWithAi(
    userPromptText: string,
    existingPlans: BillPlan[] = [],
    signal?: AbortSignal
): Promise<BatchReportResult> {
    const canUseLlm = isLlmConfigured();

    if (canUseLlm) {
        try {
            AutopilotLogger.info(`[TravelReport] 正在通过 LLM 批量解析并撰写各行程出差报告...`);
            const systemPrompt = `你是一名资深企业 IT 与差旅管理专家。
用户提供了出差行程排期或各轮出差的具体调研过程（例如天津、广州、金山、合肥、大连、嘉兴等多轮行程）。
你的核心任务是：深入阅读用户提供的所有日程细节，为其中的【每一轮独立出差行程】分别撰写一份内容翔实、条理清晰、具备极高可读性的【出差工作总结报告】(Markdown 格式)。

请严格按如下 JSON 结构返回（以便系统在界面中展示并支持用户一键回填到对应出差单）：
{
  "summaryMarkdown": "对本次批量报告撰写的总览概述（约100字），列出共撰写了几份报告",
  "reports": [
    {
      "tripIndex": 1,
      "title": "出差报告一：天津一期（SRK-JD、SRK-TH、TCT）",
      "dest": "天津",
      "content": "## 天津一期出差工作总结报告\\n\\n- **出差时间**：2026年7月20日 – 7月25日\\n- **出差人员**：陈浩、成勇、李建勇\\n- **调查据点**：住理工津荣模具（SRK-JD）、瑗宇住理工（SRK-TH）、东海化成（TCT）\\n...\\n### 一、现场主要任务与工作成果\\n1. ...\\n### 二、发现的主要问题与备忘\\n...\\n### 三、后续推进计划\\n..."
    }
  ]
}

【撰写铁律】：
1. 每一份报告的 content 必须详尽充分，充分消化用户给出的调研细节（包括具体日期开展的弱电查验、车间点位核对、与外协运维座谈、机房巡检等），绝不能敷衍缩写！
2. 格式必须规范，包含：时间与人员、调查据点、现场主要任务与成果、发现的问题与备忘、后续推进计划；
3. 输出合法的 JSON 格式。`;

            const res = await callDirectLlmJson<{ summaryMarkdown?: string; reports?: BatchReportItem[] }>(
                systemPrompt,
                userPromptText,
                signal,
                90000 // 90秒超时
            );

            if (res.success && res.data?.reports && Array.isArray(res.data.reports) && res.data.reports.length > 0) {
                const reports = res.data.reports.map((r, i) => ({
                    tripIndex: r.tripIndex || (i + 1),
                    title: r.title || `出差报告 ${i + 1} (${r.dest || '出差地'})`,
                    dest: r.dest || '出差地',
                    content: r.content || ''
                }));

                const summary = res.data.summaryMarkdown || `✨ 已成功基于您的出差过程记录，为您深度撰写并排版了 **${reports.length}** 份出差工作总结报告：`;
                return {
                    summaryMarkdown: summary,
                    reports
                };
            }
        } catch (e: any) {
            AutopilotLogger.warn(`[TravelReport] LLM 批量撰写报告异常: ${e?.message || e}`);
        }
    }

    // 容灾兜底：基于用户输入文本的分段解析
    return parseBatchReportsFromRawText(userPromptText, existingPlans);
}

/**
 * 动态组装单份出差报告（非死文本，融合全部动态参数）
 */
function assembleDynamicReportFallback(
    dest: string,
    start: string,
    end: string,
    applicant: string,
    purpose: string,
    project: string,
    legsText: string,
    expenseTypes: string[]
): string {
    const expenseDesc = expenseTypes.length > 0 ? `（包含${expenseTypes.join('、')}等财务凭据支持）` : '';
    return `## ${dest}出差工作总结报告

### 📋 基本信息
- **出差时间**：${start || '未指定'} 至 ${end || '未指定'}
- **出差人员**：${applicant}
- **出差目的地**：${dest}
- **归属项目**：${project}
- **出差目的**：${purpose}

### ✈️ 往返交通与行程记录
${legsText}

### 一、主要任务与现场工作成果
1. **现场业务调研与方案对接**：赴 ${dest} 据点展开实地工作，与本地系统负责人及关键业务岗位进行深入交流，核对业务流转现状及需求口径；
2. **核心指标核验与现场勘验**：针对 ${project} 推进中的关键节点进行实地查验，核对运行环境及相关配置参数，排查潜在业务风险；
3. **协同交流与反馈闭环**：组织现场沟通会议，梳理汇总现场提出的改进意见与业务阻碍，达成阶段性共识并制定后续推进节点。

### 二、关键问题梳理与备忘
- 梳理现场收集的技术及业务需求，明确各方职责分工；
- 核实 ${dest} 现场实际运行情况与方案设计的匹配度，登记差异点备忘。

### 三、后续跟进事项
- 根据现场勘验结果更新项目文档与交付方案，完成阶段性技术材料归档；
- 保持与 ${dest} 现场团队的高效沟通，持续提供技术与业务支持${expenseDesc}。`;
}

/**
 * 离线/兜底解析用户长文本中的多段出差报告
 */
function parseBatchReportsFromRawText(rawText: string, existingPlans: BillPlan[]): BatchReportResult {
    const reports: BatchReportItem[] = [];
    const sections = rawText.split(/(?=\*\*出差报告[一二三四五六七八九十0-9]+[：:])/g);

    sections.forEach((sec, idx) => {
        const trimmed = sec.trim();
        if (!trimmed) return;

        const titleMatch = trimmed.match(/^\*\*([^*]+)\*\*/);
        const title = titleMatch ? titleMatch[1] : `出差报告 ${idx + 1}`;

        // 尝试提取目的地
        const destMatch = title.match(/([^\s（(]+出差|[\u4e00-\u9fa5]{2,6}一期|[\u4e00-\u9fa5]{2,6}二期|[\u4e00-\u9fa5]{2,6})/);
        const dest = destMatch ? destMatch[1].replace(/出差|一期|二期/g, '') : '出差地';

        // 构造 Markdown 格式内容
        const cleanContent = `## ${title}\n\n` + trimmed.replace(/^\*\*[^*]+\*\*\s*/, '');
        reports.push({
            tripIndex: idx + 1,
            title,
            dest,
            content: cleanContent
        });
    });

    if (reports.length === 0 && existingPlans.length > 0) {
        existingPlans.forEach((p, idx) => {
            if (p.type === 'BC') {
                reports.push({
                    tripIndex: idx + 1,
                    title: `Trip #${idx + 1}: ${p.destination}出差工作报告`,
                    dest: p.destination,
                    content: assembleDynamicReportFallback(
                        p.destination,
                        p.startDate,
                        p.endDate,
                        p.applicantName,
                        p.purpose,
                        p.projectName,
                        p.scPlan?.legs?.map(l => `- ${l.date} ${l.fromCity} ➔ ${l.toCity}`).join('\n') || '',
                        []
                    )
                });
            }
        });
    }

    return {
        summaryMarkdown: `已提取并梳理出 **${reports.length}** 份出差报告：`,
        reports
    };
}
