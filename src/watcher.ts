import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';

import type { App, Config } from './types.ts';
import { manifest2Flows, backupFlows } from './src2flows.ts';
import { flows2Manifest, applyManifest } from './flows2src.ts';
import { getFlows, postFlows, listenToFlowsChange } from './api.ts';

/**
 * Resolves a file path to a full path.
 * If the file path starts with a tilde (~), then it is resolved to the home directory.
 * Otherwise, it is resolved to the current working directory.
 *
 * @param {string} filePath - The file path to resolve.
 * @returns {string} - The resolved file path.
 */
export function resolvePath(filePath: string) {
    if (filePath.startsWith('~')) filePath = path.join(os.homedir(), filePath.slice(1));
    return path.resolve(filePath);
}

/**
 * Loads the configuration from the given file path.
 * If no file path is given checks command line first argument.
 * If no command line argument is given, tries current directory.
 * If no config file is found an error will be thrown.
 *
 * @param {string} [configFilePath] - The path to the configuration file.
 * @param {import('./types').State} [state] - The state object. Gets populated if provided.
 * @returns {Promise<import('./config').Config>} - The loaded configuration. *
 * @throws {Error} - If no configuration file is given or if the given configuration file does not exist.
 */
export async function loadConfig(configFilePath?: string, app?: App): Promise<Config> {
    // If no config file is given then get it from the command line.
    if (!configFilePath) configFilePath = process.argv[2];
    // If no config on command line checks current directory.
    if (!configFilePath && fs.existsSync(path.join(process.cwd(), 'config.js'))) configFilePath = path.join(process.cwd(), 'config.js');
    // If no config file found then throw an error.
    if (!configFilePath) throw new Error('Please provide the path to the config file as a command line argument. Or create a config.js file in the current directory.');

    // If the config file is a tilde then make it a full path.
    configFilePath = resolvePath(configFilePath);

    // Make sure the file exists.
    if (!fs.existsSync(configFilePath)) throw new Error(`The provided config file does not exist: '${configFilePath}'.`);
    // Make sure it is a file and it exists.
    if (!fs.lstatSync(configFilePath).isFile()) throw new Error(`The provided config file is not a file: '${configFilePath}'.`);

    // Load the js file.
    let config: Config;
    try {
        const configFile = await import(configFilePath);
        if (!('config' in configFile)) throw new Error(`The provided config file does not export a config object: '${configFilePath}'.`);
        config = configFile.config;
    } catch (error) {
        throw new Error(`The provided config is not a valid JavaScript file: '${configFilePath}'. \n${error}`);
    }

    // If sourcePath is provided then resolve it otherwise use the config file path.
    if (config.sourcePath) config.sourcePath = resolvePath(config.sourcePath);
    else config.sourcePath = path.join(path.dirname(configFilePath), 'src');

    // If app is given then populate it.
    if (app) {
        app.config = config;
        app.configFilePath = configFilePath;
        app.configBasePath = path.dirname(configFilePath);
    }

    // Return the config.
    return config as Config;
}

export async function start() {
    // Add global error handlers for uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
        console.error('ERROR: uncaught Exception:', error);
    });
    process.on('unhandledRejection', (reason, promise) => {
        console.error('ERROR: unhandled rejection at:', promise, 'reason:', reason);
    });

    // Create a new application object.
    const app: App = {
        config: {} as Config,
        configFilePath: '',
        configBasePath: '',
        flows: null,
        revision: null,
        manifest: null
    };

    // Load the config
    console.log('INFO: Loading config...');
    try {
        app.config = await loadConfig(undefined, app);
    } catch (error: any | Error) {
        return console.error('ERROR: ' + error.toString());
    }
    const config = app.config;
    console.log(`INFO: Config loaded: ${app.configFilePath}`);

    // If allow allowSelfSignedCertificates then disable the certificate check.
    if (config.allowSelfSignedCertificates) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    // Get the latest flows
    console.log(`INFO: Loading flows from node-red: ${config.nodeRedUrl}`);
    const flowsResponse = await getFlows(config.nodeRedUrl, config.bearerToken || null);
    console.log(`INFO: Loaded flows with revision: ${flowsResponse.rev}`);

    // Update the app object.
    app.flows = flowsResponse.flows;
    app.revision = flowsResponse.rev;

    // Convert the flows to a manifest
    console.log('INFO: Converting flows to manifest...');
    app.manifest = await flows2Manifest(app.flows, app.revision);

    // If cleanOnStart is true then clear the source folder.
    if (config.cleanOnStart === true && fs.existsSync(config.sourcePath)) {
        console.info(`INFO: Clearing source directory.`);
        fs.rmSync(config.sourcePath, { recursive: true });
    }

    // Apply the manifest to the source folder.
    console.log('INFO: Applying manifest to source folder...');
    applyManifest(app.manifest, app.config.sourcePath);

    // Listen to file changes and update the flows on the node-red server.
    console.log('INFO: Listening to file changes...');
    watchFiles(app);

    // Listen to flow changes on the node-red server and update the source folder.
    console.log('INFO: Listening to flow changes on Node-Red server...');
    watchFlows(app);
}

