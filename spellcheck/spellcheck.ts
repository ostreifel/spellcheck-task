import * as fs from "fs";
import * as glob from "glob";
import * as Q from "q";
import tl = require("vsts-task-lib/task");
import jschardet = require("jschardet");
import { getLanguagesForExt } from "cspell/dist/LanguageIds";
import { getDefaultSettings } from "cspell/dist/Settings/DefaultSettings";
import { combineTextAndLanguageSettings } from "cspell/dist/Settings/TextDocumentSettings";
import { validateText } from "cspell/dist/validator";
import * as path from "path";

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
    readonly text: string;
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
                return {line: i + 2, column: pos - linePos + 1};
            }
        }
        return { line: 1, column: pos + 1 };
    }
    const textLineBreaks = findLineBreaks(corpusText);
    tl.debug(`linebreaks ${JSON.stringify(textLineBreaks)}`);
    const misspellings: IMisspelling[] = [];
    for (const {start, text} of detected) {
        const {line, column} = posToLineColumn(textLineBreaks, start);
        misspellings.push(
            {line, column, text},
        );
    }
    return misspellings;
}

// npm install --global --production windows-build-tools

function filterErrors(errors: IDetectedMisspelling[], corpusText: string): IDetectedMisspelling[] {
    interface ITextSection {
        start: number;
        end: number;
        text: string;
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
            regexMatches.push({start: match.index, end: match.index + match[1].length, text: match[1]});
        }
        return regexMatches;
    }
    function findTextToInclude(text: string): ITextSection[] | null {
        return findRegexMatches(
            text,
            tl.getInput("includeRegexString", false),
        );
    }

    const includeTexts = findTextToInclude(corpusText);
    tl.debug(`Include texts ${JSON.stringify(includeTexts)}`);
    tl.debug(`errors ${JSON.stringify(errors)}`);
    return errors.filter((e) => {
        // for (const {start, end} of skipTexts) {
        //     if (e.start >= start && e.end - 1 <= end) {
        //         return false;
        //     }
        // }
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

async function spellcheck(corpusText: string, ext: string, userWords: string[]): Promise<IMisspelling[]> {
    function getSettings() {
        const settings = getDefaultSettings();
        if (!settings.userWords) {
            settings.userWords = [];
        }
        settings.userWords.push(...userWords);
        return combineTextAndLanguageSettings(settings, corpusText, getLanguagesForExt(ext));
    }
    const errors: IDetectedMisspelling[] = (await validateText(corpusText, getSettings())).map(
        ({offset, text}): IDetectedMisspelling => ({start: offset, end: offset + text.length, text}),
    );
    const filteredErrors = filterErrors(errors, corpusText);
    const misspellings = toMisspellings(filteredErrors, corpusText);
    return misspellings;
}
function detectEncoding(b: Buffer): { encoding: string, confidence: number } {
    return jschardet.detect(b);
}
async function checkFile(filePath: string, userWords: string[]): Promise<IFileErrors> {
    const buffer = fs.readFileSync(filePath);
    const {encoding} = detectEncoding(buffer);
    const fileText = fs.readFileSync(filePath, {encoding});
    tl.debug(`${filePath} encoding ${encoding}, ${fileText.length} bytes`);

    const misspellings = await spellcheck(fileText, path.extname(filePath), userWords);
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
    function loadWhitelistedWords(): string[] {
        const wordsFile = tl.getPathInput("whitelistedWords");
        const stats = fs.lstatSync(wordsFile);
        if (!stats.isFile()) {
            return [];
        }
        const blob = fs.readFileSync(wordsFile);
        const {encoding} = detectEncoding(blob);
        const words = fs.readFileSync(wordsFile, {encoding})
            .split(/\s*\r?\n/)
            .filter((a) => a);
        return words;
    }
    try {
        const userWords = loadWhitelistedWords();
        const fileGlob: string = tl.getInput("files", true);

        const files = glob.sync(fileGlob);

        Q.all(files.map((f) => checkFile(f, userWords))).then(processErrors);
    } catch (err) {
        console.log("err", err);
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

run();
