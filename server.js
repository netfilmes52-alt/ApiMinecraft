const express  = require('express');
const axios    = require('axios');
const cors     = require('cors');
const session  = require('express-session');
const crypto   = require('crypto');
const mcData   = require('minecraft-data')('1.20.1');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Credenciais ─────────────────────────────────────────────────
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID     || '1482572584431390772';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '4ZTDl_AyisqQhFx7-Gd4LCSS-Ft6Yd8q';
const PANEL_SECRET          = process.env.PANEL_SECRET          || 'mc_secret_2026';
const PANEL_URL             = process.env.PANEL_URL             || 'https://seu-painel.vercel.app';
const API_URL               = process.env.RENDER_EXTERNAL_URL   || 'https://apiminecraft.onrender.com';
const REDIRECT_URI          = `${API_URL}/painel/auth/callback`;

// ─── Firebase ────────────────────────────────────────────────────
const { initializeApp }                     = require('firebase/app');
const { getDatabase, ref, set, get, update } = require('firebase/database');

const firebaseApp = initializeApp({
  apiKey:            process.env.FIREBASE_API_KEY,
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL:       process.env.FIREBASE_DATABASE_URL,
  projectId:         process.env.FIREBASE_PROJECT_ID,
  storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.FIREBASE_APP_ID,
});
const db = getDatabase(firebaseApp);

async function getConfig(guildId) {
  const snap = await get(ref(db, `servidores/${guildId}`));
  return snap.exists() ? snap.val() : {};
}
async function setConfig(guildId, data) {
  await update(ref(db, `servidores/${guildId}`), data);
}

// ─── Middlewares ─────────────────────────────────────────────────
app.use(cors({ origin: PANEL_URL, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: PANEL_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ─── Helpers ─────────────────────────────────────────────────────
async function get_(url, timeout = 10000) {
  const res = await axios.get(url, { timeout });
  return res.data;
}
function formatUUID(raw) {
  return raw.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}
function autenticado(req, res, next) {
  if (!req.session?.usuario) return res.status(401).json({ erro: 'Nao autenticado.' });
  next();
}

// ════════════════════════════════════════════════════════════════
//  ROTA RAIZ
// ════════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({
    name: 'Minecraft API',
    version: '2.0.0',
    rotas: {
      ping:           'GET /ping',
      servidor:       'GET /server/:ip',
      servidor_porta: 'GET /server/:ip/:porta',
      jogador:        'GET /player/:username',
      uuid:           'GET /uuid/:username',
      skin:           'GET /skin/:username',
      avatar:         'GET /avatar/:username',
      head:           'GET /head/:username',
      cape:           'GET /cape/:username',
      historico:      'GET /names/:username',
      sessao:         'GET /session/:uuid',
      item:           'GET /item/:nome',
      painel:         'GET /painel/auth/discord',
    }
  });
});

