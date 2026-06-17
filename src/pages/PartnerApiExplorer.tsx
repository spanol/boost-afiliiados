import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  KeyRound, Send, Loader2, Copy, Check, ShieldCheck, AlertTriangle, Plug, Clock, Hash,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { getDefaultRange } from '../lib/dateRange';
import { collectFields, findMonetaryFields, PARTNER_RESULT_MONETARY_FIELDS } from '../lib/partnerResults';

// Ferramenta INTERNA (admin) p/ exercitar a API do parceiro (/api/partner/v1).
// Dispara as rotas com a API key da Boost, mostra a resposta e — o ponto central —
// AUDITA os campos retornados pra provar pro Carlos que só saem os dados liberados
// (cadastro/depósitos/CPA em contagem; nada de valores R$). Não é a view do parceiro;
// é o nosso painel de verificação. Ver PARTNER-API.md e src/lib/partnerResults.ts.

type EndpointId = 'pending-affiliates' | 'affiliates' | 'results';

const ENDPOINTS: { id: EndpointId; label: string; scope: string; desc: string }[] = [
  { id: 'pending-affiliates', label: 'Pendentes', scope: 'pending-affiliates', desc: 'Aprovados na OTG aguardando produção (dado-chave).' },
  { id: 'affiliates', label: 'Afiliados', scope: 'affiliates', desc: 'Reconciliados/ativos (id, nome, marca, link).' },
  { id: 'results', label: 'Resultados', scope: 'results', desc: 'Produção agregada — SÓ contagem, nada de R$.' },
];

const COUNT_FIELDS = ['registrations', 'first_deposits', 'qualified_cpa'];
const KEY_STORAGE = 'boost_partner_api_key';

