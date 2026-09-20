#!/usr/bin/env bun

import { runAgent } from "../agent/loop";
import { describeError, fatal, renderEvent } from "./render";
import { startSession } from "./session";

const args = process.argv.slice(2);

const USAGE = `
 kivo — a terminal coding agent

 Usage:
   kivo                 start an interactive session
   kivo "<task>"        run a single task and exit
   kivo --help          show this

 Kivo reads and edits files in the directory you run it from,
 and can run shell commands there. Run it inside the project
 you want it to work on.

 Requires OPENAI_API_KEY in the environment (or a .env file
 in the folder you run it from).
`;

if(args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
}

if(!process.env.OPENAI_API_KEY) {
    fatal(
        "no OPENAI_API_KEY found.",
        `
 Set it for this shell:
   export OPENAI_API_KEY="sk-..."

 Make it permanent:
   echo 'export OPENAI_API_KEY="sk-..."' >> ~/.zshrc   # or ~/.bashrc

 Or create a .env file in the folder you run kivo from:
   OPENAI_API_KEY=sk-...
`
    );
}

const task = args.join(" ");

if (task) {
    try {
        await runAgent({
            task,
            cwd: process.cwd(),
            onEvent: renderEvent,
        })
    } catch (err) {
        fatal(describeError(err));
    }
} else {
    await startSession();
}