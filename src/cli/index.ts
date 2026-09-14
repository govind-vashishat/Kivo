#!/usr/bin/env bun

import { runAgent } from "../agent/loop";
import { renderEvent } from "./render";
import { startSession } from "./session";

const task = process.argv.slice(2).join(" ");
if (task) {
    await runAgent({
        task,
        cwd: process.cwd(),
        onEvent: renderEvent,
    })
} else {
    await startSession();
}