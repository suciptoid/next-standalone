const path = require("path");
const server = require("serverless-http");
const NextServer = require("next/dist/server/next-server").default;

const dev = process.env.NODE_ENV !== "production";
const next = new NextServer({
  dev,
  dir: path.join(__dirname),
  conf: {replaceWithActualConf},
});
const handle = next.getRequestHandler();

exports.handler = server(handle, {
  request(request, event) {
    request.body = event.rawBody;
  },
});
