const path = require("node:path");
const { parseLine, parseLog } = require("./src/parse");
const { toUsdCents } = require("./src/enrich");
const { aggregate } = require("./src/aggregate");
const { formatUsd } = require("./src/report");
const { runOnFiles } = require("./src/pipeline");

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

// --- parse ---

test("parses timestamp and key=value fields", () => {
    const result = parseLine(
        "2026-10-01T09:12:00+05:30 id=e1 user=u_01 event=purchase amount=1.50 currency=USD",
    );
    expectEqual(result, {
        ok: true,
        record: {
            timestamp: "2026-10-01T09:12:00+05:30",
            id: "e1",
            user: "u_01",
            event: "purchase",
            amount: "1.50",
            currency: "USD",
        },
    });
});

test("skips comments and blank lines, rejects lines without a zone", () => {
    const text = [
        "# header",
        "",
        "2026-10-01T09:00:00Z id=e1 user=u_01 event=signup",
        "2026-10-01T09:00:00 id=e2 user=u_01 event=signup",
        "2026-10-01T09:00:00Z id=e3 event=signup",
    ].join("\n");
    const { records, rejected } = parseLog(text);
    expectEqual(records.length, 1);
    expectEqual(rejected, [
        { lineNo: 4, reason: 'bad timestamp "2026-10-01T09:00:00"' },
        { lineNo: 5, reason: "missing user" },
    ]);
});

// --- enrich ---

test("converts minor units to USD cents", () => {
    expectEqual(toUsdCents(2995, "EUR"), 3235);
    expectEqual(toUsdCents(149900, "INR"), 1799);
    expectEqual(toUsdCents(2980, "JPY"), 1997);
    expectEqual(toUsdCents(1999, "USD"), 1999);
});

// --- aggregate ---

test("aggregates by UTC day and plan, refunds reduce revenue", () => {
    const ev = (id, user, type, iso, usdCents, plan) => ({
        id,
        user,
        type,
        at: new Date(iso),
        usdCents,
        plan,
    });
    const metrics = aggregate([
        ev("a", "u1", "signup", "2026-10-01T10:00:00Z", 0, "free"),
        ev("b", "u1", "purchase", "2026-10-01T23:59:59Z", 1000, "free"),
        ev("c", "u2", "purchase", "2026-10-02T00:00:00Z", 2500, "pro"),
        ev("d", "u2", "refund", "2026-10-02T08:00:00Z", 500, "pro"),
    ]);
    expectEqual(metrics, {
        days: [
            {
                date: "2026-10-01",
                signups: 1,
                purchases: 1,
                refunds: 0,
                revenueCents: 1000,
                activeUsers: 1,
            },
            {
                date: "2026-10-02",
                signups: 0,
                purchases: 1,
                refunds: 1,
                revenueCents: 2000,
                activeUsers: 1,
            },
        ],
        plans: [
            { plan: "pro", revenueCents: 2000 },
            { plan: "free", revenueCents: 1000 },
        ],
        totalCents: 3000,
    });
});

// --- report ---

test("formats USD amounts", () => {
    expectEqual(formatUsd(0), "$0.00");
    expectEqual(formatUsd(5), "$0.05");
    expectEqual(formatUsd(123456), "$1,234.56");
    expectEqual(formatUsd(-1999), "-$19.99");
});

// --- full pipeline on the sample export (numbers signed off by finance) ---

const result = () =>
    runOnFiles(
        path.join(__dirname, "data", "events.log"),
        path.join(__dirname, "data", "users.json"),
    );

test("daily metrics match finance", () => {
    expectEqual(result().metrics.days, [
        {
            date: "2026-09-30",
            signups: 0,
            purchases: 1,
            refunds: 0,
            revenueCents: 1997,
            activeUsers: 1,
        },
        {
            date: "2026-10-01",
            signups: 3,
            purchases: 8,
            refunds: 1,
            revenueCents: 8401,
            activeUsers: 7,
        },
        {
            date: "2026-10-02",
            signups: 1,
            purchases: 8,
            refunds: 2,
            revenueCents: 15643,
            activeUsers: 8,
        },
        {
            date: "2026-10-03",
            signups: 1,
            purchases: 4,
            refunds: 1,
            revenueCents: 16141,
            activeUsers: 5,
        },
        {
            date: "2026-10-04",
            signups: 0,
            purchases: 1,
            refunds: 0,
            revenueCents: 115,
            activeUsers: 1,
        },
    ]);
});

test("revenue by plan matches finance", () => {
    expectEqual(result().metrics.plans, [
        { plan: "team", revenueCents: 23664 },
        { plan: "pro", revenueCents: 15512 },
        { plan: "free", revenueCents: 2306 },
        { plan: "unknown", revenueCents: 815 },
    ]);
});

test("total revenue matches finance", () => {
    expectEqual(result().metrics.totalCents, 42297);
});

test("skipped and duplicate counts", () => {
    expectEqual(result().counts, { skipped: 3, duplicates: 1 });
});

test("report text", () => {
    expectText(
        result().report,
        [
            "Daily metrics (UTC)",
            "date        signups  purchases  refunds     revenue  active",
            "2026-09-30        0          1        0      $19.97       1",
            "2026-10-01        3          8        1      $84.01       7",
            "2026-10-02        1          8        2     $156.43       8",
            "2026-10-03        1          4        1     $161.41       5",
            "2026-10-04        0          1        0       $1.15       1",
            "total                                       $422.97",
            "",
            "Revenue by plan",
            "team           $236.64",
            "pro            $155.12",
            "free            $23.06",
            "unknown          $8.15",
            "",
            "Skipped lines: 3, duplicates dropped: 1",
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
