import { Module } from '@nestjs/common';
import { CollaborationController } from './collaboration.controller.js';
import { HocuspocusService } from './hocuspocus.service.js';

@Module({
  controllers: [CollaborationController],
  providers: [HocuspocusService],
  exports: [HocuspocusService],
})
export class CollaborationModule {}
