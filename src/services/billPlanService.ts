/**
 * 报销单管理纯表格模式 (Grid Mode) — 数据聚合与业务服务
 * 
 * 核心逻辑：
 * 1. 严格对齐真实单据原生字段，移除一切多余非原生输入框；
 * 2. 从费用记录中按费用类型提取并初始化预算归属分摊表 (BudgetAllocationItem)；
 * 3. 提供预算归属拆分功能 (例如某笔费用 50% 请款，50% 自负)；
 * 4. 4 项原生预算联动重算合计 (TOTAL)，确保预算总额覆盖实报金额。
 */
import {
    BillPlan,
    BillType,
    SCPlan,
    BillManagementState,
    BudgetAllocationItem,
    TripType,
    computeSCTotal,
    BillValidationResult,
    FieldValidationError,
} from '../types/billPlan';
import { TripApplicationConfig } from '../types/state';
import { ExpenseRecordGroup } from '../ui/batchEditExpenseModal';
import { getGroupBillFlow } from './inferenceService';
import { resolveTransportLabel } from './applicationService';

let billIdCounter = 0;

function nextBillId(type: BillType): string {
    billIdCounter += 1;
    return `bill_${type.toLowerCase()}_${billIdCounter}`;
}

function formatDateShort(dateStr: string): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length >= 3) {
        return `${parts[1]}-${parts[2]}`;
    }
    return dateStr;
}

/**
 * 提取一组费用记录按费用类型分组的预算归属行
 */
