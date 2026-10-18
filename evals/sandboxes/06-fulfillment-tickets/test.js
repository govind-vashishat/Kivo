const path = require("node:path");
const { allocate, formatUsd } = require("./src/money");
const { createCatalog, loadProducts } = require("./src/catalog");
const { discountFor, loadPromotions, priceLines, priceOrder } = require("./src/pricing");
const { parcelCost, qualifiesForFreeShipping, transitDays } = require("./src/shipping");
const { addBusinessDays, parseDate, toISODate } = require("./src/dates");
const { processingDay } = require("./src/fulfillment");
const { runNightly } = require("./src/index");

const DATA_DIR = path.join(__dirname, "data");

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

function expectText(actual, expected) {
    if (actual !== expected) {
        throw new Error(`expected:\n${expected}\n\n      actual:\n${actual}`);
    }
}

const catalog = createCatalog(loadProducts(DATA_DIR));
const promotions = loadPromotions(DATA_DIR);

let nextId = 1;
/** Build an order with sensible defaults. */
function order(items, overrides = {}) {
    return {
        id: `t-${nextId++}`,
        placedAt: "2026-11-17T10:00:00Z",
        customer: "Test Customer",
        shipTo: { region: "east" },
        service: "standard",
        items: items.map(([sku, qty]) => ({ sku, qty })),
        ...overrides,
    };
}

/** Run the nightly job on just these orders, with fresh stock. */
function run(...orders) {
    return runNightly({ dataDir: DATA_DIR, orders }).results;
}

/** Shipments reduced to warehouse + items, for compact assertions. */
function picks(result) {
    return result.shipments.map((s) => ({ warehouse: s.warehouse, items: s.items }));
}

function discountOf(items, code) {
    return priceOrder(
        { items: items.map(([sku, qty]) => ({ sku, qty })), promo: code },
        catalog,
        promotions,
    ).discountCents;
}

// --- basics (already working) ---

test("money: allocate keeps the total, formatUsd", () => {
    expectEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
    expectEqual(allocate(1000, [3, 0, 1]), [750, 0, 250]);
    expectEqual(formatUsd(123456), "$1,234.56");
    expectEqual(formatUsd(-2670), "-$26.70");
});

test("catalog: bundles expand into their components", () => {
    expectEqual(
        catalog.expand([
            { sku: "BND-DESK", qty: 2 },
            { sku: "MS-WL", qty: 1 },
        ]),
        [
            { sku: "STD-LAP", qty: 2, fromBundle: "BND-DESK" },
            { sku: "HUB-C7", qty: 2, fromBundle: "BND-DESK" },
            { sku: "MAT-XL", qty: 2, fromBundle: "BND-DESK" },
            { sku: "MS-WL", qty: 1, fromBundle: null },
        ],
    );
    expectEqual(catalog.weightOf(catalog.expand([{ sku: "BND-STREAM", qty: 1 }])), 720);
});

test("pricing: existing promo types", () => {
    expectEqual(
        discountOf(
            [
                ["HS-PRO", 1],
                ["SPK-MINI", 1],
            ],
            "WELCOME10",
        ),
        1340,
    );
    expectEqual(discountOf([["MS-WL", 1]], "WELCOME10"), 0);
    expectEqual(
        discountOf(
            [
                ["LMP-LED", 1],
                ["STD-LAP", 1],
                ["MAT-XL", 1],
            ],
            "SAVE15",
        ),
        1500,
    );
    expectEqual(discountOf([["LMP-LED", 1]], "SAVE15"), 0);
    expectEqual(
        discountOf(
            [
                ["STD-LAP", 1],
                ["LMP-LED", 1],
                ["STK-NOTE", 2],
            ],
            "DESKWEEK",
        ),
        2240,
    );
    expectEqual(discountOf([["BND-DESK", 1]], "DESKWEEK"), 0);
});

test("shipping: carrier rates and transit days", () => {
    expectEqual(parcelCost("EAST", "west", 1200, "standard"), 1539);
    expectEqual(parcelCost("EAST", "west", 1200, "express"), 3078);
    expectEqual(parcelCost("WEST", "west", 100, "standard"), 719);
    expectEqual(transitDays("EAST", "west", "standard"), 5);
    expectEqual(transitDays("EAST", "west", "express"), 3);
    expectEqual(transitDays("WEST", "west", "express"), 1);
});

test("dates: weekends are skipped, 17:00 UTC cutoff", () => {
    expectEqual(toISODate(addBusinessDays(parseDate("2026-11-13"), 1)), "2026-11-16");
    expectEqual(toISODate(addBusinessDays(parseDate("2026-11-16"), 0)), "2026-11-16");
    expectEqual(toISODate(processingDay("2026-11-17T16:59:00Z")), "2026-11-17");
    expectEqual(toISODate(processingDay("2026-11-17T17:00:00Z")), "2026-11-18");
    expectEqual(toISODate(processingDay("2026-11-21T10:00:00Z")), "2026-11-23");
});

