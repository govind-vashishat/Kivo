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
];