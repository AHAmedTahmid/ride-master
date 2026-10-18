import { Body, Controller, Get, Param, Patch } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { AuthContext, CurrentUser } from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { NotificationsService } from './notifications.service'

const MarkReadSchema = z.object({ read: z.boolean().default(true) })

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() auth: AuthContext) {
    return this.notifications.listForUser(auth.userId)
  }

  @Patch(':publicId/read')
  async markRead(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(MarkReadSchema)) body: { read: boolean },
  ) {
    await this.notifications.markRead(auth.userId, publicId, body.read)
    return { publicId, read: body.read }
  }
}
