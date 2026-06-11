import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Info,
  Download,
  ArrowLeft,
  RefreshCw,
  Search,
  Eye,
  FileCheck,
  Clock,
  ChevronDown,
  ChevronUp,
  FileText,
  XCircle,
  ShieldCheck,
  Share2,
  Printer,
  FileType2,
  CalendarDays,
  Timer,
  Hash,
  Filter,
  Check,
  ExternalLink,
} from 'lucide-react';
import type {
  ComplianceScan,
  Violation,
  SeverityLevel,
  PipelineGateResult,
  DocumentMeta,
  ComplianceReport,
  DocumentCategory,
  ComplianceRule,
} from '../types';
import { complianceApi, pipelineApi, documentsApi } from '../utils/api';

type SeverityFilter = 'all' | SeverityLevel;
type ResolvedFilter = 'all' | 'resolved' | 'unresolved';

const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  critical: '#dc2626',
  warning: '#f59e0b',
  info: '#3b82f6',
};

const SEVERITY_BG: Record<SeverityLevel, string> = {
  critical: 'bg-red-50',
  warning: 'bg-amber-50',
  info: 'bg-blue-50',
};

const SEVERITY_TEXT: Record<SeverityLevel, string> = {
  critical: 'text-red-700',
  warning: 'text-amber-700',
  info: 'text-blue-700',
};

const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
};

const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  privacy: '隐私合规',
  contract: '合同条款',
  technical: '技术规范',
  general: '通用规范',
};

function computeComplianceScore(scan: ComplianceScan): number {
  const criticalWeight = 10;
  const warningWeight = 3;
  const infoWeight = 1;
  const totalRules = Math.max(scan.totalRulesChecked, 1);
  const penalty =
    scan.criticalCount * criticalWeight +
    scan.warningCount * warningWeight +
    scan.infoCount * infoWeight;
  const maxPenalty = totalRules * criticalWeight;
  const score = Math.max(0, Math.min(100, 100 - (penalty / maxPenalty) * 100));
  return Math.round(score);
}

