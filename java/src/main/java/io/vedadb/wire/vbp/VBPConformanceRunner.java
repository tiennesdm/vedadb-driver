package io.vedadb.wire.vbp;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/**
 * VBP v1 conformance runner. Loads vbp_suite.yaml, runs each test against
 * a live VBP server, and emits a JUnit XML report. Mirrors the Python POC.
 *
 * <p>Usage:
 * <pre>
 *   java -cp ... io.vedadb.wire.vbp.VBPConformanceRunner \
 *     --yaml /path/vbp_suite.yaml \
 *     --host 127.0.0.1 --port 6380 \
 *     --user admin --pass TestPassword123! \
 *     --filter connect,hello,auth,query \
 *     --out /tmp/vbp-java-conformance.xml
 * </pre>
 */
public final class VBPConformanceRunner {

    public static final class Outcome {
        public final int id;
        public final String name;
        public final String category;
        public final String status; // PASS, FAIL, SKIP, ERROR
        public final String message;
        public final double durationMs;
        public Outcome(int id, String name, String category, String status,
                       String message, double durationMs) {
            this.id = id; this.name = name; this.category = category;
            this.status = status; this.message = message; this.durationMs = durationMs;
        }
    }

    public static void main(String[] args) throws Exception {
        String yaml = null, host = "127.0.0.1", user = "admin", pw = "TestPassword123!";
        int port = 6380;
        String out = "vbp-conformance-java.junit.xml";
        String filter = "";
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--yaml": yaml = args[++i]; break;
                case "--host": host = args[++i]; break;
                case "--port": port = Integer.parseInt(args[++i]); break;
                case "--user": user = args[++i]; break;
                case "--pass": pw = args[++i]; break;
                case "--out": out = args[++i]; break;
                case "--filter": filter = args[++i]; break;
                default: throw new IllegalArgumentException("unknown arg: " + args[i]);
            }
        }
        if (yaml == null) {
            System.err.println("ERROR: --yaml is required");
            System.exit(2);
        }
        List<Outcome> outcomes = run(yaml, host, port, user, pw, filter);
        writeJUnit(outcomes, Paths.get(out), "vbp-conformance-v1");
        long pass = outcomes.stream().filter(o -> "PASS".equals(o.status)).count();
        long fail = outcomes.stream().filter(o -> "FAIL".equals(o.status)).count();
        long skip = outcomes.stream().filter(o -> "SKIP".equals(o.status)).count();
        long err  = outcomes.stream().filter(o -> "ERROR".equals(o.status)).count();
        System.out.println("VBP v1 conformance (Java)");
        System.out.println("  tests:  " + outcomes.size());
        System.out.println("  pass:   " + pass);
        System.out.println("  fail:   " + fail);
        System.out.println("  skip:   " + skip);
        System.out.println("  error:  " + err);
        System.out.println("  report: " + out);
        // Exit 0 on success, 1 on any FAIL/ERROR
        System.exit((fail + err) > 0 ? 1 : 0);
    }

    public static List<Outcome> run(String yamlPath, String host, int port,
                                    String user, String pw, String filter) throws IOException {
        Map<String, Object> data = loadYaml(Paths.get(yamlPath));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tests = (List<Map<String, Object>>) data.getOrDefault("tests", new ArrayList<>());
        List<Outcome> outcomes = new ArrayList<>();
        java.util.Set<String> cats = filter == null || filter.isEmpty() ? null :
                new java.util.HashSet<>(java.util.Arrays.asList(filter.split(",")));
        // Open one connection shared by tests.
        VBPConnection conn = null;
        try {
            for (Map<String, Object> t : tests) {
                int id = ((Number) t.getOrDefault("id", 0)).intValue();
                String name = String.valueOf(t.getOrDefault("name", ""));
                String cat = String.valueOf(t.getOrDefault("category", ""));
                if (cats != null && !cats.contains(cat)) continue;
                long t0 = System.nanoTime();
                Outcome o;
                try {
                    o = dispatch(conn, host, port, user, pw, t, cat, name, id);
                } catch (Throwable e) {
                    o = new Outcome(id, name, cat, "ERROR", e.getClass().getSimpleName() + ": " + e.getMessage(), elapsedMs(t0));
                }
                outcomes.add(o);
            }
        } finally {
            if (conn != null) try { conn.close(); } catch (Exception ignored) {}
        }
        return outcomes;
    }

    private static Outcome dispatch(VBPConnection conn, String host, int port, String user, String pw,
                                    Map<String, Object> t, String cat, String name, int id) {
        long t0 = System.nanoTime();
        switch (cat) {
            case "connect": return handleConnect(conn, host, port, user, pw, t, cat, name, id, t0);
            case "hello":   return handleHello(conn, host, port, user, pw, t, cat, name, id, t0);
            case "auth":    return handleAuth(conn, host, port, user, pw, t, cat, name, id, t0);
            case "query":   return handleQuery(conn, host, port, user, pw, t, cat, name, id, t0);
            default:        return new Outcome(id, name, cat, "SKIP", "category not implemented in v1 POC", elapsedMs(t0));
        }
    }

    private static Outcome handleConnect(VBPConnection conn, String host, int port, String user, String pw,
                                         Map<String, Object> t, String cat, String name, int id, long t0) {
        // Open a fresh connection to validate TCP connect.
        try (VBPConnection c = new VBPConnection(host, port, user, pw, "", 5)) {
            c.connect();
            return new Outcome(id, name, cat, "PASS", "connected to " + host + ":" + port, elapsedMs(t0));
        } catch (Throwable e) {
            return new Outcome(id, name, cat, "FAIL", "connect failed: " + e.getMessage(), elapsedMs(t0));
        }
    }

    private static Outcome handleHello(VBPConnection conn, String host, int port, String user, String pw,
                                       Map<String, Object> t, String cat, String name, int id, long t0) {
        try (VBPConnection c = new VBPConnection(host, port, user, pw, "", 5)) {
            c.connect();
            int v = c.getServerVersion();
            return new Outcome(id, name, cat, "PASS", "server version 0x" + Integer.toHexString(v), elapsedMs(t0));
        } catch (Throwable e) {
            return new Outcome(id, name, cat, "FAIL", "hello failed: " + e.getMessage(), elapsedMs(t0));
        }
    }

    private static Outcome handleAuth(VBPConnection conn, String host, int port, String user, String pw,
                                      Map<String, Object> t, String cat, String name, int id, long t0) {
        try (VBPConnection c = new VBPConnection(host, port, user, pw, "", 5)) {
            c.connect();
            return new Outcome(id, name, cat, "PASS", "auth ok", elapsedMs(t0));
        } catch (Throwable e) {
            return new Outcome(id, name, cat, "FAIL", "auth failed: " + e.getMessage(), elapsedMs(t0));
        }
    }

    private static Outcome handleQuery(VBPConnection conn, String host, int port, String user, String pw,
                                       Map<String, Object> t, String cat, String name, int id, long t0) {
        try (VBPConnection c = new VBPConnection(host, port, user, pw, "", 5)) {
            c.connect();
            VBPResult r = c.execute("SELECT 1");
            return new Outcome(id, name, cat, "PASS",
                    "query ok (rows=" + r.rowCount() + ", tag=" + r.commandTag + ")", elapsedMs(t0));
        } catch (Throwable e) {
            return new Outcome(id, name, cat, "FAIL", "query failed: " + e.getMessage(), elapsedMs(t0));
        }
    }

    private static double elapsedMs(long t0) {
        return (System.nanoTime() - t0) / 1_000_000.0;
    }

    // ============================================================
    // YAML loader — stdlib only, ported from VbpHarness.java
    // ============================================================

    static int leadingSpaces(String s) {
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) != ' ') return i;
        return -1;
    }

    static String stripQuotes(String s) {
        if (s.length() >= 2) {
            char a = s.charAt(0), b = s.charAt(s.length() - 1);
            if ((a == '"' && b == '"') || (a == '\'' && b == '\'')) {
                return s.substring(1, s.length() - 1);
            }
        }
        return s;
    }

    static Object parseScalar(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        if (v.isEmpty()) return null;
        String low = v.toLowerCase(Locale.ROOT);
        if ("true".equals(low)) return Boolean.TRUE;
        if ("false".equals(low)) return Boolean.FALSE;
        if ("null".equals(low) || "~".equals(low)) return null;
        if (v.startsWith("[") && v.endsWith("]")) {
            String inner = v.substring(1, v.length() - 1).trim();
            if (inner.isEmpty()) return new ArrayList<>();
            List<Object> out = new ArrayList<>();
            for (String p : inner.split(",")) out.add(parseScalar(p.trim()));
            return out;
        }
        if (v.startsWith("{") && v.endsWith("}")) return v;
        if (v.startsWith("\"") || v.startsWith("'")) return stripQuotes(v);
        try { return Long.parseLong(v); } catch (NumberFormatException ignored) {}
        if (v.startsWith("0x") || v.startsWith("0X")) {
            try { return Long.parseLong(v.substring(2), 16); } catch (NumberFormatException ignored) {}
        }
        try { return Double.parseDouble(v); } catch (NumberFormatException ignored) {}
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> loadYaml(Path p) throws IOException {
        Map<String, Object> out = new LinkedHashMap<>();
        List<String> raw = Files.readAllLines(p, StandardCharsets.UTF_8);
        List<Map<String, Object>> tests = new ArrayList<>();
        int i = 0;
        while (i < raw.size()) {
            String line = raw.get(i);
            String s = line.trim();
            if (s.isEmpty() || s.startsWith("#")) { i++; continue; }
            int indent = leadingSpaces(line);
            if (s.startsWith("- ") && indent == 2) {
                Map<String, Object> cur = new LinkedHashMap<>();
                String first = s.substring(2).trim();
                int colon = first.indexOf(':');
                if (colon >= 0) {
                    cur.put(first.substring(0, colon).trim(), parseScalar(first.substring(colon + 1).trim()));
                }
                i++;
                while (i < raw.size()) {
                    String nx = raw.get(i);
                    if (nx.trim().isEmpty()) { i++; continue; }
                    int ix = leadingSpaces(nx);
                    String stripped = nx.trim();
                    if (ix == 2 && stripped.startsWith("- ")) break;
                    if (ix == 0 && !stripped.isEmpty()) break;
                    int c = stripped.indexOf(':');
                    if (c >= 0) {
                        cur.put(stripped.substring(0, c).trim(),
                                parseScalar(stripped.substring(c + 1).trim()));
                    }
                    i++;
                }
                tests.add(cur);
                continue;
            }
            if (indent == 0 && s.contains(":")) {
                int c = s.indexOf(':');
                out.put(s.substring(0, c).trim(),
                        parseScalar(s.substring(c + 1).trim()));
            }
            i++;
        }
        if (!tests.isEmpty()) out.put("tests", tests);
        return out;
    }

    // ============================================================
    // JUnit XML writer
    // ============================================================

    static String xmlEscape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&apos;");
    }

    public static void writeJUnit(List<Outcome> outcomes, Path out, String suiteName) throws IOException {
        TreeMap<String, List<Outcome>> byCat = new TreeMap<>();
        for (Outcome o : outcomes) byCat.computeIfAbsent(o.category, k -> new ArrayList<>()).add(o);
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuites>\n");
        for (Map.Entry<String, List<Outcome>> e : byCat.entrySet()) {
            List<Outcome> oo = e.getValue();
            int fails = 0, skips = 0, errs = 0;
            double totalDur = 0;
            for (Outcome o : oo) {
                if ("FAIL".equals(o.status)) fails++;
                if ("SKIP".equals(o.status)) skips++;
                if ("ERROR".equals(o.status)) errs++;
                totalDur += o.durationMs;
            }
            sb.append("  <testsuite name=\"").append(xmlEscape(e.getKey()))
              .append("\" tests=\"").append(oo.size())
              .append("\" failures=\"").append(fails)
              .append("\" skipped=\"").append(skips)
              .append("\" errors=\"").append(errs)
              .append("\" time=\"").append(String.format(Locale.ROOT, "%.3f", totalDur / 1000.0))
              .append("\">\n");
            for (Outcome o : oo) {
                sb.append("    <testcase classname=\"").append(xmlEscape(suiteName))
                  .append("\" name=\"").append(xmlEscape(o.id + " " + o.name))
                  .append("\" time=\"").append(String.format(Locale.ROOT, "%.3f", o.durationMs / 1000.0))
                  .append("\">\n");
                if ("FAIL".equals(o.status))  sb.append("      <failure>").append(xmlEscape(o.message)).append("</failure>\n");
                if ("SKIP".equals(o.status))  sb.append("      <skipped>").append(xmlEscape(o.message)).append("</skipped>\n");
                if ("ERROR".equals(o.status)) sb.append("      <error>").append(xmlEscape(o.message)).append("</error>\n");
                sb.append("    </testcase>\n");
            }
            sb.append("  </testsuite>\n");
        }
        sb.append("</testsuites>\n");
        Files.writeString(out, sb.toString(), StandardCharsets.UTF_8);
    }
}
