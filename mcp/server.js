// MCP server that lets an agent (e.g. Claude Code) drive open-lovable.
// The agent is the "AI"; this only proxies to the running Next app (`npm run dev`),
// so sandbox state lives in one place and the web UI sees the same sandbox.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = process.env.OPEN_LOVABLE_URL || 'http://localhost:3000';

async function call(path, body) {
  let res;
  try {
    res = await fetch(BASE + path, body === undefined
      ? { method: 'GET' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(`open-lovable não respondeu em ${BASE}. Rode \`npm run dev\` no projeto. (${e.message})`);
  }
  const text = await res.text();
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) return text;
  // SSE: keep only the events that matter for the agent.
  const events = text.split('\n')
    .filter(l => l.startsWith('data: '))
    .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
    .filter(e => e && ['complete', 'error', 'file-error', 'command-error', 'warning'].includes(e.type));
  return JSON.stringify(events, null, 2);
}

const ok = text => ({ content: [{ type: 'text', text }] });

const server = new McpServer({ name: 'open-lovable', version: '0.1.0' });

server.registerTool('create_sandbox', {
  description: 'Cria um sandbox novo com um app React + Vite + Tailwind rodando. Retorna a URL do preview. Substitui o sandbox ativo.',
}, async () => ok(await call('/api/create-ai-sandbox-v2', {})));

server.registerTool('sandbox_status', {
  description: 'Mostra se há sandbox ativo e a URL do preview.',
}, async () => ok(await call('/api/sandbox-status')));

server.registerTool('write_files', {
  description: 'Cria ou sobrescreve arquivos no sandbox ativo (conteúdo completo de cada arquivo, ex. src/App.jsx). Pacotes importados são instalados automaticamente.',
  inputSchema: {
    files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
  },
}, async ({ files }) => {
  const response = files.map(f => `<file path="${f.path}">\n${f.content}\n</file>`).join('\n\n');
  return ok(await call('/api/apply-ai-code-stream', { response, isEdit: true }));
});

server.registerTool('run_command', {
  description: 'Roda um comando shell no sandbox (ler arquivos com cat/find, ver logs do Vite com `tail -50 /tmp/vite.log`, etc.).',
  inputSchema: { command: z.string() },
}, async ({ command }) => ok(await call('/api/run-command-v2', { command })));

server.registerTool('install_packages', {
  description: 'Instala pacotes npm no sandbox.',
  inputSchema: { packages: z.array(z.string()).min(1) },
}, async ({ packages }) => ok(await call('/api/install-packages-v2', { packages })));

server.registerTool('scrape_url', {
  description: 'Copia o conteúdo de um site (via Firecrawl) em markdown, para recriá-lo como app React.',
  inputSchema: { url: z.string().url() },
}, async ({ url }) => ok(await call('/api/scrape-url-enhanced', { url })));

server.registerTool('kill_sandbox', {
  description: 'Encerra o sandbox ativo.',
}, async () => ok(await call('/api/kill-sandbox', {})));

await server.connect(new StdioServerTransport());
