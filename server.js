const express  = require('express');
const axios    = require('axios');
const cors     = require('cors');
const mcData   = require('minecraft-data')('1.20.1');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Credenciais ─────────────────────────────────────────────────
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID     || '1482572584431390772';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '4ZTDl_AyisqQhFx7-Gd4LCSS-Ft6Yd8q';
const PANEL_URL             = process.env.PANEL_URL             || 'https://mc-panel-nu.vercel.app';
const API_URL               = process.env.API_URL || 'https://apiminecraft-production.up.railway.app';
const REDIRECT_URI          = `${API_URL}/painel/auth/callback`;

// ─── Firebase ────────────────────────────────────────────────────
const { initializeApp }                  = require('firebase/app');
const { getDatabase, ref, get, update }  = require('firebase/database');

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

// ─── Store de sessões em memória (token → usuario) ────────────────
const sessions = new Map();

function gerarToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Middlewares ─────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Helpers ─────────────────────────────────────────────────────
function formatUUID(raw) {
  return raw.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

function autenticado(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  if (!token || !sessions.has(token)) return res.status(401).json({ erro: 'Nao autenticado.' });
  req.usuario = sessions.get(token);
  next();
}

// ════════════════════════════════════════════════════════════════
//  ROTA RAIZ
// ════════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ name: 'Minecraft API', version: '2.1.0' });
});