// ════════════════════════════════════════════════════════════════
//  PING
// ════════════════════════════════════════════════════════════════
app.get('/ping', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// ════════════════════════════════════════════════════════════════
//  SERVIDOR MINECRAFT
// ════════════════════════════════════════════════════════════════
app.get('/server/:ip', async (req, res) => {
  await getServer(res, req.params.ip, null);
});
app.get('/server/:ip/:porta', async (req, res) => {
  await getServer(res, req.params.ip, req.params.porta);
});
async function getServer(res, ip, porta) {
  try {
    const endpoint = porta
      ? `https://api.mcsrvstat.us/3/${ip}:${porta}`
      : `https://api.mcsrvstat.us/3/${ip}`;
    const data = await get_(endpoint);
    if (!data.online) {
      return res.json({ online: false, ip, porta: porta || 25565, mensagem: 'Servidor offline ou nao encontrado.' });
    }
    res.json({
      online: true, ip, porta: porta || data.port || 25565,
      motd: data.motd?.clean?.join(' ') || 'Sem descricao',
      jogadores: { online: data.players?.online || 0, max: data.players?.max || 0, lista: data.players?.list || [] },
      versao: data.version || 'Desconhecida', software: data.software || null,
      icone: data.icon || null,
      mods: data.mods?.length ? `${data.mods.length} mods` : null,
      plugins: data.plugins?.length ? `${data.plugins.length} plugins` : null,
      srv: data.srv || null
    });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao consultar servidor.', detalhe: err.message });
  }
}

// ════════════════════════════════════════════════════════════════
//  JOGADOR
// ════════════════════════════════════════════════════════════════
app.get('/player/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const profile = await get_(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (!profile?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    const raw  = profile.id;
    const uuid = formatUUID(raw);
    let nomes  = [];
    try {
      const ashcon = await get_(`https://api.ashcon.app/mojang/v2/user/${username}`);
      nomes = ashcon.username_history?.map(h => ({ nome: h.username, desde: h.changed_at || 'nome original' })) || [];
    } catch (_) {}
    res.json({
      username: profile.name, uuid, uuid_sem_hifen: raw,
      skin_url:    `https://crafatar.com/renders/body/${uuid}?overlay`,
      avatar_url:  `https://crafatar.com/avatars/${uuid}?overlay`,
      head_url:    `https://crafatar.com/renders/head/${uuid}?overlay`,
      cape_url:    `https://crafatar.com/capes/${uuid}`,
      mcheads_url: `https://mc-heads.net/avatar/${uuid}/100`,
      historico_nomes: nomes
    });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.status(500).json({ erro: 'Falha ao buscar jogador.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  UUID
// ════════════════════════════════════════════════════════════════
app.get('/uuid/:username', async (req, res) => {
  try {
    const data = await get_(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`);
    if (!data?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.json({ username: data.name, uuid: formatUUID(data.id), uuid_sem_hifen: data.id });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.status(500).json({ erro: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  HISTORICO DE NOMES
// ════════════════════════════════════════════════════════════════
app.get('/names/:username', async (req, res) => {
  try {
    const data = await get_(`https://api.ashcon.app/mojang/v2/user/${req.params.username}`);
    res.json({
      username: data.username, uuid: data.uuid,
      historico: data.username_history?.map(h => ({ nome: h.username, desde: h.changed_at || 'nome original' })) || []
    });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.status(500).json({ erro: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  SESSAO
// ════════════════════════════════════════════════════════════════
app.get('/session/:uuid', async (req, res) => {
  try {
    const data = await get_(`https://sessionserver.mojang.com/session/minecraft/profile/${req.params.uuid}`);
    const prop = data.properties?.find(p => p.name === 'textures');
    let textures = null;
    if (prop) {
      const decoded = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
      textures = decoded.textures;
    }
    res.json({ username: data.name, uuid: req.params.uuid, textures });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao buscar sessao.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  SKIN / AVATAR / HEAD / CAPE
// ════════════════════════════════════════════════════════════════
app.get('/skin/:username', async (req, res) => {
  try {
    const data = await get_(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`);
    if (!data?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.redirect(`https://crafatar.com/renders/body/${formatUUID(data.id)}?overlay`);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});
app.get('/avatar/:username', async (req, res) => {
  try {
    const data = await get_(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`);
    if (!data?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.redirect(`https://mc-heads.net/avatar/${data.id}/128`);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});
app.get('/head/:username', async (req, res) => {
  try {
    const data = await get_(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`);
    if (!data?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.redirect(`https://mc-heads.net/head/${data.id}/128`);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});
app.get('/cape/:username', async (req, res) => {
  try {
    const data = await get_(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`);
    if (!data?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.redirect(`https://crafatar.com/capes/${formatUUID(data.id)}`);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  ITEM (minecraft-data local)
// ════════════════════════════════════════════════════════════════
app.get('/item/:nome', (req, res) => {
  try {
    const nome  = req.params.nome.toLowerCase().replace(/ /g, '_');
    const item  = mcData.itemsByName[nome];
    if (!item) return res.status(404).json({ erro: 'Item nao encontrado.' });
    const receitas = mcData.recipes?.[item.id] || null;
    res.json({
      id: item.id, nome: item.name, display: item.displayName,
      stackSize: item.stackSize,
      receitas: receitas ? receitas.length + ' receita(s) disponivel(is)' : 'Sem receita',
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  PAINEL - AUTH DISCORD
// ════════════════════════════════════════════════════════════════
app.get('/painel/auth/discord', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID, redirect_uri: REDIRECT_URI,
    response_type: 'code', scope: 'identify guilds', state,
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/painel/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || state !== req.session.oauthState) return res.redirect(`${PANEL_URL}?erro=auth_falhou`);
  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token } = tokenRes.data;

    // Delay pra evitar rate limit do Discord
    await new Promise(r => setTimeout(r, 800));
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    await new Promise(r => setTimeout(r, 800));
    const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const guildsAdmin = guildsRes.data.filter(g => (BigInt(g.permissions) & BigInt(0x8)) === BigInt(0x8));
    req.session.usuario = {
      id: userRes.data.id, username: userRes.data.username,
      avatar: userRes.data.avatar, guilds: guildsAdmin,
    };
    res.redirect(`${PANEL_URL}/dashboard`);
  } catch (err) {
    console.error('[PAINEL] Erro auth:', err.message);
    res.redirect(`${PANEL_URL}?erro=auth_falhou`);
  }
});

app.get('/painel/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect(PANEL_URL);
});

app.get('/painel/auth/me', autenticado, (req, res) => {
  const u = req.session.usuario;
  res.json({
    id: u.id, username: u.username,
    avatar: u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`,
    guilds: u.guilds,
  });
});

// ════════════════════════════════════════════════════════════════
//  PAINEL - GUILDS
// ════════════════════════════════════════════════════════════════
app.get('/painel/guilds', autenticado, async (req, res) => {
  try {
    const guilds = req.session.usuario.guilds;
    const resultado = await Promise.all(guilds.map(async g => {
      const config = await getConfig(g.id);
      return {
        id: g.id, nome: g.name,
        icone: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
        config: {
          ip:            config.ip            || null,
          porta:         config.porta         || 25565,
          nome_servidor: config.nome_servidor || 'Meu Servidor',
          cor_embed:     config.cor_embed     || '#5865F2',
          canal_alertas: config.canal_alertas || null,
          cargo_admin:   config.cargo_admin   || null,
        }
      };
    }));
    res.json(resultado);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/painel/guild/:id', autenticado, async (req, res) => {
  const { id } = req.params;
  if (!req.session.usuario.guilds.some(g => g.id === id))
    return res.status(403).json({ erro: 'Sem acesso a este servidor.' });
  try {
    const config = await getConfig(id);
    const guild  = req.session.usuario.guilds.find(g => g.id === id);
    res.json({
      id, nome: guild.name,
      icone: guild.icon ? `https://cdn.discordapp.com/icons/${id}/${guild.icon}.png` : null,
      config: {
        ip:            config.ip            || '',
        porta:         config.porta         || 25565,
        nome_servidor: config.nome_servidor || 'Meu Servidor',
        cor_embed:     config.cor_embed     || '#5865F2',
        canal_alertas: config.canal_alertas || '',
        cargo_admin:   config.cargo_admin   || '',
      }
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/painel/guild/:id/save', autenticado, async (req, res) => {
  const { id } = req.params;
  if (!req.session.usuario.guilds.some(g => g.id === id))
    return res.status(403).json({ erro: 'Sem acesso a este servidor.' });
  try {
    const { ip, porta, nome_servidor, cor_embed, canal_alertas, cargo_admin } = req.body;
    if (cor_embed && !/^#[0-9A-Fa-f]{6}$/.test(cor_embed))
      return res.status(400).json({ erro: 'Cor invalida. Use formato #RRGGBB.' });
    if (porta && (isNaN(porta) || porta < 1 || porta > 65535))
      return res.status(400).json({ erro: 'Porta invalida.' });
    await setConfig(id, {
      ip: ip || null, porta: parseInt(porta) || 25565,
      nome_servidor: nome_servidor || 'Meu Servidor',
      cor_embed: cor_embed || '#5865F2',
      canal_alertas: canal_alertas || null,
      cargo_admin: cargo_admin || null,
    });
    res.json({ sucesso: true, mensagem: 'Configuracoes salvas!' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  404
// ════════════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota nao encontrada.' });
});

// ════════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`✅ API Minecraft v2 rodando na porta ${PORT}`);
});
