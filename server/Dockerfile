# 后端服务镜像：生产依赖 + 非 root 运行
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# 先装依赖（利用镜像层缓存）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 应用代码与幂等迁移脚本
COPY sql ./sql
COPY init-db.js upgrade-ai.js upgrade-papers.js upgrade-assessments.js ./
COPY src ./src

RUN mkdir -p /app/uploads /app/logs && chown -R node:node /app
USER node

EXPOSE 3001

# 健康检查走就绪探针（含 MySQL 连通检查）
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/health/ready" > /dev/null 2>&1 || exit 1

CMD ["node", "src/app.js"]
