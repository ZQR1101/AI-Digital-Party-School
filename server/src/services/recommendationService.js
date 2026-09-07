const db = require('../config/db');
const LearningProfileService = require('./learningProfileService');
const { AIClient } = require('./aiClient');

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  return String(value || '').split(/[,，;；]/).map(item => item.trim()).filter(Boolean);
}

function includesSignal(searchable, signal) {
  const normalized = String(signal || '').trim().toLowerCase();
  return normalized.length > 0 && searchable.includes(normalized);
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function beijingDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function toPublicItem(item) {
  const { ruleScore, weakEvidenceScore, historyScore, freshnessScore, ...publicItem } = item;
  return publicItem;
}

function parseSnapshot(raw) {
  const parsed = JSON.parse(raw || '[]');
  if (Array.isArray(parsed)) {
    if (parsed.length && typeof parsed[0] === 'object') {
      return { ids: parsed.map(item => Number(item.contentId)).filter(Boolean), items: parsed };
    }
    return { ids: parsed.map(Number).filter(Boolean), items: [] };
  }
  if (parsed && typeof parsed === 'object') {
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const ids = (parsed.ids || items.map(item => item.contentId)).map(Number).filter(Boolean);
    return { ids, items };
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
  static async getForUser(userId, limit = 5) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
    const dayKey = beijingDayKey();
    const snapshot = await this.loadDailySnapshot(userId, dayKey);
    const live = await this.getPublicCandidates(userId);
    const liveIds = new Set(live.map(item => Number(item.id)));

    if (snapshot.items.length) {
      const kept = snapshot.items.filter(item => liveIds.has(Number(item.contentId))).slice(0, safeLimit);
      if (kept.length) {
        if (kept.length !== snapshot.items.length) {
          await this.saveDailySnapshot(userId, dayKey, kept);
        }
        // 每日快照直接复用（含规则降级结果）：当天内容不再重新计算，
        // 否则规则模式下缓存永远不命中，首页每次打开都要等待AI超时。
        return this.present(kept, { recommendationMode: 'daily_cache', cached: true });
      }
    }

    if (snapshot.ids.length && snapshot.items.some(item => item.rankSource === 'ai_hybrid')) {
      const hydrated = snapshot.ids
        .map(id => live.find(item => Number(item.id) === Number(id)))
        .filter(Boolean)
        .map(item => this.rankContent(item, [], []))
        .map(toPublicItem)
        .slice(0, safeLimit);
      if (hydrated.length) {
        await this.saveDailySnapshot(userId, dayKey, hydrated);
        return this.present(hydrated, { recommendationMode: 'daily_cache', cached: true });
      }
    }

    const profile = await LearningProfileService.getProfile(userId);
    const historySignals = this.buildHistorySignals(profile.learningHistory);
    const ruleRanked = live.map(content => this.rankContent(content, profile.weakCategories, historySignals))
      .sort((a, b) => b.ruleScore - a.ruleScore || new Date(b.createdAt) - new Date(a.createdAt));
    const candidatePool = ruleRanked.slice(0, 20);
    let recommendations = candidatePool;
    let recommendationMode = 'rules_fallback';
    let aiError = null;
    try {
      const aiRanking = await AIClient.rankLearningContents(profile, candidatePool);
      if (aiRanking?.length) {
        recommendations = this.mergeAIRanking(candidatePool, aiRanking);
        recommendationMode = 'ai_hybrid';
      }
    } catch (error) {
      aiError = error.message;
      console.warn('[AI recommendation fallback]', error.message);
    }

    recommendations = applyDailyOrder(recommendations, snapshot.ids, safeLimit).map(toPublicItem);
    await this.saveDailySnapshot(userId, dayKey, recommendations);
    return this.present(recommendations, {
      recommendationMode,
      aiError,
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

  static async getPublicCandidates(userId, includeFeedback = true) {
    const dismissClause = includeFeedback
      ? `AND NOT EXISTS (
           SELECT 1 FROM recommendation_feedback dismissed
           WHERE dismissed.userId = ? AND dismissed.contentId = c.id
             AND dismissed.action = 'dismiss'
         )`
      : '';
    try {
      const [contents] = await db.query(
      `SELECT c.id, c.title, c.type, c.coverUrl, c.bodyOrVideoUrl, c.summary, c.tags, c.createdAt,
              EXISTS (
                SELECT 1 FROM learning_tasks completedTask
                JOIN learning_records completedRecord ON completedRecord.taskId = completedTask.id
                WHERE completedTask.contentId = c.id AND completedRecord.userId = ?
                  AND completedRecord.status = 'completed'
              ) AS hasCompleted
       FROM contents c
       WHERE c.isPublic = 1 AND c.status = 'published'
         ${dismissClause}
       ORDER BY c.createdAt DESC
       LIMIT 60`,
        includeFeedback ? [userId, userId] : [userId]
      );
      return contents;
    } catch (error) {
      if (includeFeedback && error.code === 'ER_NO_SUCH_TABLE') {
        console.warn('[Recommendation feedback disabled] recommendation_feedback table is missing');
        return this.getPublicCandidates(userId, false);
      }
      throw error;
    }
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
    const searchable = `${content.title || ''} ${content.summary || ''} ${tags.join(' ')}`.toLowerCase();
    const matchedWeak = weakCategories.filter(item => includesSignal(searchable, item.category));
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
      ? content.hasCompleted
        ? `你在“${primaryWeak.category}”仍存在薄弱项，建议通过该内容再次复习巩固。`
        : `该内容与“${primaryWeak.category}”薄弱知识点相关，建议优先学习。`
      : matchedHistory.length
        ? `与你近期学习的“${matchedHistory.slice(0, 2).map(item => item.name).join('、')}”相关，适合继续深入。`
        : '这是已发布的公共学习内容，可用于拓展学习。';
    return {
      contentId: content.id,
      title: content.title,
      contentType: content.type,
      coverUrl: content.coverUrl,
      contentUrl: content.bodyOrVideoUrl,
      summary: content.summary,
      tags,
      score: round(Math.max(0, ruleScore)),
      ruleScore: round(Math.max(0, ruleScore)),
      weakEvidenceScore: round(weakEvidenceScore),
      historyScore: round(historyScore),
      freshnessScore: round(freshnessScore),
      reason,
      matchedEvidence: [],
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
    const byId = new Map(candidates.map(item => [Number(item.contentId), item]));
    const aiById = new Map(aiRanking.map(item => [Number(item.contentId), item]));
    return candidates.map(candidate => {
      const ai = aiById.get(Number(candidate.contentId));
      if (!ai) return candidate;
      const score = ai.semanticScore * 0.60
        + candidate.weakEvidenceScore * 0.25
        + candidate.historyScore * 0.10
        + candidate.freshnessScore * 0.05;
      return {
        ...byId.get(Number(candidate.contentId)),
        score: round(score),
        semanticScore: round(ai.semanticScore),
        reason: ai.reason,
        matchedEvidence: ai.matchedEvidence,
        rankSource: 'ai_hybrid'
      };
    }).sort((a, b) => b.score - a.score || b.ruleScore - a.ruleScore);
  }

  static async recordFeedback(userId, contentId, action) {
    const allowed = ['view', 'start', 'complete', 'dismiss'];
    if (!allowed.includes(action)) throw new Error('无效的推荐反馈类型');
    const [rows] = await db.query(
      `SELECT id FROM contents WHERE id = ? AND isPublic = 1 AND status = 'published'`,
      [contentId]
    );
    if (!rows.length) throw new Error('公共学习内容不存在或已下架');
    await db.query(
      `INSERT INTO recommendation_feedback (userId, contentId, action)
       VALUES (?, ?, ?)`,
      [userId, contentId, action]
    );
    if (action === 'dismiss') {
      const dayKey = beijingDayKey();
      const snapshot = await this.loadDailySnapshot(userId, dayKey);
      const items = (snapshot.items.length ? snapshot.items : snapshot.ids.map(id => ({ contentId: id })))
        .filter(item => Number(item.contentId) !== Number(contentId));
      await this.saveDailySnapshot(userId, dayKey, items);
    }
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

  static async loadDailyIds(userId, dayKey) {
    const snapshot = await this.loadDailySnapshot(userId, dayKey);
    return snapshot.ids;
  }

  static async saveDailySnapshot(userId, dayKey, items) {
    if (!(await this.ensureDailyTable())) return;
    const list = (items || []).map(item => (typeof item === 'object' ? item : { contentId: item }));
    const payload = JSON.stringify({
      ids: list.map(item => Number(item.contentId)).filter(Boolean),
      items: list.filter(item => item.title || item.contentType),
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

  static async saveDailyIds(userId, dayKey, ids) {
    await this.saveDailySnapshot(userId, dayKey, (ids || []).map(id => ({ contentId: id })));
  }
}

module.exports = RecommendationService;
module.exports.normalizeTags = normalizeTags;
module.exports.applyDailyOrder = applyDailyOrder;
module.exports.beijingDayKey = beijingDayKey;
