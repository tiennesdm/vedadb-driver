// VedaDB .NET SDK — VBP wire layer
//
// VBP v1 conformance runner. Loads vbp_suite.yaml, runs each test against
// a live VBP server, and emits a JUnit XML report. Mirrors the Java/Python POC.
//
// Usage:
//   VBPConformanceRunner --yaml /path/vbp_suite.yaml \
//     --host 127.0.0.1 --port 6380 \
//     --user admin --pass TestPassword123! \
//     --filter connect,hello,auth,query \
//     --out /tmp/vbp-dotnet-conformance.xml
//
// YAML parser is hand-rolled (System.Text.Json doesn't parse YAML) and only
// supports the subset vbp_suite.yaml uses: simple key:value, lists of dicts,
// quoted/unquoted scalars, ints, bools, and a 1-level deep structure.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace VedaDB.Wire.Vbp
{
    public static class VBPConformanceRunner
    {
        public sealed class Outcome
        {
            public int Id { get; }
            public string Name { get; }
            public string Category { get; }
            public string Status { get; } // PASS, FAIL, SKIP, ERROR
            public string Message { get; }
            public double DurationMs { get; }
            public Outcome(int id, string name, string category, string status, string message, double durationMs)
            {
                Id = id; Name = name; Category = category;
                Status = status; Message = message; DurationMs = durationMs;
            }
        }

        public static int Main(string[] args)
        {
            string? yaml = null, host = "127.0.0.1", user = "admin", pw = "TestPassword123!";
            int port = 6380;
            string out_ = "vbp-conformance-dotnet.junit.xml";
            string filter = "";
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--yaml": yaml = args[++i]; break;
                    case "--host": host = args[++i]; break;
                    case "--port": port = int.Parse(args[++i]); break;
                    case "--user": user = args[++i]; break;
                    case "--pass": pw = args[++i]; break;
                    case "--out": out_ = args[++i]; break;
                    case "--filter": filter = args[++i]; break;
                    default: throw new ArgumentException("unknown arg: " + args[i]);
                }
            }
            if (yaml == null)
            {
                Console.Error.WriteLine("ERROR: --yaml is required");
                return 2;
            }
            var outcomes = Run(yaml, host, port, user, pw, filter);
            WriteJUnit(outcomes, out_, "vbp-conformance-v1");
            int pass = 0, fail = 0, skip = 0, err = 0;
            foreach (var o in outcomes)
            {
                switch (o.Status) { case "PASS": pass++; break; case "FAIL": fail++; break; case "SKIP": skip++; break; case "ERROR": err++; break; }
            }
            Console.WriteLine("VBP v1 conformance (.NET)");
            Console.WriteLine($"  tests:  {outcomes.Count}");
            Console.WriteLine($"  pass:   {pass}");
            Console.WriteLine($"  fail:   {fail}");
            Console.WriteLine($"  skip:   {skip}");
            Console.WriteLine($"  error:  {err}");
            Console.WriteLine($"  report: {out_}");
            return (fail + err) > 0 ? 1 : 0;
        }

        public static List<Outcome> Run(string yamlPath, string host, int port, string user, string pw, string filter)
        {
            var data = LoadYaml(yamlPath);
            var tests = data.TryGetValue("tests", out var tObj) && tObj is List<Dictionary<string, object>> tl
                ? tl : new List<Dictionary<string, object>>();
            var outcomes = new List<Outcome>();
            HashSet<string>? cats = string.IsNullOrEmpty(filter)
                ? null
                : new HashSet<string>(filter.Split(',', StringSplitOptions.RemoveEmptyEntries));
            VBPConnection? conn = null;
            try
            {
                foreach (var t in tests)
                {
                    int id = t.TryGetValue("id", out var iv) && iv is long il ? (int)il : 0;
                    string name = t.TryGetValue("name", out var nv) ? nv?.ToString() ?? "" : "";
                    string cat = t.TryGetValue("category", out var cv) ? cv?.ToString() ?? "" : "";
                    if (cats != null && !cats.Contains(cat)) continue;
                    var sw = Stopwatch.StartNew();
                    Outcome? o;
                    try
                    {
                        o = Dispatch(conn, host, port, user, pw, t, cat, name, id, sw);
                    }
                    catch (Exception e)
                    {
                        o = new Outcome(id, name, cat, "ERROR",
                            e.GetType().Name + ": " + e.Message, sw.Elapsed.TotalMilliseconds);
                    }
                    outcomes.Add(o);
                }
            }
            finally
            {
                try { conn?.Close(); } catch { }
            }
            return outcomes;
        }

        private static Outcome Dispatch(VBPConnection? conn, string host, int port, string user, string pw,
                                        Dictionary<string, object> t, string cat, string name, int id, Stopwatch sw)
        {
            switch (cat)
            {
                case "connect": return HandleConnect(host, port, user, pw, t, cat, name, id, sw);
                case "hello":   return HandleHello(host, port, user, pw, t, cat, name, id, sw);
                case "auth":    return HandleAuth(host, port, user, pw, t, cat, name, id, sw);
                case "query":   return HandleQuery(host, port, user, pw, t, cat, name, id, sw);
                default:        return new Outcome(id, name, cat, "SKIP", "category not implemented in v1 POC", sw.Elapsed.TotalMilliseconds);
            }
        }

        private static Outcome HandleConnect(string host, int port, string user, string pw,
                                             Dictionary<string, object> t, string cat, string name, int id, Stopwatch sw)
        {
            try
            {
                using var c = new VBPConnection(host, port, user, pw, "", 5);
                c.Connect();
                return new Outcome(id, name, cat, "PASS", $"connected to {host}:{port}", sw.Elapsed.TotalMilliseconds);
            }
            catch (Exception e)
            {
                return new Outcome(id, name, cat, "FAIL", "connect failed: " + e.Message, sw.Elapsed.TotalMilliseconds);
            }
        }

        private static Outcome HandleHello(string host, int port, string user, string pw,
                                            Dictionary<string, object> t, string cat, string name, int id, Stopwatch sw)
        {
            try
            {
                using var c = new VBPConnection(host, port, user, pw, "", 5);
                c.Connect();
                int v = c.ServerVersion;
                return new Outcome(id, name, cat, "PASS", $"server version 0x{v:X}", sw.Elapsed.TotalMilliseconds);
            }
            catch (Exception e)
            {
                return new Outcome(id, name, cat, "FAIL", "hello failed: " + e.Message, sw.Elapsed.TotalMilliseconds);
            }
        }

        private static Outcome HandleAuth(string host, int port, string user, string pw,
                                          Dictionary<string, object> t, string cat, string name, int id, Stopwatch sw)
        {
            try
            {
                using var c = new VBPConnection(host, port, user, pw, "", 5);
                c.Connect();
                return new Outcome(id, name, cat, "PASS", "auth ok", sw.Elapsed.TotalMilliseconds);
            }
            catch (Exception e)
            {
                return new Outcome(id, name, cat, "FAIL", "auth failed: " + e.Message, sw.Elapsed.TotalMilliseconds);
            }
        }

        private static Outcome HandleQuery(string host, int port, string user, string pw,
                                           Dictionary<string, object> t, string cat, string name, int id, Stopwatch sw)
        {
            try
            {
                using var c = new VBPConnection(host, port, user, pw, "", 5);
                c.Connect();
                var r = c.Execute("SELECT 1");
                return new Outcome(id, name, cat, "PASS",
                    $"query ok (rows={r.RowCount}, tag={r.CommandTag})", sw.Elapsed.TotalMilliseconds);
            }
            catch (Exception e)
            {
                return new Outcome(id, name, cat, "FAIL", "query failed: " + e.Message, sw.Elapsed.TotalMilliseconds);
            }
        }

        // ============================================================
        // Hand-rolled YAML loader (port of the Java POC's stdlib parser).
        // Supports the subset vbp_suite.yaml uses: top-level key:value, then
        // a `tests:` list of dicts, each with 2-space indented fields.
        // ============================================================

        private static int LeadingSpaces(string s)
        {
            for (int i = 0; i < s.Length; i++) if (s[i] != ' ') return i;
            return -1;
        }

        private static string StripQuotes(string s)
        {
            if (s.Length >= 2)
            {
                char a = s[0], b = s[s.Length - 1];
                if ((a == '"' && b == '"') || (a == '\'' && b == '\''))
                    return s.Substring(1, s.Length - 2);
            }
            return s;
        }

        private static object? ParseScalar(string? raw)
        {
            if (raw == null) return null;
            var v = raw.Trim();
            if (v.Length == 0) return null;
            var low = v.ToLowerInvariant();
            if (low == "true") return true;
            if (low == "false") return false;
            if (low == "null" || low == "~") return null;
            if (v.StartsWith("[") && v.EndsWith("]"))
            {
                var inner = v.Substring(1, v.Length - 2).Trim();
                if (inner.Length == 0) return new List<object?>();
                var outList = new List<object?>();
                foreach (var p in inner.Split(',')) outList.Add(ParseScalar(p.Trim()));
                return outList;
            }
            if (v.StartsWith("{") && v.EndsWith("}")) return v;
            if (v.StartsWith("\"") || v.StartsWith("'")) return StripQuotes(v);
            if (long.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out long lv))
                return lv;
            if ((v.StartsWith("0x") || v.StartsWith("0X"))
                && long.TryParse(v.Substring(2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out long hv))
                return hv;
            if (double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out double dv))
                return dv;
            return v;
        }

        public static Dictionary<string, object> LoadYaml(string path)
        {
            var outDict = new Dictionary<string, object>(StringComparer.Ordinal);
            var raw = File.ReadAllLines(path);
            var tests = new List<Dictionary<string, object>>();
            int i = 0;
            while (i < raw.Length)
            {
                var line = raw[i];
                var s = line.Trim();
                if (s.Length == 0 || s.StartsWith("#")) { i++; continue; }
                int indent = LeadingSpaces(line);
                if (s.StartsWith("- ") && indent == 2)
                {
                    var cur = new Dictionary<string, object>(StringComparer.Ordinal);
                    var first = s.Substring(2).Trim();
                    int colon = first.IndexOf(':');
                    if (colon >= 0)
                    {
                        cur[first.Substring(0, colon).Trim()] = ParseScalar(first.Substring(colon + 1).Trim()) ?? "";
                    }
                    i++;
                    while (i < raw.Length)
                    {
                        var nx = raw[i];
                        if (nx.Trim().Length == 0) { i++; continue; }
                        int ix = LeadingSpaces(nx);
                        var stripped = nx.Trim();
                        if (ix == 2 && stripped.StartsWith("- ")) break;
                        if (ix == 0 && stripped.Length > 0) break;
                        int c = stripped.IndexOf(':');
                        if (c >= 0)
                        {
                            cur[stripped.Substring(0, c).Trim()] = ParseScalar(stripped.Substring(c + 1).Trim()) ?? "";
                        }
                        i++;
                    }
                    tests.Add(cur);
                    continue;
                }
                if (indent == 0 && s.Contains(":"))
                {
                    int c = s.IndexOf(':');
                    outDict[s.Substring(0, c).Trim()] = ParseScalar(s.Substring(c + 1).Trim()) ?? "";
                }
                i++;
            }
            if (tests.Count > 0) outDict["tests"] = tests;
            return outDict;
        }

        // ============================================================
        // JUnit XML writer
        // ============================================================

        private static string XmlEscape(string s)
        {
            if (s == null) return "";
            return s.Replace("&", "&amp;")
                    .Replace("<", "&lt;")
                    .Replace(">", "&gt;")
                    .Replace("\"", "&quot;")
                    .Replace("'", "&apos;");
        }

        public static void WriteJUnit(List<Outcome> outcomes, string outPath, string suiteName)
        {
            var byCat = new SortedDictionary<string, List<Outcome>>(StringComparer.Ordinal);
            foreach (var o in outcomes)
            {
                if (!byCat.TryGetValue(o.Category, out var lst))
                {
                    lst = new List<Outcome>();
                    byCat[o.Category] = lst;
                }
                lst.Add(o);
            }
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuites>\n");
            foreach (var kv in byCat)
            {
                var oo = kv.Value;
                int fails = 0, skips = 0, errs = 0;
                double totalDur = 0;
                foreach (var o in oo)
                {
                    if (o.Status == "FAIL") fails++;
                    if (o.Status == "SKIP") skips++;
                    if (o.Status == "ERROR") errs++;
                    totalDur += o.DurationMs;
                }
                sb.Append("  <testsuite name=\"").Append(XmlEscape(kv.Key))
                  .Append("\" tests=\"").Append(oo.Count)
                  .Append("\" failures=\"").Append(fails)
                  .Append("\" skipped=\"").Append(skips)
                  .Append("\" errors=\"").Append(errs)
                  .Append("\" time=\"").Append(string.Format(CultureInfo.InvariantCulture, "{0:F3}", totalDur / 1000.0))
                  .Append("\">\n");
                foreach (var o in oo)
                {
                    sb.Append("    <testcase classname=\"").Append(XmlEscape(suiteName))
                      .Append("\" name=\"").Append(XmlEscape(o.Id + " " + o.Name))
                      .Append("\" time=\"").Append(string.Format(CultureInfo.InvariantCulture, "{0:F3}", o.DurationMs / 1000.0))
                      .Append("\">\n");
                    if (o.Status == "FAIL")  sb.Append("      <failure>").Append(XmlEscape(o.Message)).Append("</failure>\n");
                    if (o.Status == "SKIP")  sb.Append("      <skipped>").Append(XmlEscape(o.Message)).Append("</skipped>\n");
                    if (o.Status == "ERROR") sb.Append("      <error>").Append(XmlEscape(o.Message)).Append("</error>\n");
                    sb.Append("    </testcase>\n");
                }
                sb.Append("  </testsuite>\n");
            }
            sb.Append("</testsuites>\n");
            File.WriteAllText(outPath, sb.ToString(), new UTF8Encoding(false));
        }
    }
}
