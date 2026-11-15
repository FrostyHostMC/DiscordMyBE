/**
 * Merge event logger for tracking merge operations and errors
 */

export interface MergeLogEntry {
  id: string;
  timestamp: number;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  details?: string;
  packCount?: number;
  packNames?: string[];
}

class MergeLogger {
  private logs: MergeLogEntry[] = [];
  private listeners: ((log: MergeLogEntry) => void)[] = [];

  log(type: MergeLogEntry['type'], message: string, details?: string, packCount?: number, packNames?: string[]) {
    const entry: MergeLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type,
      message,
      details,
      packCount,
      packNames,
    };

    this.logs.push(entry);
    console.log(`[MergeLogger] [${type.toUpperCase()}] ${message}`, details || '');

    // Notify listeners
    this.listeners.forEach(listener => listener(entry));

    // Keep only last 100 logs
    if (this.logs.length > 100) {
      this.logs = this.logs.slice(-100);
    }
  }

  info(message: string, details?: string) {
    this.log('info', message, details);
  }

  warning(message: string, details?: string) {
    this.log('warning', message, details);
  }

  error(message: string, details?: string) {
    this.log('error', message, details);
  }

  success(message: string, details?: string, packCount?: number, packNames?: string[]) {
    this.log('success', message, details, packCount, packNames);
  }

  getLogs(): MergeLogEntry[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
  }

  subscribe(listener: (log: MergeLogEntry) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}

export const mergeLogger = new MergeLogger();
