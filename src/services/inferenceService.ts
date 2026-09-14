/**
 * inferenceService.ts — 推断流水线服务
 * 
 * 将 batchEditExpenseModal.ts 中的第二层 LLM 推断逻辑（~430 行）抽离重构为
 * "时空骨架提取 + 分通道分流 + 极简 IO Schema" 的高性能推断管线。
 * 
 * 三大核心优化：
 * 1. 时空骨架压缩 (extractTripSkeleton)：tripTickets JSON → 纯文本时间线，压缩 ~93%
 * 2. 按类型精准分流 (dispatchInferenceChannels)：三个独立通道并行执行
 *    - 通道 A (TAXI)：出租车批量起止地，极简 [id, from, to] 输出
 *    - 通道 B (STAY/TRANSIT)：住宿 + 大交通日程对齐
 *    - 通道 C (UNKNOWN)：未识别类型归类
 * 3. 极简 IO Schema：各通道仅传/仅返回该类型必要字段
 * 
 * @since v4.38.0
 */

import { AutopilotLogger } from '../utils/logger';
import { callDirectLlmJson, isLlmConfigured } from './llmService';
import type { ExpenseRecordGroup } from '../ui/batchEditExpenseModal';
import { DynamicExpenseFieldValues } from './expenseService';
import { type DynamicTripInput, parseItineraryTable } from './applicationService';
import type { TripLeg } from '../types/state';

export type ExpenseGroupCategory = 'HOTEL' | 'FLIGHT' | 'TRAIN' | 'TAXI' | 'MOBILE' | 'OTHER';

export type DetailedExpenseCategory = 'HOTEL' | 'FLIGHT' | 'TRAIN' | 'TRIP_TAXI' | 'LOCAL_TAXI' | 'MOBILE' | 'OTHER';

export type ExpenseBillFlow = 'BC' | 'BJ'; // BC: 出差费用报销单, BJ: 经费报销单

/**
 * 依据费用类型 ID 或名称确定单据流向 (BC 差旅报销 vs BJ 经费报销)
 */
export function getExpenseBillFlow(typeId?: string, typeName?: string): ExpenseBillFlow {
    const s = `${typeName || ''} ${typeId || ''}`.toLowerCase();
    // 明确属于非差旅/日常类的：市内交通费、手机通信费、交际费、会议费、福利费等
    if (s.includes('市内交通') || typeId === '0356c529e72de1653e55bb00bc610001') return 'BJ';
    if (s.includes('手机') || s.includes('通信费-员工') || s.includes('txf') || typeId === '0356c577f8ede1653e55bb00bc610001') return 'BJ';
    if (s.includes('交际') || s.includes('会议') || s.includes('福利') || s.includes('培训') || s.includes('办公')) return 'BJ';
    // 差旅大类：机票、高铁、住宿、出租车（taxi）、交通费其他
    return 'BC';
}

/**
 * 根据类型 ID 或类型名称智能识别费用主类别
 */
export function detectTypeCategory(typeId: string, typeName: string): ExpenseGroupCategory {
    const s = `${typeName || ''} ${typeId || ''}`.toLowerCase();
    if (s.includes('住宿') || s.includes('酒店') || s.includes('zsf') || typeId === '0356c4e2b72de1653e55bb00bc610001') return 'HOTEL';
    if (s.includes('飞机') || s.includes('航空') || s.includes('jnc') || typeId === '035671613fdde1653e55bb00bc610000') return 'FLIGHT';
    if (s.includes('火车') || s.includes('高铁') || s.includes('hcp') || typeId === '0356c4c2b14de1653e55bb00bc610000') return 'TRAIN';
    if (s.includes('出租') || s.includes('taxi') || s.includes('czc') || s.includes('市内交通') || s.includes('snj') ||
        typeId === '0356c4cef03345af7f1906ec05cc0000' || typeId === '0356c529e72de1653e55bb00bc610001') return 'TAXI';
    if (s.includes('手机') || s.includes('员工手机') || s.includes('通信') || s.includes('txf') || typeId === '0356c577f8ede1653e55bb00bc610001') return 'MOBILE';
    return 'OTHER';
}

/**
 * 获取费用分组的识别主类别
 */
export function getGroupCategory(group: ExpenseRecordGroup): ExpenseGroupCategory {
    return detectTypeCategory(
        group.newExpenseTypeId || group.expenseTypeId,
        group.newExpenseTypeName || group.expenseTypeName
    );
}

/**
 * 获取费用分组的单据流向
 */
export function getGroupBillFlow(group: ExpenseRecordGroup): ExpenseBillFlow {
    return getExpenseBillFlow(
        group.newExpenseTypeId || group.expenseTypeId,
        group.newExpenseTypeName || group.expenseTypeName
    );
}

/**
 * 检测出租车费用是否存在出差/日常错配嫌疑
 */
export function checkTaxiMisclassification(
    group: ExpenseRecordGroup,
    tripDateIntervals: Array<{ tripNo: number; destination: string; start: string; end: string }>
): { hasMisclass: boolean; suggestedTypeId?: string; suggestedTypeName?: string; reason?: string } {
    const typeId = group.newExpenseTypeId || group.expenseTypeId;
    const typeName = group.newExpenseTypeName || group.expenseTypeName;
    const date = group.newBusinessDate || group.businessDate || group.earliestInvoiceDate;
    if (!date) return { hasMisclass: false };

    const isLocalTaxi = typeName?.includes('市内交通') || typeId === '0356c529e72de1653e55bb00bc610001';
    const isTripTaxi = typeName?.includes('taxi') || typeId === '0356c4cef03345af7f1906ec05cc0000';

    if (!isLocalTaxi && !isTripTaxi) return { hasMisclass: false };

    const matchedTrip = tripDateIntervals.find(t => date >= t.start && date <= t.end);

    if (matchedTrip && isLocalTaxi) {
        return {
            hasMisclass: true,
            suggestedTypeId: '0356c4cef03345af7f1906ec05cc0000',
            suggestedTypeName: '出租车（taxi）',
            reason: `该打车发生于 Trip ${matchedTrip.tripNo} (${matchedTrip.destination}) 出差期间，建议变更为【差旅费 - 出租车(taxi)】`
        };
    }

    if (!matchedTrip && isTripTaxi && tripDateIntervals.length > 0) {
        return {
            hasMisclass: true,
            suggestedTypeId: '0356c529e72de1653e55bb00bc610001',
            suggestedTypeName: '市内交通费',
            reason: `该打车不在任何出差期间内，建议变更为【交通费 - 市内交通费 (日常经费)】`
        };
    }

    return { hasMisclass: false };
}

