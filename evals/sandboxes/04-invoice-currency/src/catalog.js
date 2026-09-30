/**
 * Product catalog.
 *
 * Every product has a list price stored in a single currency (most of the
 * catalog is priced in USD; the Japan-only range is priced in JPY). Invoices
 * in other currencies convert from the list price at build time.
 */

const { getCurrency, assertMinor } = require("./currency");

const CATEGORIES = ["hardware", "software", "books", "services", "accessories"];

const PRODUCTS = [
    {
        sku: "KB-100",
        name: "Mechanical Keyboard",
        category: "hardware",
        price: { amount: 8999, currency: "USD" },
        active: true,
        weightGrams: 950,
    },
    {
        sku: "MS-210",
        name: "Wireless Mouse",
        category: "hardware",
        price: { amount: 2999, currency: "USD" },
        active: true,
        weightGrams: 110,
    },
    {
        sku: "MN-270",
        name: '27" Monitor',
        category: "hardware",
        price: { amount: 32900, currency: "USD" },
        active: true,
        weightGrams: 6200,
    },
    {
        sku: "CB-USB",
        name: "USB-C Cable (2m)",
        category: "accessories",
        price: { amount: 1250, currency: "USD" },
        active: true,
        weightGrams: 60,
    },
    {
        sku: "BK-JS",
        name: "JavaScript: The Deep Parts",
        category: "books",
        price: { amount: 3900, currency: "USD" },
        active: true,
        weightGrams: 700,
    },
    {
        sku: "SW-ED",
        name: "Editor Pro (1-year licence)",
        category: "software",
        price: { amount: 12000, currency: "USD" },
        active: true,
        weightGrams: 0,
    },
    {
        sku: "SV-SETUP",
        name: "On-site Setup (per hour)",
        category: "services",
        price: { amount: 7500, currency: "USD" },
        active: true,
        weightGrams: 0,
    },
    {
        sku: "JP-KB-60",
        name: "Compact Keyboard (JIS layout)",
        category: "hardware",
        price: { amount: 12800, currency: "JPY" },
        active: true,
        weightGrams: 620,
    },
    {
        sku: "JP-PAD",
        name: "Desk Pad (Japan edition)",
        category: "accessories",
        price: { amount: 2480, currency: "JPY" },
        active: true,
        weightGrams: 400,
    },
    {
        sku: "OLD-TRK",
        name: "Trackball (discontinued)",
        category: "hardware",
        price: { amount: 4999, currency: "USD" },
        active: false,
        weightGrams: 300,
    },
];

/**
 * Validate a product record. Returns a list of problems (empty when valid).
 * @param {object} product
 */
function validateProduct(product) {
    const problems = [];
    if (typeof product.sku !== "string" || !/^[A-Z0-9-]+$/.test(product.sku)) {
        problems.push(`invalid sku: ${product.sku}`);
    }
    if (typeof product.name !== "string" || product.name.trim() === "") {
        problems.push(`product ${product.sku} has no name`);
    }
    if (!CATEGORIES.includes(product.category)) {
        problems.push(`product ${product.sku} has unknown category ${product.category}`);
    }
    try {
        assertMinor(product.price.amount);
        getCurrency(product.price.currency);
        if (product.price.amount < 0) {
            problems.push(`product ${product.sku} has a negative price`);
        }
    } catch (err) {
        problems.push(`product ${product.sku} has an invalid price: ${err.message}`);
    }
    return problems;
}

/**
 * Build an index from sku to product. Throws if the list contains duplicates
 * or invalid records.
 * @param {object[]} products
 */
function buildIndex(products) {
    const index = new Map();
    for (const product of products) {
        const problems = validateProduct(product);
        if (problems.length > 0) {
            throw new Error(`invalid catalog entry: ${problems.join("; ")}`);
        }
        if (index.has(product.sku)) {
            throw new Error(`duplicate sku in catalog: ${product.sku}`);
        }
        index.set(product.sku, Object.freeze({ ...product, price: { ...product.price } }));
    }
    return index;
}

const DEFAULT_INDEX = buildIndex(PRODUCTS);

/**
 * Look up an active product by sku.
 * @param {string} sku
 * @param {Map<string, object>} [index]
 */
function getProduct(sku, index = DEFAULT_INDEX) {
    const product = index.get(sku);
    if (!product) {
        throw new Error(`unknown sku: ${sku}`);
    }
    if (!product.active) {
        throw new Error(`product ${sku} is discontinued`);
    }
    return product;
}

function hasProduct(sku, index = DEFAULT_INDEX) {
    const product = index.get(sku);
    return Boolean(product?.active);
}

/**
 * All active products in a category, sorted by name.
 * @param {string} category
 * @param {Map<string, object>} [index]
 */
function listByCategory(category, index = DEFAULT_INDEX) {
    if (!CATEGORIES.includes(category)) {
        throw new Error(`unknown category: ${category}`);
    }
    return [...index.values()]
        .filter((p) => p.active && p.category === category)
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Case-insensitive search over name and sku.
 * @param {string} query
 * @param {Map<string, object>} [index]
 */
function search(query, index = DEFAULT_INDEX) {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    return [...index.values()].filter(
        (p) => p.active && (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)),
    );
}

/**
 * Total shipping weight for a list of { sku, qty } items.
 * @param {{ sku: string, qty: number }[]} items
 * @param {Map<string, object>} [index]
 */
function shippingWeight(items, index = DEFAULT_INDEX) {
    let grams = 0;
    for (const item of items) {
        grams += getProduct(item.sku, index).weightGrams * item.qty;
    }
    return grams;
}

/**
 * True when the product is delivered digitally or as a service, so no
 * shipping applies.
 * @param {object} product
 */
function isDigital(product) {
    return product.category === "software" || product.category === "services";
}

module.exports = {
    CATEGORIES,
    PRODUCTS,
    validateProduct,
    buildIndex,
    getProduct,
    hasProduct,
    listByCategory,
    search,
    shippingWeight,
    isDigital,
};
