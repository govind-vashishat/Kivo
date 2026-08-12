//Tool schemas -
export const toolDefinitions = [
    {
        type: "function" as const,
        name: "read_file",
        description: "Read the full contents of a file at the given path.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Relative or absolute file path" },
            },
            required: ["path"],
        },
    },
    {
        type: "function" as const,
        name: "write_file",
        description:
          "Create a file or overwrite it entirely. Use for new files; prefer edit_file for existing ones.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string" },
                content: { type: "string" }
            },
            required: ["path", "content"],
        },
    },
    {
        type: "function" as const,
        name: "edit_file",
        description: 
          "Replace an exact snippet in an existing file. old_text must appear exactly once. Cheaper and safer than rewriting the whole file.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string" },
                old_text: { type: "string" },
                new_text: { type: "string" },
            },
            required: ["path", "old_text", "new_text"],
        },
    },
    {
        type: "function" as const,
        name: "run_bash",
        description: 
          "Run a shell command in the working directory (e.g. to run tests). Returns stdout, stderr, and exit code.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string" },
            },
            required: ["command"],
        },
    },
];

export type ToolName = "read_file" | "write_file" | "edit_file" | "run_bash";