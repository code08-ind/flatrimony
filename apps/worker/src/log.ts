/**
 * Structured logs for Cloud Logging: one JSON object per line, with `severity` and `message`
 * (docs/03 §10). Never log personal data: ids and counts only; errors by name and message.
 */
export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(
  level: Level = 'info',
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  base: Record<string, unknown> = {},
): Logger {
  const emit = (severity: Level, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[severity] < ORDER[level]) return;
    write(
      JSON.stringify({
        severity: severity.toUpperCase(),
        message,
        time: new Date().toISOString(),
        ...base,
        ...fields,
      }),
    );
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

/** An error as loggable fields: its name and a bounded message, never its payload. */
export function errorFields(err: unknown): { err: string; errMessage: string } {
  const e = err instanceof Error ? err : new Error(String(err));
  return { err: e.name, errMessage: e.message.slice(0, 500) };
}
