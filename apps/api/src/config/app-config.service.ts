import { Injectable } from '@nestjs/common';
import { readEnvironment, type AppEnvironment } from './environment';

@Injectable()
export class AppConfigService {
  readonly values: AppEnvironment;

  constructor() {
    this.values = readEnvironment();
  }
}
