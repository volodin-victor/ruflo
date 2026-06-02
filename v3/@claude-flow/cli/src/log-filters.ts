/**
 * Console filter installed at the top of every entry point. Two jobs:
 *
 * 1. Suppress the cosmetic "[AgentDB Patch] Controller index not found"
 *    warning emitted by agentic-flow's runtime patch (it expects agentdb
 *    v1.x layout but we use v3). Tight match: requires BOTH the prefix
 *    AND the specific message. Other [AgentDB Patch] messages flow through.
 *    Audit log audit_1776483149979 flagged the previous broad filter as
 *    too aggressive — this one is tight enough to be safe.
 *
 * 2. (#2253, #2256) Redirect noisy stdout writes from upstream embedder
 *    libraries (ruvector ONNX loader, ruvector-onnx-embeddings-wasm
 *    parallel embedder) to stderr. The libraries use `console.log` for
 *    progress messages like "Loading model:" and "  Downloading: ...",
 *    which corrupts MCP JSON-RPC stdio (#2253) and is generally noise on
 *    stdout. We never want these on stdout — stderr is the right channel
 *    for progress to a TTY user, and the MCP stdio framer reads stdout
 *    only, so this keeps the protocol clean without dropping useful
 *    diagnostics.
 *
 * This file MUST be imported as the first side-effect import in any entry
 * point so the patch is in place before agentic-flow / ruvector (and
 * anything that transitively imports them) loads. ES module imports are
 * evaluated before the file's own top-level code, so putting this in
 * src/index.ts directly would race with transitive eager imports.
 */

const isCosmeticAgentdbPatchNoise = (msg: unknown): boolean => {
  const s = String(msg ?? '');
  return s.includes('[AgentDB Patch]') && s.includes('Controller index not found');
};

// #2253 / #2256: prefixes from third-party embedder libs that come out on
// stdout via console.log and corrupt MCP JSON-RPC. We redirect to stderr.
// Match is anchored to known prefixes only — anything else (e.g. legitimate
// user-facing CLI output) is unaffected.
const STDERR_REDIRECT_PREFIXES = [
  'Loading model: ',                // ruvector + ruvector-onnx-embeddings-wasm loader.js
  '  Downloading: ',                // ruvector + ruvector-onnx-embeddings-wasm loader.js
  '  Cache hit: ',                  // ruvector + ruvector-onnx-embeddings-wasm loader.js
  'Model cache cleared',            // ruvector + ruvector-onnx-embeddings-wasm loader.js
  '🚀 Initializing ',               // ruvector-onnx-embeddings-wasm parallel-embedder.mjs
  '✅ ',                            // ruvector-onnx-embeddings-wasm parallel-embedder.mjs (workers ready)
  '  Disk cache hit: ',             // ruvector-onnx-embeddings-wasm parallel-embedder.mjs
];

const shouldRedirectToStderr = (msg: unknown): boolean => {
  const s = String(msg ?? '');
  for (const prefix of STDERR_REDIRECT_PREFIXES) {
    if (s.startsWith(prefix)) return true;
  }
  return false;
};

const origWarn = console.warn.bind(console);
const origLog = console.log.bind(console);
const origError = console.error.bind(console);

console.warn = (...args: unknown[]) => {
  if (isCosmeticAgentdbPatchNoise(args[0])) return;
  origWarn(...args);
};
console.log = (...args: unknown[]) => {
  if (isCosmeticAgentdbPatchNoise(args[0])) return;
  if (shouldRedirectToStderr(args[0])) {
    origError(...args);
    return;
  }
  origLog(...args);
};
