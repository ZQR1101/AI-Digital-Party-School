const path = require('path');
const DocumentParser = require('../rag/documentParser');
const { BM25Retriever } = require('../rag/bm25');
const { VectorStore, EmbeddingClient } = require('../rag/vectorStore');
const { reciprocalRankFusion } = require('../rag/fusion');
const Reranker = require('../rag/reranker');
const { AIClient } = require('./aiClient');
const LearningProfileService = require('./learningProfileService');

const KNOWLEDGE_DIR = path.resolve(__dirname, '../../knowledge');
const RELEVANCE_THRESHOLD = 0.28;

class RagService {
  static isInitialized = false;
  static chunks = [];
  static bm25 = new BM25Retriever();
  static vectorStore = new VectorStore();

  static async init(force = false) {
    if (this.isInitialized && !force) return;

    this.chunks = DocumentParser.loadFromDirectory(KNOWLEDGE_DIR);
    this.bm25.index(this.chunks);
    await this.vectorStore.index(this.chunks);
    this.isInitialized = true;
  }

  /**
   * 混合检索 (BM25 + 向量检索 + RRF 融合 + Reranker 重排)
   */
  static async hybridSearch(query, options = {}) {
    await this.init();

    if (!query || !this.chunks.length) return [];

    const topK = options.topK || 4;
    const topN = options.topN || 20;
    const bm25Weight = options.bm25Weight ?? 1.0;
    const vectorWeight = options.vectorWeight ?? 1.0;

    // 1. 并行执行双路召回
    const [bm25Hits, vectorHits] = await Promise.all([
      this.bm25.search(query, topN),
      this.vectorStore.search(query, topN)
    ]);

    // 2. RRF 倒数排名融合算法消除量纲差异
    const rrfCandidates = reciprocalRankFusion(bm25Hits, vectorHits, {
      k: 60,
      topN,
      bm25Weight,
      vectorWeight
    });

    // 3. Reranker 深度语义精排
    const reranked = await Reranker.rerank(query, rrfCandidates, topK);
    return reranked;
  }

  /**
   * 检索后端诊断：暴露 Embedding/Reranker 实际使用的模型与是否语义检索。
   * 用于评测报告与运维排障，确认真实模型是否生效。
   */
  static getBackendStatus() {
    return {
      embedding: EmbeddingClient.getBackendInfo(),
      reranker: Reranker.getBackendInfo(),
      chunkCount: this.chunks.length,
      vectorDim: this.vectorStore.vectorDim,
      initialized: this.isInitialized
    };
  }

  /**
   * 保持旧接口完全向下兼容
   */
  static async search(query, topK = 3) {
    const hits = await this.hybridSearch(query, { topK });
    return hits.map(item => ({
      title: item.chunk.title,
      source: item.chunk.source,
      content: item.chunk.content,
      score: item.relevanceScore
    }));
  }

