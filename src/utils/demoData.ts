import type { TotpAccount, VaultPayload } from '../types/vault';

export function createDemoAccounts(): TotpAccount[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'demo-github',
      issuer: 'GitHub',
      label: 'engineer@example.jp',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA-1',
      digits: 6,
      period: 30,
      folder: 'クラウド開発',
      favorite: true,
      loginUrl: 'https://github.com/login',
      note: '組織リポジトリ管理用アカウント',
      recoveryCodes: [
        { code: '8492a-19c04', used: false },
        { code: '3f7b2-90e11', used: false },
        { code: 'c12d8-44a79', used: true },
        { code: '7e09f-65b32', used: false },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-aws',
      issuer: 'AWS Console',
      label: 'root-admin@corp.jp',
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      algorithm: 'SHA-256',
      digits: 6,
      period: 30,
      folder: 'クラウド開発',
      favorite: true,
      loginUrl: 'https://signin.aws.amazon.com/',
      note: '本番環境IAMルートMFA',
      recoveryCodes: [
        { code: 'AWS-BK-9921-4401', used: false },
        { code: 'AWS-BK-3108-7752', used: false },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-google',
      issuer: 'Google Workspace',
      label: 'admin@kagivault-demo.jp',
      secret: 'NB2W45DFOIZA====',
      algorithm: 'SHA-1',
      digits: 6,
      period: 30,
      folder: '仕事',
      favorite: false,
      loginUrl: 'https://accounts.google.com/',
      note: '社内メール・SSO管理者',
      recoveryCodes: [
        { code: '4920 1834', used: false },
        { code: '7712 9045', used: false },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-cloudflare',
      issuer: 'Cloudflare',
      label: 'dns-ops@example.jp',
      secret: 'KRSXG5CTMVRXEZLU',
      algorithm: 'SHA-1',
      digits: 6,
      period: 30,
      folder: 'クラウド開発',
      favorite: false,
      loginUrl: 'https://dash.cloudflare.com/login',
      note: 'DNS・WAF管理用',
      recoveryCodes: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-stripe',
      issuer: 'Stripe',
      label: 'billing@example.jp',
      secret: 'MFRGGZDFMZTWQ2LK',
      algorithm: 'SHA-256',
      digits: 8,
      period: 30,
      folder: '決済管理',
      favorite: false,
      loginUrl: 'https://dashboard.stripe.com/login',
      note: '8桁TOTP・決済ダッシュボード',
      recoveryCodes: [
        { code: 'st-rec-8812-ab09', used: false },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function createDemoVaultPayload(vaultId = 'demo-vault'): VaultPayload {
  const now = new Date().toISOString();
  return {
    vaultId,
    vaultName: 'デモ用セキュリティボルト',
    accounts: createDemoAccounts(),
    autoLockMinutes: 15,
    createdAt: now,
    updatedAt: now,
  };
}
