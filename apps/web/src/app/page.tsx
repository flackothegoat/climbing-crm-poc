import { AuthForm } from '../features/auth/auth-form';

export default function HomePage() {
  return (
    <main className="auth-page">
      <section className="intro-panel">
        <div className="brand-mark" aria-hidden="true">
          ↗
        </div>
        <p className="eyebrow">MODULE 01</p>
        <h2>
          让岩馆运营
          <br />
          从一个清晰的入口开始。
        </h2>
        <p>面向 L1 / L2 管理员的轻量 CRM。使用邮箱安全登录，逐步接入后续业务模块。</p>
        <div className="feature-list">
          <span>账户与岩馆隔离</span>
          <span>安全会话与审计</span>
          <span>可演进权限模型</span>
        </div>
      </section>
      <section className="form-panel">
        <AuthForm />
      </section>
    </main>
  );
}
