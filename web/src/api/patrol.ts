import { request } from './client';

export type PatrolStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export type PatrolCheck = {
  key: string;
  title: string;
  status: PatrolStatus;
  severity: string;
  command?: string;
  evidence?: string;
  conclusion: string;
  error?: string;
  duration_ms?: number;
};

export type PatrolReport = {
  device_id: number;
  device_name?: string;
  hostname?: string;
  generated_at: string;
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    unknown: number;
  };
  checks: PatrolCheck[];
  markdown: string;
};

export function runSecurityPatrol(deviceId: number, checkKeys?: string[]) {
  return request<PatrolReport>('POST', '/security/patrol/run', { device_id: deviceId, check_keys: checkKeys });
}
