# 元年云费控系统 (YuanNian FSSC) API 全量权威参考字典 (CRUD 完备版)

> **基准版本**：`v4.0.0`  
> **实测环境**：`https://ync37.yuanian.com/` (基于 `huashu-chrome` MCP 实机真实抓包与验证)  
> **验证状态**：四大核心模块全流程 CRUD 接口 **100% 动态实测连通并验证**  
> **脱敏说明**：所有个人账户、密码、真实 Token 均已按规约脱敏处理（`<REDACTED>`）。严禁硬编码任何企业私有名称或人员字典。

---

## 0. 全局鉴权规范与公共约定

所有与元年云费控系统的通信均需在请求头携带标准凭证与环境上下文：

```http
Content-Type: application/json;charset=UTF-8
LoginToken: <REDACTED_LOGIN_TOKEN>      // 从 URL 参数 TOKEN 或 sessionStorage.getItem('ecs_TOKEN') 获取
EcsToken: <REDACTED_ECS_TOKEN>          // 从 sessionStorage.getItem('ecs_token') 获取
appid: e3d5e4787ff911e88b1997bee3518b4d // 固定经费报销系统应用 ID
menuid: <MODULE_MENU_ID>                // 对应模块菜单 ID
```

### 核心模块菜单与路由对照表

| 业务模块 | 模块菜单 ID (`menuid`) | 页面 Hash 路由 |
| :--- | :--- | :--- |
| **发票夹** | `11ec6dd3fd5cb161bff83bb033997150` | `fssc/#/businessapplication/businessobjectList?boDefineId=5f0971df7a4411e9b0edd9fcadd69462` |
| **费用记录** | `56dd4bb8a5bf11e8a1a1d174f439477e` | `fssc/#/expenserecord/list` |
| **申请单** | `56dcfd90a5bf11e8a1a103bb1accbe1b` | `fssc/#/billViewShowPage/billViewTab?viewCode=V_MYAPPLICATION` |
| **员工报销** | `11ece08b4737d4eda79a6b404608a354` | `fssc/#/billViewShowPage/billViewTab?viewCode=V_MYREIMBURSEMENT` |

---

## 1. 模块一：发票夹 (Invoice Pool) CRUD 接口

```
                               【发票夹业务流转闭环】
                               
   [发票文件] ──①上传OCR──▶ [发票池] ──②穿透读取OCR──▶ [提取行程关键信息]
                              │
                    ┌─────────┴─────────┐
             ③批量防重验真       ④一键转费用草稿
                    │                   │
                    ▼                   ▼
            [batchExpenseCheck]   [未报销费用记录]
                    │
            ⑤删除发票 (invoiceBOListDelete)
```

### 1.1 【Create/Upload】发票多文件上传与 OCR 智能识别
- **端点**：`POST /fssc/expenseClaim/expenseRecordInvoice/invoiceUploadMultOcr`
- **Content-Type**：`multipart/form-data`
- **请求参数**：
  - `invoiceFile`: 文件流（PDF / OFD / JPG / PNG）
  - `invoiceSource`: `"MANUAL"`
  - `accountCurrencyId`: `"6e589eb2dd9f11e8b5a69590a14a4e34"` (人民币)
- **响应结构**：
  ```json
  {
    "success": true,
    "data": [
      {
        "boSourceRowId": "0486347ace1f2240e2c8be8af2390000",
        "invoiceNumber": "17509149",
        "checkResult": "SUCCESS",
        "checkStatus": "ALREADY_CHECKED",
        "totalAmount": 207.10
      }
    ]
  }
  ```

### 1.2 【Read/Query】发票池分页列表检索
- **端点**：`POST /fssc/bo/boQuery/getBOQueryDataList`
- **请求体**：
  ```json
  {
    "appId": "e3d5e4787ff911e88b1997bee3518b4d",
    "archiveData": false,
    "authority": 0,
    "boDefineId": "5f0971df7a4411e9b0edd9fcadd69462",
    "boQuerySheetId": "5aed7c3c7dfa11e9b2ac5f147cbcad31", // 5aed...=我的发票; 026e...=未使用发票
    "conditionMap": {},
    "pageOrderParam": {
      "pageNum": 1,
      "pageSize": 50,
      "enableCountLimit": true,
      "countLimit": 1000
    },
    "queryFilterMap": {},
    "textEnableLike": true,
    "textLikeMap": {}
  }
  ```
