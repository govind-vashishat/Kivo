#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { resolveModelSettings } from "../agent/models";
import { fatal } from "./render";
import { startUI } from "./ui/App";

const USAGE = `
 kivo — a terminal coding agent

  Usage:
   kivo                     start an interactive session
   kivo "<task>"            run a single task and exit

 Options:
   -m, --model <name>       model to use, as provider/model
                            (default openai/gpt-5, or KIVO_MODEL)
   -r, --reasoning <level>  reasoning effort: default, none, minimal,
                            low, medium, high, xhigh
                            (default: the provider's, or KIVO_REASONING)
   -y, --yes                don't ask before changes (auto-approve)
   -h, --help               show this

 In a session, /model and /reasoning switch these. /help lists
 all commands.
`;

function readArgs() {
    try {
        return parseArgs({
            args: process.argv.slice(2),
            allowPositionals: true,
            options: {
                help: { type: "boolean", short: "h" },
                yes: { type: "boolean", short: "y" },
                model: { type: "string", short: "m" },
                reasoning: { type: "string", short: "r" },
            },
        });
    } catch (err) {
        fatal((err as Error).message, "\n Run kivo --help to see the options.\n");
    }
}

const { values, positionals } = readArgs();

if (values.help) {
    console.log(USAGE);
    process.exit(0);
}

function readModelSettings() {
    try {
        resolveModelSettings({ model: values.model, reasoning: values.reasoning });
    } catch (err) {
        fatal((err as Error).message);
    }
}

const modelSettings = readModelSettings;

if (!process.env.OPENAI_API_KEY) {
    fatal(
        "no OPENAI_API_KEY found.",
        `
 Set it for this shell:
   export OPENAI_API_KEY="sk-..."

 Make it permanent:
   echo 'export OPENAI_API_KEY="sk-..."' >> ~/.zshrc   # or ~/.bashrc

 Or create a .env file in the folder you run kivo from:
   OPENAI_API_KEY=sk-...
`,
    );
}

const task = positionals.join(" ");

await startUI({ initialTask: task || undefined, autoApprove: values.yes, modelSettings });
