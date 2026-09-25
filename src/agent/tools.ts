import { tool } from "ai";
import { $ } from "bun";
import { resolve } from "node:path";
import z from "zod";

//Tool schemas -
export const toolDefinitions = {
    read_file: tool({
        description: "Read the full contents of a file at the given path.",
        inputSchema: z.object({
            path: z.string().describe("Relative or absolute file path"),
        }),
    }),

    write_file: tool({
        description: "Create a file or overwrite it entirely. Use for new files; prefer edit_file for existing ones.",
        inputSchema: z.object({
            path: z.string(),
            content: z.string(),
        }),
    }),

    edit_file: tool({
        description: "Replace an exact snippet in an existing file. old_text must appear exactly once. Cheaper and safer than rewriting the whole file.",
        inputSchema: z.object({
            path: z.string(),
            old_text: z.string().describe("Exact text to replace, including whitespace and indentation. Must appear exactly once in the file."),
            new_text: z.string().describe("Text to replace it with"),
        }),
    }),

    run_bash: tool({
        description: "Run a shell command in the working directory (e.g. to run tests). Returns stdout, stderr, and exit code.",
        inputSchema: z.object({
            command: z.string().describe("Shell command to run, e.g. 'node test.js'"),
        }),
    }),
};

export type ToolName = keyof typeof toolDefinitions;

//Tool executor - 
export async function executeTool(
    name: ToolName,
    input: any,
    cwd: string
) {
    try {
        switch (name) {
            case "read_file": {
                const path = resolve(cwd, input.path);
                const content = await Bun.file(path).text();
                return { output: content, isError: false };
            }

            case "write_file": {
                const path = resolve(cwd, input.path);
                await Bun.write(path, input.content);
                return { output: `Wrote ${input.path}`, isError: false };
            }

            case "edit_file": {
                const path = resolve(cwd, input.path);
                const original = await Bun.file(path).text();

                const count = original.split(input.old_text).length - 1;
                if (count === 0)
                    return { output: `old_text not found in ${input.path}`, isError: true }
                if (count > 1)
                    return { output: `old_text matches ${count} times — must be unique. Add surrounding context.`, isError: true }

                const updated = original.replace(input.old_text, input.new_text);
                await Bun.write(path, updated);
                return { output: `Edited ${input.path}`, isError: false }
            }

            case "run_bash": {
                const result = await $`${{ raw: input.command }}`
                    .cwd(cwd)
                    .nothrow()
                    .quiet();

                const out = result.stdout.toString();
                const err = result.stderr.toString();
                const body = `stdout:\n${out}\nstderr:\n${err}\n(exit code ${result.exitCode})`;

                return { output: body, isError: result.exitCode !== 0 };
            }

            default: {
                return { output: `Unknown tool: ${name}`, isError: true };
            }
        };
    } catch (err: any) {
        return { output: String(err?.message ?? err), isError: true }
    }
};