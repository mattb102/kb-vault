import crypto from "crypto";
import { readFileSync } from "fs";

const KEY_FILE = process.env.COINBASE_KEY_FILE || "";

interface KeyConfig {
  kid: string;
  key: crypto.KeyObject;
  alg: "ES256" | "EdDSA";
}

let cachedConfig: KeyConfig | null = null;

// PKCS8 DER prefix for an Ed25519 private key — followed by the 32-byte seed.
const ED25519_PKCS8_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex"
);

function loadKeyConfig(): KeyConfig {
  if (cachedConfig) return cachedConfig;
  if (!KEY_FILE) {
    throw new Error("Coinbase not configured — set COINBASE_KEY_FILE.");
  }
  const raw = JSON.parse(readFileSync(KEY_FILE, "utf8"));

  if (raw.name && typeof raw.privateKey === "string" && raw.privateKey.includes("BEGIN")) {
    cachedConfig = {
      kid: raw.name,
      key: crypto.createPrivateKey(raw.privateKey),
      alg: "ES256",
    };
  } else if (raw.id && typeof raw.privateKey === "string") {
    const decoded = Buffer.from(raw.privateKey, "base64");
    const seed = decoded.subarray(0, 32);
    const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
    cachedConfig = {
      kid: raw.id,
      key: crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }),
      alg: "EdDSA",
    };
  } else {
    throw new Error("Coinbase key file format not recognized.");
  }
  return cachedConfig;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function buildJwt(method: string, path: string): string {
  const cfg = loadKeyConfig();
  const header = {
    alg: cfg.alg,
    kid: cfg.kid,
    nonce: crypto.randomBytes(16).toString("hex"),
    typ: "JWT",
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "cdp",
    sub: cfg.kid,
    nbf: now,
    exp: now + 120,
    uri: `${method} api.coinbase.com${path}`,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(payload)
  )}`;

  let sig: Buffer;
  if (cfg.alg === "ES256") {
    // ieee-p1363 produces raw r||s — what JWT ES256 expects (not DER).
    sig = crypto.sign("SHA256", Buffer.from(signingInput), {
      key: cfg.key,
      dsaEncoding: "ieee-p1363",
    });
  } else {
    // Ed25519 has its own internal hash; pass null algorithm.
    sig = crypto.sign(null, Buffer.from(signingInput), cfg.key);
  }
  return `${signingInput}.${b64url(sig)}`;
}

async function cbGet<T>(path: string): Promise<T> {
  const jwt = buildJwt("GET", path);
  const res = await fetch(`https://api.coinbase.com${path}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Coinbase ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

interface Account {
  uuid: string;
  name: string;
  currency: string;
  available_balance: { value: string; currency: string };
  active: boolean;
  type: string;
}

export interface Holding {
  asset: string;
  balance: number;
  priceUsd: number;
  valueUsd: number;
}

export async function getAccounts(): Promise<Account[]> {
  const data = await cbGet<{ accounts: Account[] }>(
    "/api/v3/brokerage/accounts?limit=250"
  );
  return (data.accounts || []).filter(
    (a) => parseFloat(a.available_balance?.value || "0") > 0
  );
}

async function getSpotPriceUsd(currency: string): Promise<number> {
  if (currency === "USD" || currency === "USDC") return 1;
  try {
    const data = await cbGet<{ price: string }>(
      `/api/v3/brokerage/products/${currency}-USD`
    );
    return parseFloat(data.price);
  } catch {
    return 0;
  }
}

export async function getHoldingsWithPrices(): Promise<Holding[]> {
  const accounts = await getAccounts();
  const rows = await Promise.all(
    accounts.map(async (a) => {
      const balance = parseFloat(a.available_balance.value);
      const priceUsd = await getSpotPriceUsd(a.currency);
      return {
        asset: a.currency,
        balance,
        priceUsd,
        valueUsd: balance * priceUsd,
      };
    })
  );
  rows.sort((a, b) => b.valueUsd - a.valueUsd);
  return rows;
}

function trimTrailingZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

export async function getHoldingsFormatted(): Promise<string> {
  const rows = await getHoldingsWithPrices();
  if (rows.length === 0) return "No Coinbase holdings.";

  const total = rows.reduce((sum, r) => sum + r.valueUsd, 0);
  const lines: string[] = [
    "| Asset | Balance | Price (USD) | Value (USD) |",
    "|-------|---------|-------------|-------------|",
  ];
  for (const r of rows) {
    const bal = trimTrailingZeros(r.balance.toFixed(8));
    lines.push(
      `| ${r.asset} | ${bal} | $${r.priceUsd.toFixed(2)} | $${r.valueUsd.toFixed(2)} |`
    );
  }
  lines.push("", `**Total:** $${total.toFixed(2)}`);
  return lines.join("\n");
}
