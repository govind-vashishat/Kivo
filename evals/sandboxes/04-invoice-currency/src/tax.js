/**
 * Sales tax / VAT.
 *
 * Rates are stored in basis points (1% = 100 bp) to keep the maths in
 * integers. A region is either tax-exclusive (tax is added on top of the
 * price, as in the US) or tax-inclusive (the price already contains the tax,
 * as with VAT in the UK and EU).
 */

const { roundHalfEven, assertMinor } = require("./currency");

const REGIONS = {
    "US-NY": {
        code: "US-NY",
        name: "New York, USA",
        inclusive: false,
        standardBp: 888,
        categoryBp: { services: 0 },
    },
    "US-OR": {
        code: "US-OR",
        name: "Oregon, USA",
        inclusive: false,
        standardBp: 0,
        categoryBp: {},
    },
    GB: {
        code: "GB",
        name: "United Kingdom",
        inclusive: true,
        standardBp: 2000,
        categoryBp: { books: 0 },
    },
    DE: {
        code: "DE",
        name: "Germany",
        inclusive: true,
        standardBp: 1900,
        categoryBp: { books: 700 },
    },
    JP: {
        code: "JP",
        name: "Japan",
        inclusive: false,
        standardBp: 1000,
        categoryBp: {},
    },
    IN: {
        code: "IN",
        name: "India",
        inclusive: false,
        standardBp: 1800,
        categoryBp: { books: 0, services: 1800 },
    },
    KW: {
        code: "KW",
        name: "Kuwait",
        inclusive: false,
        standardBp: 0,
        categoryBp: {},
    },
    CH: {
        code: "CH",
        name: "Switzerland",
        inclusive: false,
        standardBp: 810,
        categoryBp: { books: 260 },
    },
};

/**
 * @param {string} code
 */
function getRegion(code) {
    const region = REGIONS[code];
    if (!region) {
        throw new Error(`unknown tax region: ${code}`);
    }
    return region;
}

/**
 * Tax rate in basis points for a category in a region.
 * @param {object} region
 * @param {string} category
 */
function rateFor(region, category) {
    if (Object.hasOwn(region.categoryBp, category)) {
        return region.categoryBp[category];
    }
    return region.standardBp;
}

/**
 * Tax on an amount that does NOT include tax.
 * @param {number} netMinor
 * @param {number} bp
 */
function exclusiveTax(netMinor, bp) {
    assertMinor(netMinor);
    return roundHalfEven((netMinor * bp) / 10000);
}

/**
 * The tax portion contained in an amount that already includes tax.
 * @param {number} grossMinor
 * @param {number} bp
 */
function inclusiveTax(grossMinor, bp) {
    assertMinor(grossMinor);
    if (bp === 0) return 0;
    const net = roundHalfEven((grossMinor * 10000) / (10000 + bp));
    return grossMinor - net;
}

/**
 * Compute tax for a set of lines. Each line must have `category` and
 * `taxable` (the amount after all discounts, in minor units).
 *
 * Returns per-line tax plus a breakdown grouped by rate, which is what goes
 * on the printed invoice.
 * @param {object[]} lines
 * @param {string} regionCode
 */
function computeTax(lines, regionCode) {
    const region = getRegion(regionCode);
    const perLine = [];
    const byRate = new Map();
    for (const line of lines) {
        const bp = rateFor(region, line.category);
        const tax = region.inclusive
            ? inclusiveTax(line.taxable, bp)
            : exclusiveTax(line.taxable, bp);
        perLine.push({ sku: line.sku, bp, tax });
        const bucket = byRate.get(bp) ?? { bp, base: 0, tax: 0 };
        bucket.base += line.taxable;
        bucket.tax += tax;
        byRate.set(bp, bucket);
    }
    const breakdown = [...byRate.values()].sort((a, b) => b.bp - a.bp);
    const total = perLine.reduce((sum, l) => sum + l.tax, 0);
    return { inclusive: region.inclusive, perLine, breakdown, total };
}

/**
 * Format basis points as a percentage label, e.g. 888 -> "8.88%".
 * @param {number} bp
 */
function formatRate(bp) {
    const pct = bp / 100;
    return `${Number.isInteger(pct) ? pct.toString() : pct.toFixed(2)}%`;
}

/**
 * Label used on invoices ("VAT" for inclusive regions, "Sales tax" otherwise).
 * @param {string} regionCode
 */
function taxLabel(regionCode) {
    const region = getRegion(regionCode);
    if (region.inclusive) return "VAT";
    if (region.code === "JP") return "Consumption tax";
    if (region.code === "IN") return "GST";
    return "Sales tax";
}

/**
 * True when the region charges no tax on anything.
 * @param {string} regionCode
 */
function isTaxFree(regionCode) {
    const region = getRegion(regionCode);
    return region.standardBp === 0 && Object.values(region.categoryBp).every((bp) => bp === 0);
}

module.exports = {
    REGIONS,
    getRegion,
    rateFor,
    exclusiveTax,
    inclusiveTax,
    computeTax,
    formatRate,
    taxLabel,
    isTaxFree,
};
