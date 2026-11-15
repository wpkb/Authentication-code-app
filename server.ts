import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data', 'vaults');
const VAULT_ID_REGEX = /^[a-zA-Z0-9_-]{3,48}$/;
const MAX_ENVELOPE_BYTES = 1024 * 1024; // 1 MB limit per encrypted vault

interface EnvelopeBody {
  version: number;
  vaultId: string;
  kdf: string;
  iterations: number;
  cipher: string;
  salt: string;
  iv: string;
  ciphertext: string;
  checksum: string;
  updatedAt: string;
  revision: number;
}

function isValidEnvelope(obj: unknown, expectedVaultId: string): obj is EnvelopeBody {
  if (!obj || typeof obj !== 'object') return false;
  const e = obj as Record<string, unknown>;
  return (
    e.version === 1 &&
    e.vaultId === expectedVaultId &&
    e.kdf === 'PBKDF2-SHA256' &&
    typeof e.iterations === 'number' &&
    e.iterations >= 1000 &&
    e.cipher === 'AES-256-GCM' &&
    typeof e.salt === 'string' &&
    e.salt.length > 0 &&
    typeof e.iv === 'string' &&
    e.iv.length > 0 &&
    typeof e.ciphertext === 'string' &&
    e.ciphertext.length > 0 &&
    typeof e.checksum === 'string' &&
    e.checksum.length === 64 &&
    typeof e.updatedAt === 'string' &&
    typeof e.revision === 'number'
  );
}

async function ensureDataDir(): Promise<boolean> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.access(DATA_DIR, fs.constants.W_OK | fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function getVaultFilePath(vaultId: string): string {
  return path.join(DATA_DIR, `${vaultId}.json`);
}

async function startServer() {
  const app = express();
  const writable = await ensureDataDir();

  app.use(express.json({ limit: '1mb' }));

  // Baseline security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const canWrite = await ensureDataDir();
    res.json({
      ok: canWrite,
      storage: 'server-fs',
      writable: canWrite,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/vaults', async (_req, res) => {
    try {
      await ensureDataDir();
      const files = await fs.readdir(DATA_DIR);
      const vaults: Array<{ vaultId: string; updatedAt: string; revision: number }> = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const vaultId = file.slice(0, -5);
        if (!VAULT_ID_REGEX.test(vaultId)) continue;
        try {
          const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf8');
          const parsed = JSON.parse(raw) as EnvelopeBody;
          vaults.push({
            vaultId: parsed.vaultId,
            updatedAt: parsed.updatedAt,
            revision: parsed.revision ?? 1,
          });
        } catch {
          // skip unreadable file
        }
      }

      vaults.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      res.json({ vaults });
    } catch {
      res.status(500).json({ error: 'ボルト一覧の取得に失敗しました。' });
    }
  });

  app.get('/api/vaults/:vaultId', async (req, res) => {
    const { vaultId } = req.params;
    if (!VAULT_ID_REGEX.test(vaultId)) {
      res.status(400).json({ error: '不正なボルトID形式です。' });
      return;
    }

    try {
      const filePath = getVaultFilePath(vaultId);
      const raw = await fs.readFile(filePath, 'utf8');
      const envelope = JSON.parse(raw) as EnvelopeBody;
      res.json({ exists: true, envelope });
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        res.status(404).json({ exists: false, error: 'ボルトが見つかりません。' });
        return;
      }
      res.status(500).json({ error: 'ボルトの読み込みに失敗しました。' });
    }
  });

  app.put('/api/vaults/:vaultId', async (req, res) => {
    const { vaultId } = req.params;
    if (!VAULT_ID_REGEX.test(vaultId)) {
      res.status(400).json({ error: 'ボルトIDは半角英数字とハイフン・アンダースコア(3〜48文字)のみ使用できます。' });
      return;
    }

    const envelope = req.body?.envelope;
    if (!isValidEnvelope(envelope, vaultId)) {
      res.status(400).json({ error: '暗号化エンベロープの形式が不正です。' });
      return;
    }

    const serialized = JSON.stringify(envelope);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_ENVELOPE_BYTES) {
      res.status(413).json({ error: 'ボルトサイズが上限(1MB)を超えています。' });
      return;
    }

    try {
      await ensureDataDir();
      const targetPath = getVaultFilePath(vaultId);
      const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tempPath, targetPath);

      res.json({
        saved: true,
        vaultId,
        revision: envelope.revision,
        updatedAt: envelope.updatedAt,
      });
    } catch {
      res.status(500).json({ error: 'サーバーへの暗号化保存に失敗しました。' });
    }
  });

  app.delete('/api/vaults/:vaultId', async (req, res) => {
    const { vaultId } = req.params;
    if (!VAULT_ID_REGEX.test(vaultId)) {
      res.status(400).json({ error: '不正なボルトID形式です。' });
      return;
    }

    try {
      await fs.unlink(getVaultFilePath(vaultId));
      res.json({ deleted: true });
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        res.json({ deleted: true });
        return;
      }
      res.status(500).json({ error: 'ボルトの削除に失敗しました。' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `KagiVault server listening on http://0.0.0.0:${PORT} (storage writable: ${writable})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
