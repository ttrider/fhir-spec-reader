"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const changeCase = require("change-case");
const util = require("util");
function processFiles(files) {
    const maxNameLength = 56;
    const typesByName = {};
    const result = {
        types: [],
        errors: [],
    };
    let currentFile;
    // process all resource definitions
    for (const id in files) {
        if (files.hasOwnProperty(id)) {
            const file = files[id];
            if (isResourceDefinition(file)) {
                if (isConstrainedType(file)) {
                    console.log("Warning! Skipping constrained type resource definition: " + file.filename);
                }
                else {
                    referenceFile(file);
                }
            }
        }
    }
    return result;
    function addError(message, ...args) {
        let msg = util.format.apply(this, arguments);
        if (currentFile) {
            msg = currentFile.filename + ": " + msg;
        }
        result.errors.push(msg);
    }
    function isResourceDefinition(file) {
        if (file.content && file.content.resourceType === "StructureDefinition") {
            return file.content.kind === "resource";
        }
        return false;
    }
    function isConstrainedType(file) {
        return file.content.derivation === "constraint";
    }
    function referenceFile(file) {
        // flag file as referenced
        if (!file.referenced) {
            file.referenced = true;
            processFile(file);
            if (file.type) {
                addTypeToResults(file.type);
            }
        }
    }
    function addTypeToResults(type) {
        // check for duplicate type names.
        if (type.name) {
            if (typesByName[type.name]) {
                addError("Duplicate type name '%s'.", type.name);
            }
            else {
                typesByName[type.name] = type;
            }
        }
        result.types.push(type);
    }
    function processFile(file) {
        if (file.processed || file.queued || !file.content) {
            return;
        }
        file.queued = true;
        const oldFile = currentFile;
        currentFile = file;
        switch (file.content.resourceType) {
            case "ValueSet":
                processValueSet(file);
                break;
            case "StructureDefinition":
                processStructureDefinition(file);
                break;
            case "CodeSystem":
                processCodeSystem(file);
                break;
            default:
                addError("Unknown resource type '%s'.", file.content.resourceType);
                break;
        }
        file.processed = true;
        currentFile = oldFile;
    }
    function processValueSet(file) {
        const content = file.content;
        const type = {
            category: 5 /* ValueSet */,
            name: getEnumName(file),
            kind: 8 /* EnumType */,
            description: content.description,
            members: [],
        };
        file.type = type;
        // See if any codes are pulled in from elsewhere
        const compose = content.compose;
        if (compose) {
            // See if codes are included from another system
            const includes = compose.include;
            if (includes) {
                includes.forEach((item) => combine(processInclude(item)));
            }
        }
        function processInclude(include) {
            if (include.system) {
                // process any included codes substituting for original system if available
                const members = substituteCodesFromOriginalSystem(include.system, processValueSetComposeInclude(include));
                // process any filters
                if (include.filter) {
                    const includeSystem = include.system;
                    include.filter.forEach((filter) => processFilter(includeSystem, filter, members));
                }
                return members;
            }
            if (include.valueSet) {
                // See if we import from another value set
                const imports = include.valueSet;
                if (imports) {
                    imports.forEach((item) => combine(processImport(item)));
                }
            }
            return [];
        }
        function combine(members) {
            if (members) {
                members.forEach((member) => {
                    if (adjustMemberName(member, type.members)) {
                        type.members.push(member);
                    }
                });
            }
        }
    }
    function adjustMemberName(memberToAdd, members) {
        // Check if we have an duplicates. If not, we are good to go.
        const duplicateMember = getDuplicate(memberToAdd, members);
        if (!duplicateMember) {
            return true;
        }
        // we have a duplicate. if it's identical then ignore
        if (areEnumMembersEqual(duplicateMember, memberToAdd)) {
            return false;
        }
        const originalName = memberToAdd.name;
        // We have a duplicate. See if switching the name to an alternate value fixed the problem
        let alternate = getAlternateName(memberToAdd);
        if (alternate) {
            memberToAdd.name = alternate;
            if (!getDuplicate(memberToAdd, members)) {
                // Problem solved. Go ahead and add the enum member.
                return true;
            }
            // That didn't work. So try switching the name of the other member.
            alternate = getAlternateName(duplicateMember);
            if (alternate) {
                duplicateMember.name = alternate;
                if (!getDuplicate(memberToAdd, members)) {
                    // Problem solved. Go ahead and add the enum member.
                    return true;
                }
            }
        }
        // Still didn't work so we are just going to add an incrementing number to the name;
        let num = 1;
        do {
            memberToAdd.name = originalName + "_" + (num++);
        } while (getDuplicate(memberToAdd, members));
        return true;
    }
    function getDuplicate(memberToAdd, members) {
        for (const currentMember of members) {
            if (currentMember.name === memberToAdd.name) {
                return currentMember;
            }
        }
        return null;
    }
    function areEnumMembersEqual(member1, member2) {
        return member1.name === member2.name
            && member1.value === member2.value
            && member1.description === member2.description
            && member1.display === member2.display
            && member1.system === member2.system
            && member1.caseSensitive === member2.caseSensitive;
    }
    function substituteCodesFromOriginalSystem(url, members) {
        const file = getValueSetFile(url);
        if (file) {
            processFile(file);
            if (file.type) {
                if (members.length === 0) {
                    members = file.type.members;
                }
                else {
                    members = file.type.members.filter((member) => {
                        for (const currentMember of members) {
                            if (currentMember.value === member.value) {
                                return true;
                            }
                        }
                        return false;
                    });
                }
            }
        }
        return members;
    }
    function processFilter(url, filter, members) {
        const file = getValueSetFile(url);
        if (!file) {
            return;
        }
        if (filter.op !== "is-a") {
            addError("Do not know how to process filter operation '%s'.", filter.op);
            return;
        }
        if (filter.property !== "concept") {
            addError("Do not know how to process filter property '%s'.", filter.property);
            return;
        }
        processFile(file);
        if (file.type) {
            file.type.members.forEach((member) => {
                if (enumMemberIsA(member, filter.value)) {
                    members.push(member);
                }
            });
        }
    }
    function enumMemberIsA(member, code) {
        let currentMember = member;
        while (currentMember) {
            if (currentMember.value === code) {
                return true;
            }
            currentMember = currentMember.parent;
        }
        return false;
    }
    function processImport(url) {
        const file = getValueSetFile(url);
        if (!file) {
            addError("Unable to process import statement for '%s' because value set with id '%s' could not be found.", url, url);
        }
        else {
            processFile(file);
            const type = file.type;
            if (type) {
                return type.members;
            }
        }
        return [];
    }
    function getValueSetFile(url) {
        // handle bad reference in devicerequest.profile.json
        if (url === "http://build.fhir.org/valueset-request-intent.html") {
            url = "http://hl7.org/fhir/ValueSet/request-intent";
        }
        let file = files[url];
        if (!file) {
            // there are some inconsistencies in the url naming so if we can't find the file, try adding in 'vs' and
            // see if we can find it then
            const parts = url.split("/");
            parts.splice(parts.length - 1, 0, "vs");
            file = files[parts.join("/")];
        }
        return file;
    }
    function processValueSetComposeInclude(include) {
        return processConcepts(include.concept, true, include.system);
    }
    function processCodeSystem(file) {
        const content = file.content;
        file.type = {
            category: 6 /* CodeSystem */,
            name: getEnumName(file),
            kind: 8 /* EnumType */,
            description: content.description,
            members: processConcepts(content.concept, content.caseSensitive, content.url),
        };
    }
    function processConcepts(concepts, caseSensitive, system) {
        const members = [];
        if (concepts) {
            for (const concept of concepts) {
                const member = {
                    name: getEnumMemberName(system, concept),
                    description: getEnumMemberDescription(concept),
                    value: concept.code,
                    system: system,
                    caseSensitive: caseSensitive,
                };
                const display = concept.display && concept.display.trim();
                if (display) {
                    member.display = display;
                }
                members.push(member);
            }
        }
        return members;
    }
    function getEnumName(file) {
        const content = file.content;
        // Get the name from the content
        let name = content.name;
        // If the name is not defined in the content or is not valid then try using the first referencing symbol
        if (!name || name.indexOf(" ") !== -1) {
            name = file.symbol;
        }
        // If it has never been referenced then take the name from the URL
        if (!name) {
            return getNameFromSystemUrl(file.id);
        }
        return formatName(name);
    }
    function getNameFromSystemUrl(url) {
        const parts = url.split("/");
        const name = parts[parts.length - 1];
        return formatName(name);
    }
    function getAlternateName(member) {
        let name = null;
        // If the code does not start with a number, use that.
        if (member.value && !startsWithNumber(member.value)) {
            name = member.value;
        }
        else {
            // Otherwise, check to see if we can use the description
            if (member.description && member.description.length < maxNameLength) {
                name = member.description;
            }
        }
        if (name) {
            return formatName(name);
        }
    }
    function getEnumMemberName(system, concept) {
        let name;
        // Check for pre-defined mapped names for problem codes
        name = getMappedName(system, concept.code);
        if (!name) {
            // use the display as the name if we have one
            const display = concept.display && concept.display.trim();
            if (display && display.length < maxNameLength) {
                name = concept.display;
                if (name) {
                    // replace the symbol * with the word Star
                    name = name.replace("*", "Star");
                }
            }
            else {
                // use the code if it doesn't start with a number
                const code = concept.code;
                if (code && !startsWithNumber(code)) {
                    name = code;
                }
                else {
                    // If the code started with a number, then see about using the description
                    let description = getEnumMemberDescription(concept);
                    description = description && description.trim();
                    if (description && description.length < maxNameLength) {
                        name = description;
                    }
                    else {
                        // Last option is to use the code as the name
                        name = code;
                    }
                }
            }
        }
        if (!name) {
            addError("Unable to determine name for value set concept.");
            return null;
        }
        return formatName(name);
    }
    function getMappedName(system, code) {
        switch (code) {
            case "=":
                return "Equals";
            case "<":
                return "LessThan";
            case "<=":
                return "LessThanOrEqual";
            case ">":
                return "GreaterThan";
            case ">=":
                return "GreaterThanOrEqual";
        }
        return null;
    }
    function formatName(name) {
        name = changeCase.pascalCase(name);
        // prepend underscore if name starts with a number
        if (startsWithNumber(name)) {
            name = "_" + name;
        }
        return name;
    }
    function startsWithNumber(text) {
        return isNumberCharacter(text.charCodeAt(0));
    }
    function isNumberCharacter(charCode) {
        return charCode >= 48 && charCode <= 57;
    }
    function getEnumMemberDescription(concept) {
        if (concept.definition) {
            return concept.definition;
        }
        const definitionExtension = getExtensionValueString(concept, "http://hl7.org/fhir/StructureDefinition/valueset-definition");
        if (definitionExtension) {
            return definitionExtension;
        }
        if (concept.display && concept.display.indexOf(" ") !== -1) {
            return concept.display;
        }
    }
    function getExtensionValueString(element, url) {
        const extension = getExtension(element, url);
        if (extension) {
            return extension.valueString;
        }
    }
    function getExtension(element, url) {
        if (element.extension) {
            for (const item of element.extension) {
                if (item.url === url) {
                    return item;
                }
            }
        }
    }
    function processStructureDefinition(file) {
        // TODO: return to fhir.StructureDefinition
        const kind = file.content.kind;
        switch (kind) {
            case "resource":
                processResource(file);
                break;
            case "constraint":
            case "datatype":
            case "type":
            case "complex-type":
            case "primitive-type":
                processType(file);
                break;
            default:
                addError("Unknown content kind '%s'.", kind);
                break;
        }
    }
    function processResource(file) {
        processTypeDefinition(file);
    }
    function processType(file) {
        if (isPrimitive(file)) {
            processPrimitive(file);
        }
        else {
            processTypeDefinition(file);
        }
    }
    function isPrimitive(file) {
        if (file.content) {
            const diff = file.content.differential;
            if (diff) {
                const elements = diff.element;
                for (const element of elements) {
                    if (element.short && element.short.indexOf("Primitive") !== -1) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    function processPrimitive(file) {
        const content = file.content;
        let description, intrinsicType;
        const elements = content.differential.element;
        for (const element of elements) {
            if (element.path === content.id) {
                // element that has resource details
                description = element.definition;
            }
        }
        const intrinsicType = getIntrinsicType(content.id);
        if (!intrinsicType) {
            addError("Unknown primitive type '%s'.", content.id);
        }
        const type = file.type = createPrimitiveType(content.id, intrinsicType);
        type.description = description;
    }
    function getIntrinsicType(primitiveType) {
        switch (primitiveType) {
            case "instant":
                return "string";
            case "time":
                return "string";
            case "date":
                return "string";
            case "dateTime":
                return "string";
            case "decimal":
                return "number";
            case "boolean":
                return "boolean";
            case "integer":
                return "number";
            case "base64Binary":
                return "string";
            case "string":
                return "string";
            case "uri":
                return "string";
            case "unsignedInt":
                return "number";
            case "positiveInt":
                return "number";
            case "code":
                return "string";
            case "id":
                return "string";
            case "oid":
                return "string";
            case "markdown":
                return "string";
        }
    }
    function processTypeDefinition(file) {
        const content = file.content;
        if (!content.id) {
            return;
        }
        const type = file.type = createInterfaceType(content.id, isResourceDefinition(file) ? 3 /* Resource */ : 2 /* DataType */);
        if (typeof content.baseDefinition === "string") {
            type.baseType = getResourceNameFromProfile(content.baseDefinition);
            if (type.baseType) {
                // Make sure we know the base type
                const baseTypeFile = files[type.baseType];
                if (!baseTypeFile) {
                    addError("Unknown base type '%s'.", type.baseType);
                    return;
                }
                referenceFile(baseTypeFile);
            }
        }
        const elements = content.differential.element;
        for (const element of elements) {
            if (element.path.indexOf(".") === -1) {
                // element that has resource details
                type.description = element.short;
            }
            else {
                // element has property details
                const propertyName = getPropertyName(element.path);
                if (!propertyName) {
                    addError("Missing property name for element %d.", i);
                    return;
                }
                const containingType = getContainingTypeForElement(type, element);
                if (!containingType) {
                    addError("Error getting containing type for property '%s': ", propertyName);
                    return;
                }
                if (propertyName.length > 3 && propertyName.indexOf("[x]") === propertyName.length - 3) {
                    const typeReferences = getTypeReferences(element.type);
                    if (!typeReferences) {
                        addError("No types specified for '%s'.", propertyName);
                        return;
                    }
                    let lastProperty = null, lastTypeReferenceName = "";
                    for (let j = 0; j < typeReferences.length; j++) {
                        const typeReference = typeReferences[j];
                        // If the reference has the same type as the last one, combine the type of the property into a
                        // union type
                        if (lastTypeReferenceName === typeReference.name) {
                            if (lastProperty.type.kind === 32 /* UnionType */) {
                                lastProperty.type.types.push(typeReference);
                            }
                            else {
                                lastProperty.type = createUnionType([lastProperty.type, typeReference]);
                            }
                        }
                        else {
                            // otherwise, add a new property for the type
                            lastProperty = addProperty(combinePropertyNameWithType(propertyName, typeReference.name), typeReference, /*optional*/ true);
                            lastTypeReferenceName = typeReference.name;
                        }
                    }
                }
                else {
                    // TODO: How to handle properties that are present to indicate that a property from the base type is not allowed. For example, see simplequantity.profile.json for property Quantity.comparator.
                    if (element.max !== "0") {
                        const propertyType = getPropertyTypeForElement(type, element);
                        if (!propertyType) {
                            addError("Error getting type for property '%s'.", propertyName);
                            return;
                        }
                        addProperty(propertyName, propertyType);
                    }
                }
            }
        }
        // Add resourceType to DomainResource if it's missing
        if (type.name === "Resource" && !getProperty(type, "resourceType")) {
            type.properties.unshift({
                name: "resourceType",
                description: "The type of the resource.",
                type: createTypeReference("code"),
                optional: true,
            });
        }
        // Add fhir_comments to Element if it's missing
        if (type.name === "Element" && !getProperty(type, "fhir_comments")) {
            type.properties.unshift({
                name: "fhir_comments",
                description: "Content that would be comments in an XML.",
                type: createArrayType(createTypeReference("string")),
                optional: true,
            });
        }
        function addProperty(name, propertyType, optional) {
            const property = {
                name: name,
                description: element.short,
                type: propertyType,
                optional: optional === undefined ? element.min === 0 : optional,
            };
            containingType.properties.push(property);
            return property;
        }
    }
    function getProperty(type, name) {
        for (const prop of type.properties) {
            if (prop.name === name) {
                return prop;
            }
        }
    }
    function combinePropertyNameWithType(propertyName, typeName) {
        return propertyName.replace("[x]", changeCase.pascalCase(typeName));
    }
    function getElementTypeName(element) {
        if (!element.type || !element.type.length) {
            return null;
        }
        return element.type[0].code;
    }
    function getPropertyName(path) {
        if (path) {
            const parts = path.split(".");
            return parts[parts.length - 1];
        }
    }
    function getContainingTypeForElement(resourceType, element) {
        const path = element.path;
        if (!path) {
            return null;
        }
        const parts = path.split(".");
        const resourceName = parts.shift();
        if (!resourceName) {
            return null;
        }
        if (!hasBaseInterface(resourceType, resourceName)) {
            addError("Expected '%s' to be a '%s'.", resourceName, resourceType.name);
            return null;
        }
        return getContainingTypeForPath(resourceType, parts);
    }
    function hasBaseInterface(interfaceType, name) {
        let baseType = interfaceType;
        while (baseType) {
            if (baseType.name === name) {
                return true;
            }
            baseType = getTypeByName(baseType.baseType);
        }
        return false;
    }
    function getContainingTypeForPath(parentType, path) {
        if (path.length === 1) {
            return parentType;
        }
        const propertyName = path.shift();
        const property = getPropertyForType(parentType, propertyName);
        if (!property) {
            addError("Could not find property '%s' on type '%s'.", propertyName, parentType.name);
            return null;
        }
        const currentType = getReferencedType(property.type);
        if (!currentType) {
            return null;
        }
        if (!(currentType.kind & 6 /* ObjectTypes */)) {
            addError("Expected property '%s' to reference an object type.", propertyName);
            return null;
        }
        return getContainingTypeForPath(currentType, path);
    }
    function getReferencedType(currentType, category) {
        if (currentType) {
            while (currentType.kind === 16 /* ArrayType */) {
                currentType = currentType.elementType;
            }
            if (currentType.kind === 1 /* TypeReference */) {
                const referencedName = currentType.name;
                currentType = getTypeByName(referencedName);
                if (!currentType) {
                    addError("Could not find type with name '%s'.", referencedName);
                    return null;
                }
                // restrict to type category if specified
                if (category && (currentType.category & category) === 0) {
                    return null;
                }
            }
        }
        return currentType;
    }
    function getTypeByName(name) {
        if (!name) {
            return name;
        }
        // See if the type has already been created
        let ret = typesByName[name];
        if (!ret) {
            // If not, check if we have a file for it
            const referencedFile = files[name];
            if (referencedFile) {
                // We have the file but not the type so process the file
                referenceFile(referencedFile);
                ret = referencedFile.type;
            }
        }
        return ret;
    }
    function getPropertyForType(objectType, propertyName) {
        for (let i = 0; i < objectType.properties.length; i++) {
            if (objectType.properties[i].name === propertyName) {
                return objectType.properties[i];
            }
        }
        return null;
    }
    function getPropertyTypeForElement(rootType, element) {
        let elementType;
        if (element.contentReference) {
            // the content reference
            if (element.contentReference[0] !== "#") {
                addError("Expected content reference '%s' to start with #.", element.contentReference);
                return null;
            }
            elementType = getReferencedType(findTypeOfFirstProperty(rootType, getPropertyName(element.contentReference), []));
            if (!elementType) {
                addError("Could not resolve content reference '%s'.", element.contentReference);
                return null;
            }
            if (elementType.kind !== 4 /* InterfaceType */) {
                addError("Expected content reference to resolve to an interface type.");
            }
            // create a reference to the interface type
            elementType = createTypeReference(elementType.name);
        }
        else {
            const typeReferences = getTypeReferences(element.type);
            if (!typeReferences || typeReferences.length === 0) {
                addError("Expected type for %s.", element.path);
            }
            else if (typeReferences.length === 1) {
                if (typeReferences[0].name === "Element") {
                    elementType = createSubType(element, "Element");
                }
                else if (typeReferences[0].name === "BackboneElement") {
                    // a type of BackboneElement indicates we should create a new sub-type
                    elementType = createSubType(element, "BackboneElement");
                }
                else {
                    elementType = typeReferences[0];
                }
            }
            else {
                elementType = createUnionType(typeReferences);
            }
            // check if we have a binding that is not an example binding
            if (element.binding && !isExampleBinding(element.binding)) {
                const bindingReference = getBindingReference(element);
                if (bindingReference) {
                    if (elementType.kind !== 1 /* TypeReference */) {
                        addError("Expected type reference");
                    }
                    else {
                        elementType.binding = bindingReference;
                    }
                }
            }
        }
        if (element.max !== "1") {
            return createArrayType(elementType);
        }
        return elementType;
    }
    function createSubType(element, baseType) {
        const subTypeName = changeCase.pascalCase(element.path);
        const subType = createInterfaceType(subTypeName, 4 /* SubType */);
        subType.description = element.short;
        subType.baseType = baseType; // all sub-types derive from BackboneElement
        addTypeToResults(subType);
        return createTypeReference(subTypeName);
    }
    function findTypeOfFirstProperty(type, name, checked) {
        if (type && type.properties) {
            if (checked.indexOf(type) !== -1) {
                return null;
            }
            checked.push(type);
            for (let i = 0; i < type.properties.length; i++) {
                const property = type.properties[i];
                let propertyType = property.type;
                if (property.name === name) {
                    return propertyType;
                }
                propertyType = getReferencedType(propertyType, 4 /* SubType */);
                if (propertyType && (propertyType.kind & 6 /* ObjectTypes */)) {
                    const match = findTypeOfFirstProperty(propertyType, name, checked);
                    if (match) {
                        return match;
                    }
                }
            }
        }
    }
    function getTypeReferences(types) {
        if (!types) {
            return null;
        }
        if (!Array.isArray(types)) {
            addError("Expected array of types.");
            return null;
        }
        const result = [];
        // shallow clone type elements array
        let typeElements = [].concat(types);
        for (const typeElement of typeElements) {
            let typeName = typeElement.code;
            if (!typeName) {
                addError("Missing type name.");
                return null;
            }
            // check that we have a valid type name
            if (typeName === "*") {
                // if we have a wildcard add list of types that represent the open type element to the end of the
                // array and then skip processing for this item.
                typeElements = typeElements.concat(openTypeElement);
                continue;
            }
            else if (typeName === "xhtml") {
                typeName = "string";
            }
            else if (!getFileForType(typeName)) {
                // if type name is not valid then skip processing.
                return null;
            }
            const typeReference = createTypeReference(typeName);
            if (typeElement.profile && typeElement.profile.length) {
                const resourceName = getResourceNameFromProfile(typeElement.profile);
                if (resourceName) {
                    if (resourceName !== "any") {
                        const resourceFile = files[resourceName];
                        if (!resourceFile) {
                            addError("Unknown profile '%s'.", resourceName);
                        }
                        else {
                            referenceFile(resourceFile);
                        }
                    }
                    typeReference.binding = resourceName;
                }
            }
            result.push(typeReference);
        }
        return result;
    }
    function getResourceNameFromProfile(profile) {
        const base = "http://hl7.org/fhir/StructureDefinition/";
        if (profile.indexOf(base) === -1) {
            addError("Unrecognized profile uri: '" + profile + "'.");
            return null;
        }
        return profile.substring(base.length);
    }
    function getFileForType(name) {
        const elementTypeFile = files[name];
        if (!elementTypeFile) {
            addError("Unknown type '%s'.", name);
            return null;
        }
        referenceFile(elementTypeFile);
        return elementTypeFile;
    }
    function getBindingReference(element) {
        const binding = element.binding;
        if (!binding) {
            addError(("Element missing binding reference '%s'.", element.path));
            return null;
        }
        const valueSetReference = binding.valueSetReference;
        if (valueSetReference && valueSetReference.reference) {
            const bindingTypeFile = getValueSetFile(valueSetReference.reference);
            if (!bindingTypeFile) {
                addError("Unknown binding reference '%s'.", valueSetReference.reference);
                return null;
            }
            // check to see if the referenced value set appears to be an example even if not specified in
            // the binding.
            if (!isApparentExampleValueSet(bindingTypeFile)) {
                // In-case the value set does not define a valid symbol name in the resource so get it from the
                // binding the first time it's used.
                if (!bindingTypeFile.symbol) {
                    bindingTypeFile.symbol = changeCase.pascalCase(element.path);
                }
                // queue the binding reference for processing.
                referenceFile(bindingTypeFile);
                return bindingTypeFile.type.name;
            }
        }
    }
    function isExampleBinding(binding) {
        return binding.strength === "example";
    }
    function isApparentExampleValueSet(file) {
        return file.content.copyright === "This is an example set";
    }
    function createArrayType(elementType) {
        return {
            category: 0 /* None */,
            kind: 16 /* ArrayType */,
            elementType: elementType,
        };
    }
    function createTypeReference(name) {
        return {
            category: 0 /* None */,
            name: name,
            kind: 1 /* TypeReference */,
        };
    }
    function createInterfaceType(name, category) {
        return {
            category: category,
            kind: 4 /* InterfaceType */,
            name: name,
            properties: [],
        };
    }
    function createObjectType() {
        return {
            category: 0 /* None */,
            kind: 2 /* ObjectType */,
            properties: [],
        };
    }
    function createPrimitiveType(name, intrinsicType) {
        return {
            category: 1 /* Primitive */,
            kind: 64 /* Primitive */,
            name: name,
            intrinsicType: intrinsicType,
        };
    }
    function createUnionType(types) {
        return {
            category: 0 /* None */,
            kind: 32 /* UnionType */,
            types: types,
        };
    }
}
exports.processFiles = processFiles;
const openTypeElement = [
    {
        code: "integer",
    },
    {
        code: "decimal",
    },
    {
        code: "dateTime",
    },
    {
        code: "date",
    },
    {
        code: "instant",
    },
    {
        code: "time",
    },
    {
        code: "string",
    },
    {
        code: "uri",
    },
    {
        code: "boolean",
    },
    {
        code: "code",
    },
    {
        code: "base64Binary",
    },
    {
        code: "Coding",
    },
    {
        code: "CodeableConcept",
    },
    {
        code: "Attachment",
    },
    {
        code: "Identifier",
    },
    {
        code: "Quantity",
    },
    {
        code: "Range",
    },
    {
        code: "Period",
    },
    {
        code: "Ratio",
    },
    {
        code: "HumanName",
    },
    {
        code: "Address",
    },
    {
        code: "ContactPoint",
    },
    {
        code: "Timing",
    },
    {
        code: "Signature",
    },
    {
        code: "Reference",
    },
];
//# sourceMappingURL=processor.js.map