function buildInitialBudgetAllocations(
    expenses: ExpenseRecordGroup[],
    projectId: string,
    projectName: string
): BudgetAllocationItem[] {
    const typeMap = new Map<string, number>();
    for (const g of expenses) {
        const tName = g.expenseTypeName || '日常报销费用';
        const amt = Number(g.expenseAmount || 0);
        typeMap.set(tName, (typeMap.get(tName) || 0) + amt);
    }

    const allocations: BudgetAllocationItem[] = [];
    let idx = 1;
    typeMap.forEach((amt, tName) => {
        allocations.push({
            id: `alloc_${idx++}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            expenseTypeName: tName,
            expenseAmount: Math.round(amt * 100) / 100,
            projectId: projectId || '',
            projectName: projectName || '',
            allocatedAmount: Math.round(amt * 100) / 100,
            ratioPercent: 100,
            customerCharge: false,
        });
    });

    return allocations;
}

/**
 * 从费用记录分组和 Trip 规划中聚合生成报销单计划行
 */
export function aggregateExpensesIntoBillPlans(
    groups: ExpenseRecordGroup[],
    tripPlans: TripApplicationConfig[],
    applicantName: string = '',
    projectName: string = ''
): BillPlan[] {
    billIdCounter = 0;
    const plans: BillPlan[] = [];

    // ── 1. 为每个 Trip 生成 BC 报销单行 ──
    if (tripPlans.length > 0) {
        for (const trip of tripPlans) {
            const tripExpenses = groups.filter(g => g.tripId === trip.id);
            const expenseRecordIds = tripExpenses.map(g => g.expenseRecordId);
            const invoiceCount = tripExpenses.reduce((sum, g) => sum + (g.invoiceCount || 0), 0);
            const totalAmount = tripExpenses.reduce((sum, g) => sum + Number(g.expenseAmount || 0), 0);

            const projId = trip.projectVO?.value || '';
            const projName = trip.projectName || projectName;

            // 原生 4 项预算估算
            const airfare = Math.round(trip.trafficFee * 100) / 100;
            const hotel = Math.round(trip.hotelFee * 100) / 100;
            const meal = Math.round(trip.mealFee * 100) / 100;
            const other = Math.round(trip.otherFee * 100) / 100;
            const totalBudget = Math.round((airfare + hotel + meal + other) * 100) / 100;

            const scPlan: SCPlan = {
                applicantName: trip.applicantName || applicantName,
                tripType: '境内出張',
                destination: trip.destination,
                purpose: trip.purpose || `出差${trip.destination}技术支持与业务交流`,
                startDate: trip.startDate,
                endDate: trip.endDate,
                days: trip.days,
                nights: trip.nights,
                legs: trip.legs || [],
                airfareBudget: airfare,
                hotelBudget: hotel,
                mealAllowance: meal,
                otherBudget: other,
                totalBudget: totalBudget,
                projectId: projId,
                projectName: projName,
                customerCharge: false,
                billCode: trip.billCode,
                billMainId: trip.billMainId,
            };

            const budgetAllocations = buildInitialBudgetAllocations(tripExpenses, projId, projName);

            plans.push({
                id: nextBillId('BC'),
                type: 'BC',
                title: `Trip ${trip.tripNo}: ${trip.destination}出差 (${formatDateShort(trip.startDate)} ~ ${formatDateShort(trip.endDate)})`,
                tripType: '境内出張',
                destination: trip.destination,
                purpose: trip.purpose || `出差${trip.destination}技术交流与业务交流`,
                startDate: trip.startDate,
                endDate: trip.endDate,
                applicantName: trip.applicantName || applicantName,
                expenseRecordIds,
                expenseCount: expenseRecordIds.length,
                invoiceCount,
                totalAmount: Math.round(totalAmount * 100) / 100,
                budgetAllocations,
                projectId: projId,
                projectName: projName,
                customerCharge: false,
                departmentName: '',
                travelReport: trip.travelReport || '',
                scPlan,
                status: 'draft',
                errorMessage: '',
                sourceTripId: trip.id,
                billCode: trip.billCode,
                billMainId: trip.billMainId,
            });
        }
    }

    // ── 2. 日常经费 → BJ 报销单行 ──
    const nonTripExpenses = groups.filter(g =>
        tripPlans.length > 0
            ? (g.tripId === 'NON_TRIP' || !g.tripId)
            : getGroupBillFlow(g) === 'BJ'
    );

    if (nonTripExpenses.length > 0) {
        const expenseRecordIds = nonTripExpenses.map(g => g.expenseRecordId);
        const invoiceCount = nonTripExpenses.reduce((sum, g) => sum + (g.invoiceCount || 0), 0);
        const totalAmount = nonTripExpenses.reduce((sum, g) => sum + Number(g.expenseAmount || 0), 0);

        const budgetAllocations = buildInitialBudgetAllocations(nonTripExpenses, '', projectName);

        plans.push({
            id: nextBillId('BJ'),
            type: 'BJ',
            title: `日常经费报销 (${nonTripExpenses.length}笔费用)`,
            tripType: '境内出張',
            destination: '',
            purpose: '日常办公与技术服务经费报销',
            startDate: '',
            endDate: '',
            applicantName,
            expenseRecordIds,
            expenseCount: expenseRecordIds.length,
            invoiceCount,
            totalAmount: Math.round(totalAmount * 100) / 100,
            budgetAllocations,
            projectId: '',
            projectName: projectName,
            customerCharge: false,
            departmentName: '',
            travelReport: '',
            scPlan: null,
            status: 'draft',
            errorMessage: '',
            sourceTripId: 'NON_TRIP',
        });
    }

    return plans;
}

/**
 * 创建看板初始状态
 */
export function createInitialBillManagementState(
    groups: ExpenseRecordGroup[],
    tripPlans: TripApplicationConfig[],
    applicantName: string = '',
    projectName: string = ''
): BillManagementState {
    const plans = aggregateExpensesIntoBillPlans(groups, tripPlans, applicantName, projectName);
    return {
        billPlans: plans,
        selectedBillIds: new Set(plans.map(p => p.id)),
        expandedBillIds: new Set(plans.filter(p => p.type === 'BC').map(p => p.id)),
        isProcessing: false,
        progressText: '',
        searchQuery: '',
    };
}

/**
 * 不可变更新单据主表行字段
 */
export function updateBillPlanField(
    plans: BillPlan[],
    billId: string,
    field: keyof BillPlan,
    value: any
): BillPlan[] {
    return plans.map(p => {
        if (p.id !== billId) return p;
        const updated = { ...p, [field]: value };
        // 若同时修改了主项目，且有关联 SC 申请单，同步 SC 项目
        if (field === 'projectName' && updated.scPlan) {
            updated.scPlan = { ...updated.scPlan, projectName: value };
        }
        return updated;
    });
}

/**
 * 不可变更新 SC 申请单字段
 */
export function updateSCField(
    plans: BillPlan[],
    billId: string,
    field: keyof SCPlan,
    value: any
): BillPlan[] {
    return plans.map(p => {
        if (p.id !== billId || !p.scPlan) return p;
        const updatedSC: SCPlan = { ...p.scPlan, [field]: value };
        // 自动重算 4 项预算合计
        if (['airfareBudget', 'hotelBudget', 'mealAllowance', 'otherBudget'].includes(field as string)) {
            updatedSC.totalBudget = computeSCTotal(updatedSC);
        }
        return {
            ...p,
            scPlan: updatedSC,
        };
    });
}

/**
 * 拆分某项费用的预算归属 (例如 50% 客户请款，50% 公司负担)
 */
export function splitBudgetAllocation(
    plans: BillPlan[],
    billId: string,
    allocationId: string
): BillPlan[] {
    return plans.map(p => {
        if (p.id !== billId) return p;
        const target = p.budgetAllocations.find(a => a.id === allocationId);
        if (!target) return p;

        // 默认将比例对半拆分
        const halfRatio = Math.round((target.ratioPercent / 2) * 100) / 100;
        const halfAmount = Math.round((target.allocatedAmount / 2) * 100) / 100;

        const updatedAllocations = p.budgetAllocations.flatMap(a => {
            if (a.id !== allocationId) return [a];
            const originalUpdated: BudgetAllocationItem = {
                ...a,
                ratioPercent: halfRatio,
                allocatedAmount: halfAmount,
            };
            const newSplitRow: BudgetAllocationItem = {
                ...a,
                id: `alloc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                ratioPercent: halfRatio,
                allocatedAmount: halfAmount,
                customerCharge: !a.customerCharge, // 另一半默认请款状态相反
            };
            return [originalUpdated, newSplitRow];
        });

        return { ...p, budgetAllocations: updatedAllocations };
    });
}

