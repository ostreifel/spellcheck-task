import * as fs from "fs";
import * as glob from "glob";
import * as path from "path";
import tl = require("vsts-task-lib/task");

async function run(): Promise<void> {
    try {
        // get task parameters
        const fileGlob: string = tl.getInput("files", true);
        const includeRegexString: string = tl.getInput("includeRegexString", false);

        // do your actions
        console.log("fileGlob:" + fileGlob);
        console.log("includeRegexString:" + includeRegexString);
        tl.setResult(tl.TaskResult.Succeeded, "No spelling errors");

    } catch (err) {
        console.log("err", err);
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

run();
