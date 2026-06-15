package io.vedadb.wire.vbp;

import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class VBPConformanceRunnerTest {

    @Test
    void yamlLoaderParsesSuite() throws Exception {
        Path yaml = Files.createTempFile("vbp_suite", ".yaml");
        try {
            Files.writeString(yaml, "version: 2\nsuite: vbp-conformance-v1\nvbp_port: 6380\ntests:\n" +
                    "  - id: 1001\n    name: test_a\n    category: connect\n" +
                    "  - id: 1002\n    name: test_b\n    category: hello\n");
            var data = VBPConformanceRunner.loadYaml(yaml);
            assertEquals("vbp-conformance-v1", data.get("suite"));
            assertEquals(Long.valueOf(6380), data.get("vbp_port"));
            @SuppressWarnings("unchecked")
            List<java.util.Map<String, Object>> tests = (List<java.util.Map<String, Object>>) data.get("tests");
            assertEquals(2, tests.size());
            assertEquals(Long.valueOf(1001), tests.get(0).get("id"));
            assertEquals("connect", tests.get(0).get("category"));
        } finally {
            Files.deleteIfExists(yaml);
        }
    }

    @Test
    void yamlLoaderParsesBooleansAndInts() throws Exception {
        Path yaml = Files.createTempFile("vbp_suite", ".yaml");
        try {
            Files.writeString(yaml, "x: 42\ny: true\nz: 0x10\n");
            var data = VBPConformanceRunner.loadYaml(yaml);
            assertEquals(42L, data.get("x"));
            assertEquals(Boolean.TRUE, data.get("y"));
            assertEquals(16L, data.get("z"));
        } finally {
            Files.deleteIfExists(yaml);
        }
    }

    @Test
    void yamlLoaderIgnoresComments() throws Exception {
        Path yaml = Files.createTempFile("vbp_suite", ".yaml");
        try {
            Files.writeString(yaml, "# header comment\nx: 1\n# mid comment\ny: 2\n");
            var data = VBPConformanceRunner.loadYaml(yaml);
            assertEquals(1L, data.get("x"));
            assertEquals(2L, data.get("y"));
        } finally {
            Files.deleteIfExists(yaml);
        }
    }

    @Test
    void xmlEscapeHandlesSpecials() {
        assertEquals("&lt;tag&gt;", VBPConformanceRunner.xmlEscape("<tag>"));
        assertEquals("a&amp;b", VBPConformanceRunner.xmlEscape("a&b"));
        assertEquals("&quot;hi&quot;", VBPConformanceRunner.xmlEscape("\"hi\""));
    }

    @Test
    void junitXmlEmitsValidStructure() throws Exception {
        Path out = Files.createTempFile("vbp_junit", ".xml");
        try {
            java.util.List<VBPConformanceRunner.Outcome> outcomes = java.util.Arrays.asList(
                    new VBPConformanceRunner.Outcome(1001, "a", "connect", "PASS", "ok", 12.3),
                    new VBPConformanceRunner.Outcome(1002, "b", "hello", "FAIL", "x", 1.0),
                    new VBPConformanceRunner.Outcome(1003, "c", "auth", "SKIP", "y", 0.5));
            VBPConformanceRunner.writeJUnit(outcomes, out, "vbp-conformance-v1");
            String xml = Files.readString(out);
            assertTrue(xml.contains("<?xml"));
            assertTrue(xml.contains("<testsuites>"));
            assertTrue(xml.contains("<testsuite name=\"connect\""));
            assertTrue(xml.contains("<testsuite name=\"hello\""));
            assertTrue(xml.contains("<testsuite name=\"auth\""));
            assertTrue(xml.contains("<failure>x</failure>"));
            assertTrue(xml.contains("<skipped>y</skipped>"));
        } finally {
            Files.deleteIfExists(out);
        }
    }

    @Test
    void runWithUnreachableHostMarksFail() throws Exception {
        Path yaml = Files.createTempFile("vbp_suite", ".yaml");
        try {
            Files.writeString(yaml, "tests:\n" +
                    "  - id: 1001\n    name: connect_test\n    category: connect\n" +
                    "  - id: 1010\n    name: hello_test\n    category: hello\n");
            var outcomes = VBPConformanceRunner.run(yaml.toString(),
                    "127.0.0.1", 1, "admin", "x", "connect,hello");
            assertEquals(2, outcomes.size());
            for (var o : outcomes) {
                assertEquals("FAIL", o.status, "test " + o.id + " should FAIL when host unreachable");
            }
        } finally {
            Files.deleteIfExists(yaml);
        }
    }

    @Test
    void filterLimitsCategories() throws Exception {
        Path yaml = Files.createTempFile("vbp_suite", ".yaml");
        try {
            Files.writeString(yaml, "tests:\n" +
                    "  - id: 1001\n    name: a\n    category: connect\n" +
                    "  - id: 2001\n    name: b\n    category: query_params\n" +
                    "  - id: 1010\n    name: c\n    category: hello\n");
            var outcomes = VBPConformanceRunner.run(yaml.toString(),
                    "127.0.0.1", 1, "admin", "x", "hello");
            assertEquals(1, outcomes.size());
            assertEquals("hello", outcomes.get(0).category);
        } finally {
            Files.deleteIfExists(yaml);
        }
    }

    @Test
    void unknownCategoryIsSkipped() throws Exception {
        Path yaml = Files.createTempFile("vbp_suite", ".yaml");
        try {
            Files.writeString(yaml, "tests:\n" +
                    "  - id: 3001\n    name: a\n    category: future_feature\n");
            var outcomes = VBPConformanceRunner.run(yaml.toString(),
                    "127.0.0.1", 1, "admin", "x", "");
            assertEquals(1, outcomes.size());
            assertEquals("SKIP", outcomes.get(0).status);
        } finally {
            Files.deleteIfExists(yaml);
        }
    }

    @Test
    void jUnitXmlIsParseable() throws Exception {
        Path yaml = Files.createTempFile("vbp_suite", ".yaml");
        Path out = Files.createTempFile("vbp_junit_out", ".xml");
        try {
            Files.writeString(yaml, "tests:\n  - id: 9999\n    name: a\n    category: connect\n");
            var outcomes = VBPConformanceRunner.run(yaml.toString(),
                    "127.0.0.1", 1, "admin", "x", "connect");
            VBPConformanceRunner.writeJUnit(outcomes, out, "vbp-conformance-v1");
            String xml = Files.readString(out);
            // Well-formed: starts with <?xml, ends with </testsuites>, has exactly one testsuites root
            assertTrue(xml.startsWith("<?xml"));
            assertTrue(xml.trim().endsWith("</testsuites>"));
            // No double root
            int open = xml.indexOf("<testsuites>");
            int close = xml.lastIndexOf("</testsuites>");
            assertTrue(open > 0 && close > open);
        } finally {
            Files.deleteIfExists(yaml);
            Files.deleteIfExists(out);
        }
    }
}
