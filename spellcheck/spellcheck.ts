import * as fs from "fs";
import * as glob from "glob";
import tl = require("vsts-task-lib/task");

// npm install vsts-task-lib

// get task parameters
const fileGlob: string = tl.getPathInput("files", false, true);
const variable2: string = tl.getInput("variable2", true);

async function run(): Promise<void> {
    try {
        // do your actions
        tl.debug("fileGlob:" + fileGlob);
        tl.debug("variable2:" + variable2);
        // glob.

    } catch (err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

run();
