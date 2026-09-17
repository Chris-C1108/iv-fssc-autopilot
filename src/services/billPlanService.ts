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
import { TripApplicationConfig, TripLeg } from '../types/state';
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
 * 标准化任何输入日期为 HTML5 datetime-local 及元年标准的 YYYY-MM-DDTHH:mm 格式
 * 解决浏览器 <input type="datetime-local"> 无法识别导致回显空白 (mm/dd/yyyy --:-- --) 的严重缺陷
 */
export function normalizeToDatetimeLocal(val: any, defaultTime: string = '09:00'): string {
    if (!val) return '';
    const str = String(val).trim();
    if (!str) return '';

    // 1. 如果已是标准 YYYY-MM-DDTHH:mm
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
        return str.slice(0, 16);
    }
    // 2. 如果是 YYYY-MM-DD HH:mm:ss 或 YYYY-MM-DD HH:mm
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(str)) {
        return str.replace(/\s+/, 'T').slice(0, 16);
    }
    // 3. 如果是纯日期 YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return `${str}T${defaultTime}`;
    }
    // 4. 如果是 MM/DD/YYYY 或 MM/DD/YYYY HH:mm
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (slashMatch) {
        const month = slashMatch[1].padStart(2, '0');
        const day = slashMatch[2].padStart(2, '0');
        const year = slashMatch[3];
        const hh = slashMatch[4] ? slashMatch[4].padStart(2, '0') : defaultTime.split(':')[0];
        const mm = slashMatch[5] || defaultTime.split(':')[1] || '00';
        return `${year}-${month}-${day}T${hh}:${mm}`;
    }
    // 5. 如果是 YYYY/MM/DD 或 YYYY/MM/DD HH:mm
    const ySlashMatch = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (ySlashMatch) {
        const year = ySlashMatch[1];
        const month = ySlashMatch[2].padStart(2, '0');
        const day = ySlashMatch[3].padStart(2, '0');
        const hh = ySlashMatch[4] ? ySlashMatch[4].padStart(2, '0') : defaultTime.split(':')[0];
        const mm = ySlashMatch[5] || defaultTime.split(':')[1] || '00';
        return `${year}-${month}-${day}T${hh}:${mm}`;
    }
    // 6. 如果是时间戳数字
    const num = Number(str);
    if (!isNaN(num) && num > 100000000000) {
        const d = new Date(num);
        if (!isNaN(d.getTime())) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hh}:${mm}`;
        }
    }
    // 7. Date.parse 兜底
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hh}:${mm}`;
    }
    return '';
}

/**
 * 格式化航班/车次备注为统一规范格式：
 * 建议格式：[人名|外驻:人名]-[飞机|高铁|出租车]-[项目号]
 * 例如：
 *  - [陈浩]-[飞机]-[X2607-001]
 *  - [外驻:成勇]-[飞机]-[X2607-001]
 *  - [外驻:李建勇]-[飞机/高铁]-[X2607-001]
 */
