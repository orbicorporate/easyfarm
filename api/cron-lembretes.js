const webpush = require('web-push');

const SUPABASE_URL = 'https://arztmxqslyfcuzlnlatb.supabase.co';
const VAPID_PUBLIC = 'BL51_8NucANGFtw5hELloqOvV4J83JW1U9sdAF4CPsgL1clGCXsUtixHL-8SgL7zPXVqbpK3wID0SmY0YCy3ks4';
const VAPID_PRIVATE = 'JZWmfe0E8LNMdPxNdU0HgzRrzRV8-Y8TClX08dcl-pw';
const FRACOES = [0, 0.03, 0.10, 0.20, 0.25, 0.30, 0.55, 0.75, 1.0, 1.05];
const ETAPA_IDS = ['Planejamento-0', 'Planejamento-1', 'Preparo do Solo-0', 'Preparo do Solo-1', 'Plantio-0', 'Plantio-1', 'Crescimento-0', 'Crescimento-1', 'Colheita-0', 'Colheita-1'];

webpush.setVapidDetails('mailto:pedrobruder11@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDiasISO(dataISO, dias) {
  const d = new Date(dataISO + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
async function sb(path) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase ${path} -> ${res.status}`);
  return res.json();
}
async function sbPatch(path, body) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function sbDelete(path) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
}

module.exports = async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY nao configurada' });
  }

  const hoje = hojeISO();
  const [inicios, progresso, lembretes, subs] = await Promise.all([
    sb('planos_inicio?select=usuario_id,cultura_nome,data_inicio,ciclo_meses'),
    sb('plano_progresso?select=usuario_id,cultura_nome,etapa_id,feito&feito=eq.true'),
    sb(`lembretes?select=id,usuario_id,titulo,data&notificado=eq.false&data=lte.${hoje}`),
    sb('push_subscriptions?select=*'),
  ]);

  const feitosSet = new Set(progresso.map((p) => `${p.usuario_id}::${p.cultura_nome}::${p.etapa_id}`));

  const contagemPorUsuario = {};
  inicios.forEach((ini) => {
    if (!ini.ciclo_meses) return;
    const cicloDias = Math.round(Number(ini.ciclo_meses) * 30);
    ETAPA_IDS.forEach((etapaId, i) => {
      const offset = Math.round(FRACOES[i] * cicloDias);
      const dataISO = addDiasISO(ini.data_inicio, offset);
      if (dataISO > hoje) return;
      const key = `${ini.usuario_id}::${ini.cultura_nome}::${etapaId}`;
      if (feitosSet.has(key)) return;
      contagemPorUsuario[ini.usuario_id] = (contagemPorUsuario[ini.usuario_id] || 0) + 1;
    });
  });
  lembretes.forEach((l) => {
    contagemPorUsuario[l.usuario_id] = (contagemPorUsuario[l.usuario_id] || 0) + 1;
  });

  let enviados = 0;
  const usuarios = Object.keys(contagemPorUsuario);
  for (const usuarioId of usuarios) {
    const n = contagemPorUsuario[usuarioId];
    const minhasSubs = subs.filter((s) => s.usuario_id === usuarioId);
    const payload = JSON.stringify({
      title: 'Easyfarm',
      body: `Você tem ${n} aviso${n > 1 ? 's' : ''} pendente${n > 1 ? 's' : ''} no calendário`,
      url: '/',
    });
    for (const s of minhasSubs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        enviados++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await sbDelete(`push_subscriptions?id=eq.${s.id}`);
        }
      }
    }
  }

  if (lembretes.length > 0) {
    const ids = lembretes.map((l) => l.id).join(',');
    await sbPatch(`lembretes?id=in.(${ids})`, { notificado: true });
  }

  res.status(200).json({ ok: true, usuarios_avisados: usuarios.length, pushes_enviados: enviados });
};
