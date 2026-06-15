// VBP v1 conformance skeleton harness (Java).
//
// Loads conformance/vbp_suite.yaml using only the JDK stdlib
// (java.nio + a hand-rolled block-style YAML parser). Iterates
// every test, emits a JUnit XML report, SKIPs all tests. Exit
// code 0 on success, 1 on any FAIL/ERROR.
//
// Build (Java 17+):
//   javac VbpHarness.java
//   java  VbpHarness --suite ../../vbp_suite.yaml \
//                     --out   ./vbp-conformance-java.junit.xml
//
// Or via the JDK single-file launcher (Java 11+):
//   java VbpHarness.java --suite ... --out ...

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TreeMap;

public class VbpHarness {

    // --- test outcome ---------------------------------------------------

    static final class Outcome {
        int id;
        String name;
        String category;
        String status; // "pass" | "fail" | "skip" | "error"
        String message;
        double duration; // seconds

        Outcome(int id, String name, String category, String status, String message, double duration) {
            this.id = id;
            this.name = name;
            this.category = category;
            this.status = status;
            this.message = message;
            this.duration = duration;
        }
    }

    // --- tiny YAML loader -----------------------------------------------

    /** Returns the index of the first non-whitespace character in s, or -1. */
    static int leadingSpaces(String s) {
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) != ' ') return i;
        }
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

    /** Parse a YAML scalar value. */
    static Object parseScalar(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        if (v.isEmpty()) return null;
        String low = v.toLowerCase(Locale.ROOT);
        if (low.equals("true")) return Boolean.TRUE;
        if (low.equals("false")) return Boolean.FALSE;
        if (low.equals("null") || low.equals("~")) return null;
        if (v.startsWith("[") && v.endsWith("]")) {
            String inner = v.substring(1, v.length() - 1).trim();
            if (inner.isEmpty()) return new ArrayList<>();
            List<Object> out = new ArrayList<>();
            for (String p : inner.split(",")) out.add(parseScalar(p.trim()));
            return out;
        }
        if (v.startsWith("{") && v.endsWith("}")) {
            // Not used by the suite directly; leave as raw string.
            return v;
        }
        if (v.startsWith("\"") || v.startsWith("'")) return stripQuotes(v);
        try { return Long.parseLong(v); } catch (NumberFormatException ignored) {}
        try { return Double.parseDouble(v); } catch (NumberFormatException ignored) {}
        return v;
    }

    /** Block-style YAML loader: only the shape used by vbp_suite.yaml. */
    static java.util.Map<String, Object> loadYaml(Path p) throws IOException {
        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
        List<String> raw = Files.readAllLines(p, StandardCharsets.UTF_8);
        List<java.util.Map<String, Object>> tests = new ArrayList<>();
        int i = 0;
        while (i < raw.size()) {
            String line = raw.get(i);
            String s = line.trim();
            if (s.isEmpty() || s.startsWith("#")) { i++; continue; }
            int indent = leadingSpaces(line);
            if (s.startsWith("- ") && indent == 2) {
                java.util.Map<String, Object> cur = new java.util.LinkedHashMap<>();
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

    // --- JUnit emit -----------------------------------------------------

    static String xmlEscape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&apos;");
    }

    static void writeJUnit(List<Outcome> outcomes, Path out, String suiteName) throws IOException {
        TreeMap<String, List<Outcome>> byCat = new TreeMap<>();
        for (Outcome o : outcomes) byCat.computeIfAbsent(o.category, k -> new ArrayList<>()).add(o);
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuites>\n");
        for (var e : byCat.entrySet()) {
            List<Outcome> oo = e.getValue();
            int fails = 0, skips = 0, errs = 0;
            double totalDur = 0;
            for (Outcome o : oo) {
                if ("fail".equals(o.status)) fails++;
                if ("skip".equals(o.status)) skips++;
                if ("error".equals(o.status)) errs++;
                totalDur += o.duration;
            }
            sb.append("  <testsuite name=\"").append(xmlEscape(e.getKey()))
              .append("\" tests=\"").append(oo.size())
              .append("\" failures=\"").append(fails)
              .append("\" skipped=\"").append(skips)
              .append("\" errors=\"").append(errs)
              .append("\" time=\"").append(String.format(Locale.ROOT, "%.3f", totalDur))
              .append("\">\n");
            for (Outcome o : oo) {
                sb.append("    <testcase classname=\"").append(xmlEscape(suiteName))
                  .append("\" name=\"").append(xmlEscape(o.id + " " + o.name))
                  .append("\" time=\"").append(String.format(Locale.ROOT, "%.3f", o.duration))
                  .append("\">\n");
                if ("fail".equals(o.status))  sb.append("      <failure>").append(xmlEscape(o.message)).append("</failure>\n");
                if ("skip".equals(o.status))  sb.append("      <skipped>").append(xmlEscape(o.message)).append("</skipped>\n");
                if ("error".equals(o.status)) sb.append("      <error>").append(xmlEscape(o.message)).append("</error>\n");
                sb.append("    </testcase>\n");
            }
            sb.append("  </testsuite>\n");
        }
        sb.append("</testsuites>\n");
        Files.writeString(out, sb.toString(), StandardCharsets.UTF_8);
    }

    // --- test runner (skeleton — all SKIP) ------------------------------

    @SuppressWarnings("unchecked")
    static Outcome runTest(java.util.Map<String, Object> t) {
        Object idObj = t.get("id");
        int id = (idObj instanceof Number) ? ((Number) idObj).intValue() : 0;
        String name = String.valueOf(t.getOrDefault("name", "unknown"));
        String cat  = String.valueOf(t.getOrDefault("category", "unknown"));
        return new Outcome(id, name, cat, "skip",
                "Java harness: skeleton — no test cases driven end-to-end (TODO: port vbp_harness.go to java)",
                0.0);
    }

    // --- CLI ------------------------------------------------------------

    public static void main(String[] args) throws IOException {
        String suite = "conformance/vbp_suite.yaml";
        String addr = "127.0.0.1:6380";
        String out  = "vbp-conformance-java.junit.xml";
        String user = "admin";
        String pw   = "TestPassword123!";
        String cat  = "";
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--suite":    suite = args[++i]; break;
                case "--addr":     addr = args[++i]; break;
                case "--out":      out  = args[++i]; break;
                case "--user":     user = args[++i]; break;
                case "--pass":     pw   = args[++i]; break;
                case "--category": cat  = args[++i]; break;
            }
        }
        // silence unused in skeleton
        @SuppressWarnings("unused") int unused = (addr.length() + user.length() + pw.length());

        if (!Files.exists(Paths.get(suite))) {
            System.err.println("ERROR: suite file not found: " + suite);
            System.exit(2);
        }
        java.util.Map<String, Object> data = loadYaml(Paths.get(suite));
        @SuppressWarnings("unchecked")
        List<java.util.Map<String, Object>> tests = (List<java.util.Map<String, Object>>) data.getOrDefault("tests", new ArrayList<>());
        if (!cat.isEmpty()) {
            final String catF = cat;
            tests.removeIf(t -> !catF.equals(String.valueOf(t.get("category"))));
        }
        String suiteName = String.valueOf(data.getOrDefault("suite", "vbp-conformance-v1"));

        List<Outcome> outcomes = new ArrayList<>();
        for (var t : tests) outcomes.add(runTest(t));

        writeJUnit(outcomes, Paths.get(out), suiteName);

        long passN = outcomes.stream().filter(o -> "pass".equals(o.status)).count();
        long failN = outcomes.stream().filter(o -> "fail".equals(o.status)).count();
        long skipN = outcomes.stream().filter(o -> "skip".equals(o.status)).count();
        long errN  = outcomes.stream().filter(o -> "error".equals(o.status)).count();
        System.out.println("VBP v1 conformance (Java skeleton)");
        System.out.println("  tests:  " + outcomes.size());
        System.out.println("  pass:   " + passN);
        System.out.println("  fail:   " + failN);
        System.out.println("  skip:   " + skipN);
        System.out.println("  error:  " + errN);
        System.out.println("  report: " + out);
        System.exit((failN + errN) > 0 ? 1 : 0);
    }
}
