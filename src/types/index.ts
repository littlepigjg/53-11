export type {
  FileType,
  ParagraphType,
  AnnotationType,
  AnnotationStatus,
  DocumentMeta,
  Paragraph,
  ParsedDocument,
  Annotation,
  ReviewSummary,
  SeverityLevel,
  RuleType,
  DocumentCategory,
  RuleStatus,
  ScanStatus,
  PipelineGateStatus,
  RegexPattern,
  ASTCondition,
  ComplianceRule,
  ViolationLocation,
  Violation,
  ComplianceScan,
  ScanSummary,
  PipelineGateResult,
  ComplianceReport,
} from '../../shared/types';

export interface RulesVersion {
  version: string;
  updatedAt: string;
  ruleCount: number;
  checksum: string;
}
