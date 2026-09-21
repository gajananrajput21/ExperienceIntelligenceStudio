import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
const storePath = path.join(dataDir, 'store.json');
const archiveDir = path.join(dataDir, 'archives');
const databaseUrl = process.env.DATABASE_URL;
const emptyStore = () => ({ projects: [], prototypes: [], studies: [], sessions: [], events: [], responses: [] });

let pool;
let writeQueue = Promise.resolve();

export const storageKind = databaseUrl ? 'postgres' : 'json';

export async function initStorage() {
  await fs.mkdir(archiveDir, { recursive: true });
  if (!databaseUrl) return;

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DATABASE_POOL_SIZE || 5),
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eis_state (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS eis_prototype_archives (
      prototype_id TEXT PRIMARY KEY,
      archive BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    'INSERT INTO eis_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(emptyStore())],
  );
}

export async function loadStore() {
  if (!pool) {
    try { return JSON.parse(await fs.readFile(storePath, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return emptyStore();
      throw error;
    }
  }
  const result = await pool.query('SELECT data FROM eis_state WHERE id = 1');
  return result.rows[0]?.data || emptyStore();
}

export function mutate(mutator) {
  if (!pool) {
    writeQueue = writeQueue.then(async () => {
      const store = await loadStore();
      const result = await mutator(store);
      await fs.writeFile(storePath, JSON.stringify(store, null, 2));
      return result;
    });
    return writeQueue;
  }

  return (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query('SELECT data FROM eis_state WHERE id = 1 FOR UPDATE');
      const store = selected.rows[0]?.data || emptyStore();
      const result = await mutator(store);
      await client.query('UPDATE eis_state SET data = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(store)]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })();
}

export async function savePrototypeArchive(prototypeId, archive) {
  if (!pool) {
    await fs.writeFile(path.join(archiveDir, `${prototypeId}.zip`), archive);
    return;
  }
  await pool.query(
    `INSERT INTO eis_prototype_archives (prototype_id, archive)
     VALUES ($1, $2)
     ON CONFLICT (prototype_id) DO UPDATE SET archive = EXCLUDED.archive, created_at = NOW()`,
    [prototypeId, archive],
  );
}

export async function readPrototypeArchive(prototypeId) {
  if (!pool) {
    try { return await fs.readFile(path.join(archiveDir, `${prototypeId}.zip`)); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  const result = await pool.query('SELECT archive FROM eis_prototype_archives WHERE prototype_id = $1', [prototypeId]);
  return result.rows[0]?.archive || null;
}

export async function storageHealth() {
  if (!pool) return true;
  await pool.query('SELECT 1');
  return true;
}

export async function closeStorage() {
  await pool?.end();
}
