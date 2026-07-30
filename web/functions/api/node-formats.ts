export const SUPPORTED_PROTOCOLS = [
  "vmess",
  "vless",
  "shadowsocks",
  "trojan",
  "hysteria2",
  "wireguard",
  "socks5",
  "http",
  "tuic",
  "anytls",
  "naive",
] as const;

export type SupportedProtocol = typeof SUPPORTED_PROTOCOLS[number];
export type NodeConfig = Record<string, unknown>;

export interface ProxyNode {
  name: string;
  address: string;
  port: number;
  protocol: string;
  network: string;
  security: string;
  path: string;
  host: string;
  sni: string;
  public_key: string;
  short_id: string;
  fingerprint: string;
  flow: string;
  config_json: string;
}

export interface ParsedNode extends ProxyNode {
  sort_order: number;
  is_active: number;
}

function decodeComponent(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function encodeBase64Utf8(value: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  return urlSafe ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") : encoded;
}

export function decodeBase64Utf8(value: string): string {
  const compact = value.trim().replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return "";
  try {
    const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export function nodeConfig(node: Pick<ProxyNode, "config_json">): NodeConfig {
  try {
    const parsed = JSON.parse(node.config_json || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as NodeConfig : {};
  } catch {
    return {};
  }
}

export function normalizeConfigJson(value: unknown, fallback = "{}"): string {
  const source = value === undefined ? fallback : value;
  let parsed: unknown;
  if (typeof source === "string") {
    if (source.length > 16384) throw new Error("协议参数不能超过 16KB");
    try { parsed = JSON.parse(source || "{}"); } catch { throw new Error("协议参数 JSON 无效"); }
  } else {
    parsed = source;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("协议参数必须是 JSON 对象");
  return JSON.stringify(parsed);
}

function queryValue(url: URL, ...names: string[]): string {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value !== null && value.trim()) return value.trim();
  }
  return "";
}

function booleanValue(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => stringValue(item).trim()).filter(Boolean);
  return stringValue(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function numberList(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  return stringValue(value).split(",").map(Number).filter(Number.isFinite);
}

function addressOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

function addressForUri(address: string): string {
  return address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
}

function nameOf(url: URL, fallback: string): string {
  return url.hash ? decodeComponent(url.hash.slice(1)) : fallback;
}

function normalizedNetwork(value: string): string {
  const network = value.toLowerCase();
  return network === "raw" ? "tcp" : network || "tcp";
}

function transportFields(url: URL) {
  const network = normalizedNetwork(queryValue(url, "type", "network"));
  const path = network === "grpc"
    ? queryValue(url, "serviceName", "service-name", "path")
    : queryValue(url, "path");
  return {
    network,
    path: path || (network === "grpc" ? "" : "/"),
    host: queryValue(url, "host"),
  };
}

function tlsFields(url: URL, defaultSecurity = "none") {
  const importedSecurity = queryValue(url, "security").toLowerCase();
  const security = importedSecurity === "xtls"
    ? "tls"
    : importedSecurity || (booleanValue(queryValue(url, "tls")) ? "tls" : defaultSecurity);
  return {
    security,
    sni: queryValue(url, "sni", "serverName", "servername", "peer"),
    public_key: queryValue(url, "pbk", "publicKey", "public-key"),
    short_id: queryValue(url, "sid", "shortId", "short-id"),
    fingerprint: queryValue(url, "fp", "fingerprint") || "chrome",
    flow: queryValue(url, "flow"),
  };
}

function parsedNode(
  protocol: SupportedProtocol,
  address: string,
  port: number,
  name: string,
  config: NodeConfig,
  common: Partial<ProxyNode> = {},
): ParsedNode {
  if (!address) throw new Error("节点地址为空");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("节点端口无效");
  return {
    name: name || `${address}:${port}`,
    address,
    port,
    protocol,
    network: common.network || "tcp",
    security: common.security || "none",
    path: common.path || (common.network === "grpc" ? "" : "/"),
    host: common.host || "",
    sni: common.sni || "",
    public_key: common.public_key || "",
    short_id: common.short_id || "",
    fingerprint: common.fingerprint || "chrome",
    flow: common.flow || "",
    config_json: JSON.stringify(config),
    sort_order: 0,
    is_active: 1,
  };
}

function parseVmess(uri: string): ParsedNode {
  const encoded = uri.slice("vmess://".length).split("#", 1)[0];
  const decoded = decodeBase64Utf8(encoded);
  if (decoded.startsWith("{")) {
    const data = JSON.parse(decoded) as Record<string, unknown>;
    const address = stringValue(data.add).trim();
    const port = numberValue(data.port, 443);
    const uuid = stringValue(data.id).trim();
    if (!uuid) throw new Error("VMess UUID 为空");
    const network = normalizedNetwork(stringValue(data.net, "tcp"));
    const securityValue = stringValue(data.tls).toLowerCase();
    const config: NodeConfig = {
      uuid,
      alter_id: numberValue(data.aid),
      cipher: stringValue(data.scy, "auto") || "auto",
      alpn: stringList(data.alpn),
      allow_insecure: Boolean(data.allowInsecure),
    };
    return parsedNode("vmess", address, port, stringValue(data.ps, `${address}:${port}`), config, {
      network,
      security: securityValue === "tls" || securityValue === "reality" ? securityValue : "none",
      path: stringValue(data.path, network === "grpc" ? "" : "/"),
      host: stringValue(data.host),
      sni: stringValue(data.sni),
      fingerprint: stringValue(data.fp, "chrome"),
    });
  }
  const url = new URL(uri);
  const transport = transportFields(url);
  const tls = tlsFields(url);
  const uuid = decodeComponent(url.username);
  if (!uuid) throw new Error("VMess UUID 为空");
  const address = addressOf(url);
  const port = Number(url.port || 443);
  return parsedNode("vmess", address, port, nameOf(url, `${address}:${port}`), {
    uuid,
    alter_id: numberValue(queryValue(url, "aid", "alterId")),
    cipher: queryValue(url, "scy", "cipher") || "auto",
    alpn: stringList(queryValue(url, "alpn")),
    allow_insecure: booleanValue(queryValue(url, "allowInsecure", "insecure")),
  }, { ...transport, ...tls });
}

function parseShadowsocks(uri: string): ParsedNode {
  const raw = uri.slice("ss://".length);
  const hashIndex = raw.indexOf("#");
  const fragment = hashIndex >= 0 ? decodeComponent(raw.slice(hashIndex + 1)) : "";
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutHash.indexOf("?");
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const authority = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  let credentials = "";
  let endpoint = "";
  if (authority.includes("@")) {
    const separator = authority.lastIndexOf("@");
    const encodedCredentials = decodeComponent(authority.slice(0, separator));
    credentials = encodedCredentials.includes(":") ? encodedCredentials : decodeBase64Utf8(encodedCredentials);
    endpoint = authority.slice(separator + 1);
  } else {
    const decoded = decodeBase64Utf8(authority);
    const separator = decoded.lastIndexOf("@");
    if (separator < 0) throw new Error("Shadowsocks 链接无效");
    credentials = decoded.slice(0, separator);
    endpoint = decoded.slice(separator + 1);
  }
  const credentialSeparator = credentials.indexOf(":");
  if (credentialSeparator < 1) throw new Error("Shadowsocks 加密方式或密码为空");
  const method = credentials.slice(0, credentialSeparator);
  const password = credentials.slice(credentialSeparator + 1);
  const endpointUrl = new URL(`ss://${endpoint}`);
  const address = addressOf(endpointUrl);
  const port = Number(endpointUrl.port || 8388);
  const queryParams = new URLSearchParams(query);
  const pluginValue = queryParams.get("plugin") || "";
  const pluginParts = pluginValue.split(";").filter(Boolean);
  const pluginOptions: NodeConfig = {};
  for (const option of pluginParts.slice(1)) {
    const separator = option.indexOf("=");
    pluginOptions[separator > 0 ? option.slice(0, separator) : option] = separator > 0 ? option.slice(separator + 1) : true;
  }
  const network = stringValue(pluginOptions.mode).includes("websocket") ? "ws" : "tcp";
  return parsedNode("shadowsocks", address, port, fragment || `${address}:${port}`, {
    method,
    password,
    plugin: pluginParts[0] || "",
    plugin_opts: pluginOptions,
  }, {
    network,
    security: pluginOptions.tls ? "tls" : "none",
    path: stringValue(pluginOptions.path, "/"),
    host: stringValue(pluginOptions.host),
  });
}

function parseWireGuard(uri: string): ParsedNode {
  const encoded = uri.slice(uri.indexOf("://") + 3).split("#", 1)[0];
  if (!encoded.includes("@") && !encoded.includes("?")) {
    const decoded = decodeBase64Utf8(encoded);
    if (decoded.startsWith("{")) {
      const data = JSON.parse(decoded) as Record<string, unknown>;
      const endpoint = stringValue(data.endpoint);
      const endpointUrl = new URL(`wg://${endpoint}`);
      const address = addressOf(endpointUrl);
      const port = Number(endpointUrl.port || 51820);
      return parsedNode("wireguard", address, port, stringValue(data.name, `${address}:${port}`), {
        private_key: stringValue(data.private_key),
        peer_public_key: stringValue(data.peer_public_key, stringValue(data.public_key)),
        local_address: stringList(data.local_address),
        reserved: numberList(data.reserved),
        mtu: numberValue(data.mtu, 1420),
        pre_shared_key: stringValue(data.pre_shared_key),
      });
    }
  }
  const url = new URL(uri.replace(/^wg:/i, "wireguard:"));
  const address = addressOf(url);
  const port = Number(url.port || 51820);
  const key = (...names: string[]) => queryValue(url, ...names).replace(/ /g, "+");
  const privateKey = decodeComponent(url.username).replace(/ /g, "+") || key("privatekey", "private_key");
  const peerPublicKey = key("publickey", "public_key", "peer_public_key");
  if (!privateKey || !peerPublicKey) throw new Error("WireGuard 密钥不完整");
  return parsedNode("wireguard", address, port, nameOf(url, `${address}:${port}`), {
    private_key: privateKey,
    peer_public_key: peerPublicKey,
    local_address: stringList(queryValue(url, "address", "ip", "local_address")),
    reserved: numberList(queryValue(url, "reserved")),
    mtu: numberValue(queryValue(url, "mtu"), 1420),
    pre_shared_key: key("presharedkey", "pre_shared_key"),
  });
}

function parseStandard(uri: string): ParsedNode {
  const originalScheme = uri.slice(0, uri.indexOf(":")).toLowerCase();
  const url = new URL(uri);
  const address = addressOf(url);
  const defaultPorts: Record<string, number> = {
    vless: 443, trojan: 443, hysteria2: 443, hy2: 443, tuic: 443, anytls: 443,
    socks: 1080, socks4: 1080, socks5: 1080, http: 8080, https: 443,
    naive: 443, "naive+https": 443, "naive+quic": 443,
  };
  const port = Number(url.port || defaultPorts[originalScheme] || 443);
  const name = nameOf(url, `${address}:${port}`);
  const transport = transportFields(url);

  if (originalScheme === "vless") {
    const tls = tlsFields(url);
    const uuid = decodeComponent(url.username);
    if (!uuid) throw new Error("VLESS UUID 为空");
    return parsedNode("vless", address, port, name, {
      uuid,
      alpn: stringList(queryValue(url, "alpn")),
      allow_insecure: booleanValue(queryValue(url, "allowInsecure", "insecure")),
    }, { ...transport, ...tls });
  }

  if (originalScheme === "trojan") {
    const tls = tlsFields(url, "tls");
    const password = decodeComponent(url.username || url.password);
    if (!password) throw new Error("Trojan 密码为空");
    return parsedNode("trojan", address, port, name, {
      password,
      alpn: stringList(queryValue(url, "alpn")),
      allow_insecure: booleanValue(queryValue(url, "allowInsecure", "insecure", "allow-insecure")),
    }, { ...transport, ...tls });
  }

  if (originalScheme === "hysteria2" || originalScheme === "hy2") {
    const password = decodeComponent(url.username || url.password) || queryValue(url, "auth", "password");
    if (!password) throw new Error("Hysteria2 密码为空");
    const tls = tlsFields(url, "tls");
    return parsedNode("hysteria2", address, port, name, {
      password,
      obfs: queryValue(url, "obfs"),
      obfs_password: queryValue(url, "obfs-password", "obfs_password"),
      alpn: stringList(queryValue(url, "alpn")),
      allow_insecure: booleanValue(queryValue(url, "insecure", "allowInsecure")),
      up: queryValue(url, "up", "upmbps"),
      down: queryValue(url, "down", "downmbps"),
    }, { ...tls, network: "udp", path: "/", host: "" });
  }

  if (originalScheme === "tuic") {
    const uuid = decodeComponent(url.username);
    const password = decodeComponent(url.password) || queryValue(url, "password");
    if (!uuid || !password) throw new Error("TUIC UUID 或密码为空");
    const tls = tlsFields(url, "tls");
    return parsedNode("tuic", address, port, name, {
      uuid,
      password,
      congestion_control: queryValue(url, "congestion_control", "congestion-controller") || "bbr",
      udp_relay_mode: queryValue(url, "udp_relay_mode", "udp-relay-mode") || "native",
      alpn: stringList(queryValue(url, "alpn")),
      allow_insecure: booleanValue(queryValue(url, "allow_insecure", "allowInsecure", "insecure")),
      disable_sni: booleanValue(queryValue(url, "disable_sni", "disable-sni")),
    }, { ...tls, network: "udp", path: "/", host: "" });
  }

  if (originalScheme === "anytls") {
    const password = decodeComponent(url.username || url.password) || queryValue(url, "password");
    if (!password) throw new Error("AnyTLS 密码为空");
    const tls = tlsFields(url, "tls");
    return parsedNode("anytls", address, port, name, {
      password,
      alpn: stringList(queryValue(url, "alpn")),
      allow_insecure: booleanValue(queryValue(url, "insecure", "allowInsecure")),
      idle_session_check_interval: queryValue(url, "idle_session_check_interval"),
      idle_session_timeout: queryValue(url, "idle_session_timeout"),
      min_idle_session: numberValue(queryValue(url, "min_idle_session")),
    }, { ...tls, network: "tcp", path: "/", host: "" });
  }

  if (["socks", "socks4", "socks5"].includes(originalScheme)) {
    return parsedNode("socks5", address, port, name, {
      username: decodeComponent(url.username),
      password: decodeComponent(url.password),
      version: originalScheme === "socks4" ? "4" : "5",
      udp: originalScheme !== "socks4" && queryValue(url, "udp") !== "false",
    });
  }

  if (originalScheme === "http" || originalScheme === "https") {
    const tls = tlsFields(url, originalScheme === "https" ? "tls" : "none");
    return parsedNode("http", address, port, name, {
      username: decodeComponent(url.username),
      password: decodeComponent(url.password),
      tls: originalScheme === "https",
      allow_insecure: booleanValue(queryValue(url, "insecure", "allowInsecure")),
    }, { ...tls, network: "tcp", path: "/", host: "" });
  }

  if (originalScheme === "naive" || originalScheme.startsWith("naive+")) {
    const protocol = originalScheme.includes("quic") ? "quic" : "https";
    const tls = tlsFields(url, "tls");
    return parsedNode("naive", address, port, name, {
      username: decodeComponent(url.username),
      password: decodeComponent(url.password),
      protocol,
      extra_headers: queryValue(url, "extra-headers", "extra_headers"),
      allow_insecure: booleanValue(queryValue(url, "insecure", "allowInsecure")),
    }, { ...tls, network: protocol === "quic" ? "udp" : "tcp", path: "/", host: "" });
  }

  throw new Error("不支持的节点协议");
}

export function parseNodeUri(uri: string): ParsedNode {
  const scheme = uri.slice(0, uri.indexOf(":")).toLowerCase();
  if (scheme === "vmess") return parseVmess(uri);
  if (scheme === "ss") return parseShadowsocks(uri);
  if (scheme === "wireguard" || scheme === "wg") return parseWireGuard(uri);
  return parseStandard(uri);
}

const URI_PATTERN = /(?:vmess|vless|trojan|ss|hysteria2|hy2|tuic|wireguard|wg|socks|socks4|socks5|http|https|anytls|naive(?:\+https|\+quic)?):\/\/[^\s<>"']+/gi;

export function extractNodeUris(content: string): string[] {
  const candidates = [content];
  const decoded = decodeBase64Utf8(content);
  if (decoded && decoded !== content) candidates.push(decoded);
  const uris = new Set<string>();
  for (const candidate of candidates) {
    for (const match of candidate.matchAll(URI_PATTERN)) uris.add(match[0]);
  }
  return [...uris];
}

function setIf(query: URLSearchParams, key: string, value: unknown): void {
  const text = stringValue(value).trim();
  if (text) query.set(key, text);
}

function commonQuery(node: ProxyNode, includeEncryption = false): URLSearchParams {
  const query = new URLSearchParams();
  if (includeEncryption) query.set("encryption", "none");
  if (node.network) query.set("type", node.network);
  if (node.security) query.set("security", node.security);
  if (node.path && node.path !== "/") query.set(node.network === "grpc" ? "serviceName" : "path", node.path);
  setIf(query, "host", node.host);
  setIf(query, "sni", node.sni);
  setIf(query, "fp", node.fingerprint);
  setIf(query, "pbk", node.public_key);
  setIf(query, "sid", node.short_id);
  setIf(query, "flow", node.flow);
  return query;
}

function appendConfigQuery(query: URLSearchParams, config: NodeConfig): void {
  const alpn = stringList(config.alpn);
  if (alpn.length) query.set("alpn", alpn.join(","));
  if (config.allow_insecure) query.set("insecure", "1");
}

export function serializeNodeUri(node: ProxyNode, fallbackUuid: string): string {
  const config = nodeConfig(node);
  const address = addressForUri(node.address);
  const name = encodeURIComponent(node.name);

  if (node.protocol === "vmess") {
    return `vmess://${encodeBase64Utf8(JSON.stringify({
      v: "2", ps: node.name, add: node.address, port: String(node.port),
      id: stringValue(config.uuid, fallbackUuid), aid: String(numberValue(config.alter_id)),
      scy: stringValue(config.cipher, "auto"), net: node.network, type: "none",
      host: node.host, path: node.path, tls: node.security === "none" ? "" : node.security,
      sni: node.sni, alpn: stringList(config.alpn).join(","), fp: node.fingerprint,
    }))}`;
  }

  if (node.protocol === "vless") {
    const query = commonQuery(node, true);
    appendConfigQuery(query, config);
    return `vless://${encodeURIComponent(stringValue(config.uuid, fallbackUuid))}@${address}:${node.port}?${query}#${name}`;
  }

  if (node.protocol === "shadowsocks") {
    const credentials = encodeBase64Utf8(`${stringValue(config.method)}:${stringValue(config.password)}`, true);
    const query = new URLSearchParams();
    const plugin = stringValue(config.plugin);
    if (plugin) {
      const options = config.plugin_opts && typeof config.plugin_opts === "object" && !Array.isArray(config.plugin_opts)
        ? Object.entries(config.plugin_opts as NodeConfig).map(([key, value]) => value === true ? key : `${key}=${stringValue(value)}`)
        : [];
      query.set("plugin", [plugin, ...options].join(";"));
    }
    return `ss://${credentials}@${address}:${node.port}${query.size ? `?${query}` : ""}#${name}`;
  }

  if (node.protocol === "trojan") {
    const query = commonQuery(node);
    appendConfigQuery(query, config);
    return `trojan://${encodeURIComponent(stringValue(config.password, fallbackUuid))}@${address}:${node.port}?${query}#${name}`;
  }

  if (node.protocol === "hysteria2") {
    const query = new URLSearchParams();
    setIf(query, "sni", node.sni);
    setIf(query, "obfs", config.obfs);
    setIf(query, "obfs-password", config.obfs_password);
    setIf(query, "up", config.up);
    setIf(query, "down", config.down);
    appendConfigQuery(query, config);
    return `hysteria2://${encodeURIComponent(stringValue(config.password, fallbackUuid))}@${address}:${node.port}?${query}#${name}`;
  }

  if (node.protocol === "tuic") {
    const query = new URLSearchParams();
    setIf(query, "sni", node.sni);
    setIf(query, "congestion_control", config.congestion_control);
    setIf(query, "udp_relay_mode", config.udp_relay_mode);
    appendConfigQuery(query, config);
    return `tuic://${encodeURIComponent(stringValue(config.uuid, fallbackUuid))}:${encodeURIComponent(stringValue(config.password, fallbackUuid))}@${address}:${node.port}?${query}#${name}`;
  }

  if (node.protocol === "wireguard") {
    const query = new URLSearchParams();
    setIf(query, "publickey", config.peer_public_key);
    const localAddress = stringList(config.local_address);
    if (localAddress.length) query.set("address", localAddress.join(","));
    const reserved = numberList(config.reserved);
    if (reserved.length) query.set("reserved", reserved.join(","));
    setIf(query, "mtu", config.mtu);
    setIf(query, "presharedkey", config.pre_shared_key);
    return `wireguard://${encodeURIComponent(stringValue(config.private_key))}@${address}:${node.port}?${query}#${name}`;
  }

  if (node.protocol === "socks5") {
    const version = stringValue(config.version, "5");
    const scheme = version === "4" ? "socks4" : "socks5";
    const username = stringValue(config.username);
    const password = stringValue(config.password);
    const auth = username || password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : "";
    return `${scheme}://${auth}${address}:${node.port}#${name}`;
  }

  if (node.protocol === "http") {
    const username = stringValue(config.username);
    const password = stringValue(config.password);
    const auth = username || password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : "";
    const query = new URLSearchParams();
    setIf(query, "sni", node.sni);
    if (config.allow_insecure) query.set("insecure", "1");
    return `${config.tls || node.security !== "none" ? "https" : "http"}://${auth}${address}:${node.port}${query.size ? `?${query}` : ""}#${name}`;
  }

  if (node.protocol === "anytls") {
    const query = new URLSearchParams();
    setIf(query, "sni", node.sni);
    setIf(query, "idle_session_check_interval", config.idle_session_check_interval);
    setIf(query, "idle_session_timeout", config.idle_session_timeout);
    setIf(query, "min_idle_session", config.min_idle_session);
    appendConfigQuery(query, config);
    return `anytls://${encodeURIComponent(stringValue(config.password, fallbackUuid))}@${address}:${node.port}?${query}#${name}`;
  }

  if (node.protocol === "naive") {
    const username = stringValue(config.username);
    const password = stringValue(config.password);
    const auth = username || password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : "";
    const scheme = stringValue(config.protocol) === "quic" ? "naive+quic" : "naive+https";
    const query = new URLSearchParams();
    setIf(query, "sni", node.sni);
    if (config.allow_insecure) query.set("insecure", "1");
    return `${scheme}://${auth}${address}:${node.port}${query.size ? `?${query}` : ""}#${name}`;
  }

  throw new Error(`不支持的节点协议：${node.protocol}`);
}
