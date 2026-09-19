/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ElectronAPI {
  quit: () => void;
  isElectron: boolean;
}

interface Window {
  electronAPI?: ElectronAPI;
}
