"""Static offline Reader server with Range support; LAN requires trusted TLS."""
import argparse, functools, http.server, re, ssl
from pathlib import Path

class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        self.remaining = None
        value = self.headers.get('Range')
        path = Path(self.translate_path(self.path))
        if not value or not path.is_file():
            return super().send_head()
        size = path.stat().st_size
        match = re.fullmatch(r'bytes=(\d+)-(\d*)', value)
        if not match or int(match[1]) >= size:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        start = int(match[1])
        end = min(int(match[2]) if match[2] else size - 1, size - 1)
        if end < start:
            self.send_error(416)
            return None
        file = path.open('rb')
        file.seek(start)
        self.remaining = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(self.remaining))
        self.end_headers()
        return file

    def copyfile(self, source, outputfile):
        if self.remaining is None:
            return super().copyfile(source, outputfile)
        while self.remaining:
            block = source.read(min(self.remaining, 65536))
            if not block:
                break
            outputfile.write(block)
            self.remaining -= len(block)

    def list_directory(self, path):
        self.send_error(403, 'Directory listing disabled')
        return None

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent / 'dist-host')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8612)
    parser.add_argument('--cert', type=Path)
    parser.add_argument('--key', type=Path)
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key):
        parser.error('--cert and --key must be supplied together')
    if args.host not in ('127.0.0.1', 'localhost', '::1') and not args.cert:
        parser.error('LAN serving requires --cert and --key for trusted HTTPS/Web Crypto')
    if not (args.root / 'reader/index.html').is_file():
        parser.error('Build the Reader first: npm run host:build')
    server = http.server.ThreadingHTTPServer((args.host, args.port), functools.partial(Handler, directory=str(args.root.resolve())))
    if args.cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.cert, args.key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f'Reader: {"https" if args.cert else "http"}://{args.host}:{args.port}', flush=True)
    server.serve_forever()
