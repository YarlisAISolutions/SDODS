/// <reference types="vite/client" />
import type { SdodsBridge } from '../../preload/index.js';

declare global {
  interface Window {
    sdods: SdodsBridge;
  }
}
export {};
