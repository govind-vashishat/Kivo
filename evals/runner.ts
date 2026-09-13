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

    try {
        // No onEvent passed - agent runs silently 
        const result = await runAgent({
            task: manifest.prompt,
            cwd: workDir,
            maxSteps: manifest.maxSteps,
        });
        stopReason = result.stopReason;
        steps = result.steps;
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
    };
}