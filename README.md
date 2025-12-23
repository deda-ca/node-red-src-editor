# node-red-src-editor

Remotely edit and synchronize Node-RED nodes within IDEs such as VS Code.

## Features

-   Remotely edit and synchronize Node-RED flows within IDEs such as VS Code.
-   TypeScript-based code using Node.js (v23.6.0^) directly with no transpilation.
-   Real-time file watching for automatic synchronization.
-   No direct access to Node-RED folders needed.
-   API integration for fetching and deploying flows to Node-RED.
-   Bidirectional conversion between Node-RED flows and source files.
-   Support for authentication via bearer tokens.
-   Optimized for very large projects and only update changed files.
-   Clear and concise logging and error handling.
-   Only 2 dependencies
    -   `chokidar` for file watching
    -   `ws` for WebSocket communication with Node-RED.

## Installation

1. Clone the repository:

    ```bash
    git clone <repository-url>
    cd node-red-src-editor
    ```

2. Install dependencies:
    ```bash
    npm install
    ```

## Configuration

1. Copy the sample configuration file:

    ```bash
    cp config-sample.js config.js
    ```

2. Edit `config.js` to match your Node-RED setup:
    - `nodeRedUrl`: The base URL to your Node-RED instance (e.g., 'https://node-red.mydomain.lan').
    - `allowSelfSignedCertificates`: Set to `true` if using self-signed certificates.
    - `bearerToken`: Provide the bearer token if authentication is enabled in Node-RED (found in `.sessions` files).
    - `sourcePath`: Full path where source files will be output (defaults to config file location if not specified).
    - `cleanOnStart`: Set to `true` to clear the source folder before building.
    - `fileChangeDelay`: Delay in milliseconds after file changes before rebuilding (default: 1000ms).

## Usage

1. Ensure Node-RED is running and accessible.

2. Run the application:

    ```bash
    npm start
    ```

3. The tool will:

    - Fetch flows from Node-RED and generate source files in the specified `sourcePath`.
    - Watch for changes in the source files and automatically deploy updates to Node-RED.

4. Edit the generated source files in your IDE (e.g., VS Code) as needed. Changes will be synchronized back to Node-RED.

## Testing

Run tests with:

```bash
npm test
```

## License

MIT License

## Author

Charbel Choueiri <charbel.choueiri@gmail.com>
