import { Global, Module } from '@nestjs/common'
import { HaversineMapProvider } from './haversine-map.provider'
import { MAP_PROVIDER, MapProvider } from './map.provider'

@Global()
@Module({
  providers: [
    {
      provide: MAP_PROVIDER,
      useFactory: (): MapProvider => {
        const kind = process.env.MAP_PROVIDER ?? 'haversine'
        switch (kind) {
          case 'haversine':
            return new HaversineMapProvider()
          default:
            throw new Error(`Unknown MAP_PROVIDER '${kind}'`)
        }
      },
    },
  ],
  exports: [MAP_PROVIDER],
})
export class MapModule {}
