# 数智党校管理后台

基于 Vue 3、Vite、Element Plus、Vue Router、Pinia、Axios 和 ECharts 的管理后台前端。

## 本地运行

```bash
npm install
npm run dev
```

默认访问地址：`http://localhost:5173`。

## 当前进度

- 已完成：Mock 登录、统一后台框架、数据总览、组织架构、人员管理、学习内容、学习任务、题库与试卷、AI 数据查询。
- 页面视觉基于 Stitch 导出的 `Red Governance Digital System` 设计规范进行 Vue 化，并统一为同一套侧栏、顶栏、色彩和组件体系。
- API 默认使用 `/api` 前缀，开发环境代理至团队后端 `http://127.0.0.1:3000`。

当前登录为演示模式，账号和密码均不校验。接入后端时应替换为 `POST /api/auth/login`，并保留现有 Bearer Token 请求拦截器。

## 团队约定

- 请求及响应字段统一使用 camelCase。
- 组织类型使用 `committee`、`generalBranch`、`branch`、`group`。
- 分页参数使用 `page`、`pageSize`，响应数据使用 `total`、`list`。
- 不要提交密码、Token、API Key 或 `.env.local`。
