const fs = require("fs");
const path = require("path");
const { nodeFileTrace } = require("@vercel/nft");

// Copy file recursive
function copy(src, dst) {
  const dstDir = path.dirname(dst);
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }

  if (fs.lstatSync(src).isDirectory()) {
    // Copy directory
    const files = fs.readdirSync(src);
    files.forEach(file => {
      const sourcePath = path.join(src, file);
      copy(sourcePath, path.join(dst, file));
    })
  } else {
    // Copy File
    fs.copyFileSync(src, dst);
  }
}

// Build minimal nextjs app
async function build() {
  const cwd = process.cwd();
  const outDir = path.join(cwd, "lambda");

  if (!fs.existsSync(path.join(cwd, ".next/server/pages-manifest.json"))) {
    console.warn("No pages-manifest.json found. Please run `next build`.");
    return false;
  }

  if (!fs.existsSync(path.join(cwd, ".next/required-server-files.json"))) {
    console.warn(
      "No required-server-files.json found. Please run `next build`."
    );
    return false;
  }

  // Get Page Manifest
  const pagesManifest = JSON.parse(
    fs.readFileSync(path.join(cwd, ".next/server/pages-manifest.json"), "utf8")
  );
  const files = [];

  // Get Page Routes
  Object.keys(pagesManifest).forEach((key) => {
    files.push(path.join(cwd, ".next", "server", pagesManifest[key]));
  });

  console.log("Tracing files...");

  const { fileList } = await nodeFileTrace(files);

  // If exists, remove the directory
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }

  // Copy page files
  fileList.forEach((p) => copy(p, path.join(outDir, p)));

  // Get Server Depedency
  const serverReq = JSON.parse(
    fs.readFileSync(path.join(cwd, ".next/required-server-files.json"))
  );

  if (serverReq.files) {
    console.log("Copying server files...");
    serverReq.files.forEach((p) => copy(p, path.join(outDir, p)));
  }

  // Create Handler
  const handlerPath = path.join(outDir, "index.js");
  // copy handeler.js for api gateway, handler-edge.js for lambda@edge / cloudfront
  const handler = path.join(__dirname, "dist", "handler.js");
  copy(handler, handlerPath);

  // Get required server handler
  const serverTrace = await nodeFileTrace([handlerPath]);

  // Copy server files
  serverTrace.fileList.forEach((p) => {
    if (p !== path.relative(cwd, handlerPath)) {
      copy(p, path.join(outDir, p));
    }
  });

  // Replace config with actual config
  // open handler file
  const handlerFile = fs.readFileSync(handlerPath, "utf8");
  const handlerFileReplaced = handlerFile.replace(
    "{replaceWithActualConf}",
    JSON.stringify({
      ...serverReq.config,
    })
  );
  fs.writeFileSync(handlerPath, handlerFileReplaced);

  // Copy Static Files
  const staticDir = path.join(cwd, ".next", "static");
  if (fs.existsSync(staticDir)) {
    copy(staticDir, path.join(outDir, ".next", "static"));
  }
}

build();
