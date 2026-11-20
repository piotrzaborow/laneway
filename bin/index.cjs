#!/usr/bin/env node
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const REPO = "piotrzaborow/laneway";
const PLATFORMS = {
    "darwin-arm64": "laneway-darwin-arm64",
    "darwin-x64": "laneway-darwin-x64",
    "linux-arm64": "laneway-linux-arm64",
    "linux-x64": "laneway-linux-x64",
    "win32-arm64": "laneway-windows-arm64.exe",
    "win32-x64": "laneway-windows-x64.exe"
};

const ALLOWED_HOSTS = new Set([
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com"
]);

const MAX_REDIRECTS = 5;
const API_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 30000;
const MAX_API_RESPONSE_BYTES = 1024 * 1024; // 1 MB
const MAX_BINARY_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

function validateTrustedUrl(rawUrl, baseUrl) {
    let parsed;
    try {
        parsed = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    } catch {
        throw new Error(`Invalid URL: ${rawUrl}`);
    }
    if (parsed.protocol !== "https:") {
        throw new Error(`Refusing non-HTTPS URL: ${parsed.protocol}`);
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
        throw new Error(`Refusing untrusted download host: ${parsed.hostname}`);
    }
    return parsed.toString();
}

function assertSafePath(targetPath, expectedType) {
    let stat;
    try {
        stat = fs.lstatSync(targetPath);
    } catch (err) {
        if (err && err.code === "ENOENT") {
            return false;
        }
        throw err;
    }

    if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to use symlinked path: ${targetPath}`);
    }
    if (expectedType === "dir" && !stat.isDirectory()) {
        throw new Error(`Expected directory at ${targetPath}`);
    }
    if (expectedType === "file" && !stat.isFile()) {
        throw new Error(`Expected regular file at ${targetPath}`);
    }
    if (process.platform !== "win32" && (stat.mode & 0o022) !== 0) {
        throw new Error(`Refusing insecure group/world-writable path: ${targetPath}`);
    }
    return true;
}

function readTrimmedFile(filePath) {
    try {
        if (!assertSafePath(filePath, "file")) {
            return null;
        }
        return fs.readFileSync(filePath, "utf-8").trim();
    } catch {
        return null;
    }
}

function writeFileAtomically(filePath, content, mode = 0o600) {
    assertSafePath(filePath, "file");
    const dir = path.dirname(filePath);
    const tmpPath = path.join(
        dir,
        `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
    );
    try {
        fs.writeFileSync(tmpPath, content, { encoding: "utf-8", mode, flag: "wx" });
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        try {
            fs.unlinkSync(tmpPath);
        } catch {
            // ignore cleanup failure
        }
        throw err;
    }
}

function httpsGet(url, options = {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        let safeUrl;
        try {
            safeUrl = validateTrustedUrl(url);
        } catch (err) {
            return reject(err);
        }

        const req = https.get(
            safeUrl,
            { headers: { "User-Agent": "laneway-cli" }, ...options },
            (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    if (redirectCount >= MAX_REDIRECTS) {
                        return reject(new Error("Too many HTTP redirects"));
                    }
                    let nextUrl;
                    try {
                        nextUrl = validateTrustedUrl(res.headers.location, safeUrl);
                    } catch (err) {
                        return reject(err);
                    }
                    return resolve(httpsGet(nextUrl, options, redirectCount + 1));
                }

                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }

                const chunks = [];
                let totalBytes = 0;
                res.on("data", (chunk) => {
                    totalBytes += chunk.length;
                    if (totalBytes > MAX_API_RESPONSE_BYTES) {
                        req.destroy();
                        return reject(new Error("Response exceeded maximum allowed size"));
                    }
                    chunks.push(chunk);
                });
                res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
                res.on("error", reject);
            }
        );

        req.on("error", reject);
        req.setTimeout(API_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error("Timeout"));
        });
    });
}

