import * as fs from "fs";
import * as glob from "glob";
import * as Q from "q";
import tl = require("vsts-task-lib/task");
import jschardet = require("jschardet");
import SpellChecker = require("spellchecker");

// TODO create configuration for this
{
    SpellChecker.add("TODO");
    SpellChecker.add("readme");
    SpellChecker.add("Chakra");
}

interface IFileErrors {
    readonly filePath: string;
    readonly misspellings: IMisspelling[];
}
interface IMisspelling {
    readonly line: number;
    readonly column: number;
    readonly text: string;
}
interface IDetectedMisspelling {
    readonly start: number;
    readonly end: number;
}
interface ILineBreaks extends Array<number> {}

interface ITextSection {
    start: number;
    end: number;
}

function detectEncoding(buffer: Buffer): { encoding: string, confidence: number } {
    return jschardet.detect(buffer);
}

function findLineBreaks(text: string): ILineBreaks {
    const breaks: ILineBreaks = [];
    for (let i = 0; i < text.length; i++) {
        if (text.charAt(i) === "\n") {
            breaks.push(i);
        }
    }
    return breaks;
}

function posToLineColumn(linebreaks: ILineBreaks, pos: number): {line: number, column: number} {
    for (let i = linebreaks.length - 1; i >= 0; i--) {
        const linePos = linebreaks[i];
        if (linePos < pos) {
            return {line: i + 1, column: pos - linePos + 1};
        }
    }
    return { line: 1, column: pos + 1 };
}

function toMisspellings(detected: IDetectedMisspelling[], corpusText: string): IMisspelling[] {
    const linebreaks = findLineBreaks(corpusText);
    const misspellings: IMisspelling[] = [];
    for (const {start, end} of detected) {
        const {line, column} = posToLineColumn(linebreaks, start);
        misspellings.push(
            {line, column, text: corpusText.substr(start, end - start)},
        );
    }
    return misspellings;
}

// npm install --global --production windows-build-tools

function filterErrors(errors: IDetectedMisspelling[], corpusText: string): IDetectedMisspelling[] {
    const skipTexts = findTextToSkip(corpusText);
    const includeTexts = findTextToInclude(corpusText);
    return errors.filter((e) => {
        for (const {start, end} of skipTexts) {
            if (e.start >= start && e.end <= end) {
                return false;
            }
        }
        if (!includeTexts) {
            return true;
        }
        for (const {start, end} of includeTexts) {
            if (e.start >= start && e.end <= end) {
                return true;
            }
        }

        return false;
    });
}

// TODO this requires windows
function spellcheck(corpusText: string): IMisspelling[] {

    const errors: IDetectedMisspelling[] = SpellChecker.checkSpelling(corpusText);
    const filteredErrors = filterErrors(errors, corpusText);
    const misspellings = toMisspellings(filteredErrors, corpusText);
    return misspellings;
}

function findTextToInclude(text: string): ITextSection[] | null {
    const includeRegexString: string = tl.getInput("includeRegexString", false);
    if (!includeRegexString) {
        return null;
    }
    const includeTexts: ITextSection[] = [];
    const regex = new RegExp(includeRegexString, "g");
    let match: RegExpExecArray | null;
    // tslint:disable-next-line:no-conditional-assignment
    while ((match = regex.exec(text)) !== null) {
        includeTexts.push({start: match.index, end: match.index + match[0].length});
    }
    return includeTexts;
}

function findTextToSkip(text: string): ITextSection[] {
    // TODO use library here
    const skipTexts: ITextSection[] = [];
    const regex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/g;
    let match: RegExpExecArray | null;
    // tslint:disable-next-line:no-conditional-assignment
    while ((match = regex.exec(text)) !== null) {
        skipTexts.push({start: match.index, end: match.index + match[0].length});
    }
    return skipTexts;
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

        const files = glob.sync(fileGlob);

        Q.all(files.map((f) => checkFile(f))).then(processErrors);
    } catch (err) {
        console.log("err", err);
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

run();
