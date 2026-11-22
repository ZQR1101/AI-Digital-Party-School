const db = require('../config/db');
const LearningProfileService = require('./learningProfileService');
const { normalizeTags, beijingDayKey } = LearningProfileService;
const { AIClient } = require('./aiClient');

function includesSignal(searchable, signal) {
  const normalized = String(signal || '').normalize('NFKC').trim().toLowerCase();
  return normalized.length > 0 && searchable.includes(normalized);
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function toPublicItem(item) {
  const { ruleScore, weakEvidenceScore, historyScore, freshnessScore, ...publicItem } = item;
  return publicItem;
}

function parseSnapshot(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (Array.isArray(parsed)) {
    if (parsed.length && typeof parsed[0] === 'object') {
      return { ids: parsed.map(item => Number(item.contentId)).filter(Boolean), items: parsed };
    }
    return { ids: parsed.map(Number).filter(Boolean), items: [] };
  }
  if (parsed && typeof parsed === 'object') {
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const ids = (parsed.ids || items.map(item => item.contentId)).map(Number).filter(Boolean);
    return { ids, items, revision: parsed.revision };
  }
  return { ids: [], items: [] };
}

function applyDailyOrder(ranked = [], savedIds = [], limit = 5) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
  const byId = new Map(ranked.map(item => [Number(item.contentId), item]));
  const pinned = [];
  const used = new Set();
  for (const id of savedIds) {
    const item = byId.get(Number(id));
    if (!item || used.has(Number(id))) continue;
    pinned.push(item);
    used.add(Number(id));
    if (pinned.length >= safeLimit) return pinned;
  }
  for (const item of ranked) {
    const id = Number(item.contentId);
    if (used.has(id)) continue;
    pinned.push(item);
    used.add(id);
    if (pinned.length >= safeLimit) break;
  }
  return pinned;
}

class RecommendationService {
  static async getForUser(userId, limit = 5, trace = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
    const dayKey = beijingDayKey();
    const [snapshot, assessmentRevision] = await Promise.all([
      this.loadDailySnapshot(userId, dayKey),
      LearningProfileService.getAssessmentRevision(userId)
    ]);
    const revision = `2:${assessmentRevision}`;
    const sameRevision = snapshot.revision === revision;
    if (sameRevision && snapshot.items.length) {
      const kept = await this.withCurrentContentUrls(userId, snapshot.items);
      if (kept.length && (kept.length >= safeLimit || kept.length === snapshot.items.length)) {
        trace.resultMode = 'cache';
        return this.present(kept.slice(0, safeLimit), { recommendationMode: 'daily_cache', cached: true });
      }
    }

    const [profile, live] = await Promise.all([
      LearningProfileService.getProfile(userId),
      this.getPublicCandidates(userId)
    ]);
    const historySignals = this.buildHistorySignals(profile.learningHistory);
    const ruleRanked = this.rankCandidates(live, profile.weakCategories, historySignals);
    const candidatePool = ruleRanked.slice(0, 20);
    const aiRanking = await AIClient.rankLearningContents(profile, candidatePool, trace);
    trace.resultMode = aiRanking?.length ? 'model' : 'rules';
    const ranked = aiRanking?.length ? this.mergeAIRanking(candidatePool, aiRanking) : candidatePool;
    const recommendations = applyDailyOrder(ranked, sameRevision ? snapshot.ids : [], 20).map(toPublicItem);
    await this.saveDailySnapshot(userId, dayKey, recommendations, revision);
    const current = await this.withCurrentContentUrls(userId, recommendations);
    return this.present(current.slice(0, safeLimit), {
      recommendationMode: trace.resultMode === 'model' ? 'ai_hybrid' : 'rules_fallback',
      aiError: trace.errorType,
      profile,
      historySignals,
    });
  }

  static present(ranked, extra = {}) {
    return {
      scene: 'learning_recommendation',
      answer: ranked.length
        ? extra.cached
          ? `已为你保留今日推荐${ranked.length}项公共学习内容。`
          : extra.recommendationMode === 'ai_hybrid'
            ? `AI已结合你的学习历史、近期错题和薄弱知识点，推荐${ranked.length}项公共学习内容。`
            : `已根据你的学习记录和薄弱知识点，推荐${ranked.length}项公共学习内容。`
        : '当前暂无可推荐的公共学习内容。',
      generatedAt: new Date().toISOString(),
      recommendationMode: extra.recommendationMode,
      cached: Boolean(extra.cached),
      aiAvailable: AIClient.isConfigured(),
      fallbackReason: extra.cached ? null : (extra.aiError ? 'AI服务暂不可用，已自动使用规则推荐。' : null),
      profile: extra.profile
        ? {
            completionRate: extra.profile.completionRate,
            avgScore: extra.profile.avgScore,
            weakKnowledgePoints: extra.profile.weakCategories,
            recentWrongQuestionCount: extra.profile.recentWrongQuestions.length,
            learningHistoryCount: extra.profile.learningHistory.length,
            interestTags: (extra.historySignals || []).slice(0, 5).map(item => item.name)
          }
        : null,
      recommendations: ranked
    };
  }

