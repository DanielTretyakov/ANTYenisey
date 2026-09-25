import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { AddressController } from './address.controller';
import { AddressProvider, DadataAddressProvider, DisabledAddressProvider, FakeAddressProvider } from './address.provider';

/**
 * Справочник адресов для залов (решение владельца от 25.09.2026):
 *   есть DADATA_API_KEY → DaData;
 *   нет, не production  → поддельный, для разработки и смоука;
 *   нет, production     → выключен: зал с новым адресом не сохранить.
 *
 * Поддельный в production невозможен намеренно: с ним «ул. Крутых Ключей»
 * прошла бы под видом справочника, стоит подставить код `fake-…`.
 */
@Module({
  controllers: [AddressController],
  providers: [
    {
      provide: AddressProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AddressProvider => {
        const key = config.get('DADATA_API_KEY', { infer: true });

        if (key) {
          return new DadataAddressProvider(key);
        }

        return config.get('NODE_ENV', { infer: true }) === 'production'
          ? new DisabledAddressProvider()
          : new FakeAddressProvider();
      },
    },
  ],
  exports: [AddressProvider],
})
export class AddressModule {}
