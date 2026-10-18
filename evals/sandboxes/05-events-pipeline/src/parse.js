/**
 * Stage 1: parse.
 *
 * Turns raw collector lines into plain objects. Each line looks like:
 *
 *   2026-10-01T09:15:00+05:30 id=e001 user=u_01 event=purchase amount=19.99 currency=USD
 *
 * The first token is the timestamp, the rest are key=value fields.
 * Blank lines and lines starting with "#" are ignored. Lines that cannot be
 * parsed are collected in `rejected` instead of throwing, so one bad line from
 * the collector doesn't take down the whole report.
 *
 * Values are kept as strings here; normalize decides what they mean.
 */

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
const REQUIRED_FIELDS = ["id", "user", "event"];

/**
 * @param {string} line
 * @returns {{ ok: true, record: object } | { ok: false, reason: string }}
 */
function parseLine(line) {
    const tokens = line.trim().split(/\s+/);
    const [timestamp, ...rest] = tokens;

    if (!TIMESTAMP_RE.test(timestamp)) {
        return { ok: false, reason: `bad timestamp "${timestamp}"` };
    }

    const record = { timestamp };
    for (const token of rest) {
        const eq = token.indexOf("=");
        if (eq <= 0) {
            return { ok: false, reason: `bad field "${token}"` };
        }
        record[token.slice(0, eq)] = token.slice(eq + 1);
    }

    for (const field of REQUIRED_FIELDS) {
        if (!record[field]) {
            return { ok: false, reason: `missing ${field}` };
        }
    }
    return { ok: true, record };
}

/**
 * @param {string} text  whole log file contents
 * @returns {{ records: object[], rejected: { lineNo: number, reason: string }[] }}
 */
function parseLog(text) {
    const records = [];
    const rejected = [];

    text.split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) return;

        const result = parseLine(trimmed);
        if (result.ok) {
            records.push(result.record);
        } else {
            rejected.push({ lineNo: index + 1, reason: result.reason });
        }
    });

    return { records, rejected };
}

module.exports = { parseLine, parseLog };
