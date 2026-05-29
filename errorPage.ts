// Página de erro server-side, em HTML standalone e estilizada no visual da Boost.
// Usada quando a requisição é bloqueada ANTES de chegar ao SPA (ex.: dotfiles como
// /.git interceptados pelo Vite) — evita vazar o 403 cru do Vite com o caminho do disco.

interface ErrorPageOptions {
  status: number;
  title: string;
  message: string;
}

export function renderErrorPage({ status, title, message }: ErrorPageOptions): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${status} · Agência Boost</title>
  <style>
    *{ box-sizing: border-box; margin: 0; padding: 0; }
    body{
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background: #020617;
      color: #e2e8f0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      padding: 24px;
    }
    .card{
      width: 100%; max-width: 440px;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 24px;
      padding: 48px 40px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,.45);
    }
    .badge{
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 11px; font-weight: 800; letter-spacing: .2em; text-transform: uppercase;
      color: #a78bfa;
      background: rgba(124,58,237,.12);
      padding: 8px 14px; border-radius: 999px;
      margin-bottom: 28px;
    }
    .code{ font-size: 64px; font-weight: 900; line-height: 1; color: #fff; letter-spacing: -.04em; }
    h1{ margin-top: 16px; font-size: 18px; font-weight: 800; color: #f8fafc; }
    p{ margin-top: 10px; font-size: 14px; color: #94a3b8; line-height: 1.6; }
    a.btn{
      display: inline-block; margin-top: 32px;
      background: #7c3aed; color: #fff; text-decoration: none;
      font-size: 12px; font-weight: 800; letter-spacing: .15em; text-transform: uppercase;
      padding: 14px 28px; border-radius: 14px;
      transition: filter .2s ease;
    }
    a.btn:hover{ filter: brightness(1.1); }
  </style>
</head>
<body>
  <main class="card">
    <span class="badge">Agência Boost</span>
    <div class="code">${status}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a class="btn" href="/">Voltar ao início</a>
  </main>
</body>
</html>`;
}
