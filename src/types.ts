export type Config = {
    nodeRedUrl: string;
    bearerToken?: string;
    allowSelfSignedCertificates?: boolean;

    sourcePath: string;
    cleanOnStart?: boolean;

    fileChangeDelay?: number;
};

export type FlowItem = {
    id: string;
    type: 'tab' | 'subflow' | 'function' | 'ui-template';
    label: string;
    name: string;
    z?: string;
    func?: string;
    format?: string;
    initialize?: string;
    finalize?: string;
    info?: string;
};

export type Flows = FlowItem[];

export type FlowsResponse = {
    flows: Flows;
    rev: string;
};

export type ManifestFolder = {
    id: string; // The id as found in the flows file
    type: string; // The type of the folder, either 'tab' | 'subflow';
    name: string; // The name as found in the flows file (label for tabs, name for subflows)
    folderName: string; // This is the sanitized and unique folder name.
};

export type ManifestFile = {
    type: 'format' | 'func' | 'initialize' | 'finalize' | 'info';
    name: string; // The baseFileName including extensions based on the type.
    content: string;
    modifiedTime?: number;
};

export type ManifestItem = {
    id: string; // The id as found in the flows file
    type: string; // The type of the item, either 'function' | 'ui-template';
    name: string; // The item name as found in the flows file
    folderName: string; // The sanitized folder name.
    baseFileName: string; // The sanitized file name including increments if files with the name already exists.
    files: ManifestFile[];
};

export type Manifest = {
    folders: { [id: string]: ManifestFolder };
    files: { [id: string]: ManifestItem };
    filesMap: Map<string, string>;
    rev?: string;
};

// This can be extended to include other node types if needed. The code not change only need to add the flow/node type, code properties, file extensions, etc.

export type FlowFileProperty = {
    type: 'func' | 'format' | 'initialize' | 'finalize' | 'info';
    extension: '.js' | '.vue' | '.initialize.js' | '.finalize.js' | '.info.md';
};

export type FlowFolderProperty = {
    type: 'tab' | 'subflow';
    name: 'label' | 'name';
};

export const flowFilesProperties: FlowFileProperty[] = [
    { type: 'func', extension: '.js' },
    { type: 'format', extension: '.vue' },
    { type: 'initialize', extension: '.initialize.js' },
    { type: 'finalize', extension: '.finalize.js' },
    { type: 'info', extension: '.info.md' }
];

export const flowFolderProperties: { [key: string]: FlowFolderProperty } = {
    tab: { type: 'tab', name: 'label' },
    subflow: { type: 'subflow', name: 'name' }
};

export const supportedFlowFileTypes = ['function', 'ui-template'];

export type App = {
    config: Config;
    configBasePath: string;
    configFilePath: string;

    flows: Flows | null;
    revision: string | null;
    manifest: Manifest | null;
};
