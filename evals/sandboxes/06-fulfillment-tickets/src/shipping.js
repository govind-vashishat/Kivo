/**
 * Shipping cost and transit time.
 *
 * Rates come from our carrier contract and depend on where a parcel ships
 * from (warehouse) and where it goes (customer region):
 *
 *   cost = base + perHalfKg * (number of started 500 g steps)
 *
 * Standard shipping is free when the order's merchandise total (after
 * discounts, before shipping) is at least $50. Express is never free, costs
 * twice the standard rate and takes half the transit days (rounded up,
 * minimum one day).
 *
 * Every shipment (one per warehouse) is charged separately.
 */

const { percentOf } = require("./money");

// Free standard shipping on orders over $50.
const FREE_SHIPPING_THRESHOLD = 50;

const EXPRESS_MULTIPLIER_PERCENT = 200;

/** @type {Record<string, Record<string, { baseCents: number, perHalfKgCents: number, transitDays: number }>>} */
const RATES = {
    EAST: {
        east: { baseCents: 599, perHalfKgCents: 120, transitDays: 2 },
        central: { baseCents: 799, perHalfKgCents: 150, transitDays: 3 },
        west: { baseCents: 999, perHalfKgCents: 180, transitDays: 5 },
    },
    WEST: {
        east: { baseCents: 999, perHalfKgCents: 180, transitDays: 5 },
        central: { baseCents: 799, perHalfKgCents: 150, transitDays: 3 },
        west: { baseCents: 599, perHalfKgCents: 120, transitDays: 2 },
    },
};

const SERVICES = new Set(["standard", "express"]);

/**
 * @param {string} warehouse
 * @param {string} region
 */
function rateFor(warehouse, region) {
    const rate = RATES[warehouse]?.[region];
    if (!rate) throw new Error(`no rate from ${warehouse} to ${region}`);
    return rate;
}

/**
 * Carrier price for one parcel, before any free-shipping rule.
 *
 * @param {string} warehouse
 * @param {string} region
 * @param {number} grams
 * @param {string} service  "standard" | "express"
 */
function parcelCost(warehouse, region, grams, service) {
    const rate = rateFor(warehouse, region);
    const steps = Math.max(1, Math.ceil(grams / 500));
    const standard = rate.baseCents + rate.perHalfKgCents * steps;
    return service === "express" ? percentOf(standard, EXPRESS_MULTIPLIER_PERCENT) : standard;
}

/**
 * @param {string} warehouse
 * @param {string} region
 * @param {string} service
 * @returns {number} business days in transit
 */
function transitDays(warehouse, region, service) {
    const days = rateFor(warehouse, region).transitDays;
    return service === "express" ? Math.max(1, Math.ceil(days / 2)) : days;
}

/**
 * @param {number} merchandiseCents  order total after discounts, before shipping
 * @param {string} service
 */
function qualifiesForFreeShipping(merchandiseCents, service) {
    return service === "standard" && merchandiseCents >= FREE_SHIPPING_THRESHOLD;
}

/**
 * Price every shipment of an order.
 *
 * @param {{ warehouse: string, grams: number }[]} parcels
 * @param {{ region: string, service: string, merchandiseCents: number }} order
 * @returns {{ warehouse: string, grams: number, costCents: number, transitDays: number }[]}
 */
function quoteShipments(parcels, order) {
    if (!SERVICES.has(order.service)) {
        throw new Error(`unknown shipping service "${order.service}"`);
    }
    const free = qualifiesForFreeShipping(order.merchandiseCents, order.service);

    return parcels.map((parcel) => ({
        warehouse: parcel.warehouse,
        grams: parcel.grams,
        costCents: free
            ? 0
            : parcelCost(parcel.warehouse, order.region, parcel.grams, order.service),
        transitDays: transitDays(parcel.warehouse, order.region, order.service),
    }));
}

module.exports = {
    FREE_SHIPPING_THRESHOLD,
    parcelCost,
    qualifiesForFreeShipping,
    quoteShipments,
    rateFor,
    transitDays,
};
