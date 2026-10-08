/**
 * Shim for iconv-lite in Cloudflare Workers environment.
 * Replaces heavy CJS iconv-lite which fails with require_streams in workerd.
 */
const { StringDecoder } = require('node:string_decoder');

module.exports = {
  getDecoder: function (encoding) {
    const enc = encoding ? String(encoding).toLowerCase().replace(/[^a-z0-9]/g, '') : 'utf8';
    const decoder = new StringDecoder(enc === 'utf8' || enc === 'utf-8' ? 'utf8' : 'utf8');
    return {
      write: function (buf) {
        return decoder.write(buf);
      },
      end: function () {
        return decoder.end();
      },
    };
  },
  getEncoder: function (encoding) {
    return {
      write: function (str) {
        return Buffer.from(str, 'utf8');
      },
      end: function () {
        return Buffer.alloc(0);
      },
    };
  },
  encodingExists: function () {
    return true;
  },
};
