import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Menu,
  X,
  ChevronRight,
  BarChart3,
  Users,
  ShieldCheck,
  ArrowRightLeft,
  Target,
  MonitorPlay,
  Lock,
  MoveRight,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { createContactInquiry, type ContactInquiryInput } from '../services/contactService';
import { useToast } from '../contexts/ToastContext';

const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;

// Casas de apostas parceiras (logos em /public/boost-home/partners).
// `size` é a altura por logo (Tailwind) — BetMGM e Lottu têm mais margem dentro
// do arquivo, então precisam de mais altura pra ter o mesmo peso visual.
const partners = [
  { name: 'Superbet', logo: 'boost-home/partners/superbet.webp', size: 'h-14 sm:h-12' },
  { name: 'Betano', logo: 'boost-home/partners/betano.webp', size: 'h-12 sm:h-12' },
  { name: 'BetMGM', logo: 'boost-home/partners/betmgm.webp', size: 'h-20' },
  { name: 'Lottu', logo: 'boost-home/partners/lottu.webp', size: 'h-24' },
];

const emptyForm: ContactInquiryInput = {
  name: '',
  email: '',
  phone: '',
  instagram: '',
  affiliateExperience: 'sim',
  presentation: '',
};

export default function Home() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [form, setForm] = useState<ContactInquiryInput>(emptyForm);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const { push } = useToast();

  const updateField = <K extends keyof ContactInquiryInput>(key: K, value: ContactInquiryInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'submitting') return;

    setStatus('submitting');
    try {
      await createContactInquiry({
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        instagram: form.instagram.trim(),
        presentation: form.presentation.trim(),
      });
      setStatus('success');
      setForm(emptyForm);
      push({ type: 'success', message: 'Aplicação enviada! Nosso time entrará em contato.' });
    } catch (error) {
      console.error('Falha ao enviar aplicação de afiliado', error);
      setStatus('error');
      push({ type: 'error', message: 'Não foi possível enviar. Tente novamente em instantes.' });
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-400 font-sans selection:bg-white selection:text-neutral-950">
      {/* Dynamic background */}
      <div className="fixed inset-0 z-0 pointer-events-none bg-grid-white opacity-[0.03]" />
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-white/5 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-white/5 blur-[120px] pointer-events-none" />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-neutral-950/80 backdrop-blur-md border-b border-neutral-800/50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={asset('boost-home/logo.svg')} alt="Boost" className="h-6 w-auto" />
          </Link>

          <div className="hidden md:flex items-center gap-4">
            <Link
              to="/login"
              className="text-sm font-medium text-white hover:opacity-80 transition-opacity px-4 py-2"
            >
              Entrar
            </Link>
            <Link
              to="/register"
              className="px-6 py-2.5 rounded-full bg-white text-neutral-950 font-bold text-sm hover:bg-neutral-200 transition-colors"
            >
              Cadastrar
            </Link>
          </div>

          <button
            type="button"
            className="md:hidden p-2 text-neutral-400 hover:text-white"
            aria-label="Abrir menu"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden bg-neutral-900 border-b border-neutral-800 overflow-hidden"
            >
              <div className="p-6 flex flex-col gap-4">
                <Link
                  to="/login"
                  className="text-base font-medium py-3 border-b border-neutral-800 text-left text-white"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Entrar
                </Link>
                <Link
                  to="/register"
                  className="mt-2 px-5 py-3 rounded-xl bg-white text-neutral-950 text-center font-bold"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Cadastrar
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <main className="relative z-10 pt-32 pb-16">
        {/* Hero */}
        <section
          id="inicio"
          className="max-w-7xl mx-auto px-6 pt-16 md:pt-24 lg:pt-32 flex flex-col items-center text-center"
        >
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold tracking-tighter text-white max-w-4xl leading-[1.1]"
          >
            Escala inteligente <span className="text-neutral-400">para Afiliados</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-6 text-lg md:text-xl text-neutral-400 max-w-2xl leading-relaxed"
          >
            Conecte-se a um ecossistema com dados, tecnologia e ferramentas que escalam sua
            operação de verdade.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-10 flex flex-col sm:flex-row gap-4"
          >
            <Link
              to="/register"
              className="px-8 py-4 rounded-full bg-white text-neutral-950 font-semibold hover:bg-neutral-200 transition-colors flex items-center justify-center gap-2 shadow-xl shadow-white/10 group"
            >
              Quero ser um Afiliado
              <MoveRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </motion.div>

          {/* Dashboard mockup — real Boost screenshot framed in the designer's chrome */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-24 w-full relative"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-transparent to-transparent z-10 pointer-events-none" />
            <div className="rounded-2xl md:rounded-[2rem] border border-neutral-800/60 bg-neutral-900/50 p-2 md:p-3 backdrop-blur-xl shadow-2xl relative overflow-hidden glow-white">
              <div className="rounded-xl overflow-hidden border border-neutral-700/50 bg-neutral-950">
                <img
                  src={asset('boost-home/dashboard-escuro.jpeg')}
                  alt="Plataforma Boost"
                  className="w-full h-auto block"
                />
              </div>
            </div>
          </motion.div>
        </section>

        {/* Stats */}
        <section className="max-w-7xl mx-auto px-6 py-24 border-b border-neutral-800/50">
          <div className="w-full max-w-[1300px] mx-auto mb-16 text-center">
            <h3 className="text-2xl md:text-3xl font-bold text-white mb-3 flex items-center justify-center">
              Para Afiliados
            </h3>
            <p className="text-lg text-neutral-400">
              que querem escalar com controle, margem e velocidade.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
            <StatCard icon={<Users className="w-6 h-6 text-neutral-400" />} value="+12.000" label="Afiliados" />
            <StatCard
              icon={<MonitorPlay className="w-6 h-6 text-neutral-400" />}
              value="+200k/mês"
              label="Usuários Cadastrados"
            />
            <StatCard
              icon={<ArrowRightLeft className="w-6 h-6 text-neutral-400" />}
              value="+120k/mês"
              label="FTDs"
            />
            <StatCard
              icon={<Target className="w-6 h-6 text-neutral-400" />}
              value="+100k/mês"
              label="CPAs Qualificados"
            />
          </div>
        </section>

        {/* Why migrate */}
        <section id="sobre" className="max-w-7xl mx-auto px-6 py-24 md:py-32">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Afiliados de alta performance <span className="text-neutral-500">estão migrando</span>
            </h2>
            <p className="text-neutral-400 text-lg max-w-2xl mx-auto">
              Operações amadoras perdem dinheiro com ferramentas genéricas. A Boost foi construída
              para quem busca controle absoluto.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12 lg:gap-24 items-center">
            {/* Generic tools */}
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-white/5 border border-white/10 text-neutral-400 text-sm font-semibold uppercase tracking-wider mb-2">
                Ferramentas Genéricas
              </div>
              <ul className="space-y-6">
                {[
                  'Dados fragmentados e não confiáveis',
                  'Baixa flexibilidade para customizar deals',
                  'Decisões lentas por falta de visibilidade',
                  'Dependência de plataformas de terceiros',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-4 text-neutral-500">
                    <div className="w-6 h-6 rounded-full bg-neutral-900 flex items-center justify-center shrink-0 mt-0.5 border border-neutral-800">
                      <X className="w-4 h-4 text-neutral-500" />
                    </div>
                    <span className="text-lg">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Boost standard */}
            <div className="bg-neutral-900 rounded-3xl p-8 lg:p-12 border border-neutral-800 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-white/10 transition-colors duration-500" />

              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-white/5 border border-white/10 text-neutral-200 text-sm font-semibold uppercase tracking-wider mb-8 relative">
                O Padrão Boost
              </div>

              <ul className="space-y-6 relative">
                {[
                  { title: 'Plataforma Própria', desc: 'Sem limitações de ferramentas externas.' },
                  {
                    title: 'Controle Total',
                    desc: 'Você no comando de toda a operação e fluxo de dados.',
                  },
                  { title: 'Decisões Rápidas', desc: 'Aja no momento certo com precisão analítica.' },
                  {
                    title: 'Performance Recompensada',
                    desc: 'Prêmios (Porsche, BMW, Viagens) para top performers.',
                  },
                  { title: 'Account Manager', desc: 'Suporte 24h para apoio estratégico e eficaz.' },
                ].map((item) => (
                  <li key={item.title} className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 mt-0.5 border border-white/10 text-white">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-white">{item.title}</h4>
                      <p className="text-neutral-400 mt-1">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Core features */}
        <section
          id="funcionalidades"
          className="py-24 md:py-32 bg-neutral-900/50 border-y border-neutral-800/50"
        >
          <div className="max-w-7xl mx-auto px-6">
            <div className="max-w-3xl mb-16">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">
                A Boost centraliza seus dados e{' '}
                <span className="text-neutral-500">entrega inteligência</span>
              </h2>
              <p className="text-xl text-neutral-400 leading-relaxed">
                Decisões que realmente impactam o seu resultado só acontecem com as ferramentas
                certas na mão.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
              {/* <FeatureCard
                icon={<Lock className="w-5 h-5 text-neutral-400" />}
                title="Autenticação e Controle de Acesso"
                desc="Segurança avançada com acessos granulares e personalizados."
                image={asset('boost-home/feature-1.webp')}
                delay={0.1}
              />
              <FeatureCard
                icon={<Users className="w-5 h-5 text-neutral-400" />}
                title="Gestão de Usuários"
                desc="Controle total sobre parceiros, sub-afiliados e equipes."
                image={asset('boost-home/feature-2.webp')}
                delay={0.2}
              />
              <FeatureCard
                icon={<BarChart3 className="w-5 h-5 text-neutral-400" />}
                title="Dashboards Otimizados"
                desc="Dados precisos na palma da sua mão, em tempo real, para leitura rápida."
                image={asset('boost-home/feature-3.webp')}
                delay={0.3}
              />
              <FeatureCard
                icon={<ShieldCheck className="w-5 h-5 text-neutral-400" />}
                title="Modo Administrativo Contextual"
                desc="Gestão estratégica focada nos fluxos críticos do iGaming."
                image={asset('boost-home/feature-4.png')}
                delay={0.4}
              /> */}
            </div>
          </div>
        </section>

        {/* Who is this for */}
        <section className="max-w-4xl mx-auto px-6 py-24 md:py-32 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-6">
            Escala real para afiliados de performance.
            <br className="hidden md:block" />
            <span className="text-neutral-500">
              Mais controle, mais clareza e decisões mais rápidas para transformar dados em
              crescimento.
            </span>
          </h2>

          <div className="mt-12 p-8 md:p-12 rounded-3xl bg-gradient-to-br from-neutral-900 to-neutral-900/50 border border-neutral-800 shadow-xl flex flex-col md:flex-row items-center justify-between gap-8 text-left">
            <div>
              <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center mb-6">
                <Target className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Opera com volume significativo?</h3>
              <p className="text-neutral-400">Busca controle, estabilidade e transparência.</p>
            </div>

            <a
              href="#contato"
              className="shrink-0 w-full md:w-auto px-8 py-4 rounded-xl bg-white text-neutral-950 font-bold text-lg text-center hover:bg-neutral-200 transition-transform active:scale-95"
            >
              Aplicar para Parceria
            </a>
          </div>
        </section>

        {/* Application form */}
        {/* <section
          id="contato"
          className="max-w-7xl mx-auto px-6 pt-16 pb-24 border-t border-neutral-800/50"
        >
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24">
            <div>
              <img
                src={asset('boost-home/logo.svg')}
                alt="Boost"
                className="h-9 w-auto mb-8"
              />
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
                Seja agora um
                <br />
                <span className="text-white">Afiliado Boost</span>
              </h2>
              <p className="text-lg text-neutral-400 mb-8 max-w-md">
                Nosso time analisará o seu perfil. Preencha os dados abaixo e entraremos em contato
                se houver fit.
              </p>
            </div>

            <div className="bg-neutral-900/50 rounded-3xl border border-neutral-800 p-8 pt-10 relative overflow-hidden backdrop-blur-sm">
              {status === 'success' ? (
                <div className="flex flex-col items-center justify-center text-center min-h-[420px] gap-5">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Aplicação enviada!</h3>
                  <p className="text-neutral-400 max-w-sm">
                    Recebemos os seus dados. Nosso time vai analisar o seu perfil e entrar em
                    contato se houver fit.
                  </p>
                  <button
                    type="button"
                    onClick={() => setStatus('idle')}
                    className="mt-2 text-sm font-medium text-white hover:opacity-80 transition-opacity"
                  >
                    Enviar outra aplicação
                  </button>
                </div>
              ) : (
                <form className="space-y-5" onSubmit={handleSubmit}>
                  <Field label="Nome Completo">
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      placeholder="Seu nome"
                      className={inputClass}
                    />
                  </Field>

                  <Field label="E-mail Profissional">
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => updateField('email', e.target.value)}
                      placeholder="nome@email.com"
                      className={inputClass}
                    />
                  </Field>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Field label="Telefone / WhatsApp">
                      <input
                        type="tel"
                        required
                        value={form.phone}
                        onChange={(e) => updateField('phone', e.target.value)}
                        placeholder="(00) 00000-0000"
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Instagram">
                      <input
                        type="text"
                        value={form.instagram}
                        onChange={(e) => updateField('instagram', e.target.value)}
                        placeholder="@seuperfil"
                        className={inputClass}
                      />
                    </Field>
                  </div>

                  <Field label="Você já trabalha no mercado de afiliação?">
                    <select
                      value={form.affiliateExperience}
                      onChange={(e) =>
                        updateField('affiliateExperience', e.target.value as 'sim' | 'nao')
                      }
                      className={cn(inputClass, 'appearance-none')}
                    >
                      <option value="sim">Sim, já trabalho</option>
                      <option value="nao">Não, quero começar</option>
                    </select>
                  </Field>

                  <Field label="Apresente-se">
                    <textarea
                      rows={4}
                      required
                      value={form.presentation}
                      onChange={(e) => updateField('presentation', e.target.value)}
                      placeholder="Conte-nos sobre sua operação, volume atual de FTDs, focos de tráfego..."
                      className={cn(inputClass, 'resize-none')}
                    />
                  </Field>

                  {status === 'error' && (
                    <p className="text-sm font-medium text-red-400">
                      Não foi possível enviar a sua aplicação. Tente novamente.
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={status === 'submitting'}
                    className="w-full px-8 py-4 rounded-xl bg-white text-neutral-950 font-bold text-lg hover:bg-neutral-200 transition-colors flex justify-center items-center gap-2 mt-4 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {status === 'submitting' ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      'Quero fazer parte'
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </section> */}

        {/* Casas de apostas parceiras */}
        <section className="max-w-7xl mx-auto px-6 py-24 border-t border-neutral-800/50">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">
              Casas de apostas parceiras
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-8 sm:gap-x-6 max-w-6xl mx-auto">
            {partners.map((partner, i) => (
              <motion.div
                key={partner.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex items-center justify-center"
              >
                <img
                  src={asset(partner.logo)}
                  alt={partner.name}
                  loading="lazy"
                  className={`${partner.size} w-auto object-contain`}
                />
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-neutral-800/50 bg-neutral-900/30">
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <img src={asset('boost-home/logo.svg')} alt="Boost" className="h-6 w-auto opacity-80" />
            <span className="font-display font-medium text-sm text-neutral-500">
              &copy; {new Date().getFullYear()} Boost
            </span>
          </div>

          <div className="flex gap-6 text-sm text-neutral-500">
            <Link to="/login" className="hover:text-white transition-colors">
              Entrar
            </Link>
            <Link to="/register" className="hover:text-white transition-colors">
              Cadastrar
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

const inputClass =
  'w-full px-4 py-3 rounded-xl bg-neutral-950/50 border border-neutral-800 focus:border-white focus:ring-1 focus:ring-white outline-none transition-all text-white placeholder:text-neutral-600';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-neutral-300">{label}</label>
      {children}
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="flex flex-col gap-3 p-6 rounded-2xl bg-neutral-900/50 border border-neutral-800/50 group hover:border-neutral-700 hover:bg-neutral-800/50 transition-all"
    >
      <div className="w-12 h-12 rounded-xl bg-neutral-800/50 flex items-center justify-center border border-neutral-700/50 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div>
        <div className="text-3xl font-display font-bold text-white mb-1">{value}</div>
        <div className="text-sm text-neutral-400 font-medium">{label}</div>
      </div>
    </motion.div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
  image,
  delay,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  image: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay }}
      className="rounded-3xl bg-neutral-900 border border-neutral-800 hover:border-neutral-700 transition-colors flex flex-col h-full group overflow-hidden"
    >
      <div className="p-8 pb-6">
        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-6 group-hover:bg-white/10 transition-colors border border-white/5">
          {icon}
        </div>
        <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
        <p className="text-neutral-400 leading-relaxed">{desc}</p>
      </div>
      <div className="mt-auto px-8">
        <div className="rounded-t-xl border-x border-t border-neutral-800/60 bg-neutral-950/40 overflow-hidden">
          <img
            src={image}
            alt={title}
            loading="lazy"
            className="w-full h-44 object-cover object-top opacity-90 group-hover:opacity-100 transition-opacity"
          />
        </div>
      </div>
    </motion.div>
  );
}
