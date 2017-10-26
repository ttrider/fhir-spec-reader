"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const glob = require("glob");
const path = require("path");
const util = require("util");
function readSpecification(basePath) {
    const result = {
        files: {},
        errors: [],
    };
    let currentFile;
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
    }
    catch (err) {
        addError("Error reading directory '%s': %s.", basePath, err.message);
    }
    return result;
    function addError(message, ...args) {
        let msg = util.format.apply(this, arguments);
        if (currentFile) {
            msg = currentFile + ": " + msg;
        }
        result.errors.push(msg);
    }
    function readFile(filename) {
        try {
            return JSON.parse(fs.readFileSync(filename, "utf8"));
        }
        catch (err) {
            addError(err.message);
        }
        return null;
    }
    function processFile(filename, content) {
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
        if (!id) {
            return;
        }
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
    function getContentId(content) {
        if (!content) {
            return null;
        }
        if (content.resourceType === "ValueSet" || content.resourceType === "CodeSystem") {
            return content.url;
        }
        return content.id;
    }
}
exports.readSpecification = readSpecification;
//# sourceMappingURL=reader.js.map