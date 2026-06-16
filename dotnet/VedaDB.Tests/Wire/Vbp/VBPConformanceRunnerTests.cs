// VedaDB .NET SDK — VBP wire layer tests
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Xunit;
using VedaDB.Wire.Vbp;

namespace VedaDB.Tests.Wire.Vbp
{
    public class VBPConformanceRunnerTests
    {
        private const string SampleYaml = @"
version: 1
tests:
  - id: 1
    name: connect tcp
    category: connect
  - id: 2
    name: client hello
    category: hello
  - id: 3
    name: auth plain
    category: auth
  - id: 4
    name: select 1
    category: query
  - id: 5
    name: skip me
    category: not_implemented
";

        private static string WriteTemp(string content)
        {
            var path = Path.Combine(Path.GetTempPath(), $"vbp-test-{Guid.NewGuid():N}.yaml");
            File.WriteAllText(path, content, new UTF8Encoding(false));
            return path;
        }

        [Fact]
        public void LoadYaml_ParsesTopLevel()
        {
            var path = WriteTemp(SampleYaml);
            var data = VBPConformanceRunner.LoadYaml(path);
            Assert.True(data.ContainsKey("version"));
            Assert.Equal(1L, data["version"]);
            File.Delete(path);
        }

        [Fact]
        public void LoadYaml_ParsesTests()
        {
            var path = WriteTemp(SampleYaml);
            var data = VBPConformanceRunner.LoadYaml(path);
            var tests = Assert.IsType<List<Dictionary<string, object>>>(data["tests"]);
            Assert.Equal(5, tests.Count);
            Assert.Equal("connect tcp", tests[0]["name"]);
            Assert.Equal(1L, tests[0]["id"]);
            File.Delete(path);
        }

        [Fact]
        public void Run_WithoutLiveServer_FailsConnect()
        {
            var path = WriteTemp(SampleYaml);
            var outcomes = VBPConformanceRunner.Run(path, "127.0.0.1", 1, "u", "p", "connect");
            Assert.Single(outcomes);
            Assert.Equal("FAIL", outcomes[0].Status);
            Assert.Contains("connect", outcomes[0].Message, StringComparison.OrdinalIgnoreCase);
            File.Delete(path);
        }

        [Fact]
        public void Run_SkipsOtherCategories_WithFilter()
        {
            var path = WriteTemp(SampleYaml);
            var outcomes = VBPConformanceRunner.Run(path, "127.0.0.1", 1, "u", "p", "auth");
            Assert.Single(outcomes);
            Assert.Equal(3, outcomes[0].Id); // SampleYaml has auth at id=3
            File.Delete(path);
        }

        [Fact]
        public void Run_UnknownCategory_IsSkipped()
        {
            var path = WriteTemp(SampleYaml);
            var outcomes = VBPConformanceRunner.Run(path, "127.0.0.1", 1, "u", "p", "not_implemented");
            Assert.Single(outcomes);
            Assert.Equal("SKIP", outcomes[0].Status);
            File.Delete(path);
        }

        [Fact]
        public void WriteJUnit_ProducesValidXml()
        {
            var outcomes = new List<VBPConformanceRunner.Outcome>
            {
                new VBPConformanceRunner.Outcome(1, "test1", "connect", "PASS", "ok", 1.5),
                new VBPConformanceRunner.Outcome(2, "test2", "connect", "FAIL", "bad", 0.5),
                new VBPConformanceRunner.Outcome(3, "test3", "query", "SKIP", "nope", 0.1),
                new VBPConformanceRunner.Outcome(4, "test4", "query", "ERROR", "oops", 0.2),
            };
            var path = Path.Combine(Path.GetTempPath(), $"vbp-junit-{Guid.NewGuid():N}.xml");
            VBPConformanceRunner.WriteJUnit(outcomes, path, "vbp-conformance-v1");
            var content = File.ReadAllText(path);
            Assert.Contains("<?xml", content);
            Assert.Contains("<testsuites>", content);
            Assert.Contains("</testsuites>", content);
            Assert.Contains("<testsuite name=\"connect\"", content);
            Assert.Contains("<testsuite name=\"query\"", content);
            Assert.Contains("<failure>bad</failure>", content);
            Assert.Contains("<skipped>nope</skipped>", content);
            Assert.Contains("<error>oops</error>", content);
            File.Delete(path);
        }

        [Fact]
        public void Run_EmptyFile_ProducesEmpty()
        {
            var path = WriteTemp("");
            var outcomes = VBPConformanceRunner.Run(path, "127.0.0.1", 1, "u", "p", "");
            Assert.Empty(outcomes);
            File.Delete(path);
        }
    }
}
