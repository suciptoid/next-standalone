const NextServer = require("next/dist/server/next-server").default;
const cloudfront = require("./cloudfront");
const path = require("path");

const dev = process.env.NODE_ENV !== "production";
const next = new NextServer({
  dev,
  dir: path.join(__dirname),
  conf: { replaceWithActualConf },
});
const handler = next.getRequestHandler();

exports.handler = cloudfront(handler);
