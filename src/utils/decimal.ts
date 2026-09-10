/**
 * 财务级高精度 Decimal 计算与格式化工具
 * 彻底消除 JavaScript IEEE-754 原生浮点误差 (如 0.1 + 0.2 = 0.30000000000000004)
 */

export type NumericValue = number | string | Decimal | null | undefined;

export class Decimal {
    private cents: bigint; // 以分 (1/100 元) 为基准存储微单位，向上支持扩展至微厘 (10^-4)
    private scale: number = 4; // 内部精度因子: 10^4 = 10000

    constructor(val: NumericValue = 0) {
        this.cents = Decimal.toInternalUnits(val, this.scale);
    }

    /**
     * 将各类数字/字符串转换为内部定点大整数
     */
    private static toInternalUnits(val: NumericValue, scale: number): bigint {
        if (val === null || val === undefined || val === '') {
            return 0n;
        }
        if (val instanceof Decimal) {
            return val.cents;
        }

        let str = String(val).trim().replace(/,/g, '').replace(/[¥$￥]/g, '');
        if (str === '' || isNaN(Number(str))) {
            return 0n;
        }

        const isNegative = str.startsWith('-');
        if (isNegative) {
            str = str.substring(1);
        }

        const parts = str.split('.');
        const integerPart = parts[0] || '0';
        let fracPart = parts[1] || '';

        if (fracPart.length > scale) {
            // 四舍五入到 scale 位
            const digitToRound = parseInt(fracPart[scale], 10);
            fracPart = fracPart.substring(0, scale);
            let bigVal = BigInt(integerPart + fracPart.padEnd(scale, '0'));
            if (digitToRound >= 5) {
                bigVal += 1n;
            }
            return isNegative ? -bigVal : bigVal;
        } else {
            fracPart = fracPart.padEnd(scale, '0');
            const bigVal = BigInt(integerPart + fracPart);
            return isNegative ? -bigVal : bigVal;
        }
    }

    public static from(val: NumericValue): Decimal {
        return new Decimal(val);
    }

    /**
     * 加法
     */
    public add(other: NumericValue): Decimal {
        const otherDecimal = other instanceof Decimal ? other : new Decimal(other);
        const res = new Decimal();
        res.cents = this.cents + otherDecimal.cents;
        return res;
    }

    /**
     * 减法
     */
    public sub(other: NumericValue): Decimal {
        const otherDecimal = other instanceof Decimal ? other : new Decimal(other);
        const res = new Decimal();
        res.cents = this.cents - otherDecimal.cents;
        return res;
    }

    /**
     * 乘法
     */
    public mul(other: NumericValue): Decimal {
        const otherDecimal = other instanceof Decimal ? other : new Decimal(other);
        const res = new Decimal();
        const factor = BigInt(10 ** this.scale);
        res.cents = (this.cents * otherDecimal.cents) / factor;
        return res;
    }

    /**
     * 除法
     */
    public div(other: NumericValue): Decimal {
        const otherDecimal = other instanceof Decimal ? other : new Decimal(other);
        if (otherDecimal.cents === 0n) {
            throw new Error('[Decimal] Division by zero');
        }
        const res = new Decimal();
        const factor = BigInt(10 ** this.scale);
        res.cents = (this.cents * factor) / otherDecimal.cents;
        return res;
    }

    /**
     * 批量累加求和
     */
    public static sum<T>(items: T[], extractor?: (item: T) => NumericValue): Decimal {
        let total = new Decimal(0);
        for (const item of items) {
            const val = extractor ? extractor(item) : (item as unknown as NumericValue);
            total = total.add(val);
        }
        return total;
    }

    /**
     * 格式化为定点字符串，默认保留 2 位小数
     */
    public toFixed(decimals: number = 2): string {
        const isNeg = this.cents < 0n;
        const absVal = isNeg ? -this.cents : this.cents;
        const factor = BigInt(10 ** this.scale);

        const intPart = absVal / factor;
        const fracPartBig = absVal % factor;

        let fracStr = fracPartBig.toString().padStart(this.scale, '0');

        if (decimals < this.scale) {
            // 四舍五入到目标位
            const roundDigit = parseInt(fracStr[decimals], 10);
            let truncated = BigInt(fracStr.substring(0, decimals) || '0');
            let finalInt = intPart;
            if (roundDigit >= 5) {
                truncated += 1n;
                const maxTruncated = BigInt(10 ** decimals);
                if (truncated >= maxTruncated) {
                    truncated = 0n;
                    finalInt += 1n;
                }
            }
            const resFrac = decimals > 0 ? '.' + truncated.toString().padStart(decimals, '0') : '';
            return `${isNeg ? '-' : ''}${finalInt}${resFrac}`;
        } else {
            const extra = decimals - this.scale;
            const resFrac = decimals > 0 ? '.' + fracStr + '0'.repeat(extra) : '';
            return `${isNeg ? '-' : ''}${intPart}${resFrac}`;
        }
    }

    /**
     * 格式化为货币展示串 (¥1,234.56)
     */
    public formatCurrency(decimals: number = 2, prefix: string = '¥', useCommas: boolean = true): string {
        const fixed = this.toFixed(decimals);
        if (!useCommas) {
            return `${prefix}${fixed}`;
        }
        const [intPart, fracPart] = fixed.split('.');
        const isNeg = intPart.startsWith('-');
        const cleanInt = isNeg ? intPart.slice(1) : intPart;
        const formattedInt = cleanInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const frac = fracPart !== undefined ? `.${fracPart}` : '';
        return `${isNeg ? '-' : ''}${prefix}${formattedInt}${frac}`;
    }

    /**
     * 转为标准 JavaScript 数字 (用于必须传递 number 类型的第三方库)
     */
    public toNumber(): number {
        return parseFloat(this.toFixed(this.scale));
    }

    public isZero(): boolean {
        return this.cents === 0n;
    }

    public isPositive(): boolean {
        return this.cents > 0n;
    }

    public isNegative(): boolean {
        return this.cents < 0n;
    }

    public toString(): string {
        return this.toFixed(2);
    }
}
