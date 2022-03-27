const url = require("url");
const http = require("http");
// const Stream = require("stream");

const HTTPS_PORT = 443;

// ATTRIBUTION: https://github.com/dougmoscrop/serverless-http
const DEFAULT_BINARY_ENCODINGS = ["gzip", "deflate", "br"];
const DEFAULT_BINARY_CONTENT_TYPES = ["image/*"];

function isContentEncodingBinary({ headers, binaryEncodingTypes }) {
  const contentEncoding = headers["content-encoding"];

  if (typeof contentEncoding !== "string") return false;

  return contentEncoding
    .split(",")
    .some((value) =>
      binaryEncodingTypes.some((binaryEncoding) =>
        value.includes(binaryEncoding)
      )
    );
}

function getContentType({ headers }) {
  const contentTypeHeader = headers["content-type"] || "";

  // only compare mime type; ignore encoding part
  return contentTypeHeader.split(";")[0];
}

function isContentTypeBinary({ headers, binaryContentTypes }) {
  if (!binaryContentTypes || !Array.isArray(binaryContentTypes)) return false;

  const binaryContentTypesRegexes = binaryContentTypes.map(
    (binaryContentType) =>
      new RegExp(`^${binaryContentType.replace(/\*/g, ".*")}$`)
  );
  const contentType = getContentType({ headers });

  if (!contentType) return false;

  return binaryContentTypesRegexes.some((binaryContentType) =>
    binaryContentType.test(contentType)
  );
}

function isBinary({ headers, binarySettings }) {
  if (binarySettings.isBinary === false) {
    return false;
  }

  if (typeof binarySettings.isBinary === "function") {
    return binarySettings.isBinary({ headers });
  }

  const binaryEncodingTypes =
    binarySettings.contentEncodings || DEFAULT_BINARY_ENCODINGS;
  const binaryContentTypes =
    binarySettings.contentTypes || DEFAULT_BINARY_CONTENT_TYPES;

  return (
    isContentEncodingBinary({ headers, binaryEncodingTypes }) ||
    isContentTypeBinary({ headers, binaryContentTypes })
  );
}

function waitForStreamComplete(stream) {
  if (stream.complete || stream.writableEnded) {
    return stream;
  }

  return new Promise((resolve, reject) => {
    stream.once("error", complete);
    stream.once("end", complete);
    stream.once("finish", complete);

    let isComplete = false;

    function complete(err) {
      if (isComplete) {
        return;
      }

      isComplete = true;

      stream.removeListener("error", complete);
      stream.removeListener("end", complete);
      stream.removeListener("finish", complete);

      if (err) {
        reject(err);
      } else {
        resolve(stream);
      }
    }
  });
}

class ServerlessRequest extends http.IncomingMessage {
  constructor({ method, url, headers, body, remoteAddress }) {
    super({
      encrypted: true,
      readable: false,
      remoteAddress,
      address: () => ({ port: HTTPS_PORT }),
      end: Function.prototype,
      destroy: Function.prototype,
    });

    Object.assign(this, {
      ip: remoteAddress,
      complete: true,
      httpVersion: "1.1",
      httpVersionMajor: "1",
      httpVersionMinor: "1",
      method,
      headers,
      url,
    });

    this._read = () => {
      this.push(body);
      this.push(null);
    };
  }
}

const headerEnd = "\r\n\r\n";

const BODY = Symbol("Response body");
const HEADERS = Symbol("Response headers");

function getString(data) {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  } else if (typeof data === "string") {
    return data;
  } else {
    throw new Error(`response.write() of unexpected type: ${typeof data}`);
  }
}

function addData(stream, data) {
  if (Buffer.isBuffer(data) || typeof data === "string") {
    stream[BODY].push(Buffer.from(data));
  } else {
    throw new Error(`response.write() of unexpected type: ${typeof data}`);
  }
}

class ServerlessResponse extends http.ServerResponse {
  static from(res) {
    const response = new ServerlessResponse(res);

    response.statusCode = res.statusCode;
    response[HEADERS] = res.headers;
    response[BODY] = [Buffer.from(res.body)];
    response.end();

    return response;
  }

  static body(res) {
    return Buffer.concat(res[BODY]);
  }

  static headers(res) {
    const headers =
      typeof res.getHeaders === "function" ? res.getHeaders() : res._headers;

    return Object.assign(headers, res[HEADERS]);
  }

  get headers() {
    return this[HEADERS];
  }

  setHeader(key, value) {
    if (this._wroteHeader) {
      this[HEADERS][key] = value;
    } else {
      super.setHeader(key, value);
    }
  }

  writeHead(statusCode, reason, obj) {
    const headers = typeof reason === "string" ? obj : reason;

    for (const name in headers) {
      this.setHeader(name, headers[name]);

      if (!this._wroteHeader) {
        // we only need to initiate super.headers once
        // writeHead will add the other headers itself
        break;
      }
    }

    super.writeHead(statusCode, reason, obj);
  }