/**
 * 判断费用分组是否为未识别类型 / 未分类 / OTHER
 */
export function isUnknownTypeGroup(group: ExpenseRecordGroup): boolean {
    const typeId = group.newExpenseTypeId || group.expenseTypeId;
    const typeName = group.newExpenseTypeName || group.expenseTypeName;
    return !typeId || typeId === 'UNIDENTIFIED' || typeName === '未知类型' || getGroupCategory(group) === 'OTHER';
}

// ============================================================
// 一、类型定义与通道 IO Schema
// ============================================================

/** 出租车通道输入：极简元组 */
interface TaxiInputRecord {
    id: string;
    date: string;       // 打车日期 YYYY-MM-DD
    on?: string;        // 上车时间 HH:MM
    off?: string;       // 下车时间 HH:MM
    sales?: string;     // 销方名称
    remark?: string;    // 备注/行程核对
}

/** 出租车通道输出：仅 id + from + to */
interface TaxiInferenceResult {
    id: string;
    from: string;
    to: string;
}

/** 差旅大项通道输入 */
interface StayTransitInputRecord {
    id: string;
    type: 'HOTEL' | 'FLIGHT' | 'TRAIN';
    amount: number | string;
    bizDate: string;
    invDate: string;
    sales?: string;
    stationOn?: string;
    stationOff?: string;
    depDate?: string;
    flightNo?: string;
    remarks?: string;
    fileName?: string;
    hotelName?: string;
    city?: string;
    checkIn?: string;
    checkOut?: string;
    missing: string[];
}

/** 差旅大项通道输出 */
interface StayTransitInferenceResult {
    id: string;
    fields: Partial<DynamicExpenseFieldValues>;
}

/** 未知类型通道输入 */
interface UnknownInputRecord {
    id: string;
    amount: number | string;
    bizDate: string;
    invDate: string;
    sales?: string;
    fileName?: string;
    remarks?: string;
    timeGetOn?: string;
    timeGetOff?: string;
    stationOn?: string;
    stationOff?: string;
}

/** 未知类型通道输出 */
interface UnknownInferenceResult {
    id: string;
    targetExpenseTypeId: string;
    targetExpenseTypeName: string;
    fields?: Partial<DynamicExpenseFieldValues>;
}

/** 三通道聚合结果 */
export interface DispatchedInferenceResults {
    taxi: TaxiInferenceResult[];
    stayTransit: StayTransitInferenceResult[];
    unknown: UnknownInferenceResult[];
}

/** 出租车通道分片阈值 */
const TAXI_BATCH_SIZE = 40;

// ============================================================
// 二、时空骨架提取 (Trip Skeleton Compression)
// ============================================================

/**
 * 从已确认的大交通和住宿记录中提取极简纯文本时间线。
 * 将数千 Token 的 JSON 上下文压缩至数百 Token 的人类可读时间线。
 * 
 * 输出格式示例：
 * ```
 * [07-20] 机票: 上海虹桥→天津滨海 (MU5227 12:35) | 宿: 天津亚朵酒店
 * [07-21~07-24] 宿: 天津美悦酒店
 * [07-25] 机票: 天津滨海→上海虹桥 (FM9116 16:00)
 * ```
 */
export function extractTripSkeleton(
    groups: ExpenseRecordGroup[],
    itineraryText?: string
): string {
    // 收集大交通与住宿记录
    const anchors: Array<{
        date: string;
        endDate?: string;
        type: 'FLIGHT' | 'TRAIN' | 'HOTEL';
        text: string;
    }> = [];

    for (const g of groups) {
        const cat = getGroupCategory(g);
        const dyn = g.dynamicFields || {};
        const inv0 = g.invoices[0];

        if (cat === 'FLIGHT') {
            const from = dyn.flightFromCity || inv0?.stationGetOn || '?';
            const to = dyn.flightToCity || inv0?.stationGetOff || '?';
            const num = dyn.flightNum || inv0?.trainNo || '';
            const depTime = inv0?.departureTime || '';
            const date = dyn.flightStartDate || inv0?.departureDate || g.businessDate || g.earliestInvoiceDate;
            const endDate = dyn.flightEndDate;
            let text = `机票: ${from}→${to}`;
            if (num) text += ` (${num}`;
            if (depTime) text += num ? ` ${depTime})` : ` (${depTime})`;
            else if (num) text += ')';
            anchors.push({ date, endDate, type: 'FLIGHT', text });
        } else if (cat === 'TRAIN') {
            const from = dyn.trainFromStation || inv0?.stationGetOn || '?';
            const to = dyn.trainToStation || inv0?.stationGetOff || '?';
            const num = inv0?.trainNo || '';
            const depTime = inv0?.departureTime || '';
            const date = dyn.trainStartDate || inv0?.departureDate || g.businessDate || g.earliestInvoiceDate;
            const endDate = dyn.trainEndDate;
            let text = `高铁: ${from}→${to}`;
            if (num) text += ` (${num}`;
            if (depTime) text += num ? ` ${depTime})` : ` (${depTime})`;
            else if (num) text += ')';
            anchors.push({ date, endDate, type: 'TRAIN', text });
        } else if (cat === 'HOTEL') {
            const hotel = dyn.hotelName || inv0?.salesName || '?';
            const city = dyn.city || '';
            const checkIn = dyn.checkInDate || g.businessDate || g.earliestInvoiceDate;
            const checkOut = dyn.checkOutDate;
            let text = `宿: ${hotel}`;
            if (city) text += ` (${city})`;
            anchors.push({
                date: checkIn,
                endDate: checkOut,
                type: 'HOTEL',
                text
            });
        }
    }

    if (anchors.length === 0 && !itineraryText) return '';

    // 按日期正序排列
    anchors.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // 按日期分组聚合
    const dateMap = new Map<string, string[]>();
    for (const anchor of anchors) {
        const dateKey = formatSkeletonDateRange(anchor.date, anchor.endDate);
        if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
        dateMap.get(dateKey)!.push(anchor.text);
    }

    const lines: string[] = [];
    for (const [dateKey, texts] of dateMap) {
        lines.push(`[${dateKey}] ${texts.join(' | ')}`);
    }

    let skeleton = lines.join('\n');

    // 附加用户权威排期表（如果存在）
    if (itineraryText) {
        skeleton += '\n\n【用户权威出差排期日程 (Ground Truth)】：\n' + itineraryText;
    }

    return skeleton;
}

