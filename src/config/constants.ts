export interface ExpenseTypeDefinition {
    id: string;
    code: string;
    name: string;
    label: string;
    category: string;
    icon: string;
    iconColor: string;
    invoiceRequired: boolean;
}

export const EXPENSE_TYPES = {
    // 1. 交通/差旅交通
    TAXI: {
        id: '0356c529e72de1653e55bb00bc610001',
        code: 'DIM_EXP_SNJ_001',
        name: '市内交通费',
        label: '🚕 市内交通费 (日常出租车/网约车)',
        category: '交通费',
        icon: 'e-private-car-utility-s',
        iconColor: '#9C61FF',
        invoiceRequired: true
    },
    TRIP_TAXI: {
        id: '0356c4cef03345af7f1906ec05cc0000',
        code: 'DIM_EXP_CZC_001',
        name: '出租车（taxi）',
        label: '🚕 出租车（taxi · 差旅）',
        category: '差旅费',
        icon: 'e-b-t-taxi',
        iconColor: '#3DBF76',
        invoiceRequired: true
    },
    FLIGHT: {
        id: '035671613fdde1653e55bb00bc610000',
        code: 'DIM_EXP_JNC_001',
        name: '飞机票（航空券）',
        label: '✈️ 飞机票 (航空券)',
        category: '差旅费',
        icon: 'e-plane-ticket',
        iconColor: '#3DBF76',
        invoiceRequired: true
    },
    TRAIN: {
        id: '0356c4c2b14de1653e55bb00bc610000',
        code: 'DIM_EXP_HCP_001',
        name: '火车公交车票 （電車Bus代）',
        label: '🚄 火车/公交车票 (電車Bus代)',
        category: '差旅费',
        icon: 'e-train',
        iconColor: '#3DBF76',
        invoiceRequired: true
    },
    TRIP_OTHER_TRAFFIC: {
        id: '0356c4d862b345af7f1906ec05cc0001',
        code: 'DIM_EXP_JTF_002',
        name: '交通费-其他(その他）',
        label: '🚗 交通费-其他 (その他)',
        category: '差旅费',
        icon: 'e-b-t-differential-complement',
        iconColor: '#3DBF76',
        invoiceRequired: true
    },

    // 2. 住宿
    HOTEL: {
        id: '0356c4e2b72de1653e55bb00bc610001',
        code: 'DIM_EXP_ZSF_001',
        name: '住宿费（宿泊代）',
        label: '🏨 住宿费 (宿泊代)',
        category: '差旅费',
        icon: 'e-expenseclaim-hotel',
        iconColor: '#3DBF76',
        invoiceRequired: true
    },

    // 3. 通信费
    COMMUNICATION: {
        id: '0356c577f8ede1653e55bb00bc610001',
        code: 'DIM_EXP_TXF_001',
        name: '通信费-员工手机费',
        label: '📱 通信费 (员工手机费)',
        category: '其他费用',
        icon: 'e-mobile-phone-charges',
        iconColor: '#2B85FF',
        invoiceRequired: true
    },
    COMMUNICATION_FAX: {
        id: '0356c4f6701345af7f1906ec05cc0000',
        code: 'DIM_EXP_TXC_001',
        name: '通信传真费（通信代）',
        label: '📠 通信传真费 (通信代)',
        category: '差旅费',
        icon: 'e-mobile-phone-charges',
        iconColor: '#3DBF76',
        invoiceRequired: true
    },

    // 4. 会议与交际
    MEETING: {
        id: '0356c563094345af7f1906ec05cc0001',
        code: 'DIM_EXP_HYF_001',
        name: '会议费',
        label: '☕ 会议费',
        category: '其他费用',
        icon: 'e-self-use-conference-fee',
        iconColor: '#F86574',
        invoiceRequired: true
    },
    ENTERTAINMENT_EXTERNAL: {
        id: '0356c536aa6345af7f1906ec05cc0001',
        code: 'DIM_EXP_SWJ_002',
        name: '社外交际费',
        label: '🤝 社外交际费',
        category: '交际费',
        icon: 'e-train',
        iconColor: '#F59A45',
        invoiceRequired: true
    },
    ENTERTAINMENT_INTERNAL: {
        id: '0356c541ccf345af7f1906ec05cc0001',
        code: 'DIM_EXP_SNJ_002',
        name: '社内交际费',
        label: '🍱 社内交际费',
        category: '交际费',
        icon: 'e-overtime-meals',
        iconColor: '#F59A45',
        invoiceRequired: true
    },
    TEAM_BUILDING: {
        id: '0356c56b795de1653e55bb00bc610001',
        code: 'DIM_EXP_YBF_001',
        name: '一般福利费-部门团建',
        label: '🎉 部门团建 (福利费)',
        category: '其他费用',
        icon: 'e-overtime-meals',
        iconColor: '#F86574',
        invoiceRequired: true
    },

    // 5. 培训与综合其他
    TRAINING: {
        id: '035d83a77c2de1653e55bb00bc610000',
        code: 'DIM_EXP_TXF_002',
        name: '培训费',
        label: '📚 培训费',
        category: '其他费用',
        icon: 'e-mobile-phone-charges',
        iconColor: '#F86574',
        invoiceRequired: true
    },
    TRIP_OTHER: {
        id: '0356c50fb32345af7f1906ec05cc0000',
        code: 'DIM_EXP_CLF_001',
        name: '差旅费-其他(その他）',
        label: '🎒 差旅费-其他 (その他)',
        category: '差旅费',
        icon: 'e-a-travle-grants-s',
        iconColor: '#3DBF76',
        invoiceRequired: true
    },
    OTHER: {
        id: '0356c583e17de1653e55bb00bc610000',
        code: 'DIM_EXP_QTF_002',
        name: '其他费用',
        label: '📦 其他费用',
        category: '其他费用',
        icon: 'e-train',
        iconColor: '#F86574',
        invoiceRequired: true
    }
};