test("orders with problems are rejected", () => {
    const results = run(
        order([["NOPE", 1]]),
        order([["MS-WL", 0]]),
        order([["MS-WL", 1]], { promo: "FREESTUFF" }),
        order([["MS-WL", 1]], { shipTo: { region: "mars" } }),
    );
    expectEqual(
        results.map((r) => r.problems),
        [
            ["unknown sku NOPE"],
            ["invalid quantity 0 for MS-WL"],
            ['unknown promo code "FREESTUFF"'],
            ['unknown region "mars"'],
        ],
    );
});

// --- FUL-101: holidays ---

test("[FUL-101] business days skip Thanksgiving closures", () => {
    expectEqual(toISODate(addBusinessDays(parseDate("2026-11-25"), 1)), "2026-11-30");
    expectEqual(toISODate(addBusinessDays(parseDate("2026-11-24"), 2)), "2026-11-30");
});

test("[FUL-101] business days skip Christmas closures", () => {
    expectEqual(toISODate(addBusinessDays(parseDate("2026-12-23"), 2)), "2026-12-29");
    expectEqual(toISODate(addBusinessDays(parseDate("2026-12-31"), 1)), "2027-01-04");
});

test("[FUL-101] order on the Wednesday before Thanksgiving", () => {
    const [r] = run(order([["KB-MECH", 1]], { placedAt: "2026-11-25T10:00:00Z" }));
    expectEqual(
        r.shipments.map((s) => [s.shipDate, s.deliveryDate]),
        [["2026-11-30", "2026-12-02"]],
    );
});

test("[FUL-101] order placed on Thanksgiving", () => {
    const [r] = run(order([["KB-MECH", 1]], { placedAt: "2026-11-26T09:00:00Z" }));
    expectEqual(
        r.shipments.map((s) => [s.shipDate, s.deliveryDate]),
        [["2026-12-01", "2026-12-03"]],
    );
});

// --- FUL-102: overselling ---

test("[FUL-102] bundle hub and extra hub do not both come from EAST", () => {
    const [r] = run(
        order([
            ["BND-DESK", 1],
            ["HUB-C7", 1],
        ]),
    );
    expectEqual(r.status, "ready");
    expectEqual(picks(r), [
        {
            warehouse: "EAST",
            items: [
                { sku: "STD-LAP", qty: 1 },
                { sku: "HUB-C7", qty: 1 },
                { sku: "MAT-XL", qty: 1 },
            ],
        },
        { warehouse: "WEST", items: [{ sku: "HUB-C7", qty: 1 }] },
    ]);
});

test("[FUL-102] repeated lines of the same sku", () => {
    const [r] = run(
        order([
            ["MS-WL", 20],
            ["MS-WL", 10],
        ]),
    );
    expectEqual(picks(r), [
        { warehouse: "EAST", items: [{ sku: "MS-WL", qty: 20 }] },
        { warehouse: "WEST", items: [{ sku: "MS-WL", qty: 10 }] },
    ]);
});

test("[FUL-102] a line that no warehouse can still cover is backordered", () => {
    const [r] = run(
        order([
            ["ARM-MON", 2],
            ["ARM-MON", 5],
            ["ARM-MON", 1],
        ]),
    );
    expectEqual(r.status, "partial");
    expectEqual(picks(r), [
        { warehouse: "EAST", items: [{ sku: "ARM-MON", qty: 2 }] },
        { warehouse: "WEST", items: [{ sku: "ARM-MON", qty: 5 }] },
    ]);
    expectEqual(r.backordered, [{ sku: "ARM-MON", qty: 1 }]);
});

test("[FUL-102] stock never goes negative in the nightly run", () => {
    const { stock } = runNightly({ dataDir: DATA_DIR });
    const negative = [];
    for (const [warehouse, skus] of Object.entries(stock)) {
        for (const [sku, level] of Object.entries(skus)) {
            if (level < 0) negative.push(`${warehouse} ${sku} ${level}`);
        }
    }
    expectEqual(negative, []);
});

// --- FUL-103: free shipping threshold ---

test("[FUL-103] free shipping threshold is $50", () => {
    expectEqual(qualifiesForFreeShipping(4999, "standard"), false);
    expectEqual(qualifiesForFreeShipping(5000, "standard"), true);
    expectEqual(qualifiesForFreeShipping(50000, "express"), false);
});

test("[FUL-103] small orders pay for shipping", () => {
    const [r] = run(
        order(
            [
                ["STK-NOTE", 3],
                ["CBL-C2", 1],
            ],
            { shipTo: { region: "central" } },
        ),
    );
    expectEqual(r.totals, {
        subtotalCents: 2400,
        discountCents: 0,
        shippingCents: 949,
        totalCents: 3349,
    });
});

