import { apiRequest } from '../utils/http';
import { mapConcurrent } from '../utils/concurrency';
import { normalizeDate } from '../utils/date';
import { GlobalState, InvoiceItem } from '../types/state';

export async function fetchInvoiceDetailsBatch(
    invoices: any[],
    state: GlobalState
): Promise<Map<string, any>> {
    const ocrMap = new Map<string, any>();
    const ids = invoices.map(i => i.id || i.dataId).filter(Boolean);

    await mapConcurrent(ids, 8, async (id: string) => {
        try {
            const res = await apiRequest(
                '/fssc/expenseClaim/expenseRecordInvoice/getInvoiceByDataId',
                'POST',
                { invoiceDataId: id },
                state
            );
            if (res.success && res.data) {
                ocrMap.set(id, res.data);
            }
        } catch (e) {
            console.error(`Failed to fetch OCR details for ${id}`, e);
        }
    });

    return ocrMap;
}
