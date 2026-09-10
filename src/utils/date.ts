export function normalizeDate(str: string): string {
    if (!str) return '';
    const clean = String(str).trim();
    // 1. 标准 YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
    const m1 = clean.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m1) {
        const y = m1[1];
        const month = m1[2].padStart(2, '0');
        const d = m1[3].padStart(2, '0');
        return `${y}-${month}-${d}`;
    }
    // 2. 美式 MM/DD/YYYY
    const m2 = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m2) {
        const y = m2[3];
        const month = m2[1].padStart(2, '0');
        const d = m2[2].padStart(2, '0');
        return `${y}-${month}-${d}`;
    }
    return clean;
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

