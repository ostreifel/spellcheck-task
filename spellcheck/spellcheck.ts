import tl = require("vsts-task-lib/task");
// npm install vsts-task-lib

// get task parameters
const variable1: string = tl.getPathInput("files", false, true);
const variable2: string = tl.getInput("variable2", true);

async function run(): Promise<void> {
    try {
        // do your actions
        tl.debug("variable1:" + variable1);
        tl.debug("variable2:" + variable2);

    } catch (err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

run();