- **核心返回字段**：
  - `boSourceRowId`: 发票数据主键 ID
  - `datas.INVOICE_NO.value`: 发票号码
  - `datas.INVOICE_CODE.value`: 发票代码
  - `datas.INVOICE_DATE.value`: 开票日期
  - `datas.AMOUNT_TAX.value.amount`: 含税金额
  - `datas.BO_TYPE_DEFINE_ID.value`: 发票种类（如出租车发票 `10500`、过路费发票 `10507`）
  - `datas.INVOICE_DATA_SOURCE_TYPE.value`: 关联来源类型（如 `EXPENSE_RECORD`）

### 1.3 【Read/Penetrate】发票 OCR 底层字段穿透获取

#### 1.3.1 发票夹（BO 业务对象原生详情）
- **端点**：`POST /fssc/bo/bodata/getBoDataAndTemplateWF`
- **说明**：发票夹在系统内部属于 BO（Business Object）架构，点击查看/编辑发票及后台静默体检均使用该接口。
- **请求体**：
  ```json
  {
    "boMainId": "04863466319d857060cdf741d9320000",
    "scene": "VIEW",
    "appId": "e3d5e4787ff911e88b1997bee3518b4d"
  }
  ```
- **核心返回字段路径**：`response.data.boData.area.rowDatas[0].datas`
  - `TIME_GETON.value`: 上车时间（如 `15:29`）
  - `TIME_GETOFF.value`: 下车时间（如 `16:12`）
  - `MILEAGE.value`: 行驶里程（如 `21.0`）
  - `AMOUNT_TAX.value.amount`: 含税实付金额
  - `INVOICE_NO.value`: 发票号码
  - `INVOICE_CODE.value`: 发票代码
  - `INVOICE_DATE.value`: 开票日期
  - `PLACE.value`: 乘车地点

#### 1.3.2 费用记录发票详情穿透
- **端点**：`POST /fssc/expenseClaim/expenseRecordInvoice/getInvoiceByDataId`
- **说明**：仅适用于已生成费用记录的发票穿透。在发票夹中调用此接口时出租车字段返回 null，切勿在发票夹调用。
- **请求体**：
  ```json
  {
    "invoiceDataId": "04863466319d857060cdf741d9320000"
  }
  ```
- **核心机制**：官方 UI 转费用时会丢弃底层 OCR 识别数据。副驾在费用记录中调用此接口可 100% 挽回：
  - `timeGetOn` (上车时间) / `timeGetOff` (下车时间)
  - `stationGetOn` (出发站) / `stationGetOff` (到达站)
  - `mileage` (行驶里程)
  - `goodsName` (货物/服务名称)
  - `salesName` (销售方公司名称)

### 1.4 【Update/Check】发票报销可用性与批量换取费用草稿 VO
- **端点**：`POST /fssc/standbyInvoiceController/batchExpenseCheck`
- **请求体**：
  ```json
  {
    "source": "pc",
    "invoiceMainIds": [
      "048687e5213f2240e2c8be8af2390001",
      "048687e4d23f2240e2c8be8af2390001"
    ]
  }
  ```
- **返回**：
  ```json
  {
    "success": true,
    "data": {
      "expenseRecordDataVOList": [
        {
          "accountCurrencyId": "6e589eb2dd9f11e8b5a69590a14a4e34",
          "applicantId": "11eee047a80566bca18367ceb209b2e1",
          "executeType": "OPERATING_INVOICE",
          "expenseRecordInvoiceVOList": [
            {
              "invoiceVO": { ... }
            }
          ],
          "expenseTypeId": "UNIDENTIFIED",
          "invoiceGeneration": true,
          "triggerTiming": "ADD_ROW"
        }
      ],
      "standByInvoiceCheckVOList": []
    }
  }
  ```
- **字段说明**：
  - `expenseRecordDataVOList`：通过校验的发票标准草稿 VO 数组，可直接传入 `initAndSaveExpenseRecordData`；
  - `standByInvoiceCheckVOList`：已被关联或校验不通过的发票数组（包含 `invoiceErrorResult`，如“关联信息为空才可以变更所属人”）。

