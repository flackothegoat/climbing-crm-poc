import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextState {
  correlationId: string;
  method: string;
  path: string;
  ip?: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextState>();

  run<T>(state: RequestContextState, callback: () => T): T {
    return this.storage.run(state, callback);
  }

  get(): RequestContextState | undefined {
    return this.storage.getStore();
  }

  correlationId(): string | undefined {
    return this.get()?.correlationId;
  }
}