  constructor({ method }) {
    super({ method });

    this[BODY] = [];
    this[HEADERS] = {};

    this.useChunkedEncodingByDefault = false;
    this.chunkedEncoding = false;
    this._header = "";

    this.assignSocket({
      _writableState: {},
      writable: true,
      on: Function.prototype,
      removeListener: Function.prototype,
      destroy: Function.prototype,
      cork: Function.prototype,
      uncork: Function.prototype,
      write: (data, encoding, cb) => {
        if (typeof encoding === "function") {
          cb = encoding;
          encoding = null;
        }

        if (this._header === "" || this._wroteHeader) {
          addData(this, data);
        } else {
          const string = getString(data);
          const index = string.indexOf(headerEnd);

          if (index !== -1) {
            const remainder = string.slice(index + headerEnd.length);

            if (remainder) {
              addData(this, remainder);
            }

            this._wroteHeader = true;
          }
        }

        if (typeof cb === "function") {
          cb();
        }
      },
    });
  }
}

async function mapEvent(event) {
  const cfRequest = event.Records[0].cf.request;
  const {
    headers: headersMap,
    uri,
    method,
    querystring,
    body: requestBodyObject = {},
    clientIp,
  } = cfRequest;
  let body = null;

  const headers = {};

  Object.entries(headersMap).forEach(([headerKey, headerValue]) => {
    headers[headerKey] = headerValue.map((header) => header.value).join(",");
  });

  if (requestBodyObject.data) {
    const isBase64Encoded = requestBodyObject.encoding === "base64";

    body = Buffer.from(
      requestBodyObject.data,
      isBase64Encoded ? "base64" : "utf8"
    );
    headers["content-length"] = Buffer.byteLength(
      body,
      isBase64Encoded ? "base64" : "utf8"
    );
  }

  const path = url.format({
    pathname: uri,
    search: querystring,
  });

  const req = new ServerlessRequest({
    method,
    url: path,
    headers,
    body,
    remoteAddress: clientIp,
  });
  // if (requestBodyObject) {
  //   req.push(
  //     requestBodyObject.data,
  //     requestBodyObject.encoding ? "base64" : "utf8"
  //   );
  // }
  // const newStream = new Stream.Readable();

  // const req = Object.assign(newStream, http.IncomingMessage.prototype);
  // req.url = cfRequest.uri;
  // req.method = cfRequest.method;
  // req.rawHeaders = [];
  // req.headers = {};
  // // req.connection = {};

  // if (cfRequest.querystring) {
  //   req.url = req.url + `?` + cfRequest.querystring;
  // }

  // const headers = cfRequest.headers || {};

  // for (const lowercaseKey of Object.keys(headers)) {
  //   const headerKeyValPairs = headers[lowercaseKey];

  //   headerKeyValPairs.forEach((keyVal) => {
  //     req.rawHeaders.push(keyVal.key);
  //     req.rawHeaders.push(keyVal.value);
  //   });

  //   req.headers[lowercaseKey] = headerKeyValPairs[0].value;
  // }

  // if (typeof req.headers["content-length"] === "undefined") {
  //   req.headers["content-length"] = Buffer.byteLength(
  //     cfRequest.body.data,
  //     cfRequest.body.encoding ? "base64" : undefined
  //   );
  // }

  // req.getHeader = (name) => {
  //   return req.headers[name.toLowerCase()];
  // };

  // req.getHeaders = () => {
  //   return req.headers;
  // };

  // if (cfRequest.body && cfRequest.body.data) {
  //   req.push(
  //     cfRequest.body.data,
  //     cfRequest.body.encoding ? "base64" : undefined
  //   );
  // }
  // req.push(null);

  // await waitForStreamComplete(req);

  const res = new ServerlessResponse(req);

  return { req, res };
}

async function mapResponse(response) {
  const statusCode = response.statusCode;
  const headers = ServerlessResponse.headers(response);
  const isBase64Encoded = isBinary({ headers, binarySettings: {} });

  const encoding = isBase64Encoded ? "base64" : "utf8";
  const body = ServerlessResponse.body(response).toString(encoding);

  // Map to response
  const headersMap = {};
  // Lambda@Edge fails if certain headers are returned
  const RESPONSE_HEADERS_DENY_LIST = ["content-length"];
  Object.entries(headers).forEach(([headerKey, headerValue]) => {
    const headerKeyLowerCase = headerKey.toLowerCase();
    if (RESPONSE_HEADERS_DENY_LIST.includes(headerKeyLowerCase)) return;
    if (!headersMap[headerKeyLowerCase]) headersMap[headerKeyLowerCase] = [];

    if (!Array.isArray(headerValue)) {
      headersMap[headerKeyLowerCase].push({
        key: headerKeyLowerCase,
        value: headerValue,
      });
      return;
    }

    const headersArray = headerValue.map((v) => ({
      key: headerKeyLowerCase,
      value: v,
    }));
    headersMap[headerKeyLowerCase].push(...headersArray);
  });
  const bodyEncoding = isBase64Encoded ? "base64" : "text";
  const edgeResponse = {
    status: statusCode,
    body,
    headers: headersMap,
    bodyEncoding,
  };

  // TODO: Handle if responseToServiceBytes exceeds Lambda@Edge limits
  // const responseToServiceBytes = (new TextEncoder().encode(JSON.stringify(responseToService))).length
  return edgeResponse;
}

function handle(handle) {
  return async (event) => {
    const { req, res } = await mapEvent(event);
    await handle(req, res);
    await waitForStreamComplete(res);
    return mapResponse(res);
  };
}

module.exports = handle;
