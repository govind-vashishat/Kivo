/**
 * Stage 3: enrich.
 *
 * Adds what the rest of the pipeline needs but the raw events don't carry:
 *
 * - the user's plan and country, looked up in data/users.json
 * - the amount converted to USD cents, so revenue can be summed across currencies
 *
 * Unknown users are kept (plan "unknown") so revenue is never silently lost.
 */

const { CURRENCY_DECIMALS } = require("./normalize");

// USD per one major unit of each currency. Finance fixes these at the start
// of each month; these are the October 2026 rates.
const USD_RATES = {
    USD: 1,
    EUR: 1.08,
    INR: 0.012,
    JPY: 0.0067,
};

/**
 * @param {number} amountMinor  integer minor units of `currency`
 * @param {string} currency
 * @returns {number} integer US cents
 */
function toUsdCents(amountMinor, currency) {
    const major = amountMinor / 10 ** CURRENCY_DECIMALS[currency];
    return Math.round(major * USD_RATES[currency] * 100);
}

/**
 * @param {object[]} users  [{ id, plan, country }]
 * @returns {Map<string, { plan: string, country: string }>}
 */
function indexUsers(users) {
    const byId = new Map();
    for (const user of users) {
        byId.set(user.id.toLowerCase(), { plan: user.plan, country: user.country });
    }
    return byId;
}

/**
 * @param {object[]} events  output of normalize
 * @param {object[]} users
 * @returns {object[]} events with { plan, country, usdCents }
 */
function enrich(events, users) {
    const byId = indexUsers(users);

    return events.map((event) => {
        const profile = byId.get(event.user) || { plan: "unknown", country: "??" };
        const usdCents = event.currency ? toUsdCents(event.amountMinor, event.currency) : 0;
        return { ...event, plan: profile.plan, country: profile.country, usdCents };
    });
}

module.exports = { USD_RATES, enrich, toUsdCents };