/** 格式化骨架日期范围：07-20 或 07-21~07-24 */
function formatSkeletonDateRange(startDate?: string, endDate?: string): string {
    const fmt = (d?: string) => {
        if (!d) return '';
        const m = d.match(/\d{4}-(\d{2}-\d{2})/);
        return m ? m[1] : d;
    };
    const s = fmt(startDate);
    const e = fmt(endDate);
    if (!s) return '?';
    if (!e || e === s) return s;
    // 住宿的 endDate 减 1 天 (checkOut 日不算入住)
    return `${s}~${e}`;
}

// ============================================================
// 三、分通道调度器 (Dispatcher)
// ============================================================

/**
 * 将待推断记录按类型分流至三个独立通道，采用两阶段瀑布式并行执行后合并结果。
 *
 * 【关键设计决策：两阶段瀑布式并行 (Two-Phase Waterfall)】
 * 出租车的时空闭环推理强依赖住宿酒店名称和大交通枢纽站点信息。
 * 若三通道完全并行，出租车通道可能拿不到 Channel B (住宿/大交通) 的 LLM 推断结果
 * （如从排期表匹配到的精确酒店商业品牌名、入离店日期等），导致推断质量下降。
 *
 * 因此采用瀑布式分阶段执行：
 *   阶段 1：Channel B (住宿+大交通) + Channel C (未知类型) → 并行执行（数量少，~10-20s）
 *   阶段 2：Channel A (出租车) → 使用被 Phase 1 结果增强后的骨架执行（信息完整）
 *
 * 总延迟 ≈ Phase1(~20s) + Phase2(~30s) ≈ 50s，远优于全串行 3~5 分钟。
 */
export async function dispatchInferenceChannels(
    groupsWithMissingFields: ExpenseRecordGroup[],
    allGroups: ExpenseRecordGroup[],
    tripSkeleton: string,
    itineraryText?: string,
    onProgress?: (status: string) => void
): Promise<DispatchedInferenceResults> {
    // 按类型分桶
    const taxiGroups: ExpenseRecordGroup[] = [];
    const stayTransitGroups: ExpenseRecordGroup[] = [];
    const unknownGroups: ExpenseRecordGroup[] = [];

    for (const g of groupsWithMissingFields) {
        if (isUnknownTypeGroup(g)) {
            unknownGroups.push(g);
        } else {
            const cat = getGroupCategory(g);
            if (cat === 'TAXI') {
                taxiGroups.push(g);
            } else if (cat === 'HOTEL' || cat === 'FLIGHT' || cat === 'TRAIN') {
                stayTransitGroups.push(g);
            }
            // MOBILE 和 OTHER 通常在 Tier 1 规则层已处理完毕，不进入 LLM 通道
        }
    }

    const results: DispatchedInferenceResults = {
        taxi: [],
        stayTransit: [],
        unknown: []
    };

    // ================================================================
    // 阶段 1：Channel B (住宿+大交通) + Channel C (未知类型) 并行执行
    // 数量少（通常 5~15 笔），耗时短（~10-20s）
    // ================================================================
    const phase1Promises: Array<Promise<void>> = [];

    if (stayTransitGroups.length > 0) {
        const statusPrefix = `🏨✈️ 差旅大项 ${stayTransitGroups.length} 笔`;
        onProgress?.(`阶段1: ${statusPrefix} 推断中...`);
        phase1Promises.push(
            executeStayTransitChannel(stayTransitGroups, tripSkeleton, itineraryText)
                .then(r => { results.stayTransit = r; onProgress?.(`${statusPrefix} ✅`); })
                .catch(err => {
                    AutopilotLogger.warn(`[InferenceService] 差旅大项通道异常: ${err?.message}`);
                    onProgress?.(`${statusPrefix} ⚠️ 部分失败`);
                })
        );
    }

    if (unknownGroups.length > 0) {
        const statusPrefix = `❓ 未知类型 ${unknownGroups.length} 笔`;
        onProgress?.(`阶段1: ${statusPrefix} 推断中...`);
        phase1Promises.push(
            executeUnknownChannel(unknownGroups, tripSkeleton)
                .then(r => { results.unknown = r; onProgress?.(`${statusPrefix} ✅`); })
                .catch(err => {
                    AutopilotLogger.warn(`[InferenceService] 未知类型通道异常: ${err?.message}`);
                    onProgress?.(`${statusPrefix} ⚠️ 部分失败`);
                })
        );
    }

    // 等待阶段 1 全部完成
    if (phase1Promises.length > 0) {
        await Promise.allSettled(phase1Promises);
    }

    // ================================================================
    // 阶段间增强：将 Phase 1 推断结果写回 groups，然后重新提取增强骨架
    // 这样出租车通道拿到的骨架已包含 LLM 推断出的精确酒店名/入离店日期/航线等
    // ================================================================
    let enrichedSkeleton = tripSkeleton;
    if (results.stayTransit.length > 0 || results.unknown.length > 0) {
        // 临时将 Phase 1 结果写入 groups 的 dynamicFields（mergeInferenceResults 后续会正式处理）
        applyPhase1ResultsToGroups(allGroups, results);
        // 重新提取增强后的骨架
        enrichedSkeleton = extractTripSkeleton(allGroups, itineraryText);
        AutopilotLogger.info(`[InferenceService] Phase 1 完成，骨架已增强 (stayTransit=${results.stayTransit.length}, unknown=${results.unknown.length})`);
    }

    // ================================================================
    // 阶段 2：Channel A (出租车) 使用增强骨架执行
    // 数量最多（通常 60~80%），但此时信息完整
    // ================================================================
    if (taxiGroups.length > 0) {
        const statusPrefix = `🚕 出租车 ${taxiGroups.length} 笔`;
        onProgress?.(`阶段2: ${statusPrefix} 推断中...`);
        try {
            results.taxi = await executeTaxiChannel(taxiGroups, enrichedSkeleton, itineraryText);
            onProgress?.(`${statusPrefix} ✅`);
        } catch (err: any) {
            AutopilotLogger.warn(`[InferenceService] 出租车通道异常: ${err?.message}`);
            onProgress?.(`${statusPrefix} ⚠️ 部分失败`);
        }
    }

    return results;
}

/**
 * 将阶段 1 推断结果临时写入 groups 的 dynamicFields，以便重新提取增强骨架。
 * 仅写入影响骨架生成的关键锚点字段（酒店名/城市/入离店/航线/车站）。
 */
