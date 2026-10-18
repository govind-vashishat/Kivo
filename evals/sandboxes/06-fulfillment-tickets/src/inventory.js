/**
 * Stock levels and allocation.
 *
 * We have two warehouses (see data/stock.json). Orders are processed one at a
 * time, in the order they were placed, against a single shared inventory, so
 * an earlier order can use up stock a later order wanted.
 *
 * Allocation rules (agreed with ops, see TICKETS.md FUL-88):
 *
 * 1. Each physical item line is shipped from the customer's preferred
 *    warehouse (the closest one) if it has enough stock for the whole line.
 * 2. Otherwise from the other warehouse, if that one has enough.
 * 3. Otherwise the line is backordered. We never split one line across
 *    warehouses; ops would rather wait than pay for two parcels.
 */

const fs = require("node:fs");
const path = require("node:path");

function loadStock(dataDir) {
    const file = path.join(dataDir, "stock.json");
    return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/**
 * @param {{ warehouses: object[], stock: Record<string, Record<string, number>> }} data
 */
function createInventory(data) {
    const warehouses = data.warehouses.map((w) => ({ ...w }));
    // Deep copy so a run never mutates the loaded JSON.
    const levels = new Map(
        Object.entries(data.stock).map(([id, skus]) => [id, new Map(Object.entries(skus))]),
    );

    function warehouseIds() {
        return warehouses.map((w) => w.id);
    }

    /** @param {string} id */
    function warehouse(id) {
        const found = warehouses.find((w) => w.id === id);
        if (!found) throw new Error(`unknown warehouse ${id}`);
        return found;
    }

    /**
     * @param {string} warehouseId
     * @param {string} sku
     */
    function available(warehouseId, sku) {
        return levels.get(warehouseId)?.get(sku) ?? 0;
    }

    /**
     * Take stock out. Callers must check availability first; allocateOrder
     * does that for the whole order before committing.
     */
    function reserve(warehouseId, sku, qty) {
        const stock = levels.get(warehouseId);
        stock.set(sku, (stock.get(sku) ?? 0) - qty);
    }

    /** Current levels as a plain object, for reports and tests. */
    function snapshot() {
        const out = {};
        for (const [id, stock] of levels) {
            out[id] = Object.fromEntries(stock);
        }
        return out;
    }

    return { available, reserve, snapshot, warehouse, warehouseIds };
}

/**
 * The warehouse closest to a shipping region.
 * @param {string} region  "east" | "central" | "west"
 */
function preferredWarehouse(region) {
    if (region === "west") return "WEST";
    // Central is the same distance from both; EAST has the bigger dock.
    return "EAST";
}

/**
 * Decide where each item line ships from, then commit the reservations.
 * Planning first and committing at the end keeps an order atomic: if we
 * threw halfway through, no stock would have been taken.
 *
 * @param {ReturnType<typeof createInventory>} inventory
 * @param {{ sku: string, qty: number }[]} items  physical items (catalog.expand)
 * @param {string} region
 * @returns {{ allocations: { warehouse: string, sku: string, qty: number }[],
 *             backordered: { sku: string, qty: number }[] }}
 */
function allocateOrder(inventory, items, region) {
    const preferred = preferredWarehouse(region);
    const order = [preferred, ...inventory.warehouseIds().filter((id) => id !== preferred)];

    const allocations = [];
    const backordered = [];

    for (const item of items) {
        const source = order.find((id) => inventory.available(id, item.sku) >= item.qty);
        if (source) {
            allocations.push({ warehouse: source, sku: item.sku, qty: item.qty });
        } else {
            backordered.push({ sku: item.sku, qty: item.qty });
        }
    }

    for (const a of allocations) {
        inventory.reserve(a.warehouse, a.sku, a.qty);
    }

    return { allocations, backordered };
}

module.exports = { allocateOrder, createInventory, loadStock, preferredWarehouse };
