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
    else if (response.status === 409) throw new Error('Conflict error, the flows have been modified since last retrieved. Please fetch the latest flows and try again.');
    else throw new Error(`Posting flows to node-red: ${response.status}, ${response.statusText}, ${await response.text()}`);
}

/**
 * Listens to Node-Red flow changes.
 *
 * @param {string} nodeRedUrl - The URL to Node-Red.
 * @param {string[]} topics - The topics to listen to.
 * @param {string | null} authToken - The authentication token to use. If no authentication is enabled, set this to null.
 * @param {(event: { topic: string; data: any }) => void} callback - The callback to call when a new flow change is received.
 */
export function listenToFlowsChange(nodeRedUrl: string, authToken: string | null, callback: (event: { topic: string; data: any }) => void) {
    // Build the URL and create the WebSocket
    nodeRedUrl = nodeRedUrl.endsWith('/') ? `${nodeRedUrl}comms` : `${nodeRedUrl}/comms`;
    const ws = new WebSocket(nodeRedUrl);
    // The topics to listen to
    const topics: string[] = ['notification/runtime-deploy'];

    // If disconnected, retry with exponential backoff
    const retryDelay = 1000;
    const maxRetryDelay = 30000;
    let delay = retryDelay;

    // Subscribe to topics
    function subscribe() {
        for (let topic of topics) ws.send(JSON.stringify({ subscribe: topic }));
    }

    // On WebSocket On events. Send auth if needed, then subscribe to topics.
    ws.on('open', () => {
        console.log('WS: connected');
        // Reset the delay on successful connection
        delay = retryDelay;
        // If there is a token then send it.
        if (authToken) ws.send(JSON.stringify({ auth: authToken }));
        // Otherwise subscribe to topics immediately.
        else subscribe();
    });

    // On WebSocket message
    ws.on('message', (data) => {
        try {
            // Parse the event.
            let events = JSON.parse(data.toString());
            if (!Array.isArray(events)) events = [events];

            // Process all the events
            for (let event of events) {
                // If this is the auth response then subscribe to the next event
                if (event.auth) {
                    if (event.auth === 'ok') {
                        console.log('WS: auth ok');
                        subscribe();
                    } else {
                        console.error('WS ERROR: auth failed');
                        // TODO: Close connection and stop retrying?
                    }
                }
                // Otherwise if the topic is in the list then call the callback
                else if (topics.includes(event.topic)) callback(event);
            }
        } catch {
            console.log('WS raw:', data.toString());
        }
    });

    // On WebSocket close, retry connection with exponential backoff
    ws.on('close', () => {
        console.log(`WS closed, retrying in ${delay}ms`);
        setTimeout(() => listenToFlowsChange(nodeRedUrl, authToken, callback), delay);
        delay = Math.min(delay * 2, maxRetryDelay);
    });

    // On WebSocket error. Log the error and close the connection to trigger a reconnect.
    ws.on('error', (error) => {
        console.error('WS ERROR:', error);
        ws.close();
    });
}