function getComplianceStatus(score: number): {
  label: string;
  color: string;
  bg: string;
} {
  if (score >= 90) return { label: 'Pass', color: 'text-green-700', bg: 'bg-green-100' };
  if (score >= 70) return { label: 'Warn', color: 'text-amber-700', bg: 'bg-amber-100' };
  return { label: 'Fail', color: 'text-red-700', bg: 'bg-red-100' };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const FILE_TYPE_LABEL: Record<string, string> = {
  markdown: 'Markdown',
  docx: 'Word 文档',
};

export function ScanResultPage() {
  const { scanId, docId } = useParams<{ scanId?: string; docId?: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ComplianceScan | null>(null);
  const [docMeta, setDocMeta] = useState<DocumentMeta | null>(null);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [pipelineHistory, setPipelineHistory] = useState<PipelineGateResult[]>([]);
  const [rulesChecked, setRulesChecked] = useState<ComplianceRule[]>([]);

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [resolvedFilter, setResolvedFilter] = useState<ResolvedFilter>('all');
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [exportDropdown, setExportDropdown] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      let currentScan: ComplianceScan | null = null;
      let currentDocId: string | undefined = docId;

      if (scanId) {
        currentScan = await complianceApi.scan.getDetail(scanId);
        currentDocId = currentScan.docId;
      } else if (docId) {
        currentScan = await complianceApi.scan.getLatest(docId);
        if (!currentScan) {
          throw new Error('该文档暂无扫描记录');
        }
      }

      if (!currentScan) {
        throw new Error('未找到扫描记录');
      }

      setScan(currentScan);

      const [doc, rep, history, rules] = await Promise.all([
        documentsApi.get(currentDocId!),
        complianceApi.report.get(currentDocId!, currentScan.id).catch(() => null),
        pipelineApi.history(currentDocId!).catch(() => []),
        complianceApi.rules
          .list()
          .catch(() => []),
      ]);

      setDocMeta(doc);
      setReport(rep);
      setPipelineHistory(history);
      setRulesChecked(rules);
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [scanId, docId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const score = useMemo(() => (scan ? computeComplianceScore(scan) : 0), [scan]);
  const status = useMemo(() => getComplianceStatus(score), [score]);

  const filteredViolations = useMemo(() => {
    if (!scan) return [];
    const q = searchQuery.trim().toLowerCase();
    return scan.violations.filter((v) => {
      if (severityFilter !== 'all' && v.severity !== severityFilter) return false;
      if (categoryFilter !== 'all' && v.category !== categoryFilter) return false;
      if (resolvedFilter === 'resolved' && !v.resolved) return false;
      if (resolvedFilter === 'unresolved' && v.resolved) return false;
      if (q) {
        const hay = `${v.ruleName} ${v.message} ${v.fixGuidance}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scan, severityFilter, categoryFilter, resolvedFilter, searchQuery]);

  const categories = useMemo(() => {
    if (!scan) return [];
    const set = new Set<string>();
    scan.violations.forEach((v) => set.add(v.category));
    return Array.from(set);
  }, [scan]);

  const handleRescan = async () => {
    if (!scan) return;
    try {
      const newScan = await complianceApi.scan.trigger(scan.docId, 'user');
      navigate(`/scan/${newScan.id}`);
    } catch (e) {
      alert((e as Error).message || '重新扫描失败');
    }
  };

  const handleExportHTML = () => {
    if (!docMeta) return;
    complianceApi.report.downloadHTML(docMeta.id, scan?.id);
    setExportDropdown(false);
  };

  const handlePrint = () => {
    if (!docMeta) return;
    complianceApi.report.openPrint(docMeta.id, scan?.id);
    setExportDropdown(false);
  };

  const handlePDFInfo = () => {
    alert('PDF 报告说明：\n\n1. 请先使用「打印」功能打开打印预览\n2. 在打印对话框中选择「另存为 PDF」\n3. 选择保存位置后即可生成 PDF 报告');
    setExportDropdown(false);
  };

  const handleResolveViolation = async (v: Violation) => {
    if (!scan) return;
    try {
      setResolvingId(v.id);
      const updated = await complianceApi.scan.resolveViolation(
        scan.id,
        v.id,
        'current-user',
        '手动标记为已修复'
      );
      setScan(updated);
    } catch (e) {
      alert((e as Error).message || '操作失败');
    } finally {
      setResolvingId(null);
    }
  };

  const handleJumpToParagraph = (paragraphId?: string) => {
    if (!docMeta || !paragraphId) return;
    navigate(`/admin/${docMeta.id}#p-${paragraphId}`);
  };

  const relatedGates = useMemo(() => {
    if (!scan) return [];
    return pipelineHistory.filter((g) => g.scanId === scan.id);
  }, [pipelineHistory, scan]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">正在加载扫描结果…</div>
      </div>
    );
  }

  if (error || !scan) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">加载失败</h2>
          <p className="mb-5 text-sm text-slate-500">{error || '扫描记录不存在'}</p>
          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded-md bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2e4e7a]"
          >
            <ArrowLeft size={14} /> 返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-6 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <Link
                to="/"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 shrink-0 mt-0.5"
              >
                <ArrowLeft size={16} />
                <span className="hidden sm:inline">合规中心</span>
              </Link>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f] shrink-0">
                <ShieldAlert size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base font-semibold text-slate-900 truncate">
                    {scan.docTitle}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${status.bg} ${status.color}`}
                  >
                    {status.label === 'Pass' ? (
                      <ShieldCheck size={12} />
                    ) : status.label === 'Warn' ? (
                      <AlertTriangle size={12} />
                    ) : (
                      <XCircle size={12} />
                    )}
                    {status.label}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <FileType2 size={12} />
                    {docMeta ? FILE_TYPE_LABEL[docMeta.fileType] || docMeta.fileType : '未知'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Hash size={12} />
                    {scan.id}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays size={12} />
                    {formatDateTime(scan.triggeredAt)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Timer size={12} />
                    {formatDuration(scan.durationMs)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleRescan}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw size={14} />
                <span className="hidden sm:inline">重新扫描</span>
              </button>
              <div className="relative">
                <button
                  onClick={() => setExportDropdown((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#1e3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2e4e7a]"
                >
                  <Download size={14} />
                  <span className="hidden sm:inline">导出报告</span>
                  <ChevronDown size={14} />
                </button>
                {exportDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setExportDropdown(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-slate-200 bg-white shadow-lg z-40 overflow-hidden">
                      <button
                        onClick={handleExportHTML}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <FileText size={14} />
                        HTML 报告
                      </button>
                      <button
                        onClick={handlePrint}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <Printer size={14} />
                        打印
                      </button>
                      <button
                        onClick={handlePDFInfo}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <Share2 size={14} />
                        PDF 报告说明
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
            <div className="flex items-center gap-6 shrink-0">
              <div className="relative">
                <div
                  className="flex h-28 w-28 items-center justify-center rounded-2xl text-white text-4xl font-bold"
                  style={{
                    backgroundColor:
                      score >= 90 ? '#16a34a' : score >= 70 ? '#f59e0b' : '#dc2626',
                  }}
                >
                  {score}
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border-2 border-white px-2.5 py-0.5 text-xs font-semibold shadow-sm ${status.bg} ${status.color}`}
                  >
                    {status.label === 'Pass' ? (
                      <CheckCircle2 size={12} />
                    ) : status.label === 'Warn' ? (
                      <AlertTriangle size={12} />
                    ) : (
                      <XCircle size={12} />
                    )}
                    {status.label === 'Pass' ? '通过' : status.label === 'Warn' ? '警告' : '不通过'}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500">合规评分</p>
                <p className="mt-0.5 text-2xl font-bold text-slate-900">{score}/100</p>
                <p className="mt-1 text-xs text-slate-500">
                  基于 {scan.totalRulesChecked} 条规则计算
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 flex-1 sm:grid-cols-4">
              <StatCard
                icon={XCircle}
                label="严重违规"
                value={scan.criticalCount}
                color="#dc2626"
                bg="bg-red-50"
                textColor="text-red-700"
              />
              <StatCard
                icon={AlertTriangle}
                label="警告"
                value={scan.warningCount}
                color="#f59e0b"
                bg="bg-amber-50"
                textColor="text-amber-700"
              />
              <StatCard
                icon={Info}
                label="提示"
                value={scan.infoCount}
                color="#3b82f6"
                bg="bg-blue-50"
                textColor="text-blue-700"
              />
              <StatCard
                icon={FileCheck}
                label="已检查规则"
                value={scan.totalRulesChecked}
                color="#1e3a5f"
                bg="bg-[#1e3a5f]/5"
                textColor="text-[#1e3a5f]"
              />
            </div>
          </div>
          {report?.recommendations && report.recommendations.length > 0 && (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="mb-2 text-sm font-medium text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={14} />
                改进建议
              </p>
              <ul className="space-y-1 text-sm text-amber-800 list-disc list-inside">
                {report.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {relatedGates.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-800 flex items-center gap-2">
              <ShieldAlert size={16} className="text-[#1e3a5f]" />
              流水线门禁信息
            </h2>
            <div className="space-y-3">
              {relatedGates.map((gate) => {
                const gateStatus =
                  gate.status === 'pass'
                    ? { label: '通过', color: 'text-green-700', bg: 'bg-green-100' }
                    : gate.status === 'warn'
                    ? { label: '警告', color: 'text-amber-700', bg: 'bg-amber-100' }
                    : { label: '阻断', color: 'text-red-700', bg: 'bg-red-100' };
                return (
                  <div
                    key={`${gate.gateName}-${gate.timestamp}`}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${gateStatus.bg} ${gateStatus.color}`}
                        >
                          {gate.status === 'pass' ? (
                            <CheckCircle2 size={12} />
                          ) : gate.status === 'warn' ? (
                            <AlertTriangle size={12} />
                          ) : (
                            <XCircle size={12} />
                          )}
                          {gateStatus.label}
                        </span>
                        <span className="text-sm font-medium text-slate-800">
                          {gate.gateName}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatDateTime(gate.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <XCircle size={12} className="text-red-500" />
                          严重 {gate.criticalCount}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <AlertTriangle size={12} className="text-amber-500" />
                          警告 {gate.warningCount}
                        </span>
                      </div>
                    </div>
                    {gate.summary && (
                      <p className="mt-2 text-sm text-slate-600">{gate.summary}</p>
                    )}
                    {gate.blockingRules.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-1.5 text-xs font-medium text-slate-500">
                          阻断规则列表：
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {gate.blockingRules.map((rule) => (
                            <span
                              key={rule}
                              className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-700 border border-red-100"
                            >
                              <XCircle size={10} />
                              {rule}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <ShieldAlert size={16} className="text-[#1e3a5f]" />
                违规详情
                <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 font-normal">
                  {filteredViolations.length} / {scan.violations.length}
                </span>
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
                {(
                  [
                    { v: 'all', label: '全部' },
                    { v: 'critical', label: '严重' },
                    { v: 'warning', label: '警告' },
                    { v: 'info', label: '提示' },
                  ] as { v: SeverityFilter; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.v}
                    onClick={() => setSeverityFilter(opt.v)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      severityFilter === opt.v
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  placeholder="搜索规则或消息…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-56 rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#1e3a5f]/50 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/30"
                />
              </div>

              <label className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                <Filter size={12} className="text-slate-400" />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="bg-transparent focus:outline-none"
                >
                  <option value="all">全部分类</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c as DocumentCategory] || c}
                    </option>
                  ))}
                </select>
              </label>

              <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
                {(
                  [
                    { v: 'all', label: '全部' },
                    { v: 'unresolved', label: '未解决' },
                    { v: 'resolved', label: '已解决' },
                  ] as { v: ResolvedFilter; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.v}
                    onClick={() => setResolvedFilter(opt.v)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      resolvedFilter === opt.v
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4">
            {filteredViolations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
                <CheckCircle2
                  size={36}
                  strokeWidth={1.2}
                  className="mx-auto mb-2 text-green-400"
                />
                <p className="text-sm text-slate-500">
                  {scan.violations.length === 0
                    ? '太棒了！本次扫描未发现任何违规'
                    : '暂无符合筛选条件的违规'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredViolations.map((v) => (
                  <ViolationCard
                    key={v.id}
                    violation={v}
                    resolving={resolvingId === v.id}
                    onResolve={() => handleResolveViolation(v)}
                    onJump={() => handleJumpToParagraph(v.location.paragraphId)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button
            onClick={() => setRulesExpanded((v) => !v)}
            className="flex w-full items-center justify-between p-4 hover:bg-slate-50 transition-colors"
          >
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <FileCheck size={16} className="text-[#1e3a5f]" />
              检查规则清单
              <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 font-normal">
                {rulesChecked.length} 条
              </span>
            </h2>
            {rulesExpanded ? (
              <ChevronUp size={18} className="text-slate-400" />
            ) : (
              <ChevronDown size={18} className="text-slate-400" />
            )}
          </button>
          {rulesExpanded && (
            <div className="border-t border-slate-100">
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                {rulesChecked.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    暂无规则数据
                  </div>
                ) : (
                  rulesChecked.map((rule) => {
                    const ruleViolations = scan.violations.filter(
                      (v) => v.ruleId === rule.id
                    );
                    const passed = ruleViolations.length === 0;
                    return (
                      <div
                        key={rule.id}
                        className="flex items-start justify-between gap-3 p-4"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-slate-800 truncate">
                              {rule.name}
                            </p>
                            <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                              {CATEGORY_LABEL[rule.category] || rule.category}
                            </span>
                            <span
                              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${SEVERITY_COLORS[rule.severity]}15`,
                                color: SEVERITY_COLORS[rule.severity],
                              }}
                            >
                              {SEVERITY_LABEL[rule.severity]}
                            </span>
                            {rule.isBuiltin && (
                              <span className="inline-flex items-center rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-700">
                                内置
                              </span>
                            )}
                          </div>
                          {rule.description && (
                            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                              {rule.description}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          {!passed && (
                            <span className="text-xs text-slate-500">
                              {ruleViolations.length} 处违规
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
                              passed
                                ? 'bg-green-50 text-green-700'
                                : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {passed ? (
                              <CheckCircle2 size={12} />
                            ) : (
                              <XCircle size={12} />
                            )}
                            {passed ? '通过' : '未通过'}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </section>

        {pipelineHistory.length > relatedGates.length && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Clock size={16} className="text-[#1e3a5f]" />
              门禁历史记录
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 pr-4 font-medium">门禁名称</th>
                    <th className="py-2 pr-4 font-medium">状态</th>
                    <th className="py-2 pr-4 font-medium">严重</th>
                    <th className="py-2 pr-4 font-medium">警告</th>
                    <th className="py-2 pr-4 font-medium">时间</th>
                    <th className="py-2 font-medium">扫描ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {pipelineHistory.slice(0, 10).map((g) => (
                    <tr key={`${g.gateName}-${g.timestamp}`}>
                      <td className="py-2 pr-4">{g.gateName}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            g.status === 'pass'
                              ? 'bg-green-50 text-green-700'
                              : g.status === 'warn'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {g.status === 'pass'
                            ? '通过'
                            : g.status === 'warn'
                            ? '警告'
                            : '阻断'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-red-600">{g.criticalCount}</td>
                      <td className="py-2 pr-4 text-amber-600">{g.warningCount}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {formatDateTime(g.timestamp)}
                      </td>
                      <td className="py-2 font-mono text-[10px] text-slate-500 truncate max-w-24">
                        {g.scanId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  bg,
  textColor,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  color: string;
  bg: string;
  textColor: string;
}) {
  return (
    <div className={`rounded-xl ${bg} p-4 border border-white/60`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className={`mt-1 text-2xl font-bold ${textColor}`}>{value}</p>
        </div>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/70"
          style={{ color }}
        >
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function ViolationCard({
  violation,
  resolving,
  onResolve,
  onJump,
}: {
  violation: Violation;
  resolving: boolean;
  onResolve: () => void;
  onJump: () => void;
}) {
  const color = SEVERITY_COLORS[violation.severity];
  const bg = SEVERITY_BG[violation.severity];
  const textColor = SEVERITY_TEXT[violation.severity];
  return (
    <div
      className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
      style={{ borderLeftWidth: 4, borderLeftColor: color }}
    >
      <div className="px-4 pt-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${bg} ${textColor}`}
            >
              {violation.severity === 'critical' ? (
                <XCircle size={12} />
              ) : violation.severity === 'warning' ? (
                <AlertTriangle size={12} />
              ) : (
                <Info size={12} />
              )}
              {SEVERITY_LABEL[violation.severity]}
            </span>
            <p className="text-sm font-semibold text-slate-800 truncate">
              {violation.ruleName}
            </p>
            <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
              {CATEGORY_LABEL[violation.category] || violation.category}
            </span>
            {violation.resolved && (
              <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
                <Check size={11} />
                已解决
              </span>
            )}
          </div>
          <span className="text-xs text-slate-400 shrink-0">
            {formatDateTime(violation.detectedAt)}
          </span>
        </div>
      </div>

      <div className="px-4 pb-3">
        <p className="text-sm text-slate-700 leading-relaxed">{violation.message}</p>
      </div>

      {(violation.location.paragraphIndex !== undefined ||
        violation.location.snippet) && (
        <div className="px-4 pb-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5 bg-slate-100/50">
              <span className="text-[11px] font-medium text-slate-500 inline-flex items-center gap-1">
                <FileText size={11} />
                {violation.location.paragraphIndex !== undefined ? (
                  <>段落 #{violation.location.paragraphIndex + 1}</>
                ) : (
                  <>位置信息</>
                )}
              </span>
              {(violation.location.lineStart !== undefined ||
                violation.location.charStart !== undefined) && (
                <span className="text-[11px] text-slate-400 font-mono">
                  {violation.location.lineStart !== undefined &&
                    `L${violation.location.lineStart}${
                      violation.location.lineEnd
                        ? `-${violation.location.lineEnd}`
                        : ''
                    }`}
                  {violation.location.lineStart !== undefined &&
                    violation.location.charStart !== undefined &&
                    ' '}
                  {violation.location.charStart !== undefined &&
                    `C${violation.location.charStart}${
                      violation.location.charEnd
                        ? `-${violation.location.charEnd}`
                        : ''
                    }`}
                </span>
              )}
            </div>
            {violation.location.snippet && (
              <pre className="p-3 text-xs font-mono text-slate-700 whitespace-pre-wrap break-all leading-relaxed bg-slate-900 text-slate-100 overflow-x-auto">
                <code>{violation.location.snippet}</code>
              </pre>
            )}
          </div>
        </div>
      )}

      {violation.fixGuidance && (
        <div className="px-4 pb-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="mb-1 text-xs font-medium text-amber-800 inline-flex items-center gap-1.5">
              <Eye size={12} />
              修复指引
            </p>
            <p className="text-xs text-amber-900/90 leading-relaxed whitespace-pre-wrap">
              {violation.fixGuidance}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-2.5">
        <div />
        <div className="flex items-center gap-2">
          {violation.location.paragraphId && (
            <button
              onClick={onJump}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-[#1e3a5f] hover:bg-[#1e3a5f]/5"
            >
              <ExternalLink size={12} />
              跳转到文档段落
            </button>
          )}
          {!violation.resolved ? (
            <button
              onClick={onResolve}
              disabled={resolving}
              className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Check size={12} />
              {resolving ? '处理中…' : '标记为已修复'}
            </button>
          ) : (
            <span className="text-xs text-green-700 inline-flex items-center gap-1">
              <CheckCircle2 size={12} />
              由 {violation.resolvedBy || '未知'} 于{' '}
              {violation.resolvedAt && formatDateTime(violation.resolvedAt)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
