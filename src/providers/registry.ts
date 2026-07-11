import { NotificationProvider } from './NotificationProvider.interface';
import { logger } from '../utils/logger';

/**
 * CIRCUIT BREAKER
 *
 * States:
 *   CLOSED  → Normal operation. Requests pass through.
 *   OPEN    → Provider hammered. All sends rejected immediately.
 *   HALF_OPEN → Testing recovery. One probe request allowed.
 *
 * Thresholds (configurable per-provider):
 *   failureThreshold: consecutive failures before opening (default: 5)
 *   recoveryIntervalMs: how long to stay OPEN before probing (default: 60s)
 */

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold?: number;    // default 5
  recoveryIntervalMs?: number;  // default 60_000
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt: Date | null = null;
  private readonly failureThreshold: number;
  private readonly recoveryIntervalMs: number;

  constructor(
    private readonly providerName: string,
    config: CircuitBreakerConfig = {}
  ) {
    this.failureThreshold   = config.failureThreshold   ?? 5;
    this.recoveryIntervalMs = config.recoveryIntervalMs ?? 60_000;
  }

  /** Returns true if a request should be allowed through. */
  canSend(): boolean {
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      const elapsed = Date.now() - (this.openedAt?.getTime() ?? 0);
      if (elapsed >= this.recoveryIntervalMs) {
        this.state = 'HALF_OPEN';
        logger.info(`[CircuitBreaker:${this.providerName}] → HALF_OPEN (probing recovery)`);
        return true; // Allow one probe
      }
      return false;  // Still OPEN — block all sends
    }

    // HALF_OPEN: allow the probe
    return true;
  }

  /** Call this after a successful delivery. */
  recordSuccess() {
    if (this.state !== 'CLOSED') {
      logger.info(`[CircuitBreaker:${this.providerName}] → CLOSED (recovery confirmed)`);
    }
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  /** Call this after any delivery failure. */
  recordFailure() {
    this.consecutiveFailures++;

    if (this.state === 'HALF_OPEN') {
      // Probe failed — go back to OPEN
      this.state = 'OPEN';
      this.openedAt = new Date();
      logger.warn(`[CircuitBreaker:${this.providerName}] Probe FAILED → back to OPEN`);
      return;
    }

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = new Date();
      logger.error(
        `[CircuitBreaker:${this.providerName}] OPENED after ${this.consecutiveFailures} consecutive failures`
      );
    }
  }

  getState()              { return this.state; }
  getConsecutiveFailures(){ return this.consecutiveFailures; }
  isOpen()                { return this.state === 'OPEN'; }
  isClosed()              { return this.state === 'CLOSED'; }

  // Test helper: force open
  forceOpen() {
    this.state = 'OPEN';
    this.openedAt = new Date(Date.now() - this.recoveryIntervalMs - 1);
    this.consecutiveFailures = this.failureThreshold;
  }
}


/**
 * HEALTH REGISTRY
 *
 * Central registry of all provider health states.
 * Updated after every delivery attempt and scheduled health check.
 * Never calls providers directly — consumers call providers and report back.
 *
 * Admin page (future) reads this registry to show:
 *   WhatsApp  ✅  |  Email ✅  |  SMS ❌  |  Maps ✅
 */
export interface ProviderHealthRecord {
  providerName: string;
  channel: string;
  healthy: boolean;
  lastChecked: Date;
  lastFailure: Date | null;
  consecutiveFailures: number;
  latencyMs: number | null;      // Last recorded round-trip latency
  enabled: boolean;
}

class HealthRegistry {
  private records = new Map<string, ProviderHealthRecord>();

  register(providerName: string, channel: string) {
    if (!this.records.has(providerName)) {
      this.records.set(providerName, {
        providerName,
        channel,
        healthy: true,
        lastChecked: new Date(),
        lastFailure: null,
        consecutiveFailures: 0,
        latencyMs: null,
        enabled: true
      });
    }
  }

  recordSuccess(providerName: string, latencyMs: number) {
    const r = this.records.get(providerName);
    if (!r) return;
    r.healthy = true;
    r.lastChecked = new Date();
    r.consecutiveFailures = 0;
    r.latencyMs = latencyMs;
  }

  recordFailure(providerName: string, latencyMs?: number) {
    const r = this.records.get(providerName);
    if (!r) return;
    r.healthy = false;
    r.lastChecked = new Date();
    r.lastFailure = new Date();
    r.consecutiveFailures++;
    if (latencyMs !== undefined) r.latencyMs = latencyMs;
  }

  getAll(): ProviderHealthRecord[] {
    return [...this.records.values()];
  }

  get(providerName: string): ProviderHealthRecord | undefined {
    return this.records.get(providerName);
  }

  setEnabled(providerName: string, enabled: boolean) {
    const r = this.records.get(providerName);
    if (r) r.enabled = enabled;
  }
}

// Singleton — shared across NotificationWorker and DeliveryService
export const healthRegistry = new HealthRegistry();


/**
 * PROVIDER REGISTRY
 *
 * Maps NotificationChannel → active NotificationProvider.
 * Switching providers = change this file only.
 */
import { NotificationChannel } from '@prisma/client';
import { MockProvider } from './MockProvider';
import { MetaWhatsAppProvider } from './MetaWhatsAppProvider';
import { EmailProvider } from './EmailProvider';
import { PROVIDER_MODE } from '../config/env';

const _providers = new Map<string, NotificationProvider>();
const _breakers   = new Map<string, CircuitBreaker>();

export const registerProvider = (provider: NotificationProvider, config?: CircuitBreakerConfig) => {
  _providers.set(provider.channel, provider);
  _breakers.set(provider.channel, new CircuitBreaker(provider.name, config));
  healthRegistry.register(provider.name, provider.channel);
};

export const getProvider = (channel: NotificationChannel): NotificationProvider | undefined =>
  _providers.get(channel);

export const getBreaker = (channel: NotificationChannel): CircuitBreaker | undefined =>
  _breakers.get(channel);

/**
 * PROVIDER FACTORY
 *
 * Centralizes provider instantiation. Decouples the registry from constructor details.
 */
export class ProviderFactory {
  static create(channel: NotificationChannel): NotificationProvider {
    if (PROVIDER_MODE === 'mock') {
      return new MockProvider(channel);
    }

    switch (channel) {
      case 'WHATSAPP': return new MetaWhatsAppProvider();
      case 'EMAIL':    return new EmailProvider();
      case 'SMS':      return new MockProvider('SMS'); // SMS live provider coming in Sprint 10.4
      default:         return new MockProvider(channel);
    }
  }
}

// ── Startup Registration ──────────────────────────────────────────────────────

const defaultBreakerConfig = { failureThreshold: 5, recoveryIntervalMs: 60_000 };

['WHATSAPP', 'EMAIL', 'SMS'].forEach(ch => {
  const channel = ch as NotificationChannel;
  registerProvider(ProviderFactory.create(channel), defaultBreakerConfig);
});
