/**
 * Discount rules and coupons.
 *
 * There are two kinds of rule:
 *   - line rules adjust individual lines (percent-off a category, bulk tiers)
 *   - order rules adjust the whole order after line rules (coupons, fixed credits)
 *
 * All amounts are integer minor units in the invoice currency. Fixed amounts
 * and minimum-spend thresholds are defined in their own currency and are
 * converted into the invoice currency when evaluated.
 */

const { roundHalfEven, assertMinor, getCurrency } = require("./currency");
const { convert } = require("./rates");

const COUPONS = {
    WELCOME10: {
        code: "WELCOME10",
        description: "10% off your first order",
        rule: { type: "percent", percent: 10 },
        minSpend: { amount: 5000, currency: "USD" },
        expires: "2026-12-31",
    },
    SAVE20: {
        code: "SAVE20",
        description: "$20 off orders over $100",
        rule: { type: "fixed", amount: 2000, currency: "USD" },
        minSpend: { amount: 10000, currency: "USD" },
        expires: "2026-12-31",
    },
    SUMMER15: {
        code: "SUMMER15",
        description: "15% off (summer sale, expired)",
        rule: { type: "percent", percent: 15 },
        minSpend: null,
        expires: "2026-08-31",
    },
};

/**
 * Percentage of an amount, rounded half-to-even.
 * @param {number} amountMinor
 * @param {number} percent
 */
function percentOf(amountMinor, percent) {
    assertMinor(amountMinor);
    if (typeof percent !== "number" || percent < 0 || percent > 100) {
        throw new RangeError(`percent must be between 0 and 100, got ${percent}`);
    }
    return roundHalfEven((amountMinor * percent) / 100);
}

/**
 * Pick the best bulk tier for a quantity. Tiers do not need to be sorted.
 * @param {{ minQty: number, percent: number }[]} tiers
 * @param {number} qty
 */
function bestTier(tiers, qty) {
    let best = null;
    for (const tier of tiers) {
        if (qty >= tier.minQty && (best === null || tier.minQty > best.minQty)) {
            best = tier;
        }
    }
    return best;
}

function lineMatches(rule, line) {
    if (rule.sku && rule.sku !== line.sku) return false;
    if (rule.category && rule.category !== line.category) return false;
    return true;
}

/**
 * Apply line rules. Each line gets at most one line rule: the one giving the
 * largest discount. Returns new line objects with `lineDiscount` and
 * `discountLabel` set.
 * @param {object[]} lines lines with { sku, category, qty, gross }
 * @param {object[]} rules
 */
function applyLineRules(lines, rules) {
    return lines.map((line) => {
        let bestAmount = 0;
        let bestLabel = null;
        for (const rule of rules) {
            if (!lineMatches(rule, line)) continue;
            let amount = 0;
            let label = null;
            if (rule.type === "percent") {
                amount = percentOf(line.gross, rule.percent);
                label = `${rule.percent}% off ${rule.category ?? rule.sku ?? "item"}`;
            } else if (rule.type === "bulk") {
                const tier = bestTier(rule.tiers, line.qty);
                if (tier) {
                    amount = percentOf(line.gross, tier.percent);
                    label = `bulk ${tier.percent}% (${tier.minQty}+)`;
                }
            } else {
                continue;
            }
            if (amount > bestAmount) {
                bestAmount = amount;
                bestLabel = label;
            }
        }
        return { ...line, lineDiscount: bestAmount, discountLabel: bestLabel };
    });
}

/**
 * Check whether a coupon can be used for an order.
 * @param {object} coupon
 * @param {{ subtotal: number, currency: string, date: string, table?: object }} ctx
 * @returns {{ ok: boolean, reason?: string }}
 */
function checkCoupon(coupon, ctx) {
    if (ctx.date > coupon.expires) {
        return { ok: false, reason: `coupon ${coupon.code} expired on ${coupon.expires}` };
    }
    if (coupon.minSpend) {
        const spendInThreshold = convert(
            ctx.subtotal,
            ctx.currency,
            coupon.minSpend.currency,
            ctx.table,
        );
        if (spendInThreshold < coupon.minSpend.amount) {
            return { ok: false, reason: `coupon ${coupon.code} needs a higher order value` };
        }
    }
    return { ok: true };
}

/**
 * Look up a coupon by code (case-insensitive).
 * @param {string} code
 */
function findCoupon(code) {
    if (!code) return null;
    return COUPONS[code.trim().toUpperCase()] ?? null;
}

/**
 * Compute the order-level discount for a subtotal (after line discounts).
 * Order rules stack; the result is capped at the subtotal.
 * @param {number} subtotal
 * @param {object[]} rules
 * @param {{ currency: string, table?: object }} ctx
 */
function orderDiscount(subtotal, rules, ctx) {
    assertMinor(subtotal);
    getCurrency(ctx.currency);
    let total = 0;
    const labels = [];
    for (const rule of rules) {
        if (rule.type === "percent") {
            const amount = percentOf(subtotal, rule.percent);
            total += amount;
            labels.push(`${rule.percent}% off order`);
        } else if (rule.type === "fixed") {
            const amount = convert(rule.amount, rule.currency, ctx.currency, ctx.table);
            total += amount;
            labels.push(`fixed credit`);
        } else {
            throw new Error(`unknown order rule type: ${rule.type}`);
        }
    }
    return { amount: Math.min(total, subtotal), labels };
}

/**
 * Resolve a coupon code into order rules for this order, or explain why it
 * cannot be used.
 * @param {string | undefined} code
 * @param {{ subtotal: number, currency: string, date: string, table?: object }} ctx
 */
function couponRules(code, ctx) {
    if (!code) return { rules: [], note: null };
    const coupon = findCoupon(code);
    if (!coupon) {
        return { rules: [], note: `unknown coupon ${code}` };
    }
    const check = checkCoupon(coupon, ctx);
    if (!check.ok) {
        return { rules: [], note: check.reason };
    }
    return { rules: [coupon.rule], note: `applied ${coupon.code}` };
}

module.exports = {
    COUPONS,
    percentOf,
    bestTier,
    applyLineRules,
    checkCoupon,
    findCoupon,
    orderDiscount,
    couponRules,
};
