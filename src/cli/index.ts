import { runAgent } from "../agent/loop";

const task = process.argv.slice(2).join(" ");
if(!task) {
    console.error('Usage: bun run agent -- "your task here"');
    process.exit(1);
};

console.log(`\nTask: ${task}\n${"-".repeat(50)}`);

const result = await runAgent({
    task,
    cwd: process.cwd(),
    onEvent: (e) => {
        switch (e.type) {
            case "text_delta":
                console.log(`\n${e.text}`);
                break;
            case "tool_start":
                console.log(`\n-> ${e.name}(${JSON.stringify(e.input).slice(0,120)})`);
                break;
            case "tool_result":
                console.log(
                    e.isError
                    ? `✗ ${e.output.slice(0, 200)}`
                    : `✓ ${e.output.slice(0, 200)}`
                );
                break;
            case "turn_end":
                console.log(`\n${"-".repeat(50)}\n[done: ${e.stopReason}]`);
                break;
            case "error":
                console.log(`${e.message}`);
                break;
        };
    },
});

console.log(`Steps: ${result.steps}`)