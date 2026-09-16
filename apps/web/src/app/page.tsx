import { AuthForm } from '../features/auth/auth-form';

export default function HomePage() {
  return (
    <main className="auth-page">
      <section className="intro-panel">
        <div className="intro-route" aria-hidden="true">
          <svg viewBox="0 0 520 680" fill="none" preserveAspectRatio="xMidYMid slice">
            <path d="M76 636C92 526 38 442 134 372C232 301 174 204 282 154C362 117 391 67 440 18" />
            <circle cx="76" cy="636" r="9" />
            <circle cx="126" cy="381" r="9" />
            <circle cx="270" cy="162" r="9" />
            <circle cx="440" cy="18" r="9" />
          </svg>
        </div>
        <div className="intro-content">
          <div className="intro-brand">
            <div className="brand-mark" aria-hidden="true">
              ↗
            </div>
            <div>
              <strong>Climbing</strong>
              <span>数字化运营平台</span>
            </div>
          </div>

          <div className="intro-copy">
            <h2>
              把每一次向上，
              <br />
              都变成岩馆更好的下一步。
            </h2>
            <p>从岩点与线路建档，到摄像头识别和攀爬复盘，一处看清岩馆每天正在发生什么。</p>
          </div>

          <div className="feature-list" aria-label="平台核心功能">
            <span>
              <i aria-hidden="true">01</i>
              岩点资产管理
            </span>
            <span>
              <i aria-hidden="true">02</i>
              线路视觉建档
            </span>
            <span>
              <i aria-hidden="true">03</i>
              摄像头识别复盘
            </span>
          </div>
        </div>
      </section>
      <section className="form-panel">
        <AuthForm />
      </section>
    </main>
  );
}
