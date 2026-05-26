import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { createContactInquiry } from '../services/contactService';

const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
type DashboardTab = 'desktop' | 'mobile';
type ContactFormData = {
  name: string;
  email: string;
  phone: string;
  instagram: string;
  affiliateExperience: 'sim' | 'nao' | '';
  presentation: string;
};
type ContactFormErrors = Partial<Record<keyof ContactFormData, string>>;

const initialContactForm: ContactFormData = {
  name: '',
  email: '',
  phone: '',
  instagram: '',
  affiliateExperience: '',
  presentation: '',
};

const stats = [
  {
    icon: asset('/boost-home/stat-icon-1-fill.svg'),
    mask: true,
    value: '+12.000',
    label: 'Afiliados',
  },
  {
    icon: asset('/boost-home/stat-icon-2-fill.svg'),
    mask: true,
    value: '+200.000 / Mês',
    label: 'Usuários cadastrados',
  },
  {
    icon: asset('/boost-home/stat-icon-3.svg'),
    value: '+120.000 / Mês',
    label: 'FTDs',
  },
  {
    icon: asset('/boost-home/stat-icon-4.svg'),
    value: '+100.000 / Mês',
    label: 'CPAs qualificados',
  },
];

const genericPainPoints = [
  'Dados fragmentados',
  'Baixa flexibilidade',
  'Dependência de terceiros',
  'Decisões lentas',
];

const boostAdvantages = [
  {
    title: 'Deals',
    description: 'Os melhores deals do mercado brasileiro.',
  },
  {
    title: 'Plataforma própria',
    description: 'Sem limitações de ferramentas externas.',
  },
  {
    title: 'Controle total',
    description: 'Você no comando de toda a operação.',
  },
  {
    title: 'Decisões rápidas',
    description: 'Aja no momento certo, com precisão.',
  },
  {
    title: 'Account manager',
    description: 'Suporte 24h para apoio estratégico, rapido e eficaz.',
  },
  {
    title: 'Performance recompensada',
    description: 'Prêmios como Porche, BMW, Viagens entre outros.',
  },
];

const featureCards = [
  {
    title: ['Autenticação e', 'Controle de Acesso'],
    description: ['Segurança com', 'acessos personalizados.'],
    image: asset('/boost-home/feature-1.webp'),
    imageClassName: 'w-[366px]',
    containerClassName:
      'justify-between bg-[radial-gradient(circle_at_top_left,_#cfddf6_0%,_#98aed4_50%,_#607eb2_100%)] pb-[71px]',
  },
  {
    title: ['Gestão de', 'Usuários'],
    description: ['Controle total de', 'parceiros e equipes.'],
    image: asset('/boost-home/feature-2.webp'),
    imageClassName: 'absolute bottom-[-2px] right-0 w-[409px]',
    containerClassName:
      'overflow-hidden bg-[radial-gradient(circle_at_top_left,_#cfddf6_0%,_#98aed4_50%,_#607eb2_100%)]',
  },
  {
    title: ['Tenha Dashboards', 'Otimizados'],
    description: ['Dados na palma da sua', 'mão para decisões rápidas.'],
    image: asset('/boost-home/feature-3.webp'),
    imageClassName: 'absolute bottom-[-2px] right-0 w-[500px]',
    containerClassName:
      'overflow-hidden bg-[radial-gradient(circle_at_top_left,_#cfddf6_0%,_#98aed4_50%,_#607eb2_100%)]',
  },
  {
    title: ['Modo Administrativo', 'Contextual'],
    description: ['Gestão estratégica', 'da operação.'],
    image: asset('/boost-home/feature-4.webp'),
    imageClassName: 'absolute bottom-0 left-[77px] w-[375px]',
    containerClassName:
      'overflow-hidden bg-[radial-gradient(circle_at_top_left,_#cfddf6_0%,_#98aed4_50%,_#607eb2_100%)]',
  },
];

const qualificationItems = [
  ['Opera com volume', 'significativo.'],
  ['Busca controle', 'e transparência.'],
  ['Quer escalar', 'com inteligência.'],
];

const footerLinksLeft = [
  { label: 'Sobre', href: '#sobre' },
  { label: 'Plataforma', href: '#plataforma' },
];

