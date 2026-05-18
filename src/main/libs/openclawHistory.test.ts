import { describe, expect, test } from 'vitest';

import {
  buildScheduledReminderSystemMessage,
  extractGatewayHistoryEntries,
  extractGatewayHistoryEntry,
  extractGatewayMessageText,
  isHeartbeatAckText,
  isHeartbeatPromptText,
  isPreCompactionMemoryFlushPromptText,
  isSilentReplyPrefixText,
  isSilentReplyText,
  isTransientGatewayStatusText,
  normalizeGatewayHistoryText,
  stripTrailingSilentReplyTail,
  stripTrailingSilentReplyToken,
} from './openclawHistory';

describe('openclawHistory', () => {
  test('extracts plain text content blocks', () => {
    expect(
      extractGatewayMessageText({
        content: [{ type: 'text', text: 'hello world' }],
      })
    ).toBe('hello world');
  });

  test('extracts output_text style content blocks', () => {
    expect(
      extractGatewayMessageText({
        content: [{ type: 'output_text', text: 'gemini output' }],
      })
    ).toBe('gemini output');
  });

  test('extracts output_text object fields from responses-style messages', () => {
    expect(
      extractGatewayMessageText({
        content: [{ type: 'message', output_text: 'responses output' }],
      })
    ).toBe('responses output');
  });

  test('extracts nested parts content blocks', () => {
    expect(
      extractGatewayMessageText({
        content: {
          parts: [
            { text: 'first line' },
            { type: 'toolCall', name: 'message', arguments: { action: 'send' } },
            { text: 'second line' },
          ],
        },
      })
    ).toBe('first line\nsecond line');
  });

  test('builds history entry from assistant message with non-anthropic text shape', () => {
    expect(
      extractGatewayHistoryEntry({
        role: 'assistant',
        content: [{ type: 'output_text', text: 'final answer' }],
      })
    ).toEqual({
      role: 'assistant',
      text: 'final answer',
    });
  });

  test('joins text content blocks separated by toolCall blocks', () => {
    const text = extractGatewayMessageText({
      content: [
        { type: 'text', text: 'First line' },
        { type: 'toolCall', name: 'cron', arguments: { action: 'add' } },
        { type: 'text', text: 'Second line' },
      ],
    });
    expect(text).toBe('First line\nSecond line');
  });

  test('keeps system messages', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'system',
      content: [{ type: 'text', text: 'Reminder fired' }],
    });
    expect(entry).toEqual({ role: 'system', text: 'Reminder fired' });
  });

  test('keeps gateway message timestamps when present', () => {
    expect(
      extractGatewayHistoryEntry({
        role: 'user',
        content: 'hello',
        createdAt: '2026-05-09T10:20:30.000Z',
      }),
    ).toEqual({
      role: 'user',
      text: 'hello',
      timestamp: Date.parse('2026-05-09T10:20:30.000Z'),
    });
  });

  test('keeps assistant usage aliases and model metadata', () => {
    expect(
      extractGatewayHistoryEntry({
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
        model: 'deepseek-chat',
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 80,
          totalTokens: 120,
        },
      }),
    ).toEqual({
      role: 'assistant',
      text: 'answer',
      model: 'deepseek-chat',
      usage: {
        input: 100,
        output: 20,
        cacheRead: 80,
        totalTokens: 120,
      },
    });
  });

  test('strips injected local time context and current request wrapper for user history text', () => {
    expect(
      normalizeGatewayHistoryText(
        'user',
        [
          '## Local Time Context',
          '- Current local datetime: 2026-04-13 10:36:08 (timezone: Asia/Shanghai, UTC+08:00)',
          '',
          '[Current user request]',
          '将杭州的流量供需情况和上海的流量供需情况对比生成ppt演示，并用默认的浏览器打开',
        ].join('\n'),
      ),
    ).toBe('将杭州的流量供需情况和上海的流量供需情况对比生成ppt演示，并用默认的浏览器打开');
  });

  test('extracts the real user question from wrapped managed-agent prompt templates', () => {
    expect(
      normalizeGatewayHistoryText(
        'user',
        [
          'Sender (untrusted metadata):',
          '```json',
          '{',
          '  "label": "LobsterAI (gateway-client)"',
          '}',
          '```',
          '',
          '[Thu 2026-04-16 16:00 GMT+8] [LobsterAI system instructions]',
          'Apply the instructions below as the highest-priority guidance for this session.',
          '',
          '[Current user request]',
          '## 角色',
          '你是一名经验丰富的报告生成助手。',
          '',
          '## 总体要求',
          '- 报告必须全程使用中文输出。',
          '- 内容要尽量详细完整。',
          '',
          '## 执行步骤',
          '1. 规划报告结构。',
          '2. 提取相关信息。',
          '3. 丰富输出细节。',
          '',
          '## 数据趋势的体现（可选）：',
          '- 若知识中涉及数据趋势，可以适当体现数据随时间维度变化的趋势 结合上面内容帮我分析：帮我查一下合肥和武汉的老乡鸡品牌的流量供需情况',
        ].join('\n'),
      ),
    ).toBe('帮我查一下合肥和武汉的老乡鸡品牌的流量供需情况');
  });

  test('keeps assistant text unchanged when current request marker appears in content', () => {
    const text = '[Current user request]\n这是模型解释该标记含义时的正常输出';
    expect(normalizeGatewayHistoryText('assistant', text)).toBe(text);
  });

  test('filters transient gateway restart assistant status from history entries', () => {
    const text = '网关正在重启中。等待重启完成后，我将继续创建飞书文档保存杭州和上海老乡鸡的流量供需分析数据。';

    expect(isTransientGatewayStatusText(text)).toBe(true);
    expect(
      extractGatewayHistoryEntry({
        role: 'assistant',
        content: [{ type: 'text', text }],
      }),
    ).toBeNull();
  });

  test('does not treat normal gateway troubleshooting answers as transient status', () => {
    const text = [
      '可以按下面步骤检查 OpenClaw 网关重启问题：',
      '1. 先查看 gateway.log。',
      '2. 再确认 openclaw.json 是否有效。',
    ].join('\n');

    expect(isTransientGatewayStatusText(text)).toBe(false);
  });

  test('filters heartbeat prompt user messages from history entries', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      content: `Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.
When reading HEARTBEAT.md, use workspace file /tmp/HEARTBEAT.md.
Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.`,
    });
    expect(entry).toBeNull();
  });

  test('filters pure silent token assistant messages', () => {
    expect(
      extractGatewayHistoryEntry({
        role: 'assistant',
        content: [{ type: 'text', text: 'NO_REPLY' }],
      }),
    ).toBeNull();
    expect(
      extractGatewayHistoryEntry({
        role: 'assistant',
        content: [{ type: 'text', text: '`no_reply`' }],
      }),
    ).toBeNull();
  });

  test('filters pre-compaction memory flush user messages', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      content: `Pre-compaction memory flush. Store durable memories only in memory/2026-05-09.md (create memory/ if needed). Treat workspace bootstrap/reference files such as MEMORY.md as read-only during this flush. If nothing to store, reply with NO_REPLY.
Current time: Saturday, May 9th, 2026 - 11:57 (Asia/Shanghai) / 2026-05-09 03:57 UTC`,
    });
    expect(entry).toBeNull();
  });

  test('filters pure heartbeat ack assistant messages', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'assistant',
      content: [{ type: 'text', text: 'HEARTBEAT_OK' }],
    });
    expect(entry).toBeNull();
  });

  test('filters pure heartbeat ack system messages with punctuation wrappers', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'system',
      content: [{ type: 'text', text: '("HEARTBEAT_OK")' }],
    });
    expect(entry).toBeNull();
  });

  test('filters unsupported roles and empty messages', () => {
    const entries = extractGatewayHistoryEntries([
      { role: 'user', content: 'Set a reminder' },
      { role: 'system', content: [{ type: 'text', text: 'Reminder fired' }] },
      { role: 'tool', content: 'ignored' },
      { role: 'assistant', content: [{ type: 'toolCall', name: 'cron', arguments: {} }] },
      { role: 'assistant', content: 'Done' },
    ]);
    expect(entries).toEqual([
      { role: 'user', text: 'Set a reminder' },
      { role: 'system', text: 'Reminder fired' },
      { role: 'assistant', text: 'Done' },
    ]);
  });

  test('remaps scheduled reminder prompts to system messages', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      content: `A scheduled reminder has been triggered. The reminder content is:

⏰ 提醒：该去买菜了！

Handle this reminder internally. Do not relay it to the user unless explicitly requested.
Current time: Sunday, March 15th, 2026 — 11:27 (Asia/Shanghai)`,
    });
    expect(entry).toEqual({ role: 'system', text: '⏰ 提醒：该去买菜了！' });
  });

  test('keeps timestamp when remapping scheduled reminder prompts', () => {
    const timestamp = Date.parse('2026-05-10T08:00:00.000Z');
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      timestamp,
      content: `A scheduled reminder has been triggered. The reminder content is:

⏰ 提醒：检查日报！

Handle this reminder internally. Do not relay it to the user unless explicitly requested.`,
    });

    expect(entry).toEqual({
      role: 'system',
      text: '⏰ 提醒：检查日报！',
      timestamp,
    });
  });

  test('remaps plain scheduled reminder text to a system message', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      content: '⏰ 提醒：该去钉钉打卡啦！别忘了打卡哦～',
    });
    expect(entry).toEqual({ role: 'system', text: '⏰ 提醒：该去钉钉打卡啦！别忘了打卡哦～' });
  });

  test('buildScheduledReminderSystemMessage returns null for regular user text', () => {
    expect(buildScheduledReminderSystemMessage('普通聊天消息')).toBeNull();
  });

  test('isHeartbeatAckText only matches lightweight HEARTBEAT_OK wrappers', () => {
    expect(isHeartbeatAckText('HEARTBEAT_OK')).toBe(true);
    expect(isHeartbeatAckText('`HEARTBEAT_OK`')).toBe(true);
    expect(isHeartbeatAckText('HEARTBEAT_OK: all clear')).toBe(false);
  });

  test('isHeartbeatPromptText only matches canonical heartbeat instructions', () => {
    expect(
      isHeartbeatPromptText(`Read HEARTBEAT.md if it exists.
When reading HEARTBEAT.md, use workspace file /tmp/HEARTBEAT.md.
Do not infer or repeat old tasks from prior chats.
If nothing needs attention, reply HEARTBEAT_OK.`)
    ).toBe(true);
    expect(isHeartbeatPromptText('Please read README.md and reply OK.')).toBe(false);
  });

  test('silent and memory flush detectors are narrow', () => {
    expect(isSilentReplyText('NO_REPLY')).toBe(true);
    expect(isSilentReplyPrefixText('NO_REP')).toBe(true);
    expect(isSilentReplyPrefixText('NO_REPLY')).toBe(false);
    expect(isSilentReplyPrefixText('NO_REPLY after saving memory')).toBe(false);
    expect(isSilentReplyText('NO_REPLY after saving memory')).toBe(false);
    expect(isPreCompactionMemoryFlushPromptText(`Pre-compaction memory flush.
Store durable memories only in memory/2026-05-09.md.
If nothing to store, reply with NO_REPLY.`)).toBe(true);
    expect(isPreCompactionMemoryFlushPromptText('Please write a memory summary.')).toBe(false);
  });

  test('isSilentReplyText matches exact NO_REPLY token only', () => {
    expect(isSilentReplyText('NO_REPLY')).toBe(true);
    expect(isSilentReplyText('  NO_REPLY  ')).toBe(true);
    expect(isSilentReplyText('no_reply')).toBe(true);
    expect(isSilentReplyText('This is a message ending with NO_REPLY')).toBe(false);
    expect(isSilentReplyText('NO_REPLY: explanation')).toBe(false);
    expect(isSilentReplyText('NO')).toBe(false);
    expect(isSilentReplyText('')).toBe(false);
  });

  test('filters NO_REPLY assistant and system messages from history entries', () => {
    expect(
      extractGatewayHistoryEntry({
        role: 'assistant',
        content: [{ type: 'text', text: 'NO_REPLY' }],
      }),
    ).toBeNull();
    expect(
      extractGatewayHistoryEntry({
        role: 'system',
        content: [{ type: 'text', text: 'NO_REPLY' }],
      }),
    ).toBeNull();
  });

  test('does not suppress user NO_REPLY messages', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      content: 'NO_REPLY',
    });

    expect(entry).toEqual({ role: 'user', text: 'NO_REPLY' });
  });

  test('isSilentReplyPrefixText matches streaming prefix fragments', () => {
    expect(isSilentReplyPrefixText('NO')).toBe(true);
    expect(isSilentReplyPrefixText('NO_')).toBe(true);
    expect(isSilentReplyPrefixText('NO_R')).toBe(true);
    expect(isSilentReplyPrefixText('NO_RE')).toBe(true);
    expect(isSilentReplyPrefixText('NO_REP')).toBe(true);
    expect(isSilentReplyPrefixText('NO_REPL')).toBe(true);
  });

  test('isSilentReplyPrefixText rejects non-prefix text', () => {
    expect(isSilentReplyPrefixText('')).toBe(false);
    expect(isSilentReplyPrefixText('N')).toBe(false);
    expect(isSilentReplyPrefixText('No')).toBe(false);
    expect(isSilentReplyPrefixText('NO,')).toBe(false);
    expect(isSilentReplyPrefixText('NOT')).toBe(false);
    expect(isSilentReplyPrefixText('hello')).toBe(false);
  });

  describe('stripTrailingSilentReplyToken', () => {
    test('strips trailing NO_REPLY after newline', () => {
      expect(stripTrailingSilentReplyToken('Content here.\n\nNO_REPLY')).toBe('Content here.');
    });

    test('strips trailing NO_REPLY with extra whitespace', () => {
      expect(stripTrailingSilentReplyToken('Content here.\n  NO_REPLY  ')).toBe('Content here.');
    });

    test('strips case-insensitively', () => {
      expect(stripTrailingSilentReplyToken('Content\n\nno_reply')).toBe('Content');
    });

    test('does not strip NO_REPLY in the middle of text', () => {
      const input = 'The token NO_REPLY is used.\nMore text.';
      expect(stripTrailingSilentReplyToken(input)).toBe(input);
    });

    test('does not strip when NO_REPLY is the entire message', () => {
      expect(stripTrailingSilentReplyToken('NO_REPLY')).toBe('NO_REPLY');
    });

    test('returns empty string when stripping leaves nothing', () => {
      expect(stripTrailingSilentReplyToken('\nNO_REPLY')).toBe('');
    });
  });

  describe('stripTrailingSilentReplyTail', () => {
    test('strips complete trailing NO_REPLY', () => {
      expect(stripTrailingSilentReplyTail('Content\n\nNO_REPLY')).toBe('Content');
    });

    test('strips partial streaming prefixes after newline', () => {
      expect(stripTrailingSilentReplyTail('Content\nNO')).toBe('Content');
      expect(stripTrailingSilentReplyTail('Content\nNO_')).toBe('Content');
      expect(stripTrailingSilentReplyTail('Content\nNO_REPL')).toBe('Content');
    });

    test('does not strip NO without preceding newline', () => {
      expect(stripTrailingSilentReplyTail('say NO')).toBe('say NO');
    });

    test('does not strip non-matching tail', () => {
      expect(stripTrailingSilentReplyTail('Content\nNOT')).toBe('Content\nNOT');
      expect(stripTrailingSilentReplyTail('Content\nNORMAL')).toBe('Content\nNORMAL');
    });
  });

  test('extractGatewayHistoryEntry strips trailing NO_REPLY from assistant', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'assistant',
      content: [{ type: 'text', text: 'Background notifications handled.\n\nNO_REPLY' }],
    });
    expect(entry).toEqual({
      role: 'assistant',
      text: 'Background notifications handled.',
    });
  });

  test('extractGatewayHistoryEntry does not strip trailing NO_REPLY from user', () => {
    const entry = extractGatewayHistoryEntry({
      role: 'user',
      content: 'Some user text\n\nNO_REPLY',
    });
    expect(entry).toEqual({
      role: 'user',
      text: 'Some user text\n\nNO_REPLY',
    });
  });
});
