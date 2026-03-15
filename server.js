
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mcData = require('minecraft-data')('1.20.1');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ════════════════════════════════════════════════
//  HELPER
// ════════════════════════════════════════════════
async function get(url, timeout = 10000) {
  const res = await axios.get(url, { timeout });
  return res.data;
}

function formatUUID(raw) {
  return raw.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

// ════════════════════════════════════════════════
//  ROTA RAIZ
// ════════════════════════════════════════════════
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
    }
  });
});

// ════════════════════════════════════════════════
//  PING
// ════════════════════════════════════════════════
app.get('/ping', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// ════════════════════════════════════════════════
//  SERVIDOR MINECRAFT (mcsrvstat.us v3)
// ════════════════════════════════════════════════
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

    const data = await get(endpoint);

    if (!data.online) {
      return res.json({
        online: false,
        ip,
        porta: porta || 25565,
        mensagem: 'Servidor offline ou não encontrado.'
      });
    }

    res.json({
      online: true,
      ip,
      porta: porta || data.port || 25565,
      motd: data.motd?.clean?.join(' ') || 'Sem descrição',
      jogadores: {
        online: data.players?.online || 0,
        max:    data.players?.max    || 0,
        lista:  data.players?.list   || []
      },
      versao:   data.version  || 'Desconhecida',
      software: data.software || null,
      icone:    data.icon     || null,
      mods:     data.mods?.length    ? `${data.mods.length} mods`       : null,
      plugins:  data.plugins?.length ? `${data.plugins.length} plugins` : null,
      srv:      data.srv || null
    });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao consultar servidor.', detalhe: err.message });
  }
}

// ════════════════════════════════════════════════
//  JOGADOR COMPLETO
// ════════════════════════════════════════════════
app.get('/player/:username', async (req, res) => {
  try {
    const { username } = req.params;

    const profile = await get(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (!profile?.id) return res.status(404).json({ erro: 'Jogador não encontrado.' });

    const raw  = profile.id;
    const uuid = formatUUID(raw);
    const nome = profile.name;

    let nomes = [];
    try {
      const ashcon = await get(`https://api.ashcon.app/mojang/v2/user/${username}`);
      nomes = ashcon.username_history?.map(h => ({
        nome: h.username,
        desde: h.changed_at || 'nome original'
      })) || [];
    } catch (_) {}

    res.json({
      username: nome,
      uuid,
      uuid_sem_hifen: raw,
      skin_url:    `https://crafatar.com/renders/body/${uuid}?overlay`,
      avatar_url:  `https://crafatar.com/avatars/${uuid}?overlay`,
      head_url:    `https://crafatar.com/renders/head/${uuid}?overlay`,
      cape_url:    `https://crafatar.com/capes/${uuid}`,
      mcheads_url: `https://mc-heads.net/avatar/${uuid}/100`,
      historico_nomes: nomes
    });

  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ erro: 'Jogador não encontrado.' });
    res.status(500).json({ erro: 'Falha ao buscar jogador.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════════
//  SOMENTE UUID
// ════════════════════════════════════════════════
app.get('/uuid/:username', async (req, res) => {
  try {
    const data = await get(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`);
    if (!data?.id) return res.status(404).json({ erro: 'Jogador não encontrado.' });
    res.json({ username: data.name, uuid: formatUUID(data.id), uuid_sem_hifen: data.id });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ erro: 'Jogador não encontrado.' });
    res.status(500).json({ erro: err.message });
  }
});

// ════════════════════════════════════════════════
//  HISTÓRICO DE NOMES (Ashcon)
// ════════════════════════════════════════════════
app.get('/names/:username', async (req, res) => {
  try {
    const data = await get(`https://api.ashcon.app/mojang/v2/user/${req.params.username}`);
    res.json({
      username: data.username,
      uuid: data.uuid,
      historico: data.username_history?.map(h => ({
        nome: h.username,
        desde: h.changed_at || 'nome original'
      })) || []
    });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ erro: 'Jogador não encontrado.' });
    res.status(500).json({ erro: err.message });
  }
});

// ════════════════════════════════════════════════
//  SESSÃO / SKIN URL DIRETA
// ════════════════════════════════════════════════
app.get('/session/:uuid', async (req, res) => {
  try {
    const data = await get(`https://sessionserver.mojang.com/session/minecraft/profile/${req.params.uuid}`);
    const prop = data.properties?.find(p => p.name === 'textures');
    let textures = null;
    if (prop) {
      const decoded = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
      textures = decoded.textures;
    }
    res.json({ username: data.name, uuid: req.params.uuid, textures });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao buscar sessão.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════════
//  SKIN → redireciona (Crafatar)
// ════════════════════════════════════════════════
app.get('/skin/:username', async (req, res) => {
  try {
    const data = await get(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`);
    if (!data?.id) return res.status(404).json({ erro: 'Jogador não encontrado.' });
    res.redirect(`https://crafatar.com/renders/body/${formatUUID(data.id)}?overlay`);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ════════════════════════════════════════════════
//  AVATAR → redireciona (mc-heads.net)
// ════════════════════════════════════════════════
app.get('/avatar/:username', async (req, res) => {
  try {
    const data = await get(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`);
    if (!data?.id) return res.status(404).json({ erro: 'Jogador não encontrado.' });
    res.redirect(`https://mc-heads.net/avatar/${data.id}/128`);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ════════════════════════════════════════════════
//  HEAD → redireciona (mc-heads.net)
// ════════════════════════════════════════════════
app.get('/head/:username', async (req, res) => {
  try {
    const data = await get(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`);
    if (!data?.id) return res.status(404).json({ erro: 'Jogador não encontrado.' });
    res.redirect(`https://mc-heads.net/head/${data.id}/128`);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ════════════════════════════════════════════════
//  CAPE → redireciona (Crafatar)
// ════════════════════════════════════════════════
app.get('/cape/:username', async (req, res) => {
  try {
    const data = await get(`https://api.mojang.com/users/profiles/minecraft/${req.params.username}`);
    if (!data?.id) return res.status(404).json({ erro: 'Jogador não encontrado.' });
    res.redirect(`https://crafatar.com/capes/${formatUUID(data.id)}`);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ════════════════════════════════════════════════
//  ITEM (minecraft-data local, sem API externa)
// ════════════════════════════════════════════════
app.get('/item/:nome', (req, res) => {
  try {
    const nome = req.params.nome.toLowerCase().replace(/ /g, '_');
    const item = mcData.itemsByName[nome];

    if (!item) return res.status(404).json({ erro: 'Item não encontrado.' });

    // Tenta pegar receita de craft
    const receitas = mcData.recipes?.[item.id] || null;

    res.json({
      id:         item.id,
      nome:       item.name,
      display:    item.displayName,
      stackSize:  item.stackSize,
      receitas:   receitas ? receitas.length + ' receita(s) disponível(is)' : 'Sem receita',
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ════════════════════════════════════════════════
//  404
// ════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// ════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`✅ API Minecraft v2 rodando na porta ${PORT}`);
});
