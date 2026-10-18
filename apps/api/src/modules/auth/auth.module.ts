import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { APP_GUARD } from '@nestjs/core'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { TokenService } from './token.service'
import { OtpService } from './otp.service'
import { TotpService } from './totp.service'
import { JwtStrategy } from './jwt.strategy'
import { JwtAuthGuard, RolesGuard, AdminLevelGuard } from '../../common/guards/auth.guards'

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'change_me_64_byte_hex',
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    OtpService,
    TotpService,
    JwtStrategy,
    // Global guards: authentication first, then role, then admin level.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AdminLevelGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