export function formatFlightTrainRemark(
    rawText: string,
    travelerName: string,
    isExternal: boolean,
    projectNameOrCode: string
): string {
    // 1. 动态提取项目编号 (如 X2607-001, PRJ-001)
    let projCode = '';
    const projMatch = (projectNameOrCode || '').match(/(X\d{4}-\d{3}|[A-Z0-9]{2,8}-\d{3,4}|PRJ-[A-Z0-9\-]+)/);
    if (projMatch) {
        projCode = projMatch[1];
    } else if (projectNameOrCode && projectNameOrCode.trim().length <= 15 && !projectNameOrCode.includes(' ')) {
        projCode = projectNameOrCode.trim();
    }

    const cleanRaw = (rawText || '').trim();

    // 若传入的 rawText 中已携带项目编号且前面未提取到
    if (!projCode) {
        const m = cleanRaw.match(/(?:\[)?(X\d{4}-\d{3}|[A-Z0-9]{2,8}-\d{3,4}|PRJ-[A-Z0-9\-]+)(?:\])?/);
        if (m) projCode = m[1];
    }

    // 2. 解析出行人姓名与外驻身份
    let effectiveTraveler = (travelerName || '').trim();
    let effectiveExternal = isExternal;

    if (!effectiveTraveler) {
        const tMatch = cleanRaw.match(/\[(?:外驻[:：])?([^\]]+)\]/) || cleanRaw.match(/\((?:外驻[:：])?([^)]+)\)/);
        if (tMatch) {
            effectiveTraveler = (tMatch[1] || '').trim();
            if (cleanRaw.includes('外驻')) effectiveExternal = true;
        }
    } else {
        if (effectiveTraveler.includes('外驻')) {
            effectiveExternal = true;
            effectiveTraveler = effectiveTraveler.replace(/外驻[:：]/, '').trim();
        }
    }
    // 剔除括号
    effectiveTraveler = effectiveTraveler.replace(/[（()）\[\]]/g, '').trim();

    // 3. 提取纯交通方式/车次 (从 rawText 中剥离括号、出行人、项目号)
    let transport = cleanRaw
        .replace(/\[(?:外驻[:：])?[^\]]+\]/g, '')
        .replace(/\((?:外驻[:：])?[^)]+\)/g, '')
        .replace(/(?:\[)?(X\d{4}-\d{3}|[A-Z0-9]{2,8}-\d{3,4}|PRJ-[A-Z0-9\-]+)(?:\])?/g, '')
        .replace(/[|\-—_]+/g, ' ')
        .trim();

    // 针对常见交通词汇进行标准化清洗
    if (!transport || transport === '未知' || transport === '待定') {
        transport = '飞机/高铁';
    } else if (/MU|CZ|CA|MF|ZH|3U|HU|FM|9C|航空|机/.test(transport) && !/高铁|火车|动车/.test(transport)) {
        if (!/^[A-Z0-9]{5,7}$/.test(transport)) {
            transport = transport.includes('机') ? '飞机' : transport;
        }
    } else if (/高铁|火车|动车|G\d|D\d/.test(transport) && !/机/.test(transport)) {
        if (!/^[GD]\d{1,5}$/.test(transport)) {
            transport = '高铁';
        }
    } else if (/出租|打车|Taxi|滴滴/.test(transport)) {
        transport = '出租车';
    }

    // 4. 组装标准三段式格式: [人名|外驻:人名]-[飞机|高铁|出租车]-[项目号]
    const travelerTag = effectiveExternal
        ? `[外驻:${effectiveTraveler || '同行人'}]`
        : `[${effectiveTraveler || '出差人'}]`;

    const transportTag = `[${transport}]`;
    const projTag = projCode ? `-[${projCode}]` : '';

    return `${travelerTag}-${transportTag}${projTag}`;
}

/**
 * 提取一组费用记录按费用类型分组的预算归属行
 */