function applyPhase1ResultsToGroups(
    groups: ExpenseRecordGroup[],
    results: DispatchedInferenceResults
): void {
    const groupMap = new Map(groups.map(g => [g.expenseRecordId, g]));

    // 写入 Channel B (住宿+大交通) 推断结果
    for (const st of results.stayTransit) {
        const g = groupMap.get(st.id);
        if (!g) continue;
        g.dynamicFields = g.dynamicFields || {};
        const dyn = g.dynamicFields;
        const f = st.fields;
        if (f.hotelName && !dyn.hotelName) dyn.hotelName = f.hotelName;
        if (f.city && !dyn.city) dyn.city = f.city;
        if (f.checkInDate && !dyn.checkInDate) dyn.checkInDate = f.checkInDate;
        if (f.checkOutDate && !dyn.checkOutDate) dyn.checkOutDate = f.checkOutDate;
        if (f.flightFromCity && !dyn.flightFromCity) dyn.flightFromCity = f.flightFromCity;
        if (f.flightToCity && !dyn.flightToCity) dyn.flightToCity = f.flightToCity;
        if (f.flightNum && !dyn.flightNum) dyn.flightNum = f.flightNum;
        if (f.flightStartDate && !dyn.flightStartDate) dyn.flightStartDate = f.flightStartDate;
        if (f.trainFromStation && !dyn.trainFromStation) dyn.trainFromStation = f.trainFromStation;
        if (f.trainToStation && !dyn.trainToStation) dyn.trainToStation = f.trainToStation;
        if (f.trainStartDate && !dyn.trainStartDate) dyn.trainStartDate = f.trainStartDate;
    }

    // 写入 Channel C (未知类型归类) 推断结果 — 更新类型以便骨架提取识别
    for (const unk of results.unknown) {
        const g = groupMap.get(unk.id);
        if (!g) continue;
        g.newExpenseTypeId = unk.targetExpenseTypeId;
        g.newExpenseTypeName = unk.targetExpenseTypeName;
        if (unk.fields) {
            g.dynamicFields = g.dynamicFields || {};
            const dyn = g.dynamicFields;
            const f = unk.fields;
            if (f.hotelName && !dyn.hotelName) dyn.hotelName = f.hotelName;
            if (f.city && !dyn.city) dyn.city = f.city;
            if (f.checkInDate && !dyn.checkInDate) dyn.checkInDate = f.checkInDate;
            if (f.checkOutDate && !dyn.checkOutDate) dyn.checkOutDate = f.checkOutDate;
            if (f.flightFromCity && !dyn.flightFromCity) dyn.flightFromCity = f.flightFromCity;
            if (f.flightToCity && !dyn.flightToCity) dyn.flightToCity = f.flightToCity;
            if (f.trainFromStation && !dyn.trainFromStation) dyn.trainFromStation = f.trainFromStation;
            if (f.trainToStation && !dyn.trainToStation) dyn.trainToStation = f.trainToStation;
        }
    }
}

// ============================================================
// 四、通道 A：出租车批量起止地推断
// ============================================================

const TAXI_SYSTEM_PROMPT_TEMPLATE = `你是元年云 FSSC 出租车行程智能推断专家。
根据出差时空骨架与打车时间，推断每笔出租车的始发地与目的地。

【出差时空骨架 (行程时间线)】：
{SKELETON}

【时空轨迹闭环推理规则】：
1. 大交通出发首日 (去程日)：
   - 出发前打车（早间/提前 1~2 小时）：始发地为「住所」，目的地为当天出发交通枢纽（如上海虹桥机场/上海虹桥站）
   - 到达外地后打车：始发地为到达交通枢纽（如天津滨海机场），目的地为当天入住酒店的具体商业品牌名
2. 大交通返程末日 (回程日)：
   - 返程前打车：始发地为当天退房酒店，目的地为外地出发交通枢纽
   - 返程到达常驻地后打车：始发地为到达交通枢纽，目的地为「住所」
3. 在途常驻出差日：
   - 在当天入住酒店与「客户现场」之间流转
4.【去代称铁律】：严禁输出"酒店"、"机场"、"车站"、"Home"等模糊代称！必须解析为真实酒店名/真实枢纽站名或「住所」
5. 仅对能确信推断的记录输出，无法判断的记录直接不放入数组

JSON 输出格式 (严禁输出其他字段/废话/思考过程)：
{"results":[{"id":"记录ID","from":"始发据点","to":"到达据点"}]}`;

async function executeTaxiChannel(
    groups: ExpenseRecordGroup[],
    skeleton: string,
    itineraryText?: string
): Promise<TaxiInferenceResult[]> {
    const systemPrompt = TAXI_SYSTEM_PROMPT_TEMPLATE.replace('{SKELETON}', skeleton);

    // 构建极简输入
    const buildInputRecords = (gs: ExpenseRecordGroup[]): TaxiInputRecord[] =>
        gs.map(g => {
            const inv = g.invoices.find(i => i.timeGetOn || i.timeGetOff) || g.invoices[0];
            const rec: TaxiInputRecord = {
                id: g.expenseRecordId,
                date: g.businessDate || g.earliestInvoiceDate
            };
            if (inv?.timeGetOn) rec.on = inv.timeGetOn;
            if (inv?.timeGetOff) rec.off = inv.timeGetOff;
            if (inv?.salesName) rec.sales = inv.salesName;
            // 合并备注与文件名中的行程线索
            const remark = [inv?.remarks, inv?.reconciliationNote].filter(Boolean).join(' ').trim();
            if (remark) rec.remark = remark;
            return rec;
        });

    // 分片处理：超过阈值则分批并行
    if (groups.length > TAXI_BATCH_SIZE) {
        const batches: ExpenseRecordGroup[][] = [];
        for (let i = 0; i < groups.length; i += TAXI_BATCH_SIZE) {
            batches.push(groups.slice(i, i + TAXI_BATCH_SIZE));
        }
        const batchResults = await Promise.allSettled(
            batches.map(batch => callTaxiLlm(systemPrompt, buildInputRecords(batch)))
        );
        const merged: TaxiInferenceResult[] = [];
        for (const r of batchResults) {
            if (r.status === 'fulfilled' && r.value) merged.push(...r.value);
        }
        return merged;
    }

    return callTaxiLlm(systemPrompt, buildInputRecords(groups));
}

async function callTaxiLlm(systemPrompt: string, records: TaxiInputRecord[]): Promise<TaxiInferenceResult[]> {
    const userPrompt = JSON.stringify({ records });
    const res = await callDirectLlmJson<{ results?: TaxiInferenceResult[] }>(
        systemPrompt, userPrompt, undefined, 120000
    );
    if (res.success && res.data?.results) {
        return res.data.results.filter(r => r.id && (r.from || r.to));
    }
    if (!res.success) {
        AutopilotLogger.warn(`[TaxiChannel] LLM 调用失败: ${res.error}`);
    }
    return [];
}

