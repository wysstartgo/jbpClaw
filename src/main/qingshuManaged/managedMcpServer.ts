import { randomUUID } from 'crypto';
import http from 'http';
import net from 'net';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { QingShuManagedToolRuntime } from '../../shared/qingshuManaged/constants';
import type { QingShuManagedCatalogService } from './catalogService';

type TransportEntry = {
  server: Server;
  transport: StreamableHTTPServerTransport;
};

type ToolInputSchema = {
  type: 'object';
  properties?: Record<string, object>;
  required?: string[];
  [key: string]: unknown;
};

export type QingShuManagedMcpServerConfig = {
  name: string;
  transportType: 'http';
  url: string;
  headers: Record<string, string>;
};

const SECRET_HEADER = 'x-qingshu-managed-mcp-secret';

const normalizeToolInputSchema = (inputSchema: Record<string, unknown>): ToolInputSchema => {
  const normalized: ToolInputSchema = {
    ...inputSchema,
    type: 'object',
  };
  if (
    normalized.properties !== undefined
    && (typeof normalized.properties !== 'object' || Array.isArray(normalized.properties))
  ) {
    delete normalized.properties;
  }
  if (normalized.required !== undefined && !Array.isArray(normalized.required)) {
    delete normalized.required;
  }
  return normalized;
};

export class QingShuManagedMcpServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private startPromise: Promise<QingShuManagedMcpServerConfig | null> | null = null;
  private readonly secret = randomUUID();
  private readonly transports = new Map<string, TransportEntry>();

  constructor(private readonly catalogService: QingShuManagedCatalogService) {}

  getServerConfig(): QingShuManagedMcpServerConfig | null {
    if (!this.port || this.catalogService.getManagedToolRuntimeManifest().length === 0) {
      return null;
    }
    return {
      name: QingShuManagedToolRuntime.ServerName,
      transportType: 'http',
      url: `http://127.0.0.1:${this.port}/mcp`,
      headers: {
        [SECRET_HEADER]: this.secret,
      },
    };
  }

  async start(): Promise<QingShuManagedMcpServerConfig | null> {
    if (this.server) {
      return this.getServerConfig();
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      const port = await this.findFreePort();
      await new Promise<void>((resolve, reject) => {
        const server = http.createServer((req, res) => {
          this.handleRequest(req, res).catch((error) => {
            console.error('[QingShuManagedMcp] request handling failed:', error);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
            }
            if (!res.writableEnded) {
              res.end(JSON.stringify({ error: 'Internal server error' }));
            }
          });
        });

        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          this.server = server;
          this.port = port;
          console.log(`[QingShuManagedMcp] server listening on http://127.0.0.1:${port}/mcp`);
          resolve();
        });
      });

      return this.getServerConfig();
    })().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  async stop(): Promise<void> {
    await this.startPromise?.catch((): null => null);
    for (const entry of this.transports.values()) {
      await entry.transport.close().catch(() => {});
      await entry.server.close().catch(() => {});
    }
    this.transports.clear();

    if (!this.server) {
      this.port = null;
      return;
    }

    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
      setTimeout(() => this.server?.closeAllConnections?.(), 2000);
    });
    this.server = null;
    this.port = null;
    console.log('[QingShuManagedMcp] server stopped');
  }

  private createMcpServer(): Server {
    const server = new Server(
      {
        name: QingShuManagedToolRuntime.ServerName,
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
          },
        },
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.catalogService.getManagedToolRuntimeManifest().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: normalizeToolInputSchema(tool.inputSchema),
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const result = await this.catalogService.invokeManagedMcpTool(
        request.params.name,
        request.params.arguments ?? {},
        { signal: extra.signal },
      );
      return {
        content: result.content.map((item) => ({
          type: 'text' as const,
          text: item.text ?? '',
        })),
        isError: result.isError,
      };
    });

    return server;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const headerValue = req.headers[SECRET_HEADER];
    if (headerValue !== this.secret) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const parsedBody = req.method === 'POST' ? await this.readJsonBody(req) : undefined;
    const sessionId = Array.isArray(req.headers['mcp-session-id'])
      ? req.headers['mcp-session-id'][0]
      : req.headers['mcp-session-id'];
    let entry = sessionId ? this.transports.get(sessionId) : undefined;

    if (!entry) {
      if (req.method !== 'POST' || !isInitializeRequest(parsedBody)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        }));
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (initializedSessionId) => {
          this.transports.set(initializedSessionId, { server, transport });
        },
      });
      const server = this.createMcpServer();
      transport.onclose = () => {
        const closedSessionId = transport.sessionId;
        if (closedSessionId) {
          this.transports.delete(closedSessionId);
        }
      };
      await server.connect(transport);
      entry = { server, transport };
    }

    await entry.transport.handleRequest(req, res, parsedBody);
  }

  private readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.once('listening', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        server.close(() => resolve(port));
      });
      server.listen(0, '127.0.0.1');
    });
  }
}

export const __qingShuManagedMcpServerTestUtils = {
  normalizeToolInputSchema,
  SECRET_HEADER,
};
