import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { readStoredText } from '../yjs/document-doc.js';
import { DEFAULT_TITLE, DocumentsService } from './documents.service.js';

const now = new Date();
const stored = {
  id: 'doc-1',
  title: 'Hello',
  content: 'World',
  yjsState: null,
  shareToken: 'secret',
  createdAt: now,
  updatedAt: now,
};

describe('DocumentsService', () => {
  let service: DocumentsService;
  const prisma = {
    document: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(DocumentsService);
  });

  it('creates a document with a seeded Yjs state matching the text', async () => {
    prisma.document.create.mockImplementation(async ({ data }) => ({
      ...stored,
      ...data,
    }));

    const doc = await service.create({ title: '  Hello ', content: 'World' });

    expect(doc.title).toBe('Hello');
    const call = prisma.document.create.mock.calls[0][0];
    expect(readStoredText(call.data.yjsState)).toEqual({
      title: 'Hello',
      content: 'World',
    });
  });

  it('falls back to the default title when none is given', async () => {
    prisma.document.create.mockImplementation(async ({ data }) => ({
      ...stored,
      ...data,
    }));
    const doc = await service.create({});
    expect(doc.title).toBe(DEFAULT_TITLE);
    expect(doc.content).toBe('');
  });

  it('throws NotFound for an unknown id', async () => {
    prisma.document.findUnique.mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('accepts the correct share token', async () => {
    prisma.document.findUnique.mockResolvedValue(stored);
    await expect(service.assertShareToken('doc-1', 'secret')).resolves.toBe(
      stored,
    );
  });

  it('rejects a wrong or missing share token with Forbidden', async () => {
    prisma.document.findUnique.mockResolvedValue(stored);
    await expect(
      service.assertShareToken('doc-1', 'nope'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.assertShareToken('doc-1', undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('removes an existing document', async () => {
    prisma.document.findUnique.mockResolvedValue(stored);
    prisma.document.delete.mockResolvedValue(stored);
    await service.remove('doc-1');
    expect(prisma.document.delete).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
    });
  });
});
