/**
 * Stage 2: normalize.
 *
 * Takes parsed records (all strings) and turns them into clean events:
 *
 *   { id, user, type, at: Date, amountMinor, currency }
 *
 * - user ids are trimmed and lowercased ("U_03" and "u_03" are the same user)
 * - event names are lowercased and mapped through aliases ("Order" -> "purchase")
 * - timestamps become Date objects
 * - amounts become integers in minor units of their currency (cents, paise, yen)
 * - duplicate ids are dropped (the collector retries and can send an event twice)
 *
 * Records that can't be normalized end up in `rejected` with a reason.
 */

const CURRENCY_DECIMALS = { USD: 2, EUR: 2, INR: 2, JPY: 0 };

const EVENT_ALIASES = {
    signup: "signup",
    sign_up: "signup",
    register: "signup",
    purchase: "purchase",
    order: "purchase",
    refund: "refund",
    page_view: "page_view",
    pageview: "page_view",
};

const MONEY_EVENTS = new Set(["purchase", "refund"]);

/**
 * @param {string} timestamp  ISO 8601 with a zone suffix, e.g. 2026-10-01T23:30:00-07:00
 * @returns {Date}
 */
function toUtcDate(timestamp) {
    // The collector stamps events in UTC already; the suffix is the client's
    // zone and is only kept for debugging. Strip it so Date() doesn't shift
    // the time a second time.
    const withoutZone = timestamp.replace(/(Z|[+-]\d{2}:\d{2})$/, "");
    return new Date(`${withoutZone}Z`);
}

/**
 * @param {string} amount    decimal string in major units, e.g. "19.99"
 * @param {string} currency
 * @returns {number} integer minor units
 */
function toMinorUnits(amount, currency) {
    const decimals = CURRENCY_DECIMALS[currency];
    return Math.trunc(Number(amount) * 10 ** decimals);
}

/**
 * @param {object} record  output of parseLine
 * @returns {{ ok: true, event: object } | { ok: false, reason: string }}
 */
function normalizeRecord(record) {
    const user = record.user.trim().toLowerCase();
    const type = EVENT_ALIASES[record.event.trim().toLowerCase()];
    if (!type) {
        return { ok: false, reason: `unknown event "${record.event}"` };
    }

    const at = toUtcDate(record.timestamp);
    if (Number.isNaN(at.getTime())) {
        return { ok: false, reason: `invalid date "${record.timestamp}"` };
    }

    const event = { id: record.id, user, type, at, amountMinor: 0, currency: null };

    if (MONEY_EVENTS.has(type)) {
        const currency = (record.currency || "").toUpperCase();
        if (!(currency in CURRENCY_DECIMALS)) {
            return { ok: false, reason: `unknown currency "${record.currency}"` };
        }
        if (!/^\d+(\.\d+)?$/.test(record.amount || "")) {
            return { ok: false, reason: `bad amount "${record.amount}"` };
        }
        event.currency = currency;
        event.amountMinor = toMinorUnits(record.amount, currency);
    }

    return { ok: true, event };
}

/**
 * @param {object[]} records
 * @returns {{ events: object[], rejected: { id: string, reason: string }[], duplicates: number }}
 */
function normalize(records) {
    const seen = new Set();
    const events = [];
    const rejected = [];
    let duplicates = 0;

    for (const record of records) {
        if (seen.has(record.id)) {
            duplicates += 1;
            continue;
        }
        seen.add(record.id);

        const result = normalizeRecord(record);
        if (result.ok) {
            events.push(result.event);
        } else {
            rejected.push({ id: record.id, reason: result.reason });
        }
    }

    events.sort((a, b) => a.at - b.at);
    return { events, rejected, duplicates };
}

module.exports = { CURRENCY_DECIMALS, normalize, normalizeRecord, toMinorUnits, toUtcDate };
