import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = path.join(process.cwd(), "data", "misa.sqlite");
let database: DatabaseSync | null = null;

export function getDatabase() {
  if (!database) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    database = new DatabaseSync(databasePath);
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        uid TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
    `);
  }
  return database;
}

export type DatabaseUser = {
  username: string;
  displayName: string;
  email: string;
  uid: string;
};

export function toDatabaseUser(row: Record<string, unknown>): DatabaseUser {
  return {
    username: String(row.username),
    displayName: String(row.display_name),
    email: String(row.email),
    uid: String(row.uid),
  };
}
