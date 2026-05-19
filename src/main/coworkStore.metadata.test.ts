import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
  },
}));

import { CoworkStore } from './coworkStore';

const tempDirs: string[] = [];
const dbs: Database.Database[] = [];

const createDb = (): Database.Database => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qingshu-cowork-metadata-'));
  tempDirs.push(dir);
  const db = new Database(path.join(dir, 'test.sqlite'));
  dbs.push(db);
  return db;
};

afterEach(() => {
  for (const db of dbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const createCoworkTables = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      claude_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      pinned INTEGER NOT NULL DEFAULT 0,
      cwd TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      execution_mode TEXT NOT NULL DEFAULT 'local',
      active_skill_ids TEXT,
      agent_id TEXT NOT NULL DEFAULT 'main',
      model_override TEXT NOT NULL DEFAULT '',
      parent_session_id TEXT,
      forked_from_message_id TEXT,
      forked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      sequence INTEGER,
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    );
  `);
};

const insertSession = (db: Database.Database, id: string): void => {
  const now = Date.now();
  db.prepare(
    `INSERT INTO cowork_sessions
      (id, title, claude_session_id, status, pinned, cwd, system_prompt, execution_mode, active_skill_ids, agent_id, model_override, created_at, updated_at)
     VALUES (?, 'test', NULL, 'idle', 0, '/tmp', '', 'local', '[]', 'main', '', ?, ?)`,
  ).run(id, now, now);
};

const insertMessage = (
  db: Database.Database,
  id: string,
  sessionId: string,
  type: string,
  content: string,
  metadata: string | null,
  sequence: number,
  timestamp = Date.now(),
): void => {
  db.prepare(
    `INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sessionId, type, content, metadata, timestamp, sequence);
};

