export type PageMode = 'POOL' | 'EXPENSE' | 'BILL' | 'UNKNOWN';

export type ExpenseCategory = 'ALL' | 'TAXI' | 'COMMUNICATION' | 'OTHER';

export interface InvoiceItem {
    id?: string;
    expenseRecordId?: string;
    version?: number;
    boDataId?: string;
    invoiceVO?: any;
    invoiceNo?: string;
    invoiceCode?: string;
    invoiceDate?: string;
    timeGetOn?: string;
    timeGetOff?: string;
    mileage?: string;
    amount?: number;
    type: 'TAXI' | 'COMMUNICATION' | 'OTHER';
    startAddress?: string;
    endAddress?: string;
    description?: string;
    period?: string;
    attachments?: any[];
    status?: string;
}

export interface BillRowItem {
    index: number;
    rowNum: number;
    claimRowId: string;
    budgetRowId: string;
    recDesc: string;
    expTypeName: string;
    expTypeTitle: string;
    amount: number;
    curAccount: string;
    curCostCenter: string;
    curProject: string;
    curKhfd: string;
    status: string;
}

export interface OptionItem {
    value: string;
    title: string;
    code?: string;
    id?: string;
    name?: string;
}

export interface GlobalState {
    pageMode: PageMode;
    loginToken: string;
    ecsToken: string;
    userOrigin: string;
    appId: string;
    menuId: string;
    eicds: string;
    v: string;
    applicantId: string;
    invoices: InvoiceItem[];
    activeGroup: 'TAXI' | 'COMMUNICATION' | 'ALL';
    selectedIndices: Set<number>;
    currentBillMainId: string;
    currentBillData: any;
    currentBillDefineTemplate: any;
    billRows: BillRowItem[];
    billTags: Map<string, number>;
    activeBillTag: string;
    billSelectedIndices: Set<number>;
    projectSearchResults: OptionItem[];
    selectedAccount: OptionItem | null;
    selectedCostCenter: OptionItem | null;
    selectedProject: OptionItem | null;
    selectedKhfd: OptionItem | null;
    isProcessing: boolean;
}
