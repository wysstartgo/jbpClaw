import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { QingShuManagedCatalogService } from './catalogService';
import { __qingShuManagedMcpServerTestUtils, QingShuManagedMcpServer } from './managedMcpServer';

const activeServers: QingShuManagedMcpServer[] = [];

afterEach(async () => {
  for (const server of activeServers.splice(0, activeServers.length)) {
    await server.stop();
  }
});

const createCatalogService = (options: {
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
  invoke?: QingShuManagedCatalogService['invokeManagedMcpTool'];
} = {}): QingShuManagedCatalogService => ({
  getManagedToolRuntimeManifest: () => (options.tools ?? [
    {
      name: 'qingshu_report_query',
      description: 'Query QingShu report',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
        },
        required: ['city'],
      },
    },
  ]).map((tool) => ({
    server: 'qingshu-managed',
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {},
  })),
  invokeManagedMcpTool: options.invoke ?? (async (_toolName, args) => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true, args }) }],
    isError: false,
  })),
} as QingShuManagedCatalogService);

const connectClient = async (config: NonNullable<ReturnType<QingShuManagedMcpServer['getServerConfig']>>) => {
  const client = new Client(
    { name: 'qingshu-managed-mcp-test', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: {
      headers: config.headers,
    },
  });
  await client.connect(transport);
  return { client, transport };
};

describe('QingShuManagedMcpServer', () => {
  test('returns null config when there are no managed tools', async () => {
    const server = new QingShuManagedMcpServer(createCatalogService({ tools: [] }));
    activeServers.push(server);

    expect(await server.start()).toBeNull();
    expect(server.getServerConfig()).toBeNull();
  });

  test('exposes managed tools over streamable HTTP MCP', async () => {
    const invoke = vi.fn(async (_toolName: string, args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: `city=${String(args.city)}` }],
      isError: false,
    }));
    const server = new QingShuManagedMcpServer(createCatalogService({ invoke }));
    activeServers.push(server);

    const config = await server.start();
    expect(config).toEqual(expect.objectContaining({
      name: 'qingshu-managed',
      transportType: 'http',
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
    }));

    const { client, transport } = await connectClient(config!);
    try {
      const tools = await client.listTools();
      expect(tools.tools).toEqual([
        expect.objectContaining({
          name: 'qingshu_report_query',
          description: 'Query QingShu report',
          inputSchema: {
            type: 'object',
            properties: {
              city: { type: 'string' },
            },
            required: ['city'],
          },
        }),
      ]);

      const result = await client.callTool({
        name: 'qingshu_report_query',
        arguments: { city: '无锡' },
      });

      expect(result).toMatchObject({
        content: [{ type: 'text', text: 'city=无锡' }],
        isError: false,
      });
      expect(invoke).toHaveBeenCalledWith(
        'qingshu_report_query',
        { city: '无锡' },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      await transport.close();
      await client.close();
    }
  });

  test('reuses the same server config for concurrent start calls', async () => {
    const server = new QingShuManagedMcpServer(createCatalogService());
    activeServers.push(server);

    const [firstConfig, secondConfig] = await Promise.all([
      server.start(),
      server.start(),
    ]);

    expect(firstConfig).not.toBeNull();
    expect(secondConfig).toEqual(firstConfig);
  });

  test('rejects requests without the managed MCP secret', async () => {
    const server = new QingShuManagedMcpServer(createCatalogService());
    activeServers.push(server);

    const config = await server.start();
    expect(config).not.toBeNull();

    const response = await fetch(config!.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'unauthorized-test', version: '1.0.0' },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  test('normalizes invalid tool input schemas to MCP object schemas', () => {
    expect(__qingShuManagedMcpServerTestUtils.normalizeToolInputSchema({
      type: 'string',
      properties: [],
      required: 'city',
      extra: true,
    })).toEqual({
      type: 'object',
      extra: true,
    });
  });
});
