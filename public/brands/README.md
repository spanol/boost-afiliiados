# Logos das casas (B6)

A API da OTG **não fornece logo** das casas (verificado por probe direto em
2026-06-10: `brand` vem só como `{id, name}`; `/brands` e `/houses` dão 404). As
fotos do portal `partners.grupootg.com` são assets do front-end deles — ficam num
bucket público do Supabase (`betting-house-logos`, arquivo = `<brandId>-<ts>.png`).
Baixamos as oficiais e hospedamos aqui (`superbet.png`, `sportingbet.png`).

## Como adicionar / trocar uma logo

1. Coloque o arquivo nesta pasta com o nome do **slug** da casa (ver
   `src/lib/brand.ts` → `KNOWN_BRANDS`). Hoje:
   - `superbet.svg`
   - `sportingbet.svg`
2. Formato: **SVG** (preferido) ou PNG quadrado (≥120×120, fundo transparente).
   Se usar PNG, ajuste o caminho `logo` em `KNOWN_BRANDS`.
3. Sem alteração de código: o `BrandLogo` resolve o caminho pelo registro.

> Os arquivos atuais são as **logos oficiais** (baixadas do bucket da OTG). Se um
> arquivo faltar/404, a UI cai no avatar de inicial automaticamente (`BrandLogo`
> tem fallback).

## Adicionar uma casa nova

Inclua uma entrada em `KNOWN_BRANDS` (`src/lib/brand.ts`) com `id` (brandId real
da OTG quando conhecido), `slug`, `name` e `logo`, e solte o arquivo aqui.
