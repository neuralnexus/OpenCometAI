// ─────────────────────────────────────────────────────────────────────────────
// src/core/logger.js
// Structured logger. In production (IS_DEV=false) all methods are no-ops.
// ─────────────────────────────────────────────────────────────────────────────

const IS_DEV = true; // flip to false for production builds

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '#9ca3af',
  info:  '#60a5fa',
  warn:  '#fbbf24',
  error: '#f87171',
};

function _log(level, namespace, ...args) {
  if (!IS_DEV) return;
  if (LEVELS[level] < LEVELS['debug']) return;
  const ts   = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const color = COLORS[level] || '#ffffff';
  const prefix = `%c[${ts}][Open Comet:${namespace}]`;
  const style  = `color:${color};font-weight:600;font-family:monospace`;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    prefix, style, ...args
  );
}

/**
 * Create a namespaced logger.
 * Usage: const log = createLogger('AgentLoop');
 *        log.info('Starting iteration', 3);
 */
export function createLogger(namespace) {
  return {
    debug: (...args) => _log('debug', namespace, ...args),
    info:  (...args) => _log('info',  namespace, ...args),
    warn:  (...args) => _log('warn',  namespace, ...args),
    error: (...args) => _log('error', namespace, ...args),
  };
}

/** Convenience default logger for quick use. */
export const log = createLogger('Open Comet');

