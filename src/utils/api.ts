import type {
  DocumentMeta,
  ParsedDocument,
  Annotation,
  ReviewSummary,
  AnnotationStatus,
  ComplianceRule,
  RuleStatus,
  DocumentCategory,
  RuleType,
  SeverityLevel,
  ComplianceScan,
  ScanSummary,
  ComplianceReport,
  PipelineGateResult,
  RulesVersion,
} from '../types';

const API_BASE = '/api';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const documentsApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`${API_BASE}/documents/upload`, {
      method: 'POST',
      body: form,
    }).then((r) => r.json() as Promise<DocumentMeta>);
  },
  list: () => request<DocumentMeta[]>('/documents'),
  get: (id: string) => request<DocumentMeta>(`/documents/${id}`),
  remove: (id: string) =>
    request<{ ok: true }>(`/documents/${id}`, { method: 'DELETE' }),
  getParsed: (id: string) => request<ParsedDocument>(`/documents/${id}/parsed`),
  createShare: (id: string) =>
    request<{ shareToken: string }>(`/documents/${id}/share`, { method: 'POST' }),
};

export const shareApi = {
  getReviewData: (token: string) =>
    request<{ document: DocumentMeta; parsed: ParsedDocument; annotations: Annotation[] }>(`/share/${token}`),
};

export const annotationsApi = {
  create: (data: {
    documentId: string;
    paragraphId: string;
    type: 'comment' | 'suggestion';
    reviewerName: string;
    reviewerEmail?: string;
    content: string;
    suggestedText?: string;
    originalText?: string;
  }) => request<Annotation>('/annotations', { method: 'POST', body: JSON.stringify(data) }),
  list: (docId: string) => request<Annotation[]>(`/annotations/${docId}`),
  updateStatus: (id: string, status: AnnotationStatus, ownerNote?: string) =>
    request<Annotation>(`/annotations/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ownerNote }),
    }),
  remove: (id: string) =>
    request<{ ok: true }>(`/annotations/${id}`, { method: 'DELETE' }),
};

export const reviewApi = {
  summary: (docId: string) => request<ReviewSummary>(`/review/${docId}/summary`),
};

export const exportApi = {
  markdown: (docId: string) =>
    fetch(`${API_BASE}/export/${docId}`).then(async (r) => ({
      filename:
        r.headers.get('Content-Disposition')?.match(/filename="?([^"]+)/)?.[1] ||
        'document.md',
      text: await r.text(),
    })),
};

export const complianceApi = {
  rules: {
    list: (params?: {
      status?: RuleStatus;
      category?: DocumentCategory;
      type?: RuleType;
      severity?: SeverityLevel;
      search?: string;
    }) => {
      const qs = params
        ? Object.entries(params)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
            .join('&')
        : '';
      return request<ComplianceRule[]>(`/compliance/rules${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => request<ComplianceRule>(`/compliance/rules/${id}`),
    create: (data: Partial<ComplianceRule>) =>
      request<ComplianceRule>('/compliance/rules', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<ComplianceRule>) =>
      request<ComplianceRule>(`/compliance/rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    remove: (id: string) =>
      request<{ ok: boolean }>(`/compliance/rules/${id}`, { method: 'DELETE' }),
    setStatus: (id: string, status: RuleStatus) =>
      request<ComplianceRule>(`/compliance/rules/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    duplicate: (id: string) =>
      request<ComplianceRule>(`/compliance/rules/${id}/duplicate`, { method: 'POST' }),
    validateScript: (script: string) =>
      request<{ valid: boolean; errors: string[]; warnings: string[] }>(
        '/compliance/rules/validate-script',
        { method: 'POST', body: JSON.stringify({ script }) }
      ),
    resetBuiltin: () =>
      request<{ restored: boolean; count: number }>('/compliance/rules/reset-builtin', {
        method: 'POST',
      }),
    version: () => request<RulesVersion>('/compliance/rules/version'),
  },
  scan: {
    trigger: (docId: string, triggeredBy?: string, category?: DocumentCategory) =>
      request<ComplianceScan>(`/compliance/scan/${docId}`, {
        method: 'POST',
        body: JSON.stringify({ triggeredBy, category }),
      }),
    getLatest: (docId: string) =>
      fetch(`${API_BASE}/compliance/scan/${docId}/latest`).then(async (r) => {
        if (r.status === 404) return null;
        return r.json() as Promise<ComplianceScan>;
      }),
    getDetail: (scanId: string) => request<ComplianceScan>(`/compliance/scan/detail/${scanId}`),
    list: (docId?: string, limit?: number) => {
      const qs = docId || limit
        ? [docId ? `docId=${docId}` : '', limit ? `limit=${limit}` : ''].filter(Boolean).join('&')
        : '';
      return request<ComplianceScan[]>(`/compliance/scans${qs ? `?${qs}` : ''}`);
    },
    resolveViolation: (
      scanId: string,
      violationId: string,
      resolvedBy: string,
      note?: string
    ) =>
      request<ComplianceScan>(`/compliance/scan/${scanId}/violations/${violationId}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({ resolvedBy, note }),
      }),
  },
  summary: () => request<ScanSummary>('/compliance/summary'),
  monitor: {
    getState: () =>
      request<{ lastRulesVersion: string; lastScanAt: string; reScanPending: string[]; monitoredDocIds: string[] }>(
        '/compliance/monitor'
      ),
    refresh: () =>
      request<{ rescannedDocs: number; rulesChanged: boolean }>('/compliance/monitor/refresh', {
        method: 'POST',
      }),
  },
  report: {
    get: (docId: string, scanId?: string) => {
      const qs = scanId ? `?scanId=${scanId}` : '';
      return request<ComplianceReport>(`/compliance/report/${docId}${qs}`);
    },
    downloadHTML: (docId: string, scanId?: string) => {
      const qs = scanId ? `?scanId=${scanId}` : '';
      window.open(`${API_BASE}/compliance/report/${docId}/html${qs}`, '_blank');
    },
    openPrint: (docId: string, scanId?: string) => {
      const qs = scanId ? `?scanId=${scanId}` : '';
      window.open(`${API_BASE}/compliance/report/${docId}/print${qs}`, '_blank');
    },
  },
};

export const pipelineApi = {
  runGate: (
    docId: string,
    gateName?: string,
    failOnCritical = true,
    maxWarnings = 10
  ) =>
    request<PipelineGateResult>(`/pipeline/gate/${docId}`, {
      method: 'POST',
      body: JSON.stringify({ gateName, failOnCritical, maxWarnings }),
    }),
  history: (docId: string) =>
    request<PipelineGateResult[]>(`/pipeline/gate/${docId}/history`),
  badgeUrl: (docId: string) => `${API_BASE}/pipeline/gate/${docId}/badge`,
  webhook: (docId: string, event: string, payload?: Record<string, unknown>) =>
    request<{ success: boolean; event: string; docId: string; gate: PipelineGateResult | ComplianceScan | null }>(`/pipeline/webhook/${docId}`, {
      method: 'POST',
      body: JSON.stringify({ event, payload }),
    }),
};
