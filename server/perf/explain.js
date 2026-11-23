/**
 * EXPLAIN ANALYZE 诊断脚本：对四类目标查询的核心 SQL 执行真实执行计划分析。
 *
 * 用法：node perf/explain.js [--out=explain-baseline.txt]
 * 输出：控制台 + perf/results/<out> 文本文件。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PERF_DB = 'party_school_perf';

/** 把参数内联进 SQL（EXPLAIN ANALYZE 不支持占位符），字符串安全转义 */
function inline(sql, params = []) {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i];
    i += 1;
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return `(${v.map(x => (typeof x === 'number' ? x : `'${x}'`)).join(',')})`;
    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
    return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  });
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.replace(/^--/, '').split('=')));
  const outName = args.out || `explain-${Date.now()}.txt`;

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: PERF_DB,
    multipleStatements: false,
  });

  // 选取有代表性的参数值（与 seed-perf 数据对应）
  const [[sec]] = await conn.query(
    "SELECT organizationId FROM users WHERE role='secretary' AND username LIKE 'perf_sec_%' ORDER BY id LIMIT 1"
  );
  const [[mem]] = await conn.query(
    "SELECT id, organizationId FROM users WHERE role='member' AND username LIKE 'perf_mem_%' ORDER BY id LIMIT 1"
  );
  const [[br]] = await conn.query("SELECT id FROM organizations WHERE type='branch' ORDER BY id LIMIT 1");
  const orgIds = [];
  {
    const [rows] = await conn.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM organizations WHERE id = ?
         UNION ALL
         SELECT o.id FROM organizations o JOIN tree t ON o.parentId = t.id
       ) SELECT id FROM tree`, [sec.organizationId]
    );
    orgIds.push(...rows.map(r => r.id));
  }
  const inList = orgIds.join(',');
  const memberId = mem.id;
  const branchId = br.id;
  const sixMonthsAgo = new Date(Date.now() - 183 * 86400000)
    .toISOString().slice(0, 19).replace('T', ' ');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const COMPLETION_SQL = `(SELECT ROUND(IFNULL(
      100 * SUM(CASE WHEN lr.status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(u.id), 0), 0))
    FROM users u
    LEFT JOIN learning_records lr ON lr.userId = u.id AND lr.taskId = t.id
    WHERE u.organizationId = t.organizationId AND u.status = 1)`;

  const queries = {
    '任务列表(逐行完成率子查询)': {
      sql: `SELECT t.*, c.title as contentTitle, o.name as organizationName,
                   ${COMPLETION_SQL} as completionRate
            FROM learning_tasks t
            LEFT JOIN contents c ON t.contentId = c.id
            LEFT JOIN organizations o ON t.organizationId = o.id
            LEFT JOIN users u ON t.createdBy = u.id
            WHERE 1=1 AND t.organizationId IN (${inList})
            ORDER BY t.id DESC LIMIT 10 OFFSET 0`,
    },
    '统计-总学习时长(范围汇总)': {
      sql: `SELECT COALESCE(SUM(lr.studySeconds), 0) AS totalSeconds
            FROM learning_records lr
            JOIN users u ON lr.userId = u.id
            WHERE 1=1 AND u.organizationId IN (${inList})`,
    },
    '统计-活跃趋势(时间范围聚合)': {
      sql: `SELECT DATE_FORMAT(lr.updatedAt, '%Y-%m') AS bucket,
                   COUNT(DISTINCT CASE WHEN lr.studySeconds > 0 THEN lr.userId END) AS activeUsers
            FROM learning_records lr
            JOIN users u ON u.id = lr.userId
            WHERE lr.updatedAt >= '${sixMonthsAgo}' AND lr.updatedAt < '${now}'
              AND u.organizationId IN (${inList})
            GROUP BY bucket ORDER BY bucket`,
    },
    '统计-完成率趋势(全表按月聚合)': {
      sql: `SELECT DATE_FORMAT(completedAt, '%Y-%m') as month, COUNT(*) as completedCount
            FROM learning_records WHERE status = 'completed' AND completedAt IS NOT NULL
            GROUP BY month ORDER BY month DESC LIMIT 12`,
    },
    '统计-考试通过率(UNION ALL 聚合)': {
      sql: `SELECT COUNT(*) AS examCount, COALESCE(AVG(er.score), 0) AS avgScore,
                   SUM(CASE WHEN er.passed = 1 THEN 1 ELSE 0 END) AS passedCount
            FROM (SELECT userId, score, submittedAt, passed FROM assessment_attempts) er
            JOIN users u ON u.id = er.userId
            WHERE er.submittedAt IS NOT NULL AND u.organizationId IN (${inList})`,
    },
    '组织树(逐行成员计数子查询)': {
      sql: `SELECT o.id, o.name, o.type, o.parentId, o.leaderUserId, o.createdAt,
                   u.realName AS leaderName,
                   (SELECT COUNT(*) FROM users usr WHERE usr.organizationId = o.id AND usr.status = 1) AS directMembers
            FROM organizations o
            LEFT JOIN users u ON u.id = o.leaderUserId
            ORDER BY o.id`,
    },
    '组织后代集合(全表扫描)': {
      sql: 'SELECT id, parentId FROM organizations',
    },
    '党员任务列表': {
      sql: `SELECT lt.id as taskId, lt.title, lt.deadline, lt.organizationId,
                   lr.studySeconds, lr.status as progress, lr.completedAt,
                   c.id as contentId, c.title as contentTitle, c.type as contentType
            FROM learning_tasks lt
            JOIN contents c ON lt.contentId = c.id
            LEFT JOIN learning_records lr ON lr.taskId = lt.id AND lr.userId = ${memberId}
            WHERE lt.status = 'published' AND lt.organizationId IN (${inList})
            ORDER BY (lt.organizationId = ${mem.organizationId}) DESC, lt.id DESC`,
    },
    '学习记录完成统计(组织维度)': {
      sql: `SELECT COUNT(DISTINCT u.id) as totalUsers,
                   COUNT(DISTINCT CASE WHEN lr.status = 'completed' THEN u.id END) as completedUsers
            FROM users u
            LEFT JOIN learning_tasks lt ON lt.organizationId = u.organizationId
            LEFT JOIN learning_records lr ON lr.userId = u.id AND lr.taskId = lt.id
            WHERE u.organizationId = ${branchId}`,
    },
  };

  const chunks = [];
  for (const [name, { sql }] of Object.entries(queries)) {
    const header = `\n========== ${name} ==========\n`;
    console.log(header);
    try {
      const [rows] = await conn.query(`EXPLAIN ANALYZE ${sql}`);
      const lines = rows.map(r => Object.values(r).join('\t'));
      console.log(lines.join('\n'));
      chunks.push(`${header}${sql}\n\n${lines.join('\n')}\n`);
    } catch (err) {
      console.log(`EXPLAIN 失败: ${err.message}`);
      chunks.push(`${header}${sql}\n\nEXPLAIN 失败: ${err.message}\n`);
    }
  }

  // ---------------- 任务完成率聚合：直接分析实际生产 SQL ----------------
  // 生产实现（taskCompletionStatistics.queryTaskCompletion）在 JS 中构造
  // (memberOrgId, taskOrgId) 对集——memberOrg 为范围内组织，taskOrg 为其祖先或自身，
  // 拼成 UNION ALL 派生表后与 users/learning_tasks/learning_records 连接。
  // EXPLAIN ANALYZE 不支持 FROM (UNION ALL..) 派生表形态，因此分两步：
  //   a) 对实际 SQL 整体执行 EXPLAIN FORMAT=TREE（优化器视角与生产完全一致）；
  //   b) 将同一对集物化进临时表，对同一主查询执行 EXPLAIN ANALYZE 取真实耗时
  //      （派生表执行时同样会被物化，主查询计划形态一致）。
  {
    const header = '\n========== 任务完成率聚合(queryTaskCompletion 实际 SQL) ==========\n';
    console.log(header);
    const chunkLines = [header];
    try {
      // 与生产 ancestorIdsFromRows 相同的对集构造：范围组织 × 祖先或自身
      const [orgRows] = await conn.query('SELECT id, parentId FROM organizations');
      const parentById = new Map(orgRows.map(r => [Number(r.id), r.parentId == null ? null : Number(r.parentId)]));
      const ancestorsOf = (orgId) => {
        const ids = [];
        let cur = Number(orgId);
        const seen = new Set();
        while (cur && !seen.has(cur)) {
          seen.add(cur);
          ids.push(cur);
          cur = parentById.has(cur) ? parentById.get(cur) : null;
        }
        return ids;
      };
      const pairs = [];
      for (const orgId of orgIds) {
        for (const ancestorId of ancestorsOf(orgId)) pairs.push([Number(orgId), ancestorId]);
      }
      const pairsSql = pairs.map(([m, t]) => `SELECT ${m} AS memberOrgId, ${t} AS taskOrgId`).join('\n          UNION ALL ');
      const buildMainSql = (fromSource) => `SELECT u.id AS userId, lt.contentId, lt.title,
                   DATE_FORMAT(DATE_ADD(lt.createdAt, INTERVAL 8 HOUR), '%Y-%m') AS month,
                   CASE WHEN lr.status = 'completed' AND COALESCE(lr.completedAt, lr.updatedAt) < '${now}'
                        THEN 1 ELSE 0 END AS completed
            FROM ${fromSource}
            JOIN users u ON u.organizationId = os.memberOrgId AND u.role = 'member' AND u.status = 1
            JOIN learning_tasks lt ON lt.organizationId = os.taskOrgId AND lt.status = 'published'
            LEFT JOIN learning_records lr ON lr.taskId = lt.id AND lr.userId = u.id
            WHERE lt.createdAt >= '${sixMonthsAgo}' AND lt.createdAt < '${now}'
            ORDER BY u.id, (lt.organizationId = u.organizationId) DESC, lt.id DESC`;
      const actualSql = buildMainSql(`(${pairsSql}) os`);

      // a) 实际 SQL 的执行计划（优化器视角）
      chunkLines.push(`-- 实际生产 SQL（UNION ALL 对集 ${pairs.length} 对）:\n${actualSql}\n`);
      const [treeRows] = await conn.query(`EXPLAIN FORMAT=TREE ${actualSql}`);
      const tree = treeRows.map(r => Object.values(r)[0]).join('\n');
      console.log(tree);
      chunkLines.push(`-- EXPLAIN FORMAT=TREE（实际 SQL，无执行）:\n${tree}\n`);

      // b) 对集物化到临时表后，同一主查询的真实执行耗时
      await conn.query(`CREATE TEMPORARY TABLE tmp_completion_pairs AS ${pairsSql}`);
      try {
        const [rows] = await conn.query(`EXPLAIN ANALYZE ${buildMainSql('tmp_completion_pairs AS os')}`);
        const lines = rows.map(r => Object.values(r).join('\t'));
        console.log(lines.join('\n'));
        chunkLines.push(`-- EXPLAIN ANALYZE（对集已物化到临时表 tmp_completion_pairs，同一主查询真实执行）:\n${lines.join('\n')}\n`);
      } finally {
        await conn.query('DROP TEMPORARY TABLE IF EXISTS tmp_completion_pairs');
      }
    } catch (err) {
      console.log(`EXPLAIN 失败: ${err.message}`);
      chunkLines.push(`EXPLAIN 失败: ${err.message}\n`);
    }
    chunks.push(chunkLines.join('\n'));
  }

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, outName);
  fs.writeFileSync(outFile, chunks.join('\n'));
  console.log(`\nEXPLAIN 结果已写入 ${outFile}`);
  await conn.end();
}

main().catch((err) => {
  console.error('EXPLAIN 失败:', err);
  process.exit(1);
});