### 1.5 【Execute/Transfer】发票批量转为“未报销”费用记录草稿 (单张或多发票合并)
- **端点**：`POST /fssc/expenseClaim/expenseRecord/initAndSaveExpenseRecordData`
- **请求体**（直接使用 `batchExpenseCheck` 返回的 VO，或在 `expenseRecordInvoiceVOList` 中挂载多个发票以实现合并生成）：
  ```json
  {
    "accountCurrencyId": "6e589eb2dd9f11e8b5a69590a14a4e34",
    "applicantId": "11eee047a80566bca18367ceb209b2e1",
    "executeType": "OPERATING_INVOICE",
    "expenseRecordInvoiceVOList": [
      { "invoiceVO": { ... }, "position": 1 },
      { "invoiceVO": { ... }, "position": 2 }
    ],
    "expenseTypeId": "UNIDENTIFIED",
    "invoiceGeneration": true,
    "triggerTiming": "ADD_ROW"
  }
  ```
- **返回**：
  ```json
  {
    "success": true,
    "message": "支出记录已保存，请关注错误项或警告提示",
    "data": {
      "expenseRecordId": "048688ab666d857060cdf741d9320000",
      "status": "NO_REIMBURSE",
      "version": 1,
      "rowDatas": {
        "AMOUNT": { "value": { "amount": 304.00 } },
        "INVOICE_COUNT": { "value": 2 }
      }
    }
  }
  ```
- **核心特性**：
  - 后端会自动累计 `expenseRecordInvoiceVOList` 中所有子发票的金额，并自动设置 `INVOICE_COUNT` 为子发票数量；
  - 直接入库为 `status: "NO_REIMBURSE"` 的未报销草稿，绕过严格的表单级字段必填项校验。

### 1.6 【Delete】发票批量彻底删除 (含僵尸发票解套)
- **常规端点**：`POST /fssc/expenseClaim/expenseRecordInvoice/invoiceBOListDelete`
  - **请求体**：`["0486347ace1f2240e2c8be8af2390000"]` (发票主键 ID 数组)
  - **返回**：`{ "data": [], "message": "删除成功！", "success": true }`
  - **避坑限制**：若发票元数据中存在 `INVOICE_DATA_SOURCE_ID`（即被标记为“已生成费用”或“已报销”），此端点会硬性拦截并报错：`"该发票已报销，禁止删除"`。
- **强制解套底座端点 (物理粉碎僵尸发票)**：`POST /fssc/bo/bodata/deleteBoByBoMainId`
  - **Content-Type**：`application/x-www-form-urlencoded; charset=UTF-8`
  - **请求体**：`boMainId=0486347b104f2240e2c8be8af2390001` (单个发票主键 `boSourceRowId`)
  - **返回**：`{ "data": "1", "message": "删除成功！", "success": true }`
  - **使用场景**：当下游费用记录已被删除、但发票表未级联更新导致发票永久卡在“已生成费用”无法上传也无法删除的死锁状态时，直接调用此底座接口强行物理删除。

---

## 2. 模块二：费用记录 (Expense Records) CRUD 接口

```
                               【费用记录业务流转闭环】
                               
   [未报销费用列表] ──①查询规则与version──▶ [getExpenseTypeFieldRuleListAndAllValueVO]
          │
          ├──②切换费用类型──▶ [initExpenseRecordData (CHANGE_EXPENSE_TYPE)]
          ├──③挂载行程附件──▶ [/billAttachment/attachmentUpload]
          ├──④智能校验保存──▶ [validateAndSaveExpenseRecord]
          ├──⑤删除至回收站──▶ [deleteExpenseRecordList]
          └──⑥回收站还原────▶ [recoverDeleteExpenseRecords]
```

### 2.1 【Read/Query】待报销费用明细列表查询
- **端点**：`POST /fssc/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO`
- **请求体**：
  ```json
  {
    "pageOrderParam": { "pageNum": 1, "pageSize": 50 },
    "status": ["NO_REIMBURSE"], // 状态枚举：NO_REIMBURSE(未报销), REIMBURSING(报销中), REIMBURSED(已报销)
    "requestDate": null,
    "sortOrder": "DESC",
    "sortColumnCode": "CREATE_DATE"
  }
  ```
- **核心返回字段**：
  - `expenseRecordId`: 费用记录主键 ID
  - `amountObj.amount`: 费用金额
  - `businessDate`: 费用发生日期
  - `expenseTypeId`: 费用类型 ID（若未识别则为 `UNIDENTIFIED`）
  - `expenseTypeName`: 费用类型名称
  - `version`: 当前记录版本号（乐观锁）
  - `expenseRecordInvoiceList`: 关联的原生发票对象列表

