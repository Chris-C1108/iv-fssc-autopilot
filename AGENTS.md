# AGENTS.md — IVision FSSC Autopilot (元年云费控极速自动驾驶副驾) AI 协作与维护指南

> **GitHub 项目主页**：[Chris-C1108/iv-fssc-autopilot](https://github.com/Chris-C1108/iv-fssc-autopilot)  
> **当前基准版本**：`v4.4.0`  
> **工程体系**：TypeScript + Rollup + JavaScript-Obfuscator 混淆打包流水线

本文档是任何接手该项目的 AI Agent（或开发者）的第一入口。旨在帮助 Agent 迅速理解系统架构、遵循代码与文档规范、复用 API 资产并避免重复踩坑。

---

## 0. 真实API获取（逆向）方法

1. 使用huashu-chrome MCP 模拟点击页面、交互，并录制接口。

2. 为了方便真实接口分析，需要录制真实的系统交互XHR 时，请向用户说明具体操作方法和录制要点。
用户浏览器若安装了API Reverse Engineer 插件，则可以要求用户点击"自动录制接口"按钮来自动录制接口
或

---

## 0.1 核心铁律：拒绝为特定需求硬编码业务数据，保障 Agent 通用性 (Anti-Hardcoding Iron Law)

> **⚠️ 核心红线规约**：任何接手本项目的 AI Agent 必须无条件遵守此铁律，**严禁为了通过当前特定用例而编写任何形式的业务硬编码**。

1. **绝对禁止私有业务实体与静态常识字典硬编码 (Zero Hardcoded Business Entities & Static Dictionaries)**：
   - **严禁写死客户/工厂名称**：严禁在代码、配置文件或常量词典中写死特定客户公司、特定工厂据点（例如禁止出现 `住理工津荣模具`、`环宇住理工`、`东海化成` 等私有名称）；
   - **严禁写死人员与项目**：严禁在源码中硬编码特定员工姓名（如李建勇）、特定工号、特定审批人、特定私有项目编号（如 X2605-001）；
   - **严禁在代码中维护静态城市/机场字典 (如 `CITY_TRANSIT_HUBS`)**：大语言模型 (LLM) 本身具备丰富完备的地理与交通基础设施世界常识，用户提供的信息足以让 LLM 理解差旅路径。严禁在客户端代码中写死城市、火车站、机场静态数组。城市与枢纽的推断必须交由 LLM 推理（经由 `trips` 结构化参数下发）或基于票据文本通用正则动态提取（如 `上海浦东-大连周水子机票` 提取大连周水子机场，`合肥南站高铁票` 提取合肥南站），纯规则兜底采用 `${dest}机场` / `${dest}高铁站` 通用模板，并通过 A2UI 界面提供交互确认。

2. **业务信息的合法动态获取管道**：
   业务数据推断必须且只能通过以下正规管道动态提取：
   - **单据与票据原生字段**：从发票详情接口、附件文件名、OCR 识别字段（`goodsName`, `salesName`, `timeGetOn`, `timeGetOff`, `stationGetOn`, `stationGetOff`）中智能提取；
   - **系统主数据与维表接口**：通过真实 API 动态检索（如项目维表搜索 `searchProjectList`、人员维表、成本中心）；
   - **用户显式上下文与输入**：通过用户 prompt 自然语言输入、用户粘贴的排期表文本（`itineraryText`）解析提取；
   - **A2UI 交互确认兜底**：当关键信息缺失或无法确定时，**严禁在代码中自作主张捏造或硬编码常量兜底**，必须通过动态声明式 A2UI 表单 AST 呈现给用户交互确认或补充输入。

3. **通用性与泛化度检验准则 (Generalizability Criteria)**：
   每次编写或修改推断算法后，必须进行通用性压力自检：
   - **换人测试**：如果是另一位完全不同的员工使用该功能，逻辑是否完全通用？
   - **换城测试**：如果出差地点是完全不同的城市（如成都、武汉、深圳），是否能自动适配客观枢纽而不产生错误关联？
   - **换客测试**：如果拜访客户是完全不同的企业（如华为、比亚迪、富士康），算法是否绝不会冒出旧客户的名称？
   - 若任一检验不通过，则判定为过拟合硬编码违规，必须立即重构通用算法。

---

## Interaction & Output Rules ，The user/reader has ADHD

1. **Immediate Next Action First**: State the primary action or direct answer in the very first sentence.
2. **Numbered Steps**: Use numbered lists for all multi-step execution tasks.
3. **Actionable Close**: End exclusively with a single, concrete next step (e.g., command to run or question to answer).
4. **Suppress Fluff**: Eliminate all conversational filler, preamble, intros, and polite closing statements (no "Sure!", "Hope this helps!").
5. **State Tracking**: Restate the current task/system status in 1 short sentence per turn when working across steps.
6. **Explicit Estimates**: Provide time estimates in minutes (avoid vague terms like "soon" or "a bit").
7. **Visible Progress**: Clearly state what was changed or completed before moving to subsequent steps.
8. **Objective Error Reporting**: Report errors factually without apologies or narrative framing.
9. **Item Constraint**: Limit lists and options to a maximum of 5 items per message.
10. **Zero Meta-Announcements**: Never write transitional announcements explaining what you are about to say.



---
## 0.2 Agentic 开发方法论与架构约束 (Agentic Architecture & Engineering Methodology)

### 1. 根本原因剖析：为什么 AI 辅助编程工具高频编写硬编码？
AI 辅助编程工具（如 Cursor、Claude Code 等）高频编写硬编码（Hardcoding）的根本原因在于：
**其训练语料中绝大多数代码是传统的命令式业务逻辑，它会下意识把所有控制流、分支判断和文本解析翻译为 `if-else` 或正则匹配，而不是 Agentic 架构中的“工具调用 + 概率认知决策 (Tool Calling + Probabilistic Cognition)”。**

要彻底纠偏，必须从**职责划分矩阵**、**工程约束注入（Rule File）**与**接口契约（Schema-First）**三层实施深度约束。

---

### 2. 职责划分矩阵：确定性代码 vs 大模型概率认知边界

在元年云 FSSC Autopilot 自动驾驶副驾系统中，确定性代码与 LLM 必须严格恪守以下职责边界：

| 维度 | 必须由编码实现（Deterministic Code） | 必须由 LLM 完成（Probabilistic Cognition） |
| :--- | :--- | :--- |
| **状态与控制流** | • 确定性的流程与安全守卫（如：未获得用户人在回路 HITL 确认绝对不可调用 `saveBillData` 写库）<br>• 会话超时、API 失败重试、乐观锁并发版本号自适应<br>• 页面路由状态机（`#business` / `#expense` / `#billWrite`） | • 对话阶段与意图连续性评估（判断用户是否处于“代报销补充行程中”还是“发起全新出差申请”）<br>• 灵活的任务流转与澄清话术引导 |
| **规则与计算** | • 财务合规硬性上限与公式计算（一线城市 ¥800/晚、其他城市 ¥700/晚、误餐补贴、市内交通 Buffer、改签 Buffer）<br>• 元年云系统蝴蝶效应联动重算（`fieldValueChange`）<br>• 本地存储加密与状态读写 | • 复杂出差行程排期分析、判断有几轮往返闭环（Trips）<br>• 各波次目标城市、入住酒店与拜访客户据点的语义对齐<br>• 生成符合企业规约的个性化业务说明（`[外驻:姓名] 项目号 客户名 事由`） |
| **数据提取与校验** | • WebMCP Tool 的输入参数强类型校验（TypeScript / JSON Schema）<br>• API 请求与响应报文的格式校验、异常解包与防御拦截<br>• 发票 ID 集合合法性与防重复提交检查 | • 从员工非结构化聊天记录、语音转写文本、复杂多波次日程表格中抽取结构化出行要素<br>• 识别多模态图片、发票附件、排期截图中混乱布局的 OCR 文本 |
| **安全与权限** | • 元年云会话 Token 鉴权、敏感 API Key 隔离与本地持久化<br>• 涉密客户数据写库拦截与 API 调用频率限制<br>• **【禁止自动提交铁律】**：智能副驾只允许调用“保存”接口（`saveBillData`，`commit: false` 保存为草稿），**绝对禁止调用任何“提交”审批流接口**（`submitBillData` 或 `commit: true`）。单据正式提交进入审批流必须严格保留由用户在系统 UI 界面人工复核后手动点击完成！ | • 评估用户输入是否脱离费控业务域<br>• 识别复杂语境下的信息缺失与歧义，提示潜在业务合规风险 |

---

### 3. 约束 AI Coding 的三大工程落地手段

#### 手段一：注入代码库上下文约束 (Codebase Context Injection)
接手本仓库的 AI Agent 必须在生成代码前完成自检：
1. **禁止硬编码语义理解**：严禁用 `if-else`、正则表达式在底层代码中强行解析用户意图、情感倾向或非标准业务实体。此类任务统一交由 LLM 进行概率推理并通过结构化输出（Structured Output / JSON Schema）下发。
2. **禁止 LLM 承担确定性计算**：金额汇总、住宿限额上限、交通费弹性加成、API 乐观锁写库等严禁由 Prompt 自行编造，必须抽象为标准的系统 Tool 并由确定性代码执行。
3. **状态流转与守卫解耦**：
   - 业务硬性前置条件（如单据状态未就绪、用户未点击确认）必须由系统状态机守卫（Guards）代码刚性拦截；
   - 对话策略、交互引导与阶段识别交由 LLM 自主决策。

#### 手段二：强制采用契约先行模式 (Schema-First Design)
编写或重构功能时，严禁直接堆砌业务实现流，必须严格按三步走：
- **第一步 (Define Schema)**：先定义业务工具的入参和出参契约（严格的 TypeScript Interface 与 JSON Schema，明确每个字段的业务语义与类型约束）；
- **第二步 (Implement Tool)**：将其包装为标准 WebMCP Tool，实现确定性的底层数据校验、API 调用与计算逻辑；
- **第三步 (Decouple Timing)**：将“何时调用、传入什么参数”彻底留给 LLM 的系统 Prompt 与 Tool-calling 认知决策循环，**严禁在代码外层手动写 `if ("报销" in message) call_expense_tool()` 这种伪 Agent 逻辑**。

#### 手段三：利用结构化节点编排限制代码自由度 (Node & Edge Decoupling)
- **Tool Node（工具节点）**：纯代码、无大模型依赖，专注确定性数据拉取、计算、A2UI AST 生成与 API 持久化；
- **Reasoning Node（认知推理节点）**：纯 Prompt 与 LLM 决策，专注上下文理解、世界常识关联与跨模态提取，禁止在推理节点内部掺杂未经格式化的业务分支；
- **Edge（边与流转条件）**：条件分支函数仅接收 LLM 结构化输出（Enum 或 State 中的确定性字段），严禁在 Edge 逻辑内通过写死字符串或模糊正则解析原始自然语言。

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
1. 生成的交接文档必须保存至 `docs/handoff/handoff_YYYYMMDD_hhmmss.md`；
2. 若发现了新的接口特性或避坑点，同步追加更新至 `docs/lessons/LESSONS_AND_PITFALLS.md` 和 `docs/api/YUANNIAN_API_REFERENCE.md`；
3. 更新 `docs/handoff/README.md` 中的历次交接索引。
