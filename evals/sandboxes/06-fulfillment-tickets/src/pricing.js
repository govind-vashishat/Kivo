/**
 * Order pricing: line subtotals and promo-code discounts.
 *
 * Prices come from the catalog (a bundle is one line at the bundle price).
 * An order can carry at most one promo code; codes and their rules live in
 * data/promotions.json. Supported promotion types:
 *
 *   percent           X% off the whole order, if the subtotal reaches minSubtotalCents
 *   fixed             a fixed amount off, if the subtotal reaches minSubtotalCents
 *   category_percent  X% off every line in one category
 *
 * The result always satisfies: merchandiseCents = subtotalCents - discountCents,
 * and the discount never exceeds the subtotal.
 */

const fs = require("node:fs");
const path = require("node:path");
const { percentOf, sum } = require("./money");

function loadPromotions(dataDir) {
    const file = path.join(dataDir, "promotions.json");
    const list = JSON.parse(fs.readFileSync(file, "utf-8"));
    return new Map(list.map((p) => [p.code, p]));
}

/**
 * @param {{ sku: string, qty: number }[]} lines
 * @param {ReturnType<import("./catalog").createCatalog>} catalog
 */
function priceLines(lines, catalog) {
    return lines.map((line) => {
        const product = catalog.get(line.sku);
        return {
            sku: line.sku,
            qty: line.qty,
            category: product.category,
            unitPriceCents: product.priceCents,
            lineCents: product.priceCents * line.qty,
        };
    });
}

function percentDiscount(promo, priced, subtotal) {
    if (subtotal < (promo.minSubtotalCents ?? 0)) return 0;
    return percentOf(subtotal, promo.percent);
}

function fixedDiscount(promo, priced, subtotal) {
    if (subtotal < (promo.minSubtotalCents ?? 0)) return 0;
    return Math.min(promo.amountCents, subtotal);
}

function categoryPercentDiscount(promo, priced) {
    const inCategory = priced.filter((l) => l.category === promo.category);
    return sum(inCategory.map((l) => percentOf(l.lineCents, promo.percent)));
}

/**
 * @param {object} promo
 * @param {ReturnType<typeof priceLines>} priced
 * @param {number} subtotal
 * @returns {number} discount in cents
 */
function discountFor(promo, priced, subtotal) {
    switch (promo.type) {
        case "percent":
            return percentDiscount(promo, priced, subtotal);
        case "fixed":
            return fixedDiscount(promo, priced, subtotal);
        case "category_percent":
            return categoryPercentDiscount(promo, priced);
        default:
            throw new Error(`unsupported promotion type "${promo.type}" (${promo.code})`);
    }
}

/**
 * @param {{ items: { sku: string, qty: number }[], promo?: string }} order
 * @param {ReturnType<import("./catalog").createCatalog>} catalog
 * @param {Map<string, object>} promotions
 * @returns {{ lines: object[], subtotalCents: number, discountCents: number,
 *             merchandiseCents: number, promo: string | null }}
 */
function priceOrder(order, catalog, promotions) {
    const priced = priceLines(order.items, catalog);
    const subtotalCents = sum(priced.map((l) => l.lineCents));

    let discountCents = 0;
    if (order.promo) {
        const promo = promotions.get(order.promo);
        if (!promo) throw new Error(`unknown promo code "${order.promo}"`);
        discountCents = Math.min(discountFor(promo, priced, subtotalCents), subtotalCents);
    }

    return {
        lines: priced,
        subtotalCents,
        discountCents,
        merchandiseCents: subtotalCents - discountCents,
        promo: order.promo ?? null,
    };
}

module.exports = { discountFor, loadPromotions, priceLines, priceOrder };
