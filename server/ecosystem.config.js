module.exports = {
  apps: [
    {
      name: 'party-school-server',
      script: 'src/app.js',
      // 实例数（cluster 模式，生产环境推荐）
      instances: 1,
      // 启用集群模式
      exec_mode: 'fork',
      // 环境变量
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      // 开发环境
      env_development: {
        NODE_ENV: 'development',
        PORT: 3001
      },
      // 日志配置
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // 自动重启配置
      max_memory_restart: '500M',
      // 监听文件变化（开发用）
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads']
    }
  ]
};
