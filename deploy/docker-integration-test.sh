#!/usr/bin/env bash
#
# Docker 集成测试：验证容器真实构建与启动、两个前端健康接口、指标隔离、
# 数据库与上传文件在容器重建后的持久化。
#
# 隔离保证（不得触碰已有部署数据）：
#   1. 独立 compose 项目名（-p it-<时间戳>-<随机>）→ 命名卷/网络/容器全部独立；
#   2. deploy/docker-compose.it.yml 覆盖 container_name 为带运行标识的唯一名；
#   3. 端口错开：默认 18080/18081（可用 IT_ADMIN_PORT/IT_MEMBER_PORT 覆盖）；
#   4. 结束时 docker compose down -v 清理本项目全部临时卷，并断言无遗留。
#
# 用法：bash deploy/docker-integration-test.sh
set -euo pipefail

cd "$(dirname "$0")/.."   # 项目根目录

PROJECT="it-$(date +%s)-$RANDOM"
IT_RUN_ID="${IT_RUN_ID:-$PROJECT}"
ADMIN_PORT="${IT_ADMIN_PORT:-18080}"
MEMBER_PORT="${IT_MEMBER_PORT:-18081}"
export ADMIN_PORT MEMBER_PORT IT_RUN_ID
export DB_PASSWORD="${IT_DB_PASSWORD:-it-only-root-pwd-2026}"
export SEED_PASSWORD="${IT_SEED_PASSWORD:-it-seed-pwd-2026-strong}"
export JWT_SECRET="${IT_JWT_SECRET:-it-only-jwt-secret-not-for-production}"

COMPOSE="docker compose -p $PROJECT -f docker-compose.yml -f deploy/docker-compose.it.yml"
MARKER_ID=987654

step() { printf '\n===== [IT] %s =====\n' "$1"; }
fail() { printf '\n[IT] ✗ 失败：%s\n' "$1" >&2; exit 1; }
ok()   { printf '[IT] ✓ %s\n' "$1"; }

# HTTP 状态码与响应体
http_code() { curl -s -o /dev/null -w '%{http_code}' "$1" || echo 000; }
http_body() { curl -s "$1" || true; }

# 在 mysql 容器内执行 SQL（-N 去表头）
db_sql() {
  $COMPOSE exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" party_school -N -e "$1"' sh "$1"
}

