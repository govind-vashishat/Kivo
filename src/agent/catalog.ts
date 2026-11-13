import z from "zod";
import { findModel, type Model, providerNames } from "./models";

const CATALOG_URL = "https://models.dev/api.json";

export interface CatalogModel {
    model: Model;
    title: string;
    contextWindow?: number;
    price?: Price;
    deprecated: boolean;
}

export interface Price {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
}

const Entry = z.object({
    id: z.string(),
    name: z.string(),
    tool_call: z.boolean().optional(),
    release_date: z.string().optional(),
    status: z.string().optional(),
    cost: z
        .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
        })
        .optional(),
    limit: z.object({ context: z.number() }).optional(),
});

const ProviderEntry = z.object({ models: z.record(z.string(), z.unknown()) });

export async function loadCatalog(): Promise<CatalogModel[]> {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`models.dev answered ${res.status}`);
    // .parse() would throw zod's multi-line JSON; prettifyError gives one readable line
    const parsed = z.record(z.string(), z.unknown()).safeParse(await res.json());
    if (!parsed.success) {
        throw new Error(`unexpected data from models.dev: ${z.prettifyError(parsed.error)}`);
    }
    const data = parsed.data;

    return providerNames.flatMap((provider) => {
        const entry = ProviderEntry.safeParse(data[provider]);
        if (!entry.success) return [];

        const entries = Object.values(entry.data.models)
            .map((m) => Entry.safeParse(m))
            .flatMap((r) => (r.success && r.data.tool_call ? [r.data] : []))
            .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""));

        return entries.map(
            (m): CatalogModel => ({
                model: findModel(`${provider}/${m.id}`),
                title: m.name,
                contextWindow: m.limit?.context,
                price: m.cost && {
                    input: m.cost.input,
                    output: m.cost.output,
                    cacheRead: m.cost.cache_read,
                    cacheWrite: m.cost.cache_write,
                },
                deprecated: m.status === "deprecated",
            }),
        );
    });
}