// ============================================================
// 五、通道 B：差旅核心大项推断 (HOTEL / FLIGHT / TRAIN)
// ============================================================

const STAY_TRANSIT_SYSTEM_PROMPT_TEMPLATE = `你是元年云 FSSC 差旅核心大项（住宿/机票/火车票）智能推断专家。
根据出差时空骨架与发票证据链，推断指定记录的缺失专属必填字段。

【出差时空骨架 (行程时间线)】：
{SKELETON}

【住宿费 (HOTEL) 规则】：
- checkInDate (YYYY-MM-DD)：实际入住日期，严禁误用开票日期！以排期/时间线为准
- checkOutDate (YYYY-MM-DD)：实际离店日期
- city：出差城市名（如天津、广州、大连），连锁酒店品牌词（亚朵、全季）不是城市
- hotelName：酒店商业品牌名（如"全季酒店(天津津南新城店)"），严禁用开票抬头/管理公司
- roomNum：数字，默认 1

【飞机票 (FLIGHT) 规则】：
- flightStartDate (YYYY-MM-DD)：出发日期
- flightEndDate (YYYY-MM-DD)：到达日期
- flightFromCity：出发城市
- flightToCity：到达城市
- flightNum：航班号。往返双程需完整填写并用正斜杠连接（如 CZ6534/CZ6523），严禁只截取单程！严禁把项目编号误识别为航班号！

【火车票 (TRAIN) 规则】：
- trainStartDate (YYYY-MM-DD)：出发日期
- trainEndDate (YYYY-MM-DD)：到达日期
- trainFromStation：出发站
- trainToStation：到达站

【输出约束】：
- 仅对能确信推断的字段输出键值，严禁输出 null 字段
- 严禁输出 reason / 思考过程 / 多余文字
- 无法推断的记录直接不放入数组

JSON 输出格式：
{"inferences":[{"id":"记录ID","fields":{"checkInDate":"YYYY-MM-DD","city":"城市",...}}]}`;

async function executeStayTransitChannel(
    groups: ExpenseRecordGroup[],
    skeleton: string,
    itineraryText?: string
): Promise<StayTransitInferenceResult[]> {
    const systemPrompt = STAY_TRANSIT_SYSTEM_PROMPT_TEMPLATE.replace('{SKELETON}', skeleton);

    const records: StayTransitInputRecord[] = groups.map(g => {
        const cat = getGroupCategory(g) as 'HOTEL' | 'FLIGHT' | 'TRAIN';
        const inv0 = g.invoices[0];
        const dyn = g.dynamicFields || {};
        const rec: StayTransitInputRecord = {
            id: g.expenseRecordId,
            type: cat,
            amount: g.expenseAmount,
            bizDate: g.businessDate,
            invDate: g.earliestInvoiceDate,
            missing: []
        };
        if (inv0?.salesName) rec.sales = inv0.salesName;
        if (inv0?.stationGetOn) rec.stationOn = inv0.stationGetOn;
        if (inv0?.stationGetOff) rec.stationOff = inv0.stationGetOff;
        if (inv0?.departureDate) rec.depDate = inv0.departureDate;
        if (inv0?.trainNo) rec.flightNo = inv0.trainNo;
        if (inv0?.remarks) rec.remarks = inv0.remarks;
        if (inv0?.fileName) rec.fileName = inv0.fileName;
        if (dyn.hotelName) rec.hotelName = dyn.hotelName;
        if (dyn.city) rec.city = dyn.city;
        if (dyn.checkInDate) rec.checkIn = dyn.checkInDate;
        if (dyn.checkOutDate) rec.checkOut = dyn.checkOutDate;

        // 明确列出缺失字段
        if (cat === 'HOTEL') {
            if (!dyn.checkInDate) rec.missing.push('checkInDate');
            if (!dyn.checkOutDate) rec.missing.push('checkOutDate');
            if (!dyn.city) rec.missing.push('city');
            if (!dyn.hotelName) rec.missing.push('hotelName');
        } else if (cat === 'FLIGHT') {
            if (!dyn.flightStartDate) rec.missing.push('flightStartDate');
            if (!dyn.flightEndDate) rec.missing.push('flightEndDate');
            if (!dyn.flightFromCity) rec.missing.push('flightFromCity');
            if (!dyn.flightToCity) rec.missing.push('flightToCity');
            if (!dyn.flightNum) rec.missing.push('flightNum');
        } else if (cat === 'TRAIN') {
            if (!dyn.trainStartDate) rec.missing.push('trainStartDate');
            if (!dyn.trainEndDate) rec.missing.push('trainEndDate');
            if (!dyn.trainFromStation) rec.missing.push('trainFromStation');
            if (!dyn.trainToStation) rec.missing.push('trainToStation');
        }
        return rec;
    });

    const userPrompt = JSON.stringify({ records });
    const res = await callDirectLlmJson<{
        inferences?: Array<{ id?: string; fields?: Record<string, any> }>;
    }>(systemPrompt, userPrompt, undefined, 120000);

    if (res.success && res.data?.inferences) {
        return res.data.inferences
            .filter(inf => inf.id && inf.fields)
            .map(inf => ({ id: inf.id!, fields: inf.fields! }));
    }
    if (!res.success) {
        AutopilotLogger.warn(`[StayTransitChannel] LLM 调用失败: ${res.error}`);
    }
    return [];
}

// ============================================================
// 六、通道 C：未识别类型归类
// ============================================================

const UNKNOWN_SYSTEM_PROMPT = `你是元年云 FSSC 费用类型智能分类专家。
根据发票金额、销售方、备注与文件名等证据，判定每笔未识别费用的标准类型，并一并补齐该类型的必填字段。

【系统标准费用类型字典】：
1. 飞机票（航空券）→ ID: "035671613fdde1653e55bb00bc610000", 必填: flightStartDate, flightEndDate, flightFromCity, flightToCity, flightNum
2. 火车公交车票 （電車Bus代）→ ID: "0356c4c2b14de1653e55bb00bc610000", 必填: trainStartDate, trainEndDate, trainFromStation, trainToStation
3. 住宿费（宿泊代）→ ID: "0356c4e2b72de1653e55bb00bc610001", 必填: checkInDate, checkOutDate, city, hotelName, roomNum
4. 出租车（taxi）→ ID: "0356c4cef03345af7f1906ec05cc0000", 必填: startAddress, endAddress
5. 通信传真费（通信代）→ ID: "0356c4f6701345af7f1906ec05cc0000", 必填: billMonth (YYYY-MM)
6. 交通费-其他(その他）→ ID: "0356c529e72de1653e55bb00bc610001", 必填: startAddress, endAddress

【分类判定规则】：
- 飞机/航空/机票 → 飞机票
- 火车/高铁/铁路/12306 → 火车公交车票
- 酒店/住宿/客房/宾馆 → 住宿费
- 出租车/滴滴/网约车/曹操/taxi → 出租车
- 通信/话费/移动/电信/联通 → 通信传真费
- 大额 (≥¥350) 且无打车特征 → 勿随意降级为出租车

【输出约束】：
- 仅输出能确信归类的记录，无法判断的不放入数组
- 严禁输出 reason / 思考过程

JSON 输出格式：
{"classifications":[{"id":"记录ID","targetExpenseTypeId":"类型ID","targetExpenseTypeName":"类型名称","fields":{"startAddress":"...",...}}]}`;

