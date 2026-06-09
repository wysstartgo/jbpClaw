import http from 'http';
import { net } from 'electron';

const PROXY_BIND_HOST = '127.0.0.1';
const QINGSHU_CLAW_PROXY_PREFIX = '/api/qingshu-claw/proxy';
const LOG_BODY_PREVIEW_LIMIT = 500;

let proxyServer: http.Server | null = null;
let proxyPort: number | null = null;

// Injected dependencies
let tokenGetter: (() => { accessToken: string; refreshToken: string } | null) | null = null;
let tokenRefresher: ((reason: string) => Promise<string | null>) | null = null;
let serverBaseUrlGetter: (() => string) | null = null;

export type OpenClawTokenProxyConfig = {
  getAuthTokens: () => { accessToken: string; refreshToken: string } | null;
  refreshToken: (reason: string) => Promise<string | null>;
  getServerBaseUrl: () => string;
};

export function startOpenClawTokenProxy(config: OpenClawTokenProxyConfig): Promise<{ port: number }> {
  tokenGetter = config.getAuthTokens;
  tokenRefresher = config.refreshToken;
  serverBaseUrlGetter = config.getServerBaseUrl;

  return new Promise((resolve, reject) => {
    if (proxyServer) {
      if (proxyPort) {
        resolve({ port: proxyPort });
        return;
      }
      reject(new Error('Token proxy is starting'));
      return;
    }

    const server = http.createServer(handleRequest);

    server.listen(0, PROXY_BIND_HOST, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        proxyPort = addr.port;
        proxyServer = server;
        console.log(`[OpenClawTokenProxy] started on ${PROXY_BIND_HOST}:${proxyPort}`);
        resolve({ port: proxyPort });
      } else {
        server.close();
        reject(new Error('Failed to bind token proxy'));
      }
    });

    server.on('error', (err) => {
      console.error('[OpenClawTokenProxy] server error:', err);
      reject(err);
    });
  });
}

export function stopOpenClawTokenProxy(): void {
  if (proxyServer) {
    proxyServer.close();
    proxyServer = null;
    proxyPort = null;
    console.log('[OpenClawTokenProxy] stopped');
  }
}

export function getOpenClawTokenProxyPort(): number | null {
  return proxyPort;
}

function summarizeAccessToken(accessToken?: string | null): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    present: Boolean(accessToken),
    length: accessToken?.length || 0,
  };
  if (!accessToken) {
    return summary;
  }
  const parts = accessToken.split('.');
  summary.jwtLike = parts.length === 3;
  if (parts.length !== 3) {
    return summary;
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as Record<string, unknown>;
    const exp = typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    summary.expiresAt = exp ? new Date(exp).toISOString() : null;
    summary.expiresInMs = exp ? exp - Date.now() : null;
    summary.userId = payload.token_user_id ?? payload.userId ?? payload.user_id ?? payload.sub ?? null;
  } catch {
    summary.parseError = true;
  }
  return summary;
}

function summarizeUrl(url: string): Record<string, unknown> {
  try {
    const parsed = new URL(url);
    return {
      origin: parsed.origin,
      pathname: parsed.pathname,
    };
  } catch {
    return {
      raw: url.replace(/[?&](access_token|token|api_key|key)=([^&]+)/gi, '$1=***'),
    };
  }
}

function buildQingShuProxyPath(requestUrl?: string): string {
  const rawPath = requestUrl || '/';
  return `${QINGSHU_CLAW_PROXY_PREFIX}${rawPath}`;
}

function readBodyPreview(body: Buffer): string | null {
  if (!body.length) {
    return null;
  }
  return body.toString('utf8', 0, Math.min(body.length, LOG_BODY_PREVIEW_LIMIT));
}

function summarizeRequestBody(body: Buffer): Record<string, unknown> {
  if (!body.length) {
    return { present: false, bytes: 0 };
  }
  try {
    const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    return {
      present: true,
      bytes: body.length,
      model: typeof parsed.model === 'string' ? parsed.model : null,
      messageCount: messages.length,
      stream: parsed.stream === true,
      maxTokens: parsed.max_tokens ?? parsed.maxTokens ?? null,
    };
  } catch {
    return {
      present: true,
      bytes: body.length,
      parseError: true,
      preview: readBodyPreview(body),
    };
  }
}

function collectRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const tokens = tokenGetter?.();
    const serverBaseUrl = serverBaseUrlGetter?.();

    if (!tokens?.accessToken || !serverBaseUrl) {
      console.warn('[OpenClawTokenProxy] rejecting QingShu server request because auth context is missing:', {
        hasTokens: Boolean(tokens),
        hasAccessToken: Boolean(tokens?.accessToken),
        hasServerBaseUrl: Boolean(serverBaseUrl),
      });
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No auth tokens available' }));
      return;
    }

    const body = await collectRequestBody(req);

    // Build upstream URL: serverBaseUrl + request path. OpenClaw sends to
    // /v1/chat/completions; the JBP compatibility backend expects
    // /api/qingshu-claw/proxy/v1/chat/completions.
    const upstreamPath = buildQingShuProxyPath(req.url);
    const upstreamUrl = `${serverBaseUrl}${upstreamPath}`;

    console.log('[OpenClawTokenProxy] forwarding QingShu server request:', {
      method: req.method || 'POST',
      incomingPath: req.url || '/',
      upstream: summarizeUrl(upstreamUrl),
      body: summarizeRequestBody(body),
      contentType: req.headers['content-type'] || null,
      accept: req.headers.accept || null,
      token: summarizeAccessToken(tokens.accessToken),
    });

    const result = await forwardRequest(upstreamUrl, req.method || 'POST', tokens.accessToken, body, req.headers);

    if ((result.status === 401 || result.status === 403) && tokenRefresher) {
      console.warn('[OpenClawTokenProxy] QingShu server returned auth failure, attempting token refresh:', {
        status: result.status,
        upstream: summarizeUrl(upstreamUrl),
        responsePreview: Buffer.isBuffer(result.body) ? result.body.toString('utf8', 0, LOG_BODY_PREVIEW_LIMIT) : null,
      });
      const newToken = await tokenRefresher('openclaw-proxy');
      if (newToken) {
        const retryResult = await forwardRequest(upstreamUrl, req.method || 'POST', newToken, body, req.headers);
        console.log('[OpenClawTokenProxy] QingShu server retry completed:', {
          status: retryResult.status,
          upstream: summarizeUrl(upstreamUrl),
          token: summarizeAccessToken(newToken),
          responsePreview: Buffer.isBuffer(retryResult.body)
            ? retryResult.body.toString('utf8', 0, LOG_BODY_PREVIEW_LIMIT)
            : null,
        });
        pipeResponse(retryResult, res);
        return;
      }
      console.warn('[OpenClawTokenProxy] QingShu token refresh returned no token; forwarding original response');
    }

    pipeResponse(result, res);
  } catch (err) {
    console.error('[OpenClawTokenProxy] request handling error:', err);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Token proxy upstream error' }));
    }
  }
}

type UpstreamResult = {
  status: number;
  headers: Record<string, string>;
  body: NodeJS.ReadableStream | Buffer;
  isStream: boolean;
};

async function forwardRequest(
  url: string,
  method: string,
  accessToken: string,
  body: Buffer,
  incomingHeaders: http.IncomingHttpHeaders,
): Promise<UpstreamResult> {
  const startedAt = Date.now();
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'auth': `Bearer ${accessToken}`,
    'Content-Type': incomingHeaders['content-type'] || 'application/json',
  };

  // Forward accept header for SSE streaming
  if (incomingHeaders.accept) {
    headers['Accept'] = incomingHeaders.accept;
  }

  const resp = await net.fetch(url, {
    method,
    headers,
    body: body.length > 0 ? new Uint8Array(body) : undefined,
  });

  const contentType = resp.headers.get('content-type') || '';
  const isStream = contentType.includes('text/event-stream');

  const responseHeaders: Record<string, string> = {};
  resp.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  console.log('[OpenClawTokenProxy] QingShu upstream response received:', {
    status: resp.status,
    elapsedMs: Date.now() - startedAt,
    upstream: summarizeUrl(url),
    contentType,
    isStream,
  });

  if (isStream && resp.body) {
    return {
      status: resp.status,
      headers: responseHeaders,
      body: resp.body as unknown as NodeJS.ReadableStream,
      isStream: true,
    };
  }

  const respBuffer = Buffer.from(await resp.arrayBuffer());
  return {
    status: resp.status,
    headers: responseHeaders,
    body: respBuffer,
    isStream: false,
  };
}

function pipeResponse(result: UpstreamResult, res: http.ServerResponse): void {
  res.writeHead(result.status, result.headers);

  if (result.isStream && 'pipe' in result.body && typeof (result.body as NodeJS.ReadableStream).pipe === 'function') {
    (result.body as NodeJS.ReadableStream).pipe(res);
  } else if (Buffer.isBuffer(result.body)) {
    res.end(result.body);
  } else {
    // Web ReadableStream from net.fetch — need to consume manually
    const webStream = result.body as unknown as ReadableStream<Uint8Array>;
    const reader = webStream.getReader();
    const pump = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        pump();
      }).catch((err) => {
        console.error('[OpenClawTokenProxy] stream read error:', err);
        res.end();
      });
    };
    pump();
  }
}
