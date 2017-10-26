import fs = require("fs");
import glob = require("glob");
import path = require("path");
import util = require("util");

export function readSpecification(basePath: string): CreateFileMapResults {

    const result: CreateFileMapResults = {
        files: {},
        errors: [],
    };

    let currentFile: string;

    try {
        const files = glob.sync(path.join(basePath, "**/*.json"));

        if (files) {
            for (currentFile of files) {

                // skip canonical files and diff files
                if (currentFile.indexOf(".canonical.json") !== -1 || currentFile.indexOf(".diff.json") !== -1) {
                    continue;
                }

                processFile(currentFile, readFile(currentFile));
            }
        }
    } catch (err) {
        addError("Error reading directory '%s': %s.", basePath, err.message);
    }
    return result;

    function addError(message: string, ...args: any[]): void {

        let msg = util.format.apply(this, arguments);
        if (currentFile) {
            msg = currentFile + ": " + msg;
        }
        result.errors.push(msg);
    }

    function readFile(filename: string): string | null {

        try {
            return JSON.parse(fs.readFileSync(filename, "utf8"));
        } catch (err) {
            addError(err.message);
        }
        return null;
    }

    function processFile(filename: string, content: any): void {

        if (!content) {
            return;
        }

        // only process value sets and structure definitions
        if (content.resourceType !== "ValueSet" &&
            content.resourceType !== "StructureDefinition" &&
            content.resourceType !== "CodeSystem") {
            return;
        }

        // skip files that are of resource type StructureDefinition but do not contain '.profile' in their name
        if (content.resourceType === "StructureDefinition" &&
            filename.indexOf(".profile") === -1) {
            return;
        }

        // skip files that do not define an id
        const id = getContentId(content);
        if (!id) { return; }

        if (result.files[id]) {
            addError("Duplicate id '%s' already defined in file '%s'.", id, result.files[id].filename);
            return;
        }

        result.files[id] = {
            id,
            filename,
            content,
        };
    }

    function getContentId(content: any): string | null {
        if (!content) { return null; }

        if (content.resourceType === "ValueSet" || content.resourceType === "CodeSystem") {
            return content.url;
        }

        return content.id;
    }
}
