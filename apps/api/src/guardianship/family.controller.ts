import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  AccessTokenPayload,
  FamilyChild,
  FamilyNotice,
  GuardianshipRequestView,
  MyGuardian,
} from '@yenisey/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccountDto } from '../auth/dto/register.dto';
import { AttachChildDto, ChildPasswordDto } from './dto/family.dto';
import { FamilyService } from './family.service';

/**
 * Дети в кабинете родителя.
 *
 * Клуба в адресе нет: ребёнок ходит в три клуба, а родитель у него один на все.
 */
@Controller('me/children')
export class MeChildrenController {
  constructor(private readonly family: FamilyService) {}

  @Get()
  children(@CurrentUser() user: AccessTokenPayload): Promise<FamilyChild[]> {
    return this.family.children(user.sub);
  }

  /** Завести ребёнку учётку — закрепляется сразу. */
  @Post()
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: AccountDto): Promise<FamilyChild> {
    return this.family.createChild(user.sub, dto);
  }

  /**
   * Заявка на существующую учётку. Ответ одинаковый при любом исходе, а
   * частота — своя, жёстче общей: иначе маршрут стал бы способом перебирать
   * почты детей.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('attach')
  @HttpCode(200)
  attach(@CurrentUser() user: AccessTokenPayload, @Body() dto: AttachChildDto): Promise<FamilyNotice> {
    return this.family.requestAttach(user.sub, dto.email);
  }

  /** Новый пароль ребёнку. Все его сессии гаснут. */
  @Post(':id/password')
  @HttpCode(204)
  password(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') childId: string,
    @Body() dto: ChildPasswordDto,
  ): Promise<void> {
    return this.family.setChildPassword(user.sub, childId, dto.password);
  }

  @Delete(':id')
  @HttpCode(204)
  unlink(@CurrentUser() user: AccessTokenPayload, @Param('id') childId: string): Promise<void> {
    return this.family.unlink(user.sub, childId);
  }
}

/**
 * Опека глазами ребёнка: кто его ведёт и кто просит закрепить.
 *
 * Ответить на заявку может только он сам — администратор и тот, кто её
 * отправил, подтвердить за ребёнка не могут.
 */
@Controller('me/guardianship')
export class MeGuardianshipController {
  constructor(private readonly family: FamilyService) {}

  @Get()
  guardian(@CurrentUser() user: AccessTokenPayload): Promise<MyGuardian | null> {
    return this.family.myGuardian(user.sub);
  }

  @Get('requests')
  requests(@CurrentUser() user: AccessTokenPayload): Promise<GuardianshipRequestView[]> {
    return this.family.incomingRequests(user.sub);
  }

  @Post('requests/:id/confirm')
  @HttpCode(204)
  confirm(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string): Promise<void> {
    return this.family.answer(user.sub, id, 'CONFIRM');
  }

  @Post('requests/:id/reject')
  @HttpCode(204)
  reject(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string): Promise<void> {
    return this.family.answer(user.sub, id, 'REJECT');
  }
}