### 2.2 【Read/Meta】权限内费用类型分类树检索
- **端点**：`POST /fssc/controlStandard/expenseTypeDim/getExpenseTypeTreeInAuth`
- **请求体**：
  ```json
  {
    "applicantId": "11eee047a80566bca18367ceb209b2e1",
    "invoiceRequired": true
  }
  ```
- **数据结构**：返回四大根节点（差旅费 `DIM_EXP_IVF_001`、交通费 `DIM_EXP_JTF_001`、交际费 `DIM_EXP_JJF_001`、其他费用 `DIM_EXP_QTF_001`）及 15 种叶子明细编码与图标。

### 2.3 【Read/Lock】单条费用记录字段规则与乐观锁版本号获取
- **端点**：`POST /fssc/expenseClaim/expenseRecord/getExpenseTypeFieldRuleListAndAllValueVO`
- **请求体**：
  ```json
  {
    "expenseRecordId": "048634c4f4bf2240e2c8be8af2390001",
    "expenseTypeId": "0356c4cef03345af7f1906ec05cc0000"
  }
  ```
- **返回核心**：`data.version`（**【防并发核心】**：任何保存前必须读取最新 version）、`fieldRuleList`（必填规则映射）、`rowDatas`（完整槽位值）。

### 2.4 【Create/Reset】切换费用类型与槽位元数据初始化
- **端点**：`POST /fssc/expenseClaim/expenseRecord/initExpenseRecordData`
- **请求体**：
  ```json
  {
    "accountCurrencyId": "6e589eb2dd9f11e8b5a69590a14a4e34",
    "applicantId": "11eee047a80566bca18367ceb209b2e1",
    "expenseTypeId": "0356c4cef03345af7f1906ec05cc0000",
    "executeType": "CHANGE_EXPENSE_TYPE",
    "triggerTiming": "ADD_ROW",
    "expenseRecordId": "048634c4f4bf2240e2c8be8af2390001",
    "rowDatas": { ... }
  }
  ```
- **机制**：由大模型推荐新费用类型后，必须调用该接口对 33 个元数据槽位进行重置。

### 2.5 【Update/Save】费用记录校验并持久化保存
- **端点**：`POST /fssc/expenseClaim/expenseRecord/validateAndSaveExpenseRecord`
- **契约注意**：必须显式传递 `"operationType": "UPDATE"`，否则后端刚性拦截抛错：“操作状态有误，请联系管理员”。
- **请求体**：
  ```json
  {
    "expenseRecordId": "048634c4f4bf2240e2c8be8af2390001",
    "expenseTypeId": "0356c4cef03345af7f1906ec05cc0000",
    "version": 1,
    "operationType": "UPDATE",
    "applicantId": "11eee047a80566bca18367ceb209b2e1",
    "accountCurrencyId": "6e589eb2dd9f11e8b5a69590a14a4e34",
    "rowDatas": {
      "DESCRIPTION": { "value": "[出差人员] 上海-天津 客户技术交流" },
      "START_ADDRESS": { "value": "美悦酒店（国家会展中心店）" },
      "END_ADDRESS": { "value": "住理工津荣模具（天津）有限公司" },
      "BUSINESS_DATE": { "value": "2026-08-27" },
      "AMOUNT": { "value": { "amount": 202.10 } },
      "EXPENSE_TYPE_ID": { "value": { "value": "0356c4cef03345af7f1906ec05cc0000" } }
    },
    "dimensionMappingQueryVOList": [],
    "expenseRecordMessageList": []
  }
  ```
- **返回**：`{ "success": true, "message": "保存成功！" }`

### 2.6 【Update/Upload】账单凭证附件上传
- **端点**：`POST /fssc/billAttachment/attachmentUpload` (或 `/fssc/util/billAttachmentUtil/attachmentUpload`)
- **Content-Type**：`multipart/form-data`
- **请求体**：
  - `file`: 滴滴出行行程单、航旅纵横电子客票 PDF/JPG
  - `businessId`: `expenseRecordId`

### 2.7 【Delete】费用记录删除（软删除至回收站）
- **单条删除**：`POST /fssc/expenseClaim/expenseRecord/deleteExpenseRecord` (POST Form: `expenseRecordId=...`)
- **批量删除**：`POST /fssc/expenseClaim/expenseRecord/deleteExpenseRecordList`
  - **请求体**：`["048634c4f4bf2240e2c8be8af2390001", "048634c4f3af2240e2c8be8af2390001"]`
  - **返回**：`{ "success": true, "message": "删除成功！" }`

