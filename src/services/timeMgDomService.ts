import { AllocatedDayPlan, TimeMgState } from '../types/timeMgTypes';
import { AutopilotLogger } from '../utils/logger';
import { checkIsOutOfOffice } from './timeMgAllocation';
import { TIME_MG_CONSTANTS } from '../config/timeMgConstants';

/**
 * 查找页面中包含 Handsontable (hotSettings) 的 AttendanceEdit Vue 组件实例
 */
export function findAttendanceEditComponent(): any {
    const allEls = Array.from(document.querySelectorAll('*'));
    for (const el of allEls) {
        const v = (el as any).__vue__;
        if (v && v.hotSettings && Array.isArray(v.hotSettings.data)) {
            return v;
        }
    }
    return null;
}

/**
 * 同步切换宿主页面 Handsontable 实例的当前考勤年月并重新拉取数据
 */
export async function syncHostMonth(year: string, month: string): Promise<boolean> {
    const editComp = findAttendanceEditComponent();
    if (!editComp) return false;

    const formattedYm = `${year}/${month.padStart(2, '0')}`;
    const targetYmDigits = `${year}${month.padStart(2, '0')}`;

    // 检查宿主当前 Handsontable 数据是否已是该月份
    if (editComp.hotSettings && Array.isArray(editComp.hotSettings.data) && editComp.hotSettings.data.length > 0) {
        const firstYmd = String(editComp.hotSettings.data[0].ymd || '');
        if (firstYmd.startsWith(targetYmDigits)) {
            return true;
        }
    }

    // 切换宿主月份并触发拉取
    if (editComp.attendance) {
        editComp.attendance.ym = formattedYm;
    }
    editComp.oldYm = formattedYm;

    const dp = document.querySelector('.el-date-editor--month input, .el-date-editor input');
    if (dp) {
        (dp as HTMLInputElement).value = `${year}-${month.padStart(2, '0')}`;
    }

    if (typeof editComp.fetchData === 'function') {
        await editComp.fetchData();
        await new Promise(r => setTimeout(r, 600));
        return true;
    }

    return false;
}

/**
 * 孪生客户端核心引擎：
 * 将工数分配方案直接注入宿主 Handsontable 实例 (`hotSettings.data`)，
 * 触发 Handsontable `loadData` 动态重绘，调用 `computeActKosu("pro")` 自动更新工时预实对比表，
 * 并触发宿主页面原生的【保存】按钮提交入库！
 */
