# 元年云费控系统 (YuanNian FSSC) API 参考字典

> **版本**：v3.0.0  
> **更新日期**：2026-08-17  
> **所属项目**：元年云报销全能批量助手  
> **脱敏说明**：所有涉及个人账号、真实 Token、密码及凭证均已脱敏处理（`<REDACTED>`）。

---

## 1. 业务流转模型 (三级演化链)

```
┌─────────────────┐       ① 逐条生成/批量流转        ┌──────────────────────┐       ③ 关联生成报销单        ┌─────────────────┐
│   发票夹列表    │ ─────────────────────────────▶ │   未报销费用记录     │ ─────────────────────────────▶ │   经费报销单    │
│ (Invoice Pool)  │                                │   (Expense Record)   │                                │  (Expense Claim)│
│ boDefineId: ... │ ◀───────────────────────────── │ status: NO_REIMBURSE │                                │  批量修改预算   │
└─────────────────┘       ② 删回发票夹原状态        └──────────────────────┘                                └─────────────────┘
```

---

## 2. 经费报销单相关 API (`#billWrite`)

### 2.1 获取报销单数据与模板
- **接口**：`POST /fssc/bill/billdata/getBillDataAndTemplateByBillMainId`
- **请求体**：
  ```json
  {
    "billMainId": "047e421229fd857060cdf741d9320001",
    "scene": "WRITE"
  }
  ```
- **核心返回**：
  - `billData`: 包含主表、区域树 `area`、费用明细区（`3bfd939291eb42439b692181c5477a96`）、支出记录区（`7e1debbe739248c4a49ea98088997acf`）及预算区（`203d2e64f6bd4b32a8c83d030fb32676`）。
  - `billDefineTemplate`: 页面规则表（`boTypeLoadRuleItem.fieldChangeEventRule`、`boTypeFields` 等）。

### 2.2 维表树项目模糊检索
- **接口**：`POST /fssc/dim/dimObject/getDimObjectAccessTree`
- **请求体**：
  ```json
  {
    "dimObjectId": "6b8ce3199ebe11e88b72a97a1dba5a21",
    "searchInfo": "X2605-001",
    "isParentId": false,
    "isShowDisable": false,
    "isFastShow": true,
    "permDataScope": "BILL_ENTRY",
    "loginUserId": "<REDACTED_USER_ID>",
    "isUseSecurityFormal": false
  }
  ```
- **返回**：树节点列表，包含项目 `objectId`（如 `046657d85762013e0358542308f60001`）、`code`（`X2605-001`）与 `title`（`X2605-001 CMP安全人员派遣(4月-6月)`）。

### 2.3 蝴蝶效应字段变更联动 (`fieldValueChange`)
- **接口**：`POST /fssc/expenseClaim/billChangeButterflyEffect/fieldValueChange`
- **请求体**：
  ```json
  {
    "billAreaFieldId": "c76bdd68560911e9940b1516ceebe56d",
    "billAreaId": "203d2e64f6bd4b32a8c83d030fb32676",
    "fieldCode": "DIM_ACCOUNT",
    "fieldName": "科目",
    "fieldValue": {
      "value": "03561d1db6a345af7f1906ec05cc0000",
      "title": { "zh_CN": "项目预算" }
    },
    "rowId": "047e42123c7d857060cdf741d9320000",
    "validateInfoList": [],
    "billSceneDataVO": { ... }
  }
  ```
- **机制**：内存蝴蝶效应联动计算引擎（动态派生 `BUDGET_DIM`、重算 `F_BM` 归属部门、校验必填项与科目税额）。**不写数据库**。

### 2.4 单据最终持久化入库保存 (`saveBillData`)
- **接口**：`POST /fssc/bill/billdata/saveBillData`
- **请求体**：
  ```json
  {
    "allowSave": true,
    "appId": "e3d5e4787ff911e88b1997bee3518b4d",
    "area": { ... },
    "areaAttributes": { ... },
    "billButtons": [],
    "billCode": "BJ26080073",
    "billMainId": "047e421229fd857060cdf741d9320001",
    "billTypeCategory": "BILL",
    "billTypeCode": "FYBXDL",
    "billTypeId": "43373ddd567a47dfa8f5bf075c66098a",
    "billTypeMajor": "MAJOR_TYPE_BX",
    "checkFlowFieldRequire": true,
    "commit": false,
    "companyId": "0354c50558b7b75b3f8815b9fabd0000",
    "createNew": false,
    "currentUserId": "<REDACTED_USER_ID>",
    "departmentId": "0437bad328e04466af82b8adbd770000",
    "enableFund": false,
    "operationType": "UPDATE",
    "scene": "WRITE",
    "sheets": { ... },
    "userDefinedReturnData": { "operateBOReturnData": [] },
    "version": 5,
    "attachmentDeleteList": [],
    "attachmentUploadList": [],
    "attachmentDeleteSync": false
  }
  ```
- **返回**：`{ "success": true, "message": "保存成功！", "data": { ... } }`，且单据 `version` 自增（如 `5 ➔ 6`）。

---

## 3. 发票夹与费用记录相关 API (`#businessapplication` / `#expenserecord`)

| 序号 | 接口端点 | 方法 | 核心功能 |
| :--- | :--- | :---: | :--- |
| 1 | `/fssc/bo/boQuery/getBOQueryDataList` | POST | 查询发票夹全部发票列表 |
| 2 | `/fssc/expenseClaim/expenseRecordInvoice/getInvoiceByDataId` | POST | 穿透拉取发票 OCR 详情（`timeGetOn`, `timeGetOff`, `mileage`） |
| 3 | `/fssc/expenseClaim/expenseRecord/getExpenseRecordListBySearchVO` | POST | 分页查询待报销费用明细列表 (`NO_REIMBURSE`) |
| 4 | `/fssc/expenseClaim/expenseRecord/initAndSaveExpenseRecordData` | POST | 将发票夹发票实例化为费用记录草稿 |
| 5 | `/fssc/expenseClaim/expenseRecord/getExpenseTypeFieldRuleListAndAllValueVO` | POST | 获取字段规则与最新乐观锁版本号（`version`） |
| 6 | `/fssc/expenseClaim/expenseRecord/initExpenseRecordData` | POST | 费用类型切换与 33 槽位元数据初始化（`CHANGE_EXPENSE_TYPE`） |
| 7 | `/fssc/billAttachment/attachmentUpload` | POST | 账单 PDF/图片多附件上传 |
| 8 | `/fssc/expenseClaim/expenseRecord/validateAndSaveExpenseRecord` | POST | 最终费用明细数据校验并持久化保存 |
