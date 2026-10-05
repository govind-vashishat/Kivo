import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";
import { runAgent } from "../src/agent/loop";
import { renderEvent } from "../src/cli/render";

const SANDBOX_DIR = path.resolve(import.meta.dir, "sandboxes");
const HISTORY_FILE = path.resolve(import.meta.dir, "eval_history.json");

interface TaskManifest {
    id: string;
    prompt: string;
    verifyCommand: string;
    maxSteps: number;
}

interface EvalRecord {
    timestamp: string;
    taskId: string;
    model: string;
    reasoning: string;
    gitCommit: string;
    pass: boolean;
    steps: number;
    stopReason: string;
    durationMs: number;
    peakInputTokens: number;
    totalInputTokens: number;
    totalCachedInputTokens: number;
    totalOutputTokens: number;
}

async function runOneTask(sandboxName: string, gitCommit: string): Promise<EvalRecord> {
    const sourceDir = path.join(SANDBOX_DIR, sandboxName);
    const manifest: TaskManifest = JSON.parse(
        await readFile(path.join(sourceDir, "task.json"), "utf-8"),
    );

    const workDir = await mkdtemp(path.join(tmpdir(), `kivo-eval-${manifest.id}-`));
    await cp(sourceDir, workDir, { recursive: true });

    const start = Date.now();

    let model = "unknown";
    let reasoning = "unknown";
    let stopReason = "error";
    let steps = 0;
    let peakInputTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedInputTokens = 0;

    try {
        const result = await runAgent({
            task: manifest.prompt,
            cwd: workDir,
            maxSteps: manifest.maxSteps,
            onEvent: process.env.DEBUG ? renderEvent : undefined,
        });

        model = result.model;
        reasoning = result.reasoning;
        stopReason = result.stopReason;
        steps = result.steps;
        peakInputTokens = Math.max(0, ...result.usage.map((u) => u.inputTokens));
        totalInputTokens = result.usage.reduce((sum, u) => sum + u.inputTokens, 0);
        totalOutputTokens = result.usage.reduce((sum, u) => sum + u.outputTokens, 0);
        totalCachedInputTokens = result.usage.reduce((sum, n) => sum + n.cachedInputTokens, 0);
    } catch (err) {
        console.error(`  agent threw on ${manifest.id}:`, err);
    }

    await cp(path.join(sourceDir, "test.js"), path.join(workDir, "test.js"));
    let pass = false;
    try {
        const res = await $`${{ raw: manifest.verifyCommand }}`.cwd(workDir).nothrow().quiet();
        pass = res.exitCode === 0;
    } catch {
        pass = false;
    }

    await rm(workDir, { recursive: true, force: true });

    return {
        timestamp: new Date().toISOString(),
        taskId: manifest.id,
        model,
        reasoning,
        gitCommit,
        pass,
        steps,
        stopReason,
        durationMs: Date.now() - start,
        peakInputTokens,
        totalInputTokens,
        totalCachedInputTokens,
        totalOutputTokens,
    };
}

function mean(values: number[]) {
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
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

    const gitCommit = (await $`git rev-parse --short HEAD`.nothrow().quiet().text()).trim();

    const records: EvalRecord[] = [];
    for (const name of sandboxes) {
        const results: EvalRecord[] = [];
        for (let i = 1; i <= runs; i++) {
            process.stdout.write(`Running ${name} (${i}/${runs})... `);
            const record = await runOneTask(name, gitCommit);
            console.log(
                `${record.pass ? "PASS" : "FAIL"}  (${record.steps} steps, peak ${record.peakInputTokens} tok, total ${record.totalInputTokens} tok, cached ${record.totalCachedInputTokens})`,
            );
            results.push(record);
        }
        records.push(...results);

        if (runs > 1) {
            const passed = results.filter((r) => r.pass).length;
            const totals = results.map((r) => r.totalInputTokens);
            const peaks = results.map((r) => r.peakInputTokens);
            console.log(
                `  => pass ${passed}/${runs}, total ${mean(totals)} (${Math.min(...totals)}–${Math.max(...totals)}), peak ${mean(peaks)} (${Math.min(...peaks)}–${Math.max(...peaks)})\n`,
            );
        }
    }

    const passed = records.filter((r) => r.pass).length;
    console.log(
        `\nAccuracy: ${passed}/${records.length} (${((passed / records.length) * 100).toFixed(0)}%)`,
    );

    const suiteTokens = records.reduce((sum, r) => sum + r.totalInputTokens, 0);
    console.log(`Total input tokens: ${suiteTokens}`);
    if (records[0]) {
        console.log(
            `Model: ${records[0].model} (reasoning ${records[0].reasoning}), commit ${gitCommit}`,
        );
    }

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
