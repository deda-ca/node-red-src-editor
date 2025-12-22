import fs from 'fs';
import path from 'path';

import type { Flows, ManifestFile, Manifest } from './types.ts';
import { flowFilesProperties, flowFolderProperties, supportedFlowFileTypes } from './types.ts';

export function sanitizeName(name: string, folderName: string, existingFileNames: Map<string, number>): string {
    // Make sure the name is a valid file name and build the file path.
    name = name.replace(/[\/\\]/g, '-');
    const filePath = path.join(folderName, name);

    // If the file name already exists then add a number to the end of the file name.
    const existingFilesCount = existingFileNames.get(filePath);

    if (existingFilesCount) {
        name += ` (${existingFilesCount})`;
        existingFileNames.set(filePath, existingFilesCount + 1);
    } else {
        existingFileNames.set(filePath, 1);
    }

    return name;
}

export async function flows2Manifest(flows: Flows): Promise<Manifest> {
    // Create the manifest
    const manifest: Manifest = { folders: {}, files: {} };
    // A list of all manifest file names. This is the sub path which includes folder name. Used to ensure file names are unique.
    const filesMap: Map<string, number> = new Map();
    // Add the default folder to the files map and the folders list.
    filesMap.set('default', 1);

    // Find all folders first. The folder structure is base on Tabs and Subflows.
    for (const flowItem of flows) {
        // If item is not of supported type then skip it.
        const folderProperty = flowFolderProperties[flowItem.type];
        if (!folderProperty) continue;
        // If item does not have a valid name then skip it.
        const name = flowItem[folderProperty.name];
        if (!name) continue;

        // Get the item properties.
        const folderName = sanitizeName(name, '', filesMap);
        const manifestFolder = { id: flowItem.id, type: flowItem.type, name, folderName };

        // Add the folder to the list of folder.
        manifest.folders[manifestFolder.id] = manifestFolder;
    }

    // Extract Functions and UI Templates (Vue components)
    for (const flowItem of flows) {
        // If not supported type then skip it.
        if (!supportedFlowFileTypes.includes(flowItem.type)) continue;

        // Find the folder
        const folder = (flowItem.z && manifest.folders[flowItem.z]) || undefined;
        const folderName = folder?.folderName || 'default';
        // Get the item properties and process them.
        const baseFileName = sanitizeName(flowItem.name, folderName, filesMap);
        const files: ManifestFile[] = [];

        // Add the files to the manifest
        for (const fileProperty of flowFilesProperties) {
            const content = flowItem[fileProperty.type];
            if (content && typeof content === 'string' && content.trim().length) {
                files.push({ type: fileProperty.type, name: `${baseFileName}${fileProperty.extension}`, content });
            }
        }

        // Add the item to the manifest list only if there are files.
        if (files.length) manifest.files[flowItem.id] = { id: flowItem.id, type: flowItem.type, name: flowItem.name, folderName, baseFileName, files };
    }

    // Return the manifest.
    return manifest;
}

export function applyManifest(manifest: Manifest, existingManifest: Manifest = { folders: {}, files: {} }, sourcePath: string) {
    // If the source path is not defined then throw an error. Create the source path if it does not exist.
    if (!sourcePath) throw new Error('Source path is not defined');
    if (!fs.existsSync(sourcePath)) fs.mkdirSync(sourcePath, { recursive: true });

    // The list of stats
    const stats = {
        foldersCreated: 0,
        foldersDeleted: 0,
        filesCreated: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        totalModified: 0
    };
    // A list of all created files and folders.
    const files: Map<string, string> = new Map();

    // Traverse the folders and make sure they exist.
    for (let manifestFolder of Object.values(manifest.folders)) {
        // Build the folder path
        const folderPath = path.join(sourcePath, manifestFolder.folderName);
        // If the folder does not exist then create it.
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
            stats.foldersCreated++;
        }
        // Add it to the list of created files.
        // files.add(folderPath);
    }

    // Traverse the files and create them as well if they do not exist or has changed.
    for (let manifestItem of Object.values(manifest.files)) {
        const existingManifestItem = existingManifest.files[manifestItem.id];
        // Build the file path
        for (let manifestFile of manifestItem.files) {
            const existingFile = existingManifestItem?.files.find((f) => f.type === manifestFile.type);
            const filePath = path.join(sourcePath, manifestItem.folderName, manifestFile.name);
            // If the file does not exist then create it.
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, manifestFile.content, 'utf8');
                manifestFile.modifiedTime = fs.statSync(filePath).mtimeMs;
                stats.filesCreated++;
            } else if (!existingFile || existingFile.modifiedTime !== fs.statSync(filePath).mtimeMs) {
                fs.writeFileSync(filePath, manifestFile.content, 'utf8');
                manifestFile.modifiedTime = fs.statSync(filePath).mtimeMs;
                stats.filesUpdated++;
            }
            // Add it to the list of created files.
            files.set(filePath, manifestItem.id);
        }
    }

    // Delete any files that should not be in the source path.
    const folderStack: string[] = [sourcePath];
    const extensions: string[] = ['vue', 'js', 'md'];

    while (folderStack.length > 0) {
        const fullPath = folderStack.pop()!;
        const fileNames = fs.readdirSync(fullPath);
        for (const file of fileNames) {
            const filePath = path.join(fullPath, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                folderStack.push(filePath);
                // TODO: we are not deleting folders, probably we should.
            } else if (stat.isFile() && extensions.includes(path.extname(file)) && !files.has(filePath)) {
                // If the file is not in the list then delete it.
                fs.unlinkSync(filePath);
                stats.filesDeleted++;
            }
        }
    }

    // Update the totalModified
    stats.totalModified = stats.filesCreated + stats.filesUpdated + stats.filesDeleted + stats.foldersCreated + stats.foldersDeleted;

    // Return the status
    return { stats, files };
}