app.get('/ping', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// ════════════════════════════════════════════════════════════════
//  SERVIDOR MINECRAFT
// ════════════════════════════════════════════════════════════════
app.get('/server/:ip', async (req, res) => getServer(res, req.params.ip, null));
app.get('/server/:ip/:porta', async (req, res) => getServer(res, req.params.ip, req.params.porta));

async function getServer(res, ip, porta) {
  try {
    const endpoint = porta ? `https://api.mcsrvstat.us/3/${ip}:${porta}` : `https://api.mcsrvstat.us/3/${ip}`;
    const { data } = await axios.get(endpoint, { timeout: 10000 });
    if (!data.online) return res.json({ online: false, ip, porta: porta || 25565 });
    res.json({
      online: true, ip, porta: porta || data.port || 25565,
      motd: data.motd?.clean?.join(' ') || 'Sem descricao',
      jogadores: { online: data.players?.online || 0, max: data.players?.max || 0, lista: data.players?.list || [] },
      versao: data.version || 'Desconhecida',
      icone: data.icon || null,
      mods: data.mods?.length ? `${data.mods.length} mods` : null,
      plugins: data.plugins?.length ? `${data.plugins.length} plugins` : null,
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
    const { data: profile } = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${username}`, { timeout: 10000 });
    if (!profile?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    const raw = profile.id;
    const uuid = formatUUID(raw);
    let nomes = [];
    try {
      const { data: ashcon } = await axios.get(`https://api.ashcon.app/mojang/v2/user/${username}`, { timeout: 10000 });
      nomes = ashcon.username_history?.map(h => ({ nome: h.username, desde: h.changed_at || 'nome original' })) || [];
    } catch (_) {}
    res.json({ username: profile.name, uuid, uuid_sem_hifen: raw, historico_nomes: nomes });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.status(500).json({ erro: err.message });
  }
});

app.get('/uuid/:username', async (req, res) => {
  try {
    const { data } = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`, { timeout: 10000 });
    if (!data?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.json({ username: data.name, uuid: formatUUID(data.id), uuid_sem_hifen: data.id });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.status(500).json({ erro: err.message });
  }
});

app.get('/names/:username', async (req, res) => {
  try {
    const { data } = await axios.get(`https://api.ashcon.app/mojang/v2/user/${req.params.username}`, { timeout: 10000 });
    res.json({
      username: data.username, uuid: data.uuid,
      historico: data.username_history?.map(h => ({ nome: h.username, desde: h.changed_at || 'nome original' })) || []
    });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.status(500).json({ erro: err.message });
  }
});

app.get('/session/:uuid', async (req, res) => {
  try {
    const { data } = await axios.get(`https://sessionserver.mojang.com/session/minecraft/profile/${req.params.uuid}`, { timeout: 10000 });
    const prop = data.properties?.find(p => p.name === 'textures');
    let textures = null;
    if (prop) textures = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures;
    res.json({ username: data.name, uuid: req.params.uuid, textures });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/skin/:username', async (req, res) => {
  try {
    const { data } = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`, { timeout: 10000 });
    if (!data?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.redirect(`https://crafatar.com/renders/body/${formatUUID(data.id)}?overlay`);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});
app.get('/avatar/:username', async (req, res) => {
  try {
    const { data } = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`, { timeout: 10000 });
    if (!data?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.redirect(`https://mc-heads.net/avatar/${data.id}/128`);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});
app.get('/head/:username', async (req, res) => {
  try {
    const { data } = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`, { timeout: 10000 });
    if (!data?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.redirect(`https://mc-heads.net/head/${data.id}/128`);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});
app.get('/cape/:username', async (req, res) => {
  try {
    const { data } = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`, { timeout: 10000 });
    if (!data?.id) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    res.redirect(`https://crafatar.com/capes/${formatUUID(data.id)}`);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  ITEM
// ════════════════════════════════════════════════════════════════
app.get('/item/:nome', (req, res) => {
  try {
    const nome = req.params.nome.toLowerCase().replace(/ /g, '_');
    const item = mcData.itemsByName[nome];
    if (!item) return res.status(404).json({ erro: 'Item nao encontrado.' });
    res.json({
      id: item.id, nome: item.name, display: item.displayName, stackSize: item.stackSize,
      receitas: mcData.recipes?.[item.id] ? `${mcData.recipes[item.id].length} receita(s)` : 'Sem receita',
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  PAINEL - AUTH DISCORD
// ════════════════════════════════════════════════════════════════
app.get('/painel/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID, redirect_uri: REDIRECT_URI,
    response_type: 'code', scope: 'identify guilds',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/painel/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${PANEL_URL}?erro=auth_falhou`);

  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token } = tokenRes.data;

    const [userData, guildsData] = await Promise.all([
      axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } }).then(r => r.data),
      axios.get('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${access_token}` } }).then(r => r.data),
    ]);

    const guildsAdmin = guildsData.filter(g => (BigInt(g.permissions) & BigInt(0x8)) === BigInt(0x8));

    // Gera token e salva em memória
    const token = gerarToken();
    sessions.set(token, {
      id: userData.id,
      username: userData.username,
      avatar: userData.avatar,
      guilds: guildsAdmin,
    });

    // Passa token na URL — frontend salva no sessionStorage
    res.redirect(`${PANEL_URL}/dashboard?token=${token}`);
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['retry-after'] || '60';
      const minutos = Math.ceil(parseFloat(retryAfter) / 60);
      return res.redirect(`${PANEL_URL}?erro=rate_limit&wait=${minutos}`);
    }
    console.error('[PAINEL] Erro auth:', err.message);
    res.redirect(`${PANEL_URL}?erro=auth_falhou`);
  }
});

app.get('/painel/auth/logout', (req, res) => {
  const token = req.query.token;
  if (token) sessions.delete(token);
  res.redirect(PANEL_URL);
});

app.get('/painel/auth/me', autenticado, (req, res) => {
  const u = req.usuario;
  res.json({
    id: u.id, username: u.username,
    avatar: u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`,
  });
});

// ════════════════════════════════════════════════════════════════
//  PAINEL - GUILDS
// ════════════════════════════════════════════════════════════════
app.get('/painel/guilds', autenticado, async (req, res) => {
  try {
    const guilds = req.usuario.guilds;
    const resultado = await Promise.all(guilds.map(async g => {
      const config = await getConfig(g.id);
      return {
        id: g.id, nome: g.name,
        icone: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
        config: {
          ip: config.ip || null, porta: config.porta || 25565,
          nome_servidor: config.nome_servidor || 'Meu Servidor',
          cor_embed: config.cor_embed || '#5865F2',
          canal_alertas: config.canal_alertas || null,
          cargo_admin: config.cargo_admin || null,
        }
      };
    }));
    res.json(resultado);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/painel/guild/:id', autenticado, async (req, res) => {
  const { id } = req.params;
  if (!req.usuario.guilds.some(g => g.id === id))
    return res.status(403).json({ erro: 'Sem acesso a este servidor.' });
  try {
    const config = await getConfig(id);
    const guild  = req.usuario.guilds.find(g => g.id === id);
    res.json({
      id, nome: guild.name,
      icone: guild.icon ? `https://cdn.discordapp.com/icons/${id}/${guild.icon}.png` : null,
      config: {
        ip: config.ip || '', porta: config.porta || 25565,
        nome_servidor: config.nome_servidor || 'Meu Servidor',
        cor_embed: config.cor_embed || '#5865F2',
        canal_alertas: config.canal_alertas || '',
        cargo_admin: config.cargo_admin || '',
      }
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/painel/guild/:id/save', autenticado, async (req, res) => {
  const { id } = req.params;
  if (!req.usuario.guilds.some(g => g.id === id))
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
    res.json({ sucesso: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.use((req, res) => res.status(404).json({ erro: 'Rota nao encontrada.' }));

app.listen(PORT, () => console.log(`✅ API Minecraft v2.1 rodando na porta ${PORT}`));
