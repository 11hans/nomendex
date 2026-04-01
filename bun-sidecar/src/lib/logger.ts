import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, appendFileSync, writeFileSync } from 'fs';

// Centralized log directory in app support (shared across all workspaces)
const LOG_DIR = join(homedir(), 'Library/Application Support/com.firstloop.nomendex');
const LOG_FILE = join(LOG_DIR, 'logs.txt');

// Startup mode flag - only log to file during startup
let isStartupMode = true;

function getLogDir(): string {
  return LOG_DIR;
}

function getLogFile(): string {
  return LOG_FILE;
}

// Mark startup as complete - stops file logging
export function markStartupComplete(): void {
  if (isStartupMode) {
    consoleLog('INFO', 'Startup complete - forcing file log to continue active');
    isStartupMode = false;
  }
}

// Check if still in startup mode
export function isInStartupMode(): boolean {
  return isStartupMode;
}

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch (error) {
  console.error('Failed to create log directory:', error);
}

// Clear previous startup logs and start fresh
try {
  writeFileSync(LOG_FILE, '');
} catch (error) {
  console.error('Failed to clear log file:', error);
}

// Write a startup log entry (kept for API compatibility but now handles double-logging prevention natively)
function writeStartupLog(_level: string, _message: string, _meta?: Record<string, unknown>): void {
  // Doing nothing here since consoleLog will handle file writing for everything
}

// Console logging (always active and writes to file)
function consoleLog(level: string, message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const metaStr = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  console.log(`${timestamp} [${level}] ${message}${metaStr}`);
  
  // Output everything to LOG_FILE as well
  try {
    const logEntry = `${new Date().toISOString()} [${level}] ${message}${metaStr}\n`;
    appendFileSync(LOG_FILE, logEntry);
  } catch {
    // silently fail
  }
}

// Startup logger - writes to both console and file (during startup only)
export const startupLog = {
  error: (message: string, meta?: Record<string, unknown>) => {
    consoleLog('ERROR', message, meta);
    writeStartupLog('ERROR', message, meta);
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    consoleLog('WARN', message, meta);
    writeStartupLog('WARN', message, meta);
  },
  info: (message: string, meta?: Record<string, unknown>) => {
    consoleLog('INFO', message, meta);
    writeStartupLog('INFO', message, meta);
  },
  debug: (message: string, meta?: Record<string, unknown>) => {
    consoleLog('DEBUG', message, meta);
    writeStartupLog('DEBUG', message, meta);
  },
};

// Create service-specific loggers (console only after startup)
export const createServiceLogger = (service: string) => {
  return {
    error: (message: string, meta?: Record<string, unknown>) => consoleLog('ERROR', `[${service}] ${message}`, meta),
    warn: (message: string, meta?: Record<string, unknown>) => consoleLog('WARN', `[${service}] ${message}`, meta),
    info: (message: string, meta?: Record<string, unknown>) => consoleLog('INFO', `[${service}] ${message}`, meta),
    http: (message: string, meta?: Record<string, unknown>) => consoleLog('HTTP', `[${service}] ${message}`, meta),
    debug: (message: string, meta?: Record<string, unknown>) => consoleLog('DEBUG', `[${service}] ${message}`, meta),
  };
};

// Default logger without service tag (console only after startup)
export const log = {
  error: (message: string, meta?: Record<string, unknown>) => consoleLog('ERROR', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => consoleLog('WARN', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => consoleLog('INFO', message, meta),
  http: (message: string, meta?: Record<string, unknown>) => consoleLog('HTTP', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => consoleLog('DEBUG', message, meta),
};

// Log startup initialization
startupLog.info('Server starting', {
  logFile: LOG_FILE,
  port: process.env.PORT || '1234',
  environment: process.env.NODE_ENV || 'development'
});

export default { log, startupLog, markStartupComplete, isInStartupMode };
export { LOG_FILE, LOG_DIR, getLogDir, getLogFile };