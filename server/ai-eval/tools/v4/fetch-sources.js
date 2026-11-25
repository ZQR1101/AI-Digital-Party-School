/**
 * V4 权威来源抓取器：从已核验的官方 URL 抓取正文，抽取纯文本，保存抓取证据。
 * 仅使用公开权威来源（共产党员网 / 中央纪委国家监委 / 中国政府网 / 人民网党史党建）。
 * 输出：ai-eval/reports/v4/fetch-evidence.json（URL、HTTP状态、字节数、SHA256、抓取时间）
 *
 * 用法：node ai-eval/tools/v4/fetch-sources.js
 * 说明：抓取结果含正文，仅作为本地核验材料；知识库文档为结构化摘编，不整页转载。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.resolve(ROOT, 'ai-eval/reports/v4/fetch-evidence.json');

// 每条都由 WebSearch 实际返回并确认可访问；抓取失败会记录 status 而非猜测内容
const SOURCES = [
  { key: '党章2022', name: '中国共产党章程（2022年修改）', domain: '共产党员网', url: 'https://www.12371.cn/special/zggcdzc/zggcdzcqw/' },
  { key: '纪律处分条例2023', name: '中国共产党纪律处分条例（2023年修订）', domain: '共产党员网', url: 'https://www.12371.cn/2023/12/27/ARTI1703689211048182.shtml' },
  { key: '支部工作条例2018', name: '中国共产党支部工作条例（试行）', domain: '共产党员网', url: 'https://www.12371.cn/2018/11/25/ARTI1543146320637564.shtml' },
  { key: '党员教育管理工作条例2019', name: '中国共产党党员教育管理工作条例', domain: '共产党员网', url: 'https://www.12371.cn/2019/05/21/ARTI1558449177626771.shtml' },
  { key: '问责条例2019', name: '中国共产党问责条例（2019年修订）', domain: '中国政府网', url: 'https://www.gov.cn/zhengce/2019-09/04/content_5427269.htm' },
  { key: '发展党员工作细则2026', name: '中国共产党发展党员工作细则（2026年修订）', domain: '人民网党史党建', url: 'https://cpc.people.com.cn/n1/2026/0519/c64387-40722562.html' },
  { key: '发展党员工作细则2014历史', name: '中国共产党发展党员工作细则（2014年，历史版本，已被2026年修订版替代）', domain: '中国政府网', url: 'https://www.gov.cn/zhengce/201406/content_7032534.htm' }
];

function extractText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

async function fetchOne(src) {
  const rec = { ...src, fetchedAt: new Date().toISOString(), httpStatus: null, bytes: 0, sha256: null, text: null, error: null };
  try {
    const res = await axios.get(src.url, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PartySchoolEval/1.0)' },
      validateStatus: () => true
    });
    rec.httpStatus = res.status;
    const html = String(res.data || '');
    rec.bytes = Buffer.byteLength(html);
    rec.sha256 = crypto.createHash('sha256').update(html).digest('hex');
    if (res.status >= 200 && res.status < 300) rec.text = extractText(html);
    else rec.error = `HTTP ${res.status}`;
  } catch (err) {
    rec.error = err.message;
  }
  return rec;
}

(async () => {
  const out = [];
  for (const src of SOURCES) {
    const rec = await fetchOne(src);
    out.push(rec);
    console.log(`${rec.key}: HTTP ${rec.httpStatus}, ${rec.bytes} bytes, text ${rec.text ? rec.text.length : 0} chars ${rec.error ? '(' + rec.error + ')' : ''}`);
  }
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`证据已保存: ${OUT}`);
})();