const footerLinksRight = [
  { label: 'Funcionalidades', href: '#funcionalidades' },
  { label: 'Contato', href: '#contato' },
];

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);

  if (digits.length <= 2) {
    return digits ? `(${digits}` : '';
  }

  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }

  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatInstagram(value: string) {
  const cleaned = value.replace(/\s+/g, '').replace(/[^a-zA-Z0-9._@]/g, '');
  const withoutAt = cleaned.replace(/^@+/, '').slice(0, 30);

  return withoutAt ? `@${withoutAt}` : '';
}

function validateContactForm(form: ContactFormData) {
  const errors: ContactFormErrors = {};
  const trimmedName = form.name.trim();
  const trimmedEmail = form.email.trim();
  const phoneDigits = form.phone.replace(/\D/g, '');
  const trimmedInstagram = form.instagram.trim();
  const trimmedPresentation = form.presentation.trim();

  if (trimmedName.length < 3) {
    errors.name = 'Informe seu nome completo.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.email = 'Digite um e-mail valido.';
  }

  if (phoneDigits.length < 10 || phoneDigits.length > 11) {
    errors.phone = 'Digite um telefone com DDD valido.';
  }

  if (!/^@[a-zA-Z0-9._]{2,30}$/.test(trimmedInstagram)) {
    errors.instagram = 'Informe um Instagram valido, como @seuperfil.';
  }

  if (!form.affiliateExperience) {
    errors.affiliateExperience = 'Selecione uma opcao.';
  }

  if (trimmedPresentation.length < 20) {
    errors.presentation = 'Conte um pouco mais sobre sua operacao.';
  }

  return errors;
}

