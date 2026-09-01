/**
 * 考勤工数管理系统 (time-mg.huge-vision.com) 核心常量定义
 */
export const TIME_MG_CONSTANTS = {
    ORIGIN: 'https://time-mg.huge-vision.com',
    API_PREFIX: '/ivggs/api',
    ENDPOINTS: {
        // 项目工时预实对比表
        EXP_WH_INFO: '/ivggs/api/wh10101/selectExpWHInfo/',
        // 考勤一览明细表
        DETAIL_WH_INFO: '/ivggs/api/wh10101/selectDetailWHInfo',
        // 考勤提交/保存前置校验
        SUBMIT_OR_SAVE_CHECK: '/ivggs/api/wh10101/submitOrSaveCheck',
        // 考勤明细保存/提交
        COMMIT_DETAIL: '/ivggs/api/wh10101/commitDetail',
        // 项目列表弹窗字典
        PROJECT_LIST: '/ivggs/api/pop/pjg/list',
        // 工时试算接口
        ACTUAL_WH: '/ivggs/api/wh10101/getActualWH'
    },
    // 考勤基准工时配置
    DEFAULTS: {
        START_TIME_API: '0900',       // API 入参格式 0900
        END_TIME_API: '1730',         // API 入参格式 1730
        START_TIME_DISPLAY: '09:00',  // 页面展示/回填格式
        END_TIME_DISPLAY: '17:30',    // 页面展示/回填格式
        STANDARD_HOURS: 7.5,          // 每日标准出勤工时 7.5h
        LUNCH_START: '12:00',
        LUNCH_END: '13:00',
        LOCATION_OUT: '外出',          // 办公地点：外出
        LOCATION_OFFICE: '社内',       // 办公地点：社内
        FLG_OUT_VALUE: '1'            // 外出标志位
    }
};
