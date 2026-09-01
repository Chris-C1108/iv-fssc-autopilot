/**
 * 考勤副驾运行日志管理工具 (支持实时输出与一键拷贝)
 */

export interface LogEntry {
    time: string;
    level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
    message: string;
}

export class AutopilotLogger {
    private static logHistory: LogEntry[] = [];
    private static listeners: Array<(entry: LogEntry) => void> = [];

    static log(level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS', message: string) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');
        const entry: LogEntry = { time: timeStr, level, message };
        
        this.logHistory.push(entry);
        console.log(`[IV-Autopilot] [${entry.time}] [${level}] ${message}`);

        // 通知所有订阅者
        this.listeners.forEach(cb => {
            try { cb(entry); } catch (e) {}
        });
    }

    static info(msg: string) { this.log('INFO', msg); }
    static warn(msg: string) { this.log('WARN', msg); }
    static error(msg: string) { this.log('ERROR', msg); }
    static success(msg: string) { this.log('SUCCESS', msg); }

    static subscribe(cb: (entry: LogEntry) => void) {
        this.listeners.push(cb);
    }

    static getFullLogsText(): string {
        const header = `=== IVision FSSC Autopilot v4.4.0 执行日志 ===\n生成时间: ${new Date().toLocaleString()}\nURL: ${window.location.href}\n----------------------------------------\n`;
        const body = this.logHistory.map(l => `[${l.time}] [${l.level}] ${l.message}`).join('\n');
        return header + body;
    }

    static async copyLogsToClipboard(): Promise<boolean> {
        const fullText = this.getFullLogsText();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(fullText);
                return true;
            }
        } catch (e) {}

        // 备用方案
        try {
            const ta = document.createElement('textarea');
            ta.value = fullText;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return true;
        } catch (e) {
            return false;
        }
    }
}
