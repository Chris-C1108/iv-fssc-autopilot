import { normalizeDate } from '../utils/date';
import { InvoiceItem } from '../types/state';

export function inferSmartCommuteRoutes(
    invoices: InvoiceItem[],
    targetIndices: number[],
    companyName: string = 'IVISION',
    customerName: string = 'CMP',
    customPurpose: string = ''
): { modifiedCount: number; uncertainDates: string[] } {
    const taxiIndices = targetIndices.filter(idx => invoices[idx] && invoices[idx].type === 'TAXI');
    const dateGroups: Record<string, number[]> = {};

    taxiIndices.forEach(idx => {
        const row = invoices[idx];
        const dt = normalizeDate(row.invoiceDate || '') || '未知日期';
        if (!dateGroups[dt]) dateGroups[dt] = [];
        dateGroups[dt].push(idx);
    });

    let modifiedCount = 0;
    const uncertainDates: string[] = [];

    Object.keys(dateGroups).forEach(dt => {
        const indicesInDate = dateGroups[dt];
        indicesInDate.sort((a, b) => {
            const timeA = invoices[a].timeGetOn || '00:00';
            const timeB = invoices[b].timeGetOn || '00:00';
            return timeA.localeCompare(timeB);
        });

        if (indicesInDate.length === 1) {
            const row = invoices[indicesInDate[0]];
            row.startAddress = companyName;
            row.endAddress = customerName;
            if (customPurpose) row.description = customPurpose;
            modifiedCount++;
        } else if (indicesInDate.length === 2) {
            const morningRow = invoices[indicesInDate[0]];
            morningRow.startAddress = companyName;
            morningRow.endAddress = customerName;
            if (customPurpose) morningRow.description = customPurpose;

            const eveningRow = invoices[indicesInDate[1]];
            eveningRow.startAddress = customerName;
            eveningRow.endAddress = companyName;
            if (customPurpose) eveningRow.description = customPurpose;

            modifiedCount += 2;
        } else {
            const morningRow = invoices[indicesInDate[0]];
            morningRow.startAddress = companyName;
            morningRow.endAddress = customerName;
            if (customPurpose) morningRow.description = customPurpose;

            const eveningRow = invoices[indicesInDate[indicesInDate.length - 1]];
            eveningRow.startAddress = customerName;
            eveningRow.endAddress = companyName;
            if (customPurpose) eveningRow.description = customPurpose;

            for (let k = 1; k < indicesInDate.length - 1; k++) {
                const midRow = invoices[indicesInDate[k]];
                midRow.startAddress = '';
                midRow.endAddress = '';
                if (customPurpose) midRow.description = customPurpose;
            }

            modifiedCount += indicesInDate.length;
            uncertainDates.push(`${dt} (${indicesInDate.length} 笔)`);
        }
    });

    return { modifiedCount, uncertainDates };
}
