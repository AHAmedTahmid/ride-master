import { Injectable, Inject } from '@nestjs/common'
import Redis from 'ioredis'
import { REDIS_CLIENT } from './redis.constants'

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  // ── Key-value ───────────────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds)
    } else {
      await this.client.set(key, value)
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key)
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key)
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds)
  }

  // ── Hash ────────────────────────────────────────────────────────────────────

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value)
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field)
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key)
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field)
  }

  // ── Geo ─────────────────────────────────────────────────────────────────────

  async geoadd(key: string, lng: number, lat: number, member: string): Promise<void> {
    await this.client.geoadd(key, lng, lat, member)
  }

  async georadius(
    key: string,
    lng: number,
    lat: number,
    radiusKm: number,
  ): Promise<string[]> {
    const results = await this.client.georadius(
      key,
      lng,
      lat,
      radiusKm,
      'km',
      'ASC',
    )
    return results as string[]
  }

  async georadiusWithDist(
    key: string,
    lng: number,
    lat: number,
    radiusKm: number,
  ): Promise<Array<{ member: string; distance: number }>> {
    const results = await this.client.georadius(
      key,
      lng,
      lat,
      radiusKm,
      'km',
      'WITHDIST',
      'ASC',
    )
    return (results as Array<[string, string]>).map(([member, dist]) => ({
      member,
      distance: parseFloat(dist),
    }))
  }

  async georem(key: string, member: string): Promise<void> {
    await this.client.zrem(key, member)
  }

  async geopos(key: string, member: string): Promise<{ lng: number; lat: number } | null> {
    const pos = await this.client.geopos(key, member)
    if (!pos || !pos[0]) return null
    const [lng, lat] = pos[0] as [string, string]
    return { lng: parseFloat(lng), lat: parseFloat(lat) }
  }

  // ── Pub/Sub ─────────────────────────────────────────────────────────────────

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message)
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping()
      return res === 'PONG'
    } catch {
      return false
    }
  }
}