  static async getPublicCandidates(userId, ids, includeFeedback = true) {
    if (ids && !ids.length) return [];
    const selectBody = ids ? ', c.bodyOrVideoUrl' : '';
    const restrictIds = ids ? 'AND c.id IN (?)' : '';
    const dismissClause = includeFeedback
      ? `AND NOT EXISTS (
           SELECT 1 FROM recommendation_feedback dismissed
           WHERE dismissed.userId = ? AND dismissed.contentId = c.id
             AND dismissed.action = 'dismiss'
         )`
      : '';
    try {
      const [contents] = await db.query(
      `SELECT c.id, c.title, c.type, c.coverUrl, c.summary, c.tags, c.createdAt${selectBody},
              EXISTS (
                SELECT 1 FROM learning_tasks completedTask
                JOIN learning_records completedRecord ON completedRecord.taskId = completedTask.id
                WHERE completedTask.contentId = c.id AND completedRecord.userId = ?
                  AND completedRecord.status = 'completed'
              ) AS hasCompleted
       FROM contents c
       WHERE c.isPublic = 1 AND c.status = 'published'
         ${dismissClause} ${restrictIds}
       ORDER BY c.createdAt DESC, c.id DESC`,
        [userId, ...(includeFeedback ? [userId] : []), ...(ids ? [ids] : [])]
      );
      return contents;
    } catch (error) {
      if (includeFeedback && error.code === 'ER_NO_SUCH_TABLE') {
        console.warn('[Recommendation feedback disabled] recommendation_feedback table is missing');
        return this.getPublicCandidates(userId, ids, false);
      }
      throw error;
    }
  }

  static async withCurrentContentUrls(userId, items) {
    const rows = await this.getPublicCandidates(userId, items.map(item => Number(item.contentId)));
    const current = new Map(rows.map(row => [Number(row.id), row]));
    return items.filter(item => current.has(Number(item.contentId))).map(item => ({
      ...item,
      contentUrl: current.get(Number(item.contentId)).bodyOrVideoUrl
    }));
  }

  static rankCandidates(live, weakCategories, historySignals = []) {
    return live.map(content => this.rankContent(content, weakCategories, historySignals))
      .sort((a, b) => Number(Boolean(b.evidence.length)) - Number(Boolean(a.evidence.length))
        || b.ruleScore - a.ruleScore || new Date(b.createdAt) - new Date(a.createdAt));
  }

  static async getReportRecommendations(profile) {
    if (!profile.weakCategories.length) return [];
    const live = await this.getPublicCandidates(profile.userId);
    return this.rankCandidates(live, profile.weakCategories)
      .filter(item => item.evidence.length)
      .slice(0, 3)
      .map(({ contentId, title, reason, matchedKnowledgePoints }) => ({ contentId, title, reason, matchedKnowledgePoints }));
  }

  static buildHistorySignals(history = []) {
    const weights = new Map();
    history.forEach((item, index) => {
      const recencyWeight = Math.max(1, 10 - index * 0.4);
      for (const tag of normalizeTags(item.tags)) {
        weights.set(tag, (weights.get(tag) || 0) + recencyWeight);
      }
    });
    return [...weights.entries()]
      .map(([name, weight]) => ({ name, weight: round(weight) }))
      .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  }

