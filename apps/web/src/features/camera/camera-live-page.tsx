'use client';

import { useEffect, useState } from 'react';
import {
  getCameraObservations,
  getCameraLiveConfiguration,
  type CameraObservation,
  type CameraLiveConfiguration,
} from './camera-live-api';
import { CameraRouteConfigurator } from './camera-route-configurator';
import styles from './camera-live.module.css';

type PlayerState = 'LOADING' | 'LOADED' | 'ERROR';

export function CameraLivePage() {
  const [configuration, setConfiguration] = useState<CameraLiveConfiguration | null>(null);
  const [message, setMessage] = useState('');
  const [playerState, setPlayerState] = useState<PlayerState>('LOADING');
  const [playerKey, setPlayerKey] = useState(0);
  const [observations, setObservations] = useState<CameraObservation[]>([]);

  useEffect(() => {
    Promise.all([getCameraLiveConfiguration(), getCameraObservations()])
      .then(([camera, recent]) => {
        setConfiguration(camera);
        setObservations(recent.items);
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : '摄像头配置加载失败'),
      );
  }, []);

  function reconnect() {
    setPlayerState('LOADING');
    setPlayerKey((value) => value + 1);
  }

  if (message) return <CameraMessage title="实时视频暂不可用" detail={message} />;
  if (!configuration) return <CameraMessage title="正在读取摄像头配置" detail="请稍候…" />;
  if (!configuration.enabled) {
    return <CameraMessage title="实时视频尚未启用" detail="请在服务端开启 CAMERA_LIVE_ENABLED。" />;
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p>CAMERA · CLIMBING VISION POC</p>
          <h2>{configuration.name}</h2>
          <span>
            {configuration.device.manufacturer} {configuration.device.model} · H.264 实时流
          </span>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.status} data-state={configuration.connectionStatus.toLowerCase()}>
            <i />
            {configuration.connectionStatus === 'ONLINE'
              ? '实时流在线'
              : configuration.connectionStatus === 'OFFLINE'
                ? '实时流不可用'
                : '实时流状态未知'}
          </span>
          <button type="button" onClick={reconnect}>
            重新连接
          </button>
        </div>
      </header>

      <section className={styles.workspace}>
        <div className={styles.playerCard}>
          <div className={styles.playerFrame}>
            <iframe
              allow="autoplay; fullscreen"
              allowFullScreen
              key={playerKey}
              referrerPolicy="strict-origin-when-cross-origin"
              src={configuration.player.url}
              title={`${configuration.name}实时画面`}
              onError={() => setPlayerState('ERROR')}
              onLoad={() => setPlayerState('LOADED')}
            />
          </div>
          <div className={styles.playerFooter}>
            <span>
              画面由 Azure GB28181 媒体平台提供 ·{' '}
              {playerState === 'LOADING'
                ? '播放器页面连接中'
                : playerState === 'LOADED'
                  ? '播放器页面已载入'
                  : '播放器页面载入失败'}
            </span>
            <a href={configuration.player.url} rel="noreferrer" target="_blank">
              在平台播放器中打开 ↗
            </a>
          </div>
        </div>

        <aside className={styles.inspector}>
          <section>
            <small>通道</small>
            <strong>{configuration.device.channelId}</strong>
            <dl>
              <div>
                <dt>编码</dt>
                <dd>{configuration.player.codec}</dd>
              </div>
              <div>
                <dt>传输</dt>
                <dd>{configuration.player.transport}</dd>
              </div>
              <div>
                <dt>业务状态</dt>
                <dd>{configuration.connectionStatus === 'ONLINE' ? '媒体在线' : '需要检查'}</dd>
              </div>
            </dl>
          </section>
          <section className={styles.notice}>
            <small>状态说明</small>
            <strong>
              {configuration.connectionStatus === 'ONLINE'
                ? '服务器已读取实时媒体数据'
                : '服务器未读取到实时媒体数据'}
            </strong>
            <p>{configuration.caveat}</p>
            <p>
              最近探测：{new Date(configuration.probe.checkedAt).toLocaleString('zh-CN')}
              {configuration.probe.latencyMs === null
                ? ''
                : ` · ${configuration.probe.latencyMs} ms`}
            </p>
          </section>
          <section>
            <small>识别能力</small>
            <strong>视觉线路配置已就绪</strong>
            <p>服务器侧实时算法 Worker 尚未启用；当前不会生成模拟攀爬结果。</p>
          </section>
        </aside>
      </section>
      <CameraRouteConfigurator />
      <ObservationList observations={observations} />
    </div>
  );
}

function ObservationList({ observations }: { observations: CameraObservation[] }) {
  return (
    <section className={styles.observations}>
      <header>
        <div>
          <small>VISION EVENTS</small>
          <h3>最近识别结果</h3>
        </div>
        <p>这里只展示视觉 Worker 实际写入的事件，不生成模拟结果。</p>
      </header>
      {observations.length ? (
        <div className={styles.observationTableWrap}>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>线路</th>
                <th>结果</th>
                <th>置信度</th>
                <th>复核</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((observation) => (
                <tr key={observation.id}>
                  <td>{new Date(observation.observedAt).toLocaleString('zh-CN')}</td>
                  <td>
                    <strong>{observation.route.code}</strong>
                    <small>{observation.route.name}</small>
                  </td>
                  <td>
                    <span
                      className={styles.outcome}
                      data-outcome={observation.outcome.toLowerCase()}
                    >
                      {outcomeLabel(observation.outcome)}
                    </span>
                  </td>
                  <td>
                    {typeof observation.analysis?.confidence === 'number'
                      ? `${Math.round(observation.analysis.confidence * 100)}%`
                      : '—'}
                  </td>
                  <td>{observation.analysis?.requiresReview ? '需要' : '否'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.observationEmpty}>
          <strong>还没有真实识别事件</strong>
          <p>Worker 在线后会监控全部已发布且已完成视觉定义的线路，并在真实尝试结束后写入结果。</p>
        </div>
      )}
    </section>
  );
}

function outcomeLabel(outcome: CameraObservation['outcome']) {
  if (outcome === 'COMPLETED') return '完攀';
  if (outcome === 'FAILED') return '失败';
  if (outcome === 'ABANDONED') return '放弃';
  return '不确定';
}

function CameraMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <section className={styles.message}>
      <span>VIDEO</span>
      <h2>{title}</h2>
      <p>{detail}</p>
    </section>
  );
}