function buildInitialBudgetAllocations(
    expenses: ExpenseRecordGroup[],
    projectId: string,
    projectName: string,
    mealAllowanceAmount: number = 0
): BudgetAllocationItem[] {
    const typeMap = new Map<string, number>();
    for (const g of expenses) {
        const tName = g.expenseTypeName || '日常报销费用';
        const amt = Number(g.expenseAmount || 0);
        typeMap.set(tName, (typeMap.get(tName) || 0) + amt);
    }

    // 正社员出差误餐补助：若费用池中尚未包含，则按出差天数标准自动追加正社员餐补
    if (mealAllowanceAmount > 0 && !typeMap.has('误餐补助') && !typeMap.has('误餐补助（誤餐補助）') && !typeMap.has('差旅费-误餐补贴')) {
        typeMap.set('误餐补助（誤餐補助）', mealAllowanceAmount);
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
 * 动态提取行程全部出差人员及全员大交通往返行程 (零硬编码，严格遵循 Anti-Hardcoding 铁律)
 */
export function extractTripTravelersAndLegs(
    plan: {
        applicantName?: string;
        destination?: string;
        startDate?: string;
        endDate?: string;
        travelReport?: string;
        projectName?: string;
        expenseRecordIds: string[];
        scPlan?: { legs?: TripLeg[]; flightOrTrain?: string; projectName?: string } | null;
    },
    expenses: ExpenseRecordGroup[],
    defaultApplicant?: string
): { allTravelers: string[]; companions: string; legs: TripLeg[] } {
    const rawApplicant = plan.applicantName || defaultApplicant || '当前社员';
    const mainApplicant = rawApplicant.replace(/（.*）|\(.*\)/g, '').trim();
    const travelerSet = new Set<string>();
    if (mainApplicant) {
        travelerSet.add(mainApplicant);
    }

    // 1. 从 travelReport 中动态提取出差人员名单 (如 "出差人员：陈浩、成勇、李建勇" 或 "调研人员为陈浩、成勇、李建勇")
    if (plan.travelReport) {
        const reportMatch = plan.travelReport.match(/(?:调研人员为|出差人员[：:]\s*|同行人员[：:]\s*|同行者[：:]\s*)([^\n。\r]+)/);
        if (reportMatch && reportMatch[1]) {
            const rawNames = reportMatch[1].split(/[、,，\s]+/);
            for (const name of rawNames) {
                const clean = name.replace(/（.*）|\(.*\)/g, '').replace(/[*#-]/g, '').trim();
                if (clean && clean.length >= 2 && clean.length <= 10 && !['人员', '同行', '等', '至', '到'].includes(clean)) {
                    travelerSet.add(clean);
                }
            }
        }
    }

    // 2. 从关联费用记录的备注中动态提取外驻出行人 ([外驻:姓名])
    if (Array.isArray(expenses)) {
        for (const exp of expenses) {
            if (plan.expenseRecordIds.includes(exp.expenseRecordId)) {
                const textsToCheck = [
                    exp.newDescription,
                    exp.description,
                    (exp as any).remarks,
                    ...(exp.invoices || []).map((inv: any) => inv.remarks || inv.description || '')
                ].filter(Boolean) as string[];

                for (const text of textsToCheck) {
                    const externalMatches = text.matchAll(/\[外驻[:：]([^\]]+)\]/g);
                    for (const m of externalMatches) {
                        const clean = (m[1] || '').replace(/（.*）|\(.*\)/g, '').trim();
                        if (clean && clean.length >= 2 && clean.length <= 10) {
                            travelerSet.add(clean);
                        }
                    }
                }
            }
        }
    }

    const allTravelers = Array.from(travelerSet);
    const companionsList = allTravelers.filter(t => t !== mainApplicant);
    const companions = companionsList.join('、');

    // 3. 构建包含所有人员的大交通行程 (ITINERARY legs)
    const legs: TripLeg[] = [];
    const destCity = plan.destination || '目的地';
    const originCity = '上海';

    // 从该 Trip 关联的所有费用记录及发票中推测大交通工具类型
    const tripInvoiceTypes: string[] = [];
    if (Array.isArray(expenses)) {
        for (const exp of expenses) {
            if (plan.expenseRecordIds.includes(exp.expenseRecordId)) {
                if (exp.expenseTypeName) tripInvoiceTypes.push(exp.expenseTypeName);
                if (exp.newExpenseTypeName) tripInvoiceTypes.push(exp.newExpenseTypeName);
                for (const inv of (exp.invoices || [])) {
                    if (inv.invoiceType) tripInvoiceTypes.push(inv.invoiceType);
                    if (inv.remarks) tripInvoiceTypes.push(inv.remarks);
                    if (inv.salesName) tripInvoiceTypes.push(inv.salesName);
                    if (inv.fileName) tripInvoiceTypes.push(inv.fileName);
                }
            }
        }
    }
    const tripTransportDefault = resolveTransportLabel(plan.scPlan?.flightOrTrain, tripInvoiceTypes);

    // 若原有 scPlan.legs 中已有具体航班/车次信息，按人员归类
    const existingLegs = plan.scPlan?.legs || [];
    const projName = plan.scPlan?.projectName || (plan as any).projectName || '';

    for (const t of allTravelers) {
        const isExt = t !== mainApplicant && !t.includes(mainApplicant);
        const tLegs = existingLegs.filter(l => {
            const legTraveler = (l.travelerName || '').replace(/（.*）|\(.*\)/g, '').trim();
            return legTraveler === t || (!legTraveler && t === mainApplicant);
        });

        if (tLegs.length > 0) {
            tLegs.forEach(l => {
                const legTransport = resolveTransportLabel(l.flightOrTrain || l.transport, tripInvoiceTypes) || tripTransportDefault;
                legs.push({
                    date: normalizeToDatetimeLocal(l.date || plan.startDate || '', '09:00'),
                    fromCity: (!l.fromCity || l.fromCity === '出发地') ? originCity : l.fromCity,
                    toCity: (!l.toCity || l.toCity === '返回地') ? destCity : l.toCity,
                    transport: legTransport,
                    flightOrTrain: formatFlightTrainRemark(l.flightOrTrain || legTransport, t, isExt, projName),
                    travelerName: t
                });
            });
        } else {
            // 为该人员自动补齐去程与返程对称大交通
            legs.push({
                date: normalizeToDatetimeLocal(plan.startDate || '', '09:00'),
                fromCity: originCity,
                toCity: destCity,
                transport: tripTransportDefault,
                flightOrTrain: formatFlightTrainRemark(tripTransportDefault, t, isExt, projName),
                travelerName: t
            });
            legs.push({
                date: normalizeToDatetimeLocal(plan.endDate || '', '18:00'),
                fromCity: destCity,
                toCity: originCity,
                transport: tripTransportDefault,
                flightOrTrain: formatFlightTrainRemark(tripTransportDefault, t, isExt, projName),
                travelerName: t
            });
        }
    }

    // 按日期与出行人正序排序
    legs.sort((a, b) => {
        const timeDiff = new Date(a.date.replace(/-/g, '/')).getTime() - new Date(b.date.replace(/-/g, '/')).getTime();
        if (timeDiff !== 0) return timeDiff;
        return (a.travelerName || '').localeCompare(b.travelerName || '');
    });

    return { allTravelers, companions, legs };
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
            
            // 原生 4 项预算估算
            const airfare = Math.round(trip.trafficFee * 100) / 100;
            const hotel = Math.round(trip.hotelFee * 100) / 100;
            const meal = Math.round(trip.mealFee * 100) / 100;
            const other = Math.round(trip.otherFee * 100) / 100;
            const totalBudget = Math.round((airfare + hotel + meal + other) * 100) / 100;

            const hasMealInExpenses = tripExpenses.some(g => (g.expenseTypeName || '').includes('误餐'));
            const effectiveMealAmt = hasMealInExpenses ? 0 : meal;
            const totalAmount = tripExpenses.reduce((sum, g) => sum + Number(g.expenseAmount || 0), 0) + effectiveMealAmt;

            const projId = trip.projectVO?.value || '';
            let tripProjName = trip.projectName || '';
            if (!tripProjName) {
                for (const g of tripExpenses) {
                    const m = (g.description || g.newDescription || '').match(/(?:\[)?(X\d{4}-\d{3}|[A-Z0-9]{2,8}-\d{3,4}|PRJ-[A-Z0-9\-]+)/);
                    if (m) {
                        tripProjName = m[1].trim();
                        break;
                    }
                }
            }
            const projName = tripProjName;

            // 动态多出行人及往返大交通航段派生 (零硬编码，支持单据初始回显全员 6 段往返)
            const planLike = {
                applicantName: trip.applicantName || applicantName,
                destination: trip.destination,
                startDate: trip.startDate,
                endDate: trip.endDate,
                travelReport: trip.travelReport || '',
                expenseRecordIds,
                scPlan: {
                    legs: trip.legs || [],
                    flightOrTrain: ''
                }
            };
            const extractedTravelers = extractTripTravelersAndLegs(planLike, tripExpenses, applicantName);
            const effectiveLegs = (trip.legs && trip.legs.length > 2) ? trip.legs : extractedTravelers.legs;

            const scPlan: SCPlan = {
                applicantName: trip.applicantName || applicantName,
                tripType: '境内出張',
                destination: trip.destination,
                purpose: trip.purpose || `出差${trip.destination}技术支持与业务交流`,
                startDate: trip.startDate,
                endDate: trip.endDate,
                days: trip.days,
                nights: trip.nights,
                legs: effectiveLegs,
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

            const budgetAllocations = buildInitialBudgetAllocations(tripExpenses, projId, projName, effectiveMealAmt);

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
        // 若同时修改了主项目，且有关联 SC 申请单，同步 SC 项目及航段备注中的项目号
        if (field === 'projectName' && updated.scPlan) {
            const sc = updated.scPlan;
            const updatedLegs = (sc.legs || []).map(leg => {
                const isExt = leg.travelerName ? (leg.travelerName !== p.applicantName && !leg.travelerName.includes(p.applicantName)) : false;
                return {
                    ...leg,
                    flightOrTrain: formatFlightTrainRemark(leg.flightOrTrain || leg.transport || '', leg.travelerName || '', isExt, value)
                };
            });
            updated.scPlan = { ...sc, projectName: value, legs: updatedLegs };
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

        // 4. 补全项目维表 (优先从该 Trip 自身费用说明中提取，防止全局串行污染)
        if (!updated.projectName || !updated.projectName.trim()) {
            let foundProj = '';
            for (const g of associatedGroups) {
                const match = (g.description || g.newDescription || '').match(/(?:\[)?([A-Z0-9]{3,}-[0-9]+[^\]\s]*)/);
                if (match) {
                    foundProj = match[1];
                    break;
                }
            }
            if (!foundProj && defaultProjectName) {
                foundProj = defaultProjectName;
            }
            if (foundProj) {
                updated.projectName = foundProj;
                if (updated.scPlan) {
                    updated.scPlan.projectName = updated.scPlan.projectName || foundProj;
                }
                updated.budgetAllocations = (updated.budgetAllocations || []).map(alloc => ({
                    ...alloc,
                    projectName: alloc.projectName || foundProj
                }));
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

