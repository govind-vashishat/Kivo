import { Box, Text } from "ink";
import type { CatalogModel } from "../../agent/catalog";
import { theme } from "./theme";

// What the picker shows while models.dev hasn't answered, or after it failed
export type CatalogState = CatalogModel[] | "loading" | "failed";

const VISIBLE_ROWS = 8;

// Models whose name or title contains every word typed, e.g. "haiku 5" or "deepseek chat"
export function filterModels(models: CatalogModel[], query: string): CatalogModel[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return models.filter((m) => {
        const text = `${m.model.name} ${m.title}`.toLowerCase();
        return words.every((w) => text.includes(w));
    });
}

// Display only: the keys are handled by the single useInput in App.tsx
export function ModelPicker({
    catalog,
    matches,
    query,
    index,
    current,
}: {
    catalog: CatalogState;
    matches: CatalogModel[];
    query: string;
    index: number;
    current: string; // name of the active model
}) {
    // Keep the highlighted row in view: scroll so it sits in the middle when it can
    const start = Math.max(
        0,
        Math.min(index - Math.floor(VISIBLE_ROWS / 2), matches.length - VISIBLE_ROWS),
    );
    const shown = matches.slice(start, start + VISIBLE_ROWS);
    // Pad names and prices to the widest one shown, so the columns line up
    const nameWidth = Math.max(0, ...shown.map((m) => m.model.name.length));
    const priceWidth = Math.max(0, ...shown.map((m) => formatPrice(m).length));

    return (
        <Box flexDirection="column" marginTop={1}>
            <Text>
                <Text color={theme.foreground} bold>
                    Pick a model{"  "}
                </Text>
                <Text color={theme.faint}>
                    type to filter · ↑↓ move · enter select · esc cancel
                </Text>
            </Text>

            <Box marginY={1}>
                <Text color={theme.mint} bold>
                    ❯{" "}
                </Text>
                <Text color={theme.foreground}>{query}</Text>
                <Text backgroundColor={theme.mint}> </Text>
            </Box>

            {catalog === "loading" && (
                <Text color={theme.mute}>loading models from models.dev…</Text>
            )}
            {catalog === "failed" && (
                <Text color={theme.mute}>
                    couldn't load the list from models.dev, type a name and press enter
                </Text>
            )}
            {Array.isArray(catalog) && matches.length === 0 && (
                <Text color={theme.mute}>
                    {query ? "no match, press enter to use the name as typed" : "no models"}
                </Text>
            )}

            {shown.map((m, i) => (
                <Row
                    key={m.model.name}
                    entry={m}
                    nameWidth={nameWidth}
                    priceWidth={priceWidth}
                    selected={start + i === index}
                    active={m.model.name === current}
                />
            ))}

            {matches.length > 0 && (
                <Box marginTop={1}>
                    <Text color={theme.faint}>
                        {`${index + 1} of ${matches.length} · context window · $ per M tokens in / out`}
                    </Text>
                </Box>
            )}
        </Box>
    );
}

function Row({
    entry,
    nameWidth,
    priceWidth,
    selected,
    active,
}: {
    entry: CatalogModel;
    nameWidth: number;
    priceWidth: number;
    selected: boolean;
    active: boolean;
}) {
    const { keyEnv } = entry.model.provider;
    const noKey = !process.env[keyEnv];
    const tags = [active && "current", entry.deprecated && "deprecated", noKey && `no ${keyEnv}`]
        .filter(Boolean)
        .join(" · ");

    return (
        <Text>
            <Text color={theme.mint}>{selected ? "❯ " : "  "}</Text>
            <Text color={selected ? theme.foreground : noKey ? theme.faint : theme.strong}>
                {entry.model.name.padEnd(nameWidth)}
            </Text>
            <Text color={theme.mute}>
                {"  "}
                {formatTokens(entry.contextWindow).padStart(5)}
                {"  "}
                {formatPrice(entry).padEnd(priceWidth)}
            </Text>
            {tags && <Text color={theme.faint}>{`  ${tags}`}</Text>}
        </Text>
    );
}

// 400000 -> "400k", 1048576 -> "1.05M"
function formatTokens(n?: number): string {
    if (!n) return "?";
    if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
    return `${Math.round(n / 1000)}k`;
}

function formatPrice({ price }: CatalogModel): string {
    if (!price) return "";
    const usd = (n: number) => `$${Number(n.toFixed(3))}`;
    return `${usd(price.input)} / ${usd(price.output)}`;
}