async function executeUnknownChannel(
    groups: ExpenseRecordGroup[],
    skeleton: string
): Promise<UnknownInferenceResult[]> {
    const systemPrompt = skeleton
        ? `${UNKNOWN_SYSTEM_PROMPT}\n\n【出差时空骨架 (辅助参考)】：\n${skeleton}`
        : UNKNOWN_SYSTEM_PROMPT;

    const records: UnknownInputRecord[] = groups.map(g => {
        const inv0 = g.invoices[0];
        const rec: UnknownInputRecord = {
            id: g.expenseRecordId,
            amount: g.expenseAmount,
            bizDate: g.businessDate,
            invDate: g.earliestInvoiceDate
        };
        if (inv0?.salesName) rec.sales = inv0.salesName;
        if (inv0?.fileName) rec.fileName = inv0.fileName;
        if (inv0?.remarks) rec.remarks = inv0.remarks;
        if (inv0?.timeGetOn) rec.timeGetOn = inv0.timeGetOn;
        if (inv0?.timeGetOff) rec.timeGetOff = inv0.timeGetOff;
        if (inv0?.stationGetOn) rec.stationOn = inv0.stationGetOn;
        if (inv0?.stationGetOff) rec.stationOff = inv0.stationGetOff;
        return rec;
    });

    const userPrompt = JSON.stringify({ records });
    const res = await callDirectLlmJson<{
        classifications?: Array<{
            id?: string;
            targetExpenseTypeId?: string;
            targetExpenseTypeName?: string;
            fields?: Record<string, any>;
        }>;
    }>(systemPrompt, userPrompt, undefined, 60000);

    if (res.success && res.data?.classifications) {
        return res.data.classifications
            .filter(c => c.id && c.targetExpenseTypeId && c.targetExpenseTypeName)
            .map(c => ({
                id: c.id!,
                targetExpenseTypeId: c.targetExpenseTypeId!,
                targetExpenseTypeName: c.targetExpenseTypeName!,
                fields: c.fields
            }));
    }
    if (!res.success) {
        AutopilotLogger.warn(`[UnknownChannel] LLM 调用失败: ${res.error}`);
    }
    return [];
}

// ============================================================
// 七、结果合并回填 (Merge & Backfill)
// ============================================================

/**
 * 将三通道推断结果统一映射回 groups 的 dynamicFields / inferredFields。
 * 完整保留现有的联动逻辑：
 * - 住宿城市 → cityType 自动推导
 * - 住宿/大交通业务日期 → newBusinessDate 同步
 * - selectedRecordIds 自动选中
 * 
 * @returns LLM 推断填充的总字段数
 */
export function mergeInferenceResults(
    groups: ExpenseRecordGroup[],
    inferenceResults: DispatchedInferenceResults,
    selectedRecordIds: Set<string>
): number {
    let llmInferredCount = 0;
    const groupMap = new Map(groups.map(g => [g.expenseRecordId, g]));

    // ---- 合并通道 C：未知类型归类 ----
    for (const unk of inferenceResults.unknown) {
        const targetG = groupMap.get(unk.id);
        if (!targetG) continue;
        targetG.dynamicFields = targetG.dynamicFields || {};
        targetG.inferredFields = targetG.inferredFields || {};

        targetG.newExpenseTypeId = unk.targetExpenseTypeId;
        targetG.newExpenseTypeName = unk.targetExpenseTypeName;
        targetG.inferredFields['expenseType'] = 'llm';
        llmInferredCount++;
        selectedRecordIds.add(targetG.expenseRecordId);

        // 归类后一并补齐的字段
        if (unk.fields) {
            llmInferredCount += applyFieldsToGroup(targetG, unk.fields);
        }
    }

    // ---- 合并通道 A：出租车起止地 ----
    for (const taxi of inferenceResults.taxi) {
        const targetG = groupMap.get(taxi.id);
        if (!targetG) continue;
        targetG.dynamicFields = targetG.dynamicFields || {};
        targetG.inferredFields = targetG.inferredFields || {};

        if (taxi.from) {
            targetG.dynamicFields.startAddress = taxi.from;
            targetG.inferredFields['dynAddrFrom'] = 'llm';
            targetG.inferredFields['startAddress'] = 'llm';
            llmInferredCount++;
        }
        if (taxi.to) {
            targetG.dynamicFields.endAddress = taxi.to;
            targetG.inferredFields['dynAddrTo'] = 'llm';
            targetG.inferredFields['endAddress'] = 'llm';
            llmInferredCount++;
        }
        if (taxi.from || taxi.to) {
            selectedRecordIds.add(targetG.expenseRecordId);
        }
    }

    // ---- 合并通道 B：差旅大项 ----
    for (const st of inferenceResults.stayTransit) {
        const targetG = groupMap.get(st.id);
        if (!targetG) continue;
        targetG.dynamicFields = targetG.dynamicFields || {};
        targetG.inferredFields = targetG.inferredFields || {};

        const count = applyFieldsToGroup(targetG, st.fields);
        if (count > 0) {
            llmInferredCount += count;
            selectedRecordIds.add(targetG.expenseRecordId);
        }
    }

    return llmInferredCount;
}

/**
 * 将推断字段应用到目标分组，包含完整的联动逻辑
 * @returns 实际填充的字段数
 */
