# 爱模考勤工数系统 (time-mg.huge-vision.com) API 全量字典

> **文档版本**：`v1.0.0` (随 Autopilot `v4.4.0` 引入)  
> **数据来源**：`assets/har/time-mg.huge-vision.com.har`  
> **基准域名**：`https://time-mg.huge-vision.com`

本文档详细记录了爱模智能工时考勤系统的全量接口规范、入参结构、出参字段及前端联动逻辑。

---

## 1. 认证与通用请求头 (Authentication & Headers)

- **认证方式**：基于 Session Cookie (`JSESSIONID`) 与 CSRF 保护 Token (`X-CSRF-TOKEN`)。
- **CSRF Token 获取**：
  - `<meta name="_csrf" content="...">` 或 Cookie `XSRF-TOKEN` / `_csrf`；
  - 拦截同源 Ajax/Fetch 请求头中的 `X-CSRF-TOKEN`。
- **通用请求头**：
  ```http
  Content-Type: application/json;charset=UTF-8
  Accept: application/json, text/plain, */*
  X-CSRF-TOKEN: <token>
  ```

---

## 2. 接口端点全景字典

| 序号 | 接口端点 (Endpoint) | 方法 | 业务作用 |
|---|---|---|---|
| 1 | `/ivggs/api/wh10101/selectExpWHInfo/` | `POST` | 查询当月各项目工时预实对比表数据 |
| 2 | `/ivggs/api/wh10101/selectDetailWHInfo` | `POST` | 查询当月每日考勤一览明细打卡记录 |
| 3 | `/ivggs/api/pop/pjg/list` | `POST` | 检索项目全量基础字典与项目经理信息 |
| 4 | `/ivggs/api/wh10101/getActualWH` | `POST` | 根据起止时间试算每日实际出勤工时 |
| 5 | `/ivggs/api/wh10101/submitOrSaveCheck` | `POST` | 考勤明细保存/提交前置数据合法性校验 |
| 6 | `/ivggs/api/wh10101/commitDetail` | `POST` | 考勤工数明细数据持久化保存/提交 |

### 2.1 项目工时预实对比表查询
- **接口路径**：`POST /ivggs/api/wh10101/selectExpWHInfo/`
- **功能描述**：获取指定年月的各项目预计工时 (`expWH`)、实际已填工时 (`workingHours`) 及部门信息。
- **请求入参 (Request Payload)**：
  ```json
  {
    "objY": "2026",
    "objM": "08"
  }
  ```
- **响应示例 (Response)**：
  ```json
  {
    "success": true,
    "datas": {
      "searchResult": [
        {
          "pjNo": "X2510-004",
          "name": "BSCN SOC MSS服务2025~2026",
          "expWH": "23.63",
          "workingHours": "0.00",
          "pjInfoID": "1103464997",
          "pjgID": null,
          "flgPJG": "2",
          "department": "IT服务事业群-安全咨询事业"
        },
        {
          "pjNo": "X2512-006",
          "name": "MHIC-SH_邮件攻击训练_2026年度",
          "expWH": "4.73",
          "workingHours": "0.00",
          "pjInfoID": "1103603342",
          "pjgID": null,
          "flgPJG": "2",
          "department": "IT服务事业群-安全咨询事业"
        }
      ]
    }
  }
  ```
- **核心字段说明**：
  - `pjNo`：项目编号，如 `X2510-004`
  - `name`：项目全称
  - `expWH`：预计分配总工时 (Planned Hours)
  - `workingHours`：实际已填报工时 (Actual Hours)
  - `pjInfoID`：项目实体主键 ID

---

### 2.2 考勤一览明细表查询 (整月日历与打卡明细)
- **接口路径**：`POST /ivggs/api/wh10101/selectDetailWHInfo`
- **功能描述**：获取指定年月每日的出勤类型、打卡进出门禁时间、已填起止时间、办公地点及项目信息。
- **请求入参 (Request Payload)**：
  ```json
  {
    "objY": "2026",
    "objM": "08"
  }
  ```