export const ALL_EXPENSE_TYPE_LIST: ExpenseTypeDefinition[] = Object.values(EXPENSE_TYPES);

export const MENU_DICTIONARY = {
    accounts: [
        { value: '03561d1db6a345af7f1906ec05cc0000', code: 'Account_P', name: '项目预算 (Account_P)' },
        { value: '03561781c2fde1653e55bb00bc610000', code: 'PL0240', name: '市内交通費 (PL0240)' },
        { value: '03561781c31de1653e55bb00bc610001', code: 'PL0250', name: '通信費（個人立替、月次精算） (PL0250)' },
        { value: '03561781c02de1653e55bb00bc610000', code: 'PL0210', name: '国内出張旅費 (PL0210)' },
        { value: '03561781c05de1653e55bb00bc610001', code: 'PL0260', name: '会議費 (PL0260)' },
        { value: '03561781c07de1653e55bb00bc610000', code: 'PL0270', name: '交際費 (PL0270)' },
        { value: '03561781c09de1653e55bb00bc610001', code: 'PL0310', name: '消耗品費 (PL0310)' },
        { value: '03561781c0cde1653e55bb00bc610000', code: 'PL0340', name: '図書研修費 (PL0340)' },
        { value: '03561781c0ede1653e55bb00bc610001', code: 'PL0130', name: '福利厚生費 (PL0130)' }
    ],
    costCenters: [
        { value: '0356194b8b3de1653e55bb00bc610000', code: '102IT40X', name: 'IT服务G-安全咨询BU(制造)' },
        { value: '03c1e3468e32ddc6286802cb9b840000', code: '102IT402', name: 'IT服务G-安全咨询BU(销售)' },
        { value: '0437bf15a8d5879532bc7df544d40001', code: '101RC20', name: '资源中心-第2Unit(制造)' },
        { value: '0356194b88cde1653e55bb00bc610000', code: '102IT20I', name: 'IT服务G-Infra BU(制造)' },
        { value: '03c1e33844853b6091e6a17737d50001', code: '102IT202', name: 'IT服务G-Infra BU(销售)' },
        { value: '0356194b8aede1653e55bb00bc610000', code: '102BS50S', name: 'IT服务G-产业BU(制造)' },
        { value: '03c1e31b62e2ddc6286802cb9b840000', code: '102BS502', name: 'IT服务G-产业BU(销售)' },
        { value: '0361f25f747627179afeae28a0c20000', code: '101AD10C', name: '职能-部门付(职能总监Account)' }
    ],
    khfd: [
        { value: '6b8ff07f9ebe11e88b7247d35c1e5077', code: 'YES', name: '是 (YES)' },
        { value: '6b8ff0809ebe11e88b7219c3aed96e32', code: 'NO', name: '否 (NO)' }
    ]
};

