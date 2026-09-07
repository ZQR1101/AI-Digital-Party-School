# 数智党校移动端

## 本地启动

不要双击 `index.html`。这是 Vite 项目，需要在本目录运行：

```powershell
npm install
npm run dev
```

然后打开终端提示的地址（默认是 `http://localhost:5173`）。

生产构建：

```powershell
npm run build
```

当前默认进入党员登录页，初始化演示党员为 `lisi / admin123`。登录后首页展示 AI 个性化公共内容推荐；后端和 MySQL 未启动时会显示明确的加载失败状态。

- 推荐首页：`/#/home`
- 在线测评：`/#/exam`
- 学习档案：`/#/record`

AI 推荐需要在 `server/.env` 中配置 `AI_API_URL`、`AI_API_KEY` 和 `AI_MODEL`。模型不可用时会自动切换为规则推荐。

## 技术说明

This template should help get you started developing with Vue 3 in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about IDE Support for Vue in the [Vue Docs Scaling up Guide](https://vuejs.org/guide/scaling-up/tooling.html#ide-support).
