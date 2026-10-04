import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

export class HealthStatus {
  @ApiProperty({ enum: ['ok'] })
  status: 'ok';

  @ApiProperty({ example: 'real-time-edit-backend' })
  service: string;

  @ApiProperty({ format: 'date-time' })
  time: string;
}

@Injectable()
export class AppService {
  health(): HealthStatus {
    return {
      status: 'ok',
      service: 'real-time-edit-backend',
      time: new Date().toISOString(),
    };
  }
}