function parseSha256Sums(content, targetAssetName) {
    if (typeof content !== "string" || !targetAssetName) return null;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // Standard sha256sum format: "<hex>  <filename>" or "<hex> *<filename>"
        const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
        if (match) {
            const hash = match[1].toLowerCase();
            const fileName = path.basename(match[2].trim());
            if (fileName === targetAssetName) {
                return hash;
            }
        }
    }
    return null;
}

function extractDigestFromAsset(asset) {
    if (asset && typeof asset.digest === "string") {
        const prefix = "sha256:";
        if (asset.digest.toLowerCase().startsWith(prefix)) {
            const hash = asset.digest.slice(prefix.length).trim().toLowerCase();
            if (SHA256_HEX_RE.test(hash)) {
                return hash;
            }
        }
    }
    return null;
}

async function resolveExpectedSha256(latestRelease, asset, targetAssetName) {
    const directDigest = extractDigestFromAsset(asset);
    if (directDigest) {
        return directDigest;
    }

    const checksumAsset = latestRelease.assets.find(
        (a) => a && typeof a.name === "string" && a.name === "SHA256SUMS.txt"
    );
    if (checksumAsset && typeof checksumAsset.browser_download_url === "string") {
        const sumsContent = await httpsGet(checksumAsset.browser_download_url);
        const parsed = parseSha256Sums(sumsContent, targetAssetName);
        if (!parsed) {
            throw new Error(`Checksum for ${targetAssetName} not found in SHA256SUMS.txt`);
        }
        return parsed;
    }

    return null;
}

