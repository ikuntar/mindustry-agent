package ai.probe.http;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Small HTTP/1.1 request/response used by the mod's embedded servers.
 *
 * <p>This intentionally implements only the subset needed by the probe API:
 * one request per connection, Content-Length bodies, and no chunked encoding.
 * It uses only java.net/java.io so the same code can run on Android, which
 * does not ship com.sun.net.httpserver.</p>
 */
public final class HttpExchange implements AutoCloseable {
    private final Socket socket;
    private final InputStream input;
    private final OutputStream output;
    private final String method;
    private final URI uri;
    private final Headers requestHeaders = new Headers();
    private final Headers responseHeaders = new Headers();
    private boolean responseStarted;
    private boolean closed;

    HttpExchange(Socket socket) throws IOException {
        this.socket = socket;
        this.input = new BufferedInputStream(socket.getInputStream());
        this.output = new BufferedOutputStream(socket.getOutputStream());

        String requestLine = readLine(input);
        if (requestLine == null || requestLine.isEmpty()) {
            throw new IOException("empty request");
        }
        String[] parts = requestLine.split(" ");
        if (parts.length < 2) throw new IOException("bad request line");
        this.method = parts[0].toUpperCase(Locale.ROOT);
        String target = parts[1];
        this.uri = URI.create(target);

        String line;
        while ((line = readLine(input)) != null && !line.isEmpty()) {
            int colon = line.indexOf(':');
            if (colon <= 0) continue;
            requestHeaders.set(line.substring(0, colon), line.substring(colon + 1).trim());
        }
    }

    public String getRequestMethod() {
        return method;
    }

    public URI getRequestURI() {
        return uri;
    }

    public Headers getRequestHeaders() {
        return requestHeaders;
    }

    public InputStream getRequestBody() {
        return input;
    }

    public Headers getResponseHeaders() {
        return responseHeaders;
    }

    public void sendResponseHeaders(int status, long contentLength) throws IOException {
        if (responseStarted) throw new IOException("response already started");
        responseStarted = true;

        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n");
        if (contentLength >= 0) {
            responseHeaders.set("Content-Length", Long.toString(contentLength));
        }
        responseHeaders.set("Connection", "close");
        for (Map.Entry<String, String> entry : responseHeaders.entries.entrySet()) {
            head.append(entry.getKey()).append(": ").append(entry.getValue()).append("\r\n");
        }
        head.append("\r\n");
        output.write(head.toString().getBytes(StandardCharsets.US_ASCII));
        output.flush();
    }

    public OutputStream getResponseBody() {
        return output;
    }

    @Override
    public void close() {
        if (closed) return;
        closed = true;
        try {
            output.flush();
        } catch (IOException ignored) {
        }
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }

    private static String readLine(InputStream input) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int previous = -1;
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (previous == '\r') {
                buffer.write('\r');
            }
            if (value != '\r') buffer.write(value);
            previous = value;
            if (buffer.size() > 16384) throw new IOException("header line too long");
        }
        if (value == -1 && buffer.size() == 0) return null;
        return new String(buffer.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 202: return "Accepted";
            case 204: return "No Content";
            case 206: return "Partial Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 410: return "Gone";
            case 413: return "Payload Too Large";
            case 416: return "Range Not Satisfiable";
            case 429: return "Too Many Requests";
            case 500: return "Internal Server Error";
            case 503: return "Service Unavailable";
            default: return "Status";
        }
    }

    public static final class Headers {
        private final Map<String, String> entries = new LinkedHashMap<>();

        public String getFirst(String name) {
            return entries.get(name.toLowerCase(Locale.ROOT));
        }

        public void set(String name, String value) {
            entries.put(name.toLowerCase(Locale.ROOT), value);
        }

        public void add(String name, String value) {
            entries.putIfAbsent(name.toLowerCase(Locale.ROOT), value);
        }
    }
}
