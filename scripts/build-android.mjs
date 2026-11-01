import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(root, "android");
const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

function run(cmd, args, cwd = root) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd, shell: true });
  if (result.status !== 0) throw new Error(`命令失败：${cmd} ${args.join(" ")}`);
}

try {
  run("node", ["scripts/gen-mobile-icons.mjs"]);
  run("npm", ["run", "build"]);
  run("npx", ["cap", "sync", "android"]);
  run(gradle, ["assembleDebug", "--no-daemon"], androidDir);

  const apkSrc = path.join(
    androidDir,
    "app",
    "build",
    "outputs",
    "apk",
    "debug",
    "app-debug.apk",
  );
  const outDir = path.join(root, "release");
  fs.mkdirSync(outDir, { recursive: true });
  const apkOut = path.join(outDir, `掘影-${version}-android.apk`);
  fs.copyFileSync(apkSrc, apkOut);
  console.log(`\nAndroid APK：${apkOut}`);
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
