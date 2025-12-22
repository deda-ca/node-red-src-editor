import os from 'os';
import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';

import { getFlows, postFlows, listenToFlowsChange } from './api.ts';
import type { Config, Manifest } from './types.ts';
import { manifest2Flows, backupFlows } from './src2flows.ts';
import { flows2Manifest, applyManifest } from './flows2src.ts';

/**
 * Loads the configuration from the given file path.
 * If no file path is given, it is expected to be provided as a command line argument.
 * If no command line argument is given, an error will be thrown.
 *
 * @param {string} [configFilePath] - The path to the configuration file.
 * @returns {Promise<import('./config').Config>} - The loaded configuration.
 * @throws {Error} - If no configuration file is given or if the given configuration file does not exist.
 */
async function loadConfig(configFilePath?: string): Promise<Config> {
    // If no config file is given then get it from the command line.
    if (!configFilePath) configFilePath = process.argv[2];
    // If no config file found then throw an error.
    if (!configFilePath) throw new Error('Please provide the path to the config file as a command line argument.');

    // If the config file is a tilde then make it a full path.
    if (configFilePath.startsWith('~')) configFilePath = path.join(os.homedir(), configFilePath.slice(1));

    // Make sure the file exists.
    if (!fs.existsSync(configFilePath)) throw new Error('The provided config file does not exist.');

    // Make sure it is a file and it exists.
    if (!fs.lstatSync(configFilePath).isFile()) throw new Error('The provided config file is not a file.');

    // Load the js file.
    const config = await import(configFilePath);
    if (!('config' in config)) throw new Error('The provided config file does not export a config object.');

    // Add the resolved file path to the config.
    config.config.configFilePath = configFilePath;

    // If sourcePath is provided then resolve it and handle tilde.
    if (config.config.sourcePath) {
        if (config.config.sourcePath.startsWith('~')) config.config.sourcePath = path.join(os.homedir(), config.config.sourcePath.slice(1));
        config.config.sourcePath = path.resolve(config.config.sourcePath);
    }

    // Return the config.
    return config.config as Config;
}

async function main() {
    // Load the config
    console.log('INFO: loading config');
    const config = await loadConfig();
    // If allow allowSelfSignedCertificates then disable the certificate check.
    if (config.allowSelfSignedCertificates) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    // Get the flows
    console.log('INFO: loading flows from node-red');
    let flowsResponse = await getFlows(config.nodeRedUrl, config.bearerToken || null);

    // If the source path is not given then build it from the config file path.
    const configPath = path.dirname(config.configFilePath);
    if (!config.sourcePath) config.sourcePath = path.join(configPath, 'src');

    listenToFlowsChange(config.nodeRedUrl, ['notification/runtime-deploy'], config.bearerToken || null, async (event) => {
        const rev = event.data?.revision;
        // If the revision is the same then ignore it.
        if (rev === flowsResponse.rev) return console.log(`INFO: flows not changed, rev: ${rev}`);
        // Otherwise fetch the new flows and update the metadata.
        else {
            console.log(`INFO: flows changed, rev: ${rev}`);
            flowsResponse = await getFlows(config.nodeRedUrl, config.bearerToken || null);

            const newManifest = await flows2Manifest(flowsResponse.flows);
            applyManifest(newManifest, manifest, config.sourcePath!);
        }
    });

    // Write the flows to a file.
    backupFlows(flowsResponse, configPath);

    // If cleanOnStart is true then clear the source folder.
    if (config.cleanOnStart === true && fs.existsSync(config.sourcePath)) {
        console.info(`INFO: clearing source directory.`);
        fs.rmSync(config.sourcePath, { recursive: true });
    }

    // Make sure the source folder exists.
    if (!fs.existsSync(config.sourcePath)) {
        console.info(`INFO: creating source directory.`);
        fs.mkdirSync(config.sourcePath, { recursive: true });
    }

    // Load existing manifest if it exists.
    const manifestPath = path.join(configPath, 'manifest.json');
    let existingManifest: Manifest = { folders: {}, files: {} };
    if (fs.existsSync(manifestPath)) {
        console.log('INFO: loading existing manifest');
        existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }

    // Convert the flows to a manifest.
    console.log('INFO: converting flows to manifest');
    const manifest = await flows2Manifest(flowsResponse.flows);

    // Apply the manifest to the source.
    console.log('INFO: applying manifest to source');
    const { stats, files } = applyManifest(manifest, existingManifest, config.sourcePath);

    // If there was modification then save the manifest.
    if (stats.totalModified > 0) {
        // TODO: Add a timeout so we don't save it a lot of times.
        console.log('INFO: saving manifest');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }

    // Watch created files, if modified then apply back to Node-Red after a delay.
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    const changeQueue: string[] = [];
    chokidar.watch(config.sourcePath).on('change', (path, stats) => {
        // If the file does not exist within the manifest then ignore it.
        if (!files.has(path)) return;

        // Push the changes onto a queue and start a timer.
        changeQueue.push(path);
        if (updateTimer) clearTimeout(updateTimer);
        updateTimer = setTimeout(async () => {
            updateTimer = null;

            if (changeQueue.length === 0) return;
            const changed = manifest2Flows(flowsResponse.flows, manifest, config.sourcePath!, changeQueue, files);

            if (changed > 0) {
                // Update the load flows.
                //writeFlows(flowsResponse, configPath);
                // Send the changes to node-red server.

                try {
                    const response = await postFlows(config.nodeRedUrl, config.bearerToken || null, flowsResponse.flows, flowsResponse.rev);
                    // Update the revision number.
                    flowsResponse.rev = response.rev;
                } catch (error) {
                    console.error('ERROR: ', error);
                }
            }

            // Clear the queue
            changeQueue.splice(0, changeQueue.length);
        }, 1000);
    });
}

main();
