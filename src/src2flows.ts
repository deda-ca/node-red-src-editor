import fs from 'fs';
import path from 'path';
import type { Flows, Manifest, FlowsResponse } from './types.ts';

export function generateFilePathToIdMap(manifest: Manifest, sourcePath: string): Map<string, string> {
    const files = new Map<string, string>();

    // Traverse the manifest files
    for (let manifestItem of Object.values(manifest.files)) {
        // Traverse the item files
        for (let manifestFile of manifestItem.files) {
            // Build the file path
            const filePath = path.join(sourcePath, manifestItem.folderName, manifestFile.name);
            // Add it to the map
            files.set(filePath, manifestItem.id);
        }
    }

    // Return the map
    return files;
}

export function manifest2Flows(flows: Flows, manifest: Manifest, sourcePath: string, changedFiles: string[], files?: Map<string, string>) {
    // If the files map is not defined then generate it.
    if (!files) files = generateFilePathToIdMap(manifest, sourcePath);

    let changed = 0;

    // Traverse the changed files and apply them within the flows
    for (let filePath of changedFiles) {
        // Get the id
        const id = files.get(filePath);
        if (!id) continue;

        // Get the manifest item
        const manifestItem = manifest.files[id];
        if (!manifestItem) continue;

        // Get the manifest file
        const fileName = path.basename(filePath);
        const manifestFile = manifestItem.files.find((file) => file.name === fileName);
        if (!manifestFile) continue;

        // Get the flow item
        const flowItem = flows.find((flow) => flow.id === id);
        if (!flowItem) continue;

        // Get the file content and latest modified date.
        const content = fs.readFileSync(filePath, 'utf-8');
        const modifiedDate = fs.statSync(filePath).mtimeMs;

        // Update the flow item and the manifest file
        manifestFile.content = content;
        manifestFile.modifiedTime = modifiedDate;
        flowItem[manifestFile.type] = content;

        // Update the changed count.
        changed++;
    }

    return changed;
}

export function backupFlows(flowsResponse: FlowsResponse, sourcePath: string) {
    // Only write every x seconds or minutes.

    const flowsPath = path.join(sourcePath, 'flows.json');
    fs.writeFileSync(flowsPath, JSON.stringify(flowsResponse, null, 2));

    // TODO: backup the current file if it exists.

    // TODO: clean up older backups.
}