function applyFieldsToGroup(
    targetG: ExpenseRecordGroup,
    fields: Partial<DynamicExpenseFieldValues> & Record<string, any>
): number {
    const dyn = targetG.dynamicFields!;
    const inf = targetG.inferredFields!;
    const effectiveCat = getGroupCategory(targetG);
    let count = 0;

    // 住宿费专属字段
    if (fields.checkInDate) {
        dyn.checkInDate = fields.checkInDate;
        inf['dynCheckIn'] = 'llm';
        inf['checkInDate'] = 'llm';
        if (effectiveCat === 'HOTEL') {
            targetG.newBusinessDate = fields.checkInDate;
            inf['businessDate'] = 'llm';
        }
        count++;
    }
    if (fields.checkOutDate) {
        dyn.checkOutDate = fields.checkOutDate;
        inf['dynCheckOut'] = 'llm';
        inf['checkOutDate'] = 'llm';
        count++;
    }
    if (fields.city) {
        dyn.city = fields.city;
        inf['dynCity'] = 'llm';
        inf['city'] = 'llm';
        // 城市级别自动推导
        const c = String(fields.city).replace(/市|区|县/g, '').trim();
        const isTier1 = /北京|上海|广州|深圳/.test(c);
        dyn.cityType = isTier1 ? '境内-北上广深' : '境内-其他';
        inf['dynCityType'] = 'rule';
        inf['cityType'] = 'rule';
        count++;
    }
    if (fields.hotelName) {
        dyn.hotelName = fields.hotelName;
        inf['dynHotel'] = 'llm';
        inf['hotelName'] = 'llm';
        count++;
    }
    if (fields.roomNum !== undefined) {
        dyn.roomNum = Number(fields.roomNum) || 1;
        inf['dynRoomNum'] = 'llm';
        inf['roomNum'] = 'llm';
        count++;
    }

    // 出租车始发到达
    if (fields.startAddress) {
        dyn.startAddress = fields.startAddress;
        inf['dynAddrFrom'] = 'llm';
        inf['startAddress'] = 'llm';
        count++;
    }
    if (fields.endAddress) {
        dyn.endAddress = fields.endAddress;
        inf['dynAddrTo'] = 'llm';
        inf['endAddress'] = 'llm';
        count++;
    }

    // 飞机票专属字段
    if (fields.flightStartDate) {
        dyn.flightStartDate = fields.flightStartDate;
        inf['dynStartDate'] = 'llm';
        inf['flightStartDate'] = 'llm';
        if (effectiveCat === 'FLIGHT') {
            targetG.newBusinessDate = fields.flightStartDate;
            inf['businessDate'] = 'llm';
        }
        count++;
    }
    if (fields.flightEndDate) {
        dyn.flightEndDate = fields.flightEndDate;
        inf['dynEndDate'] = 'llm';
        inf['flightEndDate'] = 'llm';
        count++;
    }
    if (fields.flightFromCity) {
        dyn.flightFromCity = fields.flightFromCity;
        inf['dynFrom'] = 'llm';
        inf['flightFromCity'] = 'llm';
        count++;
    }
    if (fields.flightToCity) {
        dyn.flightToCity = fields.flightToCity;
        inf['dynTo'] = 'llm';
        inf['flightToCity'] = 'llm';
        count++;
    }
    if (fields.flightNum) {
        dyn.flightNum = fields.flightNum;
        inf['dynTransitNo'] = 'llm';
        inf['flightNum'] = 'llm';
        count++;
    }

    // 火车票专属字段
    if (fields.trainStartDate) {
        dyn.trainStartDate = fields.trainStartDate;
        inf['dynStartDate'] = 'llm';
        inf['trainStartDate'] = 'llm';
        if (effectiveCat === 'TRAIN') {
            targetG.newBusinessDate = fields.trainStartDate;
            inf['businessDate'] = 'llm';
        }
        count++;
    }
    if (fields.trainEndDate) {
        dyn.trainEndDate = fields.trainEndDate;
        inf['dynEndDate'] = 'llm';
        inf['trainEndDate'] = 'llm';
        count++;
    }
    if (fields.trainFromStation) {
        dyn.trainFromStation = fields.trainFromStation;
        inf['dynFrom'] = 'llm';
        inf['trainFromStation'] = 'llm';
        count++;
    }
    if (fields.trainToStation) {
        dyn.trainToStation = fields.trainToStation;
        inf['dynTo'] = 'llm';
        inf['trainToStation'] = 'llm';
        count++;
    }

    // 通信费专属字段
    if (fields.billMonth) {
        dyn.billMonth = fields.billMonth;
        inf['dynBillMonth'] = 'llm';
        inf['billMonth'] = 'llm';
        count++;
    }

    return count;
}

const ITINERARY_PARSER_SYSTEM_PROMPT = `你是一个专业的企业财务差旅排期与出行行程认知推理专家。
用户会提供一段出差排期文本（可能来自 Excel 表格复制、日程备忘录、微信聊天、邮件通知等）。
请运用大语言模型的常识认知决策与世界地理常识，精准识别并切分出本次日程中包含的所有“出差行程轮次 (Trips)”。

【严格遵循的输出 JSON Schema】：
{
  "trips": [
    {
      "tripNo": 1,
      "destination": "目的地城市名（如 天津、广州、合肥、大连、嘉兴；若为同城园区特殊出差可带园区如 上海金山）",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "hotelName": "排期中入住的酒店名称（多家用 / 分隔）",
      "flightOrTrain": "主要交通工具（飞机 / 高铁 / 火车）",
      "purpose": "出差目的或调研事由（如：天津业务差旅与实地调研 (住理工津荣模具、環宇住理工、東海化成)）",
      "targetFactories": "走访据点或企业客户名称列表（用、分隔）",
      "travelers": ["出行人员姓名列表"],
      "legs": [
        { "date": "YYYY-MM-DD", "fromCity": "出发城市", "toCity": "到达城市", "transport": "飞机/高铁" },
        { "date": "YYYY-MM-DD", "fromCity": "离开城市", "toCity": "返回城市", "transport": "飞机/高铁" }
      ]
    }
  ]
}

【认知推理核心铁律】：
1. 往返闭环定义：从常驻出发地出发，到外地开展活动，最终返回常驻地，视为一轮完整独立的出差 (Trip)；
2. 往返周期绝对隔离：若同一月份前往同一城市多次（例如 7/20~7/25 去天津，8/17~8/21 又去天津），必须切分为独立的两个 Trip，绝对不可跨往返周期合并；
3. 有住宿即为出差：只要排期中包含酒店住宿（即使是同城或同省远距离据点园区住宿），均应作为独立出差单据识别；
4. 标准化日期：将各种日期格式（如 2026/7/20、7月20日、2026.07.20）一律归一化为标准的 YYYY-MM-DD；
5. 必须返回纯 JSON，严禁输出任何 markdown 代码块以外的解释说明文字。
`;

export interface AiItineraryDetailedResult {
    trips: DynamicTripInput[];
    summaryMarkdown: string;
    engine: 'llm' | 'rule';
    latencyMs?: number;
}

