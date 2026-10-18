/**
 * Nightly fulfillment report, emailed to ops and finance after each run.
 *
 * Sections:
 *   - order counts by status
 *   - revenue for accepted orders (everything except rejected)
 *   - parcels per warehouse
 *   - expected deliveries per day (customer support uses this for "where is
 *     my order" tickets, so it has to match what we promise customers)
 *   - backorders, low stock alerts and rejected orders
 */

const { formatUsd, sum } = require("./money");

const STATUS_ORDER = ["ready", "partial", "backordered", "rejected"];
const LOW_STOCK_LEVEL = 1;

function pad(value, width) {
    return String(value).padEnd(width);
}

function padLeft(value, width) {
    return String(value).padStart(width);
}

function statusLine(results) {
    const counts = STATUS_ORDER.map(
        (status) => `${status} ${results.filter((r) => r.status === status).length}`,
    );
    return `Orders: ${results.length} (${counts.join(", ")})`;
}

function revenueLines(accepted) {
    const subtotal = sum(accepted.map((r) => r.totals.subtotalCents));
    const discount = sum(accepted.map((r) => r.totals.discountCents));
    const shipping = sum(accepted.map((r) => r.totals.shippingCents));
    const total = sum(accepted.map((r) => r.totals.totalCents));
    return [
        "Revenue (accepted orders)",
        `  Subtotal   ${padLeft(formatUsd(subtotal), 11)}`,
        `  Discounts  ${padLeft(formatUsd(-discount), 11)}`,
        `  Shipping   ${padLeft(formatUsd(shipping), 11)}`,
        `  Total      ${padLeft(formatUsd(total), 11)}`,
    ];
}

function warehouseLines(accepted, warehouseIds) {
    const lines = ["Parcels by warehouse"];
    for (const id of warehouseIds) {
        const parcels = accepted.flatMap((r) => r.shipments).filter((s) => s.warehouse === id);
        const units = sum(parcels.flatMap((p) => p.items.map((i) => i.qty)));
        const kg = (sum(parcels.map((p) => p.grams)) / 1000).toFixed(1);
        const cost = sum(parcels.map((p) => p.costCents));
        lines.push(
            `  ${pad(id, 5)} ${padLeft(parcels.length, 3)} parcels ${padLeft(units, 4)} units ${padLeft(kg, 6)} kg  ${padLeft(formatUsd(cost), 9)} shipping`,
        );
    }
    return lines;
}

function deliveryLines(accepted) {
    const byDate = new Map();
    for (const shipment of accepted.flatMap((r) => r.shipments)) {
        byDate.set(shipment.deliveryDate, (byDate.get(shipment.deliveryDate) ?? 0) + 1);
    }
    const dates = [...byDate.keys()].sort();
    return ["Expected deliveries", ...dates.map((d) => `  ${d}  ${padLeft(byDate.get(d), 3)}`)];
}

function backorderLine(accepted) {
    const bySku = new Map();
    for (const item of accepted.flatMap((r) => r.backordered)) {
        bySku.set(item.sku, (bySku.get(item.sku) ?? 0) + item.qty);
    }
    if (bySku.size === 0) return "Backordered: none";
    const parts = [...bySku.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sku, qty]) => `${sku} x${qty}`);
    return `Backordered: ${sum([...bySku.values()])} units (${parts.join(", ")})`;
}

function stockLine(snapshot) {
    const alerts = [];
    for (const id of Object.keys(snapshot).sort()) {
        for (const sku of Object.keys(snapshot[id]).sort()) {
            const level = snapshot[id][sku];
            if (level <= LOW_STOCK_LEVEL) alerts.push(`${id} ${sku} ${level}`);
        }
    }
    return `Low stock (<= ${LOW_STOCK_LEVEL} left): ${alerts.length === 0 ? "none" : alerts.join(", ")}`;
}

function rejectedLines(results) {
    const rejected = results.filter((r) => r.status === "rejected");
    if (rejected.length === 0) return [];
    return ["Rejected", ...rejected.map((r) => `  ${r.orderId}  ${r.problems.join("; ")}`)];
}

/**
 * @param {{ runDate: string, results: object[], stock: object, warehouseIds: string[] }} run
 * @returns {string}
 */
function formatReport(run) {
    const accepted = run.results.filter((r) => r.status !== "rejected");
    const sections = [
        [`Nightly fulfillment run ${run.runDate}`, statusLine(run.results)],
        revenueLines(accepted),
        warehouseLines(accepted, run.warehouseIds),
        deliveryLines(accepted),
        [backorderLine(accepted), stockLine(run.stock)],
        rejectedLines(run.results),
    ];
    return sections
        .filter((s) => s.length > 0)
        .map((s) => s.join("\n"))
        .join("\n\n");
}

module.exports = { formatReport };
