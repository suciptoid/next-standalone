const path = require("path");
const server = require("@vendia/serverless-express");
const NextServer = require("next/dist/server/next-server").default;

const dev = process.env.NODE_ENV !== "production";
const next = new NextServer({
  dev,
  dir: path.join(__dirname),
  conf: {replaceWithActualConf},
});
const app = next.getRequestHandler();

exports.handler = server({ app });