export const BUDGET_CONSTANTS = {
    boAreaId: '203d2e64f6bd4b32a8c83d030fb32676',       // 预算区 ID
    claimSubAreaId: '3bfd939291eb42439b692181c5477a96', // 费用明细区 ID
    recSubAreaId: '7e1debbe739248c4a49ea98088997acf',   // 支出记录区 ID

    fields: {
        account: {
            fieldId: 'c76bdd68560911e9940b1516ceebe56d',
            fieldCode: 'DIM_ACCOUNT',
            fieldName: '科目'
        },
        project: {
            fieldId: 'e11f202f465111ea98d4876bf4180a90',
            fieldCode: 'DIM_PROJECT',
            fieldName: '项目'
        },
        costCenter: {
            fieldId: '035b8400635345af7f1906ec05cc0000',
            fieldCode: 'F_BM',
            fieldName: '部门/成本中心'
        },
        khfd: {
            fieldId: '03633db0f918c8097fa3ad5bc8170000',
            fieldCode: 'F_KHFD',
            fieldName: '是否向客户请款'
        }
    },
    defaultAccount: {
        value: '03561d1db6a345af7f1906ec05cc0000',
        title: '项目预算'
    },
    defaultCostCenter: {
        value: '0356194b8b3de1653e55bb00bc610000',
        title: 'IT服务G-安全咨询BU(制造)'
    },
    defaultKhfd: {
        value: '6b8ff07f9ebe11e88b7247d35c1e5077',
        title: '是(YES)'
    }
};

export const TRIP_CONSTANTS = {
    billDefineId: '0355cf627fede1653e55bb00bc610001',
    billTypeId: 'd50efa246a0111e886f4d1f57da744a6',
    billTypeCode: 'FYSQL',
    mainAreaId: '59b6f7cec84e441db2fea4a63700a175',
    budgetAreaId: '203d2e64f6bd4b32a8c83d030fb32676',
    tripDetailAreaId: '035609b3ce5345af7f1906ec05cc0000',
    cityDimObjectId: '6b8ff0649ebe11e88b72df10cd5db793',
    personDimObjectId: '6b8ce3209ebe11e88b72d1f897294e91',
    projectDimObjectId: '6b8ce3199ebe11e88b72a97a1dba5a21',

    // 默认选项
    cclx: {
        value: '03560c40cb4de1653e55bb00bc610000',
        title: { zh_CN: '境内出張' }
    },
    sqdjqf: {
        value: '036827cc9bb92ed32ae0a6e43fe00000',
        title: { zh_CN: '新建' }
    },
    xmxg: {
        value: '6b8ff07f9ebe11e88b7247d35c1e5077',
        title: { zh_CN: '是' }
    },
    account: {
        value: '03561d1db6a345af7f1906ec05cc0000',
        title: { zh_CN: '项目预算' }
    },
    khfd: {
        value: '6b8ff0809ebe11e88b7219c3aed96e32',
        title: { zh_CN: '否' }
    }
};
