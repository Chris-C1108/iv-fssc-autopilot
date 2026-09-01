import { TIME_MG_CONSTANTS } from '../config/timeMgConstants';
import { ProjectExpItem, AttendanceDetailItem, AllocatedDayPlan, BudgetShortfallInfo } from '../types/timeMgTypes';

/**
 * 格式化提取时间字符串 HH:mm:ss 或 HH:mm
 */
function extractTime(timeStr: string | null): string {
    if (!timeStr) return '';
    const clean = timeStr.trim();
    if (clean.includes(' ')) {
        return clean.split(' ')[1];
    }
    return clean;
}

/**
 * 判定工作时间 [09:00, 17:30] 是否完全在进出记录内
 */
export function checkIsOutOfOffice(inTime: string | null, outTime: string | null): { isOut: boolean; locationName: string; reason: string } {
    const tIn = extractTime(inTime);
    const tOut = extractTime(outTime);

    if (!tIn && !tOut) {
        return {
            isOut: true,
            locationName: TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT,
            reason: '无门禁进出记录'
        };
    }

    if (!tIn || !tOut) {
        return {
            isOut: true,
            locationName: TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT,
            reason: `门禁打卡单边缺失 (进:${tIn || '-'} 出:${tOut || '-'})`
        };
    }

    const time1 = tIn.length === 5 ? `${tIn}:00` : tIn;
    const time2 = tOut.length === 5 ? `${tOut}:00` : tOut;
    const earliest = time1 < time2 ? time1 : time2;
    const latest = time1 > time2 ? time1 : time2;

    const stdStart = '09:00:00';
    const stdEnd = '17:30:00';

    const isCovered = (earliest <= stdStart) && (latest >= stdEnd);

    if (isCovered) {
        return {
            isOut: false,
            locationName: '公司',
            reason: `门禁全覆盖 (最早 ${earliest.substring(0, 5)} ~ 最晚 ${latest.substring(0, 5)})`
        };
    } else {
        const missReasons: string[] = [];
        if (earliest > stdStart) missReasons.push(`到岗晚于09:00(${earliest.substring(0, 5)})`);
        if (latest < stdEnd) missReasons.push(`离岗早于17:30(${latest.substring(0, 5)})`);
        return {
            isOut: true,
            locationName: TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT,
            reason: `打卡未覆盖 (${missReasons.join(', ')})`
        };
    }
}

/**
 * 将小时数向下取整到 0.25h (15分钟刻度)，严禁超出预算
 */
export function floorToQuarterHour(hours: number): number {
    return Math.floor((hours + 1e-6) * 4) / 4;
}

/**
 * 严格基于 15 分钟刻度 (0.25h) 累加工作时间并跳过 12:00 ~ 13:00 午休
 * 返回格式为 HH:mm，分钟严格保证为 00, 15, 30, 45
 */
export function addWorkingHoursQuantized(startTimeStr: string, workHours: number): string {
    const quantizedHours = floorToQuarterHour(workHours);
    const [h, m] = startTimeStr.split(':').map(Number);
    let curMin = h * 60 + m;
    let remainingWorkMin = Math.round(quantizedHours * 60);

    const lunchStart = 12 * 60; // 720 分钟 (12:00)
    const lunchEnd = 13 * 60;   // 780 分钟 (13:00)

    while (remainingWorkMin > 0) {
        if (curMin >= lunchStart && curMin < lunchEnd) {
            curMin = lunchEnd;
        }

        if (curMin < lunchStart) {
            const availBeforeLunch = lunchStart - curMin;
            if (remainingWorkMin <= availBeforeLunch) {
                curMin += remainingWorkMin;
                remainingWorkMin = 0;
            } else {
                remainingWorkMin -= availBeforeLunch;
                curMin = lunchEnd;
            }
        } else {
            curMin += remainingWorkMin;
            remainingWorkMin = 0;
        }
    }

    const endH = String(Math.floor(curMin / 60)).padStart(2, '0');
    const endM = String(curMin % 60).padStart(2, '0');
    return `${endH}:${endM}`;
}

/**
 * 考勤工数智能分配引擎 (支持部分工时自动补全7.5h、已有记录保留、严禁超预算0.25h刻度向下量化与零碎集中拼凑)
 */
