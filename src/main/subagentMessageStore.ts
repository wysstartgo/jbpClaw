import type Database from 'better-sqlite3';

export interface SubagentMessage {
  id: string;
  runId: string;
  type: string;
  content: string;
  metadata: string | null;
  createdAt: number;
  sequence: number;
}

interface SubagentMessageRow {
  id: string;
  run_id: string;
  type: string;
  content: string;
  metadata: string | null;
  created_at: number;
  sequence: number;
}

const mapSubagentMessageRow = (row: SubagentMessageRow): SubagentMessage => ({
  id: row.id,
  runId: row.run_id,
  type: row.type,
  content: row.content,
  metadata: row.metadata,
  createdAt: row.created_at,
  sequence: row.sequence,
});

export class SubagentMessageStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insertMessages(
    runId: string,
    messages: Array<{
      id: string;
      type: string;
      content: string;
      metadata?: Record<string, unknown> | null;
      timestamp: number;
      sequence: number;
    }>,
  ): void {
    if (messages.length === 0) return;

    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO subagent_messages (id, run_id, type, content, metadata, created_at, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertAll = this.db.transaction(() => {
      for (const msg of messages) {
        stmt.run(
          msg.id,
          runId,
          msg.type,
          msg.content,
          msg.metadata ? JSON.stringify(msg.metadata) : null,
          msg.timestamp,
          msg.sequence,
        );
      }
    });

    insertAll();
  }

  getMessages(runId: string): SubagentMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM subagent_messages WHERE run_id = ? ORDER BY sequence ASC')
      .all(runId) as SubagentMessageRow[];
    return rows.map(mapSubagentMessageRow);
  }

  hasMessages(runId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM subagent_messages WHERE run_id = ? LIMIT 1')
      .get(runId);
    return row !== undefined;
  }

  deleteByRunIds(runIds: string[]): void {
    if (runIds.length === 0) return;
    const placeholders = runIds.map(() => '?').join(',');
    this.db
      .prepare(`DELETE FROM subagent_messages WHERE run_id IN (${placeholders})`)
      .run(...runIds);
  }

  deleteByParentSession(parentSessionId: string): void {
    this.db
      .prepare(
        `DELETE FROM subagent_messages WHERE run_id IN
         (SELECT id FROM subagent_runs WHERE parent_session_id = ?)`,
      )
      .run(parentSessionId);
  }
}
