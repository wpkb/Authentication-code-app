export interface BrowserAutofillCapabilities {
  autocompleteOtp: boolean;
  clipboardWrite: boolean;
  clipboardRead: boolean;
  credentialManagement: boolean;
  passwordCredential: boolean;
  webOtp: boolean;
  broadcastChannel: boolean;
}

export interface AutofillOtpPayload {
  accountId: string;
  issuer: string;
  label: string;
  code: string;
  loginUrl?: string;
  timestamp: number;
}

const CHANNEL_NAME = 'kagivault-autofill-v1';
const WINDOW_EVENT_NAME = 'kagivault:autofill-otp';

const KNOWN_SERVICE_URLS: Array<[RegExp, string]> = [
  [/github/i, 'https://github.com/login'],
  [/aws|amazon/i, 'https://signin.aws.amazon.com/'],
  [/google|gmail|workspace/i, 'https://accounts.google.com/'],
  [/cloudflare/i, 'https://dash.cloudflare.com/login'],
  [/stripe/i, 'https://dashboard.stripe.com/login'],
  [/microsoft|azure|office|entra/i, 'https://login.microsoftonline.com/'],
  [/discord/i, 'https://discord.com/login'],
  [/slack/i, 'https://slack.com/signin'],
  [/x\.com|twitter/i, 'https://x.com/i/flow/login'],
  [/npm/i, 'https://www.npmjs.com/login'],
  [/vercel/i, 'https://vercel.com/login'],
  [/supabase/i, 'https://supabase.com/dashboard/sign-in'],
  [/firebase/i, 'https://console.firebase.google.com/'],
];

export function inferServiceLoginUrl(issuer: string, customLoginUrl?: string): string | null {
  const trimmed = customLoginUrl?.trim();
  if (trimmed) {
    try {
      const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.toString();
      }
    } catch {
      return null;
    }
  }
  for (const [pattern, url] of KNOWN_SERVICE_URLS) {
    if (pattern.test(issuer)) {
      return url;
    }
  }
  return null;
}

export function extractDomainLabel(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function detectBrowserAutofillCapabilities(): BrowserAutofillCapabilities {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      autocompleteOtp: true,
      clipboardWrite: false,
      clipboardRead: false,
      credentialManagement: false,
      passwordCredential: false,
      webOtp: false,
      broadcastChannel: false,
    };
  }

  return {
    autocompleteOtp: true,
    clipboardWrite: Boolean(navigator.clipboard?.writeText),
    clipboardRead: Boolean(navigator.clipboard?.readText),
    credentialManagement:
      'credentials' in navigator && typeof navigator.credentials?.get === 'function',
    passwordCredential: 'PasswordCredential' in window,
    webOtp: 'OTPCredential' in window,
    broadcastChannel: typeof BroadcastChannel !== 'undefined',
  };
}

export async function writeOtpToClipboard(code: string): Promise<boolean> {
  if (!code) return false;
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = code;
      el.setAttribute('readonly', 'true');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Sets an <input> element's value via the native HTMLInputElement prototype setter
 * so React/Vue/Angular controlled inputs receive real input & change events.
 */
export function fillOtpIntoElement(input: HTMLInputElement, code: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  );
  if (descriptor?.set) {
    descriptor.set.call(input, code);
  } else {
    input.value = code;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function broadcastAutofillOtp(
  payload: Omit<AutofillOtpPayload, 'timestamp'>
): Promise<{ clipboardOk: boolean; payload: AutofillOtpPayload }> {
  const fullPayload: AutofillOtpPayload = {
    ...payload,
    timestamp: Date.now(),
  };

  const clipboardOk = await writeOtpToClipboard(payload.code);

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(CHANNEL_NAME);
      ch.postMessage(fullPayload);
      ch.close();
    }
  } catch {
    // ignore BroadcastChannel restrictions
  }

  try {
    window.dispatchEvent(
      new CustomEvent<AutofillOtpPayload>(WINDOW_EVENT_NAME, { detail: fullPayload })
    );
  } catch {
    // ignore
  }

  return { clipboardOk, payload: fullPayload };
}

export function subscribeAutofillOtp(
  onReceive: (payload: AutofillOtpPayload) => void
): () => void {
  const onWindowEvent = (ev: Event) => {
    const custom = ev as CustomEvent<AutofillOtpPayload>;
    if (custom.detail?.code) {
      onReceive(custom.detail);
    }
  };
  window.addEventListener(WINDOW_EVENT_NAME, onWindowEvent);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (ev: MessageEvent<AutofillOtpPayload>) => {
        if (ev.data?.code) {
          onReceive(ev.data);
        }
      };
    } catch {
      channel = null;
    }
  }

  return () => {
    window.removeEventListener(WINDOW_EVENT_NAME, onWindowEvent);
    channel?.close();
  };
}

