import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService, HealthStatus } from './app.service.js';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  @ApiOkResponse({ type: HealthStatus })
  health(): HealthStatus {
    return this.appService.health();
  }
}
