/**
 * Money helpers.
 *
 * Every amount in this codebase is an integer number of US cents. Never use
 * floats for money: 0.1 + 0.2 !== 0.3, and those errors add up across a
 * night's worth of orders. Convert to dollars only when formatting.
 */

/**
 * @param {number} cents
 * @returns {string} e.g. "$1,234.56", "-$5.00"
 */
function formatUsd(cents) {
    if (!Number.isInteger(cents)) {
        throw new Error(`formatUsd expects integer cents, got ${cents}`);
    }
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    const dollars = Math.floor(abs / 100).toLocaleString("en-US");
    const rest = String(abs % 100).padStart(2, "0");
    return `${sign}$${dollars}.${rest}`;
}

/**
 * Percentage of an amount, rounded half up to the nearest cent.
 * @param {number} cents
 * @param {number} percent  e.g. 15 for 15%
 */
function percentOf(cents, percent) {
    return Math.round((cents * percent) / 100);
}

/**
 * Split `total` cents across `weights` proportionally, so that the parts
 * always add up to exactly `total` (largest remainder method).
 *
 *   allocate(100, [1, 1, 1]) -> [34, 33, 33]
 *
 * @param {number} total
 * @param {number[]} weights  non-negative
 * @returns {number[]}
 */
function allocate(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum === 0) return weights.map(() => 0);

    const exact = weights.map((w) => (total * w) / sum);
    const parts = exact.map((x) => Math.floor(x));
    let left = total - parts.reduce((a, b) => a + b, 0);

    const order = exact
        .map((x, i) => ({ i, frac: x - Math.floor(x) }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (const { i } of order) {
        if (left <= 0) break;
        parts[i] += 1;
        left -= 1;
    }
    return parts;
}

/** @param {number[]} values */
function sum(values) {
    return values.reduce((a, b) => a + b, 0);
}

module.exports = { allocate, formatUsd, percentOf, sum };