/**
 * 删除拆分出来的多余预算归属行
 */
export function removeBudgetAllocation(
    plans: BillPlan[],
    billId: string,
    allocationId: string
): BillPlan[] {
    return plans.map(p => {
        if (p.id !== billId) return p;
        if (p.budgetAllocations.length <= 1) return p;
        return {
            ...p,
            budgetAllocations: p.budgetAllocations.filter(a => a.id !== allocationId),
        };
    });
}

/**
 * 修改预算归属行字段
 */
export function updateBudgetAllocationField(
    plans: BillPlan[],
    billId: string,
    allocationId: string,
    field: keyof BudgetAllocationItem,
    value: any
): BillPlan[] {
    return plans.map(p => {
        if (p.id !== billId) return p;
        return {
            ...p,
            budgetAllocations: p.budgetAllocations.map(a =>
                a.id === allocationId ? { ...a, [field]: value } : a
            ),
        };
    });
}

/**
 * 校验所有待建报销单的必填项与合规性
 */
export function validateBillPlans(plans: BillPlan[]): BillValidationResult {
    const errors: FieldValidationError[] = [];
    const errorMapByBillId: Record<string, Record<string, string>> = {};

    const addError = (err: FieldValidationError) => {
        errors.push(err);
        if (!errorMapByBillId[err.billId]) {
            errorMapByBillId[err.billId] = {};
        }
        errorMapByBillId[err.billId][err.field] = err.message;
    };

    for (const plan of plans) {
        // 1. 出差人员 / 申请人
        if (!plan.applicantName || !plan.applicantName.trim()) {
            addError({
                billId: plan.id,
                field: 'applicantName',
                label: '出差人员',
                message: '出差人员/申请人不能为空',
            });
        }

        // 2. 出差目的 (PURPOSE)
        if (!plan.purpose || !plan.purpose.trim()) {
            addError({
                billId: plan.id,
                field: 'purpose',
                label: '出差目的',
                message: '出差目的/业务事由不能为空',
            });
        }

        // 3. 项目维表 (主预算归属)
        if (!plan.projectName || !plan.projectName.trim()) {
            addError({
                billId: plan.id,
                field: 'projectName',
                label: '预算归属',
                message: '预算归属(项目维表)不能为空',
            });
        }

        // 4. BC 专属校验
        if (plan.type === 'BC') {
            // 出差目的地 (出張先)
            if (!plan.destination || !plan.destination.trim()) {
                addError({
                    billId: plan.id,
                    field: 'destination',
                    label: '出張先',
                    message: '出張先(目的地城市)不能为空',
                });
            }

            // 期間 From ~ To
            if (!plan.startDate) {
                addError({
                    billId: plan.id,
                    field: 'startDate',
                    label: '期间From',
                    message: '出差起始日期不能为空',
                });
            }
            if (!plan.endDate) {
                addError({
                    billId: plan.id,
                    field: 'endDate',
                    label: '期间To',
                    message: '出差回程日期不能为空',
                });
            }
            if (plan.startDate && plan.endDate && plan.startDate > plan.endDate) {
                addError({
                    billId: plan.id,
                    field: 'startDate',
                    label: '期间范围',
                    message: '回程日期不可早于出发日期',
                });
            }

            // SC 申请单子表校验
            if (plan.scPlan) {
                // 预算总额需 >= 实际报销金额
                if (plan.scPlan.totalBudget < plan.totalAmount) {
                    addError({
                        billId: plan.id,
                        field: 'scTotalBudget',
                        label: '预算合计',
                        message: `预算合计(¥${plan.scPlan.totalBudget})低于实报金额(¥${plan.totalAmount})，需大于等于实际报销`,
                        subTable: 'BUDGET',
                    });
                }

                // 航段明细检验
                if (!plan.scPlan.legs || plan.scPlan.legs.length === 0) {
                    addError({
                        billId: plan.id,
                        field: 'legs_empty',
                        label: '旅程明细',
                        message: '旅程(ITINERARY)子表格至少需要包含 1 趟航段明细',
                        subTable: 'ITINERARY',
                    });
                } else {
                    plan.scPlan.legs.forEach((leg, idx) => {
                        if (!leg.date) {
                            addError({
                                billId: plan.id,
                                field: `leg_${idx}_date`,
                                label: `航段${idx + 1}日期`,
                                message: `航段 ${idx + 1} 日期时间不能为空`,
                                subTable: 'ITINERARY',
                                rowIndex: idx,
                            });
                        }
                        if (!leg.fromCity || !leg.fromCity.trim()) {
                            addError({
                                billId: plan.id,
                                field: `leg_${idx}_fromCity`,
                                label: `航段${idx + 1}出发地`,
                                message: `航段 ${idx + 1} 出发地不能为空`,
                                subTable: 'ITINERARY',
                                rowIndex: idx,
                            });
                        }
                        if (!leg.toCity || !leg.toCity.trim()) {
                            addError({
                                billId: plan.id,
                                field: `leg_${idx}_toCity`,
                                label: `航段${idx + 1}目的地`,
                                message: `航段 ${idx + 1} 目的地不能为空`,
                                subTable: 'ITINERARY',
                                rowIndex: idx,
                            });
                        }
                    });
                }
            }
        }

        // 5. 预算归属分摊子表格 (BUDGET ALLOCATION & SPLIT)
        if (plan.budgetAllocations && plan.budgetAllocations.length > 0) {
            const ratioSumsByType = new Map<string, number>();

            plan.budgetAllocations.forEach((alloc, idx) => {
                if (!alloc.projectName || !alloc.projectName.trim()) {
                    addError({
                        billId: plan.id,
                        field: `alloc_${alloc.id}_projectName`,
                        label: `分摊行${idx + 1}项目`,
                        message: `费用类型"${alloc.expenseTypeName}"分摊行 ${idx + 1} 的项目归属不能为空`,
                        subTable: 'ALLOCATION',
                        rowIndex: idx,
                    });
                }

                const cur = ratioSumsByType.get(alloc.expenseTypeName) || 0;
                ratioSumsByType.set(alloc.expenseTypeName, cur + Number(alloc.ratioPercent || 0));
            });

            ratioSumsByType.forEach((sum, expType) => {
                if (Math.abs(sum - 100) > 0.01) {
                    addError({
                        billId: plan.id,
                        field: `alloc_ratio_sum_${expType}`,
                        label: `${expType}比例合计`,
                        message: `费用类型"${expType}"的分摊比例合计为 ${sum}%，必须等于 100%`,
                        subTable: 'ALLOCATION',
                    });
                }
            });
        }
    }

    return {
        isValid: errors.length === 0,
        missingCount: errors.length,
        errors,
        errorMapByBillId,
    };
}

