#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");

const lanewayDir = path.join(os.homedir(), ".laneway");

try {
    const stat = fs.lstatSync(lanewayDir);
    if (stat.isSymbolicLink()) {
        console.error(`Refusing to remove symlinked path at ${lanewayDir}`);
        process.exit(1);
    }
    fs.rmSync(lanewayDir, { recursive: true, force: true });
    console.log(`Successfully removed laneway cache at ${lanewayDir}`);
} catch (e) {
    if (e && e.code !== "ENOENT") {
        console.error(`Failed to remove laneway cache at ${lanewayDir}:`, e.message);
    }
}