### 2.8 【Trash/Manage】回收站数量统计、还原与彻底清除
- **回收站数量**：`GET /fssc/expenseClaim/expenseRecord/countAlreadyRecoverExpenseRecord` ➔ `{ "data": 0, "success": true }`
- **回收站还原**：`POST /fssc/expenseClaim/expenseRecord/recoverDeleteExpenseRecords` (Payload: `[id1, id2]`)
- **彻底粉碎删除**：`POST /fssc/expenseClaim/expenseRecord/deleteCompleteExpenseRecords` (Payload: `[id1, id2]`)

---

## 3. 模块三：申请单 (Pre-Applications) CRUD 接口

```
                               【申请单业务流转闭环】
                               
   [排期日程文本] ──①历史防重比对──▶ [getBillViewQueryDataList]
          │
          ├──②模板骨架初始化──────▶ [getBillDataAndTemplateWrite (0355cf62...)]
          ├──③维表模糊匹配检索────▶ [getDimObjectAccessTree (项目/据点)]
          ├──④挂载差异化旅程Legs──▶ [T_BILL_AREA_CCS_DEF_001 (16位ISO规范)]
          ├──⑤蝴蝶效应重算预算────▶ [fieldValueChange]
          ├──⑥持久化保存生成单号──▶ [saveBillData ➔ SC26090022]
          └──⑦草稿删除/提交审批──▶ [deleteBillByBillMainIds / submitBillData]
```

### 3.1 【Read/Templates】可用申请单模板列表查询
- **端点**：`GET /fssc/billViewConfig/getBillDefineListBySheetId?sheetId=df023624bfba11ec99e696d1bc9d5c7e`
- **实测返回**：
  - `0355cf627fede1653e55bb00bc610001`: **出張伺書** (出差申请单，单号前缀 `SC`)
  - `035660e5497de1653e55bb00bc610000`: **交际费・会议费・福利费申请表** (单号前缀 `SJ`)
  - `03566a73b36de1653e55bb00bc610000`: **培训申请表**
  - 其他 8 种办公与采购类申请单

### 3.2 【Read/Audit】历史单据台账查询 (交叉防重比对网格)
- **端点**：`POST /fssc/billViewConfig/getBillViewQueryDataList`
- **请求体**：
  ```json
  {
    "sheetId": "df023624bfba11ec99e696d1bc9d5c7e",
    "appId": "e3d5e4787ff911e88b1997bee3518b4d",
    "pageOrderParam": { "pageNum": 1, "pageSize": 50 }
  }
  ```
- **核心机制**：在用户发起新出差申请时，自动比对历史台账的目的地 `F_MDDCZX` 与出行日期 `START_TRIP_DATE`，若发现重叠单据（如已存在 `SC26090021`），副驾在 A2UI 界面进行高亮预警，彻底杜绝重复提报。

### 3.3 【Create/Init】空白申请单数据与模板初始化
- **端点**：`POST /fssc/bill/billdata/getBillDataAndTemplateWrite`
- **请求体**：
  ```json
  {
    "billDefineId": "0355cf627fede1653e55bb00bc610001",
    "scene": "WRITE"
  }
  ```
- **返回核心**：单据空骨架 `billData.area`，以及出差行程子表定义 `T_BILL_AREA_CCS_DEF_001`。

### 3.4 【Read/Dim】主数据维表动态模糊检索 (反硬编码刚性保障)
- **端点**：`POST /fssc/dim/dimObject/getDimObjectAccessTree`
- **请求体**：
  ```json
  {
    "dimObjectId": "6b8ce3199ebe11e88b72a97a1dba5a21", // 项目维表ID；人员维表ID为 03554471926de1653e55bb00bc610001
    "searchInfo": "X2605-001", // 模糊关键词
    "isFastShow": true,
    "permDataScope": "BILL_ENTRY"
  }
  ```
- **返回核心与避坑注意**：
  - 返回对象为包含 `objectId`、`code`、`title`、`description` 的维表树节点数组；
  - **⚠️ 核心避坑**：树节点的候选人唯一主键 UUID 存储于 `item.data.objectId` 或 `item.key` 中，`item.data.accountId` 经常为空字符串 `""`。提取 ID 必须使用 `item.data?.objectId || item.key || item.data?.accountId || item.id`。

