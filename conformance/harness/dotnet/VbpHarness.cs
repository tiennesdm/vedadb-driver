// VBP v1 conformance skeleton harness (C# / .NET).
//
// Loads conformance/vbp_suite.yaml using only the .NET BCL
// (System.IO + a hand-rolled block-style YAML parser). Iterates
// every test, emits a JUnit XML report, SKIPs all tests. Exit
// code 0 on success, 1 on any FAIL/ERROR.
//
// Build (.NET 8+):
//   dotnet new console -n vbp_harness --force -o .
//   # paste this file over Program.cs
//   dotnet build -c Release
//
// Or single-file run (no project):
//   dotnet run VbpHarness.cs -- --suite ../../vbp_suite.yaml \
//                              --out   ./vbp-conformance-dotnet.junit.xml
//
// The skeleton uses only System.* — no third-party packages —
// so CI does not need NuGet.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

public class VbpHarness
{
    // --- test outcome ---------------------------------------------------

    sealed class Outcome
    {
        public long Id;
        public string Name = "";
        public string Category = "";
        public string Status = "skip";
        public string Message = "";
        public double Duration;
    }

    // --- minimal Value + parser ----------------------------------------

    abstract class V { }
    sealed class VNull : V { public override string ToString() => "null"; }
    sealed class VBool : V { public bool B; public VBool(bool b) { B = b; } public override string ToString() => B ? "true" : "false"; }
    sealed class VInt : V { public long I; public VInt(long i) { I = i; } public override string ToString() => I.ToString(); }
    sealed class VFloat : V { public double F; public VFloat(double f) { F = f; } public override string ToString() => F.ToString("G"); }
    sealed class VStr : V { public string S; public VStr(string s) { S = s; } public override string ToString() => S; }
    sealed class VList : V { public List<V> Items = new(); }

