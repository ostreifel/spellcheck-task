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
    readonly line: number;
    readonly column: number;
    readonly text: string;
}
interface IDetectedMisspelling {
    readonly start: number;
    readonly end: number;
}
function toMisspellings(detected: IDetectedMisspelling[], corpusText: string): IMisspelling[] {
    interface ILineBreaks extends Array<number> {}
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
                return {line: i + 2, column: pos - linePos};
            }
        }
        return { line: 1, column: pos + 1 };
    }
    const textLineBreaks = findLineBreaks(corpusText);
    tl.debug(`linebreaks ${JSON.stringify(textLineBreaks)}`);
    const misspellings: IMisspelling[] = [];
    for (const {start, end} of detected) {
        const {line, column} = posToLineColumn(textLineBreaks, start);
        misspellings.push(
            {line, column, text: corpusText.substr(start, end - start)},
        );
    }
    return misspellings;
}

// npm install --global --production windows-build-tools

function filterErrors(errors: IDetectedMisspelling[], corpusText: string): IDetectedMisspelling[] {

    interface ITextSection {
        start: number;
        end: number;
    }

    function findRegexMatches(text: string, search: string | null): ITextSection[] | null;
    function findRegexMatches(text: string, search: RegExp): ITextSection[];
    function findRegexMatches(text: string, search: RegExp | string | null): ITextSection[] | null {
        if (!search)  {
            return null;
        }
        const regex = search instanceof RegExp ? search : new RegExp(search, "g");
        const regexMatches: ITextSection[] = [];
        let match: RegExpExecArray | null;
        // tslint:disable-next-line:no-conditional-assignment
        while ((match = regex.exec(text)) !== null) {
            regexMatches.push({start: match.index, end: match.index + match[1].length});
        }
        return regexMatches;
    }
    function findTextToInclude(text: string): ITextSection[] | null {
        return findRegexMatches(
            text,
            tl.getInput("includeRegexString", false),
        );
    }

    function findTextToSkip(text: string): ITextSection[] {
        return findRegexMatches(
            text,
            /(https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b(?:[-a-zA-Z0-9@:%_\+.~#?&//=]*))/g,
        );
    }

    const skipTexts = findTextToSkip(corpusText);
    const includeTexts = findTextToInclude(corpusText);
    tl.debug(`Skip texts ${JSON.stringify(skipTexts)}`);
    tl.debug(`Include texts ${JSON.stringify(includeTexts)}`);
    tl.debug(`errors ${JSON.stringify(errors)}`);
    return errors.filter((e) => {
        for (const {start, end} of skipTexts) {
            if (e.start >= start && e.end - 1 <= end) {
                return false;
            }
        }
        if (!includeTexts) {
            return true;
        }
        for (const {start, end} of includeTexts) {
            if (e.start >= start && e.end - 1 <= end) {
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
function detectEncoding(b: Buffer): { encoding: string, confidence: number } {
    return jschardet.detect(b);
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
    function loadWhitelistedWords(): void {
        const wordsFile = tl.getPathInput("whitelistedWords");
        const stats = fs.lstatSync(wordsFile);
        if (!stats.isFile()) {
            return;
        }
        const blob = fs.readFileSync(wordsFile);
        const {encoding} = detectEncoding(blob);
        const words = fs.readFileSync(wordsFile, {encoding})
            .split(/\s*\r?\n/)
            .filter((a) => a);
        for (const word of words) {
            SpellChecker.add(word);
        }
    }
    try {
        loadWhitelistedWords();
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
