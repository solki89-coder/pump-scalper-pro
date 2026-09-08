import { query, queryOne } from '../client.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const row = await queryOne<UserRow>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *`,
    [email, passwordHash],
  );
  if (!row) throw new Error('createUser: insert returned no row');
  return mapUser(row);
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const row = await queryOne<UserRow>(`SELECT * FROM users WHERE email = $1`, [email]);
  return row ? mapUser(row) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const row = await queryOne<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
  return row ? mapUser(row) : null;
}

export async function countUsers(): Promise<number> {
  const rows = await query<{ count: string }>(`SELECT count(*)::text AS count FROM users`);
  return Number(rows[0]?.count ?? '0');
}

export async function listUsers(): Promise<User[]> {
  const rows = await query<UserRow>(`SELECT * FROM users ORDER BY created_at`);
  return rows.map(mapUser);
}