function SectionTag({ children, dark = false }: { children: string; dark?: boolean }) {
  return (
    <div
      className={[
        'rounded-[24px] border px-[17px] py-[9px] text-center text-[12px] leading-[18px]',
        dark
          ? 'border-white/5 bg-[#210e1a] text-white'
          : 'border-white/10 bg-gradient-to-b from-transparent to-white/10 text-white',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

function WhiteButton({
  children,
  to,
  href,
  className = '',
}: {
  children: ReactNode;
  to?: string;
  href?: string;
  className?: string;
}) {
  const classes =
    'inline-flex items-center justify-center rounded-[8px] border border-white bg-gradient-to-b from-white to-[#bbc9e2] px-[17px] py-[13px] text-[14px] font-medium leading-[14px] text-black';

  if (to) {
    return (
      <Link to={to} className={`${classes} ${className}`.trim()}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} className={`${classes} ${className}`.trim()}>
      {children}
    </a>
  );
}

export default function Home() {
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('desktop');
  const [contactForm, setContactForm] = useState<ContactFormData>(initialContactForm);
  const [contactErrors, setContactErrors] = useState<ContactFormErrors>({});
  const [contactStatus, setContactStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmittingContact, setIsSubmittingContact] = useState(false);

  const handleContactFieldChange = (
    field: keyof ContactFormData,
    value: string,
  ) => {
    const formattedValue =
      field === 'phone'
        ? formatPhone(value)
        : field === 'instagram'
          ? formatInstagram(value)
          : value;

    setContactForm((current) => ({
      ...current,
      [field]: formattedValue as ContactFormData[keyof ContactFormData],
    }));

    setContactErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });

    if (contactStatus) {
      setContactStatus(null);
    }
  };

  const handleContactBlur = (field: keyof ContactFormData) => {
    const validation = validateContactForm(contactForm);

    setContactErrors((current) => {
      const next = { ...current };

      if (validation[field]) {
        next[field] = validation[field];
      } else {
        delete next[field];
      }

      return next;
    });
  };

  const handleContactSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validation = validateContactForm(contactForm);
    if (Object.keys(validation).length > 0) {
      setContactErrors(validation);
      setContactStatus({
        type: 'error',
        message: 'Revise os campos destacados para enviar seu contato.',
      });
      return;
    }

    try {
      setIsSubmittingContact(true);
      setContactStatus(null);

      await createContactInquiry({
        name: contactForm.name.trim(),
        email: contactForm.email.trim().toLowerCase(),
        phone: contactForm.phone,
        instagram: contactForm.instagram.trim(),
        affiliateExperience: contactForm.affiliateExperience as 'sim' | 'nao',
        presentation: contactForm.presentation.trim(),
      });

      setContactForm(initialContactForm);
      setContactErrors({});
      setContactStatus({
        type: 'success',
        message: 'Recebemos seu contato. Nosso time vai analisar seu perfil e retornar em breve.',
      });
    } catch (error) {
      console.error('Error submitting contact form:', error);
      setContactStatus({
        type: 'error',
        message: 'Nao foi possivel enviar agora. Tente novamente em instantes.',
      });
    } finally {
      setIsSubmittingContact(false);
    }
  };

  return (
    <div id="top" className="min-h-screen bg-[#050c1a] text-white">
      <header className="sticky top-0 z-50 border-b border-white/8 bg-[#141c2a]">
        <div className="mx-auto flex h-[70px] w-full max-w-[1048px] items-center justify-between gap-8 px-6 xl:px-0">
          <img
            src={asset('/boost-home/logo.svg')}
            alt="Boost"
            className="h-[24.67px] w-[99.73px] shrink-0"
          />

          <nav className="hidden items-center gap-[42px] text-[14px] font-medium leading-[21px] text-white lg:flex">
            <a href="#sobre">Sobre</a>
            <a href="#plataforma">Plataforma</a>
            <a href="#funcionalidades">Funcionalidades</a>
            <a href="#contato">Contato</a>
          </nav>

          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="rounded-[8px] border border-white/10 bg-gradient-to-b from-transparent to-white/10 px-[17px] py-[13.5px] text-center text-[12px] leading-[18px] text-white"
            >
              ENTRAR
            </Link>
            <WhiteButton to="/register">CADASTRAR</WhiteButton>
          </div>
        </div>
      </header>

      <main>
        <section className="px-6 pt-[53px] xl:px-0">
          <div className="mx-auto max-w-[1140px]">
            <div className="flex flex-col items-center pt-[62px] text-center">
              <div className="mb-10">
                <SectionTag>A Plataforma de Afiliados da Boost</SectionTag>
              </div>

              <h1 className="text-[42px] font-medium leading-[1.1] tracking-[-1.6px] sm:text-[56px] xl:text-[70px] xl:leading-[80.5px]">
                Seja um Afiliado Boost
              </h1>

              <p className="mt-10 max-w-[614px] text-[18px] leading-[1.5] text-[#b4bcd0] sm:text-[21px] sm:leading-[31.5px]">
                Acesso ao melhor <strong>ecossistema</strong>, aos melhores{' '}
                <strong>Deals</strong>, controle total dos seus dados e ferramentas para
                escalar sem limite.
              </p>

              <WhiteButton href="#contato" className="mt-10 gap-2">
                <img
                  src={asset('/boost-home/hero-arrow.svg')}
                  alt=""
                  className="h-[14.02px] w-[14.24px]"
                />
                Quero ser um Afiliado
              </WhiteButton>
            </div>

            <div id="plataforma" className="mt-[158px]">
              <img
                src={asset('/boost-home/hero-platform.webp')}
                alt="Plataforma Boost"
                className="mx-auto w-full max-w-[1048px]"
              />
            </div>
          </div>
        </section>

        <section className="px-6 py-[109px] xl:px-0">
          <div className="mx-auto max-w-[1200px]">
            <div className="text-center">
              <p className="text-[21px] font-bold leading-[29.4px]">
                Para afiliados
                <br />
                <span className="font-normal text-[#b4bcd0]">
                  que precisam de mais controle, margem e velocidade.
                </span>
              </p>
            </div>

            <div className="mt-[70px] grid border-t border-[#333] md:grid-cols-4">
              {stats.map((stat, index) => (
                <div
                  key={stat.label}
                  className={[
                    'px-3 py-[25px] text-center',
                    index === 1 ? 'border-x border-[#cfdDF6]/10' : '',
                    index === 2 ? 'border-r border-[#cfdDF6]/10' : '',
                  ].join(' ')}
                >
                  <div className="flex justify-center">
                    {stat.mask ? (
                      <span
                        className="block h-8 w-8 bg-cover bg-center"
                        style={{
                          WebkitMaskImage: `url(${asset('/boost-home/stat-mask.svg')})`,
                          maskImage: `url(${asset('/boost-home/stat-mask.svg')})`,
                          WebkitMaskRepeat: 'no-repeat',
                          maskRepeat: 'no-repeat',
                          WebkitMaskSize: 'contain',
                          maskSize: 'contain',
                          backgroundImage: `url(${stat.icon})`,
                        }}
                      />
                    ) : (
                      <img src={stat.icon} alt="" className="h-8 w-8" />
                    )}
                  </div>
                  <p className="pt-[17.25px] text-[16px] font-bold leading-[19.2px]">
                    {stat.value}
                  </p>
                  <p className="text-[16px] leading-[24px] text-[#273b5e]">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="sobre" className="px-6 py-[66px] xl:px-0">
          <div className="mx-auto max-w-[1140px]">
            <div className="text-center">
              <h2 className="text-[36px] font-medium leading-[1.2] text-white sm:text-[50px] sm:leading-[65px]">
                Afiliados de alta performance
                <br />
                <span className="text-[#b4bcd0]">estão migrando</span>
              </h2>
            </div>

            <div className="mt-11 flex justify-center">
              <SectionTag dark>Ferramentas genéricas</SectionTag>
            </div>

            <div className="mt-11 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-center">
              {genericPainPoints.map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <img src={asset('/boost-home/cross-red.svg')} alt="" className="h-6 w-6" />
                  <span className="text-[16px] leading-[24px] text-[#4a5565]">{item}</span>
                </div>
              ))}
            </div>

            <div className="mt-[138px] border-t border-[#333] bg-[radial-gradient(ellipse_at_top,_rgba(115,159,239,0.1)_0%,_rgba(115,159,239,0)_70%)] pt-11">
              <div className="flex justify-center">
                <div className="rounded-[24px] border border-white bg-gradient-to-b from-white to-[#cfddf6] px-[17px] py-[9px] text-[12px] font-bold leading-[18px] text-black">
                  BOOST ®
                </div>
              </div>

              <div className="mx-auto mt-11 grid max-w-[762px] gap-x-8 gap-y-16 px-8 md:grid-cols-3">
                {boostAdvantages.map((item) => (
                  <div key={item.title} className="text-center">
                    <div className="flex justify-center">
                      <img src={asset('/boost-home/check-blue.svg')} alt="" className="h-6 w-6" />
                    </div>
                    <h3 className="pt-[15.25px] text-[16px] font-bold leading-[19.2px]">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-[16px] leading-[24px] text-[#314568]">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="funcionalidades" className="px-6 py-[65px] xl:px-0">
          <div className="mx-auto max-w-[1140px]">
            <div className="text-center">
              <h2 className="text-[24px] font-medium leading-[1.3] text-white sm:text-[29px] sm:leading-[37.7px]">
                A BOOST centraliza seus dados e entrega
                <br />
                inteligência para decisões que realmente
                <br />
                impactam o resultado.
              </h2>
            </div>

            <div className="mt-[66px] grid gap-6 lg:grid-cols-2">
              {featureCards.map((card, index) => (
                <article
                  key={card.title.join(' ')}
                  className={[
                    'relative min-h-[500px] rounded-[20px] px-12 pt-[47.3px]',
                    card.containerClassName,
                  ].join(' ')}
                >
                  <div className={index === 1 ? 'max-w-[200px]' : index === 3 ? 'max-w-[240px]' : 'max-w-[300px]'}>
                    <h3 className="text-[23px] font-bold leading-[27.6px] text-black">
                      {card.title[0]}
                      <br />
                      {card.title[1]}
                    </h3>
                    <p className="mt-[11.45px] text-[16px] leading-[22.4px] text-black">
                      {card.description[0]}
                      <br />
                      {card.description[1]}
                    </p>
                  </div>

                  {index === 0 ? (
                    <div className="flex justify-center pt-[86px]">
                      <img src={card.image} alt="" className={card.imageClassName} />
                    </div>
                  ) : (
                    <img src={card.image} alt="" className={card.imageClassName} />
                  )}

                  {index === 3 ? (
                    <div className="absolute left-[88.73px] top-[301.27px] h-[43px] w-[186px] bg-[#fffffd]" />
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 pb-[49px] pt-[34px] xl:px-0">
          <div className="mx-auto max-w-[1024px]">
            <div className="text-center">
              <h2 className="text-[36px] font-medium leading-[1.15] text-white sm:text-[50px] sm:leading-[55px]">
                Clareza total
                <br />
                <span className="text-[#b4bcd0]">da sua operação</span>
              </h2>

              <h3 className="mt-[56.3px] text-[21px] font-bold leading-[25.2px]">
                Dashboards pensados para quem vive de performance
              </h3>
              <p className="mt-[9.24px] text-[16px] leading-[19.2px] text-[#b4bcd0]">
                Acompanhe KPIs, receitas, conversões e métricas críticas, com
                visualizações limpas e objetivas.
              </p>
            </div>

            <div className="mt-[70px]">
              <div className="flex justify-center">
                <div className="flex rounded-full border border-white p-[3px]">
                  <button
                    type="button"
                    onClick={() => setDashboardTab('desktop')}
                    aria-pressed={dashboardTab === 'desktop'}
                    className={[
                      'flex items-center gap-[5px] rounded-full px-[17px] py-[9px] text-[12px] font-bold leading-[18px] transition',
                      dashboardTab === 'desktop'
                        ? 'border border-white bg-gradient-to-b from-white to-[#cfddf6] text-black shadow-[0_6px_16px_rgba(207,221,246,0.35)]'
                        : 'border border-transparent text-white/75 hover:text-white',
                    ].join(' ')}
                  >
                    <img src={asset('/boost-home/desktop-tab.svg')} alt="" className="h-3 w-3" />
                    Desktop
                  </button>
                  <button
                    type="button"
                    onClick={() => setDashboardTab('mobile')}
                    aria-pressed={dashboardTab === 'mobile'}
                    className={[
                      'flex items-center gap-[5px] rounded-full px-[17px] py-[9px] text-[12px] font-bold leading-[18px] transition',
                      dashboardTab === 'mobile'
                        ? 'border border-white bg-gradient-to-b from-white to-[#cfddf6] text-black shadow-[0_6px_16px_rgba(207,221,246,0.35)]'
                        : 'border border-transparent text-white/75 hover:text-white',
                    ].join(' ')}
                  >
                    <img src={asset('/boost-home/mobile-tab.svg')} alt="" className="h-3 w-3" />
                    Mobile
                  </button>
                </div>
              </div>

              <div className="mt-[70px]">
                {dashboardTab === 'desktop' ? (
                  <img
                    src={asset('/boost-home/dashboard.webp')}
                    alt="Dashboard Boost na versão desktop"
                    className="w-full"
                  />
                ) : (
                  <div className="flex justify-center">
                    <div className="relative w-full max-w-[320px] rounded-[40px] border border-white/15 bg-[linear-gradient(180deg,#192334_0%,#0a1220_100%)] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                      <div className="mb-3 flex justify-center">
                        <div className="h-1.5 w-20 rounded-full bg-white/20" />
                      </div>
                      <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[#0f1725]">
                        <div className="h-[560px] overflow-hidden">
                          <img
                            src={asset('/boost-home/dashboard.webp')}
                            alt="Dashboard Boost na versão mobile"
                            className="h-full w-full origin-top scale-[1.92] object-cover object-top"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 pb-[50px] pt-[449px] xl:px-0">
          <div className="mx-auto max-w-[1140px]">
            <div className="text-center text-[#cfddf6]">
              <h2 className="text-[24px] font-medium leading-[1.3] sm:text-[29px] sm:leading-[37.7px]">
                Isso não é para qualquer um.
                <br />
                É para afiliados com resultados consistentes que querem evoluir
                <br />
                sua estrutura e ter acesso aos melhores Deals do mercado.
              </h2>
            </div>

            <div className="mx-auto mt-[60px] grid max-w-[685px] gap-12 md:grid-cols-3">
              {qualificationItems.map((item) => (
                <div key={item[0]} className="text-center">
                  <div className="flex justify-center">
                    <img src={asset('/boost-home/check-white.svg')} alt="" className="h-6 w-6" />
                  </div>
                  <h3 className="pt-[15.25px] text-[16px] font-bold leading-[19.2px] text-white">
                    {item[0]}
                  </h3>
                  <p className="text-[16px] leading-[24px] text-[#314568]">{item[1]}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="contato" className="px-6 pt-[50px] xl:px-0">
          <div className="mx-auto max-w-[1140px]">
            <div className="flex justify-center">
              <div className="relative h-[120px] w-[120px] overflow-hidden">
                <img src={asset('/boost-home/favicon.svg')} alt="" className="inset-0 h-full w-full object-cover" />
                <div className="inset-[10.52%_10.24%_9.48%_11.57%] bg-gradient-to-b from-[#19202e] to-[#101724]" />
              </div>
            </div>

            <div className="mt-16 text-center">
              <h2 className="text-[42px] font-medium leading-[1.1] text-white sm:text-[70px] sm:leading-[77px]">
                Seja agora
                <br />
                <span className="text-[#b4bcd0]">um BOOST</span>
              </h2>
            </div>

            <div className="mt-16 flex justify-center">
              <div className="relative w-full max-w-[622px] rounded-tl-[20px] rounded-tr-[20px] bg-gradient-to-b from-[#0f1624] to-transparent px-10 py-[25px]">
                <div className="absolute inset-0 rounded-tl-[20px] rounded-tr-[20px] bg-gradient-to-b from-[#232a38] to-transparent opacity-40" />
                <div className="relative">
                  <form className="space-y-6" onSubmit={handleContactSubmit}>
                    <FormField
                      label="Nome *"
                      name="name"
                      placeholder="Nome"
                      value={contactForm.name}
                      onChange={(value) => handleContactFieldChange('name', value)}
                      onBlur={() => handleContactBlur('name')}
                      error={contactErrors.name}
                    />
                    <FormField
                      label="Email *"
                      name="email"
                      type="email"
                      placeholder="nome@email.com"
                      value={contactForm.email}
                      onChange={(value) => handleContactFieldChange('email', value)}
                      onBlur={() => handleContactBlur('email')}
                      error={contactErrors.email}
                    />

                    <div className="grid gap-6 md:grid-cols-2">
                      <FormField
                        label="Telefone *"
                        name="phone"
                        inputMode="numeric"
                        placeholder="(00) 00000-0000"
                        value={contactForm.phone}
                        onChange={(value) => handleContactFieldChange('phone', value)}
                        onBlur={() => handleContactBlur('phone')}
                        error={contactErrors.phone}
                      />
                      <FormField
                        label="Instagram *"
                        name="instagram"
                        placeholder="@seuperfil"
                        value={contactForm.instagram}
                        onChange={(value) => handleContactFieldChange('instagram', value)}
                        onBlur={() => handleContactBlur('instagram')}
                        error={contactErrors.instagram}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="affiliateExperience"
                        className="mb-2 block text-[16px] leading-[16px] text-[#364153]"
                      >
                        Você já trabalha no mercado de afiliação?
                      </label>
                      <div className="relative">
                        <select
                          id="affiliateExperience"
                          value={contactForm.affiliateExperience}
                          onChange={(event) =>
                            handleContactFieldChange('affiliateExperience', event.target.value)
                          }
                          onBlur={() => handleContactBlur('affiliateExperience')}
                          className="w-full appearance-none rounded-[10px] border border-[#232a38] bg-[#19202e] px-[15px] py-[14px] pr-10 text-[16px] leading-[24px] text-white outline-none transition focus:border-white/30"
                        >
                          <option value="" disabled>
                            Selecione
                          </option>
                          <option value="sim">Sim</option>
                          <option value="nao">Não</option>
                        </select>
                        <img
                          src={asset('/boost-home/select-arrow.svg')}
                          alt=""
                          className="pointer-events-none absolute right-[10px] top-1/2 h-[11px] w-[11px] -translate-y-1/2"
                        />
                      </div>
                      {contactErrors.affiliateExperience ? (
                        <p className="mt-2 text-[13px] leading-[18px] text-[#ff8c8c]">
                          {contactErrors.affiliateExperience}
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <label
                        htmlFor="presentation"
                        className="mb-2 block text-[16px] leading-[16px] text-[#364153]"
                      >
                        Apresente-se *
                      </label>
                      <textarea
                        id="presentation"
                        value={contactForm.presentation}
                        onChange={(event) =>
                          handleContactFieldChange('presentation', event.target.value)
                        }
                        onBlur={() => handleContactBlur('presentation')}
                        placeholder="Conte-nos sobre sua operação e volume atual..."
                        className="min-h-[152px] w-full rounded-[10px] border border-[#232a38] bg-[#19202e] px-[17px] py-[16.25px] text-[16px] leading-[22.4px] text-white outline-none transition placeholder:text-white/60 focus:border-white/30"
                      />
                      {contactErrors.presentation ? (
                        <p className="mt-2 text-[13px] leading-[18px] text-[#ff8c8c]">
                          {contactErrors.presentation}
                        </p>
                      ) : null}
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingContact}
                      className="flex w-full items-center justify-center gap-2 rounded-[8px] border border-white bg-gradient-to-b from-white to-[#bbc9e2] p-[17px] text-[16px] font-medium leading-[16px] text-black transition disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmittingContact ? 'Enviando...' : 'Quero fazer parte'}
                      <img src={asset('/boost-home/button-arrow.svg')} alt="" className="h-5 w-5" />
                    </button>
                  </form>

                  <p className="mt-6 text-center text-[14px] leading-[21px] text-[#6a7282]">
                    Nosso time irá analisar o perfil e entrar em contato
                  </p>
                  {contactStatus ? (
                    <p
                      className={[
                        'mt-3 text-center text-[14px] leading-[21px]',
                        contactStatus.type === 'success' ? 'text-[#a9d3b0]' : 'text-[#ff8c8c]',
                      ].join(' ')}
                    >
                      {contactStatus.message}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#cfdDF6]/10 bg-[rgba(0,2,18,0.3)] px-6 pb-[100px] pt-[95px] backdrop-blur-[10px] xl:px-0">
        <div className="mx-auto max-w-[1140px]">
          <div className="flex flex-col items-center justify-center gap-10 lg:flex-row lg:gap-[100px]">
            <div className="flex gap-[50px]">
              {footerLinksLeft.map((item) => (
                <a key={item.label} href={item.href} className="text-[14px] font-medium leading-[21px]">
                  {item.label}
                </a>
              ))}
            </div>

            <a href="#top" className="flex h-[60px] w-[60px] items-center justify-center">
              <img src={asset('/boost-home/favicon.svg')} alt="" className="h-[40px] w-[40px] object-contain opacity-90" />
            </a>

            <div className="flex gap-[50px]">
              {footerLinksRight.map((item) => (
                <a key={item.label} href={item.href} className="text-[14px] font-medium leading-[21px]">
                  {item.label}
                </a>
              ))}
            </div>
          </div>

          <div className="mt-24 flex flex-col gap-10">
            <div className="flex flex-col items-start justify-between gap-8 border-y border-[#cfdDF6]/10 px-6 py-[49px] lg:flex-row lg:items-center">
              <div className="max-w-[255px]">
                <p className="text-[14px] font-bold leading-[21px] text-white">
                  Inscreva-se na nossa newsletter.
                </p>
                <p className="text-[14px] leading-[21px] text-[#9c9c9d]">
                  Receba atualizações e notícias sobre produtos na sua caixa de entrada.
                </p>
              </div>

              <div className="flex w-full max-w-[420px] flex-col gap-4 sm:flex-row">
                <div className="flex-1 rounded-[10px] border border-[#232a38] bg-[#19202e] px-[13px] py-[14px] text-[14px] text-white/60">
                  nome@email.com
                </div>
                <button
                  type="button"
                  className="rounded-[8px] border border-white bg-gradient-to-b from-white to-[#bbc9e2] px-[13px] py-[15px] text-[16px] font-medium leading-[16px] text-black"
                >
                  Quero receber!
                </button>
              </div>
            </div>

            <div className="overflow-hidden pb-[6px] w-full">
              <img
                src={asset('/boost-home/logo.svg')}
                alt=""
                className="block w-full h-auto opacity-10 object-contain"
              />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FormField({
  label,
  name,
  value,
  onChange,
  onBlur,
  error,
  type = 'text',
  placeholder,
  inputMode,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  type?: 'text' | 'email';
  placeholder: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-2 block text-[16px] leading-[16px] text-[#364153]">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={[
          'w-full rounded-[10px] border bg-[#19202e] px-[17px] py-[18px] text-[16px] text-white outline-none transition placeholder:text-white/60 focus:border-white/30',
          error ? 'border-[#ff8c8c]' : 'border-[#232a38]',
        ].join(' ')}
      />
      {error ? <p className="mt-2 text-[13px] leading-[18px] text-[#ff8c8c]">{error}</p> : null}
    </div>
  );
}
