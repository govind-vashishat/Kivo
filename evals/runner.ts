import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";
import { loadCatalog, type Price } from "../src/agent/catalog";
import { type CompactSettings, compactSettings } from "../src/agent/compaction";
import { costOf } from "../src/agent/cost";
import type { AgentEventListener } from "../src/agent/events";
import { runAgent, type TurnUsage } from "../src/agent/loop";
import { loadModelSettings, type Model, type ModelSettings } from "../src/agent/models";
import { describeError, renderEvent } from "../src/cli/render";

const SANDBOX_DIR = path.resolve(import.meta.dir, "sandboxes");
const HISTORY_FILE = path.resolve(import.meta.dir, "eval_history.json");

interface TaskManifest {
    id: string;
    prompt: string;
    verifyCommand: string;
    maxSteps: number;
}

type Status = "pass" | "fail" | "error";

interface EvalRecord {
    timestamp: string;
    taskId: string;
    model: string;
    reasoning: string;
    gitCommit: string;
    status: Status;
    error?: string;
    steps: number;
    stopReason: string;
    durationMs: number;
    peakInputTokens: number;
    totalInputTokens: number;
    totalCachedInputTokens: number;
    totalCacheWriteTokens: number;
    totalOutputTokens: number;
    editCalls: number;
    failedEdits: number;
    costUsd: number | null;
    compaction: string;
    compactions: number;
}

interface Setup {
    settings: ModelSettings;
    price?: Price;
    gitCommit: string;
}

interface RunStats {
    usage: TurnUsage[];
    editCalls: number;
    failedEdits: number;
    compactions: number;
}

function trackRun(forward?: AgentEventListener) {
    const stats: RunStats = { usage: [], editCalls: 0, failedEdits: 0, compactions: 0 };
    const editIds = new Set<string>();

    const onEvent: AgentEventListener = (event) => {
        forward?.(event);
        switch (event.type) {
            case "usage": {
                const { type, step, ...turn } = event;
                stats.usage.push(turn);
                break;
            }
            case "tool_start":
                if (event.name === "edit_file") {
                    stats.editCalls += 1;
                    editIds.add(event.id);
                }
                break;
            case "tool_result":
                if (event.isError && editIds.has(event.id)) stats.failedEdits += 1;
                break;
            case "compaction":
                stats.compactions += 1;
                break;
        }
    };

    return { stats, onEvent };
}

async function runOneTask(sandboxName: string, setup: Setup): Promise<EvalRecord> {
    const sourceDir = path.join(SANDBOX_DIR, sandboxName);
    const manifest: TaskManifest = JSON.parse(
        await readFile(path.join(sourceDir, "task.json"), "utf-8"),
    );

    const workDir = await mkdtemp(path.join(tmpdir(), `kivo-eval-${manifest.id}-`));
    await cp(sourceDir, workDir, { recursive: true });

    const start = Date.now();
    const { stats, onEvent } = trackRun(process.env.DEBUG ? renderEvent : undefined);

    let stopReason = "error";
    let error: string | undefined;
    try {
        const result = await runAgent({
            task: manifest.prompt,
            cwd: workDir,
            maxSteps: manifest.maxSteps,
            modelSettings: setup.settings,
            onEvent,
        });
        stopReason = result.stopReason;
    } catch (err) {
        error = describeError(err, setup.settings.model);
    }

    let status: Status = "error";
    if (error === undefined) {
        await cp(path.join(sourceDir, "test.js"), path.join(workDir, "test.js"));
        const res = await $`${{ raw: manifest.verifyCommand }}`.cwd(workDir).nothrow().quiet();
        status = res.exitCode === 0 ? "pass" : "fail";
    }

    await rm(workDir, { recursive: true, force: true });

    const { usage } = stats;
    return {
        timestamp: new Date().toISOString(),
        taskId: manifest.id,
        model: setup.settings.model.name,
        reasoning: setup.settings.reasoning,
        gitCommit: setup.gitCommit,
        status,
        error,
        steps: usage.length,
        stopReason,
        durationMs: Date.now() - start,
        peakInputTokens: Math.max(0, ...usage.map((u) => u.inputTokens)),
        totalInputTokens: sum(usage.map((u) => u.inputTokens)),
        totalCachedInputTokens: sum(usage.map((u) => u.cachedInputTokens)),
        totalCacheWriteTokens: sum(usage.map((u) => u.cacheWriteTokens)),
        totalOutputTokens: sum(usage.map((u) => u.outputTokens)),
        editCalls: stats.editCalls,
        failedEdits: stats.failedEdits,
        costUsd: setup.price ? costOf(usage, setup.price) : null,
        compaction: describeCompaction(compactSettings()),
        compactions: stats.compactions,
    };
}

async function findPrice(model: Model): Promise<Price | undefined> {
    try {
        const catalog = await loadCatalog();
        const price = catalog.find((entry) => entry.model.name === model.name)?.price;
        if (!price) console.warn(`No price for ${model.name} on models.dev, cost will show n/a`);
        return price;
    } catch (err) {
        console.warn(`Couldn't load prices from models.dev (${describeError(err)}), cost n/a`);
        return undefined;
    }
}