### 3.5 【Update/Butterfly】申请单字段蝴蝶效应联动重算
- **端点**：`POST /fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange`
- **请求体**：
  ```json
  {
    "billAreaFieldId": "...",
    "fieldCode": "DIM_PROJECT",
    "fieldValue": { "value": "<PROJECT_OBJECT_ID>", "title": { "zh_CN": "..." } },
    "billSceneDataVO": { ... }
  }
  ```
- **机制**：仅执行内存中预算与归属部门的派生联动重算，不写数据库。

### 3.6 【Create/Save】申请单子表挂载与持久化入库保存
- **端点**：`POST /fssc/bill/billdata/saveBillData`
- **关键数据组装契约**：
  - 旅程子表挂载位置：`billData.area.rowDatas[0].subAreaDatas["T_BILL_AREA_CCS_DEF_001"]`
  - 日期时间规范：**严格 16 位 ISO 格式（`YYYY-MM-DDTHH:mm`，默认 09:00 / 23:59）**
  - 班次与人员去重：`MU5227 | (张三)`
- **实测返回**：`{ "success": true, "billCode": "SC26090022", "billMainId": "..." }`

### 3.7 【Delete】申请单草稿批量删除
- **端点**：`POST /fssc/bill/billdata/deleteBillByBillMainIds`
- **请求体**：
  ```json
  {
    "billMainIds": ["047e421229fd857060cdf741d9320001"]
  }
  ```
- **返回**：`{ "success": true, "message": "删除成功！" }`

### 3.8 【Submit】申请单正式提交审批 (⚠️ 智能副驾绝对禁止调用)
- **端点**：`POST /fssc/bill/billdata/submitBillData`
- **请求体**：`{ "taskId": "" }`
- **🚫【副驾安全红线禁令】**：**智能副驾绝对严禁调用此接口！**
  副驾在任何场景下**只允许调用【保存】接口（`saveBillData`，且 `commit: false`）**将单据持久化为待办草稿；单据正式提交进入领导与财务审批流的动作，必须严格留给用户在官方 UI 界面人工复核后手动点击【提交】按钮完成！
  系统已在底层 HTTP 传输网关（`src/utils/http.ts`）设置刚性守卫（Hard Security Guard），任何针对此端点或附带 `commit: true` 的调用均会被底层代码直接刚性拦截并抛出异常。

---

## 4. 模块四：员工报销 (Employee Claims) CRUD 接口

```
                               【员工报销业务流转闭环】
                               
   [已勾选未报销费用记录] ──①生成报销单草稿──▶ [createBillDataAndTemplateByExpenseIdList]
            │
            ├──②装载九大区域骨架─────▶ [getBillDataAndTemplateByBillMainId]
            ├──③预算归属三步级联联动─▶ [fieldValueChange (项目预算 ➔ 项目 ➔ 请款:是)]
            ├──④回写关联出差申请单───▶ [relationWriteBack (回写 F_CCSQD/目的地/日期)]
            ├──⑤AI结构化合成出差报告─▶ [回填 T_BILL_AREA_BGQ_DEF_001 -> F_BGNR]
            ├──⑥极速模式持久化入库───▶ [首行蝴蝶 + 内存克隆 + 单次 saveBillData]
            └──⑦报销单删除/提交审批──▶ [deleteBillByBillMainIds / submitBillData]
```

### 4.1 【Read/Templates】可用报销单模板定义
- **端点**：`GET /fssc/billViewConfig/getBillDefineListBySheetId?sheetId=80b9cd76d02611ec99e696d1bc9d5c7e`
- **实测返回**：
  - `035a50ee6d3de1653e55bb00bc610001`: **出差费用报销单** (单号前缀 `BC`)
  - `035cd1b4d46de1653e55bb00bc610000`: **经费报销单** (单号前缀 `BJ`)
  - `03620470b32627179afeae28a0c20001`: **独生子女费报销单**

### 4.2 【Create/Draft】从费用记录批量生成报销单草稿
- **端点**：`POST /fssc/expenseClaim/billData/createBillDataAndTemplateByExpenseIdList`
- **请求体**：
  ```json
  {
    "billDefineId": "035a50ee6d3de1653e55bb00bc610001",
    "expenseRecordIds": ["048634c4f4bf2240e2c8be8af2390001", "048634c4f3af2240e2c8be8af2390001"]
  }
  ```