export function computeProjectAllocationPlan(
    expProjects: ProjectExpItem[],
    detailDays: AttendanceDetailItem[],
    allowedOverflowPjNos: string[] = []
): AllocatedDayPlan[] {
    const stdHours = TIME_MG_CONSTANTS.DEFAULTS.STANDARD_HOURS; // 7.5h

    // 1. 检查各日期是否已有填写记录，并提取已有分段
    const daysByYmd = new Map<string, AttendanceDetailItem[]>();
    detailDays.forEach(d => {
        if (!daysByYmd.has(d.ymd)) daysByYmd.set(d.ymd, []);
        daysByYmd.get(d.ymd)!.push(d);
    });

    const formatTimeStr = (tStr?: string, defaultVal = '') => {
        if (!tStr) return defaultVal;
        const digits = tStr.replace(/[^0-9]/g, '');
        if (digits.length >= 4) {
            return `${digits.substring(0, 2)}:${digits.substring(2, 4)}`;
        }
        if (tStr.includes(':')) return tStr.substring(0, 5);
        return defaultVal;
    };

    const existingPlansByYmd = new Map<string, AllocatedDayPlan[]>();

    daysByYmd.forEach((items, ymd) => {
        // 筛选出当天已经填写了项目的行 (pjNo 不为空且工时 > 0)
        const filledItems = items.filter(it => Boolean(it.pjNo && it.pjNo.trim().length > 0 && parseFloat(it.timeWH || '0') > 0));
        if (filledItems.length > 0) {
            const plans: AllocatedDayPlan[] = filledItems.map((it: any, idx) => {
                const sTime = formatTimeStr(it.fromDt || it.startTime, '09:00');
                const eTime = formatTimeStr(it.toDt || it.endTime, '17:30');
                const locationCheck = checkIsOutOfOffice(it.inTime, it.outTime);
                const isOut = it.flgOut === '1' || locationCheck.isOut;
                return {
                    ymd: it.ymd,
                    showDate: it.showDate,
                    isWorkDay: true,
                    segmentIndex: idx,
                    totalSegmentsInDay: filledItems.length,
                    inTime: it.inTime,
                    outTime: it.outTime,
                    startTime: sTime,
                    endTime: eTime,
                    timeWH: parseFloat(it.timeWH || '7.5'),
                    isOut: isOut,
                    locationName: isOut ? TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT : '公司',
                    locationReason: locationCheck.reason,
                    pjNo: it.pjNo || '',
                    pjName: it.name || '',
                    pjInfoID: it.pjInfoID || '',
                    status: '已填写'
                };
            });
            existingPlansByYmd.set(ymd, plans);
        }
    });

    // 2. 初始化项目队列并计算剩余所需工时
    const projectQueue = expProjects
        .filter(p => parseFloat(p.expWH) > 0)
        .map(p => {
            const exp = parseFloat(p.expWH);
            const act = parseFloat(p.workingHours || '0');
            const remain = Math.max(0, exp - act);
            const qNeed = floorToQuarterHour(remain);
            return {
                pjNo: p.pjNo,
                name: p.name,
                pjInfoID: p.pjInfoID,
                expWH: exp,
                remainingHours: qNeed
            };
        });

    // 3. 提取所有唯一日期
    const uniqueDays: AttendanceDetailItem[] = [];
    const seenYmd = new Set<string>();
    detailDays.forEach(d => {
        if (!seenYmd.has(d.ymd)) {
            seenYmd.add(d.ymd);
            uniqueDays.push(d);
        }
    });

    // 4. 构建待分配工作日槽位列表 (包含未填写的完整工作日与部分已填但不足7.5h的工作日)
    interface UnfilledSlot {
        ymd: string;
        day: AttendanceDetailItem;
        capacity: number;
        curStartTime: string;
        allocatedSegments: Array<{
            pjNo: string;
            pjName: string;
            pjInfoID: string;
            startTime: string;
            endTime: string;
            timeWH: number;
        }>;
    }

    const unfilledSlots: UnfilledSlot[] = [];

    uniqueDays.forEach(d => {
        const isWorkDay = (d.dtDayType === 1) && (d.onDutyStatus === '1');
        if (!isWorkDay) return;

        const existing = existingPlansByYmd.get(d.ymd) || [];
        const filledHours = existing.reduce((sum, p) => sum + p.timeWH, 0);
        const dayCapacity = Math.max(0, parseFloat((stdHours - filledHours).toFixed(2)));

        if (dayCapacity >= 0.25) {
            // 计算起始时间 (若已有分段，接在最后一个分段的结束时间后；否则 09:00)
            let startT = TIME_MG_CONSTANTS.DEFAULTS.START_TIME_DISPLAY;
            if (existing.length > 0) {
                // 取最大结束时间
                const lastEnd = existing[existing.length - 1].endTime;
                if (lastEnd) startT = lastEnd;
            }

            unfilledSlots.push({
                ymd: d.ymd,
                day: d,
                capacity: dayCapacity,
                curStartTime: startT,
                allocatedSegments: []
            });
        }
    });

    // 阶段 1: 完整工作日优先分配 (待分配工时 >= 7.5h 且 槽位容量 >= 7.5h)
    for (const proj of projectQueue) {
        if (proj.remainingHours < stdHours) continue;

        for (const slot of unfilledSlots) {
            if (slot.capacity >= stdHours && proj.remainingHours >= stdHours) {
                const endTime = addWorkingHoursQuantized(slot.curStartTime, stdHours);
                slot.allocatedSegments.push({
                    pjNo: proj.pjNo,
                    pjName: proj.name,
                    pjInfoID: proj.pjInfoID,
                    startTime: slot.curStartTime,
                    endTime: endTime,
                    timeWH: stdHours
                });
                proj.remainingHours = parseFloat((proj.remainingHours - stdHours).toFixed(2));
                slot.capacity = 0;
                slot.curStartTime = endTime;
            }
        }
    }

    // 阶段 2: 零碎项目集中拼凑 (不足 7.5h，严格按剩余预算分配并填补部分工作日或剩余槽位)
    const remainingFragments = projectQueue.filter(p => p.remainingHours > 0);

    for (const frag of remainingFragments) {
        if (frag.remainingHours <= 0) continue;

        for (const slot of unfilledSlots) {
            while (frag.remainingHours > 0 && slot.capacity > 0) {
                const hoursToAllocate = floorToQuarterHour(Math.min(frag.remainingHours, slot.capacity));
                if (hoursToAllocate <= 0) break;

                const endTime = addWorkingHoursQuantized(slot.curStartTime, hoursToAllocate);
                slot.allocatedSegments.push({
                    pjNo: frag.pjNo,
                    pjName: frag.name,
                    pjInfoID: frag.pjInfoID,
                    startTime: slot.curStartTime,
                    endTime: endTime,
                    timeWH: hoursToAllocate
                });

                frag.remainingHours = parseFloat((frag.remainingHours - hoursToAllocate).toFixed(2));
                slot.capacity = parseFloat((slot.capacity - hoursToAllocate).toFixed(2));
                slot.curStartTime = endTime;
            }
        }
    }

    // 阶段 3: 剩余未填满 7.5h 的工作日槽位 (预算缺口处理)
    // 若用户勾选了允许超预算的项目，则循环分摊给勾选项目；否则项目留空
    const overflowProjs = expProjects.filter(p => allowedOverflowPjNos.includes(p.pjNo));
    let overflowIdx = 0;

    for (const slot of unfilledSlots) {
        while (slot.capacity > 0) {
            const gap = slot.capacity;
            const assignedProj = overflowProjs.length > 0 ? overflowProjs[overflowIdx % overflowProjs.length] : null;
            const endTime = addWorkingHoursQuantized(slot.curStartTime, gap);

            slot.allocatedSegments.push({
                pjNo: assignedProj ? assignedProj.pjNo : '',
                pjName: assignedProj ? assignedProj.name : '',
                pjInfoID: assignedProj ? assignedProj.pjInfoID : '',
                startTime: slot.curStartTime,
                endTime: endTime,
                timeWH: gap
            });

            slot.capacity = 0;
            slot.curStartTime = endTime;
            if (assignedProj) overflowIdx++;
        }
    }

    // 5. 构造完整方案列表 (按自然日历顺序组装，并将同一天所有分段合并重索引)
    const resultPlans: AllocatedDayPlan[] = [];

    uniqueDays.forEach(day => {
        const isWorkDay = (day.dtDayType === 1) && (day.onDutyStatus === '1');

        if (!isWorkDay) {
            resultPlans.push({
                ymd: day.ymd,
                showDate: day.showDate,
                isWorkDay: false,
                segmentIndex: 0,
                totalSegmentsInDay: 1,
                inTime: day.inTime,
                outTime: day.outTime,
                startTime: '',
                endTime: '',
                timeWH: 0,
                isOut: false,
                locationName: '-',
                locationReason: '休假日/非工作日',
                pjNo: '',
                pjName: '',
                pjInfoID: '',
                status: '跳过'
            });
            return;
        }

        const existing = existingPlansByYmd.get(day.ymd) || [];
        const slot = unfilledSlots.find(s => s.ymd === day.ymd);
        const newSegs = slot ? slot.allocatedSegments : [];
        const locationCheck = checkIsOutOfOffice(day.inTime, day.outTime);

        const allDaySegments: AllocatedDayPlan[] = [];

        // 放入已有分段
        existing.forEach(p => allDaySegments.push(p));

        // 放入新分配分段
        newSegs.forEach(seg => {
            allDaySegments.push({
                ymd: day.ymd,
                showDate: day.showDate,
                isWorkDay: true,
                segmentIndex: 0,
                totalSegmentsInDay: 1,
                inTime: day.inTime,
                outTime: day.outTime,
                startTime: seg.startTime,
                endTime: seg.endTime,
                timeWH: seg.timeWH,
                isOut: locationCheck.isOut,
                locationName: locationCheck.locationName,
                locationReason: locationCheck.reason,
                pjNo: seg.pjNo,
                pjName: seg.pjName || (seg.pjNo ? '' : '(未分配)'),
                pjInfoID: seg.pjInfoID,
                status: '就绪'
            });
        });

        // 重新编号分段与总数
        const totalSegs = allDaySegments.length;
        allDaySegments.forEach((plan, sIdx) => {
            plan.segmentIndex = sIdx;
            plan.totalSegmentsInDay = totalSegs;
            resultPlans.push(plan);
        });
    });

    return resultPlans;
}

