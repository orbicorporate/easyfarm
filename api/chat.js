const SUPABASE_URL = 'https://arztmxqslyfcuzlnlatb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyenRteHFzbHlmY3V6bG5sYXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMDI4ODIsImV4cCI6MjA5OTg3ODg4Mn0.wNfWCPY-ITh1wXdoWbWg5x9wQ7bVjXyJskKKfa1lMzw';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    res.status(400).json({ error: 'json_invalido' });
    return;
  }

  const { messages, cultura, regiao, accessToken } = body || {};

  if (!accessToken) {
    res.status(401).json({ error: 'nao_autenticado' });
    return;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'mensagens_invalidas' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'chave_nao_configurada' });
    return;
  }

  // 1) Checa e registra uso diário via função no banco (RPC segura, roda como SECURITY DEFINER).
  let uso;
  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/chat_registrar_uso`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ limite: 20 }),
    });
    uso = await rpcRes.json();
  } catch (e) {
    res.status(500).json({ error: 'erro_verificacao_limite' });
    return;
  }

  if (!uso || uso.permitido !== true) {
    res.status(429).json({
      error: 'limite_diario_atingido',
      usadas: uso ? uso.usadas : undefined,
      limite: (uso && uso.limite) || 20,
    });
    return;
  }

  // 2) Monta o prompt do especialista e chama a API da Anthropic.
  const contextoCultura = cultura && cultura.nome
    ? `O produtor está cultivando ${cultura.nome}${regiao && regiao.label ? ` na região ${regiao.label} do Brasil` : ''}. `
    : '';

  const sistema =
    'Você é um agrônomo especialista, parte do aplicativo Easyfarm (Agro Inteligente), que ajuda pequenos e médios produtores rurais brasileiros. ' +
    contextoCultura +
    'Responda sempre em português do Brasil, de forma direta, prática e objetiva — normalmente 2 a 5 frases, sem enrolação. ' +
    'Foque em orientação agronômica aplicável: manejo, controle de pragas e doenças, solo e adubação, irrigação, poda, colheita, pós-colheita e comercialização. ' +
    'Você não tem acesso a cotações de mercado em tempo real nem a previsão do tempo atual — se perguntarem sobre preços ou clima ao vivo, explique isso e oriente onde o produtor pode checar (Ceasa local, Conab, ou o próprio card de previsão do tempo do app). ' +
    'Se a pergunta fugir totalmente do tema agrícola, redirecione com gentileza de volta para o cultivo.';

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: sistema,
        messages: messages
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-20)
          .map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error', anthropicRes.status, errText);
      res.status(502).json({ error: 'erro_ia' });
      return;
    }

    const data = await anthropicRes.json();
    const texto = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    res.status(200).json({ texto, usadas: uso.usadas, limite: uso.limite });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erro_interno' });
  }
};
