/**
 * Nightly run: process every order placed today, in the order they came in,
 * against one shared inventory, then print the report.
 *
 *   node src/index.js
 */

const fs = require("node:fs");
const path = require("node:path");
const { createCatalog, loadProducts } = require("./catalog");
const { createInventory, loadStock } = require("./inventory");
const { loadPromotions } = require("./pricing");
const { processOrder } = require("./fulfillment");
const { formatReport } = require("./report");

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");

/**
 * @param {{ dataDir?: string, orders?: object[] }} [options]
 *   orders defaults to data/orders.json
 */
function runNightly(options = {}) {
    const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
    const ordersFile = JSON.parse(fs.readFileSync(path.join(dataDir, "orders.json"), "utf-8"));
    const orders = options.orders ?? ordersFile.orders;

    const ctx = {
        catalog: createCatalog(loadProducts(dataDir)),
        inventory: createInventory(loadStock(dataDir)),
        promotions: loadPromotions(dataDir),
    };

    const sorted = [...orders].sort((a, b) => a.placedAt.localeCompare(b.placedAt));
    const results = sorted.map((order) => processOrder(order, ctx));

    const run = {
        runDate: ordersFile.runDate,
        results,
        stock: ctx.inventory.snapshot(),
        warehouseIds: ctx.inventory.warehouseIds(),
    };
    return { ...run, report: formatReport(run) };
}

if (require.main === module) {
    console.log(runNightly().report);
}

module.exports = { runNightly };