/**
 * Listen to file changes and update the flows on the node-red server.
 * Watch created files, if modified then apply back to Node-Red after a delay.
 */
export function watchFiles(app: App) {
    // Keeps track of changed files.
    const changes: Set<string> = new Set();
    // Used to prevent multiple changes to be applied at the same time.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Watch the source folder for changes.
    chokidar.watch(app.config.sourcePath).on('change', (path: string, stats) => {
        // If the file does not exist within the manifest then ignore it.
        if (!app.manifest?.filesMap.has(path)) return;

        // Add the changed file to the queue.
        changes.add(path);

        // If there is a debounce timer then clear it and start a new one.
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            onFilesChange(app, Array.from(changes));
            changes.clear();
        }, app.config.fileChangeDelay || 1000);
    });
}

export async function onFilesChange(app: App, files: string[]) {
    if (!app.flows) throw new Error('Flows or manifest not loaded.');
    if (!app.manifest) throw new Error('Flows or manifest not loaded.');

    // Traverse the changed files and apply them to the flows.
    console.log(`INFO: Detected changes in ${files.length} file(s).`);
    // Update the flows based on the changed files.
    const changed = manifest2Flows(app.flows, app.manifest, app.config.sourcePath, files);
    if (changed > 0) {
        console.log(`INFO: Applied changes to ${changed} flow item(s).`);
        // Backup the flows to a file.
        backupFlows(app.flows, app.configBasePath);
        // Send the flow updates to the node-red server.
        try {
            const response = await postFlows(app.config.nodeRedUrl, app.config.bearerToken || null, app.flows, app.revision || '');
            // Update the revision number.
            app.revision = response.rev;
            console.log(`INFO: Updated flows on Node-Red server. New revision: ${response.rev}`);
        } catch (error: any | Error) {
            console.error('ERROR: ' + error.toString());
        }
    }
}

export async function watchFlows(app: App) {
    const config = app.config;
    // Use WebSocket to listen to flow changes.
    listenToFlowsChange(config.nodeRedUrl, config.bearerToken || null, async (event) => {
        // Get the revision from the event.
        const rev = event.data?.revision;
        // If the revision is the same then ignore it.
        if (rev === app.revision) return console.log(`WS: flows not changed, rev: ${rev}`);

        console.log(`WS: flows changed, rev: ${rev}`);
        const flowsResponse = await getFlows(config.nodeRedUrl, config.bearerToken || null);

        // Update the app flows and revision.
        app.flows = flowsResponse.flows;
        app.revision = flowsResponse.rev;
        // Backup the flows to a file.
        backupFlows(app.flows, app.configBasePath);

        // Convert the flows to a manifest
        console.log('INFO: Rebuilding manifest from new flows...');
        app.manifest = flows2Manifest(flowsResponse.flows, flowsResponse.rev, app.manifest || undefined);
        console.log('INFO: Applying manifest changes to source folder...');
        const stats = applyManifest(app.manifest, config.sourcePath);
        if (stats.totalModified === 0) console.log(`    No changes detected.`);
        if (stats.foldersCreated > 0) console.log(`    Folders created: ${stats.foldersCreated}`);
        if (stats.filesCreated > 0) console.log(`    Files created: ${stats.filesCreated}`);
        if (stats.filesUpdated > 0) console.log(`    Files updated: ${stats.filesUpdated}`);
        if (stats.filesDeleted > 0) console.log(`    Files deleted: ${stats.filesDeleted}`);
    });
}

// check if this is running as the main module
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === __filename;
if (isMainModule) await start();