/**
 * Registers an account's login identifier via the Browser Credential Management API
 * (PasswordCredential) when supported in Chromium-based browsers so the browser's
 * native autofill picker recognizes the service.
 */
export async function syncAccountWithCredentialApi(params: {
  id: string;
  name: string;
  otpCode: string;
}): Promise<{ supported: boolean; stored: boolean; reason?: string }> {
  if (
    typeof window === 'undefined' ||
    !('credentials' in navigator) ||
    !('PasswordCredential' in window)
  ) {
    return {
      supported: false,
      stored: false,
      reason: 'このブラウザは PasswordCredential (Autofill Store) API に対応していません。',
    };
  }

  try {
    const PasswordCredCtor = (
      window as unknown as {
        PasswordCredential: new (data: {
          id: string;
          name: string;
          password: string;
        }) => Credential;
      }
    ).PasswordCredential;

    const cred = new PasswordCredCtor({
      id: params.id,
      name: params.name,
      password: params.otpCode,
    });
    await navigator.credentials.store(cred);
    return { supported: true, stored: true };
  } catch (err) {
    return {
      supported: true,
      stored: false,
      reason:
        err instanceof Error
          ? err.message
          : 'ブラウザの自動入力ストアへの登録が拒否されました。',
    };
  }
}

/**
 * Listens for a one-time code via the browser WebOTP API (OTPCredential).
 */
export async function listenWebOtpCredential(
  signal: AbortSignal
): Promise<{ supported: boolean; code?: string; error?: string }> {
  if (
    typeof window === 'undefined' ||
    !('OTPCredential' in window) ||
    !navigator.credentials?.get
  ) {
    return {
      supported: false,
      error: 'WebOTP (OTPCredential) API はこのブラウザ環境では利用できません。',
    };
  }

  try {
    const cred = (await navigator.credentials.get({
      otp: { transport: ['sms'] },
      signal,
    } as unknown as CredentialRequestOptions)) as ({ code?: string } | null);

    if (cred?.code) {
      return { supported: true, code: cred.code };
    }
    return { supported: true, error: 'コードを取得できませんでした。' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { supported: true, error: 'WebOTP 待機をキャンセルしました。' };
    }
    return {
      supported: true,
      error:
        err instanceof Error
          ? err.message
          : 'WebOTP API による取得がタイムアウトまたは拒否されました。',
    };
  }
}

/**
 * Builds a single-tap JavaScript bookmarklet that detects OTP inputs
 * (`autocomplete="one-time-code"`, common 2FA field attributes, or 6-digit boxes),
 * reads the live OTP code copied from KagiVault, and injects it natively.
 */
export function buildAutofillBookmarkletCode(): string {
  const script = `
(async () => {
  const setVal = (el, val) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (d && d.set) d.set.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.style.outline = '2px solid #2563eb';
    setTimeout(() => { el.style.outline = ''; }, 1400);
  };
  let raw = '';
  try {
    raw = (await navigator.clipboard.readText()).replace(/\\s+/g, '');
  } catch (e) {}
  if (!/^\\d{4,10}$/.test(raw)) {
    const entered = window.prompt('KagiVaultのワンタイムコード(数字)を入力してください:', raw || '');
    if (!entered) return;
    raw = entered.replace(/\\s+/g, '');
  }
  const visible = (el) => el && !el.disabled && el.offsetParent !== null;
  const primary = Array.from(document.querySelectorAll('input[autocomplete="one-time-code"],input[name*="otp" i],input[id*="otp" i],input[name*="totp" i],input[id*="totp" i],input[name*="2fa" i],input[id*="2fa" i],input[name*="mfa" i],input[id*="mfa" i],input[inputmode="numeric"]')).filter(visible);
  const splitBoxes = primary.filter((el) => el.maxLength === 1);
  if (splitBoxes.length >= raw.length) {
    splitBoxes.slice(0, raw.length).forEach((box, idx) => setVal(box, raw[idx]));
    return;
  }
  const target = primary[0] || (document.activeElement && document.activeElement.tagName === 'INPUT' ? document.activeElement : null);
  if (target) {
    target.focus();
    setVal(target, raw);
  }
})();
`
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return `javascript:${encodeURIComponent(script)}`;
}