function describeCompaction(settings: CompactSettings): string {
    if (settings.mode === "off") return "off";
    return `clear@${settings.clearAt} keep${settings.keepTokens}`;
}

function sum(values: number[]) {
    return values.reduce((total, v) => total + v, 0);
}

const tokens = (n: number) => String(Math.round(n));
const dollars = (n: number) => `$${n.toFixed(4)}`;
const oneDecimal = (n: number) => n.toFixed(1);

// "mean (min–max)", the shape every summary number is printed in.
function spread(values: number[], format: (n: number) => string): string {
    const mean = sum(values) / values.length;
    return `${format(mean)} (${format(Math.min(...values))}–${format(Math.max(...values))})`;
}

function describeRun(r: EvalRecord): string {
    const cost = r.costUsd === null ? "cost n/a" : dollars(r.costUsd);
    if (r.status === "error") {
        return `ERROR  ${r.error} (after ${r.steps} steps, ${cost})`;
    }
    return `${r.status.toUpperCase()}  (${r.steps} steps, peak ${r.peakInputTokens} tok, total ${r.totalInputTokens} tok, out ${r.totalOutputTokens}, cached ${r.totalCachedInputTokens}, failed edits ${r.failedEdits}/${r.editCalls}, ${cost}) compactions ${r.compactions}`;
}

function summarize(results: EvalRecord[]): string {
    const done = results.filter((r) => r.status !== "error");
    const errors = results.length - done.length;
    const errorNote = errors > 0 ? `, ${errors} error${errors > 1 ? "s" : ""} not counted` : "";
    if (done.length === 0) return `  => no finished runs${errorNote}`;

    const passed = done.filter((r) => r.status === "pass").length;
    const costs = done.flatMap((r) => (r.costUsd === null ? [] : [r.costUsd]));
    const parts = [
        `pass ${passed}/${done.length}${errorNote}`,
        `cost ${costs.length === done.length ? spread(costs, dollars) : "n/a"}`,
        `fresh ${spread(
            done.map((r) => r.totalInputTokens - r.totalCachedInputTokens),
            tokens,
        )}`,
        `out ${spread(
            done.map((r) => r.totalOutputTokens),
            tokens,
        )}`,
        `failed edits ${spread(
            done.map((r) => r.failedEdits),
            oneDecimal,
        )}`,
        `total ${spread(
            done.map((r) => r.totalInputTokens),
            tokens,
        )}`,
        `peak ${spread(
            done.map((r) => r.peakInputTokens),
            tokens,
        )}`,
    ];
    return `  => ${parts.join(", ")}`;
}

async function main() {
    const { values, positionals } = parseArgs({
        args: process.argv.slice(2),
        options: { runs: { type: "string", default: "1" } },
        allowPositionals: true,
    });

    const runs = Number(values.runs);
    const sandboxFilter = positionals[0];

    const entries = await readdir(SANDBOX_DIR, { withFileTypes: true });
    const sandboxes = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((name) => !sandboxFilter || name.includes(sandboxFilter))
        .sort();

    const settings = loadModelSettings();
    const setup: Setup = {
        settings,
        price: await findPrice(settings.model),
        gitCommit: (await $`git rev-parse --short HEAD`.nothrow().quiet().text()).trim(),
    };
    console.log(
        `Model: ${settings.model.name} (reasoning ${settings.reasoning}), commit ${setup.gitCommit}\n`,
    );

    const records: EvalRecord[] = [];
    for (const name of sandboxes) {
        const results: EvalRecord[] = [];
        for (let i = 1; i <= runs; i++) {
            process.stdout.write(`Running ${name} (${i}/${runs})... `);
            const record = await runOneTask(name, setup);
            console.log(describeRun(record));
            results.push(record);
        }
        records.push(...results);
        if (runs > 1) console.log(`${summarize(results)}\n`);
    }

    const done = records.filter((r) => r.status !== "error");
    const passed = done.filter((r) => r.status === "pass").length;
    const errors = records.length - done.length;
    const rate = done.length > 0 ? `${((passed / done.length) * 100).toFixed(0)}%` : "n/a";
    console.log(`\nAccuracy: ${passed}/${done.length} (${rate})`);
    if (errors > 0) console.log(`Errors: ${errors} (not counted in accuracy)`);

    const spent = setup.price ? dollars(sum(records.map((r) => r.costUsd ?? 0))) : "n/a";
    console.log(`Cost: ${spent} for ${records.length} runs`);

    let history: EvalRecord[] = [];
    try {
        history = JSON.parse(await readFile(HISTORY_FILE, "utf-8"));
    } catch {}
    await writeFile(HISTORY_FILE, JSON.stringify([...history, ...records], null, 2));
}

main().catch((err) => {
    console.error("runner crashed:", err);
    process.exit(1);
});
