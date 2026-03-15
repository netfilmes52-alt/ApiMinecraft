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

// ─── INFO DO JOGADOR ────────────────────────────────────────────
app.get('/player/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { data } = await axios.get(
      `https://playerdb.co/api/player/minecraft/${username}`,
      { timeout: 10000 }
    );

    if (!data.success) {
      return res.status(404).json({ erro: 'Jogador não encontrado.' });
    }

    const player = data.data.player;

    res.json({
      username: player.username,
      uuid: player.id,
      uuid_sem_hifen: player.raw_id,
      skin_url: `https://crafatar.com/renders/body/${player.id}?overlay`,
      avatar_url: `https://crafatar.com/avatars/${player.id}?overlay`,
      head_url: `https://crafatar.com/renders/head/${player.id}?overlay`,
      historico_nomes: player.meta?.name_history || []
    });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao buscar jogador.', detalhe: err.message });
  }
});

// ─── REDIRECIONA PARA SKIN (imagem) ─────────────────────────────
app.get('/skin/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { data } = await axios.get(
      `https://playerdb.co/api/player/minecraft/${username}`,
      { timeout: 10000 }
    );

    if (!data.success) return res.status(404).json({ erro: 'Jogador não encontrado.' });

    const uuid = data.data.player.id;
    res.redirect(`https://crafatar.com/renders/body/${uuid}?overlay`);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao buscar skin.', detalhe: err.message });
  }
});

// ─── REDIRECIONA PARA AVATAR (rosto) ────────────────────────────
app.get('/avatar/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { data } = await axios.get(
      `https://playerdb.co/api/player/minecraft/${username}`,
      { timeout: 10000 }
    );

    if (!data.success) return res.status(404).json({ erro: 'Jogador não encontrado.' });

    const uuid = data.data.player.id;
    res.redirect(`https://crafatar.com/avatars/${uuid}?overlay&size=128`);
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
