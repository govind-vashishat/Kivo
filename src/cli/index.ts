#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { missingKey, resolveModelSettings } from "../agent/models";
import { fatal } from "./render";
import { startUI } from "./ui/App";

const USAGE = `
 kivo — a terminal coding agent

  Usage:
   kivo                     start an interactive session
   kivo "<task>"            run a single task and exit

 Options:
   -m, --model <name>       model to use, as provider/model, e.g.
                            openai/gpt-5, anthropic/claude-sonnet-4-5,
                            google/gemini-2.5-pro
                            (default openai/gpt-5, or KIVO_MODEL)
   -r, --reasoning <level>  reasoning effort: default, none, minimal,
                            low, medium, high, xhigh
                            (default: the provider's, or KIVO_REASONING)
   -y, --yes                don't ask before changes (auto-approve)
   -h, --help               show this

 API keys (only the one for your model's provider is needed):
   openai      OPENAI_API_KEY
   anthropic   ANTHROPIC_API_KEY
   google      GOOGLE_GENERATIVE_AI_API_KEY

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
        return resolveModelSettings({ model: values.model, reasoning: values.reasoning });
    } catch (err) {
        fatal((err as Error).message);
    }
}

const modelSettings = readModelSettings();

const keyEnv = missingKey(modelSettings.model);

if (keyEnv) {
    fatal(
        `no ${keyEnv} found (needed for ${modelSettings.model}).`,
        `
    Set it for this shell:
      export ${keyEnv}="..."

    Make it permanent:
      echo 'export ${keyEnv}="..."' >> ~/.zshrc   # or ~/.bashrc

    Or create a .env file in the folder you run kivo from:
      ${keyEnv}=...
   `,
    );
}

const task = positionals.join(" ");

await startUI({ initialTask: task || undefined, autoApprove: values.yes, modelSettings });
