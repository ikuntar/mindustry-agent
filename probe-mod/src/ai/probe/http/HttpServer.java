package ai.probe.http;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * Minimal HTTP/1.1 server backed by ServerSocket. Android-compatible and
 * dependency-free. Each request gets one connection; responses close it.
 */
public final class HttpServer {
    private final InetSocketAddress address;
    private final int backlog;
    private final Map<String, Consumer<HttpExchange>> contexts = new LinkedHashMap<>();
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
                socket.setSoTimeout(15000);
                executor.execute(() -> handle(socket));
            } catch (IOException error) {
                if (running) {
                    // A closed server or transient accept failure: stop looping
                    // rather than spamming a log every frame.
                    running = false;
                }
            }
        }
    }

    private void handle(Socket socket) {
        try (HttpExchange exchange = new HttpExchange(socket)) {
            Consumer<HttpExchange> handler = find(exchange.getRequestURI().getPath());
            if (handler == null) {
                exchange.sendResponseHeaders(404, 0);
            } else {
                handler.accept(exchange);
            }
        } catch (Throwable error) {
            arc.util.Log.err("[ai-probe] http handler failed", error);
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
