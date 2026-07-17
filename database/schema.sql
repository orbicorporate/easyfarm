-- ============================================================
-- EASYFARM — SCHEMA DO BANCO DE DADOS
-- Executar no SQL Editor do Supabase
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USUÁRIOS
CREATE TABLE usuarios (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome            TEXT,
  plano_atual     TEXT NOT NULL DEFAULT 'gratis' CHECK (plano_atual IN ('gratis','pro','premium')),
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);

-- SIMULAÇÕES (histórico da calculadora)
CREATE TABLE simulacoes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cultura_nome    TEXT NOT NULL,
  cultura_emoji   TEXT NOT NULL,
  regiao_label    TEXT NOT NULL,
  cultivar_nome   TEXT,
  area_sqm        NUMERIC(12,2) NOT NULL,
  lucro_safra     NUMERIC(12,2) NOT NULL,
  lucro_anual     NUMERIC(12,2) NOT NULL,
  receita_total   NUMERIC(12,2) NOT NULL,
  custo_total     NUMERIC(12,2) NOT NULL,
  margem_pct      NUMERIC(6,2)  NOT NULL,
  dados_json      JSONB,
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_simulacoes_usuario ON simulacoes(usuario_id, criado_em DESC);

-- PROGRESSO DO PLANO
CREATE TABLE plano_progresso (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cultura_nome    TEXT NOT NULL,
  etapa_id        TEXT NOT NULL,
  feito           BOOLEAN NOT NULL DEFAULT FALSE,
  feito_em        TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(usuario_id, cultura_nome, etapa_id)
);

CREATE INDEX idx_progresso_usuario ON plano_progresso(usuario_id, cultura_nome);

-- TRIGGER: criar usuário ao cadastrar
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.usuarios (id, nome)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ROW LEVEL SECURITY
ALTER TABLE usuarios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulacoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE plano_progresso ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuarios_self"   ON usuarios        FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "simulacoes_self" ON simulacoes      FOR ALL TO authenticated USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());
CREATE POLICY "progresso_self"  ON plano_progresso FOR ALL TO authenticated USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());
