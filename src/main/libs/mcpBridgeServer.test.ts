import { afterEach, describe, expect, test } from 'vitest';

import { McpBridgeServer } from './mcpBridgeServer';

const servers: McpBridgeServer[] = [];

const startServer = async (secret = 'test-secret'): Promise<McpBridgeServer> => {
  const server = new McpBridgeServer(secret);
  servers.push(server);
  await server.start();
  return server;
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe('McpBridgeServer AskUser-only endpoint', () => {
  test('resolves ask-user requests through the registered callback', async () => {
    const secret = 'ask-user-secret';
    const server = await startServer(secret);
    const callbackUrl = server.askUserCallbackUrl;
    expect(callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/askuser$/);

    server.onAskUser((request) => {
      expect(request.questions).toHaveLength(1);
      server.resolveAskUser(request.requestId, {
        behavior: 'allow',
        answers: { choice: 'Allow' },
      });
    });

    const response = await fetch(callbackUrl!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ask-user-secret': secret,
      },
      body: JSON.stringify({
        questions: [{
          question: 'Allow this operation?',
          options: [{ label: 'Allow' }, { label: 'Deny' }],
        }],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      behavior: 'allow',
      answers: { choice: 'Allow' },
    });
  });

  test('rejects ask-user requests without the shared secret', async () => {
    const server = await startServer('secret-required');

    const response = await fetch(server.askUserCallbackUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        questions: [{
          question: 'Should fail?',
          options: [{ label: 'Allow' }],
        }],
      }),
    });

    expect(response.status).toBe(401);
  });

  test('does not expose the legacy MCP execute endpoint', async () => {
    const secret = 'ask-user-only';
    const server = await startServer(secret);
    const executeUrl = server.askUserCallbackUrl!.replace('/askuser', `/mcp/${'execute'}`);

    const response = await fetch(executeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mcp-bridge-secret': secret,
      },
      body: JSON.stringify({ server: 'legacy', tool: 'noop', args: {} }),
    });

    expect(response.status).toBe(404);
  });
});
