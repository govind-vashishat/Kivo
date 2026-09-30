/**
 * Exchange rates.
 *
 * A rate table is quoted against a single base currency: `rates[X]` is how
 * many major units of X one major unit of the base buys. Conversions between
 * two non-base currencies go through the base (a "cross rate").
 */

const { getCurrency, isSupported, minorFactor, roundHalfEven, assertMinor } = require("./currency");

/** Default table used when callers don't pass their own. Quoted against USD. */
const DEFAULT_RATES = {
    base: "USD",
    asOf: "2026-09-01T00:00:00Z",
    source: "treasury-daily",
    rates: {
        USD: 1,
        EUR: 0.92,
        GBP: 0.79,
        INR: 83.25,
        JPY: 149.5,
        KWD: 0.3075,
        CHF: 0.88,
    },
};

/**
 * Build and validate a rate table.
 * @param {string} base
 * @param {Record<string, number>} rates
 * @param {{ asOf?: string, source?: string }} [meta]
 */
function createRateTable(base, rates, meta = {}) {
    getCurrency(base);
    const cleaned = {};
    for (const [code, value] of Object.entries(rates)) {
        const upper = code.toUpperCase();
        if (!isSupported(upper)) {
            throw new Error(`rate table contains unsupported currency ${code}`);
        }
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            throw new RangeError(`rate for ${upper} must be a positive number, got ${value}`);
        }
        cleaned[upper] = value;
    }
    if (cleaned[base] === undefined) {
        cleaned[base] = 1;
    }
    if (cleaned[base] !== 1) {
        throw new RangeError(`base currency ${base} must have a rate of exactly 1`);
    }
    return {
        base,
        asOf: meta.asOf ?? new Date(0).toISOString(),
        source: meta.source ?? "manual",
        rates: cleaned,
    };
}

/**
 * Rate of `code` against the table's base.
 * @param {object} table
 * @param {string} code
 */
function getRate(table, code) {
    const upper = code.toUpperCase();
    const rate = table.rates[upper];
    if (rate === undefined) {
        throw new Error(`no exchange rate for ${upper} (table base ${table.base})`);
    }
    return rate;
}

/**
 * How many major units of `to` one major unit of `from` buys.
 * @param {object} table
 * @param {string} from
 * @param {string} to
 */
function crossRate(table, from, to) {
    if (from === to) return 1;
    return getRate(table, to) / getRate(table, from);
}

/**
 * Convert an amount in minor units of `from` into minor units of `to`.
 *
 * Steps: minor(from) -> major(from) -> major(to) via the cross rate -> minor(to),
 * rounding half-to-even once at the very end.
 *
 * @param {number} amountMinor
 * @param {string} from
 * @param {string} to
 * @param {object} [table]
 */
function convert(amountMinor, from, to, table = DEFAULT_RATES) {
    assertMinor(amountMinor);
    if (from === to) {
        return amountMinor;
    }
    const major = amountMinor / minorFactor(from);
    const convertedMajor = major * crossRate(table, from, to);
    return roundHalfEven(convertedMajor * minorFactor(from));
}

/**
 * Convert several amounts that share the same currency pair.
 * @param {number[]} amounts
 * @param {string} from
 * @param {string} to
 * @param {object} [table]
 */
function convertMany(amounts, from, to, table = DEFAULT_RATES) {
    return amounts.map((a) => convert(a, from, to, table));
}

/**
 * Re-quote a table against a different base currency.
 * @param {object} table
 * @param {string} newBase
 */
function rebase(table, newBase) {
    const upper = newBase.toUpperCase();
    const pivot = getRate(table, upper);
    const rates = {};
    for (const [code, value] of Object.entries(table.rates)) {
        rates[code] = value / pivot;
    }
    rates[upper] = 1;
    return { ...table, base: upper, rates };
}

/**
 * Apply a percentage spread (e.g. a card-processor margin) to every rate in a
 * table except the base. Spread is given in basis points.
 * @param {object} table
 * @param {number} spreadBp
 */
function withSpread(table, spreadBp) {
    if (!Number.isInteger(spreadBp) || spreadBp < 0 || spreadBp > 2000) {
        throw new RangeError(`spread must be an integer between 0 and 2000 bp, got ${spreadBp}`);
    }
    const factor = 1 - spreadBp / 10000;
    const rates = {};
    for (const [code, value] of Object.entries(table.rates)) {
        rates[code] = code === table.base ? 1 : value * factor;
    }
    return { ...table, rates, source: `${table.source}+spread${spreadBp}bp` };
}

/**
 * True when the table is older than `maxAgeHours` relative to `now`.
 * @param {object} table
 * @param {Date} now
 * @param {number} [maxAgeHours]
 */
function isStale(table, now, maxAgeHours = 24 * 7) {
    const asOf = Date.parse(table.asOf);
    if (Number.isNaN(asOf)) {
        return true;
    }
    const ageHours = (now.getTime() - asOf) / 36e5;
    return ageHours > maxAgeHours;
}

/**
 * Human-readable description of a pair, e.g. "1 USD = 149.5 JPY".
 * @param {object} table
 * @param {string} from
 * @param {string} to
 * @param {number} [precision]
 */
function describeRate(table, from, to, precision = 4) {
    const rate = crossRate(table, from, to);
    const text = Number(rate.toPrecision(precision)).toString();
    return `1 ${from} = ${text} ${to}`;
}

/**
 * Merge a partial update (e.g. one currency repriced intraday) into a table.
 * Returns a new table; the input is not modified.
 * @param {object} table
 * @param {Record<string, number>} updates
 * @param {string} [asOf]
 */
function mergeRates(table, updates, asOf) {
    const merged = createRateTable(
        table.base,
        { ...table.rates, ...updates },
        { asOf: asOf ?? table.asOf, source: table.source },
    );
    return merged;
}

module.exports = {
    DEFAULT_RATES,
    createRateTable,
    getRate,
    crossRate,
    convert,
    convertMany,
    rebase,
    withSpread,
    isStale,
    describeRate,
    mergeRates,
};
