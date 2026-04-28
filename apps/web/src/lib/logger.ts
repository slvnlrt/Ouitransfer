type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel) || "warn";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, context?: LogContext): void {
  if (!shouldLog(level)) return;

  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";

  if (context && Object.keys(context).length > 0) {
    console[method](`[${level.toUpperCase()}] ${message}`, context);
  } else {
    console[method](`[${level.toUpperCase()}] ${message}`);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => formatMessage("debug", message, context),
  info: (message: string, context?: LogContext) => formatMessage("info", message, context),
  warn: (message: string, context?: LogContext) => formatMessage("warn", message, context),
  error: (message: string, context?: LogContext) => formatMessage("error", message, context),
};
