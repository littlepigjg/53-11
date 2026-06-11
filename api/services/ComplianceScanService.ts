import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import type {
  ComplianceScan,
  Violation,
  ScanSummary,
  DocumentCategory,
  SeverityLevel,
  PipelineGateResult,
  PipelineGateStatus,
} from '../../shared/types.js';
import { FileStorageService } from './FileStorageService.js';
import { DocumentParser } from './DocumentParser.js';
import { DocumentService } from './DocumentService.js';
import { ComplianceEngine } from './ComplianceEngine.js';
import { ComplianceRuleService } from './ComplianceRuleService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SCANS_DIR = path.join(DATA_DIR, 'scans');
const LATEST_SCAN_MAP = path.join(DATA_DIR, 'latest_scans.json');
const MONITOR_STATE = path.join(DATA_DIR, 'monitor_state.json');
const PIPELINE_RESULTS = path.join(DATA_DIR, 'pipeline_results.json');

interface LatestScanMap {
  [docId: string]: string;
}

interface MonitorState {
  lastRulesVersion: string;
  lastScanAt: string;
  reScanPending: string[];
  monitoredDocIds: string[];
}

interface PipelineResultsStore {
  [docId: string]: PipelineGateResult[];
}

export class ComplianceScanService {
  static async ensureInitialized() {
    await Promise.all([
      fs.mkdir(SCANS_DIR, { recursive: true }),
      ComplianceRuleService.ensureInitialized(),
    ]);
    try {
      await fs.access(LATEST_SCAN_MAP);
    } catch {
      await FileStorageService.writeJson<LatestScanMap>(LATEST_SCAN_MAP, {});
    }
    try {
      await fs.access(MONITOR_STATE);
    } catch {
      await FileStorageService.writeJson<MonitorState>(MONITOR_STATE, {
        lastRulesVersion: 'initial',
        lastScanAt: new Date().toISOString(),
        reScanPending: [],
        monitoredDocIds: [],
      });
    }
    try {
      await fs.access(PIPELINE_RESULTS);
    } catch {
      await FileStorageService.writeJson<PipelineResultsStore>(PIPELINE_RESULTS, {});
    }
  }