  static rankContent(content, weakCategories = [], historySignals = []) {
    const tags = normalizeTags(content.tags);
    const contentText = `${content.title || ''} ${content.summary || ''}`.normalize('NFKC').toLowerCase();
    const searchable = `${contentText} ${tags.join(' ').toLowerCase()}`;
    const tagKeys = new Set(tags.map(tag => tag.toLowerCase()));
    const matchedWeak = weakCategories.filter(item => tagKeys.has(item.category.toLowerCase()) || includesSignal(contentText, item.category));
    const matchedHistory = historySignals.filter(item => includesSignal(searchable, item.name));
    const primaryWeak = matchedWeak[0] || null;
    const weakEvidenceScore = matchedWeak.length
      ? Math.min(100, 55 + matchedWeak.reduce((sum, item) => sum + Number(item.wrongCount || 0) * 8 + (100 - Number(item.masteryScore || 0)) * 0.2, 0))
      : 10;
    const historyScore = matchedHistory.length
      ? Math.min(100, 45 + matchedHistory.reduce((sum, item) => sum + item.weight * 4, 0))
      : 10;
    const createdAt = new Date(content.createdAt).getTime();
    const freshnessDays = Number.isFinite(createdAt) ? Math.max(0, (Date.now() - createdAt) / 86400000) : 365;
    const freshnessScore = Math.max(20, 100 - freshnessDays / 3);
    let ruleScore = weakEvidenceScore * 0.55 + historyScore * 0.30 + freshnessScore * 0.15;
    if (content.hasCompleted && !matchedWeak.length) ruleScore -= 15;
    const reason = primaryWeak
      ? `最近一次涉及“${primaryWeak.category}”的测评中，${primaryWeak.attempts} 道题有 ${primaryWeak.wrongCount} 道答错，推荐学习这门相关课程。`
      : matchedHistory.length
        ? `与你近期学习的“${matchedHistory.slice(0, 2).map(item => item.name).join('、')}”相关，适合继续深入。`
        : '这是已发布的公共学习内容，可用于拓展学习。';
    return {
      contentId: content.id,
      title: content.title,
      contentType: content.type,
      coverUrl: content.coverUrl,
      summary: content.summary,
      tags,
      score: round(Math.max(0, ruleScore)),
      ruleScore: round(Math.max(0, ruleScore)),
      weakEvidenceScore: round(weakEvidenceScore),
      historyScore: round(historyScore),
      freshnessScore: round(freshnessScore),
      reason,
      matchedEvidence: [],
      evidence: matchedWeak.map(({ category, attempts, wrongCount, wrongRate }) => ({ category, attempts, wrongCount, wrongRate })),
      matchedKnowledgePoints: matchedWeak.map(item => item.category),
      matchedHistoryTags: matchedHistory.map(item => item.name),
      recommendationType: primaryWeak ? (content.hasCompleted ? 'weakness_review' : 'weakness_learning') : matchedHistory.length ? 'history_related' : 'public_discovery',
      rankSource: 'rules_fallback',
      sourceScope: 'public',
      hasCompleted: Boolean(content.hasCompleted),
      createdAt: content.createdAt
    };
  }

  static mergeAIRanking(candidates, aiRanking) {
    const aiById = new Map(aiRanking.map(item => [Number(item.contentId), item]));
    return candidates.map(candidate => {
      const ai = aiById.get(Number(candidate.contentId));
      if (!ai) return candidate;
      const score = ai.semanticScore * 0.60
        + candidate.weakEvidenceScore * 0.25
        + candidate.historyScore * 0.10
        + candidate.freshnessScore * 0.05;
      return {
        ...candidate,
        score: round(score),
        semanticScore: round(ai.semanticScore),
        rankSource: 'ai_hybrid'
      };
    }).sort((a, b) => Number(Boolean(b.evidence.length)) - Number(Boolean(a.evidence.length))
      || b.score - a.score || b.ruleScore - a.ruleScore);
  }

  static async recordFeedback(userId, contentId, action) {
    const allowed = ['view', 'start', 'complete', 'dismiss'];
    if (!allowed.includes(action)) throw new Error('无效的推荐反馈类型');
    const [rows] = await db.query(
      `SELECT id FROM contents WHERE id = ? AND isPublic = 1 AND status = 'published'`,
      [contentId]
    );
    if (!rows.length) throw Object.assign(new Error('公共学习内容不存在或已下架'), { statusCode: 404 });
    await db.query(
      `INSERT INTO recommendation_feedback (userId, contentId, action)
       VALUES (?, ?, ?)`,
      [userId, contentId, action]
    );
    return { contentId, action };
  }

  static async ensureDailyTable() {
    if (this.dailyTableReady) return true;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS recommendation_daily (
        userId INT NOT NULL,
        dayKey CHAR(10) NOT NULL,
        contentIds TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (userId, dayKey)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      this.dailyTableReady = true;
      return true;
    } catch (error) {
      console.warn('[recommendation_daily]', error.message);
      return false;
    }
  }

  static async loadDailySnapshot(userId, dayKey) {
    if (!(await this.ensureDailyTable())) return { ids: [], items: [] };
    try {
      const [rows] = await db.query(
        'SELECT contentIds FROM recommendation_daily WHERE userId = ? AND dayKey = ?',
        [userId, dayKey]
      );
      if (!rows.length) return { ids: [], items: [] };
      return parseSnapshot(rows[0].contentIds);
    } catch {
      return { ids: [], items: [] };
    }
  }

  static async saveDailySnapshot(userId, dayKey, items, revision) {
    if (!(await this.ensureDailyTable())) return;
    const list = (items || []).map(item => (typeof item === 'object' ? item : { contentId: item }));
    const payload = JSON.stringify({
      ids: list.map(item => Number(item.contentId)).filter(Boolean),
      items: list.filter(item => item.title || item.contentType),
      revision
    });
    try {
      await db.query(
        `INSERT INTO recommendation_daily (userId, dayKey, contentIds)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE contentIds = VALUES(contentIds)`,
        [userId, dayKey, payload]
      );
    } catch (error) {
      console.warn('[recommendation_daily save]', error.message);
    }
  }

}

module.exports = RecommendationService;
module.exports.normalizeTags = normalizeTags;
module.exports.applyDailyOrder = applyDailyOrder;
module.exports.beijingDayKey = beijingDayKey;
