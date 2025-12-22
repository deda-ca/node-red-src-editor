import WebSocket from 'ws';
import type { Flows, FlowsResponse } from './types.ts';

/**
 * Gets the flows from Node-Red.
 *
 * @param {string} nodeRedUrl - The URL to Node-Red.
 * @param {string | null} bearerToken - The bearer token to use when making requests to Node-Red. If no authentication is enabled, set this to null.
 * @returns {Promise<import('./types').FlowsResponse>} - The flows response from Node-Red which contains the flows and the revision.
 * @throws {Error} - If the fetch request to Node-Red failed or if the response status is not 200.
 */
export async function getFlows(nodeRedUrl: string, bearerToken: string | null): Promise<FlowsResponse> {
    // Build the headers, if there is is a token then add it.
    const headers: Record<string, string> = { 'Node-Red-Api-Version': 'v2' };
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

    // Build the URL
    nodeRedUrl = nodeRedUrl.endsWith('/') ? `${nodeRedUrl}flows` : `${nodeRedUrl}/flows`;
    // Fetch the flows
    const response = await fetch(nodeRedUrl, { method: 'GET', headers });

    // Check the response status. Returns {flows: [], rev: ''}
    if (response.status === 200) return response.json();
    else throw new Error(`Error fetching flows from node-red: Status ${response.status}, ${response.statusText}, ${await response.text()}`);
}

/**
 * Posts the flows to Node-Red.
 *
 * @param {string} nodeRedUrl - The URL to Node-Red.
 * @param {string | null} bearerToken - The bearer token to use when making requests to Node-Red. If no authentication is enabled, set this to null.
 * @param {import('./types').Flows} flows - The flows to post to Node-Red.
 * @param {string} rev - The revision of the flows.
 * @returns {Promise<{rev: string}>} - The revision of the flows after posting.
 * @throws {Error} - If the fetch request to Node-Red failed or if the response status is not 200.
 */
export async function postFlows(nodeRedUrl: string, bearerToken: string | null, flows: Flows, rev: string): Promise<{ rev: string }> {
    // Build the headers, if there is is a token then add it.
    const headers: Record<string, string> = { 'Node-Red-Api-Version': 'v2', 'Node-Red-Deployment-Type': 'full', 'Content-Type': 'application/json' };
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

    // Build the URL
    nodeRedUrl = nodeRedUrl.endsWith('/') ? `${nodeRedUrl}flows` : `${nodeRedUrl}/flows`;
    // Fetch the flows
    const response = await fetch(nodeRedUrl, { method: 'POST', headers, body: JSON.stringify({ flows, rev }) });

    // Check the response status
    if (response.status === 200) return response.json();
    else throw new Error(`Error posting flows to node-red: Status ${response.status}, ${response.statusText}, ${await response.text()}`);
}

/**
 * Listens to Node-Red flow changes.
 *
 * @param {string} nodeRedUrl - The URL to Node-Red.
 * @param {string[]} topics - The topics to listen to.
 * @param {string | null} authToken - The authentication token to use. If no authentication is enabled, set this to null.
 * @param {(event: { topic: string; data: any }) => void} callback - The callback to call when a new flow change is received.
 */
export function listenToFlowsChange(nodeRedUrl: string, topics: string[], authToken: string | null, callback: (event: { topic: string; data: any }) => void) {
    // Build the URL and create the WebSocket
    nodeRedUrl = nodeRedUrl.endsWith('/') ? `${nodeRedUrl}comms` : `${nodeRedUrl}/comms`;
    const ws = new WebSocket(nodeRedUrl);

    const retryDelay = 1000;
    const maxRetryDelay = 30000;
    let delay = retryDelay;

    function subscribe() {
        for (let topic of topics) ws.send(JSON.stringify({ subscribe: topic }));
    }

    // On open
    ws.on('open', () => {
        console.log('WS: connected');
        delay = retryDelay;

        // Auth first
        if (authToken) ws.send(JSON.stringify({ auth: authToken }));
        // Then subscribe
        else subscribe();
    });

    ws.on('message', (data) => {
        try {
            let events = JSON.parse(data.toString());

            // If this is the auth response then subscribe to the next event
            if (events.auth) {
                if (events.auth === 'ok') {
                    subscribe();
                    console.log('WS: auth ok');
                } else {
                    console.error('WS ERROR: auth failed');
                }
            } else {
                if (!Array.isArray(events)) events = [events];
                for (let event of events) if (topics.includes(event.topic)) callback(event);
            }
        } catch {
            console.log('WS raw:', data.toString());
        }
    });

    ws.on('close', () => {
        console.log(`WS closed, retrying in ${delay}ms`);
        setTimeout(() => listenToFlowsChange(nodeRedUrl, topics, authToken, callback), delay);
        delay = Math.min(delay * 2, maxRetryDelay);
    });

    ws.on('error', (error) => {
        console.error('WS ERROR:', error);
        ws.close();
    });

    return ws;
}
