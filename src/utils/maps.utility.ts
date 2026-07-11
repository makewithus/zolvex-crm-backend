import axios, { AxiosError } from 'axios';
import { logger } from './logger';

/**
 * GOOGLE MAPS UTILITY — Sprint 10.3
 *
 * Stateless infrastructure utility for routing and ETA calculations.
 * Strictly decoupled from Core CRM: no knowledge of Bookings, Jobs, etc.
 *
 * Requirements:
 *   - No DB writes.
 *   - No EventBus interaction.
 *   - Degrades gracefully on failure (never crashes the request).
 *   - Retries transient errors (e.g. rate limit / network) with backoff.
 *   - Fails fast on permanent errors (e.g. invalid key / invalid coordinates).
 */

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RouteResponse {
  distanceKm: number | null;
  durationMinutes: number | null;
  status: 'OK' | 'UNAVAILABLE' | 'TIMEOUT' | 'QUOTA_EXCEEDED' | 'INVALID_REQUEST' | 'FAILED';
  provider: 'GOOGLE_MAPS';
  calculatedAt: Date;
}

const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const TIMEOUT_MS = 5000;

export class MapsUtility {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes';

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';
  }

  /**
   * Calculates distance and duration between two coordinates.
   * Returns a structured RouteResponse. Degrades gracefully on failure.
   */
  async calculateRoute(origin: Coordinates, destination: Coordinates): Promise<RouteResponse> {
    const calculatedAt = new Date();
    
    if (!this.apiKey) {
      return this._fallback('UNAVAILABLE', calculatedAt, 'GOOGLE_MAPS_API_KEY is not configured');
    }

    if (!this._isValidCoord(origin) || !this._isValidCoord(destination)) {
      return this._fallback('INVALID_REQUEST', calculatedAt, 'Invalid coordinates provided');
    }

    // Identical coordinates check (no need to call API)
    if (this._isIdentical(origin, destination)) {
      return { distanceKm: 0, durationMinutes: 0, status: 'OK', provider: 'GOOGLE_MAPS', calculatedAt };
    }

    const payload = {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE'
    };

    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': this.apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'
    };

    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      try {
        const response = await axios.post(this.baseUrl, payload, { headers, timeout: TIMEOUT_MS });
        
        const route = response.data.routes?.[0];
        if (!route) {
          // Google returned 200 OK but no route could be found (e.g. ocean)
          return this._fallback('UNAVAILABLE', calculatedAt, 'No route found between locations');
        }

        const distanceKm = (route.distanceMeters ?? 0) / 1000;
        const durationMinutes = Math.round(parseInt((route.duration ?? '0s').replace('s', ''), 10) / 60);

        return { distanceKm, durationMinutes, status: 'OK', provider: 'GOOGLE_MAPS', calculatedAt };

      } catch (err) {
        const status = this._classifyError(err);
        
        if (this._isTransient(status) && attempt < MAX_RETRIES) {
          attempt++;
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
          logger.warn(`[MapsUtility] Transient failure (${status}), retrying in ${backoff}ms...`);
          await this._sleep(backoff);
          continue;
        }

        // Exhausted retries or permanent error
        return this._fallback(status, calculatedAt, err instanceof Error ? err.message : 'Unknown error');
      }
    }

    return this._fallback('FAILED', calculatedAt, 'Exhausted retries');
  }

  /**
   * Convenience wrapper for getETA when distance is not needed.
   */
  async getETA(origin: Coordinates, destination: Coordinates): Promise<number | null> {
    const route = await this.calculateRoute(origin, destination);
    return route.status === 'OK' ? route.durationMinutes : null;
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private _fallback(status: RouteResponse['status'], calculatedAt: Date, reason: string): RouteResponse {
    if (status !== 'UNAVAILABLE' && status !== 'INVALID_REQUEST') {
      logger.error(`[MapsUtility] Route calculation failed: ${status} — ${reason}`);
    }
    return { distanceKm: null, durationMinutes: null, status, provider: 'GOOGLE_MAPS', calculatedAt };
  }

  private _classifyError(err: unknown): RouteResponse['status'] {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return 'TIMEOUT';
      const status = err.response?.status;
      if (status === 429) return 'QUOTA_EXCEEDED';
      if (status === 400) return 'INVALID_REQUEST';
      if (status === 403 || status === 401) return 'FAILED'; // Auth/Key issues
      if (status && status >= 500) return 'UNAVAILABLE';
    }
    return 'FAILED';
  }

  private _isTransient(status: RouteResponse['status']): boolean {
    return status === 'TIMEOUT' || status === 'QUOTA_EXCEEDED' || status === 'UNAVAILABLE';
  }

  private _isValidCoord(c: Coordinates): boolean {
    return typeof c.lat === 'number' && typeof c.lng === 'number' && 
           c.lat >= -90 && c.lat <= 90 && 
           c.lng >= -180 && c.lng <= 180;
  }

  private _isIdentical(a: Coordinates, b: Coordinates): boolean {
    // 5 decimal places is roughly 1 meter accuracy
    return a.lat.toFixed(5) === b.lat.toFixed(5) && a.lng.toFixed(5) === b.lng.toFixed(5);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

export const mapsUtility = new MapsUtility();
