import { request } from './client';

export type DataSourceType = 'prometheus' | 'loki' | 'cmdb' | 'other';
export type DataSourceAuthType = 'none' | 'basic' | 'bearer';

export type DataSource = {
  id: number;
  name: string;
  type: DataSourceType;
  url: string;
  auth_type: DataSourceAuthType;
  username?: string;
  secret_ref?: string;
  tls_insecure: boolean;
  label_map?: string;
  builtin: boolean;
  enabled: boolean;
  updated_at?: string;
};

export type DataSourceInput = {
  name: string;
  type: DataSourceType;
  url: string;
  auth_type?: DataSourceAuthType;
  username?: string;
  secret_ref?: string;
  tls_insecure?: boolean;
  label_map?: string;
  enabled?: boolean;
};

export function listDataSources() {
  return request<{ items: DataSource[]; total: number }>('GET', '/datasources');
}

export function createDataSource(input: DataSourceInput) {
  return request<DataSource>('POST', '/datasources', input);
}

export function updateDataSource(id: number, input: DataSourceInput) {
  return request<void>('PUT', `/datasources/${id}`, input);
}

export function deleteDataSource(id: number) {
  return request<void>('DELETE', `/datasources/${id}`);
}

export function testDataSource(id: number) {
  return request<{ ok: boolean; latency_ms: number; error?: string }>('POST', `/datasources/${id}/test`);
}

