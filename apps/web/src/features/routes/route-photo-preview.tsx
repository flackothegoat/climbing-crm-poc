'use client';

import { useEffect, useState } from 'react';
import { routePhotoUrl, type OperationalRoute } from './route-operations-api';
import styles from './routes.module.css';

export function RoutePhotoPreview({ route }: { route: OperationalRoute }) {
  const [open, setOpen] = useState(false);
  const photoUrl = routePhotoUrl(route.id);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return (
    <>
      <div className={styles.routePhotoFrame}>
        <button
          aria-haspopup="dialog"
          aria-label={`查看 ${route.name} 的完整线路截图`}
          className={styles.routePhotoButton}
          type="button"
          onClick={() => setOpen(true)}
        >
          {/* Authenticated same-origin image; the browser sends the session cookie. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.routePhoto} src={photoUrl} alt={`${route.name} 线路`} />
          <span className={styles.routePhotoHint}>查看完整截图</span>
        </button>
      </div>
      {open && (
        <div
          className={styles.dialogBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            aria-label={`${route.name} 完整线路截图`}
            aria-modal="true"
            className={styles.photoDialog}
            role="dialog"
          >
            <button
              aria-label="关闭完整线路截图"
              className={styles.dialogClose}
              type="button"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.routePhotoFull}
              src={photoUrl}
              alt={`${route.name} 完整线路截图`}
            />
            <p>
              {route.code} · {route.name}
            </p>
          </section>
        </div>
      )}
    </>
  );
}
