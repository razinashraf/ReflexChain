/**
 * Endpoint configuration.
 *
 * Never hardcodes localhost: the same build has to run against a network on the
 * developer's machine, on a laptop at a demo table, or not at all (the hosted
 * build has no reachable network and falls back to an archived chain snapshot).
 */
import { VALIDATOR_BASE_PORT, VALIDATOR_COUNT, validatorIdFor } from '@reflexchain/protocol';

export interface ValidatorEndpoint {
  ordinal: number;
  validatorId: string;
  httpUrl: string;
  wsUrl: string;
}

function envHost(): string {
  const configured = process.env.NEXT_PUBLIC_NETWORK_HOST;
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.hostname;
  return 'localhost';
}

export const COORDINATOR_URL =
  process.env.NEXT_PUBLIC_COORDINATOR_URL ?? `http://${envHost()}:4000`;

/**
 * Explicit override, e.g.
 *   NEXT_PUBLIC_VALIDATOR_URLS=http://10.0.0.4:7001,http://10.0.0.4:7002
 * Otherwise derived from the protocol's own port scheme.
 */
export function validatorEndpoints(): ValidatorEndpoint[] {
  const override = process.env.NEXT_PUBLIC_VALIDATOR_URLS;

  if (override) {
    return override
      .split(',')
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((httpUrl, index) => ({
        ordinal: index + 1,
        validatorId: validatorIdFor(index + 1),
        httpUrl,
        wsUrl: httpUrl.replace(/^http/, 'ws'),
      }));
  }

  const host = envHost();
  return Array.from({ length: VALIDATOR_COUNT }, (_, i) => {
    const ordinal = i + 1;
    const port = VALIDATOR_BASE_PORT + ordinal;
    return {
      ordinal,
      validatorId: validatorIdFor(ordinal),
      httpUrl: `http://${host}:${port}`,
      wsUrl: `ws://${host}:${port}`,
    };
  });
}

/** When no live network answers, the dashboard renders this archived chain. */
export const SNAPSHOT_URL = '/snapshot.json';

export const REGISTERED_VALIDATORS = VALIDATOR_COUNT;
