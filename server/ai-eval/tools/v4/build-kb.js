/**
 * V4 知识库构建器：从 fetch-evidence.json 的权威原文中按“章”切分，生成结构化知识文档。
 * 每份文档含完整来源元数据与该章条文原文。正文均为抓取到的权威原文，不改写、不编造。
 * 用法：node ai-eval/tools/v4/build-kb.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../..');
const EVIDENCE = path.resolve(ROOT, 'ai-eval/reports/v4/fetch-evidence.json');
const KB_DIR = path.resolve(ROOT, 'knowledge-v4');
const MANIFEST = path.resolve(ROOT, 'ai-eval/reports/v4/kb-manifest.json');

const CHAPTER_RE = /^第[一二三四五六七八九十百]+[章节]\s*[　\s]*(.*)$/;

const META = {
  '党章2022': { issuer: '中国共产党第二十次全国代表大会部分修改', pubDate: '2022-10-22', scope: '全党', version: '2022年修改版', status: '现行有效', title: '中国共产党章程' },
  '纪律处分条例2023': { issuer: '中共中央', pubDate: '2023-12-19', scope: '全党', version: '2023年修订（2024-01-01施行）', status: '现行有效', title: '中国共产党纪律处分条例' },
  '支部工作条例2018': { issuer: '中共中央', pubDate: '2018-10-28', scope: '党的基层支部', version: '2018年试行版', status: '现行有效（试行）', title: '中国共产党支部工作条例（试行）' },
  '党员教育管理工作条例2019': { issuer: '中共中央', pubDate: '2019-05-06', scope: '全体党员', version: '2019年版', status: '现行有效', title: '中国共产党党员教育管理工作条例' },
  '问责条例2019': { issuer: '中共中央', pubDate: '2019-09-01', scope: '党组织和党的领导干部', version: '2019年修订版', status: '现行有效', title: '中国共产党问责条例' },
  '发展党员工作细则2026': { issuer: '中共中央办公厅', pubDate: '2026-05-11', scope: '党的基层组织与发展党员工作', version: '2026年修订版', status: '现行有效', title: '中国共产党发展党员工作细则' },
  '发展党员工作细则2014历史': { issuer: '中共中央办公厅', pubDate: '2014-05-28', scope: '党的基层组织与发展党员工作', version: '2014年版（已被2026年修订版替代）', status: '历史版本·已失效', title: '中国共产党发展党员工作细则（2014年版·已废止）' }
};

function splitChapters(text) {
  const lines = text.split('\n');
  const marks = [];
  lines.forEach((line, i) => {
    const m = line.match(CHAPTER_RE);
    if (m) marks.push({ i, label: line.trim() });
  });
  const last = new Map();
  for (const mk of marks) last.set(mk.label, mk.i);
  const positions = [...last.values()].sort((a, b) => a - b);
  const result = [];
  for (let n = 0; n < positions.length; n++) {
    const start = positions[n];
    const end = n + 1 < positions.length ? positions[n + 1] : lines.length;
    const label = lines[start].trim();
    const body = lines.slice(start + 1, end)
      .filter((l) => !/^(分享|收藏|打印|纠错|责任编辑|热词|关于我们|联系我们|用户调查|版权所有|京ICP备|发布时间|来源：|编辑：|延伸阅读)/.test(l))
      .filter((l) => l.trim())
      .join('\n');
    if (/第[一二三四五六七八九十百]+条/.test(body) && body.length >= 80) result.push({ label, body });
  }
  return result;
}

function sectionName(label) {
  const m = label.match(CHAPTER_RE);
  return (m && m[1] ? m[1] : label).replace(/[\s　]/g, '') || '总则';
}
function safeFileName(name) { return name.replace(/[\\/:*?"<>|]/g, '').trim(); }

function build() {
  const evidence = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));
  fs.mkdirSync(KB_DIR, { recursive: true });
  // 清理上次生成的法规文档，避免来源变更后残留未纳入 manifest 的旧文件
  for (const f of fs.readdirSync(KB_DIR).filter((x) => /^V4-\d/.test(x))) fs.unlinkSync(path.join(KB_DIR, f));
  const manifest = [];
  let index = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const ev of evidence) {
    if (!ev.text || !META[ev.key]) continue;
    const meta = META[ev.key];
    for (const ch of splitChapters(ev.text)) {
      index += 1;
      const sec = sectionName(ch.label);
      const fileName = `V4-${String(index).padStart(2, '0')}-${safeFileName(meta.title)}-${safeFileName(sec)}.md`;
      const content = [
        `# ${meta.title} · ${sec}`, '',
        '> 本文件为公开权威党内法规的结构化摘编，正文为来源页面原文条款，仅供党校学习与评测使用。', '',
        '## 元数据', '',
        `- 法规名称：${meta.title}`,
        `- 章节：${ch.label}`,
        `- 来源URL：${ev.url}`,
        `- 发布单位：${meta.issuer}`,
        `- 发布日期：${meta.pubDate}`,
        `- 获取日期：${ev.fetchedAt.slice(0, 10)}`,
        `- 适用范围：${meta.scope}`,
        `- 版本：${meta.version}`,
        `- 有效性状态：${meta.status}`,
        `- 来源域名：${ev.domain}`,
        `- 来源页SHA256：${ev.sha256}`,
        '', '## 条文原文', '', ch.body
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(KB_DIR, fileName), content, 'utf8');
      manifest.push({
        file: fileName, key: ev.key, chapter: ch.label, section: sec, title: meta.title,
        url: ev.url, issuer: meta.issuer, pubDate: meta.pubDate, fetchedAt: ev.fetchedAt.slice(0, 10),
        scope: meta.scope, version: meta.version, status: meta.status, domain: ev.domain,
        sourceSha256: ev.sha256, contentSha256: crypto.createHash('sha256').update(content).digest('hex'),
        chars: content.length
      });
    }
  }

  const legacyDir = path.resolve(ROOT, 'knowledge');
  for (const file of fs.readdirSync(legacyDir).filter((f) => f.endsWith('.md')).sort()) {
    const content = fs.readFileSync(path.join(legacyDir, file), 'utf8');
    fs.writeFileSync(path.join(KB_DIR, `V4-LEGACY-${file}`), content, 'utf8');
    manifest.push({
      file: `V4-LEGACY-${file}`, key: 'legacy', chapter: 'N/A', section: 'N/A',
      title: file.replace(/\.md$/, ''), url: null, issuer: '未提供（历史基础语料）', pubDate: null,
      fetchedAt: today, scope: '党校学习', version: 'V1 基础语料', status: '沿用（来源元数据待补）',
      domain: '本地knowledge', sourceSha256: null,
      contentSha256: crypto.createHash('sha256').update(content).digest('hex'), chars: content.length
    });
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify({
    version: '4.0.0', generatedAt: new Date().toISOString(), docCount: manifest.length, docs: manifest
  }, null, 2)}\n`);
  console.log(`生成知识文档 ${manifest.length} 份 -> ${KB_DIR}`);
  const byKey = {};
  manifest.forEach((m) => { byKey[m.key] = (byKey[m.key] || 0) + 1; });
  console.log('按来源:', JSON.stringify(byKey));
}
build();
