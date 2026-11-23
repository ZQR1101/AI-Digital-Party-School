/**
 * 登录失败限流：同一 key（用户名+IP）连续失败达到阈值后临时锁定。
 * 纯内存实现，适合单实例部署；返回的判定逻辑抽为纯函数便于测试。
 */
const defaultMaxAttempts = 5;
const defaultLockMs = 15 * 60 * 1000;

class LoginGuard {
  constructor({ maxAttempts = defaultMaxAttempts, lockMs = defaultLockMs, now = () => Date.now() } = {}) {
    this.maxAttempts = maxAttempts;
    this.lockMs = lockMs;
    this.now = now;
    this.records = new Map();
  }

  _get(key) {
    return this.records.get(key) || { failures: 0, lockedUntil: 0 };
  }

  /** 是否被锁定；返回剩余锁定毫秒数（0 表示未锁定） */
  remainingLockMs(key) {
    const rec = this._get(key);
    if (rec.lockedUntil <= this.now()) return 0;
    return rec.lockedUntil - this.now();
  }

  isLocked(key) {
    return this.remainingLockMs(key) > 0;
  }

  /** 登录成功：清除失败记录 */
  succeed(key) {
    this.records.delete(key);
  }

  /** 登录失败：累加计数，达阈值后锁定。返回是否处于锁定状态 */
  fail(key) {
    const rec = this._get(key);
    const current = this.now();
    // 锁定已过期则重置计数
    if (rec.lockedUntil && rec.lockedUntil <= current) {
      rec.failures = 0;
      rec.lockedUntil = 0;
    }
    rec.failures += 1;
    if (rec.failures >= this.maxAttempts) {
      rec.lockedUntil = current + this.lockMs;
      rec.failures = this.maxAttempts;
    }
    this.records.set(key, rec);
    return this.isLocked(key);
  }

  /** 清理过期记录，避免内存无限增长 */
  prune() {
    const current = this.now();
    for (const [key, rec] of this.records) {
      if (rec.lockedUntil && rec.lockedUntil <= current && rec.failures < this.maxAttempts) {
        this.records.delete(key);
      }
    }
  }
}

module.exports = { LoginGuard, defaultMaxAttempts, defaultLockMs };
