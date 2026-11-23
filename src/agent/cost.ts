import type { Price } from "./catalog";
import type { TurnUsage } from "./loop";

export function costOf(usage: TurnUsage[], price: Price) {
    let dollars = 0;
    for (const turn of usage) {
        const uncached = turn.inputTokens - turn.cachedInputTokens - turn.cacheWriteTokens;
        dollars +=
            uncached * price.input +
            turn.cachedInputTokens * (price.cacheRead ?? price.input) +
            turn.cacheWriteTokens * (price.cacheWrite ?? price.input) +
            turn.outputTokens * price.output;
    }
    return dollars / 1_000_000;
}
