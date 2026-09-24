// Assistant backend that drives the user's own Claude Code install (`claude -p`, headless) so no API key is needed.
// Tempo's calendar tools are exposed to it through a tiny MCP server on a random localhost port.
const { app } = require('electron');
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { SYSTEM, TOOLS, runTool, nowLine, toolLabel } = require('./tools');

const TURN_TIMEOUT_MS = 3 * 60 * 1000;

let mcp = null;      // { server, port, token }
let proc = null;
let turn = null;     // { emit, resolve, reject, timer }
let busy = false;
let stderrTail = '';
const pendingTools = new Map();

// ---- MCP server (JSON-RPC over HTTP) ------------------------------------------

function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

function handleRpc(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return null; // notification
  switch (method) {
    case 'initialize':
      return rpcResult(id, { protocolVersion: params?.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'tempo', version: '0.1.0' } });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
    case 'tools/call':
      try {
        return rpcResult(id, { content: [{ type: 'text', text: runTool(params.name, params.arguments || {}) }] });
      } catch (err) {
        return rpcResult(id, { content: [{ type: 'text', text: err.message }], isError: true });
      }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function startMcp() {
  if (mcp) return Promise.resolve(mcp);
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      const replies = (Array.isArray(parsed) ? parsed : [parsed]).map(handleRpc).filter(Boolean);
      if (!replies.length) { res.writeHead(202).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => { mcp = { server, port: server.address().port, token }; resolve(mcp); });
  });
}

// ---- claude process ---------------------------------------------------------------

function findClaude() {
  try {
    const found = execFileSync('where', ['claude'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const exe = found.find((p) => p.toLowerCase().endsWith('.exe'));
    if (exe) return exe;
  } catch { /* fall through */ }
  const guess = path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe');
  if (fs.existsSync(guess)) return guess;
  throw new Error('Claude Code was not found. Install it, or switch the assistant to an Anthropic API key in Settings.');
}

async function ensureProc() {
  if (proc) return;
  const { port, token } = await startMcp();
  const dir = path.join(app.getPath('userData'), 'claude-cwd'); // neutral folder: no project CLAUDE.md gets picked up
  fs.mkdirSync(dir, { recursive: true });
  const cfg = path.join(dir, 'mcp.json');
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { tempo: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }));

  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--strict-mcp-config', '--mcp-config', cfg, '--allowedTools', 'mcp__tempo',
    '--system-prompt', SYSTEM, '--disable-slash-commands', '--setting-sources', '', '--no-session-persistence',
    '--model', store.get().settings.ccModel || 'sonnet', '--effort', 'low',
  ];
  stderrTail = '';
  const child = spawn(findClaude(), args, { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  proc = child;

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      try { onEvent(JSON.parse(line)); } catch { /* ignore non-JSON noise */ }
    }
  });
  child.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString('utf8')).slice(-2000); });
  child.on('exit', (code) => {
    if (proc === child) proc = null;
    if (turn) finishTurn(new Error(friendlyError(stderrTail) || `Claude Code stopped unexpectedly (exit ${code}).`));
  });
  child.on('error', (err) => { if (proc === child) proc = null; if (turn) finishTurn(err); });
}

function friendlyError(text) {
  if (/not logged in|\/login|authenticat|credential/i.test(text)) return 'Claude Code is not signed in. Run `claude` in a terminal, use /login, then try again.';
  return text.trim().split('\n').pop();
}

let deltaSeen = false;

function onEvent(ev) {
  if (!turn) return;
  const { emit } = turn;
  if (ev.type === 'stream_event') {
    const e = ev.event;
    if (e.type === 'message_start') deltaSeen = false;
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') { deltaSeen = true; emit({ type: 'text', delta: e.delta.text }); }
  } else if (ev.type === 'assistant') {
    for (const b of ev.message?.content || []) {
      if (b.type === 'tool_use') pendingTools.set(b.id, b);
      if (b.type === 'text' && !deltaSeen && b.text) emit({ type: 'text', delta: b.text });
    }
  } else if (ev.type === 'user') {
    for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) {
      if (b.type !== 'tool_result') continue;
      const use = pendingTools.get(b.tool_use_id);
      pendingTools.delete(b.tool_use_id);
      const name = (use?.name || '').replace(/^mcp__tempo__/, '');
      const label = toolLabel(name, use?.input || {});
      emit({ type: 'tool', label: b.is_error ? `${label} failed` : label, ok: !b.is_error });
    }
  } else if (ev.type === 'result') {
    finishTurn(ev.is_error ? new Error(friendlyError(String(ev.result || '')) || 'Claude Code returned an error.') : null);
  }
}

function finishTurn(err) {
  const t = turn; turn = null;
  if (!t) return;
  clearTimeout(t.timer);
  if (err) t.reject(err); else t.resolve();
}

async function chat(text, emit) {
  if (busy) throw new Error('Still working on the previous message.');
  busy = true;
  try {
    await ensureProc();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stop(); finishTurn(new Error('Claude Code took too long to respond.')); }, TURN_TIMEOUT_MS);
      turn = { emit, resolve, reject, timer };
      proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: `${nowLine()}\n\n${text}` } })}\n`);
    });
  } finally {
    busy = false;
    emit({ type: 'end' });
  }
}

function stop() {
  if (proc) { proc.kill(); proc = null; }
  pendingTools.clear();
}

const reset = () => stop(); // a fresh process is a fresh conversation

module.exports = { chat, reset, stop };
