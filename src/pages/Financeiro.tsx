import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Wallet, Save, Loader2, KeyRound, FileText, MapPin, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { fetchMyPaymentProfile, saveMyPaymentProfile, PaymentProfile } from '../services/affiliateService';

const PIX_TYPES = [
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'E-mail' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'aleatoria', label: 'Chave aleatória' },
];

// B4 · Dados de pagamento do afiliado. O próprio afiliado preenche o PIX e os
// dados pra emissão de nota fiscal (CPF/CNPJ, razão social, endereço). O admin
// só visualiza (na página do afiliado). Saldo/saque real ainda dependem da OTG
// liberar a API v1 (payment-cycle) — por isso esta tela é só a coleta por ora.
export default function Financeiro() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PaymentProfile>({
    pixKeyType: 'cpf',
    pixKey: '',
    documentType: 'cpf',
    document: '',
    legalName: '',
    address: '',
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await fetchMyPaymentProfile();
        if (active && data) {
          setForm((prev) => ({
            pixKeyType: data.pixKeyType || prev.pixKeyType,
            pixKey: data.pixKey || '',
            documentType: data.documentType || 'cpf',
            document: data.document || '',
            legalName: data.legalName || '',
            address: data.address || '',
          }));
        }
      } catch (err) {
        console.error('Erro ao carregar dados de pagamento:', err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const set = (field: keyof PaymentProfile, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!form.pixKey?.trim()) {
      push({ type: 'error', message: 'Informe a chave PIX.' });
      return;
    }
    setSaving(true);
    try {
      await saveMyPaymentProfile(form);
      push({ type: 'success', message: 'Dados de pagamento salvos.' });
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  // Tela exclusiva do afiliado (tem affiliateId). Admin não usa esta coleta.
  if (profile && profile.role === 'admin') return <Navigate to="/admin" replace />;
  if (profile && !profile.affiliateId) return <Navigate to="/profile" replace />;

  const inputCls =
    'w-full px-3 py-2.5 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white';
  const labelCls = 'text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest mb-1.5 block';

  return (
    <div className="space-y-8 pb-20 max-w-3xl">
      <header>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 mb-3 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest">
          <Wallet size={12} /> Financeiro
        </span>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter">Dados de Pagamento</h1>
        <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2 max-w-xl">
          Cadastre sua chave PIX e os dados para emissão de nota fiscal. É por aqui que a agência realiza seus repasses.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={32} className="text-amber-500 animate-spin" />
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-neutral-900/60 border border-slate-200/70 dark:border-neutral-800 rounded-3xl shadow-sm p-6 md:p-8 space-y-8"
        >
          {/* PIX */}
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <KeyRound size={16} className="text-amber-500" /> Recebimento (PIX)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Tipo de chave</label>
                <select value={form.pixKeyType} onChange={(e) => set('pixKeyType', e.target.value)} className={inputCls}>
                  {PIX_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Chave PIX</label>
                <input value={form.pixKey} onChange={(e) => set('pixKey', e.target.value)} placeholder="Sua chave PIX" className={inputCls} />
              </div>
            </div>
          </section>

          {/* Dados fiscais / NF */}
          <section className="space-y-4 pt-2 border-t border-slate-100 dark:border-neutral-800">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <FileText size={16} className="text-amber-500" /> Dados para nota fiscal
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Tipo de documento</label>
                <select value={form.documentType} onChange={(e) => set('documentType', e.target.value)} className={inputCls}>
                  <option value="cpf">CPF</option>
                  <option value="cnpj">CNPJ</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>{form.documentType === 'cnpj' ? 'CNPJ' : 'CPF'}</label>
                <input value={form.document} onChange={(e) => set('document', e.target.value)} placeholder={form.documentType === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00'} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{form.documentType === 'cnpj' ? 'Razão social' : 'Nome completo'}</label>
              <input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder={form.documentType === 'cnpj' ? 'Razão social da empresa' : 'Seu nome completo'} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}><MapPin size={11} className="inline -mt-0.5 mr-1" />Endereço</label>
              <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Rua, número, bairro, cidade/UF" className={inputCls} />
            </div>
          </section>

          <div className="flex items-center justify-between gap-4 pt-2">
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-neutral-500">
              <ShieldCheck size={13} className="text-emerald-500" /> Seus dados ficam protegidos e visíveis só pra você e a agência.
            </p>
            <button
              onClick={handleSave}
              disabled={saving}
              className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-full bg-amber-500 text-white text-xs font-bold hover:bg-amber-400 transition-all shadow-sm shadow-amber-500/20 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Salvar dados
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