    static V ParseScalar(string raw)
    {
        if (raw == null) return new VNull();
        var v = raw.Trim();
        if (v.Length == 0) return new VNull();
        var low = v.ToLowerInvariant();
        if (low == "true") return new VBool(true);
        if (low == "false") return new VBool(false);
        if (low == "null" || low == "~") return new VNull();
        if ((v.StartsWith("\"") && v.EndsWith("\"")) || (v.StartsWith("'") && v.EndsWith("'")))
            return new VStr(v.Substring(1, v.Length - 2));
        if (v.StartsWith("[") && v.EndsWith("]"))
        {
            var inner = v.Substring(1, v.Length - 2).Trim();
            var list = new VList();
            if (inner.Length > 0)
                foreach (var p in inner.Split(',')) list.Items.Add(ParseScalar(p.Trim()));
            return list;
        }
        if (long.TryParse(v, out long i)) return new VInt(i);
        if (double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double f)) return new VFloat(f);
        return new VStr(v);
    }

    static int LeadingSpaces(string s)
    {
        for (int i = 0; i < s.Length; i++) if (s[i] != ' ') return i;
        return -1;
    }

    /// <summary>
    /// Block-style YAML loader for the shape used by vbp_suite.yaml.
    /// Returns the suite name and the list of test cases (each test
    /// case is a list of (key, value) pairs in insertion order).
    /// </summary>
    static (string suiteName, List<List<(string key, V value)>> tests) LoadYaml(string path)
    {
        var lines = File.ReadAllLines(path);
        var top = new List<(string, V)>();
        var tests = new List<List<(string, V)>>();
        int i = 0;
        while (i < lines.Length)
        {
            var line = lines[i];
            var s = line.Trim();
            if (s.Length == 0 || s.StartsWith("#")) { i++; continue; }
            int indent = LeadingSpaces(line);
            if (s.StartsWith("- ") && indent == 2)
            {
                var cur = new List<(string, V)>();
                var first = s.Substring(2).Trim();
                int colon = first.IndexOf(':');
                if (colon >= 0) cur.Add((first.Substring(0, colon).Trim(), ParseScalar(first.Substring(colon + 1).Trim())));
                i++;
                while (i < lines.Length)
                {
                    var nx = lines[i];
                    if (nx.Trim().Length == 0) { i++; continue; }
                    var stripped = nx.TrimStart();
                    int ix = nx.Length - stripped.Length;
                    if (ix == 2 && stripped.StartsWith("- ")) break;
                    if (ix == 0 && stripped.Length > 0) break;
                    int c = stripped.IndexOf(':');
                    if (c >= 0)
                        cur.Add((stripped.Substring(0, c).Trim(), ParseScalar(stripped.Substring(c + 1).Trim())));
                    i++;
                }
                tests.Add(cur);
                continue;
            }
            if (indent == 0 && s.Contains(":"))
            {
                int c = s.IndexOf(':');
                top.Add((s.Substring(0, c).Trim(), ParseScalar(s.Substring(c + 1).Trim())));
            }
            i++;
        }
        var suiteName = top.FirstOrDefault(p => p.Item1 == "suite").Item2 is VStr s2 ? s2.S : "vbp-conformance-v1";
        return (suiteName, tests);
    }

    // --- JUnit emit -----------------------------------------------------

    static string XmlEscape(string s)
    {
        if (s == null) return "";
        return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
                .Replace("\"", "&quot;").Replace("'", "&apos;");
    }

    static void WriteJUnit(IEnumerable<Outcome> outcomes, string outPath, string suiteName)
    {
        var byCat = new SortedDictionary<string, List<Outcome>>();
        foreach (var o in outcomes)
        {
            if (!byCat.ContainsKey(o.Category)) byCat[o.Category] = new List<Outcome>();
            byCat[o.Category].Add(o);
        }
        var sb = new StringBuilder();
        sb.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLine("<testsuites>");
        foreach (var kv in byCat)
        {
            var cat = kv.Key;
            var oo = kv.Value;
            int fails = oo.Count(o => o.Status == "fail");
            int skips = oo.Count(o => o.Status == "skip");
            int errs  = oo.Count(o => o.Status == "error");
            double totalDur = oo.Sum(o => o.Duration);
            sb.AppendLine($"  <testsuite name=\"{XmlEscape(cat)}\" tests=\"{oo.Count}\" failures=\"{fails}\" skipped=\"{skips}\" errors=\"{errs}\" time=\"{totalDur.ToString("F3", System.Globalization.CultureInfo.InvariantCulture)}\">");
            foreach (var o in oo)
            {
                sb.AppendLine($"    <testcase classname=\"{XmlEscape(suiteName)}\" name=\"{XmlEscape(o.Id + " " + o.Name)}\" time=\"{o.Duration.ToString("F3", System.Globalization.CultureInfo.InvariantCulture)}\">");
                if (o.Status == "fail")  sb.AppendLine($"      <failure>{XmlEscape(o.Message)}</failure>");
                if (o.Status == "skip")  sb.AppendLine($"      <skipped>{XmlEscape(o.Message)}</skipped>");
                if (o.Status == "error") sb.AppendLine($"      <error>{XmlEscape(o.Message)}</error>");
                sb.AppendLine("    </testcase>");
            }
            sb.AppendLine("  </testsuite>");
        }
        sb.AppendLine("</testsuites>");
        File.WriteAllText(outPath, sb.ToString());
    }

    // --- test runner (skeleton — all SKIP) ------------------------------

    static Outcome RunTest(List<(string key, V value)> t)
    {
        var id = t.FirstOrDefault(p => p.key == "id").value;
        var name = t.FirstOrDefault(p => p.key == "name").value;
        var cat  = t.FirstOrDefault(p => p.key == "category").value;
        return new Outcome
        {
            Id = id is VInt vi ? vi.I : 0,
            Name = name is VStr vs ? vs.S : "unknown",
            Category = cat is VStr vsc ? vsc.S : "unknown",
            Status = "skip",
            Message = ".NET harness: skeleton — no test cases driven end-to-end (TODO: port vbp_harness.go to c#)",
            Duration = 0,
        };
    }

    // --- CLI ------------------------------------------------------------

    public static int Main(string[] args)
    {
        string suite = "conformance/vbp_suite.yaml";
        string addr  = "127.0.0.1:6380";
        string out   = "vbp-conformance-dotnet.junit.xml";
        string user  = "admin";
        string pw    = "TestPassword123!";
        string cat   = "";
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--suite":    suite = args[++i]; break;
                case "--addr":     addr  = args[++i]; break;
                case "--out":      out   = args[++i]; break;
                case "--user":     user  = args[++i]; break;
                case "--pass":     pw    = args[++i]; break;
                case "--category": cat   = args[++i]; break;
            }
        }
        _ = (addr, user, pw); // silence unused in skeleton

        if (!File.Exists(suite))
        {
            Console.Error.WriteLine($"ERROR: suite file not found: {suite}");
            return 2;
        }
        var (suiteName, tests) = LoadYaml(suite);
        if (!string.IsNullOrEmpty(cat))
            tests = tests.Where(t => t.FirstOrDefault(p => p.key == "category").value is VStr vsc && vsc.S == cat).ToList();
        var outcomes = tests.Select(RunTest).ToList();
        WriteJUnit(outcomes, out, suiteName);
        Console.WriteLine("VBP v1 conformance (.NET skeleton)");
        Console.WriteLine($"  tests:  {outcomes.Count}");
        Console.WriteLine($"  pass:   {outcomes.Count(o => o.Status == "pass")}");
        Console.WriteLine($"  fail:   {outcomes.Count(o => o.Status == "fail")}");
        Console.WriteLine($"  skip:   {outcomes.Count(o => o.Status == "skip")}");
        Console.WriteLine($"  error:  {outcomes.Count(o => o.Status == "error")}");
        Console.WriteLine($"  report: {out}");
        return (outcomes.Any(o => o.Status == "fail" || o.Status == "error")) ? 1 : 0;
    }
}
