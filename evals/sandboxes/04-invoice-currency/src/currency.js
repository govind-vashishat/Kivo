/**
 * Currency registry and money helpers.
 *
 * All money in this codebase is stored as an integer number of *minor units*
 * (cents for USD, pence for GBP, fils for KWD, whole yen for JPY). Floating
 * point is only used transiently during conversion and is rounded back to an
 * integer immediately.
 */

const CURRENCIES = {
    USD: { code: "USD", symbol: "$", decimals: 2, name: "US Dollar", symbolFirst: true },
    EUR: { code: "EUR", symbol: "€", decimals: 2, name: "Euro", symbolFirst: false },
    GBP: { code: "GBP", symbol: "£", decimals: 2, name: "Pound Sterling", symbolFirst: true },
    INR: { code: "INR", symbol: "₹", decimals: 2, name: "Indian Rupee", symbolFirst: true },
    JPY: { code: "JPY", symbol: "¥", decimals: 0, name: "Japanese Yen", symbolFirst: true },
    KWD: { code: "KWD", symbol: "KD ", decimals: 3, name: "Kuwaiti Dinar", symbolFirst: true },
    CHF: { code: "CHF", symbol: "CHF ", decimals: 2, name: "Swiss Franc", symbolFirst: true },
};

/**
 * Look up a currency by ISO code. Throws for unknown codes so that typos
 * surface immediately instead of producing NaN totals later on.
 * @param {string} code
 */
function getCurrency(code) {
    if (typeof code !== "string") {
        throw new TypeError(`currency code must be a string, got ${typeof code}`);
    }
    const info = CURRENCIES[code.toUpperCase()];
    if (!info) {
        throw new Error(`unknown currency: ${code}`);
    }
    return info;
}

function isSupported(code) {
    return typeof code === "string" && Object.hasOwn(CURRENCIES, code.toUpperCase());
}

function listCurrencies() {
    return Object.keys(CURRENCIES).sort();
}

/**
 * Number of minor units in one major unit (100 for USD, 1 for JPY, 1000 for KWD).
 * @param {string} code
 */
function minorFactor(code) {
    return 10 ** getCurrency(code).decimals;
}

/**
 * Banker's rounding (round half to even). Used everywhere money is rounded so
 * that large batches of line items do not drift upward.
 * @param {number} value
 */
function roundHalfEven(value) {
    if (!Number.isFinite(value)) {
        throw new RangeError(`cannot round non-finite value: ${value}`);
    }
    const floor = Math.floor(value);
    const diff = value - floor;
    const EPS = 1e-9;
    if (diff > 0.5 + EPS) return floor + 1;
    if (diff < 0.5 - EPS) return floor;
    return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Convert a major-unit decimal (e.g. 12.5 dollars) into integer minor units.
 * @param {number} major
 * @param {string} code
 */
function toMinor(major, code) {
    return roundHalfEven(major * minorFactor(code));
}

/**
 * Convert integer minor units back to a major-unit number. Only used for
 * display and for rate maths; never stored.
 * @param {number} minor
 * @param {string} code
 */
function fromMinor(minor, code) {
    assertMinor(minor);
    return minor / minorFactor(code);
}

function assertMinor(value) {
    if (!Number.isInteger(value)) {
        throw new TypeError(`money amounts must be integer minor units, got ${value}`);
    }
}

/**
 * Split an amount into `parts` integer shares that add back up exactly.
 * Remainders are handed out one minor unit at a time from the first share.
 * @param {number} minor
 * @param {number} parts
 */
function allocateEvenly(minor, parts) {
    assertMinor(minor);
    if (!Number.isInteger(parts) || parts <= 0) {
        throw new RangeError(`parts must be a positive integer, got ${parts}`);
    }
    const base = Math.trunc(minor / parts);
    let remainder = minor - base * parts;
    const shares = [];
    for (let i = 0; i < parts; i++) {
        let share = base;
        if (remainder > 0) {
            share += 1;
            remainder -= 1;
        } else if (remainder < 0) {
            share -= 1;
            remainder += 1;
        }
        shares.push(share);
    }
    return shares;
}

/**
 * Split an amount proportionally to `weights`, keeping the total exact.
 * Uses the largest-remainder method.
 * @param {number} minor
 * @param {number[]} weights
 */
function allocateByWeight(minor, weights) {
    assertMinor(minor);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) {
        return weights.map(() => 0);
    }
    const raw = weights.map((w) => (minor * w) / totalWeight);
    const floors = raw.map((r) => Math.floor(r));
    let leftover = minor - floors.reduce((a, b) => a + b, 0);
    const order = raw
        .map((r, i) => ({ i, frac: r - Math.floor(r) }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
    const result = floors.slice();
    for (const { i } of order) {
        if (leftover <= 0) break;
        result[i] += 1;
        leftover -= 1;
    }
    return result;
}

/**
 * Group the integer part of a number string with thousands separators.
 * @param {string} digits
 * @param {string} sep
 */
function groupThousands(digits, sep) {
    let out = "";
    for (let i = 0; i < digits.length; i++) {
        const fromEnd = digits.length - i;
        out += digits[i];
        if (fromEnd > 1 && fromEnd % 3 === 1) {
            out += sep;
        }
    }
    return out;
}

/**
 * Format minor units for humans, e.g. formatMoney(123456, "USD") => "$1,234.56".
 * @param {number} minor
 * @param {string} code
 * @param {{ showCode?: boolean }} [opts]
 */
function formatMoney(minor, code, opts = {}) {
    assertMinor(minor);
    const info = getCurrency(code);
    const negative = minor < 0;
    const abs = Math.abs(minor);
    const factor = minorFactor(code);
    const whole = Math.trunc(abs / factor).toString();
    const frac = (abs % factor).toString().padStart(info.decimals, "0");
    let body = groupThousands(whole, ",");
    if (info.decimals > 0) {
        body += `.${frac}`;
    }
    let text = info.symbolFirst ? `${info.symbol}${body}` : `${body} ${info.symbol}`;
    if (negative) {
        text = `-${text}`;
    }
    if (opts.showCode) {
        text += ` ${info.code}`;
    }
    return text;
}

/**
 * Parse a user-typed amount like "1,234.50" into minor units for `code`.
 * Rejects more fractional digits than the currency supports.
 * @param {string} text
 * @param {string} code
 */
function parseMoney(text, code) {
    const info = getCurrency(code);
    const cleaned = String(text).replace(info.symbol.trim(), "").replace(/[,\s]/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
        throw new Error(`not a money amount: ${text}`);
    }
    const [, fraction = ""] = cleaned.split(".");
    if (fraction.length > info.decimals) {
        throw new Error(`${code} supports ${info.decimals} decimal places, got "${text}"`);
    }
    return toMinor(Number(cleaned), code);
}

function sumMinor(amounts) {
    let total = 0;
    for (const a of amounts) {
        assertMinor(a);
        total += a;
    }
    return total;
}

module.exports = {
    CURRENCIES,
    getCurrency,
    isSupported,
    listCurrencies,
    minorFactor,
    roundHalfEven,
    toMinor,
    fromMinor,
    assertMinor,
    allocateEvenly,
    allocateByWeight,
    formatMoney,
    parseMoney,
    sumMinor,
};