  private static genScanId() {
    return `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private static getScanPath(scanId: string) {
    return path.join(SCANS_DIR, `${scanId}.json`);
  }

  private static countBySeverity(violations: Violation[]) {
    return {
      critical: violations.filter((v) => v.severity === 'critical').length,
      warning: violations.filter((v) => v.severity === 'warning').length,
      info: violations.filter((v) => v.severity === 'info').length,
    };
  }

  static async triggerScan(
    docId: string,
    triggeredBy: string = 'system',
    forceCategory?: DocumentCategory
  ): Promise<ComplianceScan> {
    await this.ensureInitialized();

    const startTime = Date.now();
    const doc = await DocumentService.get(docId);
    if (!doc) {
      throw new Error(`文档不存在: ${docId}`);
    }

    const parsed = await DocumentParser.getParsed(docId);
    const rulesVersion = await ComplianceRuleService.getVersion();
    const rules = await ComplianceRuleService.list({ status: 'active' });

    const scanId = this.genScanId();
    let scan: ComplianceScan = {
      id: scanId,
      docId,
      docTitle: doc.title,
      status: 'running',
      triggeredBy,
      triggeredAt: new Date().toISOString(),
      rulesVersion: rulesVersion.version,
      violations: [],
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      totalRulesChecked: 0,
      durationMs: 0,
    };
    await this.saveScan(scan);

    try {
      const result = ComplianceEngine.scanDocument(parsed, rules, doc.title, forceCategory);

      const counts = this.countBySeverity(result.violations);

      scan = {
        ...scan,
        status: 'completed',
        completedAt: new Date().toISOString(),
        violations: result.violations,
        criticalCount: counts.critical,
        warningCount: counts.warning,
        infoCount: counts.info,
        totalRulesChecked: result.rulesChecked,
        durationMs: Date.now() - startTime,
      };

      await this.saveScan(scan);
      await this.updateLatestScan(docId, scanId);
      await this.updateMonitoredList(docId);
    } catch (e) {
      scan = {
        ...scan,
        status: 'failed',
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        errorMessage: (e as Error).message || '扫描失败',
      };
      await this.saveScan(scan);
    }

    return scan;
  }

  private static async saveScan(scan: ComplianceScan) {
    await FileStorageService.writeJson(this.getScanPath(scan.id), scan);
  }

  private static async updateLatestScan(docId: string, scanId: string) {
    const map = await FileStorageService.readJson<LatestScanMap>(LATEST_SCAN_MAP, {});
    map[docId] = scanId;
    await FileStorageService.writeJson(LATEST_SCAN_MAP, map);
  }

  private static async updateMonitoredList(docId: string) {
    const state = await FileStorageService.readJson<MonitorState>(MONITOR_STATE, {
      lastRulesVersion: 'initial',
      lastScanAt: new Date().toISOString(),
      reScanPending: [],
      monitoredDocIds: [],
    });
    if (!state.monitoredDocIds.includes(docId)) {
      state.monitoredDocIds.push(docId);
    }
    await FileStorageService.writeJson(MONITOR_STATE, state);
  }

  static async getScan(scanId: string): Promise<ComplianceScan | null> {
    await this.ensureInitialized();
    try {
      return await FileStorageService.readJson<ComplianceScan>(this.getScanPath(scanId), null as any);
    } catch {
      return null;
    }
  }

  static async getLatestScan(docId: string): Promise<ComplianceScan | null> {
    await this.ensureInitialized();
    const map = await FileStorageService.readJson<LatestScanMap>(LATEST_SCAN_MAP, {});
    const scanId = map[docId];
    if (!scanId) return null;
    return this.getScan(scanId);
  }

  static async listScans(docId?: string, limit: number = 50): Promise<ComplianceScan[]> {
    await this.ensureInitialized();
    const files = await fs.readdir(SCANS_DIR).catch(() => []);
    const scans: ComplianceScan[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const scan = await FileStorageService.readJson<ComplianceScan | null>(path.join(SCANS_DIR, file), null);
        if (scan && (!docId || scan.docId === docId)) {
          scans.push(scan);
        }
      } catch {
        continue;
      }
    }

    return scans
      .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))
      .slice(0, limit);
  }

  static async resolveViolation(
    scanId: string,
    violationId: string,
    resolvedBy: string,
    note?: string
  ): Promise<ComplianceScan | null> {
    const scan = await this.getScan(scanId);
    if (!scan) return null;

    const vIdx = scan.violations.findIndex((v) => v.id === violationId);
    if (vIdx < 0) return scan;

    scan.violations[vIdx] = {
      ...scan.violations[vIdx],
      resolved: true,
      resolvedAt: new Date().toISOString(),
      resolvedBy,
      resolutionNote: note,
    };

    await this.saveScan(scan);
    return scan;
  }

  static async getScanSummary(): Promise<ScanSummary> {
    await this.ensureInitialized();
    const scans = await this.listScans();
    const latestByDoc = new Map<string, ComplianceScan>();

    for (const scan of scans) {
      if (scan.status !== 'completed') continue;
      const existing = latestByDoc.get(scan.docId);
      if (!existing || existing.triggeredAt < scan.triggeredAt) {
        latestByDoc.set(scan.docId, scan);
      }
    }

    const latestScans = Array.from(latestByDoc.values());
    const categoryCounts: Record<DocumentCategory, number> = {
      privacy: 0, contract: 0, technical: 0, general: 0,
    };
    const severityCounts: Record<SeverityLevel, number> = { critical: 0, warning: 0, info: 0 };
    let totalDuration = 0;
    let completedCount = 0;
    let docsWithCritical = 0;
    let docsWithWarning = 0;
    let lastScanAt: string | undefined;

    for (const scan of latestScans) {
      completedCount++;
      totalDuration += scan.durationMs;
      if (!lastScanAt || scan.completedAt! > lastScanAt) {
        lastScanAt = scan.completedAt;
      }
      if (scan.criticalCount > 0) docsWithCritical++;
      if (scan.warningCount > 0 || scan.criticalCount > 0) docsWithWarning++;

      for (const v of scan.violations) {
        severityCounts[v.severity]++;
        categoryCounts[v.category]++;
      }
    }

    return {
      totalScans: scans.length,
      totalDocuments: latestByDoc.size,
      documentsWithCritical: docsWithCritical,
      documentsWithWarning: docsWithWarning,
      averageScanTimeMs: completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
      lastScanAt,
      violationsByCategory: categoryCounts,
      violationsBySeverity: severityCounts,
    };
  }

  static async checkRulesUpdateAndRescan(): Promise<{ rescannedDocs: number; rulesChanged: boolean }> {
    await this.ensureInitialized();
    const state = await FileStorageService.readJson<MonitorState>(MONITOR_STATE, {
      lastRulesVersion: 'initial',
      lastScanAt: new Date().toISOString(),
      reScanPending: [],
      monitoredDocIds: [],
    });

    const currentVersion = await ComplianceRuleService.getVersion();
    const rulesChanged = state.lastRulesVersion !== currentVersion.version;

    let rescanned = 0;

    if (rulesChanged) {
      state.lastRulesVersion = currentVersion.version;

      for (const docId of state.monitoredDocIds) {
        try {
          await this.triggerScan(docId, 'rules-update');
          rescanned++;
        } catch {
          if (!state.reScanPending.includes(docId)) {
            state.reScanPending.push(docId);
          }
        }
      }

      state.lastScanAt = new Date().toISOString();
      state.reScanPending = [];
      await FileStorageService.writeJson(MONITOR_STATE, state);
    } else if (state.reScanPending.length > 0) {
      const remaining: string[] = [];
      for (const docId of state.reScanPending) {
        try {
          await this.triggerScan(docId, 'retry');
          rescanned++;
        } catch {
          remaining.push(docId);
        }
      }
      state.reScanPending = remaining;
      state.lastScanAt = new Date().toISOString();
      await FileStorageService.writeJson(MONITOR_STATE, state);
    }

    return { rescannedDocs: rescanned, rulesChanged };
  }

  static async getMonitorState() {
    await this.ensureInitialized();
    return FileStorageService.readJson<MonitorState>(MONITOR_STATE, {
      lastRulesVersion: 'initial',
      lastScanAt: new Date().toISOString(),
      reScanPending: [],
      monitoredDocIds: [],
    });
  }

  static async runPipelineGate(
    docId: string,
    gateName: string = 'compliance-gate',
    failOnCritical: boolean = true,
    maxWarnings: number = 10
  ): Promise<PipelineGateResult> {
    await this.ensureInitialized();
    const scan = await this.triggerScan(docId, 'pipeline');

    let status: PipelineGateStatus = 'pass';
    const blockingRules: string[] = [];

    if (failOnCritical && scan.criticalCount > 0) {
      status = 'fail';
    } else if (scan.warningCount > maxWarnings) {
      status = 'warn';
    } else if (scan.warningCount > 0) {
      status = 'warn';
    }

    for (const v of scan.violations) {
      if (v.severity === 'critical' && !v.resolved) {
        if (!blockingRules.includes(v.ruleName)) {
          blockingRules.push(v.ruleName);
        }
      }
    }

    const summaryMap = {
      pass: `合规检查通过：无严重违规，警告 ${scan.warningCount} 条`,
      warn: `合规检查有警告：严重违规 0 条，警告 ${scan.warningCount} 条`,
      fail: `合规检查未通过：严重违规 ${scan.criticalCount} 条，请修复后重试`,
    };

    const result: PipelineGateResult = {
      docId,
      status,
      gateName,
      timestamp: new Date().toISOString(),
      criticalCount: scan.criticalCount,
      warningCount: scan.warningCount,
      blockingRules,
      summary: summaryMap[status],
      scanId: scan.id,
    };

    const allResults = await FileStorageService.readJson<PipelineResultsStore>(PIPELINE_RESULTS, {});
    if (!allResults[docId]) allResults[docId] = [];
    allResults[docId].unshift(result);
    allResults[docId] = allResults[docId].slice(0, 100);
    await FileStorageService.writeJson(PIPELINE_RESULTS, allResults);

    return result;
  }

  static async getPipelineResults(docId: string): Promise<PipelineGateResult[]> {
    await this.ensureInitialized();
    const allResults = await FileStorageService.readJson<PipelineResultsStore>(PIPELINE_RESULTS, {});
    return allResults[docId] || [];
  }
}
