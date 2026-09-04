/// <reference lib="webworker" />
/**
 * Worker hosting @cucumber/language-service (WASM tree-sitter). It is loaded lazily and
 * degrades gracefully: if the WASM assets cannot be fetched the worker answers with empty
 * results and the editor keeps using the step-catalog completions.
 */
type Req =
  | { id: number; kind: 'init'; expressions: string[] }
  | { id: number; kind: 'completions'; text: string; line: number; column: number }
  | { id: number; kind: 'diagnostics'; text: string };

let service: any = null;
let expressionsList: any[] = [];
let ready = false;

async function init(expressions: string[]) {
  try {
    // The WASM assets are optional: when /wasm/ is not served (the SPA fallback answers with
    // HTML) skip the parser instead of letting Emscripten abort inside the worker.
    const head = await fetch('/wasm/tree-sitter.wasm', { method: 'HEAD' }).catch(() => null);
    const type = head?.headers.get('content-type') ?? '';
    if (!head?.ok || !type.includes('wasm')) {
      ready = false;
      return;
    }
    const ls: any = await import('@cucumber/language-service');
    const { WasmParserAdapter } = await import('@cucumber/language-service/wasm');
    const adapter = new WasmParserAdapter('/wasm');
    await adapter.init();
    const builder = new ls.ExpressionBuilder(adapter);
    const stepDefs = expressions.map((e) => ({ source: e, language: 'typescript' }));
    // The builder expects source files; we synthesise minimal step definitions from patterns.
    const src = expressions.map((e) => `Given(${JSON.stringify(e)}, () => {})`).join('\n');
    const result = builder.build([{ source: src, language: 'typescript' }], []);
    expressionsList = result.expressionLinks?.map((l: any) => l.expression) ?? [];
    service = ls;
    ready = expressionsList.length > 0 || stepDefs.length === 0;
  } catch {
    ready = false;
  }
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const msg = ev.data;
  if (msg.kind === 'init') {
    await init(msg.expressions);
    (self as any).postMessage({ id: msg.id, ok: ready });
    return;
  }
  if (!ready || !service) {
    (self as any).postMessage({ id: msg.id, result: [] });
    return;
  }
  try {
    if (msg.kind === 'completions') {
      const items = service.getGherkinCompletionItems(msg.text, msg.line, expressionsList);
      (self as any).postMessage({
        id: msg.id,
        result: items.map((i: any) => ({
          label: i.label,
          detail: i.detail,
          insertText: i.textEdit?.newText ?? i.insertText,
        })),
      });
    } else if (msg.kind === 'diagnostics') {
      const diags = service.getGherkinDiagnostics(msg.text, expressionsList);
      (self as any).postMessage({
        id: msg.id,
        result: diags.map((d: any) => ({
          line: d.range.start.line + 1,
          column: d.range.start.character + 1,
          message: d.message,
          severity: d.severity === 1 ? 'error' : 'warning',
        })),
      });
    }
  } catch {
    (self as any).postMessage({ id: msg.id, result: [] });
  }
};

export {};