- **响应示例 (Response)**：
  ```json
  {
    "success": true,
    "datas": {
      "searchResult": [
        {
          "ymd": "20260801",
          "showDate": "8/1 土",
          "month": "8",
          "date": "1",
          "weekDate": 6,
          "dtDayType": 2,
          "onDutyStatus": "2",
          "inTime": null,
          "outTime": null,
          "fromDt": null,
          "toDt": null,
          "timeWH": null,
          "pjNo": null,
          "flgOut": null
        },
        {
          "ymd": "20260803",
          "showDate": "8/3 月",
          "month": "8",
          "date": "3",
          "weekDate": 1,
          "dtDayType": 1,
          "onDutyStatus": "1",
          "inTime": "2026-08-03 17:30:00",
          "outTime": "2026-08-03 10:00:00",
          "fromDt": null,
          "toDt": null,
          "timeWH": null,
          "pjNo": null,
          "flgOut": null
        }
      ]
    }
  }
  ```
- **核心字段说明**：
  - `dtDayType`：日期性质，`1` 为出勤工作日，`2` 为休假日/周末；
  - `onDutyStatus`：出勤状态，`"1"` 为出勤，`"2"` 为休息；
  - `inTime` / `outTime`：门禁/打卡记录时间戳（格式 `YYYY-MM-DD HH:mm:ss`）；
  - `fromDt` / `toDt`：填写的开始/结束时间（如 `"0900"` / `"1730"`）；
  - `timeWH`：当天填写的有效工时（标准为 `7.5`）；
  - `flgOut`：办公地点标志位，`"1"` 代表“外出”，`null` 或 `"0"` 代表社内；
  - `pjNo`：当天归属的项目编号。

---

### 2.3 项目列表字典弹窗查询
- **接口路径**：`POST /ivggs/api/pop/pjg/list`
- **功能描述**：用于弹出层检索或下拉框匹配可选项目清单。
- **请求入参 (Request Payload)**：
  ```json
  {
    "paging": false,
    "params": {
      "method": "0",
      "currentDate": "202608"
    }
  }
  ```
- **响应示例 (Response)**：
  ```json
  {
    "success": true,
    "datas": {
      "searchResult": {
        "results": [
          {
            "pjNo": "X2510-004",
            "name": "BSCN SOC MSS服务2025~2026",
            "expFromDt": "2025-09",
            "expToDt": "2026-08",
            "pm": "饶冬波",
            "branch": "IT服务事业群-安全咨询事业",
            "flgPJG": "2",
            "pjInfoID": "1103464997"
          }
        ]
      }
    }
  }
  ```

---

### 2.4 工时试算接口
- **接口路径**：`POST /ivggs/api/wh10101/getActualWH`
- **功能描述**：根据起止时间计算剔除午休（12:00~13:00）后的标准出勤工时。
- **请求入参 (Request Payload)**：
  ```json
  {
    "ymd": "20260803",
    "startTime": "0900",
    "endTime": "1730"
  }
  ```
- **响应示例 (Response)**：
  ```json
  {
    "success": true,
    "datas": {
      "searchResult": 7.5
    }
  }
  ```

---

## 3. 业务联动与推断规则

1. **出勤时间固定基准**：
   - 每日起止时间固定为 `09:00 ~ 17:30` (共计 7.5h)；
2. **门禁推断办公地点**：
   $$\text{isOut} = (\text{earliestAccess} > \text{"09:00:00"}) \lor (\text{latestAccess} < \text{"17:30:00"}) \lor (\text{inTime/outTime 为空})$$
   - 满足上述任一条件时，办公地点均自动填入**“外出”**（`flgOut = "1"`）；
   - 仅当门禁打卡完全覆盖 `09:00:00 ~ 17:30:00` 时，办公地点为“社内”。
3. **两阶段智能分配策略 (Two-Phase Allocation Strategy)**：
   - **阶段一 (整日优先扣除)**：优先为所有待分配工时 $\ge 7.5h$ 的项目分配完整的出勤工作日（`09:00 ~ 17:30`, 7.5h/天），直到该项目剩余工时 $< 7.5h$；
   - **阶段二 (零碎工时集中拼凑)**：将所有剩余不足 1 个工作日（$< 7.5h$）的项目集中拼凑到后续出勤日中，拆分为多个工时分段（如 `7/16 木` 拆分为 4 段：09:00~11:15 2.25h、11:15~14:30 2.25h、14:30~16:30 2.0h、16:30~17:30 1.0h），自动跳过 12:00~13:00 午休；
   - **阶段三 (尾部兜底)**：若整月工作日仍有多余，使用最大工时配额项目兜底填满。
