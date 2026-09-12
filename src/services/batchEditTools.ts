/**
 * batchEditTools.ts — Agentic Tool Layer & Event-Driven Concurrency
 *
 * Implements:
 * 1. Google Pattern 1: Bidirectional Tool Layer (Internal tool interface + external agent access via window.__batchEditTools)
 * 2. Google Pattern 2: Event-driven concurrency via topic-based BatchEditEventBus
 */

import { TripApplicationConfig } from '../types/state';
import { ExpenseRecordGroup } from '../ui/batchEditExpenseModal';
import {
    extractTripSkeleton,
    dispatchInferenceChannels,
    mergeInferenceResults,
    parseItineraryWithAi
} from './inferenceService';
import {
    createSingleTripApplicationApi,
    parseItineraryTable,
    DynamicTripInput
} from './applicationService';
import { createBillDataAndTemplateByExpenseIdListApi, saveBillDataApi } from './billService';
import { getInvoicePoolGlobalState } from './invoicePoolDomService';
import { Decimal } from '../utils/decimal';
import { AutopilotLogger } from '../utils/logger';

// ==========================================
// 1. Google Pattern 2: Typed EventBus
// ==========================================

export type BatchEditEvent =
    | { type: 'SELECTION_CHANGED'; payload: { selectedIds: Set<string>; count: number; totalAmount: number } }
    | { type: 'INFERENCE_START'; payload: { count: number } }
    | { type: 'INFERENCE_COMPLETE'; payload: { updatedCount: number; timestamp: number } }
    | { type: 'TRIPS_CLUSTERED'; payload: { trips: TripApplicationConfig[]; count: number } }
    | { type: 'BILL_DRAFT_CREATED'; payload: { billType: 'SC' | 'BC' | 'BJ'; count: number; success: boolean } }
    | { type: 'ITINERARY_PARSED'; payload: { dynamicTrips: DynamicTripInput[]; tripCount: number } }
    | { type: 'UI_PANEL_TOGGLED'; payload: { panel: 'SETTINGS' | 'AI'; isOpen: boolean } };

export type BatchEditEventListener = (event: BatchEditEvent) => void;

export class BatchEditEventBus {
    private listeners = new Map<string, Set<BatchEditEventListener>>();

    /**
     * 订阅指定事件或全部事件 ('*' 监听所有事件)
     */
    public subscribe(eventType: string, listener: BatchEditEventListener): () => void {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType)!.add(listener);

        return () => {
            const set = this.listeners.get(eventType);
            if (set) {
                set.delete(listener);
                if (set.size === 0) {
                    this.listeners.delete(eventType);
                }
            }
        };
    }

    /**
     * 发布事件，通知所有对应监听器及通配监听器
     */
    public publish(event: BatchEditEvent): void {
        const specific = this.listeners.get(event.type);
        if (specific) {
            specific.forEach(fn => {
                try {
                    fn(event);
                } catch (err) {
                    AutopilotLogger.warn(`[BatchEditEventBus] Error in listener for ${event.type}: ${(err as Error).message}`);
                }
            });
        }

        const wildcard = this.listeners.get('*');
        if (wildcard) {
            wildcard.forEach(fn => {
                try {
                    fn(event);
                } catch (err) {
                    AutopilotLogger.warn(`[BatchEditEventBus] Error in wildcard listener: ${(err as Error).message}`);
                }
            });
        }
    }
}

export const batchEditEventBus = new BatchEditEventBus();

// ==========================================
// 2. Google Pattern 1: Standardized Tool Interfaces
// ==========================================

export interface ToolResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export interface BatchEditToolsInterface {
    inferSelectedFields(params: {
        groups: ExpenseRecordGroup[];
        selectedRecordIds: Set<string>;
        globalState?: any;
    }): Promise<ToolResult<{ updatedCount: number }>>;

    parseItinerary(params: {
        rawText: string;
    }): Promise<ToolResult<{ dynamicTrips: DynamicTripInput[] }>>;

    clusterTrips(params: {
        groups: ExpenseRecordGroup[];
        customTrips?: TripApplicationConfig[];
        itineraryText?: string;
    }): Promise<ToolResult<{ trips: TripApplicationConfig[] }>>;

    createBillDraft(params: {
        billType: 'SC' | 'BC' | 'BJ';
        tripConfigs?: TripApplicationConfig[];
        expenseRecordIds?: string[];
        globalState?: any;
    }): Promise<ToolResult<{ count: number; billData?: any }>>;

    eventBus: BatchEditEventBus;
}

// ==========================================
// 3. Tool Implementations (Pure Business Logic)
// ==========================================

/**
 * Tool 1: 智能推断已选费用的必填字段
 */
