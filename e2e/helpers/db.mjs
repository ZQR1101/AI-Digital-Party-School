// MySQL 直连助手：断言数据库状态与种子数据（仅连隔离测试栈暴露的端口）
import mysql from 'mysql2/promise';
import { DB_PORT, DB_PASSWORD } from './env.mjs';

let pool = null;

export async function getDb() {
  if (!pool) {
    pool = mysql.createPool({
      host: '127.0.0.1',
      port: DB_PORT,
      user: 'root',
      password: DB_PASSWORD,
      database: 'party_school',
      waitForConnections: true,
      connectionLimit: 4,
      namedPlaceholders: false,
    });
  }
  return pool;
}

export async function query(sql, params = []) {
  const db = await getDb();
  const [rows] = await db.query(sql, params);
  return rows;
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