describe('CoworkStore message metadata resilience', () => {
  test('keeps loading a session when one message metadata row is corrupt', () => {
    const db = createDb();
    createCoworkTables(db);
    insertSession(db, 'session-1');
    insertMessage(db, 'message-ok', 'session-1', 'user', 'hello', '{"skillIds":["demo"]}', 1);
    insertMessage(db, 'message-bad', 'session-1', 'tool_use', 'broken', '{bad-json', 2);
    insertMessage(db, 'message-empty', 'session-1', 'assistant', 'reply', null, 3);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new CoworkStore(db, () => {});
    const session = store.getSession('session-1');

    expect(session).not.toBeNull();
    expect(session?.messages).toHaveLength(3);
    expect(session?.messages.find((message) => message.id === 'message-ok')?.metadata).toEqual({ skillIds: ['demo'] });
    expect(session?.messages.find((message) => message.id === 'message-bad')?.metadata).toBeUndefined();
    expect(session?.messages.find((message) => message.id === 'message-empty')?.metadata).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  test('preserves existing and gateway timestamps when replacing conversation messages', () => {
    const db = createDb();
    createCoworkTables(db);
    insertSession(db, 'session-1');
    insertMessage(db, 'message-tool', 'session-1', 'tool_use', 'tool stays', '{}', 1, 500);
    insertMessage(db, 'message-user', 'session-1', 'user', 'old user', '{}', 2, 1_000);
    insertMessage(db, 'message-assistant', 'session-1', 'assistant', 'old assistant', '{}', 3, 2_000);

    const store = new CoworkStore(db, () => {});

    store.replaceConversationMessages('session-1', [
      { role: 'user', text: 'old user' },
      { role: 'assistant', text: 'old assistant' },
      { role: 'user', text: 'new user', timestamp: 3_000 },
    ]);

    const session = store.getSession('session-1');

    expect(session?.messages.map((message) => ({
      type: message.type,
      content: message.content,
      timestamp: message.timestamp,
    }))).toEqual([
      { type: 'tool_use', content: 'tool stays', timestamp: 500 },
      { type: 'user', content: 'old user', timestamp: 1_000 },
      { type: 'assistant', content: 'old assistant', timestamp: 2_000 },
      { type: 'user', content: 'new user', timestamp: 3_000 },
    ]);
    expect(session?.updatedAt).toBe(3_000);
  });

  test('uses provided timestamps when adding or inserting channel messages', () => {
    const db = createDb();
    createCoworkTables(db);
    insertSession(db, 'session-1');
    insertMessage(db, 'message-assistant', 'session-1', 'assistant', 'assistant reply', '{}', 1, 2_000);

    const store = new CoworkStore(db, () => {});

    const inserted = store.insertMessageBeforeId('session-1', 'message-assistant', {
      type: 'user',
      content: 'channel user',
      metadata: {},
      timestamp: 1_000,
    });
    const added = store.addMessage('session-1', {
      type: 'user',
      content: 'next channel user',
      metadata: {},
      timestamp: 3_000,
    });
    const session = store.getSession('session-1');

    expect(inserted.timestamp).toBe(1_000);
    expect(added.timestamp).toBe(3_000);
    expect(session?.messages.map((message) => ({
      type: message.type,
      content: message.content,
      timestamp: message.timestamp,
    }))).toEqual([
      { type: 'user', content: 'channel user', timestamp: 1_000 },
      { type: 'assistant', content: 'assistant reply', timestamp: 2_000 },
      { type: 'user', content: 'next channel user', timestamp: 3_000 },
    ]);
  });
});

describe('CoworkStore session forks', () => {
  test('copies messages through the selected message without changing the source session', () => {
    const db = createDb();
    createCoworkTables(db);
    insertSession(db, 'session-1');
    insertMessage(db, 'message-1', 'session-1', 'user', 'first', '{"skillIds":["demo"]}', 1, 1_000);
    insertMessage(db, 'message-2', 'session-1', 'assistant', 'reply', '{}', 2, 2_000);
    insertMessage(db, 'message-3', 'session-1', 'user', 'later', '{}', 3, 3_000);

    const store = new CoworkStore(db, () => {});
    const forked = store.forkSession('session-1', 'message-2');
    const source = store.getSession('session-1');

    expect(forked).not.toBeNull();
    expect(forked?.parentSessionId).toBe('session-1');
    expect(forked?.forkedFromMessageId).toBe('message-2');
    expect(forked?.messages.map((message) => ({
      type: message.type,
      content: message.content,
      metadata: message.metadata,
    }))).toEqual([
      { type: 'user', content: 'first', metadata: { skillIds: ['demo'] } },
      { type: 'assistant', content: 'reply', metadata: {} },
    ]);
    expect(forked?.messages.map((message) => message.id)).not.toContain('message-1');
    expect(source?.messages.map((message) => message.content)).toEqual(['first', 'reply', 'later']);
  });
});

describe('CoworkStore user message edits', () => {
  test('updates a user message and removes every following message', () => {
    const db = createDb();
    createCoworkTables(db);
    insertSession(db, 'session-1');
    insertMessage(db, 'message-1', 'session-1', 'user', 'first', '{"skillIds":["demo"]}', 1, 1_000);
    insertMessage(db, 'message-2', 'session-1', 'assistant', 'old reply', '{}', 2, 2_000);
    insertMessage(db, 'message-3', 'session-1', 'tool_use', 'old tool', '{}', 3, 3_000);
    insertMessage(db, 'message-4', 'session-1', 'user', 'later', '{}', 4, 4_000);

    const store = new CoworkStore(db, () => {});
    const edited = store.editUserMessageAndTruncateAfter('session-1', 'message-1', {
      content: 'edited first',
    });

    expect(edited).not.toBeNull();
    expect(edited?.status).toBe('idle');
    expect(edited?.claudeSessionId).toBeNull();
    expect(edited?.messages.map((message) => ({
      id: message.id,
      type: message.type,
      content: message.content,
      metadata: message.metadata,
    }))).toEqual([
      { id: 'message-1', type: 'user', content: 'edited first', metadata: { skillIds: ['demo'] } },
    ]);
  });

  test('does not edit assistant messages', () => {
    const db = createDb();
    createCoworkTables(db);
    insertSession(db, 'session-1');
    insertMessage(db, 'message-1', 'session-1', 'user', 'first', '{}', 1, 1_000);
    insertMessage(db, 'message-2', 'session-1', 'assistant', 'reply', '{}', 2, 2_000);

    const store = new CoworkStore(db, () => {});
    const edited = store.editUserMessageAndTruncateAfter('session-1', 'message-2', {
      content: 'edited reply',
    });

    expect(edited).toBeNull();
    expect(store.getSession('session-1')?.messages.map((message) => message.content)).toEqual(['first', 'reply']);
  });
});