cleanup() {
  $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

step "前置检查：运行标识唯一，无同名残留容器/卷"
[ -z "$(docker ps -aq --filter "name=party-it-$IT_RUN_ID")" ] || fail "已存在同名容器，请先清理或更换 IT_RUN_ID"
[ -z "$(docker volume ls -q | grep "^${PROJECT}_" || true)" ] || fail "已存在同名卷"
ok "隔离标识 $PROJECT 可用"

step "构建并启动完整栈（项目 $PROJECT，端口 $ADMIN_PORT/$MEMBER_PORT）"
$COMPOSE up -d --build || fail "docker compose up --build 失败"
ok "栈已启动"

wait_ready() {
  local deadline=$((SECONDS + 300))
  printf '[IT] 等待栈就绪（最多 300s）…\n'
  until [ "$(http_code "http://localhost:${ADMIN_PORT}/api/health/ready")" = "200" ] \
     && [ "$(http_code "http://localhost:${MEMBER_PORT}/api/health/ready")" = "200" ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      $COMPOSE ps || true
      $COMPOSE logs --tail=50 db-init server || true
      fail "栈未在 300s 内就绪"
    fi
    sleep 3
  done
}

step "验证 1：两个前端健康接口（Nginx → /api/health → 后端 liveness/readiness）"
wait_ready
for PORT in "$ADMIN_PORT" "$MEMBER_PORT"; do
  LIVENESS=$(http_body "http://localhost:${PORT}/api/health")
  echo "$LIVENESS" | grep -q '"status":"ok"' || fail "端口 $PORT /api/health 存活探针异常：$LIVENESS"
  READY=$(http_body "http://localhost:${PORT}/api/health/ready")
  echo "$READY" | grep -q '"status":"ready"' && echo "$READY" | grep -q '"db":true' \
    || fail "端口 $PORT /api/health/ready 就绪探针异常：$READY"
done
ok "两端 liveness 与 readiness（含 DB 检查）均通过"

step "验证 2：前端静态页面可访问"
ADMIN_CODE=$(http_code "http://localhost:${ADMIN_PORT}/")
MEMBER_CODE=$(http_code "http://localhost:${MEMBER_PORT}/")
[ "$ADMIN_CODE" = "200" ] || fail "admin 首页 HTTP $ADMIN_CODE"
[ "$MEMBER_CODE" = "200" ] || fail "member 首页 HTTP $MEMBER_CODE"
http_body "http://localhost:${ADMIN_PORT}/" | grep -qi '<html' || fail "admin 首页不是 HTML"
http_body "http://localhost:${MEMBER_PORT}/" | grep -qi '<html' || fail "member 首页不是 HTML"
ok "两端首页 HTML 200"

step "验证 3：指标隔离——/metrics 不经 Nginx 公开，仅容器网络内部可采集"
M_ADMIN=$(http_code "http://localhost:${ADMIN_PORT}/api/metrics")
M_MEMBER=$(http_code "http://localhost:${MEMBER_PORT}/api/metrics")
[ "$M_ADMIN" = "404" ] || fail "经 admin Nginx 访问 /api/metrics 返回 $M_ADMIN（应为 404）"
[ "$M_MEMBER" = "404" ] || fail "经 member Nginx 访问 /api/metrics 返回 $M_MEMBER（应为 404）"
$COMPOSE exec -T server node -e \
  "fetch('http://127.0.0.1:3001/metrics').then(async r=>{const t=await r.text();console.log('内部 /metrics →',r.status);process.exit(r.status===200&&t.includes('requestsTotal')?0:1)})" \
  || fail "容器网络内部采集 /metrics 失败"
ok "外部 404 / 内部 200，指标未公开"

step "验证 4（准备标记）：写入数据库标记行与上传卷标记文件"
USERS_BEFORE=$(db_sql "SELECT COUNT(*) FROM users")
db_sql "INSERT INTO organizations (id, name, type) VALUES (${MARKER_ID}, 'IT-持久化标记', 'committee')" >/dev/null
$COMPOSE exec -T server sh -c 'echo "it-persist-marker" > /app/uploads/it-marker.txt'
docker volume ls -q | grep -q "^${PROJECT}_" || fail "未发现项目临时卷"
ok "users=$USERS_BEFORE，标记行 id=$MARKER_ID 与 uploads/it-marker.txt 已写入"

step "验证 5：容器重建（down 保留卷 → up 重建容器）后数据持久化"
$COMPOSE down --remove-orphans >/dev/null 2>&1
docker volume ls -q | grep -q "^${PROJECT}_" || fail "down 未带 -v 却丢失了命名卷（持久化配置失效）"
$COMPOSE up -d || fail "重建启动失败"
wait_ready
USERS_AFTER=$(db_sql "SELECT COUNT(*) FROM users")
[ "$USERS_AFTER" = "$USERS_BEFORE" ] || fail "users 数量变化：$USERS_BEFORE → $USERS_AFTER"
MARKER_ROW=$(db_sql "SELECT name FROM organizations WHERE id = ${MARKER_ID}")
[ "$MARKER_ROW" = "IT-持久化标记" ] || fail "数据库标记行未持久化（查到：$MARKER_ROW）"
MARKER_FILE=$($COMPOSE exec -T server sh -c 'cat /app/uploads/it-marker.txt')
[ "$MARKER_FILE" = "it-persist-marker" ] || fail "uploads 标记文件未持久化（查到：$MARKER_FILE）"
ok "users 数量不变、数据库标记行与上传文件均在容器重建后存活"

step "验证 6：清理——down -v 移除全部临时卷，不遗留任何资源"
cleanup
sleep 2
LEFT_VOLUMES=$(docker volume ls -q | grep "^${PROJECT}_" || true)
[ -z "$LEFT_VOLUMES" ] || fail "遗留临时卷：$LEFT_VOLUMES"
LEFT_CONTAINERS=$(docker ps -aq --filter "name=party-it-$IT_RUN_ID" || true)
[ -z "$LEFT_CONTAINERS" ] || fail "遗留容器：$LEFT_CONTAINERS"
ok "临时卷与容器已全部清理，未触碰其他部署数据"

printf '\n==============================\n[IT] 全部 6 项验证通过 ✔\n==============================\n'