function downloadBinary(url, dest, expectedSha256 = null, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        let safeUrl;
        try {
            safeUrl = validateTrustedUrl(url);
        } catch (err) {
            return reject(err);
        }

        let settled = false;
        const fail = (err, tmpPath, file) => {
            if (settled) return;
            settled = true;
            if (file) {
                try {
                    file.destroy();
                } catch {
                    // ignore
                }
            }
            if (tmpPath) {
                fs.unlink(tmpPath, () => reject(err));
            } else {
                reject(err);
            }
        };

        const req = https.get(safeUrl, { headers: { "User-Agent": "laneway-cli" } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                if (redirectCount >= MAX_REDIRECTS) {
                    return fail(new Error("Too many HTTP redirects"));
                }
                let nextUrl;
                try {
                    nextUrl = validateTrustedUrl(res.headers.location, safeUrl);
                } catch (err) {
                    return fail(err);
                }
                settled = true;
                return resolve(downloadBinary(nextUrl, dest, expectedSha256, redirectCount + 1));
            }

            if (res.statusCode !== 200) {
                res.resume();
                return fail(new Error(`HTTP ${res.statusCode}`));
            }

            const dir = path.dirname(dest);
            const tmpPath = path.join(
                dir,
                `.${path.basename(dest)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
            );
            const hash = crypto.createHash("sha256");
            const file = fs.createWriteStream(tmpPath, { flags: "wx", mode: 0o700 });
            let totalBytes = 0;

            res.on("data", (chunk) => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_BINARY_SIZE_BYTES) {
                    req.destroy();
                    return fail(new Error("Downloaded binary exceeded maximum allowed size"), tmpPath, file);
                }
                hash.update(chunk);
            });

            res.on("error", (err) => fail(err, tmpPath, file));
            file.on("error", (err) => fail(err, tmpPath, file));

            res.pipe(file);

            file.on("finish", () => {
                file.close((closeErr) => {
                    if (closeErr) {
                        return fail(closeErr, tmpPath);
                    }
                    if (settled) return;
                    try {
                        if (expectedSha256) {
                            const actualHex = hash.digest("hex");
                            const actualBuf = Buffer.from(actualHex, "hex");
                            const expectedBuf = Buffer.from(expectedSha256.toLowerCase(), "hex");
                            if (
                                actualBuf.length !== expectedBuf.length ||
                                !crypto.timingSafeEqual(actualBuf, expectedBuf)
                            ) {
                                return fail(
                                    new Error(
                                        `SHA-256 integrity check failed (expected ${expectedSha256}, got ${actualHex})`
                                    ),
                                    tmpPath
                                );
                            }
                        }

                        fs.chmodSync(tmpPath, 0o755);
                        assertSafePath(dest, "file");
                        fs.renameSync(tmpPath, dest);
                        settled = true;
                        resolve();
                    } catch (finalizeErr) {
                        fail(finalizeErr, tmpPath);
                    }
                });
            });
        });

        req.on("error", (err) => fail(err));
        req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
            req.destroy();
            fail(new Error("Download timeout"));
        });
    });
}

async function getLatestRelease() {
    const data = await httpsGet(`https://api.github.com/repos/${REPO}/releases/latest`);
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed.tag_name !== "string" || !Array.isArray(parsed.assets)) {
        throw new Error("Malformed release metadata returned by GitHub API");
    }
    return parsed;
}

async function run() {
    const key = `${process.platform}-${process.arch}`;
    const assetName = PLATFORMS[key];

    if (!assetName) {
        console.error(`Unsupported platform/architecture: ${key}`);
        process.exit(1);
    }

    const lanewayDir = path.join(os.homedir(), ".laneway");
    const binDir = path.join(lanewayDir, "bin");
    const versionFile = path.join(lanewayDir, "version.txt");
    const lastCheckFile = path.join(lanewayDir, "last_check.txt");
    const exeName = process.platform === "win32" ? "laneway.exe" : "laneway";
    const binPath = path.join(binDir, exeName);

    try {
        fs.mkdirSync(lanewayDir, { recursive: true, mode: 0o700 });
        assertSafePath(lanewayDir, "dir");
        fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
        assertSafePath(binDir, "dir");

        const hasBin = assertSafePath(binPath, "file");
        const currentVersion = hasBin ? readTrimmedFile(versionFile) : null;

        // Only check for updates once an hour to avoid rate limiting and slow startup
        let shouldCheck = true;
        if (currentVersion) {
            const lastCheckStr = readTrimmedFile(lastCheckFile);
            const lastCheck = lastCheckStr ? parseInt(lastCheckStr, 10) : NaN;
            if (!isNaN(lastCheck) && Date.now() - lastCheck < 60 * 60 * 1000) {
                shouldCheck = false;
            }
        }

        if (shouldCheck) {
            let latestRelease;
            try {
                latestRelease = await getLatestRelease();
                writeFileAtomically(lastCheckFile, Date.now().toString());
            } catch {
                // Ignore offline errors if we have a cached version
                if (!currentVersion) {
                    throw new Error(
                        "Could not check for updates and no cached version exists. Please check your internet connection."
                    );
                }
            }

            if (latestRelease && latestRelease.tag_name !== currentVersion) {
                if (currentVersion) {
                    console.log(`Updating laneway from ${currentVersion} to ${latestRelease.tag_name}...`);
                } else {
                    console.log(`Downloading laneway ${latestRelease.tag_name}...`);
                }
                const asset = latestRelease.assets.find((a) => a && a.name === assetName);
                if (!asset || typeof asset.browser_download_url !== "string") {
                    throw new Error(
                        `Release asset ${assetName} for ${key} not found in release ${latestRelease.tag_name}.`
                    );
                }
                const expectedSha256 = await resolveExpectedSha256(latestRelease, asset, assetName);
                await downloadBinary(asset.browser_download_url, binPath, expectedSha256);
                writeFileAtomically(versionFile, latestRelease.tag_name);
            }
        }

        if (!assertSafePath(binPath, "file")) {
            throw new Error(`Laneway binary not found at ${binPath}`);
        }

        const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });
        if (result.error) {
            console.error("Failed to execute laneway:", result.error.message);
            process.exit(1);
        }
        process.exit(result.status ?? 0);
    } catch (e) {
        console.error("Laneway Launcher Error:", e.message);
        process.exit(1);
    }
}

if (require.main === module) {
    run();
} else {
    module.exports = {
        validateTrustedUrl,
        assertSafePath,
        parseSha256Sums,
        extractDigestFromAsset,
    };
}