export async function saveAttendanceTwinClient(
    plans: AllocatedDayPlan[],
    state?: TimeMgState,
    onProgress?: (index: number, total: number, message: string) => void
): Promise<{ successCount: number; failCount: number; errors: string[] }> {
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    if (onProgress) onProgress(1, 4, '正在连接宿主页面 Handsontable 考勤核心...');

    // 1. 查找 AttendanceEdit 组件
    const editComp = findAttendanceEditComponent();

    if (!editComp) {
        return {
            successCount: 0,
            failCount: plans.length,
            errors: ['未找到宿主页面考勤数据组件 (Handsontable)，请确认当前处于【考勤申请】编辑页面']
        };
    }

    // 1.1 确保宿主表格已加载目标年月的考勤数据
    const targetYear = state?.selectedYear || (plans[0] ? plans[0].ymd.substring(0, 4) : '');
    const targetMonth = state?.selectedMonth || (plans[0] ? plans[0].ymd.substring(4, 6) : '');
    if (targetYear && targetMonth) {
        await syncHostMonth(targetYear, targetMonth);
    }

    const hotData = editComp.hotSettings.data;
    const toFillPlans = plans.filter(p => p.isWorkDay);

    if (onProgress) onProgress(2, 4, `正在向内存装载 ${toFillPlans.length} 个工作日出勤明细...`);

    // 2. 按日期将 plans 分组
    const plansByYmd = new Map<string, AllocatedDayPlan[]>();
    toFillPlans.forEach(p => {
        if (!plansByYmd.has(p.ymd)) plansByYmd.set(p.ymd, []);
        plansByYmd.get(p.ymd)!.push(p);
    });

    // 2.1 清理因多次试算追加的多余行 (若某日现有行数大于新分配的段数，移除多余的追加行)
    plansByYmd.forEach((dayPlans, ymd) => {
        const matchingIndices: number[] = [];
        hotData.forEach((r: any, idx: number) => {
            if (r.ymd === ymd) matchingIndices.push(idx);
        });

        if (matchingIndices.length > dayPlans.length) {
            for (let i = matchingIndices.length - 1; i >= dayPlans.length; i--) {
                const targetIdx = matchingIndices[i];
                hotData.splice(targetIdx, 1);
            }
        }
    });

    // 2.2 逐日逐段精准回填
    plansByYmd.forEach((dayPlans, ymd) => {
        try {
            // 查找 hotData 中该日期的第一行位置
            const firstIdx = hotData.findIndex((r: any) => r.ymd === ymd);
            if (firstIdx < 0) return;

            // 查找该日期当前已有的所有行
            const currentDayRows = hotData.filter((r: any) => r.ymd === ymd);

            // 将分配方案的各字段写入对应行 (按分段序号对齐行，无对应行时自动克隆追加新行)
            dayPlans.forEach((plan, planIdx) => {
                let targetRow = currentDayRows[planIdx];

                if (!targetRow) {
                    const baseRow = hotData[firstIdx];
                    const cloneRow = Object.assign({}, baseRow);
                    cloneRow.checkable = null;
                    cloneRow.isAdd = true;
                    cloneRow.detailDisabled = 'abled';
                    cloneRow.whFormDetailID = '';
                    cloneRow.status = '--';
                    cloneRow.dtAppStatus = '--';
                    const insertPos = firstIdx + currentDayRows.length;
                    hotData.splice(insertPos, 0, cloneRow);
                    currentDayRows.push(cloneRow);
                    targetRow = cloneRow;
                }

                targetRow._autopilotFilled = true;
                targetRow.fromDt = plan.startTime;
                targetRow.toDt = plan.endTime;
                targetRow.timeWH = String(plan.timeWH);
                targetRow.attandence = '是';
                targetRow.onDutyStatus = '1';
                targetRow.out = plan.isOut ? TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT : (plan.locationName || '公司');
                targetRow.flgOut = plan.isOut ? '1' : '2';
                targetRow.workType = '项目';
                targetRow.flg = '1';
                targetRow.pjNo = plan.pjNo || '';
                targetRow.name = plan.pjName || '';
                targetRow.pjgID = plan.pjInfoID || null;
                targetRow.pjInfoID = plan.pjInfoID || null;
                targetRow.changeFlg = '1';
                targetRow.detailDisabled = 'abled';
                targetRow.display = true;

                // 补全部门信息
                if (plan.pjNo) {
                    const projectInfo = (editComp.projectList || []).find((p: any) => p.pjNo === plan.pjNo);
                    if (projectInfo && projectInfo.branch) {
                        targetRow.department = projectInfo.branch;
                    }
                }

                plan.status = '成功';
                successCount++;
            });
        } catch (err: any) {
            failCount++;
            errors.push(`${ymd}: ${err.message}`);
        }
    });

    // 3. 全量校准所有工作日行的办公地点 (若打卡未全覆盖09:00~17:30，100%设为外出)
    hotData.forEach((row: any) => {
        if (row.dtDayType === 1 && (row.pjNo || row.fromDt || row.toDt || row.attandence === '是')) {
            const loc = checkIsOutOfOffice(row.inTime, row.outTime);
            if (loc.isOut) {
                row.out = TIME_MG_CONSTANTS.DEFAULTS.LOCATION_OUT;
                row.flgOut = '1';
                row.changeFlg = '1';
            }
        }
    });

    // 4. 驱动 Handsontable 实例重载与工时重新试算
    if (onProgress) onProgress(3, 4, '正在重新渲染 Handsontable 与预实工数试算...');

    if (editComp.$refs && editComp.$refs.editTable && editComp.$refs.editTable.hotInstance) {
        editComp.$refs.editTable.hotInstance.loadData(hotData);
    }
    if (typeof editComp.computeActKosu === 'function') {
        editComp.computeActKosu('pro');
    }

    // 5. 触发宿主原生保存按钮
    if (onProgress) onProgress(4, 4, '正在触发宿主页面原生【保存】提交入库...');

    const saveBtn = Array.from(document.querySelectorAll('.operation-item, .dialog-btn-box li, button'))
        .find(b => (b.textContent || '').trim() === '保存');

    if (saveBtn) {
        console.log('[Time-MG Twin] 触发宿主原生保存按钮:', saveBtn);
        (saveBtn as HTMLElement).click();
    } else if (typeof editComp.handleSubmit === 'function') {
        console.log('[Time-MG Twin] 调用 editComp.handleSubmit("save")');
        editComp.handleSubmit('save');
    }

    // 5. 自动聚焦并置顶宿主确认对话框
    setTimeout(() => {
        const msgBoxes = document.querySelectorAll('.el-message-box__wrapper, .el-dialog__wrapper');
        msgBoxes.forEach((mb: any) => {
            mb.style.zIndex = '10000001';
            const confirmBtn = mb.querySelector('.el-message-box__btns button.el-button--primary, .el-dialog__footer button.el-button--primary');
            if (confirmBtn) {
                (confirmBtn as HTMLElement).focus();
            }
        });
    }, 100);

    return { successCount, failCount, errors };
}
