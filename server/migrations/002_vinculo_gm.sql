-- 002_vinculo_gm.sql — o dono da campanha entra no quadro de vinculos (ADR #19).
--
-- A partir da entrega 4 o papel na mesa vem de `membership`, e nao mais de
-- `campaign.gm_account_id`. Como toda campanha que existe foi criada por alguem,
-- o backfill e obrigatorio: sem ele, os mestres de hoje perderiam o papel no
-- primeiro boot, e `gm_account_id` sozinho nao decide mais nada.
--
-- O `do update` e de proposito. Quem entrou antes como jogador na propria
-- campanha (aconteceu nos testes: a conta que criou a missao entrou como agente)
-- tem um vinculo de jogador gravado; o conflito promove para mestre, porque quem
-- criou a mesa e mestre dela, por definicao.

insert into membership (account_id, campaign_id, role)
select c.gm_account_id, c.id, 'gm'
  from campaign c
 where c.gm_account_id is not null
on conflict (account_id, campaign_id) do update set role = 'gm';
