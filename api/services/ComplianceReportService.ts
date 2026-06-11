import type {
  ComplianceReport,
  ComplianceScan,
  DocumentMeta,
  DocumentCategory,
  Violation,
  SeverityLevel,
} from '../../shared/types.js';
import { DocumentService } from './DocumentService.js';
import { ComplianceScanService } from './ComplianceScanService.js';
import { ComplianceRuleService } from './ComplianceRuleService.js';

function genId() {
  return `rpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class ComplianceReportService {
  static async generateReport(
    docId: string,
    scanId?: string
  ): Promise<ComplianceReport> {
    const doc = await DocumentService.get(docId);
    if (!doc) throw new Error('文档不存在');

    let scan: ComplianceScan | null;
    if (scanId) {
      scan = await ComplianceScanService.getScan(scanId);
    } else {
      scan = await ComplianceScanService.getLatestScan(docId);
    }
    if (!scan) {
      scan = await ComplianceScanService.triggerScan(docId, 'report');
    }

    const activeRules = await ComplianceRuleService.list({ status: 'active' });
    const appliedRuleIds = new Set(scan.violations.map((v) => v.ruleId));
    const rulesChecked = activeRules.filter(
      (r) => appliedRuleIds.has(r.id) || r.category === 'general' || r.category === this.detectCategory(doc, scan)
    );

    const totalViolations = scan.criticalCount + scan.warningCount + scan.infoCount;
    const maxPossibleScore = (scan.criticalCount + scan.warningCount + scan.infoCount) * 100;
    const penalty = scan.criticalCount * 100 + scan.warningCount * 30 + scan.infoCount * 10;
    const complianceScore = totalViolations === 0
      ? 100
      : Math.max(0, Math.round(100 - (penalty / (maxPossibleScore || 1)) * 100));

    const recommendations = this.generateRecommendations(scan);

    return {
      reportId: genId(),
      generatedAt: new Date().toISOString(),
      documentMeta: doc,
      scan,
      summary: {
        totalViolations,
        critical: scan.criticalCount,
        warning: scan.warningCount,
        info: scan.infoCount,
        complianceScore,
      },
      rulesChecked,
      violations: scan.violations,
      recommendations,
    };
  }

  private static detectCategory(doc: DocumentMeta, scan: ComplianceScan): 'privacy' | 'contract' | 'technical' | 'general' {
    const categories = new Map<string, number>();
    for (const v of scan.violations) {
      categories.set(v.category, (categories.get(v.category) || 0) + 1);
    }
    if (categories.size === 0) {
      const text = doc.title.toLowerCase();
      if (text.includes('隐私') || text.includes('privacy')) return 'privacy';
      if (text.includes('合同') || text.includes('协议') || text.includes('contract')) return 'contract';
      if (text.includes('技术') || text.includes('api') || text.includes('技术文档')) return 'technical';
      return 'general';
    }
    return [...categories.entries()].sort((a, b) => b[1] - a[1])[0][0] as DocumentCategory;
  }

  private static generateRecommendations(scan: ComplianceScan): string[] {
    const recs: string[] = [];

    if (scan.criticalCount > 0) {
      const criticalRules = [...new Set(
        scan.violations
          .filter((v) => v.severity === 'critical' && !v.resolved)
          .map((v) => v.ruleName)
      )];
      recs.push(`【优先修复】共 ${scan.criticalCount} 项严重违规需要立即处理，涉及规则：${criticalRules.join('、')}`);
    }

    if (scan.warningCount > 5) {
      recs.push(`警告项较多（${scan.warningCount} 项），建议安排专项修复计划。`);
    }

    const unresolved = scan.violations.filter((v) => !v.resolved);
    if (unresolved.length > 20) {
      recs.push(`未修复违规项超过 20 条，建议优先处理严重级别后分批处理中低级别问题。`);
    }

    const categories = [...new Set(scan.violations.filter((v) => !v.resolved).map((v) => v.category))];
    const categoryNames: Record<string, string> = {
      privacy: '隐私合规',
      contract: '合同条款',
      technical: '技术规范',
      general: '通用要求',
    };
    if (categories.length > 0) {
      recs.push(`本次检查覆盖 ${categories.length} 类合规领域：${categories.map((c) => categoryNames[c] || c).join('、')}。`);
    }

    if (scan.criticalCount === 0 && scan.warningCount === 0) {
      recs.push('🎉 文档合规检查通过，无严重和警告级别违规，建议定期复查以确保持续合规。');
    }

    return recs;
  }

  static generateHTMLReport(report: ComplianceReport): string {
    const severityBadge = (level: SeverityLevel) => {
      const styles: Record<SeverityLevel, { bg: string; text: string; label: string }> = {
        critical: { bg: '#dc2626', text: '#ffffff', label: '严重' },
        warning: { bg: '#f59e0b', text: '#ffffff', label: '警告' },
        info: { bg: '#3b82f6', text: '#ffffff', label: '提示' },
      };
      const s = styles[level];
      return `<span style="background:${s.bg};color:${s.text};padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600;">${s.label}</span>`;
    };

    const categoryLabel = (cat: string) => {
      const map: Record<string, string> = {
        privacy: '隐私合规',
        contract: '合同条款',
        technical: '技术规范',
        general: '通用要求',
      };
      return map[cat] || cat;
    };

    const violationsBySeverity = {
      critical: report.violations.filter((v) => v.severity === 'critical'),
      warning: report.violations.filter((v) => v.severity === 'warning'),
      info: report.violations.filter((v) => v.severity === 'info'),
    };

    const formatDate = (iso: string) => {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const scoreColor =
      report.summary.complianceScore >= 90
        ? '#059669'
        : report.summary.complianceScore >= 70
        ? '#0891b2'
        : report.summary.complianceScore >= 50
        ? '#f59e0b'
        : '#dc2626';

    const renderViolations = (list: Violation[], title: string, level: SeverityLevel) => {
      if (list.length === 0) return '';
      return `
        <div style="margin:20px 0;">
          <h3 style="color:#334155;font-size:16px;margin:0 0 12px;border-left:4px solid ${
            level === 'critical' ? '#dc2626' : level === 'warning' ? '#f59e0b' : '#3b82f6'
          };padding-left:10px;">
            ${title} (${list.length}项)
          </h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:8px 12px;text-align:left;border:1px solid #e2e8f0;width:60px;">类别</th>
                <th style="padding:8px 12px;text-align:left;border:1px solid #e2e8f0;">违规内容</th>
                <th style="padding:8px 12px;text-align:left;border:1px solid #e2e8f0;width:120px;">位置</th>
                <th style="padding:8px 12px;text-align:left;border:1px solid #e2e8f0;">修复指引</th>
                <th style="padding:8px 12px;text-align:left;border:1px solid #e2e8f0;width:100px;">状态</th>
              </tr>
            </thead>
            <tbody>
              ${list
                .map(
                  (v) => `
                <tr>
                  <td style="padding:8px 12px;border:1px solid #e2e8f0;font-size:12px;">${categoryLabel(v.category)}</td>
                  <td style="padding:8px 12px;border:1px solid #e2e8f0;">
                    <div style="font-weight:500;color:#1e293b;margin-bottom:4px;">${v.ruleName}</div>
                    <div style="color:#475569;line-height:1.5;">${v.message}</div>
                    ${v.location.snippet ? `<div style="margin-top:6px;padding:6px 10px;background:#f8fafc;border-radius:4px;border-left:3px solid #cbd5e1;font-family:Consolas,monospace;font-size:12px;color:#334155;word-break:break-all;">${v.location.snippet}</div>` : ''}
                  </td>
                  <td style="padding:8px 12px;border:1px solid #e2e8f0;font-size:12px;color:#64748b;">
                    ${v.location.paragraphIndex !== undefined ? `段落 #${v.location.paragraphIndex + 1}` : '-'}<br>
                    ${v.location.charStart !== undefined ? `字符 ${v.location.charStart}-${v.location.charEnd || ''}` : ''}
                  </td>
                  <td style="padding:8px 12px;border:1px solid #e2e8f0;color:#475569;line-height:1.6;">${v.fixGuidance}</td>
                  <td style="padding:8px 12px;border:1px solid #e2e8f0;font-size:12px;">
                    ${v.resolved ? `<span style="color:#059669;">✓ 已修复<br>${v.resolvedBy || ''}</span>` : `<span style="color:#dc2626;">● 待修复</span>`}
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    };

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>合规检查报告 - ${report.documentMeta.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 40px; color: #1e293b; background: #ffffff; }
    .report-header { padding-bottom: 24px; border-bottom: 2px solid #1e3a5f; margin-bottom: 24px; }
    .report-title { font-size: 24px; font-weight: 700; color: #1e3a5f; margin: 0 0 8px 0; }
    .report-subtitle { font-size: 13px; color: #64748b; }
    .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 20px 0; }
    .info-card { padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
    .info-label { font-size: 12px; color: #64748b; margin-bottom: 4px; }
    .info-value { font-size: 14px; font-weight: 600; color: #1e293b; }
    .score-card { text-align: center; padding: 32px; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 12px; margin: 24px 0; }
    .score-number { font-size: 64px; font-weight: 800; }
    .score-label { font-size: 14px; color: #475569; margin-top: 8px; }
    .stats-row { display: flex; gap: 16px; justify-content: center; margin: 20px 0; }
    .stat-item { flex: 1; padding: 20px; text-align: center; border-radius: 8px; }
    .stat-number { font-size: 32px; font-weight: 700; }
    .stat-label { font-size: 13px; margin-top: 4px; }
    .section { margin: 28px 0; }
    .section-title { font-size: 18px; font-weight: 600; color: #1e293b; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; margin-bottom: 16px; }
    .rules-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 13px; }
    .rule-item { padding: 10px 12px; background: #f8fafc; border-radius: 6px; border-left: 3px solid #94a3b8; }
    .rule-name { font-weight: 500; color: #1e293b; margin-bottom: 2px; }
    .rule-desc { font-size: 12px; color: #64748b; }
    .recommendations { padding: 16px; background: #fefce8; border: 1px solid #fde047; border-radius: 8px; }
    .recommendations h4 { margin: 0 0 10px 0; color: #854d0e; font-size: 14px; }
    .recommendations ul { margin: 0; padding-left: 20px; }
    .recommendations li { margin: 6px 0; color: #713f12; font-size: 13px; line-height: 1.6; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
    @media print {
      body { padding: 20px; }
      .page-break { page-break-before: always; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <h1 class="report-title">📋 文档合规检查报告</h1>
    <div class="report-subtitle">
      报告编号：${report.reportId} | 生成时间：${formatDate(report.generatedAt)} | 扫描ID：${report.scan.id}
    </div>
  </div>

  <div class="info-grid">
    <div class="info-card">
      <div class="info-label">文档名称</div>
      <div class="info-value">${report.documentMeta.title}</div>
    </div>
    <div class="info-card">
      <div class="info-label">文档类型</div>
      <div class="info-value">${report.documentMeta.fileType.toUpperCase()}</div>
    </div>
    <div class="info-card">
      <div class="info-label">创建时间</div>
      <div class="info-value">${formatDate(report.documentMeta.createdAt)}</div>
    </div>
    <div class="info-card">
      <div class="info-label">扫描耗时</div>
      <div class="info-value">${report.scan.durationMs}ms</div>
    </div>
    <div class="info-card">
      <div class="info-label">检查规则数</div>
      <div class="info-value">${report.scan.totalRulesChecked} 条</div>
    </div>
    <div class="info-card">
      <div class="info-label">规则版本</div>
      <div class="info-value">${report.scan.rulesVersion}</div>
    </div>
  </div>

  <div class="score-card">
    <div class="score-number" style="color:${scoreColor};">${report.summary.complianceScore}</div>
    <div class="score-label">合规评分（满分 100 分）</div>
  </div>

  <div class="stats-row">
    <div class="stat-item" style="background:#fef2f2; border:1px solid #fecaca;">
      <div class="stat-number" style="color:#dc2626;">${report.summary.critical}</div>
      <div class="stat-label" style="color:#991b1b;">严重违规</div>
    </div>
    <div class="stat-item" style="background:#fffbeb; border:1px solid #fde68a;">
      <div class="stat-number" style="color:#f59e0b;">${report.summary.warning}</div>
      <div class="stat-label" style="color:#92400e;">警告项</div>
    </div>
    <div class="stat-item" style="background:#eff6ff; border:1px solid #bfdbfe;">
      <div class="stat-number" style="color:#3b82f6;">${report.summary.info}</div>
      <div class="stat-label" style="color:#1e40af;">提示项</div>
    </div>
    <div class="stat-item" style="background:#f0fdf4; border:1px solid #bbf7d0;">
      <div class="stat-number" style="color:#059669;">${report.summary.totalViolations}</div>
      <div class="stat-label" style="color:#065f46;">总违规项</div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">📌 修复建议</h2>
    <div class="recommendations">
      <h4>💡 针对本次检查结果的改进建议</h4>
      <ul>
        ${report.recommendations.map((r) => `<li>${r}</li>`).join('')}
      </ul>
    </div>
  </div>

  <div class="page-break"></div>

  <div class="section">
    <h2 class="section-title">📝 违规详情</h2>
    ${renderViolations(violationsBySeverity.critical, '严重违规', 'critical')}
    ${renderViolations(violationsBySeverity.warning, '警告项', 'warning')}
    ${renderViolations(violationsBySeverity.info, '提示项', 'info')}
    ${report.summary.totalViolations === 0
      ? '<div style="padding:40px;text-align:center;background:#f0fdf4;border-radius:8px;color:#065f46;font-size:15px;">✓ 未发现任何违规项，文档合规检查通过！</div>'
      : ''}
  </div>

  <div class="page-break"></div>

  <div class="section">
    <h2 class="section-title">📋 已检查规则清单 (${report.rulesChecked.length} 条)</h2>
    <div class="rules-list">
      ${report.rulesChecked
        .map(
          (r) => `
        <div class="rule-item">
          <div class="rule-name">${severityBadge(r.severity)} ${r.name}</div>
          <div class="rule-desc">${r.description}</div>
        </div>
      `
        )
        .join('')}
    </div>
  </div>

  <div class="footer">
    <p>本报告由文档合规检查系统自动生成 · ${formatDate(report.generatedAt)}</p>
    <p>如需重新扫描，请访问合规管理控制台</p>
  </div>
</body>
</html>`;
  }
}
