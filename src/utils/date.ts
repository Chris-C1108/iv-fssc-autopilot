export function normalizeDate(str: string): string {
    if (!str) return '';
    const m = String(str).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) {
        const y = m[1];
        const month = m[2].padStart(2, '0');
        const d = m[3].padStart(2, '0');
        return `${y}-${month}-${d}`;
    }
    return String(str).trim();
}

export function isWorkdayDate(dateStr: string): boolean {
    const norm = normalizeDate(dateStr);
    if (!norm) return true;
    const d = new Date(norm);
    const day = d.getDay();
    return day >= 1 && day <= 5;
}

export function computePreviousMonthPeriod(dateStr: string): string {
    return computePeriod(dateStr, true);
}

export function computePeriod(dateStr: string, isCommunication = false): string {
    if (!dateStr) return '';
    const cleanDate = normalizeDate(dateStr);
    if (cleanDate.length >= 7) {
        const parts = cleanDate.split('-');
        let year = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10);

        if (isCommunication) {
            month -= 1;
            if (month < 1) {
                month = 12;
                year -= 1;
            }
        }
        return `${year}-${String(month).padStart(2, '0')}`;
    }
    return '';
}

