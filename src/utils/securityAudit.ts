import { evaluatePassphraseStrength } from '../crypto/vaultCrypto';
import { normalizeBase32 } from '../crypto/totp';
import type { StorageSyncResult, VaultPayload } from '../types/vault';

export interface SecurityAuditFinding {
  id: string;
  severity: 'high' | 'medium' | 'low' | 'ok';
  title: string;
  description: string;
  affectedAccounts?: string[];
}

export interface SecurityAuditReport {
  score: number;
  findings: SecurityAuditFinding[];
  totalAccounts: number;
  accountsWithRecovery: number;
}

export function runVaultSecurityAudit(
  vault: VaultPayload,
  passphrase: string,
  syncStatus: StorageSyncResult | null
): SecurityAuditReport {
  const findings: SecurityAuditFinding[] = [];
  let deductions = 0;

  // 1. Passphrase strength check (skip score deduction when unlocked via non-extractable trusted CryptoKey)
  if (passphrase) {
    const strength = evaluatePassphraseStrength(passphrase);
    if (strength.score <= 1) {
      deductions += 30;
      findings.push({
        id: 'weak-passphrase',
        severity: 'high',
        title: 'マスターパスフレーズが脆弱です',
        description: `現在の推定エントロピーは ${strength.entropyBits} bits です。12文字以上の大文字・小文字・数字・記号を含むパスフレーズに変更することを推奨します。`,
      });
    } else if (strength.score === 2) {
      deductions += 12;
      findings.push({
        id: 'moderate-passphrase',
        severity: 'medium',
        title: 'マスターパスフレーズの強度をさらに上げられます',
        description: `推定エントロピーは ${strength.entropyBits} bits です。14文字以上のパスフレーズにすると総当たり耐性が向上します。`,
      });
    } else {
      findings.push({
        id: 'strong-passphrase',
        severity: 'ok',
        title: 'マスターパスフレーズ強度は良好です',
        description: `PBKDF2-HMAC-SHA256 (600,000反復) と AES-256-GCM により保護されています (推定 ${strength.entropyBits} bits)。`,
      });
    }
  } else {
    findings.push({
      id: 'trusted-key-unlock',
      severity: 'ok',
      title: '信頼済みブラウザ鍵で暗号化保護されています',
      description: 'PBKDF2-HMAC-SHA256 (600,000反復) で導出された非抽出型 AES-256-GCM CryptoKey により保護されています。',
    });
  }

  // 2. Duplicate secret detection
  const secretMap = new Map<string, string[]>();
  for (const acc of vault.accounts) {
    const norm = normalizeBase32(acc.secret);
    const list = secretMap.get(norm) ?? [];
    list.push(`${acc.issuer} (${acc.label})`);
    secretMap.set(norm, list);
  }
  const duplicateGroups = Array.from(secretMap.values()).filter((g) => g.length > 1);
  if (duplicateGroups.length > 0) {
    deductions += 20;
    findings.push({
      id: 'duplicate-secrets',
      severity: 'high',
      title: '重複したシークレットキーが検出されました',
      description: '複数のアカウントで同一のシークレットキーが使用されています。サービスごとに固有のシークレットを再発行してください。',
      affectedAccounts: duplicateGroups.flat(),
    });
  }

  // 3. Recovery codes check
  const missingRecovery = vault.accounts.filter(
    (a) => !a.recoveryCodes || a.recoveryCodes.filter((c) => !c.used).length === 0
  );
  const accountsWithRecovery = vault.accounts.length - missingRecovery.length;
  if (vault.accounts.length > 0 && missingRecovery.length > 0) {
    deductions += Math.min(18, missingRecovery.length * 4);
    findings.push({
      id: 'missing-recovery-codes',
      severity: 'medium',
      title: `${missingRecovery.length}件のアカウントに未使用リカバリーコードがありません`,
      description: '端末紛失時のロックアウトを防ぐため、各サービスが発行する緊急用リカバリーコードをボルト内に保存してください。',
      affectedAccounts: missingRecovery.map((a) => `${a.issuer} (${a.label})`),
    });
  } else if (vault.accounts.length > 0) {
    findings.push({
      id: 'recovery-ok',
      severity: 'ok',
      title: 'すべてのアカウントにリカバリーコードが登録されています',
      description: '緊急時バックアップの準備が整っています。',
    });
  }

  // 4. Auto-lock check
  if (vault.autoLockMinutes === 0 || vault.autoLockMinutes > 15) {
    deductions += 10;
    findings.push({
      id: 'autolock-disabled',
      severity: 'medium',
      title: '自動ロックが無効または長時間に設定されています',
      description: '離席時の不正アクセスを防ぐため、自動ロックを 1〜15分 に設定することを推奨します。',
    });
  } else {
    findings.push({
      id: 'autolock-ok',
      severity: 'ok',
      title: `自動ロック有効 (${vault.autoLockMinutes}分)`,
      description: '一定時間操作がない場合、メモリ上の復号済みキーを自動的に破棄します。',
    });
  }

  // 5. SHA-1 informational notice
  const sha1Accounts = vault.accounts.filter((a) => a.algorithm === 'SHA-1');
  if (sha1Accounts.length > 0) {
    findings.push({
      id: 'sha1-info',
      severity: 'low',
      title: `${sha1Accounts.length}件のアカウントが SHA-1 を使用しています`,
      description: '多くのサービスは標準でSHA-1を採用しています(RFC 6238準拠)。サービス側がSHA-256に対応している場合は移行をご検討ください。',
      affectedAccounts: sha1Accounts.map((a) => `${a.issuer} (${a.label})`),
    });
  }

  // 6. Redundant encrypted persistence check
  if (syncStatus?.savedTo === 'cloud+cookie' || syncStatus?.savedTo === 'server+cookie') {
    findings.push({
      id: 'redundant-sync',
      severity: 'ok',
      title:
        syncStatus.savedTo === 'cloud+cookie'
          ? 'Googleクラウド(Firestore)＋暗号化Cookieの二重保存が有効です'
          : 'サーバー＋暗号化Cookieの二重保存が有効です',
      description: '暗号化データはクラウド/サーバーとブラウザCookieの両方に同期されており、他端末からのアクセスやオフライン時でも利用できます。',
    });
  } else if (syncStatus?.savedTo === 'cookie-only') {
    deductions += 5;
    findings.push({
      id: 'cookie-only-sync',
      severity: 'low',
      title: '暗号化Cookieのみで保存されています',
      description: 'ブラウザのCookie削除でデータが失われる可能性があるため、Googleクラウド同期または暗号化バックアップファイルのエクスポートを推奨します。',
    });
  }

  const score = Math.max(0, Math.min(100, 100 - deductions));

  return {
    score,
    findings,
    totalAccounts: vault.accounts.length,
    accountsWithRecovery,
  };
}
