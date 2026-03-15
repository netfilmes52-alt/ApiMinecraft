const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── ROTA RAIZ ──────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'Minecraft API',
    version: '1.0.0',
    rotas: {
      servidor: '/server/:ip',
      servidor_com_porta: '/server/:ip/:porta',
      jogador: '/player/:username',
      skin: '/skin/:username',
      avatar: '/avatar/:username',
      ping: '/ping'
    }
  });
});

// ─── PING ───────────────────────────────────────────────────────
app.get('/ping', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// ─── INFO DO SERVIDOR MINECRAFT ─────────────────────────────────
app.get('/server/:ip', async (req, res) => {
  await getServerInfo(req, res, req.params.ip, null);
});

app.get('/server/:ip/:porta', async (req, res) => {
  await getServerInfo(req, res, req.params.ip, req.params.porta);
});

async function getServerInfo(req, res, ip, porta) {
  try {
    const endpoint = porta
      ? `https://api.mcsrvstat.us/2/${ip}:${porta}`
      : `https://api.mcsrvstat.us/2/${ip}`;

    const { data } = await axios.get(endpoint, { timeout: 10000 });

    if (!data.online) {
      return res.status(200).json({
        online: false,
        ip: ip,
        porta: porta || 25565,
        mensagem: 'Servidor offline ou não encontrado.'
      });
    }

    res.json({
      online: true,
      ip: ip,
      porta: porta || data.port || 25565,
      motd: data.motd?.clean?.join(' ') || 'Sem descrição',
      jogadores: {
        online: data.players?.online || 0,
        max: data.players?.max || 0,
        lista: data.players?.list || []
      },
      versao: data.version || 'Desconhecida',
      software: data.software || null,
      icone: data.icon || null,
      mods: data.mods?.length ? data.mods.length + ' mods' : null,
      plugins: data.plugins?.length ? data.plugins.length + ' plugins' : null
    });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao consultar o servidor.', detalhe: err.message });
  }
}

// ─── INFO DO JOGADOR (API oficial Mojang) ───────────────────────
app.get('/player/:username', async (req, res) => {
  try {
    const { username } = req.params;

    const profileRes = await axios.get(
      `https://api.mojang.com/users/profiles/minecraft/${username}`,
      { timeout: 10000 }
    );

    if (!profileRes.data || !profileRes.data.id) {
      return res.status(404).json({ erro: 'Jogador não encontrado.' });
    }

    const uuid_sem_hifen = profileRes.data.id;
    const nome = profileRes.data.name;

    const uuid = uuid_sem_hifen.replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
      '$1-$2-$3-$4-$5'
    );

    res.json({
      username: nome,
      uuid: uuid,
      uuid_sem_hifen: uuid_sem_hifen,
      skin_url: `https://crafatar.com/renders/body/${uuid}?overlay`,
      avatar_url: `https://crafatar.com/avatars/${uuid}?overlay`,
      head_url: `https://crafatar.com/renders/head/${uuid}?overlay`,
      cape_url: `https://crafatar.com/capes/${uuid}`
    });

  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ erro: 'Jogador não encontrado.' });
    }
    res.status(500).json({ erro: 'Falha ao buscar jogador.', detalhe: err.message });
  }
});

// ─── REDIRECIONA PARA SKIN (corpo) ──────────────────────────────
app.get('/skin/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { data } = await axios.get(
      `https://api.mojang.com/users/profiles/minecraft/${username}`,
      { timeout: 10000 }
    );

    if (!data?.id) return res.status(404).json({ erro: 'Jogador não encontrado.' });

    res.redirect(`https://crafatar.com/renders/body/${data.id}?overlay`);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao buscar skin.', detalhe: err.message });
  }
});

// ─── REDIRECIONA PARA AVATAR (rosto) ────────────────────────────
app.get('/avatar/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { data } = await axios.get(
      `https://api.mojang.com/users/profiles/minecraft/${username}`,
      { timeout: 10000 }
    );

    if (!data?.id) return res.status(404).json({ erro: 'Jogador não encontrado.' });

    res.redirect(`https://crafatar.com/avatars/${data.id}?overlay&size=128`);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao buscar avatar.', detalhe: err.message });
  }
});

// ─── 404 ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// ─── START ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ API Minecraft rodando na porta ${PORT}`);
});
