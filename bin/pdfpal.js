#!/usr/bin/env node
"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HOME = os.homedir();
const DATA_DIR = path.join(HOME, ".pdfpal");
const VENV_DIR = path.join(DATA_DIR, "venv");
const DB_PATH = path.join(DATA_DIR, "pdfpal.db");
const CONFIG_PATH = path.join(DATA_DIR, "config.env");

// Package root: <this script>/.. -> holds backend/ and frontend/dist/
const PKG_ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(PKG_ROOT, "backend");
const REQUIREMENTS = path.join(BACKEND_DIR, "requirements.txt");
const FRONTEND_DIST = path.join(PKG_ROOT, "frontend", "dist");

const IS_WIN = process.platform === "win32";
const VENV_BIN = IS_WIN ? "Scripts" : "bin";
const venvExe = (name) => path.join(VENV_DIR, VENV_BIN, name + (IS_WIN ? ".exe" : ""));

const log = (msg) => console.log(`pdfpal: ${msg}`);
const warn = (msg) => console.error(`pdfpal: ${msg}`);

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { port: 8200, host: "127.0.0.1", noBrowser: false, resetVenv: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      case "-V":
      case "--version":
        console.log("pdfpal " + require("../package.json").version);
        process.exit(0);
      case "-p":
      case "--port":
        opts.port = parseInt(argv[++i], 10);
        if (!opts.port) { warn("invalid --port"); process.exit(1); }
        break;
      case "--host":
        opts.host = argv[++i];
        break;
      case "--no-browser":
        opts.noBrowser = true;
        break;
      case "--reset-venv":
        opts.resetVenv = true;
        break;
      default:
        warn(`unknown option: ${a}`);
        printHelp();
        process.exit(1);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: pdfpal [options]

Starts the pdfpal server on localhost and opens it in your browser.

Options:
  -p, --port <n>      Port to bind (default: 8200)
  --host <addr>       Host to bind (default: 127.0.0.1)
  --no-browser        Do not open a browser on start
  --reset-venv        Recreate the Python virtualenv on this run
  -V, --version       Print version
  -h, --help          Show this help

Data, config, and the database live in:
  ${DATA_DIR}

Edit ${path.relative(HOME, CONFIG_PATH)} to set CLAUDE_BIN / TAVILY_API_KEY.`);
}

// ---------------------------------------------------------------------------
// Environment bootstrap
// ---------------------------------------------------------------------------

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function findPython() {
  const candidates = ["python3", "python"];
  for (const c of candidates) {
    const r = spawnSync(c, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3,8) else 1)"], { stdio: "pipe" });
    if (r.status === 0) return c;
  }
  warn("Python 3.8+ not found. Install it from https://www.python.org/downloads/");
  process.exit(1);
}

function requirementsHash() {
  const content = fs.readFileSync(REQUIREMENTS, "utf8");
  return crypto.createHash("sha1").update(content).digest("hex");
}

function venvUpToDate() {
  const marker = path.join(VENV_DIR, ".pdfpal_req_hash");
  if (!fs.existsSync(marker)) return false;
  return fs.readFileSync(marker, "utf8").trim() === requirementsHash();
}

function runSync(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// Download a URL to a local path using curl or wget. Returns true on success.
function downloadTo(url, dest) {
  if (fs.existsSync("/usr/bin/curl") || runSync("which", ["curl"]).status === 0) {
    return runSync("curl", ["-fsSL", url, "-o", dest]).status === 0;
  }
  if (runSync("which", ["wget"]).status === 0) {
    return runSync("wget", ["-qO", dest, url]).status === 0;
  }
  return false;
}

// Create the virtualenv at VENV_DIR. Returns true on success.
// Falls back to --without-pip + pip bootstrap when ensurepip is missing
// (common on Debian/Ubuntu without the python3-venv package installed).
function createVenv(venvPython) {
  const py = findPython();

  // 1. Standard venv creation (includes pip via ensurepip).
  let r = runSync(py, ["-m", "venv", VENV_DIR], { stdio: "pipe" });
  if (r.status === 0) return true;

  const combined = (r.stdout + r.stderr);
  // Match across line wraps (the message reads "ensurepip is not\navailable").
  const ensurepipMissing = /ensurepip/i.test(combined);

  if (!ensurepipMissing) {
    // Some other failure — surface it.
    console.error(combined.trim());
    return false;
  }

  // 2. Fallback: create without pip, then bootstrap pip via get-pip.py.
  log("system Python lacks ensurepip; bootstrapping pip via get-pip.py...");
  fs.rmSync(VENV_DIR, { recursive: true, force: true });
  r = runSync(py, ["-m", "venv", "--without-pip", VENV_DIR], { stdio: "pipe" });
  if (r.status !== 0) {
    console.error((r.stdout + r.stderr).trim());
    return false;
  }
  const getPip = path.join(VENV_DIR, "get-pip.py");
  if (!downloadTo("https://bootstrap.pypa.io/get-pip.py", getPip)) {
    warn("could not download get-pip.py (need curl or wget, and network access).");
    warn("alternative: install the python3-venv package, then run with --reset-venv.");
    return false;
  }
  r = runSync(venvPython, [getPip, "--no-warn-script-location"], { stdio: "inherit" });
  return r.status === 0;
}

function ensureVenv(opts) {
  const venvPython = venvExe("python");
  if (opts.resetVenv && fs.existsSync(VENV_DIR)) {
    log("resetting Python environment...");
    fs.rmSync(VENV_DIR, { recursive: true, force: true });
  }

  if (fs.existsSync(venvPython) && venvUpToDate()) return;

  if (!fs.existsSync(venvPython)) {
    log("setting up Python environment (one-time, may take a minute)...");
    if (!createVenv(venvPython)) { warn("failed to create virtualenv"); process.exit(1); }
  } else {
    log("updating Python dependencies...");
  }

  const pip = venvExe("pip");
  let r = spawnSync(pip, ["install", "--upgrade", "pip", "setuptools", "wheel"], { stdio: "inherit" });
  if (r.status !== 0) { warn("failed to upgrade pip"); process.exit(1); }
  r = spawnSync(pip, ["install", "-r", REQUIREMENTS], { stdio: "inherit" });
  if (r.status !== 0) { warn("failed to install backend dependencies"); process.exit(1); }

  fs.writeFileSync(path.join(VENV_DIR, ".pdfpal_req_hash"), requirementsHash());
}

function detectClaude() {
  // On Windows there is no `which`; fall through to candidate paths.
  if (!IS_WIN) {
    const r = spawnSync("which", ["claude"], { stdio: "pipe" });
    if (r.status === 0) return r.stdout.toString().trim();
  }
  const candidates = [
    path.join(HOME, ".local", "bin", "claude"),
    path.join(HOME, ".claude", "local", "claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return "";
}

function parseEnvFile(text) {
  const cfg = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    cfg[m[1]] = val;
  }
  return cfg;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return parseEnvFile(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function firstRunSetup() {
  if (fs.existsSync(CONFIG_PATH)) return null;
  const claude = detectClaude();
  const body = [
    "# pdfpal local configuration",
    "# Edit and restart pdfpal to apply changes.",
    "",
    "# Path to the claude CLI binary (required for AI chat).",
    `CLAUDE_BIN=${claude}`,
    "",
    "# Tavily API key (optional; enables web search in chat).",
    "TAVILY_API_KEY=",
    "",
    "# Leave GOOGLE_CLIENT_ID empty to keep auth disabled locally.",
    "GOOGLE_CLIENT_ID=",
    "",
    "# Override the default bind address/port here if you prefer.",
    "# PDFPAL_HOST=127.0.0.1",
    "# PDFPAL_PORT=8200",
    "",
  ].join("\n") + "\n";
  fs.writeFileSync(CONFIG_PATH, body);
  return claude;
}

function openBrowser(url) {
  let cmd, args;
  if (process.platform === "darwin") { cmd = "open"; args = [url]; }
  else if (IS_WIN) { cmd = "cmd"; args = ["/c", "start", "", url]; }
  else { cmd = "xdg-open"; args = [url]; }

  // Sanity-check the launcher exists (spawn's ENOENT is async, so a missing
  // binary would otherwise fail silently).
  const resolved = runSync("which", [cmd], { stdio: "pipe" });
  if (resolved.status !== 0) {
    warn(`could not open browser (no ${cmd}). Open manually: ${url}`);
    return;
  }
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => warn(`could not open browser. Open manually: ${url}`));
  child.unref();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Sanity: the package must include the built frontend.
  if (!fs.existsSync(path.join(FRONTEND_DIST, "index.html"))) {
    warn(`built frontend not found at:\n  ${FRONTEND_DIST}`);
    warn("run `npm run build` in the pdfpal package directory, then retry.");
    process.exit(1);
  }

  ensureDataDir();

  const detectedClaude = firstRunSetup();
  if (detectedClaude !== null) {
    log("first-time setup complete. config written to:");
    console.log("  " + CONFIG_PATH);
    if (!detectedClaude) {
      console.log("");
      console.log("  ⚠️  Claude CLI was not found on your PATH.");
      console.log("     Install it, then set CLAUDE_BIN in the config file above.");
      console.log("     The app will still run, but AI chat will be unavailable.");
    }
    console.log("");
  }

  ensureVenv(opts);

  const cfg = loadConfig();
  const claudeBin = cfg.CLAUDE_BIN || detectClaude();
  const port = cfg.PDFPAL_PORT ? parseInt(cfg.PDFPAL_PORT, 10) : opts.port;
  const host = cfg.PDFPAL_HOST || opts.host;

  const env = {
    ...process.env,
    PDFPAL_DB: DB_PATH,
    CLAUDE_BIN: claudeBin || "",
    TAVILY_API_KEY: cfg.TAVILY_API_KEY || "",
    GOOGLE_CLIENT_ID: "",            // auth disabled in local mode
    PUBLIC_URL: `http://localhost:${port}`,
    CORS_ORIGINS: `http://localhost:${port},http://127.0.0.1:${port}`,
  };

  if (!claudeBin) {
    log("running without Claude CLI — AI chat will report an error until CLAUDE_BIN is set.");
  }

  const url = `http://localhost:${port}`;
  log(`starting on ${url}  (bind ${host})`);

  const server = spawn(venvExe("python"), [
    "-m", "uvicorn", "main:app", "--host", host, "--port", String(port),
  ], { cwd: BACKEND_DIR, env, stdio: "inherit" });

  server.on("exit", (code) => process.exit(code || 0));

  if (!opts.noBrowser) {
    log(`opening in browser in a moment (pass --no-browser to skip)...`);
    setTimeout(() => openBrowser(url), 1500);
  }

  const stop = (sig) => () => server.kill(sig);
  process.on("SIGINT", stop("SIGINT"));
  process.on("SIGTERM", stop("SIGTERM"));
}

main();
