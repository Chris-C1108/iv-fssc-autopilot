export const EXPENSE_TYPES = {
    TAXI: {
        id: '0356c529e72de1653e55bb00bc610001',
        name: '市内交通费',
        label: '🚕 出租车 (交通费)',
        icon: 'e-private-car-utility-s',
        iconColor: '#9C61FF'
    },
    COMMUNICATION: {
        id: '0356c577f8ede1653e55bb00bc610001',
        name: '通信费-员工手机费',
        label: '📱 通信费 (手机费)',
        icon: 'e-phone-fee',
        iconColor: '#2B85FF'
    }
};

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
