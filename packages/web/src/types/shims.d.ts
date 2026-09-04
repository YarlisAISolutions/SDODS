// Optional runtime-only modules loaded inside the editor Web Worker.
declare module '@cucumber/language-service/wasm' {
  export class WasmParserAdapter {
    constructor(wasmBaseUrl: string);
    init(): Promise<void>;
  }
}
