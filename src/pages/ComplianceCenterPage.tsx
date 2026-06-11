import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  Info,
  Activity,
  Database,
  RefreshCw,
  Search,
  Filter,
  Plus,
  Settings,
  Zap,
  FileText,
  ArrowLeft,
  Clock,
  BarChart3,
  Eye,
  Edit3,
  Copy,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  XCircle,
  AlertCircle,
  MonitorPlay,
  History,
  Layers,
} from 'lucide-react';
import { complianceApi, pipelineApi, documentsApi } from '../utils/api';
import type {
  ScanSummary,
  ComplianceScan,
  ComplianceRule,
  SeverityLevel,
  DocumentCategory,
  RuleStatus,
  RuleType,
  ScanStatus,
  PipelineGateStatus,
  PipelineGateResult,
  DocumentMeta,
} from '../types';

type TabKey = 'dashboard' | 'rules' | 'scans' | 'pipeline';

const SEVERITY_COLORS: Record<SeverityLevel, { bg: string; text: string; border: string; badge: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', badge: 'bg-red-500' },
  warning: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', badge: 'bg-amber-500' },
  info: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', badge: 'bg-blue-500' },
};

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  privacy: '隐私',
  contract: '合同',
  technical: '技术',
  general: '通用',
};

const CATEGORY_COLORS: Record<DocumentCategory, string> = {
  privacy: 'bg-rose-500',
  contract: 'bg-violet-500',
  technical: 'bg-cyan-500',
  general: 'bg-slate-500',
};

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
};

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  regex: '正则',
  ast: 'AST',
  custom: '自定义',
};

const RULE_STATUS_LABELS: Record<RuleStatus, string> = {
  active: '启用中',
  disabled: '已禁用',
  draft: '草稿',
};

const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  pending: '等待中',
  running: '扫描中',
  completed: '已完成',
  failed: '失败',
};

const GATE_STATUS_LABELS: Record<PipelineGateStatus, string> = {
  pass: '通过',
  fail: '失败',
  warn: '警告',
};

