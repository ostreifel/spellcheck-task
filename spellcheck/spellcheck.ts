import * as fs from "fs";
import * as glob from "glob";
import * as Q from "q";
import tl = require("vsts-task-lib/task");
import jschardet = require("jschardet");
import SpellChecker = require("spellchecker");

interface IFileErrors {
    readonly filePath: string;
    readonly misspellings: IMisspelling[];
}
interface IMisspelling {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}
interface IDetectedMisspelling {
    readonly start: number;
    readonly end: number;
}

function detectEncoding(buffer: Buffer): { encoding: string, confidence: number } {
    return jschardet.detect(buffer);
}

function toMisspelling({start, end}: IDetectedMisspelling, corpusText: string): IMisspelling {
    return {start, end, text: corpusText.substr(start, end - start)};
}

// npm install --global --production windows-build-tools

function spellcheck(corpusText: string): IMisspelling[] {
    const errors: IDetectedMisspelling[] = SpellChecker.checkSpelling(corpusText);
    return errors.map((e) => toMisspelling(e, corpusText));
}

async function checkFile(filePath: string): Promise<IFileErrors> {
    const buffer = fs.readFileSync(filePath);
    const {encoding} = detectEncoding(buffer);
    const fileText = fs.readFileSync(filePath, {encoding});
    tl.debug(`${filePath} encoding ${encoding}, ${fileText.length} bytes`);
    const misspellings = spellcheck(fileText);
    return {filePath, misspellings};
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
        for (const {start, end, text} of misspellings) {
            tl.error(`${start}:${end} Misspelling '${text}'`);
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
