/**
 * Calendar helpers for ship and delivery dates.
 *
 * Dates are plain calendar days, represented as Date objects at 00:00 UTC.
 * Always build them with parseDate() and print them with toISODate() so we
 * never get bitten by the machine's local time zone.
 *
 * A "business day" is a weekday that is not a company holiday. Warehouses
 * don't pick or pack on weekends or holidays, and carriers don't deliver.
 */

const fs = require("node:fs");
const path = require("node:path");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} iso  "YYYY-MM-DD"
 * @returns {Date}
 */
function parseDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        throw new Error(`parseDate expects YYYY-MM-DD, got "${iso}"`);
    }
    return new Date(`${iso}T00:00:00Z`);
}

/**
 * @param {Date} date
 * @returns {string} "YYYY-MM-DD"
 */
function toISODate(date) {
    return date.toISOString().slice(0, 10);
}

/**
 * Calendar day (00:00 UTC) of a full timestamp.
 * @param {Date} timestamp
 */
function startOfDay(timestamp) {
    return parseDate(toISODate(timestamp));
}

/** @param {Date} date */
function addDays(date, days) {
    return new Date(date.getTime() + days * DAY_MS);
}

/** @param {Date} date */
function isWeekend(date) {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
}

function loadHolidays() {
    const file = path.join(__dirname, "..", "data", "holidays.json");
    const list = JSON.parse(fs.readFileSync(file, "utf-8"));
    return list.map((h) => parseDate(h.date));
}

// Loaded once at startup; the list only changes once a year.
const HOLIDAYS = loadHolidays();

/** @param {Date} date */
function isHoliday(date) {
    return HOLIDAYS.includes(date);
}

/** @param {Date} date */
function isBusinessDay(date) {
    return !isWeekend(date) && !isHoliday(date);
}

/**
 * The first business day strictly after `date`.
 * @param {Date} date
 */
function nextBusinessDay(date) {
    let d = addDays(date, 1);
    while (!isBusinessDay(d)) {
        d = addDays(d, 1);
    }
    return d;
}

/**
 * Move forward `n` business days. Day 0 is `date` itself, so
 * addBusinessDays(friday, 1) is the following Monday.
 *
 * @param {Date} date
 * @param {number} n  >= 0
 */
function addBusinessDays(date, n) {
    let d = date;
    for (let i = 0; i < n; i++) {
        d = nextBusinessDay(d);
    }
    return d;
}

/**
 * Number of business days between two dates (start exclusive, end inclusive).
 * Used by the report to flag slow deliveries.
 *
 * @param {Date} from
 * @param {Date} to
 */
function businessDaysBetween(from, to) {
    let count = 0;
    let d = from;
    while (d < to) {
        d = addDays(d, 1);
        if (isBusinessDay(d)) count += 1;
    }
    return count;
}

module.exports = {
    addBusinessDays,
    addDays,
    businessDaysBetween,
    isBusinessDay,
    isHoliday,
    isWeekend,
    nextBusinessDay,
    parseDate,
    startOfDay,
    toISODate,
};
