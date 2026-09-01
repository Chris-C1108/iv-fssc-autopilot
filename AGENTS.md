# AGENTS.md — IVision FSSC Autopilot (元年云费控极速自动驾驶副驾) AI 协作与维护指南

> **GitHub 项目主页**：[Chris-C1108/iv-fssc-autopilot](https://github.com/Chris-C1108/iv-fssc-autopilot)  
> **当前基准版本**：`v4.4.0`  
> **工程体系**：TypeScript + Rollup + JavaScript-Obfuscator 混淆打包流水线

本文档是任何接手该项目的 AI Agent（或开发者）的第一入口。旨在帮助 Agent 迅速理解系统架构、遵循代码与文档规范、复用 API 资产并避免重复踩坑。

---

## 1. 语义化版本演进治理规约 (Versioning Governance)

以当前版本 **`v4.4.0`** 为基准起点，所有 AI Agent 与开发者必须严格遵循三级版本号递增规约：

```
                【版本号格式：X . Y . Z】
                
  ┌───────────────────┬───────────────────┬───────────────────┐
  │  1. 主版本 (Major) │  2. 次版本 (Minor) │  3. 修订版 (Patch) │
  │      X . 0 . 0    │     4 . Y . 0     │    4 . 4 . Z      │
  ├───────────────────┼───────────────────┼───────────────────┤
  │ • 由用户/开发者修改 │ • 由 AI Agent 递增 │ • 由 AI Agent 递增 │
  │ • 跨架构/破坏性变更 │ • 每次递增 +0.1.0  │ • 每次递增 +0.0.1  │
  │ • 新增系统级子平台  │ • 新增独立业务功能 │ • Bug修复 / 小修补 │
  └───────────────────┴───────────────────┴───────────────────┘
```

- **修改 `package.json` 中的 `version` 字段**，执行 `npm run build` 会自动将该版本号同步注入到混淆脚本的 UserScript Banner 中。

---

## 2. 知识库导航与核心索引 (Context Pointers)

接手任务时，请根据任务类别首先查阅以下权威单点文档：

- **避坑实录与经验教训**：[`docs/lessons/LESSONS_AND_PITFALLS.md`](docs/lessons/LESSONS_AND_PITFALLS.md)  
  *触发条件*：修改任何 API 调用逻辑、组装 Payload 或调试保存失败问题时必读。
- **元年 FSSC 全量 API 字典**：[`docs/api/YUANNIAN_API_REFERENCE.md`](docs/api/YUANNIAN_API_REFERENCE.md)  
  *触发条件*：需要查阅接口端点、请求参数、响应结构或字段映射 ID 时查阅。
- **考勤工数系统 API 字典**：[`docs/api/TIMEMG_API_REFERENCE.md`](docs/api/TIMEMG_API_REFERENCE.md)  
  *触发条件*：需要查阅爱模考勤系统 (`time-mg.huge-vision.com`) 接口端点、门禁推断或工时分配规则时查阅。
- **最新交接文档 (Handoff)**：[`docs/handoff/handoff_20260817.md`](docs/handoff/handoff_20260817.md)  
  *触发条件*：了解上一轮开发成果、当前最新稳定版本状态（v4.4.0）与架构决策时查阅。
- **TS 工程化模块架构**：[`src/README.md`](src/README.md)  
  *触发条件*：进行多文件工程开发或新增模块时参考。

---

## 3. 核心架构与关键业务规约

```
                               【元年云 FSSC 三级流转体系】
                               
  ┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
  │ ① 发票夹列表 (#business)│ ➔ │ ② 费用记录 (#expense)   │ ➔ │ ③ 经费报销单 (#billWrite)│
  │ • 8线程并发异步拉取     │   │ • 智能往返行程自动推断  │   │ • TAG聚合与项目检索     │
  │ • 100% OCR穿透回填      │   │ • 账单多附件拖拽上传    │   │ • 蝴蝶效应链式联动      │
  │ • 通信费自动智能识别    │   │ • 乐观锁版本号自适应    │   │ • 30倍极速入库 (v4.3.0) │
  └─────────────────────────┘   └─────────────────────────┘   └─────────────────────────┘
```

### 3.1 报销单核心规则 (必须遵守)
1. **`fieldValueChange` vs `saveBillData`**：
   - `fieldValueChange` 只是内存蝴蝶效应联动计算（推导 `BUDGET_DIM`、重算部门），**不写数据库**；
   - 字段计算完毕后，必须调用 `saveBillData` 接口写入数据库，并调用 `window.location.reload()` 刷新页面。
2. **`billSceneDataVO` 完整性**：
   - 严禁手动构造精简的 `sceneVO`！必须使用 `prepareBillSceneVO(currentBillData)` 直接深克隆完整单据对象（仅剔除 `billButtons`）。
3. **v4.3.0 极速模式架构**：
   - 同批同质行（如 TAG `X2605-001`）执行：**首行蝴蝶计算 (3次API) ➔ 内存批量克隆 (0ms) ➔ 单次 `saveBillData` 持久化 (1次API)**，提速 30 倍。
   - 必须保留自动降级串行模式作为容灾后备。

### 3.2 发票夹与费用记录规则
1. **OCR 穿透回填**：从发票详情接口拉取 `timeGetOn` / `timeGetOff` / `mileage`，在保存费用记录时 100% 补全，解决官方 UI 丢失 OCR 数据的问题。
2. **乐观锁 `version` 控制**：保存前必须调用 `getExpenseTypeFieldRuleListAndAllValueVO` 重新获取最新 `version`。

---

## 4. Agent 维护与构建工作流 (Agent Workflow)

### 4.1 当修改源码时
1. 编辑 `src/` 下对应的 TypeScript 模块（严禁直接修改 `dist/`）；
2. 遵循版本规则，在 `package.json` 中递增 `version`（小修补 +0.0.1，新功能 +0.1.0）；
3. 执行编译与混淆打包：
   ```bash
   npm run build
   ```
4. 验证生成产物：
   - `dist/iv-fssc-autopilot.user.js` (防逆向混淆生产包)
   - `dist/iv-fssc-autopilot.dev.user.js` (调试包)

### 4.2 当执行 `/handoff` 或阶段交接时
1. 生成的交接文档必须保存至 `docs/handoff/handoff_YYYYMMDD.md`；
2. 若发现了新的接口特性或避坑点，同步追加更新至 `docs/lessons/LESSONS_AND_PITFALLS.md` 和 `docs/api/YUANNIAN_API_REFERENCE.md`；
3. 更新 `docs/handoff/README.md` 中的历次交接索引。
