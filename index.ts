import os from 'os';
import fs from 'fs';
import path from 'path';

import type { Config, FlowsResponse, Manifest } from './types.ts';
import { flow2Manifest, applyManifest } from './src/flows2src.ts';

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

/**
 * Gets the flows from Node-Red.
 *
 * @param {import('./types').Config} config - The configuration for the Node-Red instance.
 * @returns {Promise<import('./types').FlowsResponse>} - The flows response from Node-Red which contains the flows and the revision.
 * @throws {Error} - If the fetch request to Node-Red failed or if the response status is not 200.
 */
async function getFlows(config: Config): Promise<FlowsResponse> {
    // Build the headers, if there is is a token then add it.
    const headers = { 'Node-Red-Api-Version': 'v2' } as Record<string, string>;
    if (config.bearerToken) headers.Authorization = `Bearer ${config.bearerToken}`;

    // Build the URL
    const nodeRedUrl = config.nodeRedUrl.endsWith('/') ? `${config.nodeRedUrl}flows` : `${config.nodeRedUrl}/flows`;
    // Fetch the flows
    const response = await fetch(nodeRedUrl, { method: 'GET', headers });

    // Check the response status. Returns {flows: [], rev: ''}
    if (response.status === 200) return response.json();
    else throw new Error(`Error fetching flows from node-red: Status ${response.status}, ${response.statusText}, ${await response.text()}`);
}

async function main() {
    // Load the config
    console.log('INFO: loading config');
    const config = await loadConfig();
    // If allow allowSelfSignedCertificates then disable the certificate check.
    if (config.allowSelfSignedCertificates) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    // Get the flows
    console.log('INFO: loading flows from node-red');
    const flowsResponse = await getFlows(config);

    // If the source path is not given then build it from the config file path.
    if (!config.sourcePath) config.sourcePath = path.join(path.dirname(config.configFilePath), 'src');

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
    const manifestPath = path.join(path.dirname(config.configFilePath), 'manifest.json');
    let existingManifest: Manifest = { folders: {}, files: {} };
    if (fs.existsSync(manifestPath)) {
        console.log('INFO: loading existing manifest');
        existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }

    // Convert the flows to a manifest.
    console.log('INFO: converting flows to manifest');
    const manifest = await flow2Manifest(flowsResponse.flows);

    // Apply the manifest to the source.
    console.log('INFO: applying manifest to source');
    const stats = applyManifest(manifest, existingManifest, config.sourcePath);

    // If there was modification then save the manifest.
    if (stats.totalModified > 0) {
        // TODO: Add a timeout so we don't save it a lot of times.
        console.log('INFO: saving manifest');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }

    // Watch created files, if modified then apply back to Node-Red after a delay.
}

main();