test("[FUL-103] threshold applies after discounts", () => {
    const [below, above] = run(
        order(
            [
                ["BK-REFAC", 1],
                ["STK-NOTE", 5],
            ],
            { promo: "WELCOME10" },
        ),
        order(
            [
                ["BK-REFAC", 1],
                ["STK-NOTE", 6],
            ],
            { promo: "WELCOME10" },
        ),
    );
    expectEqual([below.totals.shippingCents, above.totals.shippingCents], [839, 0]);
});

// --- FUL-104: PAIRUP / bogo ---

test("[FUL-104] ticket example", () => {
    expectEqual(
        discountOf(
            [
                ["KB-MECH", 1],
                ["MS-WL", 2],
                ["WEB-4K", 1],
            ],
            "PAIRUP",
        ),
        4900,
    );
});

test("[FUL-104] units, not lines; odd unit pays full price", () => {
    expectEqual(discountOf([["MS-WL", 3]], "PAIRUP"), 1450);
    expectEqual(discountOf([["KB-MECH", 2]], "PAIRUP"), 4450);
    expectEqual(discountOf([["KB-MECH", 1]], "PAIRUP"), 0);
});

test("[FUL-104] bundles and other categories never count", () => {
    expectEqual(
        discountOf(
            [
                ["BND-STREAM", 1],
                ["MS-WL", 1],
            ],
            "PAIRUP",
        ),
        0,
    );
    expectEqual(
        discountOf(
            [
                ["HS-PRO", 1],
                ["SPK-MINI", 1],
            ],
            "PAIRUP",
        ),
        0,
    );
    expectEqual(
        discountOf(
            [
                ["HS-PRO", 1],
                ["MS-WL", 2],
            ],
            "PAIRUP",
        ),
        1450,
    );
});

test("[FUL-104] bogo works for any category and percent", () => {
    const promo = { code: "BOOKS", type: "bogo", category: "books", percent: 100 };
    const priced = priceLines(
        [
            { sku: "BK-REFAC", qty: 3 },
            { sku: "BK-ALGO", qty: 1 },
        ],
        catalog,
    );
    expectEqual(discountFor(promo, priced, 13700), 6400);
});

// --- the whole nightly run (data/orders.json) ---

test("nightly run: order statuses", () => {
    const { results } = runNightly({ dataDir: DATA_DIR });
    expectEqual(
        Object.fromEntries(
            ["ready", "partial", "backordered", "rejected"].map((s) => [
                s,
                results.filter((r) => r.status === s).map((r) => r.orderId),
            ]),
        ),
        {
            ready: [
                "o-1001",
                "o-1002",
                "o-1003",
                "o-1004",
                "o-1005",
                "o-1006",
                "o-1008",
                "o-1010",
                "o-1011",
                "o-1012",
                "o-1013",
                "o-1014",
                "o-1015",
                "o-1016",
                "o-1018",
                "o-1019",
                "o-1021",
                "o-1022",
                "o-1024",
            ],
            partial: ["o-1020"],
            backordered: ["o-1009"],
            rejected: ["o-1007", "o-1017", "o-1023"],
        },
    );
});

test("nightly run: report", () => {
    expectText(
        runNightly({ dataDir: DATA_DIR }).report,
        [
            "Nightly fulfillment run 2026-11-25",
            "Orders: 24 (ready 19, partial 1, backordered 1, rejected 3)",
            "",
            "Revenue (accepted orders)",
            "  Subtotal     $4,625.00",
            "  Discounts     -$266.70",
            "  Shipping       $120.22",
            "  Total        $4,478.52",
            "",
            "Parcels by warehouse",
            "  EAST   15 parcels   44 units   39.8 kg     $96.24 shipping",
            "  WEST   11 parcels   31 units   22.2 kg     $23.98 shipping",
            "",
            "Expected deliveries",
            "  2026-12-01    2",
            "  2026-12-02   10",
            "  2026-12-03    8",
            "  2026-12-07    4",
            "  2026-12-08    2",
            "",
            "Backordered: 12 units (ARM-MON x9, LMP-LED x3)",
            "Low stock (<= 1 left): EAST ARM-MON 1, EAST HUB-C7 0, EAST MON-27 0, EAST STD-LAP 1, WEST HS-PRO 1, WEST HUB-C7 0, WEST KB-MECH 0, WEST LMP-LED 0, WEST SPK-MINI 0, WEST WEB-4K 0",
            "",
            "Rejected",
            "  o-1007  unknown sku FAKE-SKU",
            "  o-1017  invalid quantity 0 for KB-MECH",
            '  o-1023  unknown promo code "BOGUS"',
        ].join("\n"),
    );
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
