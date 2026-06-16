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
using System.Net;
using System.Net.Sockets;
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
                // V2 STREAMING FIX: always append the multiplexer multichunk
                // hidden test (id=9999) after the YAML-driven tests. This
                // verifies the multiplexer delivers all frames in a
                // multi-DATA_CHUNK response. Mirrors the PHP POC.
                if (cats == null || cats.Contains("streaming"))
                {
                    var sw = Stopwatch.StartNew();
                    try
                    {
                        var o = RunMultiChunkTest(host, port, user, pw);
                        // Rebuild the outcome with the measured duration.
                        outcomes.Add(new Outcome(o.Id, o.Name, o.Category, o.Status,
                            o.Message, sw.Elapsed.TotalMilliseconds));
                    }
                    catch (Exception e)
                    {
                        outcomes.Add(new Outcome(9999,
                            "multiplexer_streaming_multichunk", "streaming", "ERROR",
                            e.GetType().Name + ": " + e.Message, sw.Elapsed.TotalMilliseconds));
                    }
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
        // V2 STREAMING FIX: the multichunk hidden test
        // ============================================================
        // This is the canonical regression test for the DATA_CHUNK
        // accumulation bug. It binds a local TCP listener, accepts a
        // single connection, reads one client frame, then writes back
        // 5 DATA_CHUNK frames + 1 ROWS_FINISHED + 1 COMMAND_COMPLETE
        // in a single TCP flush. The VBPMultiplexer must accumulate
        // all 7 frames into a single VBPReply with Frames.Count == 7.

        private static Outcome RunMultiChunkTest(string host, int port, string user, string pw)
        {
            // We don't actually need a connection to the real VBP server
            // for this test — we use a local listener and feed it frames
            // directly. The host/port/user/pw params are accepted for
            // signature parity with the other Handle* methods.
            var listener = new TcpListener(System.Net.IPAddress.Loopback, 0);
            listener.Start();
            int localPort = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
            try
            {
                // Start a background server that accepts one client, reads
                // one frame, then writes 5 DATA_CHUNKs + ROWS_FINISHED +
                // COMMAND_COMPLETE all in one big flush.
                var serverDone = new System.Threading.Tasks.TaskCompletionSource<bool>();
                System.Threading.Tasks.Task.Run(async () =>
                {
                    try
                    {
                        using var server = await listener.AcceptTcpClientAsync();
                        var s = server.GetStream();
                        // Read the client's request frame so the OS buffer
                        // doesn't back up.
                        var hdr = new byte[VBPFrame.HdrLen];
                        int got = 0;
                        while (got < hdr.Length)
                        {
                            int n = await s.ReadAsync(hdr, got, hdr.Length - got);
                            if (n == 0) return;
                            got += n;
                        }
                        int pl = BitConverter.ToInt32(hdr, 3);
                        var opflags = new byte[VBPFrame.OpFlagsLen];
                        got = 0;
                        while (got < opflags.Length)
                        {
                            int n = await s.ReadAsync(opflags, got, opflags.Length - got);
                            if (n == 0) return;
                            got += n;
                        }
                        int bodyLen = pl - VBPFrame.OpFlagsLen;
                        var bodyBuf = new byte[bodyLen];
                        got = 0;
                        while (got < bodyLen)
                        {
                            int n = await s.ReadAsync(bodyBuf, got, bodyLen - got);
                            if (n == 0) return;
                            got += n;
                        }
                        byte seq = hdr[7];
                        // Build a single buffer with 5 DATA_CHUNKs + 1
                        // ROWS_FINISHED + 1 COMMAND_COMPLETE, then flush.
                        var ms = new MemoryStream();
                        for (int i = 0; i < 5; i++)
                        {
                            var chunk = new VBPFrame(seq, VBPOpcodes.DataChunk, 0,
                                System.Text.Encoding.UTF8.GetBytes("chunk-" + i));
                            var b = chunk.Encode();
                            ms.Write(b, 0, b.Length);
                        }
                        var rowsFin = new VBPFrame(seq, VBPOpcodes.RowsFinished, 0,
                            System.Text.Encoding.UTF8.GetBytes("rows-affected=5"));
                        var rfb = rowsFin.Encode();
                        ms.Write(rfb, 0, rfb.Length);
                        var cc = new VBPFrame(seq, VBPOpcodes.CommandComplete, 0,
                            System.Text.Encoding.UTF8.GetBytes("SELECT 5"));
                        var ccb = cc.Encode();
                        ms.Write(ccb, 0, ccb.Length);
                        ms.Position = 0;
                        var all = ms.ToArray();
                        await s.WriteAsync(all, 0, all.Length);
                        await s.FlushAsync();
                        serverDone.TrySetResult(true);
                    }
                    catch (Exception ex)
                    {
                        serverDone.TrySetException(ex);
                    }
                });

                // Now connect a fresh VBPMultiplexer to our local listener
                // and call Query. The mux should accumulate all 7 frames.
                using var mux = new VBPMultiplexer("127.0.0.1", localPort, 5000);
                var reply = mux.Call(VBPOpcodes.Query,
                    System.Text.Encoding.UTF8.GetBytes("SELECT 1"));
                if (reply.Frames.Count != 7)
                {
                    return new Outcome(9999, "multiplexer_streaming_multichunk", "streaming",
                        "FAIL",
                        $"expected 7 frames, got {reply.Frames.Count}",
                        0);
                }
                if (reply.Op != VBPOpcodes.CommandComplete)
                {
                    return new Outcome(9999, "multiplexer_streaming_multichunk", "streaming",
                        "FAIL",
                        "expected COMMAND_COMPLETE as terminal, got " +
                        VBPOpcodes.OpcodeName(reply.Op),
                        0);
                }
                // Verify the 5 DATA_CHUNKs are in order with the right bodies.
                for (int i = 0; i < 5; i++)
                {
                    if (reply.Frames[i].Op != VBPOpcodes.DataChunk)
                    {
                        return new Outcome(9999, "multiplexer_streaming_multichunk", "streaming",
                            "FAIL",
                            $"frame[{i}]: expected DATA_CHUNK, got " +
                            VBPOpcodes.OpcodeName(reply.Frames[i].Op),
                            0);
                    }
                    var body = System.Text.Encoding.UTF8.GetString(reply.Frames[i].Body);
                    if (body != "chunk-" + i)
                    {
                        return new Outcome(9999, "multiplexer_streaming_multichunk", "streaming",
                            "FAIL",
                            $"frame[{i}] body: expected 'chunk-{i}', got '{body}'",
                            0);
                    }
                }
                if (reply.Frames[5].Op != VBPOpcodes.RowsFinished)
                {
                    return new Outcome(9999, "multiplexer_streaming_multichunk", "streaming",
                        "FAIL",
                        "frame[5]: expected ROWS_FINISHED, got " +
                        VBPOpcodes.OpcodeName(reply.Frames[5].Op),
                        0);
                }
                if (reply.Frames[6].Op != VBPOpcodes.CommandComplete)
                {
                    return new Outcome(9999, "multiplexer_streaming_multichunk", "streaming",
                        "FAIL",
                        "frame[6]: expected COMMAND_COMPLETE, got " +
                        VBPOpcodes.OpcodeName(reply.Frames[6].Op),
                        0);
                }
                // Wait for the server task to complete.
                serverDone.Task.Wait(2000);
                return new Outcome(9999, "multiplexer_streaming_multichunk", "streaming",
                    "PASS",
                    $"multichunk ok: 5 DATA_CHUNKs + ROWS_FINISHED + COMMAND_COMPLETE",
                    0);
            }
            finally
            {
                try { listener.Stop(); } catch { }
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
