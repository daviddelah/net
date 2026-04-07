/**
 * Parse JSON body from request.
 */
export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Parse multipart form data using busboy.
 * Returns { fields: {}, files: [{ fieldname, filename, mimeType, buffer }] }
 */
export function parseMultipart(req) {
  return new Promise(async (resolve, reject) => {
    const { default: Busboy } = await import('busboy');
    const bb = Busboy({ headers: req.headers });
    const fields = {};
    const files = [];

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, file, info) => {
      const chunks = [];
      file.on('data', d => chunks.push(d));
      file.on('end', () => {
        files.push({
          fieldname: name,
          filename: info.filename,
          mimeType: info.mimeType,
          buffer: Buffer.concat(chunks),
        });
      });
    });
    bb.on('finish', () => resolve({ fields, files }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

/**
 * Send JSON response.
 */
export function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

/**
 * Send error response.
 */
export function sendError(res, message, status = 400) {
  sendJson(res, { error: message }, status);
}
