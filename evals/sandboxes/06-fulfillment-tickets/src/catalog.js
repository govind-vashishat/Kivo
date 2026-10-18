/**
 * Product catalog.
 *
 * Two kinds of products live in data/products.json:
 *
 * - simple:  a physical item with its own stock, weight and price
 * - bundle:  a set of simple products sold together at one price. A bundle
 *            has no stock or weight of its own; the warehouse picks its
 *            components. Pricing treats it as a single line (category
 *            "bundles"), everything physical works on the components.
 */

const fs = require("node:fs");
const path = require("node:path");

function loadProducts(dataDir) {
    const file = path.join(dataDir, "products.json");
    return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/**
 * @param {object[]} products
 */
function createCatalog(products) {
    const bySku = new Map(products.map((p) => [p.sku, p]));

    for (const product of products) {
        if (product.type !== "bundle") continue;
        for (const component of product.components) {
            const target = bySku.get(component.sku);
            if (!target) {
                throw new Error(`bundle ${product.sku} contains unknown sku ${component.sku}`);
            }
            if (target.type !== "simple") {
                throw new Error(`bundle ${product.sku} contains another bundle ${component.sku}`);
            }
        }
    }

    /** @param {string} sku */
    function has(sku) {
        return bySku.has(sku);
    }

    /** @param {string} sku */
    function get(sku) {
        const product = bySku.get(sku);
        if (!product) throw new Error(`unknown sku ${sku}`);
        return product;
    }

    /**
     * Turn order lines into the physical items the warehouse has to pick.
     * Bundles are replaced by their components (quantities multiplied);
     * simple products pass through unchanged. Lines are NOT merged: the
     * same sku can appear more than once, e.g. a bundle component and the
     * same item ordered separately.
     *
     * @param {{ sku: string, qty: number }[]} lines
     * @returns {{ sku: string, qty: number, fromBundle: string | null }[]}
     */
    function expand(lines) {
        const items = [];
        for (const line of lines) {
            const product = get(line.sku);
            if (product.type === "bundle") {
                for (const component of product.components) {
                    items.push({
                        sku: component.sku,
                        qty: component.qty * line.qty,
                        fromBundle: product.sku,
                    });
                }
            } else {
                items.push({ sku: line.sku, qty: line.qty, fromBundle: null });
            }
        }
        return items;
    }

    /**
     * Shipping weight of physical items, in grams.
     * @param {{ sku: string, qty: number }[]} items  output of expand()
     */
    function weightOf(items) {
        let grams = 0;
        for (const item of items) {
            grams += get(item.sku).weightGrams * item.qty;
        }
        return grams;
    }

    return { expand, get, has, weightOf };
}

module.exports = { createCatalog, loadProducts };