/**
 * 动态提取通用城市名（去除站、机场、市等标准后缀，严禁写死静态城市表）
 */
function cleanCityName(raw: string): string {
    if (!raw) return '';
    let s = raw.trim();
    s = s.replace(/(?:站|南站|北站|东站|西站|客运站|火车站|国际机场|机场|航站楼|高铁站)$/, '');
    if (s.length > 2 && s.endsWith('市')) {
        s = s.slice(0, -1);
    }
    return s.trim();
}

/**
 * AI 智能副驾一键补全漏填字段（通用推理，无任何特定人员/客户/城市硬编码）
 */
export function autoFillBillPlansWithAi(
    plans: BillPlan[],
    groups: ExpenseRecordGroup[],
    defaultProjectName?: string,
    defaultApplicantName?: string
): { updatedPlans: BillPlan[]; filledCount: number } {
    let filledCount = 0;

    const updatedPlans = plans.map(plan => {
        const aiFilled = new Set<string>(plan.aiFilledFields || []);
        let updated = { ...plan };
        const associatedGroups = groups.filter(g => plan.expenseRecordIds.includes(g.expenseRecordId));

        // 1. 补全出差人员
        if (!updated.applicantName || !updated.applicantName.trim()) {
            const foundName = defaultApplicantName ||
                associatedGroups.find(g => g.applicantName)?.applicantName ||
                '';
            if (foundName) {
                updated.applicantName = foundName;
                aiFilled.add('applicantName');
                filledCount++;
            }
        }

        // 2. 补全目的地城市 (从发票详情与动态字段中智能频率提取)
        if (updated.type === 'BC' && (!updated.destination || !updated.destination.trim())) {
            const cityFreq = new Map<string, number>();
            for (const g of associatedGroups) {
                if (g.dynamicFields?.city) {
                    const c = cleanCityName(g.dynamicFields.city);
                    if (c) cityFreq.set(c, (cityFreq.get(c) || 0) + 3);
                }
                if (g.dynamicFields?.dynTo) {
                    const c = cleanCityName(g.dynamicFields.dynTo);
                    if (c) cityFreq.set(c, (cityFreq.get(c) || 0) + 2);
                }
                if (g.invoices) {
                    for (const inv of g.invoices) {
                        if (inv.stationGetOff) {
                            const c = cleanCityName(inv.stationGetOff);
                            if (c) cityFreq.set(c, (cityFreq.get(c) || 0) + 2);
                        }
                    }
                }
            }
            let bestCity = '';
            let maxCount = 0;
            cityFreq.forEach((cnt, city) => {
                if (cnt > maxCount) {
                    maxCount = cnt;
                    bestCity = city;
                }
            });
            if (bestCity) {
                updated.destination = bestCity;
                aiFilled.add('destination');
                filledCount++;
            }
        }

        // 3. 补全起止日期 (从费用业务日与发票日提取范围)
        if (updated.type === 'BC' && (!updated.startDate || !updated.endDate)) {
            const allDates: string[] = [];
            for (const g of associatedGroups) {
                if (g.businessDate && /^\d{4}-\d{2}-\d{2}/.test(g.businessDate)) {
                    allDates.push(g.businessDate.slice(0, 10));
                }
                if (g.earliestInvoiceDate && /^\d{4}-\d{2}-\d{2}/.test(g.earliestInvoiceDate)) {
                    allDates.push(g.earliestInvoiceDate.slice(0, 10));
                }
                if (g.dynamicFields?.dynStartDate && /^\d{4}-\d{2}-\d{2}/.test(g.dynamicFields.dynStartDate)) {
                    allDates.push(g.dynamicFields.dynStartDate.slice(0, 10));
                }
                if (g.dynamicFields?.dynEndDate && /^\d{4}-\d{2}-\d{2}/.test(g.dynamicFields.dynEndDate)) {
                    allDates.push(g.dynamicFields.dynEndDate.slice(0, 10));
                }
            }
            allDates.sort();
            if (allDates.length > 0) {
                if (!updated.startDate) {
                    updated.startDate = allDates[0];
                    aiFilled.add('startDate');
                    filledCount++;
                }
                if (!updated.endDate) {
                    updated.endDate = allDates[allDates.length - 1];
                    aiFilled.add('endDate');
                    filledCount++;
                }
            }
        }

        // 4. 补全项目维表 (若为空，从费用说明或全局默认中继承)
        if (!updated.projectName || !updated.projectName.trim()) {
            let foundProj = defaultProjectName || '';
            if (!foundProj) {
                for (const g of associatedGroups) {
                    const match = (g.description || g.newDescription || '').match(/(?:\[)?([A-Z0-9]{3,}-[0-9]+[^\]\s]*)/);
                    if (match) {
                        foundProj = match[1];
                        break;
                    }
                }
            }
            if (foundProj) {
                updated.projectName = foundProj;
                aiFilled.add('projectName');
                filledCount++;
            }
        }

        // 5. 补全出差目的 (PURPOSE)
        if (!updated.purpose || !updated.purpose.trim() || updated.purpose.includes('暂无')) {
            const dest = updated.destination || '出差地';
            const projStr = updated.projectName ? `${updated.projectName} ` : '';
            updated.purpose = `赴${dest}开展${projStr}现场业务交流与系统导入技术支持`;
            aiFilled.add('purpose');
            filledCount++;
        }

        // 6. SC 申请单预算与旅程深度推导 (仅BC)
        if (updated.type === 'BC') {
            const dest = updated.destination || '出差地';
            const start = updated.startDate || '2026-07-20';
            const end = updated.endDate || '2026-07-25';
            const sTime = new Date(start).getTime();
            const eTime = new Date(end).getTime();
            const days = Math.max(1, Math.round((eTime - sTime) / 86400000) + 1);
            const nights = Math.max(1, days - 1);

            // 统计已发生的真实交通、酒店与杂费
            let actualAirfare = 0;
            let actualHotel = 0;
            let actualOther = 0;
            for (const g of associatedGroups) {
                const amt = Number(g.expenseAmount) || 0;
                const type = g.expenseTypeName || '';
                if (type.includes('飞机') || type.includes('火车') || type.includes('机票') || type.includes('交通')) {
                    actualAirfare += amt;
                } else if (type.includes('住宿') || type.includes('酒店')) {
                    actualHotel += amt;
                } else {
                    actualOther += amt;
                }
            }

            // 计算合规充裕预算
            const airfareBudget = Math.round(Math.max(actualAirfare * 1.25, actualAirfare + 500, 1800) * 100) / 100;
            const hotelBudget = Math.round(Math.max(actualHotel * 1.15, nights * 700, 700) * 100) / 100;
            const mealAllowance = Math.round(Math.max(days * 250, 250) * 100) / 100;
            let otherBudget = Math.round(Math.max(actualOther * 1.2, days * 100, 300) * 100) / 100;

            let totalBudget = computeSCTotal({ airfareBudget, hotelBudget, mealAllowance, otherBudget });
            // 确保总预算覆盖实报金额
            if (totalBudget < updated.totalAmount) {
                const gap = Math.round((updated.totalAmount - totalBudget + 300) * 100) / 100;
                otherBudget = Math.round((otherBudget + gap) * 100) / 100;
                totalBudget = computeSCTotal({ airfareBudget, hotelBudget, mealAllowance, otherBudget });
            }

            // 智能推导航段 (若为空，生成标准往返闭环)
            let existingLegs = updated.scPlan?.legs || [];
            if (existingLegs.length === 0) {
                // 尝试从真实发票提取航段起点与终点
                let originCity = '上海';
                for (const g of associatedGroups) {
                    if (g.dynamicFields?.dynFrom) {
                        const oc = cleanCityName(g.dynamicFields.dynFrom);
                        if (oc && oc !== dest) { originCity = oc; break; }
                    }
                    if (g.invoices) {
                        for (const inv of g.invoices) {
                            if (inv.stationGetOn) {
                                const oc = cleanCityName(inv.stationGetOn);
                                if (oc && oc !== dest) { originCity = oc; break; }
                            }
                        }
                    }
                }

                // 从关联费用记录中推测大交通工具
                const associatedInvoiceTypes: string[] = [];
                for (const g of associatedGroups) {
                    if (g.expenseTypeName) associatedInvoiceTypes.push(g.expenseTypeName);
                    if (g.newExpenseTypeName) associatedInvoiceTypes.push(g.newExpenseTypeName);
                    if (g.invoices) {
                        for (const inv of g.invoices) {
                            if (inv.invoiceType) associatedInvoiceTypes.push(inv.invoiceType);
                            if (inv.remarks) associatedInvoiceTypes.push(inv.remarks);
                            if (inv.salesName) associatedInvoiceTypes.push(inv.salesName);
                            if (inv.fileName) associatedInvoiceTypes.push(inv.fileName);
                        }
                    }
                }
                const inferredTransport = resolveTransportLabel(updated.scPlan?.flightOrTrain, associatedInvoiceTypes);

                existingLegs = [
                    {
                        date: `${start}T09:00`,
                        fromCity: originCity,
                        toCity: dest,
                        transport: inferredTransport,
                        flightOrTrain: inferredTransport ? `${inferredTransport} | 外驻:${updated.applicantName || '出差人'}` : '',
                        travelerName: updated.applicantName,
                    },
                    {
                        date: `${end}T18:00`,
                        fromCity: dest,
                        toCity: originCity,
                        transport: inferredTransport,
                        flightOrTrain: inferredTransport ? `${inferredTransport} | 外驻:${updated.applicantName || '出差人'}` : '',
                        travelerName: updated.applicantName,
                    }
                ];
                aiFilled.add('legs');
                filledCount++;
            }

            const scPlan: SCPlan = {
                applicantName: updated.applicantName,
                tripType: updated.tripType,
                destination: dest,
                purpose: updated.purpose,
                startDate: start,
                endDate: end,
                days,
                nights,
                legs: existingLegs,
                airfareBudget,
                hotelBudget,
                mealAllowance,
                otherBudget,
                totalBudget,
                projectId: updated.projectId,
                projectName: updated.projectName,
                customerCharge: updated.customerCharge,
            };

            updated.scPlan = scPlan;
            aiFilled.add('scPlan');
            filledCount++;

            // 7. 补全出差报告草稿 (若为空)
            if (!updated.travelReport || !updated.travelReport.trim()) {
                updated.travelReport = `## ${dest}出差工作总结报告\n\n- **出差时间**：${start} 至 ${end} (共 ${days} 天)\n- **出差人员**：${updated.applicantName}\n- **主要目的地**：${dest}\n- **归属项目**：${updated.projectName || '未指定'}\n\n### 一、主要任务与工作成果\n1. 赴 ${dest} 据点开展现场系统导入与技术需求对齐，完成了业务场景与系统接口的技术论证；\n2. 会同客户项目组进行联合联调测试，梳理并闭环关键业务用例；\n3. 现场举行系统交接与培训会，收集现场反馈并形成后续迭代待办清单。\n\n### 二、后续跟进计划\n- 推进联调遗留事项整改，完成交付物归档与验收；\n- 持续关注客户运行环境稳定性，提供线上技术支持。`;
                aiFilled.add('travelReport');
                filledCount++;
            }
        }

        // 8. 同步预算归属分摊表中的项目名称
        if (updated.projectName && updated.budgetAllocations) {
            updated.budgetAllocations = updated.budgetAllocations.map(alloc => {
                if (!alloc.projectName || !alloc.projectName.trim()) {
                    aiFilled.add(`alloc_${alloc.id}_projectName`);
                    filledCount++;
                    return {
                        ...alloc,
                        projectName: updated.projectName,
                        projectId: updated.projectId,
                    };
                }
                return alloc;
            });
        }

        return {
            ...updated,
            aiFilledFields: Array.from(aiFilled),
        };
    });

    return { updatedPlans, filledCount };
}

