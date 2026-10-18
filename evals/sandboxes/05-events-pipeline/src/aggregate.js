/**
 * Stage 4: aggregate.
 *
 * Rolls enriched events up into the numbers finance looks at:
 *
 * - per UTC day: signups, purchases, refunds, net revenue, active users
 * - per plan: net revenue
 *
 * Net revenue = purchases minus refunds, in USD cents.
 * An "active" user is anyone with at least one event that day.
 */

/** @param {Date} date */
function utcDay(date) {
    return date.toISOString().slice(0, 10);
}

function emptyDay(date) {
    return { date, signups: 0, purchases: 0, refunds: 0, revenueCents: 0, activeUsers: new Set() };
}

/**
 * @param {object[]} events  output of enrich
 */
function aggregate(events) {
    const days = new Map();
    const byPlan = new Map();

    for (const event of events) {
        const date = utcDay(event.at);
        if (!days.has(date)) days.set(date, emptyDay(date));
        const day = days.get(date);

        day.activeUsers.add(event.user);

        let revenue = 0;
        if (event.type === "signup") {
            day.signups += 1;
        } else if (event.type === "purchase") {
            day.purchases += 1;
            revenue = event.usdCents;
        } else if (event.type === "refund") {
            day.refunds += 1;
            revenue = -event.usdCents;
        }

        day.revenueCents += revenue;
        if (revenue !== 0) {
            byPlan.set(event.plan, (byPlan.get(event.plan) || 0) + revenue);
        }
    }

    const dayList = [...days.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((day) => ({ ...day, activeUsers: day.activeUsers.size }));

    const planList = [...byPlan.entries()]
        .map(([plan, revenueCents]) => ({ plan, revenueCents }))
        .sort((a, b) => b.revenueCents - a.revenueCents || a.plan.localeCompare(b.plan));

    const totalCents = dayList.reduce((sum, day) => sum + day.revenueCents, 0);

    return { days: dayList, plans: planList, totalCents };
}

module.exports = { aggregate, utcDay };
