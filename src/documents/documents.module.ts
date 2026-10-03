import { Module } from '@nestjs/common';
import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { ShareTokenGuard } from './share-token.guard.js';

@Module({
  imports: [CollaborationModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, ShareTokenGuard],
  exports: [DocumentsService],
})
export class DocumentsModule {}