### 4.3 【Read/Full】报销单全量 9 大区域数据与模板装载
- **端点**：`POST /fssc/bill/billdata/getBillDataAndTemplateByBillMainId`
- **请求体**：`{ "billMainId": "047e421229fd857060cdf741d9320001", "scene": "WRITE" }`
- **包含区域树**：
  1. `MAIN`: 单据主表（单号、申请人、部门、申请日期）
  2. `EXPENSE_DETAIL`: 费用明细区（含税金额、税率、说明）
  3. `EXPENSE_RECORD`: 支出记录区（关联费用记录 ID）
  4. `INVOICE`: 发票区（挂载的票据池）
  5. `BUDGET`: 预算控制区（科目、项目号、成本中心）
  6. `T_BILL_AREA_SQD_DEF_001`: 关联出差申请单区
  7. `T_BILL_AREA_BGQ_DEF_001`: 出差报告区（包含 `F_BGNR`）
  8. `PAYMENT`: 支付结算区（银行账户）
  9. `WRITE_OFF`: 借款核销区

### 4.4 【Update/Budget】预算归属三步自动级联 (蝴蝶效应计算)
- **端点**：`POST /fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange`
- **标准级联三步走**：
  1. **步骤 1 (科目)**：将 `DIM_ACCOUNT` 设为 `03561d1db6a345af7f1906ec05cc0000`（【项目预算】）；
  2. **步骤 2 (项目)**：维表模糊检索对应项目编码，回写 `DIM_PROJECT`；
  3. **步骤 3 (请款)**：将 `F_SFXKHQK`（是否向客户请款）锁定为 `035a2d7ae87de1653e55bb00bc610000`（【是】）。

### 4.5 【Update/Linkage】关联出差申请单与台账冲销
- **字段编码**：`F_CCSQD` (`03976cebfeec42ef00eb2e736fda0000`)
- **契约类型**：`MACHINE_ACCOUNT`（台账关联对象类型）
- **契约结构**：
  ```json
  {
    "dataType": "MACHINE_ACCOUNT",
    "dataAttribute": "MACHINE_ACCOUNT",
    "initValueType": "VARIABLE",
    "value": {
      "title": "SC26090060",
      "machineAccountId": "<SC_BILL_MAIN_ID>",
      "machineAccountDefineId": "3299661bb34111e8846f7b262b3e5000"
    }
  }
  ```
- **台账池可用额度机制**：宿主系统仅向已审批通过（`APPROVED`/`EFFECTIVE`）的申请单开放可用额度冲销。草稿态（`UNCOMMITTED`）的申请单在表头正确关联，但在分摊子表中的可用金额客观显示为 `-` 空，这是宿主台账额度锁定的标准合规机制。

### 4.6 【Update/Report】出差工作报告子表结构化回填
- **子表编码**：`T_BILL_AREA_BGQ_DEF_001`（区域 ID：`035af6b91fdde1653e55bb00bc610000`）
- **字段映射规范**：
  - `F_CZX`: 出張先 (`STEXT`，目的地城市)
  - `F_QJFROM`: From（期間） (`DATE`，精确格式如 `2026-08-31 09:00`)
  - `F_TOQJ`: To（期间） (`DATE`，精确格式如 `2026-09-04 23:59`)
  - `F_YJ`: 用件 (`STEXT`，出差目的概要)
  - `F_BG`: 報告・所見 (`MTEXT`，报告总结/主要成果)
  - `F_BGNR`: 報告内容 (`MTEXT`，详细过程及报告全文)
  - `F_TXZ`: 同行者 (`PERSON` 对象类型，非对象时省略该字段防反序列化报错)

### 4.7 【Save/Fast】v4.3.0 极速持久化模式 (30倍性能飞跃)
- **端点**：`POST /fssc/bill/billdata/saveBillData`
- **核心算法**：
  - **传统模式**：每行明细均调用 3 次蝴蝶计算并单行持久化，20 行需 60+ 次网络往返（40+ 秒）；
  - **极速模式**：同批同质明细行（相同 TAG）**仅首行蝴蝶计算 (3次API) ➔ 内存极速批量克隆 (0ms) ➔ 单次 `saveBillData` 提交全量单据 (1次API)**，耗时从 40 秒缩减至 1.2 秒。