/**
 * 试算当月项目总预算工时缺口与超出推荐
 */
export function calculateBudgetShortfall(
    expProjects: ProjectExpItem[],
    detailDays: AttendanceDetailItem[],
    plans: AllocatedDayPlan[]
): BudgetShortfallInfo {
    const stdHours = TIME_MG_CONSTANTS.DEFAULTS.STANDARD_HOURS; // 7.5h

    // 1. 统计全月出勤工作日与全月总预算
    const uniqueDaysMap = new Map<string, AttendanceDetailItem>();
    detailDays.forEach(d => {
        if (!uniqueDaysMap.has(d.ymd)) uniqueDaysMap.set(d.ymd, d);
    });

    const allWorkDays = Array.from(uniqueDaysMap.values()).filter(d => d.dtDayType === 1 && d.onDutyStatus === '1');
    const totalMonthHours = parseFloat((allWorkDays.length * stdHours).toFixed(2)); // 如 157.50h (21天)

    const totalMonthBudget = parseFloat(expProjects.reduce((sum, p) => sum + parseFloat(p.expWH || '0'), 0).toFixed(2)); // 如 114.99h
    const monthShortfallHours = parseFloat(Math.max(0, totalMonthHours - totalMonthBudget).toFixed(2)); // 如 42.51h

    // 2. 统计本次待填出勤工作日需求总工时 (如 20天*7.5h + 8/3缺口3.0h = 153.00h)
    const totalRequiredHours = parseFloat(
        plans.filter(p => p.isWorkDay && p.status !== '已填写')
            .reduce((sum, p) => sum + (p.timeWH || 0), 0)
            .toFixed(2)
    );

    // 3. 统计各项目实际可用剩余预算 (向下取整至0.25h)
    let totalAvailableBudget = 0;
    const activeProjects = expProjects
        .filter(p => parseFloat(p.expWH) > 0)
        .map(p => {
            const exp = parseFloat(p.expWH);
            const act = parseFloat(p.workingHours || '0');
            const remain = Math.max(0, exp - act);
            const qRemain = floorToQuarterHour(remain);
            totalAvailableBudget += qRemain;
            return {
                pjNo: p.pjNo,
                name: p.name,
                expWH: exp,
                remainWH: qRemain
            };
        });

    totalAvailableBudget = parseFloat(totalAvailableBudget.toFixed(2));
    const shortfallHours = parseFloat(Math.max(0, totalRequiredHours - totalAvailableBudget).toFixed(2));

    // 按预算大小降序排序，推荐优先追加/超出的项目
    const suggestedProjects = activeProjects.sort((a, b) => b.expWH - a.expWH);

    return {
        totalMonthHours,
        totalMonthBudget,
        monthShortfallHours,
        totalRequiredHours,
        totalAvailableBudget,
        shortfallHours,
        suggestedProjects
    };
}
