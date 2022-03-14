const fs = require("fs");
const path = require("path");

function copy(src, dst) {
  const dstDir = path.dirname(dst);
  console.log("copy file path:", src);
  console.log("copy to dst dir: ", dstDir);
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
    console.log("Created directory:", dstDir);
  }

  fs.copyFileSync(src, dst);
}

async function trace() {
  const { nodeFileTrace } = require("@vercel/nft");
  if (!fs.existsSync(".next/server/pages-manifest.json")) {
    console.warn("No pages-manifest.json found. Please run `next build`.");
    return false;
  }

  if (!fs.existsSync(".next/required-server-files.json")) {
    console.warn(
      "No required-server-files.json found. Please run `next build`."
    );
    return false;
  }

  // Get Page Manifest
  const pagesManifest = JSON.parse(
    fs.readFileSync(".next/server/pages-manifest.json", "utf8")
  );
  const files = ["server.js"];

  // Get Page Routes
  Object.keys(pagesManifest).forEach((key) => {
    files.push(path.join(".next", "server", pagesManifest[key]));
  });

  console.log("Tracing files...");

  const { fileList } = await nodeFileTrace(files);

  const outDir = "dist";

  // If exists, remove the directory
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }

  // Copy page files
  fileList.forEach((p) => copy(p, path.join(outDir, p)));

  // Get Server Depedency
  const serverReq = JSON.parse(
    fs.readFileSync(".next/required-server-files.json")
  );
  
  if (serverReq.files) {
    console.log('Copying server files...');
    serverReq.files.forEach((p) => copy(p, path.join(outDir, p)));
  }

}

trace();
