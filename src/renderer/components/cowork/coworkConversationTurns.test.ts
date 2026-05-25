import { describe, expect, test } from 'vitest';

import type { CoworkMessage } from '../../types/cowork';
import {
  buildConversationTurns,
  buildDisplayItems,
  getToolResultDisplay,
  getToolResultDisplayPreview,
  hasRenderableAssistantContent,
  isLargeToolResultMessage,
  TOOL_RESULT_DISPLAY_MAX_CHARS,
} from './coworkConversationTurns';

const createMessage = (message: Partial<CoworkMessage> & Pick<CoworkMessage, 'id' | 'type'>): CoworkMessage => ({
  content: '',
  timestamp: 1,
  ...message,
});

describe('coworkConversationTurns', () => {
  test('matches tool results to the preceding tool use by toolUseId', () => {
    const toolUse = createMessage({
      id: 'tool-use-1',
      type: 'tool_use',
      metadata: {
        toolUseId: 'tool-1',
      },
    });
    const assistant = createMessage({
      id: 'assistant-1',
      type: 'assistant',
      content: 'done',
    });
    const toolResult = createMessage({
      id: 'tool-result-1',
      type: 'tool_result',
      metadata: {
        toolUseId: 'tool-1',
        toolResult: 'success',
      },
    });

    const items = buildDisplayItems([toolUse, assistant, toolResult]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: 'tool_group',
      toolUse: { id: 'tool-use-1' },
      toolResult: { id: 'tool-result-1' },
    });
    expect(items[1]).toMatchObject({
      type: 'message',
      message: { id: 'assistant-1' },
    });
  });

  test('falls back to adjacent pairing when toolUseId is missing', () => {
    const toolUse = createMessage({
      id: 'tool-use-1',
      type: 'tool_use',
    });
    const toolResult = createMessage({
      id: 'tool-result-1',
      type: 'tool_result',
      metadata: {
        toolResult: 'success',
      },
    });

    const items = buildDisplayItems([toolUse, toolResult]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'tool_group',
      toolUse: { id: 'tool-use-1' },
      toolResult: { id: 'tool-result-1' },
    });
  });

  test('starts an orphan turn for assistant-only history and then opens a new user turn', () => {
    const assistant = createMessage({
      id: 'assistant-1',
      type: 'assistant',
      content: '历史回答',
    });
    const system = createMessage({
      id: 'system-1',
      type: 'system',
      content: '系统提示',
    });
    const user = createMessage({
      id: 'user-1',
      type: 'user',
      content: '新的问题',
    });
    const answer = createMessage({
      id: 'assistant-2',
      type: 'assistant',
      content: '新的回答',
    });

    const turns = buildConversationTurns(buildDisplayItems([assistant, system, user, answer]));

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      id: 'orphan-0',
      userMessage: null,
    });
    expect(turns[0]?.assistantItems.map((item) => item.type)).toEqual(['assistant', 'system']);
    expect(turns[1]).toMatchObject({
      id: 'user-1',
      userMessage: { id: 'user-1' },
    });
    expect(turns[1]?.assistantItems.map((item) => item.type)).toEqual(['assistant']);
  });

  test('treats thinking as renderable assistant content after streaming ends', () => {
    const turns = buildConversationTurns(buildDisplayItems([
      createMessage({
        id: 'user-1',
        type: 'user',
        content: '帮我想一下',
      }),
      createMessage({
        id: 'thinking-1',
        type: 'assistant',
        content: '我需要先分析约束。',
        metadata: {
          isThinking: true,
          isStreaming: false,
        },
      }),
    ]));

    expect(hasRenderableAssistantContent(turns[0]!)).toBe(true);
  });

  test('filters silent NO_REPLY assistant messages from display items', () => {
    const items = buildDisplayItems([
      createMessage({
        id: 'assistant-silent',
        type: 'assistant',
        content: '`NO_REPLY`',
      }),
      createMessage({
        id: 'assistant-visible',
        type: 'assistant',
        content: '可见回答',
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'message',
      message: { id: 'assistant-visible' },
    });
  });

  test('starts a new orphan turn after context compaction system message', () => {
    const turns = buildConversationTurns(buildDisplayItems([
      createMessage({
        id: 'assistant-before',
        type: 'assistant',
        content: '压缩前回答',
      }),
      createMessage({
        id: 'compaction',
        type: 'system',
        content: '上下文压缩完成',
        metadata: {
          kind: 'context_compaction',
          status: 'completed',
        },
      }),
      createMessage({
        id: 'assistant-after',
        type: 'assistant',
        content: '压缩后回答',
      }),
    ]));

    expect(turns).toHaveLength(2);
    expect(turns[0]?.assistantItems.map((item) => (
      item.type === 'assistant' || item.type === 'system' ? item.message.id : item.type
    ))).toEqual(['assistant-before']);
    expect(turns[1]?.assistantItems.map((item) => (
      item.type === 'assistant' || item.type === 'system' ? item.message.id : item.type
    ))).toEqual(['compaction', 'assistant-after']);
  });

  test('strips trailing media tokens from tool result display text', () => {
    const message = createMessage({
      id: 'tool-result-media',
      type: 'tool_result',
      content: 'saved image\nMEDIA: `/tmp/chart.png`',
    });

    expect(getToolResultDisplay(message)).toBe('saved image');
  });

  test('normalizes tool result error tags before visibility checks', () => {
    const message = createMessage({
      id: 'tool-result-1',
      type: 'tool_result',
      content: '\u001B[31m<tool_use_error> permission denied </tool_use_error>\u001B[0m',
    });

    expect(getToolResultDisplay(message)).toBe('permission denied');
  });

  test('truncates only the UI preview for very large tool results', () => {
    const content = `${'a'.repeat(TOOL_RESULT_DISPLAY_MAX_CHARS)}tail`;
    const message = createMessage({
      id: 'tool-result-large',
      type: 'tool_result',
      content,
    });

    expect(isLargeToolResultMessage(message)).toBe(true);
    expect(getToolResultDisplay(message)).toBe(content);
    expect(getToolResultDisplayPreview(message)).toHaveLength(TOOL_RESULT_DISPLAY_MAX_CHARS);
  });
});