export function ComplianceCenterPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [recentScans, setRecentScans] = useState<ComplianceScan[]>([]);
  const [rules, setRules] = useState<ComplianceRule[]>([]);
  const [allScans, setAllScans] = useState<ComplianceScan[]>([]);
  const [gateHistory, setGateHistory] = useState<PipelineGateResult[]>([]);
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [monitorState, setMonitorState] = useState<{
    lastRulesVersion: string;
    lastScanAt: string;
    reScanPending: string[];
    monitoredDocIds: string[];
  } | null>(null);

  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleCategoryFilter, setRuleCategoryFilter] = useState<DocumentCategory | 'all'>('all');
  const [ruleSeverityFilter, setRuleSeverityFilter] = useState<SeverityLevel | 'all'>('all');
  const [ruleStatusFilter, setRuleStatusFilter] = useState<RuleStatus | 'all'>('all');

  const [scanDocFilter, setScanDocFilter] = useState<string>('all');
  const [scanTimeFilter, setScanTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [gateTimeFilter, setGateTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');

  const loadAll = async () => {
    try {
      setLoading(true);
      setError(null);

      const [sum, scans, ruleList, docs, monitor] = await Promise.all([
        complianceApi.summary(),
        complianceApi.scan.list(undefined, 20),
        complianceApi.rules.list(),
        documentsApi.list(),
        complianceApi.monitor.getState(),
      ]);

      setSummary(sum);
      setRecentScans(scans.slice(0, 6));
      setAllScans(scans);
      setRules(ruleList);
      setDocuments(docs);
      setMonitorState(monitor);

      if (docs.length > 0) {
        try {
          const gh = await pipelineApi.history(docs[0].id);
          setGateHistory(gh);
        } catch {
          setGateHistory([]);
        }
      }
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const complianceScore = useMemo(() => {
    if (!summary) return 100;
    const total = summary.violationsBySeverity.critical * 3 + summary.violationsBySeverity.warning * 2 + summary.violationsBySeverity.info;
    const maxPossible = Math.max(summary.totalScans * 10, total * 2, 100);
    const raw = Math.max(0, Math.min(100, 100 - (total / maxPossible) * 100));
    return Math.round(raw);
  }, [summary]);

  const filteredRules = useMemo(() => {
    return rules.filter((r) => {
      if (ruleSearch) {
        const q = ruleSearch.toLowerCase();
        if (!r.name.toLowerCase().includes(q) && !r.description.toLowerCase().includes(q)) return false;
      }
      if (ruleCategoryFilter !== 'all' && r.category !== ruleCategoryFilter) return false;
      if (ruleSeverityFilter !== 'all' && r.severity !== ruleSeverityFilter) return false;
      if (ruleStatusFilter !== 'all' && r.status !== ruleStatusFilter) return false;
      return true;
    });
  }, [rules, ruleSearch, ruleCategoryFilter, ruleSeverityFilter, ruleStatusFilter]);

  const filteredScans = useMemo(() => {
    const now = new Date();
    return allScans.filter((s) => {
      if (scanDocFilter !== 'all' && s.docId !== scanDocFilter) return false;
      if (scanTimeFilter !== 'all') {
        const d = new Date(s.triggeredAt);
        if (scanTimeFilter === 'today' && (now.getTime() - d.getTime()) / 86400000 > 1) return false;
        if (scanTimeFilter === 'week' && (now.getTime() - d.getTime()) / 86400000 > 7) return false;
        if (scanTimeFilter === 'month' && (now.getTime() - d.getTime()) / 86400000 > 30) return false;
      }
      return true;
    });
  }, [allScans, scanDocFilter, scanTimeFilter]);

  const filteredGateHistory = useMemo(() => {
    const now = new Date();
    return gateHistory.filter((g) => {
      if (gateTimeFilter !== 'all') {
        const d = new Date(g.timestamp);
        if (gateTimeFilter === 'today' && (now.getTime() - d.getTime()) / 86400000 > 1) return false;
        if (gateTimeFilter === 'week' && (now.getTime() - d.getTime()) / 86400000 > 7) return false;
        if (gateTimeFilter === 'month' && (now.getTime() - d.getTime()) / 86400000 > 30) return false;
      }
      return true;
    });
  }, [gateHistory, gateTimeFilter]);

  const toggleRuleStatus = async (rule: ComplianceRule) => {
    const newStatus: RuleStatus = rule.status === 'active' ? 'disabled' : 'active';
    try {
      const updated = await complianceApi.rules.setStatus(rule.id, newStatus);
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (e) {
      console.error('切换规则状态失败', e);
    }
  };

  const duplicateRule = async (rule: ComplianceRule) => {
    try {
      const copy = await complianceApi.rules.duplicate(rule.id);
      setRules((prev) => [...prev, copy]);
    } catch (e) {
      console.error('复制规则失败', e);
    }
  };

  const deleteRule = async (rule: ComplianceRule) => {
    if (!confirm(`确定要删除规则「${rule.name}」吗？`)) return;
    try {
      await complianceApi.rules.remove(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch (e) {
      console.error('删除规则失败', e);
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const docTitleById = (id: string) => documents.find((d) => d.id === id)?.title || id;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">正在加载…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">加载失败</h2>
          <p className="mb-5 text-sm text-slate-500">{error}</p>
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
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
            >
              <ArrowLeft size={14} />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f]">
              <Shield size={18} />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-900">文档合规中心</h1>
              <p className="text-xs text-slate-500">Compliance Management</p>
            </div>
          </div>
          <nav className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            {([
              { key: 'dashboard', label: '仪表盘', icon: Activity },
              { key: 'rules', label: '规则管理', icon: Settings },
              { key: 'scans', label: '扫描记录', icon: History },
              { key: 'pipeline', label: '流水线门禁', icon: Zap },
            ] as { key: TabKey; label: string; icon: typeof Shield }[]).map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-white text-[#1e3a5f] shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon size={13} />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {activeTab === 'dashboard' && summary && (
          <DashboardView
            summary={summary}
            complianceScore={complianceScore}
            recentScans={recentScans}
            monitorState={monitorState}
            formatDuration={formatDuration}
            formatTime={formatTime}
          />
        )}

        {activeTab === 'rules' && (
          <RulesView
            rules={filteredRules}
            totalRules={rules.length}
            search={ruleSearch}
            onSearchChange={setRuleSearch}
            categoryFilter={ruleCategoryFilter}
            onCategoryChange={setRuleCategoryFilter}
            severityFilter={ruleSeverityFilter}
            onSeverityChange={setRuleSeverityFilter}
            statusFilter={ruleStatusFilter}
            onStatusChange={setRuleStatusFilter}
            onToggleStatus={toggleRuleStatus}
            onDuplicate={duplicateRule}
            onDelete={deleteRule}
          />
        )}

        {activeTab === 'scans' && (
          <ScansView
            scans={filteredScans}
            documents={documents}
            docFilter={scanDocFilter}
            onDocFilterChange={setScanDocFilter}
            timeFilter={scanTimeFilter}
            onTimeFilterChange={setScanTimeFilter}
            formatDuration={formatDuration}
            formatTime={formatTime}
          />
        )}

        {activeTab === 'pipeline' && (
          <PipelineView
            gateHistory={filteredGateHistory}
            docTitleById={docTitleById}
            timeFilter={gateTimeFilter}
            onTimeFilterChange={setGateTimeFilter}
            formatTime={formatTime}
          />
        )}
      </main>
    </div>
  );
}

function DashboardView({
  summary,
  complianceScore,
  recentScans,
  monitorState,
  formatDuration,
  formatTime,
}: {
  summary: ScanSummary;
  complianceScore: number;
  recentScans: ComplianceScan[];
  monitorState: {
    lastRulesVersion: string;
    lastScanAt: string;
    reScanPending: string[];
    monitoredDocIds: string[];
  } | null;
  formatDuration: (ms: number) => string;
  formatTime: (iso: string) => string;
}) {
  const statCards = [
    {
      label: '总扫描次数',
      value: summary.totalScans,
      icon: Activity,
      gradient: 'from-[#1e3a5f] to-[#2e4e7a]',
    },
    {
      label: '文档总数',
      value: summary.totalDocuments,
      icon: FileText,
      gradient: 'from-slate-600 to-slate-700',
    },
    {
      label: '有严重违规的文档数',
      value: summary.documentsWithCritical,
      icon: AlertTriangle,
      gradient: 'from-red-500 to-red-600',
    },
    {
      label: '平均扫描耗时',
      value: formatDuration(summary.averageScanTimeMs),
      icon: Clock,
      gradient: 'from-emerald-500 to-emerald-600',
    },
  ];

  const maxCategoryVal = Math.max(...Object.values(summary.violationsByCategory), 1);

  const scoreColor =
    complianceScore >= 90 ? '#10b981' : complianceScore >= 70 ? '#f59e0b' : '#ef4444';
  const circumference = 2 * Math.PI * 60;
  const offset = circumference - (complianceScore / 100) * circumference;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {statCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className={`rounded-2xl bg-gradient-to-br ${c.gradient} p-4 text-white shadow-sm`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs opacity-80">{c.label}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{c.value}</p>
                </div>
                <Icon size={20} strokeWidth={1.8} className="opacity-80" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Shield size={14} /> 合规评分
          </h3>
          <div className="flex flex-col items-center">
            <div className="relative">
              <svg width="160" height="160" className="transform -rotate-90">
                <circle
                  cx="80"
                  cy="80"
                  r="60"
                  stroke="#e2e8f0"
                  strokeWidth="12"
                  fill="none"
                />
                <circle
                  cx="80"
                  cy="80"
                  r="60"
                  stroke={scoreColor}
                  strokeWidth="12"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  style={{ transition: 'stroke-dashoffset 0.6s ease' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-bold" style={{ color: scoreColor }}>
                  {complianceScore}
                </span>
                <span className="text-xs text-slate-500">合规分</span>
              </div>
            </div>
            <div className="mt-5 grid w-full grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-red-50 p-2">
                <p className="text-lg font-semibold text-red-600">
                  {summary.violationsBySeverity.critical}
                </p>
                <p className="text-[11px] text-red-500">严重</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-2">
                <p className="text-lg font-semibold text-amber-600">
                  {summary.violationsBySeverity.warning}
                </p>
                <p className="text-[11px] text-amber-500">警告</p>
              </div>
              <div className="rounded-lg bg-blue-50 p-2">
                <p className="text-lg font-semibold text-blue-600">
                  {summary.violationsBySeverity.info}
                </p>
                <p className="text-[11px] text-blue-500">提示</p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <BarChart3 size={14} /> 违规分布图
          </h3>
          <div className="space-y-4">
            {(Object.keys(CATEGORY_LABELS) as DocumentCategory[]).map((cat) => {
              const val = summary.violationsByCategory[cat] || 0;
              const pct = (val / maxCategoryVal) * 100;
              return (
                <div key={cat}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-600">{CATEGORY_LABELS[cat]}</span>
                    <span className="font-medium text-slate-700">{val}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${CATEGORY_COLORS[cat]} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <AlertCircle size={14} /> 严重级别分布
          </h3>
          <div className="space-y-3">
            {(['critical', 'warning', 'info'] as SeverityLevel[]).map((sev) => {
              const val = summary.violationsBySeverity[sev];
              const colors = SEVERITY_COLORS[sev];
              const icons = { critical: XCircle, warning: AlertTriangle, info: Info };
              const Icon = icons[sev];
              return (
                <div
                  key={sev}
                  className={`flex items-center justify-between rounded-xl border ${colors.border} ${colors.bg} p-3`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors.badge} text-white`}>
                      <Icon size={15} />
                    </div>
                    <div>
                      <p className={`text-xs font-medium ${colors.text}`}>
                        {SEVERITY_LABELS[sev]}
                      </p>
                      <p className={`text-lg font-bold ${colors.text}`}>{val}</p>
                    </div>
                  </div>
                  <p className={`text-xs ${colors.text} opacity-70`}>
                    {val === 0
                      ? '0%'
                      : `${((val / Object.values(summary.violationsBySeverity).reduce((a, b) => a + b, 0)) * 100).toFixed(0)}%`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <History size={14} /> 最近扫描记录
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">文档名</th>
                <th className="px-6 py-3 font-medium">扫描时间</th>
                <th className="px-6 py-3 font-medium">状态</th>
                <th className="px-6 py-3 font-medium">严重</th>
                <th className="px-6 py-3 font-medium">警告</th>
                <th className="px-6 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentScans.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <Activity size={28} strokeWidth={1.2} className="mx-auto mb-2" />
                    暂无扫描记录
                  </td>
                </tr>
              ) : (
                recentScans.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/60">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-slate-400" />
                        <span className="font-medium text-slate-700">{s.docTitle}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-slate-500">{formatTime(s.triggeredAt)}</td>
                    <td className="px-6 py-3">
                      <ScanStatusBadge status={s.status} />
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-medium ${s.criticalCount > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
                        {s.criticalCount}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-medium ${s.warningCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {s.warningCount}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <button className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:underline">
                        <Eye size={12} /> 查看详情
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <MonitorPlay size={14} /> 持续监控状态
          </h3>
          <button className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
            <RefreshCw size={12} /> 刷新检查
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-sky-50 to-white p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-sky-600">
                <Database size={16} />
              </div>
              <div>
                <p className="text-xs text-slate-500">监控文档数</p>
                <p className="text-xl font-semibold text-slate-800">
                  {monitorState?.monitoredDocIds.length || 0}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-white p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                <CheckCircle size={16} />
              </div>
              <div>
                <p className="text-xs text-slate-500">上次规则版本检查</p>
                <p className="text-sm font-semibold text-slate-800">
                  {monitorState?.lastScanAt ? formatTime(monitorState.lastScanAt) : '—'}
                </p>
                {monitorState?.lastRulesVersion && (
                  <p className="text-[11px] text-slate-400">版本 {monitorState.lastRulesVersion}</p>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-violet-50 to-white p-4">
            <div className="flex items-center gap-2">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${monitorState && monitorState.reScanPending.length > 0 ? 'bg-amber-100 text-amber-600' : 'bg-violet-100 text-violet-600'}`}>
                <Layers size={16} />
              </div>
              <div>
                <p className="text-xs text-slate-500">重扫描队列</p>
                <p className="text-xl font-semibold text-slate-800">
                  {monitorState?.reScanPending.length || 0} 份待处理
                </p>
                {monitorState && monitorState.reScanPending.length === 0 && (
                  <p className="text-[11px] text-emerald-500">队列空闲</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RulesView({
  rules,
  totalRules,
  search,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
  severityFilter,
  onSeverityChange,
  statusFilter,
  onStatusChange,
  onToggleStatus,
  onDuplicate,
  onDelete,
}: {
  rules: ComplianceRule[];
  totalRules: number;
  search: string;
  onSearchChange: (v: string) => void;
  categoryFilter: DocumentCategory | 'all';
  onCategoryChange: (v: DocumentCategory | 'all') => void;
  severityFilter: SeverityLevel | 'all';
  onSeverityChange: (v: SeverityLevel | 'all') => void;
  statusFilter: RuleStatus | 'all';
  onStatusChange: (v: RuleStatus | 'all') => void;
  onToggleStatus: (r: ComplianceRule) => void;
  onDuplicate: (r: ComplianceRule) => void;
  onDelete: (r: ComplianceRule) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索规则名称或描述…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-[#1e3a5f] focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/20"
            />
          </div>
          <Filter size={14} className="text-slate-400" />
          <Select
            value={categoryFilter}
            onChange={(v) => onCategoryChange(v as DocumentCategory | 'all')}
            options={[
              { value: 'all', label: '全部类别' },
              ...(Object.keys(CATEGORY_LABELS) as DocumentCategory[]).map((k) => ({
                value: k,
                label: CATEGORY_LABELS[k],
              })),
            ]}
          />
          <Select
            value={severityFilter}
            onChange={(v) => onSeverityChange(v as SeverityLevel | 'all')}
            options={[
              { value: 'all', label: '全部严重级' },
              ...(Object.keys(SEVERITY_LABELS) as SeverityLevel[]).map((k) => ({
                value: k,
                label: SEVERITY_LABELS[k],
              })),
            ]}
          />
          <Select
            value={statusFilter}
            onChange={(v) => onStatusChange(v as RuleStatus | 'all')}
            options={[
              { value: 'all', label: '全部状态' },
              ...(Object.keys(RULE_STATUS_LABELS) as RuleStatus[]).map((k) => ({
                value: k,
                label: RULE_STATUS_LABELS[k],
              })),
            ]}
          />
          <span className="ml-auto text-xs text-slate-400">
            显示 {rules.length} / {totalRules} 条规则
          </span>
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2e4e7a]">
            <Plus size={14} /> 新建规则
          </button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-16 text-center">
          <Settings size={36} strokeWidth={1.2} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-500">没有符合条件的规则</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rules.map((rule) => {
            const sevColors = SEVERITY_COLORS[rule.severity];
            return (
              <div
                key={rule.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-slate-800 truncate">
                        {rule.name}
                      </h4>
                      {rule.isBuiltin && (
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          内置
                        </span>
                      )}
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-[#1e3a5f]/10 text-[#1e3a5f]`}>
                        v{rule.version}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                      {rule.description}
                    </p>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[rule.category]} text-white`}
                      >
                        {CATEGORY_LABELS[rule.category]}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${sevColors.border} ${sevColors.bg} ${sevColors.text}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${sevColors.badge}`} />
                        {SEVERITY_LABELS[rule.severity]}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {RULE_TYPE_LABELS[rule.type]}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => onToggleStatus(rule)}
                    className="text-[#1e3a5f] hover:text-[#2e4e7a] flex-shrink-0"
                    title={rule.status === 'active' ? '禁用' : '启用'}
                  >
                    {rule.status === 'active' ? (
                      <ToggleRight size={28} strokeWidth={1.8} />
                    ) : (
                      <ToggleLeft size={28} strokeWidth={1.8} className="text-slate-300" />
                    )}
                  </button>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-[11px] text-slate-400">
                    更新于 {formatTimeShort(rule.updatedAt)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      title="编辑"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#1e3a5f]"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      onClick={() => onDuplicate(rule)}
                      title="复制"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#1e3a5f]"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={() => onDelete(rule)}
                      title="删除"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScansView({
  scans,
  documents,
  docFilter,
  onDocFilterChange,
  timeFilter,
  onTimeFilterChange,
  formatDuration,
  formatTime,
}: {
  scans: ComplianceScan[];
  documents: DocumentMeta[];
  docFilter: string;
  onDocFilterChange: (v: string) => void;
  timeFilter: 'all' | 'today' | 'week' | 'month';
  onTimeFilterChange: (v: 'all' | 'today' | 'week' | 'month') => void;
  formatDuration: (ms: number) => string;
  formatTime: (iso: string) => string;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={14} className="text-slate-400" />
          <Select
            value={timeFilter}
            onChange={(v) => onTimeFilterChange(v as typeof timeFilter)}
            options={[
              { value: 'all', label: '全部时间' },
              { value: 'today', label: '今天' },
              { value: 'week', label: '本周' },
              { value: 'month', label: '本月' },
            ]}
          />
          <Select
            value={docFilter}
            onChange={onDocFilterChange}
            options={[
              { value: 'all', label: '全部文档' },
              ...documents.map((d) => ({ value: d.id, label: d.title })),
            ]}
          />
          <span className="ml-auto text-xs text-slate-400">
            共 {scans.length} 条扫描记录
          </span>
        </div>
      </div>

      {scans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-16 text-center">
          <History size={36} strokeWidth={1.2} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-500">暂无扫描记录</p>
        </div>
      ) : (
        <div className="space-y-3">
          {scans.map((s) => (
            <div
              key={s.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f]">
                    <FileText size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-slate-800">{s.docTitle}</h4>
                      <ScanStatusBadge status={s.status} />
                      <TriggerBadge triggeredBy={s.triggeredBy} />
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} /> {formatTime(s.triggeredAt)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Activity size={11} /> {formatDuration(s.durationMs)}
                      </span>
                      <span className="text-slate-400">规则版本 {s.rulesVersion}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1">
                    <XCircle size={12} className="text-red-500" />
                    <span className="text-xs font-semibold text-red-700">{s.criticalCount}</span>
                    <span className="text-[10px] text-red-500">严重</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1">
                    <AlertTriangle size={12} className="text-amber-500" />
                    <span className="text-xs font-semibold text-amber-700">{s.warningCount}</span>
                    <span className="text-[10px] text-amber-500">警告</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1">
                    <Info size={12} className="text-blue-500" />
                    <span className="text-xs font-semibold text-blue-700">{s.infoCount}</span>
                    <span className="text-[10px] text-blue-500">提示</span>
                  </div>
                  <button className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                    <Eye size={12} /> 详情
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineView({
  gateHistory,
  docTitleById,
  timeFilter,
  onTimeFilterChange,
  formatTime,
}: {
  gateHistory: PipelineGateResult[];
  docTitleById: (id: string) => string;
  timeFilter: 'all' | 'today' | 'week' | 'month';
  onTimeFilterChange: (v: 'all' | 'today' | 'week' | 'month') => void;
  formatTime: (iso: string) => string;
}) {
  const gateStats = useMemo(() => {
    const pass = gateHistory.filter((g) => g.status === 'pass').length;
    const fail = gateHistory.filter((g) => g.status === 'fail').length;
    const warn = gateHistory.filter((g) => g.status === 'warn').length;
    return { pass, fail, warn, total: gateHistory.length };
  }, [gateHistory]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-[#1e3a5f] to-[#2e4e7a] p-6 text-white shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
                <Zap size={20} />
              </div>
              <div>
                <h3 className="text-base font-semibold">流水线合规门控</h3>
                <p className="text-xs opacity-80">Pipeline Compliance Gate</p>
              </div>
            </div>
            <p className="mt-4 max-w-xl text-sm opacity-90 leading-relaxed">
              门控会在文档提交或合并前自动执行合规扫描。若检测到严重违规则直接阻止通过，警告数量超标触发提醒，确保文档始终符合合规标准。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur-sm">
              <p className="text-2xl font-bold">{gateStats.pass}</p>
              <p className="text-[11px] opacity-80">通过</p>
            </div>
            <div className="rounded-xl bg-amber-400/20 px-4 py-3 text-center backdrop-blur-sm">
              <p className="text-2xl font-bold text-amber-200">{gateStats.warn}</p>
              <p className="text-[11px] opacity-80">警告</p>
            </div>
            <div className="rounded-xl bg-red-400/20 px-4 py-3 text-center backdrop-blur-sm">
              <p className="text-2xl font-bold text-red-200">{gateStats.fail}</p>
              <p className="text-[11px] opacity-80">失败</p>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1">
            <CheckCircle size={12} className="text-emerald-300" /> 0严重+少量警告 → Pass
          </span>
          <span className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1">
            <AlertTriangle size={12} className="text-amber-300" /> 警告数超标 → Warn
          </span>
          <span className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1">
            <XCircle size={12} className="text-red-300" /> 存在严重违规 → Fail
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={14} className="text-slate-400" />
          <Select
            value={timeFilter}
            onChange={(v) => onTimeFilterChange(v as typeof timeFilter)}
            options={[
              { value: 'all', label: '全部时间' },
              { value: 'today', label: '今天' },
              { value: 'week', label: '本周' },
              { value: 'month', label: '本月' },
            ]}
          />
          <span className="ml-auto text-xs text-slate-400">
            共 {gateHistory.length} 条门控记录
          </span>
        </div>
      </div>

      {gateHistory.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-16 text-center">
          <Zap size={36} strokeWidth={1.2} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-500">暂无门控历史</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">文档</th>
                  <th className="px-6 py-3 font-medium">门控名</th>
                  <th className="px-6 py-3 font-medium">状态</th>
                  <th className="px-6 py-3 font-medium">时间</th>
                  <th className="px-6 py-3 font-medium">违规统计</th>
                  <th className="px-6 py-3 font-medium">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gateHistory.map((g, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/60">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-slate-400" />
                        <span className="font-medium text-slate-700">{docTitleById(g.docId)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                        <Zap size={11} /> {g.gateName || 'default-gate'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <GateStatusBadge status={g.status} />
                    </td>
                    <td className="px-6 py-3 text-slate-500 text-xs">{formatTime(g.timestamp)}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        {g.criticalCount > 0 && (
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-100 px-2 text-xs font-medium text-red-700">
                            {g.criticalCount} 严重
                          </span>
                        )}
                        {g.warningCount > 0 && (
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-100 px-2 text-xs font-medium text-amber-700">
                            {g.warningCount} 警告
                          </span>
                        )}
                        {g.criticalCount === 0 && g.warningCount === 0 && (
                          <span className="text-xs text-emerald-600">无违规</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <button className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:underline">
                        <Eye size={12} /> 查看
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-xs text-slate-700 focus:border-[#1e3a5f] focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-2.5 text-slate-400" />
    </label>
  );
}

function ScanStatusBadge({ status }: { status: ScanStatus }) {
  const styles: Record<ScanStatus, string> = {
    pending: 'bg-slate-100 text-slate-600',
    running: 'bg-sky-100 text-sky-700',
    completed: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
  };
  const icons: Record<ScanStatus, typeof Shield> = {
    pending: Clock,
    running: RefreshCw,
    completed: CheckCircle,
    failed: XCircle,
  };
  const Icon = icons[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      <Icon size={10} /> {SCAN_STATUS_LABELS[status]}
    </span>
  );
}

function TriggerBadge({ triggeredBy }: { triggeredBy: string }) {
  const t = triggeredBy.toLowerCase();
  let label = triggeredBy;
  let style = 'bg-slate-100 text-slate-600';
  let icon: typeof Shield = Activity;

  if (t === 'manual' || t.includes('manual')) {
    label = 'manual';
    style = 'bg-violet-100 text-violet-700';
    icon = Activity;
  } else if (t === 'system' || t.includes('system') || t === 'monitor') {
    label = 'system';
    style = 'bg-sky-100 text-sky-700';
    icon = RefreshCw;
  } else if (t === 'pipeline' || t.includes('pipeline') || t.includes('gate')) {
    label = 'pipeline';
    style = 'bg-orange-100 text-orange-700';
    icon = Zap;
  }

  const Icon = icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}>
      <Icon size={10} /> {label}
    </span>
  );
}

function GateStatusBadge({ status }: { status: PipelineGateStatus }) {
  const styles: Record<PipelineGateStatus, { bg: string; text: string; icon: typeof Shield }> = {
    pass: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: CheckCircle },
    fail: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
    warn: { bg: 'bg-amber-100', text: 'text-amber-700', icon: AlertTriangle },
  };
  const s = styles[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.bg} ${s.text}`}>
      <Icon size={11} /> {GATE_STATUS_LABELS[status]}
    </span>
  );
}

function formatTimeShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
