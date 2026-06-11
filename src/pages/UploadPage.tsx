import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, ArrowRight, Shield, Gauge } from 'lucide-react';
import { documentsApi, complianceApi } from '../utils/api';
import type { DocumentMeta } from '../types';
import { FileUpload } from '../components/FileUpload';
import { DocumentList } from '../components/DocumentList';

export function UploadPage() {
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    const list = await documentsApi.list();
    setDocs(list);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleUploaded = async (doc: DocumentMeta) => {
    setDocs((prev) => [doc, ...prev]);
    setTimeout(async () => {
      try {
        await complianceApi.scan.trigger(doc.id, 'upload-auto');
      } catch {
        // ignore
      }
    }, 500);
  };

  const handleDeleted = (id: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
  };

  const handleShareGenerated = (id: string, token: string) => {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, shareToken: token } : d)));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-[#1e3a5f]/5">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1e3a5f] text-white">
              <FileText size={18} strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-900">文档协作审阅</h1>
              <p className="text-xs text-slate-500">Document Review Studio</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/compliance"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
            >
              <Shield size={14} />
              合规中心
            </Link>
            <Link
              to="/compliance/dashboard"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1e3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2e4e7a] transition-colors"
            >
              <Gauge size={14} />
              合规仪表盘
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-10">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">上传文档</h2>
              <p className="mt-1 text-sm text-slate-500">上传 Word 或 Markdown 文档，生成分享链接邀请审阅者 · 上传后自动执行合规检查</p>
            </div>
          </div>
          <FileUpload onUploaded={handleUploaded} />
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">我的文档</h2>
              <p className="mt-1 text-sm text-slate-500">
                共 {docs.length} 个文档 · 支持合规扫描和流水线门禁检查
              </p>
            </div>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
              加载中…
            </div>
          ) : (
            <DocumentList
              documents={docs}
              onDeleted={handleDeleted}
              onShareGenerated={handleShareGenerated}
            />
          )}
        </section>

        <section className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-4">
          {[
            {
              title: '上传解析',
              desc: '支持 Markdown 与 Word (.docx)，自动拆分为结构化段落',
              icon: FileText,
            },
            {
              title: '逐段批注',
              desc: '审阅者在浏览器中点击段落即可添加意见或建议修改',
              icon: MessageSquare,
            },
            {
              title: '合规检查',
              desc: '预置隐私/合同/技术等多类规则，支持正则、AST和自定义脚本检测',
              icon: Shield,
            },
            {
              title: '流水线门禁',
              desc: '严重违规阻断发布流程，支持持续监控和合规报告导出',
              icon: Gauge,
            },
          ].map((x, i) => (
            <div
              key={x.title}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f]">
                <x.icon size={16} />
              </div>
              <div className="mb-1 text-xs font-semibold text-slate-400">0{i + 1}</div>
              <h3 className="mb-1 text-sm font-semibold text-slate-900">{x.title}</h3>
              <p className="text-sm leading-relaxed text-slate-500">{x.desc}</p>
              <div className="mt-3 inline-flex items-center text-xs text-slate-400 group-hover:text-[#1e3a5f]">
                了解更多 <ArrowRight size={12} className="ml-0.5" />
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

function MessageSquare(props: { size?: number; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={props.size || 24} height={props.size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={props.strokeWidth || 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
