import { Injectable } from '@nestjs/common';
import type { CurrentSession } from '../auth/session.service';
import { AppConfigService } from '../config/app-config.service';
import { AccessControlService, Capability } from '../security/access-control.service';
import type { CameraWorkerHeartbeat } from './camera-worker-status.dto';

const ONLINE_WINDOW_MS = 30_000;

@Injectable()
export class CameraWorkerStatusService {
  private latest: CameraWorkerHeartbeat | null = null;

  constructor(
    private readonly access: AccessControlService,
    private readonly config: AppConfigService,
  ) {}

  record(heartbeat: CameraWorkerHeartbeat) {
    this.latest = heartbeat;
    return { accepted: true };
  }

  get(session: CurrentSession) {
    this.access.assert(session, Capability.ASSET_READ);
    const configured = Boolean(
      this.config.values.CAMERA_WORKER_TOKEN &&
      this.config.values.CAMERA_WORKER_ORGANIZATION_ID === session.organization.id,
    );
    if (!configured) {
      return { status: 'NOT_CONFIGURED' as const, configured, heartbeat: null };
    }
    const heartbeat = this.latest;
    const fresh = heartbeat
      ? Date.now() - new Date(heartbeat.checkedAt).getTime() <= ONLINE_WINDOW_MS
      : false;
    return {
      status: fresh && heartbeat?.status === 'ONLINE' ? ('ONLINE' as const) : ('OFFLINE' as const),
      configured,
      heartbeat,
    };
  }
}