  /**
   * 党务问答：带来源引用的智能解答与防幻觉兜底
   */
  static async ask(question, options = {}) {
    const trace = options.trace || {};
    const topK = options.topK || 4;

    const results = await this.hybridSearch(question, { topK });

    // 防模型幻觉门禁：如果知识库未检索到足够相关内容，明确告知用户，不编造答案
    const isRelevant = results.length > 0 && results[0].relevanceScore >= RELEVANCE_THRESHOLD;
    if (!isRelevant) {
      trace.ragOutcome = 'no_relevant_knowledge';
      return {
        scene: 'knowledge_qa',
        question,
        answer: '党校知识库中暂未收录与该问题直接相关的规章制度或学习资料，无法为您准确解答。请查阅权威党务文献或向所在党组织管理员咨询。',
        sources: [],
        isGrounded: false,
        relevantCount: 0,
        generatedAt: new Date().toISOString()
      };
    }

    // 构建带序号的上下文资料
    const context = results.map((r, i) => `[${i + 1}] 《${r.chunk.source}》- ${r.chunk.title}\n${r.chunk.content}`).join('\n\n');

    let generatedAnswer = null;
    try {
      generatedAnswer = await AIClient.generateRagAnswer({ question, context }, trace);
    } catch (err) {
      trace.ragAiError = err.message;
    }

    // 确定性事实兜底（当大模型服务不可用时，基于重排第一条及相关条款生成结构化摘要）
    const answer = generatedAnswer || this.buildFallbackAnswer(results, question);

    return {
      scene: 'knowledge_qa',
      question,
      answer,
      sources: results.map((r, i) => ({
        id: i + 1,
        title: r.chunk.title,
        source: r.chunk.source,
        excerpt: r.chunk.content.slice(0, 160).replace(/\n/g, ' ') + '...',
        relevanceScore: r.relevanceScore,
        rrfScore: Math.round(r.rrfScore * 10000) / 10000
      })),
      isGrounded: true,
      relevantCount: results.length,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 学习画像 + RAG 个性化问答联动
   * 读取学员学习画像，检测薄弱知识点，检索知识库材料，生成有针对性的学习建议
   */
  static async personalizedAsk(question, actor, trace = {}) {
    if (!actor?.userId) {
      throw Object.assign(new Error('学员身份无效，无法读取学习画像'), { statusCode: 401 });
    }

    // 1. 读取学员学习画像
    const profile = await LearningProfileService.getProfile(actor.userId);
    const weakCategories = profile.weakCategories || [];
    const weakTopicNames = weakCategories.map(w => w.category);

    // 2. 根据学员画像薄弱点检索针对性学习材料
    const searchQuery = weakTopicNames.length
      ? `${question} ${weakTopicNames.slice(0, 2).join(' ')}`
      : question;

    const results = await this.hybridSearch(searchQuery, { topK: 4 });
    const context = results.map((r, i) => `[${i + 1}] 《${r.chunk.source}》- ${r.chunk.title}\n${r.chunk.content}`).join('\n\n');

    const profileFacts = {
      userName: profile.userName,
      completionRate: profile.completionRate,
      completedTasks: profile.completedTasks,
      totalTasks: profile.totalTasks,
      weakKnowledgePoints: weakCategories.slice(0, 4).map(w => ({
        category: w.category,
        wrongRate: `${w.wrongRate}%`,
        wrongCount: w.wrongCount
      })),
      recentWrongQuestions: (profile.recentWrongQuestions || []).slice(0, 3).map(q => q.category)
    };

    let generatedAnswer = null;
    try {
      generatedAnswer = await AIClient.generatePersonalizedRagAnswer({
        question,
        profile: profileFacts,
        context
      }, trace);
    } catch (err) {
      trace.personalizedRagAiError = err.message;
    }

    const answer = generatedAnswer || this.buildFallbackPersonalizedAnswer(profile, results, question);

    return {
      scene: 'learning_evaluation',
      question,
      answer,
      profileSummary: {
        userName: profile.userName,
        completionRate: profile.completionRate,
        weakCategories: weakCategories.slice(0, 3)
      },
      sources: results.map((r, i) => ({
        id: i + 1,
        title: r.chunk.title,
        source: r.chunk.source,
        excerpt: r.chunk.content.slice(0, 160).replace(/\n/g, ' ') + '...',
        relevanceScore: r.relevanceScore
      })),
      suggestions: weakCategories.slice(0, 3).map(w => ({
        title: `强化 ${w.category} 学习`,
        content: `当前错题率为 ${w.wrongRate}%，建议结合知识库专题资料进行专项强化复习。`
      })),
      generatedAt: new Date().toISOString()
    };
  }

  static buildFallbackAnswer(results, question) {
    const top = results[0];
    let answer = `根据党校知识库资料《${top.chunk.source}》（${top.chunk.title}）[1]：\n\n${top.chunk.content}`;
    if (results.length > 1) {
      const second = results[1];
      answer += `\n\n补充参考《${second.chunk.source}》（${second.chunk.title}）[2]：\n${second.chunk.content.slice(0, 200)}...`;
    }
    return answer;
  }

  static buildFallbackPersonalizedAnswer(profile, results, question) {
    const weakList = (profile.weakCategories || []).slice(0, 3);
    let answer = `结合您的学习画像分析：`;
    if (weakList.length) {
      answer += `您当前主要在【${weakList.map(w => w.category).join('】、【')}】等知识点上存在错题（错题率分别为 ${weakList.map(w => `${w.category}: ${w.wrongRate}%`).join('，')}）。\n\n针对薄弱环节，为您检索了重点学习材料：\n`;
      results.slice(0, 2).forEach((r, i) => {
        answer += `\n[${i + 1}] 《${r.chunk.source}》${r.chunk.title}：${r.chunk.content.slice(0, 180)}...\n`;
      });
      answer += `\n建议：优先温习上述知识要点，结合错题进行针对性查漏补缺，提升理论掌握度。`;
    } else {
      answer += `您近期的学习完成情况良好，各项考核暂未出现明显薄弱点。建议继续保持学习节奏，重点阅读《${results[0]?.chunk.source || '党规党纪要点'}》强化理论深度。`;
    }
    return answer;
  }
}

module.exports = RagService;
