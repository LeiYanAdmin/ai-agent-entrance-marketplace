/**
 * Logger utility for AI Agent Entrance
 */

import { getSetting } from '../shared/config.js';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SILENT]: 'SILENT',
};

class Logger {
  private level: LogLevel | null = null;
  private useColor: boolean;

  constructor() {
    this.useColor = process.stdout.isTTY ?? false;
  }

  private getLevel(): LogLevel {
    if (this.level === null) {
      const levelStr = getSetting('LOG_LEVEL').toUpperCase();
      this.level = (LogLevel as unknown as Record<string, number>)[levelStr] ?? LogLevel.INFO;
    }
    return this.level;
  }

  private formatTimestamp(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}.${ms}`;
  }

  private formatData(data: unknown): string {
    if (data == null) return '';
    if (typeof data === 'string') return data;
    if (typeof data === 'number' || typeof data === 'boolean') return data.toString();

    if (typeof data === 'object') {
      if (data instanceof Error) {
        return this.getLevel() === LogLevel.DEBUG
          ? `${data.message}\n${data.stack}`
          : data.message;
      }
      if (Array.isArray(data)) return `[${data.length} items]`;

      const keys = Object.keys(data);
      if (keys.length === 0) return '{}';
      if (keys.length <= 3) return JSON.stringify(data);
      return `{${keys.length} keys: ${keys.slice(0, 3).join(', ')}...}`;
    }

    return String(data);
  }

  private log(
    level: LogLevel,
    component: string,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    if (level < this.getLevel()) return;

    const timestamp = this.formatTimestamp(new Date());
    const levelName = LEVEL_NAMES[level].padEnd(5);
    const comp = component.padEnd(8);

    let contextStr = '';
    if (context && Object.keys(context).length > 0) {
      contextStr = ` {${Object.entries(context)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}}`;
    }

    let errorStr = '';
    if (error != null) {
      errorStr = ' ' + this.formatData(error);
    }

    const msg = `[${timestamp}] [${levelName}] [${comp}] ${message}${contextStr}${errorStr}`;

    if (level === LogLevel.ERROR) {
      console.error(msg);
    } else {
      console.log(msg);
    }
  }

  debug(component: string, message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.DEBUG, component, message, context, error);
  }

  info(component: string, message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.INFO, component, message, context, error);
  }

  warn(component: string, message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.WARN, component, message, context, error);
  }

  error(component: string, message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.ERROR, component, message, context, error);
  }

  success(component: string, message: string, context?: Record<string, unknown>): void {
    this.info(component, `✓ ${message}`, context);
  }

  failure(component: string, message: string, context?: Record<string, unknown>, error?: Error): void {
    this.error(component, `✗ ${message}`, context, error);
  }
}

export const logger = new Logger();
