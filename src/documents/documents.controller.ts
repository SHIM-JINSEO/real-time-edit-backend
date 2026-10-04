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
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { HocuspocusService } from '../collaboration/hocuspocus.service.js';
import { applyDocumentText } from '../yjs/document-doc.js';
import {
  DocumentResponse,
  DocumentSummary,
  toDocumentResponse,
} from './document.response.js';
import { DocumentsService } from './documents.service.js';
import { CreateDocumentDto } from './dto/create-document.dto.js';
import { UpdateDocumentDto } from './dto/update-document.dto.js';
import { ApiShareToken, ShareTokenGuard } from './share-token.guard.js';

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly hocuspocus: HocuspocusService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a document',
    description:
      'The returned `shareToken` is required to read, update, delete, and connect over WebSocket.',
  })
  @ApiCreatedResponse({ type: DocumentResponse })
  @ApiBadRequestResponse({
    description: 'Validation failed (e.g. title longer than 200 chars)',
  })
  async create(@Body() dto: CreateDocumentDto): Promise<DocumentResponse> {
    return toDocumentResponse(await this.documents.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'List documents (public, titles only)' })
  @ApiOkResponse({ type: [DocumentSummary] })
  list(): Promise<DocumentSummary[]> {
    return this.documents.findAll();
  }

  /** Bootstrap endpoint for share links: token in, document (with id) out. */
  @Get('shared/:shareToken')
  @ApiOperation({
    summary: 'Open a document by share link',
    description:
      'Entry point for users who only have the share token: returns the document id and content.',
  })
  @ApiOkResponse({ type: DocumentResponse })
  @ApiNotFoundResponse({ description: 'No document for this share token' })
  async getShared(
    @Param('shareToken') shareToken: string,
  ): Promise<DocumentResponse> {
    return toDocumentResponse(
      await this.documents.findByShareToken(shareToken),
    );
  }

  @Get(':id')
  @UseGuards(ShareTokenGuard)
  @ApiOperation({ summary: 'Get a document' })
  @ApiShareToken()
  @ApiOkResponse({ type: DocumentResponse })
  @ApiNotFoundResponse({ description: 'Document not found' })
  async getOne(@Param('id') id: string): Promise<DocumentResponse> {
    return toDocumentResponse(await this.documents.findById(id));
  }

  /**
   * REST edits are applied to the live Y.Doc, so collaborators see them
   * arrive as normal CRDT updates and the DB snapshot is refreshed.
   */
  @Patch(':id')
  @UseGuards(ShareTokenGuard)
  @ApiOperation({
    summary: 'Update a document',
    description:
      'Applied to the live Y.Doc, so connected editors receive it immediately as a normal CRDT update.',
  })
  @ApiShareToken()
  @ApiOkResponse({ type: DocumentResponse })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Document not found' })
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
  @ApiOperation({
    summary: 'Delete a document',
    description: 'Also closes any open WebSocket connections to it.',
  })
  @ApiShareToken()
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Document not found' })
  async remove(@Param('id') id: string): Promise<void> {
    this.hocuspocus.closeDocument(id);
    await this.documents.remove(id);
  }
}
