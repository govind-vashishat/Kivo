/**
 * Stage 5: report.
 *
 * Formats aggregated metrics as the plain-text report that gets emailed to
 * finance every morning.
 */

/** @param {number} cents  may be negative */
function formatUsd(cents) {
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    const dollars = Math.floor(abs / 100).toLocaleString("en-US");
    const rest = String(abs % 100).padStart(2, "0");
    return `${sign}$${dollars}.${rest}`;
}

function row(cells, widths) {
    return cells
        .map((cell, i) =>
            i === 0 ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i]),
        )
        .join("  ")
        .trimEnd();
}

/**
 * @param {ReturnType<import("./aggregate").aggregate>} metrics
 * @param {{ skipped: number, duplicates: number }} counts
 * @returns {string}
 */
function formatReport(metrics, counts) {
    const widths = [10, 7, 9, 7, 10, 6];
    const lines = [];

    lines.push("Daily metrics (UTC)");
    lines.push(row(["date", "signups", "purchases", "refunds", "revenue", "active"], widths));
    for (const day of metrics.days) {
        lines.push(
            row(
                [
                    day.date,
                    day.signups,
                    day.purchases,
                    day.refunds,
                    formatUsd(day.revenueCents),
                    day.activeUsers,
                ],
                widths,
            ),
        );
    }
    lines.push(row(["total", "", "", "", formatUsd(metrics.totalCents), ""], widths));

    lines.push("");
    lines.push("Revenue by plan");
    for (const { plan, revenueCents } of metrics.plans) {
        lines.push(row([plan, formatUsd(revenueCents)], [10, 10]));
    }

    lines.push("");
    lines.push(`Skipped lines: ${counts.skipped}, duplicates dropped: ${counts.duplicates}`);

    return lines.join("\n");
}

module.exports = { formatReport, formatUsd };
