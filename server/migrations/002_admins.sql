-- 002_admins.sql — administradores delegados e o último acesso (ADR #24).
--
-- O ADR #23 fez do administrador um NOME (`ADMIN_ACCOUNT`). O pedido seguinte foi
-- delegar: "admin pode dar admin pra alguém também". Delegar precisa de lugar
-- para guardar — esta coluna.
--
-- O nome continua sendo a raiz: quem tem o nome do `ADMIN_ACCOUNT` é
-- administrador **sempre**, e não dá para rebaixar pelo painel. A flag é para os
-- outros. Assim, um clique errado nunca deixa o painel sem dono.
--
-- `last_login_at` é o que o painel precisa para responder "quem é esta conta?".
-- Só o login escreve nele; abrir a página (`/auth/me`) não conta como acesso.
alter table account add column if not exists is_admin boolean not null default false;
alter table account add column if not exists last_login_at timestamptz;
