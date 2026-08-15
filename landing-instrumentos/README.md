# Landing page — Harmonia Instrumentos

Landing page de vendas (página única) para loja de instrumentos musicais.

- Arquivo único: `index.html` — HTML + CSS + JS inline, sem dependências, sem build.
- Para ver: abra `index.html` no navegador (ou `npx serve landing-instrumentos`).

## Seções
1. Faixa de urgência + header fixo
2. Hero com proposta de valor e CTAs
3. Selos de confiança (frete, garantia, parcelamento, regulagem)
4. Categorias (guitarras, violões, teclados, baterias, sopros)
5. Vitrine com 6 produtos, preço, parcelamento e CTA
6. Depoimentos
7. Oferta de boas-vindas com formulário de captação + contador regressivo
8. FAQ
9. CTA final, rodapé e barra fixa de compra no mobile

## Observações
- Conteúdo, marca, preços e depoimentos são fictícios (demonstração).
- Ilustrações dos instrumentos são SVG inline — nenhuma imagem externa.
- O formulário é apenas front-end: exibe confirmação e não envia dados.
  Para integrar, troque o handler do `#lead-form` por um POST para a API do CRM.