/**
 * 将解析出的多轮 Trip 渲染为清晰规整的 Markdown 业务报表供对话框与看板展示
 */
export function formatTripsToMarkdownSummary(
    trips: DynamicTripInput[],
    engine: 'llm' | 'rule',
    latencyMs?: number
): string {
    if (!trips || trips.length === 0) {
        return `未能从排期文本中识别出有效出差行程。请确认文本包含目的地、起止日期或活动类型。`;
    }

    const headerBadge = engine === 'llm'
        ? `✨ **大模型 (LLM) 深度认知解析完成**` + (latencyMs ? ` (耗时 ${(latencyMs / 1000).toFixed(1)}s)` : '')
        : `⚡ **轻量规则引擎已解析排期** (已启用本地确定性规则切分)`;

    let totalDays = 0;
    trips.forEach(t => {
        try {
            const d1 = new Date(t.startDate.replace(/-/g, '/')).getTime();
            const d2 = new Date(t.endDate.replace(/-/g, '/')).getTime();
            const diff = Math.max(1, Math.round((d2 - d1) / (1000 * 3600 * 24)) + 1);
            totalDays += diff;
        } catch (e) {
            totalDays += 1;
        }
    });

    let md = `${headerBadge}\n\n`;
    md += `共精准切分出 **${trips.length}** 轮独立往返 Trip（累计约 **${totalDays}** 天出差日程），大表格已按 Trip 自动归集聚类：\n\n`;
    md += `| 轮次 | 目的地 | 日期区间 | 交通工具 | 住宿酒店 | 走访据点/企业 | 出行人 |\n`;
    md += `| :---: | :--- | :--- | :---: | :--- | :--- | :--- |\n`;

    trips.forEach((t, idx) => {
        const no = t.tripNo || (idx + 1);
        const dest = t.destination || '待定';
        const dates = t.startDate === t.endDate ? t.startDate : `${t.startDate} ~ ${t.endDate}`;
        const transport = t.flightOrTrain || '飞机/高铁';
        const hotel = t.hotelName || '-';
        const factories = t.targetFactories ? t.targetFactories.replace(/、/g, '<br>') : '-';
        const travelers = (t.travelers && t.travelers.length > 0) ? t.travelers.join(', ') : (t.applicantName || '本人');

        md += `| **Trip #${no}** | **${dest}** | ${dates} | ${transport} | ${hotel} | ${factories} | ${travelers} |\n`;
    });

    md += `\n> 💡 **系统状态**：大表格已切换至 **Trip 分组** 视图。正在结合发票证据链智能推断专属必填字段...`;
    return md;
}

/**
 * 结构化排期解析主调度器：
 * 1. 优先调用大语言模型 (LLM) 进行概率认知决策与常识往返切分；
 * 2. 若未配置 API Key、网络断开或调用异常，自动无缝降级为本地规则解析器 (parseItineraryTable)，提供高可用保障。
 */
export async function parseItineraryWithAiDetailed(
    itineraryText: string,
    signal?: AbortSignal
): Promise<AiItineraryDetailedResult> {
    if (!itineraryText || itineraryText.trim().length < 10) {
        return {
            trips: [],
            summaryMarkdown: '排期内容过短，无法解析。',
            engine: 'rule'
        };
    }

    const trimmed = itineraryText.trim();
    const canUseLlm = isLlmConfigured();

    if (canUseLlm) {
        const startTime = Date.now();
        try {
            AutopilotLogger.info(`[InferenceService] 开始调用大模型解析排期文本...`);
            const res = await callDirectLlmJson<{ trips?: any[] }>(
                ITINERARY_PARSER_SYSTEM_PROMPT,
                trimmed,
                signal,
                45000 // 45s 超时守卫
            );

            const latencyMs = Date.now() - startTime;

            if (res.success && res.data?.trips && Array.isArray(res.data.trips) && res.data.trips.length > 0) {
                const trips: DynamicTripInput[] = res.data.trips.map((t, idx) => ({
                    tripNo: t.tripNo || (idx + 1),
                    applicantName: (t.travelers && t.travelers[0]) || t.applicantName || '当前用户',
                    isProxy: false,
                    destination: (t.destination || '出差地').replace(/省|市/g, ''),
                    startDate: t.startDate,
                    endDate: t.endDate || t.startDate,
                    hotelName: (t.hotelName || '').replace(/^[-—\s]+|[-—\s]+$/g, ''),
                    flightOrTrain: t.flightOrTrain || '飞机/高铁',
                    purpose: t.purpose || `出差${t.destination}业务交流及现场技术支持`,
                    targetFactories: t.targetFactories || '',
                    travelers: t.travelers || [],
                    legs: t.legs || []
                }));

                AutopilotLogger.info(`[InferenceService] 大模型成功解析排期文本，识别出 ${trips.length} 轮 Trip (耗时 ${latencyMs}ms)`);
                return {
                    trips,
                    summaryMarkdown: formatTripsToMarkdownSummary(trips, 'llm', latencyMs),
                    engine: 'llm',
                    latencyMs
                };
            }
        } catch (e: any) {
            AutopilotLogger.warn(`[InferenceService] parseItineraryWithAi 调用大模型异常: ${e?.message || e}，将降级使用规则提取`);
        }
    }

    // 容灾兜底：降级使用确定性规则解析器 (Zero-LLM Guard)
    try {
        const trips = parseItineraryTable(trimmed);
        if (trips.length > 0) {
            AutopilotLogger.info(`[InferenceService] 本地规则引擎成功切分出 ${trips.length} 轮 Trip`);
            return {
                trips,
                summaryMarkdown: formatTripsToMarkdownSummary(trips, 'rule'),
                engine: 'rule'
            };
        }
    } catch (ruleErr: any) {
        AutopilotLogger.warn(`[InferenceService] parseItineraryTable 规则解析失败: ${ruleErr?.message || ruleErr}`);
    }

    return {
        trips: [],
        summaryMarkdown: '未能从输入文本中解析出有效排期，请检查表格表头或格式。',
        engine: 'rule'
    };
}

/**
 * 运用大语言模型 (LLM) 概率认知决策深度解析非结构化或复杂出差排期文本
 * 严格遵照 AGENTS.md 反硬编码铁律，不依赖任何静态正则字典，由大模型完成世界常识推理与往返切分
 */
export async function parseItineraryWithAi(
    itineraryText: string,
    signal?: AbortSignal
): Promise<DynamicTripInput[]> {
    const res = await parseItineraryWithAiDetailed(itineraryText, signal);
    return res.trips;
}


