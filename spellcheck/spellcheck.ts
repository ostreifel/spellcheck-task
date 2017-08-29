import * as fs from "fs";
import * as glob from "glob";
import * as Q from "q";
import tl = require("vsts-task-lib/task");
import jschardet = require("jschardet");

interface IFileErrors {
    readonly filePath: string;
    readonly misspellings: IMisspelling[];
}
interface IMisspelling {
    readonly line: string;
    readonly column: string;
    readonly text: string;
}

function detectEncoding(buffer: Buffer): { encoding: string, confidence: number } {
    return jschardet.detect(buffer);
}

async function checkFile(filePath: string): Promise<IFileErrors> {
    const buffer = fs.readFileSync(filePath);
    const {encoding} = detectEncoding(buffer);
    console.log(`${filePath} encoding ${encoding}`);
    const fileText = fs.readFileSync(filePath, {encoding});
    console.log(`filePath ${filePath}\n${fileText}`);
    return {filePath, misspellings: []};
}

async function processErrors(errors: IFileErrors[]): Promise<void> {
    let failed = tl.TaskResult.Succeeded;
    let errorCount = 0;
    for (const {filePath, misspellings} of errors) {
        if (misspellings.length === 0) {
            continue;
        }
        failed = tl.TaskResult.Failed;
        errorCount += misspellings.length;
        tl.error(`Misspellings in ${filePath}`);
        for (const {line, column, text} of misspellings) {
            tl.error(`${line}:${column} Misspelling '${text}'`);
        }
    }
    tl.setResult(failed, `${errorCount} misspellings detected`);
}

async function run(): Promise<void> {
    try {
        // get task parameters
        const fileGlob: string = tl.getInput("files", true);
        const includeRegexString: string = tl.getInput("includeRegexString", false);

        // do your actions
        console.log("fileGlob:" + fileGlob);
        console.log("includeRegexString:" + includeRegexString);
        tl.setResult(tl.TaskResult.Succeeded, "No spelling errors");
        const files = glob.sync(fileGlob);

        Q.all(files.map((f) => checkFile(f))).then(processErrors);
    } catch (err) {
        console.log("err", err);
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

run();
