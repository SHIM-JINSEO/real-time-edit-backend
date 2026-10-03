import { Controller, Get } from '@nestjs/common';
import {
  COLLABORATION_PATH,
  HocuspocusService,
  type CollaborationStats,
} from './hocuspocus.service.js';

@Controller('collaboration')
export class CollaborationController {
  constructor(private readonly hocuspocus: HocuspocusService) {}

  /** Live counters for the demo: how many docs are open and how many sockets. */
  @Get('stats')
  stats(): CollaborationStats & { path: string } {
    return { ...this.hocuspocus.stats(), path: COLLABORATION_PATH };
  }
}