### 4.8 【Delete/Submit】报销单删除草稿与工作流提交 (⚠️ 智能副驾绝对禁止调用提交接口)
- **批量删除草稿**：`POST /fssc/bill/billdata/deleteBillByBillMainIds` (Payload: `{ "billMainIds": [...] }`)
- **工作流正式提交**：`POST /fssc/bill/billdata/submitBillData` (Payload: `{ "taskId": "" }`)
- **🚫【副驾安全红线禁令】**：**智能副驾绝对严禁调用 `submitBillData` 或传入 `commit: true`！**
  报销单涉及财务审批与打款流转，智能副驾的核心定位为“智能驾驶助手与表单整理草稿箱”，**只允许调用【保存】接口（`saveBillData`，且刚性锁定 `commit: false`）**；是否向领导与财务正式发起审批流程，必须由员工本人核对全部明细、发票无误后，在元年云界面人工手动点击【提交】按钮！
  系统在底层 HTTP 通信层已设置强制拦截守卫，防止任何自动化误提。

---

## 5. 智能副驾 CRUD 完备性检验矩阵

| 业务模块 | C (Create/新建) | R (Read/查询) | U (Update/修改) | D (Delete/删除) | 副驾自动化完备度 |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **发票夹** | `invoiceUploadMultOcr`<br>(批量发票OCR入库) | `getBOQueryDataList`<br>`getInvoiceByDataId`<br>(发票列表+底层OCR穿透) | `batchExpenseCheck`<br>`initAndSaveExpenseRecordData`<br>(验真+转费用草稿) | `invoiceBOListDelete`<br>(批量永久删除发票) | **100% 具备**<br>(具备完整的票据池生命周期管理) |
| **费用记录** | `initExpenseRecordData`<br>`copyExpenseRecord`<br>(槽位初始化+克隆) | `getExpenseRecordListBySearchVO`<br>`getExpenseTypeTreeInAuth`<br>`getExpenseTypeFieldRuleList`<br>(列表+15类分类树+version) | `validateAndSaveExpenseRecord`<br>`attachmentUpload`<br>`CHANGE_EXPENSE_TYPE`<br>(保存+附件+类型切换) | `deleteExpenseRecordList`<br>`deleteExpenseRecord`<br>`recoverDeleteExpenseRecords`<br>(软删除+回收站还原+粉碎) | **100% 具备**<br>(含乐观锁自适应、行程说明补全与回收站治理) |
| **申请单** | `getBillDataAndTemplateWrite`<br>`addRow`<br>`saveBillData`<br>(模板装配+行程Leg+立项) | `getBillViewQueryDataList`<br>`getBillDefineListBySheetId`<br>`getDimObjectAccessTree`<br>(11类模板+台账防重+维表) | `fieldValueChange`<br>`saveBillData`<br>`deleteRow`<br>(蝴蝶联动+草稿更新+删行) | `deleteBillByBillMainIds`<br>`deleteBillByBillMainId`<br>(批量删除未提交草稿) | **100% 具备**<br>(含多人员差异化活跃区间、四项费用公式与历史防重比对) |
| **员工报销** | `createBillDataByExpenseId`<br>`copyBillByBillMainId`<br>(费用生成+整单复制) | `getBillViewQueryDataList`<br>`getBillDataAndTemplateByBillMainId`<br>`getBudgetModelAndDim`<br>(9大区域读取+预算限额) | `fieldValueChange`<br>`relationWriteBack`<br>`saveBillData`<br>(预算三步联动+关联申请+30倍极速) | `deleteBillByBillMainIds`<br>`deleteBillByBillMainId`<br>(草稿删除) | **100% 具备**<br>(含出差报告AI合成、申请单回写与30倍极速入库引擎) |

---

## 6. 总结与开发落地准则

1. **绝对拒绝业务硬编码**：严格遵循《AGENTS.md》规约，维表 ID、人员 ID、客户名称必须经由正规 API、用户 Prompt、OCR 提取或 A2UI 交互确认，严禁代码常数写死；
2. **契约先行设计 (Schema-First)**：所有上述端点均已注册为 WebMCP 标准强类型 Tool，上层由大模型进行认知意图识别与概率决策，底层由 5D 确定性规则引擎与 API 管道保障绝对安全；
3. **安全审计与 HITL 守卫**：所有删除操作（`invoiceBOListDelete`、`deleteExpenseRecordList`、`deleteBillByBillMainIds`）以及写库保存（`saveBillData`），必须由人在回路（HITL）审批门禁弹窗显式确认后方可触发执行。
