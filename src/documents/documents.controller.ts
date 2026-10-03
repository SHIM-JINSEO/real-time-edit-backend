import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HocuspocusService } from '../collaboration/hocuspocus.service.js';
import { applyDocumentText } from '../yjs/document-doc.js';
import {
  toDocumentResponse,
  type DocumentResponse,
  type DocumentSummary,
} from './document.response.js';
import { DocumentsService } from './documents.service.js';
import { CreateDocumentDto } from './dto/create-document.dto.js';
import { UpdateDocumentDto } from './dto/update-document.dto.js';
import { ShareTokenGuard } from './share-token.guard.js';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly hocuspocus: HocuspocusService,
  ) {}

  @Post()
  async create(@Body() dto: CreateDocumentDto): Promise<DocumentResponse> {
    return toDocumentResponse(await this.documents.create(dto));
  }

  @Get()
  list(): Promise<DocumentSummary[]> {
    return this.documents.findAll();
  }

  /** Bootstrap endpoint for share links: token in, document (with id) out. */
  @Get('shared/:shareToken')
  async getShared(
    @Param('shareToken') shareToken: string,
  ): Promise<DocumentResponse> {
    return toDocumentResponse(
      await this.documents.findByShareToken(shareToken),
    );
  }

  @Get(':id')
  @UseGuards(ShareTokenGuard)
  async getOne(@Param('id') id: string): Promise<DocumentResponse> {
    return toDocumentResponse(await this.documents.findById(id));
  }

  /**
   * REST edits are applied to the live Y.Doc, so collaborators see them
   * arrive as normal CRDT updates and the DB snapshot is refreshed.
   */
  @Patch(':id')
  @UseGuards(ShareTokenGuard)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentResponse> {
    await this.hocuspocus.withDocument(id, (doc) =>
      applyDocumentText(doc, dto),
    );
    return toDocumentResponse(await this.documents.findById(id));
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(ShareTokenGuard)
  async remove(@Param('id') id: string): Promise<void> {
    this.hocuspocus.closeDocument(id);
    await this.documents.remove(id);
  }
}