export async function inferSelectedFields(params: {
    groups: ExpenseRecordGroup[];
    selectedRecordIds: Set<string>;
    globalState?: any;
}): Promise<ToolResult<{ updatedCount: number }>> {
    const { groups, selectedRecordIds } = params;
    const targetGroups = groups.filter(g => selectedRecordIds.has(g.expenseRecordId));

    if (targetGroups.length === 0) {
        return { success: false, error: '当前未选中任何费用记录' };
    }

    batchEditEventBus.publish({
        type: 'INFERENCE_START',
        payload: { count: targetGroups.length }
    });

    try {
        const skeletons = extractTripSkeleton(groups);
        const results = await dispatchInferenceChannels(targetGroups, groups, skeletons);
        const updatedCount = mergeInferenceResults(groups, results, selectedRecordIds);

        batchEditEventBus.publish({
            type: 'INFERENCE_COMPLETE',
            payload: { updatedCount, timestamp: Date.now() }
        });

        return {
            success: true,
            data: { updatedCount },
            message: `成功推断 ${updatedCount} 笔费用的必填字段`
        };
    } catch (e: any) {
        return { success: false, error: e.message || '推断过程异常' };
    }
}

/**
 * Tool 2: 解析排期文本 (LLM 概率认知 + 规则兜底)
 */
export async function parseItinerary(params: {
    rawText: string;
}): Promise<ToolResult<{ dynamicTrips: DynamicTripInput[] }>> {
    const clean = params.rawText.trim();
    if (!clean) {
        return { success: false, error: '排期内容为空' };
    }

    try {
        let dynamicTrips: DynamicTripInput[] = [];
        try {
            dynamicTrips = await parseItineraryWithAi(clean);
        } catch (aiErr: any) {
            AutopilotLogger.warn(`[BatchEditTools] AI parse fallback: ${aiErr.message}`);
        }

        if (!dynamicTrips || dynamicTrips.length === 0) {
            dynamicTrips = parseItineraryTable(clean);
        }

        batchEditEventBus.publish({
            type: 'ITINERARY_PARSED',
            payload: { dynamicTrips, tripCount: dynamicTrips.length }
        });

        return {
            success: true,
            data: { dynamicTrips },
            message: `成功解析 ${dynamicTrips.length} 轮行程要素`
        };
    } catch (e: any) {
        return { success: false, error: e.message || '排期解析失败' };
    }
}

/**
 * Tool 3: 创建单据草稿 (SC 出差申请 / BC 出差报销 / BJ 经费报销)
 */
export async function createBillDraft(params: {
    billType: 'SC' | 'BC' | 'BJ';
    tripConfigs?: TripApplicationConfig[];
    expenseRecordIds?: string[];
    globalState?: any;
}): Promise<ToolResult<{ count: number; billData?: any }>> {
    const { billType, tripConfigs, expenseRecordIds, globalState } = params;
    const state = globalState || getInvoicePoolGlobalState();

    try {
        if (billType === 'SC') {
            if (!tripConfigs || tripConfigs.length === 0) {
                return { success: false, error: '未提供 Trip 出差申请配置' };
            }
            let successCount = 0;
            for (const trip of tripConfigs) {
                const res = await createSingleTripApplicationApi(trip, state);
                if (res && res.success) {
                    successCount++;
                }
            }
            batchEditEventBus.publish({
                type: 'BILL_DRAFT_CREATED',
                payload: { billType: 'SC', count: successCount, success: successCount > 0 }
            });
            return {
                success: successCount > 0,
                data: { count: successCount },
                message: `成功创建 ${successCount}/${tripConfigs.length} 轮出差申请单草稿`
            };
        }

        if (billType === 'BC' || billType === 'BJ') {
            if (!expenseRecordIds || expenseRecordIds.length === 0) {
                return { success: false, error: '未提供费用记录 ID 集合' };
            }
            const BILL_DEFINE_IDS = {
                BC: '035a50ee6d3de1653e55bb00bc610001',
                BJ: '035cd1b4d46de1653e55bb00bc610000'
            };
            const defineId = BILL_DEFINE_IDS[billType];
            const tplRes = await createBillDataAndTemplateByExpenseIdListApi(defineId, expenseRecordIds, state);
            if (!tplRes || !tplRes.billData) {
                return { success: false, error: '宿主系统未能生成报销单模板' };
            }

            const saveRes = await saveBillDataApi(tplRes.billData, state);
            if (!saveRes || !saveRes.success) {
                return { success: false, error: saveRes?.error || '报销单草稿保存失败' };
            }

            batchEditEventBus.publish({
                type: 'BILL_DRAFT_CREATED',
                payload: { billType, count: expenseRecordIds.length, success: true }
            });

            return {
                success: true,
                data: { count: expenseRecordIds.length, billData: saveRes.data },
                message: `成功创建 ${billType} 报销单草稿 (${expenseRecordIds.length} 笔费用)`
            };
        }

        return { success: false, error: `不支持的单据类型: ${billType}` };
    } catch (e: any) {
        return { success: false, error: e.message || '建单过程异常' };
    }
}

// ==========================================
// 4. Bidirectional Exposure (Google Pattern 1)
// ==========================================

export const batchEditTools: BatchEditToolsInterface = {
    inferSelectedFields,
    parseItinerary,
    clusterTrips: async () => ({ success: true, data: { trips: [] } }),
    createBillDraft,
    eventBus: batchEditEventBus
};

// 挂载到 window，使外部 Agent / WebMCP 能够直接调用该 Tool Layer
if (typeof window !== 'undefined') {
    (window as any).__batchEditTools = batchEditTools;
}
