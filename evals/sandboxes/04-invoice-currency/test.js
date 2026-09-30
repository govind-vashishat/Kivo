const { formatMoney } = require("./src/currency");
const { buildInvoice } = require("./src/invoice");

// Tiny test harness: runs every case and reports all failures, instead of
// stopping at the first one like a bare assert would.
const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

function expectEqual(actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`expected ${e}\n      actual   ${a}`);
    }
}

// --- money formatting ---

test("formats USD with cents", () => {
    expectEqual(formatMoney(123456, "USD"), "$1,234.56");
});

test("formats JPY without decimals", () => {
    expectEqual(formatMoney(1500, "JPY"), "¥1,500");
});

test("formats KWD with three decimals", () => {
    expectEqual(formatMoney(12345, "KWD"), "KD 12.345");
});

test("formats EUR with symbol after the amount", () => {
    expectEqual(formatMoney(99950, "EUR"), "999.50 €");
});

// --- invoices ---

test("USD invoice, New York sales tax (services exempt)", () => {
    const inv = buildInvoice({
        currency: "USD",
        region: "US-NY",
        items: [
            { sku: "KB-100", qty: 1 },
            { sku: "CB-USB", qty: 2 },
            { sku: "SV-SETUP", qty: 2 },
        ],
    });
    expectEqual(inv.totals, { subtotal: 26499, discount: 0, tax: 1021, total: 27520 });
});

test("EUR invoice, German VAT included, reduced rate on books", () => {
    const inv = buildInvoice({
        currency: "EUR",
        region: "DE",
        items: [
            { sku: "BK-JS", qty: 1 },
            { sku: "MS-210", qty: 1 },
        ],
    });
    expectEqual(inv.totals, { subtotal: 6347, discount: 0, tax: 676, total: 6347 });
});

test("GBP invoice with WELCOME10 coupon", () => {
    const inv = buildInvoice({
        currency: "GBP",
        region: "GB",
        coupon: "WELCOME10",
        items: [
            { sku: "MN-270", qty: 1 },
            { sku: "BK-JS", qty: 2 },
        ],
    });
    expectEqual(inv.totals, { subtotal: 32153, discount: 3215, tax: 3899, total: 28938 });
});

test("INR invoice with bulk discount on cables", () => {
    const inv = buildInvoice({
        currency: "INR",
        region: "IN",
        lineRules: [
            {
                type: "bulk",
                sku: "CB-USB",
                tiers: [
                    { minQty: 5, percent: 5 },
                    { minQty: 10, percent: 12 },
                ],
            },
        ],
        items: [
            { sku: "CB-USB", qty: 12 },
            { sku: "SW-ED", qty: 1 },
        ],
    });
    expectEqual(inv.totals, { subtotal: 2247744, discount: 149849, tax: 377621, total: 2475516 });
});

test("JPY invoice for USD-priced products", () => {
    const inv = buildInvoice({
        currency: "JPY",
        region: "JP",
        items: [
            { sku: "KB-100", qty: 1 },
            { sku: "MS-210", qty: 2 },
        ],
    });
    expectEqual(inv.totals, { subtotal: 22422, discount: 0, tax: 2242, total: 24664 });
});

test("JPY invoice for Japan-only products (priced in JPY)", () => {
    const inv = buildInvoice({
        currency: "JPY",
        region: "JP",
        items: [
            { sku: "JP-KB-60", qty: 1 },
            { sku: "JP-PAD", qty: 2 },
        ],
    });
    expectEqual(inv.totals, { subtotal: 17760, discount: 0, tax: 1776, total: 19536 });
});

test("KWD invoice, no tax in Kuwait", () => {
    const inv = buildInvoice({
        currency: "KWD",
        region: "KW",
        items: [
            { sku: "MN-270", qty: 1 },
            { sku: "KB-100", qty: 1 },
        ],
    });
    expectEqual(inv.totals, { subtotal: 128840, discount: 0, tax: 0, total: 128840 });
});

test("JPY invoice with SAVE20 coupon", () => {
    const inv = buildInvoice({
        currency: "JPY",
        region: "JP",
        coupon: "SAVE20",
        items: [
            { sku: "MN-270", qty: 1 },
            { sku: "SW-ED", qty: 1 },
        ],
    });
    expectEqual(inv.totals, { subtotal: 67126, discount: 2990, tax: 6414, total: 70550 });
});

test("CHF invoice, Swiss VAT added, reduced rate on books", () => {
    const inv = buildInvoice({
        currency: "CHF",
        region: "CH",
        items: [
            { sku: "SW-ED", qty: 1 },
            { sku: "BK-JS", qty: 1 },
        ],
    });
    expectEqual(inv.totals, { subtotal: 13992, discount: 0, tax: 944, total: 14936 });
});

// --- run ---

let failed = 0;
for (const t of tests) {
    try {
        t.fn();
        console.log(`  ✓ ${t.name}`);
    } catch (err) {
        failed += 1;
        console.log(`  ✗ ${t.name}\n      ${err.message}`);
    }
}
console.log(`\n${tests.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
