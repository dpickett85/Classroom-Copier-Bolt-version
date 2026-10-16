/**
 * Structured JSON logging to stdout (Render captures it natively) AND to
 * `logs/app-YYYY-MM-DD.log`, because the downstream QC stage scans that exact
 * path for `[ERROR]`/`[WARN]` lines, retries and timeouts. On most projects
 * that file does not exist and a good scanner runs against nothing.
 *
 * Each TransferJob lifecycle event (created / rate-limited-pause / resumed /
 * completed / interrupted / failed) is logged, which is what satisfies the
 * brief's "metric events instrumented even though no analytics vendor is wired".
 */
import fs from 'node:fs';
import path from 'node:path';
const LOG_DIR = path.resolve(process.cwd(), 'logs');
let stream = null;
let streamDay = null;
function today() {
    return new Date().toISOString().slice(0, 10);
}
function fileStream() {
    const day = today();
    if (stream && streamDay === day)
        return stream;
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        stream?.end();
        stream = fs.createWriteStream(path.join(LOG_DIR, `app-${day}.log`), { flags: 'a' });
        streamDay = day;
        return stream;
    }
    catch {
        // Logging must never take the process down.
        return null;
    }
}
function write(level, message, fields = {}) {
    const entry = { ts: new Date().toISOString(), level, message, ...fields };
    const line = `[${level}] ${JSON.stringify(entry)}`;
    if (level === 'ERROR')
        console.error(line);
    else if (level === 'WARN')
        console.warn(line);
    else if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true')
        console.log(line);
    fileStream()?.write(line + '\n');
}
export const logger = {
    debug: (message, fields) => write('DEBUG', message, fields),
    info: (message, fields) => write('INFO', message, fields),
    warn: (message, fields) => write('WARN', message, fields),
    error: (message, fields) => write('ERROR', message, fields),
    /** TransferJob lifecycle events — the brief's instrumented metric events. */
    jobEvent: (event, fields) => write(event === 'failed' || event === 'swept_pending' ? 'WARN' : 'INFO', `job.${event}`, fields),
};
