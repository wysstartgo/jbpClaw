import { describe, expect, test } from 'vitest';

import type { CoworkMessage } from '../../types/cowork';
import { collectCoworkSessionArtifacts } from './coworkArtifacts';
import { TOOL_RESULT_DISPLAY_MAX_CHARS } from './coworkConversationTurns';

const makeMessage = (overrides: Partial<CoworkMessage>): CoworkMessage => ({
  id: 'msg-1',
  type: 'assistant',
  content: '',
  timestamp: 1,
  metadata: {},
  ...overrides,
});

describe('collectCoworkSessionArtifacts', () => {
  test('deduplicates tool path and markdown file link by normalized path', () => {
    const messages: CoworkMessage[] = [
      makeMessage({
        id: 'tool-1',
        type: 'tool_use',
        metadata: {
          toolName: 'Write',
          toolUseId: 'write-1',
          toolInput: {
            file_path: 'D:\\workspace\\report.md',
            content: '# Report',
          },
        },
      }),
      makeMessage({
        id: 'result-1',
        type: 'tool_result',
        content: 'OK',
        metadata: { toolUseId: 'write-1' },
      }),
      makeMessage({
        id: 'assistant-1',
        type: 'assistant',
        content: '已生成：[report.md](file:///D:/workspace/report.md)',
      }),
    ];

    const artifacts = collectCoworkSessionArtifacts(messages, 'session-1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: 'artifact-tool-tool-1',
      filePath: 'D:\\workspace\\report.md',
      content: '# Report',
    });
  });

  test('does not duplicate markdown file links as plain file paths', () => {
    const messages: CoworkMessage[] = [
      makeMessage({
        id: 'assistant-1',
        type: 'assistant',
        content: '已生成：[hello.html](file:///D:/workspace/hello.html)',
      }),
    ];

    const artifacts = collectCoworkSessionArtifacts(messages, 'session-1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: 'artifact-link-assistant-1-0',
      filePath: 'D:/workspace/hello.html',
      type: 'html',
    });
  });

  test('collects localhost service URLs as local-service artifacts', () => {
    const messages: CoworkMessage[] = [
      makeMessage({
        id: 'assistant-1',
        type: 'assistant',
        content: '服务已启动：[预览页面](http://localhost:4173/login-react.html)',
      }),
    ];

    const artifacts = collectCoworkSessionArtifacts(messages, 'session-1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: 'artifact-local-service-assistant-1-0',
      type: 'local-service',
      title: '预览页面',
      url: 'http://localhost:4173/login-react.html',
    });
  });

  test('keeps codeblock artifacts and ignores thinking messages', () => {
    const messages: CoworkMessage[] = [
      makeMessage({
        id: 'thinking-1',
        type: 'assistant',
        content: '```html\n<div>hidden</div>\n```',
        metadata: { isThinking: true },
      }),
      makeMessage({
        id: 'assistant-1',
        type: 'assistant',
        content: '```artifact:html title="Demo"\n<html></html>\n```',
      }),
    ];

    const artifacts = collectCoworkSessionArtifacts(messages, 'session-1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: 'artifact-assistant-1-0',
      type: 'html',
      title: 'Demo',
      source: 'codeblock',
    });
  });

  test('extracts file paths from tool result display text', () => {
    const messages: CoworkMessage[] = [
      makeMessage({
        id: 'result-1',
        type: 'tool_result',
        content: 'saved at /tmp/output.pdf',
      }),
    ];

    const artifacts = collectCoworkSessionArtifacts(messages, 'session-1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: 'artifact-toolresult-result-1-0',
      filePath: '/tmp/output.pdf',
      type: 'document',
    });
  });

  test('skips direct path scanning for very large tool results', () => {
    const messages: CoworkMessage[] = [
      makeMessage({
        id: 'result-1',
        type: 'tool_result',
        content: `${'x'.repeat(TOOL_RESULT_DISPLAY_MAX_CHARS + 1)} /tmp/huge-output.pdf`,
      }),
    ];

    const artifacts = collectCoworkSessionArtifacts(messages, 'session-1');

    expect(artifacts).toHaveLength(0);
  });
});
