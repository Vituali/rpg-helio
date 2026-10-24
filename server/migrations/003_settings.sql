-- 003_settings.sql — configuração viva do servidor (ADR #25).
--
-- Cadastro e sala da casa nasceram como variáveis de ambiente: mudar exigia
-- editar o `.env` e reiniciar. São decisões de operação, não de build — e o
-- painel já existe. Esta tabela guarda o que o painel mudou.
--
-- O ambiente continua sendo o **padrão de fábrica**: vale num banco novo e
-- quando o banco está fora. A partir do primeiro clique no painel, o banco
-- manda (senão a mudança sumiria no próximo restart).
create table if not exists app_setting (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