export default function PartnerApiExplorer() {
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem(KEY_STORAGE) || '');
  const [showKey, setShowKey] = useState(false);
  const [endpoint, setEndpoint] = useState<EndpointId>('pending-affiliates');

  // params por rota
  const [status, setStatus] = useState<'' | 'pending' | 'reconciled'>('');
  const [house, setHouse] = useState('');
  const def = useMemo(() => getDefaultRange(), []);
  const [startDate, setStartDate] = useState(def.startDate);
  const [endDate, setEndDate] = useState(def.endDate);
  const [groupBy, setGroupBy] = useState<'affiliate' | 'brand' | 'date' | 'campaign'>('affiliate');
  const [affiliateIds, setAffiliateIds] = useState('');

  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<null | {
    ok: boolean; statusCode: number; ms: number; body: any; error?: string;
  }>(null);

  // monta a query string conforme a rota selecionada
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (endpoint === 'pending-affiliates') {
      if (status) p.set('status', status);
      if (house.trim()) p.set('house', house.trim());
    } else if (endpoint === 'results') {
      p.set('startDate', startDate);
      p.set('endDate', endDate);
      p.set('groupBy', groupBy);
      if (affiliateIds.trim()) p.set('affiliateIds', affiliateIds.trim());
    }
    return p.toString();
  }, [endpoint, status, house, startDate, endDate, groupBy, affiliateIds]);

  const path = `/api/partner/v1/${endpoint}${query ? `?${query}` : ''}`;
  const curl = `curl -H "x-boost-api-key: ${apiKey || '<SUA_KEY>'}" \\\n  "${window.location.origin}${path}"`;

  const send = async () => {
    if (!apiKey.trim()) return;
    localStorage.setItem(KEY_STORAGE, apiKey.trim());
    setLoading(true);
    setResult(null);
    const t0 = performance.now();
    try {
      const resp = await fetch(path, { headers: { 'x-boost-api-key': apiKey.trim(), Accept: 'application/json' } });
      const ms = Math.round(performance.now() - t0);
      const text = await resp.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      setResult({ ok: resp.ok, statusCode: resp.status, ms, body });
    } catch (e: any) {
      setResult({ ok: false, statusCode: 0, ms: Math.round(performance.now() - t0), body: null, error: e?.message || 'Falha de rede' });
    } finally {
      setLoading(false);
    }
  };

  const copyCurl = async () => {
    try { await navigator.clipboard.writeText(curl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  };

  // auditoria da resposta
  const rows: any[] = Array.isArray(result?.body?.data) ? result!.body.data : [];
  const fields = useMemo(() => collectFields(rows), [rows]);
  const monetary = useMemo(() => findMonetaryFields(rows), [rows]);
  const hasData = result?.ok && rows.length > 0;

  return (
    <div className="space-y-6 pb-20 max-w-5xl">
      <header>
        <span className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-slate-900/5 dark:bg-white/5 border border-slate-900/10 dark:border-white/10 text-slate-500 dark:text-neutral-300 text-[10px] font-bold uppercase tracking-widest">
          <Plug size={12} /> Ferramenta interna
        </span>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tighter">API do Parceiro · Explorer</h1>
        <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2 max-w-2xl">
          Dispare as rotas abertas ao parceiro e confira a resposta. A auditoria de campos prova que
          só saem os dados liberados — <strong>cadastro, depósitos e CPA em contagem; nada de valores (R$)</strong>.
        </p>
      </header>

      {/* API key */}
      <section className="p-5 rounded-2xl border bg-white dark:bg-neutral-900/60 border-slate-200/70 dark:border-neutral-800 shadow-sm">
        <label className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-2">
          <KeyRound size={13} /> API key do parceiro (x-boost-api-key)
        </label>
        <div className="flex gap-2">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="bsk_..."
            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/60 text-sm text-slate-900 dark:text-white font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
          <button onClick={() => setShowKey((v) => !v)} className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-neutral-700 text-xs font-bold text-slate-500 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/5">
            {showKey ? 'Ocultar' : 'Ver'}
          </button>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-neutral-500 mt-2">
          A key é guardada só neste navegador (localStorage). Gere uma com{' '}
          <code className="font-mono bg-slate-100 dark:bg-neutral-800 px-1 rounded">node scripts/partners/create-partner.mjs "Nome" *</code>.
        </p>
      </section>

      {/* Endpoint + params */}
      <section className="p-5 rounded-2xl border bg-white dark:bg-neutral-900/60 border-slate-200/70 dark:border-neutral-800 shadow-sm space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {ENDPOINTS.map((ep) => (
            <button
              key={ep.id}
              onClick={() => { setEndpoint(ep.id); setResult(null); }}
              className={cn(
                'p-3 rounded-xl border text-left transition-all',
                endpoint === ep.id
                  ? 'bg-amber-500/15 border-amber-500/40 shadow-sm'
                  : 'border-slate-200 dark:border-neutral-700 hover:bg-slate-50 dark:hover:bg-white/5'
              )}
            >
              <p className={cn('text-sm font-bold', endpoint === ep.id ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-neutral-200')}>{ep.label}</p>
              <p className="text-[10px] text-slate-400 dark:text-neutral-500 mt-0.5 leading-tight">{ep.desc}</p>
            </button>
          ))}
        </div>

        {/* params dinâmicos */}
        {endpoint === 'pending-affiliates' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="status (opcional)">
              <select value={status} onChange={(e) => setStatus(e.target.value as any)} className={inputCls}>
                <option value="">todos</option>
                <option value="pending">pending</option>
                <option value="reconciled">reconciled</option>
              </select>
            </Field>
            <Field label="house (opcional)">
              <input value={house} onChange={(e) => setHouse(e.target.value)} placeholder="Superbet" className={inputCls} />
            </Field>
          </div>
        )}
        {endpoint === 'results' && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="startDate*"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></Field>
            <Field label="endDate*"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} /></Field>
            <Field label="groupBy">
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)} className={inputCls}>
                <option value="affiliate">affiliate</option>
                <option value="brand">brand</option>
                <option value="date">date</option>
                <option value="campaign">campaign</option>
              </select>
            </Field>
            <Field label="affiliateIds (csv)"><input value={affiliateIds} onChange={(e) => setAffiliateIds(e.target.value)} placeholder="id1,id2" className={inputCls} /></Field>
          </div>
        )}
        {endpoint === 'affiliates' && (
          <p className="text-xs text-slate-400 dark:text-neutral-500">Sem parâmetros — retorna todos os reconciliados.</p>
        )}

        {/* cURL preview + enviar */}
        <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-950/60 p-3 relative">
          <button onClick={copyCurl} className="absolute top-2 right-2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10" title="Copiar cURL">
            {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
          </button>
          <pre className="text-[11px] font-mono text-slate-600 dark:text-neutral-300 whitespace-pre-wrap break-all pr-8">{curl}</pre>
        </div>

        <button
          onClick={send}
          disabled={loading || !apiKey.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-900 dark:bg-amber-500 text-white dark:text-neutral-950 text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {loading ? 'Enviando...' : 'Enviar requisição'}
        </button>
      </section>

      {/* Resposta */}
      {result && (
        <motion.section
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="p-5 rounded-2xl border bg-white dark:bg-neutral-900/60 border-slate-200/70 dark:border-neutral-800 shadow-sm space-y-4"
        >
          {/* status bar */}
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn('px-2.5 py-1 rounded-full text-xs font-bold border', result.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400')}>
              HTTP {result.statusCode || '—'}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-neutral-400"><Clock size={13} /> {result.ms} ms</span>
            {result.ok && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-neutral-400"><Hash size={13} /> {result.body?.total ?? rows.length} itens</span>}
          </div>

          {result.error && <p className="text-sm text-red-600 dark:text-red-400">{result.error}</p>}
          {!result.ok && result.body?.error && <p className="text-sm text-red-600 dark:text-red-400">{result.body.error}</p>}

          {/* AUDITORIA — o ponto pro Carlos */}
          {result.ok && (
            monetary.length === 0 ? (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40">
                <ShieldCheck size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Sem valores monetários (R$)</p>
                  <p className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70">A resposta traz só contagem e identidade — nenhum dos campos de valor da OTG.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-red-50/70 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/40">
                <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-700 dark:text-red-400">Valor monetário detectado!</p>
                  <p className="text-[11px] text-red-700/80 dark:text-red-400/80">Campos proibidos na resposta: {monetary.join(', ')}. Não deveria acontecer — revisar projeção no servidor.</p>
                </div>
              </div>
            )
          )}

          {/* chips de campos */}
          {hasData && (
            <div>
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-2">Campos retornados</p>
              <div className="flex flex-wrap gap-1.5">
                {fields.map((f) => {
                  const isMoney = PARTNER_RESULT_MONETARY_FIELDS.includes(f);
                  const isCount = COUNT_FIELDS.includes(f);
                  return (
                    <span key={f} className={cn(
                      'px-2 py-0.5 rounded-md text-[11px] font-mono border',
                      isMoney ? 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                        : isCount ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        : 'bg-slate-100 dark:bg-neutral-800 border-slate-200 dark:border-neutral-700 text-slate-500 dark:text-neutral-400'
                    )}>{f}</span>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400 dark:text-neutral-500 mt-2">
                <span className="text-emerald-500 font-bold">verde</span> = métrica de contagem ·{' '}
                <span className="text-slate-400 font-bold">cinza</span> = identidade/dimensão ·{' '}
                <span className="text-red-500 font-bold">vermelho</span> = valor (não deveria aparecer)
              </p>
            </div>
          )}

          {/* JSON cru */}
          <div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-2">Resposta (JSON)</p>
            <pre className="text-[11px] font-mono text-slate-700 dark:text-neutral-300 bg-slate-50 dark:bg-neutral-950/60 border border-slate-200 dark:border-neutral-800 rounded-xl p-3 max-h-[460px] overflow-auto">
              {JSON.stringify(result.body, null, 2)}
            </pre>
          </div>
        </motion.section>
      )}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/60 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/40';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
