/**
 * Invoice builder.
 *
 * Turns an order ({ items, currency, region, coupon, ... }) into a fully
 * priced invoice. The pipeline is:
 *
 *   1. price each line in the invoice currency (converting from list price)
 *   2. apply line rules (category / bulk discounts)
 *   3. apply order rules (coupons), spread across lines by value
 *   4. compute tax per line on the discounted amount
 *   5. total everything up
 *
 * Every amount is an integer in minor units of the invoice currency.
 */

const { getCurrency, allocateByWeight, sumMinor, formatMoney } = require("./currency");
const { convert, DEFAULT_RATES } = require("./rates");
const { getProduct } = require("./catalog");
const { applyLineRules, couponRules, orderDiscount } = require("./discounts");
const { computeTax, getRegion, taxLabel, formatRate } = require("./tax");

const DEFAULT_TERMS_DAYS = 30;

/**
 * Validate an order and return a list of problems (empty when valid).
 * @param {object} order
 */
function validateOrder(order) {
    const problems = [];
    try {
        getCurrency(order.currency);
    } catch (err) {
        problems.push(err.message);
    }
    try {
        getRegion(order.region);
    } catch (err) {
        problems.push(err.message);
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
        problems.push("order has no items");
    } else {
        for (const item of order.items) {
            if (!Number.isInteger(item.qty) || item.qty <= 0) {
                problems.push(`item ${item.sku} has invalid quantity ${item.qty}`);
            }
        }
    }
    if (order.date && !/^\d{4}-\d{2}-\d{2}$/.test(order.date)) {
        problems.push(`order date must be YYYY-MM-DD, got ${order.date}`);
    }
    return problems;
}

/**
 * Price the raw lines of an order in the invoice currency.
 * @param {object[]} items
 * @param {string} currency
 * @param {object} table
 * @param {Map<string, object>} [index]
 */
function priceLines(items, currency, table, index) {
    return items.map((item) => {
        const product = index ? getProduct(item.sku, index) : getProduct(item.sku);
        const unitPrice = convert(product.price.amount, product.price.currency, currency, table);
        return {
            sku: product.sku,
            name: product.name,
            category: product.category,
            qty: item.qty,
            listPrice: { ...product.price },
            unitPrice,
            gross: unitPrice * item.qty,
        };
    });
}

/**
 * Due date for an invoice, `termsDays` after the issue date.
 * @param {string} issueDate YYYY-MM-DD
 * @param {number} termsDays
 */
function dueDate(issueDate, termsDays = DEFAULT_TERMS_DAYS) {
    const d = new Date(`${issueDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + termsDays);
    return d.toISOString().slice(0, 10);
}

/**
 * Invoice numbers look like INV-2026-000042.
 * @param {string} issueDate
 * @param {number} sequence
 */
function invoiceNumber(issueDate, sequence) {
    const year = issueDate.slice(0, 4);
    return `INV-${year}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Build a priced invoice from an order.
 * @param {object} order
 * @param {{ table?: object, index?: Map<string, object>, sequence?: number }} [options]
 */
function buildInvoice(order, options = {}) {
    const problems = validateOrder(order);
    if (problems.length > 0) {
        throw new Error(`invalid order: ${problems.join("; ")}`);
    }

    const table = options.table ?? DEFAULT_RATES;
    const currency = order.currency;
    const date = order.date ?? "2026-09-15";
    const notes = [];

    // 1. price lines
    const priced = priceLines(order.items, currency, table, options.index);

    // 2. line rules
    const discounted = applyLineRules(priced, order.lineRules ?? []);
    const afterLine = discounted.map((l) => l.gross - l.lineDiscount);
    const subtotalAfterLine = sumMinor(afterLine);

    // 3. order rules (coupon), allocated across lines so tax stays correct
    const coupon = couponRules(order.coupon, {
        subtotal: subtotalAfterLine,
        currency,
        date,
        table,
    });
    if (coupon.note) notes.push(coupon.note);
    const order_ = orderDiscount(subtotalAfterLine, coupon.rules, { currency, table });
    const shares = allocateByWeight(order_.amount, afterLine);

    const lines = discounted.map((line, i) => ({
        ...line,
        orderDiscount: shares[i],
        taxable: afterLine[i] - shares[i],
    }));

    // 4. tax
    const tax = computeTax(lines, order.region);
    lines.forEach((line, i) => {
        line.tax = tax.perLine[i].tax;
        line.taxBp = tax.perLine[i].bp;
    });

    // 5. totals
    const subtotal = sumMinor(lines.map((l) => l.gross));
    const lineDiscounts = sumMinor(lines.map((l) => l.lineDiscount));
    const discountTotal = lineDiscounts + order_.amount;
    const taxable = sumMinor(lines.map((l) => l.taxable));
    const total = tax.inclusive ? taxable : taxable + tax.total;

    return {
        number: invoiceNumber(date, options.sequence ?? 1),
        customer: order.customer ?? null,
        currency,
        region: order.region,
        issueDate: date,
        dueDate: dueDate(date, order.termsDays),
        lines,
        taxBreakdown: tax.breakdown,
        taxInclusive: tax.inclusive,
        totals: {
            subtotal,
            discount: discountTotal,
            tax: tax.total,
            total,
        },
        notes,
    };
}

/**
 * Render an invoice as plain text for emails and logs.
 * @param {object} invoice
 */
function renderInvoice(invoice) {
    const money = (m) => formatMoney(m, invoice.currency);
    const out = [];
    out.push(`${invoice.number}   issued ${invoice.issueDate}   due ${invoice.dueDate}`);
    if (invoice.customer) out.push(`Bill to: ${invoice.customer}`);
    out.push("");
    for (const line of invoice.lines) {
        out.push(`${line.qty} x ${line.name.padEnd(32)} ${money(line.gross).padStart(14)}`);
        if (line.lineDiscount > 0) {
            out.push(`    ${line.discountLabel.padEnd(34)} ${money(-line.lineDiscount).padStart(14)}`);
        }
    }
    out.push("");
    out.push(`${"Subtotal".padEnd(38)} ${money(invoice.totals.subtotal).padStart(14)}`);
    if (invoice.totals.discount > 0) {
        out.push(`${"Discounts".padEnd(38)} ${money(-invoice.totals.discount).padStart(14)}`);
    }
    const label = taxLabel(invoice.region);
    for (const bucket of invoice.taxBreakdown) {
        const suffix = invoice.taxInclusive ? " (included)" : "";
        const name = `${label} ${formatRate(bucket.bp)}${suffix}`;
        out.push(`${name.padEnd(38)} ${money(bucket.tax).padStart(14)}`);
    }
    out.push(`${"Total".padEnd(38)} ${money(invoice.totals.total).padStart(14)}`);
    for (const note of invoice.notes) {
        out.push(`note: ${note}`);
    }
    return out.join("\n");
}

/**
 * Compact one-line summary, used in lists and logs.
 * @param {object} invoice
 */
function summarize(invoice) {
    const count = invoice.lines.reduce((n, l) => n + l.qty, 0);
    return `${invoice.number} ${invoice.currency} ${formatMoney(invoice.totals.total, invoice.currency)} (${count} item${count === 1 ? "" : "s"})`;
}

module.exports = {
    validateOrder,
    priceLines,
    dueDate,
    invoiceNumber,
    buildInvoice,
    renderInvoice,
    summarize,
};
