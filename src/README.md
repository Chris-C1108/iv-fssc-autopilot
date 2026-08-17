# 源码工程模块化蓝图 (TypeScript Modularization Plan)

> **目标**：为后续将单文件 `yuannian_batch_helper.user.js` 重构升级为现代化 TypeScript 多文件工程化项目提供标准架构规范。

---

## 1. 推荐工程目录规划

```
src/
├── index.ts                      # 主入口：Iframe 识别、路由分发与初始化
├── config/                       # 静态常量配置
│   ├── constants.ts              # 区域 ID、字段 ID、默认科目/部门常量
│   └── dictionary.ts             # 费用类型与关键词匹配字典
├── types/                        # 严格类型定义
│   ├── invoice.ts                # 发票夹发票与 OCR 类型定义
│   ├── expense.ts                # 费用记录与 33 槽位元数据类型
│   ├── bill.ts                   # 报销单、蝴蝶效应与持久化 Payload 类型
│   └── api.ts                    # API 通用响应结构
├── api/                          # 网络请求层
│   ├── client.ts                 # fetch 包装器、GM_xmlhttpRequest、Token 管理
│   ├── invoiceApi.ts             # 发票夹接口封装
│   ├── expenseApi.ts             # 费用记录接口封装
│   └── billApi.ts                # 报销单与蝴蝶效应接口封装
├── services/                     # 核心业务逻辑与算法引擎
│   ├── ocrRestorer.ts            # OCR 穿透回填服务
│   ├── commuteInferer.ts         # 早晚往返行程推断算法
│   ├── tagParser.ts              # 备注 TAG 提取与项目匹配
│   └── turboEngine.ts            # 极速批量克隆与持久化引擎
└── ui/                           # UI 交互与视图层
    ├── styles.ts                 # CSS-in-JS 或 SCSS 样式注入
    ├── components/               # 通用组件 (TAG 云、进度条、搜索下拉)
    └── modal.ts                  # 主弹窗生命周期管理
```

---

## 2. 构建与打包建议
- 构建工具：`Vite` + `vite-plugin-monkey` 或 `Webpack` + `ts-loader`；
- 输出产物：`dist/yuannian_batch_helper.user.js`。
