export const config = {
    /**
     * The base URL to Node-Red. If there is a port, include it within the URL.
     */
    nodeRedUrl: 'https://node-red.mydomain.lan',

    /**
     * Allow self-signed certificates. This is required if you are using self-signed certificates to access Node-Red.
     */
    allowSelfSignedCertificates: true,

    /**
     * If no authentication is enabled within Node-Red, set this to null.
     * If authentication is enabled within Node-Red the bearer token can be provided here.
     * The token can be found within the root folder of Node-Red within the `.sessions` files.
     */
    bearerToken: null,

    /**
     * The full path where to output the source files.
     * It can be on your local machine and does not need to be located within the node-red folder.
     * The source folder is rebuilt from the latest node-red flows files.
     *
     * If not specified then uses the location of the config file as the source path.
     */
    sourcePath: '~/Projects/iot-node-red-src',

    /**
     * If set to true then the source folder will be cleared before building the source files.
     */
    cleanOnStart: true,

    /**
     * Delay in milliseconds to wait after a file change is detected before starting the rebuild process.
     * This helps to avoid multiple rebuilds when multiple files are changed in quick succession.
     */
    fileChangeDelay: 1000
};
