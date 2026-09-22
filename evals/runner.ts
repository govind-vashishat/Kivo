import { readdir, readFile, writeFile, cp, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { $ } from "bun";
import { runAgent } from "../src/agent/loop";

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
    pass: boolean;
    steps: number;
    stopReason: string;
    durationMs: number;
    peakInputTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
}

async function runOneTask(sandboxName: string): Promise<EvalRecord> {
    const sourceDir = path.join(SANDBOX_DIR, sandboxName);
    const manifest: TaskManifest = JSON.parse(
        await readFile(path.join(sourceDir, "task.json"), "utf-8")
    );

    const workDir = await mkdtemp(path.join(tmpdir(), `kivo-eval-${manifest.id}-`));
    await cp(sourceDir, workDir, { recursive: true });

    const start = Date.now();

    let stopReason = "error";
    let steps = 0;
    let peakInputTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
        // No onEvent passed - agent runs silently 
        const result = await runAgent({
            task: manifest.prompt,
            cwd: workDir,
            maxSteps: manifest.maxSteps,
        });

        stopReason = result.stopReason;
        steps = result.steps;

        peakInputTokens = Math.max(0, ...result.usage.map((u) => u.inputTokens));
        totalInputTokens = result.usage.reduce((sum, u) => sum + u.inputTokens, 0);
        totalOutputTokens = result.usage.reduce((sum, u) => sum + u.outputTokens, 0);

    } catch (err) {
        console.error(`  agent threw on ${manifest.id}:`, err);
    }

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
        pass,
        steps,
        stopReason,
        durationMs: Date.now() - start,
        peakInputTokens,
        totalInputTokens,
        totalOutputTokens,
    };
}

async function main() {
    const entries = await readdir(SANDBOX_DIR, { withFileTypes: true });
    const sandboxes = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

    const records: EvalRecord[] = [];
    for (const name of sandboxes) {
        process.stdout.write(`Running ${name}... `);
        const record = await runOneTask(name);
        console.log(
            `${record.pass ? "PASS" : "FAIL"}  (${record.steps} steps, ${record.stopReason}, ${record.durationMs}ms, peak ${record.peakInputTokens} tok, total ${record.totalInputTokens} tok)`
        );
        records.push(record);
    };

    const passed = records.filter((r) => r.pass).length;
    console.log(`\nAccuracy: ${passed}/${records.length} (${((passed / records.length) * 100).toFixed(0)}%)`);
    
     const suiteTokens = records.reduce((sum, r) => sum + r.totalInputTokens, 0);
     console.log(`Total input tokens: ${suiteTokens}`);

    let history: EvalRecord[] = [];
    try {
        history = JSON.parse(await readFile(HISTORY_FILE, "utf-8"));
    } catch {
        
    }
    await writeFile(HISTORY_FILE, JSON.stringify([...history, ...records], null, 2));
}

main().catch((err) => {
    console.error("runner crashed:", err);
    process.exit(1);
})