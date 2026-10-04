import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import {
  COLLABORATION_PATH,
  HocuspocusService,
  type CollaborationStats,
} from './hocuspocus.service.js';

class CollaborationStatsResponse implements CollaborationStats {
  @ApiProperty({ description: 'Number of Y.Docs loaded in memory', example: 1 })
  documents: number;

  @ApiProperty({
    description: 'Number of open WebSocket connections',
    example: 2,
  })
  connections: number;

  @ApiProperty({
    description: 'Hocuspocus WebSocket path',
    example: COLLABORATION_PATH,
  })
  path: string;
}

@ApiTags('collaboration')
@Controller('collaboration')
export class CollaborationController {
  constructor(private readonly hocuspocus: HocuspocusService) {}

  /** Live counters for the demo: how many docs are open and how many sockets. */
  @Get('stats')
  @ApiOperation({ summary: 'Live collaboration stats' })
  @ApiOkResponse({ type: CollaborationStatsResponse })
  stats(): CollaborationStatsResponse {
    return { ...this.hocuspocus.stats(), path: COLLABORATION_PATH };
  }
}
