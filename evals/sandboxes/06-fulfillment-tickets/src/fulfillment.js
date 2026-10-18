/**
 * Fulfillment: turn one customer order into priced, dated shipments.
 *
 *   validate -> price -> expand bundles -> allocate stock
 *            -> group into parcels per warehouse -> quote shipping -> dates
 *
 * Timing rules:
 *
 * - Orders placed on a business day before the 17:00 UTC cutoff start
 *   processing that day. Anything later, or placed on a weekend/holiday,
 *   starts on the next business day.
 * - Picking and packing takes HANDLING_DAYS business days; the parcel leaves
 *   the warehouse at the end of that.
 * - The carrier then needs transitDays business days (see shipping.js).
 */

const { allocateOrder } = require("./inventory");
const { priceOrder } = require("./pricing");
const { quoteShipments } = require("./shipping");
const {
    addBusinessDays,
    isBusinessDay,
    nextBusinessDay,
    startOfDay,
    toISODate,
} = require("./dates");
const { sum } = require("./money");

const CUTOFF_HOUR_UTC = 17;
const HANDLING_DAYS = 1;
const REGIONS = new Set(["east", "central", "west"]);
const SERVICES = new Set(["standard", "express"]);

/**
 * @returns {string[]} problems; empty when the order can be processed
 */
function validateOrder(order, ctx) {
    const problems = [];
    if (!REGIONS.has(order.shipTo?.region)) {
        problems.push(`unknown region "${order.shipTo?.region}"`);
    }
    if (!SERVICES.has(order.service)) {
        problems.push(`unknown service "${order.service}"`);
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
        problems.push("order has no items");
    } else {
        for (const item of order.items) {
            if (!ctx.catalog.has(item.sku)) problems.push(`unknown sku ${item.sku}`);
            if (!Number.isInteger(item.qty) || item.qty < 1) {
                problems.push(`invalid quantity ${item.qty} for ${item.sku}`);
            }
        }
    }
    if (order.promo && !ctx.promotions.has(order.promo)) {
        problems.push(`unknown promo code "${order.promo}"`);
    }
    if (Number.isNaN(new Date(order.placedAt).getTime())) {
        problems.push(`invalid placedAt "${order.placedAt}"`);
    }
    return problems;
}

/**
 * The day the warehouse starts working on an order.
 * @param {string} placedAt  ISO timestamp
 */
function processingDay(placedAt) {
    const placed = new Date(placedAt);
    const day = startOfDay(placed);
    if (isBusinessDay(day) && placed.getUTCHours() < CUTOFF_HOUR_UTC) {
        return day;
    }
    return nextBusinessDay(day);
}

/**
 * Group allocations into one parcel per warehouse, merging repeated skus.
 * Warehouses keep the order in which they were first used.
 */
function buildParcels(allocations, catalog) {
    const byWarehouse = new Map();
    for (const a of allocations) {
        if (!byWarehouse.has(a.warehouse)) byWarehouse.set(a.warehouse, new Map());
        const items = byWarehouse.get(a.warehouse);
        items.set(a.sku, (items.get(a.sku) ?? 0) + a.qty);
    }

    return [...byWarehouse.entries()].map(([warehouse, items]) => {
        const list = [...items.entries()].map(([sku, qty]) => ({ sku, qty }));
        return { warehouse, items: list, grams: catalog.weightOf(list) };
    });
}

/**
 * Process one order against the shared inventory (which it mutates).
 *
 * @param {object} order
 * @param {{ catalog: object, inventory: object, promotions: Map<string, object> }} ctx
 */
function processOrder(order, ctx) {
    const problems = validateOrder(order, ctx);
    if (problems.length > 0) {
        return { orderId: order.id, status: "rejected", problems };
    }

    const pricing = priceOrder(order, ctx.catalog, ctx.promotions);
    const physical = ctx.catalog.expand(order.items);
    const { allocations, backordered } = allocateOrder(
        ctx.inventory,
        physical,
        order.shipTo.region,
    );

    const parcels = buildParcels(allocations, ctx.catalog);
    const quotes = quoteShipments(parcels, {
        region: order.shipTo.region,
        service: order.service,
        merchandiseCents: pricing.merchandiseCents,
    });

    const start = processingDay(order.placedAt);
    const shipDate = addBusinessDays(start, HANDLING_DAYS);

    const shipments = parcels.map((parcel, i) => ({
        warehouse: parcel.warehouse,
        items: parcel.items,
        grams: parcel.grams,
        costCents: quotes[i].costCents,
        shipDate: toISODate(shipDate),
        deliveryDate: toISODate(addBusinessDays(shipDate, quotes[i].transitDays)),
    }));

    let status = "ready";
    if (shipments.length === 0) status = "backordered";
    else if (backordered.length > 0) status = "partial";

    const shippingCents = sum(shipments.map((s) => s.costCents));

    return {
        orderId: order.id,
        status,
        totals: {
            subtotalCents: pricing.subtotalCents,
            discountCents: pricing.discountCents,
            shippingCents,
            totalCents: pricing.merchandiseCents + shippingCents,
        },
        shipments,
        backordered,
    };
}

module.exports = { buildParcels, processOrder, processingDay, validateOrder };
