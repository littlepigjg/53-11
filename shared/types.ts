export type FileType = 'markdown' | 'docx';
export type ParagraphType = 'heading' | 'paragraph' | 'list' | 'code' | 'quote' | 'table';
export type AnnotationType = 'comment' | 'suggestion';
export type AnnotationStatus = 'pending' | 'accepted' | 'rejected';

export type SeverityLevel = 'critical' | 'warning' | 'info';
export type RuleType = 'regex' | 'ast' | 'custom';
export type DocumentCategory = 'privacy' | 'contract' | 'technical' | 'general';
export type RuleStatus = 'active' | 'disabled' | 'draft';
export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed';
export type PipelineGateStatus = 'pass' | 'fail' | 'warn';

export interface DocumentMeta {
  id: string;
  title: string;
  originalFileName: string;
  fileType: FileType;
  createdAt: string;
  updatedAt: string;
  shareToken?: string;
  sharePassword?: string | null;
  shareExpiresAt?: string | null;
  annotationCount: number;
  reviewerCount: number;
}

export interface Paragraph {
  id: string;
  index: number;
  type: ParagraphType;
  level?: number;
  content: string;
  rawHtml?: string;
}

export interface ParsedDocument {
  docId: string;
  paragraphs: Paragraph[];
}

export interface Annotation {
  id: string;
  docId: string;
  paragraphId: string;
  type: AnnotationType;
  reviewerName: string;
  reviewerEmail?: string;
  content: string;
  suggestedText?: string;
  originalText?: string;
  status: AnnotationStatus;
  ownerNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSummary {
  docId: string;
  totalAnnotations: number;
  pendingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  commentCount: number;
  suggestionCount: number;
  byReviewer: { name: string; count: number }[];
  byParagraph: { paragraphId: string; count: number }[];
}

export interface RegexPattern {
  pattern: string;
  flags?: string;
  invert?: boolean;
}

export interface ASTCondition {
  nodeType: string;
  property?: string;
  value?: string;
  operator?: 'equals' | 'contains' | 'regex' | 'exists';
}

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  type: RuleType;
  severity: SeverityLevel;
  category: DocumentCategory;
  status: RuleStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  patterns?: RegexPattern[];
  astConditions?: ASTCondition[];
  customScript?: string;
  fixGuidance: string;
  appliesToFileTypes?: FileType[];
  tags?: string[];
  isBuiltin?: boolean;
}

export interface ViolationLocation {
  paragraphId?: string;
  paragraphIndex?: number;
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
  snippet?: string;
}

export interface Violation {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: SeverityLevel;
  category: DocumentCategory;
  message: string;
  fixGuidance: string;
  location: ViolationLocation;
  detectedAt: string;
  resolved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
}

export interface ComplianceScan {
  id: string;
  docId: string;
  docTitle: string;
  status: ScanStatus;
  triggeredBy: string;
  triggeredAt: string;
  completedAt?: string;
  rulesVersion: string;
  violations: Violation[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  totalRulesChecked: number;
  durationMs: number;
  errorMessage?: string;
}

export interface ScanSummary {
  totalScans: number;
  totalDocuments: number;
  documentsWithCritical: number;
  documentsWithWarning: number;
  averageScanTimeMs: number;
  lastScanAt?: string;
  violationsByCategory: Record<DocumentCategory, number>;
  violationsBySeverity: Record<SeverityLevel, number>;
}

export interface PipelineGateResult {
  docId: string;
  status: PipelineGateStatus;
  gateName: string;
  timestamp: string;
  criticalCount: number;
  warningCount: number;
  blockingRules: string[];
  summary: string;
  scanId: string;
}

export interface ComplianceReport {
  reportId: string;
  generatedAt: string;
  documentMeta: DocumentMeta;
  scan: ComplianceScan;
  summary: {
    totalViolations: number;
    critical: number;
    warning: number;
    info: number;
    complianceScore: number;
  };
  rulesChecked: ComplianceRule[];
  violations: Violation[];
  recommendations: string[];
}
