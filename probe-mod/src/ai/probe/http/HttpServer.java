package ai.probe.http;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.function.Consumer;

/**
 * Minimal HTTP/1.1 server backed by ServerSocket. Android-compatible and
 * dependency-free. Each request gets one connection; responses close it.
 */
public final class HttpServer {
    private static final int MAX_CONNECTIONS = 64;
    private final InetSocketAddress address;
    private final int backlog;
    private final Map<String, Consumer<HttpExchange>> contexts = new LinkedHashMap<>();
    private final Semaphore permits = new Semaphore(MAX_CONNECTIONS);
    private Executor executor = Executors.newCachedThreadPool();
    private ServerSocket server;
    private volatile boolean running;

    private HttpServer(InetSocketAddress address, int backlog) {
        this.address = address;
        this.backlog = backlog;
    }

    public static HttpServer create(InetSocketAddress address, int backlog) {
        return new HttpServer(address, backlog);
    }

    public void createContext(String path, Consumer<HttpExchange> handler) {
        contexts.put(path, handler);
    }

    public void setExecutor(Executor executor) {
        this.executor = executor;
    }

    public void start() throws IOException {
        if (running) throw new IllegalStateException("server already started");
        server = new ServerSocket();
        server.bind(address, backlog);
        running = true;
        Thread accept = new Thread(this::acceptLoop, "ai-probe-http-accept");
        accept.setDaemon(true);
        accept.start();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket socket = server.accept();
                if (!permits.tryAcquire()) {
                    closeQuietly(socket);
                    continue;
                }
                socket.setSoTimeout(15000);
                try {
                    executor.execute(() -> {
                        try {
                            handle(socket);
                        } finally {
                            permits.release();
                        }
                    });
                } catch (RuntimeException error) {
                    permits.release();
                    closeQuietly(socket);
                    arc.util.Log.err("[ai-probe] http executor rejected connection", error);
                }
            } catch (IOException error) {
                if (!running || server == null || server.isClosed()) {
                    running = false;
                    return;
                }
                // A transient accept failure (EMFILE, reset, ...) must not
                // permanently disable the data/session HTTP server.
                arc.util.Log.err("[ai-probe] http accept failed; continuing", error);
                try {
                    Thread.sleep(50L);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    running = false;
                    return;
                }
            }
        }
    }

    private void handle(Socket socket) {
        HttpExchange exchange = null;
        try {
            exchange = new HttpExchange(socket);
            Consumer<HttpExchange> handler = find(exchange.getRequestURI().getPath());
            if (handler == null) {
                exchange.sendResponseHeaders(404, 0);
            } else {
                handler.accept(exchange);
            }
        } catch (Throwable error) {
            if (exchange == null) {
                sendBadRequest(socket);
            }
            arc.util.Log.err("[ai-probe] http handler failed", error);
        } finally {
            if (exchange != null) {
                exchange.close();
            } else {
                closeQuietly(socket);
            }
        }
    }

    private void sendBadRequest(Socket socket) {
        try {
            OutputStream out = socket.getOutputStream();
            out.write(("HTTP/1.1 400 Bad Request\r\n"
                    + "Content-Length: 0\r\n"
                    + "Connection: close\r\n\r\n").getBytes("US-ASCII"));
            out.flush();
        } catch (IOException ignored) {
        }
    }

    private void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }

    private Consumer<HttpExchange> find(String path) {
        Consumer<HttpExchange> best = null;
        int bestLength = -1;
        for (Map.Entry<String, Consumer<HttpExchange>> entry : contexts.entrySet()) {
            String prefix = entry.getKey();
            if (path.equals(prefix) || path.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")
                    || prefix.equals("/")) {
                if (prefix.length() > bestLength) {
                    best = entry.getValue();
                    bestLength = prefix.length();
                }
            }
        }
        return best;
    }
}
