import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DocumentsService } from './documents.service.js';

export const SHARE_TOKEN_HEADER = 'x-share-token';

/**
 * Protects `/documents/:id` routes. The token may come from the
 * `x-share-token` header or the `?token=` query parameter.
 */
@Injectable()
export class ShareTokenGuard implements CanActivate {
  constructor(private readonly documents: DocumentsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = extractShareToken(req);
    if (!token) {
      throw new UnauthorizedException('Share token required');
    }
    await this.documents.assertShareToken(req.params.id as string, token);
    return true;
  }
}

export function extractShareToken(req: Request): string | undefined {
  const header = req.headers[SHARE_TOKEN_HEADER];
  if (typeof header === 'string' && header.length > 0) return header;
  const query = req.query?.token;
  if (typeof query === 'string' && query.length > 0) return query;
  return undefined;
}
